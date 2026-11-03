import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateResponse, validateBallot, researchAudit, parseEvents } from '../src/schema.mjs';
import { parseArgs, codexArgs, runBatch, exportBatch } from '../src/run.mjs';
import { execute } from '../src/process.mjs';

const ballot = { electionDate: '2026-11-03', scope: 'Test composite', sources: [], contests: [
  { id: 'mayor', title: 'Mayor', type: 'candidate', jurisdiction: 'Test City', options: ['Alice', 'Bob', 'Carol'], maxSelections: 3, ranked: true, sourceUrls: ['https://example.org/ballot'] },
  { id: 'measure-a', title: 'Measure A', type: 'measure', jurisdiction: 'Test City', options: ['Yes', 'No'], maxSelections: 1, ranked: false, sourceUrls: ['https://example.org/ballot'] },
] };
const response = () => ({ overallSummary: 'Illustrative ballot evaluation.', decisions: [
  { contestId: 'mayor', choices: ['Carol', 'Alice', 'Bob'], status: 'voted', rationale: 'Ranked order based on platform.', sources: ['s1'] },
  { contestId: 'measure-a', choices: [], status: 'insufficient_information', rationale: 'Missing fiscal evidence.', sources: [] },
], compass: { economic: null, social: null, confidence: 'low', rationale: 'Too little evidence.', evidenceContestIds: [] },
sources: [{ id: 's1', url: 'https://example.org/platform', title: 'Platform' }], limitations: ['Illustrative only.'] });
const webEvent = { type: 'item.completed', item: { id: 'w1', type: 'web_search', action: { type: 'search', query: 'test' } } };
const eventsFor = value => [webEvent, { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(value) } },
  { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 20 } }].map(JSON.stringify).join('\n');

test('ballot and response allow full ranking and explicit uncertainty', () => {
  assert.deepEqual(validateBallot(ballot), []);
  assert.equal(validateResponse(response(), ballot, { webSearchCalls: 1 }).valid, true);
});

test('strict response validation catches selection, coverage, citations, bounds and fabricated web claims', () => {
  for (const [name, change, pattern] of [
    ['unknown choice', r => r.decisions[0].choices.push('Dave'), /choice absent/],
    ['duplicate choice', r => r.decisions[0].choices.push('Alice'), /duplicate choice/],
    ['missing contest', r => r.decisions.pop(), /missing contest/],
    ['duplicate contest', r => r.decisions.push(r.decisions[0]), /duplicate contest/],
    ['unresolved citation', r => r.decisions[0].sources.push('s2'), /unknown source reference/],
    ['unsafe URL', r => r.sources[0].url = 'file:///private/local', /HTTP/],
    ['invalid compass', r => r.compass.economic = 11, /out of bounds/],
    ['nonfinite compass', r => r.compass.economic = Infinity, /expected/],
    ['missing evidence', r => r.compass.economic = 0, /require evidence/],
    ['nonempty abstention', r => r.decisions[1].choices.push('Yes'), /requires no choices/],
    ['unsupported property', r => r.unexpected = true, /unknown property/],
  ]) {
    const value = response(); change(value);
    const result = validateResponse(value, ballot, { webSearchCalls: 1 });
    assert.equal(result.valid, false, name); assert.match(result.errors.join(';'), pattern, name);
  }
  assert.equal(validateResponse(response(), ballot, { webSearchCalls: 0 }).valid, false);
  assert.equal(researchAudit(parseEvents(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'I searched the web' } }))).webSearchCalls, 0);
  assert.equal(researchAudit([webEvent]).webSearchCalls, 1);
  assert.equal(researchAudit([{ ...webEvent, item: { ...webEvent.item, status: 'failed' } }]).webSearchCalls, 0);
});

test('rejects malformed ballot limits and yes/no options', () => {
  const value = structuredClone(ballot); value.contests[1].options = ['Maybe'];
  assert.match(validateBallot(value).join(';'), /Yes\/No/);
  value.contests[0].maxSelections = 4;
  assert.match(validateBallot(value).join(';'), /maxSelections/);
});

test('CLI defaults, ceilings and isolation flags', () => {
  const args = parseArgs([]);
  assert.equal(args.models.length, 8); assert.equal(args.trials, 3); assert.equal(args.maxSeconds, 1200);
  assert.throws(() => parseArgs(['--concurrency', '4']), /Maximum concurrency/);
  assert.throws(() => parseArgs(['--models', '../bad']), /model IDs/);
  const flags = codexArgs({ model: 'test', workspace: '/tmp/test', schema: '/tmp/schema' });
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--ephemeral', 'read-only', 'features.shell_tool=false', 'web_search="live"']) assert.ok(flags.includes(flag));
});

