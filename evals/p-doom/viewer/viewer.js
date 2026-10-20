import { calculationGraph, formatPercent as pct, formulaFor, modelName } from './graph.js';

const bars = document.querySelector('#probability-bars'), detail = document.querySelector('#run-detail');
const selector = document.querySelector('#run-select'), toggle = document.querySelector('#scale-toggle');
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const svgEl = (tag, attrs = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k,v]) => node.setAttribute(k, String(v))); return node; };
const family = run => modelName(run.model).split(' ')[0];
const trialLabel = run => `trial ${run.trial}${run.retryOf ? run.retryOf.trial === run.trial ? ' (rerun)' : ` (retry of ${run.retryOf.trial})` : ''}`;
const label = run => `${modelName(run.model)} · ${run.effort} · ${trialLabel(run)}`;
const submitted = run => run.status === 'submitted' && run.inference && run.submission;
const statusLabel = run => run.providerOutcome === 'blocked' || run.providerFallbacks?.some(f => f.trigger === 'refusal') ? 'provider blocked' : /at capacity/i.test(run.error || '') ? 'at capacity' : /limited access.*safety reasons/is.test(run.error || '') ? 'provider blocked' : run.status === 'timed_out' ? 'time limit' : run.status.replaceAll('_', ' ');
let runs = [], selected = null, zoom = false;
let selectionVersion = 0;

function link(text, url) {
  const node = el('a', text);
  try { const parsed = new URL(url, location.href); if (['http:', 'https:'].includes(parsed.protocol)) { node.href = parsed.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; } } catch { /* leave invalid URLs as text */ }
  return node;
}

function renderBars() {
  bars.replaceChildren();
  const valid = runs.filter(submitted);
  const high = valid.length ? Math.max(...valid.map(r => r.inference.scenarioBounds.high)) : 1;
  const ceiling = zoom ? Math.min(1, Math.max(0.01, Math.ceil(high * 100) / 100)) : 1;
  const axis = el('div', undefined, 'bar-axis');
  axis.append(el('span', 'MODEL / THINKING / TRIAL'));
  const track = el('div', undefined, 'axis-track');
  for (let i = 0; i <= 4; i++) { const tick = el('span', pct(ceiling * i / 4), 'axis-tick'); tick.style.left = `${i * 25}%`; track.append(tick); }
  axis.append(track, el('span', 'LOW / CENTRAL / HIGH')); bars.append(axis);
  for (const run of valid) {
    const row = el('button', undefined, 'range-row'); row.type = 'button'; row.dataset.run = run.id;
    row.setAttribute('aria-pressed', String(selected?.id === run.id));
    row.style.setProperty('--model-color', `var(--${family(run).toLowerCase()})`);
    const name = el('span', undefined, 'range-label');
    name.append(el('span', undefined, 'model-dot'), el('span', modelName(run.model), 'range-name'), el('span', `${run.effort} · ${run.trial}${run.retryOf ? ' ↻' : ''}`, 'range-effort')); row.title = label(run);
    const range = el('span', undefined, 'range-track'), values = el('span', undefined, 'range-values');
    if (submitted(run)) {
      const { low, high } = run.inference.scenarioBounds, central = run.inference.pDoom;
      const line = el('span', undefined, 'range-line'); line.style.left = `${low / ceiling * 100}%`; line.style.width = `${(high - low) / ceiling * 100}%`;
      const point = el('span', undefined, 'range-point'); point.style.left = `${central / ceiling * 100}%`; range.append(line, point);
      values.append(document.createTextNode(`${pct(low)} / `), el('strong', pct(central)), document.createTextNode(` / ${pct(high)}`));
      row.setAttribute('aria-label', `${label(run)}: ${pct(central)}, assumption range ${pct(low)} to ${pct(high)}. Inspect this run.`);
    } else { values.textContent = statusLabel(run); row.setAttribute('aria-label', `${label(run)}: ${statusLabel(run)}. Inspect transcript.`); }
    row.append(name, range, values); row.addEventListener('click', () => {
      chooseRun(run.id);
      document.querySelector('.inspect').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }); bars.append(row);
  }
  toggle.textContent = zoom ? 'Show full 0–100%' : 'Zoom to results'; toggle.setAttribute('aria-pressed', String(zoom));
}

