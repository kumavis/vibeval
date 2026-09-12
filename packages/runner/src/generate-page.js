import { createClaudeCliProvider } from './providers/claude-cli.js';
import { createCodexCliProvider } from './providers/codex-cli.js';
import { createOpenCodeCliProvider } from './providers/opencode-cli.js';

// Returns the artifact to the eval; choosing paths and publishing it are
// intentionally the eval's responsibility. No model call occurs on import.
export async function generatePage({ provider, prompt }) {
  const factories = { 'claude-cli': createClaudeCliProvider, 'codex-cli': createCodexCliProvider, 'opencode-cli': createOpenCodeCliProvider };
  const factory = factories[provider];
  if (!Object.hasOwn(factories, provider)) throw new Error('Page generation requires claude-cli, codex-cli, or opencode-cli');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A shared prompt is required');
  const agent = factory({
    systemPrompt: 'Create a complete standalone HTML document with inline CSS and JavaScript. Return only HTML, without Markdown fences. Do not use external assets, dependencies, or network requests.',
    responseFormat: 'text',
  });
  try {
    const raw = await agent.requestText([prompt]);
    const html = raw.trim().replace(/^```(?:html)?\s*\n/i, '').replace(/\n```\s*$/, '');
    if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) throw new Error('Model did not return a complete HTML document');
    return { html, model: agent.model, provider, prompt, usage: agent.stats() };
  } finally { agent.dispose(); }
}
