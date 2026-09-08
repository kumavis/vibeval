# Courier grid

A scored JavaScript controller task: deliver five weighted parcels on a 24×24 integer grid, balancing value, deadlines, recharge stops, and two partially observed hostile robots. The model writes `controller.js`, tests revisions, inspects practice replays, and explicitly submits. The final controller is frozen before held-out scoring.

## Protocol and scoring

`prompt.txt` is the shared model-facing specification. `eval.json` pins 30 responses as the primary limit, a two-hour wall-time fallback, and a 32 KiB source limit. The protocol accepts `write_file`, `read_file`, `test`, `inspect_episode`, and `submit`. A model may spend up to 192 practice episodes: fixed tests repeat 24 cases, fresh tests consume batches of eight from a separate 40-case pool. Inspection consumes responses but no new simulations. The harness records each test's code hash and result; practice scores are not final scores.

Final scoring runs 128 separate cases. Score is mean delivered parcel value as a percentage of all available value, with partial credit retained after capture, exhaustion, or deadline. Controller exceptions and timeouts receive zero for that case. Compilation is checked at submission; compilation success does not imply behavioral correctness. No held-out result is returned to the model after it submits.

## Scenario calibration

Run `npm run calibrate --workspace @vibeval/courier-grid` to generate a **new version's** private scenario suite. Do not regenerate a suite beneath existing benchmark results. The generator accepts only scenarios with a replay-verified full-delivery witness under the real enemy policies. Witness generation sees all enemies; controllers see only nearby enemies. This certifies feasibility, not that any particular partially observed policy can guarantee 100%.

The initial suite contains 192 scenarios selected from 263 candidates. A simple enemy-aware baseline substantially outperforms greedy routing. All baselines reported in `data/public/baselines.json` are run through the same runtime with partial observations on the identical held-out cases used for the model submissions. Public baseline numbers differ from practice calibration numbers because the cases differ.

Private scenario definitions and witnesses live in ignored `data/private/suites.json`; retain that file to rerun the exact suite. Public records pin its SHA-256 and publish scored replays, not witness solutions. Published cases become inspectable by humans: this is a development holdout, not a claim of permanent benchmark secrecy. Generate and version a new suite when evaluating models trained or prompted on published traces.

## Running and publishing

```sh
npm run eval -- --eval courier-grid --provider codex-cli --model gpt-5.6-terra --effort medium
npm run eval -- --eval courier-grid --provider codex-cli --model gpt-5.6-sol --effort medium
npm run data:publish -- --eval courier-grid --run evals/courier-grid/runs/RUN_ID
npm run build
```

Run provenance includes the harness/eval source hash, prompt, requested and reported model, effort, CLI version, turns, practice history, usage, estimated cost when available, artifact hash, suite hash, and wall time. A run is one model's controller-development session; episodes are repeated tests of that single controller, not independent model samples.

## Runtime

Controller code executes in an SES compartment with no host capabilities. Inputs and outputs cross via JSON strings. Each episode creates a fresh compartment. A child process has a 128 MiB V8 heap limit; a VM timeout bounds controller initialization and the entire episode to one second. The VM is a watchdog, not the isolation boundary. A parent deadline terminates failed batches. Returned memory is capped at 32 KiB. Browser replays draw recorded data and never execute controller source.

`npm test --workspace @vibeval/courier-grid` tests determinism, observation boundaries, frozen scoring/publication, missing exports, memory limits, and infinite loops. `COURIER_VERIFY_SUITE=1 npm test --workspace @vibeval/courier-grid` additionally replays all private feasibility witnesses.

## Viewer

The gallery registers this eval automatically. The viewer loads published scores, allows selecting individual scenario bars, and scrubs the single grid replay along its delivery timeline. The spectator can see both enemies; faded enemies were not visible to the controller. All asset URLs support a GitHub Pages project prefix.

## Initial pilot (medium effort)

Terra submitted after 23 responses and 8.4 minutes, scoring 61.97% on 128 held-out cases (23 full deliveries). The enemy-aware baseline scored 77.55% on those same cases. Sol reached 83.75% on fixed practice and 79.78% on its latest fresh batch, but timed out at 20 minutes without submitting. Its unfinished run is published with its practice history, no final artifact, and no held-out score. These practice and final figures are not directly comparable model rankings.

Both encountered export/JSON formatting errors. This pilot therefore measures protocol recovery as well as controller design. Remaining wall time should be exposed in feedback, and structured/native actions should replace fragile free-text JSON before a larger comparison. The original trials remain immutable; do not silently repair their submissions or score unfinished drafts as final work. See `data/public/pilot-summary.json` for recorded timings and price-estimate completeness.

## Harness v2

Reruns retain the same simulator, scenario suite, 30-response limit, medium effort, and 192-practice-episode budget. The wall-time cap is now a two-hour fallback; controller provider requests have a 15-minute stall timeout. Every request displays the current response number, responses remaining including that request, remaining fallback seconds, and remaining simulation budget. The last response explicitly instructs submission.

Codex uses a strict JSON output schema on initial and resumed requests. Timed-out requests are not retried, and transport failures are not retried with less than 60 seconds remaining. Historical v1 results remain immutable and are labeled separately in the viewer.

The v2 rerun produced two explicit submissions with zero malformed JSON responses and zero provider retries. Terra used 21 responses (8.5 minutes) and scored 61.30%; Sol used 29 responses (19.1 minutes) and scored 76.26%, on the same 128 held-out scenarios. Sol was captured in none of those scenarios; missed deadlines and battery exhaustion account for its incomplete deliveries. These remain single-development-run pilot results. Detailed comparison: `data/public/pilot-v2-summary.json`.
