# Agent architecture migration

**Status:** active contract and remaining-work tracker. The architectural foundation through
Phase 7 is complete. Product promotion, selected behavioral models, and Phase 8 intelligence are
not complete.

The durable design contract lives in
[probabilistic-agent-architecture.md](probabilistic-agent-architecture.md). The original detailed
phase plans, implementation records, validation diary, measurements, and closed follow-ups are
preserved in
[agent-architecture-migration-history.md](agent-architecture-migration-history.md).

This file answers four current questions:

1. What architecture is implemented now?
2. What still prevents the composed agent from becoming the default?
3. Which work is active, blocked, or deliberately deferred?
4. What process and evidence are required before advancing?

---

## 1. Migration verdict

The structural migration is substantially complete. AvaLLM now has typed evidence, exact joint
beliefs, decision-ready analysis, role-aware policy, committed plans, bounded communication, and
private causal traces while preserving hidden-information and deterministic-replay guarantees.

The product migration is not complete. `Probabilistic` and `Probabilistic + LLM` are ordinary web
choices, but normal table fill still uses roster raw-LLM agents. The composed policy has not yet
shown enough cross-population strength or received enough human evaluation to replace that
default. Availability is not promotion.

No additional foundational rewrite is required before evaluating and improving the playable
agent. Future work should improve one measured layer at a time without weakening the boundaries
already established.

---

## 2. Current architecture

| Layer | Current authority | Status |
|---|---|---|
| Hidden information | `viewFor(game, seat)` and public projections are the only cognition inputs | Complete; preserve |
| Observation and memory | Typed evidence, commitments, public record, cursors, and `CognitionState` | Complete for composed agents |
| Hard inference | Exact feasible full-role worlds derived from the seat view | Complete; correctness oracle |
| Soft inference | Versioned, capped quest-card and bounded-language factors reweight feasible worlds | Partial; proposal and vote factors remain open |
| Analysis | Joint marginals, team-clean probability, situation analysis, public observer, identity, and role objectives | Complete foundation |
| Candidate and forced policy | Legal candidates, engine legality, and forced-policy precedence | Complete; mandatory safety kernel |
| Strategic policy | Ordered native score and decision layers with good, evil, Merlin, Percival, Morgana, Mordred, Oberon, and Assassin behavior | Complete architecture; strength still mixed |
| Planning and voice | Committed plan precedes structured-only or bounded LLM planner/voice rendering | Complete architecture; qualitative gate open |
| Attribution | Resolved brain descriptors, admitted traces, replay, artifacts, inspectors, and evaluation banks | Complete foundation |
| Baselines | Raw LLM, rule-based, random, compatibility, and isolated role components | Deliberately retained and attributable |

The implementation satisfies the six-part observation, constraint, belief, analysis, policy, and
voice decomposition. Optional components may be disabled or degrade independently, but engine
legality, forced policy, exact feasible-world inference, and a legal rule-based fallback remain
available without an LLM or precomputed behavioral data.

---

## 3. Non-negotiable migration rules

1. **Seat-view-only cognition.** Runtime agents never receive raw `Game`; truth joins occur only in
   offline evaluation after a decision is recorded.
2. **Joint probability.** Policies consume projections of complete hidden worlds, never products
   of independent suspicion scores presented as joint probability.
3. **Hard constraints before soft evidence.** A soft factor may reweight a feasible world but may
   not restore an impossible one.
4. **Forced policy remains authoritative.** Planning, scoring, role strategy, and voice cannot
   override an executable forced result.
5. **Engine legality remains final.** Invalid output degrades without stalling the game.
6. **Commit before communication.** Voice may explain, conceal, or strategically frame an action,
   but may not change the committed mechanical decision.
7. **Deterministic mechanics.** Mechanical variation uses the game seed and stable event sequence;
   every factor and policy assumption is versioned.
8. **Attributable alternatives.** Raw LLM, rule-based, random, compatibility, structured-only, and
   hybrid modes remain independently measurable.
9. **Data-enhanced, not data-dependent.** Optional calibrated bundles may improve strength, but
   sound inference and a complete structured policy work without them.
10. **Move authority directly.** Prefer one clear owner and deletion of superseded internal paths
    over adapters, duplicate writers, or indefinite dual representations.

---

## 4. Active gates and work register

Status values are `ready`, `review`, `human-checkpoint`, `permission-gated`, `data-gated`, or
`deferred`. Completed work belongs in the history document, not this table.

