# Agent architecture migration

**Status:** active tracking document.

**Current target phase:** Phase 7R3B1B, followed by Phase 7R3B3. Phase 7R3A4B is complete at
checkpoint `5479bb1`, and Phase 7R3B1A's shared scorer-sensitive situation surface is complete.
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
decision kind; one finalizer, selection path, and commit consume it. D3 remains the explicit
quest-card input overlay pending R3B3.
Phase 7R1 restored universal forced-policy authority ahead of optional D3 strategy, Phase 7R2A
moved admission behind an agent-owned boundary, and Phase 7R2B completed the generic contracts,
per-decision kernel, compatibility adapters, transport admission, trusted manifests, stored
report joins, and the complete generic-component exit gate. Mordred policy, Assassin
specialization, and the Phase 7 role-bank evaluation follow. The Phase 5C population sign flip
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
| MD-002 | Split trace parsing/canonicalization from host/domain admission into closed trust-labeled results | Downstream callers can still re-parse open trace shapes; pre-apply stdio admission and finalized-artifact diagnostic admission compose the same detached primitives with lifecycle-specific outcome rules, while retained diagnostics and identity-witnessed promotion remain distinguished by call path rather than a closed result type | R3B1 | The two lifecycle admissions converge on closed admitted or diagnostic result types, and artifact, report, and transport consumers stop domain re-parsing | `open` |
| MD-003 | Delete or isolate the remaining D3 legacy adapter and its two conformance exemptions | Robust and exact-quota D3 are the only legacy flat projection/binding exceptions | R3B3 | D3 uses the native component/policy boundary and both exemptions and flat projections are deleted | `open` |

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
| 7. Role-specific observer and identity models | In progress; Phase 7R1 complete | Generic component boundary, Mordred substrate and policy, Assassin specialization, then role-bank audit |
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
21. **Phase 7R3B, strategic decision layers and write-side cleanup:** move D3 behind universal
    forced policy as a registered strategic layer, remove superseded role-specific write paths
    after equality is proved, and retain read compatibility for old artifacts. Replace D3's
    transitional implicit state combinations with a discriminated compatibility read model that
    represents inapplicable, suppressed, degraded, exact-admitted, and robust-admitted historical
    states explicitly before deleting the write side. The native path must use the shared bounded
    admission boundary and separate exact-quota and heterogeneous-safe decoded variants; it must
    delete D3's local detached-data walk, exact-key parser, and optional-field mega-validator.
    Historical payload support remains a read-only adapter and cannot become the codec used by new
    in-process policy.
22. **Phase 7E2B, Mordred policy:** give the validated Mordred objective bounded causal authority
    over proposal and vote decisions through the ordered layer contract while preserving D2 and
    forced-policy dominance.
23. **Phase 7E3, Assassin specialization:** add a capped, interpretable Merlin posterior that
    remains distinct from generic goodness.
24. **Phase 7F, evaluation and exit audit:** compare compatibility, base composed, observer,
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

`visible-evil-exact-quota-homogeneous-research-v1` remains available only as an explicitly
homogeneous comparison. Its canonical cohort, order, common gate, and designation require every
visible evil seat to run the same convention. It declares that assumption, is marked mixed-table
unsafe and promotion-ineligible, and every exact artifact is rejected by current generation and
stored-report evaluation even if metadata falsely claims a verified homogeneous population.
Phase 7F may add genuine all-seat provenance for research measurement, but exact quota cannot
become the mixed-table production policy.

The typed quest-card directive is consumed by forced policy before scoring or planning. Engine
legality remains final, Oberon retains independent behavior, and no D3 payload enters prompts,
voice, public cognition, client data, or public logs. Configured and resolved policy identities
remain separate. Stdio, architecture generation, stored reporting, and artifacts reconstruct and
join the directive, forced reason, selected card, and applied card while rejecting seed
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

One boundary cleanup is intentionally not folded into E2A. Existing host-root validators establish
trusted typed values, but `validateBeliefForMordred` still rechecks admitted belief internals and
the treatment host join rebuilds the canonical public observer for exact comparison. Phase 7R2C
will make the parse/canonicalize-once boundary explicit before 7R3A, so downstream component
builders can trust admitted values without allowing raw or merely cast TypeScript objects through.

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
| DEV-004 | Inspector v2 after the generic policy-run DTO and A4 cutover | Derive Inspector and equality diagnostics from one admitted native run record | One bounded record supplies layer journal, candidates, policy gate, committed action, and equality deltas; no observability consumer reconstructs or relabels causal state independently. A2's bounded shadow diagnostic is the first private-only step, not the public schema. |
| DEV-005 | After Phase 7 | Split this tracker into a concise authoritative active contract and append-only completed-phase history | Preserve stable anchors and inbound links, keep current gates and debt easy to find, and prevent the roughly 219 KB historical record from remaining the primary working surface. A2 changes only this stale current capsule. |

`DecisionScenario.source.seed` is test-only replay provenance. The deterministic game seed can
reconstruct the hidden deal, so this DTO must not be reused for external agents, Inspector, client,
or any seat-visible production payload. Those boundaries require their own explicitly filtered
provenance contract.

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
(rg -n "legacyExemption: '7R3[AB]" test/phase7r2c2-component-conformance.test.ts | Measure-Object).Count
(rg -n "withLegacyScoring\(|scoreCandidates\(" server/agents | Measure-Object).Count
$p=@('server/agents/admission/composed-trace.ts','server/eval/architecture-report.ts','server/agents/communication/composed-renderer.ts'); (rg -n "roleObjective|evilRole|morganaRole" $p | Measure-Object).Count
(rg -n "canonicalRunInputs|structuredClone|JSON\.parse|canonicalizeJson|exactOwnDataRecord|denseOwnDataArrayValues" server/agents/policy/score-layer server/agents/score-layers 2>$null | Measure-Object).Count
(Measure-Command { npm.cmd run typecheck; node tools/architecture-fitness.mjs; node --test test/architecture-fitness.test.ts test/phase7r3a1-score-layer.test.ts }).TotalSeconds
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
`test/phase7d2-evil-policy.test.ts`; A3 consumes those laws rather than restating a weaker
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
- [ ] Give deep-cover and Merlin-blindness exploitation bounded, opt-in causal policy authority
      while preserving forced policy, legality, and generic evil fallback.
- [ ] Prove causal action or intent changes, privacy, replay, attribution, and API-free bounds.

Phase 7E2 is split into E2A substrate and E2B policy so the exact joint-world/public-observer
formula, legal-information boundary, and weighted provenance can be audited before mechanical
authority is added. E2A starts only after 7R2B4 passes the complete generic-component exit gate and
becomes its first production native role component. E2B starts only after 7R3 makes ordered score
and decision layers the sole write path.

### Assassin

- [ ] Add a separate Merlin posterior.
- [ ] Use truth-tracking, proposal quality, vote accuracy, deliberate noise, and role-claim features.
- [ ] Keep the model interpretable until a learned alternative wins held-out tests.
- [ ] Record virtual Assassin guesses for all evil seats to increase evaluation sample size.

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
