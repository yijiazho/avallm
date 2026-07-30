import {
  EVIL_COUNT,
  MAX_PLAYERS,
  ROLE_ALIGNMENT,
  validateRoles,
} from '../../engine/rules.ts'
import { isRole } from '../../engine/types.ts'
import type { Role, Seat } from '../../engine/types.ts'
import {
  CANONICAL_ROLE_ORDER,
  type BeliefSnapshot,
  type PlayerMarginal,
} from './types.ts'
import { canonicalRoleMultiset } from './worlds.ts'
import {
  canonicalRoles,
  canonicalSeats,
  denseArray,
  onlyAllowedKeys,
  probability,
  tableSize,
} from '../components/canonical-shape.ts'
import {
  addProbability,
  clampProbability,
  PROBABILITY_TOLERANCE,
  stableProbabilitySum,
  type CompensatedProbability,
} from '../components/probability-arithmetic.ts'

// The compensated summation used below was written here, because this is where
// the strict normalization check first met a 58,080-world support and lost. It
// moved to components/probability-arithmetic.ts for the same reason
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
        addProbability(accumulators[seat], hypothesis.probability)
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

function roleMultisetCounts(roles: readonly Role[]): Map<Role, number> {
  const counts = new Map<Role, number>()
  for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1)
  return counts
}

interface CanonicalQuery {
  queryKey: string
  queriedRoles: readonly Role[]
  counts: ReadonlyMap<Role, number>
}

