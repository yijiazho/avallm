import { isDeepStrictEqual } from 'node:util'
import type {
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import type { PolicyCandidate } from '../policy/types.ts'
import {
  assessPublicJointTeams,
  observePublicRecord,
} from './observer.ts'
import type { PublicObserverSnapshot } from './observer-types.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from './observer-types.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
  type CandidatePublicCommitment,
  type MerlinCandidateObjective,
  type PercivalCandidateObjective,
  type PrivateRoleObjectiveSnapshot,
  type RoleObjectiveRole,
} from './role-objective-types.ts'
import {
  denseArray,
  exactKeys,
  plainDataRecord as plainRecord,
  probability,
} from '../components/canonical-shape.ts'
import { validatePrivateRoleObjectiveSnapshot } from './role-objectives.ts'
import { projectPublicRecord } from '../communication/public-record.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'

export const ROLE_UTILITY_PROJECTION_VERSION =
  'merlin-percival-role-utility-v1'
export const ROLE_UTILITY_DEGRADATION =
  'role-utility-projection-failed'
export const ROLE_UTILITY_VALUE_SEMANTICS =
  'bounded-deterministic-heuristic-utility-not-probability'

export const ROLE_UTILITY_CONSTANTS = Object.freeze({
  primaryInfluenceWeight: 0.75,
  concealmentOrDecoyWeight: 0.25,
  exposureTellWeight: 0.50,
  exposureAmbiguityWeight: 0.25,
  exposureOwnSalienceWeight: 0.25,
})

interface RoleUtilitySource {
  roleObjectiveVersion: typeof ROLE_OBJECTIVE_MODEL_VERSION
  observerModelVersion: string
  beliefModelVersion: string
  beliefThroughSeq: number
  playerCount: number
}

interface RoleUtilityRequest {
  seat: Seat
  kind: 'propose' | 'vote'
  round: number
  proposalNum: number
  failsRequired: number
}

interface RoleUtilityAssessmentBase {
  candidateId: string
  kind: 'propose' | 'vote'
  role: RoleObjectiveRole
  direction: CandidatePublicCommitment['direction']
  team: readonly Seat[]
  valueSemantics: typeof ROLE_UTILITY_VALUE_SEMANTICS
  roleValue: number
}

export interface MerlinRoleUtilityAssessment
  extends RoleUtilityAssessmentBase {
  role: 'merlin'
  privateProbabilitySemantics: 'resolved-complete-world-sum'
  publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint'
  teamCleanProbability: number
  teamFailureCapabilityProbability: number
  privateInfluenceValue: number
  publicTeamCleanProbability: number
  publicTeamFailureCapabilityProbability: number
  publicEvilCountDistribution: readonly number[]
  publicInfluenceValue: number
  directionalKnowledgeTellIndex: number
  publicDecisionAmbiguityIndex: number
  ownPublicSalienceIndex: number
  correctedExposureProxyIndex: number
}

export interface PercivalRoleUtilityAssessment
  extends RoleUtilityAssessmentBase {
  role: 'percival'
  probabilitySemantics: 'resolved-complete-world-sum'
  pairInfluenceValue: number
  selfDecoyOpportunityProxyIndex: number
  merlinMimicryProxyIndex: number
}

export type RoleUtilityAssessment =
  | MerlinRoleUtilityAssessment
  | PercivalRoleUtilityAssessment

export interface PrivateRoleUtilityProjection {
  version: typeof ROLE_UTILITY_PROJECTION_VERSION
  role: RoleObjectiveRole
  source: RoleUtilitySource
  request: RoleUtilityRequest
  assessments: readonly RoleUtilityAssessment[]
}

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value))

const boundedInfluence = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= -1
  && value <= 1

function candidateDirectionSign(
  candidate: CandidatePublicCommitment,
): number {
  return candidate.direction === 'support'
    ? 1
    : candidate.direction === 'oppose' ? -1 : 0
}

