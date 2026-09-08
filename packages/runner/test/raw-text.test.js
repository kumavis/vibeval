import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createClaudeCliProvider } from '../src/providers/claude-cli.js';
import { createCodexCliProvider } from '../src/providers/codex-cli.js';
import { generatePage } from '../src/generate-page.js';

process.env.PATH = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}:${process.env.PATH}`;
for (const factory of [createClaudeCliProvider, createCodexCliProvider]) {
  test(`${factory.name} exposes unparsed text without changing command support`, async t => {
    const provider = factory({ systemPrompt: 'Write a page.', responseFormat: 'text' });
    t.after(() => provider.dispose());
    const text = await provider.requestText(['Create HTML']);
    assert.equal(typeof text, 'string');
    assert.match(text, /received:Create HTML/);
    assert.match(text, /command_format:false/);
    assert.match(text, /COMMAND: LOOK/);
    assert.deepEqual((await provider.requestCommands(['Next'])).commands, ['LOOK']);
    assert.equal(provider.history().length, 4);
  });
}

for (const provider of ['claude-cli', 'codex-cli']) {
  test(`${provider} generates a complete page with recorded metadata`, async () => {
    const result = await generatePage({ provider, prompt: 'GENERATE_TEST_PAGE' });
    assert.equal(result.html, '<html><body>Test page</body></html>');
    assert.equal(result.provider, provider);
    assert.equal(result.prompt, 'GENERATE_TEST_PAGE');
    assert.equal(result.usage.turns, 1);
    await assert.rejects(generatePage({ provider, prompt: 'Not HTML' }), /complete HTML/);
  });
}
