# Agent architecture migration

**Status:** archived Phase 0 through 7 implementation record. This file is append-only history,
not the current work queue. See [agent-architecture-migration.md](agent-architecture-migration.md)
for the concise authoritative tracker. Historical terminology, checkboxes, statuses, and planned
gates below remain unchanged so that the record continues to describe what each phase believed and
verified at the time.

**Reading note (2026-07-29): the declared-lean signal is gone.** Utterances once carried an
optional public `lean` of approve/reject/unsure, and much of the phase record below describes
machinery built around it: `declared-lean` evidence, the `lean` commitment kind and its
supersession rules, the discussion pass-and-public-lean candidate template, `desiredLean` on the
communication intent, `SituationAnalysis.declaredLeans` / `voteLeverage`, and the three
`*_DECLARED_LEAN` coherence codes. All of that is deleted; the rationale is in
[design-implementation.md](design-implementation.md) §7 "Turn structure". The phase entries are
left exactly as written because they record what each phase built and when, which is the point of
this document. Read any lean mention below as history, not as a description of the current tree.
See the C4B oracle retirement note in Phase 7R2C4B for the one place this forced a deletion rather
than a rewrite.

**Reading note (2026-07-30): the `stdio` agent engine is gone.** It was the cross-language door,
built for an AvalonBench import that was never going to happen, and the phase record below refers
to it constantly: the child-process adapter, `parseStdioDecisionReply`, the `external` execution
mode, and the `external` arm on all six brain component unions. All of that is deleted; the
rationale is in [ROADMAP.md](ROADMAP.md) "Deliberately not doing". What survives is the boundary
itself, renamed to `parseExternalDecisionReply` in `server/agents/external-reply.ts`: it still
converts an untrusted `{ decision, trace? }` reply into an `AgentDecision` and still admits the
optional trace through the same `pre-apply-external` lifecycle. Read any "stdio" mention below as
naming that ingress boundary, not a child process, and the §1 baseline table as the pre-migration
snapshot it was written as.

**Current target phase:** human evaluation checkpoint after Phase 7F2B completed the API-free
architecture exit audit. Assassin target authority landed at `02242c4`, F1 assembled the complete
deterministic role policy behind one immutable, role-independent scorer identity, F2A added the
frozen role-bank runner and virtual-Assassin evidence substrate, and F2B committed the complete
bank, report, baseline comparison, and six-family causal audit. No paid call or default promotion
is part of this checkpoint. Phase 7E2B's
bounded deterministic and seeded Mordred score layers are implemented and landed as opt-in paths:
they specialize only D2-viable proposal and vote candidates using the admitted E2A objective,
with no Mordred-specific central trace, evaluation, prompt, or communication field. Phase 7R3B is
complete: robust heterogeneous D3 runs on the
generic strategic decision-layer seam, exact quota remains research history only, and every
historical D3 reader and boolean trace-admission facade is deleted. Tests now consume the closed,
trust-labeled admission union directly; MD-003 and MD-004 are complete.
Phase 7R3A4B is complete at
checkpoint `5479bb1`, and Phase 7R3B1A's shared scorer-sensitive situation surface is complete.
Phase 7R3B1B's closed, trust-labeled trace admission boundary is complete.
Phase 7R3A1's role-agnostic kernel and A1.1 lease correction are complete, A2's shared
compatibility root plus Phase 4/C2 transforms are landed, and A3's deterministic and seeded
D2 terminals are complete and verified. A4A's deterministic and seeded Morgana terminals and
four native Morgana components are complete and verified. A4B cut score authority over to the
configured native chain, deleted the temporary equality and legacy score writers, and retained
custom scoring as one bounded alternate upstream producer with native fallback. Phase 7R2C4's typed `DecisionFrame`
spine and behavior-preserving runtime wiring are complete. Phase 7E2A is complete and approved:
the first production-native graph adds a reusable
actor-target treatment read plus a private Mordred blindness objective without policy authority.
The fast-feedback and static-check slice, the admission/conformance foundation, and the
single-pass replay work are complete. The resolved descriptor now owns configured architecture
identity across trace, artifact, and report surfaces, component host roots resolve only after a
component is causally eligible, and a fast dependency-fitness guard protects the coarse ownership
boundaries. Registered ordered score layers now produce the sole built-in scored frame for every
decision kind; one finalizer, selection path, and commit consume it. Robust D3 now commits
through the strategic decision-layer boundary. The homogeneous exact-quota finding remains
documented research context but is no longer an executable AvaLLM mode.
Phase 7R1 restored universal forced-policy authority ahead of optional D3 strategy, Phase 7R2A
moved admission behind an agent-owned boundary, and Phase 7R2B completed the generic contracts,
per-decision kernel, compatibility adapters, transport admission, trusted manifests, stored
report joins, and the complete generic-component exit gate. Mordred policy, Assassin
specialization, full-role composition, and the frozen Phase 7 role-bank evaluation are complete.
The Phase 5C population sign flip
remains recorded, and win-rate tuning is still intentionally deferred until the architecture is
complete enough to evaluate as a whole.

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
| Agent boundary | Every agent returns `AgentDecision { decision, trace? }`; the transitional `AgentOutput` union is deleted, and one post-legality hook plus one private sink replace the three-method trace lifecycle (NB-015) | Keep the external stdio wire permissive; that adapter is the only place a bare `Decision` is still accepted |
| Agent construction | Registry maps heuristic, random, stdio, raw-LLM, and named composed specs; `Probabilistic` and `Probabilistic + LLM` are ordinary built-in definitions in web setup | Preserve named presets and explicit model-adapter attribution; keep default table fill separate from availability |
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
| Team-clean probability | Exact joint assessment drives explicitly selected composed agents' good proposals plus current-team and best-alternative good votes | Add soft likelihood calibration only in Phase 5 |
| Candidate evaluation | Separate composed scorers provide deterministic good proposal/vote value, seeded near-equivalent vote variation, and a non-dominated bounded planner surface | Evaluate against raw LLMs and humans before any default promotion |
| Forced plays | `forced-policy-v1` executes for heuristic/fallback and composed policy; its typed result is rendered to the composed planner and voice | Raw-LLM ASKS retain compatibility prose only as a frozen experiment |
| Persistent commitments | Typed literal public-position history plus natural-language notes | Not yet consumed by production policy |
| Language evidence | Opt-in public interpreter seam, persistent typed reads/cursor, capped joint-world update, and private attribution | Add a real provider adapter and evaluation population only with explicit scope and spend permission |
| Observer beliefs | Prompt heuristics for Merlin concealment and evil cover | No explicit model of public suspicion |
| Role-specific posteriors | Some hard candidate lists and assassination prompting | No independent Merlin/Morgana or Assassin distributions |
| Decision trace | Composed traces include brain, belief/factors and factor provenance, analysis, candidate, forced-policy, policy, scorer, planner, prompt/renderer, communication versions, scores, chosen ID, and degradation | Replace role-specific optional fields with configured requests, admitted per-decision component entries, separate causal-policy attribution, and private tagged payloads |
| Brain/model/persona separation | Composed cognition persists independently of injected planner and voice identity; explicit mode labels distinguish compatibility, structured-only, hybrid, and raw LLM | Resolve component configuration into a typed immutable brain; keep runtime planner, voice, seed, client, and sink injection separate |

---

## 3. Migration rules

1. **Preserve the playable default and safety kernel.** The checked-in default path, legal
   fallback, and mandatory safety kernel stay executable. An opt-in migration target may be
   temporarily incomplete inside its worktree while its authority is being replaced.
2. **Move authority directly.** A target representation may replace an internal predecessor in
   one bounded worktree chunk without prolonged dual compatibility. Public or persisted user data
   and named evaluation baselines retain compatibility only when the chunk explicitly opts in.
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

### 3.1 Architecture-first worktree mode

Internal TypeScript shapes, schemas, and traces do not receive compatibility adapters by default.
Compatibility is opt-in and requires either real public or persisted user data, or a specifically
named evaluation baseline. A migration worktree may therefore be temporarily red or incomplete
while one authority changes hands. Landed `master` must compile and pass the mandatory kernel:
hidden-information isolation, engine legality, forced-policy precedence, exact joint semantics,
deterministic mechanical replay, public/private separation, voice/action coherence, and external
action admission.

Prefer direct target interfaces and deletion over adapters, dual writes, or parallel executable
authorities. Tests should pin durable laws and hostile boundaries, not temporary internal property
order or predecessor shapes. Broad regression and evaluation run at frozen architecture
checkpoints rather than after every active edit. Each bounded chunk moves one authority; any work
that cannot fit that transition enters the centralized ledger below. Code TODOs for deferred
migration work cite the corresponding ledger ID.

| ID | Deferred work | Reason and current risk | Owner/checkpoint | Exit condition | Status |
|---|---|---|---|---|---|
| MD-001 | Share one scorer-sensitive situation and host-surface builder between runtime and admission | Runtime and replay previously assembled candidate teams, joint assessments, and vote alternatives separately, allowing drift to falsely reject another role or decision kind | R3B1A | One pure builder drives runtime and admission and the all-role/all-decision replay matrix passes | `complete` |
| MD-002 | Split trace parsing/canonicalization from host/domain admission into closed trust-labeled results | Whole hostile traces now cross one bounded canonical snapshot before any field read, then host admission returns trusted exact, external diagnostic, finalized-artifact diagnostic, or typed rejection; replay lookup sees only the frozen candidate and stdio, benchmark, and report aggregation consume the admitted snapshot | R3B1B | The two lifecycle admissions converge on closed admitted or diagnostic result types, and artifact, report, and transport consumers stop domain re-parsing | `complete` |
| MD-003 | Delete or isolate the remaining exact-quota D3 legacy adapter and its conformance exemption | R3B3B1 deleted the historical payload type and decoder, legacy adapter token and binding, flat trace fields, exact host join, and all artifact, benchmark, and report readers; removed fields are explicit closed-ingress tombstones | R3B3B1 | Historical flat compatibility is removed from current admission and evaluation, and its exemption is closed | `complete` |
| MD-004 | Delete historical boolean trace-admission test facades | R3B3B2 migrated every remaining test caller to explicit trusted, diagnostic, or typed-rejection assertions and deleted the final facade export; the retired names remain only as architecture-fitness tombstones | R3B3B2 | Tests consume the closed union directly and the final compatibility export is deleted | `complete` |
| MD-005 | Delete or isolate the historical v1 flat role trace projections and their readers | Seven flat role payloads on `DecisionTrace` had no writer but cost three parallel validation surfaces in admission, the benchmark, and the report, so a new role risked growing a fourth | Architecture review follow-up | The flat payloads are gone from the trace type, refused at canonical ingress for every version, and the remaining v1 coherence reader is isolated behind one importer | `complete` |

### 3.2 Parent-orchestrated execution

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

### 3.3 Risk-tiered validation funnel

Validation should find structural mistakes before paying the wall-clock cost of exhaustive banks
and the complete repository suite. Higher player counts remain required at phase gates, but they do
not need to dominate the implementation loop.

1. **Inner loop:** use the dedicated feature file and hand-worked low-cost fixtures, usually at five
   players, while code is changing.
2. **Boundary loop:** add only the targeted higher-count cases the contract needs. Typical examples
   are the 7+ player two-Fail quest, the 9/10-player full-role cast, Oberon or Mordred visibility,
   and the 10-player 252-team and payload ceilings. A lower-count pass never substitutes for these
   boundary cases.
3. **Adversarial review:** the parent and fresh reviewer inspect joins, degradation, replay,
   attribution, privacy, and coherent whole-chain substitutions before the expensive gates. A
   green suite is not evidence that a missing hostile case is safe.
4. **Focused gate:** after review findings are corrected, run the dedicated tests plus the affected
   adjacency, privacy, stdio, replay, and evaluation files.
5. **Bank gate:** run the applicable free architecture bank once for the completed chunk, not after
   every provisional repair.
6. **Complete gate:** run the full API-free repository suite on the final executable commit before
   landing. If review changes executable code, schemas, fixtures, or generated inputs, repeat this
   gate on the amended commit. A later documentation-only amendment may carry forward the verified
   executable tree after an exact tree-delta check plus documentation, diff, and screenshot
   freshness checks.

The parent owns the independent focused and complete gates. A reviewer should run the dedicated
and adversarial evidence needed for an independent verdict, but need not duplicate the complete
suite unless the review contract or a finding makes that useful. CPU-heavy parent, reviewer, and
bank runs should not contend in parallel when sequential execution will finish sooner.

### 3.4 Parallel worktree protocol

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

### 3.5 Chunk handoff contract

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

Handoff evidence is Git-native:

- A writer hands off a clean commit SHA and its base SHA. Dirty-tree review is refused rather than
  supported by a second snapshot format.
- The detailed commit body records the changed contracts, focused verification, paid-call status,
  and unresolved issues. These are human assertions, so a private manifest would not make them
  more trustworthy.
- The reviewer inspects that exact commit and confirms its worktree remains clean.
- After sequential rebase, the parent records `HEAD` and `HEAD^{tree}`, runs the canonical full
  verifier on the clean commit, then requires both identities and the clean status to remain
  unchanged before the compare-and-swap landing.
- Existing tests remain the authority for component exemptions and other repository contracts.
  A handoff layer does not copy their inventories.

This deliberately uses Git's immutable objects and the existing verifier instead of maintaining a
parallel manifest schema, refresh lifecycle, or dirty-tree digest. If provenance errors recur
despite this narrower workflow, the next automation is a small clean-tree verifier wrapper, not a
general handoff subsystem.

### 3.6 Parallel non-blocking follow-ups

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
| NB-006 | Phase 7 parallel tooling | Add an API-free seat-view inspector at the stable agent boundary | Accept only `DecisionRequest + PlayerView`, explicitly select every diagnostic field, reject raw-Game-shaped input, hidden role fields on public players, mismatched cursors, and invisible events, and open the frozen architecture decision fixtures without depending on role-specific policy or trace schemas. Rich posterior, candidate, and component diagnostics remain deferred until the Phase 7R interfaces stabilize. | `landed` |
| NB-007 | Phase 7 correctness | Stabilize exact identity projection on large joint support | One compensated accumulator covers source normalization, grouped role and hidden-team mass, and detached lattice admission. The actual 10-player `phase4-good-v1` vote with 58,080 uniform worlds now reaches trusted-exact admission without rounding, tolerance widening, special casing, or invalid-mass renormalization. | `landed` |
| NB-008 | Post-Phase-7 test consolidation | Extract a shared score-family conformance harness | Consolidate repeated family fixtures for predecessor delegation, bounded specialization, deterministic seed domains, forced-boundary dominance, and native replay. Preserve focused family-specific causal laws; do not replace the generic registry, admission, privacy, and replay suites with another parallel matrix. | `landed` |
| NB-010 | Phase 7 strength gate | Diagnose the base good policy's adverse win rate against the heuristic population | Complete. A `good-proposal-only` arm localized the loss to the vote channel, whose marginal cost is `8.3` points in each of the three good roles, and `good-policy-diagnosis.ts` names two causes: Merlin legibility (near-oracle votes raise assassinations `16.7%` to `26.7%`) and permissiveness at an information-poor seat behind a symmetric vote-truth metric. NB-012 and NB-013 own the fixes. | `landed` |
| NB-012 | NB-010 | Price concealment in the good value function | **Premise confirmed, on a metric that can carry it.** NB-010 named Merlin legibility as a real cost on the evidence that near-oracle votes raise assassinations `16.7%` to `26.7%`, and NB-012 has sat unpromoted because that evidence is a binary observed only in games that reach a shot. `merlin-exposure.ts` reads the assassin's own posterior mass on the true Merlin instead. Re-gated on the 60 Merlin-target cases of `phase4-good-v1`, paired on the deal and depth matched within each pair: `structured-only` leaks `+0.0086` more exposure lift than compatibility (95% `+0.0039` to `+0.0134`) and `hybrid` `+0.0105` (95% `+0.0059` to `+0.0151`). Both intervals exclude zero. Against compatibility's own lift of `0.0270` that is a `32%` to `39%` relative increase in what the assassin learns. The binary sees nothing on the same games: `11/19`, `14/22` and `11/18` assassinated, intervals about `±22` points wide, and two thirds of the games never reach a shot at all. So the concealment cost is real and now measurable, and the gate can move off assassination rate. The original v2 arm (prospective public vote record) was removed and is not what was re-measured; what is confirmed is the DEFECT it aimed at, not that arm's fix. | `review` |
| NB-013 | NB-010 | Make the vote objective and its metric asymmetric | Complete, both halves. Metric: `vote-direction.ts` owns one confusion-matrix definition and the architecture report states `voteDirtyTeamApproveRate` and `voteCleanTeamRejectRate` per variant and per role with paired deltas, at report schema `3`. Objective: `good-vote-utility-board-swing-v1` values each vote branch by the board slot it risks, so approving a dirty team costs something for the first time, and `vote-objective-bench.ts` is the gate. On 1,080 free games the dirty-team approval rate falls in all six population/role cells and significantly at Percival and Servant in both populations (heuristic Servant `54.5%` to `37.4%`, `-17.1%` with 95% `-21.4%` to `-12.7%`), while the target win rate falls in none. Nothing was promoted: the same run shows compatibility still ahead of both structured arms against the heuristic population, so the arm narrows NB-010's Servant gap by roughly a third rather than closing it. Two caveats carry forward, both recorded in the progress log: `pairedBootstrapRateDelta` silently drops zero-trial resamples, which a sparse dirty-team denominator can trigger on a small bank; and the conditional denominators shift between arms, because a policy that votes differently is offered different teams. | `landed` |
| NB-014 | NB-010 | Diagnose good proposal value at an information-poor seat | Diagnosis complete; the fix is separate. `proposal-value-diagnosis.ts` reads bench artifacts and localizes the defect in the selection rule rather than the posterior. Good proposal value is the hard-constraint posterior's clean probability, which ties across the top of the surface on `144` of the Servant's `147` scored proposals (mean argmax `16.7` teams), so the canonical candidate-id order picks the team. On `54` matched first proposals the compatibility team was already inside that argmax `92.6%` of the time at posterior `23.4%` against the chosen `23.7%`, so the value function does not disagree with the heuristic there, it cannot see the difference. Percival ties nearly as often and gains, because its posterior does disagree (`59.2%` in argmax). Cleanliness is confirmed as a diagnostic only: it falls in both populations while the win rate goes `-6.7%` and `+5.0%`. | `landed` |
| NB-016 | NB-014 | Order the tied top of the good proposal surface | Evaluated, not promoted. A native `full-role-compatibility-tie-scorer-v1` review arm preferred the compatibility proposal only when it was already inside the Servant's exact clean-probability argmax. The matched first-proposal join confirmed the displaced baseline team remained in that argmax on every scored pair, and the candidate improved good wins against heuristic opponents from `7/60` to `11/60`. It regressed against random opponents from `29/60` to `27/60`, however, so it fails the required cross-population win gate despite raising first-proposal cleanliness in both populations. The executable candidate was removed and production remains on `full-role-policy-scorer-v1`. | `review` |
| NB-011 | Phase 7 strength gate | Freeze an evil-side policy bank | Complete. `phase7-evil-v1` mirrors `good-policy-bank.ts` over the same standard casts and pins the dealt seat for 240 deals, 60 each for Morgana, Assassin, Mordred, and the generic Minion, at every player count the standard cast deals the role. `full-role-bench.ts --side evil` runs it, so the evil half now has a paired win-rate number rather than only F2B's causal audit. Oberon has no policy layer of its own and stays uncovered. | `landed` |
| NB-015 | Phase 3 follow-on | Collapse the three-method trace lifecycle behind one hook and one host helper | Complete. `recordDecisionTrace`, `recordFallbackTrace`, and `recordAppliedDecisionOutcome` become one `finalizeAppliedTrace` hook plus a `privateTraceSink` destination, and `recordAppliedDecision()` in `server/agents/applied-trace.ts` is the single call each host makes after the engine accepts an action. The post-legality ordering, the detached host outcome, the finalized-trace host join, and the degraded fallback live in that one place rather than being duplicated in the sim runner and the server pump, and a finalized trace can still differ from the provisional one. Raw-LLM traces move onto the decide() envelope so they are persisted after legality with the applied action named. Every degradation path is unchanged. | `landed` |
| NB-009 | NB-008 follow-on | Make the three legacy role-policy suites strict | Complete at `51f9510`. `role-policy`, `evil-policy`, and `morgana-policy` are out of the strict-test baseline, which falls from 42 pinned exemptions to 39, so changes to active role-policy coverage now get normal compiler feedback. Hostile-payload mutations use detached mutable clones with narrow historical-field typing while keeping their forgery and admission assertions. The test-only `AgentOutput` normalizer adapters it added are gone with the union itself; see the progress log. | `landed` |

NB-006 is directly discoverable with
`node server/eval/seat-view-inspector.ts --help`. It reads the frozen architecture decision
fixtures by ID or one standalone request/view snapshot and emits deterministic text or JSON.
Review evidence includes hostile extra fields on players, quests, proposals, votes, transcript
entries, proposal tags, and event payloads; none can cross the explicit diagnostic schemas.
Discriminated per-event projections retain visible proposal, vote, quest, role-knowledge,
thinking, and scratchpad causes, and terminal rendering escapes untrusted text. Independent review
approved the final boundary and terminal-safety behavior. Parent validation passed all 833
API-free repository tests on the branch rebased onto Phase 7R1.

The same command now accepts `--ui` to launch the **Seat Decision Microscope** on an
ephemeral loopback port, or `--ui --file <snapshot.json>` for a custom snapshot. The eval-only
server binds to `127.0.0.1`, validates and projects every snapshot before listening, and sends the
browser only `SeatViewInspection`; it adds no production route and never serves raw request/view
input. The UI separates public and private evidence, visible history, and omitted facts, then shows
the future belief/component/candidate/policy/decision/voice path as unavailable rather than
inventing trace data. Focused boundary coverage passed 15 cases. Desktop and 390-pixel visual
review verified the evidence split and zero mobile page overflow, and the complete rebased tree
passed all 847 API-free repository tests after one isolated transient server-test rerun.

New entries should use stable IDs, name their source phase, and state whether they are `ready`,
`active`, `review`, `landed`, `permission-gated`, `data-gated`, or `deferred`. Completing a
follow-up updates both this register and its phase-local checkbox in the same commit. An item whose
source is a cross-phase lane rather than a numbered phase has no phase-local checkbox to update:
NB-004 through NB-009 are register-only and close through the progress log, while NB-008 also
updated the §14 test-matrix rows it widened.

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
| 7. Role-specific observer and identity models | Complete and available in web setup; default promotion remains blocked | Generic component boundary, role specializations, full-role composition, API-free role-bank audit, a measured strength gate, and ordinary human playtesting |
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

- [x] Cache or increment the heuristic's `CognitionState` if larger simulations show the current
      reconstruct-per-decision path is material; the present ten-game bank is acceptable.
      Measured and closed: reconstruct is 84% to 86% of a heuristic decision, so the path is
      material, but neither remedy reaches it. A per-view cache has a structurally zero hit rate
      (every decision faces a distinct seat and cursor) and incrementing keeps 97% to 100% of the
      cost. See the progress log for `cognition-reconstruct-cost-v1`.
- [x] Add closed-form candidate-count properties by player count and decision kind. Exhaustive
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

`AgentOutput` was a compatibility union during migration: raw-LLM, heuristic, random, and stdio
callers kept their raw `Decision` return while composed agents returned
`AgentDecision { decision, trace? }`, and server and simulator runners normalized both. That union
is now collapsed (see the progress log); every agent returns the envelope and the runners read it
directly. The stdio protocol accepts the same trace envelope as an optional extension. Composed traces carry every
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
- [x] Collapse the transitional `AgentOutput` union after external and direct callers have had a
      compatibility window; until then runners remain the single normalization boundary.
- [x] Collapse the trace lifecycle behind one hook and one host helper, so a runner no longer has
      to know the ordering between engine legality and telemetry (NB-015).
- [x] Cache the compatibility policy's repeated cognition work if the opt-in constructor is used
      in larger benchmarks before Phase 4 replaces that scorer. Measured and closed: the duplicate
      is real and stable at 7.5% to 8.3% of a composed decision across three populations, which
      does not pay for a determinism-critical guard on a scorer Phase 4 replaces. The prerequisite
      equality is now pinned, so promoting the composed path makes this a small specified change
      rather than a fresh investigation. See the progress log for `cognition-reconstruct-cost-v1`.

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
first Servant seat at every supported player count. `npm run good-policy-bench` compares
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

- [x] Reuse the architecture report's complete matched-table validator in the direct conversion
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
   cover and burn proxies without changing policy. **Complete.**
7. **Phase 7D2, evil/Oberon proposal and vote policy:** add bounded opt-in failure-capacity,
   cover, and future-opportunity utility while keeping Oberon separate from visible-partner
   coordination. **Complete.**
8. **Phase 7D3, evil quest-card policy:** add independently valid heterogeneous play as the only
   promotion-eligible direction. Retain exact quota only as a homogeneous, mixed-unsafe,
   nonpromotable research ceiling. **Complete.**
9. **Phase 7E1A, Morgana substrate:** add a separate public counterfeit-Merlin read and a private,
   complete-world candidate objective without changing policy. **Complete.**
10. **Phase 7E1B, Morgana policy:** make counterfeit-Merlin and Percival-influence value causally
    affect bounded policy. **Complete.**
11. **Phase 7R1, forced-policy authority:** run universal quest-card rules before optional D3
    strategic policy across runtime and admission. **Complete.**
12. **Phase 7R2A, mechanical host-admission extraction:** move the existing component
    reconstruction and exact admission equations out of stdio and evaluation call sites into one
    shared owner without changing behavior, schemas, or promotion eligibility. **Complete.**
13. **Phase 7R2B1, contracts, registry, and resolved brain:** define the generic component
    contracts and immutable registry, validate the dependency graph, and resolve requested and
    eligible components once at construction without changing traces, artifacts, or decisions.
    **Complete.**
14. **Phase 7R2B2, per-decision kernel:** determine applicability from each
    `DecisionRequest + PlayerView`, snapshot separately registered data-only host inputs for the
    invocation, execute and admit generic tagged outputs with bounded degradation, and prove the
    seam with a test-local native fixture. Host-input definitions own canonical identity, version,
    privacy, bounds, and validation; components can read only declared roots. Roots are not
    components and never enter component run, public projection, or policy-use records.
    **Complete.**
15. **Phase 7R2B3A, good-role and generic-evil compatibility adapters:** dual-write the landed C1,
    C2, D1, and D2 paths into generic entries and their unchanged legacy projections, requiring
    exact equality. **Complete.**
16. **Phase 7R2B3B, Morgana and quest-card compatibility adapters:** dual-write E1A, E1B, and D3,
    integrate generic admission with transport, and preserve D3 suppression after universal forced
    policy. **Complete.**
17. **Phase 7R2B4, artifacts and exit gate:** derive generic manifests and evaluation views,
    retain reads of historical legacy-only artifacts, and complete the frozen behavior,
    reconstruction, privacy, replay, bank, size, and latency gates. **Complete.**
18. **Phase 7E2A, Mordred substrate:** only after 7R2B4 passes, add the first production native
    generic component, modeling
    Merlin-blindness opportunity and anomalous public treatment from exact joint worlds plus
    public-only observations without changing policy or adding any Mordred-specific central field.
    **Complete.**
19. **Phase 7R2C, development-leverage checkpoint:** make correctness infrastructure reusable
    before ordered policy work. Implement as four bounded slices:
    - **7R2C1, fast feedback and static checks:** add strict no-emit server typechecking and
      fast, contract, evaluation, exhaustive, performance, and complete test lanes. Preserve the
      complete landing gate; move contested wall-clock assertions out of correctness lanes.
      **Complete.**
    - **7R2C2, parse once and component conformance:** centralize hostile JavaScript/JSON handling,
      structural primitives, canonicalization, and bounded decoding at admission. Downstream code
      consumes admitted typed values. Add a registry-wide conformance harness and shared
      rotation, renaming, private-canary, raw-truth, reweighting, and hostile-shape fixtures.
      **C2A admission and conformance foundation complete; incremental legacy migration remains.**
    - **7R2C3, one derived descriptor and linear evaluation replay:** derive trace, artifact, and
      report metadata from the resolved graph and admitted run, while fixing that same graph and
      run as the future Inspector v2 source. Replace repeated prefix replay with one pass over the
      event log while preserving exact snapshots.
      **Complete.**
    - **7R2C4, typed policy seam:** behavior-preservingly extract one `DecisionFrame` carrying the
      canonical request, view, belief, analysis, candidate surface, forced survivors, and component
      run into ordered score layers, ordered decision layers, and the committed action.
      **Complete.**
