import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseSchema, researchAudit } from '../src/model.js';
import { codexArgs, runTrial } from '../src/run.js';
import { execute } from '../src/process.js';
import { candidateHash } from '../src/lint.js';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, reviewFor, eventStream, fakeTool, fakeInference } from './fixtures.js';

async function options(t) {
  const outputRoot = await mkdtemp(join(tmpdir(), 'doom-lifecycle-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  return { outputRoot, runTool: fakeTool, inferModel: fakeInference };
}
const response = (candidate, web = true) => ({ code: 0, stdout: eventStream(candidate, web), stderr: '' });

test('source strings never count as observed web activity or verified citations', () => {
  assert.equal(researchAudit([{ type: 'item.completed', item: { type: 'agent_message', text: 'I searched the web' } }]).webSearchCalls, 0);
  const audit = researchAudit([{ type: 'item.completed', item: { type: 'web_search', action: { type: 'search', query: 'risk' } } }]);
  assert.equal(audit.webSearchCalls, 1);
  assert.match(audit.citationVerification, /unverified/);
});

test('research CLI pins model, effort, live search and isolated configuration', () => {
  const args = codexArgs({ model: 'gpt-6-luna', effort: 'medium', workspace: '/tmp/example', schema: '/tmp/schema' });
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-luna');
  assert.ok(args.includes('web_search="live"'));
  assert.ok(args.includes('features.shell_tool=false'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('read-only'));
  assert.deepEqual(Object.keys(responseSchema.properties).sort(), [...responseSchema.required].sort());
});

test('deadline terminates a process and preserves partial output', async () => {
  await assert.rejects(execute(process.execPath, ['-e', 'console.log("started");setTimeout(()=>{},10000)'], { timeoutMs: 500 }), error => error.code === 'TIMEOUT' && error.stdout.includes('started'));
});

test('same model evaluates then reviews and submits in two rounds, preserving structured review and lint', async t => {
  const target = fixture(); let calls = 0;
  const result = await runTrial({ ...await options(t), maxTurns: 2, model: 'gpt-6-luna', effort: 'medium',
    runAgent: async (_command, args, { input }) => {
      calls++;
      assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-luna');
      assert.ok(args.includes('model_reasoning_effort="medium"'));
      if (calls === 1) return response(target);
      assert.match(input, /Phase: review/);
      assert.ok(input.includes(candidateHash(target)));
      assert.match(input, /final allowed response/);
      return response({ ...target, action: 'submit', review: reviewFor(target) }, false);
    } });
  assert.equal(calls, 2);
  assert.equal(result.record.status, 'submitted');
  assert.deepEqual(result.record.rounds.map(r => r.phase), ['research', 'review']);
  assert.ok(result.record.rounds.every(r => r.lint.valid));
  assert.equal(result.record.rounds[1].reviewTargetSha256, candidateHash(target));
  assert.equal(result.record.submission.review.checks.length, 8);
  assert.ok(result.record.submission.review.checks.every(c => c.status === 'uncertain'));
  assert.equal(result.record.usage.inputTokens, 200);
  assert.ok(result.record.artifactSha256);
  assert.equal(await readFile(join(result.directory, 'model.pl'), 'utf8'), '% fixture only');
});

test('invalid first response consumes a round, then repair/evaluation precedes review', async t => {
  const target = fixture(); let calls = 0;
  const result = await runTrial({ ...await options(t),
    runAgent: async (_command, _args, { input }) => {
      calls++;
      if (calls === 1) return response({ ...target, action: 'submit' });
      if (calls === 2) { assert.match(input, /Phase: repair/); return response(target, false); }
      return response({ ...target, action: 'submit', review: reviewFor(target) }, false);
    } });
  assert.equal(calls, 3);
  assert.equal(result.record.status, 'submitted');
  assert.ok(result.record.rounds[0].lint.errors.some(e => e.code === 'evaluate_first'));
});

test('missing review consumes remaining rounds without silently submitting or making extra calls', async t => {
  const target = fixture(); let calls = 0;
  const result = await runTrial({ ...await options(t), maxTurns: 3,
    runAgent: async () => response(++calls === 1 ? target : { ...target, action: 'submit' }, calls === 1) });
  assert.equal(calls, 3);
  assert.equal(result.record.status, 'unsubmitted');
  assert.ok(result.record.rounds[1].lint.errors.some(e => e.code === 'review_required'));
  await assert.rejects(access(join(result.directory, 'submission.json')));
});

test('review target advances only after valid evaluation; stale review cannot submit', async t => {
  const first = fixture(), second = { ...fixture(), synthesis: 'Revised fixture', review: reviewFor(first) };
  let calls = 0;
  const result = await runTrial({ ...await options(t),
    runAgent: async () => {
      calls++;
      if (calls === 1) return response(first);
      if (calls === 2) return response(second, false);
      return response({ ...second, action: 'submit', review: reviewFor(first) }, false);
    } });
  assert.equal(result.record.status, 'unsubmitted');
  assert.equal(result.record.rounds[2].reviewTargetSha256, candidateHash(second));
  assert.ok(result.record.rounds[2].lint.errors.some(e => e.code === 'review_target'));
});

test('a rejected revised submission keeps the evaluated review target available for final repair', async t => {
  const target = fixture(); let calls = 0;
  const result = await runTrial({ ...await options(t),
    runAgent: async (_command, _args, { input }) => {
      calls++;
      if (calls === 1) return response(target);
      const revised = { ...fixture(), action: 'submit', review: reviewFor(target), synthesis: 'Corrected fixture' };
      if (calls === 2) revised.sources[0].accessedDate = '2026-02-30';
      else { assert.ok(input.includes(candidateHash(target))); assert.match(input, /access_date/); }
      return response(revised, false);
    } });
  assert.equal(calls, 3); assert.equal(result.record.status, 'submitted');
  assert.equal(result.record.rounds[2].reviewTargetSha256, candidateHash(target));
});

test('an evaluate on the last round stays unsubmitted without an automatic follow-up', async t => {
  const target = fixture(); let calls = 0;
  const result = await runTrial({ ...await options(t), maxTurns: 2,
    runAgent: async () => response(++calls === 1 ? target : { ...target, review: reviewFor(target) }, calls === 1) });
  assert.equal(calls, 2); assert.equal(result.record.status, 'unsubmitted');
  assert.ok(result.record.rounds.every(r => r.valid));
  await assert.rejects(access(join(result.directory, 'submission.json')));
});

test('static graph errors are returned before inference runs, and every attempt stays within budget', async t => {
  const invalid = fixture(); invalid.parameters[0].central = 50;
  let calls = 0, inferences = 0;
  const result = await runTrial({ ...await options(t), maxTurns: 2,
    inferModel: async () => { inferences++; return fakeInference(); },
    runAgent: async () => { calls++; return response(invalid); } });
  assert.equal(result.record.status, 'unsubmitted'); assert.equal(calls, 2); assert.equal(inferences, 0);
  assert.ok(result.record.rounds.every(r => r.lint.errors.some(e => e.code === 'probability_range')));
});

test('malformed JSON gets structured lint feedback and consumes the round budget', async t => {
  let calls = 0;
  const result = await runTrial({ ...await options(t), maxTurns: 2,
    runAgent: async (_command, _args, { input }) => {
      calls++;
      if (calls === 1) return { code: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '```json\n{}\n```' } }), stderr: '' };
      assert.match(input, /Phase: repair/); assert.match(input, /"code":"json"/);
      return response(fixture());
    } });
  assert.equal(calls, 2); assert.equal(result.record.status, 'unsubmitted');
  assert.equal(result.record.rounds[0].lint.errors[0].path, '$');
  assert.equal(result.record.rounds[1].valid, true);
});

test('a model claiming research without web activity never produces a final artifact', async t => {
  const result = await runTrial({ ...await options(t), maxTurns: 2, runAgent: async () => response(fixture(), false) });
  assert.equal(result.record.status, 'unsubmitted');
  assert.ok(result.record.rounds.every(r => r.lint.errors.some(e => e.code === 'web_activity')));
  await assert.rejects(access(join(result.directory, 'submission.json')));
});

test('missing CLI is retained as a failed attempt without a model call', async t => {
  let called = false;
  const result = await runTrial({ ...await options(t), runTool: async () => { throw new Error('ENOENT'); }, runAgent: async () => { called = true; } });
  assert.equal(result.record.status, 'failed'); assert.equal(called, false);
  const saved = JSON.parse(await readFile(join(result.directory, 'run.json'), 'utf8'));
  assert.equal(saved.error, 'ENOENT');
});
