import { el, json, fail } from './dom.js';
const content = document.querySelector('#artifacts');
try {
  const manifest = await json('./eval.json');
  const data = await json('./data/artifacts.json');
  document.title = `${manifest.title} — Vibeval`;
  document.querySelector('h1').textContent = manifest.title;
  document.querySelector('#prompt').textContent = data.prompt;
  function preview(run) {
    const url = new URL(run.entry, new URL('./data/', location.href));
    const base = new URL('./data/', location.href);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error(`Artifact must live in this eval's public data: ${run.entry}`);
    return el('section', { class: 'card' }, el('div', { class: 'artifact-title' }, el('h2', {}, run.model), el('span', { class: 'meta' }, run.label || '')),
      // Scripts may run, but artifacts cannot access the gallery origin,
      // navigate the parent, open popups, or submit forms.
      el('iframe', { src: url.href, title: `${run.model} output`, sandbox: 'allow-scripts', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  }
  content.replaceChildren(...data.runs.map(preview));
  if (!data.runs.length) content.append(el('p', {}, 'No model outputs published yet.'));
} catch (error) { fail(content, error); }
