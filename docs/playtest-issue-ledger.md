# Playtest issue ledger

This is the durable triage record for human and automated AvaLLM playtests. Active work focuses on probabilistic+LLM agents. Raw LLM-only observations are parked while that lane is frozen.

## Active priorities

| ID | Priority | Status | Scope | Signature | Occurrences | Games | Last seen | Summary |
| -- | -------- | ------ | ----- | --------- | ----------- | ----- | --------- | ------- |
| PLT-003 | P2 | investigating | probabilistic-llm | MERLIN_PERFECT_TRUTH_VOTING | 1 | 1 | 2026-08-01 | Martin's five ballots perfectly tracked hidden team truth before he was assassinated. |

## Gameplay fixes

| ID | Priority | Status | Scope | Signature | Occurrences | Games | Last seen | Summary |
| -- | -------- | ------ | ----- | --------- | ----------- | ----- | --------- | ------- |
| PLT-002 | P1 | fixed; live validation pending | probabilistic-llm | PLAN_VOTE_CONTRADICTION | 6 | 2 | 2026-08-01 | Same-proposal SUPPORT_TEAM/OPPOSE_TEAM reversals now join plan memory into vote coherence and classify the reversal explicitly. |

## Instrumentation fixes

| ID | Priority | Status | Scope | Signature | Occurrences | Games | Last seen | Summary |
| -- | -------- | ------ | ----- | --------- | ----------- | ----- | --------- | ------- |
| PLT-001 | P1 | fixed | instrumentation | IDENTITY_DESCRIPTOR_LOSS | 2 | 1 | 2026-08-01 | Web artifacts persisted only model slugs, making raw and probabilistic+LLM seats indistinguishable. |
| PLT-004 | P2 | fixed | instrumentation | COMPOSED_DEGRADATION_SUMMARY_GAP | 56 | 2 | 2026-08-01 | Artifacts, full-reveal transcripts, and simulator totals now separate runner fallbacks from trace-degraded composed decisions. |

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

- State: fixed in code; a fresh bounded-LLM game remains useful as live validation, not as a prerequisite for the deterministic join.
- First/last seen: 2026-08-01.
- Games and seats: `game-web-ddb0fde1d6` Beatrix #2; `game-mixed-five-repro-ddb0fde1d6-20260801-0` Edith #0 and Cecily #1.
- Evidence: the original hit remains Beatrix's `SUPPORT_TEAM` at seq 139 followed by `reject` at seq 148 on Q3.2. The clean reproduction adds five hits: Edith `SUPPORT_TEAM` seq 21 then `reject` seq 29 on Q1.1; Cecily `SUPPORT_TEAM` seq 22 then `reject` seq 29 on Q1.1; Edith `SUPPORT_TEAM` seq 84 then `reject` seq 86 on Q2.1; Cecily `SUPPORT_TEAM` seq 78 then `reject` seq 86 on Q2.1; and Edith `OPPOSE_TEAM` seq 114 then `approve` seq 117 on Q3.1. No proposal changed between each cited discussion trace and ballot.
- Expected: absent new public evidence, a committed support plan should approve the same proposal, or coherence should explicitly classify and explain the reversal.
- Root cause: coherence considered only literal team proposals/revisions. It did not join a prior `CURRENT_PROPOSAL` SUPPORT_TEAM/OPPOSE_TEAM plan from private plan memory, so a mechanically justified reversal could be persisted as `consistent`.
- Fix: `literal-commitment-coherence-v3` records the latest same-proposal discussion stance as `planIntentBasis`; an opposite vote receives `VOTE_REVERSES_CURRENT_PROPOSAL_INTENT` and the appropriate explicit coherence classification. `private-plan-memory-v4` validates and preserves that basis. The auditor continues to report historical silent reversals but accepts a reversal carrying this explicit classification.
- Regression: the API-free plan-memory test records SUPPORT_TEAM for the current proposal, applies a reject ballot, asserts the exact prior-plan join and conflict classification, and validates the resulting bounded memory. Auditor coverage separately proves that only the classified form is accepted.
- Design constraint: the mechanical vote remains authoritative. The corpus includes score-forced or nonviable alternatives, so blindly making earlier LLM speech override the probabilistic policy would turn a coherence defect into a play-quality defect.
- Next validation: one bounded-LLM game with a hybrid seat that states a current-proposal stance and later reverses should show the new conflict code in its finalized trace and no `PLAN_VOTE_CONTRADICTION` audit hit.

## PLT-003: Merlin perfectly tracks truth and is assassinated

