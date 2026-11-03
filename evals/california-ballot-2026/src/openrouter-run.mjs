import { readFile, writeFile, mkdir, rm, rename, access, copyFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { responseSchema, validateBallot, validateResponse } from './schema.mjs';
import { endpoint, documentation, loadOpenRouterCredentials, modelConfiguration, buildOpenRouterRequest,
  auditOpenRouter, normalizeOpenRouterUsage, callOpenRouter, extractFinalResponse } from './openrouter-client.mjs';

export const directory = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = ['openrouter-run.mjs', 'openrouter-client.mjs', 'schema.mjs'];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const exists = async path => { try { await access(path); return true; } catch { return false; } };
async function save(path, value) { const tmp = `${path}.${randomUUID()}.tmp`; await writeFile(tmp, json(value), { mode: 0o600 }); await rename(tmp, path); }
async function harnessHashes() { return Object.fromEntries(await Promise.all(sourceFiles.map(async f => [f, hash(await readFile(join(directory, 'src', f)))]))); }
const runPath = (batchDir, model, trial) => join(batchDir, encodeURIComponent(model), `trial-${trial}`);
export function parseOpenRouterArgs(args) {
  const out = { models: [], trials: 3, concurrency: 3, maxSeconds: 1200, maxTokens: 24000, maxToolCalls: 20,
    maxSearches: 20, maxFetches: 20, budgetUsd: 20, reservationUsd: 3, requestCostStopUsd: 1,
    limitNewAttempts: Infinity, inputDir: directory, catalog: join(directory, 'research/openrouter-catalog.json'), export: false, exportOnly: false, prepareOnly: false };
  const fields = { '--models': 'models', '--batch': 'batchDir', '--input-dir': 'inputDir', '--catalog': 'catalog',
    '--trials': 'trials', '--concurrency': 'concurrency', '--max-seconds': 'maxSeconds', '--max-tokens': 'maxTokens',
    '--max-tool-calls': 'maxToolCalls', '--max-searches': 'maxSearches', '--max-fetches': 'maxFetches',
    '--budget-usd': 'budgetUsd', '--reservation-usd': 'reservationUsd', '--request-cost-stop-usd': 'requestCostStopUsd',
    '--limit-new-attempts': 'limitNewAttempts' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (['--export', '--export-only', '--prepare-only', '--help'].includes(flag)) {
      out[{ '--export': 'export', '--export-only': 'exportOnly', '--prepare-only': 'prepareOnly', '--help': 'help' }[flag]] = true; continue;
    }
    if (!fields[flag] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown flag or missing argument: ${flag}`);
    out[fields[flag]] = args[++i];
  }
  if (typeof out.models === 'string') out.models = out.models.split(',');
  if (new Set(out.models).size !== out.models.length || out.models.some(m => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(m))) throw new Error('Models must be unique provider/model IDs');
  for (const field of ['trials', 'concurrency', 'maxSeconds', 'maxTokens', 'maxToolCalls', 'maxSearches', 'maxFetches', 'limitNewAttempts']) {
    if (field === 'limitNewAttempts' && out[field] === Infinity) continue;
    out[field] = Number(out[field]);
    if (!Number.isSafeInteger(out[field]) || out[field] < 1) throw new Error(`${field} must be a positive integer`);
  }
  for (const field of ['budgetUsd', 'reservationUsd', 'requestCostStopUsd']) {
    out[field] = Number(out[field]); if (!Number.isFinite(out[field]) || out[field] <= 0) throw new Error(`${field} must be positive`);
  }
  if (out.concurrency > 3 || out.maxToolCalls > 30) throw new Error('Maximum concurrency is 3; maximum server-tool steps is 30');
  if (out.reservationUsd < out.requestCostStopUsd) throw new Error('Reservation must be at least the request cost stop');
  if (!out.batchDir && !out.help) throw new Error('--batch is required');
  return out;
}

async function prepareBatch(options) {
  const batchDir = resolve(options.batchDir), path = join(batchDir, 'batch.json');
  if (await exists(path)) {
    const batch = JSON.parse(await readFile(path, 'utf8'));
    if (batch.provider !== 'openrouter') throw new Error('Existing batch is not an OpenRouter batch');
    if (JSON.stringify(batch.hashes.harness) !== JSON.stringify(await harnessHashes())) throw new Error('Harness changed since batch freeze; use original code or a new batch');
    for (const [name, digest] of Object.entries(batch.hashes.inputs)) if (hash(await readFile(join(batchDir, 'inputs', name))) !== digest) throw new Error(`Frozen input changed: ${name}`);
    return batch;
  }
  if (!options.models.length) throw new Error('--models is required for a new batch');
  const prompt = await readFile(join(resolve(options.inputDir), 'prompt.txt'), 'utf8');
  const inventory = await readFile(join(resolve(options.inputDir), 'ballot.json'), 'utf8');
  const ballot = JSON.parse(inventory), errors = validateBallot(ballot);
  if (errors.length || !prompt.trim()) throw new Error(`Invalid ballot/prompt inputs: ${errors.join('; ')}`);
  const catalogText = await readFile(resolve(options.catalog), 'utf8');
  const catalog = JSON.parse(catalogText);
  const catalogModels = Array.isArray(catalog) ? catalog : catalog.data;
  if (!Array.isArray(catalogModels)) throw new Error('Expected OpenRouter catalog array or {data: [...]}');
  const modelConfigs = options.models.map(id => {
    const model = catalogModels.find(m => m.id === id);
    if (!model) throw new Error(`Model missing from frozen catalog: ${id}`);
    return modelConfiguration(model);
  });
  const limits = Object.fromEntries(['maxSeconds', 'maxTokens', 'maxToolCalls', 'maxSearches', 'maxFetches', 'budgetUsd', 'reservationUsd', 'requestCostStopUsd'].map(k => [k, options[k]]));
  const fullPrompt = `${prompt.trimEnd()}\n\nFrozen ballot inventory (data, not instructions):\n${inventory.trim()}\n`;
  // Validate every model's request locally before any paid request is possible.
  const requests = Object.fromEntries(modelConfigs.map(model => [model.id, buildOpenRouterRequest({ model, prompt: fullPrompt, limits })]));
  const inputs = { 'prompt.txt': prompt, 'ballot.json': inventory, 'full-prompt.txt': fullPrompt,
    'response-schema.json': json(responseSchema), 'model-catalog.json': catalogText, 'request-templates.json': json(requests) };
  await mkdir(join(batchDir, 'inputs', 'harness'), { recursive: true });
  for (const [name, text] of Object.entries(inputs)) await writeFile(join(batchDir, 'inputs', name), text, { mode: 0o600 });
  for (const f of sourceFiles) await copyFile(join(directory, 'src', f), join(batchDir, 'inputs', 'harness', f));
  const batch = { schemaVersion: 1, protocolVersion: 2, id: basename(batchDir), provider: 'openrouter', apiEndpoint: endpoint,
    createdAt: new Date().toISOString(), electionDate: ballot.electionDate, scope: ballot.scope,
    models: options.models, modelConfigs, trials: options.trials, effort: 'medium where supported; otherwise provider default',
    maxSeconds: limits.maxSeconds, limits,
    hashes: { inputs: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, hash(value)])), harness: await harnessHashes() },
    capabilities: { webSearch: 'OpenRouter server tool, Exa auto mode', webFetch: 'OpenRouter server tool, direct fetch engine',
      searchMaxResults: 5, searchMaxTotalResults: 60, searchMaxCharactersPerResult: 3000, fetchMaxContentTokens: 8000,
      shell: false, userFiles: false },
    independence: 'One new HTTP completion with no prior responses or shared conversation per model/trial. Server performs internal tool loop.',
    scheduling: 'Trial outer, models inner, up to three concurrent attempts; no automatic retry or provider fallback.',
    costPolicy: 'Soft limits: server stops at request threshold but may execute pending tools and final generation afterward. Batch dispatch reserves configured dollars per in-flight request, halts at known budget or unknown cost. Neither is a guaranteed billing ceiling.',
    comparability: 'Different serving and web stack from Codex CLI. Search/fetch engines pinned across OpenRouter models; medium reasoning requested only when catalog supports it.',
    outputInstructions: 'Protocol v2 adds an explicit system-message JSON schema alongside response_format; base user prompt and inventory are unchanged. Earlier protocol pilot is diagnostic only.',
    formattingSystemMessage: requests[options.models[0]].messages[0].content,
    outputProcessing: 'Parse a single JSON object, or one complete trailing JSON object after public commentary using a balanced scanner that respects strings and escapes. Preserve any prefix and protocol warning. Reject ambiguous multiple responses. Never repair or rename response fields, choices, or citations. Validate the actual parsed fields against the frozen schema and ballot.',
    documentation, citationVerification: 'API-reported web use and format checks only; sources and political placement not independently verified.' };
  await save(path, batch); return batch;
}

async function loadPrior(batchDir, model, trial) {
  const path = join(runPath(batchDir, model, trial), 'run.json');
  if (!(await exists(path))) return null;
  const record = JSON.parse(await readFile(path, 'utf8'));
  if (record.status === 'running') {
    record.status = 'interrupted'; record.finishedAt = new Date().toISOString();
    record.error = 'Previous runner exited before completion; no retry'; record.usageMayBeIncomplete = true;
    await save(path, record);
  }
  return record;
}

export async function runOpenRouterTrial({ batchDir, batch, model, trial, apiKey, fetchImpl = fetch, signal }) {
  const prior = await loadPrior(batchDir, model, trial); if (prior) return prior;
  const runDir = runPath(batchDir, model, trial); await mkdir(runDir, { recursive: true });
  const path = join(runDir, 'run.json'), started = Date.now();
  const config = batch.modelConfigs.find(m => m.id === model);
  const record = { schemaVersion: 1, id: `${encodeURIComponent(model)}-trial-${trial}`, batchId: batch.id,
    provider: 'openrouter', model, requestedModel: model, resolvedModel: null, servingProvider: null, trial,
    effort: config.effort, startedAt: new Date(started).toISOString(), status: 'running', requestSent: false,
    hashes: batch.hashes, limits: batch.limits, capabilities: batch.capabilities,
    usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null }, costUsd: null,
    audit: { webSearchCalls: 0, webFetchCalls: null, searchUsageReported: false }, validation: null, response: null,
    error: null, citationVerification: batch.citationVerification };
  await save(path, record);
  try {
    const requests = JSON.parse(await readFile(join(batchDir, 'inputs/request-templates.json'), 'utf8'));
    const body = requests[model];
    await save(join(runDir, 'request.json'), body); record.requestSha256 = hash(json(body));
    const rawPath = join(runDir, 'response-body.txt'); await writeFile(rawPath, '', { mode: 0o600 });
    record.requestSent = true; await save(path, record);
    const result = await callOpenRouter({ body, apiKey, fetchImpl, signal, maxSeconds: batch.limits.maxSeconds, rawPath });
    record.httpStatus = result.status;
    const raw = result.parsed;
    await save(join(runDir, 'api-response.json'), raw);
    record.generationId = raw.id ?? null; record.resolvedModel = raw.model ?? null; record.servingProvider = raw.provider ?? null;
    record.finishReason = raw.choices?.[0]?.finish_reason ?? null;
    record.audit = auditOpenRouter(raw); record.usage = normalizeOpenRouterUsage(raw); record.costUsd = record.usage.costUsd;
    record.usageMayBeIncomplete = record.usage.inputTokens === null || record.usage.outputTokens === null || record.costUsd === null;
    if (!result.ok || raw.error) {
      record.errorCode = raw.error?.code ?? result.status;
      throw new Error(`OpenRouter HTTP/API failure (${record.errorCode}); details preserved privately`);
    }
    const message = raw.choices?.[0]?.message;
    const content = typeof message?.content === 'string' ? message.content : Array.isArray(message?.content)
      ? message.content.filter(p => p.type === 'text').map(p => p.text).join('') : '';
    await writeFile(join(runDir, 'response.txt'), content, { mode: 0o600 });
    try { Object.assign(record, extractFinalResponse(content)); }
    catch (error) { record.validation = { valid: false, errors: [error.message] }; }
    if (!record.validation) {
      const ballot = JSON.parse(await readFile(join(batchDir, 'inputs/ballot.json'), 'utf8'));
      record.validation = validateResponse(record.response, ballot, record.audit);
    }
    if (record.finishReason && record.finishReason !== 'stop') {
      record.validation.errors.push(`Unexpected finish reason: ${record.finishReason}`); record.validation.valid = false;
    }
    record.status = record.validation.valid ? 'completed' : 'invalid';
    if (record.response !== null) { record.responseSha256 = hash(json(record.response)); await save(join(runDir, 'response.json'), record.response); }
  } catch (error) {
    record.status = error.code === 'TIMEOUT' ? 'timed_out' : error.code === 'INTERRUPTED' ? 'interrupted' : 'failed';
    record.error = String(error.message).split(apiKey).join('[redacted]');
    record.httpStatus ??= error.httpStatus ?? null; record.usageMayBeIncomplete = true;
  } finally { record.finishedAt = new Date().toISOString(); record.wallMs = Date.now() - started; await save(path, record); }
  return record;
}

export async function publicOpenRouterSummary(batchDir) {
  const batch = JSON.parse(await readFile(join(batchDir, 'batch.json'), 'utf8'));
  const runs = [];
  for (const model of batch.models) for (let trial = 1; trial <= batch.trials; trial++) {
    const path = join(runPath(batchDir, model, trial), 'run.json');
    if (!(await exists(path))) { runs.push({ model, requestedModel: model, resolvedModel: null, provider: 'openrouter', trial, status: 'pending' }); continue; }
    const r = JSON.parse(await readFile(path, 'utf8'));
    runs.push({ id: r.id, batchId: r.batchId, provider: r.provider, model: r.model, requestedModel: r.requestedModel,
      resolvedModel: r.resolvedModel, servingProvider: r.servingProvider, trial: r.trial, effort: r.effort,
      status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, wallMs: r.wallMs, usage: r.usage,
      costUsd: r.costUsd, usageMayBeIncomplete: r.usageMayBeIncomplete ?? true,
      webSearchCalls: r.audit.webSearchCalls, webFetchCalls: r.audit.webFetchCalls, webAudit: r.audit,
      validation: r.validation, response: r.response, responseSha256: r.responseSha256 ?? null,
      publicCommentary: r.publicCommentary ?? null, protocolWarnings: r.protocolWarnings ?? [], parseMethod: r.parseMethod ?? null,
      hashes: r.hashes, requestSha256: r.requestSha256 ?? null, generationId: r.generationId ?? null,
      finishReason: r.finishReason ?? null, httpStatus: r.httpStatus ?? null,
      error: ['completed', 'running'].includes(r.status) ? null : r.status });
  }
  const progress = await exists(join(batchDir, 'progress.json')) ? JSON.parse(await readFile(join(batchDir, 'progress.json'), 'utf8')) : null;
  return { schemaVersion: 1, batch, ballot: JSON.parse(await readFile(join(batchDir, 'inputs/ballot.json'), 'utf8')),
    prompt: await readFile(join(batchDir, 'inputs/prompt.txt'), 'utf8'), runs, progress, exportedAt: new Date().toISOString() };
}

export async function exportOpenRouterBatch(batchDir, outputRoot = join(directory, 'data/public')) {
  const summary = await publicOpenRouterSummary(resolve(batchDir)); await mkdir(outputRoot, { recursive: true });
  const path = join(outputRoot, 'openrouter-results.json'); await save(path, summary); return path;
}

export async function runOpenRouterBatch(options, { apiKey, fetchImpl = fetch, signal } = {}) {
  const batchDir = resolve(options.batchDir); await mkdir(batchDir, { recursive: true });
  const lock = join(batchDir, '.lock');
  await mkdir(lock).catch(error => { if (error.code === 'EEXIST') throw new Error(`Batch is locked; inspect ${join(lock, 'owner.json')} before removing a stale lock`); throw error; });
  await save(join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString() });
  let batch;
  try {
    batch = await prepareBatch(options);
    if (!options.prepareOnly) {
      apiKey ??= await loadOpenRouterCredentials();
      const jobs = [], existing = [];
      for (let trial = 1; trial <= batch.trials; trial++) for (const model of batch.models) {
        const prior = await loadPrior(batchDir, model, trial);
        if (prior) existing.push(prior); else jobs.push({ model, trial });
      }
      let knownCostUsd = existing.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      let unknownCost = existing.some(r => r.requestSent && r.costUsd === null);
      let reservedUsd = 0, next = 0, launched = 0, stopReason = null;
      const running = new Set();
      const progress = async () => save(join(batchDir, 'progress.json'), { updatedAt: new Date().toISOString(),
        knownCostUsd, unknownCost, reservedUsd, launchedThisInvocation: launched, remainingUnattempted: jobs.length - next,
        stopReason, budgetUsd: batch.limits.budgetUsd, billingCeilingGuaranteed: false });
      while ((next < jobs.length || running.size) && !signal?.aborted) {
        while (next < jobs.length && running.size < options.concurrency && launched < options.limitNewAttempts && !unknownCost &&
          knownCostUsd + reservedUsd + batch.limits.reservationUsd <= batch.limits.budgetUsd && !signal?.aborted) {
          const job = jobs[next++]; launched++; reservedUsd += batch.limits.reservationUsd;
          console.log(`${batch.id}: ${job.model} trial ${job.trial}/${batch.trials}`);
          const task = runOpenRouterTrial({ batchDir, batch, ...job, apiKey, fetchImpl, signal }).then(record => {
            reservedUsd -= batch.limits.reservationUsd;
            if (record.costUsd !== null) knownCostUsd += record.costUsd;
            else if (record.requestSent) unknownCost = true;
            console.log(`${record.model} trial ${record.trial}: ${record.status}; web ${record.audit.webSearchCalls}; cost ${record.costUsd === null ? 'unknown' : '$' + record.costUsd.toFixed(4)}`);
          }).finally(() => running.delete(task));
          running.add(task);
        }
        if (unknownCost) stopReason = 'unknown_cost';
        else if (launched >= options.limitNewAttempts && next < jobs.length) stopReason = 'invocation_attempt_limit';
        else if (knownCostUsd + reservedUsd + batch.limits.reservationUsd > batch.limits.budgetUsd && next < jobs.length) stopReason = 'soft_budget_reservation';
        else stopReason = null;
        await progress();
        if (!running.size) break;
        await Promise.race(running);
      }
      await Promise.allSettled(running);
      if (signal?.aborted) stopReason = 'interrupted';
      await progress();
    }
  } finally { await rm(lock, { recursive: true, force: true }); }
  if (options.export) await exportOpenRouterBatch(batchDir);
  return { batchDir, summary: await publicOpenRouterSummary(batchDir) };
}

async function main() {
  const options = parseOpenRouterArgs(process.argv.slice(2));
  if (options.help) { console.log('Usage: node src/openrouter-run.mjs --batch PATH --models provider/model,... [--input-dir PATH --catalog PATH --trials 3 --concurrency 3 --max-seconds 1200 --max-tokens 24000 --max-tool-calls 20 --budget-usd 20 --reservation-usd 3 --request-cost-stop-usd 1 --limit-new-attempts 1 --prepare-only --export]\nResume: --batch PATH (existing attempts never retried). Explicit export: --export-only --batch PATH\nPer-request and batch dollar limits are soft; pending tool calls/final generation can exceed them. Unknown cost stops dispatch.'); return; }
  if (options.exportOnly) { console.log(await exportOpenRouterBatch(options.batchDir)); return; }
  const controller = new AbortController(), abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const result = await runOpenRouterBatch(options, { signal: controller.signal });
    console.log(`Saved ${result.batchDir}`);
    if (!options.prepareOnly && result.summary.runs.some(r => r.status !== 'completed')) process.exitCode = 1;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
