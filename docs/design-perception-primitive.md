# Perception primitive: one-layer opponent modeling, consolidated

Status: design (not yet implemented). Owner branch: `claude/optimistic-cartwright-d6495b`.

## Why this exists

Three analysis modules independently grew the *same shape*: one seat models a
specific opponent's private certainty/visibility about it, then reads off what
that asymmetry lets one side exploit.

- `analysis/mordred-blindness.ts` — Mordred is invisible to Merlin. Over each
  Merlin-hypothesis seat, where is the blind window (visible-evil below the fail
  threshold) that a hidden Mordred can exploit?
- `analysis/assassin-merlin-posterior.ts` — the assassin's per-target prior that
  a good seat is Merlin, sharpened by public behavior.
- `analysis/morgana-counterfeit.ts` — Morgana modeling Percival reading her as
  maybe-Merlin, and where that counterfeit read is exploitable.

A fourth instance was about to be added by hand: **a minion that fails a quest
alongside a loyal servant is now privately pinned by that servant** (on a team
of size `T` with `F` fails, any good member knows `F` of the other `T-1` are
evil; a full pin when `T-1 == F`). Its good-side mirror: a servant who can pin an
evil teammate holds a certainty the table does not.

Per the repo's own class-of-bug rule, four instances of one shape is a signal to
build the shape once, not a fourth time. This doc is that consolidation.

## The shared shape

Every module computes, per *subject* (a seat hypothesis or a target seat):

1. **Private mass** — a complete-world sum over the acting seat's belief worlds,
   subject to a *channel predicate* (see below). This is the certainty side.
2. **Public baseline** — the feasible-joint mass for the same event from
   `observePublicRecord`. This is the ambiguity side.
3. **Behavioral overlay** — a bounded, deterministic, *non-probability* index
   from the shared `actor-target-treatment` matrix, held strictly beside the
   posterior (never multiplied into it). Assassin/morgana currently use bespoke
   overlays; those fold into this substrate.

...and, per candidate/team, a joint pair `{ privateCountDistribution,
publicCountDistribution }` combined into a bounded role-specific exploit value.

The **channel predicate** and the **exploit value** are the only genuinely
role-specific pieces:

