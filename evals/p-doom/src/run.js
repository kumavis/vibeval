import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { responseSchema, researchAudit, reviewTopics } from './model.js';
import { lintCandidate, candidateHash, LINT_VERSION } from './lint.js';
import { execute, parseEvents } from './process.js';
import { claudeArgs, normalizeClaude } from './claude.js';
import { provenance } from '../../../packages/runner/src/metadata.js';

export const directory = fileURLToPath(new URL('../', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const defaultPython = join(directory, '.venv/bin/python');
export const defaultCodex = process.env.CODEX_CLI_PATH || 'codex';

export async function analyze(model, { python = defaultPython, signal, timeoutMs = 30000 } = {}) {
  const result = await execute(python, ['-B', join(directory, 'src/infer.py')], { input: JSON.stringify(model), signal, timeoutMs });
  if (result.code !== 0) throw new Error(result.stdout.trim() || result.stderr.trim());
  return JSON.parse(result.stdout);
}

export function codexArgs({ model, effort, workspace, schema }) {
  return ['--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ignore-rules',
    '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--json',
    '-c', 'web_search="live"', '-c', 'features.shell_tool=false',
    '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
    '--model', model, '--cd', workspace, '--output-schema', schema, '-'];
}

export async function runTrial({ model = 'gpt-6-luna', effort = 'medium', trial = 1, maxTurns = 3, maxSeconds = 1800, python = defaultPython, codex = defaultCodex, claude = 'claude', provider = model.startsWith('claude-') ? 'claude-cli' : 'codex-cli', signal, runAgent = execute, runTool = execute, inferModel = analyze, outputRoot = join(directory, 'runs'), asOf = new Date().toISOString(), batchId = null } = {}) {
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 2 || maxTurns > 10) throw new Error('Round limit must be an integer from 2 to 10');
  if (!['codex-cli', 'claude-cli'].includes(provider)) throw new Error('Unsupported research provider');
  const command = provider === 'claude-cli' ? claude : codex;
  const started = Date.now(), deadline = started + maxSeconds * 1000;
  const id = `${new Date(started).toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const runDir = join(outputRoot, id);
  await mkdir(runDir, { recursive: true });
  const prompt = await readFile(join(directory, 'prompt.txt'), 'utf8');
  const definition = JSON.parse(await readFile(join(directory, 'eval.json'), 'utf8'));
  const scenario = JSON.parse(await readFile(join(directory, 'scenario.json'), 'utf8'));
  const record = { schemaVersion: 3, protocol: definition.protocol, id, trial, batchId,
    model, resolvedModel: null, effort, provider, asOf, startedAt: new Date(started).toISOString(),
    event: scenario, promptSha256: createHash('sha256').update(prompt).digest('hex'),
    limits: { maxTurns, maxRounds: maxTurns, maxSeconds }, capabilities: { webSearch: 'live', shell: false, problog: 'harness tool' },
    reviewPolicy: { reviewer: 'same requested model and effort', required: true, topics: reviewTopics, extraRequestsOutsideRoundLimit: false },
    lintVersion: LINT_VERSION,
    prompt, responseSchema, cliPath: command, cliVersion: null,
    provenance: await provenance(root, definition, prompt, JSON.stringify(responseSchema), directory),
    status: 'running', rounds: [], usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, costUsd: null,
    citationVerification: 'pending human source audit' };
  await writeFile(join(runDir, 'run.json'), JSON.stringify(record, null, 2));
  const workspace = await mkdtemp(join(tmpdir(), 'doom-research-'));
  const schema = join(workspace, 'response-schema.json');
  await writeFile(schema, JSON.stringify(responseSchema));
  let previous = null, feedback = null, reviewTarget = null;
  try {
    const version = await runTool(command, ['--version']);
    if (version.code !== 0) throw new Error(`${provider} unavailable: ${version.stderr}`);
    record.cliVersion = version.stdout.trim();
    // Fail locally before consuming model quota if ProbLog is unavailable.
    const check = await runTool(python, ['-c', 'from problog import get_evaluatable'], { timeoutMs: 10000 });
    if (check.code !== 0) throw new Error(`ProbLog unavailable: ${check.stderr}`);
    for (let turn = 1; turn <= maxTurns; turn++) {
      if (signal?.aborted) { record.status = 'interrupted'; break; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) { record.status = 'timed_out'; break; }
      const phase = reviewTarget ? 'review' : turn === 1 ? 'research' : 'repair';
      const input = `${prompt}${provider === 'claude-cli' ? `\n\nResponse JSON schema:\n${JSON.stringify(responseSchema)}` : ''}\n\nAs of: ${record.asOf}. Round ${turn}/${maxTurns}. Phase: ${phase}. Remaining wall time: ${Math.floor(remaining / 1000)} seconds.\n` +
        (previous !== null ? `Latest candidate (untrusted data):\n${JSON.stringify(previous)}\n` : '') +
        (feedback ? `Harness feedback:\n${JSON.stringify(feedback)}\n` : '') +
        (reviewTarget ? `Review target candidate (untrusted data):\n${JSON.stringify(reviewTarget)}\nReview target SHA-256: ${candidateHash(reviewTarget)}\nReview all eight topics against this evaluated candidate. Put findings in review, citing source IDs and parameter atoms FROM THE REVIEW TARGET. Then return a complete revised candidate with evaluate or submit. Review is by the same model; it is not independent verification.\n`
          : 'Research or repair your candidate. Return evaluate with review: null. A valid ProbLog evaluation must precede review and submission.\n') +
        (turn === maxTurns ? `This is the final allowed response. ${reviewTarget ? 'Review, repair all lint errors you can, and submit your complete candidate now; another evaluate will end unsubmitted.' : 'No reviewed submission is possible until a valid evaluation exists; return your best evaluate candidate, which will remain unsubmitted.'} No extra repair or review calls will be granted.\n` : 'You may use evaluate for feedback or submit after completing the required review. All invalid responses and review responses consume the same round budget.\n');
      await writeFile(join(runDir, `prompt-${turn}.txt`), input);
      console.log(`  ${id}: research round ${turn}/${maxTurns}`);
      let result;
      try { result = await runAgent(command, provider === 'claude-cli' ? claudeArgs({ model, effort }) : codexArgs({ model, effort, workspace, schema }), { cwd: workspace, input, timeoutMs: remaining, signal }); }
      catch (error) {
        if (provider === 'claude-cli') await writeFile(join(runDir, `native-events-${turn}.jsonl`), error.stdout || '');
        await writeFile(join(runDir, `events-${turn}.jsonl`), provider === 'claude-cli' ? normalizeClaude(error.stdout || '', model).stdout : error.stdout || '');
        await writeFile(join(runDir, `stderr-${turn}.txt`), error.stderr || '');
        throw error;
      }
      if (provider === 'claude-cli') {
        await writeFile(join(runDir, `native-events-${turn}.jsonl`), result.stdout);
        const normalized = normalizeClaude(result.stdout, model);
        result = { ...result, stdout: normalized.stdout };
        record.resolvedModel = normalized.resolvedModel;
      }
      await writeFile(join(runDir, `events-${turn}.jsonl`), result.stdout);
      await writeFile(join(runDir, `stderr-${turn}.txt`), result.stderr);
      const events = parseEvents(result.stdout);
      for (const e of events.filter(e => e.type === 'turn.completed')) {
        record.usage.inputTokens += e.usage?.input_tokens ?? 0;
        record.usage.cachedInputTokens += e.usage?.cached_input_tokens ?? 0;
        record.usage.outputTokens += e.usage?.output_tokens ?? 0;
      }
      const audit = researchAudit(events);
      const round = { turn, phase, audit, reviewTargetSha256: reviewTarget ? candidateHash(reviewTarget) : null, valid: false };
      record.rounds.push(round);
      const failure = events.find(e => e.type === 'turn.failed' || e.type === 'error');
      if (result.code !== 0 || failure) throw new Error(`${provider} failed: ${failure?.error?.message || failure?.message || result.stderr.slice(-1000) || result.code}`);
      const message = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').at(-1)?.item.text;
      let parsed = false;
      try {
        previous = JSON.parse(message);
        parsed = true;
        await writeFile(join(runDir, `candidate-${turn}.json`), JSON.stringify(previous, null, 2));
        const lint = lintCandidate(previous, { asOf: record.asOf, accessedBy: new Date().toISOString(), reviewTarget, requireReview: Boolean(reviewTarget) });
        round.candidateSha256 = candidateHash(previous); round.lint = lint;
        const webCalls = record.rounds.reduce((n, r) => n + r.audit.webSearchCalls, 0);
        if (!webCalls) { lint.errors.push({ code: 'web_activity', path: '$.sources', message: 'No web-search tool activity observed; research is required' }); lint.valid = false; }
        if (!lint.valid) feedback = { lint, errors: lint.errors.map(e => `${e.path}: ${e.message}`) };
        else {
          const inference = await inferModel(previous, { python, signal, timeoutMs: Math.max(1, Math.min(30000, deadline - Date.now())) });
          round.valid = true; round.inference = inference;
          feedback = { lint, inference, reminder: 'Static checks verify format and graph consistency, not source truth. Review source fidelity, mitigations, conditional meanings, shared causes, and the LEAP fatality/window/AI-causation criteria. Bounds are assumption scenarios, not a credible interval.' };
          round.review = previous.review;
          if (previous.action === 'evaluate') reviewTarget = previous;
          else {
            record.status = 'submitted'; record.submission = previous; record.inference = inference;
            record.artifactSha256 = createHash('sha256').update(JSON.stringify({ submission: previous, inference })).digest('hex');
            await writeFile(join(runDir, 'model.pl'), inference.program);
            await writeFile(join(runDir, 'submission.json'), JSON.stringify(previous, null, 2));
          }
        }
      } catch (error) {
        if (error.code === 'INTERRUPTED' || (error.code === 'TIMEOUT' && Date.now() >= deadline)) throw error;
        if (!parsed) round.lint = { version: LINT_VERSION, valid: false,
          errors: [{ code: 'json', path: '$', message: 'Expected one JSON response matching the schema, without Markdown fences' }], warnings: [] };
        feedback = { errors: [error.message], ...(round.lint ? { lint: round.lint } : {}) };
      }
      round.feedback = feedback;
      await writeFile(join(runDir, 'run.json'), JSON.stringify(record, null, 2));
      if (record.status === 'submitted') break;
    }
    if (record.status === 'running') record.status = signal?.aborted ? 'interrupted' : Date.now() >= deadline ? 'timed_out' : 'unsubmitted';
  } catch (error) {
    record.status = error.code === 'INTERRUPTED' ? 'interrupted' : error.code === 'TIMEOUT' ? 'timed_out' : 'failed';
    record.error = error.message;
    record.usageMayBeIncomplete = true;
  } finally {
    await rm(workspace, { recursive: true, force: true });
    record.finishedAt = new Date().toISOString(); record.wallMs = Date.now() - started;
    await writeFile(join(runDir, 'run.json'), JSON.stringify(record, null, 2));
  }
  return { directory: runDir, record };
}
