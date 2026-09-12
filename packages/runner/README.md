# Shared runner

For new evals, use the common `runEval()` lifecycle from `@vibeval/runner/evaluate.js` with a definition validated by `defineEval()` from `@vibeval/runner/formats.js`. It supports iterative text and file submissions with numeric or subjective assessment. See [the format contract](../../docs/eval-formats.md) and the root `npm run eval` CLI. `generatePage()` below remains a legacy one-shot helper; it does not implement the submission lifecycle.

Extracted from `kumavis/llm-plays-zork`. The CLI process lifecycle, session replay, usage accounting, and sealed defaults are retained. Zork's command prompt remains unchanged by default.

```js
import { createAgent } from '@vibeval/runner';
const agent = createAgent({ systemPrompt: 'Your command-driven eval instructions' });
try {
  const { commands, commentary } = await agent.requestCommands(['Environment observation']);
  // Execute commands in your eval, then return observations on the next turn.
  console.log(commands, commentary, agent.stats());
} finally {
  agent.dispose();
}
```

`LLM_PROVIDER` selects `claude-cli`, `codex-cli`, `opencode-cli`, `anthropic`, or `openai`. See the Zork `.env.example` for model/auth environment variables. CLI backends use existing CLI login; tests use fake executables and local HTTP servers.

The copied command adapters still contain Zork-oriented tool descriptions. They are suitable for the migrated eval; a different command environment should supply its own protocol adapter. Process/session infrastructure belongs here, scoring and environment behavior belong in the eval.

For creative evals, CLI providers also expose `requestText(observations)` and accept `responseFormat: 'text'` to omit the command-format appendix. `requestCommands()` remains the compatibility adapter over raw text. Sessions are sequential, not safe for concurrent turns on one instance.

```js
import { generatePage } from '@vibeval/runner/generate-page.js';
const result = await generatePage({ provider: 'codex-cli', prompt: sharedPrompt });
// Save result.html in your eval's data/public/<run>/index.html.
// Retain result.prompt, model, provider, and usage with the run metadata.
```

This helper requests a self-contained page from a text-only CLI session. It does not offer filesystem tools or run a coding/build loop. Use the exact same prompt and pinned model settings for each comparison. Model calls happen only when you explicitly run an eval or this helper.
