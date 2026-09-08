import { readFile, writeFile, mkdir, cp, rename, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileInventory, safeRelative } from './workspace.js';

// Explicit local publication step; does not deploy or call a model.
export async function publishRun(evalDirectory, runDirectory) {
  const definition = JSON.parse(await readFile(join(evalDirectory, 'eval.json'), 'utf8'));
  const record = JSON.parse(await readFile(join(runDirectory, 'run.json'), 'utf8'));
  if (record.evalId !== definition.id || record.schemaVersion !== 1) throw new Error('Run does not belong to this eval');
  if (!['submitted','turn_limit','time_limit','failed','interrupted'].includes(record.status)) throw new Error('Only finished runs can be published');
  safeRelative(record.id);
  if (record.id.includes('/')) throw new Error('Invalid run id');
  const dataDir = join(evalDirectory, 'data/public');
  await mkdir(dataDir, { recursive: true });
  // Serialize publishers so an overlapping run cannot overwrite the catalog.
  const lock = join(dataDir, '.publish-lock');
  await mkdir(lock);
  const stage = join(dataDir, `.publish-${randomUUID()}`);
  try {
    let catalog;
    try { catalog = JSON.parse(await readFile(join(dataDir, 'runs.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; catalog = { schemaVersion: 1, runs: [] }; }
    if (catalog.runs.some(r => r.id === record.id)) throw new Error('Run already published; published snapshots are immutable');
    const published = structuredClone(record);
    const events = (await readFile(join(runDirectory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    await mkdir(stage);
    if (record.status === 'submitted') {
      if (!record.artifact) throw new Error('Submitted run has no artifact');
      const source = join(runDirectory, 'artifact');
      if (!(await lstat(source)).isDirectory()) throw new Error('Artifact root must be a real directory');
      const files = await fileInventory(source);
      if (files.length !== record.artifact.files.length) throw new Error('Artifact changed since submission');
      for (const file of files) {
        const digest = createHash('sha256').update(await readFile(join(source, file.path))).digest('hex');
        if (!record.artifact.files.some(f => f.path === file.path && f.sha256 === digest)) throw new Error('Artifact changed since submission');
      }
      safeRelative(record.artifact.entry);
      if (!files.some(f => f.path === record.artifact.entry)) throw new Error('Missing submitted entry');
      await cp(source, join(stage, 'artifact'), { recursive: true });
      published.artifact.entry = `${record.id}/artifact/${record.artifact.entry}`;
    } else published.artifact = null;
    if (record.evaluation?.path) {
      if (record.evaluation.path !== 'evaluation.json') throw new Error('Unsupported evaluation path');
      const content = await readFile(join(runDirectory, 'evaluation.json'));
      if (createHash('sha256').update(content).digest('hex') !== record.evaluation.sha256) throw new Error('Evaluation changed since scoring');
      await writeFile(join(stage, 'evaluation.json'), content);
      published.evaluation.path = `${record.id}/evaluation.json`;
    }
    // Failed / exhausted runs can be shipped too, but never show a draft as final.
    published.trace = `${record.id}/events.json`;
    await writeFile(join(stage, 'events.json'), JSON.stringify(events));
    await writeFile(join(stage, 'run.json'), JSON.stringify(record, null, 2));
    await rename(stage, join(dataDir, record.id));
    catalog.runs.push(published);
    const pending = join(dataDir, '.runs.json');
    await writeFile(pending, JSON.stringify(catalog, null, 2) + '\n');
    await rename(pending, join(dataDir, 'runs.json'));
    return published;
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