20. **Phase 7R3A, ordered score layers:** express the shared base scorer and the landed C2, D2, and
    E1 transformations as registered ordered layers with explicit dependencies and fallback.
21. **Phase 7R3B, strategic decision layers and historical cleanup:** robust heterogeneous D3
    runs behind universal forced policy as a registered strategic layer and uses the shared
    bounded generic component admission boundary. Exact quota is research history only: its
    executable authority, flat payload semantics, decoder, adapter, admission reconstruction, and
    evaluation readers are deleted. Old artifacts that declare those removed fields or unknown
    policy identities are invalid or nonpromotable rather than semantically reconstructed.
    Retired private field names remain privacy tombstones so deletion cannot make an old private
    payload safe to expose in public logs.
    **Complete.**
    - **7R3B2A, generic strategic seam:** register and resolve a role-agnostic ordered
      decision-layer contract, execute its monotone survivor/selection surface after universal
      policy and components, and replay its journal, component reads, causal use, and bounded
      operation counts from out-of-band identity. **Complete.**
    - **7R3B2B, robust authority cutover:** register the heterogeneous-safe D3 policy as the first
      production decision layer, prove behavior equality and universal dominance, then delete its
      legacy overlay, flat binding, and exemption. **Complete.**
    - **7R3B3A, exact-quota executable-authority deletion:** delete the homogeneous convention
      from runtime configuration, construction, registration, forced policy, decision frames,
      candidate-boundary production, and trace writing. **Complete.**
    - **7R3B3B1, historical D3 read cleanup:** delete the remaining flat payload decoder,
      admission, artifact, benchmark, and report readers and close MD-003. **Complete.**
    - **7R3B3B2, admission facade cleanup:** migrate the remaining tests to the closed admission
      union, delete the final boolean compatibility facade, and close MD-004. **Complete.**
22. **Phase 7E2B, Mordred policy:** give the validated Mordred objective bounded causal authority
    over proposal and vote decisions through the ordered layer contract while preserving D2 and
    forced-policy dominance. **Complete and landed at `d25ca29`.**
23. **Phase 7E3, Assassin specialization:** first add a mechanically inert, capped, interpretable
    Merlin posterior distinct from generic goodness (E3A), then give it bounded assassination
    target authority only after its privacy and math are approved (E3B). **Complete: E3A landed
    at `6d0be37` and E3B landed at `02242c4`.**
24. **Phase 7F1, full-role composition:** configure the deterministic good, shared evil/Oberon,
    Morgana, Mordred, and Assassin layers once for the lifetime of one scorer. Per-decision
    applicability, not a host-level role switch, determines which layers execute. Keep every
    isolated scorer as an ablation. **Complete.**
25. **Phase 7F2, evaluation and exit audit:** compare compatibility, base composed, observer,
    role-specific, and full configurations on a frozen API-free role bank, including virtual
    Assassin guesses derived only from seat-filtered views. **Complete.**

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

- [x] Add `role-objective-router-v1` so each actual role resolves to one attributable objective
      model while preserving historical Merlin/Percival artifacts and preparing Assassin routing.
- [x] Add exact public standing and explicit public burn and cover proxies with observation
      numerators and denominators; missing observations are not evidence of innocence.
- [x] Add visible-evil objectives using only `{self, ...privateInfo.evilPartners}`. Never infer a
      partner seat or special-role identity, and never include Oberon in coordination.
- [x] Add an Oberon joint posterior over unseen evil-seat sets by summing complete worlds. Keep
      unseen-evil-on-team probability distinct from coordination or Fail probability.
- [x] Represent Assassin shot preservation, Morgana counterfeit cover, Mordred deep cover, Minion
      failure banking, and Oberon uncoordinated disruption as explicit attributable postures.

### Phase 7D1 implementation record

`role-objective-router-v1` now resolves Merlin and Percival to their existing C1 model, Assassin,
Morgana, Mordred, Minion, and Oberon to `evil-oberon-objectives-v1`, and Servant to off. The
configured router and concrete resolved objective remain separately attributable. The legacy C1
lane is unchanged, and a router configured with the C2 scorer applies C2 only to Merlin and
Percival; evil and Servant decisions resolve to the matching seeded Phase 4 base scorer.

The evil substrate consumes the resolved `PrivateIdentitySnapshot.hiddenTeam` posterior, including
weighted pipelines. Visible evil coordinate only over the sorted set formed from self and
`privateInfo.evilPartners`; no partner role identity is inferred and unseen Oberon never enters
coordination. Oberon instead receives an exact posterior over unseen evil-seat sets and a separate
unseen-evil-on-team probability. Candidate failure capability sums complete-world evil-count mass
at or above the current quest threshold, including the two-Fail quest. Exact public standing uses
explicit world and observation numerators and denominators. Burn, cover, and standing are labeled
deterministic proxies, with null rather than innocence when no public observation exists. All five
evil-role postures are explicit data and have no policy authority in this slice.

The objective remains opt-in, private, bounded to 256 assessments and one MiB, absent from prompts
and public cognition, and mechanically inert. Exact API-free admission reconstructs the
authoritative belief, mandatory hidden-team identity, public observer, and objective across stdio,
generation-time architecture capture, and stored reports. The unreconstructable weighted external
lane admits only either a complete hidden-team identity/objective chain with no dependency
degradation or simultaneous absence of both payloads with both typed degradation labels. Public
observer data is always host-reconstructed. This rejects scope substitution, coherent false
posterior chains, partial payloads, observer mutation, and degradation-label mismatches while
keeping genuine weighted failures measurable.

Independent review passed 48 focused tests and the complete 769-test API-free suite. The free
10-case bank admitted all 103 traces with zero calls, cost, degradation, forced-policy,
hidden-information, or attribution findings. Router-on and router-off all-seat replays produced
identical event logs for every bank case. The 10-player quest-four surface retained all 252 legal
team candidates within the payload bound. Phase 7D2, not this substrate, owns the first evil and
Oberon proposal or vote authority.

### Phase 7D2 implementation record

`evil-oberon-role-utility-v1` gives Assassin, Morgana, Mordred, Minion, and Oberon opt-in proposal
and vote authority without changing quest-card policy. Candidate utility is fixed at 70 percent
exact failure capacity, 20 percent explicitly non-probabilistic public cover, and 10 percent
explicitly non-probabilistic future opportunity. Failure capacity sums complete-world mass at or
above the current quest threshold, including the two-Fail quest; it is not an independent
suspicion product or a model of card-choice coordination. Vote rejection compares the current
team with the canonical best Phase 7D1 alternative and a bounded public proposal-runway factor.
Visible evil use only known visible partners, while Oberon remains self-only and reasons about
unseen placement probability rather than coordination.

`evil-oberon-role-scorer-v1` composes over the Phase 7C2 scorer, which composes over the matching
seeded or deterministic Phase 4 scorer and then compatibility. This gives evil and Oberon the D2
policy, Merlin and Percival the C2 policy, and ineligible roles or decision kinds the matching
Phase 4 policy without misreporting the configured scorer. Proposals select the deterministic
maximum. Votes use the game seed and stable event sequence only within a 0.04 viable-candidate
band. Forced policy remains authoritative, engine legality remains final, and malformed or
unavailable role output falls through the nested scorer chain with explicit attribution.

The utility request carries host-derived completed-good and completed-evil quest counts. Strict
validation binds their sum to the current round, derives the two-Fail threshold from player count
and quest number, and distinguishes ordinary reserve, decisive-board, and true final-quest states.
Cross-field joins also bind visible coordination totals and reserve arithmetic, Oberon unseen
probability and self membership, rejection runway, alternative realization, score equations,
seeded selection, and selected and applied actions. The private D2 payload and component version
remain absent from public cognition, prompts, voice, and client data.

Stdio, generation-time architecture admission, and stored-report replay admit the weighted
external dependency boundary in exactly two states: a complete identity, D1, and D2 chain with no
dependency degradation; or simultaneous absence of all three private payloads with exactly the
three canonical degradation labels and truthful Phase 4 fallback attribution. Exact paths always
require the complete chain. Partial payloads, missing or extra labels, fake configured or resolved
scorers, zero-trace artifacts, detached coordinates, and coherent equation forgeries are rejected.

Independent review passed 36 focused C2/D1/D2 tests and 19 adjacent stdio, trace, architecture,
knowledge, and leak tests. The complete API-free suite passed 781 tests. The free architecture
bank, weighted generation and report fixtures, 10-player 252-team bound, deterministic replay,
two-Fail semantics, privacy checks, and hostile mutation matrices all passed with no paid calls.
This establishes Phase 7D2 architecture and safety correctness, not playing-strength promotion.
Phase 7D3 owns heterogeneous-safe visible-partner quest-card policy and the quarantined
homogeneous exact-quota comparison.

- [x] Give proposal and vote candidates bounded failure-capacity-first utility. Failure capacity
      owns at least 70 percent of normalized value; cover and future opportunity together own at
      most 30 percent.
- [x] Add a heterogeneous-safe visible-partner policy that assumes no shared algorithm, seed,
      convention, teammate action, or agent-type handshake. Below known visible quota it succeeds;
      on decisive sinkable boards each visible evil independently Fails; otherwise a seat-local
      public-context bucket controls bounded timing.
- [x] Retain exact-quota designation only as a homogeneous research ceiling. Mark it mixed-table
      unsafe and promotion-ineligible, and reject its evaluation artifacts until Phase 7F can
      prove genuine all-seat provenance.

### Phase 7D3 implementation record

`evil-robust-heterogeneous-quest-policy-v1` is the only promotion-eligible D3 direction. Each
non-Oberon visible evil decides independently from its seat-filtered request, canonical public
history, acting seat, and legally visible evil counts. It does not consume the game seed, player
names, prose, raw events, a posterior, teammate card choices, execution order, agent type, shared
state, or a capability handshake. It succeeds below known visible failure quota, independently
Fails on a decisive sinkable quest, and otherwise uses an acting-seat-local public-context bucket.
Zero, one, multiple, or subquota Fails are accepted consequences of heterogeneous play rather than
silently assuming cooperative teammates.

`visible-evil-exact-quota-homogeneous-research-v1` records the historical homogeneous comparison.
Its canonical cohort, order, common gate, and designation required every visible evil seat to run
the same convention. R3B3A removed it from executable AvaLLM configuration because that assumption
is invalid for heterogeneous agents and humans. Historical readers remain temporarily isolated
for R3B3B cleanup; the research finding does not become mixed-table production policy.

The heterogeneous-safe typed quest-card directive is now consumed by the registered strategic
decision layer after universal forced policy and before scoring or planning. Engine legality
remains final, Oberon retains independent behavior, and no D3 payload enters prompts, voice, public
cognition, client data, or public logs. Configured and resolved policy identities remain
separate. Stdio, architecture generation, stored reporting, and artifacts reconstruct and join
the component, strategic layer, selected card, and applied card while rejecting seed
dependence, mode swaps, illegal cross-mode fields, forged context, count, order, designation,
bucket, action, deletion, manifest, or degradation data.

Independent review approved the implementation with no actionable findings after 49 focused
C2/D1-D3 tests, hostile standalone and host-replay mutations, a free architecture bank, additional
5-10 player composed games, execution-order invariance, and a no-D3 transcript comparison against
the prior commit. Parent validation passed 54 focused tests and all 794 API-free repository tests.
No client, prompt, provider, production-default, paid-call, push, or deployment change is included.

The D1 posture names for Morgana and Mordred are explicitly descriptive `not-policy` data, and D2
applies the same generic 70/20/10 evil utility to both roles. That is useful shared mechanics, but
it does not implement either special role's causal objective. The following two slices are
therefore required Phase 7 architecture, not optional cleanup.

### Morgana

- [x] Add an interpretable public observer of whether Morgana is being read as Merlin and how that
      could influence Percival.
- [x] Derive counterfeit-Merlin and Percival-influence value only from legal private knowledge and
      public conduct; do not import Percival's private posterior or identify true Merlin through
      privileged data.
- [x] Give the objective bounded, opt-in causal authority over relevant proposal and vote
      decisions while preserving forced policy, legality, and generic evil fallback.
- [x] Prove causal action changes, privacy, replay, attribution, and API-free bounds.

Phase 7E1A implements `morgana-counterfeit-public-read-v1` as a separate public-only projection
rather than relabeling the generic Phase 7A behavior indices. It joins only executed proposals and
votes to resolved quest outcomes, preserves proposal and vote numerators and denominators with
null for unobserved categories, and keeps the exact public Merlin marginal separate from the
bounded deterministic read proxy. The proxy is not a posterior, likelihood factor, or role
probability.

`morgana-counterfeit-objectives-v1` then evaluates proposal and vote candidates over the resolved
complete-world belief. In each world it simulates only Merlin's legal sight by excluding that
world's Mordred from Merlin-visible evil, so uncertainty over which visible partner is Mordred is
integrated by joint-world sums rather than independent marginals. Candidate output records the
Merlin-visible and public count distributions, private and public failure-capability mass,
consistency, tell, ambiguity, signal, read opportunity, and final counterfeit value with explicit
equations. It never imports Percival's private pair posterior or assumes Morgana knows Percival's
seat. The engine's cast validation requires Percival whenever Morgana is present, so malformed
Morgana-without-Percival data is rejected instead of receiving a fabricated empty state.
Vote snapshots bind the canonical current team in their request coordinate, and both vote and
proposal snapshots carry the complete legal candidate surface for the current round. Standalone
validation reconstructs every canonical candidate ID, direction, team size, and expected
combination so deletion or a same-size team splice cannot create a valid-looking partial surface.
Before any candidate sum, every supported world must have positive mass, the current public-event
cursor, the canonical cast and alignment, Morgana at the acting seat, all seat-filtered private
knowledge, and every resolved quest constraint. A malformed belief fails atomically rather than
letting an impossible partner swap, stale world, or contradicted Fail count influence the proxy.

The slice is opt-in, Morgana-only, proposal/vote-only, private, and mechanically inert. It adds no
scorer, forced decision, prompt, voice, client, provider, or default behavior. Composed runtime
analysis supports any valid resolved belief, including weighted joint worlds. Current stdio and
stored promotion admission certify applied Morgana objectives only for exact host-reconstructable
sources because traces do not carry the complete weighted world list. Weighted runtime snapshots
remain structurally valid and attributable, but are not yet certifiable promotion evidence. Phase
7F or a dedicated provenance follow-up must close that evidence-boundary limitation without
discarding the weighted posterior from the north-star runtime.

Phase 7E1B adds `morgana-counterfeit-role-utility-v1` and the deterministic
`morgana-counterfeit-role-scorer-v1` plus its vote-only seeded ablation. This is the first causal
Morgana specialization; the unchanged D2 `evil-oberon-role-utility-v1` still owns shared evil
failure capacity, cover, and future opportunity. Forced policy filters first. Among its survivors,
the Morgana projection computes the canonical maximum D2 role value and admits only candidates
within the explicit `0.04` D2 band. No counterfeit feature can make a candidate outside that band
viable. Deterministic proposals and votes choose maximum E1A `counterfeitValue` with canonical-ID
ties. The optional seeded mode varies only between approve and reject when both survive the D2
band and their counterfeit-value gap is at most `0.04`; proposals remain seed-invariant.

The projection binds the request, canonical vote team, complete E1A and D2 candidate surfaces,
forced survivors, D2 maximum and floor, band membership, counterfeit ranking, seed domain and
bucket, and selected decision. It is plain detached data with exact keys, dense arrays, exhaustive
legal candidate IDs, at most 252 candidates, and a 1 MiB JSON ceiling. Composed policy validates
the full host join before scoring. The fallback chain remains Morgana policy to the matching
deterministic or seeded D2 scorer, then C2, Phase 4, and compatibility. Missing or malformed E1A
data records `morgana-role-utility-projection-failed` and resolves to D2; invalid Morgana scorer
output separately records `morgana-role-objective-scorer-failed`. Ineligible roles and decision
kinds resolve through the same chain without fake degradation, and configured versus resolved
components stay distinct.

Dedicated validation passed 15 causal and adversarial cases, including an authentic action change,
both hand-worked `0.04` boundaries, a real match-point forced vote, proposal seed invariance, vote
replay and both seed buckets, D2 fallback, weighted runtime, D3 invariance, rendered/public
privacy, simultaneous vote-team substitution, hostile stdio and stored joins, 5-10 player
surfaces including the 252-candidate maximum, forged exact E1B degradation behind a coherent D2
surface, and a free architecture-bank run. The 181-test focused adjacency suite and all 821
API-free repository tests also passed. E1B makes no
prompt, voice, client, provider, D3, production-default, or paid-call change. Weighted joint
beliefs remain supported in composed runtime. External and stored promotion admission still
requires E1A's exact host-reconstructable provenance because traces do not carry the complete
weighted world list; this is an explicit Phase 7F evidence limitation, not a claim that weighted
promotion evidence is complete.

### Phase 7R1 forced-policy authority checkpoint

The pre-Mordred architecture audit found that D3's optional strategic quest-card directive was
examined before universal T1 quest rules. The forced-policy owner, composed execution order, stdio
admission, architecture generation, and stored-report validation now agree on one ordering.

Universal good Success, non-Oberon evil cannot-sink Success, and decisive sinkable evil Fail now
resolve before any D3 exact-quota or robust directive. Only a remaining nondecisive legal choice
may reach the optional strategic policy. Oberon remains outside coordinated D3 policy, remains
free on an ordinary two-Fail quest it cannot knowingly sink, and still Fails when its own card can
decide a match-point quest. The change does not alter D3's opt-in and quarantine status, private
payload, deterministic policy, scorer/planner ordering, or engine legality. When universal policy
owns the choice, traces retain the configured D3 identity but correctly omit its resolved version
and private payload.

Focused API-free validation passed 24 forced-policy and D3 cases. Direct regressions supply
shape-valid adversarial Fail and Success directives and prove they cannot override cannot-sink or
decisive rules; separate Oberon cases pin both the uncoordinated ordinary path and decisive forced
Fail. A genuine 7-player no-Oberon, three-visible-evil exact-quota conflict proves that an
undesignated seat's strategic Success is not resolved, universal Fail is selected, and the trace
passes host reconstruction and stdio round-trip. A further 23 composed, trace, and stdio adjacency
cases passed. Independent re-review found no remaining correctness issue. Parent validation passed
all 824 API-free repository tests; that complete run also executed the free D3 architecture bank
and its hostile trace and artifact mutations.

### Phase 7R generic component checkpoint

This checkpoint prevents each new role from extending central scorer, context, trace, stdio,
artifact, and report shapes independently. It is behavior-preserving migration work, not a change
to beliefs, objective formulas, defaults, prompts, planner authority, voice, or engine legality.

**7R2A extracts mechanical admission first.** The exact reconstruction and cross-field equations
currently enforced by stdio, architecture generation, stored reports, and artifact validation move
behind a shared host-admission owner. Call sites invoke that owner but keep their current schemas
and outcomes. Detached or externally supplied weighted payloads whose complete world source is not
present remain structurally usable where already supported, but are explicitly unverifiable and
ineligible for promotion admission. Extraction is complete only when old and new admission results
are identical over valid fixtures and every hostile mutation.

The implementation now lives under `server/agents/admission/`. Stdio consumes that owner and keeps
only transitional re-exports for source compatibility; architecture generation and stored-report
replay import the agent-owned module directly. The move preserves the existing trace and artifact
schemas, versions, exact reconstruction equations, weighted-unverifiable treatment, and D3
configured-but-unresolved suppression join. Dependency tests prevent evaluation from importing
stdio for admission. The focused API-free gate passed 151 stdio, trace, architecture-report,
C1/C2, D1/D2/D3, and E1A/E1B cases, including existing hostile mutation and free-bank fixtures.
Independent review found the 3,659 moved implementation lines byte-identical apart from import
rebasing, confirmed runtime export identity, and passed 225 focused cases. Parent validation then
passed all 835 API-free repository tests, including the applicable free architecture banks and
hostile admission mutations.

**7R2B introduces the generic kernel in five linear chunks.** Each chunk lands only after its own
focused and complete API-free validation. Later chunks may depend on earlier contracts; they must
not bypass or redesign them at a role-specific call site.

1. **7R2B1, contracts, registry, and resolved brain:** define typed component identity, kind,
   privacy, dependencies, host requirements, payload bounds, degradation, detached validation, and
   host admission. An immutable registry rejects duplicate or missing identities, conflicts, and
   dependency cycles and produces a stable topological order. Construction freezes the requested
   and eligible graph, versions, dependencies, layer order, and compatibility snapshot; runtime
   injection remains limited to operational dependencies such as seed, planner, voice, clients,
   and sinks. Acceptance requires registry-failure and immutability tests, resistance to mutation
   of caller-owned options, and unchanged frozen prompts, decisions, and heuristic-bank behavior.

   **Complete.** The resolved brain now owns frozen dependency-first component implementations and
   a separate data-only description of requested, configured, construction-eligible, and
   ineligible entries. The registry has closure-private storage and rejects duplicate identities,
   conflicting versions, missing dependencies, unknown requests, and cycles with a concrete path.
   The compatibility facade captures configuration and injected method identities once while
   preserving the original implementation receiver and observable interpreter-version drift.
   Fresh review initially caught frozen interpreter drift and broken class-private receiver
   semantics; the corrected implementation added stateful planner and component regressions and
   passed 164 affected compatibility cases plus all 841 API-free repository tests. Traces,
   artifacts, stdio, prompts, decisions, role execution, and defaults remain unchanged.
2. **7R2B2, generic per-decision kernel and native fixture:** use the current
   `DecisionRequest + PlayerView` to determine applicability and as the only game-state boundary.
   Execution may additionally consume explicitly declared, registry-validated, invocation-local
   operational roots already derived from that same seat's cognition. Admit bounded private tagged
   payloads, degrade safely, and record configured, admitted, and causal-policy-use states
   separately. Invocation-local host values use a separate typed namespace with
   registry-owned validators and bounds. A component declares the roots it requires, the resolved
   brain records only their data-only references, and each call snapshots every supplied binding
   before asynchronous work. Root values never enter the immutable brain, component run, public
   projection, trace envelope, or policy attribution. V1 roots are private-only because arbitrary
   bindings cannot prove public-record provenance; public components continue to use the canonical
   public record and public component dependencies. Missing and invalid roots degrade only an
   applicable consumer, while duplicate, unknown, or tag-substituted extra bindings are programming
   errors. The generic status vocabulary includes inapplicable, suppressed, degraded, and
   admitted. A test-local native fixture must exercise the generic cognition, trace, stdio,
   artifact, and evaluation shapes without adding a fixture-named field to any central type or
   host. This is a structural boundary proof; B3B and B4 retain ownership of production transport
   admission and artifact/evaluation integration.

   **Complete.** The kernel and hostile contract tests cover dependency-first execution,
   applicability before every eligibility check, exact tagged and admission wrappers,
   non-substitutive host-root validation, bounded JSON cloning including own `__proto__` keys,
   rejection of proxy and alien-prototype values, private/public noninterference including wholly
   private causal-policy attribution, and concurrent reentrancy on one resolved brain. Independent
   review found and drove both the private policy-use projection correction and the strict proxy
   and prototype correction before approval. The final affected matrix passed 77/77 tests and the
   complete API-free repository suite passed 870/870.
3. **7R2B3A, C1/C2/D1/D2 compatibility adapters:** project the existing good-role and generic-evil
   substrate and policy outputs into generic entries while dual-writing the unchanged legacy
   fields. Every generic and legacy projection must compare exactly, including degradation and
   separate policy-use attribution; any mismatch is rejected.
4. **7R2B3B, E1A/E1B/D3 adapters and transport admission:** add the same exact dual-write contract
   for Morgana and evil quest-card outputs. Stdio and other external traces use registry-owned
   admission rather than role-specific transport equations. D3 records `suppressed` when a
   universal forced rule resolves the action, and weighted results without reconstructable
   complete-world provenance remain explicitly unverifiable and nonpromotable.
5. **7R2B4, artifact, bank, report, and complete exit gate:** derive an additive generic component
   manifest and evaluation view without another role-specific artifact array, while continuing to
   read historical artifacts that contain only the legacy schema. The full gate freezes prompt
   bytes, decisions, event logs, deterministic replay, degradation, component versions, exact and
   constraints-only reconstruction, weighted-unverifiable handling, architecture-bank results,
   payload size, and latency. Independent architecture review must confirm that the native fixture
   needed no component-named central field.

**7R2B3A verified implementation.** The C1/C2 good-role and D1/D2
generic-evil paths now execute generic-first through four private, stateless legacy adapters.
Invocation-local private identity and the same seat's already-derived public-observer snapshot are
the only adapter roots. C1 and D1 build their objective once; C2 and D2 consume the admitted
objective dependency and build their utility once. The unchanged cognition, flat trace, scorer
context, score features, and component-version fields are compatibility projections of admitted
generic payloads rather than a second production path. Admission still independently reconstructs
the existing structural and host joins when the required inputs are available; that verification
does not create or substitute a second authoritative output. A degraded generic entry yields no
legacy payload or resolved flat version and contributes its existing typed degradation exactly
once.

New traces carry the full private `DecisionTrace.components` run plus the generic
`decision-component-run-v1` discriminator under composed-only `decision-trace-v2`; raw LLM and
other flat producers remain on `decision-trace-v1`. A separate private
`decision-component-plan-v1` witness is copied directly from the resolved brain's configured graph
before execution. Shared trace admission requires the v2 plan, discriminator, and run together;
exact plan/run configured equality; registry-resolved graph completeness and canonical order;
plain dense non-proxy arrays; exact generic/legacy payload equality; bounded per-component, plan,
and aggregate-run bytes; unique configured/entry/use records; and causally reconstructed
`candidate-score` then optional `action-selection` stages. Historical `decision-trace-v1` flat
traces remain readable only when the plan, discriminator, and run are all absent. Weighted or
active-language payloads retain structural, nonpromotable generic admission while the unchanged
legacy validators still run. The measured ten-player C2 maximum is 398,524 bytes for the generic
run and 1,432,428 bytes for the complete dual-written trace, against a 2,097,152-byte aggregate
run bound. B4 owns broader artifact-cost measurement before legacy write-side cleanup.

The plan witness closes accidental or partial transport erasure, including configured but
inapplicable components. It is not cryptographic provenance: self-contained transport admission
cannot detect a coherent malicious rewrite of both plan and run, or a coherent rewrite from v2 to
the historical v1 shape. Binding a trace to the producer's independently expected resolved plan
belongs at the trusted producer or architecture-manifest boundary in B3B/B4 unless an existing
call site already holds that resolved brain. This checkpoint does not claim that stronger trust
join.

The stateful composed host now queues decisions FIFO while capturing planner and voice at
invocation time. Pending plan acknowledgments are bounded and retained by stable decision id, with
FIFO handling for duplicate identical ids, so an overlapping decision cannot replace an earlier
unacknowledged plan. The B2 kernel itself remains reentrant and no invocation root is stored on
the brain, component definitions, or agent.

Independent rereview passes 141/141 and parent-focused API-free validation passes 155/155
C1/C2, D1/D2, E1 adjacency, active-language, stdio, artifact/report, weighted-degradation,
privacy, hostile-admission, replay, and concurrency cases, including 12/12 dedicated B3A adapter
cases. Parent full-suite validation passes 888/888. The rereview verdict is READY; B3A is complete
while the independently expected-plan join remains an explicit B3B/B4 follow-up.

