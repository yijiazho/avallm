import {
  MAX_PLAYERS,
  ROLE_ALIGNMENT,
  validateRoles,
} from '../../engine/rules.ts'
import { isRole } from '../../engine/types.ts'
import type { Role, Seat } from '../../engine/types.ts'
import { CANONICAL_ROLE_ORDER } from '../canonical/canonical-shape.ts'
import type {
  BeliefSnapshot,
  HiddenWorld,
  WeightedWorld,
} from './types.ts'
import { canonicalRoleMultiset } from './worlds.ts'
import {
  denseArray,
  tableSize,
} from '../canonical/canonical-shape.ts'
import {
  addProbability,
  clampProbability,
  PROBABILITY_TOLERANCE,
  stableProbabilitySum,
  type CompensatedProbability,
} from '../canonical/probability-arithmetic.ts'

// The compensated summation used below was written here, because this is where
// the strict normalization check first met a 58,080-world support and lost. It
// moved to canonical/probability-arithmetic.ts for the same reason
// PROBABILITY_TOLERANCE did: analysis already imported it from this module, so
// the belief layer owned a numeric kernel that four layers need, and ARCH017
// scans that module's exports for private copies. Deliberately not re-exported.
export const JOINT_IDENTITY_MODEL_VERSION = 'joint-identity-projection-v1'
export const MAX_IDENTITY_ROLE_QUERIES = 16
export const MAX_IDENTITY_HYPOTHESES_PER_POSTERIOR = 4_096

export interface RoleIdentityQuery {
  /** A multiset. Repeated roles request the seats holding every queried copy. */
  roles: readonly Role[]
}

export interface IdentityProjectionScope {
  roleQueries: readonly RoleIdentityQuery[]
  hiddenTeam: boolean
}

export interface CanonicalRoleAssignment {
  role: Role
  seats: readonly Seat[]
}

export interface RoleIdentityHypothesis {
  assignments: readonly CanonicalRoleAssignment[]
  probability: number
}

export interface RoleIdentityPosterior {
  /** Stable canonical serialization of the queried role multiset. */
  queryKey: string
  queriedRoles: readonly Role[]
  hypotheses: readonly RoleIdentityHypothesis[]
}

export interface HiddenTeamHypothesis {
  evilSeats: readonly Seat[]
  probability: number
}

export interface HiddenTeamPosterior {
  hypotheses: readonly HiddenTeamHypothesis[]
}

/**
 * Per-seat evil probability implied by a hidden-team posterior.
 *
 * Four modules had written this loop out by hand: twice here, once in
 * `analysis/evil-objectives.ts` and once in `analysis/role-objectives.ts`. Two
 * of those four are the two sides of one comparison. The analysis modules
 * rebuild the marginals and hand them to validatePrivateIdentityHostJoin, which
 * rebuilds them again from the same posterior and checks the two agree to
 * PROBABILITY_TOLERANCE. They agreed to the last bit, but only because both
 * spellings happened to visit the hypotheses in the same order and adding a
 * literal zero for a non-member seat is exact. Either side reordering its loop,
 * or one side alone switching to a compensated sum, would have opened a gap
 * that the tolerance would have absorbed silently. One function removes the
 * coincidence: the two sides are now the same arithmetic by construction.
 *
 * Compensated because it is free here. Every consumer moves together, so the
 * choice cannot put two call sites into disagreement, and the result is exact
 * against a counted reference rather than the 6.7e-16 the naive form carried.
 */
export function hiddenTeamEvilMarginals(
  posterior: HiddenTeamPosterior,
  playerCount: number,
): readonly number[] {
  const accumulators = Array.from(
    { length: playerCount },
    (): CompensatedProbability => ({ sum: 0, compensation: 0 }),
  )
  for (const hypothesis of posterior.hypotheses) {
    for (const seat of hypothesis.evilSeats) {
      if (seat >= 0 && seat < playerCount) {
        addProbability(accumulators[seat]!, hypothesis.probability)
      }
    }
  }
  return accumulators.map(
    (accumulator) =>
      clampProbability(accumulator.sum + accumulator.compensation),
  )
}

