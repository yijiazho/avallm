import type { Role, Seat } from '../../engine/types.ts'
import { proposalVotes } from '../../engine/rules.ts'
import { hasDistinctSeats } from '../../engine/seatset.ts'
import {
  questFailEvidenceFromQuests,
  worldSatisfiesQuestEvidence,
} from '../belief/quest-constraints.ts'
import {
  canonicalRoleMultiset,
  visitCanonicalWorlds,
} from '../belief/worlds.ts'
import { projectUniformJointWorlds } from '../belief/projection.ts'
import type { PublicRecord } from '../record/public-record.ts'
import {
  PUBLIC_BEHAVIOR_READING_VERSION,
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicBehaviorReading,
  type PublicJointTeamAssessment,
  type PublicAlignmentMaskCount,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import { LEGAL_TEAM_CANDIDATE_BOUND } from '../canonical/canonical-shape.ts'

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
  evilMaskCounts: readonly PublicAlignmentMaskCount[]
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
          .map((marginal) => ({
            role: marginal.role,
            probability: marginal.probability,
          })),
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
    || teams.length > LEGAL_TEAM_CANDIDATE_BOUND
  ) {
    throw new Error('public joint team query exceeds the legal candidate bound')
  }
  return teams.map((rawTeam) => {
    const team = [...rawTeam].sort((left, right) => left - right)
    if (
      team.length === 0
      || team.length > record.playerCount
      || !hasDistinctSeats(team)
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
  const votes = proposals.flatMap((proposal) => proposalVotes(proposal))
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

// The strict JSON boundary (validatePublicObserverSnapshot and its section
// validators) lives in observer-validate.ts. It depends on nothing here, so it
// is re-exported below rather than imported back.
export { validatePublicObserverSnapshot } from './observer-validate.ts'
