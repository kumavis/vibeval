import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Artifact format and assessment are independent: a text/file eval can
// have a numeric scorer, while an interactive eval can be viewer-judged.
export function defineEval(value) {
  const definition = structuredClone(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.id)) throw new Error('Invalid eval id');
  if (!['text', 'files', 'controller', 'choice', 'environment'].includes(definition.format)) throw new Error('Unknown eval format');
  if (!['subjective', 'numeric', 'distribution'].includes(definition.assessment?.type)) throw new Error('Assessment must be subjective, numeric, or distribution');
  if (definition.assessment.type === 'numeric') {
    const metrics = definition.assessment.metrics;
    if (!Array.isArray(metrics) || !metrics.length || metrics.some(m => !m.id || !['higher', 'lower'].includes(m.direction))) throw new Error('Numeric assessment requires named metrics with directions');
  }
  if (definition.format === 'choice' && (!Array.isArray(definition.choices) || !definition.choices.length || definition.choices.some(c => typeof c !== 'string' || !c.trim()) || new Set(definition.choices).size !== definition.choices.length || definition.limits?.maxTurns !== 1)) throw new Error('Choice evals require unique choices and exactly one response');
  if (definition.format !== 'environment') {
    const limits = { maxTurns: 30, maxWallMs: 600000, maxArtifactBytes: 2000000, maxFiles: 32, ...definition.limits };
    for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid limit: ${key}`);
    definition.limits = limits;
    if (definition.format === 'controller' && definition.entry !== 'controller.js') throw new Error('Controller evals require controller.js');
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
  if (assessment.type !== 'numeric') return null;
  if (!scores || assessment.metrics.some(m => !Number.isFinite(scores[m.id]))) throw new Error('Scorer must return every declared numeric metric');
  return Object.fromEntries(assessment.metrics.map(m => [m.id, scores[m.id]]));
}

export function submissionInstructions(definition) {
  if (definition.format === 'choice') return "Answer the user’s question directly.";
  return `You are completing an evaluation. Work carefully, inspect your work, and iterate until you are satisfied. You choose when to submit. A draft is not a submission. There is no reward for using all available turns.\n\n` +
    `Return exactly one JSON object per response, without Markdown fences. Your primary budget is ${definition.limits.maxTurns} responses, including final submission. The wall-time fallback is ${definition.limits.maxWallMs / 1000} seconds. Every request includes remaining budgets. Reserve a response to submit; on your last response, submit your current best valid work. The harness returns feedback after each action. A rejected submission may be revised.\n\n` +
    (definition.format === 'controller'
      ? `Write your controller in controller.js. Actions are one JSON object per response:\n{"action":"write_file","path":"controller.js","content":"complete JavaScript source"}\n{"action":"read_file","path":"controller.js"}\n{"action":"test","suite":"fixed"}\n{"action":"test","suite":"fresh"}\n{"action":"inspect_episode","testId":"test-1","seed":123,"from":0,"limit":20}\n{"action":"submit","note":"why the controller is ready"}\nTests spend the simulation budget described in the task. Inspection reads an existing replay. Final submission freezes your controller and ends development; held-out scoring is not returned for another revision.\n`
      : definition.format === 'text'
      ? `Actions:\n{"action":"draft","content":"full revised text","note":"what you improved"}\n{"action":"submit","content":"complete final text","note":"why it is ready"}\nThe full content must be included each time. Preserve spaces and line breaks.\n`
      : `You have an initially empty working directory. Use these actions to create and inspect files; paths are relative to it. This harness performs the file operations.\nActions:\n{"action":"write_file","path":"index.html","content":"complete file contents"}\n{"action":"read_file","path":"index.html"}\n{"action":"list_files"}\n{"action":"check"}\n{"action":"submit","note":"what you checked and why it is ready"}\nYou may repeatedly overwrite files to iterate. Deliver index.html and its relative local assets. No build step, external dependencies, network calls, absolute URLs, or emoji are needed. Checks verify packaging, not appearance: review the code and interaction design yourself. The viewer uses a sandboxed iframe with scripts allowed and an opaque origin. Prefer classic scripts; storage and fetched ES modules are unavailable.\n`) +
    `\nOnly explicit, valid submit actions finish a run. Running out of time or turns leaves the run unsubmitted. Quality is ${definition.assessment.type === 'subjective' ? 'judged by the human viewer; validity checks are not quality scores' : 'measured by the eval’s declared numeric scorer'}.`;
}

// A flat, strict schema is supported by both initial and resumed Codex requests.
export const controllerActionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['write_file','read_file','test','inspect_episode','submit'] },
    path: { type: ['string','null'], enum: ['controller.js',null] },
    content: { type: ['string','null'] },
    suite: { type: ['string','null'], enum: ['fixed','fresh',null] },
    testId: { type: ['string','null'] }, seed: { type: ['integer','null'] },
    from: { type: ['integer','null'] }, limit: { type: ['integer','null'] },
    note: { type: ['string','null'] },
  },
  required: ['action','path','content','suite','testId','seed','from','limit','note'],
};