| ID | Work | Why it remains | Exit evidence | Status |
|---|---|---|---|---|
| EVAL-001 | Human play evaluation of `Probabilistic` and `Probabilistic + LLM` | Architecture tests cannot establish fun, persuasion, variety, perceived fairness, or whether the UI exposes useful attribution | Recorded qualitative sessions across roles and player counts, with fallback and silence defects separated from policy-quality feedback | `human-checkpoint` |
| EVAL-002 / NB-002 | Frozen paid comparison against raw LLM | Free populations do not represent the target LLM population, and prior paid observations are not a paired promotion study | Matched games tied to one commit, model roster, prompts, seeds, spend, latency, degradation, decision metrics, and transcript review | `permission-gated` |
| BELIEF-001 | Conservative proposal and vote likelihood factors | Current proposal and vote behavior affects policy but not the hidden-world posterior. Now measured rather than asserted: the `constraints-only` belief proposes `1.181` evil seats per team against the heuristic's `0.923`, identical at q1 and diverging from q2, which is exactly the behavioural evidence it discards. The FIRST step needs no new factor: enabling the shipped `analytical-quest-card-v1` on the same policy reaches `0.968` and the lowest dirty-team rate of any arm (`79` discordant pairs to `18`, `p = 2.7e-10`), beating the heuristic head to head. The remaining gap is the vote matrix, which no factor prices. | Wide-bank win rate in both populations plus a calibration reading for the quest-card promotion; versioned bounded likelihoods and held-out evidence for a new vote-matrix factor | `review` |
| BELIEF-002 | Promote `analytical-quest-card-v1` to a default | Gated on the wide bank's servant cell, `360` paired deals per population: clean proposal `+10.5%`/`+4.4%`, vote truth `+4.6%`/`+7.4%`, dirty-team approve `-10.2%`/`-10.0%`, every interval clear of zero, win rate unmoved in both. Calibration improves on player-evil and is neutral on team-clean; Merlin exposure does not rise. The first candidate to improve decision quality in both populations without regressing either. | Merlin and Percival cells on the same bank, an enumeration-cost profile, and a human decision, since it moves belief `quality` to `weighted` for every downstream consumer | `review` |
| CAL-001 / NB-003 | Target-model or human population calibration | Quest-card calibration currently covers synthetic heuristic and seeded-random populations rather than a production population | Whole-game train/evaluation split, named population, shrinkage for sparse players, calibration report, and provenance in traces | `data-gated` |
| POLICY-001 / NB-012 | Reduce Merlin exposure without sacrificing quest play | The new continuous metric confirms the defect: on the frozen Merlin bank, structured-only and hybrid play leak `+0.0086` and `+0.0105` more posterior lift than compatibility, respectively. The original concealment arm was removed, so this measures the problem rather than endorsing that attempted fix. | A revised bounded objective reduces paired exposure lift while preserving quest, vote, and cross-population decision quality, with causal attribution to the new component | `review` |
| POLICY-002 / NB-016 | Break information-poor good proposal ties | Reframed by measurement, and the framing matters more than the candidate. The `92.6%` in-argmax figure that motivated a tie-order rule is about FIRST proposals; across the channel it is `10.8%`, and the rule can act on `1.5%` of decisions. Meanwhile the compatibility heuristic seats `0.923` evil per team against the exact-posterior policy's `1.181` (`p = 7.7e-4`, 625 decisions), identical at q1 and diverging from q2, which is soft evidence the `constraints-only` belief does not use. The defect is in the posterior, not the ordering over it. | A behavioural likelihood factor under BELIEF-001 that improves proposal cleanliness in both frozen populations; a tie-order rule is no longer the expected shape | `review` |
| SOCIAL-001 | Finish typed social memory ownership | Composed cognition owns actionable beliefs and commitments, but raw-LLM compatibility still owns a free-form scratchpad; lossy private voice notes and role-specific social models remain optional | Any new social model has a typed owner and ablation; scratchpad-only authority is retired only with a promoted replacement | `deferred` |
| ASSASSIN-001 | Evaluate trajectory, deliberate noise, and trusted role-claim evidence | The current Assassin posterior is intentionally small and interpretable | Add a feature only after a typed trusted extractor and held-out ablation; never parse raw prose with regex as role truth | `deferred` |
| PHASE8-001 | Counterfactual value and optional learned inference | Static policy and evaluation must mature before search complexity is justified | Entry criteria in section 6 and a cost-matched ablation against the strongest static policy | `deferred` |

