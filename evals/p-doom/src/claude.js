import { parseEvents } from './process.js';

export function claudeArgs({ model, effort }) {
  return ['--safe-mode', '--strict-mcp-config', '--setting-sources', '',
    '--no-session-persistence', '--tools', 'WebSearch,WebFetch',
    '--allowedTools', 'WebSearch,WebFetch', '--permission-mode', 'dontAsk',
    '--model', model, '--effort', effort, '--print', '--verbose',
    '--output-format', 'stream-json'];
}

// Normalize only public text and completed web actions. Preserve the untouched
// native trace locally; never copy thinking blocks or retrieved page bodies.
export function normalizeClaude(stdout, requestedModel) {
  const native = parseEvents(stdout), events = [], pending = new Map(), completed = new Set();
  const primaryModels = new Set();
  let resolvedModel = null;
  for (const event of native) {
    if (event.type === 'system' && event.subtype === 'init') resolvedModel = event.model ?? null;
    if (event.type === 'assistant' && !event.parent_tool_use_id) {
      if (event.message?.model) primaryModels.add(event.message.model);
      for (const block of event.message?.content ?? []) {
        if (block.type === 'text') events.push({ type: 'item.completed', item: { type: 'agent_message', text: block.text } });
        if (block.type === 'tool_use' && ['WebSearch', 'WebFetch'].includes(block.name)) pending.set(block.id, block);
      }
    }
    if (event.type === 'user' && !event.parent_tool_use_id) {
      for (const block of event.message?.content ?? []) {
        const tool = pending.get(block.tool_use_id);
        if (block.type !== 'tool_result' || !tool || block.is_error || completed.has(block.tool_use_id)) continue;
        completed.add(block.tool_use_id);
        events.push({ type: 'item.completed', item: { type: 'web_search', action: {
          type: tool.name === 'WebSearch' ? 'search' : 'open', ...tool.input,
        } } });
      }
    }
    if (event.type === 'result') {
      if (event.structured_output !== undefined) events.push({ type: 'item.completed', item: {
        type: 'agent_message', text: JSON.stringify(event.structured_output), source: 'native_structured_output',
      } });
      else if (event.result && events.at(-1)?.item?.text !== event.result) events.push({ type: 'item.completed', item: { type: 'agent_message', text: event.result } });
      const usage = event.usage ?? {};
      events.push({ type: 'turn.completed', usage: {
        input_tokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        cached_input_tokens: usage.cache_read_input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0,
      } });
      if (event.is_error || event.subtype !== 'success') events.push({ type: 'turn.failed', error: {
        message: event.errors?.join('\n') || event.result || `Claude ${event.subtype}`,
      } });
    }
  }
  if ((resolvedModel && resolvedModel !== requestedModel) || [...primaryModels].some(model => model !== requestedModel)) {
    events.push({ type: 'turn.failed', error: { message: `Requested ${requestedModel}; provider used ${[resolvedModel, ...primaryModels].filter(Boolean).join(', ')}` } });
  }
  return { stdout: events.map(event => JSON.stringify(event)).join('\n') + '\n', resolvedModel: [...primaryModels].at(-1) || resolvedModel };
}
