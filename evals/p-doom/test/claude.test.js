import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeArgs, normalizeClaude } from '../src/claude.js';
import { runTrial } from '../src/run.js';
import { parseEvents } from '../src/process.js';
import { researchAudit } from '../src/model.js';
import { modelName } from '../viewer/graph.js';
import { fixture, reviewFor, fakeTool, fakeInference } from './fixtures.js';
const model = 'claude-haiku-5-5';
const stream = (...events) => events.map(e=>JSON.stringify(e)).join('\n');
const assistant = content => ({type:'assistant',message:{model,content}});
const result = candidate => ({type:'result',subtype:'success',is_error:false,structured_output:candidate,usage:{input_tokens:20,cache_creation_input_tokens:40,cache_read_input_tokens:10,output_tokens:30}});
const search = [assistant([{type:'thinking',thinking:'private reasoning'}, {type:'tool_use',name:'WebSearch',id:'s1',input:{query:'source'}}]), {type:'user',message:{content:[{type:'tool_result',tool_use_id:'s1',content:'retrieved page body'}]}}];

test('Claude pins requested model and effort, allows web only and ignores customizations',()=>{
  const args=claudeArgs({model,effort:'medium'});
  assert.equal(args[args.indexOf('--model')+1],model);
  assert.equal(args[args.indexOf('--effort')+1],'medium');
  assert.equal(args[args.indexOf('--tools')+1],'WebSearch,WebFetch');
  assert.ok(args.includes('--safe-mode'));assert.ok(args.includes('--no-session-persistence'));
  assert.ok(args.includes('--strict-mcp-config')); assert.ok(!args.includes('--fallback-model')); assert.ok(!args.includes('--json-schema'));
  assert.equal(modelName(model),'Haiku 5.5');assert.equal(modelName('claude-fable-5-1'),'Fable 5.1');
});
test('normalization counts only completed successful web tools, excludes private reasoning and page bodies',()=>{
  const raw=stream(...search,assistant([{type:'tool_use',name:'WebFetch',id:'failed',input:{url:'https://example.com'}}]),
    {type:'user',message:{content:[{type:'tool_result',tool_use_id:'failed',is_error:true,content:'denied'}]}},result(fixture()));
  const normalized=normalizeClaude(raw,model), events=parseEvents(normalized.stdout);
  assert.equal(researchAudit(events).webSearchCalls,1);
  assert.ok(!normalized.stdout.includes('private reasoning'));assert.ok(!normalized.stdout.includes('retrieved page body'));
  assert.deepEqual(JSON.parse(events.filter(e=>e.item?.type==='agent_message').at(-1).item.text),fixture());
  assert.equal(normalized.resolvedModel,model);
  assert.deepEqual(events.find(e=>e.type==='turn.completed').usage,{input_tokens:70,cached_input_tokens:10,output_tokens:30});
});
test('provider failures and unexpected model substitutions are retained as failures',()=>{
  assert.ok(parseEvents(normalizeClaude(stream({type:'result',subtype:'error_during_execution',is_error:true,errors:['denied']}),model).stdout).some(e=>e.type==='turn.failed'&&e.error.message==='denied'));
  assert.ok(parseEvents(normalizeClaude(stream({type:'system',subtype:'init',model:'different-model'},result(fixture())),model).stdout).some(e=>e.type==='turn.failed'));
});
test('Claude uses the same evaluate-review-submit loop and saves native and public event traces separately',async t=>{
  const outputRoot=await mkdtemp(join(tmpdir(),'doom-claude-test-'));t.after(()=>rm(outputRoot,{recursive:true,force:true}));
  const target=fixture();let calls=0;
  const run=await runTrial({model,effort:'medium',outputRoot,runTool:fakeTool,inferModel:fakeInference,
    runAgent:async(command,args,{input})=>{
      assert.equal(command,'claude');assert.equal(args[args.indexOf('--model')+1],model);
      calls++;assert.match(input,/Response JSON schema:/);if(calls===2)assert.match(input,/Phase: review/);
      const candidate=calls===1?target:{...target,action:'submit',review:reviewFor(target)};
      return{code:0,stderr:'',stdout:stream({type:'system',subtype:'init',model},...(calls===1?search:[]),assistant([{type:'text',text:JSON.stringify(candidate)}]),{...result(candidate),structured_output:undefined,result:JSON.stringify(candidate)})};
    }});
  assert.equal(calls,2);assert.equal(run.record.status,'submitted');assert.equal(run.record.provider,'claude-cli');
  assert.equal(run.record.resolvedModel,model);assert.ok(run.record.rounds.every(r=>r.lint.valid));
  assert.match(await readFile(join(run.directory,'native-events-1.jsonl'),'utf8'),/private reasoning/);
  assert.doesNotMatch(await readFile(join(run.directory,'events-1.jsonl'),'utf8'),/private reasoning/);
});
