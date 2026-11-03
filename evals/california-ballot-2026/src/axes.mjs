import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const coordinate = n => Number.isFinite(n) && n >= -10 && n <= 10 ? n : null;

export function buildAxes(data, rubric) {
  const axes = rubric.axes;
  if (!Array.isArray(axes) || new Set(axes.map(a => a.id)).size !== axes.length) throw new Error('Axis IDs must be unique');
  const ballot = data.ballot?.contests ? new Map(data.ballot.contests.map(c => [c.id, c])) : null;
  for (const axis of axes) {
    if (axis.min !== -10 || axis.max !== 10) throw new Error(`Unexpected scale: ${axis.id}`);
    if (axis.kind === 'self-reported') {
      if (!['economic', 'social'].includes(axis.id)) throw new Error(`Unknown self-report: ${axis.id}`);
      continue;
    }
    if (!axis.items?.length || axis.totalItems !== axis.items.length || !Number.isInteger(axis.minAnswered) || axis.minAnswered < Math.ceil(axis.items.length / 2) || axis.minAnswered > axis.items.length) throw new Error(`Invalid coverage rubric: ${axis.id}`);
    if (new Set(axis.items.map(i => i.contestId)).size !== axis.items.length) throw new Error(`Duplicate item: ${axis.id}`);
    for (const item of axis.items) {
      if (item.weight !== 1 || ![10, -10].includes(item.yesScore) || item.noScore !== -item.yesScore || !item.sourceUrls?.length) throw new Error(`Invalid scoring item: ${item.contestId}`);
      if (ballot && ballot.get(item.contestId)?.type !== 'measure') throw new Error(`Rubric references an absent/non-measure contest: ${item.contestId}`);
    }
  }
  const runs = {}, evidence = {}, seen = new Set();
  const excludedRuns = [];
  for (const run of data.runs ?? []) {
    if (typeof run.id !== 'string' || seen.has(run.id)) throw new Error(`Missing/duplicate run ID: ${run.id}`);
    seen.add(run.id);
    if (run.status !== 'completed' || run.validation?.valid !== true || !run.response || !Array.isArray(run.response.decisions)) {
      excludedRuns.push({id: run.id, status: run.status, reason: 'Requires completed status, explicit valid validation, and a response with decisions.'});
      continue;
    }
    runs[run.id] = {};
    evidence[run.id] = {};
    for (const axis of axes) {
      if (axis.kind === 'self-reported') {
        const value = coordinate(run.response.compass?.[axis.id]);
        runs[run.id][axis.id] = value;
        evidence[run.id][axis.id] = {answered: value === null ? 0 : 1, total: 1, minAnswered: 1,
          items: [{responseField: axis.responseField, score: value, status: value === null ? 'missing_or_invalid' : 'reported'}],
          supportingContestIds: run.response.compass?.evidenceContestIds ?? [], confidence: run.response.compass?.confidence ?? null,
          reason: value === null ? 'No finite self-reported value within the scale.' : 'Original self-reported coordinate; no vote recoding.'};
        continue;
      }
      const items = axis.items.map(item => {
        const matches = run.response.decisions.filter(d => d.contestId === item.contestId);
        const decision = matches.length === 1 ? matches[0] : null;
        const choice = decision?.status === 'voted' && Array.isArray(decision.choices) && decision.choices.length === 1 ? decision.choices[0] : null;
        const score = choice === 'Yes' ? item.yesScore : choice === 'No' ? item.noScore : null;
        return {contestId: item.contestId, title: item.title, status: matches.length > 1 ? 'duplicate_decision' : decision?.status ?? 'missing',
          choice, score, weight: 1, sourceUrls: item.sourceUrls,
          included: score !== null, reason: score !== null ? 'Recorded binary vote.' : 'No unambiguous recorded Yes/No vote.'};
      });
      const answered = items.filter(i => i.included);
      const value = answered.length >= axis.minAnswered ? answered.reduce((sum, i) => sum + i.score, 0) / answered.length : null;
      runs[run.id][axis.id] = value;
      evidence[run.id][axis.id] = {answered: answered.length, total: items.length, minAnswered: axis.minAnswered, items,
        reason: value === null ? 'Insufficient answered items; no point.' : 'Equal mean over answered items only.'};
    }
  }
  return {schemaVersion: 1, rubricVersion: rubric.rubricVersion, electionDate: rubric.electionDate,
    resultsExportedAt: data.exportedAt ?? null, sourceResultsSha256: digest(data), rubricSha256: digest(rubric),
    methodology: rubric.methodology, axes, runs, evidence, excludedRuns,
    counts: {inputRuns: (data.runs ?? []).length, eligibleRuns: Object.keys(runs).length, excludedRuns: excludedRuns.length}};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ?? new URL('../data/public/results.json', import.meta.url);
  const output = process.argv[3] ?? fileURLToPath(new URL('../data/public/axes.json', import.meta.url));
  const rubricFile = process.argv[4] ?? new URL('../axis-rubric.json', import.meta.url);
  const [data, rubric] = await Promise.all([input, rubricFile].map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const result = buildAxes(data, rubric);
  await mkdir(dirname(resolve(output)), {recursive: true});
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({output, axes: result.axes.length, ...result.counts}));
}
