import { writeFile,mkdir,access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomInt,createHash } from 'node:crypto';
import { generate,episode,summarize,VERSION } from './simulation.js';
import { baseline } from './baselines.js';
const root=fileURLToPath(new URL('../',import.meta.url));
try {
 await access(join(root,'data/private/suites.json'));
 throw new Error('A frozen suite already exists. Archive it and increment VERSION before generating a replacement.');
} catch(error) { if(error.code!=='ENOENT') throw error; }
const count=Number(process.env.COURIER_CASES||192);
if(count!==192)throw new Error('This version requires exactly 24 fixed, 40 fresh, and 128 held-out cases');
const cases=[];let attempts=0;
const begin=performance.now();const salt=randomInt(100000,1000000000);
while(cases.length<count&&attempts<count*150){
 const scenario=generate(salt+attempts++);
 for(let variant=0;variant<3;variant++){
  const witness=episode(scenario,baseline('oracle',variant),{full:true,trace:true});
  if(witness.status!=='complete'||witness.ticks>285)continue;
  for(const job of scenario.jobs)job.deadline=Math.min(300,witness.deliveredAt[job.id]+35);
  let i=0;const verified=episode(scenario,()=>({action:witness.actions[i++],memory:null}));
  if(verified.score!==100)throw new Error('Invalid feasibility witness');
  cases.push({...scenario,witness:witness.actions});break;
 }
 if(attempts%100===0)console.log('certified',cases.length,'/',attempts,'candidates');
}
if(cases.length<count)throw new Error('Insufficient feasible cases');
const practice=cases.slice(0,24),fresh=cases.slice(24,64),hidden=cases.slice(64);
const result={version:VERSION,generatedAt:new Date().toISOString(),generationSalt:salt,attempts,certified:cases.length,generationMs:performance.now()-begin,suites:{practice,fresh,hidden}};
const report={version:VERSION,certifiedCases:cases.length,attempts,description:'Each case includes a replay-verified full-delivery witness using the actual enemy policies.',baselines:{}};
for(const mode of ['greedy','value','risk']){
 const start=performance.now();const rows=practice.map(s=>episode(s,baseline(mode)));
 report.baselines[mode]={...summarize(rows),wallMs:performance.now()-start};console.log(mode,report.baselines[mode].score.toFixed(2));
}
report.suiteSha256=createHash('sha256').update(JSON.stringify(result)).digest('hex');
await mkdir(join(root,'data/private'),{recursive:true});await mkdir(join(root,'data/public'),{recursive:true});
await writeFile(join(root,'data/private/suites.json'),JSON.stringify(result));
await writeFile(join(root,'data/public/calibration.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
