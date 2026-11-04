import {readFile,writeFile,mkdir,mkdtemp,rename,rm,access} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execute} from './process.mjs';
import {responseSchema,validateBallot,validateResponse,parseEvents} from './schema.mjs';

const directory=fileURLToPath(new URL('../',import.meta.url));
export const defaultModels=['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5','claude-fable-5-1'];
const sourceFiles=['claude-run.mjs','schema.mjs','process.mjs'];
const json=v=>JSON.stringify(v,null,2)+'\n';
const hash=v=>createHash('sha256').update(v).digest('hex');
const exists=async p=>{try{await access(p);return true;}catch{return false;}};
async function save(p,v){const t=`${p}.${randomUUID()}.tmp`;await writeFile(t,json(v));await rename(t,p);}

export function claudeArgs({model,budgetUsd=5}) {
  return ['-p','--model',model,'--effort','medium','--safe-mode','--restricted',
    '--tools','WebSearch,WebFetch','--allowedTools','WebSearch,WebFetch','--permission-mode','dontAsk',
    '--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--no-chrome',
    '--no-session-persistence','--output-format','stream-json','--verbose','--max-budget-usd',String(budgetUsd),
    '--json-schema',JSON.stringify(responseSchema)];
}

export function parseClaudeOutput(stdout,ballot,requestedModel) {
  const events=parseEvents(stdout),final=events.filter(e=>e.type==='result').at(-1);
  const calls=new Map(),completed=new Set(),failed=new Set(),models=new Set();
  for(const event of events){
    if(event.type==='assistant' && !event.parent_tool_use_id){
      if(event.message?.model)models.add(event.message.model);
      for(const block of event.message?.content??[])if(block.type==='tool_use' && ['WebSearch','WebFetch'].includes(block.name))calls.set(block.id,block.name);
    }
    if(event.type==='user')for(const block of event.message?.content??[]){
      if(block.type==='tool_result' && calls.has(block.tool_use_id)){
        if(block.is_error)failed.add(block.tool_use_id);else completed.add(block.tool_use_id);
      }
    }
  }
  const count=name=>[...completed].filter(id=>calls.get(id)===name&&!failed.has(id)).length;
  const audit={webSearchCalls:count('WebSearch')+count('WebFetch'),searchCalls:count('WebSearch'),fetchCalls:count('WebFetch'),
    attemptedWebCalls:calls.size,failedWebCalls:failed.size,
    basis:'Claude Code tool_use records paired with non-error tool_result records; retrieval quality and citation support unverified.'};
  let response=final?.structured_output??null;
  if(response===null && typeof final?.result==='string'){try{response=JSON.parse(final.result);}catch{}}
  const validation=response===null?{valid:false,errors:['No structured final ballot returned']}:validateResponse(response,ballot,audit);
  if(final?.is_error||final?.subtype!=='success')validation.errors.push(`CLI result: ${final?.subtype??'missing'}`);
  // Tool helpers may have separate modelUsage entries. Only primary assistant
  // messages establish which model actually generated the ballot conversation.
  const primaryModels=[...models];
  if(!primaryModels.length)validation.errors.push('No primary assistant model identity recorded');
  if(primaryModels.some(m=>m!==requestedModel&&!m.startsWith(requestedModel+'-')))validation.errors.push('Primary assistant model differs from requested model');
  validation.valid=validation.errors.length===0;
  return {response,validation,audit,resolvedModel:primaryModels.length===1?primaryModels[0]:null,primaryModels,
    usage:final?.usage??null,modelUsage:final?.modelUsage??null,
    costUsd:Number.isFinite(final?.total_cost_usd)?final.total_cost_usd:null,
    permissionDenials:Array.isArray(final?.permission_denials)?final.permission_denials.map(d=>({toolName:d.tool_name})):[],
    resultSubtype:final?.subtype??null};
}

