import type { Role, Seat } from '../../engine/types.ts'
import {
  ROLE_ALIGNMENT,
  validateRoles,
} from '../../engine/rules.ts'
import {
  questFailEvidenceFromQuests,
  worldSatisfiesQuestEvidence,
} from '../belief/quest-constraints.ts'
import {
  canonicalRoleMultiset,
  visitCanonicalWorlds,
} from '../belief/worlds.ts'
import { CANONICAL_ROLE_ORDER } from '../belief/types.ts'
import { projectUniformJointWorlds } from '../belief/projection.ts'
import type { PublicRecord } from '../communication/public-record.ts'
import {
  PUBLIC_BEHAVIOR_READING_VERSION,
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicBehaviorReading,
  type PublicJointTeamAssessment,
  type PublicAlignmentMaskCount,
  type PublicObserverSnapshot,
} from './observer-types.ts'

const PUBLIC_OBSERVER_CACHE_LIMIT = 16
const exactProjectionCache = new Map<string, {
  feasibleWorldCount: number
  entropy: number
  seats: readonly {
    seat: Seat
    goodProbability: number
    evilProbability: number
    roleMarginals: readonly { role: Role; probability: number }[]
  }[]
  /** Compact public-only alignment histogram; never serialized. */
  evilMaskCounts: readonly { mask: number; count: number }[]
}>()

function exactCacheKey(record: PublicRecord): string {
  const quests = record.quests
    .filter((quest) =>
      quest.result !== undefined
      && quest.team !== undefined
      && (quest.failCount ?? (quest.result === 'fail' ? 1 : 0)) > 0)
    .map((quest) => [
      quest.num,
      [...quest.team!].sort((a, b) => a - b),
      quest.failCount ?? 1,
    ])
  return JSON.stringify([
    record.playerCount,
    canonicalRoleMultiset(record.rolesInPlay),
    quests,
  ])
}

function exactProjection(record: PublicRecord) {
  const key = exactCacheKey(record)
  const cached = exactProjectionCache.get(key)
  if (cached) {
    exactProjectionCache.delete(key)
    exactProjectionCache.set(key, cached)
    return cached
  }

  const questEvidence = questFailEvidenceFromQuests(record.quests)
  const evilMaskCounts = new Map<number, number>()
  const joint = projectUniformJointWorlds(
    record.playerCount,
    record.rolesInPlay,
    (visit) => visitCanonicalWorlds(
      {
        playerCount: record.playerCount,
        rolesInPlay: record.rolesInPlay,
      },
      (world) => {
        if (worldSatisfiesQuestEvidence(world, questEvidence)) {
          const mask = world.alignmentBySeat.reduce(
            (mask, alignment, seat) =>
              alignment === 'evil' ? mask | (1 << seat) : mask,
            0,
          )
          evilMaskCounts.set(mask, (evilMaskCounts.get(mask) ?? 0) + 1)
          visit(world)
        }
      },
    ),
  )
  const projection = {
    feasibleWorldCount: joint.worldCount,
    entropy: joint.entropy,
    seats: Array.from({ length: record.playerCount }, (_, seat) => {
      const player = joint.playerMarginals[seat]
      return {
        seat,
        goodProbability: player.goodProbability,
        evilProbability: player.evilProbability,
        roleMarginals: joint.roleMarginals
          .filter((marginal) => marginal.seat === seat)
          .map(({ role, probability }) => ({ role, probability })),
      }
    }),
    evilMaskCounts: [...evilMaskCounts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([mask, count]) => ({ mask, count })),
  }
  exactProjectionCache.set(key, projection)
  while (exactProjectionCache.size > PUBLIC_OBSERVER_CACHE_LIMIT) {
    const oldest = exactProjectionCache.keys().next().value
    if (oldest !== undefined) exactProjectionCache.delete(oldest)
  }
  return projection
}

/**
 * Exact public pre-action joint team quantities. This reuses the observer's
 * cached feasible-world masks and never multiplies independent seat marginals.
 */
