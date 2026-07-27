import type { Role, Seat } from '../../engine/types.ts'
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
  const joint = projectUniformJointWorlds(
    record.playerCount,
    record.rolesInPlay,
    (visit) => visitCanonicalWorlds(
      {
        playerCount: record.playerCount,
        rolesInPlay: record.rolesInPlay,
      },
      (world) => {
        if (worldSatisfiesQuestEvidence(world, questEvidence)) visit(world)
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
  }
  exactProjectionCache.set(key, projection)
  while (exactProjectionCache.size > PUBLIC_OBSERVER_CACHE_LIMIT) {
    const oldest = exactProjectionCache.keys().next().value
    if (oldest !== undefined) exactProjectionCache.delete(oldest)
  }
  return projection
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
  return snapshot.seats.every((value, seat) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const assessment = value as Record<string, unknown>
    const roles = assessment.roleMarginals
    const behavior = assessment.behavior as Record<string, unknown>
    if (
      !exactKeys(assessment, [
        'seat',
        'goodProbability',
        'evilProbability',
        'roleMarginals',
        'behavior',
      ])
      || assessment.seat !== seat
      || !probability(assessment.goodProbability)
      || !probability(assessment.evilProbability)
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
    const seen = new Set<string>()
    let total = 0
    for (const roleValue of roles) {
      if (
        !roleValue
        || typeof roleValue !== 'object'
        || Array.isArray(roleValue)
      ) return false
      const marginal = roleValue as Record<string, unknown>
      if (
        !exactKeys(marginal, ['role', 'probability'])
        || typeof marginal.role !== 'string'
        || !CANONICAL_ROLE_ORDER.includes(marginal.role as Role)
        || seen.has(marginal.role)
        || !probability(marginal.probability)
      ) return false
      seen.add(marginal.role)
      total += marginal.probability
    }
    return roles.length > 0 && Math.abs(total - 1) <= 1e-12
  })
}
