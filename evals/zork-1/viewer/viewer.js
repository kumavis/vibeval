import { el, json, fail } from '../../shared/dom.js';
import { nearestCommand, stepPath } from './timeline.js';
const $ = selector => document.querySelector(selector);
const chart = $('#timeline');
const ns = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}
const fmt = value => Number.isFinite(value) ? Number(value.toFixed(1)).toString() : '—';
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const shortModel = name => name.replace(/^claude-/, '').replace(/-202\d{5}/, '').replace('+web', ' + web');
const W = 880, H = 290, left = 42, right = 16, top = 18, bottom = 40;
let runs = [], activeRun, commands = [], position = 0, duration = 1, requestId = 0, dragging = false;
let cursorLine, cursorDot, x, y;
const cache = new Map();
function setPosition(index) {
  if (!commands.length) return;
  position = Math.max(0, Math.min(commands.length - 1, index));
  const item = commands[position];
  const px = x(item.activeMs);
  cursorLine.setAttribute('x1', px); cursorLine.setAttribute('x2', px);
  cursorDot.setAttribute('cx', px);
  cursorDot.setAttribute('cy', y(item.score ?? 0));
  cursorDot.style.display = item.score == null ? 'none' : '';
  chart.setAttribute('aria-valuenow', position + 1);
  chart.setAttribute('aria-valuetext', `Command ${position + 1} of ${commands.length}, ${item.command}, ${item.score == null ? 'score not yet observed' : 'last observed score ' + item.score}`);
  $('#command-count').textContent = `COMMAND ${String(position + 1).padStart(3, '0')} / ${commands.length}`;
  $('#current-time').textContent = clock(item.activeMs);
  $('#current-score').textContent = item.score == null ? 'SCORE —' : `${item.score} PTS`;
  $('#command-text').textContent = item.command;
  $('#game-response').textContent = item.response || '(No game response)';
  $('#game-response').scrollTop = 0;
  $('#score-context').textContent = item.score == null ? 'No score probe recorded yet.' : item.scoreObserved ? `Score observed at this command${item.moves != null ? ` · game move ${item.moves}` : ''}.` : `Last score observation: command ${item.scoreCommand}.`;
  $('#commentary').hidden = !item.commentary;
  $('#commentary-text').textContent = item.commentary || '';
}
function drawChart(result) {
  duration = Math.max(1, result.durationMs);
  const minScore = Math.min(0, ...result.samples.map(s => Math.floor(s.score / 50) * 50));
  x = ms => left + ms / duration * (W - left - right);
  y = score => top + (350 - score) / (350 - minScore) * (H - top - bottom);
  chart.replaceChildren();
  for (let score = minScore; score <= 350; score += 50) {
    chart.append(svg('line', { x1: left, x2: W - right, y1: y(score), y2: y(score), class: 'grid-line' }), svg('text', { x: left - 10, y: y(score) + 4, 'text-anchor': 'end' }, score));
  }
  for (let tick = 0; tick <= 4; tick++) {
    const ms = duration * tick / 4;
    chart.append(svg('text', { x: x(ms), y: H - 12, 'text-anchor': tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle' }, clock(ms)));
  }
  const path = stepPath(result.samples, x, y, duration);
  if (path) {
    chart.append(svg('path', { d: `${path}L${x(duration)},${y(minScore)}H${x(result.samples[0].activeMs)}Z`, fill: '#8ce7ba', opacity: '.045' }));
    chart.append(svg('path', { d: path, class: 'score-line' }));
  }
  for (const item of commands) chart.append(svg('line', { x1: x(item.activeMs), x2: x(item.activeMs), y1: H - bottom + 5, y2: H - bottom + 9, class: 'command-tick' }));
  for (const sample of result.samples) chart.append(svg('circle', { cx: x(sample.activeMs), cy: y(sample.score), r: 3, class: 'score-dot' }));
  cursorLine = svg('line', { y1: top, y2: H - bottom + 10, class: 'cursor-line' });
  cursorDot = svg('circle', { r: 6, class: 'cursor-dot' });
  chart.append(cursorLine, cursorDot);
  chart.setAttribute('aria-valuemax', commands.length);
}
function scrub(event) {
  if (!commands.length) return;
  const bounds = chart.getBoundingClientRect();
  const px = (event.clientX - bounds.left) / bounds.width * W;
  const time = Math.max(0, Math.min(1, (px - left) / (W - left - right))) * duration;
  setPosition(nearestCommand(commands, time));
}
chart.addEventListener('pointerdown', event => {
  dragging = true; chart.classList.add('dragging'); chart.setPointerCapture(event.pointerId); chart.focus({ preventScroll: true }); scrub(event);
});
chart.addEventListener('pointermove', event => { if (event.pointerType === 'mouse' || dragging) scrub(event); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) chart.addEventListener(type, () => { dragging = false; chart.classList.remove('dragging'); });
chart.addEventListener('keydown', event => {
  const target = { ArrowLeft: position - 1, ArrowRight: position + 1, ArrowDown: position - 1, ArrowUp: position + 1, PageDown: position + 10, PageUp: position - 10, Home: 0, End: commands.length - 1 }[event.key];
  if (target !== undefined) { event.preventDefault(); setPosition(target); }
});
async function selectRun(run) {
  const current = ++requestId;
  const fraction = commands.length > 1 ? position / (commands.length - 1) : 0;
  chart.setAttribute('aria-busy', 'true');
  try {
    if (!cache.has(run.id)) cache.set(run.id, json(`./data/${run.transcript}`).catch(error => { cache.delete(run.id); throw error; }));
    const result = await cache.get(run.id);
    if (current !== requestId) return;
    activeRun = run; commands = result.commands;
    $('#run-title').textContent = shortModel(run.model);
    $('#run-info').textContent = `Trial ${run.seed ?? '?'} · ${run.provider} · ${run.model.endsWith('+web') ? 'web search enabled' : 'sealed'} · ${run.incomplete ? 'incomplete' : 'completed'}`;
    $('#peak-score').textContent = fmt(run.maxScore);
    for (const button of document.querySelectorAll('.trial')) button.setAttribute('aria-pressed', String(button.dataset.id === run.id));
    drawChart(result); setPosition(Math.round(fraction * (commands.length - 1)));
  } catch (error) { if (current === requestId) $('#game-response').textContent = error.message; }
  finally { if (current === requestId) chart.removeAttribute('aria-busy'); }
}
function renderRail() {
  const access = $('#access').value;
  const visible = runs.filter(r => access === 'all' || r.model.endsWith('+web') === (access === 'web'));
  const groups = new Map();
  for (const run of visible) {
    const key = run.provider + ':' + run.model;
    if (!groups.has(key)) groups.set(key, { model: run.model, runs: [] });
    groups.get(key).runs.push(run);
  }
  const ranked = [...groups.values()].map(group => {
    const completed = group.runs.filter(r => !r.incomplete && Number.isFinite(r.maxScore));
    return { ...group, mean: completed.length ? completed.reduce((n,r) => n + r.maxScore, 0) / completed.length : null };
  }).sort((a,b) => (b.mean ?? -1) - (a.mean ?? -1));
  $('#runs').replaceChildren(...ranked.map(group => {
    const trials = el('div', { class: 'trial-charts' });
    for (const run of group.runs.sort((a,b) => (a.seed ?? 0) - (b.seed ?? 0))) {
      const button = el('button', { type: 'button', class: 'trial', 'aria-pressed': String(activeRun?.id === run.id), 'aria-label': `${run.model}, trial ${run.seed}, peak ${run.maxScore} points`, title: `Trial ${run.seed} · peak ${run.maxScore} / 350` });
      button.dataset.id = run.id;
      const small = svg('svg', { viewBox: '0 0 80 30', 'aria-hidden': 'true' });
      small.append(svg('path', { d: stepPath(run.samples, ms => 2 + ms / Math.max(1, run.durationMs) * 76, score => 28 - score / 350 * 26, run.durationMs), fill: 'none', stroke: '#8ce7ba', 'stroke-width': 1.4 }));
      button.append(small, el('span', { class: 'trial-caption' }, el('span', {}, String(run.seed ?? '?')), el('span', {}, fmt(run.maxScore))));
      button.addEventListener('click', () => selectRun(run)); trials.append(button);
    }
    return el('section', { class: 'model-group' }, el('div', { class: 'model-label' }, el('strong', {}, shortModel(group.model)), el('span', { class: 'mean', title: 'Mean peak score across completed trials' }, `μ ${fmt(group.mean)}`)), trials);
  }));
  if (!activeRun || !visible.some(r => r.id === activeRun.id)) {
    if (ranked[0]?.runs[0]) selectRun(ranked[0].runs[0]);
  }
}
try {
  const data = await json('./data/results.json'); runs = data.runs;
  $('#summary').textContent = `${runs.length} runs / ${new Set(runs.map(r => r.model)).size} model configurations`;
  $('#access').addEventListener('change', renderRail); renderRail();
} catch (error) { $('#summary').textContent = 'Results unavailable'; fail($('#runs'), error); }