export function assessPublicJointTeams(
  record: PublicRecord,
  teams: readonly (readonly Seat[])[],
): readonly PublicJointTeamAssessment[] {
  const exact = exactProjection(record)
  if (
    !Array.isArray(teams)
    || Object.keys(teams).length !== teams.length
    || teams.some(
      (team) =>
        !Array.isArray(team)
        || Object.keys(team).length !== team.length,
    )
    || teams.length > 252
  ) {
    throw new Error('public joint team query exceeds the legal candidate bound')
  }
  return teams.map((rawTeam) => {
    const team = [...rawTeam].sort((left, right) => left - right)
    if (
      team.length === 0
      || team.length > record.playerCount
      || new Set(team).size !== team.length
      || team.some(
        (seat) =>
          !Number.isSafeInteger(seat)
          || seat < 0
          || seat >= record.playerCount,
      )
    ) {
      throw new Error('public joint team query contains an invalid team')
    }
    const distribution = Array<number>(team.length + 1).fill(0)
    const teamMask = team.reduce((mask, seat) => mask | (1 << seat), 0)
    for (const { mask, count: worldCount } of exact.evilMaskCounts) {
      let aboard = mask & teamMask
      let count = 0
      while (aboard) {
        aboard &= aboard - 1
        count += 1
      }
      distribution[count] += worldCount
    }
    return {
      team,
      probabilitySemantics: 'public-preaction-uniform-feasible-joint',
      cleanProbability: distribution[0] / exact.feasibleWorldCount,
      evilCountDistribution: distribution.map(
        (count) => count / exact.feasibleWorldCount,
      ),
    }
  })
}

/** Detached compact support used by exact public joint queries and tests. */
export function publicAlignmentMaskHistogram(
  record: PublicRecord,
): readonly PublicAlignmentMaskCount[] {
  return exactProjection(record).evilMaskCounts.map((entry) => ({ ...entry }))
}

const boundedRatio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

function behaviorFor(record: PublicRecord, seat: Seat): PublicBehaviorReading {
  const proposals = record.proposals
  const votes = proposals.flatMap((proposal) => proposal.votes ?? [])
  const seatVotes = votes.filter((vote) => vote.seat === seat)
  const questParticipations = record.quests.filter(
    (quest) => quest.result !== undefined && quest.team?.includes(seat),
  )
  return {
    version: PUBLIC_BEHAVIOR_READING_VERSION,
    semantics: 'bounded-deterministic-indices-not-probabilities',
    proposalLeadershipCount: proposals.filter(
      (proposal) => proposal.leader === seat,
    ).length,
    proposalSelectionIndex: boundedRatio(
      proposals.filter((proposal) => proposal.team.includes(seat)).length,
      proposals.length,
    ),
    approvalIndex: boundedRatio(
      seatVotes.filter((vote) => vote.vote === 'approve').length,
      seatVotes.length,
    ),
    failedQuestExposureIndex: boundedRatio(
      questParticipations.filter((quest) => quest.result === 'fail').length,
      questParticipations.length,
    ),
  }
}

/**
 * Exact public observer. Its only runtime input is the canonical PublicRecord.
 * Behavioral indices are returned beside, and never applied to, the uniform
 * complete-world posterior.
 */
export function observePublicRecord(
  record: PublicRecord,
): PublicObserverSnapshot {
  const exact = exactProjection(record)
  return {
    version: PUBLIC_OBSERVER_MODEL_VERSION,
    probabilitySemantics: 'uniform-public-feasible-joint',
    behavioralSemantics: 'bounded-deterministic-indices-not-probabilities',
    playerCount: record.playerCount,
    feasibleWorldCount: exact.feasibleWorldCount,
    entropy: exact.entropy,
    seats: exact.seats.map((seat) => ({
      seat: seat.seat,
      goodProbability: seat.goodProbability,
      evilProbability: seat.evilProbability,
      roleMarginals: seat.roleMarginals.map((marginal) => ({ ...marginal })),
      behavior: behaviorFor(record, seat.seat),
    })),
  }
}

const probability = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= 1

const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key))

// Validate in count space, where an exact uniform marginal is an integer number
// of feasible worlds divided by feasibleWorldCount. Sixteen denominator-scaled
// machine epsilons admit ordinary division round trips while keeping one-world
// snapshots effectively exact instead of granting them a fixed decimal slack.
const PUBLIC_OBSERVER_COUNT_ULP_MULTIPLIER = 16
const PUBLIC_OBSERVER_PROBABILITY_TOLERANCE = 1e-12

function factorial(value: number): number {
  let result = 1
  for (let factor = 2; factor <= value; factor++) result *= factor
  return result
}

