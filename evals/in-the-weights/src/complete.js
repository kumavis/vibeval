import { readFile, writeFile, mkdir, mkdtemp, rm, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { directory, requestCompletion } from './run.js';
const exec = promisify(execFile);
const hash = s => createHash('sha256').update(s).digest('hex');
const canonical = s => s?.replace(/:free$/, '');
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const delay = ms => new Promise(r => setTimeout(r,ms));
async function save(file,data) {
  await writeFile(file+'.tmp', JSON.stringify(data,null,2)+'\n');
  await rename(file+'.tmp',file);
}
export function claudeEvidence(events) {
  const init = events.find(e => e.type === 'system' && e.subtype === 'init');
  const result = events.findLast(e => e.type === 'result');
  const messages = events.filter(e => e.type === 'assistant').map(e=>e.message);
  const blocks = messages.flatMap(m=>m.content || []);
  const finalText = blocks.filter(b=>b.type==='text').at(-1)?.text;
  const model = messages.at(-1)?.model;
  const noTools = Array.isArray(init?.tools) && init.tools.length===0 &&
    blocks.every(b=>['text','thinking','redacted_thinking'].includes(b.type)) &&
    events.every(e=>!['tool_use_summary','tool_progress','user'].includes(e.type)) &&
    !result?.usage?.server_tool_use?.web_search_requests && !result?.usage?.server_tool_use?.web_fetch_requests;
  const passed = Boolean(noTools && result?.subtype==='success' && !result.is_error && model && finalText?.trim() && finalText===result.result);
  return {passed, content:passed?finalText:'', model, usage:result?.usage, reason:result?.subtype, diagnostic:result?.is_error?result.result:undefined};
}
async function askClaude(model,system,prompt,apiKey) {
  const dir=await mkdtemp(join(tmpdir(),'vibeval-recall-'));
  const flags=['-p','--bare','--safe-mode','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','','--disable-slash-commands','--no-session-persistence','--output-format','stream-json','--verbose','--model',model,'--system-prompt',system,prompt];
  let stdout,stderr,exitCode=0;
  try { ({stdout,stderr}=await exec('claude',flags,{cwd:dir,timeout:180000,maxBuffer:16*1024*1024,env:{PATH:process.env.PATH,HOME:dir,CLAUDE_CONFIG_DIR:dir,ANTHROPIC_BASE_URL:'https://openrouter.ai/api',ANTHROPIC_AUTH_TOKEN:apiKey,ANTHROPIC_API_KEY:'',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}})); }
  catch(e) { stdout=e.stdout||'';stderr=e.stderr||e.message;exitCode=1; }
  finally { await rm(dir,{recursive:true,force:true}); }
  const events=stdout.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  const check=claudeEvidence(events);
  return {raw:events, result:{status:check.passed&&!exitCode?'completed':'provider-error',content:check.content,resolvedModel:check.model||null,provider:'claude-cli',usage:check.usage,finishReason:check.reason,toolAudit:{passed:check.passed},error:check.diagnostic||stderr.slice(-600)}};
}
export async function complete(model,{transport='openrouter',apiKey=process.env.IN_THE_WEIGHTS_API_KEY,base='https://openrouter.ai/api/v1',alternates=[],root=directory}={}) {
  const protocolText=await readFile(join(root,'protocol.json'),'utf8'), protocol=JSON.parse(protocolText);
  const publicDir=join(root,'data/public'), runRoot=join(root,'runs');
  await mkdir(runRoot,{recursive:true});
  const archive=await read(join(publicDir,'results.json'));
  const historical=await Promise.all(archive.batches.map(f=>read(join(publicDir,f))));
  for(const name of await readdir(runRoot)) {
    try {const batch=await read(join(runRoot,name,'batch.json')); if(!historical.some(b=>b.id===batch.id))historical.push(batch);} catch {}
  }
  const known=historical.flatMap(b=>b.responses).filter(r=>r.status==='completed' && (canonical(r.resolvedModel||r.requestedModel)===canonical(model) || (transport==='claude' && r.requestedModel===model)));
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
  const dir=join(runRoot,id); await mkdir(dir); const source=await readFile(new URL(import.meta.url));
  await writeFile(join(dir,'runner.js'),source);
  const batch={id,protocol,protocolSha256:hash(protocolText),runnerSha256:hash(source),startedAt:new Date().toISOString(),status:'running',transport,settings:{targetTrials:3,tools:[],temperature:transport==='claude'?null:0.7},inventory:[{id:model}],responses:[]};
  const checkpoint=()=>save(join(dir,'batch.json'),batch);
  await checkpoint();
  if (transport === 'claude') batch.settings.identityContext = 'Empty per-call home and configuration, Claude Code bare mode via OpenRouter Messages API';
  const routes=[model,...alternates];
  let routeIndex=0, stop=false;
  for(const probe of protocol.probes) {
    const occupied=new Set(known.filter(r=>r.probeId===probe.id).map(r=>r.trial));
    for(const trial of [1,2,3].filter(n=>!occupied.has(n))) {
      const pastAttempts = historical.flatMap(b=>b.responses).filter(r=>canonical(r.requestedModel)===canonical(model) && r.trial===trial && r.probeId===probe.id && r.status!=='completed').length;
      for(let tries=0;tries<4;tries++) {
        const route=routes[routeIndex], isClaude=transport==='claude';
        const request={model:route,messages:[{role:'system',content:protocol.system},{role:'user',content:probe.prompt}],...(!isClaude?{temperature:0.7,seed:1700+trial+1000*(pastAttempts+tries),max_tokens:8192,stream:false}:{})};
        const start=Date.now(),item={id:randomUUID(),trial,probeId:probe.id,requestedModel:route,request,startedAt:new Date().toISOString()};
        try {
          let raw,result;
          if(isClaude) ({raw,result}=await askClaude(route,protocol.system,probe.prompt,apiKey));
          else {const reply=await requestCompletion({base,key:apiKey,request,timeoutMs:150000});({raw,...result}=reply);}
          await save(join(dir,item.id+'.json'),raw);
          Object.assign(item,result,{rawSha256:hash(JSON.stringify(raw))});
          if(!isClaude && item.status==='completed' && canonical(item.resolvedModel)!==canonical(model))item.status='model-mismatch';
          if(!isClaude && raw.error)item.error=String(raw.error.message).slice(0,300);
        }catch(e){Object.assign(item,{status:'transport-error',content:'',error:e.message});}
        Object.assign(item,{wallMs:Date.now()-start,endedAt:new Date().toISOString()});
        batch.responses.push(item);await checkpoint();
        console.log(model,probe.id,trial,item.status,item.httpStatus||'',item.resolvedModel||'',item.status==='completed'?'':item.error?.slice(0,140));
        if(item.status==='completed')break;
        if(item.status==='provider-error' && routeIndex+1<routes.length){routeIndex++;continue;}
        if([400,401,402,403,404].includes(item.httpStatus) || (isClaude && tries>=1) || tries>=3){stop=true;break;}
        await delay(4000*2**tries);
      }
      if(stop)break;
    }
    if(stop)break;
  }
  batch.status=batch.responses.every(r=>r.status==='completed')?'completed':'completed-with-errors';
  batch.endedAt=new Date().toISOString();await checkpoint();return batch;
}