**7R2B3B verified implementation.** E1A now separates a registered public counterfeit read from
its private complete-world objective. The public component reads only the kernel's canonical
`PublicRecord`, resolves for configured proposal and vote decisions even outside Morgana, and is
the only E1 output eligible for public projection. The private E1A component consumes that public
dependency plus an invocation-local resolved-belief root. E1B consumes admitted E1A and D2
dependencies plus the universal forced-policy and deterministic-seed roots. Weighted E1A and E1B
outputs remain structural and nonpromotable, while constraints-only exact output retains its
existing promotion semantics. The legacy Morgana fields remain conditional and are exact
projections of admitted generic payloads.

D3 is represented by distinct robust and exact-quota private decision-rule definitions. The
robust seat-local policy is exact and promotable; the mixed-unsafe exact-quota research ceiling is
exact but nonpromotable. The host computes universal forced policy first and runs the resolved
component graph exactly once with that result as an invocation-local root. A forced quest-card
decision yields an explicit generic `suppressed` D3 entry before any D3 builder runs, so universal
authority remains visible rather than being rewritten as inapplicability or degradation. Registry
descriptors now own legacy projection, causal-stage, suppression, degradation, and promotion
metadata for the compatibility adapters; shared admission walks those descriptors rather than
switching on new Morgana or D3 scorer tokens.

Architecture generation now captures the target composed agent's resolved component plan before
installing the timing wrapper and supplies that independently expected plan to host admission.
Consequently, a trusted built-in producer cannot coherently erase or relabel its graph, remove
causal-use stages, or downgrade v2 to the historical v1 shape while remaining acceptable.
The shared host path additionally re-admits every reconstructable generic entry dependency-first
through its registry definition, using canonical request, seat view, public record, and only
independently reconstructed roots. The public E1 read therefore always receives an exact host
join, including for non-Morgana seats with no legacy flat projection. Missing weighted world roots
can preserve only structural, nonpromotable admission; they cannot inherit detached exactness.
Structural fallback cannot bypass the graph: every declared dependency must already have an
admitted entry before its child can be considered, even when that child lacks a reconstructable
host root.
Deterministic and seeded E1B also use distinct component identities with fixed selection modes, so
the plan identifies the implementation without consulting a legacy scorer label.

Self-contained stdio and other external producers still receive strict registry-owned detached
validation but do not gain authenticity merely by asserting a coherent plan. Historical v1 read
compatibility remains unchanged. Binding stored reports to an independently trusted manifest
remains B4's responsibility.

The new eight-case B3B suite covers exact E1A/E1B dual-write and causal use, public/private
projection, coherent public and private host forgeries, weighted structural nonpromotion,
distinct seeded E1B identity and host admission, robust and exact-quota D3 promotion, forced
suppression, trusted-plan hostile rewrites, architecture-generation capture, and the ten-player
252-candidate boundary. The maximum generic E1 run is 1,404,041 bytes under the unchanged
2,097,152-byte cap. Parent-focused validation passes 142/142 across the kernel, compatibility
adapters, transport admission, D3, E1A, E1B, architecture artifacts, privacy, replay, and
degradation surfaces. All 897 API-free repository tests pass. Independent review passes its
36/36 dedicated kernel/B3B and 132/132 adjacent architecture, admission, D3, E1, privacy, replay,
prompt, and compatibility matrices and returns READY. This checkpoint is complete.

**7R2B4 verified implementation.** Architecture artifacts now carry one additive, generic,
seat-keyed `decisionComponents` manifest under the strategy-version bundle. The host derives the
manifest only from a built-in composed agent's independently captured resolved plan; it is never
inferred from a returned trace, and a self-described stdio or wrapper-hidden external graph cannot
mint trusted provenance. The current architecture-bank producer binds exactly the evaluated target
seat, while the data-only shape remains ready for multiple seats without adding a role-named
artifact field. Plans retain the kernel's strict plain/dense JSON validation, canonical component
identity, uniqueness, per-plan 65,536-byte bound, and a 720,896-byte aggregate manifest bound.

Stored-report replay selects the target seat's trusted plan and requires component-bearing v2
traces to match it through `expectComponentTrace + expectedComponentPlan`. A fixed host manifest
therefore rejects coherent graph erasure or relabeling, dependency or causal-stage deletion, and
v2-to-v1 downgrade. Historical v1 and pre-B4 v2 artifacts remain readable for diagnostics, but
composed evidence without a trusted manifest is explicitly promotion-ineligible. Raw, heuristic,
random, and genuine external baselines require no manifest. This boundary is provenance, not a
signature: a party able to coherently rewrite the stored manifest, trace, and architecture metadata
after persistence remains outside the threat claim.

The report exposes a generic component view derived from admitted run entries: configured,
admitted, inapplicable, suppressed, degraded, exact, structural, promotable, causal-use, and
causal-stage counts. Variant and comparison output carries an explicit promotion-evidence verdict,
so quality deltas remain diagnostically visible without being mistaken for promotion evidence.
Weighted or otherwise structurally admitted entries keep the whole component evidence cell
nonpromotable, as does any generic component degradation. Trusted architecture mode is authoritative
for whether evidence is required: deleting both traces and the manifest cannot turn a composed
candidate into a not-applicable cell or an eligible comparison. No component payload, invocation
root, private policy-use record, or manifest data enters the public log, `PlayerView`, prompt,
voice, or client.

The dedicated B4 matrices pass 4/4 producer/report/privacy/replay cases and 10/10 hostile
manifest/trace/bounds/backward-compatibility cases. Focused architecture, replay, stdio, and
composed-agent validation passes 56/56, and the adjacent role-policy/free-bank matrix passes 96/96,
including the frozen 5-10 player architecture banks. The implementation full API-free suite passes
911/911. Phase 0 report fixtures, frozen prompt bytes, decisions, event logs, deterministic replay,
typed degradation, component versions, exact reconstruction, and weighted-unverifiable behavior
remain unchanged apart from the new optional generic report view. Manifest construction and report
validation happen after gameplay, so the decision path and its recorded latency samples are
unchanged. A one-case exact Merlin boundary probe produced a 167-byte manifest inside a
72,183-byte artifact and a 3,153-byte report; its six recorded decision samples had an 11.49 ms
maximum on the development host. Parent-focused validation passes 95/95, and independent
architecture rereview passes 114/114 and returns READY. The complete 7R2B exit gate is approved.

E2A does not begin after an intermediate kernel or adapter landing. It begins only after 7R2B4 and
the complete 7R2B exit gate pass, then must add Mordred through the same seam with **zero
Mordred-specific central fields**.

### Phase 7E2A implementation record

E2A adds two private production-native components through the generic registry:
`actor-target-treatment-read@public-actor-target-treatment-read-v1` and
`mordred-blindness-objective@mordred-blindness-objective-v1`. Callers request the objective; normal
dependency resolution adds the treatment read first. The actor-target treatment component consumes
only the canonical public record and exact public-observer root on proposal and vote decisions. The
objective additionally consumes the exact joint belief, applies only to Mordred when Merlin is in
the cast, and emits team opportunity assessments for proposals or the current vote team. Neither
component has policy-use stages or decision authority.

Each complete world supplies its own Merlin coordinate and excludes that world's Mordred from the
evil seats visible to the hypothesized Merlin. The objective records the Merlin-blind window,
hidden threshold-crossing probability, and a separate anomalous-public-treatment proxy. Its
bounded opportunity value is `0.75 * hidden threshold crossing + 0.25 * anomalous blind-window
proxy`. This value is explicitly a heuristic opportunity measure, not a posterior probability,
likelihood factor, or approve/reject utility. Every probability term is a direct sum over complete
joint worlds; no independent suspicion products or Assassin posterior appear.

Constraints-only beliefs and reconstructable public observations are exactly host-admitted and
promotion-eligible. Weighted beliefs remain structurally attributable and nonpromotable. The
implementation adds no Mordred-specific trace, cognition, artifact, report, prompt, or policy field; the
generic component graph is the sole write path. Component-owned observer metadata keeps the
resolved brain, decision trace, artifact, and report attributable without forcing legacy
inapplicable role components to run the observer. Execution-time suppression now requires a
registered exact host proof, and applicability is synchronous so runtime and host reconstruction
cannot disagree.

Dedicated coverage pins hand-worked one-Fail and two-Fail formulas, joint-world causality,
public-treatment causality, role/cast/decision applicability, weighted nonpromotion, private
canaries, name and seat-rotation invariance, deterministic replay, hostile graph and payload
rewrites, missing roots, artifact/report attribution, and 5-10 player bounds. The 10-player quest
four surface reaches but does not exceed the 252-assessment cap. Treatment and objective payload
caps remain 131,072 and 1,048,576 JSON bytes. The focused architecture/privacy/replay matrix passes
112/112 and the complete API-free suite passes 938/938; the 5-10 player deterministic bound case
completed in 532 ms total on the development host, with a 2-second runaway guard rather than a CI
latency SLO. Decisions, scores, prompts, public logs, defaults, forced-policy authority, and engine
legality remain unchanged. Independent final rereview passes 116/116 and returns READY.

### Phase 7E2B implementation record

E2B adds two opt-in built-in scorer identities,
`mordred-blindness-role-scorer-v1` and
`mordred-blindness-role-seeded-vote-band-v1`, backed by the ordered
`mordred-role-score` and `seeded-mordred-role-score` transforms. Their predecessors are the
matching deterministic and seeded D2 evil layers. The Mordred transforms declare only
`mordred-blindness-objective@mordred-blindness-objective-v1`; generic component dependency
closure supplies and attributes the public actor-target treatment read. Scorer descriptors add no
Mordred requirement property, and composition, trace, admission, report, stdio, prompt, and
communication schemas add no Mordred field or branch.

Applicability is exactly Mordred, Merlin in the cast, and proposal or vote. Universal forced policy
and the strategic candidate boundary run first. The layer computes the maximum predecessor D2
value among hard survivors and admits only the existing `0.04` D2 band. Proposal utility is the
canonical objective team's opportunity value. Both vote candidates join the one current-team
assessment; approve utility is opportunity and reject utility is `1 - opportunity`. These values
are bounded heuristic action utilities, not probabilities. Deterministic selection maximizes that
utility with canonical candidate IDs. Seeded proposals remain deterministic. Seeded votes vary
only when both actions are in the D2 band and their utility gap is at most `0.04`, using the stable
tuple of game seed, seat, decision kind, round, proposal number, belief event cursor, and scorer
version. Names, model roster, teammate behavior, and shared conventions are absent.

The candidate-score to action-selection transition now propagates every component that was
actually used at candidate score instead of enumerating known role tokens. Trace admission derives
native scorer and score-component membership from the configured registries, and featureless
diagnostics require proof that their version belongs to the resolved native chain. This makes E2B
a normal score-family extension and closes the generic seams it exposed without introducing a
Mordred exception. Private score reasons are limited to `MORDRED_D2_VIABLE_BAND`,
`MORDRED_BLINDNESS_OPPORTUNITY`, and `MORDRED_SEEDED_VOTE_BAND` plus generic forced-policy
reasons; public communication receives none of them.

Focused E2A/E2B/configured-layer/native replay/architecture-fitness validation passes 52/52, and
strict typechecking passes 82 roots with the unchanged 42 pinned legacy exemptions. The focused
fixture proves an exact host-admitted proposal that changes within the D2 band, proposal seed
invariance, seeded vote variation inside both bands, outside-band nonrevival, hard-boundary
dominance, transitive attribution, unknown-diagnostic rejection, and non-proposal delegation.
Existing E2A hostile, privacy, weighted-provenance, name/seat-rotation, report, 5-10 player, and
generic native replay suites remain green. `verify:contract` passes with all 115 test files
classified across the five feedback lanes. Small free five- and ten-player Mordred proposal probes
admit as trusted exact with zero degradation over 10 and 120 candidates, respectively; causal use
contains only the public treatment read, D1/D2 evil components, and blindness objective. The
complete API-free and independent-review gates passed before landing at `d25ca29`.

### Phase 7E3A implementation record

E3A adds the private native
`assassin-merlin-posterior@assassin-merlin-posterior-v1` component through the generic registry.
It applies only to an Assassin making the assassination decision with Merlin in the cast, consumes
only the already filtered `PlayerView` and resolved private belief root, and has no decision
authority. No Assassin-specific trace, admission, evaluation, report, prompt, communication,
candidate-score, or situation-analysis field is added.

The exact prior for a target is the direct joint-world mass whose Merlin coordinate is that seat.
Two public behavior features then reweight that prior: clean-team proposal rate and vote agreement.
Both are evaluated inside each possible world using Merlin-visible evil for that world, excluding
that world's Mordred. Proposal evidence uses every completed proposal in canonical order, including
rejections and their revealed votes; an automatic approval contributes the leader's proposal but
no vote evidence. The linear coefficient bundle is explicitly versioned, and the complete
relative behavioral log-weight span is compressed to at most `ln(2)` before normalization. The
result is labeled a bounded hand-authored reweighting, not a calibrated probability. Visible evil
has zero prior, while an unknown seat that could be Oberon remains in support because the
component never consults privileged truth.

The serialized projection stays compact: belief provenance, coefficient identity and cap,
aggregate span, and seat-keyed priors, observation counts, rates, and posterior. Role, request,
cast, formula, and deferred-feature semantics are fixed by the registered component and this
tracker rather than repeated as payload strings. Detached admission proves the closed transport
shape; exact host admission deterministically rebuilds the projection from the filtered view and
belief before the run becomes trusted evidence.

Trajectory and deliberate-noise shapes are deferred until evaluation supports their added
complexity. Role-claim evidence is also deferred because no typed trusted extractor exists; E3A
does not parse prose, use regular expressions, or reinterpret `roleKnowledgeTell`. E3B owns any
later target-selection authority. The dedicated E3A tests intentionally cover only its new joint
math, Mordred/Oberon information laws, compact codec, generic native execution/privacy contract,
and independence from truth outside the captured seat view. Generic hostile transport, replay,
artifact, report, and stdio matrices remain covered by the shared component harnesses.

### Phase 7E3B implementation record

E3B registers the deterministic
`assassin-merlin-target-score@assassin-merlin-target-scorer-v1` transform above the deterministic
D2 evil chain. It applies only to an Assassin choosing an assassination target with Merlin in the
cast and requires only the admitted E3A posterior. Within hard-policy survivors it selects maximum
posterior mass with canonical candidate-ID ties; an existing hard selection still dominates. Only
the selected target remains score-viable. Missing, inapplicable, or malformed posterior input
degrades through the ordinary D2 and compatibility chain.

The scorer is opt-in and has no seeded variant. Its reason codes and posterior remain private, and
it adds no Assassin-specific field or branch to candidate scores, situation analysis, admission,
evaluation, reports, stdio, prompts, or communication. Generic featureless diagnostics, registry
membership, causal attribution, replay, privacy, and degradation contracts own those concerns.
The compact E3B test adds only the unique policy laws; shared matrices are not duplicated.

### Phase 7F1 implementation record

F1 adds `full-role-policy-scorer-v1`, one immutable configured scorer whose registered
deterministic chain is compatibility, good proposal/vote, good-role, shared evil/Oberon, Morgana,
Mordred, Assassin, and a zero-component full-stack attribution terminal. The concrete transforms
remain mutually exclusive by their own applicability contracts. An irrelevant role component may
therefore be configured but is neither executed nor attributed for a decision. The terminal
preserves candidate values, viability, survivors, and the mechanical choice; its sole private
`FULL_ROLE_STACK_ATTRIBUTION` reason distinguishes the full scorer from the last applicable
specialization without claiming role evidence or entering public communication. Its generic
predecessor-diagnostic declaration makes runtime and exact replay derive semantic diagnostics
from the last prior active layer while retaining the full terminal as authoritative scorer.
Good-side strategic reasons, posterior uncertainty, and communication intent therefore remain
identical to the isolated specialization rather than collapsing to a featureless surface.

The isolated Morgana, Mordred, and Assassin scorers remain independently selectable. Deterministic
Mordred now has an inapplicable Morgana predecessor, and deterministic Assassin has inapplicable
Morgana and Mordred predecessors, so their resolved architecture identities truthfully describe
the complete registered prefix while their decisions remain unchanged. One compact integration
matrix covers full-versus-isolated mechanics for good, shared evil, Morgana, Mordred, and Assassin
play, unused-component attribution, and exact host replay. Role formulas, hard boundaries,
degradation, privacy, and transport laws remain owned by the existing reusable suites.

One boundary cleanup is intentionally not folded into E2A. Existing host-root validators establish
trusted typed values, but `validateBeliefForMordred` still rechecks admitted belief internals and
the treatment host join rebuilds the canonical public observer for exact comparison. Phase 7R2C
will make the parse/canonicalize-once boundary explicit before 7R3A, so downstream component
builders can trust admitted values without allowing raw or merely cast TypeScript objects through.

### Phase 7F2A evaluation-substrate record

F2A adds one API-free runner over the unchanged `standard-v1` cases and existing
`runArchitectureBench` plus `architectureReport` contracts. Each case has exactly five logical
arms: compatibility, deterministic good proposal/vote base, the same base with the public observer,
a role-specific isolated scorer whose raw ID names its actual scorer family, and the immutable
full-role scorer with robust heterogeneous D3 enabled. Raw evidence is deterministic JSONL sorted
by case and logical arm. Each row retains the host-owned architecture identity digest, target role
and seat, outcome, log and mechanical-decision digests, calls, cost, degradation, forced-play
violations, exact component admission, safety counts, and terminal status. It deliberately excludes
timestamps and raw latency. This is F2B input, not a report or promotion claim.

The E3A posterior now exposes its unchanged mathematics through a PlayerView-only evil-seat
predictor core. The production wrapper remains strict to an Assassin at the assassination request.
Four frozen 5, 7, 9, and 10-player successful-quest prefixes detach every seat view before any
prediction. All twelve evil seats select themselves only from their view role, freeze and hash an
unlabelled prediction, and join the true Merlin seat afterward. This includes ordinary visible-evil,
Oberon-isolated, and Mordred visibility shapes without passing a raw game, truth label, or paid
probe schema to the predictor.

### Phase 7F2B exit record

The committed `standard-v1` role corpus contains exactly 50 terminal rows: ten cases by
compatibility, base composed, observer-only, truthful isolated-role, and full-role arms. Every arm
made zero calls, spent zero cost, recorded zero degradation and forced-policy violations, and
passed hidden-information and attribution safety. All rows are promotion-eligible at the trusted
component-admission boundary with zero structural-only admissions. Base and observer mechanics
match in all ten cases.

Whole-game isolated/full equality is specified for the six cases where robust D3 cannot apply:
good target seats and Oberon. All six match. Eight of ten cases match overall; the 8-player Minion
and 9-player Mordred games differ because the full arm intentionally adds robust heterogeneous D3
to the isolated score-only arm. A separate six-row authority audit avoids conflating that integrated
effect with role-score correctness: good role, shared evil/Oberon, Morgana, Mordred, Assassin, and
robust D3 each produce the same mechanical action as their isolated reference, enter through
trusted-exact admission, record the expected causal component stages, and terminate through the
immutable full-role scorer.

The virtual Assassin corpus preserves twelve guesses from all evil seats across four histories.
Each unlabelled prediction digest is verified before the true Merlin seat is joined. The aggregate
reports 2/12 accuracy only descriptively and explicitly treats the observations as correlated,
with no promotion threshold. The deterministic report check reproduces the committed aggregate
byte-for-byte from the two raw corpora. This closes the Phase 7 architecture gate, not the
production or playing-strength gate: the ten mechanical games produced zero good-side wins in the
four composed arms and are neither a tuning sample nor evidence for default promotion.

### Phase 7R2C development-leverage checkpoint

E2A proved the generic component architecture, but it also exposed repeated implementation work
that should not scale linearly with every role. At the start of this checkpoint, the frozen
candidate had 938 tests and took about one minute on the development host. Ten agent modules
independently defined a `plainDetachedData` walk, many repeated exact-record and bounded-array
primitives, and new role coverage still reproduced generic transport, privacy, attribution, and
hostile-shape matrices. Runtime tests also carried work that a strict server `tsc --noEmit` gate
could reject earlier. High-churn integration files had grown beyond two thousand lines, making
parallel edits and causal review increasingly expensive.

7R2C is a bounded architecture investment, not a broad cleanup rewrite. Five independently
reviewed slices are now landed:

- **C1, commit `30a96e8`, keeps all coverage but separates feedback cadence.** Strict no-emit
  server typechecking and fail-closed fast, contract, evaluation, exhaustive, performance, and
  complete lanes are available. Performance assertions run serially outside correctness lanes.
  The tooling is development-only, so the production server remains zero dependency.
- **C2A, commit `35f30cb`, establishes the unsafe-input and component-conformance foundation.**
  The kernel performs bounded canonical JSON admission before semantic decoding, and every
  ingress to detached component validation crosses that boundary. Two production components have
  native executable conformance fixtures. The other ten production tokens are explicit legacy
  exemptions owned by C2B and 7R3; the inventory fails closed if a token is added, removed, or
  silently unclassified. New native components must use this boundary immediately, while legacy
  exemptions are retired one family at a time.
- **The replay half of C3, commit `b797a5e`, replaces repeated prefix reconstruction with one
  authoritative replay timeline.** It applies each action once, projects each newly appended event
  once into the timeline's seat-visible caches, binds private probes to their target seat, and
  reports actual work plus unavoidable serialized snapshot bytes. The normal one-shot view path
  constructs only the requested seat's projection, and artifact DTOs are detached from live replay
  state. Exact replay, privacy, and integration coverage pass with the complete 951/951 API-free
  suite.
- **The descriptor foundation of C3, commit `21c60a1`, establishes one immutable
  `ResolvedArchitectureDescriptor`.** It owns the configured component graph, required host
  inputs, base scorer and hard fallback, planner and voice configuration, and migration-only
  compatibility requests. The old private metadata shape is an exact projection rather than a
  second author. At that checkpoint, trace, artifact, and report projections still needed to
  consume it; those projections are now complete. Inspector v1 intentionally remains a
  `DecisionRequest + PlayerView` boundary viewer, while Inspector v2 is deferred as the
  descriptor/run projection.
- **The lazy-root slice of C3, commit `b646922`, makes component input work causal.** Runtime and
  host reconstruction share one `unresolved | missing | invalid | admitted` state machine.
  In-process providers execute only after applicability, construction eligibility, and dependency
  admission; each root and validator runs at most once per decision. Callbacks cannot cross into
  descriptors, traces, artifacts, or stdio. The generic observer now runs and stages only on first
  use, while the compatibility observer keeps its historical ordering. Strict typechecking,
  101-file lane inventory, 966 correctness tests, and three isolated performance tests pass.
- **The trace-projection slice of C3, commit `34b30ac`, removes a second architecture author.**
  Stable trace fields are a pure projection of the exact resolved descriptor, while actual
  runtime production and degradation remain facts of the admitted run. Trace assembly no longer
  reconstructs configured components or role-specific observer labels, and the descriptor/run
  join rejects mismatched identities.
- **The dependency-fitness slice, commit `5f47201`, makes coarse ownership executable.** Every
  verification level uses the pinned TypeScript parser to reject declared dependencies from
  engine to agents/evaluation, runtime agents to evaluation or raw `Game`, generic
  policy/components to artifacts/reports, and trusted host capabilities outside composition and
  the component kernel. Unreadable, malformed, escaping, or unclassifiable dynamic dependencies
  fail closed. This is a regression guard for trusted contributors, not a sandbox against a code
  author deliberately using runtime evaluation or filesystem loading. The 102-file inventory,
  982 correctness tests, and three isolated performance tests pass on the landed tree.
- **The artifact/report slice of C3, commit `b422c31`, completes descriptor ownership.** One
  migration-free `ResolvedArchitectureIdentity` and semantic codec now own current configured
  truth. The immutable identity digest is computed once per composed agent, carried by its private
  traces, and independently joined to the host-created target-seat manifest. Artifact admission
  happens once per observation; safety, grouping, evidence, and rendering consume that typed
  result. Exact identity equality controls current variant grouping, while configured display
  metadata is only a projection. Runtime belief facts and finalized replay retain their existing
  owners. Invalid present current manifests hard-fail, and schema-1 manifests remain readable
  through a named nonpromotable legacy adapter. Independent review returned READY; strict
  typechecking, 102-file inventory, 989 correctness tests, and three isolated performance tests
  pass.
- **C4A and C4B establish and wire the staged decision spine.** Canonical request/view now precede
  legal candidates; candidate-aware analysis precedes universal forced policy; component execution
  consumes that exact frame through a trusted-provider factory; the quarantined D3 adapter can run
  only after a nonselecting universal result; scoring, viable selection, existing-owner plan commit,
  and voice follow in order. The live composed path uses these transitions as its sole pipeline
  state. Final trace fields project the voiced frame's scores, IDs, effective forced result,
  degradation, component attribution, plan communication, and action rather than synchronized
  local shadows. `composed.ts` no longer calls the component kernel or names trusted-provider
  capabilities and has left the architecture-fitness allowlist.
  C4B deletes 282 and adds 227 lines in `composed.ts` relative to the C4A base. The remaining
  compatibility scorer degradation chain is isolated in `policy/legacy-scoring.ts` and is owned
  for retirement by 7R3. A provenance-pinned pre-C4 oracle covers every frozen decision kind,
  matching-base and hard fallback, real D3, planner acceptance/rejection, voice success/no-output/
  failure, exact serialized-trace hashes, bounded planner/voice inputs, and diagnostic stages.
  The only intentional compatibility correction is that the ephemeral stage hook now reports
  candidates before the candidate-aware analysis that consumes them.
  The C4B oracle is temporary migration evidence: delete its capture tool, fixture, test, and lane
  entry after the behavior-preserving 7R3 adapter retirements pass the 7R3 exit audit. Never
  regenerate this pre-C4 oracle to approve an intentional policy change; later policy behavior
  gets a new, separately owned evaluation baseline.

  **RETIRED (2026-07-29), earlier than the 7R3 exit audit that was meant to release it.** Removing
  the declared-lean signal deleted `SituationAnalysis.voteLeverage`, which had gated the two
  decisive-vote forced-play codes, and bumped `situation-analysis` and `legal-candidates` to v2.
  Every oracle trace hash diverges as a result. The divergence is an intentional policy change, so
  the clause above forbids the only repair available, and the oracle cannot distinguish this change
  from a regression. `tools/capture-c4b-baseline.mjs`, `test/fixtures/phase7r2c4b-baseline.json`,
  `test/phase7r2c4b-baseline.test.ts`, and the contract-lane entry are deleted. What it was
  guarding stays covered: the score-family conformance harness (`test/support/score-family.ts`)
  admits and forges every family terminal, and `test/phase7r2c3-architecture-descriptor.test.ts`
  still pins deterministic trace bytes. A pre-change oracle for behavior after this point has to be
  captured fresh; do not resurrect this fixture to serve as one.

The cross-review findings establish these development guardrails for the rest of the migration:

1. **Bound before traversal.** Admission rejects impossible declared array sizes and exhausts a
   byte-derived work budget while walking; it never performs an unbounded walk and checks the size
   afterward.
2. **Canonicalize external ingress, then trust typed capabilities.** Host roots, component
   payloads, traces, and external reconstruction enter through the hostile-data boundary. One
   component-owned decoder produces the typed value. Internally constructed frames and one-shot
   capabilities carry identity and sequencing by construction; downstream policy consumes them
   without another hostile walk, serialization round trip, global provenance map, or cast.
3. **Reject unsupported attribution explicitly.** An unknown observer, mode, component token, or
   lane classification is an error or an attributable degradation. It must never be relabeled as
   `off`, absent, or otherwise valid.
4. **Measure the work actually performed.** Complexity tests count log events scanned, seat-view
   events projected, actions applied, and serialized bytes emitted. Full historical snapshots
   necessarily cost the bytes they emit, so the replay contract is linear in log work plus output
   size, not a misleading constant-time or event-only claim.
5. **Test negative privacy capabilities.** A target-seat replay must prove that it cannot invoke
   all-seat projection, capture a raw `GameEvent`, select another seat's decision, or expose a
   private probe. The normal one-seat view path must not pay the cost or accept the capability of
   building every seat's view.
