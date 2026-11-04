import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function mergeResults(cohorts) {
  if (!cohorts.length) throw new Error('At least one cohort is required');
  const first = cohorts[0], ids = new Set();
  for (const cohort of cohorts) {
    if (cohort.prompt !== first.prompt || JSON.stringify(cohort.ballot) !== JSON.stringify(first.ballot)) throw new Error('Cannot merge different prompts or ballot inventories');
    for (const run of cohort.runs) {
      const id = run.id ?? `${encodeURIComponent(run.model)}-trial-${run.trial}`;
      if (ids.has(id)) throw new Error(`Duplicate run ID: ${id}`);
      ids.add(id);
    }
  }
  const batches = cohorts.flatMap(c => c.batches ?? [c.batch]);
  const models = [...new Set(batches.flatMap(b => b.models))];
  return {schemaVersion: 1, batch: {
    id: 'san-leandro-2026-10-27-comparison', models, trials: 3, effort: 'per-model recorded',
    scope: first.ballot.scope, electionDate: first.ballot.electionDate,
    comparison: 'Same frozen ballot and base prompt; different research harnesses. Codex CLI, Claude Code native web tools, and OpenRouter server tools are distinct cohorts with separately recorded collection times. Self-assessments are not calibrated across models.',
  }, batches, cohortProvenance: cohorts.map(c=>({batchId:c.batch.id, progress:c.progress??null,
    originalRunnerProgress:c.originalRunnerProgress??null, continuation:c.continuation??null})), ballot: first.ballot, prompt: first.prompt,
  runs: cohorts.flatMap(c => c.runs.map(r => ({...r, id: r.id ?? `${encodeURIComponent(r.model)}-trial-${r.trial}`, batchId: c.batch.id,
    provider: r.provider ?? c.batch.provider ?? 'codex-cli'}))),
  exportedAt: new Date().toISOString()};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...inputs] = process.argv.slice(2);
  if (!output || !inputs.length) throw new Error('Usage: merge-results.mjs OUTPUT INPUT...');
  const cohorts = await Promise.all(inputs.map(async p => JSON.parse(await readFile(p, 'utf8'))));
  const merged = mergeResults(cohorts);
  await writeFile(output, JSON.stringify(merged, null, 2) + '\n');
  console.log(`${merged.runs.length} attempts across ${merged.batch.models.length} models saved`);
}
