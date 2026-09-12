import { mkdir, writeFile, appendFile, cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createClaudeCliProvider } from './providers/claude-cli.js';
import { createCodexCliProvider } from './providers/codex-cli.js';
import { createOpenCodeCliProvider } from './providers/opencode-cli.js';
import { defineEval, submissionInstructions, validateScores, controllerActionSchema } from './formats.js';
import { createWorkspace, fileInventory } from './workspace.js';
import { provenance, cliVersion, estimateCost } from './metadata.js';

const factories = { 'claude-cli': createClaudeCliProvider, 'codex-cli': createCodexCliProvider, 'opencode-cli': createOpenCodeCliProvider };
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
function textCheck(content, definition) {
  const errors = [];
  if (typeof content !== 'string' || !content.trim()) errors.push('Content must be nonempty text');
  else {
    if (Buffer.byteLength(content) > definition.limits.maxArtifactBytes) errors.push('Artifact byte budget exceeded');
    if (definition.constraints?.asciiOnly && /[^\x20-\x7e\n\r\t]/.test(content)) errors.push('Only ASCII characters, spaces, tabs, and line breaks are allowed; no emojis');
  }
  return { valid: !errors.length, errors };
}

export async function runEval({ root, directory, definition: input, prompt, provider, model, effort, trial = 1, pricing = null, score,
  createProvider = factories[provider], harness, runtimeVersion, signal, adapter }) {
  const definition = defineEval(input);
  if (definition.format === 'environment') throw new Error('Environment evals use their own runner (for example, Zork)');
  if (!Object.hasOwn(factories, provider) || !createProvider) throw new Error('Use claude-cli, codex-cli, or opencode-cli');
  if (!model || !effort) throw new Error('Pin --model and --effort for recorded runs');
  if (!Number.isSafeInteger(trial) || trial < 1) throw new Error('Trial must be a positive integer');
  if (definition.assessment.type === 'numeric' && typeof score !== 'function' && !adapter) throw new Error('Numeric eval requires a score function');
  const instructions = submissionInstructions(definition);
  const singleChoice = definition.format === 'choice';
  const textArtifact = singleChoice || definition.format === 'text';
  // The per-request ceiling recorded in the run settings and handed to the
  // provider. Controller development and OpenCode's long artifact generations
  // get fifteen minutes; the other backends keep five.
  const requestTimeoutMs = definition.format === 'controller' || provider === 'opencode-cli' ? 900000 : 300000;
  const version = harness ?? await provenance(root, definition, prompt, instructions, directory);
  const cli = runtimeVersion ?? await cliVersion(provider);
  const id = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0,8)}`;
  const runDir = join(directory, 'runs', id);
  const workingDirectory = join(runDir, 'workspace');
  await mkdir(workingDirectory, { recursive: true });
  const workspace = createWorkspace(workingDirectory, definition.limits);
  const started = Date.now();
  const record = { schemaVersion: 1, id, evalId: definition.id, trial, format: definition.format, assessment: definition.assessment,
    status: 'running', prompt, instructions, harness: version,
    model: { provider, requested: model, resolved: null, resolutionBasis: 'not-reported', cliVersion: cli },
    settings: { budgetPolicy: 'turns-primary', structuredActions: definition.format === 'controller' && provider === 'codex-cli', providerRequestTimeoutMs: requestTimeoutMs, effort, thinkingBudget: null, thinkingBudgetBasis: 'CLI/model default; no explicit token budget', webSearch: false, tools: singleChoice ? [] : definition.format === 'controller' ? ['write_file','read_file','test','inspect_episode','submit'] : definition.format === 'files' ? ['write_file','read_file','list_files','check','submit'] : ['draft','submit'], limits: definition.limits },
    startedAt: new Date(started).toISOString(), finishedAt: null, wallMs: 0,
    turns: { harness: 0, drafts: 0, submissions: 0, providerRequests: 0, retries: 0, modelTurns: null },
    validation: null, metrics: null, artifact: null, usage: null, cost: null };
  await writeJson(join(runDir, 'run.json'), record);
  const eventsFile = join(runDir, 'events.jsonl');
  const event = value => appendFile(eventsFile, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
  let agent;
  const deadline = started + definition.limits.maxWallMs;
  async function bounded(fn) {
    let timer;
    let onAbort;
    try {
      return await Promise.race([Promise.resolve().then(() => {
        if (signal?.aborted) throw new Error('Run interrupted');
        return fn();
      }), new Promise((_, reject) => {
        const stop = reason => { agent?.dispose(); reject(new Error(reason)); };
        timer = setTimeout(() => stop('Wall clock budget exhausted'), Math.max(0, deadline - Date.now()));
        onAbort = () => stop('Run interrupted');
        signal?.addEventListener('abort', onAbort, { once: true });
      })]);
    } finally { clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); }
  }
  let observation = singleChoice ? prompt : `${prompt}\n\nBegin your work. Submit only when you are satisfied.`;
  try {
    agent = createProvider({ systemPrompt: instructions, responseFormat: 'text', model, effort, webSearch: false, deadline, retryOnFailure: !singleChoice, turnTimeoutMs: requestTimeoutMs, ...(definition.format === 'controller' && provider === 'codex-cli' ? { outputSchema: controllerActionSchema } : {}) });
    await event({ type: 'start', evalId: definition.id });
    for (let turn = 1; turn <= definition.limits.maxTurns; turn++) {
      if (Date.now() >= deadline) { record.status = 'time_limit'; break; }
      record.turns.harness = turn;
      const budget = { primary: 'responses', response: turn, responsesRemainingIncludingThis: definition.limits.maxTurns - turn + 1,
        responsesAfterThis: definition.limits.maxTurns - turn, fallbackSecondsRemaining: Math.max(0, Math.floor((deadline - Date.now()) / 1000)),
        ...(adapter?.budget?.() ?? {}) };
      const requestObservation = singleChoice ? prompt : `${observation}\n\nBUDGET: ${JSON.stringify(budget)}\n${turn === definition.limits.maxTurns ? 'LAST RESPONSE: explicitly submit your best valid work now.' : 'Reserve one response for explicit final submission. Use null for unused structured-action fields.'}`;
      await event({ type: 'observation', turn, budget, content: requestObservation });
      const raw = await bounded(() => agent.requestText([requestObservation]));
      await event({ type: 'response', turn, content: raw });
      let feedback;
      try {
        if (typeof raw !== 'string' || Buffer.byteLength(raw) > definition.limits.maxArtifactBytes * 2 + 10000) throw new Error('Response exceeds budget');
        if (singleChoice) { record.response = raw; record.choice = definition.choices.find(c => c.toLowerCase() === raw.trim().toLowerCase()) ?? null; }
        const action = singleChoice ? { action: 'submit', content: raw } : JSON.parse(raw);
        if (!action || Array.isArray(action) || typeof action !== 'object') throw new Error('Expected one JSON action object');
        let candidate = null;
        if (definition.format === 'controller') {
          if (!adapter) throw new Error('Controller eval requires an adapter');
          const handled = await bounded(() => adapter.handle(action, { workspace, workingDirectory, runDir, record }));
          feedback = handled.feedback; candidate = handled.candidate ?? null;
        } else if (textArtifact && ['draft', 'submit'].includes(action.action)) {
          feedback = textCheck(action.content, definition);
          if (singleChoice && !record.choice) feedback = { valid: false, errors: ['Response must contain exactly one declared choice'] };
          if (singleChoice) record.validation = feedback;
          if (action.action === 'draft') {
            record.turns.drafts++;
            if (feedback.valid) await writeFile(join(runDir, 'draft.txt'), action.content);
          } else {
            record.turns.submissions++;
            if (feedback.valid) candidate = { content: action.content, note: action.note ?? null };
          }
        } else if (definition.format === 'files') {
          switch (action.action) {
            case 'write_file': feedback = await workspace.write(action.path, action.content); record.turns.drafts++; break;
            case 'read_file': feedback = { content: await workspace.read(action.path) }; break;
            case 'list_files': feedback = { files: await workspace.list() }; break;
            case 'check': feedback = await workspace.check(); break;
            case 'submit':
              record.turns.submissions++;
              feedback = await workspace.check();
              if (feedback.valid) candidate = { directory: workingDirectory, note: action.note ?? null };
              break;
            default: throw new Error('Unknown file action');
          }
        } else throw new Error('Use draft or submit with complete text content');
        if (signal?.aborted) throw new Error('Run interrupted');
        if (Date.now() >= deadline) throw new Error('Wall clock budget exhausted');
        if (candidate) {
          if (!adapter) record.metrics = validateScores(definition.assessment, score ? await bounded(() => score({ ...candidate, definition, prompt })) : null);
          const artifactDir = join(runDir, 'artifact');
          await mkdir(artifactDir);
          if (textArtifact) await writeFile(join(artifactDir, 'result.txt'), candidate.content);
          else await cp(workingDirectory, artifactDir, { recursive: true });
          record.artifact = { type: definition.format === 'controller' ? 'controller' : textArtifact ? 'text' : 'website', entry: definition.format === 'controller' ? 'controller.js' : textArtifact ? 'result.txt' : 'index.html', note: candidate.note,
            files: await Promise.all((await fileInventory(artifactDir)).map(async f => {
              return { ...f, sha256: createHash('sha256').update(await readFile(join(artifactDir, f.path))).digest('hex') };
            })) };
          record.validation = feedback;
          record.status = 'submitted';
          await event({ type: 'submitted', turn, artifact: record.artifact, metrics: record.metrics });
          break;
        }
      } catch (error) {
        if (signal?.aborted || Date.now() >= deadline) throw error;
        feedback = { valid: false, errors: [error.message] };
      }
      await event({ type: 'feedback', turn, feedback });
      observation = `${JSON.stringify(feedback)}\nReview and improve your work, or explicitly submit when satisfied. ${definition.limits.maxTurns - turn} responses remain. Drafts are not final submissions.`;
      await writeJson(join(runDir, 'run.json'), record);
    }
    if (record.status === 'running') record.status = 'turn_limit';
    // Final controller scoring happens after freezing and outside the feedback loop.
    if (record.status === 'submitted' && adapter) {
      const final = await adapter.finalize({ runDir, record });
      record.metrics = validateScores(definition.assessment, final.metrics);
      record.evaluation = final.evaluation;
      await event({ type: 'scored', metrics: record.metrics });
    }
  } catch (error) {
    record.status = signal?.aborted ? 'interrupted' : Date.now() >= deadline ? 'time_limit' : 'failed';
    record.error = error.message;
    await event({ type: 'error', error: error.message });
  } finally {
    agent?.dispose();
    record.usage = agent?.stats() ?? {};
    record.usage.completeness = record.status === 'submitted' || record.status === 'turn_limit' ? 'reported-completed-requests' : 'may-exclude-unreported-in-flight-usage';
    record.turns.providerRequests = record.usage.requests ?? record.usage.turns ?? 0;
    record.turns.retries = record.usage.retries ?? 0;
    // Provider turns are protocol requests, not hidden internal model calls.
    // Keep the latter unknown unless the provider explicitly reports them.
    record.turns.modelTurns = null;
    record.model.resolved = record.usage.resolvedModel ?? null;
    record.model.resolutionBasis = record.model.resolved ? 'provider-reported' : 'not-reported';
    try { record.cost = estimateCost({ provider, model: record.model.resolved ?? model, usage: record.usage, pricing }); }
    catch (error) { record.cost = { usd: null, basis: 'unavailable', reason: error.message }; }
    if (record.usage.completeness !== 'reported-completed-requests') record.cost.usageCompleteness = record.usage.completeness;
    record.finishedAt = new Date().toISOString();
    record.wallMs = Date.now() - started;
    await event({ type: 'end', status: record.status, wallMs: record.wallMs });
    await writeJson(join(runDir, 'run.json'), record);
  }
  return { record, directory: runDir };
}
