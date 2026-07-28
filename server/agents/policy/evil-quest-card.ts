import { isDeepStrictEqual } from 'node:util'
import { isProxy } from 'node:util/types'
import { fnv1a } from '../../engine/prng.ts'
import type {
  DecisionRequest,
  PlayerView,
  ProposalRecord,
  Role,
  Seat,
} from '../../engine/types.ts'
import type { SituationAnalysis } from '../analysis/types.ts'

export const EVIL_QUEST_CARD_POLICY_VERSION =
  'evil-quest-card-policy-v1'
export const EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION =
  'visible-evil-exact-quota-homogeneous-research-v1'
export const EVIL_QUEST_ROBUST_POLICY_VERSION =
  'evil-robust-heterogeneous-quest-policy-v1'
export const EVIL_QUEST_PUBLIC_CONTEXT_VERSION =
  'evil-quest-public-context-v1'
export const MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES = 8_192
export const EVIL_QUEST_CARD_POLICY_DEGRADATION =
  'evil-quest-card-policy-failed'

export type EvilQuestCardPolicyMode =
  | 'visible-exact-quota'
  | 'robust-heterogeneous'

export type EvilQuestCardPolicyReason =
  | 'EXACT_QUOTA_DESIGNATED_FAIL'
  | 'EXACT_QUOTA_NONDESIGNATED_SUCCESS'
  | 'INSUFFICIENT_VISIBLE_QUOTA_SUCCESS'
  | 'ROBUST_DECISIVE_FAIL'
  | 'ROBUST_LOCAL_SLOW_PLAY_FAIL'
  | 'ROBUST_LOCAL_SLOW_PLAY_HOLD'
  | 'SHARED_SLOW_PLAY_HOLD'
  | 'OBERON_UNCOORDINATED'
  | 'OUT_OF_SCOPE'

export interface EvilQuestPublicContext {
  version: typeof EVIL_QUEST_PUBLIC_CONTEXT_VERSION
  playerCount: number
  round: number
  proposalNum: number
  leaderSeat: Seat
  currentTeam: readonly Seat[]
  teamSize: number
  failsRequired: number
  priorQuests: readonly string[]
  priorProposals: readonly string[]
}

export interface PrivateEvilQuestCardPolicy {
  version: typeof EVIL_QUEST_CARD_POLICY_VERSION
  policyVersion:
    | typeof EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
    | typeof EVIL_QUEST_ROBUST_POLICY_VERSION
  mode: EvilQuestCardPolicyMode
  coordinationAssumption: 'homogeneous-common-policy-required' | 'none'
  populationAssumption:
    | 'homogeneous-all-evil-required'
    | 'heterogeneous-independent'
  mixedTableSafe: boolean
  promotionEvidenceEligible: boolean
  request: Readonly<DecisionRequest>
  role: Role
  applicable: boolean
  sourceContext: EvilQuestPublicContext
  sourceFingerprint: string
  failsRequired: number
  decisiveBoard: boolean
  visibleEvilCount: number
  visibleEvilAboardCount: number
  /** Homogeneous exact-only private cohort detail. */
  visibleEvilSeats?: readonly Seat[]
  visibleEvilAboard?: readonly Seat[]
  orderedVisibleEvilAboard?: readonly Seat[]
  designation?: readonly Seat[]
  slowPlayProbability?: number
  slowPlayBucket?: number
  sharedSlowPlayGateOpen?: boolean
  localSlowPlayFail?: boolean
  reason: EvilQuestCardPolicyReason
  selectedCard?: 'success' | 'fail'
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
  if (typeof value !== 'object' || seen.has(value) || isProxy(value)) {
    return false
  }
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) return false
  if (array) {
    const expected = Array.from(
      { length: value.length },
      (_, index) => String(index),
    )
    if (
      keys.length !== expected.length + 1
      || !keys.includes('length')
      || expected.some((key) => !keys.includes(key))
    ) return false
  }
  seen.add(value)
  try {
    for (const key of keys) {
      if (array && key === 'length') continue
      const descriptor = descriptors[String(key)]
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || !plainDetachedData(descriptor.value, seen)
      ) return false
    }
    return true
  } finally {
    seen.delete(value)
  }
}

