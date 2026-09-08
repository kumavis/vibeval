import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completedRun,
  renderScoreSvg,
  scorePoints,
} from '../src/eval-score-svg.js';

const completed = (
  tag,
  score,
  budgetReached = true,
  provider = 'codex-cli',
) => [
  {
    type: 'run_start',
    t: 0,
    provider,
    model: tag,
    tag,
    moveBudget: 300,
  },
  { type: 'score', t: 1, score: 10, moves: 20 },
  { type: 'score', t: 2, score, moves: 100 },
  {
    type: 'run_end',
    t: 3,
    budgetReached,
    runStats: { totalMoves: 300, score, maxScore: score },
  },
];

test('renders all completed runs as lines in one comparable SVG', () => {
  const svg = renderScoreSvg([
    {
      events: completed('haiku-t1', 25, true, 'claude-cli'),
      sourceName: 'haiku.jsonl',
    },
    {
      events: completed('opus-t2', 80, true, 'claude-cli'),
      sourceName: 'opus.jsonl',
    },
  ]);
  assert.match(svg, /^<svg /);
  assert.match(svg, /Zork score progression — all completed runs/);
  assert.match(svg, /2 runs · 300 game moves/);
  assert.match(svg, /y-axis maximum 100/);
  assert.match(svg, /Claude Haiku 4.5 · t1/);
  assert.match(svg, /Claude Opus 5 · t2/);
  assert.match(svg, />25 \/ 25</);
  assert.match(svg, />80 \/ 80</);
  assert.match(svg, /Anthropic · strongest → lightest/);
  assert.ok(
    svg.indexOf('Claude Opus 5 · t2') <
      svg.indexOf('Claude Haiku 4.5 · t1'),
  );
  assert.equal(svg.match(/class="score-line /g)?.length, 2);
  assert.match(svg, /Game moves/);
  assert.match(svg, /Score \(points\)/);
});

test('recognizes legacy completed runs from their move count', () => {
  const legacy = completed('legacy-t1', 25);
  delete legacy.at(-1).budgetReached;
  assert.notEqual(completedRun(legacy), null);
  legacy.at(-1).runStats.totalMoves = 299;
  assert.equal(completedRun(legacy), null);
});

test('keeps score points on a cumulative move axis after a restart', () => {
  const events = [
    { type: 'score', moves: 80, score: 30 },
    {
      type: 'command',
      response: 'Your score is 30, in 100 moves. You have died.',
    },
    { type: 'game_restart' },
    { type: 'score', moves: 5, score: 10 },
  ];
  assert.deepEqual(scorePoints(events), [
    { moves: 80, score: 30 },
    { moves: 105, score: 10 },
  ]);
});

test('a +condition run is labelled and drawn apart from its sealed twin', () => {
  const svg = renderScoreSvg([
    { events: completed('gpt-5.6-terra-t1', 55), sourceName: 'sealed.jsonl' },
    { events: completed('gpt-5.6-terra+web-t1', 92), sourceName: 'web.jsonl' },
  ]);

  // Same model, same trial: without the condition the two would be one
  // indistinguishable pair of lines, quietly mixing two experiments.
  assert.match(svg, /GPT-5\.6 Terra · t1 \+web/);
  assert.match(svg, />GPT-5\.6 Terra · t1</);
  // The web run is dashed; the sealed one is not.
  const paths = svg.match(/<path class="score-line[^"]*"/g) ?? [];
  assert.equal(paths.length, 2);
  assert.equal(paths.filter((p) => p.includes('conditioned')).length, 1);
});

test('labels Astra and orders it before the other OpenAI models', () => {
  const svg = renderScoreSvg([
    { events: completed('gpt-5.6-sol-t1', 115), sourceName: 'sol.jsonl' },
    { events: completed('gpt-6-astra-t1', 185), sourceName: 'astra.jsonl' },
  ]);

  assert.match(svg, /GPT-6 Astra · t1/);
  assert.ok(svg.indexOf('GPT-6 Astra · t1') < svg.indexOf('GPT-5.6 Sol · t1'));
  assert.match(svg, /family-astra/);
  assert.match(svg, /y-axis maximum 200/);
});

test('labels Fable by version and orders it between Opus and Sonnet', () => {
  const svg = renderScoreSvg([
    {
      events: completed('claude-sonnet-5-t1', 100, true, 'claude-cli'),
      sourceName: 'sonnet.jsonl',
    },
    {
      events: completed('claude-fable-5-1-t1', 200, true, 'claude-cli'),
      sourceName: 'fable.jsonl',
    },
    {
      events: completed('claude-opus-5-t1', 150, true, 'claude-cli'),
      sourceName: 'opus.jsonl',
    },
  ]);

  assert.match(svg, /Claude Fable 5\.1 · t1/);
  assert.match(svg, /family-fable/);
  assert.ok(
    svg.indexOf('Claude Fable 5.1 · t1') <
      svg.indexOf('Claude Opus 5 · t1'),
  );
  assert.ok(
    svg.indexOf('Claude Opus 5 · t1') <
      svg.indexOf('Claude Sonnet 5 · t1'),
  );
});
