import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {publicSummary} from './claude-run.mjs';
import {mergeResults} from './merge-results.mjs';
import {buildAxes} from './axes.mjs';
import {analyze} from './analyze.mjs';
import {researchEvidence} from '../viewer/ballot-summary.js';

const publicDir=new URL('../data/public/',import.meta.url);
const load=name=>readFile(new URL(name,publicDir),'utf8').then(JSON.parse);
const save=(name,value)=>writeFile(new URL(name,publicDir),JSON.stringify(value,null,2)+'\n');
export async function refresh(batchDir,{allowPending=false}={}){
  const claude=await publicSummary(resolve(batchDir));
  if(!allowPending&&claude.runs.some(r=>['pending','running'].includes(r.status)))throw new Error('Claude batch is not finished; use --allow-pending only for a progress preview');
  claude.batch.collectionTimezone='America/Los_Angeles';
  claude.batch.collectionDateLocal=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(claude.batch.createdAt));
  claude.batch.electionResultsContext={availableAtCollection:false,source:'User clarification during collection: election results were not available yet.',independentlyVerified:false};
  const [codex,openrouter,previous,rubric]=await Promise.all([load('codex-results.json'),load('openrouter-results.json'),load('results.json'),readFile(new URL('../axis-rubric.json',import.meta.url),'utf8').then(JSON.parse)]);
  const baseline=mergeResults([codex,openrouter]),combined=mergeResults([codex,openrouter,claude]);
  assert.deepEqual(combined.runs.slice(0,baseline.runs.length),baseline.runs);
  for(const run of baseline.runs)assert.deepEqual(previous.runs.find(r=>r.id===run.id),run);
  const axes=buildAxes(combined,rubric),valid=combined.runs.filter(r=>r.status==='completed'&&r.validation?.valid===true);
  const mapping={investment:'public-investment',redistribution:'redistributive-taxation',governance:'governance-constraints'};
  const old3D=await load('political-traits-3d.json'),names=new Map(old3D.models.map(m=>[m.id,m.label]));
  for(const model of claude.batch.models)names.set(model,model.replace('claude-','Claude ').replace(/-(\d+)-(\d+)$/,' $1.$2').replace(/\b(haiku|sonnet|opus|fable)\b/g,s=>s[0].toUpperCase()+s.slice(1)));
  const rows=valid.map(r=>({id:r.id,model:r.model,trial:r.trial,provider:r.provider,
    ...Object.fromEntries(Object.entries(mapping).map(([key,axis])=>[key,axes.runs[r.id]?.[axis]??null])),
    evidence:Object.fromEntries(Object.entries(mapping).map(([key,axis])=>[key,axes.evidence[r.id]?.[axis]??null]))}));
  const three={scope:'Frozen BT11 responses, including the later Claude Code cohort. All eleven coded measures also appear in photographed BT87. No BT87 rerun; self-reported scores are excluded.',
    axes:old3D.axes,runs:rows,models:[...new Set(valid.map(r=>r.model))].map(id=>({id,label:names.get(id)??id})),
    counts:{validResponses:valid.length,plottedResponses:rows.filter(r=>Object.keys(mapping).every(k=>Number.isFinite(r[k]))).length}};
  const audit=await load('completion-audit.json');
  Object.assign(audit,{attempts:combined.runs.length,models:combined.batch.models.length,axes:axes.axes.length,
    statuses:Object.fromEntries([...new Set(combined.runs.map(r=>r.status))].map(s=>[s,combined.runs.filter(r=>r.status===s).length])),
    validContestEntries:valid.reduce((s,r)=>s+r.response.decisions.length,0),originalCodexRecordsPreserved:true,originalOpenRouterRecordsPreserved:true,
    claude:{attempts:claude.runs.length,valid:claude.runs.filter(r=>r.status==='completed'&&r.validation?.valid===true).length,collectionDateLocal:claude.batch.collectionDateLocal,timezone:claude.batch.collectionTimezone,
      completedWebActions:claude.runs.reduce((s,r)=>s+(r.audit?.webSearchCalls??0),0),
      apiEquivalentEstimateUsd:claude.runs.filter(r=>Number.isFinite(r.costUsd)).reduce((s,r)=>s+r.costUsd,0),unknownEstimates:claude.runs.filter(r=>!Number.isFinite(r.costUsd)).length,
      note:'CLI list-price estimate, not verified incremental subscription charges; excludes the integration probe.'},
    researchActivity:Object.fromEntries(['observed','none-recorded','unknown'].map(s=>[s,combined.runs.filter(r=>researchEvidence(r).state===s).length])),
    webMetricNote:'Codex completed web actions, Claude Code non-error tool results, and OpenRouter reported requests are distinct units.'});
  await save('claude-results.json',claude);await save('results.json',combined);await save('axes.json',axes);await save('analysis.json',analyze(combined));await save('political-traits-3d.json',three);await save('completion-audit.json',audit);
  console.log(JSON.stringify({attempts:audit.attempts,statuses:audit.statuses,claude:audit.claude,plotted3D:three.counts.plottedResponses}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [batchDir,...flags]=process.argv.slice(2);if(!batchDir)throw new Error('Usage: refresh-claude.mjs BATCH_DIR [--allow-pending]');
 await refresh(batchDir,{allowPending:flags.includes('--allow-pending')});
}
