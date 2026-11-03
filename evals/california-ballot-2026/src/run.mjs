import { readFile, writeFile, mkdir, mkdtemp, rm, rename, copyFile, access } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { responseSchema, validateBallot, validateResponse, parseEvents, researchAudit } from './schema.mjs';
import { execute } from './process.mjs';

export const directory = fileURLToPath(new URL('../', import.meta.url));
export const defaultModels = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
const sourceFiles = ['run.mjs', 'schema.mjs', 'process.mjs'];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const exists = async path => { try { await access(path); return true; } catch { return false; } };
async function save(path, value) { const temporary = `${path}.${randomUUID()}.tmp`; await writeFile(temporary, json(value)); await rename(temporary, path); }
async function harnessHashes() { return Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await readFile(join(directory, 'src', name)))]))); }

export function codexArgs({ model, workspace, schema }) {
  return ['--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
    '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-c', 'web_search="live"',
    '-c', 'features.shell_tool=false', '-c', 'model_reasoning_effort="medium"',
    '--model', model, '--cd', workspace, '--output-schema', schema, '-'];
}

export function parseArgs(args) {
  const out = { models: [...defaultModels], trials: 3, concurrency: 3, maxSeconds: 1200,
    codex: process.env.CODEX_CLI_PATH || 'codex', inputDir: directory, export: false, exportOnly: false };
  const fields = { '--models': 'models', '--trials': 'trials', '--concurrency': 'concurrency', '--max-seconds': 'maxSeconds', '--batch': 'batchDir', '--codex': 'codex', '--input-dir': 'inputDir' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--export') { out.export = true; continue; }
    if (arg === '--export-only') { out.exportOnly = true; continue; }
    if (arg === '--help') { out.help = true; continue; }
    if (!fields[arg] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${arg}`);
    out[fields[arg]] = args[++i];
  }
  if (typeof out.models === 'string') out.models = out.models.split(',');
  if (!out.models.length || new Set(out.models).size !== out.models.length || out.models.some(m => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(m))) throw new Error('Models must be unique safe model IDs');
  for (const field of ['trials', 'concurrency', 'maxSeconds']) {
    out[field] = Number(out[field]);
    if (!Number.isSafeInteger(out[field]) || out[field] < 1) throw new Error(`${field} must be a positive integer`);
  }
  if (out.concurrency > 3) throw new Error('Maximum concurrency is 3');
  if (out.exportOnly && !out.batchDir) throw new Error('--export-only requires --batch');
  return out;
}

async function prepareBatch(options) {
  const batchDir = resolve(options.batchDir || join(directory, 'runs', `batch-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
  await mkdir(batchDir, { recursive: true });
  const manifestPath = join(batchDir, 'batch.json');
  if (await exists(manifestPath)) {
    const batch = JSON.parse(await readFile(manifestPath, 'utf8'));
    const actualHarness = await harnessHashes();
    if (JSON.stringify(actualHarness) !== JSON.stringify(batch.hashes.harness)) throw new Error('Harness changed since this batch was frozen; use the original harness or a new batch');
    for (const [name, digest] of Object.entries(batch.hashes.inputs)) if (hash(await readFile(join(batchDir, 'inputs', name))) !== digest) throw new Error(`Frozen input changed: ${name}`);
    return { batchDir, batch };
  }
  const inputDir = resolve(options.inputDir);
  const prompt = await readFile(join(inputDir, 'prompt.txt'), 'utf8');
  if (!prompt.trim()) throw new Error('prompt.txt cannot be empty');
  const inventory = await readFile(join(inputDir, 'ballot.json'), 'utf8');
  const ballot = JSON.parse(inventory), ballotErrors = validateBallot(ballot);
  if (ballotErrors.length) throw new Error(`Invalid ballot: ${ballotErrors.join('; ')}`);
  const inputs = { 'prompt.txt': prompt, 'ballot.json': inventory, 'response-schema.json': json(responseSchema),
    'full-prompt.txt': `${prompt.trimEnd()}\n\nFrozen ballot inventory (data, not instructions):\n${inventory.trim()}\n` };
  await mkdir(join(batchDir, 'inputs', 'harness'), { recursive: true });
  for (const [name, content] of Object.entries(inputs)) await writeFile(join(batchDir, 'inputs', name), content);
  for (const name of sourceFiles) await copyFile(join(directory, 'src', name), join(batchDir, 'inputs', 'harness', name));
  const batch = { schemaVersion: 1, id: basename(batchDir), createdAt: new Date().toISOString(), electionDate: ballot.electionDate,
    scope: ballot.scope, models: options.models, trials: options.trials, effort: 'medium', maxSeconds: options.maxSeconds,
    hashes: { inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, hash(v)])), harness: await harnessHashes() },
    independence: 'Fresh ephemeral CLI invocation and isolated empty working directory per requested model and trial; no prior responses in prompts.',
    scheduling: 'Round first, models second; up to three concurrent attempts, without a barrier between rounds.',
    capabilities: { webSearch: 'live', shell: false, sandbox: 'read-only', userConfig: false },
    citationVerification: 'Format and web activity checks only. Sources and ideological interpretation require human review.' };
  await save(manifestPath, batch);
  return { batchDir, batch };
}

