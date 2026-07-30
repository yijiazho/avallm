# Probabilistic agent architecture

**Status:** target design. This document defines where AvaLLM's agent architecture should go. It is
not a description of what every current code path already does.

Companions:

- [research-probabilistic-agents.md](research-probabilistic-agents.md) records the external
  research and its evidentiary limits.
- [agent-architecture-migration.md](agent-architecture-migration.md) tracks the work from the
  current implementation to this design.
- [design-bot-guidance.md](design-bot-guidance.md) remains the reference for current prompt
  guidance and forced-play rules.
- [design-implementation.md](design-implementation.md) remains the reference for the engine,
  server, client, and existing agent boundary.

---

## 1. Decision

AvaLLM should make the production bot a composed **hybrid agent**, not an LLM with an increasingly
large strategy prompt.

The hybrid agent has six distinct responsibilities:

1. **Observation:** convert a seat-filtered `PlayerView` into typed evidence.
2. **Constraint:** enumerate complete hidden worlds that remain possible.
3. **Belief:** weight those worlds using mechanical, behavioral, and bounded language evidence.
4. **Analysis:** derive the board quantities that decisions actually need.
5. **Policy:** choose a legal action using beliefs, strategic objectives, and forced-play rules.
6. **Voice:** express the committed plan in the selected model and persona's language.

The exact-world model is the initial inference backend. Evidence is expressed as composable
factors, but AvaLLM should not initially use a factor-graph library or belief propagation. The
hidden state is small enough to enumerate, and exact enumeration preserves the correlations that
team decisions depend on.

The existing pure engine, `viewFor` hidden-information boundary, event log, and pluggable
`AvalonAgent` concept remain. The internals of the LLM and heuristic agents are expected to change
substantially.

---

## 2. Goals and non-goals

### 2.1 Goals

- Produce agents that are strategically competent, socially coherent, and enjoyable to play
  against.
- Make deductions reproducible and inspectable rather than dependent on an LLM re-deriving the
  record every turn.
- Preserve joint uncertainty over complete role assignments.
- Give proposals, votes, quest cards, discussion, and assassination one shared belief state.
- Support every legal AvaLLM player count, role set, and alignment.
- Keep mechanical truth, uncertain inference, strategic policy, and public speech separate.
- Allow better likelihood models, policies, and search to be added without rewriting prompts or
  the game engine.
- Preserve raw-LLM, heuristic, and random agents as baselines for evaluation.
- Attribute every belief change and decision to versioned evidence and policy components.

### 2.2 Non-goals

- Reimplement GRAIL's six-player factor graph.
- Require neural training, CFR, or MCTS before the first useful agent.
- Treat the highest-probability hidden world as known truth.
- Make every role optimize the same objective.
- Turn the LLM into a passive text formatter. It should still interpret language, form social
  plans, choose among strategically reasonable alternatives, and provide the character of play.
- Move private inference into `PlayerView` or the game engine.

---

## 3. Invariants

These constraints apply to every implementation of this architecture.

### 3.1 Hidden information

- All cognition starts from `PlayerView`, never raw `Game`.
- `viewFor(game, seat)` remains the only hidden-information chokepoint.
- Runtime inference may use only the events and private knowledge visible to that seat.
- Offline evaluators may join beliefs with the true deal only after the decision has been
  recorded.
- Public-observer models must use a public projection of the view. They must not accidentally
  incorporate the observing agent's private knowledge.

### 3.2 Probability

- Hard constraints may remove a world.
- Soft evidence may reweight a feasible world.
- Soft evidence can never restore an impossible world.
- A displayed probability always names its semantics and model version. A uniform share of
  feasible hypotheses is not presented as calibrated behavioral probability.
- Team quantities are derived from the joint distribution, not by multiplying independent player
  suspicion scores.

### 3.3 Data dependence and priors

The north-star agent is **data-enhanced, not data-dependent**. Its correctness, legality, hard
deductions, and complete structured policy do not require historical Avalon games or an
AvaLLM-trained model. Three probability layers remain distinct:

1. **Rule-derived prior and feasible worlds.** Role counts, the viewer's role and private
   visibility, and hard public constraints come from the current seat-filtered `PlayerView`.
   Canonical assignments may be cached by game configuration for performance, but they are not
   learned behavioral probabilities and contain no game-specific hidden state.
2. **Optional pre-game likelihood bundle.** Versioned factor parameters may be hand-authored or
   calibrated from prior game artifacts and loaded before a game. They describe behavior for a
   named opponent population, such as contextual proposal, vote, or quest-card tendencies. They
   may only reweight feasible worlds, and their data source, factor version, calibration
   population, and caps remain attributable.
3. **Current-game posterior.** During play, the agent combines the rule-derived feasible set,
   optional likelihood parameters, and evidence visible to that seat in the current game. A
   pre-game bundle must not contain a suspicion state, inferred deal, or truth-derived profile for
   the game being played.

Provider LLM pretraining is separate from AvaLLM-specific behavioral calibration. A pretrained LLM
may interpret bounded language, plan among strategically acceptable candidates, and provide voice,
but mechanical belief, forced policy, and engine legality remain complete without it.

Historical data may improve the strongest production configuration, but it must satisfy these
requirements:

- Constraints-only inference plus structured policy remains a complete, independently testable
  agent when every optional factor is absent.
- Training, calibration, and evaluation split by whole game and opponent population. Evaluation
  banks and human-study games never become training rows for the component they evaluate.
- A population mismatch weakens or disables the relevant factor rather than silently treating its
  likelihoods as universal. Unknown players receive a broad population prior. Per-player
  tendencies require adequate samples, shrink toward that population prior, and never infer traits
  from a name or other untrusted identity text.
