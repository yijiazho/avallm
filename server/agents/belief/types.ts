import type {
  Alignment,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'

/**
 * Probability semantics:
 *
 * - every world is a complete assignment of the public role multiset;
 * - impossible worlds are absent rather than present with zero weight;
 * - constraints-only snapshots give every feasible world the same probability;
 * - weighted snapshots normalize capped factor contributions over feasible worlds;
 * - entropy is Shannon entropy in bits.
 *
 * World arrays and projections are ordered by ascending seat. Role-valued
 * collections and tied worlds use CANONICAL_ROLE_ORDER and the world key.
 */
export const EXACT_BELIEF_MODEL_VERSION = 'exact-constraints-v1'
export const DEFAULT_TOP_WORLD_LIMIT = 10

// PROBABILITY_TOLERANCE used to live here, which made the belief layer the
// owner of a constant that analysis, policy, admission, and the score layers
// all needed. It moved to canonical/probability-arithmetic.ts, beside the
// shared shape guards, so the numeric contract has one home rather than a home
// plus 83 raw literals. Deliberately not re-exported: a second spelling of the
// import path is the first step back toward two definitions.

// The canonical role order and its comparator moved down one tier, to live
// with the shape guard that validates against them, in
// canonical/canonical-shape.ts. Not re-exported here: the callers import them
// from the owner, so there is one spelling of where the role order lives.

export interface HiddenWorld {
  roleBySeat: readonly Role[]
  alignmentBySeat: readonly Alignment[]
  /**
   * Stable seat-order serialization of roleBySeat. Duplicate role copies have
   * no identity, so assignments with the same key are the same world.
   */
  key: string
}

export interface WeightedWorld {
  world: HiddenWorld
  probability: number
}

export interface PlayerMarginal {
  seat: Seat
  goodProbability: number
  evilProbability: number
}

export interface RoleMarginal {
  seat: Seat
  role: Role
  probability: number
}

export interface EvidenceContribution {
  factorId: string
  factorVersion: string
  evidenceIds: readonly string[]
  logLikelihoodCap: number
  minLogLikelihood: number
  maxLogLikelihood: number
}

/**
 * A conservative likelihood factor: it prices one piece of admitted evidence
 * against a complete world as an additive log-likelihood. Both the quest-card
 * and language factors conform, so their orchestration shares one shape even
 * though each factor reads a different evidence type.
 */
export interface LikelihoodFactor<Evidence, Id extends string = string> {
  id: Id
  version: string
  logLikelihood(world: HiddenWorld, evidence: Evidence): number
}

/**
 * The provenance record every factor emits: its identity, the evidence it
 * consumed, the cap it enforced, and the span of the capped contributions.
 * min/max are folded left to right rather than spread through Math.min/max,
 * because the capped array carries one entry per feasible world and a
 * ten-player support can exceed the argument-count limit of a spread call.
 */
export function buildFactorProvenance(
  factor: { id: string; version: string },
  evidenceIds: readonly string[],
  logLikelihoodCap: number,
  cappedLogLikelihoods: readonly number[],
): EvidenceContribution {
  let minLogLikelihood = Infinity
  let maxLogLikelihood = -Infinity
  for (const value of cappedLogLikelihoods) {
    if (value < minLogLikelihood) minLogLikelihood = value
    if (value > maxLogLikelihood) maxLogLikelihood = value
  }
  return {
    factorId: factor.id,
    factorVersion: factor.version,
    evidenceIds,
    logLikelihoodCap,
    minLogLikelihood,
    maxLogLikelihood,
  }
}

export interface BeliefSnapshot {
  throughSeq: number
  modelVersion: string
  quality: 'constraints-only' | 'weighted' | 'degraded'
  worlds: readonly WeightedWorld[]
  playerMarginals: readonly PlayerMarginal[]
  roleMarginals: readonly RoleMarginal[]
  /** Shannon entropy in bits. */
  entropy: number
  /** Highest-probability worlds, then canonical key; capped at 10 by default. */
  topWorlds: readonly WeightedWorld[]
  /** Factor-level summaries only; never public player state. */
  provenance: readonly EvidenceContribution[]
  /** Typed inference failures that caused a fallback or omitted factor. */
  degradation: readonly string[]
}

export interface BeliefModel {
  version: string
  factorsVersion: string
  infer(view: PlayerView): BeliefSnapshot
}

export interface TeamAssessment {
  team: readonly Seat[]
  cleanProbability: number
  /**
   * Index k is the posterior probability that exactly k team members are evil.
   * The array always has team.length + 1 entries, including zero-probability
   * counts.
   */
  evilCountDistribution: readonly number[]
}
