import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Artifact format and assessment are independent: a text/file eval can
// have a numeric scorer, while an interactive eval can be viewer-judged.
export function defineEval(value) {
  const definition = structuredClone(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.id)) throw new Error('Invalid eval id');
  if (!['text', 'files', 'environment'].includes(definition.format)) throw new Error('Unknown eval format');
  if (!['subjective', 'numeric'].includes(definition.assessment?.type)) throw new Error('Assessment must be subjective or numeric');
  if (definition.assessment.type === 'numeric') {
    const metrics = definition.assessment.metrics;
    if (!Array.isArray(metrics) || !metrics.length || metrics.some(m => !m.id || !['higher', 'lower'].includes(m.direction))) throw new Error('Numeric assessment requires named metrics with directions');
  }
  if (definition.format !== 'environment') {
    const limits = { maxTurns: 30, maxWallMs: 600000, maxArtifactBytes: 2000000, maxFiles: 32, ...definition.limits };
    for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid limit: ${key}`);
    definition.limits = limits;
    if (definition.format === 'files' && definition.entry !== 'index.html') throw new Error('File evals currently require index.html');
  }
  return definition;
}

export async function loadEval(directory) {
  const definition = defineEval(JSON.parse(await readFile(join(directory, 'eval.json'), 'utf8')));
  const prompt = await readFile(join(directory, 'prompt.txt'), 'utf8');
  if (!prompt.trim()) throw new Error('Eval prompt cannot be empty');
  return { definition, prompt };
}

export function validateScores(assessment, scores) {
  if (assessment.type === 'subjective') return null;
  if (!scores || assessment.metrics.some(m => !Number.isFinite(scores[m.id]))) throw new Error('Scorer must return every declared numeric metric');
  return Object.fromEntries(assessment.metrics.map(m => [m.id, scores[m.id]]));
}

export function submissionInstructions(definition) {
  return `You are completing an evaluation. Work carefully, inspect your work, and iterate until you are satisfied. You choose when to submit. A draft is not a submission. There is no reward for using all available turns.\n\n` +
    `Return exactly one JSON object per response, without Markdown fences. You have ${definition.limits.maxTurns} responses and ${definition.limits.maxWallMs / 1000} seconds. The harness returns feedback after each action. A rejected submission may be revised.\n\n` +
    (definition.format === 'text'
      ? `Actions:\n{"action":"draft","content":"full revised text","note":"what you improved"}\n{"action":"submit","content":"complete final text","note":"why it is ready"}\nThe full content must be included each time. Preserve spaces and line breaks.\n`
      : `You have an initially empty working directory. Use these actions to create and inspect files; paths are relative to it. This harness performs the file operations.\nActions:\n{"action":"write_file","path":"index.html","content":"complete file contents"}\n{"action":"read_file","path":"index.html"}\n{"action":"list_files"}\n{"action":"check"}\n{"action":"submit","note":"what you checked and why it is ready"}\nYou may repeatedly overwrite files to iterate. Deliver index.html and its relative local assets. No build step, external dependencies, network calls, absolute URLs, or emoji are needed. Checks verify packaging, not appearance: review the code and interaction design yourself. The viewer uses a sandboxed iframe with scripts allowed and an opaque origin. Prefer classic scripts; storage and fetched ES modules are unavailable.\n`) +
    `\nOnly explicit, valid submit actions finish a run. Running out of time or turns leaves the run unsubmitted. Quality is ${definition.assessment.type === 'subjective' ? 'judged by the human viewer; validity checks are not quality scores' : 'measured by the eval’s declared numeric scorer'}.`;
}