test('batch freezes inputs, bounds concurrency, preserves failures, skips attempts, exports only on request', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ballot-harness-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const inputDir = join(root, 'input'), batchDir = join(root, 'batch'); await mkdir(inputDir);
  await writeFile(join(inputDir, 'prompt.txt'), 'Independent ballot evaluation.');
  await writeFile(join(inputDir, 'ballot.json'), JSON.stringify(ballot));
  const options = parseArgs(['--input-dir', inputDir, '--batch', batchDir, '--models', 'test-good,test-bad', '--trials', '3', '--concurrency', '2']);
  let calls = 0, active = 0, maximum = 0; const workspaces = new Set(), prompts = new Set(), modelOrder = [];
  const runAgent = async (_command, args, opts) => {
    calls++; active++; maximum = Math.max(active, maximum); workspaces.add(opts.cwd); prompts.add(opts.input);
    modelOrder.push(args[args.indexOf('--model') + 1]);
    await new Promise(resolve => setTimeout(resolve, 10)); active--;
    if (args[args.indexOf('--model') + 1] === 'test-bad') return { code: 1, stdout: JSON.stringify(webEvent), stderr: '/private/secret error details' };
    return { code: 0, stdout: eventsFor(response()), stderr: '' };
  };
  const runTool = async () => ({ code: 0, stdout: 'codex test-version\n', stderr: '' });
  const first = await runBatch(options, { runAgent, runTool });
  assert.equal(calls, 6); assert.equal(maximum, 2); assert.equal(workspaces.size, 6); assert.equal(prompts.size, 1);
  // Concurrent startup may reorder execution inside a dispatched wave.
  assert.deepEqual(modelOrder.slice(0, 2).sort(), ['test-bad', 'test-good']);
  assert.equal(first.summary.runs.filter(r => r.status === 'completed').length, 3);
  assert.equal(first.summary.runs.filter(r => r.status === 'failed').length, 3);
  assert.equal(first.summary.runs[0].usage.inputTokens, 10);
  assert.equal(first.summary.runs[0].resolvedModel, null);
  for (const cwd of workspaces) await assert.rejects(access(cwd));
  await writeFile(join(inputDir, 'prompt.txt'), 'Changed live source prompt.');
  const resumed = await runBatch(options, { runAgent, runTool });
  assert.equal(calls, 6); assert.equal(resumed.summary.prompt, 'Independent ballot evaluation.');
  const publicDir = join(root, 'public'); await assert.rejects(access(publicDir));
  const exported = await exportBatch(batchDir, publicDir);
  const exportedText = await readFile(exported, 'utf8');
  assert.equal(JSON.parse(exportedText).runs.length, 6);
  assert.equal(exportedText.includes('/private/secret'), false);
  assert.equal(exportedText.includes('cliPath'), false);
  assert.equal(exportedText.includes('commandArgs'), false);
  await writeFile(join(batchDir, 'inputs', 'prompt.txt'), 'Tampered.');
  await assert.rejects(runBatch(options, { runAgent, runTool }), /Frozen input changed/);
});

test('malformed output and timeout are preserved without another model call', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ballot-invalid-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'prompt.txt'), 'Evaluate.'); await writeFile(join(root, 'ballot.json'), JSON.stringify(ballot));
  const options = parseArgs(['--input-dir', root, '--batch', join(root, 'batch'), '--models', 'invalid,timeout', '--trials', '1']);
  let calls = 0;
  const runAgent = async (_cmd, args) => {
    calls++;
    if (args.includes('timeout')) throw Object.assign(new Error('Timeout'), { code: 'TIMEOUT', stdout: JSON.stringify(webEvent), stderr: 'partial' });
    return { code: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'not json' } }), stderr: '' };
  };
  const runTool = async () => ({ code: 0, stdout: 'version', stderr: '' });
  const result = await runBatch(options, { runAgent, runTool });
  assert.deepEqual(result.summary.runs.map(r => r.status), ['invalid', 'timed_out']);
  assert.equal(result.summary.runs[1].webSearchCalls, 1);
  await runBatch(options, { runAgent, runTool }); assert.equal(calls, 2);
  assert.equal(await readFile(join(root, 'batch', 'timeout', 'trial-1', 'stderr.txt'), 'utf8'), 'partial');
});

test('invalid structured responses remain inspectable and orphaned attempts are never retried', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ballot-audit-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'prompt.txt'), 'Evaluate.'); await writeFile(join(root, 'ballot.json'), JSON.stringify(ballot));
  const batchDir = join(root, 'batch');
  const options = parseArgs(['--input-dir', root, '--batch', batchDir, '--models', 'test', '--trials', '1']);
  const incomplete = response(); incomplete.decisions.pop(); let calls = 0;
  const runAgent = async () => { calls++; return { code: 0, stdout: eventsFor(incomplete), stderr: '' }; };
  const runTool = async () => ({ code: 0, stdout: 'version', stderr: '' });
  const result = await runBatch(options, { runAgent, runTool });
  assert.equal(result.summary.runs[0].status, 'invalid');
  assert.deepEqual(result.summary.runs[0].response, incomplete);
  const recordPath = join(batchDir, 'test', 'trial-1', 'run.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8')); record.status = 'running';
  await writeFile(recordPath, JSON.stringify(record));
  const resumed = await runBatch(options, { runAgent, runTool });
  assert.equal(calls, 1); assert.equal(resumed.summary.runs[0].status, 'interrupted');
  await mkdir(join(batchDir, '.lock'));
  await assert.rejects(runBatch(options, { runAgent, runTool }), /Batch is locked/);
});

test('process deadline retains partial output', async () => {
  await assert.rejects(execute(process.execPath, ['-e', 'console.log("partial");setTimeout(()=>{},10000)'], { timeoutMs: 100 }), error => error.code === 'TIMEOUT' && error.stdout.includes('partial'));
});

test('process streams stdout and stderr before exiting and preserves complete results', async () => {
  let stdout = '', stderr = '', finished = false, streamedBeforeExit = false;
  const result = await execute(process.execPath, ['-e', 'process.stdout.write("first");process.stderr.write("diagnostic");setTimeout(()=>process.stdout.write("second"),40)'], {
    onStdout: chunk => { stdout += chunk; streamedBeforeExit ||= !finished; },
    onStderr: chunk => { stderr += chunk; },
  });
  finished = true;
  assert.equal(streamedBeforeExit, true); assert.equal(stdout, 'firstsecond'); assert.equal(stderr, 'diagnostic');
  assert.equal(result.stdout, stdout); assert.equal(result.stderr, stderr);
});
