import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildOpenRouterRequest, modelConfiguration, auditOpenRouter, normalizeOpenRouterUsage, loadOpenRouterCredentials, callOpenRouter, extractFinalResponse } from '../src/openrouter-client.mjs';
import { parseOpenRouterArgs, runOpenRouterBatch, exportOpenRouterBatch } from '../src/openrouter-run.mjs';
import { diagnoseOpenRouterRun } from '../src/openrouter-diagnose.mjs';

const ballot = { electionDate: '2026-11-03', scope: 'Test', sources: [], contests: [
  { id: 'a', title: 'A', type: 'measure', jurisdiction: 'Test', options: ['Yes', 'No'], maxSelections: 1, ranked: false, sourceUrls: ['https://example.org'] },
] };
const response = () => ({ overallSummary: 'Evaluation.', decisions: [{ contestId: 'a', choices: ['Yes'], status: 'voted', rationale: 'Reason.', sources: ['s'] }],
  compass: { economic: -1, social: null, confidence: 'low', rationale: 'A single decision.', evidenceContestIds: ['a'] },
  sources: [{ id: 's', url: 'https://example.org', title: 'Evidence' }], limitations: ['Example.'] });
const model = id => ({ id, canonical_slug: id + '-fixed', supported_parameters: ['tools', 'structured_outputs', 'reasoning'],
  pricing: { prompt: '0.000001', completion: '0.000002' }, top_provider: { max_completion_tokens: 32000 }, reasoning: { supported_efforts: ['medium'] } });
const apiResponse = ({ cost = 0.1, searches = 2, result = response(), modelId = 'test/a' } = {}) => ({ id: 'generation-test', model: modelId, provider: 'test-provider',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(result), annotations: [] } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 10 },
    completion_tokens_details: { reasoning_tokens: 5 }, ...(cost === null ? {} : { cost }), server_tool_use: { web_search_requests: searches, web_fetch_requests: 1 } } });
async function setup(t, extras = []) {
  const root = await mkdtemp(join(tmpdir(), 'ballot-openrouter-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'prompt.txt'), 'Research and evaluate independently.');
  await writeFile(join(root, 'ballot.json'), JSON.stringify(ballot));
  await writeFile(join(root, 'catalog.json'), JSON.stringify({ data: [model('test/a'), model('test/b')] }));
  return { root, options: parseOpenRouterArgs(['--batch', join(root, 'batch'), '--input-dir', root, '--catalog', join(root, 'catalog.json'), '--models', 'test/a,test/b', ...extras]) };
}

test('request pins web engines, schema, reasoning and soft stops with no provider fallback', () => {
  const options = parseOpenRouterArgs(['--batch', '/tmp/test', '--models', 'test/a']);
  const request = buildOpenRouterRequest({ model: modelConfiguration(model('test/a')), prompt: 'same prompt', limits: options });
  assert.equal(request.messages[1].content, 'same prompt'); assert.equal(request.max_tokens, 24000);
  assert.equal(request.messages[0].role, 'system');
  assert.match(request.messages[0].content, /"evidenceContestIds"/); assert.match(request.messages[0].content, /"insufficient_information"/);
  assert.equal(request.provider.allow_fallbacks, false); assert.equal(request.provider.require_parameters, true);
  assert.equal(request.reasoning.effort, 'medium'); assert.equal(request.response_format.type, 'json_schema');
  assert.deepEqual(request.tools.map(t => t.parameters.engine), ['exa', 'openrouter']);
  assert.equal(request.tools[0].parameters.max_total_results, 60);
  assert.deepEqual(request.stop_server_tools_when, [{ type: 'step_count_is', step_count: 20 }, { type: 'max_cost', max_cost_in_dollars: 1 }]);
  assert.throws(() => parseOpenRouterArgs(['--batch', 'x', '--models', '../../bad']), /provider\/model/);
  assert.throws(() => parseOpenRouterArgs(['--batch', 'x', '--max-tool-calls', '31']), /maximum server-tool/);
  assert.throws(() => modelConfiguration({ id: 'no-tools', supported_parameters: [] }), /tool support/);
});

test('audit uses provider usage, not model-generated citation claims; unknown costs remain null', () => {
  const raw = apiResponse(); raw.choices[0].message.annotations = [{ type: 'url_citation', url_citation: { url: 'https://example.org', title: 'Evidence' } }];
  assert.equal(auditOpenRouter(raw).webSearchCalls, 2); assert.equal(auditOpenRouter(raw).webFetchCalls, 1);
  delete raw.usage.server_tool_use; delete raw.usage.cost;
  const audit = auditOpenRouter(raw); assert.equal(audit.webSearchCalls, 0); assert.equal(audit.searchUsageReported, false);
  assert.equal(audit.annotations.length, 1); assert.equal(audit.webFetchCalls, null);
  assert.equal(normalizeOpenRouterUsage(raw).costUsd, null); assert.equal(normalizeOpenRouterUsage(raw).costSource, 'unreported');
});

test('credentials load existing sources without logging or mutation', async t => {
  const { root } = await setup(t); const authPath = join(root, 'auth.json');
  await writeFile(authPath, JSON.stringify({ openrouter: { type: 'api', key: 'test-secret' } }));
  assert.equal(await loadOpenRouterCredentials({ env: {}, authPath }), 'test-secret');
  assert.equal(await loadOpenRouterCredentials({ env: { OPENROUTER_API_KEY: ' env-secret ' }, authPath }), 'env-secret');
  await assert.rejects(loadOpenRouterCredentials({ env: {}, authPath: join(root, 'missing') }), /credentials unavailable/);
});

test('single probe preserves full batch plan; resume executes only remaining attempts and explicit export excludes raw reasoning', async t => {
  const { root, options } = await setup(t, ['--limit-new-attempts', '1']);
  let calls = 0; const bodies = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(init.redirect, 'error');
    calls++; const body = JSON.parse(init.body); bodies.push(body);
    const raw = apiResponse({ modelId: body.model }); raw.choices[0].message.reasoning = 'PRIVATE REASONING MARKER';
    return new Response(JSON.stringify(raw), { status: 200 });
  };
  const first = await runOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl });
  assert.equal(calls, 1); assert.equal(first.summary.runs.length, 6);
  assert.equal(first.summary.runs.filter(r => r.status === 'completed').length, 1);
  assert.equal(first.summary.progress.stopReason, 'invocation_attempt_limit');
  assert.equal(first.summary.runs[0].resolvedModel, 'test/a'); assert.equal(first.summary.runs[0].costUsd, 0.1);
  await writeFile(join(root, 'prompt.txt'), 'Changed live prompt.');
  const second = await runOpenRouterBatch({ ...options, limitNewAttempts: Infinity }, { apiKey: 'test-secret', fetchImpl });
  assert.equal(calls, 6); assert.equal(second.summary.runs.filter(r => r.status === 'completed').length, 6);
  assert.equal(new Set(bodies.map(b => b.messages[1].content)).size, 1);
  assert.equal(second.summary.batch.formattingSystemMessage, bodies[0].messages[0].content);
  assert.equal(second.summary.batch.protocolVersion, 2);
  assert.equal(second.summary.prompt, 'Research and evaluate independently.');
  await runOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl }); assert.equal(calls, 6);
  const publicDir = join(root, 'public'); await assert.rejects(access(publicDir));
  const exported = await exportOpenRouterBatch(options.batchDir, publicDir); const text = await readFile(exported, 'utf8');
  assert.equal(text.includes('PRIVATE REASONING MARKER'), false); assert.equal(text.includes('test-secret'), false);
  assert.equal(JSON.parse(text).runs[0].usage.costUsd, 0.1);
  const raw = await readFile(join(options.batchDir, 'test%2Fa/trial-1/api-response.json'), 'utf8');
  assert.equal(raw.includes('PRIVATE REASONING MARKER'), true);
});

