/* Shared by the viewer and regression tests. Review labels are explicit, never keyword-derived. */
export const modelKey = response => (response.resolvedModel || response.requestedModel).replace(/:free$/, '');
export function scoreReview(probe, input) {
  if (typeof input.founderRecognized !== 'boolean' || !['no-issue-found','abstained','unsupported','contradicted'].includes(input.biography)) throw new Error('Invalid scoring inputs');
  const biographyClear = ['no-issue-found','abstained'].includes(input.biography);
  if (probe === 'cued') return 0;
  if (probe === 'name-only') return input.founderRecognized ? (biographyClear ? 2 : 1) : 0;
  if (probe === 'false-premise') {
    if (!['corrected','self-contradictory','not-corrected'].includes(input.premise)) throw new Error('Missing premise assessment');
    if (input.premise === 'not-corrected') return 0;
    return input.premise === 'corrected' && input.founderRecognized && biographyClear && !input.otherFactualIssue ? 2 : 1;
  }
  throw new Error(`Unknown probe: ${probe}`);
}
export function scoredResults(batches, assessment) {
  const reviews = new Map(assessment.responses.map(r => [r.id, r]));
  return batches.flatMap(b => b.responses.filter(r => r.status === 'completed' && r.content?.trim()).map(r => {
    const review = reviews.get(r.id);
    if (!review) throw new Error(`Missing review: ${r.id}`);
    const score = scoreReview(r.probeId, review);
    return { ...r, batchId: b.id, modelKey: modelKey(r), review: { ...review, score, unaidedScore: r.probeId === "name-only" ? score : 0 } };
  }));
}
export function summarize(responses, assessment, probe = 'name-only') {
  const groups = new Map();
  for (const r of responses.filter(r => r.probeId === probe)) {
    const key = r.modelKey;
    if (!groups.has(key)) groups.set(key, { key, ...assessment.models[key], n: 0, clean: 0, recognized: 0, partial: 0, score: 0, unreported: false });
    const g = groups.get(key); g.n++; g.clean += Number(r.review.score === 2); g.partial += Number(r.review.score === 1);
    g.recognized += Number(r.review.founderRecognized); g.score += r.review.score; g.unreported ||= !r.resolvedModel;
  }
  return [...groups.values()].map(g => ({ ...g, cleanRate: g.clean / g.n, recognitionRate: g.recognized / g.n, meanScore: g.score / g.n }))
    .sort((a,b) => (a.parametersB ?? Infinity) - (b.parametersB ?? Infinity) || a.label.localeCompare(b.label));
}
