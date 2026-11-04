import {brandSvg} from './model-identity.js';
import {envelope,projectTurn,nextAxes} from './map-geometry.js';

const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const svgNode=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const attr=(n,values)=>{for(const [k,v]of Object.entries(values))n.setAttribute(k,v);};
const average=values=>values.reduce((a,b)=>a+b,0)/values.length;

export function rotatingMap(root,{axes,runs,axisValue,name,color}){
  // Keep the same eligible rounds through the entire choice-derived tour.
  const dimensions=axes.filter(a=>a.kind==='ballot-index'&&a.items?.length>1);
  const pool=dimensions.map(a=>a.id),definitions=new Map(dimensions.map(a=>[a.id,a]));
  if(pool.length<3){root.hidden=true;return {update(){}};}
  let current=['public-investment','governance-constraints','redistributive-taxation'];
  if(current.some(id=>!pool.includes(id)))current=pool.slice(0,3);
  let cursor=3,vertical=false,angle=.35,groups=[],frame=null,last=null,onscreen=true,hovered=false,touchSlow=false,focused=false,speed=1;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const axisList=node('div',undefined,'rotation-axes');
  const axisRows=Array.from({length:3},()=>{const label=node('span');axisList.append(label);return label;});
  const scene=node('div',undefined,'rotation-scene');
  scene.tabIndex=0;scene.setAttribute('role','button');
  scene.setAttribute('aria-label','Animated model ballot map. Tap or press Enter to toggle slow motion; hover to slow.');
  scene.setAttribute('aria-pressed','false');
  const svg=svgNode('svg',{'aria-hidden':'true'});
  const cube=svgNode('g'),areas=svgNode('g'),dots=svgNode('g'),means=svgNode('g');svg.append(cube,areas,dots,means);scene.append(svg);
  root.replaceChildren(axisList,scene);
  const corners=[];for(const h of [-10,10])for(const v of [-10,10])for(const d of [-10,10])corners.push([h,v,d]);
  const segments=[];
  for(let i=0;i<corners.length;i++)for(let j=i+1;j<corners.length;j++)if(corners[i].filter((n,k)=>n!==corners[j][k]).length===1)segments.push([corners[i],corners[j]]);
  for(const n of [-5,0,5])segments.push([[-10,n,-10],[10,n,-10]],[[n,-10,-10],[n,10,-10]]);
  const edges=segments.map(()=>{const e=svgNode('line',{class:'rotation-edge'});cube.append(e);return e;});
  let plotWidth=600,plotHeight=420,scale=12,cx=300,cy=210;
  const project=values=>{const [x,y]=projectTurn(values,angle,vertical);return {x:cx+x*scale,y:cy-y*scale};};
  const point=r=>project(current.map(id=>axisValue(r,id)));

  function updateAxes(animate=false){
    current.forEach((id,i)=>{axisRows[i].textContent=definitions.get(id).label;});
    if(animate&&!reduced.matches){
      axisList.getAnimations().forEach(a=>a.cancel());
      axisList.animate([{opacity:.15,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:500,easing:'ease-out'});
    }
  }
  function advance(){const next=nextAxes(current,pool,cursor,vertical);current=next.axes;cursor=next.cursor;vertical=!vertical;angle-=Math.PI/2;updateAxes(true);}
  function resize(){plotWidth=Math.max(240,scene.clientWidth);plotHeight=Math.max(250,Math.min(450,plotWidth*.68));cx=plotWidth/2;cy=plotHeight/2;scale=Math.min((plotWidth-64)/35,(plotHeight-48)/35);attr(svg,{viewBox:`0 0 ${plotWidth} ${plotHeight}`});draw();}
  function draw(){
    segments.forEach(([a,b],i)=>{const p=project(a),q=project(b);attr(edges[i],{x1:p.x,y1:p.y,x2:q.x,y2:q.y});});
    for(const g of groups){
      const ps=g.rows.map(point),m=project(current.map(id=>average(g.rows.map(r=>axisValue(r,id)))));
      const hull=envelope(ps);g.area.setAttribute('d',hull.length>1?`M${hull.map(p=>`${p.x},${p.y}`).join('L')}${hull.length>2?'Z':''}`:'');
      ps.forEach((p,i)=>attr(g.dots[i],{cx:p.x,cy:p.y}));
      attr(g.mark,{transform:`translate(${m.x},${m.y})`});
    }
    // Decorative projection: fixed model order, never depth-sort at axis swaps.
  }
  function running(){return !reduced.matches&&onscreen&&!document.hidden;}
  function tick(now){
    frame=null;if(!running()){last=null;return;}
    const delta=last===null?0:Math.min(80,now-last);last=now;
    const target=(hovered||touchSlow||focused) ? .15 : 1;
    speed+=(target-speed)*(1-Math.exp(-delta/220));
    angle+=delta/3000*Math.PI/2*speed;if(angle>=Math.PI/2)advance();
    draw();frame=requestAnimationFrame(tick);
  }
  function schedule(){if(running()&&frame===null){last=null;frame=requestAnimationFrame(tick);}else if(!running()&&frame!==null){cancelAnimationFrame(frame);frame=null;last=null;}}
  scene.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')hovered=true;});
  scene.addEventListener('pointerleave',()=>{hovered=false;});
  scene.addEventListener('click',()=>{touchSlow=!touchSlow;scene.setAttribute('aria-pressed',String(touchSlow));});
  scene.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();scene.click();}});
  scene.addEventListener('focusin',()=>{focused=scene.matches(':focus-visible');});
  scene.addEventListener('focusout',()=>{focused=false;});
  document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);
  new IntersectionObserver(entries=>{onscreen=entries[0].isIntersecting;schedule();}).observe(root);
  new ResizeObserver(resize).observe(scene);
  function update(nextRuns){
    runs=nextRuns;
    const eligible=runs.filter(r=>r.status==='completed'&&r.validation?.valid===true&&pool.every(id=>Number.isFinite(axisValue(r,id))));
    // Sort by identity once, independent of projection, filter, and depth.
    const modelIds=[...new Set(eligible.map(r=>r.model))].sort();
    means.replaceChildren();dots.replaceChildren();areas.replaceChildren();groups=[];
    for(const model of modelIds){
      const rows=eligible.filter(r=>r.model===model);
      const area=svgNode('path',{fill:color(model),stroke:color(model),'fill-opacity':.06,'stroke-opacity':.25,'stroke-width':1});areas.append(area);
      const marks=rows.map(()=>{const d=svgNode('circle',{fill:color(model),r:2.5,opacity:.45});dots.append(d);return d;});
      const mark=svgNode('g',{class:'rotation-model','data-model':model,style:`color:${color(model)}`});
      const ring=svgNode('circle',{fill:'var(--bg)',stroke:color(model),r:11,'stroke-width':1});const logo=brandSvg(model,18);attr(logo,{x:-9,y:-9});mark.append(ring,logo);means.append(mark);
      const title=svgNode('title');title.textContent=name(model);mark.append(title);
      groups.push({model,rows,area,dots:marks,mark});
    }
    updateAxes();resize();schedule();
  }
  update(runs);
  return {update};
}
