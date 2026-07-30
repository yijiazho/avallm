import { isDeepStrictEqual } from 'node:util'
import {
  ROLE_ALIGNMENT,
  validateRoles,
} from '../../engine/rules.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  type IdentityProjectionScope,
  type PrivateIdentitySnapshot,
  type RoleIdentityPosterior,
  validatePrivateIdentityHostJoin,
} from '../belief/identity.ts'
import {
  CANONICAL_ROLE_ORDER,
  PROBABILITY_TOLERANCE,
} from '../belief/types.ts'
import type { PolicyCandidate } from '../policy/types.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicJointTeamAssessment,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import {
  assessPublicJointTeams,
  observePublicRecord,
  validatePublicObserverSnapshot,
} from './observer.ts'
import { projectPublicRecord } from '../communication/public-record.ts'
import {
  MAX_ROLE_OBJECTIVE_ASSESSMENTS,
  ROLE_OBJECTIVE_MODEL_VERSION,
  type CandidatePublicCommitment,
  type MerlinCandidateObjective,
  type MerlinMorganaPairHypothesis,
  type PercivalCandidateObjective,
  type PrivateRoleObjectiveSnapshot,
  type RoleObjectiveRole,
} from './role-objective-types.ts'
import {
  canonicalSeats,
  denseArray,
  exactKeys,
  plainDataRecord as plainRecord,
  probability,
} from '../components/canonical-shape.ts'
import {
  canonicalizeJson,
  type CanonicalJsonValue,
  DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
} from '../components/canonical-json.ts'

const VALID_ROLES = new Set<Role>(CANONICAL_ROLE_ORDER)
const roleRank = new Map(CANONICAL_ROLE_ORDER.map((role, index) => [role, index]))

const boundedIndex = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= -1
  && value <= 1

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

function canonicalRoles(value: unknown, playerCount: number): value is Role[] {
  if (
    !denseArray(value)
    || value.length !== playerCount
    || value.some((role) => !VALID_ROLES.has(role as Role))
  ) return false
  const roles = value as Role[]
  if (
    !isDeepStrictEqual(
      roles,
      [...roles].sort(
        (left, right) =>
          (roleRank.get(left) ?? 99) - (roleRank.get(right) ?? 99),
      ),
    )
  ) return false
  try {
    validateRoles(playerCount, [...roles])
    return true
  } catch {
    return false
  }
}

function roleCount(roles: readonly Role[], role: Role): number {
  return roles.filter((candidate) => candidate === role).length
}

function teamForDecision(
  decision: Decision,
  view: PlayerView,
): readonly Seat[] | undefined {
  if (decision.kind === 'propose') return decision.team
  if (decision.kind === 'finalize') {
    return decision.stick ? view.currentTeam : decision.team
  }
  if (decision.kind === 'vote' || decision.kind === 'discuss') {
    return view.currentTeam
  }
  return undefined
}

function directionForDecision(
  decision: Decision,
): CandidatePublicCommitment['direction'] {
  if (decision.kind === 'vote') {
    return decision.vote === 'approve' ? 'support' : 'oppose'
  }
  if (decision.kind === 'discuss') {
    return decision.lean === 'approve'
      ? 'support'
      : decision.lean === 'reject'
        ? 'oppose'
        : 'neutral'
  }
  return decision.kind === 'propose' || decision.kind === 'finalize'
    ? 'support'
    : 'neutral'
}

function commitmentFor(
  candidate: PolicyCandidate,
  view: PlayerView,
): CandidatePublicCommitment | undefined {
  const team = teamForDecision(candidate.decision, view)
  if (!team) return undefined
  return {
    candidateId: candidate.id,
    kind: candidate.kind,
    direction: directionForDecision(candidate.decision),
    team: [...team].sort((left, right) => left - right),
  }
}

function directionSign(
  direction: CandidatePublicCommitment['direction'],
): number {
  return direction === 'support' ? 1 : direction === 'oppose' ? -1 : 0
}

function publicTeamAmbiguity(
  assessment: PublicJointTeamAssessment,
): number {
  return clamp01(
    1 - Math.abs(2 * assessment.cleanProbability - 1),
  )
}

function ownPublicSalience(
  observer: PublicObserverSnapshot,
  seat: Seat,
  hasCompletedPublicVote: boolean,
): number {
  const own = observer.seats[seat]
  const behavior = own.behavior
  const behaviorSalience = (
    behavior.proposalSelectionIndex
    + behavior.failedQuestExposureIndex
    + (
      hasCompletedPublicVote
        ? Math.abs(behavior.approvalIndex - 0.5) * 2
        : 0
    )
  ) / 3
  return clamp01((own.goodProbability + behaviorSalience) / 2)
}

