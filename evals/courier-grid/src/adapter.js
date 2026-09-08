import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateController} from './execute.js';
import {summarize,VERSION} from './simulation.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const compact=({replay,actions,errorInput,...row})=>row;
export async function createAdapter({directory}) {
 const raw=await readFile(join(directory,'data/private/suites.json'),'utf8');
 const dataset=JSON.parse(raw),suites=dataset.suites;
 const suiteSha256=hash(JSON.stringify(dataset));
 let used=0,fresh=0;const tests=new Map();
 async function evaluate(code,cases,trace=true){
  const rows=[];
  for(let start=0;start<cases.length;start+=8){
   const chunk=cases.slice(start,start+8);
   try{rows.push(...await evaluateController(code,chunk,{trace,timeoutMs:12000}));}
   catch(error){rows.push(...chunk.map(s=>({seed:s.seed,score:0,value:0,total:s.jobs.reduce((n,j)=>n+j.value,0),status:'error',ticks:0,invalidActions:0,error:error.message})));}
  }
  return rows.map(r=>['error','timeout'].includes(r.status)?{...r,score:0}:r);
 }
 return {
  budget: () => ({ simulationsRemaining: 192-used, simulationsUsed: used, freshCasesRemaining: 40-fresh }),
  async handle(action,{workspace,workingDirectory,runDir,record}){
   if(['write_file','read_file'].includes(action.action)){
    if(action.path!=='controller.js')throw Error('Only controller.js is supported');
    if(action.action==='read_file')return {feedback:{content:await workspace.read(action.path)}};
    record.turns.drafts++;return {feedback:await workspace.write(action.path,action.content)};
   }
   if(action.action==='test'){
    if(!['fixed','fresh'].includes(action.suite))throw Error('Choose fixed or fresh');
    const cases=action.suite==='fixed'?suites.practice:suites.fresh.slice(fresh,fresh+8);
    if(cases.length!== (action.suite==='fixed'?24:8))throw Error('Fresh practice pool exhausted');
    if(used+cases.length>192)throw Error('Practice simulation budget exhausted');
    const code=await workspace.read('controller.js');used+=cases.length;if(action.suite==='fresh')fresh+=cases.length;
    const id=`test-${tests.size+1}`,started=Date.now();const rows=await evaluate(code,cases);
    const report={id,suite:action.suite,codeSha256:hash(code),...summarize(rows),wallMs:Date.now()-started,simulationsUsed:used,simulationsRemaining:192-used,results:rows.map(compact)};
    tests.set(id,{rows,cases});record.practice??=[];record.practice.push(report);
    await mkdir(join(runDir,'practice'),{recursive:true});await writeFile(join(runDir,'practice',id+'.json'),JSON.stringify({report,rows}));
    return {feedback:report};
   }
   if(action.action==='inspect_episode'){
    const test=tests.get(action.testId);if(!test)throw Error('Unknown testId');
    const row=test.rows.find(r=>r.seed===action.seed),scenario=test.cases.find(s=>s.seed===action.seed);if(!row)throw Error('Seed was not in this practice test');
    const from=action.from??0,limit=action.limit??20;if(!Number.isInteger(from)||from<0||!Number.isInteger(limit)||limit<1||limit>30)throw Error('Use nonnegative from and limit 1..30');
    return {feedback:{...compact(row),map:scenario.map,chargers:scenario.chargers,jobs:scenario.jobs,errorInput:row.errorInput,frames:(row.replay??[]).slice(from,from+limit).map(({visibleEnemyIds=[],...f})=>({...f,enemies:f.enemies.filter(e=>visibleEnemyIds.includes(e.id))})),totalFrames:row.replay?.length??0}};
   }
   if(action.action==='submit'){
    record.turns.submissions++;
    const code=await workspace.read('controller.js');const [check]=await evaluateController(code,[suites.practice[0]],{compileOnly:true,timeoutMs:3000});
    if(!check.valid)throw Error(check.error??'Invalid controller');
    return {feedback:{valid:true,checks:['controller entry compiles'],simulationsUsed:used},candidate:{directory:workingDirectory,note:action.note??null}};
   }
   throw Error('Unknown controller action');
  },
  async finalize({runDir}){
   const code=await readFile(join(runDir,'artifact/controller.js'),'utf8');const rows=await evaluate(code,suites.hidden);
   const summary=summarize(rows);
   const detail={version:VERSION,suiteSha256,codeSha256:hash(code),summary,cases:rows.map((r,i)=>({...r,map:suites.hidden[i].map,chargers:suites.hidden[i].chargers,jobs:suites.hidden[i].jobs}))};
   const content=JSON.stringify(detail);await writeFile(join(runDir,'evaluation.json'),content);
   return {metrics:{score:summary.score},evaluation:{version:VERSION,suiteSha256,summary,path:'evaluation.json',sha256:hash(content)}};
  }
 };
}
