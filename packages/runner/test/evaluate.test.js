import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runEval } from '../src/evaluate.js';
import { publishRun } from '../src/publish.js';
import { createWorkspace } from '../src/workspace.js';
import { defineEval } from '../src/formats.js';
import { estimateCost, provenance } from '../src/metadata.js';
import { fileURLToPath } from 'node:url';

async function setup(t, actions, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vibeval-run-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const definition = defineEval({ id: 'test-eval', format: 'text', assessment: { type: 'subjective' }, constraints: { asciiOnly: true }, limits: { maxTurns: 6, maxWallMs: 10000 }, ...overrides });
  await writeFile(join(directory, 'eval.json'), JSON.stringify(definition));
  let count = 0, disposed = false;
  const observations = [];
  const options = { root: directory, directory, definition, prompt: 'Draw an ASCII ship.', provider: 'codex-cli', model: 'pinned-model', effort: 'medium',
    harness: { version: 'test', commit: 'abc123', dirty: false }, runtimeVersion: 'fixture-cli 1',
    createProvider(settings) {
      assert.equal(settings.model, 'pinned-model'); assert.equal(settings.effort, 'medium'); assert.equal(settings.webSearch, false);
      return { requestText: async messages => { observations.push(messages[0]); return JSON.stringify(actions[count++] ?? { action: 'draft', content: 'unfinished' }); },
        stats: () => ({ turns: count, requests: count, inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, costReported: false }),
        dispose: () => { disposed = true; } };
    },
  };
  return { options, observations, directory, disposed: () => disposed };
}

test('text runs revise invalid submissions, freeze the final text, and publish metadata/history', async t => {
  const s = await setup(t, [{ action: 'draft', content: '   /\\\n__/__\\__' }, { action: 'submit', content: 'ship 🌊' }, { action: 'submit', content: '  |\n__|__\n\\___/', note: 'Reviewed spacing' }]);
  const { record, directory } = await runEval(s.options);
  assert.equal(record.status, 'submitted'); assert.equal(record.turns.harness, 3); assert.equal(record.turns.submissions, 2);
  assert.equal(record.model.resolved, null); assert.equal(record.turns.modelTurns, null); assert.equal(record.cost.usd, null);
  assert.match(s.observations[2], /Only ASCII/); assert.ok(s.disposed());
  assert.equal(await readFile(join(directory, 'artifact/result.txt'), 'utf8'), '  |\n__|__\n\\___/');
  const published = await publishRun(s.directory, directory);
  assert.equal(published.status, 'submitted');
  await access(join(s.directory, 'data/public', published.artifact.entry));
  const events = JSON.parse(await readFile(join(s.directory, 'data/public', published.trace)));
  assert.equal(events.filter(e => e.type === 'response').length, 3);
  await assert.rejects(publishRun(s.directory, directory), /already published/);
});

test('a draft at the turn limit is never promoted to a submission', async t => {
  const s = await setup(t, [{ action: 'draft', content: 'draft only' }], { limits: { maxTurns: 1, maxWallMs: 10000 } });
  const result = await runEval(s.options);
  assert.equal(result.record.status, 'turn_limit'); assert.equal(result.record.artifact, null);
  const published = await publishRun(s.directory, result.directory);
  assert.equal(published.artifact, null);
});

test('file runs get an isolated workspace, check missing assets, revise, and submit a frozen tree', async t => {
  const s = await setup(t, [
    { action: 'write_file', path: '../escape', content: 'bad' },
    { action: 'write_file', path: 'index.html', content: '<html><script src="scene.js"></script></html>' },
    { action: 'submit' },
    { action: 'write_file', path: 'scene.js', content: 'document.body.textContent = "Snow globe";' },
    { action: 'check' }, { action: 'submit', note: 'Local references checked' },
  ], { format: 'files', entry: 'index.html' });
  const result = await runEval(s.options);
  assert.equal(result.record.status, 'submitted'); assert.match(s.observations[1], /no traversal/);
  assert.match(s.observations[3], /Missing local asset/);
  await writeFile(join(result.directory, 'workspace/scene.js'), 'changed after submit');
  assert.match(await readFile(join(result.directory, 'artifact/scene.js'), 'utf8'), /Snow globe/);
  const published = await publishRun(s.directory, result.directory);
  await access(join(s.directory, 'data/public', published.artifact.entry));
});

