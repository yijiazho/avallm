// More than one mechanical factor at a time.
//
// A factor in this folder IS a whole `BeliefModel`, not a term inside one:
// `beliefModelFor` returns exactly one, and it replaces the entire posterior
// computation. That is why `belief/factor-manifest.ts` can say at most one
// mechanical factor runs, and why "seat the vote factor alongside quest-card"
// has never been a configuration change. It needed this file.
//
// Named `combined-model.ts` rather than `combined-factor.ts` on purpose. The
// manifest's suite derives the factor set from `belief/*-factor.ts` on disk, so
// a composer that matched that glob would be demanded an entry it cannot have:
// it is not a factor, it has no parameters of its own, and it prices nothing.
//
// WHY EACH COMPONENT KEEPS ITS OWN CAP.
//
// The obvious alternative is to sum the raw log-likelihoods and clamp once at
// some combined ceiling. That is measurably useless here. Both mechanical
// factors already clamp roughly 83% of worlds on a seven-player board, because
// a bounded factor spends its range on the worlds nearest the best one by
// design, so a shared ceiling would be consumed by whichever component ran
// first and the second would contribute almost nothing. Adding a factor would
// then be indistinguishable from not adding it, which is the one outcome that
// makes this file pointless.
//
// So each component is capped against its own best world, under its own
// declared cap and for its own stated reason (quest-card `ln(2)`, vote-matrix
// `ln(1.5)`), and the capped vectors are summed. The consequence is explicit
// and worth stating rather than discovering: the combined contribution is
// bounded by the SUM of the component caps. That is a deliberate widening, and
// it is defensible for the reason the components are separate in the first
// place, which is that they read disjoint evidence. Quest cards and ballots are
// different observations, and two independent observations should be able to
// say more together than either says alone.
//
// It does not weaken the invariant that matters. Hard feasibility removes
// worlds outright, so no finite sum of soft evidence can revive one, and
// `feasibleWorlds` still runs first and alone decides what exists.
//
// THAT RATIONALE IS WRONG, AND THE MEASUREMENT SAYS SO.
//
// "They read disjoint evidence" is true of the OBSERVATIONS and false of the
// INFERENCE, which is the distinction that matters and the one the argument
// above misses. A failed quest is quest-card evidence, and it is simultaneously
// what makes the ballots that approved that team meaningful. Both components
// are reading the same hidden state through correlated channels, so summing
// their contributions double-counts one inference rather than adding two.
//
// Measured on identical corpora, dirty-team rate against a constraints-only
// base, servant proposals:
//
//                        heuristic (n=2039)   composed (n=1713)
//   base                       81.1%               78.4%
//   quest-card (seated)        71.0%               73.6%
//   vote-matrix good v2        52.1%               59.8%
//   quest + vote good v2       61.5%               65.8%
//
// The combination lands between its components on BOTH populations. Adding the
// seated factor to v2 gives back 9.4 points on one and 6.8 on the other, and
// the ordering v2 > combined > quest-card is stable across two independent
// opponent tables. The cap arithmetic makes it worse rather than causing it:
// quest-card carries the wider `ln(2)` budget while contributing the weaker
// signal, so in the sum the less informative component pulls harder.
//
// So this file is not the route to seating v2, and the honest reading of
// BELIEF-003 changed because of it: the candidate is REPLACING quest-card, not
// joining it. Kept anyway, for three reasons. It is the evidence for that
// conclusion and deleting it invites the next reader to rebuild it to ask the
// same question. It remains the only model here capable of partial degradation.
// And a future pair of genuinely independent factors, which these two are not,
// would want exactly this mechanism.
//
// PARTIAL DEGRADATION IS THE OTHER THING THIS BUYS.
//
// A single-factor model can only degrade to the uniform posterior: if its one
// factor throws, everything mechanical is lost. Here a failing component is
// dropped and the rest still weight the posterior, which is what
// `docs/probabilistic-agent-architecture.md` §10 step 2 actually asks for
// ("omit that factor and mark the snapshot degraded") and what no model in this
// folder has been able to do until now.

