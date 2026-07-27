# Agent architecture migration

**Status:** active tracking document.

**Current target phase:** Phase 0, preserve foundations and establish baselines.

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
| Hard role deductions | `roleCertainties()` computes per-seat possible-role sets and cardinality closure | Preserve tests; replace independent sets with joint worlds as authority |
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
| Complete feasible worlds | Per-seat possible-role sets | Cross-seat correlations are lost |
| Normalized posterior | Scalar heuristic suspicion and free-form LLM judgment | No common probabilistic semantics |
| Evidence ledger | Public view plus prompt text plus scratchpad | No typed, deduplicated update history |
| Team-clean probability | Re-derived heuristically or by the LLM | No authoritative joint team assessment |
| Candidate evaluation | Direct branch logic or free-form generation | No shared legal candidate and value layer |
| Forced plays | Executed in heuristic, described in prompts, graded separately | Definitions can drift |
| Persistent commitments | Partial derived dossier plus natural-language notes | No typed public-position history |
| Language evidence | Whole transcript re-read by the LLM | No bounded, attributable belief update |
| Observer beliefs | Prompt heuristics for Merlin concealment and evil cover | No explicit model of public suspicion |
| Role-specific posteriors | Some hard candidate lists and assassination prompting | No independent Merlin/Morgana or Assassin distributions |
| Decision trace | `thinking`, `notes`, degrade records, and eval artifacts | No component versions or candidate scores |
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
| 0. Preserve foundations and establish baselines | In progress | Stable comparison point and contracts |
| 1. Exact joint-world foundation | Blocked on Phase 0 exit gate | Uniform posterior over every feasible hidden world |
| 2. Evidence, analysis, and belief visibility | Not started | Typed incremental cognition and decision-ready summaries |
| 3. Composed agent and policy boundary | Not started | Brain, model, persona, policy, and voice become separate |
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
- [ ] Record current prompt-guided LLM results by role, decision kind, model, cost, and degradation.
- [ ] Record current heuristic results on the same seeds with discussion disabled.
- [ ] Freeze representative `PlayerView` decision fixtures for belief and policy regression tests.
- [ ] Add a compact architecture benchmark report format that can compare component versions.

### Exit gate

The baseline bank can compare two agent versions on identical deals and table configurations, and a
future belief model can be evaluated without changing the game engine.

---

## 6. Phase 1: exact joint-world foundation

This is the first implementation phase because it creates useful intelligence without requiring
training data or additional LLM calls.

### Domain and solver

- [ ] Add `HiddenWorld`, `WeightedWorld`, and `BeliefSnapshot` types.
- [ ] Implement canonical role-world enumeration from `rolesInPlay`.
- [ ] Add an alignment projection optimized for team decisions.
- [ ] Apply the viewing seat's own role and private knowledge as hard constraints.
- [ ] Apply resolved Fail counts as minimum-evil cardinality constraints.
- [ ] Normalize a uniform posterior over feasible worlds.
- [ ] Derive player alignment marginals and role marginals.
- [ ] Derive team-clean probability and evil-count distribution.
- [ ] Derive posterior entropy and top worlds.

### Reuse and cleanup

- [ ] Move the constraint rules embodied in `roleCertainties()` behind the world-model boundary, or
      make both consumers use one shared constraint module.
- [ ] Preserve the exhaustive tests proving no true role is eliminated in any legal cast.
- [ ] Keep the current `RoleCertainties` renderer temporarily as a projection of joint worlds.
- [ ] Remove any duplicated closure implementation once projections are equivalent.

### Tests

- [ ] Exact world counts for simple casts.
- [ ] Duplicate Servant and Minion roles do not create duplicate worlds.
- [ ] Own role is pinned in every world.
- [ ] Merlin, Mordred, evil partner, Oberon, and Percival visibility constraints are correct.
- [ ] A quest with `k` Fail cards removes every world with fewer than `k` evil members aboard.
- [ ] A zero-Fail success does not eliminate worlds merely because evil was aboard.
- [ ] Posterior probabilities sum to one.
- [ ] Team-clean and evil-count projections match hand-worked fixtures.
- [ ] Seat rotation rotates the posterior without changing probabilities.
- [ ] Solver APIs accept only `PlayerView` or typed evidence, never `Game`.

### Exit gate

For every frozen decision fixture, AvaLLM can produce a deterministic, exact, joint posterior and
correct team assessments using only the viewing seat's information. No production behavior has to
change yet.

---

## 7. Phase 2: evidence, analysis, and belief visibility

### Incremental cognition

- [ ] Add typed `Evidence` records keyed by visible event sequence.
- [ ] Add `CognitionState.throughSeq` and process each event once.
- [ ] Separate private evidence from the public evidence projection.
- [ ] Add a typed commitment ledger for proposals, votes, leans, and explicit claims.
- [ ] Reconstruct cognition deterministically from a full `PlayerView` for replay and recovery.

### Decision-ready analysis

- [ ] Move score, match point, hammer proximity, and known-Fails-aboard calculations into
      `SituationAnalysis`.
- [ ] Add current-team and candidate-team assessments.
- [ ] Express hard deductions with provenance: private deal, role-count closure, or quest record.
- [ ] Define stable reason codes for facts and forced-play triggers.

### Prompt visibility

- [ ] Add a compact belief renderer generated from `BeliefSnapshot` and `SituationAnalysis`.
- [ ] Distinguish `proven`, `uniform hypothesis share`, and later `weighted probability` in wording.
- [ ] Keep joint relationships such as "exactly one of A/B is evil" visible.
- [ ] Render the same summaries into prompt preview and live play.
- [ ] Add prompt audits for impossible certainty and private/public scope mistakes.

### Trace seam

- [ ] Introduce optional `DecisionTrace` data without exposing it to live opponents.
- [ ] Record belief version, event cursor, top hypotheses, team assessment, and degradation quality.
- [ ] Decide whether traces live in the main game artifact or a private sidecar.

### Exit gate

An explicit experimental agent can consume the exact belief summary, and offline artifacts can
compare its stated reasoning and actions with the posterior that existed at decision time.

---

## 8. Phase 3: composed agent and policy boundary

### Agent composition

- [ ] Introduce a brain configuration distinct from model and persona configuration.
- [ ] Add a composed `hybrid` engine or equivalent agent constructor.
- [ ] Preserve `raw-llm`, heuristic, random, and stdio modes as baselines.
- [ ] Adapt legacy agents to any new `AgentDecision { decision, trace }` result boundary.
- [ ] Extend custom-agent validation and public metadata without exposing private cognition.

Suggested configuration shape:

```ts
interface BrainSpec {
  belief: 'none' | 'exact-v1' | 'weighted-v1'
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
| Independent `roleCertainties` as final inference | Phase 1 projections match its tests | Joint world posterior |
| Scalar `suspicion()` as primary good-side belief | Phase 4 structured policy passes | Team and player posterior projections |
| Forced-play triggers duplicated in prompt asks | Phase 3 central rules land | Executable forced policy plus rendered result |
| Free-form scratchpad as authoritative memory | Phase 6 typed cognition lands | `CognitionState` |
| LLM-generated arbitrary proposal as production default | Phase 4 hybrid candidate planner passes | Candidate IDs and committed plan |
| Prompt dossier as the only belief visibility | Phase 2 belief renderer lands | Typed analysis rendered for the prompt |
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
