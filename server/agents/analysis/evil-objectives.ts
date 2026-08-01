import { isDeepStrictEqual } from 'node:util'
import { evilPartnersOf } from '../../engine/knowledge.ts'
import { proposalVotes } from '../../engine/rules.ts'
import type {
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import { DECISION_KINDS } from '../../engine/types.ts'
import { canonicalRoleMultiset } from '../belief/worlds.ts'
import {
  hiddenTeamEvilMarginals,
  JOINT_IDENTITY_MODEL_VERSION,
  type HiddenTeamPosterior,
  type PrivateIdentitySnapshot,
  validatePrivateIdentityHostJoin,
} from '../belief/identity.ts'
import { projectPublicRecord } from '../record/public-record.ts'
import type { PolicyCandidate } from '../candidate/types.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'
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
  type EvilCandidateObjective,
  type EvilObjectiveRole,
  type EvilRolePosture,
  type PrivateEvilRoleObjectiveSnapshot,
  type PublicEvilStanding,
  EVIL_OBJECTIVE_ROLES,
} from './evil-objective-types.ts'
import {
  canonicalRequestBlock,
  canonicalRoles,
  canonicalSeats,
  denseArray,
  exactKeys,
  probability,
  tableSize,
} from '../canonical/canonical-shape.ts'
import type {
  AssertNever,
  ConcatKeys,
  DuplicateKeys,
  ExactKeyList,
  MissingKeys,
} from '../../shared/key-list-guards.ts'
import {
  clampProbability,
  latticeCount,
  PROBABILITY_TOLERANCE,
} from '../canonical/probability-arithmetic.ts'
import {
  observationFraction,
  type ObservationFraction,
  validObservationFraction,
} from './observation-fraction.ts'

const EVIL_ROLES = new Set<EvilObjectiveRole>(EVIL_OBJECTIVE_ROLES)
const POSTURE: Record<EvilObjectiveRole, EvilRolePosture> = {
  assassin: 'assassin-shot-preservation',
  morgana: 'morgana-counterfeit-cover',
  mordred: 'mordred-deep-cover',
  minion: 'minion-failure-banking',
  oberon: 'oberon-uncoordinated-disruption',
}

function availableMean(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null)
  return available.length === 0
    ? null
    : available.reduce((sum, value) => sum + value, 0) / available.length
}

interface EvilStandingProxyIndices {
  burnProxyIndex: number | null
  coverProxyIndex: number | null
  standingProxyIndex: number | null
}

/**
 * The burn/cover/standing proxy triple, derived once for both the builder and
 * the schema from the three observation-fraction indices. availableMean and
 * the fraction indices are already shared this way; this triple was the one
 * derivation still written out by hand at both sites. Operator-for-operator
 * identical to both, including the null propagation through each mean.
 */
function evilStandingProxyIndices(
  selectionIndex: number | null,
  approvalIndex: number | null,
  failedQuestExposureIndex: number | null,
): EvilStandingProxyIndices {
  const burnProxyIndex = availableMean([
    approvalIndex === null ? null : 1 - approvalIndex,
    failedQuestExposureIndex,
  ])
  const coverProxyIndex = availableMean([
    selectionIndex,
    approvalIndex,
    failedQuestExposureIndex === null ? null : 1 - failedQuestExposureIndex,
  ])
  const standingProxyIndex = availableMean([
    selectionIndex,
    coverProxyIndex,
    burnProxyIndex === null ? null : 1 - burnProxyIndex,
  ])
  return { burnProxyIndex, coverProxyIndex, standingProxyIndex }
}

