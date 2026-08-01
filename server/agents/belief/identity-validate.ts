// The transport and artifact admission boundary for a projected private
// identity. Everything here validates from `unknown`: it re-derives the
// canonical query keys, re-checks the probability lattices, and reconciles the
// role and team posteriors against each other and against an independent host
// cast. It never produces a snapshot, only accepts or rejects one.

import {
  EVIL_COUNT,
  ROLE_ALIGNMENT,
  validateRoles,
} from '../../engine/rules.ts'
import { isRole } from '../../engine/types.ts'
import type { Role, Seat } from '../../engine/types.ts'
import type { PlayerMarginal } from './types.ts'
import {
  canonicalRoles,
  canonicalSeats,
  denseArray,
  onlyAllowedKeys,
  probability,
  tableSize,
} from '../canonical/canonical-shape.ts'
import {
  PROBABILITY_TOLERANCE,
  stableProbabilitySum,
} from '../canonical/probability-arithmetic.ts'
import {
  assignmentKey,
  canonicalQuery,
  hiddenTeamEvilMarginals,
  JOINT_IDENTITY_MODEL_VERSION,
  MAX_IDENTITY_HYPOTHESES_PER_POSTERIOR,
  MAX_IDENTITY_ROLE_QUERIES,
  roleMultisetCounts,
  sameRoleCounts,
  validateQueryAgainstCast,
  type CanonicalQuery,
  type CanonicalRoleAssignment,
  type HiddenTeamPosterior,
  type PrivateIdentitySnapshot,
  type RoleIdentityPosterior,
} from './identity-project.ts'

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
          const currentMass = marginal[seat]
          if (currentMass === undefined) return false
          marginal[seat] = currentMass + hypothesis.probability
        }
      }
      const existing = marginalsByRole.get(role)
      if (
        existing
        && existing.some(
          (recorded, seat) =>
            marginal[seat] === undefined
            || Math.abs(recorded - marginal[seat]) > PROBABILITY_TOLERANCE,
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
      const roleProbabilities = queriedRoles.map(
        (role) => marginalsByRole.get(role)?.[seat],
      )
      const evilProbability = evilBySeat[seat]
      if (
        evilProbability === undefined
        || roleProbabilities.some((marginalValue) => marginalValue === undefined)
      ) return false
      let roleProbability = 0
      for (const marginalValue of roleProbabilities) {
        if (marginalValue === undefined) return false
        roleProbability += marginalValue
      }
      const alignmentProbability = alignment === 'evil'
        ? evilProbability
        : 1 - evilProbability
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

/**
 * Validate the scope's role queries: each is a well-formed, cast-consistent
 * canonical query whose key it restates, and the keys are collectively distinct
 * and strictly ascending.
 */
function validateScopeQueries(
  scopeQueries: readonly unknown[],
  castCounts: ReadonlyMap<Role, number>,
  playerCount: number,
): boolean {
  const scopeKeys: string[] = []
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
  return new Set(scopeKeys).size === scopeKeys.length
    && !scopeKeys.some((key, index) => {
      const previous = scopeKeys[index - 1]
      return index > 0 && previous !== undefined && previous >= key
    })
}

/**
 * Validate one role posterior against its scope query: matching key and role
 * multiset, canonical assignments that partition distinct seats in ascending
 * key order, and a valid probability lattice.
 */
function validateRolePosterior(
  value: unknown,
  scopeQuery: Record<string, unknown>,
  playerCount: number,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const posterior = value as Record<string, unknown>
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
      if (!expected) return false
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
  return validProbabilityLattice(hypotheses)
}

/**
 * Validate the optional hidden-team posterior: an evil-seat set of the cast's
 * evil size per hypothesis, distinct and ascending by key, one team size
 * throughout, and a valid probability lattice.
 */
function validateHiddenTeamPosterior(
  value: unknown,
  playerCount: number,
): boolean {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !onlyAllowedKeys(value as Record<string, unknown>, ['hypotheses'])
    || !denseArray((value as Record<string, unknown>).hypotheses)
  ) return false
  const hypotheses = (value as Record<string, unknown>)
    .hypotheses as Record<string, unknown>[]
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
  return validProbabilityLattice(hypotheses)
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
  const scopeQueries = scope.roleQueries as unknown[]
  if (!validateScopeQueries(scopeQueries, castCounts, playerCount)) return false

  for (let index = 0; index < snapshot.rolePosteriors.length; index++) {
    if (
      !validateRolePosterior(
        snapshot.rolePosteriors[index],
        scopeQueries[index] as Record<string, unknown>,
        playerCount,
      )
    ) return false
  }

  if (
    snapshot.hiddenTeamPosterior !== undefined
    && !validateHiddenTeamPosterior(snapshot.hiddenTeamPosterior, playerCount)
  ) return false
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
    (marginal, seat) => {
      const evilProbability = evilBySeat[seat]
      return evilProbability !== undefined
        && Math.abs(marginal.evilProbability - evilProbability)
          <= PROBABILITY_TOLERANCE
    },
  )
}
