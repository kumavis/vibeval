// Convex envelope of the observed rounds. Duplicates collapse; collinear
// observations produce their two endpoints, never an artificial area.
export function envelope(points) {
  const sorted=[...new Map(points.map(p=>[`${p.x},${p.y}`,p])).values()].sort((a,b)=>a.x-b.x||a.y-b.y);
  if(sorted.length<3)return sorted;
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=list=>{const out=[];for(const p of list){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=1e-9)out.pop();out.push(p);}return out;};
  return [...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
}

// A quarter-turn alternates horizontal/depth and vertical/depth planes.
// At the boundary the departing axis is exactly edge-on and can be replaced.
export function projectTurn([h,v,d], angle, vertical=false) {
  const c=Math.cos(angle),s=Math.sin(angle);
  const [x,y,z]=vertical?[h,v*c+d*s,d*c-v*s]:[h*c+d*s,v,d*c-h*s];
  // A gentle bank reveals the cube's depth between aligned faces. It returns
  // to zero at both boundaries, preserving the invisible-axis swap exactly.
  const bank=.35*Math.sin(angle*2),bc=Math.cos(bank),bs=Math.sin(bank);
  return vertical?[x*bc+z*bs,y,z*bc-x*bs]:[x,y*bc+z*bs,z*bc-y*bs];
}
export function nextAxes(current, pool, cursor, vertical=false) {
  const visible=vertical?[current[0],current[2]]:[current[2],current[1]];
  for(let n=0;n<pool.length;n++){
    const index=(cursor+n)%pool.length,id=pool[index];
    if(!visible.includes(id)&&id!==current[vertical?1:0])return {axes:[...visible,id],cursor:(index+1)%pool.length};
  }
  return {axes:[...visible,current[vertical?1:0]],cursor};
}
