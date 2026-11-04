import {brandSvg} from './model-identity.js';
import {envelope,projectTurn,nextAxes} from './map-geometry.js';

const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const svgNode=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const attr=(n,values)=>{for(const [k,v]of Object.entries(values))n.setAttribute(k,v);};
const average=values=>values.reduce((a,b)=>a+b,0)/values.length;
const fmt=n=>Number.isFinite(n)?`${n>0?'+':''}${n.toFixed(1)}`:'—';

export function rotatingMap(root,{axes,runs,axisValue,name,color,onInspect}){
  // Only multi-measure, choice-derived dimensions. Self-assessments and
  // single-proposition indicators never enter the automatic tour.
  const dimensions=axes.filter(a=>a.kind==='ballot-index'&&a.items?.length>1);
  const pool=dimensions.map(a=>a.id),definitions=new Map(dimensions.map(a=>[a.id,a]));
  if(pool.length<3){root.textContent='The rotating map needs at least three choice-derived dimensions.';return {update(){}};}
  let current=['public-investment','governance-constraints','redistributive-taxation'];
  if(current.some(id=>!pool.includes(id)))current=pool.slice(0,3);
  let cursor=3,vertical=false,angle=.35,eligible=[],groups=[],highlight=null,frame=null,last=null,onscreen=true,hovered=false,focused=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');let paused=reduced.matches;
  const heading=node('div',undefined,'rotation-heading');
  const title=node('div');title.append(node('p','CHOICES IN MOTION','eyebrow'),node('h2','One ballot. Many dimensions.'));
  const controls=node('div',undefined,'rotation-controls'),toggle=node('button'),next=node('button','Next projection');toggle.type=next.type='button';controls.append(toggle,next);heading.append(title,controls);
  const layout=node('div',undefined,'rotation-layout'),scene=node('div',undefined,'rotation-scene');
  const svg=svgNode('svg',{role:'group','aria-label':'Rotating ballot-choice map. Brand icons are model means; small dots and shaded envelopes show individual rounds. Use Pause rotation to inspect.'});
  const svgTitle=svgNode('title');svgTitle.textContent='Seven ballot-derived dimensions, projected three at a time';svg.append(svgTitle);
  const cube=svgNode('g',{'aria-hidden':'true'}),areas=svgNode('g',{'aria-hidden':'true'}),dots=svgNode('g',{'aria-hidden':'true'}),means=svgNode('g'),labels=svgNode('g',{'aria-hidden':'true'});svg.append(cube,areas,dots,means,labels);scene.append(svg);
  const aside=node('div',undefined,'rotation-aside'),axisList=node('div',undefined,'rotation-axes');
  const axisRows=Array.from({length:3},()=>{const box=node('div'),label=node('strong'),poles=node('p');box.append(label,poles);axisList.append(box);return {label,poles};});
  const chooseLabel=node('label','Highlight model'),choose=node('select');choose.id='hero-model';chooseLabel.htmlFor=choose.id;chooseLabel.append(choose);
  const detail=node('p',undefined,'rotation-detail');detail.setAttribute('aria-live','polite');
  const inspect=node('button','Inspect a ballot');inspect.type='button';
  const rules=node('details'),ruleTitle=node('summary','How these scores are calculated'),ruleBody=node('div');rules.append(ruleTitle,ruleBody);
  const population=node('p',undefined,'rotation-population');
  aside.append(axisList,chooseLabel,detail,inspect,rules,population);layout.append(scene,aside);
  const note=node('p','Brand icons = model means · Dots and areas = observed rounds · Hover to pause; select an icon to highlight its rounds.','chart-note');
  root.replaceChildren(heading,layout,note);
  const corners=[];for(const h of [-10,10])for(const v of [-10,10])for(const d of [-10,10])corners.push([h,v,d]);
  const segments=[];
  for(let i=0;i<corners.length;i++)for(let j=i+1;j<corners.length;j++)if(corners[i].filter((n,k)=>n!==corners[j][k]).length===1)segments.push([corners[i],corners[j]]);
  for(const n of [-5,0,5])segments.push([[-10,n,-10],[10,n,-10]],[[n,-10,-10],[n,10,-10]]);
  const edges=segments.map(()=>{const e=svgNode('line',{class:'rotation-edge'});cube.append(e);return e;});
  const axisEnds=[[10,-10,-10],[-10,10,-10],[-10,-10,10]];
  const axisLabels=axisEnds.map(()=>{const t=svgNode('text',{class:'rotation-axis-label'});labels.append(t);return t;});
  let plotWidth=600,plotHeight=460,scale=12,cx=300,cy=230;
  const project=values=>{const [x,y,z]=projectTurn(values,angle,vertical);return {x:cx+x*scale,y:cy-y*scale,z};};
  const point=r=>project(current.map(id=>axisValue(r,id)));

  function setHighlight(model){highlight=model;choose.value=model;updateDetails();draw();}
  function updateDetails(){
    const g=groups.find(g=>g.model===highlight);inspect.disabled=!g;
    detail.textContent=g?`${g.rows.length}/3 rounds eligible · ${current.map(id=>`${definitions.get(id).label}: ${fmt(average(g.rows.map(r=>axisValue(r,id))))}`).join(' · ')}`:'No rounds have enough evidence across the tour dimensions.';
    for(const g of groups){g.mark.setAttribute('aria-pressed',String(g.model===highlight));g.mark.setAttribute('aria-label',`${name(g.model)}: highlight ${g.rows.length} rounds. ${current.map(id=>`${definitions.get(id).label} ${fmt(average(g.rows.map(r=>axisValue(r,id))))}`).join('; ')}`);}
  }
  function updateAxes(){
    current.forEach((id,i)=>{const a=definitions.get(id);axisRows[i].label.textContent=`${['X','Y','Z'][i]} · ${a.label}`;axisRows[i].poles.textContent=`−10 ${a.lowLabel} · +10 ${a.highLabel}`;});
    ruleBody.replaceChildren(node('p','The tour keeps the same rounds across all seven multi-measure indices. The 2D chart below uses each pair’s eligible rounds. Overlapping indices are not independent traits. Axes change only when hidden edge-on; intermediate projections are animation, not new scores.'));
    for(const id of current){const a=definitions.get(id),p=node('p');p.append(node('strong',a.label+' '),document.createTextNode(`Mean of answered item scores; minimum ${a.minAnswered}/${a.items.length}. `+a.items.map(i=>`${i.contestId.replace('ca-proposition-','Prop. ').replace('alameda-measure-rtm','RTM')}: Yes ${i.yesScore}, No ${i.noScore}`).join('; ')));ruleBody.append(p);}
    updateDetails();
  }
  function advance(){const next=nextAxes(current,pool,cursor,vertical);current=next.axes;cursor=next.cursor;vertical=!vertical;angle=0;updateAxes();}
  function resize(){plotWidth=Math.max(260,scene.clientWidth);plotHeight=Math.max(320,Math.min(540,plotWidth*.8));cx=plotWidth/2;cy=plotHeight/2;scale=Math.min((plotWidth-100)/31,(plotHeight-70)/29);attr(svg,{viewBox:`0 0 ${plotWidth} ${plotHeight}`});draw();}
  function draw(){
    const origin=project([-10,-10,-10]);
    segments.forEach(([a,b],i)=>{const p=project(a),q=project(b);attr(edges[i],{x1:p.x,y1:p.y,x2:q.x,y2:q.y});});
    axisEnds.forEach((end,i)=>{const p=project(end),dx=p.x-origin.x,dy=p.y-origin.y,length=Math.hypot(dx,dy),t=axisLabels[i];const hidden=length<30;t.style.opacity=hidden?'0':'1';
      // Labels stay at separate cube-edge midpoints; full names and endpoints
      // remain visible alongside the plot at every rotation angle.
      const x=(p.x+origin.x)/2,y=(p.y+origin.y)/2;
      attr(t,{x:Math.max(22,Math.min(plotWidth-22,x+(i===1?-15:0))),y:Math.max(20,Math.min(plotHeight-12,y+(i===1?0:22))),'text-anchor':i===1?'end':'middle'});
      t.textContent=['X','Y','Z'][i];
    });
    const ordered=[];
    for(const g of groups){
      const ps=g.rows.map(point),m=project(current.map(id=>average(g.rows.map(r=>axisValue(r,id))))),chosen=g.model===highlight;
      const hull=envelope(ps);g.area.setAttribute('d',hull.length>1?`M${hull.map(p=>`${p.x},${p.y}`).join('L')}${hull.length>2?'Z':''}`:'');
      attr(g.area,{'fill-opacity':chosen ? .18 : .045,'stroke-opacity':chosen ? .8 : .2,'stroke-width':chosen?2:1});
      ps.forEach((p,i)=>{attr(g.dots[i],{cx:p.x,cy:p.y,r:chosen?4:2.5,opacity:chosen?1:.45});attr(g.links[i],{x1:m.x,y1:m.y,x2:p.x,y2:p.y,opacity:chosen ? .6 : 0});});
      attr(g.mark,{transform:`translate(${m.x},${m.y})`});attr(g.ring,{r:chosen?14:11,'stroke-width':chosen?2.5:1});
      ordered.push({g,z:m.z});
    }
    // Reorder only when depth order changes so focused controls retain focus.
    ordered.sort((a,b)=>a.z-b.z);const active=ordered.findIndex(o=>o.g.model===highlight);if(active>=0)ordered.push(...ordered.splice(active,1));
    ordered.forEach(({g},i)=>{if(means.children[i]!==g.mark)means.insertBefore(g.mark,means.children[i]??null);});
  }
  function running(){return !paused&&!hovered&&!focused&&onscreen&&!document.hidden;}
  function tick(now){frame=null;if(!running()){last=null;return;}const delta=last===null?0:Math.min(80,now-last);last=now;angle+=delta/12000*Math.PI/2;if(angle>=Math.PI/2)advance();draw();frame=requestAnimationFrame(tick);}
  function schedule(){toggle.textContent=paused?'Resume rotation':'Pause rotation';toggle.setAttribute('aria-pressed',String(paused));if(running()&&frame===null){last=null;frame=requestAnimationFrame(tick);}else if(!running()&&frame!==null){cancelAnimationFrame(frame);frame=null;last=null;}}
  toggle.onclick=()=>{paused=!paused;schedule();};next.onclick=()=>{advance();draw();};choose.onchange=()=>setHighlight(choose.value);
  inspect.onclick=()=>{const row=groups.find(g=>g.model===highlight)?.rows[0];if(row)onInspect(row.id);};
  scene.addEventListener('pointerenter',()=>{hovered=true;schedule();});scene.addEventListener('pointerleave',()=>{hovered=false;schedule();});
  scene.addEventListener('focusin',()=>{focused=true;schedule();});scene.addEventListener('focusout',e=>{if(!scene.contains(e.relatedTarget)){focused=false;schedule();}});
  document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',()=>{paused=reduced.matches;schedule();});
  new IntersectionObserver(entries=>{onscreen=entries[0].isIntersecting;schedule();}).observe(root);
  new ResizeObserver(resize).observe(scene);
  function update(nextRuns){
    runs=nextRuns;
    eligible=runs.filter(r=>r.status==='completed'&&r.validation?.valid===true&&pool.every(id=>Number.isFinite(axisValue(r,id))));
    const modelIds=[...new Set(runs.map(r=>r.model))];choose.replaceChildren();means.replaceChildren();dots.replaceChildren();areas.replaceChildren();groups=[];
    for(const model of modelIds){
      const rows=eligible.filter(r=>r.model===model),option=node('option',`${name(model)}${rows.length?'':' · no eligible rounds'}`);option.value=model;option.disabled=!rows.length;choose.append(option);if(!rows.length)continue;
      const area=svgNode('path',{fill:color(model),stroke:color(model)});areas.append(area);
      const links=rows.map(()=>{const l=svgNode('line',{stroke:color(model),'stroke-width':1});areas.append(l);return l;});
      const marks=rows.map(()=>{const d=svgNode('circle',{fill:color(model)});dots.append(d);return d;});
      const mark=svgNode('g',{role:'button',tabindex:0,class:'rotation-model',style:`color:${color(model)}`});
      const ring=svgNode('circle',{fill:'var(--bg)',stroke:color(model),r:11});const logo=brandSvg(model,18);attr(logo,{x:-9,y:-9});mark.append(ring,logo);means.append(mark);
      const title=svgNode('title');title.textContent=`${name(model)} · ${rows.length} eligible rounds`;mark.append(title);
      mark.onclick=()=>setHighlight(model);mark.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setHighlight(model);}};
      groups.push({model,rows,area,links,dots:marks,mark,ring});
    }
    if(!groups.some(g=>g.model===highlight))highlight=groups[0]?.model??null;choose.value=highlight??'';choose.disabled=!groups.length;
    population.textContent=`${eligible.length}/${runs.filter(r=>r.status==='completed'&&r.validation?.valid===true).length} valid rounds · fixed sample across ${pool.length} choice-derived tour dimensions.`;
    updateAxes();resize();schedule();
  }
  update(runs);
  return {update};
}
