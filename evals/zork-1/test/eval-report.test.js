import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { activeTiming, reportDirectories } from '../src/eval-report.js';

// One completed run's event log, as the harness writes it.
function runLog({ model, provider, tag, score, costUsd, usage = {} }) {
  const events = [
    { type: 'run_start', t: 0, provider, model, tag, seed: 1, moveBudget: 10 },
    { type: 'score', t: 1, score },
    {
      type: 'run_end',
      t: 60_000,
      budgetReached: true,
      endReason: 'budget',
      runStats: {
        modelTurns: 10,
        commands: 10,
        totalMoves: 10,
        maxScore: score,
        parserRejections: 0,
        worldRefusals: 0,
        deaths: 0,
      },
      usage: {
        outputTokens: 100,
        costUsd,
        resolvedModel: model,
        ...usage,
      },
    },
  ];
  return events.map((e) => JSON.stringify(e)).join('\n');
}

test('reports several batch directories as one table', async () => {
  const a = await mkdtemp(join(tmpdir(), 'eval-a-'));
  const b = await mkdtemp(join(tmpdir(), 'eval-b-'));
  await writeFile(
    join(a, 'run-1-sonnet-t1.jsonl'),
    runLog({ model: 'sonnet', provider: 'claude-cli', tag: 'sonnet-t1', score: 80, costUsd: 2 }),
  );
  await writeFile(
    join(b, 'run-1-sol-t1.jsonl'),
    runLog({ model: 'sol', provider: 'codex-cli', tag: 'sol-t1', score: 60, costUsd: undefined }),
  );

  const { rows, aggregates } = await reportDirectories([a, b]);
  assert.deepEqual(
    rows.map((r) => r.tag),
    ['sonnet-t1', 'sol-t1'],
  );

  const byAlias = new Map(aggregates.map((agg) => [agg.alias, agg]));
  assert.equal(byAlias.get('sonnet').provider, 'claude-cli');
  assert.equal(byAlias.get('sonnet').meanCostUsd, 2);
  assert.equal(byAlias.get('sonnet').scorePerDollar, 40);

  // An unrecognized subscription model has no safe estimate: the money
  // columns stay null rather than reading as a free run.
  const codex = byAlias.get('sol');
  assert.equal(codex.provider, 'codex-cli');
  assert.equal(codex.meanCostUsd, null);
  assert.equal(codex.scorePerDollar, null);
  assert.equal(codex.medianScore, 60);
});

test('labels Codex subscription usage as an API-equivalent estimate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eval-openai-cost-'));
  await writeFile(
    join(dir, 'run-1-sol-t1.jsonl'),
    runLog({
      model: 'gpt-5.6-sol',
      provider: 'codex-cli',
      tag: 'gpt-5.6-sol-t1',
      score: 60,
      usage: {
        inputTokens: 1_000_000,
        cacheReadTokens: 750_000,
        outputTokens: 50_000,
      },
    }),
  );

  const { rows, aggregates } = await reportDirectories([dir]);
  assert.equal(rows[0].costUsd, 2.3);
  assert.equal(rows[0].costBasis, 'api-equivalent-estimate');
  assert.equal(aggregates[0].meanCostUsd, 2.3);
  assert.equal(aggregates[0].costBasis, 'api-equivalent-estimate');
});

test('counts a crash-ended attempt through its last event, not the resume gap', () => {
  assert.deepEqual(
    activeTiming([
      { type: 'run_start', t: 0 },
      { type: 'command', t: 100 },
      { type: 'run_resume', t: 1_000 },
      { type: 'run_end', t: 1_200 },
    ]),
    { ms: 300, interruptedAttempts: 1 },
  );
});

test('marks unaccounted attempt cost incomplete until it is doctored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eval-missing-usage-'));
  const events = [
    {
      type: 'run_start',
      t: 0,
      provider: 'claude-cli',
      model: 'model-1',
      tag: 'model-1-t1',
      seed: 1,
      moveBudget: 2,
    },
    { type: 'model_turn', t: 10 },
    { type: 'run_resume', t: 1_000 },
    { type: 'model_turn', t: 1_010 },
    {
      type: 'run_end',
      t: 1_020,
      budgetReached: true,
      runStats: {
        modelTurns: 2,
        commands: 2,
        totalMoves: 2,
        maxScore: 1,
        parserRejections: 0,
        worldRefusals: 0,
        deaths: 0,
      },
      usage: { turns: 1, outputTokens: 10, costUsd: 1 },
    },
  ];
  await writeFile(
    join(dir, 'run-model-1-t1.jsonl'),
    events.map((event) => JSON.stringify(event)).join('\n'),
  );

  const { rows, aggregates } = await reportDirectories([dir]);
  assert.equal(rows[0].costBasis, 'incomplete');
  assert.equal(rows[0].costUsd, 1);
  assert.equal(rows[0].usageAccounting.unaccountedAttempts.length, 1);
  assert.equal(rows[0].wallBasis, 'partial-attempt-last-event');
  assert.equal(aggregates[0].meanCostUsd, null);
  assert.equal(aggregates[0].scorePerDollar, null);
});