NB-012 and NB-016 are evaluated candidates that were deliberately withheld, not forgotten
branches. Their full measurements and rationale remain in the historical register.

---

## 5. Default-promotion gate

The composed agent may become the normal table-fill default only after all of the following are
true:

- The exact candidate commit, brain descriptor, factor versions, policy versions, model roster,
  prompts, seeds, and opponent populations are frozen and recorded.
- Paired evaluation compares raw LLM, compatibility, structured-only, hybrid, rule-based, and
  random modes without silently mixing fallback decisions into the intended arm.
- Forced-policy violations, illegal decisions, hidden-information violations, trace-attribution
  failures, and voice/action mismatches remain zero.
- Decision-quality metrics improve in the intended channels. Overall win rate is interpreted with
  role-specific measures such as proposal cleanliness, dirty-team approval, concealment,
  assassination exposure, quest-card behavior, and degradation.
- Performance and spend remain within an explicit product budget.
- Human playtests find the agent competent, varied, persuasive, understandable when inspected,
  and fun to play against.
- A human explicitly approves the default change.

A policy that wins one synthetic population and regresses another is not a universal promotion.
It may remain an attributable population-specific experiment if its scope is explicit.

Gate arithmetic, added after a wider bank overturned three numbers this tracker had steered by.
`phase4-good-v1` carries `60` games per cell, where a net four-game paired shift cannot reach
`p < 0.05` under any split of its discordant pairs. Re-run on `phase4-good-wide-v1` at `360`
games, the servant cell that had read `full-role` as adverse (`-15.0%`, 95% `-25.0%` to `-5.0%`)
reads `-1.9%` (95% `-5.6%` to `+1.7%`) against heuristic opponents and `-0.6%` (95% `-6.4%` to
`+5.3%`) against random. The evidentiary half of that block did not survive; the block is a human
decision. Any future cell quoted against this gate should state which bank it came from, because
a sixty-game cell does not merely fail to resolve small effects, it manufactures large ones.

---

## 6. Phase 8 entry criteria

Phase 8 is not the automatic next phase. Search, rollouts, learned factors, sampling, variable
elimination, or a factor graph begin only when the relevant simpler layer has plateaued under a
stable evaluation.

Before starting Phase 8:

- Complete enough human and target-population evaluation to name a specific decision defect.
- Show that improving the static value model or policy surface no longer resolves that defect.
- Define the counterfactual quantity to estimate: quest value, information value, cover value, or
  assassination value.
- Set an equal latency and cost comparison against the strongest static policy.
- Preserve exact inference as the oracle for small casts and fixtures.
- Keep learned or approximate inference optional, versioned, attributable, and unable to affect
  hard feasibility.
- Require an ablation showing value beyond the exact-belief hybrid before retaining the added
  complexity.

Exact enumeration is not currently a measured blocker. The known largest public-observer and
decision supports are handled with streaming and compensated summation. A factor graph is an
optimization option only after profiling demonstrates a need, not a missing architectural layer.

---

## 7. Removal ledger

Migration is not complete while a superseded path silently retains authority in the composed
agent. Deliberate baselines and fallbacks are not migration failures when they remain named and
independently attributable.

| Path | Current status | Next decision |
|---|---|---|
| Compatibility prompt dossier and certainties | Derived from exact belief/public record but still active in raw-LLM rendering | Retain while raw LLM is a named baseline; reassess after default promotion |
| Scalar `suspicion()` policy | Active only as rule-based fallback/baseline and explicit compatibility ablation | Preserve as the forever fallback; never feed it silently into native probabilistic policy |
| Prompt forced-play asks | Explanatory compatibility prose; executable authority belongs to `forced-policy-v1` in structured paths | Preserve frozen raw-prompt experiments until an explicit baseline revision |
| Free-form LLM scratchpad | Active in raw-LLM compatibility, not authoritative composed cognition | Retire scratchpad-only authority when a composed replacement is promoted; keep a named raw baseline if useful |
| Arbitrary LLM proposal selection | Active in raw LLM; composed modes use bounded candidate IDs and committed plans | Demote from default only after the promotion gate passes |
| Generic role policies | Retained as fallbacks and ablations behind explicit native role layers | Preserve attribution; strengthen specializations only through causal evaluation |
| Historical trace projections, exact-quota D3, boolean admission wrappers, duplicate score writers | Removed from current authority; rejection tombstones or historical readers remain where needed | Do not restore them as compatibility shortcuts; see the history document for deletion evidence |

