# Agent architecture migration

**Status:** active tracking document.

**Current target phase:** Phase 2 complete; Phase 3 preflight is next.

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
| Agent boundary | `AvalonAgent.decide(req, view): Promise<Decision>` | Keep the concept; evolve the result contract |
| Agent construction | Registry maps heuristic, random, stdio, and LLM specs to agents | Extend with composed brains |
| LLM state | `createLlmAgent` closure owns a free-form scratchpad and reflection cadence | Replace as authoritative memory |
| Mechanical facts | `facts.ts`, `board.ts`, and `roleCertainties()` derive sound prompt facts | Reuse inside typed analysis |
| Hard role deductions | Exact complete worlds feed the temporary `roleCertainties()` projection used by normal LLM prompts | Keep exact worlds authoritative; consolidate the compatibility renderer during Phase 3 |
| Heuristic policy | `heuristic.ts` scores suspicion and directly chooses actions | Split into analysis, forced rules, and policy |
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
| Team-clean probability | Exact joint assessment is available through `SituationAnalysis` | Not yet wired into production policy |
| Candidate evaluation | Direct branch logic or free-form generation | No shared legal candidate and value layer |
| Forced plays | Executed in heuristic, described in prompts, graded separately | Definitions can drift |
| Persistent commitments | Typed literal public-position history plus natural-language notes | Not yet consumed by production policy |
| Language evidence | Whole transcript re-read by the LLM | No bounded, attributable belief update |
| Observer beliefs | Prompt heuristics for Merlin concealment and evil cover | No explicit model of public suspicion |
| Role-specific posteriors | Some hard candidate lists and assassination prompting | No independent Merlin/Morgana or Assassin distributions |
| Decision trace | Optional private trace records belief version, cursor, posterior context, reasons, action, and degradation | Add analysis, policy, renderer, prompt, and factor versions plus candidate scores |
| Brain/model/persona separation | Agent definition mostly configures an LLM and prompt layers | Strategic competence is coupled to prompt/model choice |

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

---

## 4. Phase overview

| Phase | Status | Outcome |
|---|---|---|
| 0. Preserve foundations and establish baselines | Complete | Stable comparison point and contracts |
| 1. Exact joint-world foundation | Complete | Uniform posterior over every feasible hidden world |
| 2. Evidence, analysis, and belief visibility | Complete | Typed incremental cognition and decision-ready summaries |
| 3. Composed agent and policy boundary | Next | Brain, model, persona, policy, and voice become separate |
| 4. Belief-driven production policy | Not started | Exact beliefs directly improve proposals and votes |
| 5. Soft mechanical likelihoods | Not started | Calibrated behavioral weighting of feasible worlds |
| 6. Bounded language evidence and commitments | Not started | Dialogue affects beliefs without owning them |
| 7. Role-specific observer and identity models | Not started | Merlin, Percival, evil, Oberon, and Assassin objectives |
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

- [ ] Make every posterior projection weight-aware before Phase 5 introduces non-uniform worlds.
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

- [ ] Separate the inference component from its visibility mode in agent configuration and
      architecture artifact metadata.
- [ ] Record normal LLM inference as `exact-constraints-v1` while it consumes
      `roleCertainties()`; reserve `none` for paths that perform no belief inference.
- [ ] Give compatibility certainty text and `compact-belief-v1` distinct visibility identifiers.
- [ ] Add a regression test proving that component labels match the inference and rendering paths
      actually exercised.

Non-blocking consolidation work during Phase 3:

- [ ] Route new policy code through `CognitionState` and `SituationAnalysis`; do not add another
      direct `PlayerView` arithmetic or prompt-only authority.
- [ ] Reduce direct prompt use of `roleCertainties()` and independently derived dossier facts after
      equivalent typed renderers pass tests.
- [ ] Expand decision traces with the analysis, policy, renderer, prompt, and applicable factor
      versions needed to attribute behavior to a complete brain configuration.

---

## 8. Phase 3: composed agent and policy boundary

### Agent composition

- [ ] Complete the component-identity preflight above before comparative evaluation.
- [ ] Introduce a brain configuration distinct from model and persona configuration.
- [ ] Add a composed `hybrid` engine or equivalent agent constructor.
- [ ] Preserve `raw-llm`, heuristic, random, and stdio modes as baselines.
- [ ] Adapt legacy agents to any new `AgentDecision { decision, trace }` result boundary.
- [ ] Extend custom-agent validation and public metadata without exposing private cognition.

Suggested configuration shape:

```ts
interface BrainSpec {
  belief: 'none' | 'exact-constraints-v1' | 'weighted-v1'
  beliefVisibility: 'none' | 'compat-certainties' | 'compact-belief-v1'
  policy: 'raw-llm' | 'structured-v1' | 'hybrid-v1'
  languageEvidence?: 'off' | 'bounded-v1'
  observerModel?: 'off' | 'observer-v1'
  searchBudget?: number
}
```

### Central policy

- [ ] Generate legal candidate actions in one module.
- [ ] Move forced-play triggers into executable policy rules with stable reason codes.
- [ ] Make the heuristic fallback consume the same analysis and forced-rule modules.
- [ ] Render forced-rule results into prompts rather than reimplementing triggers in `ASKS`.
- [ ] Add a structured candidate scorer.
- [ ] Add an LLM planner that may choose only from the supplied viable candidate IDs.
- [ ] Generalize commit-then-explain from proposals to revisions, discussion leans, and strategic
      claims.

