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
export const PROBABILITY_TOLERANCE = 1e-12
export const DEFAULT_TOP_WORLD_LIMIT = 10

export const CANONICAL_ROLE_ORDER: readonly Role[] = [
  'assassin',
  'merlin',
  'minion',
  'mordred',
  'morgana',
  'oberon',
  'percival',
  'servant',
]

/**
 * The two derivations every role-shaped validator and every role-ordered
 * collection needs: is this string one of the roles, and where does it sort.
 *
 * Six modules used to rebuild one or both of these from CANONICAL_ROLE_ORDER by
 * hand, and elsewhere two validators had already drifted past that into
 * hardcoding a byte-for-byte copy of the names. They exist here so that adding
 * a role is one edit to the array above rather than a hunt for the copies.
 */
export const CANONICAL_ROLE_SET: ReadonlySet<Role> = new Set(
  CANONICAL_ROLE_ORDER,
)

export const CANONICAL_ROLE_RANK: ReadonlyMap<Role, number> = new Map(
  CANONICAL_ROLE_ORDER.map((role, index) => [role, index]),
)

/** Ascending CANONICAL_ROLE_ORDER comparator. An unranked role sorts last. */
export const compareCanonicalRoles = (left: Role, right: Role): number =>
  (CANONICAL_ROLE_RANK.get(left) ?? Number.MAX_SAFE_INTEGER)
  - (CANONICAL_ROLE_RANK.get(right) ?? Number.MAX_SAFE_INTEGER)

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
