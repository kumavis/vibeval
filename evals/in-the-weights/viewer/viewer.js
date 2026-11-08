import { scoredResults, summarize } from './scoring.js';
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(className)n.className=className; return n; };
const svg = (tag, attrs={}, text) => { const n=document.createElementNS('http://www.w3.org/2000/svg',tag); for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v); if(text!==undefined)n.textContent=text; return n; };
const pct = value => `${Math.round(value*100)}%`;
const scoreRate = group => group.meanScore / 2;
const scoreLabel = group => `${pct(scoreRate(group))} · ${group.score}/${2 * group.n} pts`;
const size = value => value == null ? 'Undisclosed' : `${Number(value.toFixed(2))}B`;
async function json(url) { const r=await fetch(url);if(!r.ok)throw Error(`Could not load ${url}: ${r.status}`);return r.json(); }
async function main() {
 const batches=window.RECALL_BATCHES ?? await Promise.all((await json('data/results.json')).batches.map(f=>json(`data/${f}`)));
 const assessment=window.RECALL_ASSESSMENT ?? await json('data/assessment.json');
 const audit=window.RECALL_AUDIT ?? await json('data/audit.json');
 const responses=scoredResults(batches,assessment), protocol=batches[0].protocol;
 const groups=summarize(responses,assessment), falseGroups=summarize(responses,assessment,'false-premise');
 const display=g=>g.label+(g.unreported?' *':'');
 const nameAnswers=responses.filter(r=>r.probeId==='name-only');
 const stats=[[`${groups.reduce((sum,g)=>sum+g.score,0)}/${2*nameAnswers.length}`,'NAME-ONLY RECALL POINTS'],[groups.length,'MODELS WITH NAME-ONLY ANSWERS'],[responses.length,'ANSWERS REVIEWED'],[`${audit.verifiedAnswers}/${audit.completedAnswers}`,'PASSED NO-WEB TRACE AUDIT']];
 $('stats').replaceChildren(...stats.map(([value,label])=>{const d=el('div',undefined,'stat');d.append(el('strong',value),el('span',label));return d;}));
 const allKeys=[...new Set(responses.map(r=>r.modelKey))];
 for(const key of allKeys){const op=el('option',assessment.models[key].label);op.value=key;$('model').append(op);}
 function select(key,probe='name-only'){$('model').value=key;$('probe').value=probe;$('trial').value='all';renderAnswers();$('answer-section').scrollIntoView({behavior:'smooth',block:'start'});}
 function plot(){
  const chart=$('chart');
  const known = groups.filter(group => group.parametersB != null);
  const left = 68, right = 1008, top = 50;
  const xMin = Math.min(2, ...known.map(group => group.parametersB));
  const xMax = Math.max(1000, ...known.map(group => group.parametersB));
  const x = value => left + Math.log(value / xMin) / Math.log(xMax / xMin) * (right - left);
  const bands = Map.groupBy(known, scoreRate);
  const clustersByRate = new Map();
  let plotHeight = 300, bottomLabelHeight = 0;
  const rates = [...bands.keys()].sort((a,b) => a-b);
  for (const [index, rate] of rates.entries()) {
    const clusters = [];
    for (const model of bands.get(rate)) {
      const px = x(model.parametersB);
      const previous = clusters.at(-1);
      if (previous && px - previous.first < 108) previous.models.push(model);
      else clusters.push({first:px, models:[model]});
    }
    clustersByRate.set(rate, clusters);
    const labelHeight = 19 * Math.max(...clusters.map(c => c.models.length));
    if (rate === 0) bottomLabelHeight = labelHeight;
    else plotHeight = Math.max(plotHeight, (labelHeight + 38) / (rate - (rates[index-1] ?? 0)));
  }
  const bottom = top + plotHeight;
  const y = rate => bottom - rate * (bottom - top);
  chart.setAttribute('viewBox', '0 0 1040 410');
  chart.append(svg('text', {x:left,y:20,class:'axis'},
    'Name-only founder recall score (% of possible points)'));
  for (const rate of [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1]) {
    chart.append(svg('line',{x1:left,x2:right,y1:y(rate),y2:y(rate),class:'grid-line'}),
      svg('text',{x:left-12,y:y(rate)+5,'text-anchor':'end',class:'axis'},pct(rate)));
  }
  for (const tick of [1,3,10,30,100,300,1000].filter(t=>t>=xMin && t<=xMax)) {
    chart.append(svg('line',{x1:x(tick),x2:x(tick),y1:top,y2:bottom,class:'grid-line'}),
      svg('text',{x:x(tick),y:bottom+bottomLabelHeight+34,'text-anchor':'middle',class:'axis'},tick+'B'));
  }
  chart.append(svg('text',{x:(left+right)/2,y:bottom+bottomLabelHeight+60,'text-anchor':'middle',class:'axis'},
    'Total model parameters · logarithmic scale'));

  // Keep data marks at their measured coordinates. Place nearby labels together
  // on the same score band, with one selectable line per model.
  const labels = svg('g');
  const marks = svg('g');
  const leaders = svg('g', {'pointer-events':'none'});
  chart.append(leaders, marks, labels);
  for (const [rate, clusters] of clustersByRate) {
    const boxes = clusters.map(cluster => {
      const entries = cluster.models.map(model => {
        const label = svg('text',{class:'point-label', 'dominant-baseline':'middle'},
          model.label.endsWith(' '+size(model.parametersB)) ? model.label : model.label+' · '+size(model.parametersB));
        const button = svg('g',{class:'plot-model',tabindex:0,role:'button',
          'aria-label':model.label+', '+size(model.parametersB)+', '+scoreLabel(model)+'. Read answers.'});
        button.append(label);
        labels.append(button);
        const open = () => select(model.key);
        button.addEventListener('click',open);
        button.addEventListener('keydown',event=>{
          if (['Enter',' '].includes(event.key)) { event.preventDefault(); open(); }
        });
        return {model,label,width:label.getComputedTextLength()};
      });
      const width = Math.max(...entries.map(entry=>entry.width));
      const center = (cluster.first + x(cluster.models.at(-1).parametersB))/2;
      return {entries,width,start:Math.max(left,Math.min(right-width,center-width/2)),center};
    });
    const labelRoom = right - left - 16 * (boxes.length - 1);
    const totalWidth = boxes.reduce((width, box) => width + box.width, 0);
    if (totalWidth > labelRoom) {
      const fontSize = 14 * labelRoom / totalWidth;
      for (const box of boxes) {
        for (const {label} of box.entries) label.style.fontSize = fontSize + 'px';
        box.width = Math.max(...box.entries.map(({label}) => label.getComputedTextLength()));
        box.start = Math.max(left, Math.min(right - box.width, box.center - box.width / 2));
      }
    }
    // Reserve horizontal room for adjacent callouts, including the edge labels.
    for (let i=1; i<boxes.length; i++)
      boxes[i].start=Math.max(boxes[i].start,boxes[i-1].start+boxes[i-1].width+16);
    for (let i=boxes.length-1; i>=0; i--) {
      const limit=i===boxes.length-1 ? right : boxes[i+1].start-16;
      boxes[i].start=Math.min(boxes[i].start,limit-boxes[i].width);
    }
    for (const box of boxes) {
      const lineHeight=19;
      const base=y(rate)+20;
      const jointX=Math.max(box.start+6,Math.min(box.center,box.start+box.width-6));
      const jointY=y(rate)+10;
      const sameSize=Map.groupBy(box.entries,entry=>entry.model.parametersB);
      for (const [parameters,entries] of sameSize) {
        const px=x(parameters), py=y(rate);
        leaders.append(svg('line',{x1:px,y1:py,x2:jointX,y2:jointY,class:'leader'}));
        const mark=svg('g');
        mark.append(svg('title',{},entries.map(({model})=>model.label).join(' / ')+' · '+size(parameters)+' · '+scoreLabel(entries[0].model)),
          svg('circle',{cx:px,cy:py,r:entries.length>1?8:5.5,class:rate?'point-pass':'point-zero'}));
        if(entries.length>1) mark.append(svg('circle',{cx:px,cy:py,r:3,fill:'var(--muted)'}));
        else { mark.style.cursor='pointer'; mark.addEventListener('click',()=>select(entries[0].model.key)); }
        marks.append(mark);
      }
      box.entries.forEach(({label},index)=>{
        label.setAttribute('x',box.start);
        label.setAttribute('y',base+index*lineHeight);
        label.setAttribute('paint-order','stroke');
        label.setAttribute('stroke','var(--panel)');
        label.setAttribute('stroke-width','4');
      });
    }
  }
  chart.setAttribute('viewBox', '0 0 1040 '+(bottom+bottomLabelHeight+76));
  $('plot-desc').textContent=known.map(g=>`${g.label}: ${size(g.parametersB)}, ${scoreLabel(g)}, n=${g.n}`).join('. ');
  $('unknown').replaceChildren(el('p','Size undisclosed · shown separately, not positioned on the size axis','caption'));
  const rails=el('div',undefined,'unknown-grid');
  for(const g of groups.filter(g=>g.parametersB==null)){const b=el('button',undefined,'unknown-model');b.type='button';b.append(el('span',display(g)),el('strong',scoreLabel(g)));b.addEventListener('click',()=>select(g.key));rails.append(b);}
  $('unknown').append(rails);
  if(groups.some(g=>g.unreported)) $('unknown').append(el('p','* Codex requested model ID; resolved serving ID is not reported.','caption'));
 }
 for(const g of groups){const row=el('tr'), name=el('td'),b=el('button',display(g),'text-button');b.type='button';b.addEventListener('click',()=>select(g.key));name.append(b);const evidence=el('td');evidence.append(el('span',g.sizeNote));if(g.sizeUrl){const a=el('a',' Source ↗');a.href=g.sizeUrl;evidence.append(a);}row.append(name,el('td',size(g.parametersB)),el('td',scoreLabel(g)),evidence);$('comparison').append(row);}
 for(const g of falseGroups){const row=el('button',undefined,'false-row');row.type='button';row.setAttribute('aria-label',`${display(g)}: ${g.clean} clean, ${g.partial} partial, ${g.n-g.clean-g.partial} not corrected, ${g.n} answers`);row.append(el('span',display(g),'false-name'));const track=el('span',undefined,'false-track');for(const [n,cls,label] of [[g.clean,'segment-good','clean'],[g.partial,'segment-partial','partial'],[g.n-g.clean-g.partial,'segment-bad','not corrected']]){if(n){const segment=el('span',`${n}`,cls);segment.style.width=`${n/g.n*100}%`;segment.title=`${n} ${label}`;track.append(segment);}}row.append(track,el('span',`${g.score}/${2*g.n} pts · n=${g.n}`,'caption'));row.addEventListener('click',()=>select(g.key,'false-premise'));$('false-chart').append(row);}
 function renderAnswers(){
  const probe=protocol.probes.find(p=>p.id===$('probe').value);$('prompt').textContent=probe?probe.prompt:'Each answer is an independent conversation. Both organization names appear in the false-premise prompt.';
  const shown=responses.filter(r=>($('probe').value==='all'||r.probeId===$('probe').value)&&($('model').value==='all'||r.modelKey===$('model').value)&&($('trial').value==='all'||r.trial===Number($('trial').value)));
  $('count').textContent=`${shown.length} scored answers`;$('answers').replaceChildren();
  if(!shown.length)$('answers').append(el('p','No completed answers for this selection. Missing responses have no score.','muted'));
  for(const r of shown){const v=r.review,card=el('article',undefined,'card answer'), title=assessment.models[r.modelKey].label+(!r.resolvedModel?' *':'');
   card.append(el('span',`${protocol.probes.find(p=>p.id===r.probeId).label.toUpperCase()} · TRIAL ${r.trial}`,'badge'),el('h3',title));
   const grade=r.probeId==='cued'?'0 unaided credit · MetaMask supplied':`${v.score}/2 · ${r.probeId==='false-premise'?'premise correction':'unaided recall'}`;
   card.append(el('p',grade,`grade ${v.score===2?'good':v.score===1?'partial':'bad'}`),el('p',`Founder recognized: ${v.founderRecognized?'yes':'no'} · Biography: ${v.biography.replaceAll('-',' ')}`,'meta'));
   if(!r.resolvedModel)card.append(el('p','Requested ID only; the Codex trace does not identify the serving model.','caption'));
   card.append(el('div',r.content,'text'),el('p',v.note,'review-note'));
   const links=el('p',undefined,'source-links');for(const key of v.sources){const ref=assessment.references[key],a=el('a',ref.title);a.href=ref.url;links.append(a,document.createTextNode(' · '));}card.append(links);
   const inputDetail=el('details');inputDetail.append(el('summary','Filled scoring inputs'),el('pre',JSON.stringify({founderRecognized:v.founderRecognized,biography:v.biography,premise:v.premise,otherFactualIssue:v.otherFactualIssue,computedScore:v.score},null,2)));card.append(inputDetail);
   const detail=el('details');detail.append(el('summary','Exact model ID, prompt & provenance'),el('pre',JSON.stringify(r,null,2)));card.append(detail);$('answers').append(card);
  }
 }
 $('scope').textContent='Scores are an explicit source-assisted review of each final answer, not keyword matching. Read the rationale and references on every card.';
 $('rubric').textContent=JSON.stringify(assessment.rubric,null,2);
 $('audit-status').textContent=audit.passed?`${audit.verifiedAnswers} of ${audit.completedAnswers} saved answers pass the trace audit. No search tools were requested, and no tool calls or search events were found. Codex web search was disabled. Claude Code reported no available tools and zero server searches. Raw-answer hashes and runner snapshots match.`:'The evidence audit has unresolved failures. See provenance before treating these as unaided results.';
 $('audit-limit').textContent=audit.limitation;
 $('provenance').textContent=JSON.stringify({audit,batches:batches.map(({responses,...rest})=>rest)},null,2);
 for(const ref of Object.values(assessment.references)){const p=el('p'),a=el('a',ref.title);a.href=ref.url;p.append(a,document.createTextNode(` — ${ref.facts}`));$('references').append(p);}
 for(const p of protocol.probes)$('probes').append(el('h3',p.label),el('p',p.prompt));
 const exported={assessment,audit,results:responses};const blob=new Blob([JSON.stringify(exported,null,2)],{type:'application/json'});$('download').href=URL.createObjectURL(blob);$('download').download='dan-finlay-scored-results.json';
 for(const id of ['probe','model','trial'])$(id).addEventListener('change',renderAnswers);
 $('see-false').addEventListener('click',()=>select('all','false-premise'));plot();renderAnswers();
}
main().catch(error=>{$('stats').textContent=error.message;});