function exactKeys(
  value: object,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length
    && keys.every((key) => expected.includes(key))
}

function seatArray(
  value: unknown,
  playerCount: number,
): value is readonly Seat[] {
  return Array.isArray(value)
    && value.every(
      (seat) =>
        Number.isSafeInteger(seat)
        && seat >= 0
        && seat < playerCount,
    )
    && new Set(value).size === value.length
}

/**
 * Strict detached transport validation for the private D3 payload.
 *
 * This proves the bounded schema and its internal mode invariants. The host
 * join below remains authoritative for request, seat view, public history,
 * and the selected action.
 */
export function validatePrivateEvilQuestCardPolicy(
  value: unknown,
): value is PrivateEvilQuestCardPolicy {
  try {
    if (
      !plainDetachedData(value)
      || !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || Buffer.byteLength(JSON.stringify(value), 'utf8')
        > MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES
    ) return false
    const policy = value as Record<string, unknown>
    const optional = [
      ...(policy.visibleEvilSeats === undefined
        ? [] : ['visibleEvilSeats']),
      ...(policy.visibleEvilAboard === undefined
        ? [] : ['visibleEvilAboard']),
      ...(policy.orderedVisibleEvilAboard === undefined
        ? [] : ['orderedVisibleEvilAboard']),
      ...(policy.designation === undefined ? [] : ['designation']),
      ...(policy.slowPlayProbability === undefined
        ? [] : ['slowPlayProbability']),
      ...(policy.slowPlayBucket === undefined ? [] : ['slowPlayBucket']),
      ...(policy.sharedSlowPlayGateOpen === undefined
        ? [] : ['sharedSlowPlayGateOpen']),
      ...(policy.localSlowPlayFail === undefined
        ? [] : ['localSlowPlayFail']),
      ...(policy.selectedCard === undefined ? [] : ['selectedCard']),
    ]
    if (!exactKeys(policy, [
      'version', 'policyVersion', 'mode', 'coordinationAssumption',
      'populationAssumption', 'mixedTableSafe',
      'promotionEvidenceEligible', 'request', 'role', 'applicable',
      'sourceContext', 'sourceFingerprint', 'failsRequired',
      'decisiveBoard', 'visibleEvilCount', 'visibleEvilAboardCount',
      'reason', ...optional,
    ])) return false
    const request = policy.request as Record<string, unknown>
    const context = policy.sourceContext as Record<string, unknown>
    if (
      policy.version !== EVIL_QUEST_CARD_POLICY_VERSION
      || (
        policy.mode !== 'visible-exact-quota'
        && policy.mode !== 'robust-heterogeneous'
      )
      || policy.policyVersion !== policyVersion(
        policy.mode as EvilQuestCardPolicyMode,
      )
      || !request
      || typeof request !== 'object'
      || Array.isArray(request)
      || !exactKeys(request, [
        'kind', 'seat', 'round', 'proposalNum',
      ])
      || request.kind !== 'quest'
      || !Number.isSafeInteger(request.seat)
      || !Number.isSafeInteger(request.round)
      || !Number.isSafeInteger(request.proposalNum)
      || typeof policy.role !== 'string'
      || typeof policy.applicable !== 'boolean'
      || !context
      || typeof context !== 'object'
      || Array.isArray(context)
      || !exactKeys(context, [
        'version', 'playerCount', 'round', 'proposalNum', 'leaderSeat',
        'currentTeam', 'teamSize', 'failsRequired', 'priorQuests',
        'priorProposals',
      ])
      || context.version !== EVIL_QUEST_PUBLIC_CONTEXT_VERSION
      || !Number.isSafeInteger(context.playerCount)
      || Number(context.playerCount) < 5
      || Number(context.playerCount) > 10
      || !Number.isSafeInteger(context.round)
      || !Number.isSafeInteger(context.proposalNum)
      || !Number.isSafeInteger(context.leaderSeat)
      || !seatArray(context.currentTeam, Number(context.playerCount))
      || !Number.isSafeInteger(context.teamSize)
      || context.teamSize !== context.currentTeam.length
      || !Number.isSafeInteger(context.failsRequired)
      || !Array.isArray(context.priorQuests)
      || !context.priorQuests.every((entry) => typeof entry === 'string')
      || !Array.isArray(context.priorProposals)
      || !context.priorProposals.every((entry) => typeof entry === 'string')
      || typeof policy.sourceFingerprint !== 'string'
      || !/^[0-9a-f]{8}$/.test(policy.sourceFingerprint)
      || !Number.isSafeInteger(policy.failsRequired)
      || Number(policy.failsRequired) < 1
      || policy.failsRequired !== context.failsRequired
      || typeof policy.decisiveBoard !== 'boolean'
      || !Number.isSafeInteger(policy.visibleEvilCount)
      || Number(policy.visibleEvilCount) < 0
      || !Number.isSafeInteger(policy.visibleEvilAboardCount)
      || Number(policy.visibleEvilAboardCount) < 0
      || typeof policy.reason !== 'string'
      || (
        policy.selectedCard !== undefined
        && policy.selectedCard !== 'success'
        && policy.selectedCard !== 'fail'
      )
      || (
        policy.slowPlayProbability !== undefined
        && (
          typeof policy.slowPlayProbability !== 'number'
          || policy.slowPlayProbability < 0
          || policy.slowPlayProbability > 1
        )
      )
      || (
        policy.slowPlayBucket !== undefined
        && (
          typeof policy.slowPlayBucket !== 'number'
          || policy.slowPlayBucket < 0
          || policy.slowPlayBucket > 1
        )
      )
    ) return false
    const exact = policy.mode === 'visible-exact-quota'
    const visible = policy.visibleEvilSeats
    const aboard = policy.visibleEvilAboard
    const ordered = policy.orderedVisibleEvilAboard
    const designation = policy.designation
    if (exact) {
      if (
        policy.coordinationAssumption
          !== 'homogeneous-common-policy-required'
        || policy.populationAssumption !== 'homogeneous-all-evil-required'
        || policy.mixedTableSafe !== false
        || policy.promotionEvidenceEligible !== false
        || !seatArray(visible, Number(context.playerCount))
        || !seatArray(aboard, Number(context.playerCount))
        || !seatArray(ordered, Number(context.playerCount))
        || !seatArray(designation, Number(context.playerCount))
        || aboard.some((seat) => !visible.includes(seat))
        || ordered.length !== aboard.length
        || ordered.some((seat) => !aboard.includes(seat))
        || designation.some((seat) => !aboard.includes(seat))
        || policy.visibleEvilCount !== visible.length
        || policy.visibleEvilAboardCount !== aboard.length
        || policy.localSlowPlayFail !== undefined
      ) return false
    } else if (
      policy.coordinationAssumption !== 'none'
      || policy.populationAssumption !== 'heterogeneous-independent'
      || policy.mixedTableSafe !== true
      || policy.promotionEvidenceEligible !== true
      || visible !== undefined
      || aboard !== undefined
      || ordered !== undefined
      || designation !== undefined
      || policy.sharedSlowPlayGateOpen !== undefined
      || typeof policy.visibleEvilAboardCount !== 'number'
      || typeof policy.visibleEvilCount !== 'number'
      || policy.visibleEvilAboardCount > policy.visibleEvilCount
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function policyVersion(
  mode: EvilQuestCardPolicyMode,
): PrivateEvilQuestCardPolicy['policyVersion'] {
  return mode === 'visible-exact-quota'
    ? EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
    : EVIL_QUEST_ROBUST_POLICY_VERSION
}

function canonicalVisibleEvil(view: PlayerView): readonly Seat[] {
  if (view.alignment !== 'evil' || view.role === 'oberon') return []
  return [...new Set([
    view.seat,
    ...(view.privateInfo.evilPartners ?? []),
  ])].sort((a, b) => a - b)
}

function canonicalVotes(proposal: ProposalRecord): string {
  return [...(proposal.votes ?? [])]
    .sort((left, right) => left.seat - right.seat)
    .map((vote) => `${vote.seat}=${vote.vote}`)
    .join(',')
}

export function evilQuestPublicContext(
  req: DecisionRequest,
  view: PlayerView,
  failsRequired: number,
): EvilQuestPublicContext {
  const currentTeam = [...(view.currentTeam ?? [])].sort((a, b) => a - b)
  return {
    version: EVIL_QUEST_PUBLIC_CONTEXT_VERSION,
    playerCount: view.playerCount,
    round: req.round,
    proposalNum: req.proposalNum,
    leaderSeat: view.leaderSeat,
    currentTeam,
    teamSize: view.quests[view.round - 1]?.teamSize ?? currentTeam.length,
    failsRequired,
    priorQuests: view.quests
      .filter((quest) => quest.num < view.round && quest.result !== undefined)
      .map((quest) =>
        `${quest.num}:${quest.result}:${quest.failCount ?? 0}:`
        + `${[...(quest.team ?? [])].sort((a, b) => a - b).join(',')}`),
    priorProposals: view.proposals
      .filter((proposal) =>
        proposal.round < view.round
        || (
          proposal.round === view.round
          && proposal.proposalNum <= view.proposalNum
        ))
      .sort((left, right) =>
        left.round - right.round || left.proposalNum - right.proposalNum)
      .map((proposal) =>
        `${proposal.round}.${proposal.proposalNum}:${proposal.leader}:`
        + `${[...proposal.team].sort((a, b) => a - b).join(',')}:`
        + `${[...(proposal.revisedFrom ?? [])]
          .sort((a, b) => a - b).join(',')}:`
        + `${proposal.approved ?? 'pending'}:${proposal.auto ?? false}:`
        + `${canonicalVotes(proposal)}`),
  }
}

function contextKey(context: EvilQuestPublicContext): string {
  return JSON.stringify(context)
}

function fingerprint(context: EvilQuestPublicContext): string {
  return fnv1a(contextKey(context)).toString(16).padStart(8, '0')
}

function rotateVisibleAboard(
  context: EvilQuestPublicContext,
  visibleEvilSeats: readonly Seat[],
  visibleEvilAboard: readonly Seat[],
): readonly Seat[] {
  if (!visibleEvilSeats.length) return []
  const offset = fnv1a([
    EVIL_QUEST_CARD_POLICY_VERSION,
    'homogeneous-designation',
    contextKey(context),
  ].join(':')) % visibleEvilSeats.length
  return [
    ...visibleEvilSeats.slice(offset),
    ...visibleEvilSeats.slice(0, offset),
  ].filter((seat) => visibleEvilAboard.includes(seat))
}

function slowPlayProbability(context: EvilQuestPublicContext): number {
  return context.teamSize === 2 ? 0.15
    : context.round === 1 ? 0.4
      : 0.55
}

function bucket(key: string): number {
  return fnv1a(key) / 0x1_0000_0000
}

/**
 * Private, deterministic quest-card policy. Exact quota is an explicitly
 * homogeneous research ceiling. Robust mode makes no teammate-coordination
 * assumption and uses only seat-local randomness off decisive boards.
 */
export function buildPrivateEvilQuestCardPolicy(input: {
  req: DecisionRequest
  view: PlayerView
  analysis: SituationAnalysis
  mode: EvilQuestCardPolicyMode
}): PrivateEvilQuestCardPolicy {
  const { req, view, analysis, mode } = input
  const context = evilQuestPublicContext(req, view, analysis.failsRequired)
  const visibleEvilSeats = canonicalVisibleEvil(view)
  const team = new Set(context.currentTeam)
  const visibleEvilAboard =
    visibleEvilSeats.filter((seat) => team.has(seat))
  const failsRequired = analysis.failsRequired
  const decisiveBoard = analysis.matchPoint.good || analysis.matchPoint.evil
  const exact = mode === 'visible-exact-quota'
  const orderedVisibleEvilAboard = exact
    ? rotateVisibleAboard(context, visibleEvilSeats, visibleEvilAboard)
    : []
  const common: Omit<
    PrivateEvilQuestCardPolicy,
    'applicable' | 'reason' | 'selectedCard'
      | 'designation' | 'slowPlayProbability' | 'slowPlayBucket'
      | 'sharedSlowPlayGateOpen' | 'localSlowPlayFail'
  > = {
    version: EVIL_QUEST_CARD_POLICY_VERSION,
    policyVersion: policyVersion(mode),
    mode,
    coordinationAssumption: exact
      ? 'homogeneous-common-policy-required' as const
      : 'none' as const,
    populationAssumption: exact
      ? 'homogeneous-all-evil-required' as const
      : 'heterogeneous-independent' as const,
    mixedTableSafe: !exact,
    promotionEvidenceEligible: !exact,
    request: { ...req },
    role: view.role,
    sourceContext: context,
    sourceFingerprint: fingerprint(context),
    failsRequired,
    decisiveBoard,
    visibleEvilCount: visibleEvilSeats.length,
    visibleEvilAboardCount: visibleEvilAboard.length,
    ...(exact
      ? {
          visibleEvilSeats,
          visibleEvilAboard,
          orderedVisibleEvilAboard,
        }
      : {}),
  }

  if (req.kind !== 'quest' || view.alignment !== 'evil') {
    return {
      ...common,
      applicable: false,
      ...(exact ? { designation: [] } : {}),
      reason: 'OUT_OF_SCOPE',
    }
  }
  if (view.role === 'oberon') {
    return {
      ...common,
      applicable: false,
      ...(exact ? { designation: [] } : {}),
      reason: 'OBERON_UNCOORDINATED',
    }
  }
  if (visibleEvilAboard.length < failsRequired) {
    return {
      ...common,
      applicable: true,
      ...(exact ? { designation: [] } : {}),
      reason: 'INSUFFICIENT_VISIBLE_QUOTA_SUCCESS',
      selectedCard: 'success',
    }
  }
  if (!exact && decisiveBoard) {
    return {
      ...common,
      applicable: true,
      reason: 'ROBUST_DECISIVE_FAIL',
      selectedCard: 'fail',
    }
  }
  if (exact && decisiveBoard) {
    const designation =
      orderedVisibleEvilAboard.slice(0, failsRequired)
        .sort((a, b) => a - b)
    const designated = designation.includes(view.seat)
    return {
      ...common,
      applicable: true,
      designation,
      reason: designated
        ? 'EXACT_QUOTA_DESIGNATED_FAIL'
        : 'EXACT_QUOTA_NONDESIGNATED_SUCCESS',
      selectedCard: designated ? 'fail' : 'success',
    }
  }

  const probability = slowPlayProbability(context)
  const slowPlayBucket = bucket([
    EVIL_QUEST_CARD_POLICY_VERSION,
    exact ? 'homogeneous-slow-play' : 'robust-seat-local-slow-play',
    ...(exact ? [] : [view.seat]),
    contextKey(context),
  ].join(':'))
  const slowPlayGateOpen = slowPlayBucket < probability
  if (!slowPlayGateOpen) {
    return {
      ...common,
      applicable: true,
      ...(exact ? { designation: [] } : {}),
      slowPlayProbability: probability,
      slowPlayBucket,
      ...(exact
        ? { sharedSlowPlayGateOpen: false }
        : { localSlowPlayFail: false }),
      reason: exact
        ? 'SHARED_SLOW_PLAY_HOLD'
        : 'ROBUST_LOCAL_SLOW_PLAY_HOLD',
      selectedCard: 'success',
    }
  }
  if (!exact) {
    return {
      ...common,
      applicable: true,
      slowPlayProbability: probability,
      slowPlayBucket,
      localSlowPlayFail: true,
      reason: 'ROBUST_LOCAL_SLOW_PLAY_FAIL',
      selectedCard: 'fail',
    }
  }

  const designation =
    orderedVisibleEvilAboard.slice(0, failsRequired).sort((a, b) => a - b)
  const designated = designation.includes(view.seat)
  return {
    ...common,
    applicable: true,
    designation,
    slowPlayProbability: probability,
    slowPlayBucket,
    sharedSlowPlayGateOpen: true,
    reason: designated
      ? 'EXACT_QUOTA_DESIGNATED_FAIL'
      : 'EXACT_QUOTA_NONDESIGNATED_SUCCESS',
    selectedCard: designated ? 'fail' : 'success',
  }
}

export function validatePrivateEvilQuestCardPolicyHostJoin(
  value: PrivateEvilQuestCardPolicy,
  input: {
    req: DecisionRequest
    view: PlayerView
    analysis: SituationAnalysis
    mode: EvilQuestCardPolicyMode
  },
): boolean {
  try {
    return isDeepStrictEqual(
      value,
      buildPrivateEvilQuestCardPolicy(input),
    )
  } catch {
    return false
  }
}
