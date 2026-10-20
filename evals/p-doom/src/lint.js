import { createHash } from 'node:crypto';
import { responseSchema, reviewTopics } from './model.js';

export const LINT_VERSION = 'doom-lint-v2';
const atomPattern = /^[a-z][a-z0-9_]{0,63}$/;
const reserved = new Set(['query', 'evidence', 'true', 'false', 'fail', 'call', 'consult']);
// JSON key order is irrelevant to candidate identity; array order remains significant.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const candidateHash = candidate => createHash('sha256').update(JSON.stringify(canonical(candidate))).digest('hex');

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Validate the small JSON Schema vocabulary used by responseSchema. This is not
// a general JSON Schema implementation. Both CLI output and offline files pass
// through this check; provider-side structured output is not trusted alone.
function shape(value, schema, path, add) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(type) || (type === 'number' && !Number.isFinite(value))) {
    add('type', path, `Expected ${types.join(' or ')}`); return;
  }
  if (schema.enum && !schema.enum.includes(value)) add('enum', path, `Expected one of: ${schema.enum.join(', ')}`);
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) add('required', `${path}.${key}`, 'Required field is missing');
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) add('unknown_field', `${path}.${key}`, 'Unknown field');
      else shape(child, schema.properties[key], `${path}.${key}`, add);
    }
  } else if (type === 'array') value.forEach((v, i) => shape(v, schema.items, `${path}[${i}]`, add));
  else if (type === 'string' && !value.trim()) add('empty_text', path, 'Text must not be blank');
}

