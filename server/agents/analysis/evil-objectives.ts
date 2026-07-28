import { isDeepStrictEqual } from 'node:util'
import {
  validateRoles,
} from '../../engine/rules.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'
import {
  CANONICAL_ROLE_ORDER,
  PROBABILITY_TOLERANCE,
} from '../belief/types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  type HiddenTeamPosterior,
  type PrivateIdentitySnapshot,
  validatePrivateIdentityHostJoin,
} from '../belief/identity.ts'
import { projectPublicRecord } from '../communication/public-record.ts'
import type { PolicyCandidate } from '../policy/types.ts'
import {
  assessPublicJointTeams,
  observePublicRecord,
} from './observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  MAX_EVIL_ROLE_OBJECTIVE_ASSESSMENTS,
  MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
  type EvilCandidateObjective,
  type EvilObjectiveRole,
  type EvilRolePosture,
  type ObservationFraction,
  type PrivateEvilRoleObjectiveSnapshot,
  type PublicEvilStanding,
} from './evil-objective-types.ts'

const roleRank = new Map(
  CANONICAL_ROLE_ORDER.map((role, index) => [role, index]),
)
const EVIL_ROLES = new Set<EvilObjectiveRole>([
  'assassin',
  'morgana',
  'mordred',
  'minion',
  'oberon',
])
const POSTURE: Record<EvilObjectiveRole, EvilRolePosture> = {
  assassin: 'assassin-shot-preservation',
  morgana: 'morgana-counterfeit-cover',
  mordred: 'mordred-deep-cover',
  minion: 'minion-failure-banking',
  oberon: 'oberon-uncoordinated-disruption',
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.length
    && allowed.every((key) => Object.hasOwn(value, key))
}

function plainDetachedData(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const array = Array.isArray(value)
  if (
    array
      ? (
          Object.keys(value).length !== value.length
          || Array.from(
            { length: value.length },
            (_, index) => Object.hasOwn(value, index),
          ).some((present) => !present)
        )
      : Object.getPrototypeOf(value) !== Object.prototype
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    if (typeof key !== 'string') return false
    const descriptor = descriptors[key]
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !plainDetachedData(descriptor.value, seen)
    ) return false
  }
  return true
}

function denseArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
    && Object.keys(value).length === value.length
    && Array.from(
      { length: value.length },
      (_, index) => Object.hasOwn(value, index),
    ).every(Boolean)
}

const probability = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= 1

function canonicalSeats(
  value: unknown,
  playerCount: number,
  allowEmpty = false,
): value is Seat[] {
  return denseArray(value)
    && (allowEmpty || value.length > 0)
    && value.length <= playerCount
    && value.every((seat, index, all) => {
      const previous = all[index - 1]
      return typeof seat === 'number'
        && Number.isSafeInteger(seat)
        && seat >= 0
        && seat < playerCount
        && (
          index === 0
          || (typeof previous === 'number' && previous < seat)
        )
    })
}

