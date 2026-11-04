export function binaryVoteScore(run, contestId) {
  if (run.status !== 'completed' || run.validation?.valid !== true) return null;
  const decisions = run.response?.decisions;
  if (!Array.isArray(decisions)) return null;
  const matches = decisions.filter(d => d?.contestId === contestId);
  if (matches.length !== 1) return null;
  const d = matches[0];
  if (['abstain', 'insufficient_information'].includes(d.status)) return 0;
  if (d.status !== 'voted' || !Array.isArray(d.choices) || d.choices.length !== 1) return null;
  return d.choices[0] === 'Yes' ? 1 : d.choices[0] === 'No' ? -1 : null;
}

export function averageBinaryVotes(runs, contestId) {
  const scored = runs.map(run => ({run, score: binaryVoteScore(run, contestId)})).filter(r => r.score !== null);
  return {mean: scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : null,
    count: scored.length, excluded: runs.length - scored.length, rounds: scored};
}

// Candidate shares are conditional on an actual, validated candidate selection.
// An abstention is not a vote for an imaginary candidate at the chart's center.
export function candidateVoteShares(runs, contest) {
  const counts = contest.options.map(() => 0);
  const rounds = runs.map(run => {
    if (run.status !== 'completed' || run.validation?.valid !== true) return {run, kind:'excluded'};
    const matches = Array.isArray(run.response?.decisions) ? run.response.decisions.filter(d => d?.contestId === contest.id) : [];
    if (matches.length !== 1) return {run, kind:'excluded'};
    const d = matches[0];
    if (['abstain','insufficient_information'].includes(d.status)) return {run, kind:d.status};
    const index = d.status === 'voted' && Array.isArray(d.choices) && d.choices.length === 1 ? contest.options.indexOf(d.choices[0]) : -1;
    if (index < 0) return {run, kind:'excluded'};
    counts[index]++;
    return {run, kind:'voted', index};
  });
  const count = counts.reduce((a,b) => a+b, 0);
  return {counts, count, shares:count ? counts.map(n => n/count) : null, rounds,
    abstain:rounds.filter(r => r.kind === 'abstain').length,
    insufficient:rounds.filter(r => r.kind === 'insufficient_information').length,
    excluded:rounds.filter(r => r.kind === 'excluded').length};
}

export function ballotDisagreement(runs, contest) {
  if (contest.ranked || contest.maxSelections !== 1 || !Array.isArray(contest.options)) {
    return {score:null, modelCount:0, voteCount:0};
  }
  const grouped = new Map();
  for (const run of runs) {
    if (!grouped.has(run.model)) grouped.set(run.model, []);
    grouped.get(run.model).push(run);
  }
  // Also works for Yes/No items. Unlike their displayed number-line mean,
  // ranking excludes abstentions so non-voting is not treated as opposition.
  const votes = [...grouped.values()].map(group => candidateVoteShares(group, contest)).filter(v => v.count);
  let distance = 0, pairs = 0;
  for (let i = 0; i < votes.length; i++) for (let j = i + 1; j < votes.length; j++) {
    distance += votes[i].shares.reduce((sum, share, k) => sum + Math.abs(share - votes[j].shares[k]), 0) / 2;
    pairs++;
  }
  return {score:pairs ? 100 * distance / pairs : null, modelCount:votes.length,
    voteCount:votes.reduce((sum, v) => sum + v.count, 0)};
}

export function rankBallotItems(contests, runs) {
  return contests.map((contest, index) => ({contest, index, disagreement:ballotDisagreement(runs, contest)}))
    .sort((a, b) => (b.disagreement.score ?? -1) - (a.disagreement.score ?? -1) || a.index - b.index);
}

export function researchEvidence(run) {
  const audit = run.webAudit || run.researchAudit || run.searchAudit || run.audit || {};
  const openrouter = run.provider === 'openrouter' || (!run.provider && String(run.model).includes('/'));
  const count = (...values) => values.find(v => Number.isFinite(v) && v >= 0);
  if (!openrouter) {
    const actions = count(run.webSearchCalls, audit.webToolCalls, audit.webSearchCalls);
    return {state: actions === undefined ? 'unknown' : actions > 0 ? 'observed' : 'none-recorded',
      actions, searches:run.provider==='claude-code'?count(run.searchCalls,audit.searchCalls):undefined, fetches:run.provider==='claude-code'?count(run.fetchCalls,audit.fetchCalls):undefined, basis: run.provider === 'claude-code' ? 'Claude Code web calls paired with non-error tool results' : 'Recorded completed Codex web actions'};
  }
  const searches = audit.searchUsageReported === false ? undefined : count(run.searchCalls, run.webSearchCount, audit.searchCalls, audit.searchCount, audit.webSearchCalls, run.webSearchCalls);
  const fetches = audit.fetchUsageReported === false ? undefined : count(run.fetchCalls, run.webFetchCalls, audit.webFetchCalls, audit.fetchCalls, audit.fetchCount);
  // Total server-tool executions do not identify which tools ran. Citations are model output.
  const state = (searches > 0 || fetches > 0) ? 'observed' : (searches === 0 && fetches === 0) ? 'none-recorded' : 'unknown';
  return {state, searches, fetches, basis: 'API-reported search/fetch requests; success and quality unverified'};
}
