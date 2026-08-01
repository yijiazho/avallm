# Playtest issue ledger

This is the durable triage record for human and automated AvaLLM playtests. Active work focuses on probabilistic+LLM agents. Raw LLM-only observations are parked while that lane is frozen.

## Active priorities

| ID | Priority | Status | Scope | Signature | Occurrences | Games | Last seen | Summary |
| -- | -------- | ------ | ----- | --------- | ----------- | ----- | --------- | ------- |
| PLT-002 | P1 | open | probabilistic-llm | PLAN_VOTE_CONTRADICTION | 6 | 2 | 2026-08-01 | Three probabilistic+LLM seats reversed a committed team objective at the vote. |
| PLT-004 | P2 | investigating | instrumentation | COMPOSED_DEGRADATION_SUMMARY_GAP | 56 | 2 | 2026-08-01 | Hybrid planner/voice degradation is present in decision traces but absent from top-level degradation summaries. |
| PLT-003 | P2 | investigating | probabilistic-llm | MERLIN_PERFECT_TRUTH_VOTING | 1 | 1 | 2026-08-01 | Martin's five ballots perfectly tracked hidden team truth before he was assassinated. |

## Instrumentation fixes

| ID | Priority | Status | Scope | Signature | Occurrences | Games | Last seen | Summary |
| -- | -------- | ------ | ----- | --------- | ----------- | ----- | --------- | ------- |
| PLT-001 | P1 | fixed | instrumentation | IDENTITY_DESCRIPTOR_LOSS | 2 | 1 | 2026-08-01 | Web artifacts persisted only model slugs, making raw and probabilistic+LLM seats indistinguishable. |

## PLT-001: Agent definition lost in web telemetry

- State: fixed in code; validation still requires a newly played web artifact.
- First/last seen: 2026-08-01.
- Game: `game-web-ddb0fde1d6`; Beatrix #2 and Martin #3.
- Evidence: Beatrix has 20 and Martin has 17 admitted composed decision traces, while both persisted `agent` fields contain only their OpenRouter model slug. The copied transcript consequently labeled Martin as raw Kimi.
- Expected: one game-start identity must feed runtime construction, client metadata, reveal, transcript, and artifact. Martin should render `Probabilistic + LLM` with execution descriptor `def:probabilistic-llm:llm:kimi`.
- Boundary: web session agent identity and artifact serialization.
- Regression: descriptor unit coverage, artifact model-manifest coverage, transcript rendering coverage, and focused HTTP transcript tests.
- Fix: store one per-seat definition snapshot, model override, public info, and exact descriptor; construct the runtime agent and every diagnostic projection from it.
- Headless check: `game-mixed-five-repro-ddb0fde1d6-20260801-0` and `game-mixed-five-repro-ddb0fde1d6-20260801-1` persisted all four hybrid seats as `def:probabilistic-llm:llm:<model>` while the raw controls remained `llm:<model>`, and the auditor reported no new identity-provenance hits. This confirms the current descriptor vocabulary but does not exercise the web session serialization boundary, so it does not close validation.

## PLT-002: Support plan reverses at the vote

- State: open; highest active gameplay priority.
- First/last seen: 2026-08-01.
- Games and seats: `game-web-ddb0fde1d6` Beatrix #2; `game-mixed-five-repro-ddb0fde1d6-20260801-0` Edith #0 and Cecily #1.
- Evidence: the original hit remains Beatrix's `SUPPORT_TEAM` at seq 139 followed by `reject` at seq 148 on Q3.2. The clean reproduction adds five hits: Edith `SUPPORT_TEAM` seq 21 then `reject` seq 29 on Q1.1; Cecily `SUPPORT_TEAM` seq 22 then `reject` seq 29 on Q1.1; Edith `SUPPORT_TEAM` seq 84 then `reject` seq 86 on Q2.1; Cecily `SUPPORT_TEAM` seq 78 then `reject` seq 86 on Q2.1; and Edith `OPPOSE_TEAM` seq 114 then `approve` seq 117 on Q3.1. No proposal changed between each cited discussion trace and ballot.
- Expected: absent new public evidence, a committed support plan should approve the same proposal, or coherence should explicitly classify and explain the reversal.
- Suspected boundary: vote scoring versus private plan memory/coherence admission.
- Next test: replay the six cited vote states through the API-free probabilistic decision layer, first as recorded and then with plan-memory coherence disabled, and compare candidate score features, relevant-team posterior, and commitment basis. This distinguishes a scoring override from a failed commitment join without another model call.

## PLT-003: Merlin perfectly tracks truth and is assassinated

- State: investigating; the detector is a review signal, not proof by itself.
- First/last seen: 2026-08-01.
- Game: `game-web-ddb0fde1d6`; Martin #3, Merlin.
- Evidence: Martin's approve/reject choice matches whether the proposed team is actually evil-free on all five proposals. Evil then correctly assassinates Martin after the third successful quest.
- Expected: Merlin should preserve good win probability while avoiding a uniquely truth-revealing ballot pattern when strategically tolerable.
- Suspected boundary: Merlin role utility and exposure adjustment across vote decisions.
- Next test: inspect Martin's candidate score deltas on all five votes, then run a paired API-free bank over equivalent Merlin states to see whether exposure adjustment can ever change the top action.
- New-run note: neither new artifact supplied a probabilistic+LLM Merlin sample. The clean game's Merlin was the rule-based human surrogate, and the cap-degraded game's Merlin was the raw Kimi control, so recurrence remains one qualifying game.

