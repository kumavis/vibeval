# Snow globe

A 3D interactive snow globe with a snow-capped peak. Compare the scene and how it feels to explore.

The exact shared prompt is in `prompt.txt`. This is a files eval with viewer judgment, no synthetic quality score. The agent can iterate and must explicitly submit. A validity failure is returned as feedback so it can revise within the remaining budget.

From the repo root:

```sh
npm run eval -- --eval snow-globe --models "codex-cli:MODEL@medium,claude-cli:MODEL@high" --trials 3
npm run data:publish -- --eval snow-globe --run evals/snow-globe/runs/RUN_ID
npm run build
```

The shipped September 8, 2026 batch uses three trials each of `gpt-5.6-luna`, `gpt-5.6-terra`, and `claude-haiku-4-5-20251001`, plus one trial each of `gpt-5.6-sol` and `claude-opus-5`, all with medium effort. Run records retain the CLI versions, usage, cost basis, and submission outcomes. Failed or exhausted trials remain in the dataset. See the [format contract](../../docs/eval-formats.md) for actions, limits, recorded metadata, pricing, and publication.
