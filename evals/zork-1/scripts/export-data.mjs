import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evalRoot = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2] ? resolve(process.argv[2]) : join(evalRoot, 'data/raw');
const output = join(evalRoot, 'data/public');
const runs = [];
const transcripts = [];
for (const batch of (await readdir(source, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
  const directory = join(source, batch.name);
  const summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'));
  for (const file of (await readdir(directory)).filter(f => f.startsWith('run-') && f.endsWith('.jsonl')).sort()) {
    const events = (await readFile(join(directory, file), 'utf8')).trim().split('\n').map(JSON.parse);
    const start = events.find(e => e.type === 'run_start');
    if (!start) throw new Error(`Missing run_start: ${file}`);
    const row = summary.rows.find(r => r.tag === start.tag);
    if (!row) throw new Error(`Summary missing ${start.tag}; regenerate the batch report first`);
    const id = `run-${String(runs.length + 1).padStart(3, '0')}`;
    const commands = [];
    let commentary = '';
    for (const event of events) {
      if (event.type === 'model_turn') commentary = event.commentary || '';
      if (event.type === 'command') commands.push({ command: event.command, response: event.response, commentary, turn: event.turn });
    }
    // Explicit projection: diagnostics, local paths, and full provider payloads
    // stay out of the public transcript. Source event order is preserved.
    transcripts.push({ id, commands });
    runs.push({ id, model: row.model, resolvedModel: row.resolvedModel ?? null, provider: row.provider, tag: row.tag, seed: row.seed ?? start.seed ?? null,
      moveBudget: start.moveBudget, moves: row.moves ?? null, maxScore: row.maxScore ?? null, deaths: row.deaths ?? null,
      wallMin: row.wallMin ?? null, incomplete: Boolean(row.incomplete), endReason: row.endReason ?? null,
      source: `${batch.name}/${file}`, transcript: `transcripts/${id}.json` });
  }
}
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'transcripts'), { recursive: true });
for (const transcript of transcripts) await writeFile(join(output, 'transcripts', `${transcript.id}.json`), JSON.stringify(transcript));
await writeFile(join(output, 'results.json'), JSON.stringify({ schemaVersion: 1, maxScore: 350, runs }, null, 2) + '\n');
console.log(`Exported ${runs.length} runs and ${transcripts.reduce((n,t) => n + t.commands.length, 0)} commands`);
