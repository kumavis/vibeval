import {envelope} from './map-geometry.js';
import {rotatingMap} from './rotating-map.js';
import {candidateChart, disconnectCandidateCharts} from './candidate-chart.js';
import {brand, modelColor, brandSvg} from './model-identity.js';
import {averageBinaryVotes, researchEvidence, rankBallotItems} from './ballot-summary.js';
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const svgEl = (tag, attrs = {}, text) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text !== undefined) n.textContent = text; return n; };
const compactName = model => name(model).replace(/-(sol|terra|luna|astra)$/, (_,tier)=>' '+tier[0].toUpperCase()+tier.slice(1)).replace(' (1017)','').replace(' (0902)','');
function brandIcon(model) { const icon=el('span',undefined,'model-brand-icon'); icon.style.setProperty('--brand-icon',`url("brand-icons/${brand(model)}.svg")`); icon.setAttribute('aria-hidden','true'); return icon; }
const format = n => Number.isFinite(n) ? n.toFixed(1) : '—';
const modelNames = { 'claude-haiku-5-5':'Claude Haiku 5.5', 'claude-sonnet-5-5':'Claude Sonnet 5.5', 'claude-opus-5-5':'Claude Opus 5.5', 'claude-fable-5-1':'Claude Fable 5.1', 'x-ai/grok-4.7': 'Grok 4.7', 'x-ai/grok-4.3': 'Grok 4.3', 'z-ai/glm-5.3': 'GLM 5.3', 'google/gemini-4-argon': 'Gemini 4 Argon', 'deepseek/deepseek-v4.1-flash-1017': 'DeepSeek V4.1 Flash (1017)', 'qwen/qwen3.8-max-0902': 'Qwen 3.8 Max (0902)', 'moonshotai/kimi-k3.1-pro': 'Kimi K3.1 Pro', 'mistralai/mistral-large-4-0': 'Mistral Large 4.0' };
const name = model => modelNames[model] || String(model ?? 'Unknown model').replace(/^gpt-/, 'GPT-');
const provider = r => r.provider === 'claude-code' || String(r.model).startsWith('claude-') ? 'claude' : r.provider === 'openrouter' || (!r.provider && String(r.model).includes('/')) ? 'openrouter' : 'codex';
const providerName = r => ({claude:'Claude Code',openrouter:'OpenRouter',codex:'Codex'}[provider(r)]);
const label = r => `${name(r.model)} · ${providerName(r)} · round ${r.trial ?? '—'}`;
const status = r => String(r.status || 'unknown').replaceAll('_', ' ');
const coordinate = n => Number.isFinite(n) && n >= -10 && n <= 10;
const plotted = r => r.status === 'completed' && coordinate(axisValue(r, horizontalAxis)) && coordinate(axisValue(r, verticalAxis));
const pretty = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
let data, runs = [], models = [], contests = [], selected, cohort = 'all', heroMap;
const defaultAxes = [
  {id:'public-investment',label:'Public investment',description:'Choice-derived public financing preferences; requires the scoring export.',lowLabel:'Reject public financing',highLabel:'Expand public financing',min:-10,max:10,kind:'ballot-index'},
  {id:'redistributive-taxation',label:'Redistributive taxation',description:'Choice-derived high-income and wealth-tax preferences; requires the scoring export.',lowLabel:'Restrict high-income / wealth taxes',highLabel:'Enable high-income / wealth taxes',min:-10,max:10,kind:'ballot-index'},
  {id:'governance-constraints',label:'Rules versus discretion',description:'Choice-derived binding-constraint preferences; requires the scoring export.',lowLabel:'Governing discretion',highLabel:'Binding constraints',min:-10,max:10,kind:'ballot-index'},
];
let axes = defaultAxes, axisData = null, horizontalAxis = 'public-investment', verticalAxis = 'governance-constraints', axisTransition = null, animationFrame = null, pickerDimension = null;
const axisDefinition = id => axes.find(a => a.id === id) || defaultAxes[0];
function axisValue(run, id) {
  const value = id === 'economic' || id === 'social' ? run.response?.compass?.[id] : axisData?.runs?.[run.id]?.[id];
  return coordinate(value) ? value : null;
}
function displayPoint(run) {
  if (run.status !== 'completed') return null;
  const x = axisValue(run, horizontalAxis), y = axisValue(run, verticalAxis);
  if (!axisTransition) return coordinate(x) && coordinate(y) ? { run, x, y, opacity: 1 } : null;
  const t = axisTransition, oldValue = axisValue(run, t.from), newValue = axisValue(run, t.to), fixed = t.dimension === 'x' ? y : x;
  if (!coordinate(fixed) || (!coordinate(oldValue) && !coordinate(newValue))) return null;
  let moving, opacity = 1;
  if (coordinate(oldValue) && coordinate(newValue)) moving = oldValue * Math.cos(t.progress * Math.PI / 2) + newValue * Math.sin(t.progress * Math.PI / 2);
  else if (coordinate(oldValue)) { moving = oldValue; opacity = 1 - t.progress; }
  else { moving = newValue; opacity = t.progress; }
  return { run, x: t.dimension === 'x' ? moving : fixed, y: t.dimension === 'y' ? moving : fixed, opacity };
}
const color = modelColor, voteColor = modelColor;
const visibleRuns = () => runs.filter(r => cohort === 'all' || provider(r) === cohort);
const visibleModels = () => models.filter(model => cohort === 'all' || provider(runs.find(r => r.model === model) || { model }) === cohort);
const firstNumber = (...values) => values.find(Number.isFinite);
function researchMetrics(run) {
  const audit = run.webAudit || run.researchAudit || run.searchAudit || run.audit || {};
  const viaOpenRouter = provider(run) === 'openrouter';
  return {
    search: audit.searchUsageReported === false ? undefined : firstNumber(run.searchCalls, run.webSearchCount, audit.searchCalls, audit.searchCount, ...(viaOpenRouter ? [audit.webSearchCalls, run.webSearchCalls] : [])),
    fetch: audit.fetchUsageReported === false ? undefined : firstNumber(run.fetchCalls, run.webFetchCalls, audit.webFetchCalls, audit.fetchCalls, audit.fetchCount, audit.pageFetchCalls),
    actions: viaOpenRouter ? undefined : firstNumber(run.webSearchCalls, audit.webToolCalls, audit.webSearchCalls),
  };
}
function researchSummary(run) {
  const m = researchMetrics(run), parts = [];
  if (m.search !== undefined) parts.push(`${m.search} ${provider(run)==='claude'?'completed searches':'search requests'}`);
  else if (provider(run) === 'openrouter') parts.push('search count unreported');
  if (m.fetch !== undefined) parts.push(`${m.fetch} ${provider(run)==='claude'?'completed fetches':'fetch requests'}`);
  else if (provider(run) === 'openrouter') parts.push('fetch count unreported');
  if (m.actions !== undefined) parts.push(`${m.actions} recorded web actions`);
  return parts.length ? parts.join(' · ') : 'Research activity not reported';
}

