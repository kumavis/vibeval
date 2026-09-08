import 'ses';
import vm from 'node:vm';
import { episode } from './simulation.js';
lockdown();
process.on('message', ({code,scenarios,trace,episodeMs=1000,compileOnly=false})=>{
 const rows=[];
 for(const scenario of scenarios){
  let observationJSON='';let memoryJSON='null';
  const compartment=new Compartment();
  try {
   if(typeof code!=='string'||Buffer.byteLength(code)>32768)throw new Error('Controller exceeds 32 KiB');
   const source=code.replace(/\bexport\s+(?=(?:function\s+act\b|(?:const|let)\s+act\s*=))/g,'');
   // The controller and both JSON bridges are created in the compartment.
   // No host functions, state objects, clocks, imports, or I/O are endowed.
   const run=()=>{
   const invoke=compartment.evaluate(`(function(){${source}\n;if(typeof act!=='function')throw Error('Export function act(observation,memory)');return function(input,memory){const result=act(JSON.parse(input),JSON.parse(memory));return JSON.stringify(result);};})()`);
   if(compileOnly)return {valid:true};
   return episode(scenario,(observation)=>{
    observationJSON=JSON.stringify(observation);
    const output=invoke(observationJSON,memoryJSON);
    if(typeof output!=='string'||output.length>40000)throw new Error('Controller must return JSON action and at most 32 KiB memory');
    const result=JSON.parse(output);memoryJSON=JSON.stringify(result.memory??null);
    if(memoryJSON.length>32768)throw new Error('Memory exceeds 32 KiB');
    return {action:result.action,memory:null};
   },{trace});
   };
   // VM is a CPU watchdog, not the security boundary; SES supplies confinement.
   rows.push(new vm.Script('run()').runInContext(vm.createContext({run}),{timeout:episodeMs}));
  }catch(error){rows.push({seed:scenario.seed,score:0,value:0,total:scenario.jobs.reduce((n,j)=>n+j.value,0),status:error.code==='ERR_SCRIPT_EXECUTION_TIMEOUT'?'timeout':'error',ticks:0,invalidActions:0,error:String(error.message).slice(0,500)});}
 }
 process.send({rows},()=>process.exit(0));
});
