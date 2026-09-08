import{el,json}from'../../shared/dom.js';
const choices=['rock','paper','scissors'],colors={rock:'#ebc981',paper:'#9fbcf5',scissors:'#8ce7ba',invalid:'#ffada7'};
const percent=n=>(100*n).toFixed(1)+'%';
function interval(k,n){const z=1.96,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return `${percent(Math.max(0,c-h))}–${percent(Math.min(1,c+h))}`;}
try{
 const[catalog,context]=await Promise.all([json('data/runs.json'),json('data/eval-context.json')]);document.querySelector('#prompt').textContent=context.prompt;
 const groups=new Map();for(const r of catalog.runs){const key=r.model.requested; if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const root=document.querySelector('#models');root.replaceChildren();
 for(const[model,runs]of [...groups].sort(([a],[b])=>b.localeCompare(a))){runs.sort((a,b)=>a.trial-b.trial);const name=model.startsWith('claude-haiku-')?'Haiku':model.replace('gpt-5.6-','').replace(/^./,c=>c.toUpperCase());const counts=Object.fromEntries([...choices,'invalid'].map(c=>[c,0]));for(const r of runs)counts[r.status==='submitted'&&choices.includes(r.choice)?r.choice:'invalid']++;
 const panel=el('section',{class:'model'},el('h2',{},name),el('p',{class:'meta'},`${runs.length} independent samples · ${runs[0].settings.effort} effort`));
 for(const c of [...choices,...(counts.invalid?['invalid']:[])]){const track=el('div',{class:'track'},el('div',{class:'fill',style:`width:${100*counts[c]/runs.length}%;--color:${colors[c]}`}));panel.append(el('div',{class:'choice'},el('div',{class:'choice-label'},el('span',{},c[0].toUpperCase()+c.slice(1)),el('strong',{},`${counts[c]} / ${runs.length} · ${percent(counts[c]/runs.length)}`)),track,el('span',{class:'interval'},`95% interval ${interval(counts[c],runs.length)}`)));}
 panel.append(el('p',{class:'meta'},'ANSWERS IN TRIAL ORDER'));
 panel.append(el('div',{class:'samples'},...runs.map(r=>{const c=r.choice??'invalid';return el('a',{class:'sample',style:`--color:${colors[c]??colors.invalid}`,href:'data/'+(r.artifact?.entry??r.trace),title:`Trial ${r.trial}: ${r.response??r.status}`,'aria-label':`Trial ${r.trial}: ${r.choice??r.status}`},c==='invalid'?'?':c[0].toUpperCase());})));
 const cost=runs.every(r=>r.cost?.usd!=null)?'$'+runs.reduce((s,r)=>s+r.cost.usd,0).toFixed(3):'Unavailable';
 panel.append(el('details',{},el('summary',{},'Run metadata'),el('p',{class:'metadata'},`Requested model: ${model}. Effort: ${runs[0].settings.effort}. API-equivalent price estimate: ${cost}. One fresh CLI request per sample; no output schema or option shuffling.`),...runs.map(r=>el('p',{class:'metadata'},el('a',{href:`data/${r.id}/run.json`},`Trial ${r.trial}`),` · ${r.status} · ${(r.wallMs/1000).toFixed(1)}s · ${r.harness.version} · reported model: ${r.model.resolved??'not reported'}`))));root.append(panel);
 }
 if(!groups.size)root.append(el('p',{},'Sampling in progress. Results appear after publication.'));
}catch(e){document.querySelector('#error').textContent=e.message;}
