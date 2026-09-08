// Adds an explicit estimate for one crash-ended attempt whose provider usage
// was lost before run_end could be written.
//
// Usage: node src/doctor-missing-usage.js <target.jsonl> <peer.jsonl> [...]
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const ESTIMATED_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'thinkingTokens',
  'apiMs',
];

function completedUsage(events, path) {
  const end = events.findLast(
    (event) => event.type === 'run_end' && event.budgetReached,
  );
  if (!end?.usage || !(end.usage.turns > 0)) {
    throw new Error(`${path} has no completed run with positive usage.turns`);
  }
  return end.usage;
}

function missingAttempt(events) {
  let active = null;
  const missing = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === 'run_start' || event.type === 'run_resume') {
      if (active !== null) missing.push({ ...active, insertAt: index });
      active = { start: event, retainedTurns: 0, lastEvent: event };
    } else if (
      (event.type === 'run_end' || event.type === 'usage_estimate') &&
      active !== null
    ) {
      active = null;
    } else if (active !== null) {
      if (event.type === 'model_turn') active.retainedTurns += 1;
      if (event.t != null) active.lastEvent = event;
    }
  }
  if (active !== null) missing.push({ ...active, insertAt: events.length });
  if (missing.length !== 1) {
    throw new Error(
      `expected exactly one unaccounted attempt, found ${missing.length}`,
    );
  }
  return missing[0];
}

export function buildUsageEstimateRepair(targetEvents, references) {
  const attempt = missingAttempt(targetEvents);
  if (attempt.retainedTurns === 0) {
    throw new Error('the unaccounted attempt has no retained model turns');
  }
  const targetStart = targetEvents.find((event) => event.type === 'run_start');
  const referenceUsage = references.map(({ path, events }) => ({
    path,
    usage: completedUsage(events, path),
  }));
  const resolvedModels = new Set(
    referenceUsage.map(({ usage }) => usage.resolvedModel).filter(Boolean),
  );
  if (resolvedModels.size > 1) {
    throw new Error('reference runs resolved to different models');
  }
  const resolvedModel = [...resolvedModels][0] ?? targetStart?.model;
  if (targetStart?.model && resolvedModel && targetStart.model !== resolvedModel) {
    throw new Error(
      `target model ${targetStart.model} does not match ${resolvedModel}`,
    );
  }

  const referenceTurns = referenceUsage.reduce(
    (sum, { usage }) => sum + usage.turns,
    0,
  );
  const usage = { turns: attempt.retainedTurns };
  for (const field of ESTIMATED_FIELDS) {
    const total = referenceUsage.reduce(
      (sum, reference) => sum + (reference.usage[field] ?? 0),
      0,
    );
    usage[field] = Math.round(
      (total / referenceTurns) * attempt.retainedTurns,
    );
  }
  const referencesWithCost = referenceUsage.filter(
    ({ usage: value }) => value.costUsd != null,
  );
  if (referencesWithCost.length > 0) {
    const pricedTurns = referencesWithCost.reduce(
      (sum, { usage: value }) => sum + value.turns,
      0,
    );
    usage.costUsd =
      (referencesWithCost.reduce(
        (sum, { usage: value }) => sum + value.costUsd,
        0,
      ) /
        pricedTurns) *
      attempt.retainedTurns;
  }
  if (resolvedModel) usage.resolvedModel = resolvedModel;

  const estimate = {
    t: attempt.lastEvent.t,
    type: 'usage_estimate',
    reason: 'hard crash prevented provider usage from reaching run_end',
    usage,
    method: {
      kind: 'pooled-peer-per-turn',
      formula:
        'sum(reference usage) / sum(reference usage.turns) * retained attempt turns',
      retainedAttemptTurns: attempt.retainedTurns,
      referenceTurns,
      tokenRounding: 'nearest integer',
      costRounding: 'unrounded',
    },
    referenceRuns: referenceUsage.map(({ path }) => basename(path)),
  };
  return {
    events: [
      ...targetEvents.slice(0, attempt.insertAt),
      estimate,
      ...targetEvents.slice(attempt.insertAt),
    ],
    estimate,
  };
}

async function readEvents(path) {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

async function doctor(targetPath, referencePaths) {
  const targetEvents = await readEvents(targetPath);
  const references = await Promise.all(
    referencePaths.map(async (path) => ({ path, events: await readEvents(path) })),
  );
  const repaired = buildUsageEstimateRepair(targetEvents, references);
  const temporaryPath = `${targetPath}.doctoring`;
  await writeFile(
    temporaryPath,
    `${repaired.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  await rename(temporaryPath, targetPath);
  return repaired.estimate;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [targetPath, ...referencePaths] = process.argv.slice(2);
  if (!targetPath || referencePaths.length === 0) {
    throw new Error(
      'Usage: node src/doctor-missing-usage.js <target.jsonl> <peer.jsonl> [...]',
    );
  }
  const estimate = await doctor(targetPath, referencePaths);
  console.log(JSON.stringify(estimate, null, 2));
}