// Invalid attempts can retain any parsable JSON. Project only fields safe to render;
// the unchanged response remains available in the audit disclosure.
const array = value => Array.isArray(value) ? value : [];
const string = value => typeof value === 'string' ? value : '';
function displayResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    overallSummary: string(value.overallSummary),
    decisions: array(value.decisions).filter(d => d && typeof d === 'object').map(d => ({ contestId: string(d.contestId), choices: array(d.choices).filter(c => typeof c === 'string'), status: string(d.status), rationale: string(d.rationale), sources: array(d.sources).filter(s => typeof s === 'string') })),
    compass: value.compass && typeof value.compass === 'object' ? { economic: value.compass.economic, social: value.compass.social, confidence: string(value.compass.confidence), rationale: string(value.compass.rationale), evidenceContestIds: array(value.compass.evidenceContestIds).filter(id => typeof id === 'string') } : null,
    sources: array(value.sources).filter(s => s && typeof s === 'object').map(s => ({ id: string(s.id), url: string(s.url), title: string(s.title) })),
    limitations: array(value.limitations).map(pretty),
  };
}

function link(text, url) {
  const n = el('a', text);
  try { const u = new URL(url); if (['http:', 'https:'].includes(u.protocol)) { n.href = u.href; n.target = '_blank'; n.rel = 'noopener noreferrer'; } } catch { /* untrusted or malformed URLs stay inert */ }
  return n;
}
function disclosure(title, content) { const n = el('details', undefined, 'disclosure'); n.append(el('summary', title), content); return n; }
function textList(items) { const n = el('ul'); for (const item of items || []) n.append(el('li', pretty(item))); return n; }
function badge(run) { return el('span', status(run), `status ${/^[a-z_]+$/.test(run.status) ? run.status : ''}`); }
function sourceLinks(ids, response) {
  const n = el('div', undefined, 'citations'), sources = new Map((response?.sources || []).map(s => [s.id, s]));
  for (const id of ids || []) { const s = sources.get(id); n.append(s ? link(`${s.id} · ${s.title}`, s.url) : el('span', `Unresolved source: ${id}`)); }
  return n;
}
function choices(decision, contest) {
  const n = el('div', undefined, 'choice');
  if (!decision) { n.textContent = 'No recorded decision'; return n; }
  if (decision.status !== 'voted') { n.textContent = decision.status === 'abstain' ? 'Abstain' : 'Insufficient information'; return n; }
  if (contest?.ranked || decision.choices.length > 1) {
    if (contest?.ranked) n.append(el('span', 'Ranked choices'));
    const list = el(contest?.ranked ? 'ol' : 'ul'); decision.choices.forEach(c => list.append(el('li', c))); n.append(list);
  } else n.textContent = decision.choices[0] || 'No choice recorded';
  return n;
}
function mean(points, key) { return points.reduce((s, r) => s + axisValue(r, key), 0) / points.length; }
function pointMean(points, key) { return points.reduce((s, p) => s + p[key], 0) / points.length; }

function renderAxisDescriptions() {
  const root = $('axis-descriptions'); root.replaceChildren();
  for (const [direction, id] of [['Horizontal', horizontalAxis], ['Vertical', verticalAxis]]) {
    const axis = axisDefinition(id), section = el('div', undefined, 'axis-description'), p = el('p');
    const intro = (axis.description || '').split(/\s\d+ (?:measures?|coordinate);/)[0];
    const kind = axis.totalItems === 1 && array(axis.items).length === 1 ? 'single-measure indicator' : (axis.kind || 'unspecified scoring method').replaceAll('-', ' ');
    p.append(el('strong', `${direction}: ${axis.label}`), document.createTextNode(` · ${kind}. ${intro}`)); section.append(p);
    section.append(el('p', `−10: ${axis.lowLabel || axis.negativeLabel || 'negative end'} · +10: ${axis.highLabel || axis.positiveLabel || 'positive end'}.`, 'axis-poles'));
    const items = array(axis.items);
    if (items.length) {
      const rule = el('p'), equalBinary = items.every(i => i.yesScore === 10 && i.noScore === -10 && i.weight === 1);
      rule.append(el('strong', 'Scoring rule: '), document.createTextNode(`${equalBinary ? 'Yes = +10; No = −10; equal mean of answered measures. ' : 'Weighted mean using the item scores below. '}Requires at least ${axis.minAnswered ?? 'the stated minimum'} of ${axis.totalItems ?? items.length} answered. Abstention and missing answers are excluded; below threshold gives no score.`)); section.append(rule);
      const list = el('ul');
      for (const item of items) {
        const li = el('li'); li.append(el('strong', item.title || item.contestId), el('p', `Yes: ${item.yesScore}; No: ${item.noScore}; weight: ${item.weight}. ${item.yesMeaning || ''}${item.note ? ` ${item.note}` : ''}`));
        const sources = el('div', undefined, 'citations');
        for (const [index, url] of array(item.sourceUrls).entries()) sources.append(link(`Official source ${index + 1} ↗`, url));
        if (contests.some(c => c.id === item.contestId)) { const b = el('button', 'Compare this contest', 'rubric-contest-link'); b.type = 'button'; b.addEventListener('click', () => { $('contest-select').value = item.contestId; renderComparison(); $('compare-title').scrollIntoView({ block: 'start' }); }); sources.append(b); }
        li.append(sources); list.append(li);
      }
      section.append(disclosure(`Scoring items and sources (${items.length})`, list));
    } else if (axis.responseField) section.append(el('p', `Scoring rule: copy ${axis.responseField} unchanged; one finite coordinate within −10 to +10 is required.`, 'axis-rule'));
    root.append(section);
  }
}
function closeAxisPicker() { $('axis-picker').hidden = true; pickerDimension = null; }
function openAxisPicker(dimension) {
  if (axisTransition) return;
  pickerDimension = dimension;
  const select = $('axis-select'), current = dimension === 'x' ? horizontalAxis : verticalAxis, other = dimension === 'x' ? verticalAxis : horizontalAxis;
  select.replaceChildren();
  for (const axis of axes.filter(a => a.id !== other)) { const option = el('option', `${axis.label} · ${axis.kind || 'score'}`); option.value = axis.id; select.append(option); }
  select.value = current; $('axis-picker-label').textContent = dimension === 'x' ? 'Choose horizontal axis' : 'Choose vertical axis';
  $('axis-picker').hidden = false; $('axis-picker').dataset.dimension = dimension; select.focus();
  try { select.showPicker?.(); } catch { /* The focused native select remains available when automatic opening is unsupported. */ }
}
function changeAxis(dimension, next) {
  const old = dimension === 'x' ? horizontalAxis : verticalAxis, other = dimension === 'x' ? verticalAxis : horizontalAxis;
  closeAxisPicker();
  if (old === next || next === other || !axes.some(a => a.id === next)) return;
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  if (dimension === 'x') horizontalAxis = next; else verticalAxis = next;
  renderAxisDescriptions(); renderAttempts(); renderSummary(); renderRun();
  const restoreFocus = () => $('compass').querySelector(`[data-axis="${dimension}"]`)?.focus();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { axisTransition = null; renderCompass(); restoreFocus(); return; }
  axisTransition = { dimension, from: old, to: next, progress: 0 };
  let started;
  const frame = timestamp => {
    started ??= timestamp;
    const progress = Math.min(1, (timestamp - started) / 700);
    axisTransition.progress = progress * progress * (3 - 2 * progress);
    renderCompass();
    if (progress < 1) animationFrame = requestAnimationFrame(frame);
    else { axisTransition = null; animationFrame = null; renderCompass(); restoreFocus(); }
  };
  animationFrame = requestAnimationFrame(frame);
}

