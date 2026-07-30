import { isDeepStrictEqual } from 'node:util'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import {
  LEGAL_CANDIDATE_VERSION,
  type PolicyCandidate,
  type ForcedPolicyResult,
} from '../policy/types.ts'
import {
  candidateIdForDecision,
  compareCandidateIds,
} from '../policy/candidates.ts'
import {
  type CanonicalJsonValue,
} from '../components/canonical-json.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'
import {
  decodeCanonicalPrivateEvilRoleUtilityProjection,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  validatePrivateEvilRoleUtilityProjection,
  type PrivateEvilRoleUtilityProjection,
} from './evil-role-utility.ts'
import {
  decodeCanonicalPrivateMorganaCounterfeitObjective,
  validatePrivateMorganaCounterfeitObjective,
} from './morgana-counterfeit.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  type PrivateMorganaCounterfeitObjective,
} from './morgana-counterfeit-types.ts'
import {
  exactKeys,
  plainDataRecord as plainRecord,
} from '../components/canonical-shape.ts'

export const MORGANA_ROLE_UTILITY_PROJECTION_VERSION =
  'morgana-counterfeit-role-utility-v1'
export const MORGANA_ROLE_UTILITY_DEGRADATION =
  'morgana-role-utility-projection-failed'
export const MORGANA_ROLE_SCORER_DEGRADATION =
  'morgana-role-objective-scorer-failed'
export const MORGANA_ROLE_SCORER_VERSION =
  'morgana-counterfeit-role-scorer-v1'
export const MORGANA_ROLE_SEEDED_SCORER_VERSION =
  'morgana-counterfeit-role-seeded-vote-band-v1'
export const MORGANA_ROLE_SCORE_FEATURE_VERSION =
  'morgana-counterfeit-role-score-features-v1'
export const MAX_MORGANA_ROLE_UTILITY_ASSESSMENTS = 252
export const MORGANA_ROLE_UTILITY_CONSTANTS = Object.freeze({
  d2ViableBand: 0.04,
  seededVoteCounterfeitBand: 0.04,
})

export type MorganaRoleSelectionMode =
  | 'top-counterfeit-within-d2-band'
  | 'seeded-near-equal-vote-within-d2-band'

export interface MorganaRoleCandidateUtility {
  candidateId: string
  kind: 'propose' | 'vote'
  decision: Decision
  forcedAllowed: boolean
  d2RoleValue: number
  d2BandFloor: number
  inD2ViableBand: boolean
  counterfeitValue: number
  counterfeitRank: number
}

export interface PrivateMorganaRoleUtilityProjection {
  version: typeof MORGANA_ROLE_UTILITY_PROJECTION_VERSION
  role: 'morgana'
  source: {
    morganaCounterfeitObjectiveVersion:
      typeof MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    evilRoleUtilityVersion: typeof EVIL_ROLE_UTILITY_PROJECTION_VERSION
    beliefModelVersion: string
    beliefThroughSeq: number
    playerCount: number
  }
  request: {
    seat: Seat
    kind: 'propose' | 'vote'
    round: number
    proposalNum: number
    currentTeam?: readonly Seat[]
  }
  selectionMode: MorganaRoleSelectionMode
  d2ViableBand: number
  seededVoteCounterfeitBand: number
  maxD2RoleValue: number
  d2BandFloor: number
  seedDomain: string
  seedBucket?: 0 | 1
  selectedCandidateId: string
  selectedDecision: Decision
  forcedSelectedCandidateId?: string
  counterfeitObjective: PrivateMorganaCounterfeitObjective
  evilRoleUtility: PrivateEvilRoleUtilityProjection
  candidates: readonly MorganaRoleCandidateUtility[]
}

function stablePolicyBucket(input: string): 0 | 1 {
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 2 as 0 | 1
}

function canonicalTeam(team: readonly Seat[] | undefined): readonly Seat[] | undefined {
  return team === undefined
    ? undefined
    : [...team].sort((left, right) => left - right)
}

function sameTeam(
  left: readonly Seat[] | undefined,
  right: readonly Seat[] | undefined,
): boolean {
  return isDeepStrictEqual(canonicalTeam(left), canonicalTeam(right))
}

