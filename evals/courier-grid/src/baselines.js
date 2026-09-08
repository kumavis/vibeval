// Baselines are ordinary controllers. The certifier uses full enemy positions;
// the three reported baselines receive exactly the model's partial observation.
export function baseline(mode='risk',variant=0) {
 return (o,m={})=>{
  m=m||{};const w=o.width,n=w*o.height,idx=p=>p.y*w+p.x,c=o.courier;
  const ds=[[0,-1,'N'],[1,0,'E'],[0,1,'S'],[-1,0,'W']];
  const walk=p=>o.map[p.y]?.[p.x]==='.';
  function search(start,risk=false){
   const d=Array(n).fill(Infinity),first=Array(n);d[idx(start)]=0;
   // Tiny heap Dijkstra keeps risk-aware routing cheap.
   const heap=[[0,start.x,start.y]];
   const push=v=>{let i=heap.length;heap.push(v);while(i){let p=(i-1)>>1;if(heap[p][0]<=v[0])break;heap[i]=heap[p];i=p;}heap[i]=v;};
   const pop=()=>{const root=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][0]<heap[j][0])j++;if(heap[j][0]>=last[0])break;heap[i]=heap[j];i=j;}heap[i]=last;}return root;};
   while(heap.length){const [cost,x,y]=pop();if(cost!==d[y*w+x])continue;
    for(const [dx,dy,dir]of ds){const p={x:x+dx,y:y+dy};if(!walk(p))continue;
     let penalty=0;
     if(risk)for(const e of o.enemies){const delta=Math.abs(p.x-e.x)+Math.abs(p.y-e.y);penalty+=delta===0?1000:delta===1?45:delta===2?16:delta===3?6:delta===4?2:0;}
     const next=cost+1+penalty,i=idx(p);if(next<d[i]){d[i]=next;first[i]=cost===0?dir:first[y*w+x];push([next,p.x,p.y]);}
    }
   }return {d,first};
  }
  const risk=mode==='risk'||mode==='oracle',routes=search(c,risk),plain=search(c),nearestCharger=o.chargers.slice().sort((a,b)=>plain.d[idx(a)]-plain.d[idx(b)])[0];
  const cargo=o.jobs.filter(j=>j.status==='carried'),available=o.jobs.filter(j=>j.status==='available');
  const at=p=>c.x===p.x&&c.y===p.y;
  const weight=cargo.reduce((s,j)=>s+j.weight,0),energy=weight>3?2:1;
  let target,job;
  const reserve=mode==='greedy'?3:10+variant%4;
  if(o.chargers.some(at)&&c.battery<75)return {action:{type:'charge'},memory:m};
  if(c.battery<=plain.d[idx(nearestCharger)]*energy+reserve)target=nearestCharger;
  else if(cargo.length){job=cargo.slice().sort((a,b)=>routes.d[idx(a.to)]-routes.d[idx(b.to)])[0];target=job.to;}
  else {
   let candidates=available.map(j=>{
    const onward=search(j.from).d[idx(j.to)];const distance=routes.d[idx(j.from)]+onward+2;
    const reward=mode==='greedy'?1:j.value**(1+(variant%3)*.18);
    return {j,d:mode==='greedy'?plain.d[idx(j.from)]:distance/reward, feasible:o.tick+plain.d[idx(j.from)]+onward+2<=j.deadline};
   }).filter(x=>mode==='greedy'||x.feasible).sort((a,b)=>a.d-b.d);
   if(candidates.length){job=candidates[0].j;target=job.from;}
  }
  if(!target)return {action:{type:'wait'},memory:m};
  if(at(target)){
   if(o.chargers.some(at)&&c.battery<75)return {action:{type:'charge'},memory:m};
   if(job)return {action:job.status==='carried'?{type:'deliver'}:{type:'pickup',id:job.id},memory:m};
  }
  const dir=routes.first[idx(target)];return {action:dir?{type:'move',dir}:{type:'wait'},memory:m};
 };
}
