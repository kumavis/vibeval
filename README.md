# Vibeval

A monorepo of model evaluations. Each eval owns its runner, prompts, results, and static viewer. The gallery discovers eval manifests at build time and links to their viewers. Zork I measures game performance; the ASCII sunken ship and interactive snow globe evals let viewers judge creative submissions.

The [common eval formats](docs/eval-formats.md) separate text/files/environment outputs from numeric/viewer judgment. Creative runs support revision and explicit final submission, with provenance, usage, timing, cost estimates, and iteration history.

```text
apps/gallery/                Static gallery shell
packages/runner/             Claude/Codex sessions, API adapters, model specs
packages/viewer/             Shared styling and sandboxed artifact viewer
evals/zork-1/                Zork runner, prompt, interpreter, tests, and results
  eval.json                 Gallery metadata
  data/raw/                 Shipped source runs and summaries (not in Pages output)
  data/public/              Explicit browser-facing results and transcripts
  viewer/                   Eval-owned static entry point
templates/static-artifacts/  Starting point for creative coding comparisons
scripts/                    Static build and local preview
```

Requires Node 22+ and npm. The website has no runtime dependencies, model credentials, backend, or browser-side model calls.

```sh
npm ci
npm test
npm run dev                 # http://127.0.0.1:4173; builds once before serving
npm run build               # outputs dist/; rebuild after source/data changes
```

Run a creative eval with pinned settings:

```sh
npm run eval -- --eval ascii-sunken-ship --provider codex-cli --model YOUR_MODEL --effort medium
npm run eval -- --eval snow-globe --provider claude-cli --model YOUR_MODEL --effort high
```

Each run stays local until `npm run data:publish -- --eval <id> --run <run-directory>`. See the [format contract](docs/eval-formats.md) for model matrices, trials, numeric scorers, publication, and limits.

## Run Zork

Use installed and authenticated Claude/Codex CLIs, or configure API credentials in your shell. `.env` files are not loaded automatically. See [Zork setup](evals/zork-1/README.md) and the copied [runner reference](evals/zork-1/RUNNER.md).

```sh
npm run eval:zork -- --models claude-cli:YOUR_CLAUDE_MODEL,codex-cli:YOUR_CODEX_MODEL@medium --trials 3 --moves 300 --name comparison
```

New run logs stay under `evals/zork-1/logs/` and are ignored. To ship a batch, review and copy its `summary.json` and completed `run-*.jsonl` files to `evals/zork-1/data/raw/<batch>/`, then run `npm run data:zork`. Public data is committed, so viewing and building do not require replaying evals. The initial dataset contains 30 historical runs; model names reflect those logs.

## Add an eval

Create `evals/<id>/eval.json` with `id`, `title`, `description`, and `kind` (`interactive` or `static-artifacts`), plus optional `tags` and `metric`. IDs must match the directory and use lowercase letters, digits, and hyphens. Add `viewer/index.html` and `data/public/`. The build automatically registers the eval—no gallery code changes needed. Use a `package.json` if the eval has its own dependencies or scripts; npm workspaces discovers it.

Only `viewer/`, `data/public/`, and the eval manifest are copied to Pages. Viewers see data at `./data/` and shared assets at `../../shared/`. Use relative URLs throughout, including inside generated artifacts, so project Pages paths such as `/vibeval/` work. Public asset trees must contain no hidden files or symlinks.

For a same-prompt artifact comparison:

```sh
cp -R templates/static-artifacts evals/my-eval
```

Change the manifest ID/title, then edit `data/public/artifacts.json`:

```json
{
  "schemaVersion": 1,
  "prompt": "The exact prompt given to each model",
  "runs": [
    { "model": "model-a", "label": "trial 1", "entry": "model-a/index.html" },
    { "model": "model-b", "label": "trial 1", "entry": "model-b/index.html" }
  ]
}
```

Put the outputs under `data/public/model-a/index.html`, etc. The reusable viewer presents the shared prompt and side-by-side sandboxed previews. Prefer self-contained HTML; sandboxed frames have opaque origins, so browser storage and some module-loading patterns are unavailable. The sandbox isolates the gallery but does not prevent outbound network requests. Keep artifacts self-contained for reproducibility. The [runner package](packages/runner/README.md) includes a `generatePage` helper for Claude/Codex raw-text generation. No fictional outputs are included in the template.

## GitHub Pages

The repository is [kumavis/vibeval](https://github.com/kumavis/vibeval), with `main` as its publishing branch. GitHub Pages uses **GitHub Actions** as its source. The included workflow installs from the lockfile, runs all tests, builds the gallery, and deploys `dist/` on pushes to `main` or manual dispatch. Pull requests test/build without deploying.

The Pages artifact contains only public viewer assets; the repository itself includes the shipped raw eval data.

## Provenance

Zork runner, fixtures, interpreter/story assets, and historical data were copied from the local `llm-plays-zork` checkout, whose HEAD was `f4a239cc38cb47d7646e5be5ae044a9d4d7c3f13`. The original checkout was left untouched. See [Zork data notes](evals/zork-1/README.md) for the source and score semantics. The original package declares MIT for code; the bundled game/interpreter assets retain their original ownership and are not relicensed here.
