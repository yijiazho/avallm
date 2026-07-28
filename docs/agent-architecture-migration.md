# Agent architecture migration

**Status:** active tracking document.

**Current target phase:** Phase 7D1 visible-evil and Oberon objective substrate plus the
role-objective router. Phase 7C2 landed bounded, opt-in Merlin and Percival proposal and vote
authority over the exact Phase 7C1 substrate, with host-replayed scoring, fallback attribution,
and role-neutral voice projection. Phase 7D is split into three independently reviewable landings:
objective substrate and routing, proposal/vote policy, then quest-card coordination and forced
policy ablations. The Phase 5C population sign flip remains recorded, and win-rate tuning is still
intentionally deferred until the architecture is complete enough to evaluate as a whole.

This document tracks the transition from AvaLLM's current prompt-guided agents to the target in
[probabilistic-agent-architecture.md](probabilistic-agent-architecture.md). Unlike the research
brief, this document is expected to accumulate implementation status, measurements, decisions, and
links to landed work.

The migration is complete when the production agent uses typed evidence, joint beliefs,
decision-ready analysis, role-aware policy, and plan-driven communication while preserving
AvaLLM's hidden-information and replay guarantees.

---

## 1. Current baseline

The current system already has strong foundations that should be retained.

| Area | Current implementation | Assessment |
|---|---|---|
| Game logic | Pure event-sourced engine under `server/engine/` | Keep |
| Hidden information | `viewFor(game, seat)` produces the only `PlayerView` agents receive | Keep and extend tests |
| Agent boundary | Legacy agents return `Decision`; composed agents return `AgentDecision { decision, trace? }` through one compatibility-safe `AgentOutput` contract | Migrate remaining agents to the envelope only when compatibility permits |
| Agent construction | Registry maps heuristic, random, stdio, and LLM specs; the composed constructor is opt-in | Add an explicit composed registry/definition mode only with Phase 4 rollout evidence |
| LLM state | `createLlmAgent` closure owns a free-form scratchpad and reflection cadence | Replace as authoritative memory |
| Mechanical facts | `facts.ts`, `board.ts`, and `roleCertainties()` derive sound prompt facts | Reuse inside typed analysis |
| Hard role deductions | Exact complete worlds feed the temporary `roleCertainties()` projection used by normal LLM prompts | Keep exact worlds authoritative; consolidate the compatibility renderer during Phase 3 |
| Heuristic policy | `heuristic-policy-v2` applies shared candidates and forced rules before legacy suspicion scoring | Keep as fallback; replace scalar scoring in Phase 4 |
| Prompt policy | `prompts.ts` contains role guidance, forced-play asks, facts, transcript, and output contracts | Reduce to rendering and communication contracts |
| Proposal coherence | LLM proposal is committed before a separate pitch call | Generalize to every plan-driven utterance |
| Fallback | Agent errors degrade to the heuristic in server and simulator | Preserve; make degradation classes more specific |
| Evaluation | Seeded simulation, replay, artifacts, forced-play metrics, prompt audits | Extend with belief and policy metrics |

The primary architectural problem is not a missing heuristic. It is that facts, uncertain beliefs,
policy, memory, and speech are represented in different mixtures across `board.ts`, `facts.ts`,
`heuristic.ts`, `prompts.ts`, and the LLM scratchpad. Those mixtures make improvements difficult to
compose and difficult to measure independently.

---

## 2. Gap to target

| Target capability | Current state | Gap |
|---|---|---|
| Complete feasible worlds | Exact `PlayerView`-only enumeration | Add typed evidence updates and soft factors in later phases |
| Normalized posterior | Uniform share of feasible worlds plus exact projections | No calibrated behavioral weighting yet |
| Evidence ledger | Typed, deduplicated evidence and commitments in `CognitionState` | Not yet authoritative for every agent path |
| Team-clean probability | Exact joint assessment drives opt-in good proposals plus current-team and best-alternative good votes | Add soft likelihood calibration only in Phase 5 |
| Candidate evaluation | Separate opt-in scorers provide deterministic good proposal/vote value, seeded near-equivalent vote variation, and a non-dominated bounded planner surface | Evaluate against raw LLMs and humans before rollout |
| Forced plays | `forced-policy-v1` executes for heuristic/fallback and composed policy; its typed result is rendered to the composed planner and voice | Raw-LLM ASKS retain compatibility prose only as a frozen experiment |
| Persistent commitments | Typed literal public-position history plus natural-language notes | Not yet consumed by production policy |
| Language evidence | Opt-in public interpreter seam, persistent typed reads/cursor, capped joint-world update, and private attribution | Add a real provider adapter and evaluation population only with explicit scope and spend permission |
| Observer beliefs | Prompt heuristics for Merlin concealment and evil cover | No explicit model of public suspicion |
| Role-specific posteriors | Some hard candidate lists and assassination prompting | No independent Merlin/Morgana or Assassin distributions |
| Decision trace | Composed traces include brain, belief/factors and factor provenance, analysis, candidate, forced-policy, policy, scorer, planner, prompt/renderer, communication versions, scores, chosen ID, and degradation | Extend only when another evidence class lands |
| Brain/model/persona separation | Composed cognition persists independently of injected planner and voice identity; explicit mode labels distinguish compatibility, structured-only, hybrid, and raw LLM | Production still defaults to the deliberately separate raw-LLM baseline |

---

## 3. Migration rules

1. **Preserve a playable vertical path.** Every phase ends with complete games, legal fallbacks, and
   replay tests.
2. **Add an authoritative representation before deleting its predecessor.** Joint worlds land
   before `roleCertainties` stops serving prompt code; typed cognition lands before scratchpad
   authority is removed.
3. **One definition per executable rule.** When a forced-play rule moves into policy, prompt text
   renders the rule result rather than maintaining an independent trigger.
4. **No truth joins in runtime code.** Belief metrics join with the true role deal only in offline
   evaluation.
5. **No default-agent switch without paired evidence.** New production behavior is first exposed as
   an explicit agent or brain version and compared on matched seeds.
6. **Version probabilistic assumptions.** A likelihood table or learned model change creates a new
   factor version.
7. **Prefer vertical value over framework breadth.** Implement enough structure to improve one real
   decision path before adding every planned factor or role objective.
8. **Delete superseded paths.** Once a replacement passes its exit gate, remove duplicate policy
   and memory logic rather than leaving both active indefinitely.

### 3.1 Parent-orchestrated execution

Architecture phases should run as a sequence of bounded chunks under one parent orchestrator. The
parent owns scope, integration, validation, tracker updates, and the decision to advance. A normal
chunk has these distinct gates:

1. **Frame:** the parent records the chunk's objective, non-goals, invariants, allowed file surface,
   exit evidence, and human-stop conditions.
2. **Implement:** a fresh implementation agent works on only that bounded chunk and returns a
   commit plus focused validation. The implementer does not land, push, promote a default, spend
   money, or broaden scope.
3. **Review:** a different fresh agent audits the completed diff against the probabilistic
   architecture, hidden-information boundary, deterministic replay, attribution contracts,
   compatibility baselines, and the chunk's exit gate. Review is not replaced by the implementer's
   tests.
4. **Verify:** the parent independently reviews and corrects the diff, runs focused and complete
   API-free validation, checks fixtures, prompt hashes, replay, leaks, traces, screenshots,
   performance, and the applicable free evaluation bank, then updates this tracker.
5. **Integrate:** the parent makes a house-format commit whose subject is descriptive and whose
   non-empty body covers motivation, changed behavior, important choices, and verification. It
   rebases and lands the verified commit linearly before dispatching a dependent chunk.

The parent may continue automatically when the exit gate is objective and all work remains
API-free, reversible, and within the approved architecture. It stops for genuine architectural
ambiguity, a merge conflict that changes semantics, destructive action, paid calls, external
permission, production-default promotion, or a checkpoint whose purpose is human play or
qualitative judgment.

### 3.2 Parallel worktree protocol

Parallel code writers are allowed, including within the same broad architectural area, when each
writer has a separate Git worktree and branch. A shared checkout is suitable only for one writer;
parallel writers must not edit the same working tree.

- The parent creates every worktree from a recorded common base and assigns a unique
  `codex/<phase>-<chunk>` branch, owned files or interfaces, and acceptance criteria.
- Partition by contract where possible. If two chunks touch the same files or semantics, describe
  the expected integration order before dispatch and treat the later chunk as dependent even
  though implementation can begin in parallel.
- Writers use unique artifact paths, ports, and temporary outputs. They do not alter another
  worktree, advance `master`, push, deploy, or rewrite another agent's branch.
- Each writer commits independently in house format. The parent reviews and integrates one branch
  at a time. Before the next branch lands, it is rebased onto the newly advanced `master`, conflicts
  are resolved in its own worktree, and its focused validation is repeated.
- Passing tests in two isolated branches are not integration evidence. The parent reruns the full
  API-free suite and applicable evaluation after each landing and after the final composition.
- Review agents should ordinarily be read-only. If a reviewer supplies corrections, those changes
  happen in the reviewed branch or a dedicated repair worktree and still pass through the parent
  gate.

Useful parallel lanes include research for the next phase, read-only architecture or security
audits, evaluation and fixture design, documentation review, and implementation of a registered
non-blocking follow-up. Work that changes the same baseline, fixture corpus, schema version, or
promotion decision is integrated sequentially even when separate worktrees make concurrent coding
safe.

### 3.3 Chunk handoff contract

Every dispatched chunk should answer this template:

| Field | Required content |
|---|---|
| Objective | One observable architectural or behavioral outcome |
| Base and workspace | Exact base commit, branch, and separate worktree path |
| Owned surface | Files, interfaces, or evaluation cells the agent may change |
| Invariants | Hidden information, forced-policy, legality, determinism, attribution, and baseline guarantees that apply |
| Non-goals | Later factors, policy changes, paid work, rollout, or cleanup explicitly excluded |
| Exit evidence | Focused tests, full tests expected of the parent, fixtures, evaluation, latency, and safety checks |
| Deliverable | House-format commit, diff summary, validation results, and unresolved risks |
| Stop conditions | Ambiguity, conflict, destructive action, paid call, permission, or default-promotion decision |

The parent records the base and resulting commit in the progress log. A review handoff cites that
commit rather than a moving branch so the reviewed bytes are unambiguous.

### 3.4 Parallel non-blocking follow-ups

Phase-local follow-up lists remain the source of architectural context. An open item enters this
cross-phase register when it has explicit acceptance criteria and can proceed without changing the
active phase's comparison baseline. The parent may dispatch `ready` items in separate worktrees
while the primary lane runs, then integrate them one at a time.

| ID | Source | Follow-up | Independence boundary and acceptance | Status |
|---|---|---|---|---|
| NB-001A | Phase 3 | Route compatibility certainty prose through typed belief and situation analysis | Preserve exact feasible-world support, record provenance, prompt bytes, and compatibility behavior; false certainty from rounded weighted marginals is forbidden. | `landed` |
| NB-001B | Phase 3 / Phase 6 | Replace independently derived public dossier facts with a typed public-record projection | The Phase 6 public-language boundary owns the shared public record. Dossier and language-input bytes remain frozen and the viewer seat affects only the existing own-position callout. | `landed` |
| NB-002 | Phase 4 | Paid raw-LLM comparison and human playtests | No code dependency, but requires explicit spend/study permission and a frozen candidate commit. Results must remain attributable to that exact commit and population. | `permission-gated` |
| NB-003 | Phase 5 | Extend factor calibration beyond heuristic and seeded-random opponents | Requires a versioned corpus from the target model or human population, leakage-safe splits, and a uniform-versus-weighted ablation. Synthetic work must not be presented as human calibration. | `data-gated` |
| NB-004 | Phase 6 | Add an active-language architecture evaluation bank and dynamic belief matcher | Separate stable configured belief-pipeline identity from the actual per-decision snapshot version; run a public-dialogue fake-interpreter cell with calls greater than zero, accept its mixed mechanical/bounded snapshots, and preserve exact attribution, zero cost, and report validation. | `landed` |
| NB-005 | Phase 7 | Harden external public-observer snapshot semantic validation | Before any external observer payload can affect policy, validate a common canonical role set, role/alignment consistency, and the probability lattice implied by the feasible-world count. Runtime snapshots are already exact; the current shape-only external boundary is not policy-authoritative. | `landed` |

New entries should use stable IDs, name their source phase, and state whether they are `ready`,
`active`, `review`, `landed`, `permission-gated`, `data-gated`, or `deferred`. Completing a
follow-up updates both this register and its phase-local checkbox in the same commit.