test('prepare-only freezes requests without API calls or credentials', async t => {
  const { options } = await setup(t, ['--prepare-only']); let calls = 0;
  const result = await runOpenRouterBatch(options, { fetchImpl: async () => { calls++; throw new Error('Must not call'); } });
  assert.equal(calls, 0); assert.equal(result.summary.runs.every(r => r.status === 'pending'), true);
  await writeFile(join(options.batchDir, 'inputs/ballot.json'), '{}');
  await assert.rejects(runOpenRouterBatch(options), /Frozen input changed/);
});

test('unknown billing halts new dispatch, never retries the completed request', async t => {
  const { options } = await setup(t, ['--concurrency', '1']); let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify(apiResponse({ cost: null }))); };
  const first = await runOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl });
  assert.equal(calls, 1); assert.equal(first.summary.progress.unknownCost, true);
  assert.equal(first.summary.progress.stopReason, 'unknown_cost'); assert.equal(first.summary.runs[0].costUsd, null);
  await runOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl }); assert.equal(calls, 1);
});

test('reservation bounds concurrent dispatch and keeps invalid structured responses', async t => {
  const { options } = await setup(t, ['--budget-usd', '3.05', '--reservation-usd', '3']);
  let calls = 0, active = 0, maxActive = 0;
  const fetchImpl = async () => {
    calls++; active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return new Response(JSON.stringify(apiResponse({ searches: 0 })));
  };
  const result = await runOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl });
  assert.equal(calls, 1); assert.equal(maxActive, 1); assert.equal(result.summary.runs[0].status, 'invalid');
  assert.deepEqual(result.summary.runs[0].response, response());
  assert.equal(result.summary.progress.stopReason, 'soft_budget_reservation');
});

