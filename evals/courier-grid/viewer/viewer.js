import {el,json} from '../../shared/dom.js';
const $=s=>document.querySelector(s),fmt=n=>Number(n).toFixed(1),label=r=>r.model.requested.replace('gpt-5.6-','').replace(/^./,c=>c.toUpperCase())+' · '+r.harness.version.replace('submission-','');
let selectedRun,detail,current,index=0,tick=0,timer=null,selection=0;
const cache=new Map(),board=$('#board'),ctx=board.getContext('2d'),timeline=$('#timeline'),tx=timeline.getContext('2d');
function stop(){clearInterval(timer);timer=null;$('#play').textContent='Play replay';}
function draw(){
 if(!current)return;const frames=current.replay??[],f=frames[tick];
 ctx.fillStyle='#101820';ctx.fillRect(0,0,720,720);
 if(!f){tx.clearRect(0,0,600,180);$('#parcels').replaceChildren();$('#action').textContent='';timeline.setAttribute('aria-valuemax','0');timeline.setAttribute('aria-valuenow','0');ctx.fillStyle='#eef4fc';ctx.font='20px system-ui';ctx.fillText('No replay: controller failed before its first action.',22,350);$('#tick-summary').textContent=current.error??'Replay unavailable';return;}
 const cell=30,center=p=>[p.x*cell+cell/2,p.y*cell+cell/2];
 for(let y=0;y<24;y++)for(let x=0;x<24;x++){ctx.fillStyle=current.map[y][x]==='#'?'#263541':'#111c24';ctx.fillRect(x*cell+1,y*cell+1,cell-2,cell-2);}
 ctx.font='bold 20px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
 for(const p of current.chargers){ctx.fillStyle='#96bbff';ctx.fillText('+',...center(p));}
 for(const j of current.jobs){const state=f.jobs.find(x=>x.id===j.id)?.status;if(['expired','delivered'].includes(state))continue;const [dx,dy]=center(j.to);ctx.strokeStyle='#a8bbd7';ctx.lineWidth=2;ctx.strokeRect(dx-9,dy-9,18,18);ctx.font='11px monospace';ctx.fillStyle='#a8bbd7';ctx.fillText(j.id.slice(1),dx,dy);if(state==='available'){const[x,y]=center(j.from);ctx.fillStyle='#ebc981';ctx.fillRect(x-8,y-8,16,16);ctx.fillStyle='#101820';ctx.fillText(j.id.slice(1),x,y);}}
 // Draw traveled path softly; the courier remains the singleton focal point.
 ctx.beginPath();for(let i=0;i<=tick;i++){const p=center(frames[i].courier);i?ctx.lineTo(...p):ctx.moveTo(...p);}ctx.strokeStyle='#8ce7ba45';ctx.lineWidth=3;ctx.stroke();
 for(const e of f.enemies){const[x,y]=center(e);ctx.globalAlpha=(f.visibleEnemyIds??f.enemies.filter(e=>Math.abs(e.x-f.courier.x)+Math.abs(e.y-f.courier.y)<=6).map(e=>e.id)).includes(e.id)?1:.3;ctx.fillStyle='#ff927b';ctx.beginPath();ctx.moveTo(x,y-11);ctx.lineTo(x+10,y);ctx.lineTo(x,y+11);ctx.lineTo(x-10,y);ctx.closePath();ctx.fill();ctx.globalAlpha=1;}
 const[x,y]=center(f.courier);ctx.fillStyle='#8ce7ba';ctx.beginPath();ctx.arc(x,y,10,0,2*Math.PI);ctx.fill();ctx.strokeStyle='#0c1016';ctx.lineWidth=3;ctx.stroke();
 $('#tick-summary').textContent=`Tick ${f.tick} / 300 · battery ${f.courier.battery} / 90 · ${f.courier.cargo.length} carried · ${f.value} / ${current.total} value delivered`;
 $('#action').textContent=f.action?`Action: ${f.action.type}${f.action.dir?' '+f.action.dir:''}${f.action.id?' '+f.action.id:''}`:`Ended: ${current.status}`;
 $('#parcels').replaceChildren(...current.jobs.map(j=>{const state=f.jobs.find(x=>x.id===j.id)?.status;return el('div',{class:'parcel-row '+state},el('span',{},`${j.id} · ${j.value} value · ${j.weight} weight`),el('span',{},`${state} · due ${j.deadline}`));}));
 tx.clearRect(0,0,600,180);tx.strokeStyle='#2a384a';tx.lineWidth=1;for(const y of [20,80,140]){tx.beginPath();tx.moveTo(30,y);tx.lineTo(585,y);tx.stroke();}
 const px=f=>30+f.tick/300*555,py=f=>140-f.value/current.total*120;
 tx.beginPath();frames.forEach((f,i)=>{if(i){tx.lineTo(px(f),py(frames[i-1]));tx.lineTo(px(f),py(f));}else tx.moveTo(px(f),py(f));});tx.strokeStyle='#8ce7ba';tx.lineWidth=3;tx.stroke();
 tx.strokeStyle='#eef4fc';tx.lineWidth=1;tx.beginPath();tx.moveTo(px(f),12);tx.lineTo(px(f),145);tx.stroke();tx.fillStyle='#eef4fc';tx.beginPath();tx.arc(px(f),py(f),4,0,Math.PI*2);tx.fill();
 tx.font='12px system-ui';tx.fillStyle='#9daec2';tx.fillText('100%',0,14);tx.fillText('0',22,164);tx.fillText('300 ticks',529,164);
 timeline.setAttribute('aria-valuemax',String(frames.length-1));timeline.setAttribute('aria-valuenow',String(tick));timeline.setAttribute('aria-valuetext',`Tick ${f.tick}, delivered ${fmt(100*f.value/current.total)} percent`);
}
function chooseCase(i){stop();index=i;current=detail.cases[i];tick=0;$('#play').disabled=!current.replay?.length;$('#case-title').textContent=`SCENARIO ${i+1} / ${detail.cases.length} · SEED ${current.seed}`;$('#case-score').textContent=`${fmt(current.score)}% · ${current.status}`;[...$('#episodes').children].forEach((b,j)=>b.setAttribute('aria-pressed',String(i===j)));draw();}
async function chooseRun(run){
 stop();const version=++selection;selectedRun=run;$('#error').textContent='';
 try{
 if(!cache.has(run.id))cache.set(run.id,json('data/'+run.evaluation.path));const loaded=await cache.get(run.id);if(version!==selection)return;detail=loaded;
 $('#explorer').hidden=false;$('#run-title').textContent=`${label(run)} · held-out episodes`;$('#source').href='data/'+run.artifact.entry;
 [...$('#scores').querySelectorAll('button')].forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===run.id)));
 $('#episodes').replaceChildren(...detail.cases.map((c,i)=>{const b=el('button',{type:'button',class:c.score===100?'complete':'',title:`Scenario ${i+1}: ${fmt(c.score)}%, ${c.status}`,'aria-label':`Scenario ${i+1}: ${fmt(c.score)} percent, ${c.status}`},el('span',{}));b.style.setProperty('--score',Math.max(4,c.score)+'%');b.onclick=()=>chooseCase(i);return b;}));
 const metadata={'Requested model':run.model.requested,'Reported model':run.model.resolved??'Not reported','Thinking':run.settings.effort,'Response budget':run.settings.limits.maxTurns,'Wall-time fallback':`${run.settings.limits.maxWallMs/60000} minutes`,'Development responses':run.turns.harness,'Practice episodes':run.practice?.at(-1)?.simulationsUsed??0,'Wall time':`${fmt(run.wallMs/1000)} seconds`,'Estimated price':run.cost?.usd==null?'Unavailable':`$${run.cost.usd.toFixed(3)} (${run.cost.basis})`,'Harness':JSON.stringify(run.harness),'Scenario suite':run.evaluation.suiteSha256};
 $('#metadata').replaceChildren(...Object.entries(metadata).flatMap(([k,v])=>[el('span',{class:'muted'},k),el('span',{},String(v))]));
 $('#practice').replaceChildren(el('h3',{},'Practice progression'),...(run.practice??[]).map(t=>el('p',{},`${t.id} · ${t.suite} · ${fmt(t.score)}% · ${t.episodes} episodes`)),el('a',{href:'data/'+run.trace},'Full development transcript ↗'));
 chooseCase(Math.min(index,detail.cases.length-1));
 }catch(e){$('#error').textContent=e.message;}
}
function scrub(e){if(!current?.replay?.length)return;const r=timeline.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*600;const target=Math.round(Math.max(0,Math.min(300,(x-30)/555*300)));tick=current.replay.reduce((best,f,i)=>Math.abs(f.tick-target)<Math.abs(current.replay[best].tick-target)?i:best,0);draw();}
timeline.onpointerdown=e=>{stop();timeline.setPointerCapture(e.pointerId);scrub(e);};timeline.onpointermove=e=>{if(timeline.hasPointerCapture(e.pointerId))scrub(e);};timeline.onpointerup=e=>{if(timeline.hasPointerCapture(e.pointerId))timeline.releasePointerCapture(e.pointerId);};
timeline.onkeydown=e=>{if(!current?.replay)return;const changes={ArrowLeft:-1,ArrowRight:1,PageUp:10,PageDown:-10};if(e.key in changes){e.preventDefault();stop();tick=Math.max(0,Math.min(current.replay.length-1,tick+changes[e.key]));draw();}else if(['Home','End'].includes(e.key)){e.preventDefault();stop();tick=e.key==='Home'?0:current.replay.length-1;draw();}};
$('#play').onclick=()=>{if(timer){stop();return;}if(!current?.replay?.length)return;if(tick===current.replay.length-1)tick=0;$('#play').textContent='Pause';timer=setInterval(()=>{tick++;if(tick>=current.replay.length-1){tick=current.replay.length-1;stop();}draw();},80);};
try{
 const [catalog,context]=await Promise.all([json('data/runs.json'),json('data/eval-context.json')]);$('#prompt').textContent=context.prompt;
 const runs=catalog.runs.filter(r=>r.status==='submitted'&&r.evaluation).sort((a,b)=>b.harness.version.localeCompare(a.harness.version)||b.metrics.score-a.metrics.score);
 $('#scores').replaceChildren(...runs.map(r=>{const b=el('button',{class:'scorecard',type:'button','aria-pressed':'false'},el('span',{},label(r)),el('strong',{},fmt(r.metrics.score)+'%'),el('span',{class:'muted small'},`${r.evaluation.summary.episodes} scenarios · ${r.evaluation.summary.outcomes.complete??0} full deliveries`));b.dataset.id=r.id;b.onclick=()=>chooseRun(r);return b;}));
 for(const r of catalog.runs.filter(r=>r.status!=='submitted')){
  const fixed=(r.practice??[]).filter(t=>t.suite==='fixed'),fresh=(r.practice??[]).filter(t=>t.suite==='fresh');
  const details=el('details',{},el('summary',{},'Development record'),el('p',{},`${r.turns.harness} responses · ${fmt(r.wallMs/60000)} minutes · ${r.practice?.at(-1)?.simulationsUsed??0} practice episodes`),...(r.practice??[]).map(t=>el('p',{},`${t.id} · ${t.suite} · ${fmt(t.score)}%`)),el('p',{},`Reported-usage price estimate: ${r.cost?.usd==null?'unavailable':'$'+r.cost.usd.toFixed(3)}. Unreported in-flight usage may be missing.`),el('a',{href:'data/'+r.trace},'Development transcript ↗'),el('p',{},JSON.stringify({model:r.model,settings:r.settings,harness:r.harness})));
  $('#scores').append(el('article',{class:'scorecard unfinished'},el('span',{},label(r)),el('strong',{},r.status==='time_limit'?'Timed out':'Unsubmitted'),el('span',{class:'muted small'},'No final submission or held-out score'),el('p',{class:'small'},`Best fixed practice: ${fixed.length?fmt(Math.max(...fixed.map(t=>t.score)))+'%':'—'} · latest fresh: ${fresh.length?fmt(fresh.at(-1).score)+'%':'—'}`),details));
 }
 if(runs.length)await chooseRun(runs[0]);else $('#scores').append(el('p',{},'Pilot runs are in progress. Results appear after final submission.'));
 try{const b=await json('data/baselines.json');$('#baseline').textContent='Same held-out suite · '+Object.entries(b.baselines).map(([k,v])=>`${k==='risk'?'Enemy-aware':k==='value'?'Value-aware':'Greedy'} baseline ${fmt(v.score)}%`).join(' · ');}catch{}
}catch(e){$('#error').textContent=e.message;}