---

## 4. Phase overview

| Phase | Status | Outcome |
|---|---|---|
| 0. Preserve foundations and establish baselines | Complete | Stable comparison point and contracts |
| 1. Exact joint-world foundation | Complete | Uniform posterior over every feasible hidden world |
| 2. Evidence, analysis, and belief visibility | Complete | Typed incremental cognition and decision-ready summaries |
| 3. Composed agent and policy boundary | Complete | Brain, model, persona, policy, and voice are separate |
| 4. Belief-driven production policy | Complete (opt-in; rollout not promoted) | Exact beliefs directly improve proposals and votes |
| 5. Soft mechanical likelihoods | In progress; quest factor complete | First calibrated behavioral weighting of feasible worlds |
| 6. Bounded language evidence and commitments | Language path complete and opt-in; commitment coherence pending | Dialogue affects beliefs without owning them |
| 7. Role-specific observer and identity models | In progress; Phase 7B2 complete | Merlin, Percival, evil, Oberon, and Assassin objectives |
| 8. Counterfactual value and optional learned inference | Deferred | Search or learned models added only where measured |

---

## 5. Phase 0: preserve foundations and establish baselines

### Existing foundations

- [x] Pure deterministic engine.
- [x] Seat-filtered `PlayerView` boundary.
- [x] Event sequence numbers and replayable log.
- [x] Seeded heuristic and random agents.
- [x] Agent registry and stdio protocol.
- [x] Legal fallback in both web server and simulator.
- [x] Prompt rendering from `PlayerView`, never raw `Game`.
- [x] Hard role-knowledge closure with exhaustive legal-cast tests.
- [x] Derived public facts dossier.
- [x] Forced-play behavioral tests and evaluation metrics.
- [x] Commit-then-explain proposal flow.

### Baseline work

- [x] Select a fixed paired-seed bank covering 5 through 10 players and all standard special roles.
- [x] Record migration-start prompt-guided LLM results by role, decision kind, model, cost, and
      degradation, reusing already-paid archived playtests.
- [x] Record current heuristic results on the same seeds with discussion disabled.
- [x] Freeze representative `PlayerView` decision fixtures for belief and policy regression tests.
- [x] Add a compact architecture benchmark report format that can compare component versions.

### Exit gate

The baseline bank can compare two agent versions on identical deals and table configurations, and a
future belief model can be evaluated without changing the game engine.

**Satisfied.** `test/architecture-eval.test.ts` runs two component-version bundles on an identical
bank deal and rejects configuration drift. The committed decision fixtures contain only
`DecisionRequest`, seat-filtered `PlayerView`, and the baseline decision, so a future belief or
policy evaluator can consume them without a `Game`. The free heuristic record is
[`baselines/phase0-heuristic-standard-v1.json`](baselines/phase0-heuristic-standard-v1.json).
Available prompt-guided evidence is preserved in
[`baselines/phase0-prompt-guided-observed.json`](baselines/phase0-prompt-guided-observed.json);
it came from three existing paid playtests, not new calls, and is explicitly observational rather
than a paired promotion result.

---

## 6. Phase 1: exact joint-world foundation

This is the first implementation phase because it creates useful intelligence without requiring
training data or additional LLM calls.

### Domain and solver

- [x] Add `HiddenWorld`, `WeightedWorld`, and `BeliefSnapshot` types.
- [x] Implement canonical role-world enumeration from `rolesInPlay`.
- [x] Add an alignment projection optimized for team decisions.
- [x] Apply the viewing seat's own role and private knowledge as hard constraints.
- [x] Apply resolved Fail counts as minimum-evil cardinality constraints.
- [x] Normalize a uniform posterior over feasible worlds.
- [x] Derive player alignment marginals and role marginals.
- [x] Derive team-clean probability and evil-count distribution.
- [x] Derive posterior entropy and top worlds.

### Reuse and cleanup

- [x] Move the constraint rules embodied in `roleCertainties()` behind the world-model boundary, or
      make both consumers use one shared constraint module.
- [x] Preserve the exhaustive tests proving no true role is eliminated in any legal cast.
- [x] Keep the current `RoleCertainties` renderer temporarily as a projection of joint worlds.
- [x] Remove any duplicated closure implementation once projections are equivalent.

### Tests

- [x] Exact world counts for simple casts.
- [x] Duplicate Servant and Minion roles do not create duplicate worlds.
- [x] Own role is pinned in every world.
- [x] Merlin, Mordred, evil partner, Oberon, and Percival visibility constraints are correct.
- [x] A quest with `k` Fail cards removes every world with fewer than `k` evil members aboard.
- [x] A zero-Fail success does not eliminate worlds merely because evil was aboard.
- [x] Posterior probabilities sum to one.
- [x] Player and role marginals match hand-worked cases.
- [x] Team-clean and evil-count projections match hand-worked fixtures.
- [x] Top worlds and complete solver output are deterministic.
- [x] Seat rotation rotates the posterior without changing probabilities.
- [x] Solver APIs accept only `PlayerView` or typed evidence, never `Game`.
- [x] Every frozen Phase 0 decision fixture has explicit posterior and team expectations.
- [x] Legal views retain the true world in truth-joined offline tests.

### Exit gate

For every frozen decision fixture, AvaLLM can produce a deterministic, exact, joint posterior and
correct team assessments using only the viewing seat's information. No production behavior has to
change yet.

**Satisfied.** All eight frozen Phase 0 decision fixtures have explicit expected event cursors,
world counts, entropy, assessment teams, clean probabilities, and full evil-count distributions.
The exact solver consumes their stored `PlayerView` values directly. It is not wired into proposal,
vote, quest-card, discussion, or assassination policy, and it makes no LLM calls.

### Phase 1 implementation record

- `exact-constraints-v1` assigns equal probability to every feasible complete role assignment.
  This is a uniform hypothesis share under hard information, not a calibrated behavioral
  probability. Impossible worlds are absent. A legal view that yields none throws a diagnostic
  error rather than returning a degraded or empty posterior.
- Duplicate Servant and Minion cards are multiset counts, not identities. A world key is the role
  name at each ascending seat joined by `|`. Worlds sort by that key; top worlds sort by descending
  probability and then the same key. Player projections sort by seat, and role projections sort
  by seat then the fixed canonical role order.
- Entropy is Shannon entropy in bits. Probability assertions use an absolute tolerance of
  `1e-12`. `throughSeq` is the maximum sequence number in the seat-visible event list, or `-1`
  when that list is empty.
- Private lists are treated as complete knowledge: named seats and omitted seats both constrain a
  world. Quest evidence uses every visible Fail card as a minimum-evil constraint, including one
  Fail on the two-Fail quest when that quest succeeds. A zero-Fail success adds no constraint.
- `roleCertainties()` now projects possible roles and proven alignments from exact worlds. Its
  former independent closure is removed. `fromRecord` still separates deal-only conclusions from
  record conclusions, and a `questNum` is attached only when that quest directly exhausts the
  seats that could account for its Fails. Consequences of several joint constraints remain
  record-attributed without falsely crediting one quest. This is intentionally sharper than the
  old independent closure: intersecting failed-team constraints can prove a seat good even when
  no single quest names it; a focused regression test pins that behavior.
- Canonical pinned assignment sets and deal-only feasible sets use small LRU caches. On the
  standard casts with a Servant viewer, the representative 5-player posterior has 24 worlds and
  took 1.360 ms cold / 0.036 ms warm median; the 10-player posterior has 60,480 worlds and took
  100.879 ms cold / 17.872 ms warm median. Measurements used Node's `performance.now()` on the
  development Windows host over 20 warm runs; the observed warm p95 values were 0.299 ms and
  49.877 ms respectively.

### Non-blocking Phase 1 follow-ups

These items do not reopen the Phase 1 exit gate, but later phases must not silently build on the
current limitations.

- [x] Make every posterior projection weight-aware before Phase 5 introduces non-uniform worlds.
  The Phase 1 posterior is uniform, so counting feasible worlds gives correct player marginals,
  role marginals, team-clean probability, evil-count distributions, and entropy today. Once
  `WeightedWorld.probability` can vary, those quantities must sum world weights and entropy must
  use the weighted distribution. Add a deliberately non-uniform projection test with that change.
- [x] Add a repeatable exact-belief and prompt-rendering performance benchmark, then monitor it as
  coverage grows. On the development Windows host, the full suite increased from roughly 3 seconds
  before Phase 1 to roughly 42 seconds after it; exhaustive legal-cast certainty and rendered-prompt
  audits account for most of the increase. Preserve those exhaustive tests, and improve snapshot
  reuse or caching before inference or coverage expands enough to make the feedback loop onerous.

---

## 7. Phase 2: evidence, analysis, and belief visibility

### Incremental cognition

- [x] Add typed `Evidence` records keyed by visible event sequence.
- [x] Add `CognitionState.throughSeq` and process each event once.
- [x] Separate private evidence from the public evidence projection.
- [x] Add a typed commitment ledger for proposals, votes, leans, and explicit claims.
- [x] Reconstruct cognition deterministically from a full `PlayerView` for replay and recovery.

### Decision-ready analysis

- [x] Move score, match point, hammer proximity, and known-Fails-aboard calculations into
      `SituationAnalysis`.
- [x] Add current-team and candidate-team assessments.
- [x] Express hard deductions with provenance: private deal, role-count closure, or quest record.
- [x] Define stable reason codes for facts and forced-play triggers.

### Prompt visibility

- [x] Add a compact belief renderer generated from `BeliefSnapshot` and `SituationAnalysis`.
- [x] Distinguish `proven`, `uniform hypothesis share`, and later `weighted probability` in wording.
- [x] Keep joint relationships such as "exactly one of A/B is evil" visible.
- [x] Render the same summaries into prompt preview and live play.
- [x] Add prompt audits for impossible certainty and private/public scope mistakes.

### Trace seam

- [x] Introduce optional `DecisionTrace` data without exposing it to live opponents.
- [x] Record belief version, event cursor, top hypotheses, team assessment, and degradation quality.
- [x] Decide whether traces live in the main game artifact or a private sidecar.

### Exit gate

An explicit experimental agent can consume the exact belief summary, and offline artifacts can
compare its stated reasoning and actions with the posterior that existed at decision time.

**Satisfied.** The nondefault `exact-belief-experimental` definition selects
`beliefMode: "exact-summary-v1"`. Its live prompts, fixed-fixture previews, and offline situation
replays all use the same `compact-belief-v1` renderer. The normal LLM definitions select no belief
mode and their prompt bytes and policy path remain unchanged. Experimental decisions can emit an
optional private trace into the completed-game artifact. `snapshotAt()` associates that trace with
the replayed decision by its stable seat, request, and visible-event cursor identity, so an offline
evaluator can compare the recorded action and stated reasoning with the exact posterior available
before that action.

### Phase 2 implementation record

#### Evidence, cursors, and boundaries

- `mechanical-evidence-v1` is a discriminated union. Public records cover game setup and leader
  changes, proposed/locked/revised teams, raw attributed utterances, declared leans, revealed
  votes, quest teams and results with Fail counts, renames, assassination, and the game result.
  Private records cover only the viewer's own role and legal deal knowledge. Hidden `voteCast` and
  `questCard` events, model thinking, scratchpads, and other seats' private events produce no
  evidence.
- Every event-derived id is `event:<visible sequence>:<evidence kind>`. An utterance with a lean
  deliberately produces two typed records with the same source sequence and different kinds.
  Evidence sorts by source sequence and id. `CognitionState.throughSeq` is the maximum sequence
  visible to that seat, including ignored private events, so advancing from that cursor processes
  every later visible event exactly once. Repeating a view is idempotent.
- `advanceCognition(previous, newerView)` and `reconstructCognition(completeView)` both recompute
  the exact posterior from the complete seat-filtered view while incrementally merging evidence.
  They produce identical state. Version metadata records the cognition schema, evidence model,
  commitment model, and belief model.
- `publicCognition()` contains public evidence, literal public commitments, and the last public
  evidence sequence. It contains no viewer identity, role, private knowledge, feasible worlds,
  marginals, or posterior. Equal public game states project identically for every seat.

#### Commitments and analysis

- `public-commitments-v1` records proposed and revised teams, revealed votes, declared leans, and
  exact public text from discussion, pitches, and revision reasons. It does not interpret prose.
  Each entry carries its source evidence id and sequence, actor, quest/proposal/team context,
  public visibility, and current or superseded status. A revision supersedes the original team and
  pre-revision leans; a newer lean supersedes the prior lean in that proposal context; a revealed
  vote supersedes that actor's nonbinding lean.