- Every learned or hand-authored contribution is versioned, capped, attributable, and unable to
  revive an impossible world.
- Missing, stale, or failed factor data degrades to the exact feasible-world posterior and is
  visible in private trace data; it never prevents a legal decision.

The production agent may therefore depend on a calibrated bundle for its measured peak strength,
but not for sound inference, safe operation, or a coherent playable fallback.

### 3.4 Decisions

- Engine legality is final and remains independent of the agent.
- Forced plays are executable policy rules with tests. Prompt prose may explain them but is not
  their only implementation.
- A proposal or revision is committed before its public explanation is generated.
- Public speech may explain or disguise a plan within the role's strategy, but it may not silently
  change the selected action.
- An agent's own prior actions are not evidence for its private hidden-world posterior. They are
  evidence in the separate model of what public observers may believe.

### 3.5 Reproducibility

- Deterministic components use the game seed and stable event sequence numbers.
- Every soft factor, policy, language interpreter, and prompt has a version.
- Belief snapshots record the last processed event and evidence provenance.
- Replaying the same seat view through the same component versions produces the same mechanical
  evidence and posterior.

---

## 4. Target flow

```mermaid
flowchart LR
    V["Seat-filtered PlayerView"] --> O["Observation and evidence extraction"]
    O --> C["Hard constraints and feasible worlds"]
    O --> F["Soft likelihood factors"]
    L["Bounded LLM language interpretation"] --> F
    C --> B["Exact normalized world posterior"]
    F --> B
    B --> A["Situation analysis"]
    A --> G["Legal candidate generation"]
    G --> P["Role-aware hybrid policy"]
    P --> D["Committed decision plan"]
    D --> X["Engine Decision"]
    D --> S["LLM voice and explanation"]
    S --> X
    X --> R["Engine legality and event log"]
    R --> V
```

The arrows describe data ownership, not necessarily one model call per box. Mechanical layers
should be cheap and deterministic. Language interpretation should run only when new table talk
justifies it. Voice runs only when a public utterance is needed.

---

## 5. Core domain types

The exact TypeScript names may change during implementation. The important decision is that these
concepts are explicit and do not collapse into a prompt string.

### 5.1 Evidence

```ts
type EvidenceScope = 'private' | 'public'
type EvidenceStrength = 'hard' | 'soft'

interface Evidence {
  id: string
  throughSeq: number
  scope: EvidenceScope
  strength: EvidenceStrength
  kind:
    | 'deal'
    | 'privateKnowledge'
    | 'proposal'
    | 'voteReveal'
    | 'questResult'
    | 'utterance'
    | 'commitment'
  actor?: Seat
  payload: unknown
}
```

Evidence extraction consumes typed `PlayerView` fields and visible events. It never parses the
rendered facts dossier or prompt text. Prompt rendering is a downstream presentation of the same
facts.

Mechanical evidence includes role counts, private visibility, proposals, votes, quest teams, and
Fail counts. Language evidence is a structured interpretation with source attribution; it is not
free-form scratchpad prose.

### 5.2 Hidden worlds

```ts
interface HiddenWorld {
  roleBySeat: readonly Role[]
  alignmentBySeat: readonly Alignment[]
  key: string
}
```

A world is a complete assignment of the public role multiset to seats. Canonical generation handles
duplicate Servant or Minion roles without producing duplicate worlds.

The first implementation may use a compact alignment projection for good/evil team decisions. The
public abstraction is still a complete hidden world so that Merlin, Morgana, Percival, Mordred,
Oberon, and assassination posteriors can be added without changing every consumer.

### 5.3 Factors and posterior

```ts
interface LikelihoodFactor {
  id: string
  version: string
  supports(evidence: Evidence): boolean
  logLikelihood(
    world: HiddenWorld,
    evidence: Evidence,
    context: InferenceContext,
  ): number
}

interface WeightedWorld {
  world: HiddenWorld
  probability: number
}

interface BeliefSnapshot {
  throughSeq: number
  modelVersion: string
  worlds: readonly WeightedWorld[]
  playerMarginals: readonly PlayerMarginal[]
  roleMarginals: readonly RoleMarginal[]
  entropy: number
  provenance: readonly EvidenceContribution[]
  quality: 'constraints-only' | 'weighted' | 'degraded'
  degradation: readonly string[]
}
```

For feasible world \(w\) and evidence \(E\):

\[
P(w \mid E) \propto I[w\text{ feasible}]P_0(w)\prod_i \phi_i(w,E_i)
\]

Implementation should accumulate log likelihoods and normalize with log-sum-exp.
The landed projection kernel normalizes arbitrary positive feasible-world weights and is shared by
constraints-only and weighted models. Every downstream marginal, joint team quantity, entropy
value, and decision feature consumes those weights. Constraints-only snapshots retain exact
uniform arithmetic so frozen prompts and fixtures do not drift.

Initial factors should be transparent:

- exact role multiset;
- own role and private visibility;
- quest Fail-count feasibility;
- quest-card behavior;
- proposal behavior;
- approval behavior;
- bounded language evidence.

The first three can be implemented without training. The behavioral factors should begin as
versioned, conservative tables or small regressions and must expose calibration metrics before
their influence is increased.

The first such implementation is `analytical-quest-card-v1`. It uses only public resolved-quest
card counts and mechanical context, applies a nonzero smoothing mixture, and caps the entire
quest-history contribution at `ln(2)`. It never changes the feasible-world set: exact constraints
remain authoritative and the factor only redistributes probability within that set. Its private
snapshot and decision trace identify the factor version, source event sequences, capped
contribution, and any typed degradation. It remains opt-in after its initial held-out success
because the composed policy has not yet beaten the compatibility agent on absolute win rate.
Its calibration improvement survived a deliberately different seeded-random opponent population,
but that is a sensitivity check rather than evidence that its hand-authored likelihoods describe
humans or particular language models.

