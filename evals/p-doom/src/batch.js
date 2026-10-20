import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { directory, runTrial } from './run.js';
import { parseEvents } from './process.js';

export const thinkingLevels = ['low', 'medium', 'high', 'xhigh', 'max'];
export function comparisonMatrix() {
  const jobs = [];
  for (let trial = 1; trial <= 3; trial++) {
    jobs.push({ model: 'gpt-6-astra', effort: 'medium', trial }, { model: 'gpt-6-sol', effort: 'medium', trial });
    for (const effort of [...thinkingLevels].reverse()) jobs.push({ model: 'gpt-6-luna', effort, trial });
  }
  return jobs;
}
const digest = value => createHash('sha256').update(value).digest('hex');
export async function frozenInputs() {
  const paths = ['prompt.txt', 'scenario.json', 'eval.json', 'requirements.txt', 'src/run.js', 'src/model.js', 'src/lint.js', 'src/infer.py', 'src/process.js', 'src/batch.js', 'src/claude.js'];
  const files = {};
  for (const path of paths) files[path] = digest(await readFile(join(directory, path)));
  return files;
}

export async function runBatch({ resume, concurrency = 3 } = {}) {
  const batchDirectory = join(directory, 'runs', resume || `leap-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(batchDirectory, { recursive: true });
  const manifestPath = join(batchDirectory, 'batch.json');
  const inputs = await frozenInputs();
  let manifest;
  if (resume) {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (JSON.stringify(inputs) !== JSON.stringify(manifest.inputs)) throw new Error('Comparison inputs changed; start a new batch rather than mixing prompts or harness versions');
    if (manifest.jobs.some(j => j.status === 'running')) throw new Error('Resume only a batch with no running jobs; inspect interrupted jobs first');
  } else {
    manifest = { schemaVersion: 1, id: batchDirectory.split('/').at(-1), createdAt: new Date().toISOString(),
      inputs, promptSha256: inputs['prompt.txt'], scenario: JSON.parse(await readFile(join(directory, 'scenario.json'), 'utf8')),
      maxRounds: 3, maxSeconds: 1800, concurrency, jobs: comparisonMatrix().map(j => ({ ...j, status: 'pending' })) };
  }
  let persistence = Promise.resolve();
  const save = () => { const contents = JSON.stringify(manifest, null, 2); persistence = persistence.then(() => writeFile(manifestPath, contents)); return persistence; };
  await save();
  const controller = new AbortController(); const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let next = 0;
  const worker = async () => {
    while (!controller.signal.aborted) {
      const job = manifest.jobs[next++]; if (!job) return;
      if (job.status !== 'pending') continue;
      if (JSON.stringify(await frozenInputs()) !== JSON.stringify(manifest.inputs)) throw new Error('Frozen comparison inputs changed during the batch');
      job.status = 'running'; await save();
      console.log(`START ${job.model}@${job.effort} trial ${job.trial}`);
      const result = await runTrial({ ...job, maxTurns: manifest.maxRounds, maxSeconds: manifest.maxSeconds,
        asOf: manifest.createdAt, batchId: manifest.id, signal: controller.signal });
      job.status = result.record.status; job.directory = result.directory; job.runId = result.record.id;
      console.log(`DONE ${job.model}@${job.effort} trial ${job.trial}: ${job.status}${result.record.inference ? ` (${(result.record.inference.pDoom * 100).toPrecision(4)}%)` : ''}`);
      await save();
    }
  };
  try {
    const results = await Promise.allSettled(Array.from({ length: concurrency }, worker));
    const error = results.find(r => r.status === 'rejected'); if (error) throw error.reason;
    manifest.finishedAt = new Date().toISOString(); await save();
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await save(); }
  console.log(`BATCH ${manifest.id}`);
  return manifest;
}

// Explicitly exports only this frozen LEAP batch. Historical pilots cannot leak
// in via a directory glob. The transcript contains public model/tool events,
// not provider stderr, thread IDs, reasoning items, or local executable paths.
export async function exportBatch(batchId) {
  if (!/^leap-[a-zA-Z0-9.-]+$/.test(batchId)) throw new Error('Invalid batch ID');
  const manifest = JSON.parse(await readFile(join(directory, 'runs', batchId, 'batch.json'), 'utf8'));
  const scenario = JSON.parse(await readFile(join(directory, 'scenario.json'), 'utf8'));
  if (manifest.scenario.id !== scenario.id || manifest.promptSha256 !== digest(await readFile(join(directory, 'prompt.txt')))) throw new Error('Cannot publish a batch with a different scenario or prompt');
  const publicDirectory = join(directory, 'data/public');
  const runs = [];
  for (const job of manifest.jobs) {
    if (!job.directory) continue;
    const record = JSON.parse(await readFile(join(job.directory, 'run.json'), 'utf8'));
    if (record.batchId !== batchId || record.event.id !== scenario.id || record.promptSha256 !== manifest.promptSha256) throw new Error('Refusing a mixed-scenario or mixed-prompt run');
    if (record.status === 'submitted') {
      const actual = digest(JSON.stringify({ submission: record.submission, inference: record.inference }));
      if (actual !== record.artifactSha256) throw new Error('Final artifact hash mismatch');
    }
    const transcript = [];
    const filenames = (await readdir(job.directory)).filter(n => /^prompt-\d+\.txt$/.test(n)).sort((a,b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    for (const filename of filenames) {
      const turn = Number(filename.match(/\d+/)[0]);
      transcript.push({ role: 'user', turn, content: await readFile(join(job.directory, filename), 'utf8') });
      let events = [];
      try { events = parseEvents(await readFile(join(job.directory, `events-${turn}.jsonl`), 'utf8')); } catch { /* interrupted before events were saved */ }
      for (const event of events) {
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') transcript.push({ role: 'assistant', turn, content: event.item.text });
        if (event.type === 'item.completed' && event.item?.type === 'web_search') transcript.push({ role: 'tool', turn, content: JSON.stringify(event.item.action || { type: 'web_search' }) });
        if (event.type === 'turn.failed' || event.type === 'error') transcript.push({ role: 'error', turn, content: event.error?.message || event.message || 'Provider failure' });
      }
      const round = record.rounds.find(r => r.turn === turn);
      if (round?.feedback) transcript.push({ role: 'harness', turn, content: JSON.stringify(round.feedback, null, 2) });
    }
    const target = join(publicDirectory, record.id); await mkdir(target, { recursive: true });
    await writeFile(join(target, 'transcript.json'), JSON.stringify({ id: record.id, visibility: 'Recorded prompts, assistant messages, search actions and harness feedback. Private reasoning and retrieved page bodies are excluded.', messages: transcript }, null, 2));
    if (record.status === 'submitted') await writeFile(join(target, 'model.pl'), record.inference.program);
    const { cliPath, responseSchema, ...publicRecord } = record;
    runs.push({ ...publicRecord, transcript: `${record.id}/transcript.json`, modelFile: record.status === 'submitted' ? `${record.id}/model.pl` : null });
  }
  await writeFile(join(publicDirectory, 'results.json'), JSON.stringify({ schemaVersion: 3,
    batch: { id: batchId, createdAt: manifest.createdAt, finishedAt: manifest.finishedAt || null, maxRounds: manifest.maxRounds, maxSeconds: manifest.maxSeconds, promptSha256: manifest.promptSha256, jobs: manifest.jobs.map(({ directory, ...j }) => j),
      inputHistory: (manifest.inputHistory || []).map(({ snapshot, ...history }) => history),
      supersededAttempts: (manifest.supersededAttempts || []).map(({ directory, ...attempt }) => attempt) },
    scenario, runs }, null, 2));
  console.log(`Exported ${runs.length} attempts from ${batchId}; earlier pilots excluded`);
  return runs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { resume: { type: 'string' }, export: { type: 'string' }, concurrency: { type: 'string', default: '3' } } });
  const concurrency = Number(values.concurrency);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Concurrency must be 1–4');
  if (values.export) await exportBatch(values.export); else await runBatch({ resume: values.resume, concurrency });
}