function textLines(text, max = 25) {
  const words = text.replaceAll('_', ' ').split(' ').flatMap(word => word.match(new RegExp(`.{1,${max}}`, 'g')) || []), lines = []; let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length > 2 ? [lines[0], `${lines[1].slice(0, max - 1)}…`] : lines;
}

function renderCalculation(run, parent) {
  parent.append(el('h3', 'The model’s calculation', 'section-title'), el('p', 'Inputs are subjective probability assumptions. AND requires every input; OR counts overlapping routes once. Select a node to inspect its definition and evidence. Scroll the graph when needed.', 'graph-description'));
  const graph = calculationGraph(run.submission, run.inference), lookup = new Map(graph.nodes.map(n => [n.id, n]));
  const scroll = el('div', undefined, 'graph-scroll');
  const svg = svgEl('svg', { class: 'calculation', width: graph.width, height: graph.height, viewBox: `0 0 ${graph.width} ${graph.height}`, role: 'group', 'aria-label': 'Agent-authored probability calculation graph' });
  const defs = svgEl('defs'), marker = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
  marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--muted)' })); defs.append(marker); svg.append(defs);
  for (const edge of graph.edges) {
    const from = lookup.get(edge.from), to = lookup.get(edge.to), x1 = from.x + from.width, y1 = from.y + 50, x2 = to.x, y2 = to.y + 50;
    svg.append(svgEl('path', { d: `M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2-3},${y2}`, class: 'edge', 'marker-end': 'url(#arrow)' }));
  }
  const nodeDetail = el('div', undefined, 'node-detail'); nodeDetail.setAttribute('aria-live', 'polite');
  const groups = new Map();
  function selectNode(node) {
    groups.forEach((group, id) => { group.classList.toggle('selected', id === node.id); group.setAttribute('aria-pressed', String(id === node.id)); });
    nodeDetail.replaceChildren(el('h4', node.atom || 'AND: all incoming conditions'), el('code', formulaFor(node)));
    if (node.parameter) {
      const p = node.parameter;
      nodeDetail.append(el('p', `Low ${pct(p.low)} · central ${pct(p.central)} · high ${pct(p.high)}`), el('p', p.event), el('p', p.rationale));
      const references = el('p', 'Evidence: ');
      p.sourceIds.forEach((id, i) => { const source = run.submission.sources.find(s => s.id === id); if (i) references.append(document.createTextNode(' · ')); if (source) references.append(link(`${id}: ${source.title}`, source.url)); });
      nodeDetail.append(references);
    } else if (Number.isFinite(node.probability)) nodeDetail.append(el('p', `${pct(node.probability)} calculated by ProbLog at central inputs. Shared assumptions and overlapping proofs are accounted for.`));
  }
  for (const node of graph.nodes) {
    const g = svgEl('g', { class: `node ${node.kind}`, transform: `translate(${node.x},${node.y})`, role: 'button', tabindex: 0, 'aria-label': `${node.atom || 'AND gate'}${Number.isFinite(node.probability) ? `: ${pct(node.probability)}` : ''}`, 'aria-pressed': 'false' });
    g.append(svgEl('rect', { width: node.width, height: node.height, rx: 8 }));
    const kind = svgEl('text', { x: 14, y: 18, class: 'node-kind' }); kind.textContent = node.kind === 'parameter' ? 'ASSUMPTION' : `${node.operator} · ${node.kind === 'result' ? 'FINAL RESULT' : 'CALCULATED'}`; g.append(kind);
    const lines = textLines(node.atom || 'All incoming conditions');
    lines.forEach((line, i) => { const text = svgEl('text', { x: 14, y: 38 + i * 16 }); text.textContent = line; g.append(text); });
    if (Number.isFinite(node.probability)) { const p = svgEl('text', { x: 14, y: 79, class: 'node-probability' }); p.textContent = pct(node.probability); g.append(p); }
    if (node.parameter) { const bounds = svgEl('text', { x: 14, y: 95, class: 'node-range' }); bounds.textContent = `${pct(node.low)}–${pct(node.high)}`; g.append(bounds); }
    g.addEventListener('click', () => selectNode(node)); g.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node); } });
    groups.set(node.id, g); svg.append(g);
  }
  scroll.append(svg); parent.append(scroll, nodeDetail);
  const root = lookup.get('p_doom'); selectNode(root);
  requestAnimationFrame(() => {
    scroll.scrollTop = Math.max(0, root.y + 50 - scroll.clientHeight / 2);
    scroll.scrollLeft = Math.max(0, root.x + root.width - scroll.clientWidth + 30);
  });
}