- `situation-analysis-v1` owns score, match point, proposal runway, hammer state, current and
  caller-supplied team assessment, legally known Fails aboard, proven alignments, hard deductions,
  and stable fact/forced-play codes. `board.ts` is now a compatibility wrapper over this owner, and
  the facts dossier reads the same board result. Existing heuristic and prompt forced-play behavior
  therefore keeps its former interface while sharing the migrated calculations.
- Deduction provenance distinguishes `private-deal`, `role-cardinality-closure`, `quest-record`,
  and `joint-constraints`. A quest is the sole provenance only when every member of its team
  supplied a Fail, so the public quest record alone proves each alignment. Conclusions that also
  need the viewer's role, private knowledge, role cardinality, or several quest records use
  `joint-constraints` with every required evidence id and quest number.

#### Rendering, experiment identity, and traces

- `compact-belief-v1` renders proven good and evil seats separately from unresolved player shares,
  current/candidate team-clean shares and evil-count possibilities, aggregated top joint alignment
  hypotheses, exact pair relationships, the belief model, visible cursor, and quality. Under
  `exact-constraints-v1`, every numeric line says "uniform share of feasible hypotheses" and the
  block explicitly says it is not a calibrated behavioral likelihood. The renderer already has a
  distinct wording branch reserved for a future weighted snapshot; it does not implement weights.
- `exact-summary-v1` is a prompt visibility mode, not a Phase 3 brain configuration. The curated
  `exact-belief-experimental` agent is the explicit test surface. The mode appears in public agent
  metadata and architecture artifact component metadata, but the rendered belief block remains
  private to the deciding model.
- Traces live as the optional `decisionTraces` field in the main full-reveal game artifact rather
  than a sidecar. This preserves atomic association with the replayable event log and avoids a
  second retention lifecycle. The artifact is already opt-in for web games and private by
  contract. Traces are never stored in `Game`, emitted as events, added to `PlayerView`, included
  in SSE/client payloads, or read while producing cognition. Truth remains available only from the
  rest of the completed artifact for a later offline join.
- Parse-level failures in reflection and pitch calls are explicit trace degradation codes even when
  the transport succeeds. If the decision call or engine application falls back, the runner invokes
  the agent's optional private fallback-trace hook and upserts the same stable decision identity
  with the heuristic action that was actually applied. Trace telemetry remains best-effort and
  cannot stall a game.

#### Performance

`npm run belief-performance` runs without an API key and reports the first call plus warm median
and p95 over a configurable iteration count. It benchmarks a Servant opening view in the standard
5-player cast (24 worlds) and 10-player cast (60,480 worlds), both for the exact posterior alone
and for the complete experimental prompt path. The prompt measurement follows the exact
measurement in one process, so its first-call number has the canonical assignment cache warm but
still pays its first complete cognition, analysis, renderer, and prompt construction.

On the development Windows host with Node v24.15.0 and 20 warm samples, the final Phase 2 run
recorded:

| Players | Worlds | Exact cold / median / p95 | Experimental prompt cold / median / p95 |
|---|---:|---:|---:|
| 5 | 24 | 0.752 / 0.048 / 0.072 ms | 7.497 / 0.077 / 0.243 ms |
| 10 | 60,480 | 95.866 / 17.009 / 20.467 ms | 41.392 / 36.069 / 41.543 ms |

The benchmark is reproducible and the performance follow-up is complete. The separate
weight-aware projection follow-up remains open until Phase 5 supplies a deliberately non-uniform
test. Warm medians average the two middle samples for even runs; p95 uses the nearest-rank
definition, so the documented 20-sample p95 is the nineteenth ordered sample rather than the
maximum.

### Architecture checkpoint before Phase 3

Phase 2 satisfies its exit gate, but its experiment metadata currently conflates inference with
prompt visibility. Normal LLM prompts already call `roleCertainties()`, which projects certainties
from `exact-constraints-v1`. Therefore a normal agent recorded as `belief: "none"` does not have no
belief inference. It has exact hard-constraint inference rendered through the compatibility
certainty text, but it does not receive the compact belief summary. The Phase 2 experiment compares:

- exact hard certainties plus the existing dossier; against
- the same information plus `compact-belief-v1`.

It is not a no-belief versus exact-belief comparison. Historical Phase 0 artifacts retain their
recorded metadata, but new artifacts must describe this distinction accurately before Phase 3
benchmarks are used for causal claims.

Required Phase 3 preflight:

- [x] Separate the inference component from its visibility mode in agent configuration and
      architecture artifact metadata.
- [x] Record normal LLM inference as `exact-constraints-v1` while it consumes
      `roleCertainties()`; reserve `none` for paths that perform no belief inference.
- [x] Give compatibility certainty text and `compact-belief-v1` distinct visibility identifiers.
- [x] Add a regression test proving that component labels match the inference and rendering paths
      actually exercised.

Non-blocking consolidation work during Phase 3:

- [x] Route new policy code through `CognitionState` and `SituationAnalysis`; do not add another
      direct `PlayerView` arithmetic or prompt-only authority.
- [x] **NB-001A:** Route compatibility certainty prose through typed belief and situation analysis
      after equivalent typed renderers pass tests.
- [x] **NB-001B:** Replace independently derived dossier facts with the Phase 6 typed public-record
      projection after that boundary lands.
- [x] Expand decision traces with the analysis, policy, renderer, prompt, and applicable factor
      versions needed to attribute behavior to a complete brain configuration.

---

## 8. Phase 3: composed agent and policy boundary

### Agent composition

- [x] Complete the component-identity preflight above before comparative evaluation.
- [x] Introduce a brain configuration distinct from model and persona configuration.
- [x] Add a composed `hybrid` engine or equivalent agent constructor.
- [x] Preserve `raw-llm`, heuristic, random, and stdio modes as baselines.
- [x] Adapt legacy agents to the new result boundary through one transitional `AgentOutput`
      normalizer, without changing their returned decision bytes.
- [x] Extend custom-agent validation and public metadata without exposing private cognition.

Suggested configuration shape:

```ts
interface BrainSpec {
  belief: 'none' | 'exact-constraints-v1' | 'weighted-v1'
  beliefVisibility: 'none' | 'compat-certainties-v1' | 'compact-belief-v1'
  policy: 'raw-llm' | 'structured-v1' | 'hybrid-v1'
  languageEvidence?: 'off' | 'bounded-v1'
  observerModel?: 'off' | 'observer-v1'
  searchBudget?: number
}
```

### Phase 3A implementation record

`server/agents/brain.ts` owns the resolved strategic identity. `resolveBrain()` is the single
adapter used by runtime LLM construction, validation, public metadata, prompt preview/replay, and
new architecture artifacts. Model choice, personality, strategy, and prompt guidance remain in
their existing configuration and are not members of `BrainSpec`.

The identifiers at the Phase 3A checkpoint were:

| Component | Identifier |
|---|---|
| Brain schema | `brain-spec-v1` |
| Normal and experimental LLM inference | `exact-constraints-v1` |
| Normal LLM belief visibility | `compat-certainties-v1` |
| Experimental belief visibility | `compact-belief-v1` |
| Current raw prompt-guided LLM policy | `prompt-guided-v1` |
| Current LLM communication | `prompt-voice-v1` |
| Phase 3A heuristic policy | `heuristic-v1` |
| Random policy | `random-v1` |
| Language evidence and observer model | `off` |
| Stdio-owned components | `external` |

The Phase 2 `beliefMode: "exact-summary-v1"` field remains a compatibility input. It has one
adapter in `resolveBrain()` and maps to `beliefVisibility: "compact-belief-v1"` with
`belief: "exact-constraints-v1"`. New definitions may express that visibility directly through
`engine.brain`. Conflicting legacy and typed values fail validation. Remove `beliefMode` after the
curated experimental definition and all API callers use the typed brain field; until then it must
not be interpreted anywhere else.

New architecture artifacts derive their brain component bundle from the same resolver used to
construct the runtime agent. A variant may add experiment-specific metadata but cannot override a
resolved runtime component with a contradictory label. The committed Phase 0 baseline files and
their recorder retain the historical `belief: "none"` schema and values; they are evidence from
before this correction and are not relabeled.

Phase 3A changes no decision behavior or prompt bytes. Regression coverage proves default and
compact legacy/typed prompt equivalence, truthful LLM/heuristic/random/stdio identities, invalid
configuration rejection, runtime-to-artifact agreement, frozen Phase 2 prompt hashes across every
decision-fixture kind and private-knowledge shape, typed HTTP preview equivalence, and frozen Phase
0 metadata. The focused agent, prompt, architecture, baseline, and HTTP suite passed 38 tests; the
complete API-free suite passed 545 tests, all eight frozen architecture fixtures were current, and
the screenshot manifest remained current without regeneration.

Phase 3A handed off a bounded Phase 3B target: one legal candidate owner, one executable
forced-policy owner, and a heuristic fallback consuming both through `SituationAnalysis`, with
behavior equivalence pinned before prompt rendering changed.

### Phase 3B implementation record

`server/agents/policy/candidates.ts` is the single finite legal-candidate owner. Version
`legal-candidates-v1` enumerates canonical proposal teams, stick plus every non-identical revision,
approve/reject votes, alignment-legal quest cards, and every non-self assassination target.
Discussion uses a finite pass-and-public-lean template seam; arbitrary speech remains a
communication concern. Candidate IDs are deterministic, canonical by seat, independent of player
names, and generated from `DecisionRequest` plus `PlayerView` only. The engine remains authoritative:
an exhaustive architecture-bank test applies every generated candidate to a cloned real decision
state through `applyDecision`.

`server/agents/policy/forced.ts` owns executable T1 constraints as `forced-policy-v1`. It returns
the surviving candidate IDs, an optional single selected candidate, and stable
`ForcedPlayReasonCode` values supplied by `situation-analysis-v1`. It covers good's mandatory
Success card; the non-Oberon Success required when legally known Fails cannot meet the quest
threshold; decisive-board Fail and vote choices when the public lean tally says the vote can still
matter; and the sinkable-team constraint for both proposal and finalize, including the hammer, when
an evil leader acts at good's match point. Oberon's missing partner knowledge remains an explicit
exception.
Away from a decisive board, two-Fail cover versus failure timing remains seeded heuristic policy,
not a falsely absolute forced rule; its shared public-board RNG still makes every designated evil
choose consistently.

The heuristic and forever-fallback path now reconstruct `CognitionState`, obtains
`SituationAnalysis`, generates candidates, applies forced rules before ordinary scoring, and proves
its preferred decision names a surviving candidate. Exhaustive proposal surfaces use the cheap
`SituationAnalysis.policyCandidateTeams` projection (candidate ID, canonical team, and legally
known Fails) rather than computing a 60,480-world joint assessment for each of as many as 252 teams.
The analysis also owns the current Fail requirement, current-segment public leans, and whether this
seat's approve or reject could still change passage. Candidate joins validate both ID and team;
request/view seat, phase, round, and proposal coordinates must all agree. The current brain identity
is therefore exact inference plus `heuristic-policy-v2`, with no belief renderer or communication
component. Historical Phase 0 `heuristic-v1` artifacts remain unchanged.

Behavior equivalence is pinned two ways. All eight frozen decision fixtures match their Phase 3A
decisions after JSON boundary normalization. The complete ten-game `standard-v1` architecture bank
hashes `JSON.stringify(artifacts.map(({seed, log, degraded}) => ...))` with SHA-256; both sides of
the rewrite equal
`0c6a67ef0c269f0ab5fc46fb8a9d5e55216bd2290f1551a7b6c689a4ad6db52f`.
The before value was captured from a clean worktree at Phase 3A commit
`ee8803b81ec7688db2fc2a2bf311590824c00fcf` before the rewrite.
On the development Windows host, a 10-player opening proposal with 252 legal teams measured
26.379 ms cold, 0.326 ms warm median, and 0.720 ms warm p95 over 20 warm samples.

Independent review found and corrected five boundary defects before landing: vote rules now share
the evaluator's public-leverage admission condition, finalize cannot escape the sinkable-team
constraint, stale request/view coordinates fail closed, and candidate facts are keyed and verified
rather than joined by array position; decision-ready quest and vote arithmetic now stays in
`SituationAnalysis`. Verification completed with 44 focused policy, forced-rule,
equivalence, heuristic, attribution, and situation tests plus all 559 API-free tests. All eight
architecture fixtures and the screenshot manifest were current, and a fresh ten-game heuristic
architecture bank completed without a network or paid LLM call in about 2.4 seconds end to end.

