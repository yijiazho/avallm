import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import type { PublicCommitment } from './types.ts'

export const COHERENCE_MODEL_VERSION = 'literal-commitment-coherence-v2'

export const COHERENCE_CONFLICT_CODES = [
  'VOTE_OPPOSES_OWN_TEAM',
  'TEAM_REVERSES_CURRENT_TEAM',
  'REVISION_MISSING_EXPLANATION',
] as const

export type CoherenceConflictCode = typeof COHERENCE_CONFLICT_CODES[number]
export type CoherenceIntent = 'maintain' | 'conceal' | 'deceive'
export type CoherenceClassification =
  | 'consistent'
  | 'accidental-conflict'
  | 'intentional-concealment'
  | 'strategic-deception'

export interface LiteralCommitmentBasis {
  id: string
  sourceSeq: number
  actor: Seat
  kind: 'team'
  round: number
  proposalNum: number
  payload: { type: 'team'; action: 'proposed' | 'revised'; team: readonly Seat[] }
}

export interface CoherenceAssessment {
  version: typeof COHERENCE_MODEL_VERSION
  intent: CoherenceIntent
  classification: CoherenceClassification
  conflictCodes: readonly CoherenceConflictCode[]
  commitmentBasis: readonly LiteralCommitmentBasis[]
  currentTeam?: readonly Seat[]
}

function sameTeam(
  left: readonly Seat[] | undefined,
  right: readonly Seat[] | undefined,
): boolean {
  if (!left || !right || left.length !== right.length) return false
  const a = [...left].sort((x, y) => x - y)
  const b = [...right].sort((x, y) => x - y)
  return a.every((seat, index) => seat === b[index])
}

export function literalCommitmentBasis(
  commitments: readonly PublicCommitment[],
  req: DecisionRequest,
): readonly LiteralCommitmentBasis[] {
  return commitments
    .filter(
      (commitment) =>
        commitment.status === 'current'
        && commitment.actor === req.seat
        && commitment.context.round === req.round
        && commitment.context.proposalNum === req.proposalNum
        && commitment.kind === 'team',
    )
    .map((commitment): LiteralCommitmentBasis => {
      if (commitment.payload.type !== 'team') {
        throw new Error('literal coherence received a non-literal commitment')
      }
      return {
        id: commitment.id,
        sourceSeq: commitment.sourceSeq,
        actor: commitment.actor,
        kind: 'team',
        round: req.round,
        proposalNum: req.proposalNum,
        payload: {
          type: 'team',
          action: commitment.payload.action,
          team: commitment.payload.team.slice(),
        },
      }
    })
    .sort((left, right) =>
      left.sourceSeq - right.sourceSeq || left.id.localeCompare(right.id))
}

export function assessLiteralCoherence(
  req: DecisionRequest,
  appliedDecision: Decision,
  intent: CoherenceIntent,
  commitmentBasis: readonly LiteralCommitmentBasis[],
  currentTeam?: readonly Seat[],
): CoherenceAssessment {
  const codes = new Set<CoherenceConflictCode>()
  const ownTeam = commitmentBasis.find(
    (commitment) =>
      commitment.payload.type === 'team'
      && sameTeam(commitment.payload.team, currentTeam),
  )

  if (appliedDecision.kind === 'vote') {
    if (ownTeam && appliedDecision.vote === 'reject') {
      codes.add('VOTE_OPPOSES_OWN_TEAM')
    }
  }
  if (appliedDecision.kind === 'finalize' && !appliedDecision.stick) {
    // A normal explained one-seat revision is coherent. "Reverses" is kept
    // deliberately narrow here: the replacement abandons every member of the
    // current team, so literal continuity is absent.
    if (
      currentTeam?.length
      && !appliedDecision.team.some((seat) => currentTeam.includes(seat))
    ) {
      codes.add('TEAM_REVERSES_CURRENT_TEAM')
    }
    if (!appliedDecision.reason?.trim()) {
      codes.add('REVISION_MISSING_EXPLANATION')
    }
  }

  const conflictCodes = COHERENCE_CONFLICT_CODES.filter((code) => codes.has(code))
  const classification: CoherenceClassification = conflictCodes.length === 0
    ? 'consistent'
    : intent === 'conceal'
      ? 'intentional-concealment'
      : intent === 'deceive'
        ? 'strategic-deception'
        : 'accidental-conflict'
  return {
    version: COHERENCE_MODEL_VERSION,
    intent,
    classification,
    conflictCodes,
    commitmentBasis: structuredClone(commitmentBasis),
    ...(currentTeam ? { currentTeam: currentTeam.slice() } : {}),
  }
}

export function coherenceBasisFromView(
  view: Pick<PlayerView, 'seat' | 'events'>,
  req: DecisionRequest,
  commitments: readonly PublicCommitment[],
): readonly LiteralCommitmentBasis[] {
  if (view.seat !== req.seat) {
    throw new Error('coherence view seat does not match decision request')
  }
  return literalCommitmentBasis(commitments, req)
}