function section(title) { const details = el('details', undefined, 'research-details'); details.append(el('summary', title)); return details; }

async function renderTranscript(run, parent, version) {
  const details = section('Full recorded transcript');
  details.append(el('p', 'Recorded prompts, assistant messages, web actions, and harness feedback. Private reasoning and full retrieved page bodies are excluded.'));
  const content = el('div'); details.append(content); parent.append(details);
  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return; loaded = true; content.textContent = 'Loading transcript…';
    try {
      const response = await fetch(`./data/${run.transcript}`); if (!response.ok) throw new Error('Cannot load transcript');
      const data = await response.json(); if (version !== selectionVersion) return;
      content.replaceChildren(link('Open transcript JSON ↗', `./data/${run.transcript}`));
      for (const message of data.messages) {
        const article = el('div', undefined, 'transcript-message'); article.append(el('h4', `${message.role} · round ${message.turn}`));
        let text = message.content; try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* retain exact prose */ }
        article.append(el('pre', text)); content.append(article);
      }
    } catch (error) { content.textContent = error.message; loaded = false; }
  });
}

function renderRun(run) {
  const version = ++selectionVersion; detail.replaceChildren();
  const top = el('div', undefined, 'run-top'), title = el('div');
  title.append(el('h3', `${modelName(run.model)} · ${run.effort} thinking · ${trialLabel(run)}`), el('p', `${statusLabel(run)} · ${run.rounds.length}/${run.limits.maxRounds} responses · ${(run.wallMs/1000).toFixed(1)}s`, 'run-stat'));
  title.append(el('p', `Information cutoff ${run.asOf}. Requested model ${run.model}; resolved ID ${run.resolvedModel || 'not reported by provider'}.`, 'run-stat'));
  top.append(title); detail.append(top);
  if (submitted(run)) {
    const result = el('div'); result.append(el('p', pct(run.inference.pDoom), 'result-value'), el('p', `${pct(run.inference.scenarioBounds.low)}–${pct(run.inference.scenarioBounds.high)} assumption range`, 'run-stat')); top.append(result);
    detail.append(el('p', `${run.submission.sources.length} sources · ${run.submission.parameters.length} probability inputs · ${run.submission.rules.length} rules · ${run.rounds.reduce((n,r) => n + r.audit.webSearchCalls, 0)} web actions`, 'run-stat'), el('p', run.submission.synthesis, 'synthesis'));
    renderCalculation(run, detail);
    const evidence = section('Sources and evidence'); const list = el('ol', undefined, 'source-list');
    for (const source of run.submission.sources) { const li = el('li'); li.append(link(`${source.id} · ${source.title}`, source.url), el('p', `${source.publisher} · published ${source.publishedDate || 'date unknown'} · accessed ${source.accessedDate}`, 'source-meta'), el('p', source.observation), el('p', `Limitation: ${source.limitation}`)); list.append(li); }
    evidence.append(list, el('p', run.citationVerification)); detail.append(evidence);
    const review = section('Self-review, dependencies, and limitations');
    for (const check of run.submission.review?.checks || []) { const block = el('div', undefined, 'review-check'); block.append(el('strong', `${check.topic.replaceAll('_', ' ')} · ${check.status}`), el('p', check.note)); review.append(block); }
    const addList = (heading, entries) => { review.append(el('h4', heading)); const list = el('ul'); entries.forEach(text => list.append(el('li', text))); review.append(list); };
    addList('Changes after review', run.submission.review?.changes || []); addList('Unresolved issues', run.submission.review?.unresolvedIssues || []);
    addList('Dependencies', run.submission.dependencies); addList('Limitations', run.submission.limitations);
    addList('Counterarguments', run.submission.counterarguments.map(c => `${c.argument} [${c.sourceIds.join(', ')}]`));
    review.append(el('h4', 'Alternative structure'), el('p', run.submission.alternativeStructure)); detail.append(review);
    const program = section('Executable calculation and sensitivities'); program.append(link('Open ProbLog program ↗', `./data/${run.modelFile}`), el('pre', run.inference.program));
    for (const s of run.inference.sensitivity) program.append(el('p', `${s.atom}: ${pct(s.low)} → ${pct(s.high)} when varying only this input over its range.`)); detail.append(program);
  } else {
    detail.append(el('p', 'This attempt did not produce a valid reviewed submission. Its draft is not displayed as a final probability.', 'empty'));
    if (run.error) detail.append(el('pre', run.error));
    for (const round of run.rounds) { if (round.feedback?.errors?.length) detail.append(el('pre', `Round ${round.turn}: ${round.feedback.errors.join('\n')}`)); }
  }
  const provenance = section('Prompt, budgets, and provenance'); provenance.append(el('p', `Shared prompt SHA-256: ${run.promptSha256}`), el('p', `${run.cliVersion} · ${run.lintVersion} · ${run.limits.maxRounds} total responses · ${run.limits.maxSeconds} seconds · live web research`), el('pre', run.prompt)); detail.append(provenance);
  renderTranscript(run, detail, version);
}

