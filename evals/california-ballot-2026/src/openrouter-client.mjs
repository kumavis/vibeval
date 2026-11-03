import { readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { responseSchema, isHttpUrl } from './schema.mjs';

export const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
export const documentation = [
  'https://openrouter.ai/docs/guides/features/server-tools',
  'https://openrouter.ai/docs/guides/features/server-tools/web-search',
  'https://openrouter.ai/docs/guides/features/server-tools/web-fetch',
  'https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion',
  'https://openrouter.ai/docs/cookbook/administration/usage-accounting',
];

export async function loadOpenRouterCredentials({ env = process.env, authPath = join(homedir(), '.local/share/opencode/auth.json') } = {}) {
  if (env.OPENROUTER_API_KEY?.trim()) return env.OPENROUTER_API_KEY.trim();
  let auth;
  try { auth = JSON.parse(await readFile(authPath, 'utf8')); }
  catch { throw new Error('OpenRouter credentials unavailable; use OPENROUTER_API_KEY or existing OpenCode auth'); }
  if (typeof auth.openrouter?.key !== 'string' || !auth.openrouter.key.trim()) throw new Error('No OpenRouter API key in existing OpenCode auth');
  return auth.openrouter.key.trim();
}

export function modelConfiguration(model) {
  const supported = model.supported_parameters ?? [];
  if (!supported.includes('tools')) throw new Error(`${model.id}: catalog does not advertise tool support`);
  if (!supported.includes('structured_outputs')) throw new Error(`${model.id}: catalog does not advertise structured output support`);
  const efforts = model.reasoning?.supported_efforts;
  const medium = supported.includes('reasoning') && (!Array.isArray(efforts) || efforts.includes('medium'));
  return { id: model.id, canonicalSlug: model.canonical_slug ?? null, pricing: model.pricing ?? null,
    supportedParameters: supported, reasoning: model.reasoning ?? null, contextLength: model.context_length ?? null,
    effort: medium ? 'medium' : 'provider-default', reasoningRequested: medium ? { effort: 'medium' } : null,
    outputFormat: 'json_schema', maxCompletionTokens: model.top_provider?.max_completion_tokens ?? null };
}

export function buildOpenRouterRequest({ model, prompt, limits }) {
  if (model.maxCompletionTokens && limits.maxTokens > model.maxCompletionTokens) throw new Error(`${model.id}: requested output cap exceeds catalog maximum`);
  const formatInstruction = 'Research the user’s ballot using the available web tools. Return one final JSON object and no progress commentary or Markdown. ' +
    'The final object must match the following JSON Schema exactly. Use exactly the property names and enum values shown; include every required field. ' +
    'In decisions, use sources (an array of source IDs), not sourceIds, and include status. In compass, confidence is low, medium, or high; use rationale and evidenceContestIds. ' +
    'Do not substitute different property names or numeric confidence. Source IDs must resolve to the top-level sources array. ' +
    'Use the supplied ballot options exactly. If evidence is insufficient, use the schema’s uncertainty fields instead of inventing evidence.\n\n' + JSON.stringify(responseSchema);
  return { model: model.id, messages: [{ role: 'system', content: formatInstruction }, { role: 'user', content: prompt }],
    stream: false, max_tokens: limits.maxTokens,
    ...(model.reasoningRequested ? { reasoning: model.reasoningRequested } : {}),
    provider: { require_parameters: true, allow_fallbacks: false },
    response_format: { type: 'json_schema', json_schema: { name: 'california_ballot_evaluation', strict: true, schema: responseSchema } },
    tools: [
      { type: 'openrouter:web_search', parameters: { engine: 'exa', mode: 'auto', max_uses: limits.maxSearches,
        max_results: 5, max_total_results: 60, max_characters: 3000 } },
      { type: 'openrouter:web_fetch', parameters: { engine: 'openrouter', max_uses: limits.maxFetches, max_content_tokens: 8000 } },
    ],
    stop_server_tools_when: [
      { type: 'step_count_is', step_count: limits.maxToolCalls },
      { type: 'max_cost', max_cost_in_dollars: limits.requestCostStopUsd },
    ],
  };
}

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function auditOpenRouter(response) {
  const detailed = response.usage?.server_tool_use_details;
  const toolUse = detailed ?? response.usage?.server_tool_use;
  const searches = count(toolUse?.web_search_requests);
  const fetches = count(toolUse?.web_fetch_requests);
  const annotations = (response.choices ?? []).flatMap(c => c.message?.annotations ?? [])
    .filter(a => a.type === 'url_citation' && isHttpUrl(a.url_citation?.url))
    .map(a => ({ url: a.url_citation.url, title: a.url_citation.title ?? null }));
  return { webSearchCalls: searches ?? 0, webFetchCalls: fetches,
    toolCallsRequested: count(toolUse?.tool_calls_requested), toolCallsExecuted: count(toolUse?.tool_calls_executed),
    searchUsageReported: searches !== null, fetchUsageReported: fetches !== null,
    usageField: detailed ? 'usage.server_tool_use_details' : toolUse ? 'usage.server_tool_use' : null,
    basis: 'OpenRouter API usage.server_tool_use_details or usage.server_tool_use; source citations alone do not establish a web call',
    searchEngineRequested: 'exa', fetchEngineRequested: 'openrouter', annotations,
    citationVerification: 'API-reported activity and citation format only; source truth and entailment unverified.' };
}

export function normalizeOpenRouterUsage(response) {
  const usage = response.usage ?? {};
  return { inputTokens: count(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: count(usage.completion_tokens ?? usage.output_tokens),
    cachedInputTokens: count(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens),
    reasoningTokens: count(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens),
    costUsd: amount(usage.cost), costSource: amount(usage.cost) === null ? 'unreported' : 'OpenRouter usage.cost',
    serverToolUse: usage.server_tool_use_details ?? usage.server_tool_use ?? null };
}

// Locate the single final object without changing its bytes, field names, or choices.
// Reverse scanning begins at the required final closing brace, so arbitrary quotes
// in preceding prose cannot change JSON string state inside the actual object.
export function extractFinalResponse(content) {
  if (typeof content !== 'string') throw new Error('Assistant content is not text');
  const end = content.trimEnd().length;
  if (!end || content[end - 1] !== '}') throw new Error('Assistant content does not end with a JSON object');
  const stack = []; let quoted = false, start = -1;
  for (let i = end - 1; i >= 0; i--) {
    const char = content[i];
    if (char === '"') {
      let slashes = 0; for (let j = i - 1; j >= 0 && content[j] === '\\'; j--) slashes++;
      if (slashes % 2 === 0) quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === '}' || char === ']') stack.push(char);
    if (char === '{' || char === '[') {
      if (stack.pop() !== (char === '{' ? '}' : ']')) throw new Error('Unbalanced trailing JSON object');
      if (!stack.length) { start = i; break; }
    }
  }
  if (start < 0 || quoted || stack.length || content[start] !== '{') throw new Error('No complete trailing JSON object');
  const response = JSON.parse(content.slice(start, end));
  const prefix = content.slice(0, start);
  // Reject a prior complete response object rather than silently choosing among
  // multiple submissions. Incidental braces in ordinary commentary are allowed.
  for (let begin = 0; begin < prefix.length; begin++) {
    if (prefix[begin] !== '{') continue;
    let depth = 0, inString = false, escaped = false;
    for (let at = begin; at < prefix.length; at++) {
      const char = prefix[at];
      if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
      if (char === '"') { inString = true; continue; }
      if (char === '{') depth++;
      if (char === '}' && --depth === 0) {
        try {
          const earlier = JSON.parse(prefix.slice(begin, at + 1));
          if (Object.hasOwn(earlier, 'overallSummary') || Object.hasOwn(earlier, 'decisions')) throw Object.assign(new Error('Multiple response objects; refusing to select one'), { code: 'AMBIGUOUS_RESPONSE' });
        } catch (error) { if (error.code === 'AMBIGUOUS_RESPONSE') throw error; }
        break;
      }
    }
  }
  return { response, publicCommentary: prefix.trim() || null,
    protocolWarnings: prefix.trim() ? ['Assistant included public commentary before its final JSON object; prefix preserved separately and no response fields were repaired.'] : [],
    parseMethod: prefix.trim() ? 'balanced_trailing_object' : 'single_json_object' };
}

// One HTTP request, with no retry, no redirect, and no logged Authorization header.
// Non-streaming server-tool responses may not yield body bytes until research finishes.
export async function callOpenRouter({ body, apiKey, maxSeconds, signal, rawPath, fetchImpl = fetch }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? new Error('Interrupted'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Deadline exceeded')); }, maxSeconds * 1000);
  let text = '', status = null;
  try {
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal });
    status = response.status;
    const decoder = new TextDecoder(); let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 40000000) { controller.abort(); throw new Error('HTTP response exceeds 40 MB limit'); }
      const part = decoder.decode(chunk, { stream: true }); text += part;
      if (rawPath) await appendFile(rawPath, part, { mode: 0o600 });
    }
    const tail = decoder.decode(); text += tail;
    if (tail && rawPath) await appendFile(rawPath, tail, { mode: 0o600 });
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error(`OpenRouter returned non-JSON HTTP ${status}`); }
    return { status, ok: response.ok, parsed };
  } catch (error) {
    // Provider error bodies stay in private raw storage; public error categories are allowlisted.
    if (timedOut) throw Object.assign(new Error('OpenRouter request timed out; server billing may continue'), { code: 'TIMEOUT', httpStatus: status });
    if (signal?.aborted) throw Object.assign(new Error('OpenRouter request interrupted; server billing may continue'), { code: 'INTERRUPTED', httpStatus: status });
    throw Object.assign(new Error(String(error.message).split(apiKey).join('[redacted]')), { code: 'TRANSPORT', httpStatus: status });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
