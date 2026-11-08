import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { claudeEvidence } from './complete.js';
export const hash = value => createHash('sha256').update(value).digest('hex');
const empty = v => v == null || (Array.isArray(v) && !v.length);
export function auditRequest(request, protocol, probeId) {
  return ['tools','plugins','web_search_options','functions'].every(k => empty(request[k])) &&
    request.messages?.length === 2 && request.messages[0].content === protocol.system &&
    request.messages[1].role === 'user' && request.messages[1].content === protocol.probes.find(p => p.id === probeId)?.prompt;
}
export function auditEvents(text) {
  const events = text.trim().split('\n').map(line => JSON.parse(line));
  const allowedEvents = new Set(['thread.started','turn.started','turn.completed','item.started','item.updated','item.completed']);
  const allowedItems = new Set(['agent_message','reasoning','plan']);
  const violations = events.filter(e => !allowedEvents.has(e.type) || (e.item && !(allowedItems.has(e.item.type) ||
    (e.item.type === 'error' && e.item.message?.startsWith('Codex is ignoring ') && e.item.message.includes('features.skills')))));
  return { passed: violations.length === 0 && events.some(e => e.type === 'turn.completed'), eventCount: events.length,
    configurationWarningCount: events.filter(e => e.item?.type === 'error').length,
    violations: violations.map(e => e.item?.type || e.type) };
}
export function auditApi(raw) {
  const messages = raw.choices?.map(c => c.message) ?? [];
  const webCounts = [raw.usage?.server_tool_use?.web_search_requests, raw.usage?.server_tool_use?.web_fetch_requests, raw.usage?.web_search_requests];
  return webCounts.every(n=>n==null || n===0) && messages.length > 0 && messages.every(m => m && ['tool_calls','function_call','annotations'].every(k => empty(m[k]))) &&
    ['tools','plugins','web_search_results','citations','annotations'].every(k => empty(raw[k]));
}
export async function audit(root, output) {
  const index = JSON.parse(await readFile(join(root,'data/public/results.json'),'utf8'));
  const rows = [], snapshots = [];
  for (const file of index.batches) {
    const b = JSON.parse(await readFile(join(root,'data/public',file),'utf8'));
    const dir = join(root,'runs',b.id), source = await readFile(join(dir,'runner.js'),'utf8');
    const sourceVerified = hash(source) === b.runnerSha256;
    snapshots.push({ batchId: b.id, sourceVerified, sha256: hash(source) });
    for (const r of b.responses.filter(r => r.status === 'completed' && r.content?.trim())) {
      const codex = r.provider === 'codex-cli';
      const raw = await readFile(join(dir,`${r.id}.${codex ? 'jsonl' : 'json'}`),'utf8');
      // API runner hashes parsed JSON; Codex runner hashes exact JSONL bytes.
      const claude = r.provider === 'claude-cli';
      const receipt = claude ? claudeEvidence(JSON.parse(raw)) : null;
      const rawVerified = hash(codex ? raw : JSON.stringify(JSON.parse(raw))) === r.rawSha256;
      const contentVerified = claude ? receipt.content === r.content && receipt.model === r.resolvedModel : codex ? raw.trim().split("\n").map(line => JSON.parse(line)).filter(e => e.type === "item.completed" && e.item?.type === "agent_message").at(-1)?.item.text === r.content : (JSON.parse(raw).model === r.resolvedModel && JSON.parse(raw).choices?.[0]?.message.content === r.content);
      const requestVerified = auditRequest(r.request,b.protocol,r.probeId);
      const trace = claude ? { passed: receipt.passed && b.settings.identityContext?.startsWith('Empty per-call home') } : codex ? auditEvents(raw) : { passed: auditApi(JSON.parse(raw)) };
      const webDisabled = claude ? source.includes("'--tools',''") && source.includes("'--strict-mcp-config'") : !codex || source.includes("config('web_search', 'disabled')");
      rows.push({ id: r.id, batchId: b.id, transport: codex ? 'codex' : claude ? 'claude-code' : 'api', rawVerified, contentVerified, requestVerified, sourceVerified, webDisabled,
        ...trace, passed: rawVerified && contentVerified && requestVerified && sourceVerified && webDisabled && trace.passed });
    }
  }
  const result = { version: 'no-web-audit-v1', checkedAt: new Date().toISOString(), completedAnswers: rows.length,
    verifiedAnswers: rows.filter(r => r.passed).length, passed: rows.every(r => r.passed), snapshots,
    conclusion: 'No search tools requested or tool/search activity found in the saved traces. Codex disables web search. Claude Code reports an empty tool list and no server search or fetch calls. API responses contain no tool calls or citation annotations.',
    limitation: 'This checks saved requests, hashed runner snapshots and response traces; it cannot independently observe hidden provider-side behavior. Reviewer source research was performed afterwards and was not given to models.', responses: rows };
  if (output) await writeFile(output,JSON.stringify(result,null,2)+'\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await audit(resolve(process.argv[2] || new URL('..',import.meta.url).pathname),process.argv[3]);
  console.log(JSON.stringify({ completed:result.completedAnswers, verified:result.verifiedAnswers, passed:result.passed, failures:result.responses.filter(r=>!r.passed) },null,2));
  if (!result.passed) process.exitCode = 1;
}
