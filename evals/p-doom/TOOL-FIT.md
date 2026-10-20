# ProbLog pilot: tool fit and first research run

Date: October 19, 2026. Scope: verify the calculation tool, then run one GPT-6 Luna research trial before starting a batch.

**Decision:** ProbLog works well as an auditable calculation backend for a small causal graph. The research pilot successfully used its feedback, but the resulting probability is not ready to treat as an established estimate. Evidence review and structural uncertainty are more important next steps than collecting more runs of the same prompt.

## Mechanical checks

ProbLog 2.2.10 passed five executable checks: shared prerequisites across overlapping routes, duplicate proofs, an impossible prerequisite, conditioning on an observed absence, and mutually exclusive timeline alternatives. The hypothetical shared-gate example gives 0.026; independent-path arithmetic incorrectly gives 0.028, while adding routes gives 0.030. These numbers only test inference.

The additional Python integration tests cover scenario bounds, input sensitivity, very small probabilities, boundary values, and rejection of code injection, cycles, undefined atoms, disconnected parameters and invalid probabilities. The Node tests cover the research protocol and failure handling without making model calls.

## One real research trial

The requested model was `gpt-6-luna`, medium reasoning. The first attempt using Homebrew's Codex CLI 0.152.0 was rejected by the backend as unsupported for the login. The app-bundled CLI 0.163.0-alpha.10.2 completed the requested model invocation. There was no fallback to a different model. The provider did not report a resolved model identifier, so provenance preserves the requested ID and leaves the resolved ID unknown.

The successful trial took about 145 seconds. It made two harness responses and nine completed web-tool calls (search/open/find actions), supplied nine sources, and built seven parameter switches and six deterministic rules. Its first `evaluate` response executed in ProbLog; its second response inspected feedback, revised source descriptions and a URL, and explicitly submitted. The submitted probability inputs and graph remained the same.

| Output | Pilot result |
| --- | --- |
| Target | AI substantially causes at least 90% human population loss completed by the end of 2050 |
| Central model implication | 0.3768% |
| All-low parameter scenario | 0.0024% |
| All-high parameter scenario | 8.3634% |
| Largest input sensitivity | Conditional loss-of-control switch |
| Structural uncertainty | Described qualitatively; not included in scenario bounds |
| Forecast accuracy / calibration | Unknown; no score assigned |

The model has a common capability/deployment prerequisite and three routes: biological misuse, loss of control, and military escalation. Each route includes a separate conditional assumption for reaching the 90% mortality threshold. The union reuses the same capability atom rather than multiplying independent copies. The remaining switch independence is a substantial simplifying assumption.

The enormous range comes from the supplied input assumptions, not from statistical evidence establishing a confidence interval. Important concerns include the common prerequisite's broad definition, the judgmental mapping from source observations to probabilities, correlated response failures, omitted pathways, and the residual time needed for an event to reach 90% mortality by the deadline.

Local records (ignored by Git and not copied to the gallery) are under `runs/2026-10-19T08-23-33-284Z-01a3138f/`. They include exact prompts, candidates, raw provider events, validation feedback, final JSON, and the executable `model.pl`. The failed old-CLI attempt is retained separately under `runs/2026-10-19T08-21-11-771Z-e6c6f47f/`.

## Partial source audit

This is a spot check, not a completed citation audit:

- The pilot correctly distinguishes the LEAP survey's more-than-10% mortality threshold and progress-conditional forecasts from this task's 90% threshold. The [original report](https://leap.forecastingresearch.org/reports/wave9) supports that distinction. Such surveys do not directly identify the pilot's individual probability inputs.
- The first candidate incorrectly described the nuclear-food study as not estimating deaths. The submitted candidate corrected this after further research, stating that the study projects more than five billion deaths under one scenario. This is a useful example of iteration improving source interpretation; it does not verify the rest of the evidence.
- The DeepMind source's recorded publication date is wrong: the pilot says March 28, 2024, but the [publication page](https://deepmind.google/research/publications/78150/) says March 21. The source's main dangerous-capability finding is consistent with the page.
- The screening source is summarized incompletely. The [paper's abstract](https://pubmed.ncbi.nlm.nih.gov/41037625/) says the authors developed and deployed patches that substantially improved detection. Describing this only as collaborative work to improve screening loses important counterevidence about mitigation.
- The agent corrected the SIPRI URL between candidates. The final [SIPRI page](https://www.sipri.org/publications/2025/sipri-insights-peace-and-security/impact-military-artificial-intelligence-nuclear-escalation-risk) supports qualitative escalation mechanisms, but does not establish the pilot's numerical escalation probability.

The run remains marked `pending human source audit`. A successful execution proves neither source entailment nor credible probability elicitation. The accepted submission is preserved as generated; these audit notes do not silently edit its evidence or numbers.

## How to use ProbLog here

Use ProbLog to expose conditional assumptions, reuse shared causes, compute the union of pathways, and identify which inputs dominate. Keep sourced observations separate from probability judgments, show the full program, and report scenario sensitivity alongside the central result.

Do not treat textual citations as a likelihood model or an `evidence(...)` statement. In ProbLog, evidence means conditioning a modeled random event on an observation; merely finding a paper is not that observation. The demo tests conditioning, while the initial research adapter intentionally uses a smaller positive-rule subset. See [ProbLog's semantics](https://problog.readthedocs.io/en/latest/modeling_basic.html).

Before scaling the experiment, strengthen source review and compare alternative graph structures. If the model needs mutually exclusive timelines, latent governance regimes, dependencies between uncertain input values, or dynamic feedback, expand the interface or compare against a Bayesian-network or simulation baseline. The present subset is a useful pilot, not a complete representation of AI catastrophe risk.

## v2 prompt, lint, and same-model review smoke test

The next increment focuses on prompt improvements, offline static lint and a bounded review loop by the same model. It does not add a separate reviewer or change the inference semantics. A GPT-6 Luna medium-effort run under `doom-research-v2` completed in two of the three allowed responses, in about 111 seconds. Both candidates passed static lint without errors or warnings and executed in ProbLog. The review referenced the evaluated candidate's exact SHA-256, covered all eight topics, recorded three concrete changes, and retained uncertainty about source fidelity, dependence and the mortality bridge rather than claiming an all-pass review.

The agent reported reopening decisive sources, clarifying a study's research-only model variant and recording that a source could not be reopened. These are the model's own review findings, not independent factual verification. Offline lint also accepted the saved evaluated and submitted candidates. Local records are under `runs/2026-10-19T08-45-07-823Z-d1e07f32/`. The default budget remains three total responses including invalid outputs, repairs and review; no draft is automatically promoted when that budget expires.