function publicRoleOnTeamProbability(
  observer: PublicObserverSnapshot,
  team: readonly Seat[],
  role: 'merlin' | 'morgana',
): number {
  return clamp01(
    team.reduce(
      (sum, seat) =>
        sum + (
          observer.seats[seat].roleMarginals.find(
            (marginal) => marginal.role === role,
          )?.probability ?? 0
        ),
      0,
    ),
  )
}

function identityRolePosterior(
  identity: PrivateIdentitySnapshot,
  roles: readonly Role[],
): RoleIdentityPosterior | undefined {
  const expected = [...roles].sort(
    (left, right) =>
      (roleRank.get(left) ?? 99) - (roleRank.get(right) ?? 99),
  )
  return identity.rolePosteriors.find(
    (posterior) => isDeepStrictEqual(posterior.queriedRoles, expected),
  )
}

function merlinAssessments(
  identity: PrivateIdentitySnapshot,
  observer: PublicObserverSnapshot,
  commitments: readonly CandidatePublicCommitment[],
  viewerSeat: Seat,
  publicTeams: readonly PublicJointTeamAssessment[],
  failsRequired: number,
  hasCompletedPublicVote: boolean,
): readonly MerlinCandidateObjective[] {
  const hidden = identity.hiddenTeamPosterior
  if (!hidden) throw new Error('Merlin objective requires a hidden-team posterior')
  return commitments.map((candidate, candidateIndex) => {
    const team = candidate.team ?? []
    const publicTeam = publicTeams[candidateIndex]
    const distribution = Array<number>(team.length + 1).fill(0)
    for (const hypothesis of hidden.hypotheses) {
      const evil = team.filter((seat) => hypothesis.evilSeats.includes(seat)).length
      distribution[evil] += hypothesis.probability
    }
    const distributionTotal = distribution.reduce(
      (sum, probability) => sum + probability,
      0,
    )
    for (let index = 0; index < distribution.length; index++) {
      distribution[index] = clamp01(distribution[index] / distributionTotal)
    }
    const teamCleanProbability = distribution[0]
    const teamFailureCapabilityProbability = distribution
      .slice(failsRequired)
      .reduce((sum, entry) => sum + entry, 0)
    const sign = directionSign(candidate.direction)
    const ambiguity = publicTeamAmbiguity(publicTeam)
    const conspicuousness = clamp01(Math.abs(sign) * ambiguity)
    return {
      candidate,
      probabilitySemantics: 'resolved-complete-world-sum',
      valueSemantics: 'bounded-deterministic-indices-not-probabilities',
      teamCleanProbability,
      teamFailureCapabilityProbability,
      evilCountDistribution: distribution,
      influenceValue:
        sign * (teamCleanProbability - teamFailureCapabilityProbability),
      publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint',
      publicTeamCleanProbability: publicTeam.cleanProbability,
      publicAmbiguityIndex: ambiguity,
      conspicuousnessIndex: conspicuousness,
      assassinExposureProxyIndex: clamp01(
        (
          ownPublicSalience(
            observer,
            viewerSeat,
            hasCompletedPublicVote,
          )
          + conspicuousness
        ) / 2,
      ),
    }
  })
}

function pairPosterior(
  identity: PrivateIdentitySnapshot,
): {
  includesMorgana: boolean
  hypotheses: readonly MerlinMorganaPairHypothesis[]
} {
  const includesMorgana = identity.sourceBelief.rolesInPlay.includes('morgana')
  const queriedRoles: Role[] = includesMorgana
    ? ['merlin', 'morgana']
    : ['merlin']
  const posterior = identityRolePosterior(identity, queriedRoles)
  if (!posterior) {
    throw new Error('Percival objective requires a Merlin/Morgana identity posterior')
  }
  const hypotheses = posterior.hypotheses.map((hypothesis) => {
    const merlin = hypothesis.assignments.find(
      (assignment) => assignment.role === 'merlin',
    )
    const morgana = hypothesis.assignments.find(
      (assignment) => assignment.role === 'morgana',
    )
    if (
      !merlin
      || merlin.seats.length !== 1
      || (includesMorgana && (!morgana || morgana.seats.length !== 1))
      || (!includesMorgana && morgana !== undefined)
    ) {
      throw new Error('identity posterior has invalid Merlin/Morgana multiplicity')
    }
    return {
      merlinSeat: merlin.seats[0],
      morganaSeat: morgana?.seats[0] ?? null,
      probability: hypothesis.probability,
    }
  }).sort((left, right) =>
    left.merlinSeat - right.merlinSeat
    || (left.morganaSeat ?? -1) - (right.morganaSeat ?? -1))
  return { includesMorgana, hypotheses }
}

