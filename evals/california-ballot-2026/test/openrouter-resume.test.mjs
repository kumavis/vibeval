import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseOpenRouterArgs, runOpenRouterBatch } from '../src/openrouter-run.mjs';
import { parseResumeArgs, resumeOpenRouterBatch, exportOpenRouterContinuation } from '../src/openrouter-resume.mjs';

const ballot = { electionDate: '2026-11-03', scope: 'Test', sources: [], contests: [
  { id: 'a', title: 'A', type: 'measure', jurisdiction: 'Test', options: ['Yes', 'No'], maxSelections: 1, ranked: false, sourceUrls: ['https://example.org'] },
] };
const answer = { overallSummary: 'Example.', decisions: [{ contestId: 'a', choices: ['Yes'], status: 'voted', rationale: 'Example.', sources: ['s'] }],
  compass: { economic: null, social: null, confidence: 'low', rationale: 'Example.', evidenceContestIds: [] },
  sources: [{ id: 's', url: 'https://example.org', title: 'Example' }], limitations: [] };
const success = model => new Response(JSON.stringify({ id: 'test-generation', model, provider: 'test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }],
  usage: { cost: 0.1, prompt_tokens: 20, completion_tokens: 30, server_tool_use_details: { web_search_requests: 1, tool_calls_executed: 1 } } }));
async function setup(t, extra = []) {
  const root = await mkdtemp(join(tmpdir(), 'ballot-resume-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'prompt.txt'), 'Research the ballot.'); await writeFile(join(root, 'ballot.json'), JSON.stringify(ballot));
  await writeFile(join(root, 'catalog.json'), JSON.stringify({ data: ['test/a', 'test/b'].map(id => ({ id,
    supported_parameters: ['tools', 'structured_outputs', 'reasoning'], top_provider: { max_completion_tokens: 32000 } })) }));
  const batchDir = join(root, 'batch');
  const initial = parseOpenRouterArgs(['--batch', batchDir, '--input-dir', root, '--catalog', join(root, 'catalog.json'), '--models', 'test/a,test/b', '--concurrency', '1', ...extra]);
  let originalCalls = 0;
  await runOpenRouterBatch(initial, { apiKey: 'test-secret', fetchImpl: async () => { originalCalls++; return new Response(JSON.stringify({ error: { code: 429, message: 'Rate limited' } }), { status: 429 }); } });
  assert.equal(originalCalls, 1);
  return { root, batchDir, options: parseResumeArgs(['--batch', batchDir]) };
}

test('429 unknown charge reserves $3; continuation skips original, preserves frozen files, exports null actual cost', async t => {
  const { root, batchDir, options } = await setup(t);
  const protectedPaths = ['batch.json', 'progress.json', 'test%2Fa/trial-1/run.json', 'test%2Fa/trial-1/api-response.json',
    'inputs/request-templates.json', 'inputs/harness/openrouter-run.mjs', 'inputs/harness/openrouter-client.mjs'];
  const before = await Promise.all(protectedPaths.map(p => readFile(join(batchDir, p), 'utf8')));
  const templates = JSON.parse(await readFile(join(batchDir, 'inputs/request-templates.json'), 'utf8'));
  let calls = 0, active = 0, maximum = 0;
  const result = await resumeOpenRouterBatch({ ...options, export: true }, { apiKey: 'test-secret', outputRoot: join(root, 'public'), fetchImpl: async (_url, init) => {
    calls++; active++; maximum = Math.max(maximum, active);
    const body = JSON.parse(init.body); assert.deepEqual(body, templates[body.model]);
    await new Promise(resolve => setTimeout(resolve, 5)); active--; return success(body.model);
  } });
  assert.equal(calls, 5); assert.equal(maximum, 3);
  assert.equal(result.summary.progress.unknownAttemptCount, 1); assert.equal(result.summary.progress.unknownReservedUsd, 3);
  assert.equal(result.summary.progress.knownCostUsd, 0.5); assert.equal(result.summary.progress.accountedBudgetUsd, 3.5);
  assert.equal(result.summary.runs[0].costUsd, null); assert.equal(result.summary.runs[0].status, 'failed');
  assert.equal(result.summary.runs[0].httpStatus, 429);
  assert.deepEqual(await Promise.all(protectedPaths.map(p => readFile(join(batchDir, p), 'utf8'))), before);
  assert.equal(result.summary.continuation.existingRecordsUnchanged, true);
  const frozenController = await readFile(join(result.continuationDir, 'controller.mjs'));
  assert.equal(createHash('sha256').update(frozenController).digest('hex'), result.summary.continuation.controllerSha256);
  const exported = JSON.parse(await readFile(join(root, 'public/openrouter-results.json'), 'utf8'));
  assert.equal(exported.runs[0].usage.costUsd, null); assert.equal(exported.originalRunnerProgress.stopReason, 'unknown_cost');
  assert.equal(exported.progress.unknownReservedUsd, 3);
  await resumeOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl: async () => { throw new Error('No retry allowed'); } });
});

