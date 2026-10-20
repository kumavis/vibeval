import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { comparisonMatrix } from '../src/batch.js';

test('published comparison contains only the matched LEAP scenario, consistent budgets and attributable transcripts', async () => {
  const base = new URL('../data/public/', import.meta.url);
  const data = JSON.parse(await readFile(new URL('results.json', base), 'utf8'));
  assert.equal(data.schemaVersion, 3);
  assert.equal(data.scenario.id, 'leap-wave9-ai-catastrophe-2050');
  assert.equal(data.scenario.mortalityFraction, 0.1);
  assert.equal(data.scenario.thresholdOperator, '>');
  assert.equal(data.batch.maxSeconds, 1800);
  assert.equal(data.batch.maxRounds, 3);
  const key = j => `${j.model}/${j.effort}/${j.trial}`;
  const scheduled = new Set(data.batch.jobs.map(key));
  for (const job of comparisonMatrix()) assert.ok(scheduled.has(key(job)), 'The original comparison must remain present');
  assert.equal(scheduled.size, data.batch.jobs.length);
  const completed = data.batch.jobs.filter(j => j.runId);
  assert.equal(data.runs.length, completed.length);
  assert.equal(new Set(data.runs.map(r => r.id)).size, data.runs.length);
  for (const run of data.runs) {
    const job = completed.find(j => j.runId === run.id);
    assert.ok(job, 'Every published run must belong to a scheduled attempt');
    for (const key of ['model', 'effort', 'trial', 'status']) assert.equal(run[key], job[key]);
    assert.equal(run.protocol, 'doom-leap-v3');
    assert.equal(run.batchId, data.batch.id);
    assert.equal(run.asOf, data.batch.createdAt);
    assert.deepEqual(run.event, data.scenario);
    assert.equal(run.limits.maxSeconds, data.batch.maxSeconds);
    assert.equal(run.limits.maxRounds, data.batch.maxRounds);
    assert.equal(createHash('sha256').update(run.prompt).digest('hex'), data.batch.promptSha256);
    assert.equal(run.promptSha256, data.batch.promptSha256);
    assert.equal(run.transcript, `${run.id}/transcript.json`);
    const transcript = JSON.parse(await readFile(new URL(run.transcript, base), 'utf8'));
    assert.equal(transcript.id, run.id);
    assert.ok(transcript.messages.some(m => m.role === 'user'));
    if (run.status === 'submitted') {
      assert.ok(transcript.messages.some(m => m.role === 'assistant'));
      const p = run.inference.pDoom, { low, high } = run.inference.scenarioBounds;
      assert.ok(0 <= low && low <= p && p <= high && high <= 1);
      assert.equal(run.inference.queries.p_doom, p);
      const actual = createHash('sha256').update(JSON.stringify({ submission: run.submission, inference: run.inference })).digest('hex');
      assert.equal(actual, run.artifactSha256);
    } else assert.equal(run.submission, undefined);
  }
});