function renderCompass() {
  const root = $('compass'); root.replaceChildren(); $('legend').replaceChildren();
  const shown = visibleRuns(), valid = shown.filter(plotted), points = shown.map(displayPoint).filter(Boolean), width = Math.max(280, root.getBoundingClientRect().width);
  const left = 66, top = 42, size = width - left - 22, right = left + size, bottom = top + size, height = bottom + 90;
  // Keep endpoint circles, selection strokes, and mean diamonds inside the frame.
  const inset = 16, scaleSize = size - inset * 2;
  const x = n => left + inset + (n + 10) / 20 * scaleSize, y = n => bottom - inset - (n + 10) / 20 * scaleSize, center = (left + right) / 2;
  const visibleAxis = dimension => axisDefinition(axisTransition?.dimension === dimension && axisTransition.progress < .5 ? axisTransition.from : dimension === 'x' ? horizontalAxis : verticalAxis);
  const horizontal = visibleAxis('x'), vertical = visibleAxis('y');
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'compass-svg', role: 'group', 'aria-label': `${horizontal.label} versus ${vertical.label}. Select either axis label to change dimensions. Exact final coordinates are available in the attempts table.` });
  const defs = svgEl('defs'), clip = svgEl('clipPath', { id: 'compass-domain' }); clip.append(svgEl('rect', { x: left, y: top, width: size, height: size })); defs.append(clip); svg.append(defs);
  const marks = svgEl('g', { 'clip-path': 'url(#compass-domain)' });
  svg.append(svgEl('rect', { x: left, y: top, width: right-left, height: bottom-top, fill: 'var(--panel)', rx: 4 }));
  for (const tick of (width < 400 ? [-10, 0, 10] : [-10, -5, 0, 5, 10])) {
    svg.append(svgEl('line', { x1: x(tick), x2: x(tick), y1: top, y2: bottom, class: tick ? 'gridline' : 'zeroline' }), svgEl('line', { x1: left, x2: right, y1: y(tick), y2: y(tick), class: tick ? 'gridline' : 'zeroline' }));
    svg.append(svgEl('text', { x: x(tick), y: bottom + 18, 'text-anchor': 'middle' }, tick > 0 ? `+${tick}` : tick), svgEl('text', { x: left - 10, y: y(tick) + 4, 'text-anchor': 'end' }, tick > 0 ? `+${tick}` : tick));
  }
  const shortVerticalPole = value => { const limit = Math.floor((width - 20) / 6.4); return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value; };
  svg.append(svgEl('text', { x: width / 2, y: 20, 'text-anchor': 'middle', class: 'axis-label endpoint' }, shortVerticalPole(`${vertical.highLabel || vertical.positiveLabel || '+10'}${vertical.highLabel || vertical.positiveLabel ? ' +10' : ''}`)));
  const shortPole = value => { const limit = Math.floor((size / 2 - 10) / 6); return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value; };
  svg.append(svgEl('text', { x: left, y: height - 48, 'text-anchor': 'start', class: 'axis-label endpoint' }, shortPole(horizontal.lowLabel || horizontal.negativeLabel || '−10')), svgEl('text', { x: right, y: height - 48, 'text-anchor': 'end', class: 'axis-label endpoint' }, shortPole(horizontal.highLabel || horizontal.positiveLabel || '+10')));
  svg.append(svgEl('text', { x: width / 2, y: height - 4, 'text-anchor': 'middle', class: 'axis-label endpoint' }, shortVerticalPole(`${vertical.lowLabel || vertical.negativeLabel || '−10'}${vertical.lowLabel || vertical.negativeLabel ? ' −10' : ''}`)));
  for (const [dimension, axis, attributes] of [['x', horizontal, { x: center, y: height - 26 }], ['y', vertical, { transform: `translate(16,${(top+bottom)/2}) rotate(-90)` }]]) {
    const maxLabel = Math.max(18, Math.floor(size / 7)), shortLabel = axis.label.length > maxLabel ? `${axis.label.slice(0, maxLabel - 1)}…` : axis.label;
    const button = svgEl('text', { ...attributes, 'data-axis': dimension, 'text-anchor': 'middle', class: 'axis-label axis-button', role: 'button', tabindex: 0, 'aria-label': `Change ${dimension === 'x' ? 'horizontal' : 'vertical'} axis: ${axis.label}`, 'aria-haspopup': 'listbox', 'aria-disabled': String(Boolean(axisTransition)) }, `${shortLabel} ▾`);
    button.addEventListener('click', () => openAxisPicker(dimension)); button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAxisPicker(dimension); } }); svg.append(button);
  }
  const meanMarks=[];
  for (const model of visibleModels()) {
    const finalRuns = valid.filter(r => r.model === model), modelPoints = points.filter(p => p.run.model === model && p.opacity === 1), row = el('div', undefined, 'legend-row');
    const representative = finalRuns[0] || shown.find(r => r.model === model), title = el('button', name(model), 'legend-model'); title.type = 'button'; title.disabled = !representative; title.title = `${model} · ${providerName(representative || { model })}`; title.setAttribute('aria-pressed', String(selected?.model === model)); title.addEventListener('click', () => { if (representative) chooseRun(representative.id); });
    row.style.setProperty('--model-color', color(model)); const icon=brandIcon(model);icon.style.color=color(model);row.append(icon, title);
    row.append(el('span', finalRuns.length ? `n=${finalRuns.length} · ${format(mean(finalRuns, horizontalAxis))}, ${format(mean(finalRuns, verticalAxis))}` : 'no scores for this pair', 'legend-number')); $('legend').append(row);
    if (!modelPoints.length) continue;
    const mx = x(pointMean(modelPoints, 'x')), my = y(pointMean(modelPoints, 'y'));
    const spreadMode=$('spread-mode').value;
    const spread=svgEl('g',{'data-model':model,class:'observed-spread','aria-hidden':'true'});
    if(modelPoints.length>1 && spreadMode!=='none'){
      if(spreadMode==='area'){
        const hull=envelope(modelPoints);
        if(hull.length>=3)spread.append(svgEl('polygon',{points:hull.map(p=>`${x(p.x)},${y(p.y)}`).join(' '),fill:color(model),'fill-opacity':selected?.model===model?0.2:0.08,stroke:color(model),'stroke-opacity':0.5,'stroke-width':1.5}));
        else if(hull.length===2)spread.append(svgEl('line',{x1:x(hull[0].x),y1:y(hull[0].y),x2:x(hull[1].x),y2:y(hull[1].y),stroke:color(model),class:'spread'}));
      } else if(spreadMode==='connections'){
        for(const p of modelPoints)spread.append(svgEl('line',{x1:mx,y1:my,x2:x(p.x),y2:y(p.y),stroke:color(model),class:'spread'}));
      } else {
        const ex=modelPoints.map(p=>p.x),sy=modelPoints.map(p=>p.y);
        spread.append(svgEl('line',{x1:x(Math.min(...ex)),x2:x(Math.max(...ex)),y1:my,y2:my,stroke:color(model),class:'spread'}),svgEl('line',{x1:mx,x2:mx,y1:y(Math.min(...sy)),y2:y(Math.max(...sy)),stroke:color(model),class:'spread'}));
      }
    }
    marks.append(spread);
    const meanMark=svgEl('g',{transform:`translate(${mx},${my})`,class:'compass-brand-mean',role:'button',tabindex:axisTransition?-1:0,'aria-label':`${name(model)} mean: ${horizontal.label} ${format(pointMean(modelPoints,'x'))}; ${vertical.label} ${format(pointMean(modelPoints,'y'))}; ${modelPoints.length} plotted runs`,'aria-pressed':String(selected?.model===model),style:`color:${color(model)}`});
    const radius=selected?.model===model?14:11;
    meanMark.append(svgEl('circle',{r:radius,fill:'var(--panel)',stroke:color(model),'stroke-width':selected?.model===model?2.5:1}));
    const logo=brandSvg(model,radius*1.5);logo.setAttribute('x',-radius*.75);logo.setAttribute('y',-radius*.75);meanMark.append(logo);
    meanMark.append(svgEl('title',{},`${name(model)} · mean of ${modelPoints.length} plotted rounds`));
    meanMark.addEventListener('click',()=>{if(representative)chooseRun(representative.id)});meanMark.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();if(representative)chooseRun(representative.id)}});
    meanMarks.push({model,node:meanMark});
  }
  // Preserve exact coordinates: coincident points are never jittered into fictional values.
  for (const point of [...points.filter(p => p.run.id !== selected?.id), ...points.filter(p => p.run.id === selected?.id)]) {
    const run = point.run, description = axisTransition ? `${label(run)}: axis transition animation` : `${label(run)}: ${horizontal.label} ${point.x}, ${vertical.label} ${point.y}. Inspect this ballot.`;
    const dot = svgEl('circle', { cx: x(point.x), cy: y(point.y), r: run.id === selected?.id ? 7 : 5, fill: provider(run) === 'openrouter' ? 'var(--panel)' : color(run.model), style: `--model-color:${color(run.model)};opacity:${point.opacity}`, class: `run-dot ${provider(run)}${run.id === selected?.id ? ' selected' : ''}`, role: 'button', tabindex: axisTransition ? -1 : 0, 'aria-label': description, 'aria-pressed': String(run.id === selected?.id) });
    dot.append(svgEl('title', {}, description)); dot.addEventListener('click', () => chooseRun(run.id)); dot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseRun(run.id); } }); marks.append(dot);
  }
  for(const mark of [...meanMarks.filter(m=>m.model!==selected?.model),...meanMarks.filter(m=>m.model===selected?.model)])marks.append(mark.node);
  svg.append(marks);
  if (!points.length) svg.append(svgEl('text', { x: center, y: (top+bottom)/2, 'text-anchor': 'middle' }, shown.length ? 'No completed scores for this pair' : 'Not run yet'));
  root.append(svg);
}

