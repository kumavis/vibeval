import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extent = values => values.length ? [Math.min(...values), Math.max(...values)] : null;
const average = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
export function analyze(data) {
  const runs = data.runs ?? [];
  const valid = runs.filter(r => r.status === 'completed');
  const models = (data.batch?.models ?? [...new Set(runs.map(r => r.model))]).map(model => {
    const group = runs.filter(r => r.model === model);
    const completed = group.filter(r => r.status === 'completed');
    const points = completed.filter(r => Number.isFinite(r.response?.compass?.economic) && Number.isFinite(r.response?.compass?.social));
    const economic = points.map(r => r.response.compass.economic), social = points.map(r => r.response.compass.social);
    const costs = group.map(r => r.provider === 'claude-code' ? r.costUsd : r.usageCost ?? r.usage?.costUsd);
    return {model, provider: group[0]?.provider ?? 'codex-cli', attempts: group.length, completed: completed.length, plotted: points.length,
      economicMean: average(economic), socialMean: average(social), economicRange: extent(economic), socialRange: extent(social),
      votes: completed.reduce((n, r) => n + r.response.decisions.filter(d => d.status === 'voted').length, 0),
      abstentions: completed.reduce((n, r) => n + r.response.decisions.filter(d => d.status === 'abstain').length, 0),
      insufficientInformation: completed.reduce((n, r) => n + r.response.decisions.filter(d => d.status === 'insufficient_information').length, 0),
      webCalls: group.reduce((n, r) => n + (r.webSearchCalls ?? 0), 0),
      reportedCostUsd: costs.some(Number.isFinite) ? costs.filter(Number.isFinite).reduce((a,b)=>a+b,0) : null,
      costBasis: group[0]?.provider === 'claude-code' ? 'CLI API-equivalent estimate; not a verified subscription charge' : 'Provider-reported usage cost',
      costComplete: costs.length > 0 && costs.every(Number.isFinite),
      inputTokens: group.reduce((n, r) => n + (r.usage?.inputTokens ?? ((r.usage?.input_tokens ?? 0)+(r.usage?.cache_creation_input_tokens ?? 0)+(r.usage?.cache_read_input_tokens ?? 0))), 0),
      outputTokens: group.reduce((n, r) => n + (r.usage?.outputTokens ?? r.usage?.output_tokens ?? 0), 0)};
  });
  const contests = (data.ballot?.contests ?? []).map(contest => {
    const choices = new Map();
    for (const run of valid) {
      const decision = run.response.decisions.find(d => d.contestId === contest.id);
      if (!decision) continue;
      const key = decision.status === 'voted' ? JSON.stringify(contest.ranked ? decision.choices : [...decision.choices].sort()) : decision.status;
      const value = choices.get(key) ?? {choices: decision.choices, status: decision.status, count: 0, runs: []};
      value.count++; value.runs.push(run.id); choices.set(key, value);
    }
    const outcomes = [...choices.values()].sort((a,b) => b.count-a.count);
    const total = outcomes.reduce((n,o) => n+o.count, 0);
    return {id: contest.id, title: contest.title, type: contest.type, total, outcomes,
      modalShare: total ? outcomes[0].count/total : null,
      unanimous: total > 1 && outcomes.length === 1};
  });
  return {schemaVersion:1, interpretation:'Response self-assessment, not a calibrated ideology test. Means/ranges use completed runs with both coordinates. Three trials do not establish model-wide political identity.',
    batchId: data.batch?.id, scope: data.ballot?.scope, totalRuns: runs.length, completedRuns:valid.length,
    contestCount: contests.length, models, contests,
    mostDisagreed: [...contests].filter(c=>c.total>1).sort((a,b)=>a.modalShare-b.modalShare).slice(0,12).map(c=>c.id)};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ?? new URL('../data/public/results.json',import.meta.url);
  const summary = analyze(JSON.parse(await readFile(input,'utf8')));
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({...summary,contests:undefined},null,2));
}
