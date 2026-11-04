import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claudeArgs,parseClaudeOutput,prepareBatch,runTrial,publicSummary} from '../src/claude-run.mjs';
const original=JSON.parse(await readFile(new URL('../data/public/codex-results.json',import.meta.url),'utf8'));
const ballot=original.ballot,response=original.runs.find(r=>r.validation?.valid).response,model='claude-haiku-5-5';
function events({failed=false,identity=model,structured=response}={}){return [
 {type:'assistant',message:{model:identity,content:[{type:'tool_use',id:'s',name:'WebSearch'},{type:'tool_use',id:'f',name:'WebFetch'}]}},
 {type:'user',message:{content:[{type:'tool_result',tool_use_id:'s',is_error:failed},{type:'tool_result',tool_use_id:'f',is_error:true}]}},
 {type:'result',subtype:'success',is_error:false,structured_output:structured,total_cost_usd:.1,modelUsage:{[model]:{costUSD:.1}}}
 ];}
const stdout=e=>e.map(JSON.stringify).join('\n');
test('Claude args isolate context and allow only web tools with bounded cost',()=>{
 const args=claudeArgs({model});for(const flag of ['--safe-mode','--restricted','--no-session-persistence','--strict-mcp-config','--json-schema'])assert.ok(args.includes(flag));
 assert.equal(args[args.indexOf('--tools')+1],'WebSearch,WebFetch');assert.equal(args[args.indexOf('--max-budget-usd')+1],'5');
 assert.ok(!args.includes('--dangerously-skip-permissions'));
});
test('Claude parser validates complete ballot and pairs successful web results',()=>{
 const result=parseClaudeOutput(stdout(events()),ballot,model);
 assert.equal(result.validation.valid,true);assert.equal(result.audit.webSearchCalls,1);assert.equal(result.audit.fetchCalls,0);assert.equal(result.audit.failedWebCalls,1);
 assert.equal(result.resolvedModel,model);assert.deepEqual(result.response,response);
 const repeated=events();repeated.splice(2,0,repeated[1]);assert.equal(parseClaudeOutput(stdout(repeated),ballot,model).audit.webSearchCalls,1);
});
test('failed tools, missing output and fallback identities never become valid ballots',()=>{
 assert.equal(parseClaudeOutput(stdout(events({failed:true})),ballot,model).validation.valid,false);
 assert.equal(parseClaudeOutput(stdout(events({identity:'claude-sonnet-5-5'})),ballot,model).validation.valid,false);
 assert.equal(parseClaudeOutput(stdout(events({structured:null})),ballot,model).validation.valid,false);
 assert.equal(parseClaudeOutput('',ballot,model).costUsd,null);
});
test('frozen Claude inputs match original, runs never retry, and exports omit raw traces and paths',async t=>{
 const batchDir=await mkdtemp(join(tmpdir(),'claude-ballot-test-'));t.after(()=>rm(batchDir,{recursive:true,force:true}));
 const batch=await prepareBatch({batchDir,models:[model],cliVersion:'test'});
 assert.equal(batch.hashes.inputs['full-prompt.txt'],original.batch.hashes.inputs['full-prompt.txt']);
 let calls=0;
 const runAgent=async(command,args,options)=>{calls++;assert.equal(command,'claude');assert.match(options.cwd,/ballot-claude-/);return {code:0,stdout:stdout(events()),stderr:'private detail'};};
 await runTrial({batchDir,batch,model,trial:1,runAgent});await runTrial({batchDir,batch,model,trial:1,runAgent});assert.equal(calls,1);
 const out=await publicSummary(batchDir);assert.equal(out.runs[0].status,'completed');assert.equal(out.runs.length,3);assert.equal(out.runs[1].status,'pending');
 assert.ok(!JSON.stringify(out).includes('private detail'));assert.ok(!JSON.stringify(out).includes(batchDir));
 await writeFile(join(batchDir,'inputs','prompt.txt'),'changed');await assert.rejects(prepareBatch({batchDir}),/Frozen input changed/);
});
