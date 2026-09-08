import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estimateUnprobedMoves,
  parseScoreProbe,
  probeScore,
} from '../src/score-probe.js';

const identity = (value) => value;

function stats(overrides = {}) {
  return {
    commands: 0,
    parserRejections: 0,
    score: null,
    maxScore: null,
    moves: null,
    movesBeforeRestarts: 0,
    totalMoves: 0,
    commandsAtLastScoreChange: 0,
    maxCommandsWithoutScore: 0,
    commandsAtLastProbe: 0,
    parserRejectionsAtLastProbe: 0,
    scoreProbeFailures: 0,
    ...overrides,
  };
}

test('parses the plural and the singular move count', () => {
  assert.deepEqual(
    parseScoreProbe('Your score is 45 (total of 350 points), in 78 moves.'),
    { score: 45, moves: 78 },
  );
  // Zork writes "1 move", so a strict /moves/ misses every run's first probe.
  assert.deepEqual(
    parseScoreProbe('Your score is 0 (total of 350 points), in 1 move.'),
    { score: 0, moves: 1 },
  );
});

test('the Loud Room echo is not a score reading', () => {
  assert.equal(parseScoreProbe('score score ...'), null);
  assert.equal(parseScoreProbe(''), null);
});

test('an answered probe sets moves from the game and rebaselines', async () => {
  const runStats = stats({ commands: 12, parserRejections: 2 });
  const events = [];
  await probeScore(
    { input: async () => 'Your score is 10 (total of 350 points), in 11 moves.' },
    runStats,
    false,
    (type, payload) => events.push([type, payload]),
    identity,
  );
  assert.equal(runStats.moves, 11);
  assert.equal(runStats.totalMoves, 11);
  assert.equal(runStats.commandsAtLastProbe, 12);
  assert.equal(runStats.parserRejectionsAtLastProbe, 2);
  assert.equal(runStats.scoreProbeFailures, 0);
  assert.deepEqual(events[0][0], 'score');
});

test('an unanswered probe keeps the budget advancing instead of freezing', async () => {
  // The game answered at command 100 / move 90, then went quiet (Loud Room).
  const runStats = stats({
    commands: 100,
    parserRejections: 5,
    moves: 90,
    score: 50,
    commandsAtLastProbe: 100,
    parserRejectionsAtLastProbe: 5,
  });
  const echo = { input: async () => 'score score ...' };
  const events = [];
  const log = (type, payload) => events.push([type, payload]);

  // Ten more commands, one of them rejected by the parser (no move spent).
  runStats.commands = 110;
  runStats.parserRejections = 6;
  await probeScore(echo, runStats, false, log, identity);

  assert.equal(runStats.scoreProbeFailures, 1);
  // 90 known + (10 commands - 1 parser rejection) estimated.
  assert.equal(runStats.totalMoves, 99);
  assert.equal(events[0][0], 'score_probe_unanswered');

  // Still unanswered: the estimate keeps climbing, so a move budget still
  // ends the run rather than letting it play on unbounded.
  runStats.commands = 120;
  await probeScore(echo, runStats, false, log, identity);
  assert.equal(runStats.totalMoves, 109);
  assert.equal(runStats.scoreProbeFailures, 2);
  // The diagnostic is logged once, not once per turn.
  assert.equal(events.filter(([t]) => t === 'score_probe_unanswered').length, 1);

  // When the game answers again, its own counter wins outright.
  await probeScore(
    { input: async () => 'Your score is 50 (total of 350 points), in 104 moves.' },
    runStats,
    false,
    log,
    identity,
  );
  assert.equal(runStats.totalMoves, 104);
  assert.equal(runStats.commandsAtLastProbe, 120);
});

test('estimateUnprobedMoves never goes backwards', () => {
  assert.equal(
    estimateUnprobedMoves(
      stats({ commands: 5, parserRejections: 9, commandsAtLastProbe: 5, parserRejectionsAtLastProbe: 0 }),
    ),
    0,
  );
});

test('a restarted turn is not probed', async () => {
  const runStats = stats({ moves: 7, totalMoves: 7 });
  await probeScore(
    { input: async () => { throw new Error('should not be asked'); } },
    runStats,
    true,
    () => {},
    identity,
  );
  assert.equal(runStats.totalMoves, 7);
});