### 5.4 Situation analysis

```ts
interface TeamAssessment {
  team: readonly Seat[]
  cleanProbability: number
  evilCountDistribution: readonly number[]
  questSuccessProbability: number
  expectedInformationGain?: number
}

interface SituationAnalysis {
  throughSeq: number
  score: { good: number; evil: number }
  matchPoint: { good: boolean; evil: boolean }
  proposalsRemaining: number
  currentTeam?: TeamAssessment
  candidateTeams: readonly TeamAssessment[]
  knownGood: readonly Seat[]
  knownEvil: readonly Seat[]
  unresolved: readonly Seat[]
  publicObserver?: ObserverSnapshot
  assassinTargets?: readonly TargetAssessment[]
}
```

This layer owns the board and team arithmetic. It replaces repeated arithmetic in prompts and
prevents each policy from inventing a different definition of "safe team."

**As implemented, it is not the single entry point this sketch implies.** Three things drifted, and
the accurate claim is narrower: `analysis/` owns every decision-ready summary, but a scorer reaches
them through a surface rather than by calling `analyzeSituation` itself.

First, the analysis is now parameterized. `policyCandidateAssessments` is empty unless a policy
explicitly requests the exhaustive team surface, and `goodVote` is present only under the good-vote
plan. `analysis/situation-plan.ts` is the sole compiler from policy requirements to one of three
executable plans (`candidate-teams`, `good-proposal`, `good-vote`), so composition never switches on
requirement IDs.

Second, `analysis/scorer-situation-surface.ts` sits in front of it. It builds the analysis together
with the hypothetical proposal candidates a good vote needs, so runtime and admission replay cannot
assemble that input differently and falsely reject each other. `ARCH008` forbids its two consumers,
`policy/decision-frame.ts` and `admission/composed-trace.ts`, from importing `analysis/situation.ts`
directly.

Third, the fields above are the target sketch, not the landed type. `SituationAnalysis` in
`analysis/types.ts` extends a `BoardSituation` that carries hammer proximity and rejection runway,
names proven alignments `provenGood`/`provenEvil` with typed `deductions` recording their
provenance, and carries declared leans, vote leverage, fact codes, and forced-play reason
codes. `publicObserver`
and `assassinTargets` never became fields: the public observer and the Assassin Merlin posterior are
separate `analysis/` modules producing their own private snapshots, which is what §5.7 requires of
any role component.

### 5.5 Persistent cognition

```ts
interface CognitionState {
  throughSeq: number
  evidence: readonly Evidence[]
  beliefs: BeliefSnapshot
  commitments: readonly Commitment[]
  languageReads: readonly LanguageEvidence[]
  socialModels: readonly SocialModel[]
  currentPlan?: DecisionPlan
}
```

`CognitionState` replaces the current scratchpad as authoritative memory. A short natural-language
private note may remain for model continuity and post-game entertainment, but no rule, belief, or
commitment exists only in that note.

Commitments record what the agent publicly supported, opposed, claimed, and promised. They allow
the policy to distinguish intentional deception from accidental incoherence.

### 5.6 Decision plan

```ts
interface DecisionPlan {
  request: DecisionRequest
  decision: Decision
  policyId: string
  reasons: readonly ReasonCode[]
  beliefThroughSeq: number
  candidateScores?: readonly CandidateScore[]
  communication?: CommunicationIntent
}
```

The policy commits this plan before the voice layer runs. `CommunicationIntent` can specify the
claim to advance, facts safe to cite, facts to conceal, target players, and tone. The
LLM turns that intent into natural table talk.

### 5.7 Decision components and resolved brains

Role observers, private objectives, score projections, and strategic decision rules are versioned
**decision components**, not optional fields added to central scorer or trace types one role at a
time. A component declares:

- the decision kinds and roles to which it applies;
- its required upstream components and typed inputs;
- the private tagged payload or policy transformation it produces;
- its version, deterministic seed domain, degradation behavior, and admission rules.

The exact interface names are deliberately not fixed here. The durable contract is that a new role
can be implemented by registering a component and, when it has decision authority, its policy layer
without adding a role-named field to the composed-agent host, common candidate score, common scorer
context, trace envelope, stdio transport, artifact manifest, or evaluator.

Configuration and execution have different representations. Configuration names requested
components and modes. At construction time, a typed resolved brain freezes the requested and
eligible component graph, versions, dependencies, layer order, and compatibility projections for
one agent construction. Runtime options supply operational dependencies such as the game seed,
planner and voice implementations, trace sinks, and clocks or clients where permitted; they do not
become a second source of component configuration. The resolved brain remains immutable across its
decisions.

Each `DecisionRequest` and seat-filtered `PlayerView` then determines which components are
applicable and execute for that decision. Traces preserve all three distinctions: configured
entries show construction-time intent; resolved or admitted decision entries show outputs
successfully admitted into typed cognition; separate policy attribution records whether an
admitted output causally transformed candidate scores or selected an action. A mechanically inert
observer or objective therefore receives a resolved decision entry even though it has no policy
use. Component payloads are tagged by component identity, version, kind, and privacy rather than
stored in unrelated role-specific fields. Private cognition remains private even when the
component metadata is included in an artifact manifest.

