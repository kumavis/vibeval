import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadEval } from '../packages/runner/src/formats.js';
import { runEval } from '../packages/runner/src/evaluate.js';
import { parseModelSpec } from '../packages/runner/src/model-spec.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  eval: { type: 'string' }, models: { type: 'string' }, provider: { type: 'string', default: 'codex-cli' },
  model: { type: 'string' }, effort: { type: 'string' }, trials: { type: 'string', default: '1' },
  'max-turns': { type: 'string' }, 'max-seconds': { type: 'string' }, pricing: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('npm run eval -- --eval ascii-sunken-ship --models "codex-cli:MODEL@medium,claude-cli:MODEL@high" --trials 3\nOr use --provider, --model, --effort. Optional: --max-turns N --max-seconds N --pricing snapshot.json.\nRuns stay local under evals/<id>/runs/. Publish selected results with npm run data:publish -- --eval <id> --run <run-directory>.');
} else {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.eval || '')) throw new Error('Provide --eval <id>');
  const directory = join(root, 'evals', values.eval);
  const { definition, prompt } = await loadEval(directory);
  if (values['max-turns']) definition.limits.maxTurns = Number(values['max-turns']);
  if (values['max-seconds']) definition.limits.maxWallMs = Number(values['max-seconds']) * 1000;
  const models = values.models ? values.models.split(',').map(s => parseModelSpec(s.trim(), values.provider)) : [{ provider: values.provider, name: values.model, effort: values.effort, web: false }];
  if (!models.length || models.some(m => !['claude-cli','codex-cli'].includes(m.provider) || !m.name || !m.effort || m.web)) throw new Error('Pin a provider, model, and effort for each sealed run');
  const trials = Number(values.trials);
  if (!Number.isSafeInteger(trials) || trials < 1) throw new Error('--trials must be a positive integer');
  const pricing = JSON.parse(await readFile(values.pricing ? resolve(values.pricing) : join(root, 'packages/runner/src/pricing.json'), 'utf8'));
  const score = definition.assessment.type === 'numeric' && definition.format !== 'controller' ? (await import(pathToFileURL(join(directory, 'scorer.js')))).score : undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    for (const model of models) {
      for (let trial = 1; trial <= trials && !controller.signal.aborted; trial++) {
        console.log(`${definition.id}: ${model.provider}:${model.name}@${model.effort}, trial ${trial}`);
        const adapter = definition.format === 'controller' ? await (await import(pathToFileURL(join(directory, 'src/adapter.js')))).createAdapter({ directory }) : undefined;
        const result = await runEval({ adapter, root, directory, definition, prompt, provider: model.provider, model: model.name, effort: model.effort, trial, pricing, score, signal: controller.signal });
        console.log(`${result.record.status} · ${result.record.turns.harness} turns · ${(result.record.wallMs / 1000).toFixed(1)}s\n${result.directory}`);
        if (result.record.status !== 'submitted') process.exitCode = 1;
      }
    }
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
