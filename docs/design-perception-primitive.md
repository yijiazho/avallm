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

1. **Extract the pure core** `perception-asymmetry.ts` + focused unit tests
   (private mass, public baseline, asymmetry index) against hand-built worlds.
2. **Pilot: mordred-blindness** — refactor `buildPrivateMordredBlindnessObjective`
   internals to call the core; output unchanged; run `node --test
   test/mordred-*.test.ts` to confirm byte-identity.
3. **assassin-posterior** onto the core; retire its bespoke behavioral proxy in
   favor of `actor-target-treatment` (this one *may* need a version bump if the
   overlay numbers change — measure with `server/eval/*` first).
4. **morgana-counterfeit** onto the core; same overlay retirement.
5. **New: `quest-coparticipation` channel** + a thin servant/minion consumer
   (evil exposure read; good leverage read). This is now a small module, not a
   fourth 700-line one.
6. **Optional later**: unify the three payloads behind one version (larger,
   requires version bumps + validator/test rewrites). Only if step 5 shows the
   shared payload is genuinely cleaner than three byte-frozen ones.

Gate steps 3–5 on the eval benches the repo already trusts (Brier/log-loss on
held-out casts) before granting any scoring authority — matching how the
quest-card factor is pinned.

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
