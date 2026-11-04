import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from '../src/analyze.mjs';

test('Claude usage remains an estimate and missing attempt costs remain unknown',()=>{
  const runs=[
    {model:'claude-test',provider:'claude-code',status:'failed',costUsd:0.25,
      usage:{input_tokens:10,cache_creation_input_tokens:20,cache_read_input_tokens:30,output_tokens:40}},
    {model:'claude-test',provider:'claude-code',status:'failed',costUsd:null},
    {model:'other/test',provider:'openrouter',status:'failed',usageCost:0.5,usage:{inputTokens:7,outputTokens:8}},
  ];
  const [claude,other]=analyze({runs}).models;
  assert.equal(claude.reportedCostUsd,0.25);
  assert.equal(claude.costComplete,false);
  assert.match(claude.costBasis,/estimate/);
  assert.equal(claude.inputTokens,60);
  assert.equal(claude.outputTokens,40);
  assert.equal(other.reportedCostUsd,0.5);
  assert.equal(other.costComplete,true);
  assert.equal(other.inputTokens,7);
  assert.equal(other.outputTokens,8);
  assert.equal(analyze({runs:[runs[1]]}).models[0].reportedCostUsd,null);
});