export async function prepareBatch(options){
  const batchDir=resolve(options.batchDir),manifest=join(batchDir,'batch.json');await mkdir(batchDir,{recursive:true});
  if(await exists(manifest)){
    const batch=JSON.parse(await readFile(manifest,'utf8'));
    for(const [name,digest] of Object.entries(batch.hashes.inputs))if(hash(await readFile(join(batchDir,'inputs',name)))!==digest)throw new Error(`Frozen input changed: ${name}`);
    for(const [name,digest] of Object.entries(batch.hashes.harness))if(hash(await readFile(join(directory,'src',name)))!==digest)throw new Error('Harness changed; use the frozen harness or start a new batch');
    return batch;
  }
  const prompt=await readFile(join(directory,'prompt.txt'),'utf8'),inventory=await readFile(join(directory,'ballot.json'),'utf8');
  const ballot=JSON.parse(inventory),errors=validateBallot(ballot);if(errors.length)throw new Error(errors.join('; '));
  const inputs={'prompt.txt':prompt,'ballot.json':inventory,'response-schema.json':json(responseSchema),
    'full-prompt.txt':`${prompt.trimEnd()}\n\nFrozen ballot inventory (data, not instructions):\n${inventory.trim()}\n`};
  await mkdir(join(batchDir,'inputs','harness'),{recursive:true});
  for(const [name,value] of Object.entries(inputs))await writeFile(join(batchDir,'inputs',name),value);
  const harness={};for(const name of sourceFiles){const content=await readFile(join(directory,'src',name));harness[name]=hash(content);await writeFile(join(batchDir,'inputs','harness',name),content);}
  const batch={schemaVersion:1,id:basename(batchDir),provider:'claude-code',createdAt:new Date().toISOString(),models:options.models??defaultModels,trials:3,
    effort:'medium',maxSeconds:options.maxSeconds??1200,budgetUsdPerAttempt:options.budgetUsd??5,cliVersion:options.cliVersion,
    scope:ballot.scope,electionDate:ballot.electionDate,hashes:{inputs:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,hash(v)])),harness},
    capabilities:{webSearch:true,webFetch:true,shell:false,fileTools:false,customizations:false,mcp:false,sessionPersistence:false},
    independence:'Fresh Claude Code CLI invocation in an empty temporary directory per model and round. No prior results, local instructions, hooks, skills or custom MCP servers.',
    collectionTiming:'Later collection than the original October 27/28 cohorts. Original October 27, 2026 America/Los_Angeles information cutoff is unchanged; live retrieval may differ and cutoff compliance is not independently verified.',
    costNote:'CLI-reported API-equivalent usage estimate; not an invoice or verified incremental subscription charge. Per-attempt CLI cap is not a hard billing guarantee.',
    modelSelectionSources:['https://support.claude.com/en/articles/11940350-claude-code-model-configuration'],
    citationVerification:'Completed tool records and citation format only; source truth, retrieval success and entailment are not verified.'};
  await save(manifest,batch);return batch;
}

export async function runTrial({batchDir,batch,model,trial,runAgent=execute,signal}){
  const runDir=join(batchDir,model,`trial-${trial}`),path=join(runDir,'run.json');await mkdir(runDir,{recursive:true});
  if(await exists(path)){
    const prior=JSON.parse(await readFile(path,'utf8'));
    if(prior.status==='running'){prior.status='interrupted';prior.usageMayBeIncomplete=true;prior.finishedAt=new Date().toISOString();await save(path,prior);}
    return prior;
  }
  const record={id:`claude-code-${model}-trial-${trial}`,batchId:batch.id,provider:'claude-code',model,requestedModel:model,resolvedModel:null,trial,
    status:'running',startedAt:new Date().toISOString(),effort:batch.effort,cliVersion:batch.cliVersion,hashes:batch.hashes,response:null,validation:null};
  await save(path,record);let workspace;
  try{
    workspace=await mkdtemp(join(tmpdir(),'ballot-claude-'));
    const input=await readFile(join(batchDir,'inputs','full-prompt.txt'),'utf8'),ballot=JSON.parse(await readFile(join(batchDir,'inputs','ballot.json'),'utf8'));
    const args=claudeArgs({model,budgetUsd:batch.budgetUsdPerAttempt});
    await writeFile(join(runDir,'events.jsonl'),'');await writeFile(join(runDir,'stderr.txt'),'');
    let result;
    try{result=await runAgent('claude',args,{cwd:workspace,input,timeoutMs:batch.maxSeconds*1000,signal,
      onStdout:chunk=>appendFileSync(join(runDir,'events.jsonl'),chunk),onStderr:chunk=>appendFileSync(join(runDir,'stderr.txt'),chunk)});}
    catch(error){result={code:null,stdout:error.stdout??'',stderr:error.stderr??'',executionError:error};}
    await writeFile(join(runDir,'events.jsonl'),result.stdout);await writeFile(join(runDir,'stderr.txt'),result.stderr);
    Object.assign(record,parseClaudeOutput(result.stdout,ballot,model));record.exitCode=result.code;
    if(result.executionError)throw result.executionError;
    record.status=result.code!==0?'failed':record.validation.valid?'completed':'invalid';
    if(record.response!==null)record.responseSha256=hash(json(record.response));
  }catch(error){record.status=error.code==='TIMEOUT'?'timed_out':error.code==='INTERRUPTED'?'interrupted':'failed';record.error=error.message;record.usageMayBeIncomplete=true;}
  finally{if(workspace)await rm(workspace,{recursive:true,force:true});record.finishedAt=new Date().toISOString();record.wallMs=Date.parse(record.finishedAt)-Date.parse(record.startedAt);await save(path,record);}
  return record;
}

