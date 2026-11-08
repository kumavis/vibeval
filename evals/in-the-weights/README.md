# Is Dan Finlay in the weights?

A small, reproducible recall comparison inspired by [In the Weights](https://intheweights.com/). It asks about **Dan Finlay**, associated with **MetaMask**, using three independent probes and three trials per model. Results are inspectable text, not a claim that we can audit a model's training corpus.

## Protocol

`protocol.json` contains the exact common instruction and prompts. Each call starts a fresh conversation. No search, tools, prior answers, reference facts, or reviewer feedback is supplied.

1. **Name only:** “Who is Dan Finlay, and what is he known for?”
2. **MetaMask cue:** asks about his connection with MetaMask. This is explicitly prompted recognition, not unaided recall.
3. **False premise:** asks whether he co-founded Phantom rather than MetaMask. This tests correction of a deliberately incorrect premise, not unaided recall.

The viewer leads with the percentage of available name-only rubric points against total parameter count (three answers worth up to two points each), followed by a separate false-premise comparison. It shows completed answers only. HTTP errors, transport failures, truncation and empty responses have no score and never enter a denominator. Original attempts remain in run provenance. Model groups use the returned model ID; price-tier suffixes are hidden. Codex requested IDs are explicitly marked because its traces do not attest serving identity. Unknown sizes are displayed separately, without invented coordinates. Reviewer references are never sent to tested models.

## Run the Tailscale models

Set `IN_THE_WEIGHTS_BASE_URL` to the inference server’s OpenAI-compatible base URL on your tailnet.

```sh
node evals/in-the-weights/src/run.js \
  --base "$IN_THE_WEIGHTS_BASE_URL" \
  --models gemma-4-26b-a4b,step-3.7-flash --trials 3
```

The runner first reads `/models` and rejects unavailable model IDs. Omitting `--models` uses all advertised IDs. Requests run sequentially to avoid competing model loads on the same GPU. It records weights filenames when advertised by llama.cpp, without copying private server paths into public data. Temperature is 0.7, seed is 1700 + trial, max tokens is 8192, and the request timeout is 600 seconds. Seed support and determinism depend on the server. Thinking uses the server default. There are no implicit retries or substitute models.

## Run free OpenRouter models

Set `IN_THE_WEIGHTS_API_KEY` in the environment using your existing OpenRouter credential, then:

```sh
node evals/in-the-weights/src/run.js --base https://openrouter.ai/api/v1 \
  --models nvidia/nemotron-3.5-lightning:free,openrouter/free --trials 3 --pause-ms 3500
```

Free-model availability and rate limits vary. Check the current `/models` inventory. Both the requested route and **the response's actual `model` field** are retained for every answer, including `openrouter/free`; different requests can select different models. A router is a heterogeneous sample, not one model. The initial expanded batch uses a 3.5-second pause before each request. Failed requests remain in raw operational records, excluded from result views and scoring. Authentication is read only from the environment, never embedded in the eval or public artifacts.

## Run Codex models

```sh
node evals/in-the-weights/src/codex.js \
  --models gpt-6-luna,gpt-6.1-sol,gpt-6-astra --effort medium --trials 3
```

Uses `CODEX_CLI_PATH` when available, otherwise `codex`, with existing CLI authentication. Each call is ephemeral in a new empty temporary directory. User configuration, project documentation, web search, shell tools, apps, memories, and multi-agent features are disabled. The runner checks the JSONL output for tool activity. Native Codex instructions remain; temperature, seed, and token cap use provider defaults. Those differences are recorded rather than claiming identical inference settings. The common instruction is supplied as a developer message, and the probe as the user prompt. Codex JSONL does not attest the serving model: `resolvedModel` stays null, never copied from the requested model.

The first Codex run used an unsupported `features.skills=false` setting; the CLI ignored it and emitted configuration diagnostics. The retained raw traces allow those diagnostics to be distinguished from actual tool calls. A parser correction is recorded in the batch; no new model answer is fabricated and no model was rerun solely to fix parsing.

## Local data and publication

Each batch is checkpointed under ignored `runs/<id>/batch.json`. Raw provider JSON or Codex JSONL and stderr stay local. Runner snapshots and hashes preserve the executed source. Interruptions remain marked running rather than pretending to be complete. API credentials are never serialized. Exact endpoint URLs and native reasoning traces are excluded from public export.

```sh
node evals/in-the-weights/src/run.js --publish RUN_DIRECTORY_NAME
npm run build
npm run dev
```

Publication here means copying a completed batch into `data/public/` locally. It does not push or deploy. The build auto-registers `eval.json`; the viewer works under a GitHub Pages project prefix.

## Validation

```sh
node --test evals/in-the-weights/test/*.test.js
npm test
npm run build
```

Unit tests use mocked responses only. They cover resolved identity, failure/truncation accounting, public export, fresh request transport, and Codex tool auditing. Install, tests, and build never query a model.

## Scoring rubric and filled inputs

`data/public/assessment.json` contains the filled review inputs for all 369 included answers, rationale, evidence links, and a SHA-256 binding to the exact answer text. `viewer/scoring.js:scoreReview` is the single deterministic scoring function. The viewer recomputes scores from inputs; tests require the saved values to agree. No keyword classifier or stochastic model judge is involved.

| Probe | 2 points | 1 point | 0 points |
| --- | --- | --- | --- |
| Name only | Affirmative MetaMask founder/co-creator identification, no material biographical issue found | Founder identified, but contradicted or unsupported material biographical claim | No founder identification, including abstention |
| MetaMask cue | — | — | Always: supplied association earns no unaided credit |
| False premise | Unambiguous rejection of Phantom founding, identifies MetaMask founding, no material factual issue | Partial correction, contradictory yes/no, missing founding role, or added factual issue | Accepts the premise or fails to correct it |

The recorded inputs are `founderRecognized`, `biography`, `premise`, and `otherFactualIssue`. Founder credit requires an affirmative founding/co-creation claim; lead developer, product manager, association or a negated founding statement does not qualify. Biographical labels distinguish abstention, no issue found, unsupported specific claims, and claims contradicted by sources. Unsupported is not synonymous with proven false. Current job titles and generic praise are outside the rubric. False-premise scoring additionally considers errors about Phantom's founders. Its score is never counted toward name-only recall.

Evidence classification is a manual, source-assisted judgment. The arithmetic is deterministic; reviewing the inputs may still change a score. Every answer card exposes the inputs, rationale, and sources. The sources are post-run reviewer material. Clean means no material issue found in this review, not a guarantee that every claim is true.

## No-web evidence audit

```sh
node evals/in-the-weights/src/audit.js evals/in-the-weights evals/in-the-weights/data/public/audit.json
```

The audit rechecks all 369 included answers against locally retained traces and runner snapshots. For Claude Code it verifies the empty tool list at initialization, text-only final answer, reported serving model, and absence of tool invocations and server web searches or fetches. The traces cover client-visible activity. Provider internals are outside their scope.

## Expanded run · November 8, 2026

Each of 20 models contributed three answers per probe, giving 60 name-only, 60 cued and 60 false-premise answers. The expanded run filled missing trial slots by responding model. HTTP failures, truncated responses and tool requests without an answer have no score. Retries preserve the original probe and trial slot and record the actual requested model, seed and returned model.

Gemma 31B completed through its standard route after its free route returned an error. Step ran on the Tailscale server. The large additions were Qwen3 235B Instruct, Nemotron 3 Ultra (550B) and DeepSeek V3.2 (671B). GPT-6.1 Terra used Codex CLI. Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.1 used Claude Code CLI in bare mode, with a fresh empty home and configuration directory and OpenRouter’s Messages API. A signed-in preliminary Claude run exposed account context and was excluded from the evaluation.

The name-only review awarded full credit to 33 of 60 answers. Qwen3 235B and Nemotron Ultra each earned full credit three times. Dots 3 Note Preview (280B) and DeepSeek V3.2 earned zero full-credit passes. DeepSeek identified the creator once and added an unsupported ConsenSys Mesh CEO role. The four Claude models and four Codex models each earned three full-credit passes. Their parameter counts are undisclosed. The separate false-premise test recorded 24 clean corrections in 60 answers.

## OpenRouter coverage · November 9, 2026

Five direct endpoints supplied nine answers each. Llama 3.1 8B and Qwen3 14B fill the gap between 2.69B and 25.23B. Llama 3.3 70B and gpt-oss-120b fill the gap between 30.7B and 198B. Hermes 4 405B falls between Dots 280B and Nemotron Ultra 550B. The plotted totals for Qwen3 14B and gpt-oss-120b are 14.8B and 117B. Every response reported its requested model ID.

That expansion brought the evaluation to 225 audited answers from 25 models. None of the 15 additional name-only answers identified MetaMask co-founding. Hermes associated Dan with the wallet on all three trials and described him as a developer or contributor. The name-only full-credit count is 33/75 and the false-premise clean correction count is 25/75.

To fill remaining slots programmatically, call `complete(model, options)` from `src/complete.js`. Set `transport` to `openrouter`, `tailscale` or `claude`. Set `base` to the local inference URL for Tailscale and pass the OpenRouter credential through `apiKey` or `IN_THE_WEIGHTS_API_KEY` for hosted runs. The Claude transport uses Claude Code with the supplied model ID and a fresh empty workspace. Raw evidence stays in ignored run directories. Every new answer requires a filled review, a passing audit and a unique model/probe/trial slot before inclusion in the scored dataset.


## Original model card coverage · November 9, 2026

The 17 model IDs from the original card are listed in `assessment.json` under `cardModels`. The [original checker’s public model map](https://intheweights.com/assets/index-C6ai_yQ4.js) resolves its abbreviated labels: “Thinky Inkling” is Inkling, “Gemini 3.1 Lite” is Gemini 3.1 Flash-Lite, and “DeepSeek V4” is V4 Flash. All card scores come from these Vibeval prompts and reviews.

Llama 3.3 70B already had nine responses. Thirteen additional models used direct OpenRouter endpoints. Opus 4.8 and Haiku 4.5 used Claude Code through OpenRouter with an empty profile and tools disabled. OpenRouter retired its Qwen3 8B route; its error was excluded. A private CPU llama.cpp instance on the Tailscale host served the [publisher’s Qwen3-8B-Q4_K_M.gguf](https://huggingface.co/Qwen/Qwen3-8B-GGUF), verified before loading (SHA-256 `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785`). The local inventory reports 8,190,735,360 parameters. The different quantization and inference server matter when comparing Qwen’s results with the original card.

Each of the 17 has a reported model ID and three completed, trace-audited answers for each probe. This adds 144 answers to the previous 225. In the combined dataset, 41 models contribute 369 reviewed answers.