function chooseRun(id) {
  selected = runs.find(run => run.id === id); if (!selected) return;
  selector.value = id;
  if (!bars.querySelector('[data-run]')) renderBars();
  else bars.querySelectorAll('[data-run]').forEach(row => row.setAttribute('aria-pressed', String(row.dataset.run === id)));
  renderRun(selected);
}

toggle.addEventListener('click', () => { zoom = !zoom; renderBars(); });
selector.addEventListener('change', () => chooseRun(selector.value));
try {
  const response = await fetch('./data/results.json'); if (!response.ok) throw new Error('Cannot load results');
  const data = await response.json();
  if (data.schemaVersion !== 3 || data.scenario?.id !== 'leap-wave9-ai-catastrophe-2050') throw new Error('No current LEAP comparison has been exported. Earlier pilots are excluded.');
  const order = { Luna: 0, Sol: 1, Astra: 2, Fable: 3, Opus: 4, Sonnet: 5, Haiku: 6 }, efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  runs = data.runs.filter(run => run.status !== 'interrupted' && statusLabel(run) !== 'provider blocked')
    .sort((a,b) => order[family(a)] - order[family(b)] || a.model.localeCompare(b.model, 'en', { numeric: true }) || efforts.indexOf(a.effort) - efforts.indexOf(b.effort) || a.trial - b.trial);
  if (!runs.length) {
    document.querySelector('#batch-summary').textContent = `${data.batch.jobs.length} scheduled attempts · ${data.batch.maxRounds} responses and ${data.batch.maxSeconds / 60} minutes per attempt`;
    bars.append(el('p', 'The comparison is running. Completed attempts will appear here when exported.', 'empty')); detail.replaceChildren();
  }
  else {
    for (const run of runs) { const option = el('option', `${label(run)}${submitted(run) ? ` · ${pct(run.inference.pDoom)}` : ` · ${statusLabel(run)}`}`); option.value = run.id; selector.append(option); }
    document.querySelector('#batch-summary').textContent = `${runs.filter(submitted).length} submitted forecasts · same prompt, ${data.batch.maxRounds} responses and ${data.batch.maxSeconds / 60} minutes each`;
    chooseRun(runs.find(submitted)?.id || runs[0].id);
  }
} catch (error) { bars.replaceChildren(); detail.replaceChildren(); document.querySelector('#error').textContent = error.message; }