function rankByCounterfeit(
  rows: readonly {
    candidateId: string
    counterfeitValue: number
  }[],
): Map<string, number> {
  const ordered = [...rows].sort(
    (left, right) =>
      right.counterfeitValue - left.counterfeitValue
      || compareCandidateIds(left.candidateId, right.candidateId),
  )
  return new Map(ordered.map((row, index) => [row.candidateId, index + 1]))
}

function sameRequest(
  objective: PrivateMorganaCounterfeitObjective,
  d2: PrivateEvilRoleUtilityProjection,
  req: DecisionRequest,
  view: PlayerView,
): boolean {
  return (
    objective.role === 'morgana'
    && d2.role === 'morgana'
    && req.seat === view.seat
    && view.role === 'morgana'
    && (req.kind === 'propose' || req.kind === 'vote')
    && objective.request.seat === req.seat
    && objective.request.kind === req.kind
    && objective.request.round === req.round
    && objective.request.proposalNum === req.proposalNum
    && d2.request.seat === req.seat
    && d2.request.kind === req.kind
    && d2.request.round === req.round
    && d2.request.proposalNum === req.proposalNum
    && objective.source.beliefModelVersion === d2.source.beliefModelVersion
    && objective.source.beliefThroughSeq === d2.source.beliefThroughSeq
    && objective.source.playerCount === d2.source.playerCount
    && objective.source.playerCount === view.playerCount
    && (
      req.kind !== 'vote'
      || (
        sameTeam(objective.request.currentTeam, view.currentTeam)
        && view.currentTeam !== undefined
      )
    )
  )
}

interface MorganaRoleUtilityProjectionInput {
  req: DecisionRequest
  view: PlayerView
  candidates: readonly PolicyCandidate[]
  forced: ForcedPolicyResult
  counterfeitObjective: PrivateMorganaCounterfeitObjective
  evilRoleUtility: PrivateEvilRoleUtilityProjection
  selectionMode: MorganaRoleSelectionMode
  deterministicSeed: string
}