The north-star structured agent configures one immutable full-role brain for its lifetime. It does
not select a Morgana scorer, then a Mordred scorer, then an Assassin scorer in host code. Instead,
the resolved brain contains the ordered good, shared evil/Oberon, and special-role layers; each
layer's typed applicability contract decides whether it executes for a particular seat and
request. Irrelevant layers and components remain visible as configured intent but have no causal
use. An identity-only composition terminal may retain full-brain trace identity while explicitly
delegating diagnostic semantics to its last active predecessor; that delegation must be derived
from the admitted ordered run, not reconstructed from the acting role. Separate single-role
configurations remain valuable ablations and degradation baselines, not the production
composition mechanism.

Admission belongs to the component boundary. Runtime, stdio, architecture-bank generation, stored
report replay, and artifact validation invoke the same registered reconstruction and validation
rules instead of independently mirroring each component's equations. Admission distinguishes an
exact host-reconstructable result from a structurally valid result whose weighted-world source
cannot be verified from the trace. The latter may remain useful for live execution and diagnostics,
but it is not promotion evidence.

---

## 6. Belief model

### 6.1 Hard feasibility

The world enumerator applies:

- the exact `rolesInPlay` multiset;
- the viewing seat's own role;
- Merlin's visible evil set and possible Mordred omission;
- evil partner knowledge and possible Oberon omission;
- Percival's Merlin/Morgana candidate pair;
- every resolved quest's minimum evil count implied by its Fail count.

The current `roleCertainties` implementation is a useful, well-tested source of constraint rules.
It computes sound per-seat possibility sets and cardinality closure. The target world model should
reuse those rules or their tests, but its authoritative output is a set of **joint assignments**.
Independent possible-role sets cannot express "exactly one of these two seats is evil."

### 6.2 Exact inference first

At ten players, fixing a good viewer leaves at most `C(9, 4) = 126` alignment assignments. Full
special-role assignments are larger but still tractable for the standard casts, and projections
can avoid paying for role distinctions irrelevant to a decision.

Exact normalized enumeration gives:

- coherent player and role marginals;
- the probability that an entire team is clean;
- an evil-count distribution for the team;
- correlations among seats;
- entropy and information gain;
- samples for shallow counterfactual evaluation.

These are more useful to policy than a single maximum-likelihood assignment.

### 6.3 Factor semantics without a factor graph

AvaLLM should adopt the useful modeling idea from GRAIL: separate hard constraints, learned game
evidence, and bounded language evidence. It should not copy GRAIL's initial inference machinery.

The released GRAIL graph uses six dense neural factors. Each player-role factor consumes essentially
the full flattened quest history, and the graph reconciles those overlapping scores with an
exact-two-evil constraint using loopy max-product belief propagation. AvaLLM instead needs:

- five through ten players;
- configurable special roles;
- good and evil policies;
- exact joint team quantities;
- provenance suitable for debugging;
- no required Python or PyTorch runtime.

The `LikelihoodFactor` interface keeps a future graph backend possible. If hidden state later
includes persistent player traits, nested beliefs for every seat, or enough latent variables that
enumeration becomes expensive, `FactorGraphBeliefModel` can replace `ExactWorldBeliefModel` behind
the same contract.

### 6.4 Mechanical likelihoods

Quest outcomes require a model of evil card choice. A succeeded quest containing evil is possible,
so success normally reweights rather than eliminates worlds. The model must account for:

- quest number and score;
- team size and Fails required;
- number of evil players aboard;
- whether those evil players know one another;
- slow-play conventions;
- decisive-board behavior.

Proposal and vote factors must also be contextual. Approving a team on proposal one is not the same
event as approving it near the hammer. Factors should be conservative until measured against
held-out games from the opponent populations AvaLLM actually uses.

### 6.5 Language likelihoods

The LLM language interpreter receives new attributed utterances plus the current public record. It
returns a small schema such as:

```ts
interface LanguageEvidence {
  sourceSeqs: readonly number[]
  subject: Seat
  direction: 'moreEvil' | 'moreGood' | 'unchanged'
  class:
    | 'contradiction'
    | 'unsupportedCertainty'
    | 'coalitionDefense'
    | 'truthTracking'
    | 'roleKnowledgeTell'
    | 'other'
  confidence: 'low' | 'medium' | 'high'
  publicRationale: string
  interpreterVersion: string
}
```

The inference layer maps this finite output to capped likelihood ratios. Caps are weaker early,
stronger only after validation, and lower than hard mechanical evidence. Multiple descriptions of
the same utterance are deduplicated by source sequence so one statement is not counted repeatedly.

---

## 7. Policy architecture

Belief and policy are separate. The posterior describes what may be true; policy chooses what this
role wants to do about it.

### 7.1 Policy order

1. Generate legal candidates.
2. Apply universal forced-play rules that dominate strategic discretion.
3. Compute the shared base candidate features and expected values.
4. Apply configured score-policy layers in explicit order.
5. Remove clearly dominated candidates.
6. Apply any remaining strategic decision layers that are valid for the unresolved choice.
7. Choose among the remaining candidates using the configured policy.
8. Commit a `DecisionPlan`.
9. Generate any public explanation from that plan.

Score and decision layers transform a typed prior surface. The score surface has one schema
version, while the execution journal's exact layer token identifies the producer; rows do not
carry arbitrary producer versions. Each layer declares its inputs, one applicability predicate,
version, and fallback. Its execution may apply a surface or degrade, but it cannot independently
redeclare itself inapplicable. It may narrow or rank the candidates that survived universal forced
policy, but it cannot revive a removed candidate, mutate the committed engine action, or silently
bypass a stronger shared objective. If a layer is missing, inapplicable, malformed, or degraded,
execution continues from the last valid surface and records that resolution. Analysis
requirements are exposed before analysis through an invocation-local one-shot capability. That
capability verifies the exact resolved brain, delegates once to the sole component transition,
binds its exact returned frame, and may execute only against that frame, without a global
provenance map or second hostile-data parse.

