---
name: avalon-playtest-debugging
description: Audit AvaLLM debug transcripts and JSONL game artifacts, distinguish raw LLM seats from probabilistic+LLM seats, detect reproducible play and telemetry failures, and maintain the prioritized playtest issue ledger. Use when reviewing a copied Avalon transcript, investigating a game id or seed, automating artifact-based playtesting, comparing repeated failures across games, or deciding which probabilistic+LLM issue to fix next.
---

# Avalon Playtest Debugging

Turn a transcript or artifact into evidence-backed, deduplicated issues. Prefer persisted execution traces over labels or behavioral inference, and keep raw LLM findings separate while that lane is frozen.

## Workflow

1. Establish the source. Extract the game id from a copied transcript and locate the matching record in `data/transcripts/artifacts.jsonl`. If no artifact exists, mark claims based only on prose or behavior as hypotheses.
2. Run the deterministic audit from the repository root:

   ```powershell
   node .codex/skills/avalon-playtest-debugging/scripts/audit-artifact.mjs --game GAME_ID
   ```

   Use `--transcript PATH` to extract the id, `--all` to aggregate the corpus, `--json` for machine-readable output, and `--artifacts PATH` for another corpus.
3. Classify each seat before judging behavior.
   - `def:probabilistic-llm:llm:<model>` is probabilistic+LLM.
   - Composed decision traces conclusively identify historical probabilistic+LLM execution even if an old descriptor is lossy.
   - `llm:<model>` plus thinking events and no composed traces is raw LLM.
   - A model slug alone is legacy and ambiguous until traces resolve it.
4. Investigate probabilistic+LLM findings in this order: legality or hidden-information failures; action/plan contradictions and degradation; role-objective failures; then speech quality.
5. Do not spend money automatically. Audit artifacts and run API-free tests without asking. Obtain explicit authorization before invoking real LLM seats.
6. Update `docs/playtest-issue-ledger.md` using [references/ledger-schema.md](references/ledger-schema.md). Deduplicate by root cause, increment occurrences and games, attach exact evidence, and park raw LLM-only findings while that lane is frozen.
7. When fixing an issue, add the narrowest deterministic regression test, run the focused test and `npm run verify:quick`, then record validation in the ledger.

## Evidence Standard

Use this order of authority:

1. Applied engine events and admitted decision traces.
2. Persisted game-start agent descriptor and resolved architecture metadata.
3. Transcript seat labels and rendered play-by-play.
4. Behavioral inference from prose.

Never upgrade lower-level inference over contradictory higher-level evidence. State confidence as `confirmed`, `strong`, or `hypothesis`.

## Automation Boundaries

The auditor reports deterministic signatures `IDENTITY_DESCRIPTOR_LOSS`, `PLAN_VOTE_CONTRADICTION`, and `MERLIN_PERFECT_TRUTH_VOTING`. The last is a review signal, not proof of a bug. Read the traces and assassination outcome before proposing a fix. Add detectors only when their inputs and false-positive policy can be unit tested.

## Deliverable

Conclude with the seat execution classification, new versus recurring issues, the top active priority, ledger changes, and the next cheapest discriminating test.