function buildMorganaRoleUtilityProjectionInternal(
  input: MorganaRoleUtilityProjectionInput,
  admittedDependencies: boolean,
): PrivateMorganaRoleUtilityProjection {
  const {
    req,
    view,
    candidates,
    forced,
    counterfeitObjective,
    evilRoleUtility,
    selectionMode,
    deterministicSeed,
  } = input
  if (req.kind !== 'propose' && req.kind !== 'vote') {
    throw new Error('Morgana role utility requires bound complete inputs')
  }
  if (
    !sameRequest(counterfeitObjective, evilRoleUtility, req, view)
    || (
      !admittedDependencies
      && (
        !validatePrivateMorganaCounterfeitObjective(counterfeitObjective)
        || !validatePrivateEvilRoleUtilityProjection(evilRoleUtility)
      )
    )
    || candidates.length === 0
    || candidates.length > MAX_MORGANA_ROLE_UTILITY_ASSESSMENTS
    || forced.allowedCandidateIds.length === 0
    || !deterministicSeed.trim()
  ) {
    throw new Error('Morgana role utility requires bound complete inputs')
  }
  const requestKind: 'propose' | 'vote' = req.kind
  const candidateIds = candidates.map((candidate) => candidate.id)
  const allowed = new Set(forced.allowedCandidateIds)
  const d2ById = new Map(
    evilRoleUtility.assessments.map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  )
  const counterfeitById = new Map(
    counterfeitObjective.assessments.map((assessment) => [
      assessment.candidate.candidateId,
      assessment,
    ]),
  )
  if (
    new Set(candidateIds).size !== candidates.length
    || d2ById.size !== candidates.length
    || counterfeitById.size !== candidates.length
    || forced.allowedCandidateIds.some((id) => !candidateIds.includes(id))
    || (
      forced.selectedCandidateId !== undefined
      && !allowed.has(forced.selectedCandidateId)
    )
  ) {
    throw new Error('Morgana role utility requires exact candidate surfaces')
  }
  const survivors = candidates.map((candidate) => {
    const d2Utility = d2ById.get(candidate.id)
    const counterfeitAssessment = counterfeitById.get(candidate.id)
    if (
      !d2Utility
      || !counterfeitAssessment
      || d2Utility.kind !== req.kind
      || counterfeitAssessment.candidate.kind !== req.kind
      || candidateIdForDecision(candidate.decision) !== candidate.id
      || !sameTeam(
        d2Utility.team,
        candidate.decision.kind === 'propose'
          ? candidate.decision.team
          : view.currentTeam,
      )
      || !sameTeam(
        counterfeitAssessment.candidate.team,
        candidate.decision.kind === 'propose'
          ? candidate.decision.team
          : view.currentTeam,
      )
    ) {
      throw new Error('Morgana role utility candidate join mismatch')
    }
    return {
      candidate,
      d2Utility,
      counterfeitAssessment,
    }
  }).filter(({ candidate }) => allowed.has(candidate.id))
  if (!survivors.length) {
    throw new Error('Morgana role utility requires a forced survivor')
  }
  const maxD2RoleValue = Math.max(
    ...survivors.map(({ d2Utility }) => d2Utility.roleValue),
  )
  const d2BandFloor =
    maxD2RoleValue - MORGANA_ROLE_UTILITY_CONSTANTS.d2ViableBand
  const band = survivors.filter(
    ({ d2Utility }) => d2Utility.roleValue >= d2BandFloor - 1e-12,
  )
  const ranks = rankByCounterfeit(
    band.map(({ candidate, counterfeitAssessment }) => ({
      candidateId: candidate.id,
      counterfeitValue: counterfeitAssessment.counterfeitValue,
    })),
  )
  const deterministicSelected = [...band].sort(
    (left, right) =>
      right.counterfeitAssessment.counterfeitValue
        - left.counterfeitAssessment.counterfeitValue
      || compareCandidateIds(left.candidate.id, right.candidate.id),
  )[0]
  const voteBand =
    req.kind === 'vote'
    && band.length === 2
    && band.every(({ candidate }) => candidate.decision.kind === 'vote')
    && Math.abs(
      band[0].counterfeitAssessment.counterfeitValue
        - band[1].counterfeitAssessment.counterfeitValue,
    ) <= MORGANA_ROLE_UTILITY_CONSTANTS.seededVoteCounterfeitBand + 1e-12
  const seedDomain = MORGANA_ROLE_SEEDED_SCORER_VERSION
  const seedBucket =
    selectionMode === 'seeded-near-equal-vote-within-d2-band'
    && voteBand
    && !forced.selectedCandidateId
      ? stablePolicyBucket([
          deterministicSeed,
          req.seat,
          req.kind,
          req.round,
          req.proposalNum,
          counterfeitObjective.source.beliefThroughSeq,
          seedDomain,
        ].join(':'))
      : undefined
  const seededVote = seedBucket === 0 ? 'approve' : 'reject'
  const selected = forced.selectedCandidateId
    ? survivors.find(
        ({ candidate }) => candidate.id === forced.selectedCandidateId,
      )
    : seedBucket === undefined
      ? deterministicSelected
      : band.find(
          ({ candidate }) =>
            candidate.decision.kind === 'vote'
            && candidate.decision.vote === seededVote,
        )
  if (!selected) {
    throw new Error('Morgana role utility could not select a legal candidate')
  }
  const rows = candidates.map((candidate): MorganaRoleCandidateUtility => {
    const d2Utility = d2ById.get(candidate.id)!
    const counterfeitAssessment = counterfeitById.get(candidate.id)!
    const inD2ViableBand =
      allowed.has(candidate.id)
      && d2Utility.roleValue >= d2BandFloor - 1e-12
    return {
      candidateId: candidate.id,
      kind: requestKind,
      decision: structuredClone(candidate.decision),
      forcedAllowed: allowed.has(candidate.id),
      d2RoleValue: d2Utility.roleValue,
      d2BandFloor,
      inD2ViableBand,
      counterfeitValue: counterfeitAssessment.counterfeitValue,
      counterfeitRank: inD2ViableBand
        ? ranks.get(candidate.id)!
        : 0,
    }
  })
  const projection: PrivateMorganaRoleUtilityProjection = {
    version: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
    role: 'morgana',
    source: {
      morganaCounterfeitObjectiveVersion:
        MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
      evilRoleUtilityVersion: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
      beliefModelVersion: counterfeitObjective.source.beliefModelVersion,
      beliefThroughSeq: counterfeitObjective.source.beliefThroughSeq,
      playerCount: counterfeitObjective.source.playerCount,
    },
    request: {
      seat: req.seat,
      kind: requestKind,
      round: req.round,
      proposalNum: req.proposalNum,
      ...(req.kind === 'vote'
        ? { currentTeam: canonicalTeam(view.currentTeam)! }
        : {}),
    },
    selectionMode,
    d2ViableBand: MORGANA_ROLE_UTILITY_CONSTANTS.d2ViableBand,
    seededVoteCounterfeitBand:
      MORGANA_ROLE_UTILITY_CONSTANTS.seededVoteCounterfeitBand,
    maxD2RoleValue,
    d2BandFloor,
    seedDomain,
    ...(seedBucket === undefined ? {} : { seedBucket }),
    selectedCandidateId: selected.candidate.id,
    selectedDecision: structuredClone(selected.candidate.decision),
    ...(forced.selectedCandidateId === undefined
      ? {}
      : { forcedSelectedCandidateId: forced.selectedCandidateId }),
    counterfeitObjective: structuredClone(counterfeitObjective),
    evilRoleUtility: structuredClone(evilRoleUtility),
    candidates: rows,
  }
  return projection
}

