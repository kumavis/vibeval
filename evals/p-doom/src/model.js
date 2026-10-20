const string = { type: 'string' };
const strings = { type: 'array', items: string };
const number = { type: 'number' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: 'array', items });

export const reviewTopics = [
  'event_definition', 'source_fidelity', 'mitigations', 'conditioning',
  'dependence', 'mortality_bridge', 'sensitivity', 'uncertainty',
];

const reviewSchema = object({
  candidateSha256: string,
  checks: array(object({
    topic: { type: 'string', enum: reviewTopics },
    status: { type: 'string', enum: ['pass', 'issue', 'uncertain'] },
    note: string, sourceIds: strings, parameterAtoms: strings,
  })),
  changes: strings,
  unresolvedIssues: strings,
});

export const responseSchema = object({
  action: { type: 'string', enum: ['evaluate', 'submit'] },
  eventInterpretation: string,
  sources: array(object({
    id: string, url: string, title: string, publisher: string,
    publishedDate: { type: ['string', 'null'] }, accessedDate: string,
    observation: string, limitation: string,
  })),
  parameters: array(object({
    atom: string, event: string, low: number, central: number, high: number,
    sourceIds: strings, rationale: string,
  })),
  rules: array(object({ head: string, body: strings })),
  synthesis: string,
  counterarguments: array(object({ argument: string, sourceIds: strings })),
  dependencies: strings,
  limitations: strings,
  alternativeStructure: string,
  review: { ...reviewSchema, type: ['object', 'null'] },
});

export function researchAudit(events) {
  const items = events.filter(e => e.type === 'item.completed' && e.item?.type === 'web_search').map(e => e.item);
  return { webSearchCalls: items.length, actions: items.map(i => i.action ?? null),
    citationVerification: 'unverified: trace shows tool activity, not that citations entail claims; manual source audit required' };
}
