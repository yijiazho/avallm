import { ROLES } from '../../engine/types.ts'
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

/**
 * The serialization order for role-valued collections: ascending by role name.
 *
 * Derived from ROLES, never restated. This used to be its own list of the eight
 * names, which made it a second membership authority alongside the engine's:
 * adding a role to ROLES (and so to the Role union) would have left every
 * role-ordered projection silently omitting it, with nothing to typecheck
 * against. Only the ORDER is this module's contribution, and alphabetical is a
 * total order over any set of names, so a ninth role slots itself in.
 *
 * ROLES is declaration-ordered (good roles, then evil) because that is how the
 * rulebook reads. Sorting is deliberately not that: this order reaches world
 * keys and snapshot payloads, where stability matters more than legibility.
 */
export const CANONICAL_ROLE_ORDER: readonly Role[] = Object.freeze(
  [...ROLES].sort(),
)

/** Where each role sorts. Membership questions go to the engine's isRole. */
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
