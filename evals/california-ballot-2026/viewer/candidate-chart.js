import {candidateVoteShares} from './ballot-summary.js';

const percent = n => `${Math.round(n * 100)}%`;
const node = (tag, text, cls) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const svgNode = (tag, attrs) => {const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const observers = new WeakMap();
export function disconnectCandidateCharts(root) {
  for(const plot of root.querySelectorAll('.candidate-plot')) observers.get(plot)?.disconnect();
}

export function candidateChart(contest, models, runs, ui) {
  const root=node('div',undefined,'candidate-overview');
  const entries=models.map(model=>({model,...candidateVoteShares(runs.filter(r=>r.model===model),contest)}));
  const size=contest.options.length, detail=node('div',undefined,'candidate-detail');
  detail.setAttribute('aria-live','polite');
  let active=entries.find(e=>e.count)?.model;
  const distribution=entry=>entry.count ? entry.counts.map((count,i)=>count?`${contest.options[i]} ${percent(entry.shares[i])} (${count}/${entry.count})`:null).filter(Boolean).join(' · ') : 'No valid candidate votes';
  function select(entry){
    active=entry.model;detail.replaceChildren(node('h4',ui.name(entry.model)),node('p',distribution(entry),'chart-note'));
    const rounds=node('div',undefined,'candidate-rounds');
    for(const {run,kind} of [...entry.rounds].sort((a,b)=>a.run.trial-b.run.trial)){
      const card=node('div',undefined,'candidate-round');
      card.append(node('strong',`Round ${run.trial} · ${kind==='excluded'?'Excluded':kind==='voted'?'Candidate vote':kind==='abstain'?'Abstained':'Insufficient information'}`));
      card.append(node('p',ui.choice(run)));
      const rationale=ui.rationale(run);if(rationale)card.append(node('blockquote',rationale,'candidate-rationale'));
      const inspect=node('button','Full response and sources ↗','vote-choice');inspect.type='button';inspect.addEventListener('click',()=>ui.inspect(run));card.append(inspect);rounds.append(card);
    }
    detail.append(rounds);
    for(const button of root.querySelectorAll('[data-model]'))button.setAttribute('aria-pressed',String(button.dataset.model===active));
    // Put the selected icon above overlapping markers without moving its coordinates.
    const selected=root.querySelector('.candidate-plot [data-model][aria-pressed=true]');if(selected)selected.style.zIndex='2';
    for(const button of root.querySelectorAll('.candidate-plot [data-model][aria-pressed=false]'))button.style.zIndex='1';
  }
  function button(entry,cls){
    const b=node('button',undefined,cls);b.type='button';b.dataset.model=entry.model;b.style.setProperty('--model-color',ui.color(entry.model));b.setAttribute('aria-pressed',String(entry.model===active));
    b.setAttribute('aria-label',`${ui.name(entry.model)}. ${distribution(entry)}. ${entry.abstain} abstentions, ${entry.insufficient} insufficient information, ${entry.excluded} excluded. Show round details.`);
    b.title=`${ui.name(entry.model)} · ${distribution(entry)}`;b.addEventListener('click',()=>select(entry));return b;
  }
  const note=size===2?'Position shows the share of votes for each candidate; the midpoint means an even split.':size===3?'Each corner is a candidate. A 2–1 split lies on an edge; one vote for each candidate lands in the center.':'Each bar shows a candidate’s share of that model’s valid candidate votes.';
  root.append(node('p',`${note} Abstentions and insufficient information are separate; invalid or unsupported responses are excluded. Select a model for round details.`,'chart-note'));
  if(size===2){
    const labels=node('div',undefined,'candidate-endpoints');for(const option of contest.options)labels.append(node('strong',option));root.append(labels);
    const plot=node('div',undefined,'candidate-plot candidate-line');root.append(plot);let previousWidth=0;
    function draw(){
      const width=plot.clientWidth;if(!width||width===previousWidth)return;previousWidth=width;plot.replaceChildren();
      const lanes=[],left=18,right=width-18;
      const measure=document.createElement('canvas').getContext('2d');measure.font='500 13px system-ui';
      const points=entries.filter(e=>e.count).map(entry=>{
        const x=left+entry.shares[1]*(right-left), label=`${ui.compactName(entry.model)}  ${entry.counts[0]}:${entry.counts[1]}`;
        const labelWidth=Math.min(width-64,Math.ceil(measure.measureText(label).width)+18),toLeft=x+20+labelWidth>width-4;
        const labelX=toLeft?Math.max(4,x-20-labelWidth):x+20,lo=Math.min(x-14,labelX),hi=Math.max(x+14,labelX+labelWidth);
        let lane=lanes.findIndex(bounds=>bounds.every(([a,b])=>hi+12<a||lo>b+12));if(lane<0){lane=lanes.length;lanes.push([]);}lanes[lane].push([lo,hi]);
        return{entry,x,labelWidth,labelX,toLeft,lane};
      });
      const baseline=30+Math.max(0,lanes.length-1)*40,height=baseline+50;plot.style.height=`${height}px`;
      const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,'aria-hidden':'true'});
      for(const share of [0,.5,1])svg.append(svgNode('line',{x1:left+share*(right-left),x2:left+share*(right-left),y1:8,y2:baseline+22,class:'vote-column-guide'}));
      svg.append(svgNode('line',{x1:left,x2:right,y1:baseline+22,y2:baseline+22,class:'vote-axis'}));plot.append(svg);
      for(const p of points){const b=button(p.entry,'vote-labeled-dot');b.style.left=`${p.x-14}px`;b.style.top=`${baseline-p.lane*40-14}px`;
        const marker=node('span',undefined,'vote-brand-marker');marker.append(ui.brandIcon(p.entry.model));
        const label=node('span',undefined,'vote-direct-label');label.style.left=`${p.labelX-p.x+14}px`;label.style.width=`${p.labelWidth}px`;label.classList.toggle('label-left',p.toLeft);
        label.append(node('span',ui.compactName(p.entry.model),'vote-model-name'),node('strong',`${p.entry.counts[0]}:${p.entry.counts[1]}`,'vote-mean'));b.append(marker,label);plot.append(b);
      }
    }
    const observer=new ResizeObserver(draw);observers.set(plot,observer);observer.observe(plot);
    root.append(node('p','Labels show candidate vote counts in left:right order. Vertical stacking only separates labels.','chart-note'));
  } else if(size===3){
    const layout=node('div',undefined,'candidate-triangle-layout'),plot=node('div',undefined,'candidate-plot candidate-triangle');
    const width=600,height=470,vertices=[[300,90],[100,340],[500,340]];
    const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,'aria-hidden':'true'});
    svg.append(svgNode('polygon',{points:vertices.map(p=>p.join(',')).join(' '),class:'candidate-triangle-face'}));
    for(let i=0;i<3;i++)for(const t of [1/3,2/3]){const a=vertices[i],b=vertices[(i+1)%3],c=vertices[(i+2)%3];svg.append(svgNode('line',{x1:a[0]*(1-t)+b[0]*t,y1:a[1]*(1-t)+b[1]*t,x2:a[0]*(1-t)+c[0]*t,y2:a[1]*(1-t)+c[1]*t,class:'vote-column-guide'}));}
    plot.append(svg);
    contest.options.forEach((option,i)=>{const label=node('strong',option,'triangle-candidate');label.style.left=`${vertices[i][0]/width*100}%`;label.style.top=`${(i===0?12:435)/height*100}%`;plot.append(label);});
    const groups=new Map();for(const entry of entries.filter(e=>e.count)){const key=entry.shares.join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
    for(const group of groups.values()){
      const shares=group[0].shares,x=shares.reduce((s,v,i)=>s+v*vertices[i][0],0),y=shares.reduce((s,v,i)=>s+v*vertices[i][1],0);
      svg.append(svgNode('circle',{cx:x,cy:y,r:3,class:'candidate-anchor'}));
      group.forEach((entry,i)=>{const angle=2*Math.PI*i/group.length-Math.PI/2,radius=group.length===1?0:Math.max(28,group.length*7),px=x+Math.cos(angle)*radius,py=y+Math.sin(angle)*radius;
        if(radius)svg.append(svgNode('line',{x1:x,y1:y,x2:px,y2:py,class:'candidate-leader'}));
        const b=button(entry,'vote-labeled-dot triangle-model');b.style.left=`${px/width*100}%`;b.style.top=`${py/height*100}%`;const marker=node('span',undefined,'vote-brand-marker');marker.append(ui.brandIcon(entry.model));b.append(marker);plot.append(b);
      });
    }
    layout.append(plot);const list=node('div',undefined,'candidate-model-list');
    for(const entry of entries.filter(e=>e.count)){const b=button(entry,'candidate-model-summary');const label=node('span',undefined,'candidate-model-name');label.append(ui.brandIcon(entry.model),node('strong',ui.compactName(entry.model)));b.append(label,node('span',distribution(entry),'candidate-distribution'));list.append(b);}
    layout.append(list);root.append(layout,node('p','Icons at the same position fan out for access; connector ends mark the exact vote shares.','chart-note'));
  } else {
    const bars=node('div',undefined,'candidate-bars');
    for(const entry of entries.filter(e=>e.count)){
      const b=button(entry,'candidate-bar-row'),label=node('span',undefined,'candidate-model-name');label.append(ui.brandIcon(entry.model),node('strong',ui.compactName(entry.model)));b.append(label);
      const values=node('span',undefined,'candidate-bar-values');
      for(let i=0;i<size;i++){const cell=node('span',undefined,'candidate-bar-cell');cell.append(node('span',contest.options[i],'candidate-bar-label'));const track=node('span',undefined,'candidate-bar-track'),fill=node('span',undefined,'candidate-bar-fill');fill.style.width=percent(entry.shares[i]);track.append(fill);cell.append(track,node('span',`${percent(entry.shares[i])} · ${entry.counts[i]}/${entry.count}`,'candidate-bar-value'));values.append(cell);}
      b.append(values);bars.append(b);
    }
    root.append(bars);
  }
  const separate=node('div',undefined,'candidate-separate');separate.append(node('h4','Abstentions & unavailable votes'));
  const affected=entries.filter(e=>e.abstain||e.insufficient||e.excluded||!e.count);
  if(!affected.length)separate.append(node('p','Every recorded round selected a candidate.','chart-note'));
  for(const entry of affected){const b=button(entry,'candidate-separate-model');const label=node('span',undefined,'candidate-model-name');label.append(ui.brandIcon(entry.model),node('strong',ui.compactName(entry.model)));const reasons=[];if(entry.abstain)reasons.push(`${entry.abstain} abstained`);if(entry.insufficient)reasons.push(`${entry.insufficient} insufficient information`);if(entry.excluded)reasons.push(`${entry.excluded} excluded`);if(!entry.rounds.length)reasons.push('No recorded attempts');b.append(label,node('span',`${reasons.join(' · ')} · ${entry.count} candidate votes`));separate.append(b);}
  root.append(separate,detail);const first=entries.find(e=>e.model===active)||entries[0];if(first)select(first);return root;
}
