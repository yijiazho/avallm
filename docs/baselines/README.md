# Agent architecture baselines

These compact records anchor Phase 0 of
[`agent-architecture-migration.md`](../agent-architecture-migration.md).

## `phase0-heuristic-standard-v1.json`

This is the reproducible, API-free result of `heuristic-v1` on every case in the fixed
`standard-v1` architecture bank. Discussion is disabled by the bank contract.

Regenerate it with:

```text
npm run architecture-baselines -- heuristic
```

The test suite independently rebuilds the ten games and requires an exact match with the committed
report.

## `phase0-prompt-guided-observed.json`

This preserves the prompt-guided evidence that already existed when Phase 0 began: three paid
seven-player playtests from 2026-07-24. The recorder read their artifacts and transcript spend
summaries; it made no LLM calls. Source hashes are included because the large raw playtest files
are local evaluation inputs rather than committed repository fixtures.

The record groups decisions and degradation by role, decision kind, and model. The archived
transcripts retained exact calls and cost per model, but not per call tag, so kind-level call and
cost fields are `null` instead of estimated. It is an observational architecture baseline, not a
paired promotion result: it used 7-player tables with discussion enabled and does not share the
fixed bank's configurations.

Future prompt-guided or hybrid results should be captured with:

```text
npm run architecture-bench -- --baseline autopilot --candidate <agent-id> --allow-paid
npm run architecture-report -- data/eval/architecture-standard-v1.jsonl
```

`--allow-paid` is intentionally required. Do not run that lane without explicit approval.
