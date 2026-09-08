import { el, json, fail } from '../../shared/dom.js';
const $ = s => document.querySelector(s);
const table = $('#leaderboard');
const transcript = $('#transcript');
let commands = [], position = 0, requestId = 0;
const fmt = n => n == null ? '—' : Number(n).toFixed(1).replace(/\.0$/, '');
function showCommand() {
  const item = commands[position];
  $('#step').value = commands.length ? position + 1 : 0;
  $('#prev').disabled = !item || position === 0;
  $('#next').disabled = !item || position === commands.length - 1;
  $('#step').disabled = !item;
  if (!item) { transcript.replaceChildren(el('p', {}, 'No commands recorded.')); return; }
  transcript.replaceChildren(el('span', { class: 'meta' }, `COMMAND ${position + 1} / ${commands.length}`),
    item.commentary ? el('p', { class: 'muted' }, item.commentary) : null,
    el('pre', { class: 'command' }, `> ${item.command}`), el('pre', {}, item.response || '(No game response)'));
}
try {
  const data = await json('./data/results.json');
  $('#summary').textContent = `${data.runs.length} recorded runs · ${new Set(data.runs.map(r => r.model)).size} model configurations`;
  function renderTable() {
    const access = $('#access').value;
    const selected = data.runs.filter(r => access === 'all' || r.model.endsWith('+web') === (access === 'web'));
    const groups = new Map();
    for (const run of selected) {
      const key = `${run.provider}:${run.model}`;
      if (!groups.has(key)) groups.set(key, { model: run.model, provider: run.provider, runs: [] });
      if (!run.incomplete && Number.isFinite(run.maxScore)) groups.get(key).runs.push(run);
    }
    const rows = [...groups.values()].map(g => ({ ...g, mean: g.runs.length ? g.runs.reduce((n,r) => n + r.maxScore, 0) / g.runs.length : null })).sort((a,b) => (b.mean ?? -1) - (a.mean ?? -1));
    const heading = el('tr', {}, ...['Model', 'Mean peak score', 'Trial scores', 'Completed'].map(t => el('th', { scope: 'col' }, t)));
    table.replaceChildren(el('table', {}, el('thead', {}, heading), el('tbody', {}, ...rows.map(g => el('tr', {},
      el('td', {}, el('strong', {}, g.model), el('div', { class: 'meta' }, g.provider)),
      el('td', {}, el('div', { class: 'score' }, fmt(g.mean), el('span', { class: 'bar', style: `width:${Math.max(0, Math.min(350, g.mean ?? 0)) / 350 * 140}px`, 'aria-hidden': 'true' }))),
      el('td', {}, g.runs.map(r => String(r.maxScore)).join(' / ') || '—'), el('td', {}, String(g.runs.length)))))));
    if (!rows.length) table.replaceChildren(el('p', {}, 'No runs match this filter.'));
  }
  $('#access').addEventListener('change', renderTable); renderTable();
  $('#run').replaceChildren(...data.runs.map(r => el('option', { value: r.id }, `${r.model} · seed ${r.seed ?? '?'} · ${r.incomplete ? 'incomplete' : fmt(r.maxScore) + ' pts'}`)));
  async function loadRun() {
    const current = ++requestId;
    const run = data.runs.find(r => r.id === $('#run').value);
    commands = []; position = 0; showCommand();
    if (!run) return;
    $('#run-info').textContent = `${run.provider} · ${run.moves ?? '?'} moves · ${fmt(run.wallMin)} minutes · ${run.incomplete ? 'Incomplete' : 'Completed'}`;
    transcript.replaceChildren(el('p', { role: 'status' }, 'Loading transcript…'));
    try {
      const result = await json(`./data/${run.transcript}`);
      if (current !== requestId) return;
      commands = result.commands; $('#step').max = commands.length; showCommand();
    } catch (error) { if (current === requestId) fail(transcript, error); }
  }
  $('#run').addEventListener('change', loadRun);
  $('#prev').addEventListener('click', () => { position = Math.max(0, position - 1); showCommand(); });
  $('#next').addEventListener('click', () => { position = Math.min(commands.length - 1, position + 1); showCommand(); });
  $('#step').addEventListener('change', () => { position = Math.max(0, Math.min(commands.length - 1, (Number.parseInt($('#step').value, 10) || 1) - 1)); showCommand(); });
  await loadRun();
} catch (error) { $('#summary').textContent = 'Results unavailable'; fail(table, error); }
