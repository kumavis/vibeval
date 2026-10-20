import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { directory, runTrial, defaultPython, defaultCodex } from './run.js';
import { execute } from './process.js';
import { lintCandidate } from './lint.js';

const { values } = parseArgs({ options: {
  model: { type: 'string', default: 'gpt-6-luna' }, effort: { type: 'string', default: 'medium' },
  trials: { type: 'string', default: '1' }, 'max-turns': { type: 'string' }, 'max-rounds': { type: 'string' },
  'max-seconds': { type: 'string', default: '1800' }, python: { type: 'string', default: defaultPython },
  codex: { type: 'string', default: defaultCodex }, claude: { type: 'string', default: 'claude' },
  'tool-trial': { type: 'boolean' }, help: { type: 'boolean' },
  lint: { type: 'string' }, previous: { type: 'string' }, 'as-of': { type: 'string' },
} });
if (values.help) {
  console.log('npm run eval:doom -- --tool-trial\nnpm run eval:doom -- --model gpt-6-luna --effort medium --trials 1 --max-rounds 3\nnpm run eval:doom -- --lint candidate.json [--previous evaluated-candidate.json] [--as-of ISO_TIMESTAMP]\nOptions: --max-rounds 3 (--max-turns is an alias), --max-seconds 1800 --python PATH --codex PATH --claude PATH. Claude model IDs use the authenticated Claude CLI. Invalid responses and same-model review share the round budget. Lint is offline; runs remain local.');
} else if (values.lint) {
  let report;
  try {
    const candidate = JSON.parse(await readFile(values.lint, 'utf8'));
    const reviewTarget = values.previous ? JSON.parse(await readFile(values.previous, 'utf8')) : null;
    report = lintCandidate(candidate, { asOf: values['as-of'] || new Date().toISOString(), reviewTarget, requireReview: Boolean(reviewTarget) });
  } catch (error) { report = { valid: false, errors: [{ code: 'input', path: '$', message: error.message }], warnings: [] }; }
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
} else if (values['tool-trial']) {
  const result = await execute(values.python, ['-B', join(directory, 'src/problog_trial.py')]);
  console.log(result.stdout || result.stderr);
  if (result.code !== 0) process.exitCode = 1;
  else {
    await mkdir(join(directory, 'runs'), { recursive: true });
    await writeFile(join(directory, 'runs/tool-trial.json'), result.stdout);
  }
} else {
  if (values['max-turns'] && values['max-rounds']) throw new Error('Use either --max-rounds or --max-turns, not both');
  const trials = Number(values.trials), maxTurns = Number(values['max-rounds'] ?? values['max-turns'] ?? '3'), maxSeconds = Number(values['max-seconds']);
  if (!Number.isSafeInteger(trials) || trials < 1 || trials > 100) throw new Error('--trials must be an integer from 1 to 100');
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 2 || maxTurns > 10) throw new Error('--max-rounds must be an integer from 2 to 10');
  if (!Number.isSafeInteger(maxSeconds) || maxSeconds < 10 || maxSeconds > 7200) throw new Error('--max-seconds must be an integer from 10 to 7200');
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(values.effort)) throw new Error('Unknown reasoning effort');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    for (let trial = 1; trial <= trials && !controller.signal.aborted; trial++) {
      const result = await runTrial({ model: values.model, effort: values.effort, trial, maxTurns, maxSeconds, python: values.python, codex: values.codex, claude: values.claude, signal: controller.signal });
      console.log(`${result.record.status}${result.record.inference ? ` · p(doom) ${(100 * result.record.inference.pDoom).toFixed(3)}%` : ''}\n${result.directory}`);
      if (result.record.error) console.error(result.record.error);
      if (result.record.status !== 'submitted') process.exitCode = 1;
    }
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
