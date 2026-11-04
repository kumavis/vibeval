import {brandSvg} from './model-identity.js';
import {envelope,projectHero,nextHeroAxes,heroAngle,heroWallOpacity} from './map-geometry.js';

const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const svgNode=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const attr=(n,values)=>{for(const [k,v]of Object.entries(values))n.setAttribute(k,v);};
const average=values=>values.reduce((a,b)=>a+b,0)/values.length;

export function rotatingMap(root,{axes,runs,axisValue,name,color}){
  // Keep the same eligible rounds through the entire choice-derived tour.
  const dimensions=axes.filter(a=>a.kind==='ballot-index'&&a.items?.length>1);
  const pool=dimensions.map(a=>a.id),axisNames=new Map(dimensions.map(a=>[a.id,a.label]));
  if(pool.length<3){root.hidden=true;return {update(){}};}
  let current=['public-investment','governance-constraints','redistributive-taxation'];
  if(current.some(id=>!pool.includes(id)))current=pool.slice(0,3);
  let cursor=3,elapsed=0,angle=heroAngle(0),groups=[],frame=null,last=null,onscreen=true,hovered=false,touchSlow=false,focused=false,speed=1;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const scene=node('div',undefined,'rotation-scene');
  scene.tabIndex=0;scene.setAttribute('role','button');
  scene.setAttribute('aria-label','Animated model ballot map. Tap or press Enter to toggle slow motion; hover to slow.');
  scene.setAttribute('aria-pressed','false');
  const svg=svgNode('svg',{'aria-hidden':'true'});
  const walls=svgNode('g'),cube=svgNode('g'),areas=svgNode('g'),dots=svgNode('g'),means=svgNode('g'),frontEdges=svgNode('g',{class:'rotation-front-edges'});svg.append(walls,cube,areas,dots,means,frontEdges);scene.append(svg);
  const axisLabels=node('div',undefined,'rotation-axis-labels');
  const axisValues=['X','Y','Z'].map(letter=>{
    const item=node('div',undefined,'rotation-axis-item'),value=node('span',undefined,'rotation-axis-name');
    item.append(node('span',letter,'rotation-axis-letter'),value);axisLabels.append(item);return value;
  });
  root.replaceChildren(scene,axisLabels);
  function updateAxisLabels(animate=false){
    current.forEach((id,i)=>{
      const value=axisValues[i];if(value.dataset.axis===id)return;
      value.dataset.axis=id;value.textContent=axisNames.get(id);
      value.getAnimations().forEach(animation=>animation.cancel());
      if(animate&&!reduced.matches)value.animate(
        [{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],
        {duration:450,easing:'ease-out'}
      );
    });
  }
  updateAxisLabels();
  const corners=[];for(const h of [-10,10])for(const v of [-10,10])for(const d of [-10,10])corners.push([h,v,d]);
  const segments=[];
  for(let i=0;i<corners.length;i++)for(let j=i+1;j<corners.length;j++)if(corners[i].filter((n,k)=>n!==corners[j][k]).length===1)segments.push([corners[i],corners[j]]);
  const edges=segments.map(()=>{const e=svgNode('line',{class:'rotation-edge'});cube.append(e);return e;});
  const wallGrids=[];
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
    const normal=[0,0,0];normal[axis]=sign;
    const group=svgNode('g',{class:'rotation-wall-grid','data-wall':`${axis}:${sign}`});walls.append(group);
    const free=[0,1,2].filter(k=>k!==axis),lines=[];
    for(const fixed of free)for(const offset of [-5,0,5]){
      const moving=free.find(k=>k!==fixed),a=[0,0,0],b=[0,0,0];
      a[axis]=b[axis]=10*sign;a[fixed]=b[fixed]=offset;a[moving]=-10;b[moving]=10;
      const line=svgNode('line',{class:'rotation-grid-line'});group.append(line);lines.push({a,b,line});
    }
    wallGrids.push({normal,group,lines});
  }
  let plotWidth=600,plotHeight=420,scale=12,cx=300,cy=210;
  const project=values=>{const [x,y,z]=projectHero(values,angle);return {x:cx+x*scale,y:cy-y*scale,z};};
  const point=r=>project(current.map(id=>axisValue(r,id)));

  function changeDimension(boundary){
    const next=nextHeroAxes(current,pool,cursor,boundary);current=next.axes;cursor=next.cursor;updateAxisLabels(true);
  }
  function resize(){plotWidth=Math.max(240,scene.clientWidth);plotHeight=Math.max(250,Math.min(450,plotWidth*.68));cx=plotWidth/2;cy=plotHeight/2;scale=Math.min((plotWidth-64)/35,(plotHeight-48)/35);attr(svg,{viewBox:`0 0 ${plotWidth} ${plotHeight}`});draw();}
  function draw(){
    for(const {normal,group,lines} of wallGrids){
      group.setAttribute('opacity',heroWallOpacity(normal,angle));
      for(const {a,b,line} of lines){const p=project(a),q=project(b);attr(line,{x1:p.x,y1:p.y,x2:q.x,y2:q.y});}
    }
    segments.forEach(([a,b],i)=>{
      const p=project(a),q=project(b),edge=edges[i];
      // Edges bordering a camera-facing exterior face occlude interior marks.
      const foreground=a.some((value,k)=>{
        if(value!==b[k])return false;
        const normal=[0,0,0];normal[k]=Math.sign(value);
        return projectHero(normal,angle)[2]>1e-8;
      });
      const layer=foreground?frontEdges:cube;
      if(edge.parentNode!==layer)layer.append(edge);
      // Continuous camera-space depth cues reduce front/back ambiguity.
      const near=Math.max(0,Math.min(1,.5+(p.z+q.z)/(4*Math.sqrt(300))));
      attr(edge,{x1:p.x,y1:p.y,x2:q.x,y2:q.y,opacity:.25+.75*near});
      edge.style.strokeWidth=String(.65+1.6*near);
      edge.style.stroke=`color-mix(in srgb, var(--ink) ${Math.round(65*near)}%, var(--line))`;
    });
    const depthOrder=[];
    for(const g of groups){
      const ps=g.rows.map(point),m=project(current.map(id=>average(g.rows.map(r=>axisValue(r,id)))));
      const hull=envelope(ps);g.area.setAttribute('d',hull.length>1?`M${hull.map(p=>`${p.x},${p.y}`).join('L')}${hull.length>2?'Z':''}`:'');
      ps.forEach((p,i)=>attr(g.dots[i],{cx:p.x,cy:p.y}));
      attr(g.mark,{transform:`translate(${m.x},${m.y})`,'data-depth':m.z});
      depthOrder.push({mark:g.mark,depth:m.z});
    }
    // Positive camera-space depth is nearer. Stable ties retain model order;
    // move SVG nodes only when their actual occlusion order changes.
    depthOrder.sort((a,b)=>a.depth-b.depth);
    depthOrder.forEach(({mark},i)=>{if(means.children[i]!==mark)means.insertBefore(mark,means.children[i]??null);});
  }
  function running(){return !reduced.matches&&onscreen&&!document.hidden;}
  function tick(now){
    frame=null;if(!running()){last=null;return;}
    const delta=last===null?0:Math.min(80,now-last);last=now;
    const target=(hovered||touchSlow||focused) ? .15 : 1;
    speed+=(target-speed)*(1-Math.exp(-delta/220));
    const previous=angle;elapsed+=delta*speed;angle=heroAngle(elapsed);
    const before=Math.floor(previous/(Math.PI/2)),after=Math.floor(angle/(Math.PI/2));
    if(after>before)for(let q=before+1;q<=after;q++)changeDimension(q);
    if(after<before)for(let q=before;q>after;q--)changeDimension(q);
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
    // Identity order provides a deterministic tie-break for equal depths.
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
    resize();schedule();
  }
  update(runs);
  return {update};
}
