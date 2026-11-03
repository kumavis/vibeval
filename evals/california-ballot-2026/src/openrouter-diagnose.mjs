import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extractFinalResponse, auditOpenRouter, normalizeOpenRouterUsage } from './openrouter-client.mjs';
import { validateResponse } from './schema.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
// Offline only. Never mutates the original run, frozen batch, raw output or harness.
export async function diagnoseOpenRouterRun(runDirectory, outputPath) {
  const runDir = resolve(runDirectory), batchDir = resolve(runDir, '../..'), output = resolve(outputPath);
  const rel = relative(batchDir, output);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('Diagnostic output must be outside the original batch');
  const [rawText, recordText, ballotText] = await Promise.all([
    readFile(join(runDir, 'api-response.json'), 'utf8'), readFile(join(runDir, 'run.json'), 'utf8'),
    readFile(join(batchDir, 'inputs/ballot.json'), 'utf8'),
  ]);
  const raw = JSON.parse(rawText), record = JSON.parse(recordText), ballot = JSON.parse(ballotText);
  const audit = auditOpenRouter(raw), usage = normalizeOpenRouterUsage(raw);
  let parsed = { response: null, publicCommentary: null, protocolWarnings: [], parseMethod: null }, validation;
  try {
    parsed = extractFinalResponse(raw.choices?.[0]?.message?.content);
    validation = validateResponse(parsed.response, ballot, audit);
  } catch (error) { validation = { valid: false, errors: [error.message] }; }
  const diagnostic = { schemaVersion: 1, kind: 'openrouter-pilot-diagnostic', includedInComparison: false,
    processedAt: new Date().toISOString(), provider: 'openrouter', model: record.model, requestedModel: record.requestedModel,
    resolvedModel: raw.model ?? null, servingProvider: raw.provider ?? null, trial: record.trial, batchId: record.batchId,
    originalStatus: record.status, originalValidation: record.validation, originalHashes: record.hashes,
    sourceHashes: { apiResponse: hash(rawText), originalRun: hash(recordText), ballot: hash(ballotText) },
    processingHashes: { client: hash(await readFile(new URL('./openrouter-client.mjs', import.meta.url))),
      schema: hash(await readFile(new URL('./schema.mjs', import.meta.url))),
      diagnostic: hash(await readFile(fileURLToPath(import.meta.url))) },
    status: validation.valid ? 'completed' : 'invalid', validation, ...parsed, webAudit: audit, usage, costUsd: usage.costUsd,
    explanation: 'Offline interpretation of existing public assistant content and API usage counters. No model retry, response field normalization, or change to the original batch. This extra protocol-v1 pilot is excluded from the comparison.' };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(diagnostic, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return diagnostic;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--run' || args[2] !== '--output') { console.error('Usage: node src/openrouter-diagnose.mjs --run PATH --output PATH'); process.exitCode = 1; }
  else diagnoseOpenRouterRun(args[1], args[3]).then(d => console.log(JSON.stringify({ status: d.status,
    webSearchCalls: d.webAudit.webSearchCalls, toolCallsExecuted: d.webAudit.toolCallsExecuted,
    costUsd: d.costUsd, validationErrors: d.validation.errors.length, originalBatchUnchanged: true })))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