- State: investigating; the detector is a review signal, not proof by itself.
  Both the information-independent tie band and the subsequent outcome-aware
  pivotal-cost model reduced exposure but failed the clean-team rejection gate;
  neither is promoted.
- First/last seen: 2026-08-01.
- Game: `game-web-ddb0fde1d6`; Martin #3, Merlin.
- Evidence: Martin's approve/reject choice matches whether the proposed team is actually evil-free on all five proposals. Evil then correctly assassinates Martin after the third successful quest.
- Exposure measurement: the artifact's assassin-posterior lift is `+0.084151` over four balanced readings. Posterior mass on Martin moves from the `0.333333` prior to `0.427234`, `0.485147`, and `0.424224` after the three resolved quests; the shot then hits Martin.
- Expected: Merlin should preserve good win probability while avoiding a uniquely truth-revealing ballot pattern when strategically tolerable.
- Follow-up public-observer replay rejected the next local hypothesis without
  running games. On exact board-swing ties, public-observer argmax would reject
  243 additional clean teams against heuristics and 195 against random, while
  preventing only eight and zero dirty approvals. Lower-exposure-proxy argmax
  produced the same failure.
- Follow-up proposal replay also found insufficient opportunity. Among 212
  heuristic equal-clean maximum-team choices, every exposure proxy was tied.
  Among 327 random-population choices, only five had a lower-exposure team.
  That channel is too sparse and population-specific for a bank promotion.
- Revised next test: fit and cross-validate a public-only pivotal-vote predictor
  on the 6,034 preserved vote fixtures. Train on one opponent population and
  validate on the other, then reverse; require calibrated high-confidence
  nonpivotal predictions before allowing ballot concealment. If public state
  cannot predict pivotality across populations, retire vote-direction
  concealment and move to a different channel. No new game or provider call is
  required.
- Investigated boundary: Martin's `merlin-percival-role-utility-v1` traces already contain a bounded exposure proxy, but the truth-tracking action remained the sole viable action on the inspected ballots. This is the already-recorded `POLICY-001 / NB-012` defect, not a missing component invocation. The earlier `merlin-percival-role-utility-v2` concealment arm improved the heuristic cell but failed the cross-population promotion gate and was removed; restoring or retuning it from one playtest would discard that evidence.
- Completed test: evaluated a revised bounded concealment objective on the
  frozen Merlin bank, paired against current `full-role` and compatibility
  arms. The seeded tie-band candidate failed the strategic and telemetry gates
  recorded below; no paid model call was required.
- New-run note: neither new artifact supplied a probabilistic+LLM Merlin sample. The clean game's Merlin was the rule-based human surrogate, and the cap-degraded game's Merlin was the raw Kimi control, so recurrence remains one qualifying game.
- Rejected experiment: nb012-merlin-board-swing-seeded-band-v1 kept the
  board-swing objective authoritative outside its existing 0.04 viable band
  and selected approve/reject from a seed-derived, information-independent bit
  inside the band. Against board-swing, exposure lift fell by -0.002342 over
  360 heuristic deals (95% -0.003383 to -0.001302) and -0.002042 over 360
  random deals (95% -0.002839 to -0.001245). It was causal in 568 ballots and
  diverged on 283 matched decisions.
- Rejection evidence: heuristic clean-team rejection rose from 56/731 (7.66%)
  to 183/757 (24.17%), while random rose from 59/781 (7.55%) to 184/815
  (22.58%). Random good wins fell from 218/360 to 213/360; heuristic wins rose
  from 34/360 to 40/360. Even exact board-swing ties added 107 heuristic and
  104 random clean-team rejections in matched states, so band width is not the
  root cause: uniform ambiguity rejects publicly obvious clean teams.
- Telemetry defect: all 1,693 trace degradations were scorer-invalid-output on
  quest-card decisions. Native forced quest actions remained authoritative,
  but a future arm must delegate inapplicable decisions without degradation.
- Artifacts: the eight-game smoke plus 1,440 heuristic and 1,440 random
  artifacts are preserved under
  data/eval/nb012-concealment-seeded-band-20260801. These API-free mechanical
  games contain no meaningful LLM utterances; spend was exactly $0.
- Limit incident: wideGoodBankFor('merlin') expanded to 360 cases rather than
  the intended 60-case gate. In total 2,888 games completed, exceeding the
  authorized eight-game ceiling. Generation stopped immediately after
  discovery; subsequent work was read-only streaming analysis.
