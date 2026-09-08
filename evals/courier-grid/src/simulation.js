export const VERSION = 'courier-grid-v1';
export const SIZE = 24, TICKS = 300, BATTERY = 90, CAPACITY = 5;
export const DIRS = { N: [0,-1], E: [1,0], S: [0,1], W: [-1,0] };
export function rng(seed) { let a=seed>>>0; return () => { a+=0x6d2b79f5;let t=Math.imul(a^a>>>15,1|a);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296; }; }
export const index = p => p.y*SIZE+p.x;
export const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export function neighbors(map,p) {return Object.entries(DIRS).map(([dir,[dx,dy]])=>({dir,x:p.x+dx,y:p.y+dy})).filter(n=>map[n.y]?.[n.x]==='.');}
export function bfs(map,start) {
 const dist=new Int16Array(SIZE*SIZE).fill(-1),first=new Array(SIZE*SIZE);const q=[start];dist[index(start)]=0;
 for(let i=0;i<q.length;i++)for(const n of neighbors(map,q[i]))if(dist[index(n)]<0){dist[index(n)]=dist[index(q[i])]+1;first[index(n)]=i===0?n.dir:first[index(q[i])];q.push(n);}
 return {dist,first};
}
export function generate(seed) {
 const random=rng(seed),pick=a=>a[Math.floor(random()*a.length)];
 const map=Array.from({length:SIZE},(_,y)=>Array.from({length:SIZE},(_,x)=>x===0||y===0||x===SIZE-1||y===SIZE-1?'#':'.'));
 for(const wall of [6,12,18]) {
  for(let k=1;k<SIZE-1;k++){map[k][wall]='#';map[wall][k]='#';}
 }
 for(const wall of [6,12,18])for(const low of [1,7,13,19]) {
  map[low+Math.floor(random()*4)][wall]='.';
  map[wall][low+Math.floor(random()*4)]='.';
  if(random()<.55){map[low+Math.floor(random()*4)][wall]='.';map[wall][low+Math.floor(random()*4)]='.';}
 }
 const grid=map.map(r=>r.join(''));const chargers=[{x:2,y:2},{x:21,y:2},{x:2,y:21},{x:21,y:21}];const start={...pick(chargers)};
 const reachable=bfs(grid,start).dist;const cells=[];
 for(let y=1;y<23;y++)for(let x=1;x<23;x++)if(reachable[y*SIZE+x]>=0)cells.push({x,y});
 const jobs=[];
 for(let j=0;j<5;j++){
  const from={...pick(cells)};const ds=bfs(grid,from).dist;
  const to={...pick(cells.filter(p=>ds[index(p)]>=7&&ds[index(p)]<=25))};
  jobs.push({id:'p'+j,from,to,value:3+Math.floor(random()*8),weight:1+Math.floor(random()*3),deadline:TICKS,status:'available'});
 }
 const distant=cells.filter(p=>distance(p,start)>=14);
 const enemies=[{id:'patrol',kind:'patrol',...pick(distant),period:3,waypoints:[...chargers].sort(()=>0),waypoint:Math.floor(random()*4),target:null,lastSeen:-100},
 {id:'hunter',kind:'hunter',...pick(distant),period:2,waypoints:jobs.slice(0,4).map(j=>j.from),waypoint:Math.floor(random()*4),target:null,lastSeen:-100}];
 return {seed,map:grid,start,chargers,jobs,enemies};
}
export function initial(scenario) {return {scenario, tick:0, courier:{...scenario.start,battery:BATTERY,cargo:[]},jobs:structuredClone(scenario.jobs),enemies:structuredClone(scenario.enemies),value:0,invalid:0,status:'active',events:[],deliveredAt:{}};}
export function observe(s,full=false) {
 return {width:SIZE,height:SIZE,map:s.scenario.map,tick:s.tick,ticksRemaining:TICKS-s.tick,courier:structuredClone(s.courier),batteryCapacity:BATTERY,cargoCapacity:CAPACITY,
  chargers:s.scenario.chargers,jobs:structuredClone(s.jobs),enemies:s.enemies.filter(e=>full||distance(e,s.courier)<=6).map(({id,kind,x,y,period})=>({id,kind,x,y,period})),deliveredValue:s.value,events:s.events};
}
export function step(s,action) {
 if(s.status!=='active')return;
 const c=s.courier,old={x:c.x,y:c.y};s.events=[];
 const invalid=()=>{s.invalid++;s.events.push('invalid action');};
 const carried=()=>s.jobs.filter(j=>j.status==='carried');
 if(action?.type==='move'&&DIRS[action.dir]){
  const [dx,dy]=DIRS[action.dir],next={x:c.x+dx,y:c.y+dy};const cost=carried().reduce((n,j)=>n+j.weight,0)>3?2:1;
  if(s.scenario.map[next.y]?.[next.x]!=='.'||c.battery<cost)invalid();else{Object.assign(c,next);c.battery-=cost;}
 }else if(action?.type==='pickup'){
  const job=s.jobs.find(j=>j.id===action.id);
  if(!job||job.status!=='available'||distance(c,job.from)!==0||carried().reduce((n,j)=>n+j.weight,0)+job.weight>CAPACITY)invalid();
  else{job.status='carried';c.cargo.push(job.id);s.events.push('picked up '+job.id);}
 }else if(action?.type==='deliver'){
  const deliver=carried().filter(j=>distance(c,j.to)===0);if(!deliver.length)invalid();
  for(const j of deliver){j.status='delivered';s.value+=j.value;s.deliveredAt[j.id]=s.tick;c.cargo=c.cargo.filter(id=>id!==j.id);s.events.push('delivered '+j.id);}
 }else if(action?.type==='charge'){
  if(!s.scenario.chargers.some(p=>distance(p,c)===0))invalid();else c.battery=Math.min(BATTERY,c.battery+18);
 }else if(action?.type!=='wait')invalid();
 let caught=s.enemies.some(e=>distance(e,c)===0);
 for(const e of s.enemies){
  const before={x:e.x,y:e.y};
  if(e.kind==='hunter'&&distance(e,c)<=7){e.target={x:c.x,y:c.y};e.lastSeen=s.tick;}
  if(e.kind==='hunter'&&s.tick-e.lastSeen>18)e.target=null;
  const target=e.target??e.waypoints[e.waypoint];
  if(s.tick%e.period===0&&distance(e,target)>0){
   const dir=bfs(s.scenario.map,e).first[index(target)];if(dir){e.x+=DIRS[dir][0];e.y+=DIRS[dir][1];}
  }
  if(distance(e,target)===0){if(e.target)e.target=null;else e.waypoint=(e.waypoint+1)%e.waypoints.length;}
  if(distance(e,c)===0||(distance(before,c)===0&&distance(e,old)===0))caught=true;
 }
 s.tick++;
 for(const j of s.jobs)if(['available','carried'].includes(j.status)&&s.tick>j.deadline){j.status='expired';c.cargo=c.cargo.filter(id=>id!==j.id);s.events.push('expired '+j.id);}
 if(caught)s.status='captured';
 else if(s.jobs.every(j=>j.status==='delivered'))s.status='complete';
 else if(c.battery===0&&!s.scenario.chargers.some(p=>distance(p,c)===0))s.status='exhausted';
 else if(s.tick>=TICKS)s.status='deadline';
}
export function episode(scenario,act,{full=false,trace=false}={}) {
 const s=initial(scenario);let memory=null;const replay=[];const actions=[];
 while(s.status==='active'){
  const observation=observe(s,full);
  let result;
  try { result=act(observation,memory);memory=result.memory??null; }
  catch(error){s.status='error';s.error=String(error.message||error).slice(0,500);s.errorInput=observation;break;}
  if(trace)replay.push({tick:s.tick,courier:{...s.courier,cargo:[...s.courier.cargo]},enemies:s.enemies.map(({id,kind,x,y})=>({id,kind,x,y})),jobs:s.jobs.map(j=>({id:j.id,status:j.status})),value:s.value,action:result.action,visibleEnemyIds:observation.enemies.map(e=>e.id)});
  actions.push(result.action);step(s,result.action);
 }
 if(trace)replay.push({tick:s.tick,courier:{...s.courier,cargo:[...s.courier.cargo]},enemies:s.enemies.map(({id,kind,x,y})=>({id,kind,x,y})),jobs:s.jobs.map(j=>({id:j.id,status:j.status})),value:s.value,status:s.status});
 const total=scenario.jobs.reduce((n,j)=>n+j.value,0);
 return {seed:scenario.seed,score:100*s.value/total,value:s.value,total,status:s.status,ticks:s.tick,invalidActions:s.invalid,deliveredAt:s.deliveredAt,error:s.error,errorInput:s.errorInput,...(trace?{replay,actions}: {})};
}
export function summarize(rows) {
 const mean=rows.reduce((n,r)=>n+r.score,0)/rows.length;
 const variance=rows.reduce((n,r)=>n+(r.score-mean)**2,0)/Math.max(1,rows.length-1);
 const counts={};for(const r of rows)counts[r.status]=(counts[r.status]??0)+1;
 return {episodes:rows.length,score:mean,standardDeviation:Math.sqrt(variance),standardError:Math.sqrt(variance/rows.length),outcomes:counts,invalidActions:rows.reduce((n,r)=>n+r.invalidActions,0),worst:rows.slice().sort((a,b)=>a.score-b.score).slice(0,5).map(({seed,score,status,ticks,error})=>({seed,score,status,ticks,error}))};
}
