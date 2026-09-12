import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

// Put the fake `opencode` fixture first on PATH before importing the provider.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
process.env.PATH = `${fixtures}:${process.env.PATH}`;
const { createOpenCodeCliProvider } = await import('../src/providers/opencode-cli.js');

test('carries the session across turns and replays the transcript after a failure', async (t) => {
  const provider = createOpenCodeCliProvider({ systemPrompt: 'You play Zork.' });
  t.after(() => provider.dispose());

  // First turn opens a session; nothing to resume yet.
  const turn1 = await provider.requestCommands(['West of House']);
  assert.deepEqual(turn1.commands, ['LOOK']);
  assert.match(turn1.commentary, /session:new/);
  assert.match(turn1.commentary, /received:West of House/);

  // Second turn resumes the session the first one opened.
  const turn2 = await provider.requestCommands(['There is a small mailbox here.']);
  assert.match(turn2.commentary, /session:ses-1/);

  // A failed turn drops the session and retries with the whole transcript
  // replayed into a fresh one (the replay is [Game]-labeled, so it does not
  // re-trigger the exact-match DIE).
  const turn3 = await provider.requestCommands(['DIE']);
  assert.deepEqual(turn3.commands, ['LOOK']);
  assert.match(turn3.commentary, /session:new/);
  assert.match(turn3.commentary, /received:\[Game\]/);

  // History committed exactly once per turn despite the internal retry.
  assert.equal(provider.history().filter((m) => m.role === 'user').length, 3);

  // Usage accumulated across the three successful exchanges; OpenCode prices
  // steps from list rates, so the positive cost is reported.
  const stats = provider.stats();
  assert.equal(stats.turns, 3);
  assert.equal(stats.inputTokens, 300);
  assert.equal(stats.outputTokens, 30);
  assert.equal(stats.cacheReadTokens, 150);
  assert.equal(stats.cacheWriteTokens, 15);
  assert.equal(stats.thinkingTokens, 12);
  assert.ok(Math.abs(stats.costUsd - 0.03) < 1e-9);
  assert.equal(stats.costReported, true);
});

test('runs the oracle agent with the model, variant, and every tool denied', async (t) => {
  const provider = createOpenCodeCliProvider({ systemPrompt: 'You play Zork.', model: 'openrouter/test-model', effort: 'medium' });
  t.after(() => provider.dispose());
  assert.equal(provider.model, 'openrouter/test-model');

  const turn = await provider.requestCommands(['West of House']);
  assert.match(turn.commentary, /agent:vibeval/);
  assert.match(turn.commentary, /model:openrouter\/test-model/);
  assert.match(turn.commentary, /variant:medium/);
  assert.match(turn.commentary, /pure:true/);
  assert.match(turn.commentary, /tools_denied:true/);
  assert.match(turn.commentary, /command_format:true/);
});

test('does not retry an elapsed request or a transport failure near the wall deadline', async t => {
  const p = createOpenCodeCliProvider({ systemPrompt: 'Test', turnTimeoutMs: 100 });
  t.after(() => p.dispose());
  await assert.rejects(p.requestText(['HANG']), /timed out/);
  assert.equal(p.stats().retries, 0);
  const q = createOpenCodeCliProvider({ systemPrompt: 'Test', deadline: Date.now() + 30000 });
  t.after(() => q.dispose());
  await assert.rejects(q.requestText(['DIE']), /simulated failure/);
  assert.equal(q.stats().retries, 0);
});