test('HTTP failure and transport timeout are single attempts with partial raw response retained', async t => {
  const { root, options } = await setup(t, ['--concurrency', '1']); let calls = 0;
  const failed = await runOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ error: { code: 402, message: 'Account detail' } }), { status: 402 });
  } });
  assert.equal(calls, 1); assert.equal(failed.summary.runs[0].status, 'failed'); assert.equal(failed.summary.progress.stopReason, 'unknown_cost');
  assert.equal(JSON.stringify(failed.summary).includes('Account detail'), false);
  const rawPath = join(root, 'timeout.txt');
  await assert.rejects(callOpenRouter({ body: {}, apiKey: 'test-secret', maxSeconds: 0.02, rawPath,
    fetchImpl: async (_url, init) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      init.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    } })) }), error => error.code === 'TIMEOUT');
  assert.equal(await readFile(rawPath, 'utf8'), '{"partial":');
});

test('actual API detailed usage counters are read without inferring fetches', () => {
  const raw = apiResponse();
  delete raw.usage.server_tool_use;
  raw.usage.server_tool_use_details = { web_search_requests: 14, tool_calls_requested: 36, tool_calls_executed: 36 };
  raw.usage.cost = 0.891632;
  const audit = auditOpenRouter(raw);
  assert.equal(audit.webSearchCalls, 14); assert.equal(audit.toolCallsExecuted, 36); assert.equal(audit.webFetchCalls, null);
  assert.equal(audit.usageField, 'usage.server_tool_use_details');
  assert.deepEqual(normalizeOpenRouterUsage(raw).serverToolUse, raw.usage.server_tool_use_details);
  assert.equal(normalizeOpenRouterUsage(raw).costUsd, 0.891632);
});

test('balanced trailing-object parser preserves commentary and JSON strings without repair', () => {
  const result = response(); result.overallSummary = 'Braces } { and quote " and slash \\ and array ] [.';
  const prefix = 'Progress "with an unmatched quote and { non-JSON brace.\n';
  const parsed = extractFinalResponse(prefix + JSON.stringify(result) + '\n ');
  assert.deepEqual(parsed.response, result); assert.equal(parsed.publicCommentary, prefix.trim());
  assert.equal(parsed.parseMethod, 'balanced_trailing_object'); assert.equal(parsed.protocolWarnings.length, 1);
  assert.equal(extractFinalResponse(' \n' + JSON.stringify(result)).parseMethod, 'single_json_object');
  for (const content of [JSON.stringify(result) + ' commentary', JSON.stringify(result).slice(0, -1),
    '"' + JSON.stringify(result) + '"', JSON.stringify(result) + JSON.stringify(result), '{"a": [}']) {
    assert.throws(() => extractFinalResponse(content));
  }
  const actualInvalid = { overallSummary: 'Actual output.', decisions: [{ contestId: 'a', choices: ['Yes'], rationale: 'Reason', sourceIds: ['s'] }],
    compass: { economic: -1, social: 1, confidence: 0.52, explanation: 'Actual output.' }, sources: response().sources, limitations: [] };
  assert.deepEqual(extractFinalResponse('Checking sources.' + JSON.stringify(actualInvalid)).response, actualInvalid);
});

test('offline pilot diagnosis preserves original files and keeps structurally wrong output invalid', async t => {
  const { root, options } = await setup(t, ['--limit-new-attempts', '1']);
  const actual = response(); delete actual.decisions[0].status; actual.decisions[0].sourceIds = actual.decisions[0].sources; delete actual.decisions[0].sources;
  actual.compass.confidence = 0.52; actual.compass.explanation = actual.compass.rationale; delete actual.compass.rationale; delete actual.compass.evidenceContestIds;
  const raw = apiResponse({ result: actual }); raw.choices[0].message.content = 'Checking official sources.' + JSON.stringify(actual);
  delete raw.usage.server_tool_use; raw.usage.server_tool_use_details = { web_search_requests: 14, tool_calls_executed: 36 };
  await runOpenRouterBatch(options, { apiKey: 'test-secret', fetchImpl: async () => new Response(JSON.stringify(raw)) });
  const runDir = join(options.batchDir, 'test%2Fa/trial-1');
  const recordBefore = await readFile(join(runDir, 'run.json'), 'utf8'), batchBefore = await readFile(join(options.batchDir, 'batch.json'), 'utf8');
  const diagnostic = await diagnoseOpenRouterRun(runDir, join(root, 'diagnostic.json'));
  assert.equal(diagnostic.status, 'invalid'); assert.equal(diagnostic.includedInComparison, false);
  assert.deepEqual(diagnostic.response, actual); assert.equal(diagnostic.webAudit.webSearchCalls, 14);
  assert.match(diagnostic.validation.errors.join(';'), /status/); assert.match(diagnostic.validation.errors.join(';'), /sourceIds/);
  assert.equal(await readFile(join(runDir, 'run.json'), 'utf8'), recordBefore);
  assert.equal(await readFile(join(options.batchDir, 'batch.json'), 'utf8'), batchBefore);
  await assert.rejects(diagnoseOpenRouterRun(runDir, join(runDir, 'diagnostic.json')), /outside the original batch/);
});