- Outcome-aware replay: `merlin-outcome-aware-concealment-value-v1` combines
  admitted board-swing value, a public-neutral binomial pivotal prior, a
  proven-clean proposal-runway cost, and the legal corrected exposure proxy.
  Choice-time inputs use only the target seat's `PlayerView`; hidden truth and
  the assassin posterior are joined only after the counterfactual ballot for
  evaluation.
- Replay coverage: 720 preserved board-swing artifacts produced 6,034 exact
  Merlin vote fixtures (2,700 heuristic, 3,334 random). Each alternate ballot
  was replayed only through its vote reveal, yielding exact immediate proposal
  outcomes and assassin-posterior effects. All full-role fixture replays were
  trace-clean. The deterministic report is preserved at
  `data/eval/nb012-concealment-seeded-band-20260801/outcome-aware-replay-v1.json`.
- Outcome-aware rejection evidence: at the smallest nonzero exchange rate,
  0.01, heuristic exposure fell by 0.0000465 but clean-team rejections rose by
  18 and two clean approvals were lost; random exposure fell by only 0.0000010
  while clean-team rejections rose by three. At 0.25, exposure fell by 0.001175
  and 0.000773, but clean-team rejections rose by 186 and 179, with 56 and 55
  clean approvals lost. Every nonzero rate increased clean-team rejection in
  both populations, so the model is rejected and no production scorer changes.

## PLT-004: Hybrid degradation is missing from summary telemetry

- State: fixed and API-free validated.
- First/last seen: 2026-08-01.
- Games and seats: `game-mixed-five-repro-ddb0fde1d6-20260801-0` Edith #0 and Cecily #1; `game-mixed-five-repro-ddb0fde1d6-20260801-1` Winifred #0 and Bertram #3.
- Evidence: the clean artifact has 12 hybrid decision traces with non-empty `degradation` (one `planner-no-choice`, 11 `voice-no-output`) while top-level `degraded` is empty. The cap-degraded artifact has 44 hybrid traces with degradation (42 `planner-failed`, three `voice-failed`, two `voice-no-output`; some traces carry two codes), while its 45 top-level degradation rows all belong to the raw Kimi/DeepSeek controls and none to the hybrid seats. The rendered transcript and simulator total therefore omit every hybrid planner/voice degradation even though the decision traces preserve it.
- Expected: summaries must distinguish action fallback from planner/voice degradation, but must count and label both so a zero or raw-only top-level total cannot be read as a clean hybrid run.
- Root cause: `RunResult.degraded` intentionally owns only whole-agent illegal/error fallback, while every bounded planner/voice failure lives in `DecisionTrace.degradation`; artifact and transcript summaries projected only the first source and used the ambiguous label “degraded decisions.”
- Fix: current artifacts always emit `traceDegraded`, a public-safe projection of decision id, seat, kind, and sorted degradation codes. Full-reveal transcripts and multi-game simulator totals label `runner fallbacks` and `trace-degraded decisions` separately and show explicit zeroes. Scoped transcripts receive neither per-seat detail, preserving the existing hidden-information boundary.
- Regression: an invalid API-free planner produces a composed trace degradation with zero runner fallbacks; artifact tests assert both categories, renderer tests assert the separate labels and codes, and the existing scoped-transcript test continues to prove private details are omitted.
- Next validation: the next real hybrid artifact should reproduce the exact trace-derived count in `traceDegraded`; no paid game is required to validate the contract itself.

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

### 2026-08-01: targeted post-fix API-free validation

- Source: two replayable artifacts plus full-reveal transcripts under `data/transcripts/targeted-post-fix-20260801/`; seeds `targeted-post-fix-0` and `targeted-post-fix-1`.
- Scope: structured-only `composed:full-role` smoke games, not mixed-table or human-surrogate reproductions and not evidence about bounded LLM behavior. They validate artifact/transcript telemetry without provider calls.
- Result: 62 decision traces per game, zero runner fallbacks, zero trace-degraded decisions, and zero forced-play violations. Both artifacts explicitly persist `traceDegraded: []`; both transcripts separately render `runner fallbacks: 0` and `trace-degraded decisions: 0`.
- Audit correction: this run exposed that trace presence alone made the auditor infer `probabilistic-llm`, causing ten false identity hits and two out-of-scope Merlin review hits for `composed:full-role`. Descriptor classification now recognizes that lane as API-free `probabilistic`; a focused regression pins it, and the corrected audit reports no findings in either smoke game.
- Validation gates: 63 focused tests passed before the audit correction; the correction's three focused auditor tests passed; `npm run verify:quick` then passed strict server/client typechecks, the strict-test ratchet, architecture and cycle checks, lane inventory, and 581 fast tests.