export interface PrivateIdentitySnapshot {
  version: typeof JOINT_IDENTITY_MODEL_VERSION
  sourceBelief: {
    modelVersion: string
    throughSeq: number
    quality: BeliefSnapshot['quality']
    playerCount: number
    /** Canonical public cast that every source world assigns. */
    rolesInPlay: readonly Role[]
  }
  scope: {
    roleQueries: readonly { queryKey: string; queriedRoles: readonly Role[] }[]
    hiddenTeam: boolean
  }
  rolePosteriors: readonly RoleIdentityPosterior[]
  hiddenTeamPosterior?: HiddenTeamPosterior
}

// Kernel helpers shared with the boundary-validation half (identity-validate.ts)
// as well as the projection engine below. They are exported for that sibling,
// not as a public surface.

export function roleMultisetCounts(roles: readonly Role[]): Map<Role, number> {
  const counts = new Map<Role, number>()
  for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1)
  return counts
}

export interface CanonicalQuery {
  queryKey: string
  queriedRoles: readonly Role[]
  counts: ReadonlyMap<Role, number>
}

export function canonicalQuery(roles: readonly Role[]): CanonicalQuery {
  if (
    !denseArray(roles)
    || roles.length === 0
  ) {
    throw new Error('identity role query requires at least one role')
  }
  if (roles.length > MAX_PLAYERS) {
    throw new Error('identity role query exceeds the supported player limit')
  }
  if (!roles.every(isRole)) {
    throw new Error('identity role query contains an invalid role')
  }
  const queriedRoles = canonicalRoleMultiset(roles)
  const counts = roleMultisetCounts(queriedRoles)
  const queryKey = [...counts.entries()]
    .map(([role, count]) => `${role}:${count}`)
    .join('|')
  return { queryKey, queriedRoles, counts }
}

export function sameRoleCounts(
  left: ReadonlyMap<Role, number>,
  right: ReadonlyMap<Role, number>,
): boolean {
  return CANONICAL_ROLE_ORDER.every(
    (role) => (left.get(role) ?? 0) === (right.get(role) ?? 0),
  )
}

export function validateQueryAgainstCast(
  query: CanonicalQuery,
  castCounts: ReadonlyMap<Role, number>,
  playerCount: number,
): void {
  if (query.queriedRoles.length > playerCount) {
    throw new Error('identity role query exceeds player count')
  }
  for (const [role, count] of query.counts) {
    const castCount = castCounts.get(role) ?? 0
    if (count !== castCount) {
      throw new Error(
        `identity role query requests ${count} ${role} copies but cast contains ${castCount}`,
      )
    }
  }
}

export function assignmentKey(assignments: readonly CanonicalRoleAssignment[]): string {
  return assignments
    .map((assignment) => `${assignment.role}:${assignment.seats.join('.')}`)
    .join('|')
}

/** The per-world structural contract validateBelief enforces, minus the running
 * duplicate-key check which needs cross-world state. */
function hasValidWorldShape(weighted: WeightedWorld): boolean {
  return Boolean(weighted)
    && typeof weighted === 'object'
    && Boolean(weighted.world)
    && typeof weighted.world === 'object'
    && Number.isFinite(weighted.probability)
    && weighted.probability > 0
    && denseArray(weighted.world.roleBySeat)
    && denseArray(weighted.world.alignmentBySeat)
    && weighted.world.roleBySeat.length === weighted.world.alignmentBySeat.length
    && Boolean(tableSize(weighted.world.roleBySeat.length))
    && !weighted.world.roleBySeat.some((role: unknown) => !isRole(role))
    && !weighted.world.alignmentBySeat.some(
      (alignment: unknown, seat: number) => {
        const role = weighted.world.roleBySeat[seat]
        return (
          (alignment !== 'good' && alignment !== 'evil')
          || !isRole(role)
          || ROLE_ALIGNMENT[role] !== alignment
        )
      },
    )
    && weighted.world.key === weighted.world.roleBySeat.join('|')
}