## PLT-004: Hybrid degradation is missing from summary telemetry

- State: investigating; confirmed summary/trace mismatch, with semantics and desired roll-up still to decide.
- First/last seen: 2026-08-01.
- Games and seats: `game-mixed-five-repro-ddb0fde1d6-20260801-0` Edith #0 and Cecily #1; `game-mixed-five-repro-ddb0fde1d6-20260801-1` Winifred #0 and Bertram #3.
- Evidence: the clean artifact has 12 hybrid decision traces with non-empty `degradation` (one `planner-no-choice`, 11 `voice-no-output`) while top-level `degraded` is empty. The cap-degraded artifact has 44 hybrid traces with degradation (42 `planner-failed`, three `voice-failed`, two `voice-no-output`; some traces carry two codes), while its 45 top-level degradation rows all belong to the raw Kimi/DeepSeek controls and none to the hybrid seats. The rendered transcript and simulator total therefore omit every hybrid planner/voice degradation even though the decision traces preserve it.
- Expected: summaries must distinguish action fallback from planner/voice degradation, but must count and label both so a zero or raw-only top-level total cannot be read as a clean hybrid run.
- Suspected boundary: `RunResult.degraded` and transcript/simulator summaries roll up runner fallbacks but do not project composed trace degradation.
- Next test: use an API-free fake bounded-LLM client that returns blank output and throws for planner/voice calls, run one composed decision through artifact and transcript rendering, and assert the trace-level and summary-level categories separately. This determines the narrowest telemetry contract without paying for another game.
- Regression: not added; no fix requested yet.

## Parked raw LLM observations

- Sabine and Nerys in `game-web-ddb0fde1d6` remain classified as raw LLM by their thinking events and lack of composed traces.
- The new clean controls were Ansel #2 (raw DeepSeek, Percival) and Mabel #3 (raw Kimi, Servant). Their full reasoning and behavior are preserved, but the audit found no raw-only root cause worth promoting.
- The second game's raw controls, Heloise #1 (Kimi, Merlin) and Adela #2 (DeepSeek, Assassin), incurred all 45 top-level fallbacks after the experiment spend ceiling. Their post-ceiling behavior is parked as budget-induced and is not treated as evidence about raw model quality.

## Audit runs

### 2026-08-01: game-web-ddb0fde1d6

- Source: `data/transcripts/artifacts.jsonl` plus the copied debug transcript.
- Deterministic result: four findings across three signatures: two identity-provenance hits, one support/vote contradiction, and one Merlin exposure review signal.
- Execution classification: Sabine raw DeepSeek; Nerys raw Kimi; Beatrix probabilistic+LLM DeepSeek; Martin probabilistic+LLM Kimi; Human human.

### 2026-08-01: mixed five-player human-surrogate reproduction

- Source: the 57-artifact existing corpus copied into `data/transcripts/artifacts.jsonl`, plus two newly appended artifacts and their full-reveal transcripts under `data/transcripts/mixed-five-ddb0fde1d6-20260801/`.
- Configuration: one rule-based human surrogate, raw DeepSeek, raw Kimi, probabilistic+LLM DeepSeek, and probabilistic+LLM Kimi; five-player rules and `2,1` discussion rounds matching `game-web-ddb0fde1d6`. Seat types were shuffled from each game seed. The surrogate happened to land in seat #4 in both completed games, while the four control/treatment placements changed.
- Limits: two of at most eight games completed. Spend reached $0.244270, below the authorized $0.25, and no third game started. Every artifact is tagged `human-surrogate`; these are not exact reproductions of human play.
- Clean game: `game-mixed-five-repro-ddb0fde1d6-20260801-0`, $0.216497, 37 composed traces, zero runner-level fallbacks, five `PLAN_VOTE_CONTRADICTION` hits, and 12 trace-level planner/voice degradations. Both hybrid seats were evil; Morgana played Success on Q2 and Fail on Q3, the Assassin correctly targeted the rule-based Merlin, and evil won. No forced-play or confirmed role-objective failure was found.
- Cap-degraded game: `game-mixed-five-repro-ddb0fde1d6-20260801-1`, $0.027773 incremental, 52 composed traces, 45 raw-seat runner fallbacks after the spend ceiling, and 44 hybrid traces with planner/voice degradation. Its strategic outcomes are excluded from clean recurrence claims.
- Full-corpus deterministic result over 59 artifacts: six `PLAN_VOTE_CONTRADICTION` hits in two games, two historical `IDENTITY_DESCRIPTOR_LOSS` hits in one game, and one `MERLIN_PERFECT_TRUTH_VOTING` review signal in one game. The new headless descriptors are correct but do not validate the fixed web boundary in PLT-001. No legality, hidden-information, forced-play, or new confirmed role-objective failure was detected.