Universal rules and strategic rules remain distinct even when both choose an action directly.
Good always playing Success, evil being unable to sink a quest, and decisive match-point play are
universal forced policy. A role or coordination strategy such as an optional nondecisive evil
quest-card convention runs only after those universal rules leave discretion. Ordered layers make
that precedence executable and independently testable rather than dependent on call-site order.

Score families relate as a tree while a registered layer stores one predecessor, so the tree has to
be linearized before it can execute. The two are kept apart explicitly. A family declares its
semantic base, meaning the family its layers truthfully degrade to, together with the reason that
base is correct. Predecessors are then derived per lane. A **composed** lane is one that a single
composition terminal has to traverse on behalf of the whole stack, so within it a family's
predecessor is the previous family in the lane rather than its base; that is sound only because
sibling specializations have mutually exclusive applicability predicates, so an intervening sibling
is inapplicable for the seat that reaches it and passes the prior surface through untouched. An
**isolated** lane has no composition terminal, its families are selected one at a time as
ablations, and each one hangs directly off its own base. A family whose base is declared after it,
or which joins an isolated lane its base skipped, is rejected rather than quietly re-pointed, so
inserting a family cannot silently invert an existing fallback.

### 7.2 Policy modes

- **Structured:** deterministic or stochastic code chooses from candidate values. Useful as a
  strong, cheap baseline and fallback.
- **Hybrid:** code enforces forced plays and supplies a bounded candidate set; the LLM planner may
  choose among strategically viable candidates and set the social intent. This should become the
  production default.
- **Raw LLM:** the LLM receives the view and decides directly. Retained as a research baseline for
  measuring the value of the architecture.

An LLM planner choice is still structured output referencing candidate IDs. It does not regenerate
arbitrary teams or cards in prose.

### 7.3 Role objectives

- **Servant:** maximize quest win probability while preserving enough information to identify safe
  teams.
- **Merlin:** trade off quest influence against public conspicuousness and assassination risk.
- **Percival:** infer the Merlin/Morgana pair while increasing its own value as an Assassin decoy.
- **Evil:** share the mechanical objective of quest failure, cover, and future failure capacity.
  This common objective is a substrate, not a substitute for special-role policy.
- **Morgana:** counterfeit Merlin's public behavior and influence Percival's belief while still
  serving the shared evil mechanical objective.
- **Mordred:** exploit Merlin's uncertainty and observe who treats it anomalously.
- **Oberon:** maintain a posterior over unseen teammates and reason explicitly about coordination
  uncertainty.
- **Assassin:** use a separate Merlin posterior and endgame target value, not a generic "most good"
  score.

These objectives share facts and beliefs but should not be compressed into one universal score.
In particular, a role label or descriptive posture that does not causally affect policy is not an
implemented role objective.

The Assassin posterior begins with the exact joint-world mass whose Merlin coordinate is each
seat. It may then apply a small versioned public-behavior model, but the full relative log-weight
span must remain capped at `ln(2)` before normalization. The first model uses only clean-team
proposal rate and vote agreement, evaluated separately in every possible world by simulating what
that world's Merlin sees: all evil except that world's Mordred. The versioned component contract
defines this as a bounded, hand-authored reweighting of the exact prior, not a calibrated role
probability. Those fixed semantics and deferred-input declarations live here rather than as
repeated strings in every payload. Visible evil
therefore retains zero Merlin prior while a seat that might be Oberon from the Assassin's legal
view is not silently removed. Every completed proposal contributes proposal evidence, rejected
proposals retain their revealed votes, and automatic approvals contribute no nonexistent votes.
Trajectory and deliberate-noise features remain deferred until evaluation justifies them.
Role-claim evidence also remains absent until a typed trusted extractor
exists; raw prose, regular-expression claims, and generic language labels are not valid substitutes.

The first Assassin target policy is deliberately smaller than the posterior model. A private,
registered score layer consumes only the admitted posterior, considers only hard-policy survivors,
and chooses the maximum posterior mass with canonical candidate-ID ties. Engine legality and any
hard selected candidate remain authoritative. Missing or malformed posterior data falls through
the ordinary deterministic evil and compatibility chain, and neither posterior values nor private
reason codes enter communication. There is no seeded assassination variant.

Morgana's public "read as Merlin" feature must keep two different semantics visible. Public Merlin
eligibility is an exact marginal from the public feasible-world model. Proposal and vote
truth-tracking are bounded, deterministic behavior counts and proxies, not likelihoods or role
probabilities, and they must not reweight that public posterior merely by being displayed beside
it. Candidate consistency is computed over Morgana's resolved complete worlds by simulating
Merlin's legal sight in each world: evil except that world's Mordred. This integrates uncertainty
over which partner is Mordred through joint sums and preserves role correlations; multiplying
independent role or alignment marginals is not an acceptable substitute.

Morgana policy is bounded by the shared evil mechanical objective rather than blended into it.
Forced policy filters first, then the maximum D2 role value over the surviving candidates defines
an explicit `0.04` viability band. Counterfeit value may rank candidates only inside that band and
can never revive a candidate removed by forced policy or lying below the D2 floor. Deterministic
mode chooses maximum counterfeit value with canonical ties. Optional seeded variation is confined
to approve versus reject when both votes are in the D2 band and their counterfeit values differ by
at most `0.04`; proposals stay deterministic. Missing, malformed, or inapplicable Morgana evidence
falls back to the matching D2 policy, not directly to compatibility. This preserves shared evil
competence while making the special-role objective genuinely causal and separately attributable.

