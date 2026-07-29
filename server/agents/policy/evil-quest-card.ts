import { isDeepStrictEqual } from 'node:util'
import { fnv1a } from '../../engine/prng.ts'
import type {
  DecisionRequest,
  PlayerView,
  ProposalRecord,
  Role,
  Seat,
} from '../../engine/types.ts'
import type { SituationAnalysis } from '../analysis/types.ts'
import {
  denseOwnDataArrayValues,
  exactOwnDataRecord,
  type CanonicalJsonValue,
} from '../components/canonical-json.ts'

export const EVIL_QUEST_CARD_POLICY_VERSION =
  'evil-quest-card-policy-v1'
export const EVIL_QUEST_ROBUST_POLICY_VERSION =
  'evil-robust-heterogeneous-quest-policy-v1'
export const EVIL_QUEST_PUBLIC_CONTEXT_VERSION =
  'evil-quest-public-context-v1'
export const MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES = 8_192
export const EVIL_QUEST_CARD_POLICY_DEGRADATION =
  'evil-quest-card-policy-failed'

export type EvilQuestCardPolicyMode = 'robust-heterogeneous'

export type EvilQuestCardPolicyReason =
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
  policyVersion: typeof EVIL_QUEST_ROBUST_POLICY_VERSION
  mode: EvilQuestCardPolicyMode
  coordinationAssumption: 'none'
  populationAssumption: 'heterogeneous-independent'
  mixedTableSafe: true
  promotionEvidenceEligible: true
  request: Readonly<DecisionRequest>
  role: Role
  applicable: boolean
  sourceContext: EvilQuestPublicContext
  sourceFingerprint: string
  failsRequired: number
  decisiveBoard: boolean
  visibleEvilCount: number
  visibleEvilAboardCount: number
  slowPlayProbability?: number
  slowPlayBucket?: number
  localSlowPlayFail?: boolean
  reason: EvilQuestCardPolicyReason
  selectedCard?: 'success' | 'fail'
}

const ROBUST_REASON_CODES: readonly EvilQuestCardPolicyReason[] = [
  'INSUFFICIENT_VISIBLE_QUOTA_SUCCESS',
  'ROBUST_DECISIVE_FAIL',
  'ROBUST_LOCAL_SLOW_PLAY_FAIL',
  'ROBUST_LOCAL_SLOW_PLAY_HOLD',
]

/**
 * Native decoder after the component kernel's canonical, byte-bounded ingress.
 */