export function lintCandidate(model, { asOf = new Date().toISOString(), accessedBy = new Date().toISOString(), reviewTarget = null, requireReview = false } = {}) {
  const errors = [], warnings = [];
  const add = (code, path, message) => errors.push({ code, path, message });
  const warn = (code, path, message) => warnings.push({ code, path, message });
  const result = () => ({ version: LINT_VERSION, dates: { asOf, accessedBy }, valid: !errors.length, errors, warnings });
  shape(model, responseSchema, '$', add);
  if (errors.length) return result(); // Later checks operate on a fully typed tree.
  if (reviewTarget !== null) {
    shape(reviewTarget, responseSchema, '$reviewTarget', add);
    if (errors.length) return result();
    if (reviewTarget.action !== 'evaluate') add('review_target_action', '$reviewTarget.action', 'The review target must be an evaluate candidate');
  }
  const day = typeof asOf === 'string' ? asOf.slice(0, 10) : '';
  if (!isDate(day) || !Number.isFinite(Date.parse(asOf))) { add('as_of', '$', 'asOf must be a valid date or timestamp'); return result(); }
  const accessDay = typeof accessedBy === 'string' ? accessedBy.slice(0, 10) : '';
  if (!isDate(accessDay) || !Number.isFinite(Date.parse(accessedBy))) { add('accessed_by', '$', 'accessedBy must be a valid date or timestamp'); return result(); }
  const count = (array, min, max, path) => { if (array.length < min || array.length > max) add('count', path, `Require ${min}–${max} entries`); };
  count(model.sources, 6, 16, '$.sources');
  count(model.parameters, 2, 20, '$.parameters');
  count(model.rules, 1, 32, '$.rules');
  count(model.counterarguments, 1, 16, '$.counterarguments');
  count(model.dependencies, 1, 32, '$.dependencies');
  count(model.limitations, 1, 32, '$.limitations');
  const unique = (values, path) => { if (new Set(values).size !== values.length) add('duplicate', path, 'Entries must be unique'); };
  const sourceIds = new Set(model.sources.map(s => s.id));
  unique(model.sources.map(s => s.id), '$.sources');
  const urls = new Set(), hosts = new Set(), usedSources = new Set();
  model.sources.forEach((source, i) => {
    const path = `$.sources[${i}]`;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(source.id)) add('source_id', `${path}.id`, 'Use a simple source identifier');
    try {
      if (source.url !== source.url.trim()) throw new Error();
      const url = new URL(source.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      url.hash = '';
      if (urls.has(url.href)) add('duplicate_url', `${path}.url`, 'Duplicate source URL (fragments are ignored)');
      urls.add(url.href); hosts.add(url.hostname.toLowerCase().replace(/^www\./, ''));
    } catch { add('source_url', `${path}.url`, 'Expected an absolute HTTP(S) URL without credentials or surrounding whitespace'); }
    if (!isDate(source.accessedDate) || source.accessedDate > accessDay) add('access_date', `${path}.accessedDate`, 'Expected a real YYYY-MM-DD date no later than the research execution date');
    if (source.publishedDate !== null && (!isDate(source.publishedDate) || source.publishedDate > day)) add('publication_date', `${path}.publishedDate`, 'Expected null or a real YYYY-MM-DD date no later than asOf');
    if (isDate(source.publishedDate) && isDate(source.accessedDate) && source.publishedDate > source.accessedDate) add('date_order', path, 'Publication date cannot follow access date');
  });
  if (hosts.size < 3) add('source_diversity', '$.sources', 'Require at least three distinct hostnames');
  const refs = (values, available, path, min = 1) => {
    count(values, min, 32, path); unique(values, path);
    values.forEach((id, i) => { if (!available.has(id)) add('reference', `${path}[${i}]`, `Unknown reference: ${id}`); });
  };
  model.parameters.forEach((p, i) => { refs(p.sourceIds, sourceIds, `$.parameters[${i}].sourceIds`); p.sourceIds.forEach(id => usedSources.add(id)); });
  model.counterarguments.forEach((c, i) => { refs(c.sourceIds, sourceIds, `$.counterarguments[${i}].sourceIds`); c.sourceIds.forEach(id => usedSources.add(id)); });
  model.sources.forEach((s, i) => { if (!usedSources.has(s.id)) warn('unused_source', `$.sources[${i}]`, 'Source is not linked to a parameter or counterargument'); });

  const params = new Set(model.parameters.map(p => p.atom));
  const heads = new Set(model.rules.map(r => r.head));
  const atoms = new Set([...params, ...heads]);
  unique(model.parameters.map(p => p.atom), '$.parameters');
  model.parameters.forEach((p, i) => {
    if (heads.has(p.atom)) add('atom_collision', `$.parameters[${i}].atom`, 'An atom cannot be both a parameter and a rule head');
    if (!(0 <= p.low && p.low <= p.central && p.central <= p.high && p.high <= 1)) add('probability_range', `$.parameters[${i}]`, 'Require 0 <= low <= central <= high <= 1; use fractions, not percentages');
  });
  for (const atom of atoms) if (!atomPattern.test(atom) || reserved.has(atom)) add('atom', '$.rules', `Invalid or reserved atom: ${atom}`);
  if (!heads.has('p_doom')) add('target', '$.rules', 'p_doom must be a derived rule head');
  const dependencies = new Map([...atoms].map(a => [a, new Set()]));
  const ruleKeys = new Set();
  model.rules.forEach((rule, i) => {
    const path = `$.rules[${i}]`;
    refs(rule.body, atoms, `${path}.body`);
    if (rule.body.length > 20) add('body_count', `${path}.body`, 'At most 20 body atoms');
    const key = JSON.stringify([rule.head, [...rule.body].sort()]);
    if (ruleKeys.has(key)) add('duplicate_rule', path, 'Duplicate rule (body order is ignored)');
    ruleKeys.add(key);
    rule.body.forEach(a => { if (atoms.has(a)) dependencies.get(rule.head).add(a); });
  });
  const active = new Set(), visited = new Set();
  function walk(atom) {
    if (active.has(atom)) { add('cycle', '$.rules', `Cycle through ${atom}`); return; }
    if (visited.has(atom)) return;
    active.add(atom); dependencies.get(atom)?.forEach(walk); active.delete(atom); visited.add(atom);
  }
  // Inspect all components for cycles, then separately check target reachability.
  atoms.forEach(walk);
  const reachable = new Set();
  function reach(atom) { if (reachable.has(atom)) return; reachable.add(atom); dependencies.get(atom)?.forEach(reach); }
  if (heads.has('p_doom')) reach('p_doom');
  for (const atom of atoms) if (!reachable.has(atom)) add('unused_atom', '$.rules', `${atom} does not contribute to p_doom`);

  if (requireReview && model.review === null) add('review_required', '$.review', 'Review the previously evaluated candidate before revising or submitting');
  if (model.action === 'submit' && !reviewTarget) add('evaluate_first', '$.action', 'Submission requires a previously evaluated candidate');
  if (model.review !== null) {
    const review = model.review;
    if (!/^[a-f0-9]{64}$/.test(review.candidateSha256)) add('review_hash', '$.review.candidateSha256', 'Expected a SHA-256 candidate identifier');
    if (reviewTarget && review.candidateSha256 !== candidateHash(reviewTarget)) add('review_target', '$.review.candidateSha256', 'Review must reference the most recently evaluated candidate');
    if (!reviewTarget) add('review_without_target', '$.review', 'Supply the previous evaluated candidate, or use review: null in the research/repair phase');
    unique(review.checks.map(c => c.topic), '$.review.checks');
    review.checks.forEach((check, i) => {
      unique(check.sourceIds, `$.review.checks[${i}].sourceIds`);
      unique(check.parameterAtoms, `$.review.checks[${i}].parameterAtoms`);
    });
    for (const topic of reviewTopics) if (!review.checks.some(c => c.topic === topic)) add('review_topic', '$.review.checks', `Missing review topic: ${topic}`);
    if (reviewTarget) {
      const previousSources = new Set(reviewTarget.sources.map(s => s.id));
      const previousParams = new Set(reviewTarget.parameters.map(p => p.atom));
      review.checks.forEach((check, i) => {
        refs(check.sourceIds, previousSources, `$.review.checks[${i}].sourceIds`, 0);
        refs(check.parameterAtoms, previousParams, `$.review.checks[${i}].parameterAtoms`, 0);
      });
    }
    if (review.checks.some(c => c.status !== 'pass') && !review.unresolvedIssues.length && !review.changes.length) warn('review_disposition', '$.review', 'Review reports issues or uncertainty without recording changes or remaining issues');
  }
  return result();
}