function percivalAssessments(
  pairs: ReturnType<typeof pairPosterior>,
  observer: PublicObserverSnapshot,
  commitments: readonly CandidatePublicCommitment[],
  viewerSeat: Seat,
  publicTeams: readonly PublicJointTeamAssessment[],
): readonly PercivalCandidateObjective[] {
  return commitments.map((candidate, candidateIndex) => {
    const team = candidate.team ?? []
    const merlinOnTeamProbability = clamp01(
      pairs.hypotheses.reduce(
        (sum, hypothesis) =>
          sum + (team.includes(hypothesis.merlinSeat)
            ? hypothesis.probability
            : 0),
        0,
      ),
    )
    const morganaOnTeamProbability = clamp01(
      pairs.hypotheses.reduce(
        (sum, hypothesis) =>
          sum + (
            hypothesis.morganaSeat !== null
            && team.includes(hypothesis.morganaSeat)
              ? hypothesis.probability
              : 0
          ),
        0,
      ),
    )
    const sign = directionSign(candidate.direction)
    const publicTeam = publicTeams[candidateIndex]
    const ambiguity = publicTeamAmbiguity(publicTeam)
    const publicMerlinProbabilityAtSelf =
      observer.seats[viewerSeat].roleMarginals.find(
        (marginal) => marginal.role === 'merlin',
      )?.probability ?? 0
    const publicMerlinOnTeamProbability =
      publicRoleOnTeamProbability(observer, team, 'merlin')
    const publicMorganaOnTeamProbability =
      publicRoleOnTeamProbability(observer, team, 'morgana')
    const pairInfluenceValue =
      sign * (merlinOnTeamProbability - morganaOnTeamProbability)
    const publicPairInfluenceValue =
      sign * (
        publicMerlinOnTeamProbability - publicMorganaOnTeamProbability
      )
    const pairKnowledgeTellIndex = clamp01(
      Math.max(0, pairInfluenceValue - publicPairInfluenceValue) / 2,
    )
    const decisiveAmbiguityIndex = clamp01(Math.abs(sign) * ambiguity)
    const merlinMimicryProxyIndex = clamp01(
      0.75 * pairKnowledgeTellIndex + 0.25 * decisiveAmbiguityIndex,
    )
    return {
      candidate,
      probabilitySemantics: 'resolved-complete-world-sum',
      valueSemantics: 'bounded-deterministic-indices-not-probabilities',
      merlinOnTeamProbability,
      morganaOnTeamProbability,
      pairInfluenceValue,
      publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint',
      publicTeamCleanProbability: publicTeam.cleanProbability,
      publicMerlinProbabilityAtSelf,
      publicMerlinOnTeamProbability,
      publicMorganaOnTeamProbability,
      publicPairInfluenceValue,
      pairKnowledgeTellIndex,
      decisiveAmbiguityIndex,
      merlinMimicryProxyIndex,
      selfDecoyOpportunityProxyIndex: clamp01(
        (1 - publicMerlinProbabilityAtSelf) * merlinMimicryProxyIndex,
      ),
    }
  })
}

export function roleObjectiveIdentityScope(
  role: RoleObjectiveRole,
  rolesInPlay: readonly Role[],
): IdentityProjectionScope {
  return role === 'merlin'
    ? { roleQueries: [{ roles: ['merlin'] }], hiddenTeam: true }
    : {
        roleQueries: [{
          roles: rolesInPlay.includes('morgana')
            ? ['merlin', 'morgana']
            : ['merlin'],
        }],
        hiddenTeam: false,
      }
}

export function mergeIdentityScopes(
  left: IdentityProjectionScope | undefined,
  right: IdentityProjectionScope,
): IdentityProjectionScope {
  const queries = [...(left?.roleQueries ?? []), ...right.roleQueries]
  const unique = new Map<string, { roles: readonly Role[] }>()
  for (const query of queries) {
    const roles = [...query.roles].sort(
      (a, b) => (roleRank.get(a) ?? 99) - (roleRank.get(b) ?? 99),
    )
    unique.set(roles.join('|'), { roles })
  }
  return {
    roleQueries: [...unique.values()],
    hiddenTeam: (left?.hiddenTeam ?? false) || right.hiddenTeam,
  }
}

