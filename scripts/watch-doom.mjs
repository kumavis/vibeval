// Companion to an active local comparison, not a scheduled/background model job.
// Export completed attempts and rebuild the preview without additional inference.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { directory } from '../evals/p-doom/src/run.js';
import { exportBatch } from '../evals/p-doom/src/batch.js';
import { build } from './build.mjs';
const batchId = process.argv[2];
if (!/^leap-[a-zA-Z0-9.-]+$/.test(batchId || '')) throw new Error('Provide the active LEAP batch ID');
let previous = '';
while (true) {
  let batch;
  try { batch = JSON.parse(await readFile(join(directory, 'runs', batchId, 'batch.json'), 'utf8')); }
  catch { await setTimeout(1000); continue; } // A concurrent manifest write may be in progress.
  const state = JSON.stringify(batch.jobs.map(j => [j.runId, j.status]));
  if (state !== previous || batch.finishedAt) {
    await exportBatch(batchId); await build(); previous = state;
    console.log(`Preview updated: ${batch.jobs.filter(j => j.directory).length}/${batch.jobs.length} completed attempts`);
  }
  if (batch.finishedAt) break;
  await setTimeout(30000);
}
