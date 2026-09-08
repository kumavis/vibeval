import { el, json, fail } from './shared/dom.js';
const gallery = document.querySelector('#gallery');
try {
  const catalog = await json('./catalog.json');
  gallery.replaceChildren(...catalog.map((item, i) => el('a', { class: 'card card-link', href: item.url },
    el('span', { class: 'meta' }, `${String(i + 1).padStart(2, '0')} / ${item.assessment?.type === 'distribution' ? 'CHOICE DISTRIBUTION' : item.assessment?.type === 'subjective' ? 'VIEWER JUDGMENT' : item.assessment?.type === 'numeric' ? 'NUMERIC EVAL' : 'GENERATED ARTIFACTS'}`),
    el('h2', {}, item.title), el('p', {}, item.description),
    el('div', {}, ...(item.tags || []).map(tag => el('span', { class: 'tag' }, tag))),
    el('p', { class: 'command' }, 'Explore evaluation →'))));
  if (!catalog.length) gallery.append(el('p', {}, 'No evaluations published yet.'));
} catch (error) { fail(gallery, error); }
