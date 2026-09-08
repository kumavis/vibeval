# Zork I

The first Vibeval eval: a model plays the bundled Zork I story through a WebAssembly interpreter. The original system prompt, seeded RNG, move/turn limits, score probes, restart accounting, resume behavior, and reporting tools are preserved. Shared providers and model-spec parsing now import from `@vibeval/runner`.

Run commands from the repo root with `npm run eval:zork -- ...`, or run `npm run eval -- ...` in this directory. For an individual run, set `LLM_PROVIDER`, the provider's model environment variable, `MAX_MOVES`, and optionally `ZORK_SEED`, then use `npm run start:zork` from the root. Configuration is read from the environment; see [.env.example](.env.example). Credentials from the source checkout were not copied.

[RUNNER.md](RUNNER.md) is the original detailed reference. Its `src/`, `logs/`, and game-asset paths are relative to this eval directory; its historical yarn commands can be run using the equivalent npm scripts. The source repository links in that document are historical references.

## Shipped dataset

`data/raw/` contains the 30 tracked completed event logs and their batch summaries from the source checkout (10 model/access configurations). Diagnostic terminal logs, abandoned runs, and repair backups were excluded. Each run records its own harness commit where available. Public transcripts contain only commands, game responses, model commentary, and turn numbers. Public result rows identify the source file and preserve recorded model/provider labels. No prices are presented in the viewer.

Scores are peak scores, not final scores. The leaderboard averages completed runs with numeric scores, groups by provider and recorded model label, and keeps `+web` configurations separate. Trials normally share seed numbers and a 300-move budget; the viewer shows each run's recorded move count. Transcripts preserve retained event order, including any restarts. Regenerate summaries with the reporting tool when adding or repairing runs, then regenerate public data:

The viewer uses each trial's score sparkline as its selector. The main chart shows observed score over active elapsed time; pointing or dragging on the chart scrubs a single transcript display to the nearest command. Arrow keys step through commands, Page Up/Down jump ten commands, and Home/End jump to either end. Probe observations appear as dots; the step line carries the last observed value until the next probe and preserves score drops. Time gaps between interrupted attempts and their resume markers are excluded. Before the first probe, the score remains unknown. Mean/peak figures in the model rail are summaries, not the chart's instantaneous score.

```sh
npm run eval:report -- data/raw/<batch>
# From the monorepo root:
npm run data:zork
npm run build
```

The exporter can also read another directory of batch subdirectories via `node evals/zork-1/scripts/export-data.mjs /path/to/batches`. It replaces `data/public/` after parsing all inputs successfully. Commit both source data and public exports for reproducible publication.

The story (`zork1.z3`) and interpreter (`web.wasm`) are copied as supplied by the original project and are only used by the local eval runner. They are not included in the Pages build.