export function buildRoleObjectiveSnapshot(input: {
  req: DecisionRequest
  view: PlayerView
  identity: PrivateIdentitySnapshot
  observer: PublicObserverSnapshot
  candidates: readonly PolicyCandidate[]
}): PrivateRoleObjectiveSnapshot {
  const { req, view, identity, observer, candidates } = input
  if (
    (view.role !== 'merlin' && view.role !== 'percival')
    || req.seat !== view.seat
    || candidates.length > MAX_ROLE_OBJECTIVE_ASSESSMENTS
    || !validatePrivateIdentityHostJoin(
      identity,
      view.rolesInPlay,
      identity.hiddenTeamPosterior
        ? Array.from({ length: view.playerCount }, (_, seat) => {
            const evilProbability = clamp01(
              identity.hiddenTeamPosterior!.hypotheses.reduce(
                (sum, hypothesis) =>
                  sum + (hypothesis.evilSeats.includes(seat)
                    ? hypothesis.probability
                    : 0),
                0,
              ),
            )
            return { seat, goodProbability: 1 - evilProbability, evilProbability }
          })
        : // The pair-only Percival scope has no alignment surface. Its cast and
          // source semantics were already validated by the identity projector.
          Array.from({ length: view.playerCount }, (_, seat) => ({
            seat,
            goodProbability: ROLE_ALIGNMENT[view.role] === 'good' && seat === view.seat
              ? 1
              : 0.5,
            evilProbability: ROLE_ALIGNMENT[view.role] === 'good' && seat === view.seat
              ? 0
              : 0.5,
          })),
    )
    || !validatePublicObserverSnapshot(observer)
    || observer.playerCount !== view.playerCount
  ) {
    throw new Error('role objective received inconsistent private sources')
  }
  const commitments = candidates
    .map((candidate) => commitmentFor(candidate, view))
    .filter(
      (candidate): candidate is CandidatePublicCommitment =>
        candidate !== undefined,
    )
  if (view.role === 'merlin') {
    const ownPosterior = identityRolePosterior(identity, ['merlin'])
    if (
      !ownPosterior
      || ownPosterior.hypotheses.some(
        (hypothesis) =>
          hypothesis.assignments.length !== 1
          || hypothesis.assignments[0].role !== 'merlin'
          || !isDeepStrictEqual(hypothesis.assignments[0].seats, [view.seat]),
      )
    ) {
      throw new Error('Merlin objective identity does not bind the viewer role')
    }
  }
  const publicRecord = projectPublicRecord(view)
  const publicTeams = assessPublicJointTeams(
    publicRecord,
    commitments.map((candidate) => candidate.team!),
  )
  const hasCompletedPublicVote = publicRecord.proposals.some(
    (proposal) => proposal.votes?.length === publicRecord.playerCount,
  )
  const failsRequired = view.quests[view.round - 1]?.failsRequired
  if (!Number.isSafeInteger(failsRequired) || failsRequired < 1 || failsRequired > 2) {
    throw new Error('role objective requires the current quest failure threshold')
  }
  const source = {
    beliefModelVersion: identity.sourceBelief.modelVersion,
    beliefThroughSeq: identity.sourceBelief.throughSeq,
    beliefQuality: identity.sourceBelief.quality,
    playerCount: identity.sourceBelief.playerCount,
    rolesInPlay: [...identity.sourceBelief.rolesInPlay],
    identityModelVersion: JOINT_IDENTITY_MODEL_VERSION,
    observerModelVersion: PUBLIC_OBSERVER_MODEL_VERSION,
    observerFeasibleWorldCount: observer.feasibleWorldCount,
  }
  const request = {
    seat: req.seat,
    kind: req.kind,
    round: req.round,
    proposalNum: req.proposalNum,
    failsRequired,
  }
  if (view.role === 'merlin') {
    return {
      version: ROLE_OBJECTIVE_MODEL_VERSION,
      role: 'merlin',
      source,
      request,
      objective: {
        role: 'merlin',
        assessments: merlinAssessments(
          identity,
          observer,
          commitments,
          view.seat,
          publicTeams,
          failsRequired,
          hasCompletedPublicVote,
        ),
      },
    }
  }
  const pairs = pairPosterior(identity)
  const privateCandidateSeats = [...(view.privateInfo.merlinCandidates ?? [])]
    .sort((left, right) => left - right)
  const pairCandidateSeats = [...new Set(pairs.hypotheses.flatMap(
    (hypothesis) => [
      hypothesis.merlinSeat,
      ...(hypothesis.morganaSeat === null ? [] : [hypothesis.morganaSeat]),
    ],
  ))].sort((left, right) => left - right)
  if (
    !canonicalSeats(privateCandidateSeats, view.playerCount)
    || !isDeepStrictEqual(privateCandidateSeats, pairCandidateSeats)
    || (
      pairs.includesMorgana
      && pairs.hypotheses.some(
        (hypothesis) =>
          !isDeepStrictEqual(
            [hypothesis.merlinSeat, hypothesis.morganaSeat!]
              .sort((left, right) => left - right),
            privateCandidateSeats,
          ),
      )
    )
    || (
      !pairs.includesMorgana
      && pairs.hypotheses.some(
        (hypothesis) =>
          !privateCandidateSeats.includes(hypothesis.merlinSeat),
      )
    )
  ) {
    throw new Error('Percival pair posterior disagrees with private candidate union')
  }
  return {
    version: ROLE_OBJECTIVE_MODEL_VERSION,
    role: 'percival',
    source,
    request,
    objective: {
      role: 'percival',
      pairPosterior: {
        probabilitySemantics: 'resolved-complete-world-sum',
        includesMorgana: pairs.includesMorgana,
        privateCandidateSeats,
        hypotheses: pairs.hypotheses,
      },
      assessments: percivalAssessments(
        pairs,
        observer,
        commitments,
        view.seat,
        publicTeams,
      ),
    },
  }
}

