const string = { type: 'string' };
const strings = { type: 'array', items: string };
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
export const responseSchema = object({
  overallSummary: string,
  decisions: { type: 'array', items: object({ contestId: string, choices: strings,
    status: { type: 'string', enum: ['voted', 'abstain', 'insufficient_information'] }, rationale: string, sources: strings }) },
  compass: object({ economic: { type: ['number', 'null'], minimum: -10, maximum: 10 },
    social: { type: ['number', 'null'], minimum: -10, maximum: 10 },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, rationale: string, evidenceContestIds: strings }),
  sources: { type: 'array', items: object({ id: string, url: string, title: string }) },
  limitations: strings,
});

function checkSchema(value, schema, path, errors) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (![schema.type].flat().includes(type) || (type === 'number' && !Number.isFinite(value))) {
    errors.push(`${path}: expected ${schema.type}`); return;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: invalid enum value`);
  if (type === 'number' && (value < schema.minimum || value > schema.maximum)) errors.push(`${path}: out of bounds`);
  if (type === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const key of Object.keys(value)) {
      if (!schema.properties[key]) errors.push(`${path}.${key}: unknown property`);
      else checkSchema(value[key], schema.properties[key], `${path}.${key}`, errors);
    }
  }
  if (type === 'array') value.forEach((entry, i) => checkSchema(entry, schema.items, `${path}[${i}]`, errors));
}

export function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export function validateBallot(ballot) {
  const errors = [];
  if (!ballot || typeof ballot !== 'object') return ['Ballot must be an object'];
  if (ballot.electionDate !== '2026-11-03') errors.push('electionDate must be 2026-11-03');
  if (!ballot.scope) errors.push('scope is required');
  if (!Array.isArray(ballot.sources)) errors.push('sources must be an array');
  if (!Array.isArray(ballot.contests) || !ballot.contests.length) return [...errors, 'contests must be a nonempty array'];
  const ids = new Set();
  for (const c of ballot.contests) {
    if (!c || typeof c !== 'object') { errors.push('contest must be an object'); continue; }
    if (typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id)) errors.push(`duplicate or missing contest ID: ${c.id}`);
    ids.add(c.id);
    if (typeof c.title !== 'string' || !c.title.trim()) errors.push(`${c.id}: title is required`);
    if (typeof c.jurisdiction !== 'string' || !c.jurisdiction.trim()) errors.push(`${c.id}: jurisdiction is required`);
    if (!['candidate', 'measure', 'retention'].includes(c.type)) errors.push(`${c.id}: invalid contest type`);
    if (!Array.isArray(c.options) || !c.options.length || c.options.some(o => typeof o !== 'string' || !o.trim()) || new Set(c.options).size !== c.options.length) errors.push(`${c.id}: invalid options`);
    if (!Number.isSafeInteger(c.maxSelections) || c.maxSelections < 1 || c.maxSelections > (c.options?.length ?? 0)) errors.push(`${c.id}: invalid maxSelections`);
    if (typeof c.ranked !== 'boolean') errors.push(`${c.id}: ranked must be boolean`);
    if (['measure', 'retention'].includes(c.type) && (JSON.stringify(c.options?.map(o => o.toLowerCase()).sort()) !== '["no","yes"]' || c.maxSelections !== 1 || c.ranked)) errors.push(`${c.id}: measure/retention requires Yes/No and one selection`);
    if (!Array.isArray(c.sourceUrls) || !c.sourceUrls.length || c.sourceUrls.some(u => !isHttpUrl(u))) errors.push(`${c.id}: sourceUrls must contain HTTP(S) URLs`);
  }
  return errors;
}

export function validateResponse(response, ballot, audit) {
  const errors = [];
  checkSchema(response, responseSchema, '$', errors);
  if (errors.length) return { valid: false, errors };
  const contests = new Map(ballot.contests.map(c => [c.id, c]));
  const sources = new Map();
  for (const source of response.sources) {
    if (!source.id.trim() || sources.has(source.id)) errors.push(`duplicate or empty source ID: ${source.id}`);
    if (!isHttpUrl(source.url)) errors.push(`source ${source.id}: expected HTTP(S) URL`);
    if (!source.title.trim()) errors.push(`source ${source.id}: title is required`);
    sources.set(source.id, source);
  }
  const seen = new Set();
  for (const decision of response.decisions) {
    const contest = contests.get(decision.contestId);
    if (!contest) { errors.push(`unknown contest ${decision.contestId}`); continue; }
    if (seen.has(contest.id)) errors.push(`duplicate contest ${contest.id}`);
    seen.add(contest.id);
    if (!decision.rationale.trim()) errors.push(`${contest.id}: rationale is required`);
    if (new Set(decision.choices).size !== decision.choices.length) errors.push(`${contest.id}: duplicate choice`);
    if (decision.choices.some(choice => !contest.options.includes(choice))) errors.push(`${contest.id}: choice absent from ballot`);
    if (decision.choices.length > contest.maxSelections) errors.push(`${contest.id}: too many selections`);
    if (decision.status === 'voted' && !decision.choices.length) errors.push(`${contest.id}: voted requires a choice`);
    if (decision.status !== 'voted' && decision.choices.length) errors.push(`${contest.id}: abstention/insufficient information requires no choices`);
    if (decision.status === 'voted' && !decision.sources.length) errors.push(`${contest.id}: voted requires source references`);
    for (const id of decision.sources) if (!sources.has(id)) errors.push(`${contest.id}: unknown source reference ${id}`);
  }
  for (const id of contests.keys()) if (!seen.has(id)) errors.push(`missing contest ${id}`);
  if (!response.overallSummary.trim()) errors.push('overallSummary is required');
  if (!response.compass.rationale.trim()) errors.push('compass rationale is required');
  for (const id of response.compass.evidenceContestIds) if (!seen.has(id)) errors.push(`unknown compass evidence contest ${id}`);
  if ((response.compass.economic !== null || response.compass.social !== null) && !response.compass.evidenceContestIds.length) errors.push('numeric compass coordinates require evidence contests');
  if (!(audit?.webSearchCalls > 0)) errors.push('No completed web tool activity observed');
  return { valid: errors.length === 0, errors };
}

export function parseEvents(stdout) {
  return stdout.split('\n').filter(line => line.trim()).flatMap(line => {
    try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : []; } catch { return []; }
  });
}

export function researchAudit(events) {
  const items = events.filter(e => e.type === 'item.completed' && e.item?.type === 'web_search' && e.item.status !== 'failed').map(e => e.item);
  return { webSearchCalls: items.length, actions: items.map(i => i.action ?? null),
    citationVerification: 'Tool activity and citation format only; source truth and entailment have not been verified.' };
}
