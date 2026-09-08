# Eval formats and submissions

An eval has two independent properties:

| Property | Options | Purpose |
| --- | --- | --- |
| `format` | `text`, `files`, `environment` | What the model produces or interacts with |
| `assessment.type` | `subjective`, `numeric` | Whether viewers judge the work or a scorer returns metrics |

`defineEval()` validates this contract. Zork declares an environment format and a numeric peak-score metric, and retains its established game runner. The two new creative evals use the common submission runner. Their prompts are stored verbatim in `prompt.txt`.

## Run the examples

```sh
npm run eval -- --eval ascii-sunken-ship \
  --models "codex-cli:YOUR_MODEL@medium,claude-cli:YOUR_MODEL@high" --trials 3

npm run eval -- --eval snow-globe \
  --provider codex-cli --model YOUR_MODEL --effort medium
```

Model IDs and effort are required. Each trial has a fresh session and working directory; environment variable defaults cannot silently change these settings or enable web search. Existing CLI authentication is used. No model calls happen during install, tests, building, or publication. `--max-turns` and `--max-seconds` override an eval's defaults and are included in the run's definition hash and settings.

## Iteration and submission

The system instructions encourage inspection and revision until the agent is satisfied. The agent chooses when to finish. A successful first-turn submission is allowed; the harness does not force pointless extra turns.

The common action protocol is one JSON object per model response. The harness returns structured feedback and a reminder of the remaining responses. JSON parsing and validity failures consume a turn but allow another attempt.

Text actions:

```json
{"action":"draft","content":"a complete draft, preserving whitespace","note":"what changed"}
{"action":"submit","content":"the complete final text","note":"why it is ready"}
```

The ASCII eval accepts printable ASCII plus whitespace and rejects emoji/Unicode submissions. This validates the output format; it does not grade the depiction of the ship or sea.

File actions:

```json
{"action":"write_file","path":"index.html","content":"<html>...</html>"}
{"action":"read_file","path":"index.html"}
{"action":"list_files"}
{"action":"check"}
{"action":"submit","note":"checked the scene and controls"}
```

The harness performs these operations in the run's real `workspace/` directory. Both providers get the same file interface. They can inspect and overwrite files repeatedly. Native CLI filesystem/shell tools are not enabled: these are model-driven file actions, not a general shell/build/browser agent. A future execution adapter can add those capabilities without changing result formats or assessment types.

The file checker verifies the file/byte budgets, `index.html`, and static HTML/CSS asset references. It does **not** execute JavaScript, render the page, test interactions, verify 3D behavior, or judge visual quality. It returns those limits explicitly. Output should be directly servable HTML/CSS/JS with relative local assets and no build step. The viewer uses `sandbox="allow-scripts"`: scripts run but cannot access the gallery origin. Opaque origins limit storage and fetched modules. Network calls dynamically made by JavaScript are not blocked by the packaging checker or iframe sandbox.

An accepted `submit` freezes the final text or file tree under `artifact/` and hashes every file. Later workspace changes cannot alter that snapshot. Turn exhaustion, time exhaustion, interruption, and provider failure are distinct terminal statuses with no final artifact. Nothing promotes the last draft to a final result.

## Numeric scoring

Declare metrics with an ID and `higher` or `lower` direction:

```json
"assessment": {
  "type": "numeric",
  "metrics": [{ "id": "correctness", "label": "Correct answers", "direction": "higher" }]
}
```

Add an eval-owned `scorer.js` exporting `score({ content, directory, definition, prompt })`. Text candidates supply `content`; file candidates supply their `directory`. Return an object with finite numbers for every declared metric. Scoring happens only at a valid final submission and is subject to the remaining wall budget for async work. Scorers are trusted harness code; do not put unbounded synchronous work in them. Subjective evals have `metrics: null`, and the viewer does not invent quality scores or rankings.

## Run records

Local runs are ignored by Git until explicitly published:

```text
evals/<id>/runs/<run-id>/
  run.json          Settings, provenance, outcome, timing, usage, and artifact hashes
  events.jsonl      Observations, responses, feedback, and submission events
  draft.txt         Latest valid text draft, if any
  workspace/        File eval's mutable workspace
  artifact/         Frozen accepted submission, if any
```

The versioned record captures:

- The harness protocol version, Git commit, dirty state, Node version, and SHA-256 of runner source plus the dependency lockfile. The definition, prompt, and eval-owned source (including scorers) have a separate hash, as do the full system instructions; prompt/instruction text is retained.
- Requested model ID, provider-reported resolved ID when available, CLI version, explicit reasoning effort, and thinking-budget configuration. Missing resolved IDs and unreported internal model-call counts stay `null`.
- Trial number, capabilities, limits, status, start/end timestamps, and wall time, including retries and harness feedback.
- Harness turns, draft/write actions, submission attempts, provider requests/retries, provider usage, and reported cost or a versioned API-equivalent estimate. A harness turn is one response/action, not a claim about the provider's hidden internal inference calls.
- Whether a failed or interrupted run may be missing in-flight usage. Unreported thinking tokens are not assumed to be independently billable.

## Pricing

The CLI uses the historical `packages/runner/src/pricing.json` snapshot copied from Zork, dated **2026-09-07**, with exact model matching. It is not a live pricing lookup. Pass `--pricing my-prices.json` to use another recorded snapshot:

```json
{
  "asOf": "YYYY-MM-DD",
  "source": "URL or other provenance for these rates",
  "models": {
    "EXACT_MODEL_ID": { "input": 1, "cachedInput": 0.1, "cacheWrite": 1.25, "output": 5 }
  }
}
```

Rates are USD per million tokens. The numbers above only illustrate the schema. A CLI-reported API-equivalent price takes priority; otherwise the matching snapshot and formula are saved in the result. Unknown rates remain unavailable rather than becoming zero. Estimates account for the providers' different cached-input semantics and do not bill reasoning tokens twice. They do not represent a subscription charge or include unknown tier/long-context surcharges.

## Publish and view

```sh
npm run data:publish -- --eval ascii-sunken-ship \
  --run evals/ascii-sunken-ship/runs/RUN_ID
npm run build
npm run dev
```

Publication checks artifact hashes, copies the frozen result and history into `data/public/`, and appends the run metadata to `runs.json`. It can also publish an unsuccessful run to show its status/history, but never its draft as a final. Duplicate publication is rejected. The operation is local; GitHub Pages deployment follows the repository's normal workflow. Do not run two publishers for the same eval simultaneously; a lock rejects concurrent publication. If a process is killed during publication, remove its leftover `.publish-lock` only after confirming that no publisher is active.

The viewer preserves ASCII whitespace, embeds websites in sandboxed frames, and shows effort, turns, time, price, detailed provenance, the prompt used for each run, and expandable iteration history. The creative evals ship recorded Luna, Terra, and Haiku trials. Tests use deterministic fake providers and never fabricate published model results.

## Add another eval

Copy `templates/text-submission` or `templates/file-submission` into `evals/<id>`, change `eval.json` and `prompt.txt`, and run the common CLI. Add `scorer.js` only for numeric assessment. The build discovers the directory automatically and exports the prompt into the viewer's context. The older `static-artifacts` template remains supported for importing pre-existing outputs that do not have submission-run metadata.
