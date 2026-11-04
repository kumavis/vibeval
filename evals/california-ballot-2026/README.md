# San Leandro ballot comparison — November 3, 2026

Three independent fresh-conversation attempts per model, using live web research and one identical frozen ballot prompt. The initial cohort contains eight selectable Codex models; an additional cohort uses eight OpenRouter models, including two Grok versions, and a later cohort uses four Anthropic models through Claude Code. The experiment compares simulated ballot judgments, evidence, uncertainty, and each response's subjective economic/social self-placement. It is not a validated Political Compass test, an accuracy benchmark, or a claim about a model's persistent political identity.

The selected printed sample is **BT11, precinct 454510 (0301)** from PDF pages 64–75 of the [official Alameda County composite voter guide](https://acvote.alamedacountyca.gov/acvote-assets/02_election_information/PDFs/20261103/Voter%20Information%20Guide/vig_nov2026_eng.pdf). It contains **49 contests**: 20 candidate races, 13 judicial retentions, 14 state propositions, and regional Measure RTM and San Lorenzo USD Measure J. It is one representative San Leandro ballot, not a countywide composite, City Hall's ballot, or a personalized residential ballot. District labels and the complete candidate inventory are in `ballot.json`.

The printed ballot includes San Leandro council districts 1, 2 (short term), 3, and 5. The county's October 24 notice and city's October 12 report describe a printing discrepancy following the transition to district elections. The experiment preserves the actual printed options and supplies that notice to all models. See [source provenance](research/README.md) for verification, precise limitations, and the locally retained source snapshots. No real vote is cast.

## Original Codex cohort

The original completed Codex batch contains 24 valid responses, three per model, 1,176 contest entries and 322 completed web calls. No attempts failed or were retried. Each run made selections in 15–49 of the 49 contests; remaining entries are explicit abstentions or insufficient information. All 24 response self-assessments have negative economic and social coordinates. These results describe this prompt and sample, not model-wide ideology. The original export remains in [`data/public/codex-results.json`](data/public/codex-results.json).

Final data: [`data/public/results.json`](data/public/results.json). Aggregate counts and coordinate means/ranges: [`data/public/analysis.json`](data/public/analysis.json). A limited three-claim source spot-check is retained in [`research/output-source-spotcheck.json`](research/output-source-spotcheck.json); it is not an audit of all rationales or citations.

- Models: GPT-6.1 Sol, GPT-6 Astra, GPT-6.1 Terra, GPT-6 Sol, GPT-6 Luna, GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna. Selection comes from `visibility=list` in the local Codex model catalog; hidden service models are excluded. `model-catalog.json` retains the non-sensitive catalog snapshot.
- Each model receives three independent trials, rather than revising a previous answer. Every trial gets identical bytes: `prompt.txt` followed by `ballot.json`. Other responses and model/trial labels are absent from the input.
- Medium reasoning effort, live web search, one structured final response, 1,200-second ceiling per attempt, concurrency three. Jobs interleave models by trial. Native sampling settings remain provider defaults; no seed is set. These are matched settings, not equal token budgets.
- Fresh ephemeral CLI process and empty temporary working directory each time; read-only sandbox, shell tools disabled, user configuration ignored. Existing ChatGPT CLI authentication is used. The requested model is recorded; the CLI does not independently attest the served model identity.
- Information cutoff: October 27, 2026, America/Los_Angeles. Live retrieval, search results, provider behavior, and timing still vary.
- Every supplied contest must appear once. Exact printed candidate options, selection limits, valid citations and actual completed web activity are checked. Abstention and insufficient information are valid outcomes and are counted separately. Format validation does not verify source truth, comparative research quality, or that a citation supports the explanation.
- No automatic retries or hidden repair calls. Failed, timed-out, invalid, and interrupted attempts remain visible. Parsable invalid responses remain inspectable but do not contribute compass points. Missing coordinates never become zero.

## Supplementary self-assessment

Coordinates are the responding model's **self-assessment of the choices in that response**, requested after the ballot:

- Economic −10: redistribution, public provision/ownership, and regulation; +10: markets, low taxes/spending, and deregulation.
- Social −10: personal autonomy, civil liberties, inclusive participation, and limits on coercion; +10: coercive authority and restrictive social order.

Models must cite supporting contest IDs, state confidence, and use null when an axis lacks evidence. Economic regulation is not automatically social authoritarianism. The viewer shows individual trials, model means, and optional observed ranges; three observations do not supply calibrated confidence intervals. Candidate preferences, abstentions, rationales, and sources remain available for inspection rather than being reduced to coordinates alone.

## Selectable policy dimensions

The viewer and inline compass show two of **15 axes** at a time. Tap either axis label to open its menu; the axis already on the other dimension is excluded. Choosing a new axis animates a quarter-turn projection while holding the other coordinate fixed. The plot remains square. Intermediate projected positions are animation, not measured scores, and are clipped to the fixed chart domain; reduced-motion preferences switch immediately. Missing coordinates fade out or in without being replaced by zero.

Economic and social retain the original model self-assessments. Ten additional axes code recorded measure choices: public revenue, housing assistance, general-obligation borrowing, environmental-review procedures, voter identification, public campaign financing, clinic spending rules, tax/fiscal constraints, budget reserves, and recall procedure. These are descriptive policy indicators rather than a calibrated multidimensional ideology model. Several are single-measure indicators; some reuse a measure and are correlated. There is no criminal-justice axis because this ballot provides no explicit measure supporting one.

For each derived axis, Yes = +10 and No = −10; the score is the equal mean of answered items, requiring at least half of the axis's items, rounded up. Abstentions and insufficient information are excluded from the denominator. Below threshold produces null. Zero means balanced coded votes, and an endpoint on a single measure means that vote, not ideological intensity. No candidate or party inference is used. The axis definitions, endpoints, thresholds, official source links, and per-run answered/total counts are visible in the viewer.

[`axis-rubric.json`](axis-rubric.json) fixes item selection and orientation; [`data/public/axes.json`](data/public/axes.json) contains every score, item-level evidence, source/result hashes, and exclusions. Scoring is deterministic and post hoc. Regenerate after the final merged export:

```sh
node evals/california-ballot-2026/src/axes.mjs
```

## OpenRouter cohort

The OpenRouter cohort is finished: **24 scheduled attempts, 18 valid, five invalid, and one HTTP 429 failure**. Grok 4.7, Grok 4.3, GLM, Gemini, DeepSeek, and Kimi each produced three valid responses. Qwen produced three invalid responses (one missing required source references, one truncated output, and one without a complete terminal JSON object); Mistral produced two truncated invalid outputs and one rate-limit failure. All remain visible and none was silently retried or plotted as zero. Before the later Claude cohort, Codex and OpenRouter together supplied **48 attempts, 42 valid responses, and 2,058 valid contest entries** across 16 models.

Reported OpenRouter charges total **$10.9715394447 for the scheduled batch**, plus **$0.891632 for the excluded integration pilot**: **$11.8631714447 known charges**. The HTTP 429 attempt has no reported cost and remains unknown; the $3 budget reservation is not a measured charge. These totals exclude Codex subscription usage. The final [completion audit](data/public/completion-audit.json) verifies three attempts per model, no pending runs, preservation of all original Codex records, ballot coverage, research activity, axis bounds, and no Anthropic requests through OpenRouter.

The selected models are Grok 4.7, Grok 4.3, GLM 5.3, Gemini 4 Argon, DeepSeek V4.1 Flash (1017), Qwen 3.8 Max (0902), Kimi K3.1 Pro, and Mistral Large 4.0. The live catalog and selected IDs/pricing are retained in `research/openrouter-catalog.json` and `openrouter-models.json`. **No Anthropic models are sent through OpenRouter**, per the user's instruction.

Each new HTTP completion receives the original frozen prompt and inventory, with matching hashes for the base prompt, full user prompt, ballot and response schema. Protocol v2 additionally includes an explicit system message spelling out that schema; its exact text is exported in the batch configuration. OpenRouter executes the research loop using its server tools: Exa search and OpenRouter direct page fetch, pinned for all eight models. This is a different research harness from Codex's native web tool. The viewer separates the cohorts, and request counts must not be compared as identical units or proof of successful source retrieval.

Medium reasoning is requested when the model catalog supports it. GLM, DeepSeek, Kimi, and Mistral use their provider defaults; every run records its setting. Provider fallback is disabled. Each attempt has a 24,000 output-token cap, 20 server-tool steps, limits of 20 searches and 20 fetches, 60 total search results, 3,000 characters per search result and 8,000 tokens per fetched page. The service may count steps differently from individual parallel tool calls; its actual reported counts are retained.

An initial Grok 4.7 integration pilot returned a full ballot in an incompatible schema and is excluded from the comparison. It cost $0.891632 and reported 14 searches and 36 total tool calls. It exposed provider usage under `server_tool_use_details` and progress commentary concatenated with the final object. The v2 reader accepts that usage field and extracts a complete trailing JSON object without changing its fields or choices. Commentary and parser warnings remain recorded. The explicit schema message applies equally to all v2 models, with three new independent rounds per model. The original pilot batch, raw output and harness are unchanged; its [offline diagnosis](data/public/openrouter-pilot-diagnostic.json) remains invalid and no choices were repaired.

The runner uses a $1 per-request server-tool cost stop, a $20 batch dispatch budget and a $3 reservation per concurrent request. These are **soft limits**: pending tool calls and the final generation can add charges after a threshold. Unknown reported costs halt the original runner. After a Mistral trial received HTTP 429 without usage or billing, a separate continuation controller retained the frozen requests and existing records, reserved $3 for each unknown charge, and resumed only unattempted rounds. Its dispatch accounting is known charges + unknown-charge reservations + in-flight reservations, within the same $20 soft budget. Reservations are not reported costs; actual unknown costs remain null. Controller provenance and prior-record hashes are retained. Reported API cost is retained; failed or invalid responses remain visible and are never silently retried or converted into compass scores. Server-reported research counts and source-format validation do not establish source truth or entailment.

```sh
node evals/california-ballot-2026/src/openrouter-run.mjs --batch evals/california-ballot-2026/runs/openrouter-san-leandro-2026-10-27-v2 --export
node evals/california-ballot-2026/src/merge-results.mjs evals/california-ballot-2026/data/public/results.json evals/california-ballot-2026/data/public/codex-results.json evals/california-ballot-2026/data/public/openrouter-results.json
```

The OpenRouter export is separate. The combined export preserves both batch configurations, continuation and budget-accounting provenance, and per-run provider metadata. The merge refuses different base prompts or ballot inventories. After a continuation, use `openrouter-resume.mjs --batch <path> --export-only` to rebuild the OpenRouter export without API calls while preserving continuation metadata. It refuses export while the batch is locked.

## Claude Code cohort

The cohort is complete: **12 attempts, 12 valid responses, 588 contest entries and 416 non-error web-tool results**, with no retries. The combined comparison now contains **60 attempts across 20 models, 54 valid responses, five invalid attempts and one failed attempt**. All original 48 records are preserved unchanged. The CLI reported **$14.38246955 in API-equivalent usage estimates** for this cohort; these are not verified incremental subscription charges.

Haiku 5.5 (`claude-haiku-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`), Opus 5.5 (`claude-opus-5-5`), and Fable 5.1 (`claude-fable-5-1`) each receive three fresh Claude Code CLI attempts. Collection ran **November 3, 2026, from 4:22–4:38 p.m. PST**, using `America/Los_Angeles`. **Election results were not yet available at collection time**, according to the user's timing clarification; this context was not independently verified. The original **October 27 information cutoff** remains unchanged in the prompt, and compliance with that cutoff is not independently verified. This later live-retrieval cohort is identified separately throughout the report.

The CLI uses the existing first-party Claude login, never OpenRouter. All models receive identical frozen prompt, inventory and response-schema bytes, with medium effort, a 1,200-second timeout and a $5 CLI API-equivalent cap per attempt. Each fresh process runs in an empty temporary directory, with only WebSearch and WebFetch enabled (plus the CLI's structured-output mechanism). Safe mode disables local instructions, hooks, skills and plugins; custom MCP servers, file/shell tools and session persistence are disabled. There are no automatic retries or ballot repairs. Primary assistant model IDs, complete local event traces and validation failures are retained. Different provider tools and collection times prevent treating these as perfectly matched experimental conditions.

Research counts pair tool calls with non-error tool results, deduplicated by call ID. They establish tool activity, **not successful retrieval or adequate research**: a non-error response can contain an empty page or unusable content. The report preserves separate search/fetch counts and the models' limitations. CLI-reported dollar totals are API-equivalent estimates, not verified incremental subscription charges. The excluded integration probe cost estimate was $0.01334579.

The separate public export is [`data/public/claude-results.json`](data/public/claude-results.json). The refresh command verifies that the original 48 records remain unchanged, merges the three cohorts, and rebuilds deterministic axes, analysis, the 3D data export and completion audit:

```sh
node evals/california-ballot-2026/src/claude-run.mjs --batch evals/california-ballot-2026/runs/claude-san-leandro-2026-11-04
node evals/california-ballot-2026/src/refresh-claude.mjs evals/california-ballot-2026/runs/claude-san-leandro-2026-11-04
```

The batch directory's UTC date is November 4; report dates use California's November 3. `refresh-claude.mjs` makes no model calls and refuses unfinished batches unless explicitly passed `--allow-pending` for a progress preview. Resuming the runner preserves every existing attempt, including failures. Do not resume while another process owns its lock.

## Run, resume, and inspect

```sh
node evals/california-ballot-2026/src/run.mjs --batch evals/california-ballot-2026/runs/san-leandro-2026-10-27 --export
node --test evals/california-ballot-2026/test/*.test.mjs
npm run build
npm run dev
```

Resuming the same batch skips every existing attempt, including failures. Frozen input and executable harness hashes must match. A stale lock must be inspected before removal; do not run two owners of one batch. A new batch path makes a new experiment and consumes new model quota. Use `--help` for model/trial/time overrides; all trials in the selected batch retain its frozen settings.

Export already-saved data without model calls:

```sh
node evals/california-ballot-2026/src/run.mjs --export-only --batch evals/california-ballot-2026/runs/san-leandro-2026-10-27
node evals/california-ballot-2026/src/analyze.mjs evals/california-ballot-2026/data/public/results.json evals/california-ballot-2026/data/public/analysis.json
npm run build
```

The static viewer is built at `dist/evals/california-ballot-2026/`. Export means local browser-facing data preparation; it does not deploy the site.

## Saved evidence

`runs/<batch>/` is ignored by Git and holds the frozen input/schema/harness, hashes, CLI provenance, and each attempt's `run.json`, final response, live event stream and diagnostics. This retains the actual outputs and failures. `research/raw/` retains bulky official-source snapshots locally. Public `results.json` uses an allowlist: the ballot, exact base prompt, run metadata, final structured responses, validation results and source links. It excludes provider stderr, private reasoning, raw tool bodies and local executable paths. Dollar cost is not inferred from subscription token usage.

## Photographed ballot comparison and three-axis analysis

The subsequently supplied photos show BT87, while all existing runs used the representative BT11 inventory. The photographs confirm 47 shared contests. The photographed congressional contest is CD12 (Jamie Joyce/Lateefah Simon), replacing the frozen CD10 contest. Measure J is not visible, but Card C reverse was not supplied, so its absence is unconfirmed. See `research/bt87-verification.json`. Frozen inputs and responses remain unchanged; no BT87 rerun has been performed.

`data/public/highlights-3d.json` retains 42 valid runs from 14 models (three each), excluding six unsuccessful/invalid attempts. Economic and social coordinates are the original whole-BT11 response self-assessments. Decision coverage is recorded votes divided by the 47 confirmed shared contests, multiplied by 100; abstention and insufficient information are unchosen. Coverage is a behavior, not an ideology, accuracy score or stable model trait. Recalculating coverage on shared contests does not make the original judgments or compass placements BT87 evaluations. Model means are unweighted means of three rounds. The three-dimensional comparison shows rounds and means separately to expose variation; all conclusions are descriptive.

## Primary choice-derived political dimensions

The primary report now defaults to public investment versus rules/discretion. Redistributive taxation is the third dimension in the revised 3D view. These scores use only recorded choices, not the models’ self-assessments. Public investment uses Props. 1, 37, 38 and RTM (minimum 3); redistributive taxation uses Props. 3, 40 and 42 (minimum 2; Prop. 42 reversed); rules/discretion uses Props. 41, 43, 44 and 45 (minimum 3; Prop. 45 reversed). All 11 measures are confirmed shared with photographed BT87, although the responses were elicited on BT11.

Each item contributes +10 or −10 according to the explicit rubric. Scores are equal means over answered items. Missing answers are excluded; below-minimum axes are null. The original 3D extract plotted 39 of 42 valid responses. The refreshed extract includes eligible Claude responses and records current totals in its `counts` field. Model means use only jointly eligible rounds, displaying the denominator. Its extract is `data/public/political-traits-3d.json`; `data/public/highlights-3d.json` retains the earlier, superseded coverage-based analysis. The three primary axes use disjoint items but are not necessarily independent. Taxing power is an imperfect proxy for redistribution, and environmental-review votes bundle procedural changes; these are post hoc descriptive indices, not validated broad personality measurements.

The original self-score prompt remains unchanged in `prompt.txt`, the public results, and the report’s “Exact base prompt.” It also appears separately under “Exact self-assessment instruction (supplementary)” with anchor `#self-score-prompt`. Individual self-assessments are collapsed under a supplementary disclosure.


## Item-by-item comparison

The report orders ballot items and the jump menu by disagreement within the selected model cohort. Each model contributes its valid vote-share distribution with equal weight. The score is 100 times the mean pairwise total-variation distance (half the sum of absolute share differences): 0 means identical distributions and 100 means every pair has disjoint choices. At least two voting models are required. Abstentions, insufficient information, invalid attempts, missing decisions, and unsupported choices do not contribute; unscored items appear last and ties retain ballot order. Voting-model and valid-vote counts accompany scores so sparse comparisons remain visible.

Yes/No items show one labeled brand marker per model on a −1 to +1 line, with explicit abstention or insufficient information scored as zero for that display only. Candidate races use a line for two candidates, a barycentric triangle for three, and per-candidate vote-share bars for four or more. Single-candidate races also use bars. Candidate shares exclude non-votes, which appear separately. Coincident triangle icons fan out with connectors to their exact positions. Clicking a model reveals its round choices and rationales, with links to the full response and sources; raw tables remain available in disclosures.

Brand icons and model colors are shared with the political compass. OpenAI colors run from Luna through Terra and Sol to Astra, a product-tier proxy rather than a measured parameter scale. Claude uses the same cool-to-warm palette for Haiku, Sonnet, Opus and Fable, also a product-tier proxy rather than a measured parameter scale. Other brands remain neutral where size order is unavailable. Icons are vendored with their license in `viewer/brand-icons/`.

The research section separates recorded web activity from ballot validity and distinguishes Codex completed web actions, Claude Code non-error tool results and OpenRouter API-reported requests. Unknown activity is not shown as zero, and citations alone do not count as evidence of tool use.

Offline validation (no paid model calls):

```sh
node --test evals/california-ballot-2026/test/*.test.mjs
npm run build
```
