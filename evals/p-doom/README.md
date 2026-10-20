# AI catastrophe research comparison

This eval compares independent research and model construction for **LEAP Wave 9's unconditional global AI-catastrophe scenario by December 31, 2050**. The event kills more than 10% of the people alive at the start of a qualifying five-year period. That period begins on or after December 31, 2025 and ends before the resolution date. AI must be a direct or proximate cause under LEAP's but-for test, including substantial AI involvement within the prior year. The authoritative criteria and metadata are in `scenario.json`, with the [original resolution rules](https://leap.forecastingresearch.org/reports/wave9#ai-catastrophic-risk).

Each model selects its own sources, mechanisms, nodes, dependencies and numerical judgments. No starting graph, pathway taxonomy, common capability prerequisite or probability is supplied. The shared ProbLog format limits the representation to a compact positive acyclic graph; it does not prescribe its construction. The calculated percentage is an output to inspect, not a quality or accuracy score.

The earlier 90% pilot results remain archived locally for provenance. They are excluded from this comparison's public data. [Tool-fit notes](TOOL-FIT.md) describe those historical experiments; they are not the current scenario or benchmark results.

## Install and check ProbLog

From the repository root:

```sh
python3 -m venv evals/p-doom/.venv
evals/p-doom/.venv/bin/python -m pip install -r evals/p-doom/requirements.txt
npm run eval:doom -- --tool-trial
```

The tool trial makes no model calls and uses **hypothetical inputs only**. It checks a shared prerequisite across overlapping pathways, duplicate proofs, a zero-probability prerequisite, conditioning on observed evidence, and mutually exclusive timeline alternatives. On October 19, 2026, all five checks passed using ProbLog 2.2.10. The example yields 2.6%; falsely treating dependent pathways as independent yields 2.8%, and simply adding them yields 3.0%. These are test numbers, not a forecast.

ProbLog is a good fit for a compact, inspectable network of causal pathways with shared causes. It computes the implications of assumptions and avoids double counting overlapping proofs. It does not discover credible probabilities from internet prose, validate citations, establish a causal graph, or calibrate an extinction forecast. These are the difficult research tasks.

## Run the matched comparison

```sh
npm run eval:doom:batch -- --concurrency 3
```

The batch contains 21 attempts: three GPT-6 Luna attempts at each supported CLI thinking level (`low`, `medium`, `high`, `xhigh`, `max`), plus three GPT-6 Sol and three GPT-6 Astra attempts at `medium`. The medium runs provide a matched cross-model comparison; Luna's additional levels explore thinking-effort differences. `none` and `ultra` are not offered for Luna by this CLI's model catalog.

Every attempt uses a shared frozen prompt and information cutoff, live web research, at most three total responses, and a 1800-second wall budget. These are response/time budgets, not equal token spend. Thinking effort deliberately varies in the Luna sweep. Each response is an isolated ephemeral conversation with the previous candidate and feedback replayed. Models cannot inspect earlier trials. Native provider defaults and live web retrieval remain sources of variation.

The batch saves `runs/leap-.../batch.json`, including the exact input hashes and every scheduled job. It refuses to continue if executable harness inputs, scenario or prompt change. A stopped batch with no jobs still marked running can be resumed with `--resume BATCH_ID`; failed or timed-out attempts are retained, not silently rerun. A backend capacity error is a provider failure, not a modeling failure.

The published comparison includes three requested Sol 6.1 medium-effort trials alongside the initial comparison. The separately requested trial-4 attempts for the original models were stopped by the user and remain marked interrupted. Sol 6.1's first attempts at trials 1 and 2 exposed a harness bug: access dates were incorrectly bounded by the earlier forecast cutoff. Those attempts are archived as superseded harness runs; their replacements use `doom-lint-v2`, which checks access dates against research execution time while still checking publication dates against the forecast cutoff. Trial 3's provider content restriction is retained as a failure. At the user's explicit request, Sol 6.1 trial 4 retries that blocked attempt using the same prompt and safeguards; its `retryOf` metadata links back to trial 3. The batch records this correction, superseded run IDs and exact input-version snapshots. The prompt, inference semantics, cutoff and per-attempt budgets remain the same.

After a batch, explicitly export that batch's records and transcripts:

```sh
npm run eval:doom:batch -- --export BATCH_ID
npm run build
npm run dev
```

Export accepts only the selected batch with the current LEAP scenario and prompt. It verifies frozen final-artifact hashes and includes unsuccessful attempts without promoting drafts to estimates. It cannot import the older pilots through a directory glob. The public viewer’s hero shows only submitted forecasts on one probability scale; failed and unfinished attempts remain in audit data. It includes central percentages, a selectable calculation graph, source rationales, self-review and a recorded transcript. Graph inputs are assumptions; derived-node probabilities come from ProbLog. Added AND proof gates carry no invented probabilities. Shared atoms are rendered once.

Transcripts contain the prompts, recorded assistant messages, web actions and harness feedback. Private reasoning and full retrieved page bodies are excluded from public transcripts. Provider stderr and local executable paths are excluded from the public transcript.

## Run one research trial

```sh
npm run eval:doom -- --model gpt-6-luna --effort medium --trials 1
```

The default is the requested GPT-6 Luna, medium effort, one trial, at most three total responses, and a 1800-second wall budget. The first valid response evaluates an agent-authored candidate; later responses review and revise it using the same model and effort. Invalid responses, repairs, review and submission all share the round limit. Each response may involve multiple native web searches. No other model is substituted if access fails. An unavailable model produces a retained failed attempt.

The runner prefers `CODEX_CLI_PATH` (the desktop app's bundled CLI), then `codex` on PATH. Override with `--codex /absolute/path/to/codex`. This matters when Homebrew and the app ship different CLI versions/model catalogs. The actual executable and version are recorded. Existing CLI login is used; no API key is needed by this adapter. Provider availability still depends on the login. Each response uses an ephemeral conversation in a fresh isolated directory, with user config ignored, read-only sandbox, live search explicitly enabled, and shell tools disabled. On subsequent responses, the agent receives its previous candidate and ProbLog feedback in a fresh conversation. Trials do not see each other's outputs. Temperature and seed remain provider defaults.

Optional: `--max-seconds 900`, `--max-rounds 4`, `--python /absolute/path/to/python`. `--max-turns` remains an alias for `--max-rounds`; do not supply both. Only explicitly running the research command consumes model quota. Installation, tests, build, offline lint, and the tool trial make no model calls.

## What the agent does

1. Research primary sources, including counterevidence. Produce 6–16 source observations across at least three hostnames, with access dates and limitations. Hostname diversity does not prove independent ownership.
2. Separate sourced observations from subjective probability inputs. Define conditional meanings, plausible parameter ranges, and shared causes.
3. Return an `evaluate` action with a causal graph and `review: null`. The harness statically lints it before invoking ProbLog, then returns the central estimate, derived-event probabilities, all-low/all-high scenarios, and one-at-a-time sensitivity.
4. Review the evaluated candidate using the same model and effort. The response must contain eight structured checks, the SHA-256 of the evaluated candidate, concrete changes, and remaining issues. Review covers the event definition, source fidelity, mitigations, conditioning, dependence, mortality bridge, sensitivity, and uncertainty. References in the review point to the candidate being reviewed; references elsewhere point to the returned revised candidate.
5. Explicitly `submit` the complete revised graph with its review, or `evaluate` again if budget remains. A new valid evaluation becomes the next review target. A rejected submit consumes a round but does not replace that target. A complete review may honestly report issues or uncertainty: the harness never requires an all-pass review. No response or repair calls occur beyond the round limit, and exhaustion never promotes a draft to a forecast.

Protocol `doom-leap-v3` retains the required `review` field and structured lint reports. The historical v1/v2 90%-fatality pilot records are preserved unchanged and excluded from public comparison data. A default successful run can finish in two responses (evaluate, then review-and-submit); the third is available for another review or repair. A review is a structured section of the same model's response, not a separate judge call. The model may revise probability inputs, evidence and graph structure; the numerical inference semantics are unchanged.

## Static format lint

Run lint on a candidate without Python, web access, model credentials, or model calls:

```sh
npm run eval:doom -- --lint candidate.json --as-of 2026-10-19T00:00:00Z
npm run eval:doom -- --lint revised-candidate.json --previous evaluated-candidate.json --as-of 2026-10-19T00:00:00Z
```

Use `--previous` for a reviewed evaluate/submit candidate. The supplied file must be the evaluated candidate referenced by `review.candidateSha256`. Offline lint verifies that identity and format; it cannot establish that an arbitrary supplied file was actually evaluated. The live runner selects its own most recently evaluated candidate. Hashes ignore object key order but preserve array order.

The JSON report contains `valid`, path-specific `errors`, and nonblocking `warnings`. Errors cause exit code 1. Validation checks the exact schema (types, required/unknown fields and enum values), nonblank text, source/parameter counts, real calendar dates and ordering, URL syntax and duplicates, unique IDs and references, finite ordered probabilities, legal atoms, graph connectivity/cycles/collisions, duplicate rules/body atoms, and review completeness/identity. Unused source entries produce warnings. Graph errors are caught before launching ProbLog; the Python engine retains its own defensive checks.

Lint does not fetch URLs or infer whether a date or observation is factually correct. It does not validate a narrative's reasoning or calibrate probabilities. The prompt asks the same model to review those questions and record remaining uncertainty; completing a checklist does not turn that into independent verification.

Each parameter becomes an independent probabilistic fact; a rule body is AND and multiple rules for a head are OR. The agent defines `p_doom` as the final derived event. Shared prerequisites reuse the same atom. A conditional switch must not already include the prerequisite probability; otherwise the model would multiply that probability twice. Every parameter and derived atom must contribute to the target.

For example, the **hypothetical** tool trial contains:

```prolog
0.5::capability_by_2050.
0.4::loss_of_control_switch.
0.2::misuse_switch.
0.1::mortality_threshold_switch.
loss_of_control :- capability_by_2050, loss_of_control_switch.
misuse :- capability_by_2050, misuse_switch.
catastrophe :- loss_of_control.
catastrophe :- misuse.
p_doom :- catastrophe, mortality_threshold_switch.
query(p_doom).
```

Both pathways share `capability_by_2050`; their union is not independent. The mortality threshold is a separate assumption. The computation is `0.5 × (1 − 0.6 × 0.8) × 0.1 = 0.026`.

The research interface deliberately supports a **bounded subset** of ProbLog: positive, acyclic, ground rules with 2–20 parameter switches and up to 32 rules. It rejects injected Prolog, recursion, undefined atoms, dangling branches, nonfinite probabilities, and invalid ranges. Agent code is never executed. ProbLog itself can also express negation, conditioning, and annotated disjunctions; the tool trial demonstrates some of these, but the initial research interface does not expose them. A richer model with exclusive timelines, state-dependent conditional probabilities, or dynamic feedback may warrant a later interface revision or a Bayesian network. Safeguards can be represented through explicitly defined failure switches and shared dependencies in this subset.

The scenario range is exact for the supplied low/high parameter box in this monotone graph, **not a confidence or credible interval**. One-at-a-time sensitivities hold all other inputs at central values. Neither accounts for omitted pathways, uncertain structure, or unmodeled parameter dependence. The agent must describe those separately, including an alternative graph structure.

## Outputs and review

Local results are ignored by Git under `evals/p-doom/runs/<id>/`:

- `run.json`: status, source/model provenance, settings, usage, research audit, round phases, candidate/review-target hashes, structured lint reports, review feedback, and final inference if submitted.
- `events-N.jsonl`, `stderr-N.txt`, `prompt-N.txt`, `candidate-N.json`: raw provider trace, exact prompt, candidate, and diagnostics for each response.
- `model.pl`, `submission.json`: only created after an accepted explicit submission.

`runs/tool-trial.json` stores the latest mechanical check. The batch command does not automatically export or deploy; the explicit export command writes the selected batch to `data/public/`. The gallery reads only explicitly exported comparison records. The common sealed `npm run eval` and common data publisher do not drive this research protocol; use `npm run eval:doom`.

An accepted submission means the graph executed and the evidence fields passed structural checks. It does **not** mean the research is credible. Review the exact event mapping, primary-source quality, whether observations actually support claims, conditional parameter meanings, dependence assumptions, the bridge to the LEAP fatality outcome, and credible counterarguments. Actual web-tool activity is recorded, but citation entailment remains explicitly unverified. Do not pool repeated Luna trials into a calibrated probability or treat them as independent expert opinions.

## Tests

```sh
npm test
evals/p-doom/.venv/bin/python -B -m unittest discover -s evals/p-doom/test -p 'test_*.py'
npm run build
```

Node tests require no Python dependency or model credentials. The separate Python integration tests exercise real ProbLog inference, scenario bounds, shared causes, and malicious/invalid graph rejection. The pinned virtual environment is local and is not part of the static site.

References: [ProbLog modeling semantics](https://problog.readthedocs.io/en/latest/modeling_basic.html), [ProbLog Python API](https://problog.readthedocs.io/en/latest/python.html), [official GPT-6 Luna model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

## Claude research trials

Claude model IDs automatically select the authenticated `claude` CLI (`--claude PATH` overrides it). This uses the same prompt, schema, lint, ProbLog engine, forecast cutoff and bounded same-model review loop as the Codex adapter:

```sh
npm run eval:doom -- --model claude-opus-5-5 --effort medium --trials 3
```

The October 20 extension schedules three medium-effort trials each for Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5, plus one Astra 6 xhigh trial. Every attempt retains the 30-minute, three-response budget. Claude runs with safe mode, empty settings sources, strict MCP isolation, no session persistence and only WebSearch/WebFetch tools. No shell, filesystem or agent tool is enabled. Usage uses the CLI result-level counters; native helper accounting can differ between providers. Native provider system prompts and web-tool implementations differ, so this is a shared research protocol rather than an identical tool environment.

`native-events-N.jsonl` preserves Claude's untouched local trace. `events-N.jsonl` normalizes assistant text, structured output, successful completed web actions, usage and errors for the shared runner and public transcript. Thinking blocks and fetched page bodies are omitted from normalized traces. Primary assistant model IDs are checked against the requested ID; substitutions fail the attempt. No fallback model or automatic harness-level provider retry is configured. Native traces confirmed provider `model_refusal_fallback` events (including category `bio`) that switched Fable/Opus requests to Opus 5. Mixed-model completions are rejected. An initial formatting hypothesis led to replacing CLI structured-output mode with the identical schema supplied as prompt context; longer direct-JSON runs confirmed that the provider refusal fallback also occurs without structured-output mode. The transport change does not resolve that refusal. Affected initial attempts and interrupted work are retained as superseded audit records. The adapter accepts JSON authored by the requested model and validated by the shared static lint; the prompt and safeguards are not weakened to obtain a result. Unaffected Sonnet/Haiku first trials remain attributed to their initial transport snapshot. CLI/API internal network retries, if any, remain inside the same wall-clock budget. CLI subscription authentication is separate from Anthropic API-key authentication.

Exact executable-input snapshots and model cohorts are recorded in the batch history. The Claude adapter extension changes transport and trace normalization, while keeping the original prompt and inference semantics. The Astra xhigh attempt began under the previous executable snapshot.
