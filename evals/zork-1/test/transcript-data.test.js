import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptData } from '../src/transcript-data.js';
import { nearestCommand, stepPath } from '../viewer/timeline.js';

test('score observations align to commands, carry forward, and preserve score drops', () => {
  const result = transcriptData([
    { type: 'run_start', t: 1000 },
    { type: 'command', t: 2000, command: 'LOOK' },
    { type: 'score', t: 2001, score: 10 },
    { type: 'command', t: 3000, command: 'NORTH' },
    { type: 'command', t: 4000, command: 'RESTART' },
    { type: 'score', t: 4001, score: 0 },
  ]);
  assert.deepEqual(result.commands.map(c => c.score), [10, 10, 0]);
  assert.deepEqual(result.commands.map(c => c.scoreObserved), [true, false, true]);
  assert.deepEqual(result.samples.map(s => s.command), [1, 3]);
  assert.equal(stepPath(result.samples, n => n, n => n, 4000), 'M1000,10H3000V0H4000');
});
test('scrubbing finds nearest chronological command and excludes resume downtime', () => {
  const result = transcriptData([
    { type: 'run_start', t: 1000 }, { type: 'command', t: 2000, command: 'LOOK' },
    { type: 'run_end', t: 2500 }, { type: 'run_resume', t: 100000 },
    { type: 'command', t: 101000, command: 'NORTH' },
  ]);
  assert.deepEqual(result.commands.map(c => c.activeMs), [1000, 2500]);
  assert.equal(nearestCommand(result.commands, 2200), 1);
  assert.equal(nearestCommand(result.commands, 0), 0);
  assert.equal(nearestCommand(result.commands, 999999), 1);
  assert.equal(nearestCommand([], 100), -1);
  assert.equal(nearestCommand([{ activeMs: 10 }, { activeMs: 10 }, { activeMs: 20 }], 10), 1);
  assert.equal(result.commands[0].score, null);
});