6. **Keep replay inputs append-only and outputs detached.** The replay projector binds one exact
   `Game` identity, accepts only an immutable append-only event-log prefix, and returns detached
   artifact DTOs rather than references to mutable engine or cache state. Historical rename
   semantics remain behind one explicit compatibility adapter instead of contaminating the
   current projection model.
7. **Make the landing gate cheap to enter and hard to bypass.** Run strict typechecking and the
   smallest focused test first, then independent boundary review, then contract and complete
   API-free suites. The lane inventory is fail closed. Every commit has a detailed motivation,
   behavior, design, and verification body, followed by a pre-land commit-message and clean-tree
   check.
8. **Separate boundary validation from domain semantics.** Shared admission owns hostile-shape
   limits, prototype rejection, canonical JSON, and detachment. A component-owned codec owns the
   meaning of one external shape. Host join owns contextual equality against reconstructed private
   inputs. Code after that join receives a trusted discriminated type and does not repeat parsing,
   bounds checks, or canonicalization.
9. **Prefer registered data over central branching.** Applicability, dependencies, codecs,
   policy-layer order, fallbacks, and projection metadata belong in component or layer
   descriptors. A growing role- or token-named `if`/`switch` in the orchestrator, trace, artifact,
   report, or Inspector is an ownership defect unless it is an explicitly quarantined
   compatibility reader.
10. **Use exact fixtures only where exactness is a contract.** Byte and property-order goldens
    protect wire formats, historical compatibility, prompts, and deterministic persisted
    artifacts. Domain behavior uses formula examples, algebraic invariants, and replayable
    generated cases so harmless representation changes do not create broad fixture churn.
11. **Keep observability downstream of execution truth.** Trace, artifact, report, and Inspector
    project the same descriptor plus admitted run. They may filter private data for their
    audience, but they do not infer which policy ran, repair missing causal stages, or relabel an
    invalid trace into a self-consistent story.
12. **Quarantine migration debt.** Historical readers have named adapters, explicit version
    states, and retirement owners. New write paths never emit legacy optional bags. Compatibility
    code does not become a shared utility imported by native policy.
13. **Keep behavior-free seams additive.** The old call path and its assertions remain unchanged
    until the wiring chunk replaces them; a seam does not justify changing behavior.
14. **Expire every parallel authority.** Its next chunk names and deletes the old writer, then
    reviews net complexity instead of merely celebrating the new abstraction.
15. **Carry provenance from construction.** A stage initiates dependent work against its exact
    immutable inputs and carries a local one-shot lease through the later typed frame. The lease
    exposes only bounded planning requirements, verifies the exact resolved brain, delegates once
    to the existing component transition, binds its exact returned frame, and owns consumption in
    closure-private state. Do not pre-run work for later attachment, add global provenance
    registries, serialize a provenance token, or rely on downstream deep revalidation.
16. **Ratchet compatibility debt.** Native code adds no legacy walker, central role field,
    optional compatibility bag, or unowned cast; every exception names its retirement owner.
17. **Build typed semantic scenarios.** Normal tests use scenario builders; only the generic
    contract kit constructs hostile raw values. Extract shared automation after a third use or
    when two uses demonstrably enforce the same invariant; superficial repetition alone is not an
    abstraction trigger.
18. **Treat assertion changes as behavior decisions.** They require explicit justification and
    cannot be inverted merely to bless a refactor. A change-surface or complexity-budget breach
    stops new cross-layer branching.
19. **Prove replacement equivalence from an independent oracle.** A compatibility fixture records
    the exact clean source commit that produced it and never derives expected values from the
    runner under test. C4B's oracle was captured from the clean C4A commit `5354c2c`; the live
    runtime still has one decision authority.
20. **Make replacement work retire authority.** Each chunk names and deletes the old writer;
    compatibility exemptions only shrink and every survivor has an exact retirement owner.
    Native families use the shared contract kit and typed scenarios. Net-additive central
    replacement work requires an explicit retained-authority explanation, and owner-local
    operation counts are preferred to development-host wall-clock assertions.
21. **Keep new frameworks provisional through first production use.** A generic seam is not
    settled merely because its synthetic contract is green. Its first real role family must use
    it without a central ID switch, then a simplification audit removes unused generality,
    duplicate authority, and construction proofs that the staged types already guarantee.

The development model follows a proof pyramid rather than using end-to-end mutation matrices as
the first line of defense:

1. **Types prevent invalid in-process states.** Staged frames and discriminated unions express
   sequencing and availability. Optional bags and casts do not substitute for a state model.
2. **One codec owns each external shape.** Hostile `unknown` data is bounded and canonicalized at
   every ingress, then one component-owned decoder produces a trusted semantic value. Independent
   trust boundaries still validate independently; downstream consumers do not parse again.
3. **A reusable contract kit proves generic component behavior.** The kit owns bounds, hostile
   shapes, detachment, deterministic replay, root/dependency degradation, privacy projection,
   exact versus structural host admission, and causal-use attribution. Component tests add only
   their formula and role semantics.
4. **Algebraic and metamorphic tests cover broad policy behavior.** Fixed-seed generators exercise
   survivor monotonicity, seat-permutation equivariance where applicable, hidden-equivalent view
   invariance, irrelevant-history invariance, deterministic replay, forced-policy dominance, and
   voice-after-commit. Failures print a replayable seed.
5. **A small exact fixture bank proves composition.** Frozen decisions, prompt hashes, target-seat
   privacy, artifacts, reports, and stdio prove the seams without making every local iteration
   rebuild an entire game.
6. **The complete API-free suite is the landing proof.** It is not the default tool for locating a
   local defect.

The remaining work follows a **systemic development operating model**. Its purpose is to move
correctness earlier, where types and narrow contracts can prove it cheaply, instead of discovering
invalid states through large mutation matrices or complete simulations:

1. **Draw the trust boundary once.** External JSON moves through four explicit states:
   `unknown -> bounded canonical data -> component-decoded DTO -> host-joined domain value`.
   Only the first two states need hostile-shape walking. In-process constructors return the
   host-joined type directly; downstream policy and projections never serialize, cast, or parse it
   again. Independent external boundaries still admit independently, but internal module boundaries
   do not pretend trusted values are hostile input. Internal sequencing uses typed, invocation-
   local capabilities rather than serializable provenance records.
2. **Represent variants as variants.** Mode-, stage-, and applicability-dependent values use
   discriminated unions with exact members, not one interface containing many optional fields.
   Constructors make illegal combinations unrepresentable. Codecs prove transport shape; small
   semantic refinements prove relationships within one member; the host join proves equality to
   authoritative request, view, belief, and analysis.
3. **Return diagnostic failures at boundaries.** New native codecs return bounded structured
   failures with component, path, and reason for tests and debug tools. A boolean accept/reject
   projection may exist for a wire contract, but it does not erase the diagnostic internally.
   This avoids debugging a large validator by adding one mutation and one branch at a time.
4. **Budget change surface, not just runtime.** A native policy family normally changes its
   descriptor, codec, formula, local tests, and one registry inventory. Review stops for an
   architecture correction if the change adds a role-named branch or field to a generic
   orchestrator/projection, a second parser for an existing shape, a second policy writer, or
   synchronized edits across trace, stdio, artifact, report, and Inspector. Those are interface
   failures, not an expected role checklist.
5. **Make the compiler and local laws the inner loop.** The default sequence is strict typecheck,
   owner-local formula and contract tests, deterministic algebraic or metamorphic laws, one small
   composition fixture, then the contract and complete lanes before landing. Full games and paid
   calls evaluate play quality after the architecture is coherent; they are not the primary way to
   find schema, ordering, attribution, or authority defects.
6. **Migrate by substitution and deletion.** Every replacement slice names the old writer,
   validator, exemption, and fixture it will remove. A slice that only adds a parallel path is
   incomplete unless its retained authority has an explicit next owner and near-term deletion
   point. Net central complexity, not new abstraction count, is the review measure.
7. **Decompose hotspots by transformation ownership.** File size alone does not trigger a split,
   but a module that admits, semantically decodes, host-joins, executes, and projects the same value
   has multiple owners and should be separated along those transitions. The current
   `admission/composed-trace.ts`, `eval/architecture-report.ts`, `composed.ts`, and `policy/score.ts`
   are migration hotspots; new features do not extend them merely because they already contain
   adjacent compatibility code.
8. **Keep orchestration sequential at authority changes.** Separate worktrees can build independent
   tooling, fixture capture, or owner-local components in parallel. Changes to the same registry,
   staged frame, schema version, compatibility oracle, or live decision authority remain
   sequential and are reviewed on the exact rebased tree. This avoids spending validation time on
   combinations that can never be landed safely.

These are stop conditions for the parent orchestrator, not style suggestions. When one is tripped,
the next task is to repair the seam or narrow the state model before adding coverage. A test that
passes by teaching another downstream consumer to recognize the same invalid shape does not close
the defect.

The remaining systemic improvements are tracked explicitly rather than rediscovered inside each
role migration:

| ID | Owner / when | Improvement | Acceptance |
|---|---|---|---|
| DEV-001 | **Installed after A2; A3 is the first mandatory consumer** | Add a typed legal-replay `DecisionScenario` helper | The small non-fluent helper clones its input game once, validates exact request coordinates through `expectedDecisions`, advances only through `applyDecisionWithOutcome`, and returns only a detached request, seat-filtered `PlayerView`, and visible event cursor. The request/decision mapped union rejects mismatched kinds at compile time. A3's new strict contract test must derive its decision surface this way rather than splice phases or request cursors. |
| DEV-002 | **Gate installed after A2; exemptions burn down with each slice** | Ratchet strict typechecking over new and touched test/support code | `tools/strict-test-ratchet.mjs` is the single inventory authority in `typecheck` and every verifier level. At installation, 73 roots pass strictly and 43 legacy top-level tests have LF-normalized content hashes plus reviewed rationales. Every new top-level test is strict automatically; all eight `test/support/**` and `test/typecheck/**` files are always strict; changed or deleted exemptions fail closed. Repository fitness uses TypeScript's config parser and rejects any test file resolved from another root `tsconfig`, including `include`, `files`, globs, and inherited settings; config diagnostics and nonempty root project references fail closed rather than allowing a nested inventory to bypass the owner. The ratchet, verification funnel, and architecture-fitness tests themselves are strict roots. |
| DEV-003 | **LF policy installed after A2; controlled legacy normalization remains pending** | Adopt repository line-ending and editor policies without mixing mechanical rewrites into behavior commits | `.gitattributes` declares extension-scoped LF text and explicit binary formats; `.editorconfig` declares UTF-8, LF, final newlines, and trailing-whitespace behavior without imposing indentation. The policy commit performs no `git add --renormalize`, no bulk normalization, and changes no unrelated tracked bytes. The one known pre-policy CRLF blob, `server/eval/report.ts`, has a narrow temporary `-text` exception so the policy cannot silently rewrite it; remove that exception only in a separately reviewed normalization commit. |
| DEV-004 | **Implemented after the generic policy-run DTO and A4 cutover** | Derive Inspector and equality diagnostics from one admitted native run record | One bounded, payload-free record supplies the score-layer journal, candidate surface, forced and strategic gates, committed mechanics, voice status, and compatibility choice. Exact admission replays and compares the native run before causal panels become eligible; diagnostic admission and seat-view-only mode cannot populate them. No observability consumer reconstructs, erases, or relabels causal state independently. |
| DEV-005 | After Phase 7 | Split this tracker into a concise authoritative active contract and append-only completed-phase history | Preserve stable anchors and inbound links, keep current gates and debt easy to find, and prevent the roughly 219 KB historical record from remaining the primary working surface. A2 changes only this stale current capsule. |

`DecisionScenario.source.seed` is test-only replay provenance. The deterministic game seed can
reconstruct the hidden deal, so this DTO must not be reused for external agents, Inspector, client,
or any seat-visible production payload. Those boundaries require their own explicitly filtered
provenance contract.

Inspector v2 preserves that boundary by projecting only `SeatDecisionInspection` into the
loopback browser. The projection omits the seed, true deal, raw trace, identity witness, other-seat
views, and component payloads. Deterministic full-role fixtures exercise every supported private
role, while custom snapshots are projected and discarded before the server begins listening.
Isolated-role versus full-role equality remains explicitly unavailable until one admitted paired
artifact owns that comparison.

The same post-A2 gate installs `score-layers/configured.ts` as the one normal score-family
selection surface. It owns terminal selection, registry construction, decision applicability, and
the temporary A0/A2 equality dispatch. `composed.ts` imports only this seam; generic policy and
component code cannot import concrete families, and concrete families cannot import one another.
Fail-closed ARCH007 checks named, aliased, namespace, export-from, dynamic-import, and `require`
edges. A3 adds one evil catalog entry at this seam; edits to composition, trace, report, stdio, or
Inspector for family selection are a seam failure during 7R3.

The post-A2 gate also closes the deterministic-order debt:
`policy/candidates.ts::compareCandidateIds` is the one owner for candidate selection ties across
analysis, legacy policy, native policy, validation, and planning. It specifies deterministic
lexicographic UTF-16 code-unit order, not Unicode code-point or host locale collation, and has a
focused ordering law. The root TypeScript project remains
intentionally non-composite: the strict-test ratchet rejects nonempty `references` in any root
configuration it audits, because a referenced project could become a second test-inventory owner.
Shared test/support code is compiled directly under the repository's one server option set.

This ordering is a response to measured change cost, not an attempt to reduce assurance. At this
checkpoint agent source was about 33,500 lines and tests about 35,600 lines. The test tree had
roughly 550 manual `structuredClone` mutations, 250 direct composed-agent constructions, and 24
files reaching into architecture bench or report paths. Those numbers show that common proof
machinery is being restated. They do not justify deleting outer-boundary tests; they justify
moving their repeated setup and mutation rules into owned contract and scenario helpers.

Every new policy family also has a **change-surface test** during review. A native component should
normally add its declaration, semantic codec, policy implementation, formula tests, and one
independently maintained inventory entry. If it must also add role-named fields or branches to the
central orchestrator, trace, stdio, artifact, report, and Inspector, that is an architecture gap to
fix rather than a checklist to repeat. Compatibility readers are the explicit exception and carry
a named retirement owner.

The 7R2C outcomes and 7R3 handoff are:

1. **C4 is complete as two staged `DecisionFrame` chunks**, not one optional-field bag.
   Candidate generation, candidate-aware analysis, universal forced policy, exact-frame component
   execution, quarantined D3, scoring, selection, commit, and voice now have one live authority.
   D3 remains behind its named post-universal compatibility adapter until 7R3B.
2. The C2A fixtures now use a **reusable component contract kit**. Eight exact 7R3A exemptions and
   two exact 7R3B exemptions remain; a migrated family cannot retain its exemption.
3. Add **operation budgets during 7R3A** for applicability evaluations, roots materialized,
   components executed, policy layers invoked, candidates scored, and posterior assessments
   reused. These budgets assert bounded work without turning development-host wall-clock timing
   into a false CI contract. The relevant counters are a 7R3A landing requirement, not a blocker
   to beginning the ordered-layer implementation.
4. Continue using the **Git-native clean-commit handoff** in Section 3.4. Exact base, commit, and
   tree identities bind review and verification; commit bodies carry human declarations;
   existing tests own component exemptions. Do not add a private manifest or support dirty-tree
   handoff unless repeated evidence shows the narrower protocol is insufficient.

Descriptor and staged-frame ownership are complete, so 7R3A is the next sequential interface gate.
Coarse dependency fitness runs in every verification lane: engine cannot import
agents or evaluation; runtime agents cannot import evaluation or raw `Game`; generic policy and
component code cannot import artifact or report types; trusted provider callbacks remain confined
to in-process composition. 7R3 owns the remaining transitional analysis-policy and
cognition-communication compatibility paths.

Broad file splitting, a third-party schema runtime, wholesale conversion of historical validators,
and a rewrite of every legacy compatibility reader are deferred until a measured bottleneck or the
owning migration slice justifies them. Large modules split by transformation ownership after the
new seams exist, not by line count. D3's optional-field-heavy live payload becomes a discriminated
native layer in 7R3B, while one quarantined compatibility decoder keeps historical artifacts
readable. Paid tests and win-rate tuning remain deferred until the architecture can be evaluated
as a coherent whole.

The 7R2C exit gate requires strict server typechecking, a green fast and complete test matrix,
fail-closed classification of every production component token with an executable conformance
fixture for every native token, byte-identical replay snapshots, derived metadata equality across
runtime/artifact/report surfaces, frozen decisions/prompts/logs/replay, and no new role-named
central write field. Each remaining legacy exemption must name its retirement owner; 7R3 cannot
declare a migrated family native while its exemption remains.

**Exit audit passed on `26eee384`.** Independent code/ownership and metadata/evidence audits
approved 7R3A. The final parent gate passed strict typechecking, architecture fitness, the
104-file fail-closed lane inventory, 999 correctness tests, and three isolated performance tests.
The applicable free banks passed; a separate ten-case `standard-v1` autopilot run recorded 7/10
target-side wins, zero forced violations, zero degradation, zero calls, and zero cost. The
registry contains twelve production tokens: two have native executable conformance fixtures,
eight exemptions name 7R3A, and two D3 exemptions name 7R3B. Frozen decisions, prompt hashes,
trace hashes, replay/log snapshots, descriptor-manifest-report joins, target-seat privacy, and
historical provenance all pass.

Inspector v1 remains intentionally limited to the `DecisionRequest + PlayerView` boundary. It is
not evidence that descriptor, admitted component-run, candidate, policy-gate, committed-action,
or voiced-frame diagnostics are implemented. Inspector v2 remains a post-7R3 projection over
`ResolvedArchitectureIdentity`, admitted `DecisionComponentRun`, and `DecisionFrame`; it must not
become a parallel metadata author.

**7R3 converts policy composition after the component kernel is stable.** In 7R3A, the shared base
score and C2, D2, and E1 policies become ordered registered layers. Each layer receives the last
valid forced-policy survivor surface, declares its dependencies and fallback, and cannot revive a
removed candidate. The native score surface carries one enforced `score-layer-surface-v1` schema
version; each row contains only candidate identity, scalar value, viability, and bounded reason
codes. The exact journal layer token owns producer attribution. Good-role, evil-role, and
Morgana feature records remain in their owning analysis or component output and may enter an exact
historical projection only through a named compatibility adapter. They do not become optional
fields on the new common score type.

Layer output is constructed once by an invocation-bound factory that enforces the complete legal
surface, hard-survivor monotonicity, forced-choice dominance, finite bounded values, exact row
shape, and reason/string/aggregate limits. The runner accepts that constructed value and does not
reparse trusted in-process output as hostile JSON. Request- and view-dependent analysis needs are
resolved by a bounded lease prepared from the exact candidate frame: opaque requirement references
are available before analysis, failed transform preparation degrades only that transform, and all
evaluations appear in the journal and operation counts. The same closure-private capability verifies
the exact resolved brain, delegates once to the existing component transition, binds the exact
returned component frame, and can be consumed only against that frame. Concrete analysis-profile
combination belongs at the family edge, not in the generic registry.

**7R3A0 is complete; 7R3A1 is provisional after its A1.1 architecture correction.** A0 froze an
independent sixteen-scenario compatibility oracle at
`d7789a2`; its expected decisions are reconstructed from legal replay rather than from the scorer
being replaced. A1 adds the role-agnostic native score-layer kernel without changing the live
composed path or its empty production layer order. The kernel has one registered root, ordered
monotone transforms, an invocation-local one-shot lease and family admission join, an exact immutable
surface factory, canonical forced-policy projection, and run-wide component-use attribution.
Concrete layer dependencies are derived into the component request graph, so callers cannot omit
the matching component while still constructing a valid brain.

The A1 implementation applies the systemic model above rather than adding another central
validator. Generic rows contain only candidate identity, value, viability, and bounded reason
codes; one surface schema version and the journal token replace arbitrary per-row producer
versions. The runner is split by transformation owner into registry, requirement preparation, component
closure, surface construction, and orchestration modules. Component payloads and definitions are
indexed once; survivor lookup is set-based; cycle and dependency walks are iterative; all retained
candidate-, layer-, requirement-, graph-, attribution-, and byte-dependent work has an explicit
counter. Construction-proven chain and component-run facts are not rescanned merely to produce
more counters. Stress laws cover a 4,000-layer registry, a 12,000-node dependency chain without stack
growth, and sparse component reads. Architecture fitness rejects role identifiers or legacy
scorer dependencies in the generic kernel.

A1.1 subsequently corrected three interface defects: module-global preflight provenance became a
minimal local lease whose narrow wrapper binds the exact brain and sole component-transition result;
the trusted runner stopped deeply revalidating the resolved brain and staged frame; and transform
applicability plus surface schema/provenance each gained one authority. The
strict native contract lane is glob-inventoried so later `score-layer-*` family helpers cannot
silently escape typechecking.
The corrected gate passes both independent oracles, 319 contract tests, 1,031 API-free correctness
tests, three isolated performance tests, and screenshot freshness without a client-source change.

**7R3A2 is complete.** The exact
built-in scorer singleton selects a family-owned chain; custom or malformed same-version scorers
remain entirely legacy. Native preparation, component binding, and equality shadowing are scoped
to proposal and vote decisions, so an independently configured D3 quest policy does not enter the
A2 lease or shadow path. The native and legacy forks start from the same exact post-component
frame, and the legacy result remains the only downstream decision/trace writer through A4.
Phase 4A, Phase 4B, the seeded Phase 4 vote band, deterministic C2, and seeded C2 are covered,
including out-of-scope delegation, forced-survivor monotonicity, deterministic replay, and exact
comparison to A0's pinned scenarios. The temporary comparison now reports a bounded first
candidate/field delta together with the configured chain, native journal, survivor sets,
structured IDs, and component-use delta.

The family laws are intentionally layered instead of restated. `A2 exact built-ins resolve
canonical family-owned chains` covers exact singleton/custom-clone routing;
`Phase 4A singleton covers proposal, delegated vote, descriptor, and forced survivors` covers
applicability and hard-policy dominance; `role scorer is opt-in and ineligible decisions resolve
exactly to base` covers C2 inapplicability; `malformed role output degrades to the matching base
and compatibility is last` plus A0's `c2:malformed-falls-to-phase4` scenario cover ordered
fallback; the good proposal/vote name and seat-rotation laws plus `seeded role votes vary only
inside the combined band and replay exactly` cover metamorphic invariance and replay. The
Phase 4 transform and C2 recomputation call one native deterministic good-base calculator; seeded
Phase 4 and seeded C2 add only their bounded selection adjustments.

The historical A2 simplification and change-surface audit was:

| Audit question | Historical A2 result | Subsequent owner |
|---|---|---|
| Did composition gain concrete role or requirement-ID branches? | No. The analysis domain compiles opaque family requirements, and architecture fitness rejects concrete good-analysis IDs in `composed.ts`. | Preserve in A3/A4. |
| Did a generic or observability schema gain role fields? | No. Native rows remain the four-field common score shape; architecture fitness rejects trace, report, stdio, and legacy `CandidateScore` dependencies from concrete score families. | A4 removes old write-side projections. |
| Was hostile input admitted once? | Yes for migrated good objective/utility payloads: shared bounded canonical JSON precedes family decode and exact host join. The admitted utility child consumes its kernel-admitted objective dependency without revalidating it. | Apply the same substitution in A3/A4; historical external readers still admit independently. |
| What duplicate machinery was removed? | Two manual detached-data walkers, the utility child's repeated objective validation, the utility child's redundant direct identity host root, two independent native Phase 4 formula implementations, and two conformance exemptions. | A4 retires the legacy good scorer writer and temporary equality adapter. |
| What is the normal future change surface? | The family contract/constants, `score-layers/good.ts`, an owning analysis/component codec when needed, one registry inventory, and focused formula/contract fixtures. | A role feature that also edits central trace, stdio, report, artifact, and Inspector schemas is an architecture correction, not normal work. |
| What legacy authority remained after A2? | `withLegacyScoring`, good/role scorer implementations in `policy/score.ts`, feature-rich legacy score/trace projections, and the named A2-A4 equality adapter. The good objective/utility definitions were behaviorally native but still physically housed in `components/legacy-role-adapters.ts`; `source: 'native'` alone was not structural cleanup. Their admitted/degraded/inapplicable generic entries also retained an exact named flat-trace compatibility binding. | A4 would extract those definitions to a native owner, remove the compatibility binding and flat projection together, then perform the cutover and deletion audit. |

Independent final review approved the original A1 snapshot after rejecting and correcting earlier
versions that had reused the optional-field legacy score type, duplicated hostile parsing for
trusted values, lacked exact host joins, or hid repeated scans. The parent gate passed strict
typechecking, architecture fitness, both independent compatibility oracles, 1,026 API-free
correctness tests, and three isolated performance tests. The legacy scoring function and
`composed.ts` remained source-identical to A0. A1 remained provisional until A2 became its first production
client and completed a simplification audit. Before A2 received live decision authority, the
native selected/plan/trace projection seam must be specified; this correction deliberately does
not create that downstream authority, and A4 cannot cut over until the seam is the sole current
writer. 7R3A3 follows with the generic evil family, then 7R3A4 owns Morgana and remaining write-side
cleanup before the 7R3A equality and deletion audit.

The compact Phase 7 scorecard is run from the repository root after each authority chunk:

