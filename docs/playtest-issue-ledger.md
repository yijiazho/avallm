# Playtest issue ledger

This is the durable triage record for human and automated AvaLLM playtests. Active work focuses on probabilistic+LLM agents. Raw LLM-only observations are parked while that lane is frozen.

## Active priorities

| ID | Priority | Status | Scope | Signature | Occurrences | Games | Last seen | Summary |
| -- | -------- | ------ | ----- | --------- | ----------- | ----- | --------- | ------- |
| PLT-002 | P1 | open | probabilistic-llm | PLAN_VOTE_CONTRADICTION | 1 | 1 | 2026-08-01 | Beatrix supported Q3.2, then the policy voted reject. |
| PLT-003 | P2 | investigating | probabilistic-llm | MERLIN_PERFECT_TRUTH_VOTING | 1 | 1 | 2026-08-01 | Martin's five ballots perfectly tracked hidden team truth before he was assassinated. |

## Instrumentation fixes

| ID | Priority | Status | Scope | Signature | Occurrences | Games | Last seen | Summary |
| -- | -------- | ------ | ----- | --------- | ----------- | ----- | --------- | ------- |
| PLT-001 | P1 | fixed | instrumentation | IDENTITY_DESCRIPTOR_LOSS | 2 | 1 | 2026-08-01 | Web artifacts persisted only model slugs, making raw and probabilistic+LLM seats indistinguishable. |

## PLT-001: Agent definition lost in web telemetry

- State: fixed in code; validation pending a newly played web artifact.
- First/last seen: 2026-08-01.
- Game: `game-web-ddb0fde1d6`; Beatrix #2 and Martin #3.
- Evidence: Beatrix has 20 and Martin has 17 admitted composed decision traces, while both persisted `agent` fields contain only their OpenRouter model slug. The copied transcript consequently labeled Martin as raw Kimi.
- Expected: one game-start identity must feed runtime construction, client metadata, reveal, transcript, and artifact. Martin should render `Probabilistic + LLM` with execution descriptor `def:probabilistic-llm:llm:kimi`.
- Boundary: web session agent identity and artifact serialization.
- Regression: descriptor unit coverage, artifact model-manifest coverage, transcript rendering coverage, and focused HTTP transcript tests.
- Fix: store one per-seat definition snapshot, model override, public info, and exact descriptor; construct the runtime agent and every diagnostic projection from it.

## PLT-002: Support plan reverses at the vote

- State: open; highest active gameplay priority.
- First/last seen: 2026-08-01.
- Game: `game-web-ddb0fde1d6`; Beatrix #2, Percival, Q3.2.
- Evidence: at trace seq 139 the applied discussion plan objective is `SUPPORT_TEAM` for [Nerys, Beatrix], with speech saying it is the team she wants. At trace seq 148 the applied vote is `reject` and the objective becomes `OPPOSE_TEAM` without an intervening team change.
- Expected: absent new public evidence, a committed support plan should approve the same proposal, or coherence should explicitly classify and explain the reversal.
- Suspected boundary: vote scoring versus private plan memory/coherence admission.
- Next test: replay the Q3.2 state through the probabilistic decision layer and compare score features, relevant-team posterior, and coherence commitment basis.

## PLT-003: Merlin perfectly tracks truth and is assassinated

- State: investigating; the detector is a review signal, not proof by itself.
- First/last seen: 2026-08-01.
- Game: `game-web-ddb0fde1d6`; Martin #3, Merlin.
- Evidence: Martin's approve/reject choice matches whether the proposed team is actually evil-free on all five proposals. Evil then correctly assassinates Martin after the third successful quest.
- Expected: Merlin should preserve good win probability while avoiding a uniquely truth-revealing ballot pattern when strategically tolerable.
- Suspected boundary: Merlin role utility and exposure adjustment across vote decisions.
- Next test: inspect Martin's candidate score deltas on all five votes, then run a paired API-free bank over equivalent Merlin states to see whether exposure adjustment can ever change the top action.

## Parked raw LLM observations

None recorded yet. Sabine and Nerys in `game-web-ddb0fde1d6` are classified as raw LLM by their thinking events and lack of composed traces; their play is outside the current improvement scope.

## Audit runs

### 2026-08-01: game-web-ddb0fde1d6

- Source: `data/transcripts/artifacts.jsonl` plus the copied debug transcript.
- Deterministic result: four findings across three signatures: two identity-provenance hits, one support/vote contradiction, and one Merlin exposure review signal.
- Execution classification: Sabine raw DeepSeek; Nerys raw Kimi; Beatrix probabilistic+LLM DeepSeek; Martin probabilistic+LLM Kimi; Human human.
