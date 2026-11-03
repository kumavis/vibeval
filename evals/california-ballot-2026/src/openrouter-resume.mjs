import { readFile, writeFile, mkdir, rename, rm, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { directory, runOpenRouterTrial, publicOpenRouterSummary } from './openrouter-run.mjs';
import { loadOpenRouterCredentials } from './openrouter-client.mjs';

const sourcePath = fileURLToPath(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const exists = async path => { try { await access(path); return true; } catch { return false; } };
async function save(path, value) { const tmp = `${path}.${randomUUID()}.tmp`; await writeFile(tmp, json(value), { mode: 0o600 }); await rename(tmp, path); }
const recordPath = (batchDir, model, trial) => join(batchDir, encodeURIComponent(model), `trial-${trial}`, 'run.json');
const knownAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function parseResumeArgs(args) {
  const out = { concurrency: 3, unknownReservationUsd: 3, limitNewAttempts: Infinity, export: false, exportOnly: false, inspectOnly: false,
    reason: 'Continue only unattempted trials after an API failure with unreported billing. Reserve dollars for each unresolved charge without treating its actual cost as zero.' };
  const fields = { '--batch': 'batchDir', '--concurrency': 'concurrency', '--unknown-reservation-usd': 'unknownReservationUsd', '--limit-new-attempts': 'limitNewAttempts', '--reason': 'reason' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--export') { out.export = true; continue; }
    if (flag === '--export-only') { out.exportOnly = true; continue; }
    if (flag === '--inspect-only') { out.inspectOnly = true; continue; }
    if (flag === '--help') { out.help = true; continue; }
    if (!fields[flag] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown flag or missing argument: ${flag}`);
    out[fields[flag]] = args[++i];
  }
  for (const field of ['concurrency', 'limitNewAttempts']) {
    if (field === 'limitNewAttempts' && out[field] === Infinity) continue;
    out[field] = Number(out[field]);
    if (!Number.isSafeInteger(out[field]) || out[field] < 1) throw new Error(`${field} must be a positive integer`);
  }
  out.unknownReservationUsd = Number(out.unknownReservationUsd);
  if (!Number.isFinite(out.unknownReservationUsd) || out.unknownReservationUsd < 3) throw new Error('Unknown charge reservation must be at least $3');
  if (out.concurrency > 3) throw new Error('Maximum concurrency is 3');
  if (!out.batchDir && !out.help) throw new Error('--batch is required');
  return out;
}

function attachContinuation(summary, metadata, progress) {
  return { ...summary, originalRunnerProgress: summary.progress, progress, continuation: { ...metadata, progress } };
}

// Read-only with respect to the batch. No credentials, lock acquisition or model
// calls: reconstruct the public artifact from the newest saved continuation.
export async function exportOpenRouterContinuation(batchDirectory, outputRoot = join(directory, 'data/public')) {
  const batchDir = resolve(batchDirectory), lock = join(batchDir, '.lock');
  if (await exists(lock)) throw new Error('Batch is locked; wait for the active runner before exporting continuation results');
  const root = join(batchDir, 'continuations');
  const names = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
  let metadata, progress;
  for (const name of names) {
    const path = join(root, name, 'continuation.json');
    if (!(await exists(path))) continue;
    metadata = JSON.parse(await readFile(path, 'utf8'));
    progress = JSON.parse(await readFile(join(root, name, 'progress.json'), 'utf8'));
    break;
  }
  if (!metadata) throw new Error('No saved continuation metadata to export');
  const summary = attachContinuation(await publicOpenRouterSummary(batchDir), metadata, progress);
  if (await exists(lock)) throw new Error('Runner started while reading results; export stopped');
  await mkdir(outputRoot, { recursive: true });
  const path = join(outputRoot, 'openrouter-results.json'); await save(path, summary);
  return path;
}

async function inspectFrozenBatch(batchDir) {
  const batchText = await readFile(join(batchDir, 'batch.json'), 'utf8'), batch = JSON.parse(batchText);
  if (batch.provider !== 'openrouter' || batch.protocolVersion !== 2) throw new Error('Continuation requires the frozen OpenRouter protocol-v2 batch');
  if (batch.models.some(model => model.startsWith('anthropic/'))) throw new Error('Anthropic models must not run through OpenRouter for this evaluation');
  for (const name of ['openrouter-run.mjs', 'openrouter-client.mjs', 'schema.mjs']) {
    const digest = batch.hashes.harness[name];
    if (!digest || hash(await readFile(join(directory, 'src', name))) !== digest || hash(await readFile(join(batchDir, 'inputs/harness', name))) !== digest) throw new Error(`Frozen harness mismatch: ${name}`);
  }
  for (const [name, digest] of Object.entries(batch.hashes.inputs)) if (hash(await readFile(join(batchDir, 'inputs', name))) !== digest) throw new Error(`Frozen input mismatch: ${name}`);
  const existing = [], jobs = [];
  for (let trial = 1; trial <= batch.trials; trial++) for (const model of batch.models) {
    const path = recordPath(batchDir, model, trial);
    if (!(await exists(path))) { jobs.push({ model, trial }); continue; }
    const text = await readFile(path, 'utf8'), record = JSON.parse(text);
    if (record.status === 'running') throw new Error(`Existing attempt is still marked running: ${model} trial ${trial}; wait for the original runner to settle`);
    existing.push({ model, trial, status: record.status, costUsd: knownAmount(record.costUsd) ? record.costUsd : null,
      requestSent: record.requestSent !== false, recordSha256: hash(text) });
  }
  return { batch, batchSha256: hash(batchText), existing, jobs };
}

export async function resumeOpenRouterBatch(options, { apiKey, fetchImpl = fetch, signal, outputRoot = join(directory, 'data/public') } = {}) {
  const batchDir = resolve(options.batchDir), lock = join(batchDir, '.lock');
  await mkdir(lock).catch(error => { if (error.code === 'EEXIST') throw new Error('Original batch is locked; wait for its runner to finish before continuing'); throw error; });
  await save(join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString(), controller: 'openrouter-resume' });
  let metadata, progress, continuationDir;
  try {
    const { batch, batchSha256, existing, jobs } = await inspectFrozenBatch(batchDir);
    const unknownReservationUsd = Math.max(options.unknownReservationUsd, batch.limits.reservationUsd);
    let knownCostUsd = existing.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    let unknownAttemptCount = existing.filter(r => r.requestSent && r.costUsd === null).length;
    const baseState = { knownCostUsd, unknownAttemptCount, unknownReservationUsd, unknownReservedUsd: unknownAttemptCount * unknownReservationUsd,
      budgetUsd: batch.limits.budgetUsd, perInFlightReservationUsd: batch.limits.reservationUsd, remainingUnattempted: jobs.length };
    if (options.inspectOnly) return { batchDir, inspection: baseState, existing, jobs };
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    continuationDir = join(batchDir, 'continuations', id); await mkdir(continuationDir, { recursive: true });
    const source = await readFile(sourcePath, 'utf8'); await writeFile(join(continuationDir, 'controller.mjs'), source, { mode: 0o600 });
    metadata = { schemaVersion: 1, id, batchId: batch.id, createdAt: new Date().toISOString(), reason: options.reason,
      controllerSha256: hash(source), originalBatchSha256: batchSha256, originalHarnessHashes: batch.hashes.harness,
      originalInputHashes: batch.hashes.inputs, initialState: baseState, existingRecords: existing,
      policy: 'Dispatch only absent run.json attempts. Budget accounting = known reported charges + fixed reservation for each sent request with unknown charge + fixed reservation per in-flight request. Unknown actual costs remain null; reservations are not measured charges. Original requests, harness, inputs, existing records and progress are unchanged. No failed attempt is retried.',
      billingCeilingGuaranteed: false, concurrency: options.concurrency };
    await save(join(continuationDir, 'continuation.json'), metadata);
    if (jobs.length) apiKey ??= await loadOpenRouterCredentials();
    let next = 0, launched = 0, inFlightReservedUsd = 0, stopReason = null, infrastructureError = null;
    const running = new Set();
    const accounted = () => knownCostUsd + unknownAttemptCount * unknownReservationUsd + inFlightReservedUsd;
    const persist = async () => {
      progress = { updatedAt: new Date().toISOString(), knownCostUsd, unknownAttemptCount,
        unknownReservedUsd: unknownAttemptCount * unknownReservationUsd, unknownReservationUsd, inFlightReservedUsd,
        accountedBudgetUsd: accounted(), budgetUsd: batch.limits.budgetUsd,
        launchedThisContinuation: launched, remainingUnattempted: jobs.length - next, stopReason, billingCeilingGuaranteed: false };
      await save(join(continuationDir, 'progress.json'), progress);
    };
    while (next < jobs.length || running.size) {
      while (next < jobs.length && running.size < options.concurrency && launched < options.limitNewAttempts && !signal?.aborted && !infrastructureError &&
        accounted() + batch.limits.reservationUsd <= batch.limits.budgetUsd) {
        const job = jobs[next++]; launched++; inFlightReservedUsd += batch.limits.reservationUsd;
        console.log(`${batch.id}: continuation ${job.model} trial ${job.trial}/${batch.trials}`);
        const task = runOpenRouterTrial({ batchDir, batch, ...job, apiKey, fetchImpl, signal }).then(record => {
          if (knownAmount(record.costUsd)) knownCostUsd += record.costUsd;
          else if (record.requestSent !== false) unknownAttemptCount++;
          console.log(`${record.model} trial ${record.trial}: ${record.status}; reported cost ${knownAmount(record.costUsd) ? '$' + record.costUsd.toFixed(4) : 'unknown (reserved)'} `);
        }).catch(error => { infrastructureError = error; unknownAttemptCount++; }).finally(() => {
          inFlightReservedUsd -= batch.limits.reservationUsd; running.delete(task);
        });
        running.add(task);
      }
      stopReason = infrastructureError ? 'infrastructure_error' : signal?.aborted ? 'interrupted'
        : launched >= options.limitNewAttempts && next < jobs.length ? 'invocation_attempt_limit'
        : accounted() + batch.limits.reservationUsd > batch.limits.budgetUsd && next < jobs.length ? 'conservative_budget_reservation' : null;
      await persist();
      if (!running.size) break;
      await Promise.race(running);
    }
    await persist();
    for (const prior of existing) if (hash(await readFile(recordPath(batchDir, prior.model, prior.trial))) !== prior.recordSha256) throw new Error('Existing run changed during continuation; provenance check failed');
    if (hash(await readFile(join(batchDir, 'batch.json'))) !== batchSha256) throw new Error('Batch manifest changed during continuation');
    metadata.finishedAt = new Date().toISOString(); metadata.existingRecordsUnchanged = true;
    await save(join(continuationDir, 'continuation.json'), metadata);
    if (infrastructureError) throw new Error('Continuation infrastructure error; completed requests and conservative charge reservations preserved');
  } finally { await rm(lock, { recursive: true, force: true }); }
  const summary = await publicOpenRouterSummary(batchDir);
  const enriched = attachContinuation(summary, metadata, progress);
  if (options.export) { await mkdir(outputRoot, { recursive: true }); await save(join(outputRoot, 'openrouter-results.json'), enriched); }
  return { batchDir, continuationDir, summary: enriched };
}

async function main() {
  const options = parseResumeArgs(process.argv.slice(2));
  if (options.help) { console.log('Usage: node src/openrouter-resume.mjs --batch PATH [--concurrency 3 --unknown-reservation-usd 3 --limit-new-attempts N --inspect-only --export]\nRead-only final export: --batch PATH --export-only (requires no active batch lock; uses latest saved continuation metadata and current run records).\nContinues absent attempts only, preserving original harness and records. Unknown charges reserve at least $3 each; reported costs remain null. Same frozen soft batch budget.'); return; }
  if (options.exportOnly) { console.log(await exportOpenRouterContinuation(options.batchDir)); return; }
  const controller = new AbortController(), abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const result = await resumeOpenRouterBatch(options, { signal: controller.signal });
    if (options.inspectOnly) console.log(JSON.stringify(result.inspection));
    else { console.log(`Continuation saved: ${result.continuationDir}`); if (result.summary.runs.some(r => r.status === 'pending' || r.status === 'running')) process.exitCode = 1; }
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && resolve(process.argv[1]) === sourcePath) main().catch(error => { console.error(error.message); process.exitCode = 1; });
