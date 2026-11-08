import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResponse, publicBatch, requestCompletion, publish } from '../src/run.js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseCodex, codexArgs } from '../src/codex.js';

test('captures actual routed model per call; missing identity stays unknown', () => {
  const result = classifyResponse({ model: 'actual/free-model', choices: [{ finish_reason: 'stop', message: { content: 'An answer.' } }] });
  assert.equal(result.resolvedModel, 'actual/free-model'); assert.equal(result.status, 'completed');
  assert.equal(classifyResponse({ choices: [] }).resolvedModel, null);
});
test('truncation, empty responses, and provider errors are never completed recall', () => {
  assert.equal(classifyResponse({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }).status, 'truncated');
  assert.equal(classifyResponse({ choices: [{ finish_reason: 'stop', message: { content: ' ' } }] }).status, 'invalid-response');
  assert.equal(classifyResponse({ choices: [{ finish_reason: 'stop', message: { content: '<|tool_call_start|>google(query=x)<|tool_call_end|>' } }] }).status, 'tool-request-without-answer');
  assert.equal(classifyResponse({ error: { message: 'failed' } }).status, 'provider-error');
});
test('transport keeps fresh messages, preserves returned identity, and handles HTTP failure', async () => {
  let sent;
  const request = { model: 'openrouter/free', messages: [{ role: 'user', content: 'Who is Dan Finlay?' }] };
  const answer = await requestCompletion({ base: 'https://example.invalid/v1/', key: 'secret', request, timeoutMs: 1000,
    fetchImpl: async (url, options) => { sent = { url, options }; return new Response(JSON.stringify({ model: 'actual', choices: [{ finish_reason: 'stop', message: { content: 'answer' } }] })); } });
  assert.equal(sent.url, 'https://example.invalid/v1/chat/completions'); assert.deepEqual(JSON.parse(sent.options.body), request); assert.equal(answer.resolvedModel, 'actual');
  const fail = await requestCompletion({ base: 'x', request, timeoutMs: 1000, fetchImpl: async () => new Response('{"error":"rate limited"}', { status: 429 }) });
  assert.equal(fail.status, 'provider-error');
});
test('public output does not leak endpoint, raw reasoning, credentials, or server paths', () => {
  const output = JSON.stringify(publicBatch({ endpoint: 'private-host', secret: 'key', responses: [{ content: 'answer', raw: { reasoning: 'private reasoning' }, error: 'private-host' }] }));
  for (const value of ['private-host', 'private reasoning', 'secret']) assert.ok(!output.includes(value));
  assert.match(output, /answer/);
});
test('Codex parser rejects tool activity and does not invent resolved model identity', () => {
  const events = [{ type: 'item.completed', item: { type: 'agent_message', text: 'answer' } }, { type: 'turn.completed', usage: { output_tokens: 10 } }];
  const lines = a => a.map(e => JSON.stringify(e)).join('\n');
  assert.equal(parseCodex(lines(events), 0).status, 'completed'); assert.equal(parseCodex(lines(events), 0).resolvedModel, null);
  events.push({ type: 'item.completed', item: { type: 'web_search' } });
  assert.equal(parseCodex(lines(events), 0).status, 'tool-use-violation');
  const args = codexArgs({ model: 'test', effort: 'medium', workspace: '/tmp/empty', system: 'memory only' });
  assert.ok(args.includes('web_search="disabled"')); assert.ok(args.includes('features.shell_tool=false')); assert.ok(args.includes('--ephemeral'));
});
test('configuration diagnostics are retained separately from tool calls and failures', () => {
  const events = [ { type: 'item.completed', item: { type: 'error', message: 'Codex is ignoring 1 unrecognized configuration setting. features.skills' } }, { type: 'item.completed', item: { type: 'agent_message', text: 'answer' } }, { type: 'turn.completed' } ];
  const r = parseCodex(events.map(e => JSON.stringify(e)).join('\n'), 0);
  assert.equal(r.status, 'completed'); assert.equal(r.configurationWarnings.length, 1); assert.equal(r.toolAudit.passed, true);
});
test('publication validates raw evidence and excludes reviewer notes from the batch index', async t => {
  const root = await mkdtemp(join(tmpdir(), 'recall-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const id = '2026-10-28T00-00-00-000Z-test';
  await mkdir(join(root, 'runs', id), { recursive: true }); await mkdir(join(root, 'data/public'), { recursive: true });
  const raw = { model: 'actual', choices: [] };
  await writeFile(join(root, 'runs', id, 'r.json'), JSON.stringify(raw));
  await writeFile(join(root, 'runs', id, 'batch.json'), JSON.stringify({ id, status: 'completed', responses: [{ id: 'r', status: 'completed', rawSha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex') }] }));
  await writeFile(join(root, 'data/public/review.json'), '{}');
  await publish(root, id);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'data/public/results.json'), 'utf8')).batches, [`${id}.json`]);
  await writeFile(join(root, 'runs', id, 'r.json'), '{}');
  await assert.rejects(publish(root, id), /Raw response changed/);
});