function renderAttempts() {
  const table = el('table'), head = el('thead'), hr = el('tr');
  for (const title of ['Model / provider / round', 'Status', axisDefinition(horizontalAxis).label, axisDefinition(verticalAxis).label, 'Research activity']) { const th = el('th', title); th.scope = 'col'; hr.append(th); } head.append(hr); table.append(head);
  const body = el('tbody');
  for (const run of visibleRuns()) {
    const row = el('tr'), cell = el('td'), b = el('button', label(run)); b.type = 'button'; b.addEventListener('click', () => chooseRun(run.id)); cell.append(b); row.append(cell, el('td', status(run)));
    row.append(el('td', run.status === 'completed' ? format(axisValue(run, horizontalAxis)) : '—'), el('td', run.status === 'completed' ? format(axisValue(run, verticalAxis)) : '—'), el('td', researchSummary(run))); body.append(row);
  }
  table.append(body); $('attempts').replaceChildren(visibleRuns().length ? table : el('p', 'No recorded attempts in this cohort yet.', 'empty'));
}

function renderRun() {
  const root = $('run-detail'); root.replaceChildren();
  if (!selected) { root.append(el('p', 'No recorded attempts yet. Results will appear after the experiment runs.', 'empty')); return; }
  const run = selected, response = displayResponse(run.response), top = el('div', undefined, 'run-heading'); const heading=el('h3',undefined,'model-heading'),icon=brandIcon(run.model);icon.style.color=color(run.model);heading.append(icon,document.createTextNode(label(run)));top.append(heading, badge(run)); root.append(top);
  const time = Number.isFinite(run.wallMs) ? `${(run.wallMs / 1000).toFixed(1)} seconds` : 'duration unavailable';
  root.append(el('p', `${providerName(run)} · ${run.effort || 'unspecified'} reasoning · ${time} · ${researchSummary(run)}`, 'run-meta'));
  const cost = firstNumber(run.usage?.costUsd, run.costUsd, run.usageCost);
  if (cost !== undefined) root.append(el('p', `${provider(run)==='claude'?'CLI API-equivalent usage estimate':'Reported API usage cost'}: $${cost.toFixed(4)} USD${run.usage?.costSource ? ` (${run.usage.costSource})` : ''}.`, 'run-meta'));
  root.append(el('p', provider(run) === 'claude' ? 'Claude Code delivery through Anthropic. Web actions pair tool calls with non-error results; counts do not establish retrieval quality. CLI cost is an API-equivalent estimate, not a verified subscription charge.' : provider(run) === 'openrouter' ? 'OpenRouter delivery. Search and fetch counts are API-reported requests, not verified successful actions. Unreported metrics remain unknown. These counts are not directly equivalent to Codex web-action counts.' : 'Codex delivery with its native web tools. Recorded web actions can include different action types; this total is not a count of independent sources or necessarily a count of search queries.', 'run-meta'));
  const webAudit = run.webAudit || run.researchAudit || run.searchAudit || run.audit || {};
  if (webAudit.searchEngineRequested || webAudit.fetchEngineRequested) root.append(el('p', `Requested search engine: ${webAudit.searchEngineRequested || 'unreported'} · requested fetch engine: ${webAudit.fetchEngineRequested || 'unreported'}.`, 'run-meta'));
  if (run.error) root.append(el('p', run.error, 'warning'));
  if (run.status !== 'completed' && response) root.append(el('p', 'This attempt did not pass the harness checks. Its recorded response is shown for audit and is excluded from the compass and model means.', 'warning'));
  if (run.validation?.errors?.length) root.append(disclosure('Validation errors', textList(run.validation.errors)));
  if (run.protocolWarnings?.length) root.append(disclosure('Output formatting notes', textList(run.protocolWarnings)));
  if (run.publicCommentary) root.append(disclosure('Recorded progress text before the final ballot', el('pre', run.publicCommentary)));
  if (run.status === 'completed') {
    const evidence = axisData?.evidence?.[run.id] || {}, coverage = id => {
      const e = evidence[id]; return e ? `${e.answered}/${e.total} answered; minimum ${e.minAnswered}` : 'coverage not exported';
    };
    root.append(el('p', `Current chart: ${axisDefinition(horizontalAxis).label} ${format(axisValue(run, horizontalAxis))} (${coverage(horizontalAxis)}) · ${axisDefinition(verticalAxis).label} ${format(axisValue(run, verticalAxis))} (${coverage(verticalAxis)}).`, 'run-meta'));
    const scores = el('div'); scores.append(textList(axes.map(axis => `${axis.label}: ${format(axisValue(run, axis.id))} · ${coverage(axis.id)} · ${axis.kind || 'unspecified method'}.`)));
    scores.append(disclosure('Item-by-item scoring evidence for this run', el('pre', JSON.stringify(evidence, null, 2))));
    root.append(disclosure('Scores and coverage across all available axes', scores));
  }
  if (response) {
    root.append(el('p', response.overallSummary));
    const c = response.compass, placement = el('div', undefined, 'placement');
    if (c) {
      placement.append(el('h4', `Self-placement: economic ${format(c.economic)} · social ${format(c.social)}`), el('p', `${c.confidence || 'unspecified'} confidence. ${c.rationale || ''}`));
      if (!coordinate(c.economic) || !coordinate(c.social)) placement.append(el('p', 'A missing or unsupported axis is unplotted; it does not represent a centrist score.'));
      const evidence = el('div', undefined, 'evidence-links');
      for (const id of c.evidenceContestIds || []) {
        const index = contests.findIndex(t => t.id === id), a = el('a', contests[index]?.title || id); if (index >= 0) a.href = `#ballot-contest-${index}`;
        a.addEventListener('click', () => { const filter = $('ballot-filter'); if (filter) { filter.value = ''; filter.dispatchEvent(new Event('input')); } }); evidence.append(a);
      }
      placement.append(evidence); root.append(disclosure('Supplementary: model self-placement (not used in primary scores)', placement));
    }
    if (response.limitations?.length) root.append(disclosure('The model’s limitations and reservations', textList(response.limitations)));
    const filterLabel = el('label', 'Find a contest in this ballot', 'ballot-filter'), filter = el('input'); filter.id = 'ballot-filter'; filter.type = 'search'; filter.placeholder = 'Search title, jurisdiction, or choice…'; filterLabel.append(filter); root.append(filterLabel);
    const list = el('div', undefined, 'ballot-list'), decisions = new Map((response.decisions || []).map(d => [d.contestId, d]));
    contests.forEach((contest, index) => {
      const d = decisions.get(contest.id), article = el('article', undefined, 'contest-card'); article.id = `ballot-contest-${index}`;
      article.dataset.search = `${contest.title} ${contest.jurisdiction} ${(d?.choices || []).join(' ')}`.toLowerCase();
      article.append(el('h4', contest.title), el('p', `${contest.jurisdiction} · ${contest.ranked ? 'ranked choice' : `select up to ${contest.maxSelections}`}`, 'jurisdiction'), choices(d, contest));
      if (d) article.append(el('p', d.rationale, 'rationale'), sourceLinks(d.sources, response)); list.append(article);
    });
    filter.addEventListener('input', () => { const q = filter.value.trim().toLowerCase(); for (const article of list.children) article.hidden = !article.dataset.search.includes(q); }); root.append(list);
    const sources = el('ol', undefined, 'source-list'); for (const s of response.sources || []) { const li = el('li'); li.append(link(`${s.id} · ${s.title}`, s.url)); sources.append(li); } root.append(disclosure(`All cited sources (${response.sources?.length || 0})`, sources));
  } else root.append(el('p', run.status === 'pending' || run.status === 'running' ? 'No final response recorded yet.' : 'No structured ballot response was recorded.', 'empty'));
  const audit = { provider: provider(run), batchId: run.batchId, requestedModel: run.requestedModel || run.model, resolvedModel: run.resolvedModel ?? null, servingProvider: run.servingProvider, effort: run.effort, cliVersion: run.cliVersion, startedAt: run.startedAt, finishedAt: run.finishedAt, usage: run.usage, modelUsage: run.modelUsage, primaryModels: run.primaryModels, costUsd: run.costUsd, usageCost: run.usageCost, usageMayBeIncomplete: run.usageMayBeIncomplete, webSearchCalls: run.webSearchCalls, webFetchCalls: run.webFetchCalls, searchCalls: run.searchCalls, fetchCalls: run.fetchCalls, searchConfig: run.searchConfig, search: run.search, webAudit: run.webAudit, researchAudit: run.researchAudit, searchAudit: run.searchAudit, audit: run.audit, hashes: run.hashes, responseSha256: run.responseSha256, validation: run.validation };
  root.append(disclosure('Usage, provenance, and validation', el('pre', JSON.stringify(audit, null, 2))));
  if (run.response !== null && run.response !== undefined) root.append(disclosure('Exact recorded structured response', el('pre', JSON.stringify(run.response, null, 2))));
}