function canonicalRoles(value: unknown, playerCount: number): value is Role[] {
  if (
    !denseArray(value)
    || value.length !== playerCount
    || value.some((role) => !roleRank.has(role as Role))
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

function fraction(numerator: number, denominator: number): ObservationFraction {
  return {
    numerator,
    denominator,
    index: denominator === 0 ? null : numerator / denominator,
  }
}

function availableMean(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null)
  return available.length === 0
    ? null
    : available.reduce((sum, value) => sum + value, 0) / available.length
}

function publicStanding(
  view: PlayerView,
  observer: PublicObserverSnapshot,
): readonly PublicEvilStanding[] {
  const record = projectPublicRecord(view)
  const allVotes = record.proposals.flatMap((proposal) => proposal.votes ?? [])
  return observer.seats.map((assessment) => {
    const seat = assessment.seat
    const selected = fraction(
      record.proposals.filter((proposal) => proposal.team.includes(seat)).length,
      record.proposals.length,
    )
    const seatVotes = allVotes.filter((vote) => vote.seat === seat)
    const approval = fraction(
      seatVotes.filter((vote) => vote.vote === 'approve').length,
      seatVotes.length,
    )
    const questExposure = record.quests.filter(
      (quest) => quest.result !== undefined && quest.team?.includes(seat),
    )
    const failedQuestExposure = fraction(
      questExposure.filter((quest) => quest.result === 'fail').length,
      questExposure.length,
    )
    const burn = availableMean([
      approval.index === null ? null : 1 - approval.index,
      failedQuestExposure.index,
    ])
    const cover = availableMean([
      selected.index,
      approval.index,
      failedQuestExposure.index === null
        ? null
        : 1 - failedQuestExposure.index,
    ])
    return {
      seat,
      probabilitySemantics: 'public-uniform-feasible-joint',
      goodProbability: assessment.goodProbability,
      evilProbability: assessment.evilProbability,
      evilWorldNumerator: Math.round(
        assessment.evilProbability * observer.feasibleWorldCount,
      ),
      feasibleWorldDenominator: observer.feasibleWorldCount,
      observationSemantics: 'public-counts-no-data-is-null',
      selection: selected,
      approval,
      failedQuestExposure,
      proxySemantics: 'bounded-deterministic-indices-not-probabilities',
      burnProxyIndex: burn,
      coverProxyIndex: cover,
      standingProxyIndex: availableMean([
        selected.index,
        cover,
        burn === null ? null : 1 - burn,
      ]),
    }
  })
}

function teamForCandidate(
  candidate: PolicyCandidate,
  view: PlayerView,
): readonly Seat[] | undefined {
  const decision = candidate.decision
  if (decision.kind === 'propose') return decision.team
  if (decision.kind === 'finalize') {
    return decision.stick ? view.currentTeam : decision.team
  }
  if (decision.kind === 'vote') return view.currentTeam
  return undefined
}

function directionForCandidate(
  candidate: PolicyCandidate,
): 'support' | 'oppose' {
  return candidate.decision.kind === 'vote'
    && candidate.decision.vote === 'reject'
    ? 'oppose'
    : 'support'
}

function failureProbability(
  distribution: readonly number[],
  failsRequired: number,
): number {
  return Math.max(0, Math.min(1, distribution
    .slice(failsRequired)
    .reduce((sum, probability) => sum + probability, 0)))
}

function oberonUnseenPosterior(
  hidden: HiddenTeamPosterior,
  self: Seat,
  playerCount: number,
): NonNullable<
  PrivateEvilRoleObjectiveSnapshot['oberonUnseenEvilPosterior']
> {
  const grouped = new Map<string, { seats: Seat[]; probability: number }>()
  let total = 0
  for (const hypothesis of hidden.hypotheses) {
    const seats = hypothesis.evilSeats.filter((seat) => seat !== self)
    const key = seats.join(',')
    const prior = grouped.get(key)
    grouped.set(key, {
      seats,
      probability: (prior?.probability ?? 0) + hypothesis.probability,
    })
    total += hypothesis.probability
  }
  if (!(total > 0)) throw new Error('Oberon objective received empty belief')
  const hypotheses = [...grouped.values()]
    .sort((left, right) => {
      const length = Math.min(left.seats.length, right.seats.length)
      for (let index = 0; index < length; index++) {
        if (left.seats[index] !== right.seats[index]) {
          return left.seats[index] - right.seats[index]
        }
      }
      return left.seats.length - right.seats.length
    })
    .map((hypothesis) => ({
      evilSeats: hypothesis.seats,
      probability: hypothesis.probability / total,
    }))
  const countDistribution = Array<number>(playerCount).fill(0)
  for (const hypothesis of hypotheses) {
    countDistribution[hypothesis.evilSeats.length] += hypothesis.probability
  }
  const countTotal = countDistribution.reduce(
    (sum, probability) => sum + probability,
    0,
  )
  for (let count = 0; count < countDistribution.length; count++) {
    countDistribution[count] /= countTotal
  }
  return {
    probabilitySemantics: 'resolved-complete-world-sum',
    excludesCoordinationSemantics: true,
    hypotheses,
    countDistribution,
  }
}

function objectiveAssessments(input: {
  req: DecisionRequest
  view: PlayerView
  identity: PrivateIdentitySnapshot
  candidates: readonly PolicyCandidate[]
  coordination: readonly Seat[]
  oberonPosterior?: NonNullable<
    PrivateEvilRoleObjectiveSnapshot['oberonUnseenEvilPosterior']
  >
}): readonly EvilCandidateObjective[] {
  const relevant = input.candidates.flatMap((candidate) => {
    const team = teamForCandidate(candidate, input.view)
    return team
      && (
        candidate.kind === 'propose'
        || candidate.kind === 'finalize'
        || candidate.kind === 'vote'
      )
      ? [{ candidate, team: [...team].sort((a, b) => a - b) }]
      : []
  })
  const publicTeams = assessPublicJointTeams(
    projectPublicRecord(input.view),
    relevant.map((entry) => entry.team),
  )
  const privateTotal =
    input.identity.hiddenTeamPosterior!.hypotheses.reduce(
      (sum, hypothesis) => sum + hypothesis.probability,
      0,
    )
  if (!(privateTotal > 0)) {
    throw new Error('evil objective received empty hidden-team posterior')
  }
  return relevant.map(({ candidate, team }, index) => {
    const distribution = Array<number>(team.length + 1).fill(0)
    for (const hypothesis of input.identity.hiddenTeamPosterior!.hypotheses) {
      const evil = team.filter(
        (seat) => hypothesis.evilSeats.includes(seat),
      ).length
      distribution[evil] += hypothesis.probability
    }
    for (let count = 0; count < distribution.length; count++) {
      distribution[count] /= privateTotal
    }
    const publicDistribution = publicTeams[index].evilCountDistribution
    const unseenEvilOnTeamProbability = input.oberonPosterior
      ? input.oberonPosterior.hypotheses.reduce(
          (sum, hypothesis) =>
            sum + (
              hypothesis.evilSeats.some((seat) => team.includes(seat))
                ? hypothesis.probability
                : 0
            ),
          0,
        )
      : undefined
    return {
      candidateId: candidate.id,
      kind: candidate.kind as EvilCandidateObjective['kind'],
      direction: directionForCandidate(candidate),
      team,
      probabilitySemantics: 'resolved-complete-world-sum',
      teamFailureCapabilityProbability:
        failureProbability(distribution, input.view.quests[input.req.round - 1].failsRequired),
      evilCountDistribution: distribution,
      publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint',
      publicTeamFailureCapabilityProbability:
        failureProbability(
          publicDistribution,
          input.view.quests[input.req.round - 1].failsRequired,
        ),
      publicEvilCountDistribution: publicDistribution,
      coordination: input.oberonPosterior
        ? {
            kind: 'self-only-uncoordinated',
            semantics: 'oberon-self-is-not-coordination',
            selfAboard: team.includes(input.req.seat),
          }
        : {
            kind: 'visible-coordination',
            semantics: 'private-visible-evil-seats-only',
            coordinatedEvilAboard: team.filter(
              (seat) => input.coordination.includes(seat),
            ).length,
          },
      ...(unseenEvilOnTeamProbability === undefined
        ? {}
        : { unseenEvilOnTeamProbability }),
    }
  })
}

export function buildEvilRoleObjectiveSnapshot(input: {
  req: DecisionRequest
  view: PlayerView
  identity: PrivateIdentitySnapshot
  observer: PublicObserverSnapshot
  candidates: readonly PolicyCandidate[]
}): PrivateEvilRoleObjectiveSnapshot {
  const { req, view, identity, observer, candidates } = input
  if (
    !EVIL_ROLES.has(view.role as EvilObjectiveRole)
    || view.alignment !== 'evil'
    || req.seat !== view.seat
    || candidates.length > MAX_EVIL_ROLE_OBJECTIVE_ASSESSMENTS
    || identity.version !== JOINT_IDENTITY_MODEL_VERSION
    || !identity.scope.hiddenTeam
    || !identity.hiddenTeamPosterior
    || identity.sourceBelief.throughSeq
      !== Math.max(0, ...view.events.map((event) => event.seq))
    || identity.sourceBelief.playerCount !== view.playerCount
    || !isDeepStrictEqual(
      identity.sourceBelief.rolesInPlay,
      [...view.rolesInPlay].sort(
        (left, right) =>
          (roleRank.get(left) ?? 99) - (roleRank.get(right) ?? 99),
      ),
    )
    || observer.version !== PUBLIC_OBSERVER_MODEL_VERSION
    || !isDeepStrictEqual(observer, observePublicRecord(projectPublicRecord(view)))
  ) {
    throw new Error('evil objective received inconsistent private sources')
  }
  const quest = view.quests[req.round - 1]
  if (!quest || (quest.failsRequired !== 1 && quest.failsRequired !== 2)) {
    throw new Error('evil objective requires the current quest failure threshold')
  }
  const role = view.role as EvilObjectiveRole
  const coordination = role === 'oberon'
    ? [view.seat]
    : [...new Set([
        view.seat,
        ...(view.privateInfo.evilPartners ?? []),
      ])].sort((left, right) => left - right)
  if (
    coordination.some(
      (seat) =>
        !Number.isSafeInteger(seat)
        || seat < 0
        || seat >= view.playerCount,
    )
  ) throw new Error('evil objective received invalid visible partners')
  const oberonPosterior = role === 'oberon'
    ? oberonUnseenPosterior(
        identity.hiddenTeamPosterior,
        view.seat,
        view.playerCount,
      )
    : undefined
  const snapshot: PrivateEvilRoleObjectiveSnapshot = {
    version: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
    role,
    source: {
      beliefModelVersion: identity.sourceBelief.modelVersion,
      beliefThroughSeq: identity.sourceBelief.throughSeq,
      beliefQuality: identity.sourceBelief.quality,
      playerCount: view.playerCount,
      rolesInPlay: [...view.rolesInPlay].sort(
        (left, right) =>
          (roleRank.get(left) ?? 99) - (roleRank.get(right) ?? 99),
      ),
      identityModelVersion: identity.version,
      observerModelVersion: observer.version,
      observerFeasibleWorldCount: observer.feasibleWorldCount,
    },
    request: {
      seat: req.seat,
      kind: req.kind,
      round: req.round,
      proposalNum: req.proposalNum,
      failsRequired: quest.failsRequired,
    },
    posture: {
      kind: POSTURE[role],
      semantics: 'explicit-role-posture-not-policy',
    },
    coordination: {
      ...(role === 'oberon'
        ? {
            kind: 'self-only-uncoordinated' as const,
            semantics: 'oberon-has-no-visible-evil-partners' as const,
            self: view.seat,
            visiblePartnerSeats: [] as const,
            knowsPartnerSpecialRoles: false as const,
          }
        : {
            kind: 'visible-partners' as const,
            semantics: 'private-visible-evil-seats-only' as const,
            seats: coordination,
            excludesUnseenOberon: true as const,
            knowsPartnerSpecialRoles: false as const,
          }),
    },
    publicStanding: publicStanding(view, observer),
    ...(oberonPosterior
      ? { oberonUnseenEvilPosterior: oberonPosterior }
      : {}),
    assessmentApplicability:
      req.kind === 'propose'
      || req.kind === 'finalize'
      || req.kind === 'vote'
        ? 'team-candidates'
        : 'not-applicable-to-decision-kind',
    assessments: objectiveAssessments({
      req,
      view,
      identity,
      candidates,
      coordination,
      oberonPosterior,
    }),
  }
  if (
    Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
      > MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES
  ) throw new Error('evil objective exceeds its private payload bound')
  return snapshot
}

export function validatePrivateEvilRoleObjectiveSnapshot(
  value: unknown,
): value is PrivateEvilRoleObjectiveSnapshot {
  if (!plainDetachedData(value)) return false
  try {
    if (
      Buffer.byteLength(JSON.stringify(value), 'utf8')
        > MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES
      || !value
      || typeof value !== 'object'
      || Array.isArray(value)
    ) return false
    const snapshot = value as unknown as Record<string, unknown>
    if (
      !exactKeys(snapshot, [
        'version',
        'role',
        'source',
        'request',
        'posture',
        'coordination',
        'publicStanding',
        ...(snapshot.oberonUnseenEvilPosterior === undefined
          ? []
          : ['oberonUnseenEvilPosterior']),
        'assessmentApplicability',
        'assessments',
      ])
      || snapshot.version !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      || !EVIL_ROLES.has(snapshot.role as EvilObjectiveRole)
    ) return false
    const role = snapshot.role as EvilObjectiveRole
    const source = snapshot.source as Record<string, unknown>
    const request = snapshot.request as Record<string, unknown>
    const posture = snapshot.posture as Record<string, unknown>
    const coordination = snapshot.coordination as Record<string, unknown>
    if (
      !source
      || typeof source !== 'object'
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
      || !Number.isSafeInteger(source.beliefThroughSeq)
      || !['constraints-only', 'weighted', 'degraded'].includes(
        String(source.beliefQuality),
      )
      || !Number.isSafeInteger(source.playerCount)
      || (source.playerCount as number) < 5
      || (source.playerCount as number) > 10
      || !canonicalRoles(source.rolesInPlay, source.playerCount as number)
      || source.identityModelVersion !== JOINT_IDENTITY_MODEL_VERSION
      || source.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
      || !Number.isSafeInteger(source.observerFeasibleWorldCount)
      || (source.observerFeasibleWorldCount as number) <= 0
      || !request
      || typeof request !== 'object'
      || !exactKeys(request, [
        'seat',
        'kind',
        'round',
        'proposalNum',
        'failsRequired',
      ])
      || !Number.isSafeInteger(request.seat)
      || (request.seat as number) < 0
      || (request.seat as number) >= (source.playerCount as number)
      || !['discuss', 'propose', 'finalize', 'vote', 'quest', 'assassinate']
        .includes(String(request.kind))
      || !Number.isSafeInteger(request.round)
      || (request.round as number) < 1
      || (request.round as number) > 5
      || !Number.isSafeInteger(request.proposalNum)
      || (request.proposalNum as number) < 1
      || (request.proposalNum as number) > 5
      || ![1, 2].includes(request.failsRequired as number)
      || !posture
      || typeof posture !== 'object'
      || !exactKeys(posture, ['kind', 'semantics'])
      || posture.kind !== POSTURE[role]
      || posture.semantics !== 'explicit-role-posture-not-policy'
      || !coordination
      || typeof coordination !== 'object'
      || coordination.knowsPartnerSpecialRoles !== false
      || !denseArray(snapshot.publicStanding)
      || snapshot.publicStanding.length !== source.playerCount
      || !denseArray(snapshot.assessments)
      || snapshot.assessments.length > MAX_EVIL_ROLE_OBJECTIVE_ASSESSMENTS
    ) return false
    if (
      role === 'oberon'
        ? (
            !exactKeys(coordination, [
              'kind',
              'semantics',
              'self',
              'visiblePartnerSeats',
              'knowsPartnerSpecialRoles',
            ])
            || coordination.kind !== 'self-only-uncoordinated'
            || coordination.semantics
              !== 'oberon-has-no-visible-evil-partners'
            || coordination.self !== request.seat
            || !denseArray(coordination.visiblePartnerSeats)
            || coordination.visiblePartnerSeats.length !== 0
          )
        : (
            !exactKeys(coordination, [
              'kind',
              'semantics',
              'seats',
              'excludesUnseenOberon',
              'knowsPartnerSpecialRoles',
            ])
            || coordination.kind !== 'visible-partners'
            || coordination.semantics !== 'private-visible-evil-seats-only'
            || coordination.excludesUnseenOberon !== true
            || !canonicalSeats(
              coordination.seats,
              source.playerCount as number,
            )
            || !(coordination.seats as Seat[]).includes(request.seat as Seat)
          )
    ) return false
    const teamApplicable = ['propose', 'finalize', 'vote'].includes(
      String(request.kind),
    )
    if (
      snapshot.assessmentApplicability !== (
        teamApplicable
          ? 'team-candidates'
          : 'not-applicable-to-decision-kind'
      )
      || (!teamApplicable && snapshot.assessments.length !== 0)
    ) return false
    if (
      role === 'oberon'
        !== (snapshot.oberonUnseenEvilPosterior !== undefined)
    ) return false
    let oberonHypotheses:
      NonNullable<
        PrivateEvilRoleObjectiveSnapshot['oberonUnseenEvilPosterior']
      >['hypotheses'] | undefined
    if (role === 'oberon') {
      const posterior =
        snapshot.oberonUnseenEvilPosterior as Record<string, unknown>
      if (
        !posterior
        || typeof posterior !== 'object'
        || !exactKeys(posterior, [
          'probabilitySemantics',
          'excludesCoordinationSemantics',
          'hypotheses',
          'countDistribution',
        ])
        || posterior.probabilitySemantics
          !== 'resolved-complete-world-sum'
        || posterior.excludesCoordinationSemantics !== true
        || !denseArray(posterior.hypotheses)
        || posterior.hypotheses.length === 0
        || posterior.hypotheses.length > 252
        || !denseArray(posterior.countDistribution)
        || posterior.countDistribution.length !== source.playerCount
        || posterior.countDistribution.some((entry) => !probability(entry))
      ) return false
      let total = 0
      let prior = ''
      const derivedCounts = Array<number>(source.playerCount as number).fill(0)
      for (const raw of posterior.hypotheses) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
        const hypothesis = raw as Record<string, unknown>
        if (
          !exactKeys(hypothesis, ['evilSeats', 'probability'])
          || !canonicalSeats(
            hypothesis.evilSeats,
            source.playerCount as number,
          )
          || (hypothesis.evilSeats as Seat[]).includes(request.seat as Seat)
          || !probability(hypothesis.probability)
          || hypothesis.probability === 0
        ) return false
        const key = (hypothesis.evilSeats as Seat[]).join(',')
        if (prior && prior >= key) return false
        prior = key
        total += hypothesis.probability as number
        derivedCounts[(hypothesis.evilSeats as Seat[]).length] +=
          hypothesis.probability as number
      }
      if (
        Math.abs(total - 1) > PROBABILITY_TOLERANCE
        || !isDeepStrictEqual(
          (posterior.countDistribution as number[]).map(
            (value) => Math.round(value / PROBABILITY_TOLERANCE),
          ),
          derivedCounts.map(
            (value) => Math.round(value / PROBABILITY_TOLERANCE),
          ),
        )
      ) return false
      oberonHypotheses = posterior.hypotheses as typeof oberonHypotheses
    }
    // Strict host validation below owns all nested equations. These checks make
    // the detached validator reject shape/key/probability corruption early.
    for (const [seat, raw] of snapshot.publicStanding.entries()) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
      const standing = raw as Record<string, unknown>
      if (
        !exactKeys(standing, [
          'seat',
          'probabilitySemantics',
          'goodProbability',
          'evilProbability',
          'evilWorldNumerator',
          'feasibleWorldDenominator',
          'observationSemantics',
          'selection',
          'approval',
          'failedQuestExposure',
          'proxySemantics',
          'burnProxyIndex',
          'coverProxyIndex',
          'standingProxyIndex',
        ])
        || standing.seat !== seat
        || standing.probabilitySemantics !== 'public-uniform-feasible-joint'
        || !probability(standing.goodProbability)
        || !probability(standing.evilProbability)
        || Math.abs(
          (standing.goodProbability as number)
            + (standing.evilProbability as number) - 1,
        ) > PROBABILITY_TOLERANCE
        || !Number.isSafeInteger(standing.evilWorldNumerator)
        || (standing.evilWorldNumerator as number) < 0
        || !Number.isSafeInteger(standing.feasibleWorldDenominator)
        || standing.feasibleWorldDenominator !== source.observerFeasibleWorldCount
        || (standing.evilWorldNumerator as number)
          > (standing.feasibleWorldDenominator as number)
        || Math.abs(
          (standing.evilWorldNumerator as number)
            / (standing.feasibleWorldDenominator as number)
            - (standing.evilProbability as number),
        ) > PROBABILITY_TOLERANCE
        || standing.observationSemantics !== 'public-counts-no-data-is-null'
        || standing.proxySemantics
          !== 'bounded-deterministic-indices-not-probabilities'
      ) return false
      for (const key of [
        'selection',
        'approval',
        'failedQuestExposure',
      ] as const) {
        const fraction = standing[key] as Record<string, unknown>
        if (
          !fraction
          || typeof fraction !== 'object'
          || !exactKeys(fraction, ['numerator', 'denominator', 'index'])
          || !Number.isSafeInteger(fraction.numerator)
          || !Number.isSafeInteger(fraction.denominator)
          || (fraction.numerator as number) < 0
          || (fraction.denominator as number) < (fraction.numerator as number)
          || (
            fraction.denominator === 0
              ? fraction.index !== null
              : (
                  !probability(fraction.index)
                  || Math.abs(
                    (fraction.index as number)
                      - (fraction.numerator as number)
                        / (fraction.denominator as number),
                  ) > PROBABILITY_TOLERANCE
                )
          )
        ) return false
      }
      for (const key of [
        'burnProxyIndex',
        'coverProxyIndex',
        'standingProxyIndex',
      ] as const) {
        if (standing[key] !== null && !probability(standing[key])) return false
      }
      const selection = standing.selection as ObservationFraction
      const approval = standing.approval as ObservationFraction
      const exposure = standing.failedQuestExposure as ObservationFraction
      const expectedBurn = availableMean([
        approval.index === null ? null : 1 - approval.index,
        exposure.index,
      ])
      const expectedCover = availableMean([
        selection.index,
        approval.index,
        exposure.index === null ? null : 1 - exposure.index,
      ])
      const expectedStanding = availableMean([
        selection.index,
        expectedCover,
        expectedBurn === null ? null : 1 - expectedBurn,
      ])
      for (const [actual, expected] of [
        [standing.burnProxyIndex, expectedBurn],
        [standing.coverProxyIndex, expectedCover],
        [standing.standingProxyIndex, expectedStanding],
      ] as const) {
        if (
          actual === null || expected === null
            ? actual !== expected
            : Math.abs((actual as number) - expected) > PROBABILITY_TOLERANCE
        ) return false
      }
    }
    const seenCandidateIds = new Set<string>()
    for (const raw of snapshot.assessments) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
      const assessment = raw as Record<string, unknown>
      const hasUnseen = assessment.unseenEvilOnTeamProbability !== undefined
      if (
        !exactKeys(assessment, [
          'candidateId',
          'kind',
          'direction',
          'team',
          'probabilitySemantics',
          'teamFailureCapabilityProbability',
          'evilCountDistribution',
          'publicProbabilitySemantics',
          'publicTeamFailureCapabilityProbability',
          'publicEvilCountDistribution',
          'coordination',
          ...(hasUnseen ? ['unseenEvilOnTeamProbability'] : []),
        ])
        || typeof assessment.candidateId !== 'string'
        || !['propose', 'finalize', 'vote'].includes(String(assessment.kind))
        || !['support', 'oppose'].includes(String(assessment.direction))
        || !canonicalSeats(
          assessment.team,
          source.playerCount as number,
        )
        || assessment.probabilitySemantics
          !== 'resolved-complete-world-sum'
        || !probability(assessment.teamFailureCapabilityProbability)
        || assessment.publicProbabilitySemantics
          !== 'public-preaction-uniform-feasible-joint'
        || !probability(assessment.publicTeamFailureCapabilityProbability)
        || (role === 'oberon'
          ? !hasUnseen || !probability(assessment.unseenEvilOnTeamProbability)
          : hasUnseen)
      ) return false
      if (seenCandidateIds.has(assessment.candidateId as string)) return false
      seenCandidateIds.add(assessment.candidateId as string)
      const candidateCoordination =
        assessment.coordination as Record<string, unknown>
      if (
        !candidateCoordination
        || typeof candidateCoordination !== 'object'
        || (
          role === 'oberon'
            ? (
                !exactKeys(candidateCoordination, [
                  'kind',
                  'semantics',
                  'selfAboard',
                ])
                || candidateCoordination.kind !== 'self-only-uncoordinated'
                || candidateCoordination.semantics
                  !== 'oberon-self-is-not-coordination'
                || typeof candidateCoordination.selfAboard !== 'boolean'
              )
            : (
                !exactKeys(candidateCoordination, [
                  'kind',
                  'semantics',
                  'coordinatedEvilAboard',
                ])
                || candidateCoordination.kind !== 'visible-coordination'
                || candidateCoordination.semantics
                  !== 'private-visible-evil-seats-only'
                || !Number.isSafeInteger(
                  candidateCoordination.coordinatedEvilAboard,
                )
                || (candidateCoordination.coordinatedEvilAboard as number) < 0
                || (candidateCoordination.coordinatedEvilAboard as number)
                  > (assessment.team as Seat[]).length
              )
        )
      ) return false
      for (const distribution of [
        assessment.evilCountDistribution,
        assessment.publicEvilCountDistribution,
      ]) {
        if (
          !denseArray(distribution)
          || distribution.length !== (assessment.team as Seat[]).length + 1
          || distribution.some((entry) => !probability(entry))
          || Math.abs(
            (distribution as number[]).reduce((sum, entry) => sum + entry, 0)
              - 1,
          ) > PROBABILITY_TOLERANCE
        ) return false
      }
      const privateDistribution =
        assessment.evilCountDistribution as number[]
      const publicDistribution =
        assessment.publicEvilCountDistribution as number[]
      if (
        Math.abs(
          failureProbability(
            privateDistribution,
            request.failsRequired as number,
          ) - (assessment.teamFailureCapabilityProbability as number),
        ) > PROBABILITY_TOLERANCE
        || Math.abs(
          failureProbability(
            publicDistribution,
            request.failsRequired as number,
          ) - (assessment.publicTeamFailureCapabilityProbability as number),
        ) > PROBABILITY_TOLERANCE
      ) return false
      if (role === 'oberon') {
        const expectedUnseen = oberonHypotheses!.reduce(
          (sum, hypothesis) =>
            sum + (
              hypothesis.evilSeats.some(
                (seat) => (assessment.team as Seat[]).includes(seat),
              )
                ? hypothesis.probability
                : 0
            ),
          0,
        )
        if (
          Math.abs(
            expectedUnseen
              - (assessment.unseenEvilOnTeamProbability as number),
          ) > PROBABILITY_TOLERANCE
          || (
            assessment.coordination as Record<string, unknown>
          ).selfAboard
            !== (assessment.team as Seat[]).includes(request.seat as Seat)
        ) return false
      } else {
        const expectedCoordinated = (assessment.team as Seat[]).filter(
          (seat) => (coordination.seats as Seat[]).includes(seat),
        ).length
        if (
          (
            assessment.coordination as Record<string, unknown>
          ).coordinatedEvilAboard !== expectedCoordinated
        ) return false
      }
    }
    return true
  } catch {
    return false
  }
}