function canonicalQuery(roles: readonly Role[]): CanonicalQuery {
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

function sameRoleCounts(
  left: ReadonlyMap<Role, number>,
  right: ReadonlyMap<Role, number>,
): boolean {
  return CANONICAL_ROLE_ORDER.every(
    (role) => (left.get(role) ?? 0) === (right.get(role) ?? 0),
  )
}

function validateQueryAgainstCast(
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
    if (
      !weighted
      || typeof weighted !== 'object'
      || !weighted.world
      || typeof weighted.world !== 'object'
      || !Number.isFinite(weighted.probability)
      || weighted.probability <= 0
      || !denseArray(weighted.world.roleBySeat)
      || !denseArray(weighted.world.alignmentBySeat)
      || weighted.world.roleBySeat.length !== weighted.world.alignmentBySeat.length
      || !tableSize(weighted.world.roleBySeat.length)
      || weighted.world.roleBySeat.some((role: unknown) => !isRole(role))
      || weighted.world.alignmentBySeat.some(
        (alignment: unknown, seat: number) => {
          const role = weighted.world.roleBySeat[seat]
          return (
            (alignment !== 'good' && alignment !== 'evil')
            || !isRole(role)
            || ROLE_ALIGNMENT[role] !== alignment
          )
        },
      )
      || weighted.world.key !== weighted.world.roleBySeat.join('|')
      || worldKeys.has(weighted.world.key)
    ) {
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
          weighted.probability - snapshot.worlds[0].probability,
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

function assignmentKey(assignments: readonly CanonicalRoleAssignment[]): string {
  return assignments
    .map((assignment) => `${assignment.role}:${assignment.seats.join('.')}`)
    .join('|')
}

function projectRolePosterior(
  snapshot: BeliefSnapshot,
  query: CanonicalQuery,
  total: number,
): RoleIdentityPosterior {
  const grouped = new Map<string, CompensatedProbability & {
    assignments: readonly CanonicalRoleAssignment[]
  }>()
  for (const weighted of snapshot.worlds) {
    const assignments = assignmentFor(weighted.world.roleBySeat, query.counts)
    const key = assignmentKey(assignments)
    let accumulated = grouped.get(key)
    if (!accumulated) {
      accumulated = {
        assignments,
        sum: 0,
        compensation: 0,
      }
      grouped.set(key, accumulated)
    }
    addProbability(accumulated, weighted.probability)
    if (grouped.size > MAX_IDENTITY_HYPOTHESES_PER_POSTERIOR) {
      throw new Error(
        `identity query ${query.queryKey} exceeds the bounded hypothesis limit`,
      )
    }
  }
  return {
    queryKey: query.queryKey,
    queriedRoles: [...query.queriedRoles],
    hypotheses: [...grouped.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, hypothesis]) => ({
        assignments: hypothesis.assignments.map((assignment) => ({
          role: assignment.role,
          seats: [...assignment.seats],
        })),
        probability:
          (hypothesis.sum + hypothesis.compensation) / total,
      })),
  }
}

function projectHiddenTeam(
  snapshot: BeliefSnapshot,
  total: number,
): HiddenTeamPosterior {
  const grouped = new Map<string, CompensatedProbability & {
    evilSeats: readonly Seat[]
  }>()
  for (const weighted of snapshot.worlds) {
    const evilSeats = weighted.world.alignmentBySeat
      .map((alignment, seat) => alignment === 'evil' ? seat : -1)
      .filter((seat) => seat >= 0)
    const key = evilSeats.join('.')
    let accumulated = grouped.get(key)
    if (!accumulated) {
      accumulated = {
        evilSeats,
        sum: 0,
        compensation: 0,
      }
      grouped.set(key, accumulated)
    }
    addProbability(accumulated, weighted.probability)
    if (grouped.size > MAX_IDENTITY_HYPOTHESES_PER_POSTERIOR) {
      throw new Error('hidden-team identity exceeds the bounded hypothesis limit')
    }
  }
  return {
    hypotheses: [...grouped.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, hypothesis]) => ({
        evilSeats: [...hypothesis.evilSeats],
        probability:
          (hypothesis.sum + hypothesis.compensation) / total,
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

/**
 * A hypothesis carries strictly positive mass: a zero-probability world is
 * absent from the posterior rather than listed with a zero. Deliberately not
 * the shared `probability`, which admits zero.
 */
const positiveProbability = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value > 0
  && value <= 1

function validProbabilityLattice(
  hypotheses: readonly Record<string, unknown>[],
): boolean {
  return hypotheses.length > 0
    && hypotheses.length <= MAX_IDENTITY_HYPOTHESES_PER_POSTERIOR
    && Math.abs(
      stableProbabilitySum(
        hypotheses,
        (hypothesis) =>
          typeof hypothesis.probability === 'number'
            ? hypothesis.probability
            : Number.NaN,
      ) - 1,
    ) <= PROBABILITY_TOLERANCE
}

function reconcilesRoleAndTeamPosteriors(
  snapshot: Record<string, unknown>,
  rolesInPlay: readonly Role[],
  playerCount: number,
): boolean {
  if (snapshot.hiddenTeamPosterior === undefined) return true
  const evilBySeat = hiddenTeamEvilMarginals(
    snapshot.hiddenTeamPosterior as HiddenTeamPosterior,
    playerCount,
  )

  const marginalsByRole = new Map<Role, readonly number[]>()
  for (const posterior of snapshot.rolePosteriors as RoleIdentityPosterior[]) {
    for (const role of new Set(posterior.queriedRoles)) {
      const marginal = Array<number>(playerCount).fill(0)
      for (const hypothesis of posterior.hypotheses) {
        const assignment = hypothesis.assignments.find(
          (candidate) => candidate.role === role,
        )
        if (!assignment) return false
        for (const seat of assignment.seats) {
          marginal[seat] += hypothesis.probability
        }
      }
      const existing = marginalsByRole.get(role)
      if (
        existing
        && existing.some(
          (recorded, seat) =>
            Math.abs(recorded - marginal[seat]) > PROBABILITY_TOLERANCE,
        )
      ) return false
      marginalsByRole.set(role, marginal)
    }
  }

  for (const alignment of ['evil', 'good'] as const) {
    const queriedRoles = [...marginalsByRole.keys()].filter(
      (role) => ROLE_ALIGNMENT[role] === alignment,
    )
    if (queriedRoles.length === 0) continue
    const queriedCopies = queriedRoles.reduce(
      (sum, role) =>
        sum + rolesInPlay.filter((candidate) => candidate === role).length,
      0,
    )
    const castCopies = rolesInPlay.filter(
      (role) => ROLE_ALIGNMENT[role] === alignment,
    ).length
    for (let seat = 0; seat < playerCount; seat++) {
      const roleProbability = queriedRoles.reduce(
        (sum, role) => sum + marginalsByRole.get(role)![seat],
        0,
      )
      const alignmentProbability = alignment === 'evil'
        ? evilBySeat[seat]
        : 1 - evilBySeat[seat]
      if (
        roleProbability > alignmentProbability + PROBABILITY_TOLERANCE
        || (
          queriedCopies === castCopies
          && Math.abs(roleProbability - alignmentProbability)
            > PROBABILITY_TOLERANCE
        )
      ) return false
    }
  }
  return true
}

/** Strict private JSON boundary used by external and artifact validation. */
export function validatePrivateIdentitySnapshot(
  value: unknown,
): value is PrivateIdentitySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Record<string, unknown>
  const source = snapshot.sourceBelief as Record<string, unknown>
  const scope = snapshot.scope as Record<string, unknown>
  if (
    !onlyAllowedKeys(snapshot, [
      'version',
      'sourceBelief',
      'scope',
      'rolePosteriors',
      'hiddenTeamPosterior',
    ])
    || snapshot.version !== JOINT_IDENTITY_MODEL_VERSION
    || !source
    || typeof source !== 'object'
    || Array.isArray(source)
    || !onlyAllowedKeys(source, [
      'modelVersion',
      'throughSeq',
      'quality',
      'playerCount',
      'rolesInPlay',
    ])
    || typeof source.modelVersion !== 'string'
    || source.modelVersion.length === 0
    || !Number.isSafeInteger(source.throughSeq)
    || (source.throughSeq as number) < -1
    || !['constraints-only', 'weighted', 'degraded'].includes(source.quality as string)
    || !tableSize(source.playerCount)
    || !canonicalRoles(source.rolesInPlay, source.playerCount as number)
    || !scope
    || typeof scope !== 'object'
    || Array.isArray(scope)
    || !onlyAllowedKeys(scope, ['roleQueries', 'hiddenTeam'])
    || !denseArray(scope.roleQueries)
    || scope.roleQueries.length > MAX_IDENTITY_ROLE_QUERIES
    || typeof scope.hiddenTeam !== 'boolean'
    || !denseArray(snapshot.rolePosteriors)
    || snapshot.rolePosteriors.length !== scope.roleQueries.length
    || ((scope.hiddenTeam as boolean) !== (snapshot.hiddenTeamPosterior !== undefined))
    || (scope.roleQueries.length === 0 && !scope.hiddenTeam)
  ) return false

  const playerCount = source.playerCount as number
  const rolesInPlay = source.rolesInPlay as Role[]
  const castCounts = roleMultisetCounts(rolesInPlay)
  const scopeKeys: string[] = []
  const scopeQueries = scope.roleQueries as unknown[]
  for (const value of scopeQueries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const query = value as Record<string, unknown>
    if (
      !onlyAllowedKeys(query, ['queryKey', 'queriedRoles'])
      || typeof query.queryKey !== 'string'
      || !Array.isArray(query.queriedRoles)
    ) return false
    let canonical: CanonicalQuery
    try {
      canonical = canonicalQuery(query.queriedRoles as Role[])
      validateQueryAgainstCast(canonical, castCounts, playerCount)
    } catch {
      return false
    }
    if (canonical.queryKey !== query.queryKey) return false
    scopeKeys.push(canonical.queryKey)
  }
  if (
    new Set(scopeKeys).size !== scopeKeys.length
    || scopeKeys.some((key, index) => index > 0 && scopeKeys[index - 1] >= key)
  ) return false

  for (let index = 0; index < snapshot.rolePosteriors.length; index++) {
    const value = snapshot.rolePosteriors[index]
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const posterior = value as Record<string, unknown>
    const scopeQuery = scopeQueries[index] as Record<string, unknown>
    if (
      !onlyAllowedKeys(posterior, ['queryKey', 'queriedRoles', 'hypotheses'])
      || posterior.queryKey !== scopeQuery.queryKey
      || JSON.stringify(posterior.queriedRoles)
        !== JSON.stringify(scopeQuery.queriedRoles)
      || !denseArray(posterior.hypotheses)
    ) return false
    const hypotheses = posterior.hypotheses as Record<string, unknown>[]
    let priorKey = ''
    for (const hypothesis of hypotheses) {
      if (
        !hypothesis
        || typeof hypothesis !== 'object'
        || Array.isArray(hypothesis)
        || !onlyAllowedKeys(hypothesis, ['assignments', 'probability'])
        || !positiveProbability(hypothesis.probability)
        || !denseArray(hypothesis.assignments)
      ) return false
      const assignments = hypothesis.assignments as Record<string, unknown>[]
      const roles = posterior.queriedRoles as Role[]
      const counts = roleMultisetCounts(roles)
      if (assignments.length !== counts.size) return false
      const assignedSeats = new Set<Seat>()
      for (const [assignmentIndex, assignment] of assignments.entries()) {
        const expected = [...counts.entries()][assignmentIndex]
        if (
          !assignment
          || typeof assignment !== 'object'
          || Array.isArray(assignment)
          || !onlyAllowedKeys(assignment, ['role', 'seats'])
          || assignment.role !== expected[0]
          || !canonicalSeats(assignment.seats, playerCount)
          || assignment.seats.length !== expected[1]
        ) return false
        for (const seat of assignment.seats as Seat[]) {
          if (assignedSeats.has(seat)) return false
          assignedSeats.add(seat)
        }
      }
      const key = assignmentKey(assignments as unknown as CanonicalRoleAssignment[])
      if (priorKey && priorKey >= key) return false
      priorKey = key
    }
    if (!validProbabilityLattice(hypotheses)) return false
  }

  if (snapshot.hiddenTeamPosterior !== undefined) {
    const posterior = snapshot.hiddenTeamPosterior as Record<string, unknown>
    if (
      !posterior
      || typeof posterior !== 'object'
      || Array.isArray(posterior)
      || !onlyAllowedKeys(posterior, ['hypotheses'])
      || !denseArray(posterior.hypotheses)
    ) return false
    const hypotheses = posterior.hypotheses as Record<string, unknown>[]
    let priorKey = ''
    let hiddenTeamSize: number | undefined
    for (const hypothesis of hypotheses) {
      if (
        !hypothesis
        || typeof hypothesis !== 'object'
        || Array.isArray(hypothesis)
        || !onlyAllowedKeys(hypothesis, ['evilSeats', 'probability'])
        || !positiveProbability(hypothesis.probability)
        || !canonicalSeats(hypothesis.evilSeats, playerCount)
        || hypothesis.evilSeats.length !== EVIL_COUNT[playerCount]
      ) return false
      const key = (hypothesis.evilSeats as Seat[]).join('.')
      if (priorKey && priorKey >= key) return false
      priorKey = key
      hiddenTeamSize ??= (hypothesis.evilSeats as Seat[]).length
      if ((hypothesis.evilSeats as Seat[]).length !== hiddenTeamSize) return false
    }
    if (!validProbabilityLattice(hypotheses)) return false
  }
  return reconcilesRoleAndTeamPosteriors(snapshot, rolesInPlay, playerCount)
}

/**
 * Binds an otherwise valid private identity payload to its host cast and the
 * belief marginals carried by the same trace. Call this at every transport or
 * artifact boundary that has those independent authorities.
 */
export function validatePrivateIdentityHostJoin(
  value: unknown,
  hostRolesInPlay: unknown,
  beliefPlayerMarginals: unknown,
): value is PrivateIdentitySnapshot {
  if (!validatePrivateIdentitySnapshot(value)) return false
  const playerCount = value.sourceBelief.playerCount
  // Deliberately not canonicalRoles, per that guard's own note about laxer
  // checks: the host cast arrives in the host's seat order, not canonical order,
  // and it is reconciled as a multiset below. Requiring canonical order here
  // would reject a perfectly legal host join.
  if (
    !denseArray(hostRolesInPlay)
    || hostRolesInPlay.length !== playerCount
    || !hostRolesInPlay.every(isRole)
  ) return false
  const hostRoles = hostRolesInPlay as Role[]
  try {
    validateRoles(playerCount, [...hostRoles])
  } catch {
    return false
  }
  if (
    !sameRoleCounts(
      roleMultisetCounts(value.sourceBelief.rolesInPlay),
      roleMultisetCounts(hostRoles),
    )
  ) return false

  if (
    !denseArray(beliefPlayerMarginals)
    || beliefPlayerMarginals.length !== playerCount
  ) return false
  const marginals = beliefPlayerMarginals as PlayerMarginal[]
  if (
    marginals.some(
      (marginal, seat) =>
        !marginal
        || typeof marginal !== 'object'
        || Array.isArray(marginal)
        || marginal.seat !== seat
        || !probability(marginal.goodProbability)
        || !probability(marginal.evilProbability)
        || Math.abs(
          marginal.goodProbability + marginal.evilProbability - 1,
        ) > PROBABILITY_TOLERANCE,
    )
  ) return false

  if (!value.hiddenTeamPosterior) return true
  const evilBySeat = hiddenTeamEvilMarginals(
    value.hiddenTeamPosterior,
    playerCount,
  )
  return marginals.every(
    (marginal, seat) =>
      Math.abs(marginal.evilProbability - evilBySeat[seat])
      <= PROBABILITY_TOLERANCE,
  )
}