function comparisonDecision(run, contest) {
  const matches = displayResponse(run?.response)?.decisions.filter(d => d.contestId === contest.id) || [];
  return { decision: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}
function comparisonChoice(decision, contest, ambiguous) {
  if (ambiguous) return 'Ambiguous: multiple recorded decisions';
  if (!decision) return 'No recorded decision';
  if (decision.status === 'abstain') return 'Abstain';
  if (decision.status === 'insufficient_information') return 'Insufficient information';
  if (decision.status !== 'voted') return `Unknown decision status${decision.status ? ': '+decision.status : ''}`;
  if (!decision.choices.length) return 'No choice recorded';
  return contest.ranked ? decision.choices.map((c,i) => `${i+1}. ${c}`).join(' → ') : decision.choices.join(' + ');
}
function comparisonTable(contest, contestIndex) {
  const table = el('table', undefined, 'votes-table'), caption = el('caption', `${contest.title}: recorded choices by model and round`, 'sr-only');
  table.append(caption);
  const head = el('thead'), headers = el('tr');
  for (const title of ['Model', 'Round 1', 'Round 2', 'Round 3']) { const th=el('th',title); th.scope='col'; headers.append(th); }
  head.append(headers); table.append(head); const body=el('tbody');
  for (const model of visibleModels()) {
    const row=el('tr'), modelCell=el('th',name(model)); modelCell.scope='row'; row.append(modelCell);
    for (const trial of [1,2,3]) {
      const cell=el('td'), attempts=visibleRuns().filter(r=>r.model===model && r.trial===trial);
      if (!attempts.length) cell.append(el('span','No attempt recorded','vote-missing'));
      for (const run of attempts) {
        const {decision,ambiguous}=comparisonDecision(run,contest), text=comparisonChoice(decision,contest,ambiguous);
        const valid=run.status==='completed' && run.validation?.valid===true;
        const entry=el('div',undefined,'vote-entry');
        if (!valid) entry.append(el('span',`${status(run)} · unvalidated`, 'vote-invalid'));
        const button=el('button',text,'vote-choice'); button.type='button';
        button.setAttribute('aria-label',`${name(model)}, round ${trial}: ${valid?'':status(run)+', unvalidated, '}${text}. Inspect recorded ballot and sources.`);
        if (valid && decision?.status==='voted' && decision.choices.length===1 && ['Yes','No'].includes(decision.choices[0])) button.dataset.vote=decision.choices[0].toLowerCase();
        if (valid && decision?.status!=='voted') button.classList.add('vote-missing');
        button.addEventListener('click',()=>{chooseRun(run.id); ($(`ballot-contest-${contestIndex}`)||$('inspect-title')).scrollIntoView({block:'start'});});
        entry.append(button); cell.append(entry);
      }
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);return table;
}
const lineDrawers = new WeakMap();
const lineResize = new ResizeObserver(entries => { for (const {target} of entries) lineDrawers.get(target)?.(); });
const lineFormat = value => value === null ? 'No valid average' : value === 0 ? '0' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(2).replace(/\.00$/, '')}`;
function binaryNumberLine(contest, contestIndex) {
  const root = el('div', undefined, 'binary-overview'), plot = el('div', undefined, 'vote-numberline');
  const detail = el('p', undefined, 'line-detail'); detail.setAttribute('aria-live','polite');
  const entries = visibleModels().map(model => ({model,...averageBinaryVotes(visibleRuns().filter(r=>r.model===model),contest.id)}));
  let active=entries.find(e=>e.mean!==null)?.model, previousWidth=0;
  function select(entry){
    active=entry.model;
    detail.textContent=`${name(entry.model)}: ${lineFormat(entry.mean)} · ${entry.count}/3 valid rounds. `+entry.rounds.map(({run,score})=>`R${run.trial}: ${comparisonChoice(comparisonDecision(run,contest).decision,contest,false)} (${lineFormat(score)})`).join(' · ')+(entry.excluded?` · ${entry.excluded} unsuccessful or unsupported round(s) excluded.`:'');
    // Preserve keyboard focus when the selected label changes.
    for(const button of root.querySelectorAll('[data-model]'))button.setAttribute('aria-pressed',String(button.dataset.model===active));
  }
  function modelButton(entry,cls){
    const button=el('button',undefined,cls);button.type='button';button.dataset.model=entry.model;
    button.style.setProperty('--model-color',voteColor(entry.model));button.setAttribute('aria-pressed',String(entry.model===active));
    button.setAttribute('aria-label',`${name(entry.model)}: ${lineFormat(entry.mean)}, ${entry.count} valid rounds. Show round choices.`);
    button.title=`${entry.model} · ${entry.count}/3 valid rounds`;
    button.addEventListener('click',()=>select(entry));return button;
  }
  function draw(){
    const width=plot.clientWidth;if(!width)return;previousWidth=width;plot.replaceChildren();
    const left=22,right=width-22,x=value=>left+(value+1)*(right-left)/2;
    // Pack the full label + marker bounds, so equal votes retain exact x positions
    // without making the reader cross-reference numbered dots and a legend.
    const measure=document.createElement('canvas').getContext('2d');measure.font='500 13px system-ui';
    const lanes=[];
    const points=entries.filter(e=>e.mean!==null).map(entry=>{
      const px=x(entry.mean),text=`${compactName(entry.model)}  ${lineFormat(entry.mean)}`;
      const labelWidth=Math.min(width-66,Math.ceil(measure.measureText(text).width)+22);
      const toLeft=px+20+labelWidth>width-8;
      const labelX=toLeft?Math.max(4,px-20-labelWidth):px+20;
      const lo=Math.min(px-14,labelX),hi=Math.max(px+14,labelX+labelWidth);
      let lane=lanes.findIndex(bounds=>bounds.every(([a,b])=>hi+14<a || lo>b+14));
      if(lane<0){lane=lanes.length;lanes.push([]);}lanes[lane].push([lo,hi]);
      return {...entry,px,lane,labelWidth,labelX,toLeft};
    });
    const baseline=30+Math.max(0,lanes.length-1)*40,height=baseline+68;
    plot.style.height=`${height}px`;
    const svg=svgEl('svg',{viewBox:`0 0 ${width} ${height}`,'aria-hidden':'true'});
    for(const value of [-1,0,1])svg.append(svgEl('line',{x1:x(value),x2:x(value),y1:10,y2:baseline+22,class:'vote-column-guide'}));
    svg.append(svgEl('line',{x1:left,x2:right,y1:baseline+22,y2:baseline+22,class:'vote-axis'}));
    for(const [value,text,anchor] of [[-1,'−1 · No','start'],[0,'0','middle'],[1,'Yes · +1','end']])svg.append(svgEl('text',{x:x(value),y:baseline+50,'text-anchor':anchor,class:'vote-axis-label'},text));
    plot.append(svg);
    for(const point of points){
      const py=baseline-point.lane*40;
      const button=modelButton(point,'vote-labeled-dot');
      button.style.left=`${point.px-14}px`;button.style.top=`${py-14}px`;
      const marker=el('span',undefined,'vote-brand-marker');marker.append(brandIcon(point.model));
      const text=el('span',undefined,'vote-direct-label');text.style.left=`${point.labelX-point.px+14}px`;text.style.width=`${point.labelWidth}px`;text.classList.toggle('label-left',point.toLeft);
      text.append(el('span',compactName(point.model),'vote-model-name'),el('strong',lineFormat(point.mean),'vote-mean'));
      if(point.count<3)text.append(el('small',`n=${point.count}`));
      button.append(marker,text);plot.append(button);
    }
  }
  root.append(el('p','Average of three rounds: No −1 · Abstain / insufficient information 0 · Yes +1. Select a model for its round-by-round votes.','chart-note'),plot,detail);
  const unavailable=entries.filter(e=>e.mean===null);
  if(unavailable.length){
    const missing=el('div',undefined,'line-unavailable');missing.append(el('span','No valid average:','muted'));
    for(const entry of unavailable){const b=modelButton(entry,'line-unavailable-model');b.append(brandIcon(entry.model),el('span',compactName(entry.model)));missing.append(b);}root.append(missing);
  }
  lineDrawers.set(plot,()=>{if(plot.clientWidth!==previousWidth)draw();});lineResize.observe(plot);
  const first=entries.find(e=>e.model===active);if(first)select(first);else detail.textContent='No validated round supplies an average for this item.';
  return root;
}
function renderResearch(){
  const root=$('research-content');root.replaceChildren();const shown=visibleRuns(),ev=shown.map(run=>({run,...researchEvidence(run)}));
  const observed=ev.filter(e=>e.state==='observed').length,none=ev.filter(e=>e.state==='none-recorded').length,unknown=ev.filter(e=>e.state==='unknown').length;
  root.append(el('p',`${observed}/${shown.length} attempts have recorded web activity · ${none} with explicit zero activity · ${unknown} unknown.`,'research-summary'));
  root.append(el('p','Activity is independent of ballot validity. Codex counts completed web actions; Claude Code counts web calls paired with non-error results; OpenRouter counts API-reported search/fetch requests. These units are not directly comparable. Citations alone do not prove tool use, and tool counts do not establish research quality or that every ballot item was researched.','chart-note'));
  for(const group of ['codex','openrouter','claude']){
    const groupModels=visibleModels().filter(model=>provider(shown.find(r=>r.model===model)||{model})===group);if(!groupModels.length)continue;
    root.append(el('h3',group==='codex'?'Codex · recorded completed web actions':group==='claude'?'Claude Code · completed search/fetch tool results':'OpenRouter · API-reported search requests'));
    const table=el('table',undefined,'votes-table research-table'),head=el('thead'),header=el('tr');for(const title of ['Model','Round 1','Round 2','Round 3']){const th=el('th',title);th.scope='col';header.append(th);}head.append(header);table.append(head);const body=el('tbody');
    for(const model of groupModels){const row=el('tr'),th=el('th',name(model));th.scope='row';row.append(th);for(const trial of [1,2,3]){const cell=el('td'),e=ev.find(e=>e.run.model===model&&e.run.trial===trial);if(!e){cell.textContent='Not attempted';row.append(cell);continue;}const b=el('button',e.state==='observed'?'Activity recorded':e.state==='none-recorded'?'No activity recorded':'Unknown','vote-choice');b.type='button';b.addEventListener('click',()=>{chooseRun(e.run.id);$('inspect-title').scrollIntoView({block:'start'});});cell.append(b);cell.append(el('div',group==='codex'?`${e.actions??'Unreported'} web actions`:`${e.searches??'Unreported'} searches · ${e.fetches??'unreported'} fetches`,'run-meta'));cell.append(el('div',`Ballot: ${status(e.run)}`,'run-meta'));if(e.run.status!=='completed'){const reasons=array(e.run.validation?.errors);cell.append(el('div',reasons.length?reasons.join('; '):'No valid final ballot; inspect attempt for details.','research-error'));}row.append(cell);}body.append(row);}table.append(body);root.append(table);
  }
}

function renderComparison() {
  const root=$('contest-comparison'), openIds=new Set([...root.querySelectorAll('.vote-contest[open]')].map(d=>d.dataset.contest));
  for(const plot of root.querySelectorAll('.vote-numberline'))lineResize.unobserve(plot);
  disconnectCandidateCharts(root);
  root.replaceChildren(); const shown=visibleRuns();
  const ranked=rankBallotItems(contests,shown), picker=$('contest-select'), previousContest=picker.value;
  picker.replaceChildren();
  for (const {contest,disagreement} of ranked) {
    const option=el('option',`${disagreement.score===null?'Unscored':disagreement.score.toFixed(1)+'/100'} · ${contest.title} · ${contest.jurisdiction}`);
    option.value=contest.id;picker.append(option);
  }
  if(ranked.some(({contest})=>contest.id===previousContest))picker.value=previousContest;
  for (const {index,contest,disagreement} of ranked) {
    const item=el('details',undefined,'vote-contest'); item.id=`all-votes-${contest.id}`;item.dataset.contest=contest.id;
    const summary=el('summary'), title=el('span',contest.title,'vote-contest-title'); summary.append(title);
    const score=el('span',disagreement.score===null?'Disagreement unavailable':`Disagreement ${disagreement.score.toFixed(1)}/100`,'vote-disagreement');
    summary.append(score,el('span',`${disagreement.modelCount} voting models · ${disagreement.voteCount} valid votes`,'vote-evidence'));
    item.dataset.disagreement=disagreement.score===null?'':String(disagreement.score);
    const valid=shown.filter(r=>r.status==='completed'&&r.validation?.valid===true);
    const decisions=valid.map(r=>comparisonDecision(r,contest).decision), voted=decisions.filter(d=>d?.status==='voted');
    const binary=voted.length && voted.every(d=>d.choices.length===1 && ['Yes','No'].includes(d.choices[0]));
    const counts=binary ? `${voted.filter(d=>d.choices[0]==='Yes').length} Yes · ${voted.filter(d=>d.choices[0]==='No').length} No` : `${voted.length} choices`;
    summary.append(el('span',`${counts} · ${valid.length-voted.length} unchosen · ${shown.length-valid.length} unvalidated attempts`,'vote-tally'));
    item.append(summary);
    const content=el('div');item.append(content);let built=false;
    function populate(){if(built)return;built=true;content.append(el('p',`${contest.jurisdiction} · ${contest.ranked?'Ranked choices in order':`Up to ${contest.maxSelections} selection(s); multiple selections are unordered`}`,'run-meta'));const binaryItem=array(contest.options).length===2 && contest.options.includes('Yes') && contest.options.includes('No');if(binaryItem){content.append(binaryNumberLine(contest,index),disclosure('Individual round choices and unsuccessful attempts',comparisonTable(contest,index)));}else if(!contest.ranked && contest.maxSelections===1 && contest.options.length){content.append(candidateChart(contest,visibleModels(),visibleRuns(),{name,compactName,color:voteColor,brandIcon,choice:run=>{const {decision,ambiguous}=comparisonDecision(run,contest);return comparisonChoice(decision,contest,ambiguous);},rationale:run=>comparisonDecision(run,contest).decision?.rationale,inspect:run=>{chooseRun(run.id);($(`ballot-contest-${index}`)||$('inspect-title')).scrollIntoView({block:'start'});}}),disclosure('Individual round choices and unsuccessful attempts',comparisonTable(contest,index)));}else content.append(comparisonTable(contest,index));}
    item.addEventListener('toggle',()=>{if(item.open)populate()});
    item.dataset.search=[contest.title,contest.jurisdiction,...array(contest.options).map(o=>typeof o==='string'?o:o.name||o.label||'')].join(' ').toLowerCase();
    root.append(item);
    if(openIds.has(contest.id)||(!openIds.size&&contest.id===ranked[0]?.contest.id)){item.open=true;populate();}
  }
  filterComparison();
}
function filterComparison(){
  const query=$('comparison-filter').value.trim().toLowerCase();let count=0;
  for(const item of $('contest-comparison').children){item.hidden=!item.dataset.search.includes(query);if(!item.hidden)count++;}
  $('contest-info').textContent=`${count} of ${contests.length} ballot items · Most disagreement first · ${visibleModels().length} models · 3 rounds per model. Scores use valid votes from the selected cohort.`;
}
function jumpToContest(){
  $('comparison-filter').value='';filterComparison();
  const item=$(`all-votes-${$('contest-select').value}`);if(item){item.open=true;item.scrollIntoView({block:'start'});}
}

function renderMethod() {
  const root = $('method'), b = data.batch || {};
  root.append(el('p', `${b.models?.length || models.length} requested models × ${b.trials || 3} independent rounds. Each attempt starts a fresh context using the shared frozen ballot and base research instructions. Model interfaces, reasoning settings, search services, tool budgets, and timing can differ between Codex, Claude Code, and OpenRouter cohorts; the configuration and provenance below record those differences.`));
  root.append(el('p', 'The harness checks ballot coverage, choices, response structure, citation format, and recorded completed web activity. These checks do not establish that sources are true, current, or support the claims. A completed run is not an endorsement or an accuracy score.'));
  root.append(el('p', 'The plot uses only completed attempts with both coordinates supported. Means are arithmetic means of those plotted runs. Spread modes show the observed envelope, mean-to-round connections, or per-axis ranges. None is a confidence region, and three runs cannot establish statistical reliability.'));
  root.append(el('p', 'Primary dimensions apply the published rubric to recorded ballot selections. Economic and social self-assessments remain supplementary and are not used in primary scores. Tap an axis label to choose a pair; the other coordinate stays fixed during the illustrative quarter-turn. Scores with missing evidence remain unplotted, including while switching axes. Intermediate projected positions are clipped to the fixed −10 to +10 chart domain.'));
  const selfStart = (data.prompt || '').indexOf('After completing the ballot');
  const selfEnd = (data.prompt || '').indexOf('\nReturn only', selfStart);
  const selfPrompt = disclosure('Exact self-assessment instruction (supplementary)', el('pre', selfStart >= 0 ? data.prompt.slice(selfStart, selfEnd >= 0 ? selfEnd : undefined).trim() : 'No self-assessment instruction found.'));
  selfPrompt.id = 'self-score-prompt'; root.append(selfPrompt);
  root.append(disclosure('Exact base prompt', el('pre', data.prompt || 'No prompt exported.')), disclosure('Frozen ballot inventory and scope', el('pre', JSON.stringify(data.ballot || {}, null, 2))), disclosure('Cohort configurations, search tools, and provenance', el('pre', JSON.stringify({ batch: b, batches: data.batches, cohortProvenance: data.cohortProvenance, exportedAt: data.exportedAt }, null, 2))));
  root.append(disclosure('Axis definitions, scoring rubric, and exported scores', el('pre', JSON.stringify(axisData || { axes: defaultAxes, note: 'No scoring export available; choice-derived coordinates remain unplotted.' }, null, 2))));
  const a = el('a', 'Download the complete public result JSON ↗'); a.href = './data/results.json'; root.append(a);
}
function chooseRun(id) { selected = runs.find(r => r.id === id); $('run-select').value = selected?.id || ''; renderRun(); renderCompass(); }

function renderSummary() {
  const shown = visibleRuns(), done = shown.filter(r => r.status === 'completed').length, failed = shown.filter(r => ['failed', 'invalid', 'timed_out', 'interrupted'].includes(r.status)).length;
  $('batch-summary').textContent = shown.length ? `${done} completed · ${failed} unsuccessful · ${shown.length} attempts in cohort · ${contests.length} contests · ${shown.filter(plotted).length} plotted responses` : `Not run yet · ${visibleModels().length} models in cohort · ${contests.length} frozen contests`;
}
function renderCohort() {
  const shown = visibleRuns(); renderSummary();
  $('run-select').replaceChildren();
  for (const run of shown) { const option = el('option', `${label(run)} — ${status(run)}`); option.value = run.id; $('run-select').append(option); }
  $('run-select').disabled = !shown.length;
  if (!shown.some(r => r.id === selected?.id)) selected = shown.find(r => r.status === 'completed') || shown[0];
  $('run-select').value = selected?.id || '';
  renderCompass(); renderAttempts(); renderRun(); renderComparison(); renderResearch(); heroMap?.update(visibleRuns());
}

async function load() {
  try {
    const [response, extraAxes] = await Promise.all([fetch('./data/results.json'), fetch('./data/axes.json').then(r => r.ok ? r.json() : null).catch(() => null)]);
    if (!response.ok) throw new Error(`Could not load the public result export (HTTP ${response.status}).`);
    data = await response.json(); runs = Array.isArray(data.runs) ? data.runs.map(r => ({...r, id: r.id || `${r.model}-trial-${r.trial}`})) : []; contests = data.ballot?.contests || [];
    if (extraAxes && typeof extraAxes === 'object') {
      axisData = extraAxes;
      const inventory = new Map(defaultAxes.map(a => [a.id, a]));
      for (const axis of array(extraAxes.axes)) if (axis && typeof axis.id === 'string' && axis.id && typeof axis.label === 'string' && axis.label && (axis.min === undefined || axis.min === -10) && (axis.max === undefined || axis.max === 10)) inventory.set(axis.id, { ...inventory.get(axis.id), ...axis });
      axes = [...inventory.values()];
    }
    models = [...new Set([...(data.batch?.models || []), ...runs.map(r => r.model)])];
    const scope = data.ballot?.scope ?? data.batch?.scope;
    $('scope').textContent = typeof scope === 'string' ? scope : scope ? pretty(scope) : 'Scope has not been exported. Alameda County contains multiple district-specific ballots; this inventory must not be assumed to match any one voter.';
    $('run-select').disabled = !runs.length; $('contest-select').disabled = !contests.length;
    selected = runs.find(r => r.status === 'completed') || runs[0]; if (selected) $('run-select').value = selected.id;
    heroMap=rotatingMap($('rotating-map'),{axes,runs:visibleRuns(),axisValue,name,color,onInspect:id=>{chooseRun(id);$('inspect-title').scrollIntoView({block:'start'});}});
    renderCohort(); renderAxisDescriptions(); renderMethod();
    const collection=data.batches?.find(b=>b.provider==='claude-code');if(collection){const notice=el('p',`Claude collection began ${new Date(collection.createdAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'short'})}. Election results were not yet available at collection time (user-provided timing context). The original October 27 cutoff remains in every prompt; live retrieval differs from the earlier cohorts.`,'provider-note');$('provider-note').after(notice);}
    $('comparison-filter').addEventListener('input',filterComparison);
    $('run-select').addEventListener('change', e => chooseRun(e.target.value)); $('contest-select').addEventListener('change', jumpToContest); $('spread-mode').addEventListener('change', renderCompass);
    $('cohort-select').addEventListener('change', e => { cohort = e.target.value; renderCohort(); });
    $('axis-select').addEventListener('change', e => { if (pickerDimension) changeAxis(pickerDimension, e.target.value); });
    $('axis-picker-close').addEventListener('click', closeAxisPicker);
    $('axis-picker').addEventListener('keydown', e => { if (e.key === 'Escape') { closeAxisPicker(); $('compass').querySelector('.axis-button')?.focus(); } });
  } catch (error) { $('batch-summary').textContent = 'Results unavailable'; $('scope').textContent = 'The frozen scope could not be loaded.'; $('error').textContent = error.message; }
}
window.addEventListener('resize', () => { if (data) renderCompass(); });
load();
