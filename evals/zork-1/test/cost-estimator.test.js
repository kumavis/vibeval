import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateAttemptUsage,
  aggregateScoringUsage,
  attemptEndEvents,
  estimateOpenAiApiCost,
} from '../src/cost-estimator.js';

test('estimates uncached, cached, cache-write, and output token cost', () => {
  const estimate = estimateOpenAiApiCost('gpt-5.6-sol', {
    inputTokens: 1_000_000,
    cacheReadTokens: 750_000,
    cacheWriteTokens: 100_000,
    outputTokens: 50_000,
    thinkingTokens: 40_000,
  });

  // 150K uncached * $4/M + 750K cached * $0.40/M
  // + 100K cache writes * $5/M + 50K output * $20/M.
  assert.equal(estimate.totalUsd, 2.4);
  assert.equal(estimate.tokens.uncachedInput, 150_000);
  assert.equal(estimate.breakdownUsd.output, 1);
  assert.match(estimate.formula, /uncachedInput/);
  assert.equal(estimate.assumptions.reasoningIncludedInOutput, true);
  assert.equal(estimate.assumptions.longContextSurchargeIncluded, false);
});

test('returns null for a model without an explicit price', () => {
  assert.equal(estimateOpenAiApiCost('unknown-model', {}), null);
});

test('estimates GPT-6 Astra at its published token prices', () => {
  const estimate = estimateOpenAiApiCost('gpt-6-astra', {
    inputTokens: 1_000_000,
    cacheReadTokens: 750_000,
    outputTokens: 50_000,
  });

  // 250K uncached * $10/M + 750K cached * $1/M
  // + 50K output * $50/M.
  assert.equal(estimate.totalUsd, 5.75);
  assert.deepEqual(estimate.usdPerMillionTokens, {
    input: 10,
    cachedInput: 1,
    cacheWrite: 12.5,
    output: 50,
  });
});

test('sums one usage record per interrupted attempt', () => {
  const events = [
    { type: 'run_start' },
    {
      type: 'run_end',
      usage: { turns: 2, inputTokens: 100, costUsd: 1 },
    },
    // Duplicate signal cleanup for the already-ended attempt is ignored.
    {
      type: 'run_end',
      usage: { turns: 2, inputTokens: 100, costUsd: 1 },
    },
    { type: 'run_resume' },
    {
      type: 'run_end',
      usage: { turns: 3, inputTokens: 200, costUsd: 2 },
    },
  ];

  assert.equal(attemptEndEvents(events).length, 2);
  assert.deepEqual(aggregateAttemptUsage(events), {
    turns: 5,
    inputTokens: 300,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    thinkingTokens: 0,
    costUsd: 3,
  });
});

test('drops estimated usage for turns removed from the scoring transcript', () => {
  const events = [
    { type: 'run_start' },
    { type: 'model_turn' },
    { type: 'model_turn' },
    // The repaired transcript has only two of the four recorded turns.
    {
      type: 'run_end',
      usage: {
        turns: 4,
        inputTokens: 400,
        outputTokens: 40,
        cacheReadTokens: 200,
        thinkingTokens: 20,
        costUsd: 2,
      },
    },
    { type: 'run_resume' },
    { type: 'model_turn' },
    {
      type: 'run_end',
      usage: {
        turns: 1,
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 50,
        thinkingTokens: 5,
        costUsd: 1,
      },
    },
    { type: 'log_compaction', droppedModelTurns: 2 },
  ];

  assert.deepEqual(aggregateScoringUsage(events), {
    turns: 3,
    recordedTurns: 5,
    discardedTurns: 2,
    inputTokens: 300,
    outputTokens: 30,
    cacheReadTokens: 150,
    cacheWriteTokens: 0,
    thinkingTokens: 15,
    costUsd: 2,
  });
});

test('combines explicit crash-recovery estimates with reported usage', () => {
  const events = [
    { type: 'run_start', t: 0 },
    { type: 'model_turn', t: 1 },
    { type: 'model_turn', t: 2 },
    {
      type: 'usage_estimate',
      t: 2,
      usage: { turns: 2, outputTokens: 20, costUsd: 0.5 },
      method: { kind: 'pooled-peer-per-turn' },
      referenceRuns: ['peer-1.jsonl', 'peer-2.jsonl'],
      reason: 'hard crash',
    },
    { type: 'run_resume', t: 10 },
    { type: 'model_turn', t: 11 },
    {
      type: 'run_end',
      t: 12,
      usage: { turns: 1, outputTokens: 10, costUsd: 1 },
    },
    { type: 'log_compaction', droppedModelTurns: 1 },
  ];

  const usage = aggregateScoringUsage(events);
  assert.equal(usage.turns, 3);
  assert.equal(usage.outputTokens, 30);
  assert.equal(usage.costUsd, 1.5);
  assert.equal(usage.usageEstimated, true);
  assert.equal(usage.usageEstimates[0].retainedTurns, 2);
  assert.deepEqual(usage.usageEstimates[0].referenceRuns, [
    'peer-1.jsonl',
    'peer-2.jsonl',
  ]);
  assert.equal(usage.unaccountedAttempts, undefined);
});

test('flags a crash-ended attempt whose usage has not been doctored', () => {
  const usage = aggregateScoringUsage([
    { type: 'run_start', t: 0 },
    { type: 'model_turn', t: 1 },
    { type: 'run_resume', t: 10 },
    { type: 'model_turn', t: 11 },
    { type: 'run_end', t: 12, usage: { turns: 1, costUsd: 1 } },
  ]);

  assert.deepEqual(usage.unaccountedAttempts, [
    { startedAt: 0, endedAt: 1, retainedTurns: 1 },
  ]);
});

test('a +condition label prices as its base model', () => {
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 };
  const sealed = estimateOpenAiApiCost('gpt-5.6-luna', usage);
  const web = estimateOpenAiApiCost('gpt-5.6-luna+web', usage);
  // The experiment changes token counts, never token prices, so a labelled
  // run must not fall through to "no price known".
  assert.notEqual(web, null);
  assert.equal(web.totalUsd, sealed.totalUsd);
  assert.equal(web.model, 'gpt-5.6-luna');
});
