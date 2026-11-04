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

// Two-axis motion follows one smooth path. Pitch is zero at aligned faces,
// allowing invisible dimension swaps without resetting either rotation.
export function projectHero([h,v,d], angle) {
  const c=Math.cos(angle),s=Math.sin(angle),pitch=.38*Math.sin(2*angle),roll=.18;
  const x=h*c+d*s,z=d*c-h*s;
  const y=v*Math.cos(pitch)-z*Math.sin(pitch),depth=v*Math.sin(pitch)+z*Math.cos(pitch);
  return [x*Math.cos(roll)-y*Math.sin(roll),x*Math.sin(roll)+y*Math.cos(roll),depth];
}
// Peak yaw speed matches a 4.5-second quarter-turn. Reversals ease through
// zero velocity every 36 seconds, independently of political-axis swaps.
export function heroAngle(milliseconds) {
  return .35+4*Math.sin(milliseconds*Math.PI/36000);
}
export function heroWallOpacity(normal,angle) {
  // Negative outward-normal depth identifies a far wall whose inside faces us.
  return Math.min(1,Math.max(0,-projectHero(normal,angle)[2]*4));
}
export function nextHeroAxes(current,pool,cursor,quarter) {
  const hidden=Math.abs(quarter)%2===1?0:2;
  for(let n=0;n<pool.length;n++){
    const index=(cursor+n)%pool.length,id=pool[index];
    if(!current.includes(id)){
      const axes=[...current];axes[hidden]=id;
      return {axes,cursor:(index+1)%pool.length};
    }
  }
  return {axes:[...current],cursor};
}