function publicStanding(
  view: PlayerView,
  observer: PublicObserverSnapshot,
): readonly PublicEvilStanding[] {
  const record = projectPublicRecord(view)
  const allVotes = record.proposals.flatMap((proposal) => proposalVotes(proposal))
  return observer.seats.map((assessment) => {
    const seat = assessment.seat
    const selected = observationFraction(
      record.proposals.filter((proposal) => proposal.team.includes(seat)).length,
      record.proposals.length,
    )
    const seatVotes = allVotes.filter((vote) => vote.seat === seat)
    const approval = observationFraction(
      seatVotes.filter((vote) => vote.vote === 'approve').length,
      seatVotes.length,
    )
    const questExposure = record.quests.filter(
      (quest) => quest.result !== undefined && quest.team?.includes(seat),
    )
    const failedQuestExposure = observationFraction(
      questExposure.filter((quest) => quest.result === 'fail').length,
      questExposure.length,
    )
    const { burnProxyIndex, coverProxyIndex, standingProxyIndex } =
      evilStandingProxyIndices(
        selected.index,
        approval.index,
        failedQuestExposure.index,
      )
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
      burnProxyIndex,
      coverProxyIndex,
      standingProxyIndex,
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
  return clampProbability(distribution
    .slice(failsRequired)
    .reduce((sum, mass) => sum + mass, 0))
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
          return left.seats[index]! - right.seats[index]!
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
    countDistribution[hypothesis.evilSeats.length]! += hypothesis.probability
  }
  const countTotal = countDistribution.reduce(
    (sum, mass) => sum + mass,
    0,
  )
  for (let count = 0; count < countDistribution.length; count++) {
    countDistribution[count]! /= countTotal
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
      distribution[evil]! += hypothesis.probability
    }
    for (let count = 0; count < distribution.length; count++) {
      distribution[count]! /= privateTotal
    }
    const publicDistribution = publicTeams[index]!.evilCountDistribution
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
        failureProbability(distribution, input.view.quests[input.req.round - 1]!.failsRequired),
      evilCountDistribution: distribution,
      publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint',
      publicTeamFailureCapabilityProbability:
        failureProbability(
          publicDistribution,
          input.view.quests[input.req.round - 1]!.failsRequired,
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
      canonicalRoleMultiset(view.rolesInPlay),
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
        ...evilPartnersOf(view.privateInfo),
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
    team: 'evil',
    role,
    source: {
      beliefModelVersion: identity.sourceBelief.modelVersion,
      beliefThroughSeq: identity.sourceBelief.throughSeq,
      beliefQuality: identity.sourceBelief.quality,
      playerCount: view.playerCount,
      rolesInPlay: canonicalRoleMultiset(view.rolesInPlay),
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
  return snapshot
}

/*
 * The assessment list appends `unseenEvilOnTeamProbability` only when the
 * assessment carried it, which is the shape where a hand-written binding compiles
 * and is still wrong: bound against the whole interface the optional key would be
 * counted twice whenever the spread fires, inflating the length `exactKeys`
 * compares and refusing every Oberon assessment. So the fixed half binds against
 * the interface with that key omitted, which makes naming it there a type error,
 * and both directions are asserted over the concatenation.
 *
 * The underscore-prefixed assertion aliases are exported only so noUnusedLocals
 * accepts them. Nothing imports one: it fails the build if its list drifts from the
 * shape it covers, so being referenced is not what makes it work, and deleting one
 * as dead would remove that check silently.
 */
const EVIL_CANDIDATE_UNSEEN_KEYS = [
  'unseenEvilOnTeamProbability',
] as const satisfies ExactKeyList<EvilCandidateObjective>

const EVIL_CANDIDATE_KEYS = [
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
] as const satisfies ExactKeyList<
  Omit<EvilCandidateObjective, 'unseenEvilOnTeamProbability'>
>
type EvilCandidateAllKeys = ConcatKeys<
  typeof EVIL_CANDIDATE_KEYS,
  typeof EVIL_CANDIDATE_UNSEEN_KEYS
>
export type _EvilCandidateKeysSound =
  | AssertNever<MissingKeys<EvilCandidateObjective, EvilCandidateAllKeys>>
  | AssertNever<DuplicateKeys<EvilCandidateAllKeys>>

type OberonHypotheses = NonNullable<
  PrivateEvilRoleObjectiveSnapshot['oberonUnseenEvilPosterior']
>['hypotheses']

/**
 * Source/request envelope check. The first slice of the original single-`||`
 * schema guard, extracted verbatim in the same short-circuit order, so a later
 * clause still only runs once an earlier one has proved the field it reads.
 */
function validateEvilSource(
  source: Record<string, unknown>,
  request: Record<string, unknown>,
): boolean {
  return !(
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
    || !tableSize(source.playerCount)
    || !canonicalRoles(source.rolesInPlay, source.playerCount as number)
    || source.identityModelVersion !== JOINT_IDENTITY_MODEL_VERSION
    || source.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
    || !Number.isSafeInteger(source.observerFeasibleWorldCount)
    || (source.observerFeasibleWorldCount as number) <= 0
    || !canonicalRequestBlock(request, {
      playerCount: source.playerCount as number,
      kinds: DECISION_KINDS,
    })
  )
}

/**
 * Role-specific coordination block. Runs only after the source/frame guards
 * above have proved playerCount and request.seat, exactly as the original.
 */
function validateCoordination(
  role: EvilObjectiveRole,
  coordination: Record<string, unknown>,
  source: Record<string, unknown>,
  request: Record<string, unknown>,
): boolean {
  return !(
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
  )
}

/**
 * Oberon posterior block. Returns `{ ok: true }` (no hypotheses) for non-Oberon
 * roles, `{ ok: false }` on any rejection, and the validated hypotheses when
 * present. Same clause set and short-circuit order as the inlined original.
 */
function validateOberonPosterior(
  role: EvilObjectiveRole,
  snapshot: Record<string, unknown>,
  source: Record<string, unknown>,
  request: Record<string, unknown>,
): { ok: false } | { ok: true; hypotheses?: OberonHypotheses } {
  if (role !== 'oberon') return { ok: true }
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
  ) return { ok: false }
  let total = 0
  let prior = ''
  const derivedCounts = Array<number>(source.playerCount as number).fill(0)
  for (const raw of posterior.hypotheses) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false }
    }
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
    ) return { ok: false }
    const key = (hypothesis.evilSeats as Seat[]).join(',')
    if (prior && prior >= key) return { ok: false }
    prior = key
    total += hypothesis.probability as number
    derivedCounts[(hypothesis.evilSeats as Seat[]).length]! +=
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
  ) return { ok: false }
  return { ok: true, hypotheses: posterior.hypotheses as OberonHypotheses }
}

