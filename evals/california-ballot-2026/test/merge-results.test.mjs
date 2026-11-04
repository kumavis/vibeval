import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeResults} from '../src/merge-results.mjs';

const sample = (id, provider) => ({prompt: 'frozen', ballot: {scope: 'sample', electionDate: '2026-11-03'}, batch: {id, provider, models: [id]}, runs: [{id: `${id}-trial-1`, model: id, status: 'completed'}]});
test('merge preserves cohorts and refuses incompatible or duplicate attempts', () => {
  const a = sample('codex', 'codex-cli'), b = sample('grok', 'openrouter');
  b.continuation={policy:'Reserve unknown billing; never retry',existingRecordsUnchanged:true};
  b.progress={unknownAttemptCount:1,remainingUnattempted:0};
  const result = mergeResults([a,b]);
  assert.equal(result.batches.length, 2);
  assert.deepEqual(result.runs.map(r => r.provider), ['codex-cli','openrouter']);
  assert.equal(result.runs[1].batchId, 'grok');
  assert.deepEqual(result.cohortProvenance[1].continuation,b.continuation);
  assert.deepEqual(result.cohortProvenance[1].progress,b.progress);
  assert.throws(() => mergeResults([a,{...b,prompt:'changed'}]), /different prompts/);
  assert.throws(() => mergeResults([a,a]), /Duplicate/);
  assert.equal(a.runs[0].provider, undefined);
});

test('merge retains Claude Code provider and collection timing',()=>{
 const a=sample('codex','codex-cli'),b=sample('claude','claude-code');b.batch.collectionTimezone='America/Los_Angeles';
 const merged=mergeResults([a,b]);assert.equal(merged.runs[1].provider,'claude-code');assert.equal(merged.batches[1].collectionTimezone,'America/Los_Angeles');
});
