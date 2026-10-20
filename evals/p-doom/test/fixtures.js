import { reviewTopics } from '../src/model.js';
import { candidateHash } from '../src/lint.js';

export const fixture = () => ({ action: 'evaluate', eventInterpretation: '90% human mortality by 2050',
  synthesis: 'Test fixture only', alternativeStructure: 'Shared latent governance state', review: null,
  sources: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, url: `https://publisher${i}.example/paper`,
    title: 'Test fixture', publisher: 'Fixture', publishedDate: null, accessedDate: '2020-01-01',
    observation: 'No real evidence', limitation: 'Test fixture only' })),
  parameters: [
    { atom: 'capability', event: 'Unconditional fixture capability', rationale: 'Judgment', sourceIds: ['s0'], low: 0.1, central: 0.2, high: 0.3 },
    { atom: 'mortality_switch', event: 'Fixture conditional mortality switch', rationale: 'Judgment', sourceIds: ['s1'], low: 0.2, central: 0.3, high: 0.4 },
  ],
  rules: [{ head: 'p_doom', body: ['capability', 'mortality_switch'] }],
  counterarguments: [{ argument: 'Resilience', sourceIds: ['s2'] }], dependencies: ['Shared gates'], limitations: ['Unresolved event'] });

export const reviewFor = candidate => ({ candidateSha256: candidateHash(candidate),
  checks: reviewTopics.map(topic => ({ topic, status: 'uncertain', note: `Fixture review of ${topic}; no factual claim`, sourceIds: ['s0'], parameterAtoms: ['capability'] })),
  changes: [], unresolvedIssues: ['Fixture assumptions remain judgmental'] });

export const eventStream = (candidate, web = true) => [
  ...(web ? [{ type: 'item.completed', item: { type: 'web_search', action: { query: 'fixture' } } }] : []),
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(candidate) } },
  { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 20 } },
].map(e => JSON.stringify(e)).join('\n');
export const fakeTool = async () => ({ code: 0, stdout: 'fixture-cli', stderr: '' });
export const fakeInference = async () => ({ pDoom: 0.06, program: '% fixture only', scenarioBounds: { low: 0.02, high: 0.12 }, sensitivity: [] });
