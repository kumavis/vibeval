# Rock, paper, scissors

A distribution eval, not a game or a correctness score. Each sample asks the exact prompt in `prompt.txt`, in a fresh CLI conversation, and records the first response. There is no draft/submit protocol, output schema, retry, corrective feedback, or second model request. Medium thinking effort is pinned; temperature and seed use provider defaults and are not controlled. The Codex CLI still supplies its built-in system instructions; Claude CLI accepts the harness system prompt directly. Provider differences and the meaning of effort settings can therefore affect comparisons.

The initial batch contains 12 attempts each for Terra and Luna; a follow-up adds 12 each for Sol and Haiku (claude-haiku-4-5-20251001). Option order stays rock, paper, scissors. This measures behavior for that wording and order; it does not establish an order-invariant preference or expose token-level probabilities. Larger samples and balanced option-order permutations would be separate experiments.

Classification ignores outer whitespace and letter case. Everything else must match a declared choice exactly. Explanations, errors, and missing answers remain invalid attempts; they are not silently repaired, discarded, or retried. Frequencies use all attempts as their denominator. Each choice has a marginal 95% Wilson interval to show small-sample uncertainty.

```sh
npm run eval -- --eval rock-paper-scissors --provider codex-cli --model gpt-5.6-terra --effort medium --trials 12
npm run eval -- --eval rock-paper-scissors --provider codex-cli --model gpt-5.6-luna --effort medium --trials 12
```

Publish every attempt with the common data publisher and build the site. Exact responses, model/effort settings, timings, provenance, reported usage, and price estimates are retained with each run.