Non-blocking Phase 3B follow-ups:

- [ ] Cache or increment the heuristic's `CognitionState` if larger simulations show the current
      reconstruct-per-decision path is material; the present ten-game bank is acceptable.
- [ ] Add closed-form candidate-count properties by player count and decision kind. Exhaustive
      engine acceptance across the architecture bank currently proves legality, but an independent
      cardinality oracle would strengthen completeness coverage.

### Phase 3C implementation record

`server/agents/composed.ts` adds the opt-in `composed-policy-v1` engine. One decision advances
seat-owned `CognitionState`, derives `SituationAnalysis`, generates the finite legal surface,
applies `forced-policy-v1`, obtains typed scores, optionally accepts one supplied viable candidate
ID from an injected planner, commits `decision-plan-v1`, and only then invokes an injected voice.
It is deliberately not registered as the production default. Phase 4 must replace the compatibility
score with measured role utility before any default switch.

`compatibility-scorer-v1` emits deterministic, finite, JSON-round-trippable `CandidateScore`
records. It preserves the current heuristic choice when that candidate survives the forced policy
and otherwise uses canonical legal-candidate order. This is an architectural seam, not new
intelligence: belief-driven team value, dominance bands, and role objectives remain Phase 4 work.
The optional planner receives the seat-filtered `PlayerView` plus the typed
`composed-typed-context-v1` rendering and viable candidates. It may return only one candidate ID
and a bounded communication intent. An absent, unknown, removed, duplicate, non-finite, or
otherwise malformed scorer/planner result degrades to the compatibility scorer and structured
choice; neither plugin can reopen a forced-policy removal or construct an arbitrary engine action.

`AgentOutput` is a compatibility union during migration. Existing raw-LLM, heuristic, random, and
stdio callers keep their exact raw `Decision` behavior, while composed agents return
`AgentDecision { decision, trace? }`; server and simulator runners normalize both. The stdio
protocol accepts the same trace envelope as an optional extension. Composed traces carry every
component version from the centrally resolved brain, belief visibility, and inactive factor slots
through policy, prompt renderer, communication plan, and concrete voice, plus the central forced
result, candidate scores, chosen ID, planner attempt, and degradation. The stdio boundary validates
the complete required base trace and stable decision identity. Runners hold envelope traces pending
until engine legality succeeds, so an illegal attempted action cannot be persisted as the ultimate
decision. Traces use only private sinks; neither `Game` nor `PlayerView` gained a trace field.

`CommunicationIntent` owns the discussion, proposal-pitch, or revision-reason task. The committed
mechanical decision is cloned before voice runs, planner intent must match its channel and public
lean, and voice can return only text plus private thinking. Analysis fact codes are private by
default: only a small public-safe allowlist may enter `safeFactCodes`, while private deductions are
placed in the intent's concealment set. A voice failure leaves the proposal, revision, or discussion
lean intact and makes its public communication silent. Replacing the planner/model or voice on a
composed agent does not replace or reset that seat's cognition.

The composed renderer consumes the executable forced-policy result, reason codes, allowed IDs,
candidate scores, and committed plan. It does not re-derive board triggers from prose. The raw LLM
`ASKS` text is intentionally unchanged because raw prompt-guided play is a frozen comparison mode;
its prompt hashes remain
`f931cc39468717af07c0188065669d26822441b17bad18153827ff5f364e1fdb` (default) and
`fc97263aa064c080b7004e853d7b0c0cdafe56b620d3cb877780b6257d62f102` (compact).
In the composed path those sentences are explanatory compatibility text with no executable
authority.

Independent review found and corrected scorer-boundary totality, private-fact speech projection,
ultimate-action trace ordering, stdio trace-schema validation, central brain attribution, and
committed-team trace assessment. Follow-up review also tightened boolean viability, optional stdio
extension relations, preservation of central reason codes in chosen-team traces, and attribution
to the exact planner and voice instances used across awaits. The parent correction suite passed
39 focused composition, brain, trace, and stdio tests, followed by all 577 API-free tests. All eight
architecture fixtures and the screenshot manifest were current, and a fresh ten-game free
architecture bank completed with zero degradation, zero calls, and no paid LLM use.

Non-blocking Phase 3C follow-ups:

- [ ] Replace `compatibility-scorer-v1` with Phase 4 role-aware belief features and a measured
      viable band before exposing composed agents in the normal table registry.
- [x] Add the real bounded planner and voice adapters only with an explicit free fake-client test
      path and the existing paid-call gate; Phase 3 defines the injection contracts only.
- [ ] Collapse the transitional `AgentOutput` union after external and direct callers have had a
      compatibility window; until then runners remain the single normalization boundary.
- [ ] Cache the compatibility policy's repeated cognition work if the opt-in constructor is used
      in larger benchmarks before Phase 4 replaces that scorer.

### Central policy

- [x] Generate legal candidate actions in one module.
- [x] Move forced-play triggers into executable policy rules with stable reason codes.
- [x] Make the heuristic fallback consume the same analysis and forced-rule modules.
- [x] Render forced-rule results into composed planner/voice context; retain unchanged raw-LLM
      compatibility ASKS as the baseline experiment.
- [x] Add a structured candidate scorer.
- [x] Add a bounded planner seam that may choose only from supplied viable candidate IDs.
- [x] Generalize commit-then-explain from proposals to revisions, discussion leans, and strategic
      claims.

### Exit gate

Facts, forced rules, candidate generation, policy, and voice have distinct owners. Deleting a
forced-play sentence from a prompt cannot remove the executable behavior, and changing a persona
cannot reset strategic state.

**Status:** met for the opt-in composed path. The raw-LLM mode remains intentionally prompt-guided
and behavior-frozen as an evaluation baseline; it is not mislabeled as the composed policy.

---

## 9. Phase 4: belief-driven production policy

The first production slice should be narrow enough to attribute gains:

1. exact uniform alignment worlds;
2. good-side proposal and vote decisions;
3. structured team assessment;
4. existing LLM for social planning and speech;
5. existing heuristic as final fallback.

### Phase 4A implementation record

`good-proposal-scorer-v1` is an injected composed-policy scorer for good-side proposal requests.
Every forced-policy survivor remains viable, and its numeric value is the exact joint probability
that the whole team is clean under `exact-constraints-v1`. It does not multiply or sum independent
seat marginals. Exact ties resolve by stable candidate ID. All other alignments and decision kinds
delegate to compatibility scoring, and `compatibility-scorer-v1` remains the composed default and
explicit ablation.

The scorer declares `joint-proposal-team-assessments` as an analysis requirement. Only that opt-in
path asks `SituationAnalysis` for the exhaustive, candidate-ID-keyed projection; ordinary
compatibility analysis pays no batch cost. The belief layer aggregates full-role worlds by compact
alignment mask, preserves exact uniform output, and sums probability mass correctly for a future
nonuniform snapshot. Each score records `good-proposal-features-v1`, including probability
semantics, belief version/cursor, canonical team, clean probability, and evil-count distribution.
Validation joins candidate ID, team, analysis assessment, score value, trace action, and relevant
team before accepting that attribution.

Independent review found and corrected a mutable scorer-context escape that could reopen a forced
candidate, missing score-to-feature coupling, incomplete stdio relations, empty-batch overhead, and
an implicit uniform-weight assumption. Scorers now receive a defensive clone while validation and
selection retain untouched authoritative state. Parent focused validation passed 59 tests; the
independent final review passed 68 tests; the complete API-free suite passed 591 tests. All eight
architecture fixtures and raw prompt hashes remained current. The ten-player Quest 4 surface
contains 252 teams over 60,480 full-role worlds and remained comfortably below the two-second test
ceiling; measured warm analysis before the final mask aggregation was about 29 ms median and 32 ms
p95. No production default, registry mode, prompt, paid call, or Phase 4B behavior changed.

### Phase 4B implementation record

`good-proposal-vote-scorer-v1` extends the Phase 4A scorer with good-side vote value while retaining
the Phase 4A scorer and `compatibility-scorer-v1` as independent ablations. `good-vote-situation-v1`
owns exact current-team and best-different-team summaries. Both probabilities come from the same
feasible joint-world posterior; the scorer never combines independent seat suspicion.

`good-vote-utility-v1` makes its intentionally conservative, pre-calibration assumptions explicit.
It values approval from current-team clean probability and a small information bonus only while
later quests remain. It values rejection from the best legal alternative, discounted by proposal
runway and charged for hammer risk. Match point raises the stake. These constants are heuristic
policy parameters, not learned likelihood factors or calibrated quest-success probabilities, and
remain versioned and visible in candidate features and traces.

The deterministic scorer keeps only the top-utility forced-policy survivor viable. The separate
`good-proposal-vote-seeded-band-v1` mode keeps both votes viable only when their utility gap is at
most `0.04`, then uses the composed agent's game seed, seat, request coordinates, and belief cursor
to select replayably within that band. Outside the band, seed cannot change the choice. A forced
selection remains authoritative and disables variation. Analysis projections, scorer values,
selection adjustment, candidate ID, committed action, relevant-team trace, and stdio transport are
validated as one joined record.

Independent review found duplicated best-alternative ownership and an independently supplied
variation seed. The scorer now consumes the analysis-owned projection after checking its max/tie
contract, and variation derives only from the composed agent's game seed and stable event identity.
Boundary validation also recomputes the seed bucket and couples it to the selected vote and exact
score adjustment. Compatibility remains the composed default; no production registry mode, prompt,
paid call, role-specific objective, soft factor, search, or factor graph changed.

### Phase 4C implementation record

`decision-plan-v2` and `communication-intent-v2` attach feature-derived selected reasons and
`posterior-uncertainty-v1` to the committed candidate. Proposal reasons are recomputed from the
validated full score surface, and vote reasons are recomputed from validated vote features; a
scorer cannot turn an invented reason string into speech. Exact posterior numbers remain in private
trace intent. The voice receives only the committed action, public-safe fact codes, selected
strategic reasons, and `voice-uncertainty-v1` qualitative confidence. It does not receive the
candidate surface, forced/private reason names, concealment list, posterior numbers, belief model,
or cursor.

The planner surface is narrower than scorer viability. Phase 4A remains an ablation in which every
forced-policy survivor is scored, but the bounded planner sees only exact-max proposal teams.
Choosing a different max team requires `GOOD_PROPOSAL_MAX_TEAM_CLEAN`. Vote planning preserves the
Phase 4B viable band and requires `GOOD_VOTE_SEEDED_VIABLE_BAND` for a nonstructured choice.
Compatibility and featureless scorers expose only the structured choice. Planner output names only
a supplied candidate ID, feature-derived reason codes, and finite communication direction codes.
The strict JSON adapter rejects wrapped, partial, extra-field, duplicate, and malformed output.
Planner or voice failure retains the committed structured action.

`AgentExecutionMode` explicitly distinguishes `raw-llm`, `compatibility`, `structured-only`,
`hybrid`, heuristic, random, and external execution. Private traces and architecture artifacts join
the mode to actual scorer, planner, voice, brain, and policy versions. The architecture benchmark
accepts an opt-in custom factory only with an explicit paid declaration and validates every
declared component against runtime traces. This enables API-free composed comparisons without
adding composed agents to the registry or changing the production default.

Independent review found and corrected mutable planner inputs and component-version time-of-check
gaps, discarded override reasons, semantic reason spoofing, dominated proposal exposure, permissive
JSON salvage, private voice fields, and incomplete stdio/artifact relations. The final adversarial
review approved the corrected boundary after 74 focused API-free tests. A matched free ten-case
bank compared compatibility, structured-only, and fake-client hybrid with zero forced violations,
zero degradation, zero recorded calls, and zero cost. A separate 60-case good-target comparison
improved vote truth accuracy from `55.5%` to `70.9%`; initial clean-team proposal rate moved from
`49.3%` to `47.1%` and good wins from 8/60 to 6/60, both inconclusive at this sample size but not
evidence for promotion. Phase 4 therefore closes as an opt-in technical foundation, not as a
production-default recommendation. Parent verification passed 178 focused tests and all 612
repository tests, including frozen decision fixtures, raw prompt hashes, deterministic replay,
hidden-information boundaries, stdio/trace attribution, and screenshot freshness. A final standard
ten-case autopilot bank also completed with 7/10 target-side wins, zero forced violations, zero
degradation, zero calls, and zero cost.

### Structured decisions

