import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUsageEstimateRepair } from '../src/doctor-missing-usage.js';

const completedPeer = (turns, outputTokens, costUsd, resolvedModel = 'model-1') => [
  {
    type: 'run_end',
    budgetReached: true,
    usage: { turns, outputTokens, costUsd, resolvedModel },
  },
];

test('doctors one missing attempt from pooled complete-peer rates', () => {
  const target = [
    { type: 'run_start', t: 0, model: 'model-1' },
    { type: 'model_turn', t: 5 },
    { type: 'command', t: 6 },
    { type: 'model_turn', t: 10 },
    { type: 'command', t: 11 },
    { type: 'run_resume', t: 100, model: 'model-1' },
    { type: 'model_turn', t: 105 },
    { type: 'run_end', t: 110, budgetReached: true, usage: { turns: 1 } },
  ];
  const { events, estimate } = buildUsageEstimateRepair(target, [
    { path: '/logs/peer-1.jsonl', events: completedPeer(2, 20, 1) },
    { path: '/logs/peer-2.jsonl', events: completedPeer(6, 120, 3) },
  ]);

  assert.equal(estimate.usage.turns, 2);
  assert.equal(estimate.usage.outputTokens, 35);
  assert.equal(estimate.usage.costUsd, 1);
  assert.equal(estimate.method.referenceTurns, 8);
  assert.deepEqual(estimate.referenceRuns, ['peer-1.jsonl', 'peer-2.jsonl']);
  assert.equal(events[5], estimate);
  assert.equal(events[6].type, 'run_resume');
});

test('refuses to doctor a log that no longer has missing usage', () => {
  assert.throws(
    () =>
      buildUsageEstimateRepair(
        [
          { type: 'run_start', t: 0, model: 'model-1' },
          { type: 'run_end', t: 1, budgetReached: true, usage: { turns: 1 } },
        ],
        [{ path: '/logs/peer.jsonl', events: completedPeer(1, 10, 1) }],
      ),
    /expected exactly one unaccounted attempt, found 0/,
  );
});