Mordred policy follows the same bounded-specialization rule without treating its blindness
objective as a probability of action success. Forced policy and the strategic candidate boundary
filter first. The maximum shared D2 evil value over those survivors defines the existing `0.04`
viability band, and Mordred's blindness opportunity may rank only candidates inside it. For a
proposal, action utility is the selected team's bounded opportunity value. For a vote, approve
uses the current team's opportunity and reject uses its complement. These are explicit heuristic
action utilities, not posterior probabilities or independent-marginal products. Deterministic
mode chooses the maximum utility with canonical candidate ties. Optional seeded variation is
confined to approve versus reject when both actions remain inside the D2 band and their Mordred
utility gap is at most `0.04`; proposals remain seed invariant. The seed domain contains only the
game seed, acting seat, decision coordinates, belief event cursor, and scorer version. It contains
no names, roster identities, teammate behavior, or shared coordination convention.

The Mordred layer reads only the admitted private blindness objective. Its public-treatment
dependency arrives through the component graph's transitive closure, so the generic trace can
attribute both inputs without a role-specific field. Missing, malformed, or inapplicable evidence
delegates to the matching deterministic or seeded D2 predecessor. Admitted weighted evidence may
still affect the decision, but its structural rather than exact provenance makes that evaluation
run nonpromotable. Private Mordred reason codes remain mechanical trace evidence and are not
projected into public communication intent. This keeps Merlin-blindness play causal and
inspectable while preserving the shared evil policy, engine legality, and heterogeneous-table
assumptions.

Coordination policy must also be valid for heterogeneous tables containing humans, raw LLMs, and
other agent types. A deployable evil agent cannot assume that teammates share its algorithm,
timing convention, seed, or capability handshake. Independent robust play is therefore the
production direction. An exact-quota convention remains useful as a clearly labeled homogeneous
research ceiling, but it is deliberately not an executable AvaLLM mode. It depends on a shared
pre-game convention that heterogeneous agents and humans cannot be assumed to follow, so its
results are not production or mixed-table promotion evidence.

---

## 8. Voice and model identity

The model remains a visible part of AvaLLM's appeal. Architecture should separate:

- **brain:** belief model, factors, analysis, and policy;
- **model:** the LLM used for interpretation, planning, and speech;
- **persona:** table manner and rhetorical style;
- **strategy pack:** optional role or kind guidance;
- **difficulty:** factor strength, policy quality, search budget, and model tier.

Changing a persona must not erase beliefs. Changing the model should not silently change forced
plays. Two agents can share a brain but feel different because their planners and voices differ.
Conversely, two agents can share a model while playing at different strategic levels.

Prompt construction becomes a renderer over typed cognition:

```text
rules and role
+ selected private knowledge
+ belief and situation summary
+ current commitments and plan
+ recent attributed table talk
+ communication task and output contract
```

The prompt is no longer the authoritative database of strategy or memory.

---

## 9. Agent boundary and telemetry

Phase 3 introduced a compatibility boundary where legacy agents could still return a bare engine
`Decision` while composed agents returned `AgentDecision`, and runners normalized that transitional
`AgentOutput` union. The union is now collapsed: every agent returns the envelope, and the external
stdio wire is the only place a bare decision is still accepted. The boundary is envelope-only, which
allows agent-owned trace data without adding cognition concepts to the pure engine:

```ts
interface AgentDecision {
  decision: Decision
  trace?: DecisionTrace
}

interface AvalonAgent {
  decide(req: DecisionRequest, view: PlayerView): Promise<AgentDecision>
  /** One post-legality trace-lifecycle hook, reached only through the host helper. */
  finalizeAppliedTrace?(outcome: AppliedDecisionOutcome): DecisionTrace | undefined
  /** Private sink of last resort, used only when the host provides none. */
  privateTraceSink?(trace: DecisionTrace): void
  dispose?(): void
}
```

The runner unwraps `decision` for `applyDecision` and records an envelope trace only after the
engine accepts that action. `DecisionTrace` can contain component versions, posterior summaries,
candidate scores, degradation state, and token cost. It must never enter another live player's
view.

That ordering is owned by `recordAppliedDecision()` in `server/agents/applied-trace.ts`, the one
call each host makes once an action is legal. The helper detaches its own request, view, and applied
action, invokes the agent's single hook, checks the returned trace still joins to what the engine
accepted, degrades the record rather than trusting a mismatch, and persists. Hosts hold no part of
the lifecycle, and a finalized trace is free to differ from the provisional one: the applied action
can be a coerced or fallback decision the agent never selected.

Agents with no telemetry of their own return `{ decision }` and implement no hook. External stdio
agents keep sending a bare `{ decision }` on the wire, which `parseStdioDecisionReply` translates
into the envelope at the process boundary; the trace field there remains an optional protocol
extension, admitted only after validation.

The composed-agent host resolves one typed brain before a decision. That resolved brain owns
component selection, versions, dependency order, score and decision layers, and configured versus
resolved attribution. Operational injection remains separate: a planner, voice adapter, fake
client, seed source, or trace sink can be replaced for testing without changing which brain was
configured.

Transport and evaluation are consumers of component metadata, not parallel policy
implementations. Stdio may carry registered tagged payloads, and artifacts may retain compatibility
projections while older readers are supported, but reconstruction, equation checks, privacy
classification, and promotion eligibility come from the shared component admission owner. New
manifests and reports are derived from resolved component entries rather than extended with another
role-specific array for each feature.

---

## 10. Failure and degradation

The game must still never stall.

1. If language interpretation fails, retain the previous structured state and process mechanical
   evidence.
