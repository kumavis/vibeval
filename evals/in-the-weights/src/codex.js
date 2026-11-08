import { readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { directory } from './run.js';
const hash = value => createHash('sha256').update(value).digest('hex');
async function save(path, data) { const temp = `${path}.tmp`; await writeFile(temp, JSON.stringify(data, null, 2) + '\n'); await rename(temp, path); }
export function codexArgs({ model, effort, workspace, system }) {
  const config = (key, value) => ['-c', `${key}=${JSON.stringify(value)}`];
  return ['--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--json',
    ...config('web_search', 'disabled'), ...config('features.shell_tool', false), ...config('features.unified_exec', false),
    ...config('features.apps', false), ...config('features.memories', false), ...config('features.multi_agent', false),
    ...config('project_doc_max_bytes', 0), ...config('developer_instructions', system),
    ...config('model_reasoning_effort', effort), '--model', model, '--cd', workspace, '-'];
}
export function parseCodex(stdout, code) {
  const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const items = events.filter(e => e.type === 'item.completed').map(e => e.item);
  const warnings = items.filter(i => i?.type === 'error' && i.message?.startsWith('Codex is ignoring '));
  const forbidden = items.filter(i => !['agent_message','reasoning','plan','error'].includes(i?.type));
  const content = items.filter(i => i?.type === 'agent_message').at(-1)?.text ?? '';
  const completed = events.find(e => e.type === 'turn.completed');
  const error = events.find(e => e.type === 'turn.failed' || e.type === 'error') || items.find(i => i?.type === 'error' && !warnings.includes(i));
  return { status: forbidden.length ? 'tool-use-violation' : code !== 0 || error ? 'provider-error' : completed && content.trim() ? 'completed' : 'invalid-response',
    content, resolvedModel: null, resolvedModelNote: 'Codex JSONL does not attest the resolved serving model; requested ID retained.',
    usage: completed?.usage ?? null, toolAudit: { toolItems: forbidden.map(i => i.type), passed: forbidden.length === 0 }, configurationWarnings: warnings.map(i => i.message),
    finishReason: completed ? 'turn.completed' : null };
}
function execute(command, args, prompt, timeoutMs) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const child = spawn(command, args, { stdio: ['pipe','pipe','pipe'] });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000).unref(); }, timeoutMs);
    const done = code => { if (settled) return; settled = true; clearTimeout(timer); resolve({ stdout, stderr, code, timedOut }); };
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', e => { stderr += e.message; done(-1); }); child.on('close', done);
    child.stdin.on('error', () => {}); child.stdin.end(prompt);
  });
}
export async function runCodex({ models, trials = 3, effort = 'medium', timeoutMs = 180000, codex = process.env.CODEX_CLI_PATH || 'codex' }) {
  if (!models?.length || !Number.isSafeInteger(trials) || trials < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Models and positive trials/timeout required');
  const text = await readFile(join(directory, 'protocol.json'), 'utf8'), protocol = JSON.parse(text);
  const source = await readFile(fileURLToPath(import.meta.url));
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const runDir = join(directory, 'runs', id); await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'runner.js'), source);
  const batch = { id, protocol, protocolSha256: hash(text), runnerSha256: hash(source), nodeVersion: process.version,
    startedAt: new Date().toISOString(), status: 'running', transport: 'Codex CLI; fresh ephemeral conversation; tools and web search disabled',
    settings: { trials, effort, temperature: null, seedBase: null, maxTokens: null, timeoutMs, reasoning: effort, retries: 0,
      cliVersion: execFileSync(codex, ['--version'], { encoding: 'utf8' }).trim(), limitations: 'Codex adds its native instructions. Temperature, seed, and output token limit are provider defaults, unlike the API runs. Resolved serving model is unreported.' },
    inventory: models.map(id => ({ id, ownedBy: 'OpenAI', weightsFile: null })), responses: [] };
  await save(join(runDir, 'batch.json'), batch);
  for (const model of models) for (let trial = 1; trial <= trials; trial++) for (const probe of protocol.probes) {
    const workspace = await mkdtemp(join(tmpdir(), 'vibeval-recall-'));
    const args = codexArgs({ model, effort, workspace, system: protocol.system });
    const item = { id: randomUUID(), requestedModel: model, provider: 'codex-cli', trial, probeId: probe.id,
      request: { model, messages: [{ role: 'developer', content: protocol.system }, { role: 'user', content: probe.prompt }], effort },
      startedAt: new Date().toISOString(), status: 'running' };
    batch.responses.push(item); await save(join(runDir, 'batch.json'), batch);
    console.log(`START ${model} trial ${trial} ${probe.id}`);
    const start = performance.now();
    const raw = await execute(codex, args, probe.prompt, timeoutMs);
    await writeFile(join(runDir, `${item.id}.jsonl`), raw.stdout);
    await writeFile(join(runDir, `${item.id}.stderr.txt`), raw.stderr);
    Object.assign(item, parseCodex(raw.stdout, raw.code), { rawSha256: hash(raw.stdout), wallMs: Math.round(performance.now() - start), endedAt: new Date().toISOString() });
    if (raw.timedOut) item.status = 'timeout';
    await save(join(runDir, 'batch.json'), batch); await rm(workspace, { recursive: true, force: true });
    console.log(`END ${model} trial ${trial} ${probe.id}: ${item.status} (${(item.wallMs / 1000).toFixed(1)}s)`);
  }
  batch.status = batch.responses.every(r => r.status === 'completed') ? 'completed' : 'completed-with-errors'; batch.endedAt = new Date().toISOString();
  await save(join(runDir, 'batch.json'), batch); console.log(`Saved ${runDir}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { models: { type: 'string', default: 'gpt-6-luna,gpt-6.1-sol,gpt-6-astra' }, trials: { type: 'string', default: '3' }, effort: { type: 'string', default: 'medium' } } });
  await runCodex({ models: values.models.split(','), trials: Number(values.trials), effort: values.effort });
}