function latticeCount(
  value: unknown,
  feasibleWorldCount: number,
): number | undefined {
  if (!probability(value)) return undefined
  const scaled = value * feasibleWorldCount
  const nearest = Math.round(scaled)
  const tolerance = PUBLIC_OBSERVER_COUNT_ULP_MULTIPLIER
    * Number.EPSILON
    * feasibleWorldCount
  return Math.abs(scaled - nearest) <= tolerance
    ? nearest
    : undefined
}

/** Strict JSON boundary used by stdio and persisted-artifact readers. */
export function validatePublicObserverSnapshot(
  value: unknown,
): value is PublicObserverSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Record<string, unknown>
  if (
    !exactKeys(snapshot, [
      'version',
      'probabilitySemantics',
      'behavioralSemantics',
      'playerCount',
      'feasibleWorldCount',
      'entropy',
      'seats',
    ])
    || snapshot.version !== PUBLIC_OBSERVER_MODEL_VERSION
    || snapshot.probabilitySemantics !== 'uniform-public-feasible-joint'
    || snapshot.behavioralSemantics
      !== 'bounded-deterministic-indices-not-probabilities'
    || !Number.isInteger(snapshot.playerCount)
    || (snapshot.playerCount as number) < 5
    || (snapshot.playerCount as number) > 10
    || !Number.isSafeInteger(snapshot.feasibleWorldCount)
    || (snapshot.feasibleWorldCount as number) <= 0
    || typeof snapshot.entropy !== 'number'
    || !Number.isFinite(snapshot.entropy)
    || Math.abs(
      snapshot.entropy
      - Math.log2(snapshot.feasibleWorldCount as number),
    ) > 1e-12
    || !Array.isArray(snapshot.seats)
    || snapshot.seats.length !== snapshot.playerCount
  ) {
    return false
  }

  const playerCount = snapshot.playerCount as number
  const feasibleWorldCount = snapshot.feasibleWorldCount as number
  // No role multiset can produce more distinct assignments than n!; reject
  // impossible or unsafe denominators before multiplying any marginal by it.
  if (feasibleWorldCount > factorial(playerCount)) return false
  let sharedRoles: readonly Role[] | undefined
  const roleWorldOccurrences = new Map<Role, number>()
  let goodWorldOccurrences = 0
  let evilWorldOccurrences = 0

  for (let seat = 0; seat < playerCount; seat++) {
    const seatValue = snapshot.seats[seat]
    if (
      !seatValue
      || typeof seatValue !== 'object'
      || Array.isArray(seatValue)
    ) return false
    const assessment = seatValue as Record<string, unknown>
    const roles = assessment.roleMarginals
    const behavior = assessment.behavior as Record<string, unknown>
    const goodCount = latticeCount(
      assessment.goodProbability,
      feasibleWorldCount,
    )
    const evilCount = latticeCount(
      assessment.evilProbability,
      feasibleWorldCount,
    )
    if (
      !exactKeys(assessment, [
        'seat',
        'goodProbability',
        'evilProbability',
        'roleMarginals',
        'behavior',
      ])
      || assessment.seat !== seat
      || goodCount === undefined
      || evilCount === undefined
      || Math.abs(
        assessment.goodProbability + assessment.evilProbability - 1,
      ) > 1e-12
      || !Array.isArray(roles)
      || !behavior
      || typeof behavior !== 'object'
      || Array.isArray(behavior)
      || !exactKeys(behavior, [
        'version',
        'semantics',
        'proposalLeadershipCount',
        'proposalSelectionIndex',
        'approvalIndex',
        'failedQuestExposureIndex',
      ])
      || behavior.version !== PUBLIC_BEHAVIOR_READING_VERSION
      || behavior.semantics
        !== 'bounded-deterministic-indices-not-probabilities'
      || !Number.isSafeInteger(behavior.proposalLeadershipCount)
      || (behavior.proposalLeadershipCount as number) < 0
      || !probability(behavior.proposalSelectionIndex)
      || !probability(behavior.approvalIndex)
      || !probability(behavior.failedQuestExposureIndex)
    ) {
      return false
    }

    if (roles.length === 0) return false
    const seatRoles: Role[] = []
    let seatWorldOccurrences = 0
    let seatGoodWorldOccurrences = 0
    let seatEvilWorldOccurrences = 0
    let seatProbabilityTotal = 0
    let seatGoodProbability = 0
    let seatEvilProbability = 0
    let previousRoleRank = -1
    for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
      const roleValue = roles[roleIndex]
      if (
        !roleValue
        || typeof roleValue !== 'object'
        || Array.isArray(roleValue)
      ) return false
      const marginal = roleValue as Record<string, unknown>
      const role = marginal.role as Role
      const canonicalRank = CANONICAL_ROLE_ORDER.indexOf(role)
      const count = latticeCount(marginal.probability, feasibleWorldCount)
      if (
        !exactKeys(marginal, ['role', 'probability'])
        || typeof marginal.role !== 'string'
        || canonicalRank < 0
        || canonicalRank <= previousRoleRank
        || count === undefined
      ) return false
      previousRoleRank = canonicalRank
      seatRoles.push(role)
      seatWorldOccurrences += count
      const aggregateRoleOccurrences =
        (roleWorldOccurrences.get(role) ?? 0) + count
      if (!Number.isSafeInteger(aggregateRoleOccurrences)) return false
      roleWorldOccurrences.set(role, aggregateRoleOccurrences)
      const roleProbability = marginal.probability as number
      seatProbabilityTotal += roleProbability
      if (ROLE_ALIGNMENT[role] === 'good') {
        seatGoodWorldOccurrences += count
        seatGoodProbability += roleProbability
      } else {
        seatEvilWorldOccurrences += count
        seatEvilProbability += roleProbability
      }
    }
    if (
      !Number.isSafeInteger(seatWorldOccurrences)
      || !Number.isSafeInteger(seatGoodWorldOccurrences)
      || !Number.isSafeInteger(seatEvilWorldOccurrences)
      || seatWorldOccurrences !== feasibleWorldCount
      || seatGoodWorldOccurrences !== goodCount
      || seatEvilWorldOccurrences !== evilCount
      || Math.abs(seatProbabilityTotal - 1)
        > PUBLIC_OBSERVER_PROBABILITY_TOLERANCE
      || Math.abs(
        seatGoodProbability - (assessment.goodProbability as number),
      ) > PUBLIC_OBSERVER_PROBABILITY_TOLERANCE
      || Math.abs(
        seatEvilProbability - (assessment.evilProbability as number),
      ) > PUBLIC_OBSERVER_PROBABILITY_TOLERANCE
    ) return false
    if (sharedRoles === undefined) {
      sharedRoles = seatRoles
    } else if (
      seatRoles.length !== sharedRoles.length
      || seatRoles.some((role, index) => role !== sharedRoles![index])
    ) return false
    goodWorldOccurrences += goodCount
    evilWorldOccurrences += evilCount
    if (
      !Number.isSafeInteger(goodWorldOccurrences)
      || !Number.isSafeInteger(evilWorldOccurrences)
    ) return false
  }

  if (!sharedRoles) return false
  const reconstructedRoles: Role[] = []
  const reconstructedRoleCounts = new Map<Role, number>()
  for (const role of sharedRoles) {
    const occurrences = roleWorldOccurrences.get(role) ?? 0
    if (occurrences % feasibleWorldCount !== 0) return false
    const roleCount = occurrences / feasibleWorldCount
    if (!Number.isSafeInteger(roleCount) || roleCount <= 0) return false
    reconstructedRoleCounts.set(role, roleCount)
    reconstructedRoles.push(...Array<Role>(roleCount).fill(role))
  }
  if (reconstructedRoles.length !== playerCount) return false
  try {
    validateRoles(playerCount, reconstructedRoles)
  } catch {
    return false
  }

  const repeatedRoleDivisor = [...reconstructedRoleCounts.values()].reduce(
    (product, roleCount) => product * factorial(roleCount),
    1,
  )
  const maximumDistinctWorlds =
    factorial(playerCount) / repeatedRoleDivisor
  if (
    !Number.isSafeInteger(maximumDistinctWorlds)
    || feasibleWorldCount > maximumDistinctWorlds
  ) return false

  const reconstructedGood = reconstructedRoles.filter(
    (role) => ROLE_ALIGNMENT[role] === 'good',
  ).length
  const reconstructedEvil = playerCount - reconstructedGood
  return goodWorldOccurrences === reconstructedGood * feasibleWorldCount
    && evilWorldOccurrences === reconstructedEvil * feasibleWorldCount
}