/**
 * One publicStanding entry. Body of the original per-seat loop, verbatim, with
 * each rejection preserved in order; returns true when the entry is well formed.
 */
function validatePublicStandingEntry(
  seat: number,
  raw: unknown,
  source: Record<string, unknown>,
): boolean {
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
    // A public-uniform marginal is an integer count of feasible worlds over
    // the denominator beside it, so the question is which integer rather than
    // whether a fixed decimal slack covers the gap. See latticeCount.
    || latticeCount(
      standing.evilProbability,
      standing.feasibleWorldDenominator as number,
    ) !== standing.evilWorldNumerator
    || standing.observationSemantics !== 'public-counts-no-data-is-null'
    || standing.proxySemantics
      !== 'bounded-deterministic-indices-not-probabilities'
  ) return false
  for (const key of [
    'selection',
    'approval',
    'failedQuestExposure',
  ] as const) {
    if (!validObservationFraction(standing[key])) return false
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
  const {
    burnProxyIndex: expectedBurn,
    coverProxyIndex: expectedCover,
    standingProxyIndex: expectedStanding,
  } = evilStandingProxyIndices(
    selection.index,
    approval.index,
    exposure.index,
  )
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
  return true
}

/**
 * One assessment entry. Body of the original per-candidate loop, verbatim, with
 * every rejection kept in order; `seenCandidateIds` is threaded in so the
 * duplicate-id guard still spans the whole list.
 */