- [x] Propose teams using joint team-clean probability, not summed suspicion.
- [x] Vote using current-team probability, best-alternative value, score, and hammer position.
- [x] Preserve information-seeking only when future quests remain.
- [x] Add calibrated stochasticity or a viable-candidate band so play does not become mechanical.
- [x] Attach selected reasons and uncertainty to the communication intent.

### Hybrid planning

- [x] Let the LLM choose among non-dominated candidate teams or social plans.
- [x] Require any override of the top numerical candidate to name a permitted strategic reason.
- [x] Reject planner output that references an absent candidate or contradicts a forced rule.
- [x] Keep deterministic structured choice available as an ablation and fallback.

### Rollout

- [ ] Run paired good-side games against the current prompt-guided agent.
- [ ] Compare all-good proposal rate, approval quality, forced violations, cost, and win rate.
- [ ] Conduct human playtests for predictability, variety, persuasiveness, and perceived fairness.
- [ ] Promote the hybrid brain to the default only after it improves competence without making
      table talk sterile.

### Exit gate

The production agent's good-side proposals and votes are causally driven by the exact posterior, and
the structured-only, hybrid, and raw-LLM modes can be compared independently.

**Status:** met for the opt-in composed policy. Exact posterior causality is pinned at the
score/value/action boundary, and every experiment cell has explicit runtime attribution. Promotion
is intentionally not met: the raw-LLM comparison requires paid permission, the current free outcome
sample is inconclusive, and human predictability/persuasiveness testing has not run.

Non-blocking Phase 4 follow-ups:

- [x] Persist the admitted planner-reason subset separately for non-speech vote overrides.
- [x] Expand matched outcome evaluation before interpreting win-rate or clean-proposal movement.
- [ ] **NB-002:** Run the paid raw-LLM comparison and human playtests only with explicit permission.

### Phase 4D evaluation-hardening record

`plannerReasonCodes` now records only the reason subset admitted by the planner boundary, separately
from speech-bearing communication intent. `structuredCandidateId` distinguishes the scorer choice
from the committed candidate, so non-speech vote overrides are attributable without inferring
behavior from score order. The stdio boundary joins both fields to the chosen score and permits only
feature-derived override reasons; traces created before these additive fields remain accepted.

`phase4-good-v1` freezes 180 good-side target deals: ten deals each for Merlin, Percival, and the
first Servant seat at every supported player count. `npm run phase4-policy-bench` compares
compatibility, seeded structured-only, and bounded fake-client hybrid agents on identical deals and
heuristic opponents. The architecture report now includes Wilson intervals for per-variant rates,
deterministic paired-bootstrap intervals for matched deltas, clean initial proposals, vote truth
accuracy, selected posterior regret, planner overrides, seeded vote variation, approve rate,
target-seat median/p95/max latency, degradation/cost, and structural privacy and trace-attribution
counters. The privacy counter is a canary for private trace keys or exact private intent values in
public output; the exhaustive knowledge/leak tests remain the authoritative semantic boundary.

The full API-free run completed 540 games with zero forced violations, degradation, calls, cost,
structural privacy findings, or attribution mismatches. Against compatibility, structured-only
improved vote truth accuracy by `14.6` points (paired 95% interval `10.9` to `18.3`) but reduced
target-side wins by `11.7` points (`-17.8` to `-5.6`). Fake-client hybrid improved vote truth by
`13.7` points (`9.9` to `17.7`) but reduced wins by `8.3` points (`-14.4` to `-2.2`). Clean initial
proposal deltas included zero. Seeded variation activated on about `27%` of scored votes, and the
adversarial fake planner exercised an admitted override on `34.6%` of its selections. Median target
decision latency stayed below `1 ms`; p95 was below `100 ms`. This larger result supersedes the
temporary 60-case estimate and is evidence against production promotion, not a reason to spend on
the current candidate.

---

## 10. Phase 5: soft mechanical likelihoods

### Data contract

- [x] Version game artifacts with agent, model, prompt, policy, and factor identifiers.
- [x] Define training rows from public information only.
- [x] Split data by game and opponent population to avoid leakage.
- [x] Keep evaluation deals and human-study games out of training.

### Factors

- [x] Implement an analytical quest-card factor using score, quest number, Fails required, known
      coordination, and slow-play assumptions.
- [ ] Add conservative proposal and vote lookup factors.
- [ ] Add per-agent or per-population tendencies only when sample sizes support them.
- [x] Cap every implemented factor's log-likelihood contribution.
- [x] Add factor-level provenance to belief traces.

### Calibration

- [x] Log loss and Brier score.
- [x] Player-alignment and team-clean calibration curves.
- [x] Held-out comparison against uniform feasible worlds.
- [x] Sensitivity to a seeded-random opponent-population shift.
- [ ] **NB-003:** Repeat calibration against a versioned target-model or human population when
      suitable artifacts exist.
- [x] Quest-factor ablation.
- [ ] Proposal- and vote-factor ablations when those factors exist.

### Exit gate

Weighted beliefs improve held-out calibration or decision quality over uniform feasible worlds.
Factors that do not improve a measured outcome remain disabled.

### Phase 5A foundation record

All belief projections now consume normalized world weights. Player and role marginals, team-clean
probability, evil-count distributions, entropy, top worlds, decision analysis, and Phase 4 proposal
and vote features share the same weighted joint distribution. The constraints-only path preserves
its exact historical values and frozen prompt bytes. Weighted snapshots carry factor-level
provenance and typed degradation, and composed cognition accepts an injected, versioned belief
model while continuing to default to `exact-constraints-v1` with factors off.

New artifacts include a strategy-version manifest derived from agent descriptors, architecture
metadata, and admitted traces. `mechanical-public-rows-v1` extracts proposal, vote, and quest rows
only from public events; deterministic game-plus-population splits keep every game in one partition,
and architecture-bank or human-study artifacts are excluded from training. Tests prove that
changing hidden roles and private events cannot change these rows. `belief-calibration-v1` provides
Brier score, log loss, player-alignment and team-clean reliability curves, population slices, and
paired held-out deltas. This is measurement infrastructure, not evidence that a factor is
calibrated; the first real uniform-versus-weighted comparison remains a Phase 5B gate.

### Phase 5B quest-card factor record

`analytical-quest-card-v1` weights only worlds already admitted by the exact model. It consumes
public resolved-quest card counts and contextualizes evil card choice by quest number, board score,
Fails required, evil count aboard, non-Oberon coordination, Oberon independence, and whether the
board makes slow play plausible. A five-percent uniform mixture keeps every legal public outcome
nonzero. The complete quest-history contribution is capped at `ln(2)`, so this factor alone can
move posterior odds by at most `2:1`. Factor failure omits the update, records typed degradation,
and preserves a complete constraints-only agent; impossible worlds are never revived.

The frozen `phase4-good-v1` deal bank was replayed through four API-free lanes: uniform and
quest-weighted structured policies for causal decision measurement, plus uniform and
quest-weighted compatibility mechanics for an identical-outcome calibration comparison. Across
`122,796` matched predictions, weighting improved Brier score by `0.001189` and log loss by
`0.003827`. Player-evil predictions improved by `0.008522` Brier and `0.017847` log loss; team-clean
predictions improved by `0.000599` and `0.002699`.

On the 180 matched structured-policy games, weighting raised wins from `21/180` (`11.7%`) to
`32/180` (`17.8%`), a paired gain of `6.1` points with a 95% interval of `2.2` to `10.0`. Clean
initial proposals improved by `7.6` points (`2.5` to `12.8`) and truth-aligned votes by `2.0`
points (`0.2` to `3.8`). Median target-decision latency fell from `0.98 ms` to `0.89 ms`; weighted
p95 was `121.52 ms`. All 720 games completed with zero provider calls, cost, degradation,
hidden-information canary findings, or trace-attribution mismatches.

The same four lanes and frozen deals were then replayed with every non-target seat changed from
heuristic to seeded random. The shifted population retained smaller calibration gains: Brier
improved by `0.000471` and log loss by `0.001208` across `145,444` matched predictions.
Player-evil and team-clean Brier improved separately by `0.003639` and `0.000225`. Weighted policy
wins moved from `100/180` to `102/180`, a nonsignificant `1.1` points (`-3.9` to `6.1`), while clean
initial proposals improved by `4.4` points (`-1.0` to `9.7`) and truth-aligned votes by `4.3`
points (`2.6` to `6.1`). The two-population gate therefore covers 1,440 games with no calls, cost,
degradation, hidden-information findings, or attribution mismatches. It establishes robustness to
one substantial free shift, not calibration for arbitrary humans or named models.

This passes the Phase 5 exit gate for the quest factor, not the production-promotion gate. The
weighted structured policy remains below Phase 4D compatibility's `42/180` (`23.3%`) win rate.
The factor stays opt-in, proposal/vote factors remain unimplemented, and the next step requires a
human choice between another mechanical iteration and a deliberately small paid/human study.

### Phase 5C vote-conversion diagnosis

The frozen 180-deal bank was replayed through four API-free lanes: compatibility; quest-weighted
good proposals with compatibility votes; the same proposals with deterministic top-utility votes;
and the same proposals with seeded-band votes. A post-hoc full-reveal report measures quest
success, assassination reach and survival, win-reason transitions, clean-team rejection,
dirty-team approval, role and player-count slices, and deterministic game-paired intervals.
Full-reveal labels never enter a running agent.

Against heuristic opponents, compatibility won `42/180`; proposal-only won `47/180`, a `+2.8`
point paired delta with a 95% interval of `-0.6` to `+6.1`; top-utility won `33/180`, a `-5.0`
point delta (`-10.6` to `+0.6`); and seeded-band won `32/180`, a `-5.6` point delta (`-12.2`
to `+0.6`). Proposal-only increased assassination reach from `68/180` to `77/180` while leaving
conditional survival effectively unchanged. Top-utility substantially reduced both vote-error
classes, yet conditional assassination survival fell by `11.8` points (`-24.2` to `-0.2`) and
Servant wins fell from `16/60` to `9/60`. Better literal vote classification did not convert into
better play against the primary strategic population.

Against seeded-random opponents, compatibility won `83/180`; proposal-only won `92/180`, a
significant `+5.0` point delta (`+1.1` to `+9.4`); top-utility won `108/180`, a `+13.9` point
delta (`+6.1` to `+21.7`); and seeded-band won `102/180`, a `+10.6` point delta (`+2.2` to
`+18.9`). The structured vote policies improved quest success, assassination reach, and both
vote-error classes in this shifted population.

All 1,440 games completed with zero calls, cost, degradation, hidden-information findings, or
trace-attribution findings. The population sign flip closes Phase 5C as a diagnosis, not a
promotion. Proposal-only is the most robust current candidate, while the v1 vote scorers remain
ablations. Adding proposal or vote likelihood factors would not resolve this action-conversion
ambiguity. Further vote-policy iteration now requires an explicit target-population decision or a
small paid/human study; production defaults remain unchanged.

Non-blocking Phase 5C follow-up:

- [ ] Reuse the architecture report's complete matched-table validator in the direct conversion
      report API. The supported benchmark path already runs that validator first, so this is
      defense-in-depth for callers that invoke the post-hoc report directly.

---

## 11. Phase 6: bounded language evidence and commitments

### Phase 6A public-language contract record

`public-language-input-v1` projects only public attributed pitches, discussion statements and
leans, and proposal-revision reasons from `PlayerView`. The nested projection is an explicit
allow-list rather than an object spread, so later private or unreviewed view fields do not cross the
boundary automatically. Every interpreting seat receives the same projection. Player-authored text
is labeled untrusted data and remains data, never instructions.

The contract also defines finite evidence classes, directions, confidence buckets, subjects,
source sequences, a public rationale, an interpreter version, and a monotonic cursor. Admission
validates the complete input and output at runtime, canonicalizes provider-controlled ordering,
rejects duplicate or stale sources, and advances across public events that contain no speech.

Phase 6A is a schema and safety foundation, not operational language inference. By itself it makes
no provider call, maps no evidence to likelihood ratios, changes no posterior or policy, and adds
no persistent language state to cognition. Phase 6B now supplies the likelihood mapping below;
Phase 6C still owns runtime interpretation and persistent state, so the Phase 6 exit gate remains
open until the bounded path executes end to end.

### Phase 6B bounded-language factor record

`bounded-language-likelihood-v1` is a pure, API-free factor over a supplied normalized joint-world
posterior. It accepts only admitted finite evidence and a narrow attribution context containing
the viewer seat, public cursor, player count, interpreter version, and canonical source
sequence/speaker pairs. Raw utterance text, player names, public rationale, plans, private events,
and posterior summaries cannot enter the likelihood arithmetic.

