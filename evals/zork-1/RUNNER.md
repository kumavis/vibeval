# llm-plays-zork

An LLM plays [Zork I](https://en.wikipedia.org/wiki/Zork). A z-machine
interpreter compiled to WebAssembly (`web.wasm`) runs the original
`zork1.z3` story file, and an agent loop wires the game up to an LLM as a
tool: each turn the model submits one command via a `submit_command` tool
call, and the game's printed response comes back as the tool result. Text
the model writes outside the tool call is its "out loud" commentary.

![Score progression across all completed runs; dashed lines are web-assisted](logs/run-scores.svg)

Four interchangeable player backends are supported:

- **OpenAI** — or any OpenAI-compatible endpoint (LM Studio, Ollama, etc.)
  via `OPENAI_BASE_URL`. Uses the `submit_command` tool; endpoints without
  tool calling fall back to a plain-text `COMMAND:` protocol.
- **Anthropic API** — via the official SDK, defaulting to `claude-opus-5`.
  Uses the `submit_command` tool with server-side refusal fallbacks, and
  surfaces the model's summarized thinking in the terminal.
- **Claude Code CLI** — headless `claude -p` with all tools disabled, using
  whatever login the CLI already has; no API key needed. Uses the
  `COMMAND:` text protocol over one persistent CLI process per game, so
  the CLI's multi-second startup is paid once rather than every turn.
- **Codex CLI** — headless `codex exec` on whatever ChatGPT login the CLI
  already has; no API key needed. Also the `COMMAND:` text protocol, but
  `codex exec` has no persistent stdin channel, so each turn is its own
  process continuing the thread with `codex exec resume <id>` — boot is
  paid per turn (~2s of wall time, no move budget).

Each backend owns its conversation history in its API's native format, so
thinking blocks and tool calls are retained and replayed where the API
supports them.

## Setup

Requires Node.js 22+.

```sh
cp .env.example .env   # pick a backend and add a key (not needed for the CLI backends)
yarn                   # install dependencies
```

The backend is chosen with `LLM_PROVIDER` (`openai`, `anthropic`,
`claude-cli`, `codex-cli`, or `opencode-cli`); when unset, it is inferred
from which API key is present. The CLI backends need their tool installed
and logged in (`claude`, `brew install codex && codex login`, or
`brew install opencode && opencode auth login`) but no key here. See
`.env.example` for all knobs (models, base URL, reasoning effort).

## Run

```sh
yarn start
```

The terminal shows the game transcript and the player's reasoning and
commands. Press Ctrl+C to stop; the chat history is written to `logs/`
for debugging. Malformed model responses are also dumped there.

## Test

```sh
yarn test
```

Runs a smoke test of the z-machine bridge (boots the game and opens the
mailbox), unit tests for the text protocol and history trimming, and
stub-server tests of both API providers (tool-result pairing, thinking
replay, failure recovery, and the tools fallback).

## Eval

`yarn eval` runs a models × trials matrix and reports how they compare:

```sh
yarn eval --models claude-haiku-4-5-20251001,claude-sonnet-5 --trials 3 --moves 300 --name my-eval
yarn eval:cost logs/eval-gpt-5.6-sol-300/*.jsonl
yarn eval:report logs/eval-my-eval        # re-aggregate a batch
yarn eval:report logs/eval-a logs/eval-b  # one table across batches
yarn eval:score-svg                       # chart all completed runs together
```

A `--models` entry may carry its own backend and reasoning effort, so a
single batch can span harnesses:

```sh
yarn eval --models claude-cli:claude-sonnet-5,codex-cli:gpt-5.6-sol@medium --trials 3
```

Each run is bounded by **game moves**, not wall-clock, so a slower model
is not penalized for thinking longer. The trial number doubles as the
game's RNG seed, so every model plays the same game in trial *k* —
combat rolls and thief movement included — which makes the comparison
paired rather than noisy. A trial that already spent its budget is
skipped, so an interrupted batch resumes with the same command.

Runs write `logs/eval-<name>/run-*.jsonl`: one event per model turn,
command (with the game's response and whether it was a parser rejection
or a world refusal), score change, and a `run_end` summary with token
usage and cost. Only runs that spent their full move budget are counted;
one stopped early is labeled and excluded. Metrics are queries over
those logs, so new questions can be asked of old runs.

Model comparisons hold the backend constant. The `claude-cli` backend
spawns with no tools, no MCP servers, no setting sources, and a neutral
working directory, so a run cannot search the web, read files, or keep
notes between turns: its only effector is the game. The `codex-cli`
backend gets the same treatment it can ask for — `--ignore-user-config`
(no plugins, skills, or MCP servers), `--ignore-rules`, web search off, a
read-only sandbox, and an empty scratch directory of its own per game —
with two differences worth stating rather than papering over:

- Codex's shell tool cannot be turned off the way `claude --tools ''`
  removes Claude's, so the model *can* run read-only commands. There is
  nothing in its working directory to find, but the capability is there.
- `codex exec` has no equivalent of `claude --system-prompt`, so Codex's
  own agent instructions stay in the request and the player prompt rides
  on top of them as `developer_instructions`.

The `opencode-cli` backend defines its own primary agent inline: the
player prompt replaces OpenCode's default agent instructions, and a
single `*: deny` permission closes built-in, custom, and MCP tools alike.
It runs with `--pure` (no external plugins) and disables snapshots,
sharing, autoupdate, and CLAUDE.md-style instruction files around an
empty scratch directory per game, so like the Claude backend its only
effector is the game. A single request may run for fifteen minutes so
large artifact generations can finish; the run's wall-clock budget still
bounds every turn.

So cross-harness numbers compare *harness plus model*, which is what a
subscription actually buys; only within a backend is the model the single
variable.

The report groups runs by the model name they requested, so use versioned
Claude IDs rather than the moving `opus`, `sonnet`, and `haiku` aliases. Eval
runs reject those aliases to keep later model generations in separate rows.
Also pin one reasoning effort per model within a batch
(`gpt-5.6-sol@medium`) — two Codex efforts otherwise share a row.

The Claude CLI reports its own API-equivalent cost. The Codex CLI reports
tokens but no dollar amount because these runs use a ChatGPT subscription,
so `src/cost-estimator.js` estimates what the same recorded usage would cost
at standard OpenAI API list prices. The OpenCode CLI prices each step from
models.dev list rates and reports that API-equivalent amount; it stays
unreported when the model has no rate metadata rather than becoming zero.
Estimated amounts carry a `~` prefix and are not the subscription charge.

The estimator subtracts cached reads and cache writes from total input to
obtain uncached input, then calculates:

```text
(uncached input × input price
 + cached input × cached-input price
 + cache writes × 1.25 × input price
 + output × output price) / 1,000,000
```

Reasoning tokens are already included in output tokens and are not charged
twice. Costs cover only model turns retained in the repaired scoring
transcript. When repair removed turns from an interrupted attempt, historical
logs provide only an attempt-level token total, so the estimator prorates each
token category by retained turns / recorded turns and rounds to the nearest
token. Duplicate cleanup records are ignored.

If a hard crash prevents an attempt's provider usage from being written at
all, `yarn eval:doctor-usage <target.jsonl> <complete-peer.jsonl> [...]` adds
an explicit `usage_estimate` event. It pools the named complete peer runs,
calculates each usage category and provider-reported cost per model turn, and
multiplies those rates by the crash-ended attempt's retained turns. Token and
duration estimates are rounded to the nearest integer; dollar cost remains
unrounded. Before repair, reports mark the known subtotal with `>` and an
`incomplete` basis; they never silently present it as the whole cost. After
repair, reports mark the reported-plus-estimated total with `~`, retain the
reference filenames and formula in `summary.json`, and approximate a
crash-ended attempt's active duration through its last logged event rather
than counting the idle gap before resume. Historical logs contain
aggregate, not per-request, usage, so estimates cannot detect or include the
OpenAI long-context surcharge for requests over 272K input tokens. Prices are
the official [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
and [GPT-5.6](https://developers.openai.com/api/docs/models/compare) rates as
of 2026-09-07; each generated `summary.json` records the rate table, formula,
token breakdown, and assumptions for every estimated run.

### Results

All runs use a 300-game-move budget and deterministic seeds, with a maximum
Zork score of 350. Every model has three completed trials. Full transcripts,
event logs, and summaries are under the matching `logs/eval-<model>-300/`
directory, and a qualitative read of the
earlier 24 runs — what each model actually did and where it got stuck — is in
[logs/transcript-summaries.md](logs/transcript-summaries.md). Scores are
each run's **peak**; Zork deducts 10 points for dying, so a run can and
often does end below the figure reported here. The table below is the sealed
benchmark — no internet, no tools beyond the game; see
[Web access](#web-access) for what changes when the model can search.

| provider  | model            | seed 1 | seed 2 | seed 3 |
| --------- | ---------------- | -----: | -----: | -----: |
| Anthropic | Claude Fable 5.1 |    204 |    149 |    296 |
| Anthropic | Claude Opus 5    |    144 |     94 |     98 |
| Anthropic | Claude Sonnet 5  |     95 |     75 |     69 |
| Anthropic | Claude Haiku 4.5 |     15 |     49 |     40 |
| OpenAI    | GPT-6 Astra      |    185 |    189 |    214 |
| OpenAI    | GPT-5.6 Sol      |    104 |    129 |    115 |
| OpenAI    | GPT-5.6 Terra    |     55 |     50 |     59 |
| OpenAI    | GPT-5.6 Luna     |     40 |     35 |     49 |

| provider  | model            | trials | median | mean  | mean cost/run | score per $ | mean wall/run |
| --------- | ---------------- | -----: | -----: | ----: | ------------: | ----------: | ------------: |
| Anthropic | Claude Fable 5.1 |      3 |    204 | 216.3 |        ~$2.68 |        80.6 |     ~16.7 min |
| Anthropic | Claude Opus 5    |      3 |     98 | 112.0 |         $9.79 |        11.4 |      36.0 min |
| Anthropic | Claude Sonnet 5  |      3 |     75 |  79.7 |         $1.76 |        45.3 |      19.6 min |
| Anthropic | Claude Haiku 4.5 |      3 |     40 |  34.7 |         $1.04 |        33.5 |      13.7 min |
| OpenAI    | GPT-6 Astra      |      3 |    189 | 196.0 |        ~$7.91 |        24.8 |      38.5 min |
| OpenAI    | GPT-5.6 Sol      |      3 |    115 | 116.0 |        ~$4.93 |        23.5 |      59.4 min |
| OpenAI    | GPT-5.6 Terra    |      3 |     55 |  54.7 |        ~$2.41 |        22.7 |      37.5 min |
| OpenAI    | GPT-5.6 Luna     |      3 |     40 |  41.3 |        ~$0.21 |       193.2 |      36.2 min |

Claude Fable 5.1 leads on both median (204) and mean (216.3), and its 296 on
seed 3 is the benchmark's highest single run. Its spread is wide — 149 to
296 — but even its median is 15 points above GPT-6 Astra's 189. Astra remains
the more consistent high scorer, with all three runs between 185 and 214.
Fable also has the best score per dollar among the Anthropic runs at 80.6,
although its seed 3 cost and duration are approximate because a disk-full
crash lost the first attempt's provider accounting. GPT-5.6 Luna retains the
best score per estimated API dollar among the sealed OpenAI runs, at much
lower absolute scores.


### Web access

The sealed runs cannot reach the internet. To measure what that costs, the
two weakest OpenAI models were rerun on the same seeds with Codex's web
search turned on and one line added to the player prompt telling them the
tool exists (`--models codex-cli:gpt-5.6-terra@medium+web`). Nothing else
changed: same model, same effort, same seeds, same move budget.

| model         | condition | seed 1 | seed 2 | seed 3 | median |  mean | cost/run | score per $ |
| ------------- | --------- | -----: | -----: | -----: | -----: | ----: | -------: | ----------: |
| GPT-5.6 Terra | sealed    |     55 |     50 |     59 |     55 |  54.7 |   ~$2.41 |        22.7 |
| GPT-5.6 Terra | **+web**  |     92 |     87 |     99 | **92** |  92.7 |   ~$2.61 |        35.5 |
| GPT-5.6 Luna  | sealed    |     40 |     35 |     49 |     40 |  41.3 |   ~$0.21 |       193.2 |
| GPT-5.6 Luna  | **+web**  |     75 |    100 |     72 | **75** |  82.3 |   ~$0.32 |       257.7 |

Every seed improved, and both models roughly doubled: Terra's median went
55 → 92, Luna's 40 → 75. Both got *cheaper per point* despite spending more
per run, and the session logs confirm the models really did search, with
queries like "Zork I brass key location grating walkthrough". The runs are
labelled `<model>+web` end to end — in `run_start`, in the report's rows,
and as dashed lines in the chart above — so an assisted run can never be
averaged into a sealed one.

Two behavioural side effects are visible in the tables: deaths rose (Luna
1 → 4 per run) while world refusals fell by half, consistent with a
walkthrough sending the model confidently into places it had not yet
earned. Both conditions used the same 300-move budget, so this measures
what web access buys within a fixed budget, not how fast a walkthrough
finishes the game.

## How it works

- `src/zork.js` — bridges the WASM z-machine via `wasm-ffi`: loads the
  story file, feeds commands, and emits the game's printed output.
- `src/agent.js` — selects the provider backend.
- `src/providers/` — the backends: `openai.js`, `anthropic.js`,
  `claude-cli.js`, `codex-cli.js`, and `opencode-cli.js`. Each owns its
  native conversation history and exposes the same interface:
  `requestCommands(gameOutputs)` returns the model's submitted commands
  plus its out-loud commentary.
- `src/index.js` — the game loop: runs submitted commands in the game,
  feeds the printed output back as the next tool result, and restarts
  the game when it ends.
- `src/system-prompt.txt` — the player's static instructions (tutorial,
  game commands); each backend appends its own response-format section.

## Prompt caching

Prompt caching is a prefix match, so the harness keeps the request prefix
byte-stable between turns: the system prompt is static (no interpolated
state), the transcript only grows, and history is trimmed in chunks (jump
the window forward once at a ceiling) rather than sliding every turn. The
Anthropic backend sets a cache breakpoint each request so the previous
turn's prefix bills at cache-read rates; OpenAI endpoints cache stable
prefixes automatically; the Claude CLI backend resumes one CLI session
per game and only sends new game output, letting the CLI manage its own
history and caching. The Codex backend cannot hold a process open, so each
turn re-enters the same thread with `codex exec resume`; the Responses API
still cache-reads the replayed prefix, which is most of the request. The
OpenCode backend works the same way through `opencode run --session <id>`,
re-entering the stored session each turn and letting the provider cache the
replayed prefix.