function validateBelief(snapshot: BeliefSnapshot): {
  playerCount: number
  rolesInPlay: readonly Role[]
  castCounts: ReadonlyMap<Role, number>
  projectionTotal: number
} {
  if (
    !snapshot
    || typeof snapshot !== 'object'
    || typeof snapshot.modelVersion !== 'string'
    || snapshot.modelVersion.length === 0
    || !Number.isSafeInteger(snapshot.throughSeq)
    || snapshot.throughSeq < -1
    || !['constraints-only', 'weighted', 'degraded'].includes(snapshot.quality)
    || !Array.isArray(snapshot.worlds)
    || snapshot.worlds.length === 0
  ) {
    throw new Error('identity projection requires a valid resolved belief snapshot')
  }

  let playerCount: number | undefined
  const worldKeys = new Set<string>()
  let expectedRoleCounts: Map<Role, number> | undefined
  let expectedEvilCount: number | undefined
  for (const weighted of snapshot.worlds) {
    if (!hasValidWorldShape(weighted) || worldKeys.has(weighted.world.key)) {
      throw new Error('identity projection received an invalid weighted world')
    }
    worldKeys.add(weighted.world.key)
    playerCount ??= weighted.world.roleBySeat.length
    if (weighted.world.roleBySeat.length !== playerCount) {
      throw new Error('identity projection worlds disagree on player count')
    }
    const roleCounts = roleMultisetCounts(weighted.world.roleBySeat)
    if (!expectedRoleCounts) {
      expectedRoleCounts = roleCounts
    } else if (
      !sameRoleCounts(roleCounts, expectedRoleCounts)
    ) {
      throw new Error('identity projection worlds disagree on role multiset')
    }
    const evilCount = weighted.world.alignmentBySeat.filter(
      (alignment: unknown) => alignment === 'evil',
    ).length
    expectedEvilCount ??= evilCount
    if (evilCount !== expectedEvilCount) {
      throw new Error('identity projection worlds disagree on hidden-team size')
    }
  }
  const total = stableProbabilitySum(
    snapshot.worlds,
    (weighted) => weighted.probability,
  )
  if (
    !Number.isFinite(total)
    || Math.abs(total - 1) > PROBABILITY_TOLERANCE
  ) {
    throw new Error('identity projection requires normalized positive support')
  }
  if (
    snapshot.quality === 'constraints-only'
    && snapshot.worlds.some(
      (weighted) =>
        Math.abs(
          weighted.probability - snapshot.worlds[0]!.probability,
        ) > PROBABILITY_TOLERANCE,
    )
  ) {
    throw new Error('constraints-only identity support must be uniform')
  }
  const rolesInPlay = canonicalRoleMultiset(snapshot.worlds[0].world.roleBySeat)
  validateRoles(playerCount!, [...rolesInPlay])
  return {
    playerCount: playerCount!,
    rolesInPlay,
    castCounts: roleMultisetCounts(rolesInPlay),
    projectionTotal: total,
  }
}

function assignmentFor(
  roleBySeat: readonly Role[],
  counts: ReadonlyMap<Role, number>,
): readonly CanonicalRoleAssignment[] {
  return [...counts.entries()].map(([role, requiredCopies]) => {
    const seats = roleBySeat
      .map((candidate, seat) => candidate === role ? seat : -1)
      .filter((seat) => seat >= 0)
    if (seats.length !== requiredCopies) {
      throw new Error(
        `identity query requests ${requiredCopies} ${role} copies but worlds contain ${seats.length}`,
      )
    }
    return { role, seats }
  })
}

/**
 * Group a snapshot's worlds by a derived key, summing each group's probability
 * against a shared total. projectRolePosterior and projectHiddenTeam both
 * reduce to this: compute a payload per world, key it, accumulate compensated
 * mass under a bounded-hypothesis guard, then emit ascending by key normalized
 * by total. The payload of the first world in a group is the one retained, and
 * callers shape it into their hypothesis type.
 */
function groupWorldsBy<Payload>(
  worlds: readonly WeightedWorld[],
  payloadOf: (world: HiddenWorld) => Payload,
  keyOf: (payload: Payload) => string,
  total: number,
  overflowMessage: string,
): readonly { payload: Payload; probability: number }[] {
  const grouped = new Map<
    string,
    CompensatedProbability & { payload: Payload }
  >()
  for (const weighted of worlds) {
    const payload = payloadOf(weighted.world)
    const key = keyOf(payload)
    let accumulated = grouped.get(key)
    if (!accumulated) {
      accumulated = { payload, sum: 0, compensation: 0 }
      grouped.set(key, accumulated)
    }
    addProbability(accumulated, weighted.probability)
    if (grouped.size > MAX_IDENTITY_HYPOTHESES_PER_POSTERIOR) {
      throw new Error(overflowMessage)
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, group]) => ({
      payload: group.payload,
      probability: (group.sum + group.compensation) / total,
    }))
}