### Exit gate

Facts, forced rules, candidate generation, policy, and voice have distinct owners. Deleting a
forced-play sentence from a prompt cannot remove the executable behavior, and changing a persona
cannot reset strategic state.

---

## 9. Phase 4: belief-driven production policy

The first production slice should be narrow enough to attribute gains:

1. exact uniform alignment worlds;
2. good-side proposal and vote decisions;
3. structured team assessment;
4. existing LLM for social planning and speech;
5. existing heuristic as final fallback.

### Structured decisions

- [ ] Propose teams using joint team-clean probability, not summed suspicion.
- [ ] Vote using current-team probability, best-alternative value, score, and hammer position.
- [ ] Preserve information-seeking only when future quests remain.
- [ ] Add calibrated stochasticity or a viable-candidate band so play does not become mechanical.
- [ ] Attach selected reasons and uncertainty to the communication intent.

### Hybrid planning

- [ ] Let the LLM choose among non-dominated candidate teams or social plans.
- [ ] Require any override of the top numerical candidate to name a permitted strategic reason.
- [ ] Reject planner output that references an absent candidate or contradicts a forced rule.
- [ ] Keep deterministic structured choice available as an ablation and fallback.

### Rollout

- [ ] Run paired good-side games against the current prompt-guided agent.
- [ ] Compare all-good proposal rate, approval quality, forced violations, cost, and win rate.
- [ ] Conduct human playtests for predictability, variety, persuasiveness, and perceived fairness.
- [ ] Promote the hybrid brain to the default only after it improves competence without making
      table talk sterile.

### Exit gate

The production agent's good-side proposals and votes are causally driven by the exact posterior, and
the structured-only, hybrid, and raw-LLM modes can be compared independently.

---

## 10. Phase 5: soft mechanical likelihoods

### Data contract

- [ ] Version game artifacts with agent, model, prompt, policy, and factor identifiers.
- [ ] Define training rows from public information only.
- [ ] Split data by game and opponent population to avoid leakage.
- [ ] Keep evaluation deals and human-study games out of training.

### Factors

- [ ] Implement an analytical quest-card factor using score, quest number, Fails required, known
      coordination, and slow-play assumptions.
- [ ] Add conservative proposal and vote lookup factors.
- [ ] Add per-agent or per-population tendencies only when sample sizes support them.
- [ ] Cap every factor's log-likelihood contribution.
- [ ] Add factor-level provenance to belief traces.

### Calibration

- [ ] Log loss and Brier score.
- [ ] Player-alignment and team-clean calibration curves.
- [ ] Held-out comparison against uniform feasible worlds.
- [ ] Sensitivity to opponent-population shift.
- [ ] Ablations for quest, proposal, and vote factors separately.

### Exit gate

Weighted beliefs improve held-out calibration or decision quality over uniform feasible worlds.
Factors that do not improve a measured outcome remain disabled.

---

## 11. Phase 6: bounded language evidence and commitments

### Interpreter

- [ ] Process only new attributed utterances.
- [ ] Return a finite evidence class, direction, confidence bucket, subjects, and source sequences.
- [ ] Require a public rationale tied to the cited utterance or event.
- [ ] Deduplicate repeated interpretations of the same source.
- [ ] Map the schema to capped, versioned likelihood ratios outside the LLM.
- [ ] Prevent language evidence from reviving impossible worlds.

### Typed memory

- [ ] Make `CognitionState` the authoritative persistent state.
- [ ] Store beliefs, commitments, social models, language reads, and current plan separately.
- [ ] Retain natural-language private notes only as a lossy voice aid and reveal feature.
- [ ] Stop using scratchpad prose as the only source for any actionable belief or promise.

### Coherence

- [ ] Detect contradictions between the current plan and prior public commitments.
- [ ] Let evil and Merlin intentionally violate a commitment when the policy marks it as deception
      or concealment.
- [ ] Distinguish strategic deception from accidental inconsistency in evaluation.

### Exit gate

Dialogue can change the posterior through a bounded, inspectable path, and turning language
evidence off leaves a complete mechanical agent rather than an amnesiac one.

---

## 12. Phase 7: role-specific observer and identity models

### Public observer

- [ ] Build a public-only evidence projection.
- [ ] Estimate how a generic table observer reads each seat.
- [ ] Exclude private knowledge and the agent's private posterior.
- [ ] Treat the agent's own actions as evidence only in this observer model.

### Merlin and Percival

- [ ] Add Merlin's influence-versus-conspicuousness objective.
- [ ] Score candidate actions for Assassin exposure.
- [ ] Add a Merlin/Morgana pair posterior for Percival.
- [ ] Model Percival's own decoy value.

### Evil and Oberon

- [ ] Add public trust and burned-teammate assessments.
- [ ] Add coordinated Fail-card policy using only visible partners.
- [ ] Add Oberon's posterior over unseen evil teammates.
- [ ] Add cover value and future quest opportunity to candidate scoring.

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
