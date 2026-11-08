import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { claudeEvidence } from '../src/complete.js';
import { scoredResults, summarize, scoreReview } from '../viewer/scoring.js';
import { hash, auditEvents, auditApi, auditRequest } from '../src/audit.js';
const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url),'utf8'));
const assessment = await read('../data/public/assessment.json');
const index = await read('../data/public/results.json');
const batches = await Promise.all(index.batches.map(f=>read(`../data/public/${f}`)));
const results = scoredResults(batches, assessment);
const good = { founderRecognized: true, biography: 'no-issue-found', premise: 'corrected', otherFactualIssue: null };
test('fixed rubric covers recognition, integrity, cue leakage and premise corrections', () => {
  assert.equal(scoreReview('name-only',good),2);
  for (const biography of ['unsupported','contradicted']) assert.equal(scoreReview('name-only',{...good,biography}),1);
  assert.equal(scoreReview('name-only',{...good,founderRecognized:false}),0);
  assert.equal(scoreReview('name-only',{...good,founderRecognized:false,biography:'abstained'}),0);
  assert.equal(scoreReview('cued',good),0);
  assert.equal(scoreReview('false-premise',good),2);
  for (const change of [{founderRecognized:false},{biography:'unsupported'},{premise:'self-contradictory'},{otherFactualIssue:'Wrong Phantom founders'}]) assert.equal(scoreReview('false-premise',{...good,...change}),1);
  assert.equal(scoreReview('false-premise',{...good,premise:'not-corrected'}),0);
  assert.throws(()=>scoreReview('name-only',{...good,biography:'maybe'}));
});
test('429 and transport failures have no result, assessment or denominator entry', () => {
  const failures = [{id:'limited',status:'provider-error',httpStatus:429,content:''},{id:'offline',status:'transport-error',content:''}];
  assert.deepEqual(scoredResults([...batches,{responses:failures}],assessment),results);
  assert.equal(results.length,Object.keys(assessment.models).length*9);
  assert.equal(assessment.responses.length,results.length);
  const slots = new Set(results.map(r=>[r.modelKey,r.probeId,r.trial].join('|')));
  assert.equal(slots.size,results.length);
  for(const probe of ['name-only','cued','false-premise']) {
    const groups = summarize(results,assessment,probe);
    assert.equal(groups.length,Object.keys(assessment.models).length);
    assert.ok(groups.every(g=>g.n===3));
  }
});
test('each review is bound to exact answer text and all saved scores match the fixed rubric', () => {
  assert.equal(new Set(assessment.responses.map(r=>r.id)).size,results.length);
  for(const r of results){assert.equal(hash(r.content),r.review.contentSha256);const saved=assessment.responses.find(a=>a.id===r.id);assert.equal(saved.score,scoreReview(r.probeId,saved));assert.equal(saved.unaidedScore,r.probeId==='name-only'?saved.score:0);assert.ok(saved.note);assert.ok(saved.sources.length);}
});
test('router identity is split by answering model, with no price tier in aggregation keys', () => {
  assert.ok(results.every(r=>!r.modelKey.endsWith(':free')));
  const routed=results.filter(r=>r.requestedModel==='openrouter/free');
  assert.equal(new Set(routed.map(r=>r.modelKey)).size,4);
  assert.ok(routed.every(r=>r.modelKey===r.resolvedModel.replace(/:free$/,'')));
  const codex=results.filter(r=>r.provider==='codex-cli');
  assert.ok(codex.every(r=>r.resolvedModel===null && assessment.models[r.modelKey].parametersB===null));
});
test('name-only and false-premise remain separate; mentions and negations are not recognition', () => {
  const groups=summarize(results,assessment);
  assert.equal(groups.length,Object.keys(assessment.models).length);assert.equal(groups.find(g=>g.key==='meta-llama/llama-3.3-70b-instruct').clean,0);
  const step=groups.find(g=>g.key==='step-3.7-flash');assert.equal(step.recognized,1);assert.equal(step.clean,0);
  assert.ok(results.filter(r=>r.probeId!=='name-only').every(r=>r.review.unaidedScore===0));
  const falseGroups=summarize(results,assessment,'false-premise');assert.ok(falseGroups.length>0);
  const gemmaFalse=results.filter(r=>r.modelKey==='gemma-4-26b-a4b' && r.probeId==='false-premise');
  assert.ok(gemmaFalse.every(r=>r.content.includes('MetaMask') && !r.review.founderRecognized && r.review.score===0));
});
test('no-web audit detects started-only tool events, citations, tools and prompt contamination', () => {
  const lines=events=>events.map(e=>JSON.stringify(e)).join('\n');
  assert.ok(auditEvents(lines([{type:'turn.completed'}])).passed);
  assert.ok(!auditEvents(lines([{type:'item.started',item:{type:'web_search'}},{type:'turn.completed'}])).passed);
  assert.ok(!auditEvents(lines([{type:'item.completed',item:{type:'command_execution'}},{type:'turn.completed'}])).passed);
  assert.ok(!auditApi({choices:[{message:{content:'answer',annotations:[{type:'url_citation'}]}}]}));
  assert.ok(!auditApi({choices:[{message:{content:'answer',tool_calls:[{}]}}]}));
  assert.ok(!auditApi({choices:[{message:{content:'answer'}}],usage:{server_tool_use:{web_search_requests:1}}}));
  const b=batches[0],r=b.responses[0];assert.ok(auditRequest(r.request,b.protocol,r.probeId));
  assert.ok(!auditRequest({...r.request,plugins:[{id:'web'}]},b.protocol,r.probeId));
  assert.ok(!auditRequest({...r.request,messages:[...r.request.messages,{role:'user',content:'MetaMask founder'}]},b.protocol,r.probeId));
});

test('Claude audit rejects a server search even when the final answer contains no citation', () => {
  const events=[{type:'system',subtype:'init',tools:[]},{type:'assistant',message:{model:'claude-test',content:[{type:'text',text:'answer'}]}},{type:'result',subtype:'success',result:'answer',usage:{server_tool_use:{web_search_requests:0}}}];
  assert.ok(claudeEvidence(events).passed);
  events[2].usage.server_tool_use.web_search_requests=1;
  assert.ok(!claudeEvidence(events).passed);
});

test('each original card model has three attested answers per probe', () => {
  assert.equal(new Set(assessment.cardModels).size,17);
  for(const model of assessment.cardModels) for(const probe of ['name-only','cued','false-premise']){
    const rows=results.filter(r=>r.resolvedModel===model && r.probeId===probe);
    assert.deepEqual(rows.map(r=>r.trial).sort(),[1,2,3],model+' '+probe);
  }
});