2. If a soft factor fails, omit that factor and mark the snapshot degraded.
3. If weighted inference fails, fall back to a uniform distribution over feasible worlds.
4. If world enumeration fails, fall back to the existing tested heuristic agent.
5. If planning or voice fails, use the structured policy's committed decision and a silent or
   canned utterance.
6. If the final decision is illegal, the runner retains the existing heuristic fallback.

Each step is surfaced in trace data. A belief failure and a malformed-output failure are different
degradation classes.

---

## 11. Module ownership

Unlike the rest of this document, this section describes the tree that exists rather than one to
aim at. Check it against `git ls-files 'server/agents/**'`; the line counts below are tracked
TypeScript lines at the time of writing and will drift, but the owners and their boundaries should
not drift silently.

```text
server/agents/                        # about 41.9k lines in ten owners
  *.ts                                #  6.4k  agent boundary and the raw-LLM baseline
    types.ts registry.ts defs.ts packs.ts board.ts experimental.ts
    heuristic.ts random.ts llm.ts stdio.ts composed.ts brain.ts
    prompts.ts facts.ts parse.ts trace.ts
  cognition/                          #  1.9k  observation to typed private memory
    evidence.ts state.ts commitments.ts coherence.ts plan-memory.ts types.ts
  belief/                             #  2.6k  hidden worlds and the posterior
    worlds.ts constraints.ts quest-constraints.ts exact.ts
    projection.ts weighting.ts identity.ts
    quest-card-factor.ts language-factor.ts types.ts
  analysis/                           #  9.0k  decision-ready reads, including role semantics
    situation.ts situation-plan.ts scorer-situation-surface.ts types.ts
    observer.ts
    role-objectives.ts role-objective-router.ts role-utility.ts
    evil-objectives.ts evil-role-utility.ts
    morgana-counterfeit.ts morgana-role-utility.ts
    mordred-blindness.ts assassin-merlin-posterior.ts
    actor-target-treatment.ts
    (seven of the above carry a sibling *-types.ts)
  policy/                             #  7.6k  action authority and the generic layer kernels
    candidates.ts forced.ts plan.ts types.ts
    decision-frame.ts                 #   the staged spine every decision walks
    score.ts score-compatibility.ts compatibility-score.ts custom-scoring.ts
    component-runtime.ts trusted-data.ts deterministic-policy.ts
    evil-quest-card.ts *-score-contract.ts
    score-layer/                      #  1.8k  generic score-layer kernel
    decision-layer/                   #  1.3k  generic strategic decision-layer kernel
  score-layers/                       #  1.9k  concrete score families
    good.ts evil.ts mordred.ts morgana.ts assassin.ts full-role.ts configured.ts
  decision-layers/                    #  0.1k  concrete strategic layers
    robust-evil-quest-card.ts configured.ts
  components/                         #  5.6k  the generic decision-component substrate
    kernel.ts resolved-brain.ts registry.ts production-registry.ts
    native-score-components.ts native-role-components.ts
    robust-evil-quest-card.ts
    canonical-json.ts architecture-metadata.ts types.ts
  admission/                          #  5.1k  trace canonicalization and host admission
    composed-trace.ts legacy-role-trace-v1.ts
    component-host-inputs.ts trace-primitives.ts
  communication/                      #  1.8k  language in and voice out
    language-contract.ts language-orchestration.ts language-types.ts
    planner-voice-adapter.ts composed-renderer.ts belief-summary.ts
    public-record.ts compat-certainties.ts
```

Four owners postdate the original map and had no place in it. `components/` holds the generic
decision-component substrate from §5.7: the kernel, the resolved brain, the registries, and the
canonical JSON and architecture-identity surfaces. `admission/` owns hostile-trace canonicalization
and host admission, which §9 names as the shared component admission owner but the map never gave a
home. `score-layers/` and `decision-layers/` hold the concrete families that the generic
`policy/score-layer/` and `policy/decision-layer/` kernels execute; splitting concrete from generic
is what lets the kernels stay role-free.

Three entries in the earlier map never landed as written. `belief/factors/` stayed flat, because
only two soft factors exist: `quest-card-factor.ts` and `language-factor.ts`. Proposal and vote
likelihoods were never parameterized, so there is nothing for a subdirectory to hold (§13).
`policy/structured.ts` and `policy/hybrid.ts` never became files; that work is split across
`decision-frame.ts`, `score.ts`, and the two layer kernels. The `agents/` subdirectory never
existed either, and the agents themselves sit flat at the top level as `llm.ts`, `heuristic.ts`,
`random.ts`, `stdio.ts`, and `composed.ts`.

### 11.1 `analysis/` owns role semantics

The earlier map put role objectives under `policy/objectives/`. That is withdrawn. `analysis/`
legitimately owns role semantics, and it is the largest subsystem because of it.

The split between the two owners is **authority, not subject matter**. `analysis/` produces
read-only typed projections; `policy/` and its two concrete layer directories hold the only code
that can apply one. The role modules read `PolicyCandidate` shapes and rank or annotate them into
private tagged payloads, and a score or decision layer then consumes, ignores, or is configured
without each one. `role-objective-router.ts` says so in one line: pure routing that never enables
policy.

Naming a preference and holding authority are different things, and one module shows the gap.
`analysis/morgana-role-utility.ts` does put `selectedCandidateId` and `selectedDecision` on its
private projection, so an analysis payload can carry a fully formed `Decision`. It still commits
nothing. `score-layers/morgana.ts` checks that id against the legal candidate set and against the
forced boundary and declines the projection outright when either rejects it, and the commit itself
happens later in `policy/decision-frame.ts`. A role objective that could apply its own action would
violate the first boundary rule below wherever it lived, so moving the directory would not buy that
guarantee.