function ownPublicSalience(
  observer: PublicObserverSnapshot,
  viewerSeat: Seat,
  record: ReturnType<typeof projectPublicRecord>,
): number {
  const own = observer.seats[viewerSeat]
  if (!own) throw new Error('role utility observer lacks the viewer seat')
  const completedVote = record.proposals.some(
    (proposal) => proposal.votes?.length === record.playerCount,
  )
  const behavior = own.behavior
  // Approval direction is only meaningful after at least one complete public
  // ballot. Before then it contributes exactly zero instead of treating the
  // observer's zero default as an extreme vote.
  const approvalSalience = completedVote
    ? Math.abs(behavior.approvalIndex - 0.5) * 2
    : 0
  const behaviorSalience = (
    behavior.proposalSelectionIndex
    + behavior.failedQuestExposureIndex
    + approvalSalience
  ) / 3
  return clamp01((own.goodProbability + behaviorSalience) / 2)
}

function assessmentMap(
  objective: PrivateRoleObjectiveSnapshot,
): ReadonlyMap<string, MerlinCandidateObjective | PercivalCandidateObjective> {
  const map = new Map<string, MerlinCandidateObjective | PercivalCandidateObjective>()
  for (const assessment of objective.objective.assessments) {
    if (map.has(assessment.candidate.candidateId)) {
      throw new Error('role utility received duplicate objective candidates')
    }
    map.set(assessment.candidate.candidateId, assessment)
  }
  return map
}

interface RoleUtilityProjectionInput {
  req: DecisionRequest
  view: PlayerView
  objective: PrivateRoleObjectiveSnapshot
  observer: PublicObserverSnapshot
  candidates: readonly PolicyCandidate[]
}