The initial hand-authored mapping is deliberately weak and symmetric: low, medium, and high
confidence apply likelihood ratios of `1.02`, `1.05`, and `1.10` to worlds whose subject
alignment matches the interpreted direction. Evidence class is attributable but does not alter
strength. `unchanged` reads and the viewer's own speech are exact no-ops, and the entire language
history is capped to a maximum relative-odds span of `1.25:1`.

Admission requires exact agreement among the Phase 6A cursor, the cited evidence sources, and the
current public-language projection. The public cursor is intentionally distinct from the
seat-visible belief cursor, which may include private trailing events. The factor reweights all
and only positive worlds from the supplied exact or mechanically weighted posterior, so it cannot
restore an impossible world. It preserves prior provenance and degradation, appends attributable
source/version records when active, and returns the supplied mechanical posterior with typed
degradation on contract or computation failure.

This chunk remains behaviorally inert: it adds no interpreter, provider, registry entry, prompt,
runtime wiring, or default change. Phase 6C owns the opt-in orchestration and persistent language
state required to make the path execute end to end.

### Phase 6C orchestration record

The opt-in composed agent now snapshots an injected interpreter identity, projects only the new
public utterance batch, admits finite evidence once, infers the configured exact or mechanically
weighted posterior, applies the cumulative Phase 6B factor, and atomically commits cognition before
analysis or scoring. `CognitionState` owns admitted private reads and their public cursor separately
from mechanical evidence, commitments, the seat-visible cursor, and the actual resolved belief.
Language-off execution retains its prior stage order, decision behavior, component values, and
trace shape.

Interpreter errors, malformed replies, invalid runtime versions, and version drift fail closed.
A validated batch advances once without evidence, so a repeated decision cannot repeat an
interpreter call. An input-projection failure retains the previous language state for a later
retry. Unexpected belief or cognition failure commits no candidate language state. Valid evidence
remains admitted even when its likelihood factor degrades, while the legal mechanical path
continues.

Private traces identify the public input/cursor schemas, stable interpreter identity, likelihood
factor and bundle, cursor, newly admitted sources, cumulative sources, and typed degradation,
without retaining player text, names, rationales, provider payloads, or private view fields. Stdio
validation couples that block to the declared bounded-language components, cursor, and language
factor provenance. A safe sentinel attributes invalid interpreter identities without copying
arbitrary runtime values.

The implementation remains a fake-tested injection seam. It adds no OpenRouter adapter, prompt,
registry entry, production default, paid call, language-strength tuning, special-role objective,
search, or factor graph. The standard architecture bank has discussion disabled and therefore
proves zero-cost configured attribution without active interpretation. Phase 6D's separate
public-dialogue bank closes the former NB-004 evaluation gap without changing this baseline.

### Phase 6D public-record consolidation

`PublicRecord` is now the single typed owner for public board state consumed by deterministic
prompt facts and the language interpreter context. Its projection is an explicit nested allow-list
with detached arrays and rows. It carries public players and names, roles in play, phase and board
position, quests, proposals, votes, and public result, but no viewer identity, role, alignment,
private information or events, cognition, posterior, plans, or language reads.

The Phase 6A `publicContext` is a direct type alias and projection of this record. The compatibility
dossier derives all board, quest, vote, lead, and per-player rows from the same record; the adapter
passes the viewer seat separately only for the existing “Your resolved public positions” callout.
Frozen dossier, complete language-input, and raw-prompt bytes are unchanged. Cross-seat equality,
5–10-player coverage, private canaries, detached-copy tests, and the full API-free suite close
NB-001B without changing policy, prompts, providers, or defaults.

### Phase 6D active-language evaluation

The frozen `standard-v1` architecture bank remains a no-discussion mechanical baseline. A separate
`public-dialogue-language-v1` bank and explicit versioned profile exercise the complete opt-in
bounded-language path with a deterministic, evaluation-only interpreter. Stable configured
mechanical-belief and belief-pipeline identities are recorded separately from the actual snapshot
version used by each decision; benchmark, report, stdio, and artifact validation enforce that the
stable fields appear only on the bounded-language path.

The pinned case made 9 fake-interpreter calls, admitted 19 active reads, and produced 16 target
traces containing both exact and exact-plus-bounded snapshot versions in one game. Replay was
identical, every actual snapshot matched its trace attribution, and the run recorded zero
degradation, LLM calls, cost, telemetry, hidden-information violations, or attribution violations.
The case is an architecture and safety test, not a statistical gameplay evaluation. NB-004 is
closed without provider wiring, prompt changes, production defaults, or strength tuning.

### Interpreter

- [x] Process only new attributed utterances.
- [x] Return a finite evidence class, direction, confidence bucket, subjects, and source sequences.
- [x] Require a public rationale tied to the cited utterance or event.
- [x] Deduplicate repeated interpretations of the same source.
- [x] Map the schema to capped, versioned likelihood ratios outside the LLM.
- [x] Prevent language evidence from reviving impossible worlds.

### Typed memory

- [x] Make `CognitionState` authoritative for composed mechanical and language inference.
- [x] Store beliefs, commitments, language reads, and the public language cursor separately.
- [x] Persist selected and engine-applied current-plan state after engine legality succeeds.
- [ ] Add role-specific social models when their owning phases begin.
- [ ] Retain natural-language private notes only as a lossy voice aid and reveal feature.
- [x] Keep composed actionable beliefs and literal public promises out of scratchpad prose.
- [ ] Retire scratchpad-only authority from remaining raw-LLM compatibility paths.

### Coherence

- [x] Detect finite literal conflicts between the applied plan and prior public commitments.
- [x] Commit maintain, conceal, or deceive intent before engine application.
- [x] Distinguish strategic concealment or deception from accidental inconsistency in evaluation.

### Exit gate

Dialogue can change the posterior through a bounded, inspectable path, and turning language
evidence off leaves a complete mechanical agent rather than an amnesiac one.

**Bounded-language result:** passed by the opt-in composed path. Commitment-coherence work and a
real provider remain separate follow-ups; neither is required for the mechanical fallback.

---

## 12. Phase 7: role-specific observer and identity models

Phase 7 is implemented as bounded, sequential slices so each new authority is independently
reviewable and ablatable:

1. **Phase 7A, exact public observer:** infer complete public role worlds from `PublicRecord` only,
   keep exact role marginals separate from non-probabilistic behavioral indices, and prove the
   result is identical across viewing seats. **Complete.**
2. **Phase 7B1, joint identity projection:** aggregate role and hidden-team identity posteriors
   directly from complete weighted worlds without reconstructing correlations from marginals.
   **Complete.**
3. **Phase 7B2, plan memory and coherence:** persist selected and applied plans privately, add a
   post-legality outcome acknowledgment, and distinguish consistent conduct, accidental conflict,
   intentional concealment, and strategic deception. **Complete.**
4. **Phase 7C1, Merlin and Percival substrate:** derive exact private influence and pair
   posteriors plus bounded public exposure, mimicry, and decoy-opportunity proxies without changing
   policy. **Complete.**
5. **Phase 7C2, Merlin and Percival policy:** give the role-objective features bounded opt-in
   proposal and vote scoring authority without weakening forced policy, legality, or the base
   good-side scorer. **Complete.**
6. **Phase 7D1, evil/Oberon substrate and routing:** add a role-objective router, exact private
   visible-team or unseen-team projections, public standing, and explicitly non-probabilistic
   cover and burn proxies without changing policy.
7. **Phase 7D2, evil/Oberon proposal and vote policy:** add bounded opt-in failure-capacity,
   cover, and future-opportunity utility while keeping Oberon separate from visible-partner
   coordination.
8. **Phase 7D3, evil quest-card coordination:** add an exact-quota visible-partner convention and
   retain the robust all-Fail policy as a separately attributable ablation for mixed-agent tables.
9. **Phase 7E, Assassin:** add a capped, interpretable Merlin posterior that remains distinct from
   generic goodness.
10. **Phase 7F, evaluation and exit audit:** compare compatibility, base composed, observer,
   role-specific, and full configurations on a frozen API-free role bank, including virtual
   Assassin guesses derived only from seat-filtered views.

Every slice remains opt-in, records its component versions, preserves raw and compatibility
baselines, and lands only after independent review plus focused and complete API-free validation.
Phase 7 does not own paid calls, provider wiring, win-rate tuning, search, learned factors, a factor
graph, or production-default promotion.

### Public observer

- [x] Build a public-only evidence projection.
- [x] Estimate how a generic table observer reads each seat.
- [x] Exclude private knowledge and the agent's private posterior.
- [x] Treat the agent's own actions as evidence only in this observer model.

### Phase 7A implementation record

`exact-public-observer-v1` consumes only the canonical `PublicRecord`. It streams every complete
assignment of the public role multiset through public Fail-count constraints and a shared uniform
joint projection kernel, returning exact alignment and role marginals without retaining the worlds
in traces. Separately labeled deterministic indices summarize public proposal leadership,
selection, approval, and failed-quest exposure; they are not probabilities and never reweight the
exact posterior. The same public action has the same effect regardless of which seat owns it.

The observer is opt-in, policy-inert, and absent from default prompts and traces. Enabled runs carry
a bounded private snapshot and explicit component identity through composed traces, stdio,
artifacts, architecture benchmarks, and safety reports. Cross-seat and private-canary tests cover
5–10 players. Names and role input order do not affect arithmetic, cached projections return
detached data, deterministic replay is exact, and forged observer-on/off attribution is rejected
while historical observer-absent artifacts remain valid.

The legal maximum-special 10-player cast contains 151,200 complete worlds. NB-005 validation
measured about 77 ms cold, effectively immediate cached replay, and a 5,727-byte snapshot; parent
focused validation measured about 86 ms cold. The former 907,200-world stress fixture contained six
evil roles and was not a legal 10-player cast, so it was replaced and is now pinned as invalid.
NB-005 also requires externally supplied snapshots to reconstruct a legal cast, match raw and exact
lattice probability semantics, and stay within that cast's multinomial world-count ceiling.

### Identity and coherence substrate

- [x] Project bounded role-to-seat hypotheses by summing complete-world probabilities directly.
- [x] Project hidden evil-team hypotheses without multiplying independent seat suspicions.
- [x] Bind private identity snapshots to a legal canonical cast, source belief, and trace marginals.
- [x] Keep identity opt-in, private, attributable, and mechanically inert before role objectives.
- [x] Persist selected and engine-applied plans through a post-legality acknowledgment.
- [x] Classify literal commitment consistency, accidental conflict, intentional concealment, and
      strategic deception without parsing generated prose.

### Phase 7B1 implementation record

`joint-identity-projection-v1` consumes the final resolved private `BeliefSnapshot`, including
opt-in quest and language weights, and groups complete worlds into bounded canonical hypotheses.
Each role query requests every copy of its named roles, so duplicate Servant and Minion assignments
remain sets of seats and multi-role queries preserve correlations such as Merlin versus Morgana.
The optional hidden-team projection groups full evil-seat sets. No projection reconstructs a joint
probability from independent marginals.

The substrate is opt-in and mechanically inert. Its private snapshot and component version are
attributed through composed traces, stdio, artifacts, architecture benchmarks, and safety reports;
identity-off and typed projection-degradation paths remain independently measurable. The external
boundary requires a legal canonical public cast, exact role multiplicities, role/alignment
agreement, dense bounded arrays, correct evil-team cardinality, and agreement among queried role
marginals, hidden-team marginals, the trace belief marginals, and the host-known cast. Identity data
does not enter `PlayerView`, public cognition, the public observer, public logs, prompts, or policy.

Hand-worked joint sums, duplicate-role sets, input-order invariance, seat rotation, deterministic
replay, partial scopes, weighted provenance, malformed external snapshots, stale-state removal,
degradation, and observer/identity orthogonality are covered. A 10-player Servant projection over
60,480 seat-filtered worlds completed in about 176 ms and produced a roughly 10.4 KB validated
snapshot. Phase 7B2, rather than this projector, owns private plan memory and coherence.

### Phase 7B2 implementation record

`private-plan-memory-v1` records a bounded private history only after an action has passed engine
legality. The engine snapshots untrusted decisions once, validates the complete action before
emitting thinking or scratchpad events, and returns the canonical action reconstructed from its
authoritative event transaction. Selected-applied, agent-error fallback, and illegal-decision
fallback are explicit. Optional cognition and trace acknowledgment run after that transaction and
cannot re-enter legality or stall either simulator or live-server play.