The placement is also already depended on by the fitness checks. `tools/architecture-fitness.mjs`
`ARCH005` forbids generic score-layer code from importing anything under `server/agents/analysis/`
except `analysis/types.ts`, and separately rejects role-named identifiers in that code; `ARCH011`
applies the same rule to the generic decision layer. Those rules key on the `analysis/` prefix.
Moving objectives into `policy/objectives/` would place role semantics inside the prefix the rules
protect and cost the repo its cheapest structural guard against a role-shaped generic kernel.

Role specialization already has a policy home, so nothing is homeless: `score-layers/` and
`decision-layers/` hold the concrete families that carry authority, and `analysis/` holds the reads
they consume.

The cost of this call is that `analysis/` keeps growing with each new role. The rule that keeps it
honest: a module belongs in `analysis/` only while every layer remains free to decline it. As soon
as a role read decides the action, that deciding code belongs in `score-layers/` or
`decision-layers/`, whatever it reads.

### 11.2 Boundaries

These are the durable rules:

- evidence does not choose actions;
- belief does not render prompts;
- policy does not read raw `Game`;
- voice does not change committed actions;
- evaluation observes traces but runtime cognition never reads evaluation truth.

`tools/architecture-fitness.mjs` is a static import and identifier graph, so it enforces the rules
that reduce to a forbidden dependency. `ARCH002` covers "policy does not read raw `Game`" directly,
refusing any agent import of `server/engine/game`, `server/engine/view`, or the raw `Game` type.
`ARCH001` and `ARCH002` together keep engine, agent, and evaluation code from depending on each
other in the wrong direction, which is the import half of the evaluation-isolation rule.

The rest are behavioral, and their coverage is uneven in a way worth knowing before trusting the
list. "Voice does not change committed actions" is pinned by `test/prompt-coherence.test.ts` and
`test/plan-coherence.test.ts`. The hidden-information boundary these rules exist to protect
is pinned by `test/leaks.test.ts` and `test/knowledge.test.ts`. "Evidence does not choose actions"
and "belief does not render prompts" have no mechanical check today and rest on the directory
layering above, so a green suite is not evidence that either still holds.

---

## 12. Evaluation contract

Every meaningful architecture stage must be independently ablatable:

- current prompt-guided LLM;
- hard constraints only;
- exact hypotheses plus structured policy;
- mechanical likelihood factors;
- bounded language factors;
- hybrid LLM planner;
- observer and role-specific models;
- shallow search.

Required metrics are defined in
[research-probabilistic-agents.md §7](research-probabilistic-agents.md#7-evaluation-requirements).
In addition, architecture tests should cover:

- permutation invariance;
- identical replay from the same view and versions;
- no impossible world receiving weight;
- no language evidence restoring an impossible world;
- no private evidence entering the public-observer model;
- no own-action self-confirmation in the private posterior;
- proposal explanation matching the committed team;
- legal fallback at every degradation layer.

Win rate decides whether an agent is useful, but calibration and behavioral metrics explain why.

---

## 13. Deferred decisions and their outcomes

These choices do not change the component boundaries above. Landed work has since settled four of
the original six; they are recorded here with their outcome rather than deleted, so a later reader
can see what was chosen and why.

### 13.1 Still open

- **The first parameterization of proposal and vote likelihoods.** `belief/` still has exactly two
  soft factors, `quest-card-factor.ts` and `language-factor.ts`. Nothing scores a proposal or a vote
  as evidence about the proposer or voter. Phase 5C's vote work diagnosed the vote *policy* channel
  and does not close this.
- **When exact enumeration becomes expensive enough to justify variable elimination, sampling, or a
  factor graph.** Still open, and the pressure points are known: the legal maximum-special 10-player
  cast has 151,200 complete worlds for the public observer, and the 10-player `phase4-good-v1` vote
  reaches 58,080 uniform worlds in identity projection. Both are currently handled by exact
  streaming plus compensated summation rather than by approximation, so the question is deferred on
  evidence rather than by neglect.

### 13.2 Decided by landed work

- **Full role worlds are the stored representation; alignment is a projection.** `HiddenWorld`
  stores `roleBySeat` with the seat-ordered role string as its identity, keeps `alignmentBySeat`
  alongside it, and duplicate Servant and Minion cards are multiset counts without identity.
  Alignment and role marginals stay projections rather than a second stored representation: a
  uniform posterior takes them from the shared kernel in `belief/projection.ts`, and a weighted one
  from the weight-summing projections in `belief/exact.ts`. Settled in Phase 1.
- **The hybrid planner chooses one candidate, from a bounded non-dominated set.** Planner output
  names one supplied candidate ID; overriding the top numerical candidate requires a named permitted
  strategic reason; deterministic structured choice remains both an ablation and the fallback, and
  planner or voice failure retains the committed structured action. Settled in Phase 4C.
- **Observer modeling runs online, at every decision of a configured seat, and is not gated to
  Merlin and evil decision points.** `composed.ts` builds the snapshot once per decision on first
  use, whenever the observer is configured or a role objective or Morgana counterfeit read needs it.
  It stays policy-inert: nothing prices what a seat's own record reveals, which is exactly the gap
  NB-012 owns. Settled in Phase 7A.
- **Cognition traces live in the main game artifact, not a sidecar.** They are the optional
  `decisionTraces` field on the full-reveal artifact, which keeps atomic association with the
  replayable event log and avoids a second retention lifecycle. Traces are never stored in `Game`,
  emitted as events, added to `PlayerView`, sent to a client, or read while producing cognition.
  Settled in Phase 2.
