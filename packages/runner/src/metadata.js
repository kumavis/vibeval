import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile);
export const HARNESS_VERSION = 'submission-v2';

export async function provenance(root, definition, prompt, instructions, evalDirectory) {
  const hash = createHash('sha256');
  async function add(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await add(path);
      else if (item.isFile()) { hash.update(path.slice(root.length)); hash.update(await readFile(path)); }
    }
  }
  await add(join(root, 'packages/runner/src'));
  hash.update(await readFile(join(root, 'package-lock.json')));
  const sourceSha256 = hash.digest('hex');
  const evalHash = createHash('sha256').update(JSON.stringify(definition)).update(prompt);
  // Include eval-owned scoring/runner code, including uncommitted changes.
  // Data, outputs, viewers, and local credentials are not executable harness inputs.
  async function addEval(directory, prefix = '') {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('.') || ['data','runs','logs','viewer','node_modules'].includes(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) await addEval(path, prefix + item.name + '/');
      else if (item.isFile()) { evalHash.update(prefix + item.name); evalHash.update(await readFile(path)); }
    }
  }
  if (evalDirectory) await addEval(evalDirectory);
  let commit = null, dirty = null;
  try {
    commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    dirty = Boolean((await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim());
  } catch { /* Exported source trees still have an exact content hash. */ }
  return { version: HARNESS_VERSION, commit, dirty, sourceSha256,
    evalSha256: evalHash.digest('hex'),
    instructionsSha256: createHash('sha256').update(instructions).digest('hex'), nodeVersion: process.version };
}

const CLI_COMMANDS = { 'claude-cli': 'claude', 'codex-cli': 'codex', 'opencode-cli': 'opencode' };

export async function cliVersion(provider) {
  const command = CLI_COMMANDS[provider];
  if (!command) return null;
  try { return (await exec(command, ['--version'], { timeout: 10000 })).stdout.trim(); }
  catch { return null; }
}

// A caller-supplied, versioned pricing snapshot takes precedence. Otherwise
// the CLI's reported price is retained. Missing pricing stays null, never $0.
export function estimateCost({ provider, model, usage, pricing }) {
  if (usage.costReported && Number.isFinite(usage.costUsd)) return { usd: usage.costUsd, basis: 'cli-reported-api-equivalent', currency: 'USD', subscriptionCharge: false };
  const rates = pricing?.models?.[model];
  if (!rates) return { usd: null, basis: 'unavailable', reason: 'No CLI-reported cost or exact-model pricing snapshot', currency: 'USD' };
  if (!pricing.asOf || !pricing.source || ['input', 'cachedInput', 'cacheWrite', 'output'].some(k => !Number.isFinite(rates[k]) || rates[k] < 0)) throw new Error('Pricing needs asOf, source, and nonnegative per-million rates');
  const input = usage.inputTokens ?? 0, cached = usage.cacheReadTokens ?? 0, writes = usage.cacheWriteTokens ?? 0, output = usage.outputTokens ?? 0;
  // Codex reports total input including cache reads/writes; Claude and
  // OpenCode already report uncached input separately.
  const uncached = provider === 'codex-cli' ? input - cached - writes : input;
  if ([uncached, cached, writes, output].some(n => !Number.isFinite(n) || n < 0)) return { usd: null, basis: 'unavailable', reason: 'Invalid or inconsistent token counts' };
  return { usd: (uncached * rates.input + cached * rates.cachedInput + writes * rates.cacheWrite + output * rates.output) / 1e6,
    basis: 'api-equivalent-estimate', currency: 'USD', subscriptionCharge: false, model,
    formula: '(uncachedInput * inputRate + cacheRead * cachedInputRate + cacheWrite * cacheWriteRate + output * outputRate) / 1000000',
    pricing: { asOf: pricing.asOf, source: pricing.source, rates },
    assumptions: ['Reasoning tokens are included in output, not billed twice', 'No tier or long-context surcharge', 'Not subscription spend'] };
}