export function buildMorganaRoleUtilityProjection(
  input: MorganaRoleUtilityProjectionInput,
): PrivateMorganaRoleUtilityProjection {
  return buildMorganaRoleUtilityProjectionInternal(input, false)
}

/** Build from dependencies and roots already admitted by the kernel. */
export function buildAdmittedMorganaRoleUtilityProjection(
  input: MorganaRoleUtilityProjectionInput,
): PrivateMorganaRoleUtilityProjection {
  return buildMorganaRoleUtilityProjectionInternal(input, true)
}

const safeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

const seatArray = (value: unknown): value is readonly Seat[] =>
  Array.isArray(value)
  && value.every((seat) => safeInteger(seat) && seat >= 0)

function morganaRoleUtilitySchema(value: unknown): boolean {
  if (
    !plainRecord(value)
    || !exactKeys(value, [
      'version', 'role', 'source', 'request', 'selectionMode',
      'd2ViableBand', 'seededVoteCounterfeitBand', 'maxD2RoleValue',
      'd2BandFloor', 'seedDomain',
      ...(value.seedBucket === undefined ? [] : ['seedBucket']),
      'selectedCandidateId', 'selectedDecision',
      ...(value.forcedSelectedCandidateId === undefined
        ? []
        : ['forcedSelectedCandidateId']),
      'counterfeitObjective', 'evilRoleUtility',
      'candidates',
    ])
    || value.version !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    || value.role !== 'morgana'
    || !plainRecord(value.source)
    || !exactKeys(value.source, [
      'morganaCounterfeitObjectiveVersion', 'evilRoleUtilityVersion',
      'beliefModelVersion', 'beliefThroughSeq', 'playerCount',
    ])
    || value.source.morganaCounterfeitObjectiveVersion
      !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    || value.source.evilRoleUtilityVersion
      !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
    || typeof value.source.beliefModelVersion !== 'string'
    || !safeInteger(value.source.beliefThroughSeq)
    || !safeInteger(value.source.playerCount)
    || !plainRecord(value.request)
    || !exactKeys(value.request, [
      'seat', 'kind', 'round', 'proposalNum',
      ...(value.request.kind === 'vote' ? ['currentTeam'] : []),
    ])
    || !['propose', 'vote'].includes(String(value.request.kind))
    || !safeInteger(value.request.seat)
    || !safeInteger(value.request.round)
    || !safeInteger(value.request.proposalNum)
    || (
      value.request.kind === 'vote'
      && !seatArray(value.request.currentTeam)
    )
    || ![
      'top-counterfeit-within-d2-band',
      'seeded-near-equal-vote-within-d2-band',
    ].includes(String(value.selectionMode))
    || value.d2ViableBand
      !== MORGANA_ROLE_UTILITY_CONSTANTS.d2ViableBand
    || value.seededVoteCounterfeitBand
      !== MORGANA_ROLE_UTILITY_CONSTANTS.seededVoteCounterfeitBand
    || typeof value.maxD2RoleValue !== 'number'
    || typeof value.d2BandFloor !== 'number'
    || Math.abs(
      value.d2BandFloor
        - (value.maxD2RoleValue - value.d2ViableBand),
    ) > 1e-12
    || value.seedDomain !== MORGANA_ROLE_SEEDED_SCORER_VERSION
    || (
      value.seedBucket !== undefined
      && value.seedBucket !== 0
      && value.seedBucket !== 1
    )
    || typeof value.selectedCandidateId !== 'string'
    || !Array.isArray(value.candidates)
    || Object.keys(value.candidates).length !== value.candidates.length
    || value.candidates.length === 0
    || value.candidates.length > MAX_MORGANA_ROLE_UTILITY_ASSESSMENTS
  ) return false
  const counterfeitObjective =
    decodeCanonicalPrivateMorganaCounterfeitObjective(
      value.counterfeitObjective as CanonicalJsonValue,
    )
  const evilRoleUtility =
    decodeCanonicalPrivateEvilRoleUtilityProjection(
      value.evilRoleUtility as CanonicalJsonValue,
    )
  if (!counterfeitObjective || !evilRoleUtility) return false
  const d2ById = new Map(
    evilRoleUtility.assessments.map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  )
  const counterfeitById = new Map(
    counterfeitObjective.assessments.map((assessment) => [
      assessment.candidate.candidateId,
      assessment,
    ]),
  )
  const requestTeam = seatArray(value.request.currentTeam)
    ? value.request.currentTeam
    : undefined
  if (
    counterfeitObjective.role !== 'morgana'
    || evilRoleUtility.role !== 'morgana'
    || value.source.beliefModelVersion
      !== counterfeitObjective.source.beliefModelVersion
    || value.source.beliefModelVersion
      !== evilRoleUtility.source.beliefModelVersion
    || value.source.beliefThroughSeq
      !== counterfeitObjective.source.beliefThroughSeq
    || value.source.beliefThroughSeq
      !== evilRoleUtility.source.beliefThroughSeq
    || value.source.playerCount
      !== counterfeitObjective.source.playerCount
    || value.source.playerCount
      !== evilRoleUtility.source.playerCount
    || value.request.seat !== counterfeitObjective.request.seat
    || value.request.seat !== evilRoleUtility.request.seat
    || value.request.kind !== counterfeitObjective.request.kind
    || value.request.kind !== evilRoleUtility.request.kind
    || value.request.round !== counterfeitObjective.request.round
    || value.request.round !== evilRoleUtility.request.round
    || value.request.proposalNum
      !== counterfeitObjective.request.proposalNum
    || value.request.proposalNum
      !== evilRoleUtility.request.proposalNum
    || (
      value.request.kind === 'vote'
      && !sameTeam(
        requestTeam,
        counterfeitObjective.request.currentTeam,
      )
    )
    || d2ById.size !== value.candidates.length
    || counterfeitById.size !== value.candidates.length
  ) return false
  const d2BandFloor = value.d2BandFloor
  const ids = new Set<string>()
  for (const rawCandidate of value.candidates) {
    if (!plainRecord(rawCandidate)) return false
    const candidate = rawCandidate
    if (typeof candidate.candidateId !== 'string') return false
    const candidateId = candidate.candidateId
    const d2Utility = d2ById.get(candidateId)
    const counterfeitAssessment =
      counterfeitById.get(candidateId)
    if (
      !exactKeys(candidate, [
        'candidateId', 'kind', 'decision', 'forcedAllowed',
        'd2RoleValue', 'd2BandFloor', 'inD2ViableBand',
        'counterfeitValue', 'counterfeitRank',
      ])
      || ids.has(candidateId)
      || candidate.kind !== value.request.kind
      || typeof candidate.forcedAllowed !== 'boolean'
      || typeof candidate.d2RoleValue !== 'number'
      || candidate.d2BandFloor !== d2BandFloor
      || typeof candidate.inD2ViableBand !== 'boolean'
      || candidate.inD2ViableBand !== (
        candidate.forcedAllowed
        && candidate.d2RoleValue >= d2BandFloor - 1e-12
      )
      || typeof candidate.counterfeitValue !== 'number'
      || !safeInteger(candidate.counterfeitRank)
      || candidate.counterfeitRank < 0
      || !d2Utility
      || !counterfeitAssessment
      || d2Utility.roleValue !== candidate.d2RoleValue
      || counterfeitAssessment.counterfeitValue
        !== candidate.counterfeitValue
      || candidateIdForDecision(candidate.decision as Decision)
        !== candidateId
      || !sameTeam(
        d2Utility.team,
        (candidate.decision as Decision).kind === 'propose'
          ? (candidate.decision as Extract<Decision, { kind: 'propose' }>).team
          : requestTeam,
      )
      || !sameTeam(
        counterfeitAssessment.candidate.team,
        (candidate.decision as Decision).kind === 'propose'
          ? (candidate.decision as Extract<Decision, { kind: 'propose' }>).team
          : requestTeam,
      )
    ) return false
    ids.add(candidateId)
  }
  const survivors = value.candidates.filter(
    (candidate) => candidate.forcedAllowed,
  )
  if (!survivors.length) return false
  const maxD2 = Math.max(
    ...survivors.map((candidate) => candidate.d2RoleValue),
  )
  const bandRows = survivors.filter(
    (candidate) =>
      candidate.d2RoleValue >= d2BandFloor - 1e-12,
  )
  const ranked = [...bandRows].sort(
    (left, right) =>
      right.counterfeitValue - left.counterfeitValue
      || compareCandidateIds(left.candidateId, right.candidateId),
  )
  if (
    Math.abs(value.maxD2RoleValue - maxD2) > 1e-12
    || value.candidates.some((candidate) => {
      const rank = ranked.findIndex(
        (row) => row.candidateId === candidate.candidateId,
      )
      return candidate.counterfeitRank !== (
        rank === -1 ? 0 : rank + 1
      )
    })
  ) return false
  const seededEligible =
    value.selectionMode
      === 'seeded-near-equal-vote-within-d2-band'
    && value.request.kind === 'vote'
    && value.forcedSelectedCandidateId === undefined
    && bandRows.length === 2
    && bandRows.every(
      (candidate) => (candidate.decision as Decision).kind === 'vote',
    )
    && Math.abs(
      bandRows[0].counterfeitValue - bandRows[1].counterfeitValue,
    ) <= value.seededVoteCounterfeitBand + 1e-12
  if ((value.seedBucket !== undefined) !== seededEligible) return false
  const expectedSelected = value.forcedSelectedCandidateId
    ?? (
      value.seedBucket === undefined
        ? ranked[0]?.candidateId
        : `${LEGAL_CANDIDATE_VERSION}:vote:${
            value.seedBucket === 0 ? 'approve' : 'reject'
          }`
    )
  const selectedCandidateId = value.selectedCandidateId
  const selected = value.candidates.find(
    (candidate) => candidate.candidateId === selectedCandidateId,
  )
  return !!selected
    && selected.inD2ViableBand
    && value.selectedCandidateId === expectedSelected
    && isDeepStrictEqual(selected.decision, value.selectedDecision)
    && (
      value.forcedSelectedCandidateId === undefined
      || value.forcedSelectedCandidateId === value.selectedCandidateId
    )
}

const morganaRoleUtilityCodec =
  projectionCodec<PrivateMorganaRoleUtilityProjection>(
    morganaRoleUtilitySchema,
  )

export const validatePrivateMorganaRoleUtilityProjection =
  morganaRoleUtilityCodec.validate
export const decodeCanonicalPrivateMorganaRoleUtilityProjection =
  morganaRoleUtilityCodec.decode

export function validatePrivateMorganaRoleUtilityHostJoin(
  value: unknown,
  input: MorganaRoleUtilityProjectionInput,
): value is PrivateMorganaRoleUtilityProjection {
  if (
    !validatePrivateMorganaRoleUtilityProjection(value)
    || !validatePrivateMorganaCounterfeitObjective(
      input.counterfeitObjective,
    )
    || !validatePrivateEvilRoleUtilityProjection(input.evilRoleUtility)
  ) return false
  return exactHostJoin(buildMorganaRoleUtilityProjection)(value, input)
}

export const validateAdmittedPrivateMorganaRoleUtilityHostJoin = exactHostJoin(
  (input: MorganaRoleUtilityProjectionInput) =>
    buildMorganaRoleUtilityProjectionInternal(input, true),
)
