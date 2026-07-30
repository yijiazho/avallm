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
npm run architecture-bench -- --baseline autopilot --candidate <agent-id> --allow-paid --out data/eval/<run-id>.jsonl
npm run architecture-report -- data/eval/<run-id>.jsonl
```

`--allow-paid` is intentionally required. Do not run that lane without explicit approval.
Use a fresh output path for every run. The benchmark refuses a non-empty output file before
starting so a rerun cannot spend money and then leave duplicate bank cells that the report rejects.

## Phase 7 role-policy evidence

The three `phase7-*-standard-v1` files are the API-free Phase 7 exit evidence:

- `phase7-role-evidence-standard-v1.jsonl` is the raw 50-cell corpus: ten fixed
  `standard-v1` cases by five logical arms. It preserves each isolated scorer's truthful raw
  variant ID, descriptor, and resolved architecture identity.
- `phase7-virtual-assassin-standard-v1.jsonl` contains twelve pretruth predictions from every evil
  seat in four frozen histories. Each prediction is hashed before the true Merlin seat is joined.
- `phase7-role-report-standard-v1.json` is the deterministic aggregate and six-row causal-authority
  audit. It records outcomes descriptively and contains no timestamps or raw latency.

Regenerate all three without provider calls:

```text
npm run role-report -- --generate
```

Check supplied raw evidence against the committed aggregate without replaying the bank:

```text
npm run role-report -- docs/baselines/phase7-role-evidence-standard-v1.jsonl docs/baselines/phase7-virtual-assassin-standard-v1.jsonl --check docs/baselines/phase7-role-report-standard-v1.json
```

The twelve virtual guesses are correlated observations from four histories, not twelve independent
games, so their 2/12 descriptive accuracy has no promotion threshold. Likewise, the ten-case role
bank proves deterministic architecture, attribution, isolation, and safety; its win counts are too
small and too mechanically narrow to justify a production-default change.
