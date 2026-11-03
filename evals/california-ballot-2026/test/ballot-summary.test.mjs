import test from 'node:test';
import assert from 'node:assert/strict';
import {averageBinaryVotes, binaryVoteScore, researchEvidence} from '../viewer/ballot-summary.js';
const run = (status, choices = []) => ({status:'completed',validation:{valid:true},response:{decisions:[{contestId:'p',status,choices}]}});
test('number line averages explicit abstention as zero, not a missing denominator', () => {
  const r = averageBinaryVotes([run('voted',['Yes']),run('voted',['No']),run('abstain')],'p');
  assert.equal(r.mean,0); assert.equal(r.count,3);
  assert.equal(averageBinaryVotes([run('voted',['Yes']),run('insufficient_information'),run('voted',['Yes'])],'p').mean,2/3);
});
test('failed, invalid, absent and ambiguous ballots never become abstentions', () => {
  const invalid={...run('voted',['Yes']),validation:{valid:false}};
  assert.equal(binaryVoteScore(invalid,'p'),null);
  assert.equal(binaryVoteScore(run('voted',['Yes']),'absent'),null);
  assert.equal(averageBinaryVotes([invalid,{status:'failed'}],'p').mean,null);
  const duplicate=run('voted',['Yes']);duplicate.response.decisions.push(duplicate.response.decisions[0]);
  assert.equal(binaryVoteScore(duplicate,'p'),null);
});
test('unreported OpenRouter zero sentinel is unknown, and citations do not establish research', () => {
  assert.equal(researchEvidence({provider:'openrouter',webSearchCalls:0,webAudit:{searchUsageReported:false,fetchUsageReported:false}}).state,'unknown');
  assert.equal(researchEvidence({provider:'openrouter',response:{sources:[{url:'https://example.com'}]}}).state,'unknown');
  assert.equal(researchEvidence({provider:'openrouter',webAudit:{webSearchCalls:0,fetchUsageReported:false}}).state,'unknown');
});
test('research is independent of response validity and separates provider units', () => {
  assert.equal(researchEvidence({provider:'openrouter',status:'invalid',webSearchCalls:16,webAudit:{searchUsageReported:true}}).state,'observed');
  assert.equal(researchEvidence({webSearchCalls:0}).state,'none-recorded');
  assert.equal(researchEvidence({webSearchCalls:3}).actions,3);
  assert.equal(researchEvidence({provider:'openrouter',webAudit:{webSearchCalls:0,webFetchCalls:0}}).state,'none-recorded');
});

test('candidate shares use candidate votes only, with abstentions separate', async () => {
  const {candidateVoteShares}=await import('../viewer/ballot-summary.js');
  const contest={id:'p',options:['A','B','C']};
  const split=candidateVoteShares([run('voted',['A']),run('voted',['A']),run('voted',['B'])],contest);
  assert.deepEqual(split.shares,[2/3,1/3,0]);
  const abstention=candidateVoteShares([run('voted',['A']),run('abstain'),run('insufficient_information')],contest);
  assert.deepEqual(abstention.shares,[1,0,0]);assert.equal(abstention.count,1);
  assert.equal(abstention.abstain,1);assert.equal(abstention.insufficient,1);
  assert.deepEqual(candidateVoteShares(['A','B','C'].map(c=>run('voted',[c])),contest).shares,[1/3,1/3,1/3]);
});
test('candidate aggregation excludes invalid, ambiguous, missing and unknown choices', async () => {
  const {candidateVoteShares}=await import('../viewer/ballot-summary.js');
  const duplicate=run('voted',['A']);duplicate.response.decisions.push(duplicate.response.decisions[0]);
  const result=candidateVoteShares([{status:'failed'}, {...run('voted',['A']),validation:{valid:false}},duplicate,run('voted',['Write in']),run('voted',['A','B']),{...run('voted',['A']),response:{decisions:[]}}],{id:'p',options:['A','B']});
  assert.equal(result.shares,null);assert.equal(result.excluded,6);assert.equal(result.abstain,0);
  assert.equal(candidateVoteShares([run('abstain')],{id:'p',options:['A']}).shares,null);
});
test('four-candidate vote bars retain zero shares and sum to one', async () => {
  const {candidateVoteShares}=await import('../viewer/ballot-summary.js');
  const result=candidateVoteShares(['A','D','D'].map(c=>run('voted',[c])),{id:'p',options:['A','B','C','D']});
  assert.deepEqual(result.counts,[1,0,0,2]);assert.deepEqual(result.shares,[1/3,0,0,2/3]);
  assert.equal(result.shares.reduce((a,b)=>a+b),1);
});

test('disagreement compares equally weighted model distributions, not within-model variation', async () => {
  const {ballotDisagreement}=await import('../viewer/ballot-summary.js');
  const contest={id:'p',options:['Yes','No'],maxSelections:1};
  const votes=(model,choices)=>choices.map(choice=>({...run('voted',[choice]),model}));
  assert.equal(ballotDisagreement([...votes('a',['Yes','No']),...votes('b',['Yes','No'])],contest).score,0);
  assert.equal(ballotDisagreement([...votes('a',['Yes','Yes','Yes']),...votes('b',['No'])],contest).score,100);
  const partial=ballotDisagreement([...votes('a',['Yes','Yes','No']),...votes('b',['No','No','No'])],contest);
  assert.ok(Math.abs(partial.score-200/3)<1e-10);assert.equal(partial.modelCount,2);assert.equal(partial.voteCount,6);
});
test('disagreement excludes non-votes and unsupported attempts and needs two voting models', async () => {
  const {ballotDisagreement}=await import('../viewer/ballot-summary.js');
  const contest={id:'p',options:['A','B','C','D'],maxSelections:1};
  const votes=[{...run('voted',['A']),model:'a'},{...run('voted',['A']),model:'b'},
    {...run('abstain'),model:'a'},{...run('insufficient_information'),model:'c'},
    {...run('voted',['B']),model:'d',validation:{valid:false}}];
  assert.deepEqual(ballotDisagreement(votes,contest),{score:0,modelCount:2,voteCount:2});
  assert.equal(ballotDisagreement(votes.filter(v=>v.model!=='b'),contest).score,null);
  assert.equal(ballotDisagreement([],contest).score,null);
  assert.equal(ballotDisagreement(votes,{...contest,ranked:true}).score,null);
  assert.equal(ballotDisagreement(['A','B','C'].map((choice,i)=>({...run('voted',[choice]),model:String(i)})),contest).score,100);
});
test('ranking sorts descending, preserves ballot indexes and ties, and recalculates for cohorts', async () => {
  const {rankBallotItems}=await import('../viewer/ballot-summary.js');
  const contests=['same','split','tied','missing'].map(id=>({id,options:['A','B'],maxSelections:1}));
  const runs=['a','b','c'].map(model=>({model,status:'completed',validation:{valid:true},response:{decisions:contests.slice(0,3).map(c=>({contestId:c.id,status:'voted',choices:[c.id==='split'&&model==='c'?'B':'A']}))}}));
  assert.deepEqual(rankBallotItems(contests,runs).map(r=>r.index),[1,0,2,3]);
  assert.deepEqual(rankBallotItems(contests,runs.filter(r=>r.model!=='c')).map(r=>r.index),[0,1,2,3]);
});