function validCommitment(
  value: unknown,
  source: Record<string, unknown>,
  request: Record<string, unknown>,
): value is CandidatePublicCommitment {
  if (!plainRecord(value)) return false
  const candidate = value as Record<string, unknown>
  const playerCount = source.playerCount as number
  return exactKeys(candidate, ['candidateId', 'kind', 'direction', 'team'])
    && typeof candidate.candidateId === 'string'
    && candidate.candidateId.length > 0
    && candidate.candidateId.length <= 256
    && candidate.kind === request.kind
    && ['support', 'oppose', 'neutral'].includes(candidate.direction as string)
    && canonicalSeats(candidate.team, playerCount)
}

function validDistribution(value: unknown, teamSize: number): value is number[] {
  return denseArray(value)
    && value.length === teamSize + 1
    && value.every(probability)
    && Math.abs(
      value.reduce((sum, entry) => sum + (entry as number), 0) - 1,
    ) <= PROBABILITY_TOLERANCE
}

function validatePrivateRoleObjectiveSnapshotShape(
  value: unknown,
  hostileBoundary: boolean,
): value is PrivateRoleObjectiveSnapshot {
  try {
    const detached = hostileBoundary
      ? canonicalizeJson(value, DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES)
      : { ok: true as const, payload: value }
    if (!detached.ok) return false
    if (!plainRecord(detached.payload)) return false
    const snapshot = detached.payload as Record<string, unknown>
    const source = snapshot.source as Record<string, unknown>
    const request = snapshot.request as Record<string, unknown>
    const objective = snapshot.objective as Record<string, unknown>
    if (
      !exactKeys(snapshot, ['version', 'role', 'source', 'request', 'objective'])
      || snapshot.version !== ROLE_OBJECTIVE_MODEL_VERSION
      || !['merlin', 'percival'].includes(snapshot.role as string)
      || !plainRecord(source)
      || !exactKeys(source, [
        'beliefModelVersion',
        'beliefThroughSeq',
        'beliefQuality',
        'playerCount',
        'rolesInPlay',
        'identityModelVersion',
        'observerModelVersion',
        'observerFeasibleWorldCount',
      ])
      || typeof source.beliefModelVersion !== 'string'
      || source.beliefModelVersion.length === 0
      || source.beliefModelVersion.length > 200
      || !Number.isSafeInteger(source.beliefThroughSeq)
      || (source.beliefThroughSeq as number) < -1
      || !['constraints-only', 'weighted', 'degraded'].includes(
        source.beliefQuality as string,
      )
      || !Number.isSafeInteger(source.playerCount)
      || (source.playerCount as number) < 5
      || (source.playerCount as number) > 10
      || !canonicalRoles(source.rolesInPlay, source.playerCount as number)
      || roleCount(source.rolesInPlay as Role[], snapshot.role as Role) !== 1
      || source.identityModelVersion !== JOINT_IDENTITY_MODEL_VERSION
      || source.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
      || !Number.isSafeInteger(source.observerFeasibleWorldCount)
      || (source.observerFeasibleWorldCount as number) <= 0
      || !plainRecord(request)
      || !exactKeys(request, [
        'seat', 'kind', 'round', 'proposalNum', 'failsRequired',
      ])
      || !Number.isSafeInteger(request.seat)
      || (request.seat as number) < 0
      || (request.seat as number) >= (source.playerCount as number)
      || !['discuss', 'propose', 'finalize', 'vote', 'quest', 'assassinate']
        .includes(request.kind as string)
      || !Number.isSafeInteger(request.round)
      || (request.round as number) < 1
      || (request.round as number) > 5
      || !Number.isSafeInteger(request.proposalNum)
      || (request.proposalNum as number) < 1
      || (request.proposalNum as number) > 5
      || !Number.isSafeInteger(request.failsRequired)
      || ![1, 2].includes(request.failsRequired as number)
      || !plainRecord(objective)
      || objective.role !== snapshot.role
      || !denseArray(objective.assessments)
      || objective.assessments.length > MAX_ROLE_OBJECTIVE_ASSESSMENTS
    ) return false

    const candidateIds = new Set<string>()
    for (const raw of objective.assessments) {
      if (!plainRecord(raw)) return false
      const assessment = raw as Record<string, unknown>
      const candidate = assessment.candidate as Record<string, unknown>
      if (
        !validCommitment(candidate, source, request)
        || candidateIds.has(candidate.candidateId as string)
      ) return false
      candidateIds.add(candidate.candidateId as string)
      const teamSize = (candidate.team as Seat[]).length
      if (snapshot.role === 'merlin') {
        if (
          !exactKeys(assessment, [
            'candidate',
            'probabilitySemantics',
            'valueSemantics',
            'teamCleanProbability',
            'teamFailureCapabilityProbability',
            'evilCountDistribution',
            'influenceValue',
            'publicProbabilitySemantics',
            'publicTeamCleanProbability',
            'publicAmbiguityIndex',
            'conspicuousnessIndex',
            'assassinExposureProxyIndex',
          ])
          || assessment.probabilitySemantics !== 'resolved-complete-world-sum'
          || assessment.valueSemantics
            !== 'bounded-deterministic-indices-not-probabilities'
          || !probability(assessment.teamCleanProbability)
          || !probability(assessment.teamFailureCapabilityProbability)
          || !validDistribution(assessment.evilCountDistribution, teamSize)
          || Math.abs(
            (assessment.evilCountDistribution as number[])[0]
              - (assessment.teamCleanProbability as number),
          ) > PROBABILITY_TOLERANCE
          || Math.abs(
            (assessment.evilCountDistribution as number[])
              .slice(request.failsRequired as number)
              .reduce((sum, entry) => sum + entry, 0)
              - (assessment.teamFailureCapabilityProbability as number),
          ) > PROBABILITY_TOLERANCE
          || !boundedIndex(assessment.influenceValue)
          || Math.abs(
            directionSign(
              (assessment.candidate as CandidatePublicCommitment).direction,
            ) * (
              (assessment.teamCleanProbability as number)
              - (assessment.teamFailureCapabilityProbability as number)
            )
              - (assessment.influenceValue as number),
          ) > PROBABILITY_TOLERANCE
          || assessment.publicProbabilitySemantics
            !== 'public-preaction-uniform-feasible-joint'
          || !probability(assessment.publicTeamCleanProbability)
          || !probability(assessment.publicAmbiguityIndex)
          || !probability(assessment.conspicuousnessIndex)
          || !probability(assessment.assassinExposureProxyIndex)
        ) return false
      } else if (
        !exactKeys(assessment, [
          'candidate',
          'probabilitySemantics',
          'valueSemantics',
          'merlinOnTeamProbability',
          'morganaOnTeamProbability',
          'pairInfluenceValue',
          'publicProbabilitySemantics',
          'publicTeamCleanProbability',
          'publicMerlinProbabilityAtSelf',
          'publicMerlinOnTeamProbability',
          'publicMorganaOnTeamProbability',
          'publicPairInfluenceValue',
          'pairKnowledgeTellIndex',
          'decisiveAmbiguityIndex',
          'merlinMimicryProxyIndex',
          'selfDecoyOpportunityProxyIndex',
        ])
        || assessment.probabilitySemantics !== 'resolved-complete-world-sum'
        || assessment.valueSemantics
          !== 'bounded-deterministic-indices-not-probabilities'
        || !probability(assessment.merlinOnTeamProbability)
        || !probability(assessment.morganaOnTeamProbability)
        || !boundedIndex(assessment.pairInfluenceValue)
        || assessment.publicProbabilitySemantics
          !== 'public-preaction-uniform-feasible-joint'
        || !probability(assessment.publicTeamCleanProbability)
        || !probability(assessment.publicMerlinProbabilityAtSelf)
        || !probability(assessment.publicMerlinOnTeamProbability)
        || !probability(assessment.publicMorganaOnTeamProbability)
        || !boundedIndex(assessment.publicPairInfluenceValue)
        || !probability(assessment.pairKnowledgeTellIndex)
        || !probability(assessment.decisiveAmbiguityIndex)
        || !probability(assessment.merlinMimicryProxyIndex)
        || !probability(assessment.selfDecoyOpportunityProxyIndex)
      ) return false
    }

    if (snapshot.role === 'merlin') {
      return exactKeys(objective, ['role', 'assessments'])
    }
    const pair = objective.pairPosterior as Record<string, unknown>
    if (
      !exactKeys(objective, ['role', 'pairPosterior', 'assessments'])
      || !plainRecord(pair)
      || !exactKeys(pair, [
        'probabilitySemantics',
        'includesMorgana',
        'privateCandidateSeats',
        'hypotheses',
      ])
      || pair.probabilitySemantics !== 'resolved-complete-world-sum'
      || typeof pair.includesMorgana !== 'boolean'
      || pair.includesMorgana !== (source.rolesInPlay as Role[]).includes('morgana')
      || !canonicalSeats(pair.privateCandidateSeats, source.playerCount as number)
      || !denseArray(pair.hypotheses)
      || pair.hypotheses.length === 0
      || pair.hypotheses.length > 90
    ) return false
    let total = 0
    let priorKey = ''
    const hypotheses = pair.hypotheses as unknown[]
    for (const raw of hypotheses) {
      if (!plainRecord(raw)) return false
      const hypothesis = raw as Record<string, unknown>
      if (
        !exactKeys(hypothesis, ['merlinSeat', 'morganaSeat', 'probability'])
        || !Number.isSafeInteger(hypothesis.merlinSeat)
        || (hypothesis.merlinSeat as number) < 0
        || (hypothesis.merlinSeat as number) >= (source.playerCount as number)
        || (
          pair.includesMorgana
            ? (
                !Number.isSafeInteger(hypothesis.morganaSeat)
                || (hypothesis.morganaSeat as number) < 0
                || (hypothesis.morganaSeat as number)
                  >= (source.playerCount as number)
                || hypothesis.morganaSeat === hypothesis.merlinSeat
              )
            : hypothesis.morganaSeat !== null
        )
        || !probability(hypothesis.probability)
        || hypothesis.probability === 0
      ) return false
      const key = `${hypothesis.merlinSeat}:${hypothesis.morganaSeat ?? -1}`
      if (priorKey && priorKey >= key) return false
      priorKey = key
      total += hypothesis.probability as number
    }
    if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) return false
    const pairCandidateSeats = [...new Set(
      (hypotheses as MerlinMorganaPairHypothesis[]).flatMap(
        (hypothesis) => [
          hypothesis.merlinSeat,
          ...(hypothesis.morganaSeat === null ? [] : [hypothesis.morganaSeat]),
        ],
      ),
    )].sort((left, right) => left - right)
    if (!isDeepStrictEqual(pair.privateCandidateSeats, pairCandidateSeats)) {
      return false
    }
    if (
      pair.includesMorgana
      && (hypotheses as MerlinMorganaPairHypothesis[]).some(
        (hypothesis) =>
          !isDeepStrictEqual(
            [hypothesis.merlinSeat, hypothesis.morganaSeat!]
              .sort((left, right) => left - right),
            pair.privateCandidateSeats,
          ),
      )
    ) return false

    const typedHypotheses = hypotheses as MerlinMorganaPairHypothesis[]
    for (const raw of objective.assessments as unknown[]) {
      const assessment = raw as PercivalCandidateObjective
      const team = assessment.candidate.team ?? []
      const merlin = typedHypotheses.reduce(
        (sum, hypothesis) =>
          sum + (team.includes(hypothesis.merlinSeat)
            ? hypothesis.probability
            : 0),
        0,
      )
      const morgana = typedHypotheses.reduce(
        (sum, hypothesis) =>
          sum + (
            hypothesis.morganaSeat !== null
            && team.includes(hypothesis.morganaSeat)
              ? hypothesis.probability
              : 0
          ),
        0,
      )
      if (
        Math.abs(merlin - assessment.merlinOnTeamProbability)
          > PROBABILITY_TOLERANCE
        || Math.abs(morgana - assessment.morganaOnTeamProbability)
          > PROBABILITY_TOLERANCE
        || Math.abs(
          directionSign(assessment.candidate.direction) * (merlin - morgana)
            - assessment.pairInfluenceValue,
        ) > PROBABILITY_TOLERANCE
      ) return false
      const sign = directionSign(assessment.candidate.direction)
      const expectedPublicPair = sign * (
        assessment.publicMerlinOnTeamProbability
        - assessment.publicMorganaOnTeamProbability
      )
      const expectedTell = clamp01(
        Math.max(0, assessment.pairInfluenceValue - expectedPublicPair) / 2,
      )
      const expectedDecisive = clamp01(
        Math.abs(sign)
        * (
          1 - Math.abs(2 * assessment.publicTeamCleanProbability - 1)
        ),
      )
      const expectedMimicry = clamp01(
        0.75 * expectedTell + 0.25 * expectedDecisive,
      )
      if (
        Math.abs(expectedPublicPair - assessment.publicPairInfluenceValue)
          > PROBABILITY_TOLERANCE
        || Math.abs(expectedTell - assessment.pairKnowledgeTellIndex)
          > PROBABILITY_TOLERANCE
        || Math.abs(expectedDecisive - assessment.decisiveAmbiguityIndex)
          > PROBABILITY_TOLERANCE
        || Math.abs(expectedMimicry - assessment.merlinMimicryProxyIndex)
          > PROBABILITY_TOLERANCE
        || Math.abs(
          (1 - assessment.publicMerlinProbabilityAtSelf) * expectedMimicry
            - assessment.selfDecoyOpportunityProxyIndex,
        ) > PROBABILITY_TOLERANCE
      ) return false
    }
    return true
  } catch {
    return false
  }
}

