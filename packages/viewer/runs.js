import { el, json, fail } from './dom.js';
const content = document.querySelector('#runs');
const display = value => value == null ? 'Not reported' : String(value);
function localURL(path) {
  const base = new URL('./data/', location.href);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Result must live in this eval’s public data');
  return url;
}
function metadata(run) {
  const rows = [
    ['Provider', run.model.provider], ['Requested model', run.model.requested], ['Resolved model', run.model.resolved],
    ['Reasoning effort', run.settings.effort], ['Thinking token budget', run.settings.thinkingBudget ?? run.settings.thinkingBudgetBasis],
    ['Harness revision', run.harness.commit ? `${run.harness.commit}${run.harness.dirty ? ' + local changes' : ''}` : null],
    ['Harness version', run.harness.version], ['Source SHA-256', run.harness.sourceSha256], ['Eval SHA-256', run.harness.evalSha256],
    ['CLI version', run.model.cliVersion], ['Harness turns', run.turns.harness], ['Draft / write actions', run.turns.drafts],
    ['Submission attempts', run.turns.submissions], ['Provider requests', run.turns.providerRequests], ['Provider retries', run.turns.retries],
    ['Internal model turns', run.turns.modelTurns], ['Wall time', `${(run.wallMs / 1000).toFixed(1)} seconds`],
    ['Input tokens (provider semantics)', run.usage?.inputTokens], ['Output tokens', run.usage?.outputTokens],
    ['Cached input tokens', run.usage?.cacheReadTokens], ['Cache write tokens', run.usage?.cacheWriteTokens],
    ['Cost basis', run.cost?.basis], ['Pricing date', run.cost?.pricing?.asOf], ['Pricing source', run.cost?.pricing?.source],
    ['Started', run.startedAt], ['Finished', run.finishedAt], ['Status', run.status],
  ];
  const details = el('details', {}, el('summary', {}, 'Run details'));
  details.append(el('dl', { class: 'run-metadata' }, ...rows.flatMap(([key,value]) => [el('dt', {}, key), el('dd', {}, display(value))])));
  if (run.cost?.usd != null) details.append(el('p', { class: 'muted' }, 'API-equivalent cost; not a subscription charge.'));
  if (run.cost?.reason) details.append(el('p', { class: 'muted' }, run.cost.reason));
  if (run.validation?.notChecked) details.append(el('p', { class: 'muted' }, `Not checked: ${run.validation.notChecked.join(', ')}.`));
  if (run.error) details.append(el('p', { class: 'error' }, run.error));
  return details;
}

async function renderRun(run, definition) {
  const card = el('section', { class: 'card run-card' }, el('div', { class: 'artifact-title' },
    el('h2', {}, run.model.requested), el('span', { class: 'tag' }, run.status === 'submitted' ? 'Submitted' : run.status.replaceAll('_',' '))));
  card.append(el('p', { class: 'meta' }, `TRIAL ${run.trial} · ${run.settings.effort} effort · ${run.turns.harness} turns · ${(run.wallMs / 1000).toFixed(1)}s · ${run.cost?.usd == null ? 'Cost unavailable' : '$' + run.cost.usd.toFixed(4)}`));
  if (run.status === 'submitted' && run.artifact) {
    const url = localURL(run.artifact.entry);
    if (run.artifact.type === 'text') {
      const pre = el('pre', { class: 'ascii-art' }, 'Loading submitted text…');
      card.append(pre);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Could not load submitted text');
        pre.textContent = await response.text();
      } catch (error) { fail(pre, error); }
    } else card.append(el('iframe', { src: url.href, sandbox: 'allow-scripts', title: `${run.model.requested} · trial ${run.trial}`, loading: 'lazy', referrerpolicy: 'no-referrer' }));
    if (definition.assessment.type === 'numeric') card.append(el('p', {}, ...definition.assessment.metrics.map(m => `${m.label || m.id}: ${display(run.metrics?.[m.id])} `)));
  } else card.append(el('p', { class: 'muted' }, 'No final submission. Drafts are available in the iteration history.'));
  card.append(metadata(run));
  const trace = el('details', {}, el('summary', {}, 'Iteration history'));
  const log = el('div'); trace.append(log);
  trace.addEventListener('toggle', async () => {
    if (!trace.open || trace.dataset.loaded) return;
    trace.dataset.loaded = 'true';
    log.textContent = 'Loading history…';
    try {
      const events = await json(localURL(run.trace));
      log.replaceChildren(...events.filter(e => ['response','feedback','submitted','error'].includes(e.type)).map(e => el('details', {},
        el('summary', {}, `Turn ${e.turn ?? '—'} · ${e.type}`), el('pre', {}, e.content ?? JSON.stringify(e.feedback ?? e, null, 2)))));
    } catch (error) { fail(log, error); delete trace.dataset.loaded; }
  });
  card.append(trace);
  return card;
}
try {
  const [definition, data, context] = await Promise.all([json('./eval.json'), json('./data/runs.json'), json('./data/eval-context.json')]);
  document.title = `${definition.title} — Vibeval`;
  document.querySelector('h1').textContent = definition.title;
  document.querySelector('#description').textContent = definition.description;
  document.querySelector('#prompt').textContent = context.prompt;
  document.querySelector('#assessment').textContent = definition.assessment.type === 'subjective' ? 'VIEWER JUDGMENT' : 'NUMERIC EVALUATION';
  document.querySelector('#guidance').textContent = definition.assessment.guidance || 'Compare the final submissions and their recorded metrics.';
  content.replaceChildren(...await Promise.all(data.runs.map(run => renderRun(run, definition))));
  if (!data.runs.length) content.append(el('section', { class: 'card' }, el('h2', {}, 'No submissions yet'), el('p', { class: 'muted' }, 'Recorded model runs will appear here once they are published.')));
} catch (error) { fail(content, error); }
