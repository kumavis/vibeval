import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generate,initial,observe,episode,distance} from '../src/simulation.js';
import {evaluateController} from '../src/execute.js';
test('deterministic generation and partial observations',()=>{
 const s=generate(123);assert.deepEqual(s,generate(123));
 const state=initial(s),o=observe(state);assert.ok(o.enemies.every(e=>distance(e,o.courier)<=6));assert.equal(o.seed,undefined);assert.equal(o.enemies[0]?.waypoints,undefined);
});
test('SES runs valid controllers without exposing host capabilities',async()=>{
 const rows=await evaluateController(`export function act(o,m){if(typeof process!=='undefined'||typeof require!=='undefined'||typeof fetch!=='undefined')throw Error('host leak');return {action:{type:'wait'},memory:(m||0)+1}}`,[generate(123)]);
 assert.notEqual(rows[0].status,'error');
});
test('CPU watchdog covers initialization and per-tick execution',async()=>{
 for(const code of ['while(true){};function act(){}','function act(){while(true){}}']){
 const [r]=await evaluateController(code,[generate(123)],{episodeMs:25});assert.equal(r.status,'timeout');assert.equal(r.score,0);
 }
});
test('rejects missing entry and oversized memory',async()=>{
 const [a]=await evaluateController('const x=1',[generate(123)],{compileOnly:true});assert.equal(a.status,'error');
 const [b]=await evaluateController('function act(){return {action:{type:"wait"},memory:"x".repeat(33000)}}',[generate(123)]);assert.equal(b.status,'error');
});
test('private calibration witnesses still deliver all value',{skip:!process.env.COURIER_VERIFY_SUITE},async()=>{
 const data=JSON.parse(await readFile(new URL('../data/private/suites.json',import.meta.url)));
 for(const cases of Object.values(data.suites))for(const s of cases){let i=0;assert.equal(episode(s,()=>({action:s.witness[i++]})).score,100);}
});