Removal means deleting or isolating old authority, not merely adding another path beside it.

---

## 8. Execution and integration protocol

Architecture work proceeds as bounded chunks under a parent integrator when independent agents or
parallel worktrees are used.

1. **Frame:** record the objective, non-goals, invariants, owned surface, exit evidence, base commit,
   and human-stop conditions.
2. **Implement:** use a fresh branch and separate worktree for each code writer. Parallelize only
   when contracts and integration order are explicit.
3. **Review:** audit the exact commit independently against privacy, joint inference, forced policy,
   replay, attribution, and the chunk exit gate.
4. **Verify:** run focused tests first, then affected boundaries and evaluation, then the complete
   API-free suite on the final executable tree.
5. **Integrate:** use a house-format commit with a descriptive subject and detailed body; rebase and
   land linearly only when explicitly authorized.

Temporary incompleteness is acceptable inside an isolated architecture worktree while one internal
authority changes hands. Landed code must preserve the mandatory kernel: hidden-information
isolation, engine legality, forced-policy precedence, exact joint semantics, deterministic
mechanical replay, public/private separation, and voice/action coherence.

Do not spend money, push, deploy, change the production default, broaden an external-data contract,
or resolve a semantic merge conflict without the applicable human authority.

---

## 9. Validation contract

Use the cheapest gate that can disprove the current change, then escalate once per stable chunk:

1. Focused feature and low-player-count fixtures.
2. Required boundary casts, including two-Fail quests and maximum-role configurations.
3. Adversarial review of privacy, admission, degradation, replay, and attribution.
4. Affected contract, fixture, prompt-hash, and screenshot-freshness checks.
5. Applicable free evaluation bank.
6. Complete API-free repository validation on the final executable commit.

Every change preserves applicable coverage for hidden information, true-world retention,
probability normalization, symmetry, deterministic replay, candidate completeness, forced-policy
dominance, plan/voice coherence, degradation, evaluation isolation, prompt safety, latency, and
artifact compatibility. Paid evaluation supplements these gates; it never replaces them.

---

## 10. Completed-phase index

The complete records and their original exit evidence are in the history document:

- [Phase 0: foundations and baselines](agent-architecture-migration-history.md#5-phase-0-preserve-foundations-and-establish-baselines)
- [Phase 1: exact joint-world foundation](agent-architecture-migration-history.md#6-phase-1-exact-joint-world-foundation)
- [Phase 2: evidence, analysis, and belief visibility](agent-architecture-migration-history.md#7-phase-2-evidence-analysis-and-belief-visibility)
- [Phase 3: composed agent and policy boundary](agent-architecture-migration-history.md#8-phase-3-composed-agent-and-policy-boundary)
- [Phase 4: belief-driven production policy](agent-architecture-migration-history.md#9-phase-4-belief-driven-production-policy)
- [Phase 5: soft mechanical likelihood foundation](agent-architecture-migration-history.md#10-phase-5-soft-mechanical-likelihoods)
- [Phase 6: bounded language evidence and commitments](agent-architecture-migration-history.md#11-phase-6-bounded-language-evidence-and-commitments)
- [Phase 7: role-specific observer and identity models](agent-architecture-migration-history.md#12-phase-7-role-specific-observer-and-identity-models)
- [Historical non-blocking register](agent-architecture-migration-history.md#36-parallel-non-blocking-follow-ups)
- [Historical removal ledger](agent-architecture-migration-history.md#15-removal-ledger)
- [Complete progress log](agent-architecture-migration-history.md#16-progress-log)

---

## 11. Updating this tracker

- Add only current decisions, active work, blocked work, and the evidence needed for the next human
  checkpoint.
- Move completed implementation narratives and measurements to the history document in the same
  commit that closes them here.
- Keep stable IDs when an item moves between states.
- Do not paste test transcripts or per-commit diaries into this file; link to a report, artifact,
  commit, or concise historical entry.
- Reconcile the current-state table, work register, promotion gate, and removal ledger whenever a
  component gains or loses executable authority.
- Treat unchecked items in the history document as historical plans unless they are represented in
  the active register above.