test('numeric scoring is independent of artifact format and runs on final submission', async t => {
  const s = await setup(t, [{ action: 'submit', content: '12345' }], { assessment: { type: 'numeric', metrics: [{ id: 'length', direction: 'higher' }] } });
  const result = await runEval({ ...s.options, score: ({ content }) => ({ length: content.length }) });
  assert.deepEqual(result.record.metrics, { length: 5 }); assert.equal(result.record.status, 'submitted');
  await assert.rejects(runEval(s.options), /score function/);
});

test('wall limits dispose a stuck provider and persist an unsubmitted run', async t => {
  const s = await setup(t, [], { limits: { maxTurns: 3, maxWallMs: 30 } });
  let disposed = false;
  const result = await runEval({ ...s.options, createProvider: () => ({ requestText: () => new Promise(() => {}), stats: () => ({}), dispose: () => { disposed = true; } }) });
  assert.equal(result.record.status, 'time_limit'); assert.equal(result.record.artifact, null); assert.ok(disposed);
  assert.equal(JSON.parse(await readFile(join(result.directory, 'run.json'))).status, 'time_limit');
});

test('provider setup errors persist a failed run', async t => {
  const s = await setup(t, []);
  const result = await runEval({ ...s.options, createProvider() { throw new Error('No CLI'); } });
  assert.equal(result.record.status, 'failed'); assert.match(result.record.error, /No CLI/);
});

test('workspace rejects traversal, symlinks, byte budgets and external asset references', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vibeval-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = createWorkspace(directory, { maxArtifactBytes: 200, maxFiles: 2 });
  for (const path of ['/tmp/x', '../x', 'a/../../x', '.env', 'x\\..\\y']) await assert.rejects(workspace.write(path, 'x'));
  await assert.rejects(workspace.write('large.txt', 'x'.repeat(201)), /byte budget/);
  await workspace.write('index.html', '<html><script src="https://example.com/x.js"></script></html>');
  assert.equal((await workspace.check()).valid, false);
  await symlink('/tmp', join(directory, 'link'));
  await assert.rejects(workspace.read('link/x'), /Symlinks/);
});

test('publisher rejects artifacts modified after submission', async t => {
  const s = await setup(t, [{ action: 'submit', content: 'Final' }]);
  const result = await runEval(s.options);
  await writeFile(join(result.directory, 'artifact/result.txt'), 'Tampered');
  await assert.rejects(publishRun(s.directory, result.directory), /changed since submission/);
});

test('pricing records exact-model snapshots, handles provider cache semantics, and preserves unknowns', () => {
  const pricing = { asOf: '2026-01-01', source: 'test snapshot', models: { model: { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 20 } } };
  const usage = { inputTokens: 1000000, cacheReadTokens: 500000, outputTokens: 100000, thinkingTokens: 50000 };
  assert.equal(estimateCost({ provider: 'codex-cli', model: 'model', usage, pricing }).usd, 7.5);
  assert.equal(estimateCost({ provider: 'claude-cli', model: 'model', usage, pricing }).usd, 12.5);
  assert.equal(estimateCost({ provider: 'codex-cli', model: 'unknown', usage, pricing }).usd, null);
  assert.equal(estimateCost({ provider: 'claude-cli', model: 'unknown', usage: { costReported: true, costUsd: 0 } }).usd, 0);
});