| Module | Channel | Exploit value |
| --- | --- | --- |
| mordred-blindness | role-vision (evil cannot see Mordred) | hidden-threshold-crossing in the Merlin blind window |
| assassin-posterior | role-vision (Merlin sees evil), run backwards | max posterior target |
| morgana-counterfeit | role-pair (Percival's Merlin/Morgana ambiguity) | counterfeit consistency vs public ambiguity |
| **servant/minion (new)** | **quest-coparticipation (failed team residual)** | evil: exposure to a pinning seat; good: leverage of a private pin |

## Proposed primitive

```
// analysis/perception-asymmetry.ts  (pure, role-agnostic, exact)
interface PerceptionSubjectRow {
  subject: Seat
  privateMass: number                    // complete-world sum, channel-predicated
  publicBaseline: number                 // observer feasible-joint, same event
  asymmetryIndex: number                 // bounded gap, private vs public
  behavioralOverlayIndex: number | null  // from actor-target-treatment
}
```

A channel is a `(world, subject) -> boolean` predicate plus the matching public
event. The primitive owns: the complete-world sum, the public-joint baseline,
the strict "counts-as-worlds / bounded-index-not-probability" discipline, and
the validators (`exactKeys`, semantics tags, payload byte bounds). Each role
module shrinks to: pick its channel, map its hypotheses/targets/candidates
through the primitive, and apply its exploit value function.

## Migration sequence (behavior-preserving first)

The role modules end in host-join validators that assert
`isDeepStrictEqual(value, buildX(input))`. So the safe path keeps every payload
**byte-identical** while sharing only the computation — no version bumps, all
pinned tests stay green.

1. **Extract the pure core** `perception-asymmetry.ts` + focused unit tests.
   **DONE.** `accumulateSubjectMass` (naive fold + overlay) and
   `partitionBySubject` (buckets + compensated `stableProbabilitySum` mass).
2. **Pilot: mordred-blindness.** **DONE, byte-identical.** `merlinHypotheses`
   builds through `accumulateSubjectMass`; host-join + `mordred-native` pin it.
3. **assassin-posterior.** **DONE (mass), overlay fold REJECTED by eval.** The
   per-Merlin-candidate prior routes through `partitionBySubject` (compensated,
   byte-identical). The overlay could *not* fold onto `actor-target-treatment`:
   on a 1,200-prediction held-out set the matrix-sourced steelman regressed to
   0.28 hit-rate vs the bespoke overlay's 0.33 (prior-only floor 0.19), because
   the bespoke overlay's hypothesis-conditioned vote signal ("Merlin approves
   iff clean") has no counterpart in the raw `voteApproval` matrix. The bespoke
   overlay stays. Lesson: the summation discipline consolidates; the overlay is
   genuinely role-specific and does not.
4. **morgana-counterfeit** onto the core — next. Expect the same split: mass/
   partition consolidates byte-identically; its counterfeit overlay likely stays
   bespoke (measure before folding).
5. **New: `quest-coparticipation` channel** + a thin servant/minion consumer
   (evil exposure read; good leverage read). A small module, not a fourth big one.
6. **Optional later**: unify the payloads behind one version. Only if it proves
   genuinely cleaner than the byte-frozen ones.

Gate every overlay change on the eval benches the repo trusts (Brier/log-loss on
held-out casts) before granting scoring authority — as step 3 did, and matching
how the quest-card factor is pinned. The step-3 harness is now formalized as
`server/eval/assassin-calibration.ts`.

## Measured: the servant weight pair carries no information about cleanliness

The servant is the first role whose objective was written as a weight pair over
the shared public read rather than as its own model, and the only one whose
objective is a function of the public record alone (no belief, no host input,
no dependency). That made it the cheapest possible test of the wider claim that
every role is a signed weight pair over one measurement. It was granted propose
scoring authority and then gated by `server/eval/servant-propose-bench.ts`: 60
servant-target cases of the frozen phase-4 bank, two arms differing by exactly
one layer and one component, both free populations, plus compatibility as a
reference.

### What the run supports

**The layer behaves as designed.** Of the target proposals reachable from an
identical prefix, the pick changed 26.8% (19/71) against heuristic opponents and
26.0% (20/77) against random ones, and the changes land where the read has
signal: **0 of 12 and 0 of 22 at round one**, rising through q3-q5. The measured
round profile of the projection (0% separation at r1, 100% at r4-r5) reproduces
end to end.

**No large effect exists.** Win rate moved +0.0% (heuristic, 7/60 in both arms)
and -1.7% (random). Whatever this layer does, it is not worth ten points.

### Why the bench cannot say more than that

**The effective sample is ~20, not 60.** Only 19/60 and 20/60 games diverged
from the baseline at all; the rest are byte-identical. Each diverged game
carried about one changed proposal. So the experiment is really "about twenty
single-proposal changes per population, does the win rate move," and the answer
at that sample size could only ever be "cannot tell." Reporting "60 matched
cases" overstates it by a factor of three.

**Floor effect.** The target servant wins 11.7% against heuristic opponents, and
44 of 60 games end in `threeFails` before anyone reaches the assassination
phase. A single seat's proposal tie-break has almost no leverage on a
distribution that lopsided.

**One refined seat in an unrefined table.** `runArchitectureBench` gives the
variant agent to the target seat only; every other seat is the free population.
On 8-to-10-player tables that is one refined servant among three or four, so the
bench measures a lone refined seat rather than the policy as deployed, which
runs at every servant seat through `fullRolePolicyScorer`.

**The decoy half is close to untestable here.** Half the servant objective is to
look Merlin-like so the assassin spends its shot wrongly, which can only pay off
through `assassinMissed`, and only 16 of 60 heuristic games reach assassination
at all. The bank also runs with discussion disabled, removing the main channel
through which a table forms the perception this half is trying to manipulate.
Assassination outcomes were unchanged (`merlinAssassinated` 9 to 9, missed 7 to
7) on a sample that could not have shown a change.

### A claim to retract

An earlier draft of this section said the mechanism was established: that
`evilReadIndex` is anti-correlated with actual cleanliness where it
discriminates, on the strength of "every cleanliness-moving change went the
wrong way, 2 to 0," plus per-round clean rates falling at q3 and q4.

**Those are differences of two to four proposals.** 2-to-0 is a coin landing
heads twice; q4's "13.6% to 4.5%" is 3 of 22 becoming 1 of 22. The direction is
consistent across cells, which is worth remembering, but it is a hypothesis, not
a measurement. Likewise the one interval that excluded zero (`dirty-approve`
+1.7% against random) is one of roughly a dozen intervals reported across two
populations, which is where one such interval is expected by chance. The register
already warns about exactly this reading, and this section was doing it.

### Measured properly: the reshuffle is a coin flip

`server/eval/servant-propose-calibration.ts` asks the question the policy
actually answers. Every servant proposal in every game is one held-out case: the
seat's view, and the true evil seats from the deal it cannot see. Both policies
are scored on the **same** cases, so the comparison is paired per decision
rather than per game, and the two arms cannot drift into different games.

1,552 held-out servant proposals, 600 seeded games across four casts:

| | base | candidate |
| --- | --- | --- |
| dirty teams (seated any evil) | 80.0% | 80.3% |
| evil seats per team | 1.118 | 1.112 |

The refinement changed **569 of 1,552 picks (36.7%)** — every one of them inside
the 1,066 cases where the public read discriminates, and none in the 486 flat
ones, exactly as designed. Of the picks where cleanliness changed:

- base clean, candidate dirty: **58**
- candidate clean, base dirty: **52**
- exact two-sided sign test: **p = 0.63**

That is a coin flip, on enough discordant pairs to have seen a real effect: a
60/40 split would have landed near p = 0.06. So the standing half of the servant
weight pair reshuffles more than a third of proposals and the reshuffle carries
**no information about whether the team is actually clean**.

This is a genuine negative, and it is the one the earlier draft claimed on four
proposals. The direction it guessed (that the refinement makes teams dirtier)
is not supported either: 58 against 52 is noise in both directions.

What remains unmeasured is the decoy half. Looking Merlin-like pays off only
when an assassin spends its shot wrongly, which is a game outcome and not a
property of a proposal, so no per-decision harness can see it. A policy could
lose here and still be worth having if it buys the shot. Nothing in either run
suggests it does, but nothing tests it.

### The instrument was the wrong shape

The question is per-decision: given this proposal, does the refinement pick a
better team? The bench answers it through game outcomes, which costs three
orders of magnitude of sample and adds every source of variance in the game
between the decision and the result.

The right pattern is already in the repo. `assassin-calibration.ts` scores a
1,200-prediction held-out set directly, and that is what made step 3's verdict
binding. A servant equivalent would sweep many seeded games, and for **every**
servant propose decision record whether the base pick and the refined pick each
seated evil, giving a paired binary comparison with n in the thousands from the
same play. `servant-propose-bench.ts` should keep its job (it caught the
component-closure defect below, and it bounds the size of any outcome effect),
but it should not be the gate.

### Two defects the run did establish

- The score family was first declared last among the specializations, which made
  its terminal inherit the whole evil subtree's component closure: the candidate
  arm configured **eleven** components (assassin, Mordred, Morgana machinery,
  none of which can apply to a good seat) against the baseline's two, and the
  A/B silently stopped being an A/B. A family inherits the closure of every
  layer before it in the composed lane, so a specialization belongs next to its
  base. `test/servant-propose-bench.test.ts` now pins the one-component
  difference.
- `proposal-value-diagnosis.ts` cannot read a surface from any layer that
  narrows viability to a single row: its value-structure and posterior columns
  key on the good proposal features and go blank. The matched-pair section still
  works.

### What still stands, and the open question

Two roles have now been tested against the shared-measurement claim, and both
split the same way. Summation discipline and the measurement itself consolidate.
The *preference* does not: the assassin overlay beat a shared-matrix steelman by
5 hit-rate points on 1,200 held-out predictions, and the servant weight pair
carries no information about cleanliness across 1,552. Both verdicts now rest on
per-decision harnesses with n in the thousands, which is the only reason either
is worth quoting.

Two negatives in the same direction, on the same kind of evidence, is a pattern:
the shared read is a good *measurement* and a poor *objective*. Worth noting
precisely what that does and does not say. It does not say `evilReadIndex` is
wrong; it says a signed weight over it does not beat an exact joint posterior at
choosing teams, which is unsurprising once stated, because the posterior already
uses every hard constraint the public record implies and the read adds only a
proxy on top. Where a weight pair might still earn its place is exactly where
the posterior has nothing to say and the payoff is not team cleanliness at all:
the decoy channel, which neither harness can currently see.

The larger finding from this run is not about the weight pair. Compatibility
beats the composed good policy at a servant seat by **+15.0% win (95% +5.0 to
+25.0)** against heuristic opponents on these games, which is a big effect on
the same thin sample everything else here was too thin to show. The refinement
was polishing tie-breaks on a policy fifteen points behind the checked-in
behavior at the seat it refines. NB-010 localized that gap to the vote channel;
this restates it on the propose side of the same bank. Closing it is worth more
than any weight pair.

## Experiment: does surfacing the perception read help? (hybrid vs pure-LLM)

Goal: show the value of a one-layer opponent-model by comparing a table that is
*told* "seat X can privately pin you" against one that must infer it from raw
prose reasoning.

### Wiring gap (do this first)

The sim seats only `composed` (pure-mechanical) and `llm` (raw-LLM). The hybrid
— an LLM `planner`/`voice` riding on the composed belief/analysis substrate,
with the perception read rendered into its prompt context — is a *capability*
(`createComposedAgent` accepts `planner`/`voice`; `communication/planner-voice-
adapter.ts` exists) but is **not seated** by `registry.ts` or the sim CLI.

To run the experiment, add a hybrid seating:
- an `AgentSpec` variant (e.g. `composed` + an LLM planner/voice), or a
  `--agents hybrid` sim flag that builds `createComposedAgent({ ...full-role,
  planner: llmPlanner, voice: llmVoice })`.
- render the perception read into `composed-renderer.ts`'s policy context so the
  LLM planner actually sees it.

### Scenario harness

The standoff is luck-of-the-deal, so force it rather than wait for it:
- Seed a game and script the opening so a size-2 team of {one minion, one
  servant} runs quest 1 and the minion fails it (a fixture like the
  `components/` gallery fixtures, or a scripted `sim` seed with a forced deal).
- Decision under test: the minion's next proposal/vote/table-talk, and the
  servant's — the classic 1-fail-on-a-2-team standoff.

### Arms and metric

- **A. pure-LLM** (`--agents llm`): no perception read; infers the standoff
  unaided.
- **B. hybrid, read hidden**: composed substrate, LLM planner/voice, perception
  read computed but *not* rendered (ablation control).
- **C. hybrid, read shown**: same, with "seat X can pin you / you can pin seat Y"
  in context.

Metric: evil win-rate and a behavioral proxy — does the exposed minion stop
courting the pinning servant's approval and pivot to the uncommitted audience
(read off `actor-target-treatment` toward the servant vs others). C > B isolates
the *rendered read's* marginal value; B vs A isolates the substrate's value.

### Runnable proxy today (no wiring)

Until the hybrid is seated, two cheaper analogs exist:
- raw-LLM belief-visibility A/B: `compat-certainties-v1` vs the full belief
  renderer already varies how much structured belief the LLM sees.
- mechanical-only: evaluate the composed stack with/without the new
  perception channel via `server/eval/*` (API-free), measuring standoff
  decision quality directly on fixtures.

### Commands (once hybrid is seated)

```bash
# forced-standoff fixture, three arms, readable transcripts
npm run sim -- --agents llm      --players 5 --seed <S> --talk 2,1 --transcripts runs/pure/
npm run sim -- --agents hybrid   --players 5 --seed <S> --talk 2,1 --transcripts runs/hybrid-hidden/   # read off
npm run sim -- --agents hybrid   --players 5 --seed <S> --talk 2,1 --transcripts runs/hybrid-shown/    # read on
# aggregate win-rate once the arm plumbing is confirmed
npm run sim -- --agents hybrid   --games 200 --talk 0,0
```