import {
  beliefFromWeightedWorlds,
  exactBelief,
  feasibleWorlds,
} from './exact.ts'
import {
  buildFactorProvenance,
  type BeliefModel,
  type BeliefSnapshot,
  type EvidenceContribution,
  type HiddenWorld,
} from './types.ts'
import { capLogLikelihood } from '../canonical/probability-arithmetic.ts'
import { normalizeLogWeights } from './log-weights.ts'
import type { PlayerView, Seat } from '../../engine/types.ts'
import {
  analyticalQuestCardFactor,
  questCardEvidence,
  QUEST_CARD_FACTOR_DEGRADATION,
  QUEST_CARD_FACTOR_VERSION,
  QUEST_FACTOR_BUNDLE_VERSION,
  QUEST_FACTOR_LOG_LIKELIHOOD_CAP,
  type QuestCardEvidence,
} from './quest-card-factor.ts'
import {
  analyticalVoteMatrixFactorV2,
  voteMatrixEvidence,
  VOTE_MATRIX_BUNDLE_V2_VERSION,
  VOTE_MATRIX_FACTOR_DEGRADATION,
  VOTE_MATRIX_FACTOR_V2_VERSION,
  VOTE_MATRIX_LOG_LIKELIHOOD_CAP,
  type VoteMatrixEvidence,
} from './vote-matrix-factor.ts'

/**
 * One mechanical factor, reduced to what composition needs: how to read its
 * evidence from a seat view, how to price a world against one piece of it, and
 * how far it may move a world on its own.
 *
 * Deliberately structural rather than an interface the factors implement. The
 * factors' own evidence builders differ in shape (one takes a viewer seat, one
 * does not) and making them uniform would mean editing three settled files to
 * add a fourth; this adapts them instead.
 */
/**
 * Every factor's evidence carries a stable id, and composition depends on it:
 * provenance is what admission joins a trace on. Constrained here rather than
 * cast at the use site, so a component whose evidence lacks one fails to
 * compile instead of emitting undefined ids that surface later as an
 * unexplained host-join mismatch.
 */
export interface IdentifiedEvidence {
  readonly evidenceId: string
}

export interface CombinedComponent<E extends IdentifiedEvidence> {
  readonly id: string
  readonly version: string
  /** Contributes to the bundle identity, so the pair cannot drift apart. */
  readonly bundleVersion: string
  readonly logLikelihoodCap: number
  /** Stable code recorded when this component alone fails. */
  readonly degradation: string
  readonly evidence: (view: PlayerView, viewer: Seat) => readonly E[]
  readonly logLikelihood: (world: HiddenWorld, evidence: E) => number
}

/**
 * A component whose evidence type is not known to the holder. The composer is
 * genuinely heterogeneous: its whole job is to run factors that read different
 * evidence, and `E` appears in both an input and an output position, so no
 * single parameter can describe a mixed list. Named once here rather than
 * spelled `any` at every seam.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCombinedComponent = CombinedComponent<any>

export interface CombinedModelVersions {
  readonly belief: string
  readonly bundle: string
}

/** The per-world capped contribution of one component, plus its provenance. */
interface ComponentContribution {
  readonly capped: readonly number[]
  readonly provenance: EvidenceContribution
}

function contribute<E extends IdentifiedEvidence>(
  component: CombinedComponent<E>,
  view: PlayerView,
  worlds: readonly HiddenWorld[],
): ComponentContribution | undefined {
  const evidence = component.evidence(view, view.seat)
  // No evidence is not a failure and not a degradation. It contributes a zero
  // vector, which is exactly "this component saw nothing yet" and leaves the
  // others free to weight. A single-factor model returns the uniform posterior
  // here, and doing that in a composition would silently discard its siblings.
  if (!evidence.length) return undefined
  const raw = worlds.map((world) =>
    evidence.reduce(
      (sum, item) => sum + component.logLikelihood(world, item),
      0,
    ))
  let best = -Infinity
  for (const value of raw) if (value > best) best = value
  const capped = raw.map((value) =>
    capLogLikelihood(value - best, component.logLikelihoodCap).value)
  return {
    capped,
    provenance: buildFactorProvenance(
      component,
      evidence.map((item) => item.evidenceId),
      component.logLikelihoodCap,
      capped,
    ),
  }
}

/**
 * A belief model that applies several mechanical factors before normalizing.
 *
 * Components are applied in the order given, and that order is not a priority:
 * addition commutes, so it affects only the order of provenance entries. It is
 * still fixed rather than incidental, because a trace whose provenance reorders
 * between runs cannot be compared with a stored one.
 */