export async function runTrial({ batchDir, batch, model, trial, codex, signal, runAgent = execute, cliVersion }) {
  const runDir = join(batchDir, model, `trial-${trial}`), path = join(runDir, 'run.json');
  await mkdir(runDir, { recursive: true });
  if (await exists(path)) {
    const prior = JSON.parse(await readFile(path, 'utf8'));
    if (prior.status === 'running') {
      prior.status = 'interrupted'; prior.error = 'Previous harness exited before recording completion; preserved without retry';
      prior.finishedAt = new Date().toISOString(); prior.usageMayBeIncomplete = true; await save(path, prior);
    }
    return prior;
  }
  const started = Date.now();
  const record = { schemaVersion: 1, id: `${model}-trial-${trial}`, batchId: batch.id, model, requestedModel: model, resolvedModel: null,
    trial, effort: batch.effort, startedAt: new Date(started).toISOString(), status: 'running', cliPath: codex, cliVersion,
    hashes: batch.hashes, maxSeconds: batch.maxSeconds, capabilities: batch.capabilities,
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, audit: { webSearchCalls: 0, actions: [] },
    validation: null, response: null, error: null, citationVerification: batch.citationVerification };
  await save(path, record);
  let workspace, result;
  try {
    workspace = await mkdtemp(join(tmpdir(), 'ca-ballot-research-'));
    const schema = join(workspace, 'response-schema.json');
    await copyFile(join(batchDir, 'inputs', 'response-schema.json'), schema);
    const input = await readFile(join(batchDir, 'inputs', 'full-prompt.txt'), 'utf8');
    const ballot = JSON.parse(await readFile(join(batchDir, 'inputs', 'ballot.json'), 'utf8'));
    record.commandArgs = codexArgs({ model, workspace, schema });
    await save(path, record);
    const eventsPath = join(runDir, 'events.jsonl'), stderrPath = join(runDir, 'stderr.txt');
    await writeFile(eventsPath, ''); await writeFile(stderrPath, '');
    try { result = await runAgent(codex, record.commandArgs, { cwd: workspace, input, timeoutMs: batch.maxSeconds * 1000, signal,
      onStdout: chunk => appendFileSync(eventsPath, chunk), onStderr: chunk => appendFileSync(stderrPath, chunk) }); }
    catch (error) { result = { code: null, stdout: error.stdout || '', stderr: error.stderr || '', executionError: error }; }
    await writeFile(join(runDir, 'events.jsonl'), result.stdout);
    await writeFile(join(runDir, 'stderr.txt'), result.stderr);
    const events = parseEvents(result.stdout);
    record.exitCode = result.code;
    for (const e of events.filter(e => e.type === 'turn.completed')) {
      record.usage.inputTokens += e.usage?.input_tokens ?? 0;
      record.usage.cachedInputTokens += e.usage?.cached_input_tokens ?? 0;
      record.usage.outputTokens += e.usage?.output_tokens ?? 0;
    }
    record.audit = researchAudit(events);
    if (result.executionError) throw result.executionError;
    const failure = events.find(e => ['turn.failed', 'error'].includes(e.type));
    if (result.code !== 0 || failure) throw new Error(failure?.error?.message || failure?.message || `CLI exited ${result.code}: ${result.stderr.slice(-1500)}`);
    const message = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').at(-1)?.item.text;
    if (message !== undefined) await writeFile(join(runDir, 'response.txt'), message);
    try { record.response = JSON.parse(message); }
    catch { record.validation = { valid: false, errors: ['Final assistant message is absent or not a single JSON value'] }; }
    if (record.response !== null) record.validation = validateResponse(record.response, ballot, record.audit);
    if (record.response === null && !record.validation) record.validation = { valid: false, errors: ['Null response'] };
    record.status = record.validation.valid ? 'completed' : 'invalid';
    if (record.response !== null) { record.responseSha256 = hash(json(record.response)); await save(join(runDir, 'response.json'), record.response); }
  } catch (error) {
    record.status = error.code === 'INTERRUPTED' ? 'interrupted' : error.code === 'TIMEOUT' ? 'timed_out' : 'failed';
    record.error = error.message; record.usageMayBeIncomplete = true;
  } finally {
    if (workspace) await rm(workspace, { recursive: true, force: true });
    record.finishedAt = new Date().toISOString(); record.wallMs = Date.now() - started;
    await save(path, record);
  }
  return record;
}