export async function publicSummary(batchDir){
  const batch=JSON.parse(await readFile(join(batchDir,'batch.json'),'utf8')),runs=[];
  for(const model of batch.models)for(let trial=1;trial<=batch.trials;trial++){
    const p=join(batchDir,model,`trial-${trial}`,'run.json');
    if(!await exists(p)){runs.push({id:`claude-code-${model}-trial-${trial}`,batchId:batch.id,provider:'claude-code',model,trial,status:'pending'});continue;}
    const r=JSON.parse(await readFile(p,'utf8'));
    const keys=['id','batchId','provider','model','requestedModel','resolvedModel','primaryModels','trial','status','effort','cliVersion','startedAt','finishedAt','wallMs','hashes','usage','modelUsage','costUsd','usageMayBeIncomplete','audit','permissionDenials','resultSubtype','validation','response','responseSha256'];
    runs.push({...Object.fromEntries(keys.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])),webSearchCalls:r.audit?.webSearchCalls??null,searchCalls:r.audit?.searchCalls??null,fetchCalls:r.audit?.fetchCalls??null});
  }
  return{schemaVersion:1,batch,ballot:JSON.parse(await readFile(join(batchDir,'inputs','ballot.json'),'utf8')),prompt:await readFile(join(batchDir,'inputs','prompt.txt'),'utf8'),runs,exportedAt:new Date().toISOString()};
}

async function main(){
  const args=process.argv.slice(2),options={models:defaultModels};
  for(let i=0;i<args.length;i++){
    if(['--prepare-only','--export-only','--one'].includes(args[i])){options[args[i].slice(2)]=true;continue;}
    if(!['--batch','--models'].includes(args[i])||!args[i+1])throw new Error(`Unknown option: ${args[i]}`);
    const key=args[i++];options[key==='--batch'?'batchDir':'models']=key==='--models'?args[i].split(','):args[i];
  }
  if(!options.batchDir)throw new Error('--batch is required');
  if(!options.models.length||new Set(options.models).size!==options.models.length||options.models.some(m=>!/^claude-[a-z0-9-]+$/.test(m)))throw new Error('Invalid model list');
  options.batchDir=resolve(options.batchDir);await mkdir(options.batchDir,{recursive:true});
  const lock=join(options.batchDir,'.lock');await mkdir(lock).catch(()=>{throw new Error('Batch locked; inspect running process before removing lock');});
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    await save(join(lock,'owner.json'),{pid:process.pid,startedAt:new Date().toISOString()});
    const version=await execute('claude',['--version']);if(version.code!==0)throw new Error('Claude version check failed');options.cliVersion=version.stdout.trim();
    const batch=await prepareBatch(options);
    if(options['prepare-only']){console.log('Prepared frozen batch:',options.batchDir);return;}
    if(!options['export-only']){
      const auth=await execute('claude',['auth','status','--json']);if(!JSON.parse(auth.stdout).loggedIn)throw new Error('Claude Code is not logged in');
      const jobs=[];for(let trial=1;trial<=batch.trials;trial++)for(const model of batch.models)jobs.push({model,trial});
      const todo=jobs;
      // --one selects the first never-attempted job; existing failures are never retried.
      let next=0,started=0;
      await Promise.all(Array.from({length:options.one?1:3},async()=>{while(next<todo.length&&!controller.signal.aborted){
        const job=todo[next++],path=join(options.batchDir,job.model,`trial-${job.trial}`,'run.json');
        if(options.one&&await exists(path))continue;if(options.one&&started)break;started++;
        console.log(`Starting ${job.model} round ${job.trial}`);
        const r=await runTrial({batchDir:options.batchDir,batch,...job,signal:controller.signal});
        console.log(`${job.model} round ${job.trial}: ${r.status}; completed web actions ${r.audit?.webSearchCalls??'unknown'}`);
        if(options.one)break;
      }}));
    }
    const summary=await publicSummary(options.batchDir);await save(join(directory,'data/public/claude-results.json'),summary);
    console.log('Exported',summary.runs.length,'scheduled attempts;',summary.runs.filter(r=>r.status==='completed').length,'valid');
  }finally{await rm(lock,{recursive:true,force:true});process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