export function validatePrivateEvilRoleObjectiveHostJoin(
  value: unknown,
  input: {
    req: DecisionRequest
    view: PlayerView
    identity: PrivateIdentitySnapshot
    observer: PublicObserverSnapshot
    candidates: readonly PolicyCandidate[]
  },
): value is PrivateEvilRoleObjectiveSnapshot {
  if (!validatePrivateEvilRoleObjectiveSnapshot(value)) return false
  try {
    const hidden = input.identity.hiddenTeamPosterior
    if (!hidden) return false
    const marginals = Array.from(
      { length: input.view.playerCount },
      (_, seat) => {
        const evilProbability = hidden.hypotheses.reduce(
          (sum, hypothesis) =>
            sum + (
              hypothesis.evilSeats.includes(seat)
                ? hypothesis.probability
                : 0
            ),
          0,
        )
        return {
          seat,
          goodProbability: Math.max(0, Math.min(1, 1 - evilProbability)),
          evilProbability: Math.max(0, Math.min(1, evilProbability)),
        }
      },
    )
    if (
      !validatePrivateIdentityHostJoin(
        input.identity,
        input.view.rolesInPlay,
        marginals,
      )
    ) return false
    return isDeepStrictEqual(
      value,
      buildEvilRoleObjectiveSnapshot(input),
    )
  } catch {
    return false
  }
}