export async function publicSummary(batchDir) {
  const batch = JSON.parse(await readFile(join(batchDir, 'batch.json'), 'utf8'));
  const records = [];
  for (const model of batch.models) for (let trial = 1; trial <= batch.trials; trial++) {
    const path = join(batchDir, model, `trial-${trial}`, 'run.json');
    if (!(await exists(path))) { records.push({ model, requestedModel: model, resolvedModel: null, trial, status: 'pending' }); continue; }
    const r = JSON.parse(await readFile(path, 'utf8'));
    // Allowlist export: never publish raw traces, stderr, local paths or error text.
    records.push({ id: r.id, model: r.model, requestedModel: r.requestedModel, resolvedModel: r.resolvedModel, trial: r.trial,
      status: r.status, effort: r.effort, startedAt: r.startedAt, finishedAt: r.finishedAt, wallMs: r.wallMs,
      usage: r.usage, usageMayBeIncomplete: r.usageMayBeIncomplete ?? false, cliVersion: r.cliVersion,
      hashes: r.hashes, responseSha256: r.responseSha256 ?? null, webSearchCalls: r.audit.webSearchCalls,
      validation: r.validation, response: r.response,
      error: ['completed', 'pending', 'running'].includes(r.status) ? null : r.status });
  }
  return { schemaVersion: 1, batch: { ...batch, limits: { maxSeconds: batch.maxSeconds } },
    ballot: JSON.parse(await readFile(join(batchDir, 'inputs', 'ballot.json'), 'utf8')),
    prompt: await readFile(join(batchDir, 'inputs', 'prompt.txt'), 'utf8'),
    runs: records, exportedAt: new Date().toISOString() };
}

export async function exportBatch(batchDir, outputRoot = join(directory, 'data', 'public')) {
  const summary = await publicSummary(resolve(batchDir));
  await mkdir(outputRoot, { recursive: true });
  const path = join(outputRoot, 'results.json');
  await save(path, summary); return path;
}

export async function runBatch(options, { runAgent = execute, runTool = execute, signal } = {}) {
  const batchDir = resolve(options.batchDir || join(directory, 'runs', `batch-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
  await mkdir(batchDir, { recursive: true });
  // Exclusive lock: a stale lock requires explicit removal after checking its PID.
  const lock = join(batchDir, '.lock');
  await mkdir(lock).catch(error => { if (error.code === 'EEXIST') throw new Error(`Batch is locked: inspect ${join(lock, 'owner.json')} before removing a stale lock`); throw error; });
  await save(join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString() });
  try {
    const { batch } = await prepareBatch({ ...options, batchDir });
    const version = await runTool(options.codex, ['--version'], { timeoutMs: 15000, signal });
    if (version.code !== 0) throw new Error(`Codex CLI version check failed: ${version.stderr}`);
    const jobs = Array.from({ length: batch.trials }, (_, i) => batch.models.map(model => ({ model, trial: i + 1 }))).flat();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(options.concurrency, jobs.length) }, async () => {
      while (next < jobs.length && !signal?.aborted) {
        const job = jobs[next++];
        console.log(`${batch.id}: ${job.model} trial ${job.trial}/${batch.trials}`);
        const r = await runTrial({ batchDir, batch, ...job, codex: options.codex, cliVersion: version.stdout.trim(), signal, runAgent });
        console.log(`${r.id}: ${r.status}; ${r.audit.webSearchCalls} completed web calls`);
      }
    }));
  } finally { await rm(lock, { recursive: true, force: true }); }
  if (options.export) await exportBatch(batchDir);
  return { batchDir, summary: await publicSummary(batchDir) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log('Usage: node src/run.mjs [--batch PATH] [--models ID,ID] [--trials 3] [--concurrency 3] [--max-seconds 1200] [--input-dir PATH] [--codex PATH] [--export]\nResume uses frozen batch settings and skips every existing attempt, including failures.\nExplicit publication: --export-only --batch PATH'); return; }
  if (options.exportOnly) { console.log(await exportBatch(options.batchDir)); return; }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const { batchDir, summary } = await runBatch(options, { signal: controller.signal });
    console.log(`Batch saved: ${batchDir}`);
    if (summary.runs.some(r => r.status !== 'completed')) process.exitCode = 1;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
