import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';

export const directory = fileURLToPath(new URL('../', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
async function save(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, path);
}
export function classifyResponse(body) {
  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  return {
    status: body.error ? 'provider-error' : /^\s*<\|tool_call_start\|>/u.test(content ?? '') ? 'tool-request-without-answer' : choice?.finish_reason === 'length' ? 'truncated' :
      choice?.finish_reason === 'stop' && typeof content === 'string' && content.trim() ? 'completed' : 'invalid-response',
    resolvedModel: typeof body.model === 'string' ? body.model : null,
    responseId: body.id ?? null,
    provider: body.provider ?? null,
    finishReason: choice?.finish_reason ?? null,
    content: typeof content === 'string' ? content : '',
    usage: body.usage ?? null,
  };
}
export async function requestCompletion({ base, key, request, timeoutMs, fetchImpl = fetch }) {
  const response = await fetchImpl(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(request), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let raw;
  try { raw = JSON.parse(text); } catch { return { raw: { httpStatus: response.status, body: text }, status: 'invalid-response', content: '', resolvedModel: null }; }
  return { ...classifyResponse(raw), ...(response.ok ? {} : { status: 'provider-error' }), httpStatus: response.status, raw };
}
function modelInventory(model) {
  const args = model.status?.args ?? [];
  const index = args.indexOf('--model');
  return { id: model.id, ownedBy: model.owned_by ?? null, weightsFile: index >= 0 ? basename(args[index + 1]) : null,
    metadata: model.meta ?? null, initialStatus: model.status?.value ?? null };
}
export async function runBatch({ base, models, trials = 3, maxTokens = 8192, timeoutMs = 600000, apiKey, root = directory, pauseMs = 0 }) {
  if (!Number.isSafeInteger(trials) || trials < 1 || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Trials, tokens, and timeout must be positive integers');
  if (!Number.isSafeInteger(pauseMs) || pauseMs < 0) throw new Error('Pause must be a nonnegative integer');
  const protocolText = await readFile(join(root, 'protocol.json'), 'utf8');
  const protocol = JSON.parse(protocolText);
  const discovery = await fetch(`${base.replace(/\/$/, '')}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(15000) });
  if (!discovery.ok) throw new Error(`Model inventory failed: HTTP ${discovery.status}`);
  const inventory = (await discovery.json()).data;
  if (!Array.isArray(inventory) || !inventory.length) throw new Error('Empty model inventory');
  const selected = models ?? inventory.map(m => m.id);
  if (!selected.length || new Set(selected).size !== selected.length) throw new Error('Model IDs must be nonempty and unique');
  for (const model of selected) if (!inventory.some(m => m.id === model)) throw new Error(`Model absent from inventory: ${model}`);
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const runDir = join(root, 'runs', id);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'runner.js'), await readFile(fileURLToPath(import.meta.url)));
  let git = null;
  try { git = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) }; } catch {}
  const batch = { id, protocol, protocolSha256: hash(protocolText), runnerSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    git, nodeVersion: process.version, startedAt: new Date().toISOString(), status: 'running',
    transport: 'OpenAI-compatible chat completions; no tools, retrieval, or conversation history', endpoint: base,
    settings: { trials, temperature: 0.7, maxTokens, timeoutMs, reasoning: 'server default', seedBase: 1700, retries: 0, pauseMs },
    inventory: inventory.filter(m => selected.includes(m.id)).map(modelInventory), responses: [] };
  await save(join(runDir, 'batch.json'), batch);
  // Sequential per-model execution avoids parallel GPU loads; every probe is a fresh request.
  for (const model of selected) for (let trial = 1; trial <= trials; trial++) for (const probe of protocol.probes) {
    if (pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs));
    const request = { model, messages: [{ role: 'system', content: protocol.system }, { role: 'user', content: probe.prompt }], temperature: 0.7, seed: 1700 + trial, max_tokens: maxTokens, stream: false };
    const item = { id: randomUUID(), requestedModel: model, trial, probeId: probe.id, request,
      startedAt: new Date().toISOString(), status: 'running' };
    batch.responses.push(item);
    await save(join(runDir, 'batch.json'), batch);
    console.log(`START ${model} trial ${trial} ${probe.id}`);
    const start = performance.now();
    try {
      const { raw, ...result } = await requestCompletion({ base, key: apiKey, request, timeoutMs });
      await save(join(runDir, `${item.id}.json`), raw);
      Object.assign(item, result, { rawSha256: hash(JSON.stringify(raw)) });
    } catch (error) { Object.assign(item, { status: error.name === 'TimeoutError' ? 'timeout' : 'transport-error', error: error.message, content: '', resolvedModel: null }); }
    item.wallMs = Math.round(performance.now() - start);
    item.endedAt = new Date().toISOString();
    await save(join(runDir, 'batch.json'), batch);
    console.log(`END ${model} trial ${trial} ${probe.id}: ${item.status} (${(item.wallMs / 1000).toFixed(1)}s) resolved=${item.resolvedModel}`);
  }
  batch.status = batch.responses.every(r => r.status === 'completed') ? 'completed' : 'completed-with-errors';
  batch.endedAt = new Date().toISOString();
  await save(join(runDir, 'batch.json'), batch);
  console.log(`Saved ${runDir}`);
  return batch;
}
export function publicBatch(batch) {
  // Explicit allowlist: endpoint, server command lines, credentials, and reasoning traces never ship.
  return Object.fromEntries(['id','protocol','protocolSha256','runnerSha256','git','nodeVersion','startedAt','endedAt','status','transport','settings','inventory','parserCorrection'].map(k => [k, batch[k]]).concat([['responses', batch.responses.map(r => Object.fromEntries(['id','requestedModel','resolvedModel','resolvedModelNote','toolAudit','configurationWarnings','responseId','provider','trial','probeId','request','startedAt','endedAt','wallMs','status','finishReason','content','usage','rawSha256','httpStatus'].map(k => [k, r[k]])))]]));
}
export async function publish(root, runName) {
  if (!/^[a-zA-Z0-9-]+$/.test(runName)) throw new Error('Use a run directory name, not a path');
  const batch = JSON.parse(await readFile(join(root, 'runs', runName, 'batch.json'), 'utf8'));
  if (!['completed', 'completed-with-errors'].includes(batch.status)) throw new Error('Batch is still running or interrupted');
  for (const response of batch.responses) {
    if (!response.rawSha256) { if (response.status === 'completed') throw new Error('Completed response has no evidence hash'); continue; }
    const nativeCodex = response.provider === 'codex-cli';
    const text = await readFile(join(root, 'runs', runName, `${response.id}.${nativeCodex ? 'jsonl' : 'json'}`), 'utf8');
    if (hash(nativeCodex ? text : JSON.stringify(JSON.parse(text))) !== response.rawSha256) throw new Error(`Raw response changed: ${response.id}`);
  }
  const destination = join(root, 'data/public');
  await mkdir(destination, { recursive: true });
  await save(join(destination, `${batch.id}.json`), publicBatch(batch));
  const batches = (await readdir(destination)).filter(n => /^\d{4}-\d{2}-\d{2}T.*\.json$/.test(n)).sort();
  await save(join(destination, 'results.json'), { batches });
  console.log(`Published ${batch.id} locally; build to view.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { base: { type: 'string', default: process.env.IN_THE_WEIGHTS_BASE_URL || 'http://127.0.0.1:8080/v1' }, models: { type: 'string' }, trials: { type: 'string', default: '3' }, 'max-tokens': { type: 'string', default: '8192' }, 'timeout-seconds': { type: 'string', default: '600' }, 'pause-ms': { type: 'string', default: '0' }, publish: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) console.log('node evals/in-the-weights/src/run.js [--base URL] [--models ID,ID] [--trials 3] [--max-tokens 8192] [--timeout-seconds 600]\nPublish a completed batch locally: --publish RUN_DIRECTORY_NAME\nOptional authentication: IN_THE_WEIGHTS_API_KEY environment variable.');
  else if (values.publish) await publish(directory, values.publish);
  else await runBatch({ base: values.base, models: values.models?.split(','), trials: Number(values.trials), maxTokens: Number(values['max-tokens']), timeoutMs: Number(values['timeout-seconds']) * 1000, pauseMs: Number(values['pause-ms']), apiKey: process.env.IN_THE_WEIGHTS_API_KEY });
}