```powershell
(rg -n "legacyExemption: '7R3[AB]" test/component-conformance.test.ts | Measure-Object).Count
(rg -n "withLegacyScoring\(|scoreCandidates\(" server/agents | Measure-Object).Count
$p=@('server/agents/admission/composed-trace.ts','server/eval/architecture-report.ts','server/agents/communication/composed-renderer.ts'); (rg -n "roleObjective|evilRole|morganaRole" $p | Measure-Object).Count
(rg -n "canonicalRunInputs|structuredClone|JSON\.parse|canonicalizeJson|exactOwnDataRecord|denseOwnDataArrayValues" server/agents/policy/score-layer server/agents/score-layers 2>$null | Measure-Object).Count
(Measure-Command { npm.cmd run typecheck; node tools/architecture-fitness.mjs; node --test test/architecture-fitness.test.ts test/score-layer.test.ts }).TotalSeconds
$o=@('tools/capture-phase7r3a-score-oracle.mjs','test/fixtures/phase7r3a-score-equivalence.json','test/phase7r3a-score-equivalence-oracle.test.ts'); ($o | Where-Object { Test-Path $_ }).Count
$n=0; git diff --numstat d7789a2 -- server/agents/policy/score-layer server/agents/score-layers server/agents/policy/legacy-scoring.ts | ForEach-Object { $x=$_ -split "`t"; if($x[0]-match '^\d+$' -and $x[1]-match '^\d+$'){$n+=[int]$x[0]-[int]$x[1]} }; $n
```

The A1.1 checkpoint is respectively `10`, `7`, `194`, `0`, under `10` seconds on the
development host, `3`, and `+1778` production lines relative to A0. Exemptions, legacy calls, and
role-named current projections must decline as their owners migrate; duplicate score-layer
parsers must remain zero. The temporary oracle count becomes zero at the 7R3 exit audit. Net
authority-family lines may rise for A2's first client, but A2's simplification audit and A4's
cutover must explain or reduce the total rather than treating framework growth as success.

The pre-freeze A2 scorecard is respectively `8`, `7`, `194`, `0`, `4.72` seconds on the same
focused lane, `3`, and `+2623` production lines relative to A0 (`+845` since A1.1). The first
production family necessarily adds concrete layers and the temporary equality edge, but removes
two conformance exemptions without increasing legacy call sites, central role projections, or
duplicate parsers. A4 owns the expected drop when the legacy good writer, equality edge, flat
compatibility projections, and physical definitions under `legacy-role-adapters.ts` are deleted.

The A2 pre-freeze evidence is strict server plus strict test-contract typechecking, clean
architecture fitness, `134/134` focused tests, `328/328` contract-lane tests, and the complete
API-free verifier at `1041/1041` correctness plus `3/3` isolated performance tests. The historical
pre-C4 trace hashes remain unchanged through an explicitly unmapped compatibility clone; the exact
default singleton separately reports the new native compatibility-root descriptor and stable
digest. `git diff --check` passes, no client file differs from the A1.1 base, and screenshot
freshness remains `bae3010696159ecb`.

**7R3A3 is complete.** Exact singleton identity
selects one deterministic or seeded evil-family terminal; custom and malformed same-version
scorers remain wholly legacy. The configured seam owns the only family catalog entry and supplies
the matching C2 predecessors, producing the exact compatibility to Phase 4 to C2 to D2 chains.
The D2 transform reads the already admitted evil utility once, preserves the existing `0.04`
vote band, seed tuple, `1e-9` selection adjustment, canonical candidate ordering, forced-policy
dominance, and Oberon self-only utility semantics. It never imports or recomputes the good family,
and D3 quest policy remains outside the proposal/vote layer lease.

D1 and D2 hostile payloads now cross the component kernel's bounded canonical JSON boundary once.
Their family decoders validate the resulting canonical value, while exact host joins operate on
typed admitted dependencies. The objective host join trusts the kernel-admitted identity root and
exactly rebuilds from its typed fields; raw historical admission remains the separate owner that
validates identity shape and marginal reconciliation. The utility child no longer revalidates its
admitted objective or rescans either constructed payload with `JSON.stringify`; its vote
alternative remains an authoritative host-built value rather than a second component dependency.
Both definitions now declare native execution and their two conformance exemptions are retired
through proof-owner coverage that executes the exact codec, host join, missing-root degradation,
deterministic replay, and private projection contract for both tokens. Their physical
definitions, flat trace bindings, feature-rich legacy scorer writer, `withLegacyScoring`, and
historical read validators deliberately remain until A4.

The strict A3 lane is the first production client of `replayDecisionScenario`: a legal seven-seat
evil proposal and legal ten-seat seeded Mordred vote prove exact coordinates, filtered seat views,
ordered journals, component reads and transitive attribution, deterministic replay, and hard
survivor monotonicity. The four pinned A0 D2 role cases prove Assassin forced filtering, seeded
Mordred voting, deterministic Minion voting, and Oberon forced selection. Separate cases prove
Merlin and Percival delegation to matching C2, Servant delegation to matching Phase 4, custom
clone exclusion, and malformed D2's unchanged frozen fallback. Metamorphic candidate-order,
seed-band, two-Fail, name, and replay laws remain owned by
`test/evil-policy.test.ts`; A3 consumes those laws rather than restating a weaker
mutation matrix.

**Historical 7R3A4A completion record (superseded by A4B).** Exact deterministic
and seeded Morgana scorer singletons selected matching terminals above D2; same-version clones,
custom scorers, and malformed scorers remained wholly legacy. The configured seam was the sole
catalog owner and supplied the deterministic or seeded D2 predecessor, producing the exact
compatibility to Phase 4 to C2 to D2 to Morgana chain. The transform applies only to Morgana
proposal and vote decisions, reads only its matching utility component, and trusts the
kernel-admitted projection. It preserves E1B's exact forced survivor sentinel, counterfeit
value, sole selected viable row, reason codes, seeded band selection, and forced-choice
dominance. Quest-card policy remains outside the layer.

**Historical A4A checkpoint (closed by A4B).** At that checkpoint, the public counterfeit read,
private counterfeit objective, and deterministic and seeded Morgana utility components had
canonical decoders and native conformance owners. Raw historical validators remained independent
ingress boundaries; native decode happened after the kernel-owned bounded canonicalization at
each generic trust transition. Admitted objective and
utility builders and host joins
trusted their already-admitted belief, public-read, counterfeit-objective, and evil-utility inputs
instead of re-entering raw validation. The four definitions truthfully declare native execution,
and the four remaining 7R3A conformance exemptions were retired. Their physical location,
legacy flat trace bindings and writes, feature-rich legacy scorer, and downstream authority were
intentionally left for A4B.

The dedicated strict A4A lane uses `replayDecisionScenario` for a legal Morgana proposal and
seeded Morgana vote. It proves filtered seat-view input, exact ordered chains and common rows,
sole selected ID, journal reads, transitive component attribution, deterministic replay, and
forced-survivor monotonicity. The frozen A0 deterministic proposal, seeded vote, and malformed
fallback cells remain exact. Separate coverage proves non-Morgana delegation to D2 and exact
singleton clone exclusion. Existing E1A and E1B suites remain the owners of the broader public
read, counterfeit math, seeded-band, degradation, payload-bound, and private trace laws.

Independent review rejected a false belief-root trust proof before approval: its original
mutation was still accepted by the raw root validator. The corrected test uses a genuinely
rejected root and public-read dependency, reconstructs through the admitted-only builder, and
proves the exact admitted host join without removing the necessary seat/world semantic join.
The final parent gate passed 1,071 API-free correctness tests and three isolated performance
tests, with 79 strict roots and 43 pinned exemptions, architecture fitness, the complete frozen
score oracle, privacy and replay checks, and clean diff checks. The screenshot manifest remains
pre-existing stale with no client diff in A4A, so it was not rewritten.

**Historical A4A-to-A4B handoff (closed).** A4B owned the remaining authority/deletion debt:
whole-family equality, absent-graph hardening, C2's named deterministic base contract, native
scored-frame authority, and deletion of the legacy good, evil, Morgana, and equality writers.
Those authority changes are now implemented. Current-v2 role payloads and attribution are generic,
the native chain is the sole built-in producer, and exact promotion requires the out-of-band
architecture identity plus one generic replay. Historical v1 remains a diagnostic reader, while
the two D3 flat bindings are the named R3B3 quarantine rather than score authority.

The A3 final parent gate passed 1,064 API-free correctness tests and three isolated performance
tests, with 78 strict test roots, architecture fitness, and clean diff checks. A fresh final
review approved the exact corrected tree after rejecting and correcting false conformance
certification and repeated validation of an already admitted identity root.

The independent A2 review also assigned three nonblocking debts rather than extending the
temporary migration edge:

- **Closed by the post-A2 systemic gate: explicit candidate-ID ordering.**
  `policy/candidates.ts::compareCandidateIds` now owns deterministic lexicographic UTF-16
  code-unit ordering for candidate selection ties. Native and legacy good policy, evil and
  Morgana utility, the staged frame, planning, and trace admission consume that one owner.
- **A4 owns absent-graph hardening with flat-projection deletion.** Complete role validators
  currently reject a flat projection or degradation whose bound component is absent from the
  configured graph, but generic trace admission does not independently enforce that relationship.
  Harden the generic admission join while A4 removes the transitional flat writer, rather than
  teaching another downstream consumer to infer the missing graph edge.
- **A4 owns the C2 deterministic-base exception.** Give the deterministic Phase 4 base used by
  C2 a named typed contract and concise rationale, then remove or narrow the exception as the good
  family becomes the sole write path. The exception must not become an alternate scoring owner.

In 7R3B, D3 becomes a strategic decision layer that is reachable only after universal forced rules
leave discretion. Generic-versus-legacy equality is required across all landed role paths before
legacy write-side wrappers and optional fields are removed. Historical artifact read compatibility
remains after that cleanup. E2B and Assassin policy do not begin until these ordered layers are the
sole write path. Residual compatibility debt deliberately survives 7R2B: role booleans and scorer
selection in composed-agent options; role-specific scorer wrappers, contexts, and common-score
feature fields; flat role component versions and private payloads in traces and cognition;
role-specific stages and branches; manifest role arrays and variant maps; and legacy stdio reads.
7R3 removes their write-side authority only after dual-write equality is proved, while retaining
the historical read path.

### Mordred

- [x] Model the value of Merlin's blindness and anomalous public treatment using only Mordred's
      legal view and the shared public observer.
- [x] Do not infer Merlin from privileged role identity or reuse the future Assassin posterior as
      if Mordred possessed it.
- [x] Give deep-cover and Merlin-blindness exploitation bounded, opt-in causal policy authority
      while preserving forced policy, legality, and generic evil fallback.
- [x] Prove causal action changes, privacy, replay, attribution, and API-free bounds.

Phase 7E2 is split into E2A substrate and E2B policy so the exact joint-world/public-observer
formula, legal-information boundary, and weighted provenance can be audited before mechanical
authority is added. E2A starts only after 7R2B4 passes the complete generic-component exit gate and
becomes its first production native role component. E2B starts only after 7R3 makes ordered score
and decision layers the sole write path.

### Assassin

- [x] Add a separate Merlin posterior as the mechanically inert E3A substrate.
- [x] Reweight the exact joint-world prior with versioned clean-team proposal and vote-agreement
      features whose complete log-weight span is capped at `ln(2)`.
- [ ] Evaluate trajectory and deliberate-noise features before adding them; do not expand the
      hand-authored model merely to match the research feature list.
- [ ] Add role-claim evidence only after a typed trusted role-claim extractor exists. Raw prose,
      regex parsing, and `roleKnowledgeTell` are not valid posterior inputs.
- [x] Give the posterior bounded E3B assassination-target authority.
- [ ] Keep the model interpretable until a learned alternative wins held-out tests.
- [x] Record virtual Assassin guesses for all evil seats across the four frozen pretruth histories.

### Full-role composition

- [x] Configure all deterministic role layers behind one role-independent scorer identity.
- [x] Preserve isolated role scorers as independently measurable ablations.
- [x] Prove irrelevant configured components remain unused and exact replay reconstructs the
      applied full stack.
- [x] Run and commit the frozen Phase 7F role bank and virtual Assassin-guess evaluation.

### Exit gate

Each special role has an explicit objective and appropriate posterior or observer. None is
implemented only as extra prose, a descriptive posture label, or unchanged generic good or evil
utility.

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
| Replay | Same view, seed, and versions reproduce the same mechanical state; each score family admits exactly on both its own and its delegated decisions, rejects a forged score row, and stays diagnostic without a resolved identity |
| Policy | Forced rules, legal candidates, reason-code coverage; a closed-form candidate cardinality per player count and decision kind, and candidate completeness up to observable game equivalence; every native score family also satisfies the shared predecessor-delegation, bounded-specialization, seeded-domain, and forced-boundary-dominance laws |
| Coherence | Committed decision matches pitch, reason, lean, and later trace |
| Degradation | Each failed component falls back without stalling |
| Evaluation isolation | Runtime code cannot access truth-only labels |
| Prompt safety | Existing injection, talk-norm, and hidden-role audits |
| Operations | Token cost, latency, fallback rate, artifact compatibility |

---

## 15. Removal ledger

Migration is not complete while a superseded path can still make a target-agent decision. A path
may remain deliberately as the checked-in default, fallback, compatibility baseline, or historical
reader; those states are not deletion and are named below.

| Path | Current status and evidence | Next gate |
|---|---|---|
| Compatibility certainties and prompt dossier | **Demoted derivation, active raw-LLM rendering.** `RoleCertainties` is projected from exact belief and typed analysis, and the dossier renders the shared `PublicRecord`; both still appear in the default raw-LLM prompt and remain measurable compatibility surfaces. | Retain while raw LLM is the default/baseline. A future default promotion may isolate or delete the renderer only with prompt-equivalence and baseline evidence. |
| Scalar `suspicion()` policy | **Retained baseline/fallback authority.** It remains in `heuristic-policy-v2`, including server and simulator fallback, rather than serving as the target agent's probabilistic belief. The composed scorer keeps the compatibility choice explicitly attributable. | Preserve the forever-fallback and named ablation. Do not let scalar suspicion become an untraced input to native policy. |
| Forced-play triggers in prompt asks | **Structured path demoted to prose; raw-LLM experiment still active.** `forced-policy-v1` owns executable forced behavior for heuristic/fallback and composed policy. Frozen raw-LLM asks still influence that separate baseline but cannot override engine legality. | Delete duplicate target-mode triggers; retain raw-prompt bytes until an explicit baseline revision. |
| Free-form scratchpad memory | **Active in the default raw-LLM agent.** Typed cognition, evidence, commitments, and plan memory exist for composed agents, but `createLlmAgent` still reinjects its private scratchpad. | Retire scratchpad-only authority when a composed brain is promoted; keep a named raw-LLM baseline if it remains useful. |
| LLM-selected arbitrary proposal | **Active in the default raw-LLM agent.** The composed path uses legal candidate IDs, ordered policy, a committed plan, and voice that cannot reopen the mechanical action. `Probabilistic` and `Probabilistic + LLM` expose the same `full-role` mechanics as ordinary built-in web choices; the latter adds only the bounded planner/voice adapters and accepts the existing per-seat model override. Neither participates in default table fill. | Require paired evaluation and human approval before default promotion; then demote arbitrary selection to the raw-LLM baseline. The free paired evaluation exists and is adverse against the heuristic population. NB-010 has since named the mechanism and closed, and so has NB-013: the asymmetric vote objective lowers the dirty-team approval rate in every measured cell without lowering the win rate, but compatibility still wins the heuristic Servant cell `16/60` against `10/60`, so it narrows that gap rather than closing it. The gate is now NB-012 concealment cost and, after NB-014 diagnosed the proposal channel, NB-016 an ordering for the tied top of the proposal surface. |
| Generic evil policy for Mordred | **Demoted baseline/fallback authority.** The landed E2B scorers specialize D2-viable Mordred proposals and votes through the admitted blindness objective while the generic D2 scorer remains the explicit fallback and ablation. F2B records exact causal Mordred authority and isolated/full action equality, and NB-011's evil bank adds the paired strength number: `0.0%` (95% `-10.0%` to `+8.3%`) against the heuristic population and `-8.3%` (`-21.7%` to `+5.0%`) against seeded random, over `60` deals each. | Retain the generic evil baseline. The paired number is now in hand and is not a promotion; qualitative evaluation is what is still missing. |
| Generic assassination heuristic and prompt ranking | **Demoted baseline/fallback authority.** E3B gives the admitted E3A posterior bounded target authority in the opt-in composed scorer. F2B records exact causal Assassin authority, isolated/full action equality, and twelve correlated pretruth guesses with descriptive 2/12 accuracy. NB-011's evil bank adds the paired strength number over `60` deals each: `+1.7%` (95% `-8.3%` to `+13.3%`) against the heuristic population and `-6.7%` (`-16.7%` to `+1.7%`) against seeded random. | Retain the independently attributable baseline; improve playing strength against a measurement that is now real, and still do not treat the four virtual histories as a promotion sample. |
| Host-selected role scorer | **Removed from the full-role candidate and verified.** F1 resolves one immutable scorer and complete deterministic layer chain at construction. Runtime role and decision applicability is owned by registered layers. F2B's six-family causal audit proves the terminal selects the same action as each isolated reference while the 50-cell corpus retains truthful isolated identities. | Keep isolated scorers as ablations and the compatibility fallback. Promotion is now blocked on evidence as well as on a human decision: the 1,080-game full-role bench measures the stack as adverse against the heuristic population (Servant `-15.0%`, 95% `-25.0%` to `-5.0%`) and indistinguishable from base-composed on win rate. NB-010 located that defect in the Phase 4 base good policy rather than the role layers and has closed; NB-013 has since landed the vote half of the fix, the board-swing vote objective recovering roughly a third of the heuristic Servant gap (`7/60` to `10/60`, against compatibility's `16/60`) while cutting dirty-team approvals `54.5%` to `37.4%`; NB-012 and NB-016 own the rest, NB-014 having diagnosed the proposal channel, NB-011's `phase7-evil-v1` bank has since measured the other half over 1,920 games and found the same shape: `full-role` diverges from compatibility in `477` of `480` evil-target games yet moves no win-rate cell off zero, so promotion stays blocked on both sides. |
| Duplicate compatibility scored frame and re-derived structured choice | **Deleted; the native score surface is the sole scoring authority.** The composed agent used to build its scored frame twice per decision: native score layers produced the mechanical rows, `projectConfiguredScoreDiagnostics` rebuilt a compatibility row set, and `withNativeScoringAuthority` compared the two field by field before merging. Because every family projection builds from `mechanical(rows, version)` and only adds feature fields, that comparison could fail only on a code invariant, so it moved to `test/native-score-diagnostics.test.ts`, which perturbs the native rows and asserts the mechanical fields track them while the feature fields do not. `finalizeScoredDecisionFrame` also re-derived the structured choice over all viable rows, discarding the choice the layers had already made over hard survivors only; `ScoredFrameResolution` now carries an explicit `structuredCandidateId` and selection validates it. What survives is `NativeScoreDiagnostics`, which supplies only additive private feature fields plus degradation. | Keep the additive contract pinned by test rather than by a hot-path comparison, and keep trace admission's independent replay of the recorded score layers as the real check. Custom scoring remains one bounded alternate upstream producer with native fallback, naming its own rule in `customStructuredChoice`. |
| Historical v1 role-specific trace projections and readers | **Deleted; MD-005 complete.** The seven flat role projections are gone from `DecisionTrace` and refused at canonical ingress for every trace version, so a stored or external trace presenting one is refused rather than reconstructed. Both evaluation readers were retired: `architecture-report.ts` fell from 2,824 to 2,628 lines and `architecture-bench.ts` from 1,638 to 1,424, removing the duplicate `buildRoleObjectiveSnapshot`/`buildRoleUtilityProjection`/`buildEvilRole*` reconstruction and three `validate*HostJoin` joins. The isolated `role-trace-v1.ts` reader keeps only the version and degradation coherence a v1 trace must still satisfy, pinned to one importer by `ARCH012`. Retired field names remain leak-scan tombstones so a public log containing one is still a hidden-information violation. | Keep the ingress refusal and the tombstones while old integrations could attempt to restore a flat role projection. `componentVersions` role identities stay readable: a v1 trace may name a role objective it produced, and descriptor-less v1 artifacts remain diagnostic. |
| Exact-quota D3 adapter, flat trace projection, effective-forced overlay, and conformance exemption | **Deleted; MD-003 complete.** R3B3A removed executable authority. R3B3B1 removed the historical payload type and decoder, private adapter token and binding, flat trace fields, exact host join, evaluation reconstruction, artifact readers, and report readers. Old exact artifacts now use generic unknown, invalid, or nonpromotable handling; removed flat keys are rejected at canonical ingress. | Retain exact quota only as documented homogeneous research context. Robust heterogeneous D3 evidence comes from the trusted architecture descriptor, generic admitted component, and decision-layer journal. |
| Boolean trace-admission wrappers | **Deleted; MD-004 complete.** Runtime, evaluation, and tests consume the closed trust-labeled admission union directly. The three retired export names remain only as architecture-fitness tombstones that reject fake imports, aliases, namespace access, dynamic imports, and re-exports. | Keep the tombstones while old integrations could attempt to restore a boolean admission bypass. |

Removal means deleting or isolating old authority, not merely adding a new path beside it. A
retained baseline must stay independently attributable and must not silently feed native policy.

---

## 16. Progress log

Use this section for concise implementation history. Research corrections and design rationale
belong in their source documents; landed changes, measurements, and deviations from the plan belong
here.

- Human-evaluation bridge: the web agent-definition engine now admits the named `full-role`
  composed preset directly. The setup dropdown exposes a model-free `Probabilistic` entry and a
  `Probabilistic + LLM` entry whose roster model supplies only the bounded planner and voice.
  `Rule-based` replaces the Autopilot display name while the `autopilot` id remains stable for
  artifacts, fixtures, URLs, and fallback code. There is no feature flag or experimental opt-in
  gate: both are ordinary seat choices. Availability is not default promotion: normal table fill
  still draws only roster model ids.
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
- Phase 7D1 evil and Oberon substrate: added the explicit role-objective router, exact visible-evil
  and Oberon hidden-team projections, threshold-correct candidate failure capability, exact public
  standing counts, null-aware burn and cover proxies, and five role postures without changing
  policy. Exact host replay and a strict two-state weighted boundary join identity, observer, and
  objective attribution across stdio, architecture capture, and stored reporting. Independent
  review passed 769 API-free tests and a 103-trace free bank; all router-on/off event logs matched.
  Phase 7D2 owns proposal and vote authority.
- Phase 7D2 evil and Oberon policy: added opt-in 70/20/10 failure-capacity, cover, and future
  opportunity utility for proposals and votes, with exact joint threshold mass, canonical vote
  alternatives, deterministic proposals, a 0.04 seeded vote band, and separate visible-evil and
  Oberon semantics. The nested D2 to C2 to Phase 4 to compatibility chain preserves forced policy
  and truthful fallback attribution. Strict standalone and host-replay joins bind public board
  coordinates, two-Fail rules, role coordination, equations, seeds, selections, actions, and the
  exact weighted complete-or-triple-absence boundary. Independent review approved 781 API-free
  tests, the free bank, weighted generation/report fixtures, privacy, bounds, deterministic
  replay, and hostile mutations. Phase 7D3 owns heterogeneous-safe quest-card policy and a
  quarantined homogeneous research comparison.
- Phase 7D3 heterogeneous evil quest policy: added an opt-in forced-policy owner whose robust mode
  requires no shared convention, seed, teammate action, execution order, agent-type handshake, or
  shared state. It succeeds below known visible quota, independently Fails on decisive sinkable
  boards, and uses a seat-local public-context timing bucket otherwise. Exact quota remains an
  explicitly homogeneous, mixed-unsafe, promotion-ineligible research ceiling, and current
  evaluation rejects every exact artifact until Phase 7F can supply genuine all-seat provenance.
  Forced-policy precedence, engine legality, Oberon separation, privacy, configured-versus-resolved
  attribution, strict stdio and architecture joins, deterministic replay, hostile mutations, a
  free bank, and no-D3 compatibility replay passed independent review. Parent validation passed 54
  focused tests and all 794 API-free tests. Phase 7E is now split into required Morgana, Mordred,
  and Assassin specialization because D1 posture labels and D2 generic evil utility do not yet
  make the first two roles causally distinct.
- Phase 7E1A Morgana counterfeit substrate: added a separate public-only counterfeit-Merlin read
  with exact Merlin marginals, hand-auditable truth-tracking counts, null no-data semantics, and a
  bounded non-probabilistic read proxy. Added a private mechanically inert proposal/vote objective
  that sums complete joint worlds while excluding each world's Mordred from simulated Merlin
  sight, records exact private/public distributions and equations, and never imports Percival's
  private posterior. Opt-in routing, typed atomic failure, configured-versus-resolved attribution,
  strict detached validation, exact host reconstruction, stdio and stored-report rejection,
  artifact manifests, 5-10 player bounds, weighted-world causal sensitivity, privacy, and a free
  architecture-bank lane passed 65 focused tests and all 806 API-free repository tests. Applied
  weighted objectives are supported by the composed runtime but remain ineligible for external
  promotion evidence until a future provenance contract can certify their complete-world source.
- Phase 7E1B Morgana counterfeit policy: added an opt-in scorer above the unchanged D2 evil
  utility. Forced survivors must remain within `max(D2) - 0.04`; deterministic play selects maximum
  E1A counterfeit value with canonical ties, and seeded variation is vote-only when both votes are
  in the D2 band and within `0.04` counterfeit value. The exact fallback chain is E1B to matching
  D2, C2, Phase 4, then compatibility. Fifteen dedicated causal/adversarial cases, the free
  architecture bank, 5-10 player and 252-candidate bounds, privacy, replay, D3 invariance, hostile
  stdio/report joins, exact reconstruction rejection of forged E1B degradation, and weighted
  runtime passed alongside 181 focused tests and all 821 API-free repository tests. Weighted
  traces remain ineligible for external promotion admission until complete-world provenance is
  certifiable. Phase 7R now establishes the generic component boundary before E2A.
- Phase 7R1 forced-policy authority: reordered universal quest-card rules ahead of the optional D3
  strategic directive across runtime and admission, and pinned adversarial no-sink, match-point,
  exact-quota conflict, and Oberon behavior. Focused validation passed 47 API-free forced-policy,
  D3, composed, trace, and stdio cases. Independent re-review approved the corrected integration;
  all 824 API-free tests then passed, including the free D3 architecture bank and hostile stored
  mutations.
- Phase 7R2A shared admission owner: mechanically moved composed-trace detached validation, host
  reconstruction, exact cross-field joins, and promotion admission from stdio into the agent
  boundary. Stdio now consumes that owner and retains transitional join re-exports; architecture
  generation and report replay import the owner directly. Existing valid, degraded,
  weighted-unverifiable, D3-suppressed, and hostile-mutation outcomes passed 151 implementation
  and 225 independent-review focused cases without changing trace or artifact schemas, versions,
  decisions, or defaults. Parent validation passed all 835 API-free tests, including the applicable
  free architecture banks.
- Phase 7R2B1 component construction: added dependency-light component contracts, an immutable
  registry with stable dependency-first resolution, and a resolved composed brain that owns both
  frozen implementations and a data-only construction description. The compatibility facade now
  snapshots configuration without hiding interpreter-version drift or rebinding stateful plugin
  methods. Fresh re-review approved the corrected class/private-state and drift behavior; 164
  affected compatibility cases and all 841 API-free repository tests passed without trace,
  artifact, stdio, prompt, decision, role-policy, or default changes.
- Phase 7R2B3B complete: registered the E1A public read, private E1A objective,
  E1B utility, and separate robust and exact-quota D3 rules behind the generic kernel while
  preserving exact legacy projections and universal forced-policy dominance. Adapter descriptors
  now own projection, causal-use, suppression, degradation, and promotion admission. Shared host
  admission re-runs each reconstructable entry through its registry definition and cannot promote
  unavailable weighted roots; deterministic and seeded E1B have separate plan identities.
  Structural children cannot survive a non-admitted dependency.
  Architecture generation binds a trusted composed producer to its independently captured
  resolved plan, while external self-contained traces remain unauthenticated. Eight dedicated
  cases, 65 adjacent kernel, adapter, and role-policy cases, and all 897 API-free repository tests
  pass. Independent review returned READY after 36/36 dedicated and 132/132 adjacent cases.
- Phase 7R2B4 complete: added a host-assigned, seat-keyed generic component
  manifest and bound stored-report replay to the independently expected target-seat plan. Reports
  now expose generic component status, verification, promotion, and causal-use counts plus an
  explicit promotion-evidence verdict; historical and external artifacts remain readable without
  gaining trust. Coherent graph, dependency, stage, and downgrade rewrites; malformed, duplicate,
  sparse, proxy, accessor, wrong-seat, wrong-version, and oversized manifests; weighted
  nonpromotion; privacy; replay; free-bank coverage; and bounds pass 14 dedicated cases, 56 focused
  architecture cases, 96 adjacent role/free-bank cases, and all 911 API-free repository tests.
  Parent validation passes 95/95; independent architecture rereview passes 114/114 and returns
  READY.
- Phase 7E2A complete: added the first production-native generic graph for
  Mordred's Merlin-blindness opportunity and anomalous public-treatment read. It is private,
  policy-inert, joint-world based, exactly host-reconstructable for constraints-only beliefs, and
  structurally nonpromotable for weighted beliefs. Generic component-owned observer attribution,
  synchronous applicability, and registered exact suppression proofs close the host-replay gaps
  found during review. Focused architecture/privacy/replay validation passes 112/112 and all 938
  API-free repository tests pass. Independent final rereview passes 116/116 and returns READY.
- Phase 7R2C checkpoint complete: C1 (`30a96e8`) added strict server typechecking and
  fail-closed tiered test lanes. C2A (`35f30cb`) added the bounded canonical admission boundary,
  registry-wide conformance inventory, two native executable fixtures, and ten explicit legacy
  exemptions now owned exactly by 7R3A and 7R3B. The replay half of C3 (`b797a5e`) added one
  authoritative replay timeline, incremental target-seat projection, private probe binding,
  detached artifact DTOs, and honest work/output accounting. The descriptor foundation
  (`21c60a1`) now owns
  configured architecture identity, and lazy host roots (`b646922`) remove eager private work for
  inapplicable, ineligible, or dependency-blocked components through one shared cached state
  machine. Trace metadata (`34b30ac`) is now a descriptor/run projection rather than a parallel
  role-aware author. The AST-based dependency-fitness guard (`5f47201`) runs in every verification
  lane and protects coarse import direction and trusted-provider ownership without becoming a
  source-code sandbox. Descriptor-derived artifacts and reports (`b422c31`) now share one
  canonical migration-free identity, cached trace/manifest digest, exact run and replay joins,
  once-per-observation admission, and a named nonpromotable schema-1 adapter. Strict typechecking,
  the 102-file lane inventory, 989 correctness tests, and three isolated performance tests pass.
  C4A's staged type spine and C4B's live runtime wiring now own optional-state pipeline ambiguity
  rather than allowing it to accrete inside each component. Focused strict typechecking,
  architecture fitness, frame/composed contracts, and the independent pre-C4 compatibility oracle
  pass on the executable tree. C4B leaves role payload extraction, the quarantined scorer fallback
  adapter, planner protocol rendering, communication intent rendering, and chosen-team trace
  reanalysis as explicit 7R3 ownership work rather than pretending they are native frame layers.
  Phase 7R3B separately owns D3's discriminated historical compatibility read, incremental
  retirement of its conformance exemption, and deletion of its transitional write path after
  equality. The reusable native component contract kit (`6a586fc`) and sole-owner C4B runtime
  wiring (`26eee384`) passed independent review. The exit audit passed strict typechecking,
  architecture fitness, the 104-file lane inventory, 999 correctness tests, three performance
  tests, the applicable composed-agent banks, and a separate ten-case free `standard-v1` run.
  Inspector v2 remains explicitly deferred, and layer-owned operation budgets are required before
  7R3A lands.
- Phase 7R3A4B score-authority cutover complete: the configured native score-layer chain is the
  sole built-in score producer, while a caller-supplied custom scorer is one bounded alternate
  upstream producer with the canonical native chain as its failure fallback. Both paths converge
  on one scored-frame finalizer and one downstream selection path. The eight C1/C2/D1/D2/E1A/E1B
  objective and utility components now live only in the generic current-v2 component run; the two
  robust/exact-quota D3 components remain the explicitly quarantined flat compatibility
  exemptions for R3B3. Current-v2 admission reconstructs exact component host inputs, the
  host-declared scorer chain and scorer-sensitive analysis plan, universal and post-D3 effective
  forced surfaces, every native
  score layer and journal transition, survivors, score values, viability, reasons, component
  reads, transitive attribution, structured choice, and selected action. It fails closed unless
  an out-of-band resolved architecture identity passes its digest/graph join; a supplied expected
  component plan is checked separately. The former role-specific current-v2 score replayers are
  deleted, leaving one generic exact score replay. Seedless stdio traces are self-described
  diagnostics:
  structurally coherent reason rewrites or passive graph claims may remain attached, but they are
  never promotion evidence; invalid optional telemetry is stripped without changing an otherwise
  legal action. Ordinary external traces do not invent a scorer-specific exact replay; D3 is
  reconstructed only when a quest trace actually claims or suppresses D3. Historical v1 flat
  traces remain readable diagnostics and cannot become current
  promotion evidence. The existing knowledge, leak, and view suites continue to own the
  seat-filtered `PlayerView` boundary. D3 admission now constructs one exact host surface, applies
  universal precedence before an admitted discretionary policy, and passes the resulting
  effective forced surface into native replay; a pre-D3 surface substitution is rejected.
- Phase 7R3B1A shared situation surface complete: one pure scorer-sensitive builder now owns the
  expansion from trusted legal candidates plus an explicit compiled analysis plan into policy
  candidate teams, proposal assessments, good-vote hypothetical candidates and assessments, and
  the exact `SituationAnalysis`. Runtime frame construction and exact host admission choose or
  compile their plans independently but invoke that same builder; universal forced policy remains
  downstream, and the quarantined D3 overlay still runs only after universal precedence. The
  candidate-only, good-proposal, and good-vote plan laws, all six frozen decision kinds, good,
  C2, D2, Morgana, and D3 host replay pass without decision-fixture, prompt-byte,
  hidden-information, or deterministic-replay drift. Architecture fitness prevents either runtime
  or admission from rebuilding this scorer-sensitive `analyzeSituation` option surface. MD-001 is
  closed; R3B1B retains ownership of closed trust-labeled admission outcomes and no parsing or
  trace-admission redesign was included here.
- Phase 7R3B1B closed trace admission complete: every external or stored trace is first copied
  through one 4 MiB strict JSON snapshot before any discriminator, selected decision, plan
  outcome, or component field is read. Host admission then returns one exhaustive result:
  identity-witnessed `trusted-exact`, pre-apply `external-diagnostic`, finalized
  `artifact-diagnostic`, or `rejected` with a typed reason. Only the trusted branch can derive
  promotion eligibility, and it does so after the out-of-band architecture identity, component
  plan, generic native score replay, action, and host joins pass; descriptor-less traces remain
  diagnostics even when structurally coherent. Stdio retains valid optional telemetry and strips
  invalid telemetry without rejecting a legal action. Replay lookup receives only the frozen
  canonical candidate; architecture generation, safety, report aggregation, and D3 suppression
  reporting consume the admitted snapshot and explicit facts rather than open trace objects or
  boolean validator combinations. Architecture
  fitness rejects legacy boolean admission imports from server consumers. Three historical
  formula/D3 test facades remain thin wrappers over the union and are assigned to MD-004 for
  deletion with the R3B3 compatibility reader.
- Phase 7R3B2A generic strategic seam complete: the resolved brain now owns one registry-resolved
  ordered decision-layer identity and its frozen definitions. `DecisionFrame` executes that order
  exactly once after universal forced policy and component resolution. Each layer can only use
  declared admitted component payloads and a factory-minted monotone survivor/selection surface;
  accepted direct reads causally attribute their exact admitted transitive component closure
  through the component runtime shared with score layers. Universal selection and an earlier
  strategic selection are terminal: remaining layers journal typed suppression without running
  applicability, execution, component reads, or attribution. The generic kernel records
  configured order, applicability or degradation, prior and resulting
  candidates, reasons, component reads, causal use, and exact bounded operation counts without
  knowing any role, D3 version, trace, artifact, or evaluation shape. Current production order is
  intentionally empty and behavior-neutral. Current traces carry the honest empty run, and exact
  host admission replays it from out-of-band identity plus the canonical universal surface while
  descriptor-less traces remain diagnostic. A native two-layer fixture proves ordered narrowing
  and selection, factory provenance, dependency admission, universal dominance, journal and
  operation rewrite rejection, exact replay, and construction-time registry substitution
  rejection. The whole-trace canonical snapshot now domain-admits the decision-layer child once
  into an authority-local opaque capability; detached diagnostics and exact replay reuse that
  result without a second sanitizer. Exact replay removes only the decision-layer-owned causal
  stage, reconstructs it, and proves the applied-journal attribution union exactly matches final
  single-owned component attribution while preserving every other stage. Focused validation
  passed all six strategic-layer cases plus the existing score and trace-admission laws; the
  contract gate passed all 358 tests. Both robust and exact-quota D3 remain wholly on the
  preexisting legacy
  overlay in this checkpoint; R3B2B owns the robust authority cutover and R3B3 still owns
  exact-quota quarantine plus MD-003 and MD-004.
- NB-007 large-support identity normalization: replaced naive identity-boundary sums with one
  compensated accumulator for source normalization, grouped role and hidden-team mass, and
  detached lattice validation. The actual 10-player `phase4-good-v1` vote at
  `decision:3:vote:q3:p1:v70` now projects all 58,080 uniform worlds and reaches trusted-exact
  admission. Exact joint entries, the `1e-12` tolerance, canonical ordering, and invalid-mass
  rejection are unchanged; the fix does not round, widen tolerance, special-case the fixture, or
  renormalize invalid input.
- Phase 7R3B2B robust D3 authority cutover complete: `robust-heterogeneous` configures
  `evil-quest-card-robust-strategic@evil-robust-heterogeneous-quest-decision-v1`
  as the first production concrete decision layer. Its admitted native component is the only
  cognition writer, and the layer is the only mechanical writer. Universal forced selection
  suppresses the layer before applicability, execution, component reads, reasons, or attribution;
  otherwise its factory-minted singleton becomes the actual downstream candidate boundary for
  native scoring, custom-scoring fallback, planner gating, committed plans, communication
  reasons, trace admission, and evaluation. The universal `ForcedPolicyResult` remains a separate
  fact and authority.
  Current robust traces omit `configuredEvilQuestCardPolicy`,
  `componentVersions.evilQuestCardPolicy`, and `privateEvilQuestCardPolicy`; generic component
  admission plus the registered layer journal and surface carry the evidence instead. Exact quota
  alone retains `withLegacyD3QuestCard`, the effective-forced compatibility projection, flat
  trace binding, and the remaining D3 conformance exemption for R3B3. Score-run operation
  accounting now distinguishes universal forced candidates from the strategic candidate
  boundary. Planner context preserves universal forced facts as their own diagnostic block but
  derives its visible candidate set from the hard strategic boundary, including a future layer
  that narrows without selecting. Current-trace flat-state admission identifies the registered
  robust D3 layer token exactly rather than treating every nonempty future strategic order as D3.
  Robust transport uses one semantic decoder at the native component admission boundary, after
  the component kernel's strict canonical and byte-bounded ingress. Downstream decision, scoring,
  planning, trace, and evaluation code consume the admitted value and do not repeat the raw-shape
  predicate. The historical optional-field validator remains only for exact quota until R3B3;
  this checkpoint deliberately does not introduce a schema framework.
  Focused validation covers native component conformance, strategic authority, universal
  suppression with zero reads, exact-path quarantine, custom scorer and planner non-reopening,
  stdio legal-action retention after forged telemetry, host replay, architecture fitness, the
  free D3 architecture bank, and the frozen robust trace change. The contract verifier is the
  chunk gate; the parent owns the post-rebase complete suite and broad banks.
- Phase 7R3B3A exact-quota executable-authority deletion: removed
  `visible-exact-quota` from the composed-agent option type and runtime validation, deleted its
  component definition and production registration, removed exact policy generation and shared
  designation helpers, and deleted the strategic option from universal forced policy. The
  `legacy-d3-quest-card` frame, lease transition, effective-forced overlay, synthesized candidate
  boundary, and flat trace writer are gone. Every runtime candidate boundary now comes from the
  registered decision-layer run, while `ForcedPolicyResult` remains independent. The robust token
  and definition now live in a native robust component module and remain the only executable D3
  authority. Exact quota remains documented as a homogeneous research ceiling, not a runnable
  AvaLLM mode. R3B3B still owns the explicitly historical flat payload decoder, trace admission
  and evaluation readers, plus MD-004 facade cleanup. The exact-heavy behavior suite was deleted
  rather than preserved one-for-one; a small architecture-fitness test proves that the removed
  mode, token, frame, and writer cannot return. A compact robust-only law set retains the durable
  visible-quota, decisive independent-Fail, seat-local determinism, heterogeneous-assumption,
  Oberon, and private-surface contracts. It deliberately reuses the registry-wide native
  conformance harness, R3B2B host-mutation coverage, and B4 stored-report mutation suite instead of
  restoring a duplicate D3 architecture bank.
- Phase 7R3B3B1 historical exact-quota read cleanup: deleted the old payload discriminator,
  optional-field validator, exact reason and cohort fields, private compatibility component,
  flat trace version and payload fields, exact host reconstruction, suppression branch, and
  artifact, benchmark, and report readers. Robust policy evidence now has one route: the trusted
  resolved architecture identifies the registered component and decision layer, canonical
  generic admission validates the private payload, and exact layer replay verifies selection and
  attribution. Current JSON carrying any removed flat D3 key is rejected at the closed canonical
  ingress; unknown policy declarations remain invalid and nonpromotable without reconstructing
  their historical semantics. Exact quota remains research history only. MD-003 is complete.
  Retired private D3 field names remain explicit public-log privacy tombstones: deleting a
  semantic schema cannot make its former private payload safe to expose.
  Two zero-caller boolean wrappers were deleted; R3B3B2 owns the remaining test migration and
  `validateComposedTraceHostJoin` deletion under MD-004.
- Phase 7R3B3B2 admission facade cleanup: migrated the remaining test callers from the historical
  boolean wrapper to explicit `trusted-exact`, `artifact-diagnostic`, `external-diagnostic`, or
  typed rejection assertions. Known finalized producers carry out-of-band architecture identity;
  synthetic and external artifacts remain nonpromotable diagnostics. Deleted the final facade
  export without changing runtime admission behavior. The three retired names remain only as
  architecture-fitness tombstones. Phase 7R3B and MD-004 are complete; Phase 7E2B is next.
- Phase 7R component checkpoint: inserted a behavior-preserving migration before Mordred. 7R2A
  centralizes host reconstruction and admission. 7R2B now lands linearly as contracts and resolved
  brain (B1), generic per-decision kernel plus a test-native fixture (B2), C1/C2/D1/D2 adapters
  (B3A), E1A/E1B/D3 adapters and transport admission (B3B), then artifacts, evaluation, and the
  complete exit gate (B4). E2A cannot start before B4 passes and is the first production native
  component. 7R3 then replaces nested role scorers and D3 call-site ordering with registered policy
  layers before E2B and Assassin specialization.
- Validation cadence checkpoint: moved adversarial parent and fresh-agent review ahead of expensive
  banks and the complete suite. Normal iteration now uses dedicated low-cost fixtures, then only
  the high-player-count boundary cases required by the contract. The applicable free bank and full
  API-free suite run once on the completed executable chunk; a later documentation-only amendment
  may carry forward that evidence after an exact tree-delta and documentation hygiene check.
- Development-workflow correction: a reviewed prototype proved that a tree-bound handoff manifest
  could detect dirty-tree and test-evidence drift, but doing so added 1,239 repository lines and a
  roughly 31-second process-heavy test without a durable CI or landing consumer. The prototype was
  dropped before commit. Handoffs now use clean Git commits, exact base/commit/tree identities,
  detailed commit bodies, and post-rebase verification. This narrows the permitted workflow and
  reuses authoritative Git and verifier state instead of creating another parser and evidence
  store.
- Phase 5C vote-conversion diagnosis: added a reproducible four-lane funnel over the frozen Phase 4
  bank and ran both free populations for 1,440 games. Proposal-only improved or held outcomes in
  both populations, while top-utility and seeded-band votes were harmful against heuristic agents
  and strongly beneficial against seeded-random agents. The sign flip triggers the human checkpoint
  before further mechanical tuning, paid study, or rollout.
- Architecture review follow-up, scoring authority and v1 role isolation: gave the native score
  surface sole authority over the scored frame. The per-decision compatibility row comparison in
  `withNativeScoringAuthority` was a self-comparison, because every family projection builds from
  `mechanical(rows, version)` and only adds feature fields, so the mechanical values it checked
  were copies of the native values it checked them against. That is a code invariant rather than a
  data invariant, so it moved to `test/native-score-diagnostics.test.ts`, which perturbs the native
  rows and asserts the mechanical fields track them while the features do not move. Trace admission
  still performs the independent replay-based check. `finalizeScoredDecisionFrame` also re-derived
  the structured choice over all viable rows, discarding the choice the native layers had made over
  hard survivors only; the resolution now carries an explicit `structuredCandidateId` and selection
  validates it. Separately, the v1 role trace projections moved behind
  `admission/role-trace-v1.ts` with `ARCH012` pinning its single importer, taking the generic
  admission owner from 5,059 to 4,199 lines. Full suite passes 1113 tests. (The reader
  was originally `legacy-role-trace-v1.ts`; renamed because v1 is the live belief-only
  trace version the raw-LLM agent emits, not a historical shape.)
- NB-010 base good-policy diagnosis: the adverse win rate is in the vote channel, and it has two
  separate named causes. Adding a `good-proposal-only` arm (structured proposal value, compatibility
  votes) to the same bank and populations isolates the channel. Matched-pair win-rate deltas against
  compatibility on the heuristic population, 60 games per cell: proposal-only is `+5.0%` for Merlin
  (95% `0.0%` to `+11.7%`), `+0.0%` for Percival (`-6.7%` to `+6.7%`), and `-6.7%` for Servant
  (`-15.0%` to `0.0%`), while adding the vote channel gives `-3.3%`, `-8.3%`, and `-15.0%`
  respectively. The marginal cost of the vote channel is `8.3` points in every one of the three good
  roles. Per-cell intervals are wide and only the Servant total excludes zero, so the evidence is
  that identical marginal cost across roles. `good-policy-diagnosis.ts` reads bench artifacts and
  reports the mechanism.
  The same isolation puts Phase 5C's sign flip precisely on the vote channel. Against the seeded
  random population proposal-only is `+1.7%`, `+6.7%`, and `+5.0%` for Merlin, Percival, and Servant,
  and adding votes raises those to `+13.3%`, `+10.0%`, and `+8.3%`. So the vote channel is worth
  `+11.6`, `+3.3`, and `+3.3` points against random opponents and `-8.3` points against heuristic
  ones in every role. The channel does not have a fixed value; its sign is set by whether the
  opponents can exploit it.
  Proposal value is not the problem for Merlin or Percival, but the Servant seat carries a separate
  and statistically clear proposal defect: with structured proposals alone its clean initial-proposal
  rate falls `-10.6%` (95% `-20.6%` to `-1.1%`), an interval excluding zero, which is the mechanism
  behind that seat's `-6.7%` proposal-only win delta. A seat with no private information appears to
  be the case the proposal value function serves worst, and Merlin shows cleanliness is not itself
  the win driver: its clean-proposal rate also falls slightly, `-3.4%` (`-8.4%` to `-0.1%`), while it
  wins `+5.0%`.
  The first cause is Merlin legibility, and the two populations prove it by contrast rather than by
  argument. The composed vote is near-oracle in both, cutting the target's approvals of dirty teams
  from about `18%` to about `3%`. Against the heuristic population that pattern identifies the seat:
  Merlin assassinations rise from `16.7%` to `26.7%` while three-fail losses fall only `65.0%` to
  `63.3%`, so the endgame is reached more often and lost to the shot. Against the seeded random
  population the identical vote pattern *lowers* assassinations, `16.7%` to `11.7%`, and the seat wins
  `58.3%` to `71.7%`. The behavior is therefore not intrinsically bad; it is exploited. An assassin
  that reads the vote record converts accuracy into a target, and one that cannot read it does not.
  The good value function has no term for what its own vote record reveals, and Phase 7A's exact
  public observer is present but mechanically inert, so nothing prices concealment. This is the §2
  gap row that still reads "no explicit model of public suspicion".
  The second cause is permissiveness at an information-poor seat, together with a metric that hides
  it. `voteTruthAccuracy` scores a vote correct when `(vote === 'reject') === teamHasEvil`, which
  weights both error directions equally, but their game value is not equal: rejecting a clean team
  costs one proposal while approving a dirty team can cost a quest. The composed Servant converts
  compatibility's indiscriminate rejections into approvals, dropping clean-team rejections from
  `12.5%` to `4.8%` while leaving dirty-team approvals at `39.8%` against `37.7%`, so its approval
  rate rises from `55.2%` to `61.9%`, quest failures from `49.2%` to `53.6%`, and three-fail losses
  from `60.0%` to `73.3%`. Vote-truth accuracy rises throughout. The Servant seat also loses on the
  proposal channel alone (`26.7%` to `20.0%`), so it carries a proposal defect the other two roles do
  not. NB-012 owns concealment cost and NB-013 owns the asymmetric vote objective; both are policy
  changes and neither is attempted here.
- Phase 7 full-role playing-strength gate, and the first seatable composed brain. F2B proved causal
  correctness, not strength, so `full-role-bench.ts` reuses the frozen 180-deal
  `phase4-good-v1` bank and the existing matched-case paired-bootstrap comparison to measure
  compatibility versus the Phase 4 good base versus the complete role stack, per target role and per
  free population. The 1,080-game run cost nothing, degraded nothing, and reproduced the Phase 5C
  sign flip at full strength for the finished architecture. Against the heuristic population the
  full-role stack loses: Servant win rate is `-15.0%` with a 95% interval of `-25.0%` to `-5.0%`,
  Percival `-8.3%` (`-20.0%` to `+3.3%`), Merlin `-1.7%` (`-5.0%` to `0.0%`). Against the seeded
  random population it wins: Merlin `+13.3%` (`0.0%` to `+25.0%`), Percival `+11.7%`, Servant
  `+8.3%`. Vote-truth accuracy rises sharply in both populations, up to `+26.4%` for Merlin, so the
  belief machinery is genuinely more accurate while the policy consuming it is exploited by the
  heuristic population specifically. The decisive new fact is that full-role and base-composed are
  indistinguishable on win rate in all six cells: the role layers move Percival's clean-proposal
  rate (`+15.1%`, `+2.3%` to `+28.1%`) but not one game outcome, so the win-rate defect lives in the
  Phase 4 base good policy rather than in the Phase 7 role specializations. No promotion or demo
  should present this brain as stronger than the checked-in default. Separately, `AgentSpec` gains
  an API-free `composed` variant with two named presets, `good-base` and `full-role`, the registry
  owns their component wiring, and `npm run sim --agents composed [--brain <preset>]` seats them, so
  the stack is now runnable outside the eval benches. `composed-agent-spec.test.ts` pins each
  preset's resolved architecture identity to the identity of the bench arm that measured it, so a
  seated brain and its recorded comparison cannot drift apart. Scope stated plainly:
  `phase4-good-v1` targets Merlin, Percival, and Servant only, so the evil layers were never causal
  here and remain unmeasured for strength until a frozen evil-side bank exists. NB-010 owns the base
  policy diagnosis and NB-011 owns that bank. Full suite 1141 correctness tests.
- NB-008 shared score-family conformance harness: `test/support/score-family.ts` now owns the five
  cross-family laws every native score specialization must satisfy, and each family declares a data
  descriptor instead of hand-rolling the scaffolding. The laws are predecessor delegation (the
  specialized configuration yields the predecessor's exact action and scores, reports the configured
  specialization, resolves the truthful fallback version, and admits no family component),
  bounded specialization (own scorer version, every legal candidate scored in order, and the
  structured choice), the seeded domain (per-seed determinism, legal choice, a band the seed selects
  inside but never resizes, and invariance for every kind not declared varying), forced-boundary
  dominance, and native replay (trusted-exact admission, a forged score row rejected as
  `trusted-identity-host-join-failed`, and descriptor-less admission staying
  `artifact-diagnostic`). All five specializations are wired: C2 good-role, D2 evil-role, E1B
  Morgana, E2B Mordred, and E3B Assassin, each across its deterministic and seeded variants. Native
  replay covers eligible and delegating decisions alike, because a delegated trace carries the
  specialization as its configured scorer and the predecessor as its resolved one, and that mismatch
  is its own host-join shape. The
  harness reuses `buildScorerSituationSurface`, `applyForcedPolicy`, and
  `replayNativeScoresForAdmission` to build the same host surface admission builds, so a family
  cannot satisfy forced dominance through a family-shaped fake context. The base Phase 4 scorer and
  the F1 full-role relabeler are deliberately out of scope: neither owns a component nor delegates.
  Three specified behaviors were corrected against what the individual suites had implied. A seeded
  plan may leave its whole near-equal band viable, so exactly-one-viable is a deterministic-only
  law. A family layer may legitimately decline a single-survivor forced boundary, so the law binds
  survivors and viability rather than which layer resolves. Mordred's real 9-player deal never
  enters the seeded near-equal D2 band, so its declared seed-varying kind was dropped and the
  harness now rejects an idle varying declaration instead of silently waiving invariance. Family
  suites keep their hand-worked band equations, hostile payload forgeries, privacy canaries, stdio
  joins, and bank attribution. C2, D2, and E1B also dropped their duplicate proposal and vote view
  rewriters for the shared `asProposal`/`asVote` builders. The three legacy suites remain
  hash-pinned strict-test exemptions with refreshed hashes; NB-009 owns their conversion. The seeded
  law is registered only for a family that has a seeded plan, so a family without one no longer
  reports a green test name for coverage it does not have, and a descriptor whose seeded variant
  duplicates its deterministic one is refused rather than silently taking the deterministic branch
  twice. Full suite 1137 correctness tests plus the three isolated performance tests.
- Retired the v1 role projections end to end (MD-005). The seven flat role payloads had no writer: only `createDecisionTrace` for the raw-LLM baseline and the composed v2 builder exist, and neither ever set one, which a live trace probe confirmed. They were reachable only from a stored artifact or an external stdio agent, and reading them cost three parallel validation surfaces. Canonical ingress now refuses the keys for every trace version, the treatment MD-003 used for its own retired keys. Three specified behaviors changed and are pinned the other way: an external stdio agent presenting a historical flat role trace keeps its decision and loses its trace; an external weighted producer can no longer present a complete flat role objective, so generation fails before the report; and the descriptor-less v1 path is exercised through a role-free variant. Both evaluation readers and the admission owner now hold zero references to the retired payloads, and the fields are deleted from the trace type. Full suite 1114 tests.
- Phase 3B candidate cardinality and completeness oracle: closed the last open Phase 3B follow-up.
  The bank sweep only proved soundness, that every generated candidate is engine-legal, so a
  generator that silently dropped a legal action stayed green. Two independent laws now bound the
  surface from the other side. The closed-form oracle derives the expected count from `TEAM_SIZES`
  and factorial binomials rather than the generator's own `combinations`, so a shared defect cannot
  cancel itself out, and it is checked at every decision of every bank playthrough plus the frozen
  decision fixtures, covering 5 through 10 players for all six decision kinds. The completeness law
  enumerates the whole syntactic domain, including all 2^n seat subsets for proposals and
  revisions, applies each to a clone, and asserts the generated candidates reach exactly the set of
  reachable post-decision game states, with no two candidates reaching the same one. It sweeps once
  per distinct surface shape per bank case rather than once per kind, because a proposal surface is
  parameterized by the quest's team size: keying on the kind alone swept only the opening quest and
  left team sizes 4 and 5 unchecked, and the corrected key raises the bank from 52 sweeps to 80
  covering sizes 2 through 5. That statement
  is equality up to observable equivalence rather than raw engine acceptance, because two of the
  generator's exclusions are engine coercions rather than policy narrowings: the engine drops a
  leader's lean and rewrites a good seat's fail to success, so those extra inputs are accepted but
  land on a state a generated candidate already reaches. Discussion text is held fixed because voice,
  not policy, owns it. Mutation-checked three ways: dropping the `unsure` lean, offering good both
  quest cards, and a count-preserving wrong proposal set each fail the new laws, and the first two
  leave the pre-existing acceptance test green. Full suite 1139 correctness tests plus the three
  isolated performance tests, strict typecheck, and ratchet.
- NB-009 strict role-policy suites, landed at `51f9510` alongside this series. The Phase 7C2, 7D2,
  and 7E1B suites left the strict-test baseline, which falls from 42 pinned exemptions to 39, so
  changes to active role-policy coverage now draw normal compiler feedback instead of a refreshed
  hash. Composed-agent and stdio results route through the canonical `AgentOutput` normalizer in
  test-only adapters, and the deliberate hostile-payload mutations use detached mutable clones with
  narrow historical-field typing so their forgery and admission assertions are unchanged. The
  register row is corrected here because that commit closed the follow-up without updating either
  the register or this log, which §3.6 requires in the same commit.
- Collapsed the transitional `AgentOutput` union (Phase 3C follow-up). `AvalonAgent.decide` now
  returns `AgentDecision` only, and `AgentOutput`, `isAgentDecision`, and `normalizeAgentOutput` are
  deleted. Heuristic, random, raw-LLM, the terminal human agent, and the stdio adapter wrap their
  own result; `server.ts` and `sim/runner.ts` read the envelope directly instead of normalizing at
  the call site. The external wire is deliberately unchanged: a child process may still reply with a
  bare `{ decision }`, and `parseStdioDecisionReply` is now the single place that shape is converted,
  which is why the union could go without touching the AvalonBench bridge contract. No decision bytes
  move, so this is a shape change rather than a behavior change; the composed path already returned
  the envelope. 157 references across 26 test files were unwrapped mechanically, and three of those
  edits needed a hand correction the sweep could not make: a test of the deleted normalizer became
  tautological and was replaced with the law that now matters (every built-in agent answers with the
  envelope), a ternary whose two branches were an envelope and a bare decision was wrapped whole
  before being split, and two stdio expectations compared against `.action` rather than `.decision`.
  The union's last vestige went with it: `createNormalizedComposedAgent` in the shared score-family
  harness had become an `Object.create` proxy that delegated verbatim, so the three suites that
  imported it aliased as `createComposedAgent` now import the real constructor.
  Deleting the union cleared no strict-test exemptions: the audit reports the same 39 failing roots
  before and after, so the 14 exempt files this touched had their hashes refreshed rather than their
  exemptions removed. Their remaining diagnostics are a different class from the one NB-009 closed.
  One more call site arrived on master during the rebase, in the composed-spec suite, and was
  migrated the same way. Full suite 1148 correctness tests plus the three isolated performance
  tests, strict typecheck, ratchet, and lane inventory.
- Gave both paired-variant reports one matched-table law. The Phase 5C conversion report carried its
  own weaker copy: it compared the configured role list, seed, player count, talk settings, target
  role/seat, and opponent population, but not the dealt seat-to-role assignment, the seat names the
  prompts render, or the agent seated at each non-target seat. A permuted deal under the same
  configured roles therefore paired two structurally different games, and the resulting bootstrap
  delta was reported with an interval as though the pair were matched. The benchmark path hid this
  because it runs `architectureReport` first, whose validator is complete; only a direct
  `phase5VoteConversionReport` caller was exposed, and the Phase 5C suite is itself such a caller.
  The architecture validator is now exported as `assertMatchedVariants` over a structural
  `MatchedVariantInput`, so both reports check the same ten facets, and the conversion report keeps
  only the opponent-population check that is genuinely its own. A new boundary test perturbs each
  facet in turn and confirms the direct API refuses; reverting to the old local copy makes the
  permuted-deal case pass, which is the gap the follow-up described. These two are the complete set
  of paired reports in the tree, so the law now has no second definition to drift from. Full suite
  1149 correctness tests plus the three isolated performance tests.
- NB-015 one trace lifecycle behind one host call. The three optional telemetry methods fall to two
  with distinct jobs: `finalizeAppliedTrace` is the whole lifecycle, and `privateTraceSink` is only a
  destination for hosts that keep no store of their own. `recordAppliedDecision()`
  (`server/agents/applied-trace.ts`) is the single call the sim runner, the server pump, and the eval
  drivers make once `applyDecisionWithOutcome` has accepted an action: it detaches the host
  request/view/action so a hook cannot reach back into them, invokes the hook, keeps the returned
  trace only if `validateFinalizedAppliedTraceHostJoin` still binds it to what the engine accepted,
  and otherwise records the degraded outcome trace. The two runners previously carried
  near-identical copies of that sequence; the helper's own behavior is unchanged from those copies,
  including the case where a declining hook degrades the provisional record rather than publishing
  it. Two shared finalizers replace duplicated bodies: `finalizeProvisionalAppliedTrace` (used by the
  composed host with plan memory off and by the raw-LLM agent) and `bindFallbackAppliedTrace` for the
  one lane with no provisional trace to join against, where `decide` threw and the agent still has an
  account of the fallback it did not choose. Behavior change worth naming: raw-LLM traces now ride
  the decide() envelope and are persisted by the host after legality instead of being pushed to the
  agent's own sink mid-decision, so a raw-LLM trace names the action the engine applied; the agent
  option that used to receive them is now only the sink of last resort. Every degradation path is
  unchanged: agent error, illegal decision, throwing hook, and uncloneable telemetry still land on
  the heuristic without stalling. The server source scan in `plan-coherence` now pins both halves of
  the ordering law, that the record call follows the apply call and that no host calls the hook
  directly. Verification: full API-free suite 1170 correctness tests plus the three isolated
  performance tests, 416 contract tests, strict server typecheck, and the ratchet at the same 37
  pinned exemptions with five refreshed hashes.
- NB-014 proposal value at an information-poor seat: the defect is in the selection rule, not in
  the posterior, and clean-proposal rate is confirmed as a diagnostic that cannot gate the fix.
  `proposal-value-diagnosis.ts` joins bench artifacts to the archived deal and separates the
  proposal decision into the parts a value function owns. Rerunning `full-role-bench.ts` over the
  frozen `phase4-good-v1` bank, 1,440 games across both populations, reproduces every NB-010
  proposal-channel number exactly: Servant `-6.7%` win and `-10.6` points clean against heuristic
  opponents and `+5.0%` against random, Merlin `+5.0%` and `-3.4` points, Percival `+0.0%` and
  `+6.7%`. The reader therefore measures the corpus NB-010 measured.
  Good proposal value is the hard-constraint posterior's joint probability that a team carries no
  evil, and `structuredChoice` breaks ties by candidate id, which for a proposal is the sorted seat
  list. That value is not a total order at an information-poor seat. The Servant's argmax holds
  more than one team on 144 of its 147 scored proposals across both populations, a mean of `16.7`
  teams out of `72.4` legal ones; Merlin ties on 36 of 63 at a mean argmax of `4.6` and Percival on
  63 of 65 at `10.4`. The chosen candidate was inside the argmax in every one of the 443 scored
  proposals, so the candidate-id order, not the value function, picked the Servant's team every
  time it proposed.
  The posterior is flat rather than wrong: the Servant believed `23.4%` and the realized clean
  share of its tied sets was `22.0%`. Against that null the canonical order scored `18.2%`
  (12 of 66) and Merlin's scored `80.6%` (29 of 36) against `85.6%`. Both gaps are small and
  neither is significant alone, so the order is close to a coin flip on cleanliness. What it
  reliably is, is predictable: it takes the canonically first team the posterior cannot rule out on
  `42.4%` of the Servant's proposals against `19.7%` for compatibility, and the mean normalized
  candidate-id rank falls from `0.32` to `0.12`.
  Flatness alone does not explain the regression, and Percival rules it out: its posterior ties on
  `96.9%` of proposals, nearly as often as the Servant's, and its clean rate rises `23.8%` to
  `33.8%`. The separating fact is the matched first target proposal, the one proposal decision both
  arms reach from an identical prefix because these arms differ only in the proposal action. On the
  Servant's 54 matched pairs the compatibility team was already inside the structured arm's argmax
  50 times (`92.6%`), at posterior `23.4%` against the chosen `23.7%`; at Percival only `59.2%`, at
  `22.6%` against `28.6%`. So the value function genuinely disagrees with the heuristic at Percival
  and is right to, while at the Servant it does not disagree at all and the tie-break simply walks
  away from a team the heuristic chose on soft public evidence the hard-constraint posterior does
  not represent. On those same 54 states the ordering is compatibility `27.8%`, a uniform draw
  inside the argmax `22.0%`, the canonical order `18.5%`, with 7 discordant pairs to 2.
  Ruled out along the way. Miscalibration: no, believed and realized agree to `1.4` points. A
  tie-break that is actively anti-selected: at most a small effect, `-3.8` points at the Servant and
  `-5.0` at Merlin on fewer than 70 decisions each. Concentration in the sense of a repeated
  signature team: no, the Servant led twice with the same team size in one game only once in 60
  games and did not repeat; the concentration is toward low seat indices, which an opponent
  reproducing the removals predicts and one watching for a repeated team never sees. A separate
  revision channel: none exists, since the bank disables discussion, so there is no finalize phase
  and the reader counts zero revisions in all twelve cells and the initial proposal is the whole
  channel. "The seat has no private knowledge, so its posterior is uninformative" is half right; the
  operative fact is the conjunction of a flat posterior with a discarded heuristic that was already
  at the top of it.
  Within a round the loss is descriptively concentrated early, Servant clean `25.0%` to `12.5%` at
  proposal 1 and `41.2%` to `25.0%` at proposal 2 against `44.4%` to `44.4%` at proposal 3, but with
  32 and 16 proposals in those buckets the split cannot carry a claim. What moves monotonically is
  the round: the tied share of the Servant's scored surface falls `34.1%` at quest 1 to `9.4%` at
  quest 5 as quest results add hard constraints, and Merlin's falls `17.6%` to `2.6%`. The posterior
  does sharpen with evidence at every seat; at the Servant seat it became decisive 3 times in 147
  scored proposals.
  What this implies for the fix, which NB-016 owns. Nothing about the posterior needs to change to
  recover the loss, because on `92.6%` of matched Servant states the better team was already tied
  for the maximum. Preferring the compatibility candidate whenever it is inside the argmax is
  posterior-neutral by construction and is the arm this evidence supports directly; a secondary
  value term that can order a tied set is the alternative. The candidate-id order should be retired
  on its own account as well, since it makes a large share of proposals predictable from public
  information, which is the concealment cost NB-012 is separately pricing. And the gate must not be
  clean-proposal rate: the Servant's falls in both populations while its win rate goes `-6.7%` and
  `+5.0%`, so the same proposal degradation costs games only where the opponents convert it.
  New reader plus 17 focused tests over hand-worked artifacts. Full suite 1182 correctness tests
  plus the three isolated performance tests, strict typecheck, ratchet, and lane inventory.
- NB-011 evil-side policy bank, and the first strength number for the evil half. `phase7-evil-v1`
  mirrors `good-policy-bank.ts`: the same six standard casts, the same frozen no-discussion profile,
  and a pinned dealt seat per case, so only the target seat differs and the two sides are drawn from
  one deal population rather than from casts invented for one of them. Two scope choices make the
  deal counts uneven and are stated rather than smoothed over. The casts stay `DEFAULT_ROLES`, so a
  role is covered only where the standard table deals it: Morgana and Assassin at all six counts,
  Mordred at 9 and 10, and the generic Minion at 8. Widening a cast to force a Minion onto a
  5-player table would pass `validateRoles` but would measure a setup the lobby never offers. Each
  target role still gets `60` deals, the same per-role sample the good bank gives Merlin, Percival,
  and Servant, so thin table coverage does not also become a thin sample. Oberon is not covered: it
  has no policy layer of its own for a target seat to make causal. The bank is target-role major, so
  a `--target-role` shard is an exact piece of the same run, which is how `240` deals stay runnable.
  The `1,920`-game run cost nothing, degraded nothing, and recorded zero forced-play violations,
  zero hidden-information violations, and zero attribution violations, with every arm
  promotion-evidence eligible.
  The first result is that the four-arm ladder is really a two-arm comparison here. Both good-side
  ablations, `good-proposal-only` and `base-composed`, replay compatibility event for event in
  `480` of `480` evil-target games, so the good value functions are completely inert at an evil seat
  and every reported delta for them is an exact `0.0%` with a zero-width interval. Only `full-role`
  is causal, and it is causal almost everywhere: it diverges from compatibility in `477` of `480`
  games.
  The second result is that all that divergence moves no win-rate cell. Against the heuristic
  population `full-role` minus compatibility is Morgana `-1.7%` (95% `-10.0%` to `+6.7%`), Assassin
  `+1.7%` (`-8.3%` to `+13.3%`), Mordred `0.0%` (`-10.0%` to `+8.3%`), Minion `-3.3%` (`-8.3%` to
  `0.0%`); against the seeded random population Morgana `-1.7%` (`-15.0%` to `+11.7%`), Assassin
  `-6.7%` (`-16.7%` to `+1.7%`), Mordred `-8.3%` (`-21.7%` to `+5.0%`), Minion `+5.0%` (`-8.3%` to
  `+18.3%`). No interval excludes zero and none excludes a loss; the one interval that excludes an
  improvement is Minion against the heuristic population, whose upper bound is exactly `0.0%`.
  Pooled descriptively across the four roles, compatibility takes `198` of `240` heuristic-population
  games against `full-role`'s `196`, and `179` of `240` random-population games against `172`. The
  report produces no pooled interval, so those two are point counts only. This is the same shape the
  good side produced: the role layers change decisions without changing outcomes, which is why
  NB-010 diagnosed the base policy rather than the specializations. Nothing here promotes anything.
  One reading caution is recorded with the numbers and printed by the bench itself. Of the three
  report rates only `targetWinRate` is alignment relative; `cleanInitialProposalRate` and
  `voteTruthAccuracy` are defined from the good side, so an evil target scores low on them by
  playing its own side well. `cleanInitialProposalRate` is `0.0%` in all eight cells, as it must be
  for a leader who seats itself. `voteTruthAccuracy` is the loud signal: `full-role` raises it from
  `13.0%` to `34.1%` for Morgana against the heuristic population, `4.2%` to `45.9%` for Assassin
  against random, and `6.0%` to `56.0%` for Mordred against random. Read at an evil seat that says
  the role stack rejects evil-carrying teams far more often than compatibility does, which is a
  behavior change worth a policy look and not a quality improvement. NB-013 is separately making
  that metric asymmetric; this run touched neither the report fields nor the stored baselines.
  Run it with `node server/eval/full-role-bench.ts --side evil`, optionally sharded by
  `--target-role`. The whole bank was measured three times while landing, once per base as this
  branch rebased forward: before the NB-015 trace lifecycle and the score-projection refactors,
  after them, and again after the declared-lean removal and NB-014. All three runs agree exactly,
  down to the win count in every one of the `32` variant cells, all eight intervals, the `480` of
  `480` inert ablations, the `477` of `480` divergences, and the clean safety and eligibility
  record. That is independent evidence those changes preserved behavior, and it is cheap evidence to
  keep collecting: the bank pins its own deals, so `test/evil-policy-bench.test.ts` fails loudly if
  a future engine change moves them rather than letting the recorded numbers quietly stop matching
  the code under them. Full suite 1186 correctness tests plus the three isolated performance tests.
- Measured the two open cognition-caching follow-ups instead of guessing at them. New API-free
  benchmark `server/eval/cognition-performance.ts` (`npm run cognition-performance`,
  `cognition-reconstruct-cost-v1`) collects a corpus by playing normal heuristic games, recording
  the exact request/view pair each deciding seat faced, then replaying those recorded inputs down
  each timed path. Nothing it does changes a decision. Default population is five games at each of
  the six player counts, best of two sweeps, reporting the minimum total as the least
  noise-contaminated estimator on a shared developer host.

  Phase 3B is closed, and not because the cost is small. Reconstruct is `84%` to `86%` of a
  heuristic decision, measured over 6,105 decisions in 30 games and 3,634 in 18, so the path is
  material. Neither proposed remedy reaches it. A per-view cache cannot hit at all: both corpora
  have exactly as many distinct `(game, seat, visible cursor)` keys as decisions, 6,105 of 6,105 and
  3,634 of 3,634, because a seat never decides twice at the same cursor. That is a structural
  property, not a measurement, so it is pinned by its own test rather than by a timing budget; if it
  ever breaks, the follow-up deserves reopening. Incrementing is nearly as expensive as rebuilding,
  keeping `97%` to `100%` of the reconstruct cost, because `advanceCognition` re-infers the whole
  belief regardless of the earlier state and only skips re-extracting evidence from events it has
  already seen. The cost lives in the exact belief projection itself, which is `96%` to `98%` of
  reconstruct, and the bounded deal cache already removes the enumeration half of it: cold first
  touches are 225 of 6,105 calls and `7%` of total reconstruct time. So this is a solver question,
  not a redundant-work question, and neither wording of the follow-up addresses it.

  Phase 3C is closed too. The compatibility call does rebuild cognition the composed agent already
  advanced for the same seat and cursor, and that duplicate is `7.5%` of a composed decision at one
  game per player count, `8.3%` at three, and `7.9%` at five. An earlier reading of this same arm
  reported the whole composed sweep at `968 ms` for three games against `241 s` for five and took
  that instability as a reason to leave the item open. The instability was a defect in the
  measurement, not in the system: the composed `decide` is async, and stopping a synchronous clock
  around the call timed the promise's construction rather than the work. With the timing awaited,
  three games per player count measure `114 s` against `246 s` for five, and the duplicate's share
  is stable to within a point across all three populations. The corrected numbers are what the item
  is closed on.

  Reuse is feasible: chaining `advanceCognition` produces byte-identical state to a fresh
  `reconstructCognition` across every decision in the corpus, so the composed agent's own cognition
  could in principle be handed to the compatibility policy. It is not worth doing now. Eight percent
  is roughly twenty seconds on a four-minute composed sweep, and collecting it means widening a
  production heuristic entry point and guarding it on facts that are cheap to get wrong: the saving
  only exists when the belief pipeline is plain exact belief, because a configured language
  interpreter makes the composed belief deliberately different, and passing it anyway would move the
  compatibility candidate id, the scored surface, and therefore decision and trace bytes. The
  composed cognition also carries private role-objective and plan-memory fields the heuristic does
  not read, so a safe version would pass only the two consumed projections rather than the state.
  That is a small change, but it buys eight percent on an opt-in non-default path that Phase 4
  replaces. The equality is pinned by test so a future promotion starts from it. Full suite 1182
  correctness tests plus six isolated performance tests, strict typecheck, ratchet, and lane
  inventory.
- NB-012 concealment experiment evaluated and withheld. The tested
  `merlin-percival-role-utility-v2` candidate added a bounded prospective vote-record cost after
  Merlin had one prior public vote. Its vote value weighted private influence at `0.35` and
  concealment at `0.65`; the concealment cost weighted directional knowledge tell at `0.75` and
  prospective public salience at `0.25`, with a `0.50` centered score adjustment. The cost used
  only the exact public observer and canonical public record, remained zero for proposals and a
  first vote, and was host-rebuilt under exact trace admission. A frozen matched evaluation covered
  all 60 Merlin seats in each of the compatibility and full-role arms for both heuristic and random
  opponent populations, or 240 games per revision. Against heuristics, the full-role arm improved
  from 11.7% to 16.7% good wins: assassination losses fell from 25.0% to 21.7%, and three-fail
  losses fell from 63.3% to 61.7%. Against random opponents, good wins fell from 71.7% to 68.3%:
  assassination losses rose from 11.7% to 15.0%, while three-fail losses remained 16.7%.
  Compatibility arms were unchanged. This clears the directional heuristic gate but not the
  cross-population acceptance bar. The executable candidate was removed after evaluation, so the
  production `full-role` preset and its scorer/projection identities remain byte-for-byte v1; the
  result is retained here as evidence for the next NB-012 iteration.
- NB-013 first half: the asymmetric vote metric, promoted out of the offline reader into the report a
  promotion is gated on. `voteTruthAccuracy` scored a vote correct when `(vote === 'reject') ===
  teamHasEvil`, so a wrongly rejected clean team and a wrongly approved dirty team counted the same
  while their game value does not, and NB-010 watched that number rise as the win rate fell. The
  directional split existed only in `good-policy-diagnosis.ts`, which no gate reads. The architecture
  report's decision-quality block now states `voteDirtyTeamApproveRate` and `voteCleanTeamRejectRate`
  next to the symmetric accuracy, per variant and per role, with matched-case paired bootstrap deltas
  for both, and the renderer prints a `vote-errors` line and a `vote-error deltas` line. Each
  directional rate is conditioned on the teams the seat was actually offered, not on all of its
  votes, so it measures the vote policy rather than how often the leaders around it happened to offer
  a dirty team. The symmetric accuracy is kept and documented as continuity-only: it cannot gate a
  promotion. Three readers were separately classifying the same event, so the classification is now a
  single definition in `vote-direction.ts` (four cells, the dirty-team predicate, and every
  denominator), and the architecture report, the Phase 5C conversion report, and the NB-010 diagnosis
  all consume it. That collapsed two duplicate confusion matrices, and the unknown-team-seat refusal
  the conversion report had alone now protects all three: scoring an unresolvable seat as good would
  silently convert the costly error into the cheap one. Report schema goes `2` to `3`. The pinned
  Phase 0 heuristic baseline is unaffected and byte-identical, because it strips `decisionQuality`
  wholesale; its comparison projection did carry the leak shape, since it omitted today's delta
  fields by name and would have absorbed the two new ones, so it is now a positive field list that
  cannot gain a field by a current report growing one. The new suite builds the case that motivated
  the change: two variants over one deal, each casting one right and one wrong vote, so the symmetric
  delta is exactly `0` while the dirty-team approval delta is `+100%` and the clean-team rejection
  delta is `-100%`. NB-013's second half still owes the policy change: weight the two directions in
  the good vote value function, then require the dirty-team approval rate to fall on the paired bench
  with the win rate not falling. Nothing is gated on the new number yet, no default moved, and no
  paid lane ran. Full suite 1195 correctness tests plus the isolated performance tests.
- NB-013 second half: the asymmetric vote objective, and the gate its first half was built to read.
  `good-vote-utility-board-swing-v1` values a vote branch by the board slot it risks,
  `P(clean) - P(dirty)`, where the symmetric utility valued it by `P(clean)` alone and so left the
  failure branch worth exactly zero. That is the whole change: rejecting a clean team was already
  priced through `alternativeRealization` and `hammerPenalty`, and approving a dirty team was free.
  The weight is not tuned. A failed quest costs the good side one board slot, which is what a
  successful one gains, so `failedQuestCost` is `1` by derivation. It is a separate recorded identity
  (`good-proposal-vote-board-swing-v1`, a fourth good score layer) rather than an edit to the
  measured Phase 4B arm, because a different value function is a different policy, and admission now
  enforces the pairing: a trace declaring the board-swing utility must carry the board-swing scorer
  and vice versa. `createGoodProposalVoteScorer` refuses a seeded board-swing arm, which was never
  measured. No default, preset, or bank arm moved.
  The gate is `npm run vote-objective-bench`: the same frozen 180-deal `phase4-good-v1` bank, both
  free populations, three arms differing only in the vote value function, 1,080 games, zero cost and
  zero degradation. The dirty-team approval rate falls in all six population/role cells and its 95%
  interval excludes zero in four: heuristic Percival `42.4%` to `28.3%` (`-14.1%`, `-18.9%` to
  `-9.5%`), heuristic Servant `54.5%` to `37.4%` (`-17.1%`, `-21.4%` to `-12.7%`), random Percival
  `35.9%` to `20.8%`, random Servant `47.5%` to `30.2%`. The target win rate falls in no cell and
  rises in four, none significantly on its own: heuristic Servant `7/60` to `10/60`, heuristic
  Percival `13/60` to `14/60`, random Servant `29/60` to `31/60`. The cheap error rises in exchange,
  which is the trade the objective now makes deliberately rather than by accident: heuristic Servant
  clean-team rejections go `18.0%` to `43.9%`. The gate is met.
  Two findings worth more than the gate. First, the first half earns its keep: the symmetric accuracy
  also rose in most cells (random Servant `55.7%` to `69.8%`), so a promotion gated on that number
  could not have told this change from the NB-010 regression that also raised it, while the
  directional split shows the actual trade. Second, the reference arm reproduces NB-010 on the same
  games: compatibility beats the symmetric structured baseline at heuristic Servant by `+15.0%` (95%
  `+5.0%` to `+25.0%`), matching NB-010's `-15.0%` (`-25.0%` to `-5.0%`) with the arms swapped, and
  loses to it in all three random cells. So the population sign flip is intact and the adverse gap is
  narrowed, not closed: at heuristic Servant compatibility still wins `16/60` against board swing's
  `10/60`. Nothing here justifies promoting the composed default, and the register's promotion row
  stays blocked on NB-012 and NB-014.
  Structural work the change required. The vote value function had three exact copies that admission
  compares at `1e-12`: the score layer that produces the features, the scorer contract that validates
  them, and the trace admission that restates them from an archived artifact. A second utility version
  would have made three copies six, so the formula now has one definition in `good-score-contract.ts`
  that all three consume, verified by the existing arms' numbers not moving. `calculateDeterministicGoodBase`
  takes the utility version as a required argument rather than a defaulted one, because the one call
  site that inherited the default silently (diagnostic feature projection in `score-compatibility.ts`)
  would have published board-swing decisions with symmetric feature numbers. The recorded vote features
  gained no field. Trace admission replays a decision and compares the whole run for deep equality, so
  any field added to the archived shape refuses every artifact recorded before it while
  `GOOD_VOTE_FEATURE_VERSION` still claims compatibility; `utilityVersion` carries which value function
  ran and the priced cost term stays derivable from fields already recorded, pinned by a key-set test.
  Recorded honestly: the first formulation priced only the approve branch, which left the two branches
  on different scales, and the measured effect on the 5-player slice was a policy that rejected nearly
  every clean team (clean-team rejections `+84.2%` at Servant, dirty approvals `-50.0%`, win rate
  flat). It was never committed. Pricing both branches on the same scale is what produced the numbers
  above. Also carried forward: the conditional denominators are not a fixed vote set, since an arm
  that votes differently is offered different teams (heuristic Servant sees 347 dirty-team votes
  under the baseline and 364 under the candidate), so these rates measure the policy in play rather
  than a treatment effect on identical decisions.
  One defect the gate did not catch, found in review and left for NB-012 or NB-014 because fixing it
  changes the value function and would invalidate this measurement. `rejectUtility` multiplies the
  signed swing by `alternativeRealization`, a factor below `1`, which discounts a gain correctly but
  shrinks a loss toward zero. With `currentCleanProbability` `0.025` and every alternative dirty, the
  seat approves a `97.5%`-dirty team at full runway (approve `-0.9207` against reject `-1.0000`) and
  rejects the same team with the hammer imminent (`-0.9000`). That is inverted twice: rejection should
  be cheaper with runway to spare, and the hammer is the one place rejecting buys nothing because the
  team is auto-approved. A signed value needs a discount toward the status quo, not toward zero. Full suite 1207 correctness tests plus the isolated
  performance tests.
- NB-016 second attempt, and a power finding that applies to the whole NB-01x
  queue. A servant score layer ranked the tied top of the proposal surface by the shared public
  read (`analysis/public-self-read.ts`) instead of by the compatibility choice. It was granted
  propose authority, gated, and **withdrawn**. Per decision, over 1,552 held-out servant proposals
  from 600 seeded games (`server/eval/servant-propose-calibration.ts`), it reshuffles `36.7%` of
  picks and the reshuffle carries no information about whether the team is actually clean: 58
  base-clean/candidate-dirty against 52 the other way, exact two-sided sign test `p = 0.63`. It was
  always going to be inert: `evilReadIndex` is `0.70` times the public evil marginal plus `0.30`
  times a failed-quest exposure index, so it is a lossy re-encoding of what the exact posterior
  already holds plus a documented double count, and its only real content is the private-versus-
  public knowledge gap, which at a servant seat is close to zero. The layer is deleted; the
  hypothesis survives as `projectionAdjustedPicker`, verified 130 of 130 picks identical to the
  layer before deletion.

  **The power finding.** The first NB-016 attempt was withheld for moving heuristic wins `7/60` to
  `11/60` while moving random `29/60` to `27/60`. At `n = 60` a net four-game paired shift cannot
  reach `p < 0.05` under any split of the discordant pairs: the most favourable possible
  arrangement, four discordant pairs all one way, is an exact sign-test `p = 0.125`, and realistic
  splits land between `0.29` and `0.50`. The two-game "regression" that blocked it is further from
  resolvable still (`45.0%`, 95% `33.1%` to `57.5%`, against `48.3%`, 95% `36.2%` to `60.7%`). The
  same holds for NB-013's `7/60` to `10/60`. So all three withheld fixes (NB-012, NB-013, NB-016)
  were gated on differences the bank cannot resolve, while NB-013's per-decision metric, which the
  bank CAN resolve, moved `54.5%` to `37.4%` with a 95% interval of `-21.4%` to `-12.7%`.

  There is a structural reason this keeps happening in one direction. NB-010 named the defect as
  Merlin legibility: near-oracle votes that an exploiting opponent punishes. A random population
  cannot exploit it, so any genuine fix is neutral-to-slightly-negative there by construction.
  Requiring no regression in the population that cannot exhibit the defect systematically blocks
  every fix for it. The gate wants a power threshold on the regression arm, or a bank large enough
  to distinguish four games from noise, before any further policy work is worth doing.
- NB-016 compatibility tie-order experiment evaluated and withheld. The tested
  `full-role-compatibility-tie-scorer-v1` terminal applied only to Servant proposals. It retained
  the exact `good-proposal-features-v1` clean probability and used one `Number.EPSILON` mechanical
  adjustment only when the unchanged compatibility choice was already a member of the posterior
  argmax. Every other role and decision resolved through the existing full-role stack. Exact
  admission replayed the extra terminal and all 240 artifacts from the frozen 60-Servant-seat,
  two-arm, two-population matrix were promotion-evidence eligible, with zero forced-policy,
  degradation, hidden-information, attribution, call, or cost failures.
  The matched first target proposal confirms the mechanism NB-014 predicted. Against heuristic
  opponents, all 52 scored baseline teams remained viable and inside the candidate argmax; the
  arms agreed on 24 (`46.2%`), and candidate-clean/baseline-dirty pairs outnumbered the reverse
  7 to 2. Against random opponents, all 56 scored baseline teams likewise remained in the argmax;
  the arms agreed on 28 (`50.0%`), with a 6 to 2 cleanliness advantage. First-proposal cleanliness
  rose from `15.4%` to `25.0%` in the heuristic population and from `21.4%` to `28.6%` in the
  random population. Those numbers establish that the tie order changed the intended surface
  without inventing posterior evidence. They do not gate promotion.
  The win gate is mixed. Against heuristic opponents, good wins rose from `7/60` (`11.7%`) to
  `11/60` (`18.3%`), a paired `+6.7` points with 95% interval `0.0` to `15.0`. Against random
  opponents, they fell from `29/60` (`48.3%`) to `27/60` (`45.0%`), `-3.3` points with interval
  `-11.7` to `+5.0`. Clean proposal rates rose in both populations while win rate changed sign,
  independently confirming NB-016's rule that cleanliness cannot substitute for the outcome gate.
  The candidate therefore does not promote. Its executable scorer, registry terminal, and
  dedicated bench were removed after evaluation, leaving `full-role-policy-scorer-v1` and every
  production preset unchanged. The result remains `review` evidence for a future tie policy that
  can retain the heuristic-population gain without reproducing its random-population loss.

- Wide good bank, and three numbers this tracker had been steering by that did not survive it.
  `phase4-good-v1` stays frozen because every recorded measurement is against it;
  `phase4-good-wide-v1` is the same experiment at six times the deals (identical casts, identical
  disabled-discussion profile, identical three good target roles, distinct seeds, `1,080` cases at
  `360` per target role). Its target seats are derived by dealing each seed rather than hand
  listed, with the drift guard surviving as one digest over the whole mapping, `e3043271`, pinned
  by `test/wide-good-bank.test.ts`, emitted by every run as provenance, and separately proved to
  pin the truth by re-dealing all 1,080. `server/eval/wide-good-gate.ts --role --population` runs
  one cell and writes artifacts; reading them stays with the shared readers.

  The sizing came from a power calculation the frozen bank cannot meet. At `60` games a cell, a
  net four-game paired shift cannot reach `p < 0.05` under ANY split of its discordant pairs: four
  discordant all one way is an exact sign-test `p = 0.125`, and realistic splits land between
  `0.29` and `0.50`. NB-016 was withheld for moving heuristic wins `7/60` to `11/60` against a
  two-game move the other way, and NB-013's vote objective moved `7/60` to `10/60`.

  **The servant win-rate gap does not replicate.** At `360` paired games per cell, `full-role`
  against compatibility reads `-1.9%` (95% `-5.6%` to `+1.7%`) against heuristic opponents and
  `-0.6%` (95% `-6.4%` to `+5.3%`) against random. `base-composed` and `structured-only` read the
  same way. The frozen bank's `-15.0%` (95% `-25.0%` to `-5.0%`) sits outside the new interval;
  both wide estimates sit INSIDE the old ones, so nothing contradicts anything. The sixty-game
  cell drew high for compatibility and low for the composed policy and the gap compounded both
  errors. A small cell does not merely fail to resolve small effects, it manufactures large ones,
  and this one had been carried as settled fact and used to rank work.

  The indistinguishability claim is confirmed exactly rather than approximately: `full-role` and
  `base-composed` return identical wins (`68/360`) and identical deltas on every reported metric,
  to the tenth of a point, in both populations. The role layers cost and add nothing measurable at
  a servant seat.

  **NB-016's premise is narrower than recorded.** The `92.6%` in-argmax figure for the
  compatibility team is about matched FIRST proposals. Across the whole propose channel it is
  `10.8%` (14 of 130), against a mean argmax of `22.7` teams among `114.2` survivors, so a random
  survivor lands in the argmax about `20%` of the time and the heuristic lands there LESS often
  than chance. Removing the cases where the base already agrees, the tie-order rule can act on
  `1.5%` of decisions, which cannot move a win rate and is the likeliest reading of its first
  attempt.

  **What survives is proposal quality, and the defect is in the belief.** Every composed arm
  proposes fewer clean teams than compatibility in both populations (`-7.0%`, 95% `-11.6%` to
  `-2.3%` for full-role against heuristic), clear of zero in five of six cells. Scored per
  decision over `625` held-out servant proposals, the compatibility heuristic seats `0.923` evil
  players per team against the exact-posterior policy's `1.181`, with `73` discordant pairs
  favouring it against `37`, exact two-sided sign test `p = 7.7e-4`. The round profile is the
  mechanism: at q1 the two are IDENTICAL (`62.5%` dirty each) because no behavioural record exists
  yet, and from q2 the heuristic pulls away and stays away (q3 `71.3%` against `80.9%`, q5 `68.0%`
  against `78.0%`). The belief runs `constraints-only`, exact over the hard constraints the public
  record implies and blind to behaviour; the heuristic is not. So the propose channel does not
  want a better ordering over a blind posterior, which is what NB-016 and the withdrawn servant
  public-read refinement both attempted. It wants the posterior to stop being blind, which is
  BELIEF-001's territory and the existing `LikelihoodFactor` mechanism.

  One incidental finding bearing on NB-013: the two composed vote policies differ by fourteen
  points on dirty-team approval. `structured-only`, on the SEEDED vote band, reads `-7.6%` against
  compatibility (better); `base-composed` and `full-role`, on the deterministic
  `goodProposalVoteScorer`, read `+6.7%` (worse). The permissiveness NB-010 named is a property of
  the deterministic vote policy and the seeded band already removes most of it, so a board-swing
  objective must be measured against the seeded arm or be credited with a gain shipping code
  already delivers.

- The propose-channel fix already exists in the tree and is switched off. Following the finding
  that the `constraints-only` belief is blind to behaviour, the obvious next build was a
  behavioural likelihood. Checking first showed there was nothing to build: Phase 5 shipped
  `analytical-quest-card-v1`, `questCardEvidence` builds a record for EVERY completed quest
  including the successful ones, and `questWeightedBeliefModel` is exported. Every bench and
  preset runs `factors: 'off'`.

  Scored on the same `625` held-out servant proposals, same policy, only the belief model changed:

  | proposal policy | dirty teams | evil per team | vs base, discordant | p |
  | --- | --- | --- | --- | --- |
  | `constraints-only` base | `81.1%` | `1.181` | | |
  | compatibility heuristic | `75.4%` | `0.923` | `73` for, `37` against | `7.7e-4` |
  | **quest-weighted belief** | **`71.4%`** | `0.968` | `79` for, `18` against | **`2.7e-10`** |

  The weighted belief beats the heuristic head to head as well, `61` discordant pairs to `36`,
  `p = 0.0144`. It reaches the lowest dirty-team rate of the three while the heuristic keeps a
  slight edge on evil seats per team.

  The round profile is the anchor and it lands exactly where the mechanism predicts. At q1 all
  THREE policies are identical (`62.5%` dirty): no quest has completed, so the factor has no
  evidence and reweights nothing. From q2 the weighted belief separates and the gap widens with
  the record: q3 `69.9%` against the base's `80.9%`, q4 `81.9%` against `93.5%`, q5 `62.0%`
  against `78.0%`.

  So the propose-channel defect is not a missing model, a missing selection rule, or a missing
  weight table. It is a shipped, tested, capped likelihood factor that no configuration turns on.
  Promoting it is a real decision rather than a flag flip, because it moves belief `quality` from
  `constraints-only` to `weighted` for every downstream consumer and pays an enumeration cost, so
  it wants the wide-bank gate on win rate in both populations plus a `belief-calibration.ts`
  reading. BELIEF-001 remains open and is now the SECOND step: the two vote-matrix signals the
  heuristic reads (`+1.5` for leading a proposal whose quest failed, `+0.4` for approving one from
  off the team) still have no factor, and they are what the quest-card model cannot express.

- Quest-card factor gated on the wide bank, and it passes the cross-population test that has
  blocked every previous candidate. `full-role` with `analytical-quest-card-v1` against the same
  `full-role` on `constraints-only`, servant cell, `360` paired deals per population, with
  compatibility carried as the reference.

  | quest-weighted minus constraints-only | heuristic | random |
  | --- | --- | --- |
  | win | `+1.9%` (95% `-1.4%` to `+5.3%`) | `-0.3%` (95% `-4.4%` to `+3.9%`) |
  | clean proposal | `+10.5%` (95% `+5.8%` to `+15.2%`) | `+4.4%` (95% `+0.9%` to `+7.9%`) |
  | vote truth | `+4.6%` (95% `+2.8%` to `+6.4%`) | `+7.4%` (95% `+6.1%` to `+8.8%`) |
  | dirty-team approve | `-10.2%` (95% `-12.3%` to `-8.2%`) | `-10.0%` (95% `-11.4%` to `-8.6%`) |
  | clean-team reject | `+13.9%` (95% `+10.4%` to `+17.6%`) | `+7.0%` (95% `+4.1%` to `+9.9%`) |

  Three decision-quality channels improve in BOTH populations with every interval clear of zero,
  and win rate moves in neither (both intervals span zero). Against the reference, the
  quest-weighted arm ties compatibility exactly on heuristic wins (`75/360` each, against the
  constraints-only arm's `68/360`) while beating it on clean proposals (`31.7%` against `28.2%`)
  and vote truth (`57.0%` against `51.8%`). This is the first candidate in the register to
  improve decision quality in both populations without regressing win rate in either, which is
  the gate NB-012, NB-013 and NB-016 each failed.

  The two ways it could have been paid for were checked rather than assumed, and neither
  happened. **Votes:** a sharper posterior could have made an information-poor seat more
  exploitably decisive, which is NB-010's mechanism. Instead vote truth rose and dirty-team
  approval fell by ten points in both populations, the latter being NB-013's own gating metric,
  reached through the belief rather than through a vote objective. **Merlin exposure:** a sharper
  belief could have made the good side more legible. Paired and depth matched on the same games,
  the quest-weighted arm reads `-0.0010` (95% `-0.0020` to `+0.0001`), trending slightly down,
  while compatibility reads `+0.0014` (95% `+0.0001` to `+0.0026`) and does leak more.

  **Calibration**, which the factor's own header asks for because its probabilities are
  "analytical conventions, not measured frequencies": on the heuristic cell the weighted belief
  improves the player-evil target (Brier `0.2422` to `0.2382`, log loss `0.6775` to `0.6689`,
  ~26k rows) and is neutral on team-clean (Brier `0.0602` to `0.0605`, log loss `0.2112` to
  `0.2125`, ~235k rows). So the reweighting is honest and not merely useful.

  The one cost is clean-team rejection, up in both populations. The arm rejects more overall: it
  trades away some clean teams to refuse far more dirty ones, and the symmetric vote-truth metric
  nets positive. Compatibility is worse still on that measure (`+24.3%` on heuristic against this
  arm's `+13.9%`), so the quest-weighted arm sits between the two rather than at an extreme.

  Scope, stated because promotion should not outrun it: this is the SERVANT cell only. Merlin and
  Percival cells are unrun, and the factor changes belief `quality` to `weighted` for every
  downstream consumer at an enumeration cost that has not been profiled. A tooling limit also
  surfaced: `readArtifacts` threw `ERR_STRING_TOO_LONG` on the random cell's artifact file, so the
  calibration reading above covers the heuristic population only.

- Quest-card promotion attempted and reverted, on a blocker neither the per-decision harness nor
  the wide-bank gate could see. Seating `questWeightedBeliefModel` on the `full-role` preset (the
  one place a preset becomes wiring, and the arm that was gated) reddens
  `seat-decision-inspector`: the agent's own trace comes back `rejected` with
  `trusted-identity-host-join-failed` instead of `trusted-exact`.

  The cause is one line. `exactPolicyHostSurface` builds its host-owned scoring surface from
  `exactBelief(view)` unconditionally, so the host recomputes against a uniform posterior whatever
  the trace was actually produced on. It fails even on `merlin-opening-proposal`, where no quest
  has completed and the weighted belief is numerically IDENTICAL to the uniform one, because the
  recomputed `beliefModelVersion` still disagrees with the trace's. With real quest evidence the
  numbers would diverge too.

  This is not a test to update. Trace admission is the trust boundary: seating the factor would
  mean every production decision's trace fails exact admission, taking the artifact pipeline and
  the external-agent ingress with it. The gate measured the policy and could not have caught this,
  because it never asked whether the resulting traces admit.

  The fix is shaped and symmetric rather than novel. The validation layer already models weighted
  beliefs (`quality === 'weighted'`, belief provenance, a `factors` component version), so only the
  exact replay is behind. The identity already carries `configuredPipeline.belief.model`, and the
  score chain is ALREADY resolved from that same identity via `trustedNativeScoreChain`, so
  resolving the belief model the same way follows an established precedent at the same boundary.
  What does not exist yet is any version-to-model resolver, and adding one at this boundary needs
  hostile-artifact coverage proving a forged belief claim cannot make a bad trace admit. Tracked as
  ADMIT-001; BELIEF-002 is blocked on it.

- ADMIT-001 built, and the quest-card factor seated on `full-role`. Promotion had reverted because
  admission recomputes a decision to prove it and named the uniform belief literally, which was
  the same thing as "the model this trace used" only while the uniform model was the only one
  anything ran.

  It turned out to be three gates, not one, and the third is the reason the first attempt was
  right to revert:

  1. `policy-host-surface` rebuilt its scoring surface from `exactBelief` unconditionally.
  2. `component-host-inputs` bound a rebuilt belief as a trusted input only when the trace named
     the uniform model with factors off, so a weighted decision's components had nothing to be
     verified against.
  3. `isExactNonLanguage` gated the exact native score replay on the same literal, so seating the
     factor SKIPPED the strongest verification entirely. The `score-layer deletion` forgery in
     `seat-decision-inspector` admitted as `trusted-exact` with the whole `scoreLayerRun` removed.
     A promotion that only fixed the first two would have quietly widened what admission accepts
     while appearing to work.

  The fix is one predicate, `isHostReconstructibleCognition`, asked by both the host-input gate and
  the score replay, over a closed list keyed off each model's own reported version. Gates 1 and 2
  fall out of it. The list holds only models the host can rebuild from a view alone; the
  language-weighted belief is absent because its version is composed at runtime and rebuilding it
  needs interpreted evidence no host holds, which makes it unreconstructible rather than merely
  unimplemented. The legacy v1 role reader keeps its own frozen `isExactNonLanguage`: widening a
  historical ingress is a separate decision with separate evidence.

  Six tests cover the boundary, and most of them are about what is still refused: a trace claiming
  the cheaper model while carrying weighted content, a model and factor bundle that do not belong
  together, a component graph disagreeing with the trace about the belief, a claimed `weighted`
  quality the host's own rebuild does not produce, and an invented model name. All rejected.

  Seating the factor then tripped `composed-spec`'s invariant that the `full-role` preset and the
  bench arm resolve one identity, which is the invariant working: the arm moved with the preset,
  so what ships and what was measured stay the same configuration. `good-base` is untouched,
  because only `full-role` was gated.

- Vote-matrix factor built, measured, and NOT promoted, on the population test that separates a
  model of the game from a model of one opponent. BELIEF-001's remaining two signals are both
  votes, so the factor prices one asymmetry: evil approves a team it can fail and is more
  reluctant about one it cannot. Both heuristic signals fall out of that rule read in two
  directions, only evil votes are priced (a constant for good voters cancels in the
  normalization), and failability is world-conditioned so an Oberon aboard reads a team's
  failability differently from the partners it cannot see.

  On heuristic-driven records it is the strongest thing measured here: dirty-team rate `81.1%` to
  `52.0%` over `625` held-out proposals, `211` discordant pairs to `29`, `p = 2.7e-35`, with the
  round anchor landing correctly (identical to the base at q1 when no ballot has been cast, then
  improving monotonically to `22.7%` against `78.0%` by q5).

  **Against a random-driven population it finds nothing**: `75.5%` to `74.0%` over `703`
  proposals, `76` to `65`, `p = 0.40`. The quest-card factor, run on the same two corpora,
  survives both: `81.1%` to `70.7%` (`p = 6.8e-12`) and `75.5%` to `68.1%` (`p = 1.3e-5`).

  That contrast is the finding, and it is not a defect in the factor. Random opponents vote
  without regard to who is aboard, so there is genuinely no vote behaviour to read and finding
  nothing is the honest result. What it establishes is the SHAPE of the evidence: the quest factor
  reads quest outcomes, which are determined by who was aboard however anyone voted, so it
  generalizes; the vote factor reads behaviour, so its value is entirely contingent on opponents
  whose evil voting follows the modelled asymmetry.

  And the heuristic follows that asymmetry close to by construction: its own `decideVote` makes
  evil approve teams with known evil aboard, which is this model's assumption. So `p = 2.7e-35` is
  an UPPER BOUND on a population built to satisfy the model, not an estimate for real play. That
  is why the factor is registered and not seated, and why the wide-bank gate on it, however it
  reads, cannot settle the question either: both of its populations are the same two.

  What would settle it is a population that votes purposefully but was NOT built on this
  assumption. The cheap version is a third synthetic table whose evil votes to look clean rather
  than to fail; the expensive and more convincing version is EVAL-002's paid LLM comparison.

- Vote-matrix model checked against the strategy brief instead of against another invented
  opponent, and the brief names two things the model does not have. Recorded because the general
  lesson is worth more than the specific fix: when a behavioural model is uncertain, the question
  is usually already answered in `docs/research-strategy.md`, and building a synthetic population
  to probe it is a slower and weaker substitute for reading what human play has already settled.

  First, the model's DIRECTION is confirmed, not merely assumed. §1.2 states it outright: "Evil
  players systematically approve teams that contain evil and reject clean teams." The heuristic
  implementing that rule is the heuristic being right about Avalon, so a corpus generated by it is
  not circular in the damning sense. The earlier reading of the random-population null as "the
  gain does not survive" was wrong on its own terms: random tables do not play Avalon, so a
  behavioural factor finding nothing there is a NULL CONTROL PASSING, and a factor that had
  "helped" against random voters would have been reading something other than the votes.

  Second, and this is the gap. §3.1 lists the per-player vote features strong humans and the SVM
  assassin actually use, and the evil-finder among them is **approve-rate on teams EXCLUDING the
  voter** — "evil is happy off-team". The current model prices failability through
  `visibleFailPower`, which counts the voter's own seat when aboard, so it captures that only
  incidentally. The feature discriminates because of a good-side baseline the same document
  states as a rule: good "should generally reject teams they are not on", since a team including
  yourself has one guaranteed-good slot.

  That undercuts this factor's central design decision. Good votes were left unpriced on the
  grounds that a good player votes on an inference the host cannot reconstruct. For the off-team
  case that is not true: the brief gives good a stated, reconstructible baseline, with its
  exceptions named (validated teams, the hammer, deliberate trust signals). Pricing it is what
  supplies the contrast the SVM feature exploits, and leaving it unpriced discards the strongest
  documented evil tell in the game.

  §2's vote-discipline entry also describes, in play terms, the "disciplined evil" population
  that was about to be built to probe this: "Mix in rejections of dirty teams and approvals of
  clean teams you can afford; never be the only rejector of an obviously clean team; never reject
  on hammer." That is a model to encode, not an experiment to run. The hammer clause is already
  satisfied, since the engine casts no ballot there and the factor excludes it.

  Next version of the factor therefore prices two asymmetries rather than one: failability as
  now, plus own-membership, with good's off-team rejection baseline supplying the contrast.

- Vote-matrix v2 built from the brief's off-team feature, measured, and REVERTED. The previous
  entry read §3.1 correctly: "approve-rate on teams excluding the voter" is the evil-finder
  strong humans use, it discriminates because §1.2 gives good a stated baseline of rejecting
  teams it is not on, and v1 could not read it because good votes were unpriced. v2 priced both
  sides, plus the brief's named exception for teams every member has already validated.

  It measured worse. On the heuristic corpus, dirty-team rate `59.8%` against v1's `52.0%` over
  the same `625` proposals; on the random corpus `72.8%` against `74.0%`, still null either way.

  The by-round profile says why, and it is not subtle: at q2 v2 reads `82.7%` against the
  constraints-only base's own `81.7%`. It is WORSE THAN NO FACTOR at the round where round-one
  ballots dominate the record, and round one is exactly where good does not follow the off-team
  rule, because rejecting there burns a proposal count good needs later and buys almost no
  information. §1.2 names that exception; v2 modelled the rule and not the exception.

  The general result is worth more than the specific revert. A feature that depends on GOOD's
  behaviour can only be read as well as good is modelled, and good's baseline carries enough
  documented exceptions (proposal pressure, validated teams, deliberate trust signals, the
  hammer) that a partial model injects more noise than signal. v1's narrower rule, price only
  what the host can reconstruct confidently and let the good constant cancel in the
  normalization, is the more defensible position and is now the measured one too.

  So the brief was right about the feature and right about the reason it works, and still did not
  license this implementation. Reading the research told us what to build; only the measurement
  told us whether this attempt at it was worth having.

  A v3 would have to model good's exceptions, not just its rule. That is a larger claim about
  play than v1 makes, and it should not be attempted without a population that did not generate
  the numbers it is tuned against.

- Correction to the entry above: the v2 revert's REASONING was wrong, and the measurement it
  rests on is now the weaker claim.

  That entry said v2 lost because good approves at round one, since "rejecting there burns a
  proposal count good needs later and buys almost no information", and that v2 modelled §1.2's
  rule without its exception. `research-strategy.md` §1.3 says the opposite. Many groups **reject
  the first proposal on principle** to harvest a free round of voting data; "always reject
  mission 1" is a widely-cited convention, and who approves an arbitrary first team seeds the
  trust graph. Rejecting round one does buy information: not a better-informed team next, which
  is what the earlier reasoning looked for and correctly found absent, but another row of the
  vote matrix, which is evidence in itself. That is doubly relevant here, since a vote-reading
  factor consumes exactly those rows. Good rejecting at round one is how good manufactures the
  evidence the factor reads.

  So the ordering reverses. `decideVote` hard-codes round one to approve for good, which does NOT
  follow the convention, and v2's off-team model is therefore CLOSER to documented human play
  than the heuristic is. v2 measured worse because it modelled good correctly against a
  population that plays the first round contrary to convention.

  The measurement stands: on this corpus v1 beats v2, and v1 remains the registered version. What
  does not stand is the inference that v1 is the better MODEL. It is the better fit to this
  opponent, which is a different and much weaker claim, and it makes the retest trigger below
  binding rather than optional.

- Retest trigger fired, and it went against the correction above rather than for it.

  That entry demanded "a population that did not generate the numbers it is tuned against" before
  a v3. Avalon-NLU supplies one: 20 annotated six-player human games with ground-truth roles,
  distilled into `server/eval/fixtures/human-games.json`. Both premises of the correction fail on
  it.

  The off-team FEATURE does not discriminate in the claimed direction. Good approves teams it is
  not on `62.4%` of the time (108/173) against evil's `51.7%` (75/145), an odds ratio of `0.64`
  where v2's model needs it well above one. Good is MORE willing to approve an off-team proposal
  than evil is, not less, so §3.1's evil-finder does not reproduce on this population.

  The round-one convention does not hold either. Good approves the first proposal `93.8%` of the
  time (75/80). The correction argued that `decideVote`'s hard-coded round-one approve is
  unrepresentative and that v2 was therefore penalized for modelling humans correctly; this
  population approves round one at essentially the same rate the heuristic does. Whatever §1.3's
  "always reject mission 1" describes, it is not what these players did.

  So the ORIGINAL revert stands on its outcome, and both explanations offered for it were wrong.
  v2 did not lose because it modelled the exception badly, and it did not lose because it modelled
  humans correctly against a bot that does not. It lost because its feature does not carry the
  signal it was believed to carry. The correction was right that the bot corpus alone could not
  settle it, and wrong about which way settling it would go.

  What survives is the general lesson, restated more strongly: a feature named in the brief is a
  hypothesis about a population, not a property of the game. §3.1 may well describe strong online
  play; it does not describe this table, and it did not describe ours.

  This is also the reason BELIEF-003's good-vote model is built on TEAM CLEANLINESS rather than
  off-team membership. Different feature, opposite evidentiary position: cleanliness
  discrimination is the strongest signal in the corpus (odds ratio `0.11` overall, `0.18` for
  servants alone) where off-team is inverted. `analytical-vote-matrix-good-v2` is deliberately
  named `-good-v2` so it can never be mistaken in a trace for the off-team v2 recorded here.

  A second correction, smaller. That entry also said four rejections let "evil's leader" seat an
  unrefusable team. Leadership rotates deterministically, so the hammer's holder is fixed by the
  seating, but whether that seat is evil is unknown to good. A rejection costs the RISK that the
  unrefusable proposal falls to an evil leader, roughly the evil fraction of the table, not a
  certainty.

- HEUR-001. The heuristic never harvests the free voting round: `decideVote` returns approve for
  any good seat at round one, against a convention the strategy brief calls widely cited. This is
  not only a bot-strength question. Every factor that reads votes is measured against a
  population that generates LESS vote evidence than real play would, so the whole class of
  vote-reading factors is systematically understated by the current corpus. Fixing it changes
  what the evidence looks like before it changes what any policy does with it.

- Retest trigger for BELIEF-001, recorded because the two versions have OPPOSITE sensitivities to
  play quality and the current verdict is a property of the opponent rather than of the game. v1
  prices only evil and needs evil's vote leak to stay undisciplined, but the brief says strong
  evil deliberately mutes it, so v1 weakens as evil improves. v2 prices good's baseline as well
  and needs good to follow it reliably, so v2 strengthens as good improves. Re-run both whenever
  the default opponent population changes materially: a heuristic that adopts the round-one
  convention, an LLM table, or human logs. The result may invert.

- Prerequisite noted while answering how a factor is turned off: there is no combined MECHANICAL
  belief model. A factor is off exactly when the seated preset's belief model does not contain
  it, which is a clean design with no dead config, but each weighted model bundles exactly one
  factor. `languageBeliefPipelineVersion` and `combinedLanguageFactorBundleVersion` compose
  language OVER a mechanical belief; nothing composes two mechanical factors. If the vote factor
  ever earns a seat alongside the quest factor, that composition is a prerequisite rather than a
  detail.

- HEUR-001 withdrawn the day it was registered, and the reason is worth more than the item.

  It proposed teaching the heuristic §1.3's convention that good rejects the first proposal to
  harvest voting data. That convention is a HUMAN table dynamic: you reject to watch how people
  react and to seed a trust graph you then talk about. On a bot table with discussion disabled
  there is nobody to read and no conversation to seed, so encoding it changes the synthetic
  corpus without making the agent a better opponent for a person.

  The stated justification was also circular. The corpus was to be changed so that a vote-reading
  factor would measure better against it, which is tuning the instrument to the hypothesis.

  The general correction, which should shape what counts as evidence from here. These agents
  exist to be good to play AGAINST, for humans. Bot-versus-bot play is the cheap, fast, offline
  proxy that makes iteration possible, and this tracker is full of it, but it is a proxy and not
  the objective. Where a behaviour's value depends on human dynamics, a bot-versus-bot number
  cannot establish it in either direction, and the honest move is to say so rather than to
  reshape the bot population until the number appears.

  Applied to the open question: the vote-matrix factor reads exactly the signal humans generate
  and heuristics largely do not. Its v1-beats-v2 result is a fact about a heuristic table and
  says little about play against people, where v2's premise (good follows a documented baseline)
  and v1's premise (evil leaks through its votes) are both more nearly true. That is why
  BELIEF-001's exit now names human or LLM tables rather than another synthetic population.

  EVAL-001 already owns the checkpoint this implies, and its framing was right all along:
  architecture tests cannot establish fun, persuasion, variety, or perceived fairness.