Each provisional plan trace commits `maintain`, `conceal`, or `deceive` intent before application.
`literal-coherence-v1` then compares the engine-applied action with finite typed lean and team
commitments, producing consistent, accidental-conflict, intentional-concealment, or
strategic-deception classification without interpreting generated prose. Ordinary explained
revisions remain consistent; the model detects only its six narrow conflict codes. The component
is mechanically inert, and plan-memory-off decisions remain behaviorally identical.

The runtime host owns request, seat-filtered view, selected decision, provisional trace, resolution,
and canonical applied action. Finalization may add only the validated current outcome and expected
resolution markers; it cannot promote plan mode, relabel intent, rewrite stable telemetry, or
persist an action different from the engine transaction. Offline evaluation independently replays
the complete target-seat decision set, requires exactly one trace per authoritative decision,
reapplies selected decisions to distinguish legal normalization from illegal fallback, and applies
the same joins in benchmark admission and reporting.

External plan data requires exact keys, plain detached data, canonical dense arrays without
expandos, safe bounded coordinates, JSON-stable values, a 128-entry history limit, and a 4 MB UTF-8
serialized ceiling. Stdio cannot claim post-legality outcomes or their degradation before the host
applies an action. Plan state remains absent from `PlayerView`, public cognition, public logs,
prompts, the public observer, and policy.

Focused validation passed 23 Phase 7B2 tests, a 78-test engine/replay/stdio/architecture matrix, an
8-test adjacent identity audit, and all 732 API-free repository tests. Independent adversarial
review covered mutation, normalization, fallback, replay, trace-cardinality, intent, sparse-array,
serialization-hook, and boundary-attribution forgeries. No client, prompt, provider, paid-call,
default-policy, search, learned-factor, or factor-graph change was included.

### Merlin and Percival

- [x] Add exact Merlin influence and bounded public conspicuousness and exposure proxies.
- [x] Add a Merlin/Morgana pair posterior for Percival.
- [x] Add candidate-conditioned pair-knowledge, Merlin-mimicry, and self-decoy-opportunity proxies.
- [x] Give proposal and vote candidates bounded role-objective scoring authority.
- [x] Prove causal score and action changes while forced policy and base-scorer degradation remain
      authoritative.

### Phase 7C1 implementation record

`merlin-percival-objectives-v1` activates only for seats actually dealt Merlin or Percival. Merlin
candidate assessments sum the resolved private hidden-team hypotheses directly into a complete
evil-count distribution, exact team-clean probability, and the probability that a team can meet
the current quest's one- or two-Fail threshold. Public team context is computed separately from the
uniform public feasible-world projection. Its compact alignment-mask histogram retains
multiplicity, so no joint quantity is reconstructed from independent seat marginals.

Percival's pair posterior is a direct complete-world sum over ordered Merlin/Morgana assignments.
Casts without Morgana retain an explicit `morganaSeat: null` coordinate, and every hypothesis is
bound to the candidate seats in Percival's filtered private view. Exact public Merlin- and
Morgana-on-team probabilities come from sums of the unique-role marginals. Their difference from
the private pair influence feeds bounded pair-knowledge, Merlin-mimicry, and self-decoy-opportunity
indices. These and Merlin's conspicuousness and Assassin-exposure values are explicitly labeled
deterministic proxies, not calibrated Assassin probabilities. A no-vote sentinel contributes no
approval extremity until a complete public vote has actually occurred.

The component is opt-in, private, deterministic, and mechanically inert. It does not alter scores,
candidate viability, selected actions, prompts, voice, `PlayerView`, public cognition, or defaults.
External snapshots require strict plain detached data, exact keys, dense arrays, safe coordinates,
semantic equations, authoritative request/view/candidate/observer/identity recomputation, and a
1 MB UTF-8 ceiling. Stdio and offline evaluation reject missing recomputable payloads disguised as
degradation. Architecture metadata distinguishes a configured role-objective variant from
Merlin/Percival-only trace applicability, so the same variant completes the full frozen role bank
while ineligible roles carry no role-objective payload, version, or degradation marker.

The legal 10-player maximum enumerates 151,200 complete public role worlds but caches at most 210
alignment-mask rows. Quest-four measurements covered all 252 legal teams: the Merlin snapshot was
about 165 KB and 115 ms cold, and the Percival snapshot about 197 KB and 26 ms warm. Independent
adversarial review covered joint arithmetic, no-Morgana semantics, filtered-view binding,
candidate-varying decoy features, serialization tricks, forged degradation and dependency
declarations, role applicability, full-bank attribution, privacy, replay, and policy inertia.
Focused validation passed 64 tests and the complete API-free suite passed 745 tests.

### Phase 7C2 implementation record

`merlin-percival-role-utility-v1` is a private scorer-input projection layered over the unchanged
Phase 7C1 objective. Merlin's public failure capability is the exact public joint evil-count mass
at or above the current quest's failure threshold, so one evil on the 7-or-more-player fourth quest
is not mislabeled as able to fail it. Private influence, public influence, directional knowledge
tell, public ambiguity, and vote-gated own salience produce a bounded concealment proxy. Percival
combines the exact Merlin/Morgana pair influence with the explicitly non-probabilistic self-decoy
opportunity proxy. Neither role value is represented as a calibrated probability.

`merlin-percival-role-scorer-v1` and
`merlin-percival-role-seeded-band-v1` add a centered role adjustment equal to 0.20 times the
candidate role value minus the mean role value of the forced-policy survivors. The base value
remains the exact Phase 4 proposal clean probability or unadjusted vote utility. Proposals retain
only the canonical maximum combined value. Seeded variation is limited to the existing 0.04
combined-utility vote band and uses the game seed plus stable decision coordinates. Forced policy
remains authoritative, and engine legality remains final.

The scorer is opt-in. Ineligible seats and decision kinds resolve to the matching deterministic or
seeded Phase 4 good-side scorer without activating the Phase 7C1 payload. A failed role dependency
or malformed role score also resolves to that matching base; compatibility is used only if the
base fails. Traces distinguish the configured scorer from the scorer actually resolved. Role
reasons and exact composite uncertainty remain private to planning; voice receives only a
role-neutral qualitative confidence label and cannot change the committed mechanical decision.

Stdio, generation-time benchmark admission, and stored-report replay share a strict host join.
For the exact API-free role path it reconstructs the authoritative belief, identity scope, public
observer, Phase 7C1 objective, Phase 7C2 utility, legal candidates, Phase 4 analysis, forced-policy
surface, configured or fallback scorer output, seed bucket, and structured selection. Selected
pre-fallback decisions and authoritative applied decisions are joined separately, preserving
engine normalization and fallback semantics while rejecting score, selection, action, seed,
dependency-deletion, and fake-degradation forgeries. Zero-trace artifacts and public speech that
echoes the private role-policy marker are rejected.

Independent review covered the two-Fail threshold, exact complete-world sums, centered equations,
forced dominance, deterministic replay, configured-versus-resolved attribution, ineligible
fallback, plan-memory normalization, a legitimate hybrid in-band override, full dependency-chain
deletion, consistent base-posterior mutation, stored and generation-time action mutation, stdio,
voice privacy, and 10-player bounds. Focused validation passed 66 tests and the complete API-free
suite passed 758 tests. A free 10-case architecture bank admitted 102 of 102 target traces with
zero attribution, hidden-information, forced-policy, degradation, API-call, or cost findings. A
252-candidate 10-player role decision completed in roughly 144 ms in independent review. This
establishes architecture and safety correctness, not playing-strength promotion.

### Evil and Oberon

- [ ] Add `role-objective-router-v1` so each actual role resolves to one attributable objective
      model while preserving historical Merlin/Percival artifacts and preparing Assassin routing.
- [ ] Add exact public standing and explicit public burn and cover proxies with observation
      numerators and denominators; missing observations are not evidence of innocence.
- [ ] Add visible-evil objectives using only `{self, ...privateInfo.evilPartners}`. Never infer a
      partner seat or special-role identity, and never include Oberon in coordination.
- [ ] Add an Oberon joint posterior over unseen evil-seat sets by summing complete worlds. Keep
      unseen-evil-on-team probability distinct from coordination or Fail probability.
- [ ] Represent Assassin shot preservation, Morgana counterfeit cover, Mordred deep cover, Minion
      failure banking, and Oberon uncoordinated disruption as explicit attributable postures.
- [ ] Give proposal and vote candidates bounded failure-capacity-first utility. Failure capacity
      owns at least 70 percent of normalized value; cover and future opportunity together own at
      most 30 percent.
- [ ] Add a visible-partner exact-quota Fail convention with a public common designation and
      deterministic tie-breaking. Non-Oberon visible evil below the required quota still succeeds.
- [ ] Preserve the current robust all-Fail decisive policy as an opt-in ablation until Phase 7F
      measures exact-quota convention compliance on mixed-agent tables.

### Assassin

- [ ] Add a separate Merlin posterior.
- [ ] Use truth-tracking, proposal quality, vote accuracy, deliberate noise, and role-claim features.
- [ ] Keep the model interpretable until a learned alternative wins held-out tests.
- [ ] Record virtual Assassin guesses for all evil seats to increase evaluation sample size.

### Exit gate

Each special role has an explicit objective and appropriate posterior. None is implemented only as
extra prose appended to the generic good or evil prompt.

---

## 13. Phase 8: counterfactual value and optional learned inference

This phase starts only after earlier components plateau under stable evaluation.

- [ ] Sample complete worlds from `BeliefSnapshot`.
- [ ] Roll out candidate actions with cheap policies.
- [ ] Estimate quest value, information value, cover value, and assassination value separately.
- [ ] Add shallow search before full CFR or MCTS.
- [ ] Compare search against a stronger static value model at equal latency and cost.
- [ ] Consider a learned likelihood factor only after enough versioned artifacts exist.
- [ ] Consider a factor graph, variable elimination, or sampling only if measured world-model cost
      makes exact enumeration unsuitable.
- [ ] Preserve the exact solver as a correctness oracle for small casts and fixtures.

### Exit gate

A learned or search component remains only if an ablation shows value beyond the exact-belief
hybrid at acceptable cost and latency.

---

## 14. Cross-cutting test matrix

Every phase should update the applicable rows.

| Concern | Required coverage |
|---|---|
| Hidden information | Knowledge matrix, leak tests, public-observer isolation |
| Constraint soundness | True world never removed across every legal cast |
| Constraint completeness | Hand-worked fixtures produce the expected feasible set |
| Probability | Normalization, calibration, impossible-world zero mass |
| Symmetry | Seat-rotation and name-change invariance |
| Replay | Same view, seed, and versions reproduce the same mechanical state |
| Policy | Forced rules, legal candidates, reason-code coverage |
| Coherence | Committed decision matches pitch, reason, lean, and later trace |
| Degradation | Each failed component falls back without stalling |
| Evaluation isolation | Runtime code cannot access truth-only labels |
| Prompt safety | Existing injection, talk-norm, and hidden-role audits |
| Operations | Token cost, latency, fallback rate, artifact compatibility |

---

## 15. Removal ledger

Migration is not complete while superseded authority remains active.

| Current path | Remove or reduce when | Replacement |
|---|---|---|
| `RoleCertainties` compatibility renderer | Phase 3 typed rendering covers its prompt contract and equivalence tests pass | `BeliefSnapshot` plus typed analysis |
| Scalar `suspicion()` as primary good-side belief | Phase 4 structured policy passes | Team and player posterior projections |
| Forced-play triggers duplicated in prompt asks | Phase 3 central rules land | Executable forced policy plus rendered result |
| Free-form scratchpad as authoritative memory | Phase 6 typed cognition lands | `CognitionState` |
| LLM-generated arbitrary proposal as production default | Phase 4 hybrid candidate planner passes | Candidate IDs and committed plan |
| Prompt dossier and compatibility certainties as the default belief visibility | Phase 3 typed rendering covers their contracts; Phase 4 policy consumes the same analysis | Typed analysis rendered for policy and prompt |
| Generic "most good" assassination reasoning | Phase 7 target model passes | Merlin posterior |

Removal means deleting or demoting the old authority, not merely adding a new path beside it.

---

## 16. Progress log

Use this section for concise implementation history. Research corrections and design rationale
belong in their source documents; landed changes, measurements, and deviations from the plan belong
here.

- Initial document: target architecture and phased migration defined; Phase 1 selected as the next
  implementation step.
