import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintCandidate, candidateHash, isDate } from '../src/lint.js';
import { fixture, reviewFor } from './fixtures.js';

const asOf = '2026-10-19T00:00:00Z';
const lint = model => lintCandidate(model, { asOf });

test('lint accepts a typed graph and emits nonblocking unused-source warnings', () => {
  const report = lint(fixture());
  assert.equal(report.valid, true);
  assert.equal(report.warnings.filter(w => w.code === 'unused_source').length, 3);
});

test('shape lint handles malformed roots, nested values, extra fields and missing fields without throwing', () => {
  for (const value of [null, [], 42, {}, { sources: [] }]) assert.equal(lint(value).valid, false);
  for (const mutate of [
    m => { m.sources[0] = null; },
    m => { m.parameters[0].low = '0.1'; },
    m => { m.parameters[0].low = NaN; },
    m => { m.rules[0].body = 'capability'; },
    m => { m.extra = 'unexpected'; },
    m => { delete m.review; },
    m => { m.sources[0].observation = ' '; },
  ]) { const model = fixture(); mutate(model); assert.equal(lint(model).valid, false); }
});

test('calendar lint rejects impossible dates and reversed dates, accepts leap days and unknown publication dates', () => {
  assert.equal(isDate('2024-02-29'), true);
  for (const date of ['2025-02-29', '2026-04-31', '2026-13-01', '2026-00-12', '2026-1-1']) assert.equal(isDate(date), false);
  const model = fixture(); model.sources[0].publishedDate = '2026-01-01';
  assert.ok(lint(model).errors.some(e => e.code === 'date_order'));
  model.sources[0].publishedDate = null; model.sources[0].accessedDate = '2051-01-01';
  assert.ok(lint(model).errors.some(e => e.code === 'access_date'));
  assert.equal(lintCandidate(fixture(), { asOf: '2026-02-30' }).valid, false);
});

test('historical forecasts allow later research access while retaining the publication cutoff', () => {
  const model = fixture(); model.sources[0].accessedDate = '2026-10-20';
  const options = { asOf, accessedBy: '2026-10-20T12:00:00Z' };
  assert.equal(lintCandidate(model, options).valid, true);
  model.sources[0].publishedDate = '2026-10-20';
  assert.ok(lintCandidate(model, options).errors.some(e => e.code === 'publication_date'));
  model.sources[0].publishedDate = null; model.sources[0].accessedDate = '2026-10-21';
  assert.ok(lintCandidate(model, options).errors.some(e => e.code === 'access_date'));
  assert.ok(lintCandidate(fixture(), { ...options, accessedBy: '2026-02-30' }).errors.some(e => e.code === 'accessed_by'));
});

test('static evidence lint rejects dangling or duplicate references, invalid URLs and duplicate source identities', () => {
  const cases = [
    [m => { m.parameters[0].sourceIds = ['invented']; }, 'reference'],
    [m => { m.parameters[0].sourceIds = ['s0', 's0']; }, 'duplicate'],
    [m => { m.sources[1].url = m.sources[0].url + '#section'; }, 'duplicate_url'],
    [m => { m.sources[1].id = m.sources[0].id; }, 'duplicate'],
    [m => { m.sources[0].url = 'https://name:secret@example.com/paper'; }, 'source_url'],
    [m => { m.sources[0].url = 'javascript:alert(1)'; }, 'source_url'],
    [m => { m.sources.forEach(s => { s.url = `https://same.example/${s.id}`; }); }, 'source_diversity'],
  ];
  for (const [mutate, code] of cases) { const model = fixture(); mutate(model); assert.ok(lint(model).errors.some(e => e.code === code), code); }
});

test('static graph lint rejects invalid probabilities, cycles, code, disconnected atoms and duplicate rules', () => {
  const cases = [
    [m => { m.parameters[0].central = 20; }, 'probability_range'],
    [m => { m.parameters[0].low = 0.9; }, 'probability_range'],
    [m => { m.parameters[0].atom = "a. consult('/tmp/untrusted')"; }, 'atom'],
    [m => { m.rules[0].body.push('undefined'); }, 'reference'],
    [m => { m.rules[0].body.push('p_doom'); }, 'cycle'],
    [m => { m.rules.push({ head: 'unused', body: ['capability'] }); }, 'unused_atom'],
    [m => { m.rules.push({ head: 'p_doom', body: [...m.rules[0].body].reverse() }); }, 'duplicate_rule'],
    [m => { m.rules[0].body.push('capability'); }, 'duplicate'],
    [m => { m.rules.push({ head: 'capability', body: ['mortality_switch'] }); }, 'atom_collision'],
    [m => { m.rules[0].head = 'other'; }, 'target'],
  ];
  for (const [mutate, code] of cases) { const model = fixture(); mutate(model); assert.ok(lint(model).errors.some(e => e.code === code), code); }
});

test('review must cover each topic once and reference the evaluated candidate, while honest uncertainty is allowed', () => {
  const target = fixture();
  const model = { ...structuredClone(target), action: 'submit', review: reviewFor(target) };
  const options = { asOf, reviewTarget: target, requireReview: true };
  assert.equal(lintCandidate(model, options).valid, true);
  const original = model.review.candidateSha256;
  model.review.candidateSha256 = '0'.repeat(64);
  assert.ok(lintCandidate(model, options).errors.some(e => e.code === 'review_target'));
  model.review.candidateSha256 = original;
  model.review.checks.pop();
  assert.ok(lintCandidate(model, options).errors.some(e => e.code === 'review_topic'));
  model.review = reviewFor(target); model.review.checks[0].parameterAtoms = ['invented'];
  assert.ok(lintCandidate(model, options).errors.some(e => e.code === 'reference'));
  model.review = null;
  assert.ok(lintCandidate(model, options).errors.some(e => e.code === 'review_required'));
  model.review = reviewFor(target);
  assert.equal(lintCandidate(model, { asOf }).valid, false); // Offline submit needs --previous.
  assert.equal(lintCandidate(model, { ...options, reviewTarget: {} }).valid, false);
});

test('candidate identity ignores object key order and changes when the content changes', () => {
  const model = fixture();
  const reordered = Object.fromEntries(Object.entries(model).reverse());
  assert.equal(candidateHash(model), candidateHash(reordered));
  reordered.parameters = [...model.parameters].reverse();
  assert.notEqual(candidateHash(model), candidateHash(reordered));
});
