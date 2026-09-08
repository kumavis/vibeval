import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function evaluateController(code,scenarios,{trace=false,timeoutMs=45000,episodeMs=1000,compileOnly=false}={}) {
 return new Promise((resolve,reject)=>{
  const child=fork(fileURLToPath(new URL('./worker.js',import.meta.url)),[],{execArgv:['--max-old-space-size=128'],env:{},stdio:['ignore','ignore','pipe','ipc']});
  let stderr='',settled=false;
  const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');error?reject(error):resolve(value);};
  const timer=setTimeout(()=>done(new Error('Controller suite exceeded its runtime budget')),timeoutMs);
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1000);});
  child.on('error',error=>done(error));child.on('exit',code=>done(new Error(`Controller worker exited (${code}): ${stderr}`)));
  child.on('message',message=>done(null,message.rows));
  child.send({code,scenarios,trace,episodeMs,compileOnly});
 });
}