function buildRoleUtilityProjectionInternal(
  input: RoleUtilityProjectionInput,
  objectiveAlreadyAdmitted: boolean,
): PrivateRoleUtilityProjection {
  const { req, view, objective, observer, candidates } = input
  if (
    (req.kind !== 'propose' && req.kind !== 'vote')
    || (view.role !== 'merlin' && view.role !== 'percival')
    || objective.role !== view.role
    || (
      !objectiveAlreadyAdmitted
      && !validatePrivateRoleObjectiveSnapshot(objective)
    )
    || observer.playerCount !== view.playerCount
    || req.seat !== view.seat
  ) {
    throw new Error('role utility is inapplicable or has invalid sources')
  }
  const requestKind: 'propose' | 'vote' = req.kind
  const publicRecord = projectPublicRecord(view)
  if (!isDeepStrictEqual(observer, observePublicRecord(publicRecord))) {
    throw new Error('role utility public observer is not authoritative')
  }
  const objectives = assessmentMap(objective)
  if (
    candidates.length === 0
    || candidates.length > 252
    || objectives.size !== candidates.length
  ) {
    throw new Error('role utility requires the complete legal candidate surface')
  }
  const teams = candidates.map((candidate) => {
    if (candidate.kind !== req.kind) {
      throw new Error('role utility received a mixed candidate surface')
    }
    if (candidate.decision.kind === 'propose') return candidate.decision.team
    if (candidate.decision.kind === 'vote' && view.currentTeam) {
      return view.currentTeam
    }
    throw new Error('role utility candidate lacks a public team commitment')
  })
  const publicTeams = assessPublicJointTeams(publicRecord, teams)
  const ownSalience = ownPublicSalience(observer, view.seat, publicRecord)
  const failsRequired = view.quests[view.round - 1]?.failsRequired
  if (failsRequired !== 1 && failsRequired !== 2) {
    throw new Error('role utility lacks a legal quest failure threshold')
  }

  const assessments = candidates.map(
    (candidate, index): RoleUtilityAssessment => {
      const source = objectives.get(candidate.id)
      const publicTeam = publicTeams[index]
      if (
        !source
        || source.candidate.candidateId !== candidate.id
        || source.candidate.kind !== req.kind
      ) {
        throw new Error(`role utility objective join mismatch for ${candidate.id}`)
      }
      if (view.role === 'merlin') {
        if (source.probabilitySemantics !== 'resolved-complete-world-sum') {
          throw new Error('Merlin role utility received incompatible semantics')
        }
        const merlin = source as MerlinCandidateObjective
        const sign = candidateDirectionSign(merlin.candidate)
        const publicFailureCapability = publicTeam.evilCountDistribution
          .slice(failsRequired)
          .reduce((sum, value) => sum + value, 0)
        const publicInfluence =
          sign * (publicTeam.cleanProbability - publicFailureCapability)
        const tell = clamp01(
          Math.max(0, merlin.influenceValue - publicInfluence) / 2,
        )
        const ambiguity = clamp01(
          1 - Math.abs(
            publicTeam.cleanProbability - publicFailureCapability,
          ),
        )
        const exposure = clamp01(
          ROLE_UTILITY_CONSTANTS.exposureTellWeight * tell
          + ROLE_UTILITY_CONSTANTS.exposureAmbiguityWeight
            * Math.abs(sign) * ambiguity
          + ROLE_UTILITY_CONSTANTS.exposureOwnSalienceWeight * ownSalience,
        )
        const roleValue = clamp01(
          ROLE_UTILITY_CONSTANTS.primaryInfluenceWeight
            * ((merlin.influenceValue + 1) / 2)
          + ROLE_UTILITY_CONSTANTS.concealmentOrDecoyWeight * (1 - exposure),
        )
        return {
          candidateId: candidate.id,
          kind: requestKind,
          role: 'merlin',
          direction: merlin.candidate.direction,
          team: [...(merlin.candidate.team ?? [])],
          valueSemantics: ROLE_UTILITY_VALUE_SEMANTICS,
          privateProbabilitySemantics: merlin.probabilitySemantics,
          publicProbabilitySemantics: publicTeam.probabilitySemantics,
          teamCleanProbability: merlin.teamCleanProbability,
          teamFailureCapabilityProbability:
            merlin.teamFailureCapabilityProbability,
          privateInfluenceValue: merlin.influenceValue,
          publicTeamCleanProbability: publicTeam.cleanProbability,
          publicTeamFailureCapabilityProbability: publicFailureCapability,
          publicEvilCountDistribution: [...publicTeam.evilCountDistribution],
          publicInfluenceValue: publicInfluence,
          directionalKnowledgeTellIndex: tell,
          publicDecisionAmbiguityIndex: ambiguity,
          ownPublicSalienceIndex: ownSalience,
          correctedExposureProxyIndex: exposure,
          roleValue,
        }
      }
      const percival = source as PercivalCandidateObjective
      const roleValue = clamp01(
        ROLE_UTILITY_CONSTANTS.primaryInfluenceWeight
          * ((percival.pairInfluenceValue + 1) / 2)
        + ROLE_UTILITY_CONSTANTS.concealmentOrDecoyWeight
          * percival.selfDecoyOpportunityProxyIndex,
      )
      return {
        candidateId: candidate.id,
        kind: requestKind,
        role: 'percival',
        direction: percival.candidate.direction,
        team: [...(percival.candidate.team ?? [])],
        valueSemantics: ROLE_UTILITY_VALUE_SEMANTICS,
        probabilitySemantics: percival.probabilitySemantics,
        pairInfluenceValue: percival.pairInfluenceValue,
        selfDecoyOpportunityProxyIndex:
          percival.selfDecoyOpportunityProxyIndex,
        merlinMimicryProxyIndex: percival.merlinMimicryProxyIndex,
        roleValue,
      }
    },
  )
  return {
    version: ROLE_UTILITY_PROJECTION_VERSION,
    role: view.role,
    source: {
      roleObjectiveVersion: ROLE_OBJECTIVE_MODEL_VERSION,
      observerModelVersion: observer.version,
      beliefModelVersion: objective.source.beliefModelVersion,
      beliefThroughSeq: objective.source.beliefThroughSeq,
      playerCount: view.playerCount,
    },
    request: {
      seat: req.seat,
      kind: req.kind,
      round: req.round,
      proposalNum: req.proposalNum,
      failsRequired,
    },
    assessments,
  }
}

export function buildRoleUtilityProjection(
  input: RoleUtilityProjectionInput,
): PrivateRoleUtilityProjection {
  return buildRoleUtilityProjectionInternal(input, false)
}

/** Build from a component dependency already admitted by the kernel. */
export function buildAdmittedRoleUtilityProjection(
  input: RoleUtilityProjectionInput,
): PrivateRoleUtilityProjection {
  return buildRoleUtilityProjectionInternal(input, true)
}