export function validatePrivateRoleObjectiveSnapshot(
  value: unknown,
): value is PrivateRoleObjectiveSnapshot {
  return validatePrivateRoleObjectiveSnapshotShape(value, true)
}

/** Decode after the component kernel's one canonical JSON boundary. */
export function decodeCanonicalPrivateRoleObjectiveSnapshot(
  value: CanonicalJsonValue,
): PrivateRoleObjectiveSnapshot | undefined {
  return validatePrivateRoleObjectiveSnapshotShape(value, false)
    ? value as PrivateRoleObjectiveSnapshot
    : undefined
}

export function validatePrivateRoleObjectiveHostJoin(
  value: unknown,
  input: {
    req: DecisionRequest
    view: PlayerView
    identity: PrivateIdentitySnapshot
    observer: PublicObserverSnapshot
    candidates: readonly PolicyCandidate[]
  },
): value is PrivateRoleObjectiveSnapshot {
  if (!validatePrivateRoleObjectiveSnapshot(value)) return false
  try {
    const authoritativeObserver = observePublicRecord(
      projectPublicRecord(input.view),
    )
    if (!isDeepStrictEqual(input.observer, authoritativeObserver)) return false
    return isDeepStrictEqual(value, buildRoleObjectiveSnapshot({
      ...input,
      observer: authoritativeObserver,
    }))
  } catch {
    return false
  }
}

export function validateAdmittedPrivateRoleObjectiveHostJoin(
  value: PrivateRoleObjectiveSnapshot,
  input: {
    req: DecisionRequest
    view: PlayerView
    identity: PrivateIdentitySnapshot
    observer: PublicObserverSnapshot
    candidates: readonly PolicyCandidate[]
  },
): boolean {
  try {
    const authoritativeObserver = observePublicRecord(
      projectPublicRecord(input.view),
    )
    return isDeepStrictEqual(input.observer, authoritativeObserver)
      && isDeepStrictEqual(value, buildRoleObjectiveSnapshot({
        ...input,
        observer: authoritativeObserver,
      }))
  } catch {
    return false
  }
}