test('both CLI transports complete text and file submissions using fake executables', async t => {
  const oldPath = process.env.PATH;
  process.env.PATH = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}:${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; delete process.env.VIBEVAL_FIXTURE_SUBMISSION; });
  for (const provider of ['claude-cli', 'codex-cli']) {
    for (const format of ['text', 'files']) {
      process.env.VIBEVAL_FIXTURE_SUBMISSION = format;
      const s = await setup(t, [], format === 'files' ? { format, entry: 'index.html' } : {});
      const options = { ...s.options, provider };
      delete options.createProvider;
      const result = await runEval(options);
      assert.equal(result.record.status, 'submitted');
      assert.equal(result.record.turns.harness, format === 'text' ? 1 : 2);
      assert.equal(result.record.model.requested, 'pinned-model');
      assert.equal(result.record.settings.effort, 'medium');
      assert.equal(result.record.turns.retries, 0);
    }
  }
});

test('interrupting a run preserves its interrupted status', async t => {
  const s = await setup(t, []);
  const controller = new AbortController();
  const result = await runEval({ ...s.options, signal: controller.signal,
    createProvider: () => ({ requestText: () => { controller.abort(); return new Promise(() => {}); }, stats: () => ({}), dispose() {} }) });
  assert.equal(result.record.status, 'interrupted');
});

test('provenance detects scorer changes even without a Git repository', async t => {
  const s = await setup(t, []);
  await mkdir(join(s.directory, 'packages/runner/src'), { recursive: true });
  await writeFile(join(s.directory, 'packages/runner/src/runner.js'), 'version one');
  await writeFile(join(s.directory, 'package-lock.json'), '{}');
  const evalDir = join(s.directory, 'evals/example');
  await mkdir(evalDir, { recursive: true });
  await writeFile(join(evalDir, 'scorer.js'), 'score version one');
  const before = await provenance(s.directory, s.options.definition, 'Prompt', 'Instructions', evalDir);
  await writeFile(join(evalDir, 'scorer.js'), 'score version two');
  const after = await provenance(s.directory, s.options.definition, 'Prompt', 'Instructions', evalDir);
  assert.equal(before.sourceSha256, after.sourceSha256);
  assert.notEqual(before.evalSha256, after.evalSha256);
  assert.equal(after.commit, null);
});

test('every request exposes remaining responses and fallback time, with a last-response submission warning',async t=>{
 const s=await setup(t,[{action:'draft',content:'draft'},{action:'submit',content:'final'}],{limits:{maxTurns:2,maxWallMs:10000}});
 const r=await runEval(s.options);assert.equal(r.record.status,'submitted');assert.match(s.observations[0],/"responsesRemainingIncludingThis":2/);assert.match(s.observations[1],/"responsesRemainingIncludingThis":1/);assert.match(s.observations[1],/LAST RESPONSE/);assert.match(s.observations[0],/fallbackSecondsRemaining/);
});

test('choice evaluation asks the exact question once and records its first answer without a submit protocol',async t=>{
 const s=await setup(t,[],{format:'choice',choices:['rock','paper','scissors'],assessment:{type:'distribution'},limits:{maxTurns:1,maxWallMs:10000}});let calls=0;
 const result=await runEval({...s.options,prompt:'Choose rock, paper, or scissors.',createProvider:settings=>{assert.equal(settings.retryOnFailure,false);assert.doesNotMatch(settings.systemPrompt,/submit|iterate|JSON/);return{requestText:async messages=>{calls++;assert.deepEqual(messages,['Choose rock, paper, or scissors.']);return 'Paper\n';},stats:()=>({requests:calls}),dispose(){}};}});
 assert.equal(calls,1);assert.equal(result.record.choice,'paper');assert.equal(result.record.status,'submitted');assert.equal(await readFile(join(result.directory,'artifact/result.txt'),'utf8'),'Paper\n');
});
test('invalid single-turn choices are retained without asking again or coercing an explanation into a choice',async t=>{
 const s=await setup(t,[],{format:'choice',choices:['rock','paper','scissors'],assessment:{type:'distribution'},limits:{maxTurns:1,maxWallMs:10000}});let calls=0;
 const result=await runEval({...s.options,createProvider:()=>({requestText:async()=>{calls++;return 'I choose rock.';},stats:()=>({}),dispose(){}})});
 assert.equal(calls,1);assert.equal(result.record.choice,null);assert.equal(result.record.response,'I choose rock.');assert.equal(result.record.artifact,null);
});