export function decodeCanonicalRobustEvilQuestCardPolicy(
  value: CanonicalJsonValue,
): PrivateEvilQuestCardPolicy | undefined {
  const common = [
    'version', 'policyVersion', 'mode', 'coordinationAssumption',
    'populationAssumption', 'mixedTableSafe',
    'promotionEvidenceEligible', 'request', 'role', 'applicable',
    'sourceContext', 'sourceFingerprint', 'failsRequired',
    'decisiveBoard', 'visibleEvilCount', 'visibleEvilAboardCount',
    'reason',
  ] as const
  const variants = [
    common,
    [...common, 'selectedCard'],
    [
      ...common,
      'slowPlayProbability',
      'slowPlayBucket',
      'localSlowPlayFail',
      'selectedCard',
    ],
  ] as const
  const policy = variants
    .map((keys) => exactOwnDataRecord(value, keys))
    .find((record) => record !== undefined)
  if (!policy) return undefined
  const request = exactOwnDataRecord(policy.request, [
    'kind', 'seat', 'round', 'proposalNum',
  ])
  const context = exactOwnDataRecord(policy.sourceContext, [
    'version', 'playerCount', 'round', 'proposalNum', 'leaderSeat',
    'currentTeam', 'teamSize', 'failsRequired', 'priorQuests',
    'priorProposals',
  ])
  if (!request || !context) return undefined
  const playerCount = context.playerCount
  const currentTeam = denseOwnDataArrayValues(context.currentTeam, 10)
  const priorQuests = denseOwnDataArrayValues(context.priorQuests, 5)
  const priorProposals =
    denseOwnDataArrayValues(context.priorProposals, 25)
  const seat = (candidate: unknown): candidate is Seat =>
    Number.isSafeInteger(candidate)
      && Number.isSafeInteger(playerCount)
      && Number(candidate) >= 0
      && Number(candidate) < Number(playerCount)
  const roles: readonly Role[] = [
    'merlin', 'percival', 'servant', 'minion', 'morgana',
    'mordred', 'oberon', 'assassin',
  ]
  if (
    policy.version !== EVIL_QUEST_CARD_POLICY_VERSION
    || policy.policyVersion !== EVIL_QUEST_ROBUST_POLICY_VERSION
    || policy.mode !== 'robust-heterogeneous'
    || policy.coordinationAssumption !== 'none'
    || policy.populationAssumption !== 'heterogeneous-independent'
    || policy.mixedTableSafe !== true
    || policy.promotionEvidenceEligible !== true
    || request.kind !== 'quest'
    || !seat(request.seat)
    || !Number.isSafeInteger(request.round)
    || !Number.isSafeInteger(request.proposalNum)
    || typeof policy.role !== 'string'
    || !roles.includes(policy.role as Role)
    || policy.applicable !== true
    || context.version !== EVIL_QUEST_PUBLIC_CONTEXT_VERSION
    || !Number.isSafeInteger(playerCount)
    || Number(playerCount) < 5
    || Number(playerCount) > 10
    || !Number.isSafeInteger(context.round)
    || !Number.isSafeInteger(context.proposalNum)
    || !seat(context.leaderSeat)
    || !currentTeam
    || new Set(currentTeam).size !== currentTeam.length
    || !currentTeam.every(seat)
    || !Number.isSafeInteger(context.teamSize)
    || context.teamSize !== currentTeam.length
    || !Number.isSafeInteger(context.failsRequired)
    || Number(context.failsRequired) < 1
    || !priorQuests
    || !priorQuests.every((entry) => typeof entry === 'string')
    || !priorProposals
    || !priorProposals.every((entry) => typeof entry === 'string')
    || typeof policy.sourceFingerprint !== 'string'
    || !/^[0-9a-f]{8}$/.test(policy.sourceFingerprint)
    || policy.failsRequired !== context.failsRequired
    || typeof policy.decisiveBoard !== 'boolean'
    || !Number.isSafeInteger(policy.visibleEvilCount)
    || Number(policy.visibleEvilCount) < 1
    || !Number.isSafeInteger(policy.visibleEvilAboardCount)
    || Number(policy.visibleEvilAboardCount) < 0
    || Number(policy.visibleEvilAboardCount)
      > Number(policy.visibleEvilCount)
    || typeof policy.reason !== 'string'
    || !ROBUST_REASON_CODES.includes(
      policy.reason as EvilQuestCardPolicyReason,
    )
    || (
      policy.selectedCard !== 'success'
      && policy.selectedCard !== 'fail'
    )
    || policy.selectedCard !== (
      policy.reason === 'ROBUST_DECISIVE_FAIL'
      || policy.reason === 'ROBUST_LOCAL_SLOW_PLAY_FAIL'
        ? 'fail'
        : 'success'
    )
  ) return undefined
  const slow = policy.slowPlayProbability !== undefined
  if (
    slow !== (
      policy.reason === 'ROBUST_LOCAL_SLOW_PLAY_FAIL'
      || policy.reason === 'ROBUST_LOCAL_SLOW_PLAY_HOLD'
    )
    || (
      slow
      && (
        typeof policy.slowPlayProbability !== 'number'
        || policy.slowPlayProbability < 0
        || policy.slowPlayProbability > 1
        || typeof policy.slowPlayBucket !== 'number'
        || policy.slowPlayBucket < 0
        || policy.slowPlayBucket > 1
        || policy.localSlowPlayFail
          !== (policy.reason === 'ROBUST_LOCAL_SLOW_PLAY_FAIL')
      )
    )
  ) return undefined
  return value as unknown as PrivateEvilQuestCardPolicy
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

function slowPlayProbability(context: EvilQuestPublicContext): number {
  return context.teamSize === 2 ? 0.15
    : context.round === 1 ? 0.4
      : 0.55
}

function bucket(key: string): number {
  return fnv1a(key) / 0x1_0000_0000
}

/** Private deterministic policy with no teammate-coordination assumption. */
export function buildPrivateEvilQuestCardPolicy(input: {
  req: DecisionRequest
  view: PlayerView
  analysis: SituationAnalysis
}): PrivateEvilQuestCardPolicy {
  const { req, view, analysis } = input
  const context = evilQuestPublicContext(req, view, analysis.failsRequired)
  const visibleEvilSeats = canonicalVisibleEvil(view)
  const team = new Set(context.currentTeam)
  const visibleEvilAboard =
    visibleEvilSeats.filter((seat) => team.has(seat))
  const failsRequired = analysis.failsRequired
  const decisiveBoard = analysis.matchPoint.good || analysis.matchPoint.evil
  const common: Omit<
    PrivateEvilQuestCardPolicy,
    'applicable' | 'reason' | 'selectedCard'
      | 'slowPlayProbability' | 'slowPlayBucket' | 'localSlowPlayFail'
  > = {
    version: EVIL_QUEST_CARD_POLICY_VERSION,
    policyVersion: EVIL_QUEST_ROBUST_POLICY_VERSION,
    mode: 'robust-heterogeneous',
    coordinationAssumption: 'none',
    populationAssumption: 'heterogeneous-independent',
    mixedTableSafe: true,
    promotionEvidenceEligible: true,
    request: { ...req },
    role: view.role,
    sourceContext: context,
    sourceFingerprint: fingerprint(context),
    failsRequired,
    decisiveBoard,
    visibleEvilCount: visibleEvilSeats.length,
    visibleEvilAboardCount: visibleEvilAboard.length,
  }

  if (req.kind !== 'quest' || view.alignment !== 'evil') {
    return {
      ...common,
      applicable: false,
      reason: 'OUT_OF_SCOPE',
    }
  }
  if (view.role === 'oberon') {
    return {
      ...common,
      applicable: false,
      reason: 'OBERON_UNCOORDINATED',
    }
  }
  if (visibleEvilAboard.length < failsRequired) {
    return {
      ...common,
      applicable: true,
      reason: 'INSUFFICIENT_VISIBLE_QUOTA_SUCCESS',
      selectedCard: 'success',
    }
  }
  if (decisiveBoard) {
    return {
      ...common,
      applicable: true,
      reason: 'ROBUST_DECISIVE_FAIL',
      selectedCard: 'fail',
    }
  }

  const probability = slowPlayProbability(context)
  const slowPlayBucket = bucket([
    EVIL_QUEST_CARD_POLICY_VERSION,
    'robust-seat-local-slow-play',
    view.seat,
    contextKey(context),
  ].join(':'))
  const slowPlayGateOpen = slowPlayBucket < probability
  if (!slowPlayGateOpen) {
    return {
      ...common,
      applicable: true,
      slowPlayProbability: probability,
      slowPlayBucket,
      localSlowPlayFail: false,
      reason: 'ROBUST_LOCAL_SLOW_PLAY_HOLD',
      selectedCard: 'success',
    }
  }
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

export function validatePrivateEvilQuestCardPolicyHostJoin(
  value: PrivateEvilQuestCardPolicy,
  input: {
    req: DecisionRequest
    view: PlayerView
    analysis: SituationAnalysis
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