export function createCombinedBeliefModel(
  components: readonly AnyCombinedComponent[],
  versions: CombinedModelVersions,
): BeliefModel {
  if (components.length < 2) {
    // A one-component combination is the component, and shipping it under a
    // combined version would put a name in traces that promises composition it
    // does not perform.
    throw new Error('a combined belief model needs at least two components')
  }
  return Object.freeze({
    version: versions.belief,
    factorsVersion: versions.bundle,
    infer(view: PlayerView): BeliefSnapshot {
      let worlds: readonly HiddenWorld[]
      try {
        worlds = feasibleWorlds(view)
      } catch {
        // Enumeration is the shared prerequisite, so its failure is not
        // partial: there is nothing to weight. §10 step 4 hands this to the
        // host, which falls back to the tested heuristic agent.
        throw new Error('combined belief model cannot enumerate worlds')
      }
      const totals = new Array<number>(worlds.length).fill(0)
      const provenance: EvidenceContribution[] = []
      const degradation: string[] = []
      let contributed = 0
      for (const component of components) {
        let result: ComponentContribution | undefined
        try {
          result = contribute(component, view, worlds)
        } catch {
          // The point of the composition: one component failing costs its own
          // evidence and nothing else.
          degradation.push(component.degradation)
          continue
        }
        if (!result) continue
        for (let index = 0; index < totals.length; index++) {
          totals[index]! += result.capped[index]!
        }
        provenance.push(result.provenance)
        contributed += 1
      }
      if (!contributed) {
        // Either nothing has happened yet or every component failed. The
        // degradation list is what tells those apart, and it is why the
        // snapshot carries one even when the posterior is the honest uniform.
        const uniform = exactBelief(view)
        return {
          ...uniform,
          modelVersion: versions.belief,
          ...(degradation.length
            ? { quality: 'degraded' as const, degradation }
            : {}),
        }
      }
      return beliefFromWeightedWorlds(
        view,
        normalizeLogWeights(worlds, totals),
        {
          modelVersion: versions.belief,
          // Degraded when a component was lost even though others weighted, so
          // a consumer can tell a full posterior from a partial one without
          // reading the provenance list.
          quality: degradation.length ? 'degraded' : 'weighted',
          provenance,
          ...(degradation.length ? { degradation } : {}),
        },
      )
    },
  })
}

/**
 * The combination BELIEF-003 exists to make seatable: the seated quest-card
 * factor plus the good-vote model that beat v1 on the composed population.
 *
 * Versions are derived from the components rather than authored, so a bundle
 * string can never claim a composition the model does not perform.
 */
export const QUEST_AND_VOTE_GOOD_COMPONENTS: readonly AnyCombinedComponent[] =
  Object.freeze([
  Object.freeze({
    id: 'quest-card',
    version: QUEST_CARD_FACTOR_VERSION,
    bundleVersion: QUEST_FACTOR_BUNDLE_VERSION,
    logLikelihoodCap: QUEST_FACTOR_LOG_LIKELIHOOD_CAP,
    degradation: QUEST_CARD_FACTOR_DEGRADATION,
    // Quest cards are public and carry no viewer asymmetry, so the viewer
    // argument is accepted and ignored rather than absent.
    evidence: (view: PlayerView) => questCardEvidence(view),
    logLikelihood: (world: HiddenWorld, evidence: QuestCardEvidence) =>
      analyticalQuestCardFactor.logLikelihood(world, evidence),
  }),
  Object.freeze({
    id: 'vote-matrix',
    version: VOTE_MATRIX_FACTOR_V2_VERSION,
    bundleVersion: VOTE_MATRIX_BUNDLE_V2_VERSION,
    logLikelihoodCap: VOTE_MATRIX_LOG_LIKELIHOOD_CAP,
    degradation: VOTE_MATRIX_FACTOR_DEGRADATION,
    // §3.4: the viewer's own ballot is excluded, which is why this one needs
    // the seat the other ignores.
    evidence: (view: PlayerView, viewer: Seat) =>
      voteMatrixEvidence(view, viewer),
    logLikelihood: (world: HiddenWorld, evidence: VoteMatrixEvidence) =>
      analyticalVoteMatrixFactorV2.logLikelihood(world, evidence),
  }),
])

export const QUEST_AND_VOTE_GOOD_VERSIONS: CombinedModelVersions = Object.freeze({
  belief: `exact-constraints+${QUEST_FACTOR_BUNDLE_VERSION}`
    + `+${VOTE_MATRIX_BUNDLE_V2_VERSION}`,
  bundle: `${QUEST_FACTOR_BUNDLE_VERSION}+${VOTE_MATRIX_BUNDLE_V2_VERSION}`,
})

export const questAndVoteGoodBeliefModel = createCombinedBeliefModel(
  QUEST_AND_VOTE_GOOD_COMPONENTS,
  QUEST_AND_VOTE_GOOD_VERSIONS,
)