test('unknown-charge plus in-flight reservations enforce conservative dispatch cap', async t => {
  const { options } = await setup(t, ['--budget-usd', '6.05']); let calls = 0;
  const result = await resumeOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl: async (_url, init) => { calls++; return success(JSON.parse(init.body).model); } });
  assert.equal(calls, 1);
  assert.equal(result.summary.progress.unknownReservedUsd, 3); assert.equal(result.summary.progress.knownCostUsd, 0.1);
  assert.equal(result.summary.progress.stopReason, 'conservative_budget_reservation');
  assert.equal(result.summary.progress.remainingUnattempted, 4);
});

test('new unknown charges retain their reservation and remain null in results', async t => {
  const { options } = await setup(t, ['--budget-usd', '6']); let calls = 0;
  const result = await resumeOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 }); } });
  assert.equal(calls, 1); assert.equal(result.summary.progress.unknownAttemptCount, 2);
  assert.equal(result.summary.progress.accountedBudgetUsd, 6); assert.equal(result.summary.progress.knownCostUsd, 0);
  assert.equal(result.summary.runs.filter(r => r.status === 'failed').every(r => r.costUsd === null), true);
});

test('lock and frozen-input mismatch prevent any continuation request', async t => {
  const { batchDir, options } = await setup(t); let calls = 0;
  const dependencies = { apiKey: 'test-secret', fetchImpl: async () => { calls++; throw new Error('No call allowed'); } };
  await mkdir(join(batchDir, '.lock'));
  await assert.rejects(resumeOpenRouterBatch(options, dependencies), /locked/); assert.equal(calls, 0);
  await rm(join(batchDir, '.lock'), { recursive: true });
  await writeFile(join(batchDir, 'inputs/prompt.txt'), 'Changed prompt.');
  await assert.rejects(resumeOpenRouterBatch(options, dependencies), /Frozen input mismatch/); assert.equal(calls, 0);
});

test('inspection performs no model calls and low unknown-charge reservations are rejected', async t => {
  const { options } = await setup(t);
  const result = await resumeOpenRouterBatch({ ...options, inspectOnly: true }, { fetchImpl: async () => { throw new Error('No call allowed'); } });
  assert.equal(result.inspection.unknownReservedUsd, 3); assert.equal(result.jobs.length, 5);
  assert.throws(() => parseResumeArgs(['--batch', 'x', '--unknown-reservation-usd', '0']), /at least/);
});

test('export-only uses latest saved continuation and current records without network or metadata changes', async t => {
  const { root, batchDir, options } = await setup(t);
  const dependencies = { apiKey: 'test-secret', fetchImpl: async (_url, init) => success(JSON.parse(init.body).model) };
  await resumeOpenRouterBatch({ ...options, limitNewAttempts: 1 }, dependencies);
  const latest = await resumeOpenRouterBatch({ ...options, limitNewAttempts: 1 }, dependencies);
  const metadataPath = join(latest.continuationDir, 'continuation.json'), progressPath = join(latest.continuationDir, 'progress.json');
  const metadataBefore = await readFile(metadataPath, 'utf8'), progressBefore = await readFile(progressPath, 'utf8');
  const batchBefore = await readFile(join(batchDir, 'batch.json'), 'utf8');
  const savedFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Export must not call network'); };
  try {
    const outputPath = await exportOpenRouterContinuation(batchDir, join(root, 'public'));
    const exported = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(calls, 0); assert.equal(exported.continuation.id, latest.summary.continuation.id);
    assert.deepEqual(exported.progress, JSON.parse(progressBefore));
    assert.equal(exported.runs.filter(r => r.status === 'completed').length, 2);
    assert.equal(exported.runs[0].costUsd, null); assert.equal(exported.originalRunnerProgress.stopReason, 'unknown_cost');
    assert.equal(await readFile(metadataPath, 'utf8'), metadataBefore); assert.equal(await readFile(progressPath, 'utf8'), progressBefore);
    assert.equal(await readFile(join(batchDir, 'batch.json'), 'utf8'), batchBefore);
    assert.equal(parseResumeArgs(['--batch', batchDir, '--export-only']).exportOnly, true);
    await mkdir(join(batchDir, '.lock'));
    await assert.rejects(exportOpenRouterContinuation(batchDir, join(root, 'public')), /locked/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = savedFetch; }
});