- Phase 0 seed contract: added the versioned `standard-v1` architecture bank. Its ten fixed cases
  cover 5 through 10 players, target every standard role, pin the dealt target seat, and disable
  discussion for the free mechanical baseline.
- Phase 0 comparison seam: added an architecture runner over the fixed bank plus a compact
  text/JSON report grouped by component versions, target role, decision/call kind, model, exact
  token cost, and degradation. Paid variants are refused unless the caller passes the explicit
  `--allow-paid` gate, and non-empty output corpora are refused before a run starts so duplicate
  cells cannot waste paid calls or invalidate the report.
- Phase 0 regression seam: froze representative `DecisionRequest` + `PlayerView` + heuristic
  decision fixtures through the existing verified replay path. The set covers every decision kind,
  special-role private-knowledge shapes, accumulated quest evidence, the two-Fail quest, and the
  assassination transition without exposing a raw `Game`.
- Phase 0 baselines and exit gate: recorded the ten-game free heuristic bank (7/10 target-side
  wins, zero forced-play violations, zero degradation) and summarized three already-paid
  prompt-guided playtests (21 seat-games, 576 decisions, 700 calls, $0.7852 transcript-rounded
  spend, one degraded finalize). No LLM call was made for Phase 0. Paired configuration checks and
  `PlayerView`-only frozen inputs satisfy the Phase 0 exit gate.
- Phase 1 exact worlds and exit gate: added deterministic multiset enumeration, complete private
  and quest constraints, the uniform `exact-constraints-v1` posterior, alignment/role/team/entropy
  projections, and cached deal-world reuse. `roleCertainties()` is now a joint-world projection
  with its old output and attribution contract. Hand-worked, rotation, exhaustive soundness, raw
  `Game` boundary, true-world retention, and all eight frozen-fixture expectations pass.
- Phase 2 typed cognition and exit gate: added stable typed evidence, literal commitment history,
  deterministic incremental/reconstructed cognition, one decision-ready analysis owner, compact
  exact-belief rendering, the explicit `exact-summary-v1` prompt experiment, and optional private
  artifact traces associated through replay. Default agents and policy remain unchanged. The
  repeatable 5/10-player belief and prompt benchmark closes the performance follow-up; uniform-only
  projections remain tracked for a weight-aware conversion before Phase 5.
- Phase 2 architecture checkpoint: confirmed the exit gate and full API-free suite, then identified
  that artifact metadata called normal LLM belief `none` even though normal prompts consume
  exact-world-derived compatibility certainties. Phase 3 begins by separating inference identity
  from belief visibility, then consolidates compatibility prompt paths and expands per-decision
  component versioning.
- Phase 3A component identity: added the centrally resolved `brain-spec-v1`, separated
  `exact-constraints-v1` inference from `compat-certainties-v1` and `compact-belief-v1`
  visibility, and derived runtime, public, preview/replay, and new artifact identities from that
  resolver. Legacy `beliefMode` remains a single validated adapter. Raw LLM, heuristic, random,
  and stdio behavior is unchanged, prompt bytes are pinned, and historical Phase 0 records retain
  their original semantics.
- Phase 3B central policy: added deterministic `legal-candidates-v1` and executable
  `forced-policy-v1`, routed `heuristic-policy-v2` and the forever fallback through typed cognition
  and situation analysis, and preserved every frozen decision plus the complete Phase 3A
  architecture-bank event-log hash. Exhaustive team candidates use a cheap known-Fails projection;
  prompt rule rendering, structured scoring, plan traces, and voice separation remain for Phase 3C.
- Phase 3C composed boundary: added the opt-in composed decision pipeline,
  `compatibility-scorer-v1`, ID-bounded planner contract, committed plans and communication intents,
  plan-driven discussion/proposal/revision voice, compatibility-safe trace-bearing agent outputs,
  complete component attribution, central forced-result rendering, and the optional stdio trace
  envelope. Raw prompt bytes and every production baseline remain unchanged; Phase 4 owns the
  first belief-driven policy and any production rollout.
- Phase 4A good proposal value: added opt-in `good-proposal-scorer-v1`, scorer-requested
  candidate-ID-keyed joint team assessments, batch alignment-mask projection, posterior-causal
  feature/value validation, deterministic ties, and hardened scorer/stdio boundaries. Compatibility
  remains the default and good-side vote policy remains Phase 4B work.
- Phase 4B good vote value: added analysis-owned current/best-alternative joint summaries,
  versioned board/runway/hammer/information utility, deterministic and game-seeded viable-band
  scorers, and end-to-end score/action/trace validation. Compatibility and Phase 4A remain distinct
  ablations; the composed brain is still opt-in.
- Phase 4C bounded hybrid: added feature-derived communication intent, private exact and public
  qualitative uncertainty, non-dominated planner candidates, strict fake-tested planner/voice
  adapters, explicit execution modes, and custom-factory architecture comparisons. Adversarial
  review closed mutation, semantic-reason, voice-leak, stdio, and artifact-attribution gaps. The
  composed brain remains opt-in pending paid and human rollout evidence.
- Phase 4D evaluation hardening: persisted the structured choice and admitted planner reasons,
  froze the 180-deal `phase4-good-v1` bank, and added reproducible compatibility,
  structured-only, and fake-client hybrid evaluation with rate confidence intervals, matched
  paired-bootstrap deltas, posterior regret, variation, latency, privacy canaries, and attribution
  checks. The full 540-game free run confirmed the vote-accuracy gain but found statistically
  adverse win-rate deltas, so Phase 5 begins from an explicit no-promotion result.
- Phase 5A foundations: converted every posterior projection and Phase 4 scorer join to normalized
  joint world weights, added an injectable versioned belief-model seam with provenance and
  degradation, versioned artifact strategy components, and added public-only mechanical rows,
  leakage-safe population/game splits, calibration scores, reliability curves, and paired
  comparison primitives. Default behavior and frozen prompt bytes remain unchanged.
- Phase 5B quest-card factor: added a public-mechanical, context-sensitive analytical likelihood
  with nonzero smoothing, a whole-factor `ln(2)` log-odds cap, impossible-world preservation,
  typed fallback, and factor-level trace attribution. Two 720-game four-lane held-out runs against
  heuristic and seeded-random populations improved both calibration targets with zero calls, cost,
  degradation, or safety findings. It remains opt-in because absolute wins against the primary
  heuristic population still trail compatibility.
- NB-001A typed compatibility certainties: routed normal compatibility knowledge prose through the
  explicit belief and situation-analysis boundary while preserving its prompt contract. Hard
  alignment deductions now inspect positive feasible-world support instead of rounded marginals,
  so arbitrarily small supported alternatives cannot become false certainties. Independent public
  dossier consolidation remains NB-001B and is deferred to the Phase 6 public-record boundary.
- Phase 6A public-language contract: added a public-only, versioned interpreter input, finite
  evidence output, and monotonic admission cursor without changing belief or policy behavior.
  Explicit nested allow-lists, cross-seat equality, complete runtime validation, canonical output
  ordering, lean-only attribution, and adversarial private-field canaries establish the boundary
  for later bounded language likelihoods.
- Phase 6B bounded-language factor: added a pure API-free likelihood layer over supplied exact or
  quest-weighted joint worlds. Finite direction/confidence ratios are symmetric and weak, class is
  strength-neutral, own and unchanged speech are no-ops, and the complete history is capped at
  `1.25:1` relative odds. Exact admission, cursor separation, support preservation, provenance,
  and typed fallback landed without runtime behavior changes.
- Phase 6C bounded-language orchestration: wired the Phase 6A and 6B contracts through opt-in
  composed cognition, deterministic fake interpretation, atomic persistent reads/cursor, actual
  posterior consumption by scoring, skip-once failure, stable brain/factor identity, and private
  stdio/artifact attribution. Independent review closed non-string version, missing attribution,
  cursor/provenance coupling, and full-world cloning defects. The standard no-discussion bank
  remains zero-cost and fully attributed; Phase 6D closes the former active-language comparison
  gap with a separate public-dialogue bank.
- Phase 6D public record: replaced independent language-context and prompt-dossier board
  derivations with one typed, public-only projection. Frozen dossier, full language-input, and raw
  prompt bytes remain identical; cross-seat, 5–10-player, private-canary, and detached-copy tests
  establish the shared boundary. NB-001B is closed without policy or default changes.
- Phase 6D active-language evaluation: separated stable configured belief-pipeline identity from
  each decision's actual belief snapshot and added a versioned public-dialogue bank driven by a
  deterministic evaluation-only interpreter. The pinned run made 9 interpreter calls, admitted 19
  active reads, and exercised both exact and bounded snapshots with zero degradation, calls, cost,
  telemetry, hidden-information findings, or attribution findings. The standard no-discussion
  bank and language-off trace shape remain frozen; NB-004 is closed.
- Phase 7A exact public observer: added a `PublicRecord`-only uniform posterior over complete public
  role worlds plus separately labeled non-probabilistic behavior indices. Shared streaming
  projection arithmetic keeps private and public exact marginals consistent without storing the
  151,200-world legal maximum-special cast in traces. Cross-seat, private-canary, symmetry,
  cache-isolation,
  replay, attribution, historical-artifact, and performance checks passed; the observer remains
  opt-in and mechanically inert. NB-005 records stronger external semantic validation before any
  observer payload becomes policy-authoritative.
- NB-005 observer semantic validation: externally supplied observer snapshots now require one
  canonical role set, raw and integer-lattice role/alignment agreement, safe aggregate counts, an
  engine-legal reconstructed cast, and a feasible-world count no larger than that cast's exact
  multinomial assignment count. All 71 legal casts pass as priors and constrained posteriors. The
  former six-evil 10-player performance fixture is rejected and replaced by the legal 151,200-world
  cast; NB-005 closes before observer data becomes policy-authoritative.
- Phase 7B1 joint identity: added bounded private role-assignment and hidden-team posteriors by
  summing resolved complete-world weights directly. Legal-cast, source-belief, trace-marginal,
  duplicate-role, cardinality, dense-array, stdio, artifact, and report joins prevent internally
  valid but falsely attributed identity payloads. The opt-in substrate is private, attributable,
  deterministic, observer-orthogonal, and mechanically inert; Phase 7B2 owns plan memory and
  coherence.
- Phase 7B2 plan memory and coherence: added engine-canonical post-legality outcomes, bounded
  private selected/applied plan history, precommitted maintain/conceal/deceive intent, and finite
  literal commitment classification. Engine application now snapshots untrusted decisions and
  validates them before private preamble emission; optional acknowledgment cannot re-enter
  legality. Runtime host joins and independently replay-derived benchmark/report joins bind the
  exact target decision set, selected resolution, canonical action, view cursor, stable trace, and
  coherence intent. Strict plain-data, dense-array, safe-coordinate, JSON-stability, and UTF-8 byte
  limits close external admission bypasses. The opt-in component remains private, mechanically
  inert, API-free, and absent from production defaults; Phase 7C owns Merlin and Percival policy.
- Phase 7C1 Merlin and Percival substrate: added exact private Merlin team influence and
  Merlin/Morgana pair posteriors, exact public joint-team context, and explicitly
  non-probabilistic exposure, pair-knowledge, mimicry, and self-decoy-opportunity indices. A
  multiplicity-weighted alignment histogram bounds repeated public projections without marginal
  products. Strict host recomputation, role-applicability, dependency, degradation, serialization,
  privacy, and full-bank attribution checks keep the component opt-in and mechanically inert;
  Phase 7C2 owns proposal and vote scoring authority.
- Phase 7C2 Merlin and Percival policy: added threshold-correct private role utility and bounded
  centered role adjustments over the exact Phase 4 proposal and vote values. Deterministic
  proposals use the canonical combined maximum; seeded votes vary only inside the 0.04 combined
  band. Forced policy, legality, matching base-scorer fallback, compatibility fallback, and
  configured-versus-resolved attribution remain explicit. Shared host replay reconstructs the
  exact dependency and score surface and separately binds selected and applied actions, rejecting
  score, seed, action, deletion, degradation, and speech-leak forgeries. The component remains
  opt-in, API-free, and absent from production defaults; Phase 7D is split into substrate/routing,
  proposal/vote policy, and quest-card coordination landings.
- Phase 5C vote-conversion diagnosis: added a reproducible four-lane funnel over the frozen Phase 4
  bank and ran both free populations for 1,440 games. Proposal-only improved or held outcomes in
  both populations, while top-utility and seeded-band votes were harmful against heuristic agents
  and strongly beneficial against seeded-random agents. The sign flip triggers the human checkpoint
  before further mechanical tuning, paid study, or rollout.