function roleUtilitySchema(detached: unknown): boolean {
  {
    if (
      !plainRecord(detached)
      || !exactKeys(detached, [
        'version', 'role', 'source', 'request', 'assessments',
      ])
      || detached.version !== ROLE_UTILITY_PROJECTION_VERSION
      || !['merlin', 'percival'].includes(detached.role as string)
      || !plainRecord(detached.source)
      || !exactKeys(detached.source, [
        'roleObjectiveVersion',
        'observerModelVersion',
        'beliefModelVersion',
        'beliefThroughSeq',
        'playerCount',
      ])
      || detached.source.roleObjectiveVersion !== ROLE_OBJECTIVE_MODEL_VERSION
      || detached.source.observerModelVersion
        !== PUBLIC_OBSERVER_MODEL_VERSION
      || typeof detached.source.beliefModelVersion !== 'string'
      || !(detached.source.beliefModelVersion as string).length
      || !Number.isSafeInteger(detached.source.beliefThroughSeq)
      || (detached.source.beliefThroughSeq as number) < -1
      || typeof detached.source.playerCount !== 'number'
      || !Number.isSafeInteger(detached.source.playerCount)
      || (detached.source.playerCount as number) < 5
      || (detached.source.playerCount as number) > 10
      || !plainRecord(detached.request)
      || !exactKeys(detached.request, [
        'seat', 'kind', 'round', 'proposalNum', 'failsRequired',
      ])
      || !Number.isSafeInteger(detached.request.seat)
      || (detached.request.seat as number) < 0
      || (detached.request.seat as number)
        >= (detached.source.playerCount as number)
      || !['propose', 'vote'].includes(detached.request.kind as string)
      || !Number.isSafeInteger(detached.request.round)
      || (detached.request.round as number) < 1
      || (detached.request.round as number) > 5
      || !Number.isSafeInteger(detached.request.proposalNum)
      || (detached.request.proposalNum as number) < 1
      || (detached.request.proposalNum as number) > 5
      || ![1, 2].includes(detached.request.failsRequired as number)
      || !denseArray(detached.assessments)
      || detached.assessments.length === 0
      || detached.assessments.length > 252
    ) return false
    const playerCount = detached.source.playerCount
    const ids = new Set<string>()
    for (const raw of detached.assessments) {
      if (!plainRecord(raw)) return false
      const common = raw as Record<string, unknown>
      if (
        typeof common.candidateId !== 'string'
        || !common.candidateId.length
        || common.candidateId.length > 256
        || ids.has(common.candidateId)
        || common.kind !== detached.request.kind
        || common.role !== detached.role
        || !['support', 'oppose'].includes(common.direction as string)
        || !denseArray(common.team)
        || (common.team as unknown[]).length === 0
        || (common.team as unknown[]).length
          > (detached.source.playerCount as number)
        || new Set(common.team as unknown[]).size
          !== (common.team as unknown[]).length
        || !(common.team as unknown[]).every(
          (seat) =>
            typeof seat === 'number'
            && Number.isSafeInteger(seat)
            && seat >= 0
            && seat < playerCount,
        )
        || (common.team as number[]).some(
          (seat, index) =>
            index > 0 && (common.team as number[])[index - 1] >= seat,
        )
        || common.valueSemantics !== ROLE_UTILITY_VALUE_SEMANTICS
        || !probability(common.roleValue)
      ) return false
      ids.add(common.candidateId)
      if (detached.role === 'merlin') {
        if (
          !exactKeys(common, [
            'candidateId',
            'kind',
            'role',
            'direction',
            'team',
            'valueSemantics',
            'privateProbabilitySemantics',
            'publicProbabilitySemantics',
            'teamCleanProbability',
            'teamFailureCapabilityProbability',
            'privateInfluenceValue',
            'publicTeamCleanProbability',
            'publicTeamFailureCapabilityProbability',
            'publicEvilCountDistribution',
            'publicInfluenceValue',
            'directionalKnowledgeTellIndex',
            'publicDecisionAmbiguityIndex',
            'ownPublicSalienceIndex',
            'correctedExposureProxyIndex',
            'roleValue',
          ])
          || common.privateProbabilitySemantics
            !== 'resolved-complete-world-sum'
          || common.publicProbabilitySemantics
            !== 'public-preaction-uniform-feasible-joint'
          || !probability(common.teamCleanProbability)
          || !probability(common.teamFailureCapabilityProbability)
          || !boundedInfluence(common.privateInfluenceValue)
          || !probability(common.publicTeamCleanProbability)
          || !probability(common.publicTeamFailureCapabilityProbability)
          || !denseArray(common.publicEvilCountDistribution)
          || (common.publicEvilCountDistribution as unknown[]).length
            !== (common.team as unknown[]).length + 1
          || !(common.publicEvilCountDistribution as unknown[])
            .every(probability)
          || !boundedInfluence(common.publicInfluenceValue)
          || !probability(common.directionalKnowledgeTellIndex)
          || !probability(common.publicDecisionAmbiguityIndex)
          || !probability(common.ownPublicSalienceIndex)
          || !probability(common.correctedExposureProxyIndex)
        ) return false
        const distribution = common.publicEvilCountDistribution as number[]
        const distributionTotal = distribution.reduce(
          (sum, entry) => sum + entry,
          0,
        )
        const failsRequired = detached.request.failsRequired as number
        const publicFailure = distribution
          .slice(failsRequired)
          .reduce((sum, entry) => sum + entry, 0)
        const sign = common.direction === 'support' ? 1 : -1
        const publicInfluence = sign * (
          (common.publicTeamCleanProbability as number) - publicFailure
        )
        const tell = clamp01(
          Math.max(
            0,
            (common.privateInfluenceValue as number) - publicInfluence,
          ) / 2,
        )
        const ambiguity = clamp01(
          1 - Math.abs(
            (common.publicTeamCleanProbability as number) - publicFailure,
          ),
        )
        const exposure = clamp01(
          ROLE_UTILITY_CONSTANTS.exposureTellWeight * tell
          + ROLE_UTILITY_CONSTANTS.exposureAmbiguityWeight * ambiguity
          + ROLE_UTILITY_CONSTANTS.exposureOwnSalienceWeight
            * (common.ownPublicSalienceIndex as number),
        )
        const expectedRoleValue = clamp01(
          ROLE_UTILITY_CONSTANTS.primaryInfluenceWeight
            * (((common.privateInfluenceValue as number) + 1) / 2)
          + ROLE_UTILITY_CONSTANTS.concealmentOrDecoyWeight * (1 - exposure),
        )
        if (
          Math.abs(distributionTotal - 1) > 1e-9
          || Math.abs(distribution[0]
            - (common.publicTeamCleanProbability as number)) > 1e-12
          || Math.abs(publicFailure
            - (common.publicTeamFailureCapabilityProbability as number))
              > 1e-12
          || Math.abs(publicInfluence
            - (common.publicInfluenceValue as number)) > 1e-12
          || Math.abs(tell
            - (common.directionalKnowledgeTellIndex as number)) > 1e-12
          || Math.abs(ambiguity
            - (common.publicDecisionAmbiguityIndex as number)) > 1e-12
          || Math.abs(exposure
            - (common.correctedExposureProxyIndex as number)) > 1e-12
          || Math.abs(expectedRoleValue
            - (common.roleValue as number)) > 1e-12
        ) return false
      } else if (
        !exactKeys(common, [
          'candidateId',
          'kind',
          'role',
          'direction',
          'team',
          'valueSemantics',
          'probabilitySemantics',
          'pairInfluenceValue',
          'selfDecoyOpportunityProxyIndex',
          'merlinMimicryProxyIndex',
          'roleValue',
        ])
        || common.probabilitySemantics !== 'resolved-complete-world-sum'
        || !boundedInfluence(common.pairInfluenceValue)
        || !probability(common.selfDecoyOpportunityProxyIndex)
        || !probability(common.merlinMimicryProxyIndex)
      ) return false
      else {
        const expectedRoleValue = clamp01(
          ROLE_UTILITY_CONSTANTS.primaryInfluenceWeight
            * (((common.pairInfluenceValue as number) + 1) / 2)
          + ROLE_UTILITY_CONSTANTS.concealmentOrDecoyWeight
            * (common.selfDecoyOpportunityProxyIndex as number),
        )
        if (
          Math.abs(expectedRoleValue - (common.roleValue as number)) > 1e-12
        ) return false
      }
    }
    return true
  }
}

const roleUtilityCodec =
  projectionCodec<PrivateRoleUtilityProjection>(roleUtilitySchema)

export const validatePrivateRoleUtilityProjection = roleUtilityCodec.validate
export const decodeCanonicalPrivateRoleUtilityProjection =
  roleUtilityCodec.decode

export const validateAdmittedPrivateRoleUtilityHostJoin =
  exactHostJoin(buildAdmittedRoleUtilityProjection)