function validateAssessment(
  raw: unknown,
  role: EvilObjectiveRole,
  source: Record<string, unknown>,
  request: Record<string, unknown>,
  coordination: Record<string, unknown>,
  oberonHypotheses: OberonHypotheses | undefined,
  seenCandidateIds: Set<string>,
): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const assessment = raw as Record<string, unknown>
  const hasUnseen = assessment.unseenEvilOnTeamProbability !== undefined
  if (
    !exactKeys(assessment, [
      ...EVIL_CANDIDATE_KEYS,
      ...(hasUnseen ? EVIL_CANDIDATE_UNSEEN_KEYS : []),
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
  return true
}

function evilRoleObjectiveSchema(detached: unknown): boolean {
  if (
    !detached
    || typeof detached !== 'object'
    || Array.isArray(detached)
  ) return false
  const snapshot = detached as unknown as Record<string, unknown>
  if (
    !exactKeys(snapshot, [
      'version',
      'team',
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
    || snapshot.team !== 'evil'
    || !EVIL_ROLES.has(snapshot.role as EvilObjectiveRole)
  ) return false
  const role = snapshot.role as EvilObjectiveRole
  const source = snapshot.source as Record<string, unknown>
  const request = snapshot.request as Record<string, unknown>
  const posture = snapshot.posture as Record<string, unknown>
  const coordination = snapshot.coordination as Record<string, unknown>
  if (!validateEvilSource(source, request)) return false
  // Posture, coordination presence, and collection shapes: the tail of the
  // original source guard, kept inline and in place so nothing is reordered.
  if (
    !posture
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
  if (!validateCoordination(role, coordination, source, request)) return false
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
  const oberon = validateOberonPosterior(role, snapshot, source, request)
  if (!oberon.ok) return false
  const oberonHypotheses = oberon.hypotheses
  // Strict host validation below owns all nested equations. These checks make
  // the detached validator reject shape/key/probability corruption early.
  for (const [seat, raw] of snapshot.publicStanding.entries()) {
    if (!validatePublicStandingEntry(seat, raw, source)) return false
  }
  const seenCandidateIds = new Set<string>()
  for (const raw of snapshot.assessments) {
    if (
      !validateAssessment(
        raw,
        role,
        source,
        request,
        coordination,
        oberonHypotheses,
        seenCandidateIds,
      )
    ) return false
  }
  return true
}

const evilRoleObjectiveCodec =
  projectionCodec<PrivateEvilRoleObjectiveSnapshot>(evilRoleObjectiveSchema)

export const validatePrivateEvilRoleObjectiveSnapshot =
  evilRoleObjectiveCodec.validate
export const decodeCanonicalPrivateEvilRoleObjectiveSnapshot =
  evilRoleObjectiveCodec.decode

interface EvilRoleObjectiveHostJoinInput {
  req: DecisionRequest
  view: PlayerView
  identity: PrivateIdentitySnapshot
  observer: PublicObserverSnapshot
  candidates: readonly PolicyCandidate[]
}

export const validateAdmittedPrivateEvilRoleObjectiveHostJoin = exactHostJoin(
  (input: EvilRoleObjectiveHostJoinInput) =>
    buildEvilRoleObjectiveSnapshot(input),
)

export function validatePrivateEvilRoleObjectiveHostJoin(
  value: unknown,
  input: EvilRoleObjectiveHostJoinInput,
): value is PrivateEvilRoleObjectiveSnapshot {
  if (!validatePrivateEvilRoleObjectiveSnapshot(value)) return false
  const hidden = input.identity.hiddenTeamPosterior
  if (!hidden) return false
  const marginals = hiddenTeamEvilMarginals(
    hidden,
    input.view.playerCount,
  ).map((evilProbability, seat) => ({
    seat,
    goodProbability: clampProbability(1 - evilProbability),
    evilProbability,
  }))
  return validatePrivateIdentityHostJoin(
    input.identity,
    input.view.rolesInPlay,
    marginals,
  ) && validateAdmittedPrivateEvilRoleObjectiveHostJoin(
    value,
    input,
  )
}