function projectRolePosterior(
  snapshot: BeliefSnapshot,
  query: CanonicalQuery,
  total: number,
): RoleIdentityPosterior {
  return {
    queryKey: query.queryKey,
    queriedRoles: [...query.queriedRoles],
    hypotheses: groupWorldsBy(
      snapshot.worlds,
      (world) => assignmentFor(world.roleBySeat, query.counts),
      assignmentKey,
      total,
      `identity query ${query.queryKey} exceeds the bounded hypothesis limit`,
    ).map(({ payload, probability }) => ({
      assignments: payload.map((assignment) => ({
        role: assignment.role,
        seats: [...assignment.seats],
      })),
      probability,
    })),
  }
}

function projectHiddenTeam(
  snapshot: BeliefSnapshot,
  total: number,
): HiddenTeamPosterior {
  return {
    hypotheses: groupWorldsBy(
      snapshot.worlds,
      (world) => world.alignmentBySeat
        .map((alignment, seat) => alignment === 'evil' ? seat : -1)
        .filter((seat) => seat >= 0),
      (evilSeats) => evilSeats.join('.'),
      total,
      'hidden-team identity exceeds the bounded hypothesis limit',
    ).map(({ payload, probability }) => ({
      evilSeats: [...payload],
      probability,
    })),
  }
}

/**
 * Project bounded identity hypotheses by summing complete-world probability.
 * This module deliberately knows nothing about the view, public observer,
 * policy, prompt adapters, external services, evaluation labels, or deal labels.
 */
export function projectJointIdentity(
  snapshot: BeliefSnapshot,
  scope: IdentityProjectionScope,
): PrivateIdentitySnapshot {
  const source = validateBelief(snapshot)
  if (
    !scope
    || typeof scope !== 'object'
    || !denseArray(scope.roleQueries)
    || typeof scope.hiddenTeam !== 'boolean'
    || scope.roleQueries.length > MAX_IDENTITY_ROLE_QUERIES
  ) {
    throw new Error('identity projection received an invalid bounded query scope')
  }
  const queries = scope.roleQueries.map((query) => {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new Error('identity projection received an invalid role query')
    }
    const canonical = canonicalQuery(query.roles)
    validateQueryAgainstCast(canonical, source.castCounts, source.playerCount)
    return canonical
  })
  const unique = new Map(queries.map((query) => [query.queryKey, query]))
  if (unique.size !== queries.length) {
    throw new Error('identity projection scope contains duplicate role queries')
  }
  const canonicalQueries = [...unique.values()].sort(
    (left, right) =>
      left.queryKey < right.queryKey ? -1 : left.queryKey > right.queryKey ? 1 : 0,
  )
  if (canonicalQueries.length === 0 && !scope.hiddenTeam) {
    throw new Error('identity projection scope must request at least one posterior')
  }
  const total = source.projectionTotal
  return {
    version: JOINT_IDENTITY_MODEL_VERSION,
    sourceBelief: {
      modelVersion: snapshot.modelVersion,
      throughSeq: snapshot.throughSeq,
      quality: snapshot.quality,
      playerCount: source.playerCount,
      rolesInPlay: [...source.rolesInPlay],
    },
    scope: {
      roleQueries: canonicalQueries.map((query) => ({
        queryKey: query.queryKey,
        queriedRoles: [...query.queriedRoles],
      })),
      hiddenTeam: scope.hiddenTeam,
    },
    rolePosteriors: canonicalQueries.map(
      (query) => projectRolePosterior(
        snapshot,
        query,
        total,
      ),
    ),
    ...(scope.hiddenTeam
      ? {
          hiddenTeamPosterior: projectHiddenTeam(
            snapshot,
            total,
          ),
        }
      : {}),
  }
}
