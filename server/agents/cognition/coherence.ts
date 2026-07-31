import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import { teamsEqual } from '../../engine/seatset.ts'
import type { PublicCommitment } from './commitment-types.ts'

export const COHERENCE_MODEL_VERSION = 'literal-commitment-coherence-v2'

export const COHERENCE_CONFLICT_CODES = [
  'VOTE_OPPOSES_OWN_TEAM',
  'TEAM_REVERSES_CURRENT_TEAM',
  'REVISION_MISSING_EXPLANATION',
] as const

export type CoherenceConflictCode = typeof COHERENCE_CONFLICT_CODES[number]

export const COHERENCE_INTENTS = [
  'maintain',
  'conceal',
  'deceive',
] as const

export type CoherenceIntent = typeof COHERENCE_INTENTS[number]

/**
 * The runtime half of the union. Every admission boundary that has to decide
 * whether a stored or declared intent is real reads this instead of spelling
 * the set out again: a type-only union has nothing to check at runtime, so
 * each validator was forced to restate it and the compiler could not tie the
 * copies back to the type.
 *
 * Exported for external intent-admission consumers (e.g. plan-memory schema
 * validation); it has no in-file caller.
 */
export function isCoherenceIntent(value: unknown): value is CoherenceIntent {
  return (COHERENCE_INTENTS as readonly unknown[]).includes(value)
}
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

export function literalCommitmentBasis(
  commitments: readonly PublicCommitment[],
  req: DecisionRequest,
): readonly LiteralCommitmentBasis[] {
  return commitments
    .filter(
      (commitment): commitment is Extract<PublicCommitment, { kind: 'team' }> =>
        commitment.status === 'current'
        && commitment.actor === req.seat
        && commitment.context.round === req.round
        && commitment.context.proposalNum === req.proposalNum
        && commitment.kind === 'team',
    )
    .map((commitment): LiteralCommitmentBasis => ({
      id: commitment.id,
      sourceSeq: commitment.sourceSeq,
      actor: commitment.actor,
      kind: 'team',
      round: req.round,
      proposalNum: req.proposalNum,
      payload: {
        type: 'team',
        // kind: 'team' now narrows the payload, so no runtime guard is needed.
        action: commitment.payload.action,
        team: commitment.payload.team.slice(),
      },
    }))
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
    // Every basis entry is a team commitment by construction, so match on team.
    (commitment) => teamsEqual(commitment.payload.team, currentTeam),
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
  view: Pick<PlayerView, 'seat'>,
  req: DecisionRequest,
  commitments: readonly PublicCommitment[],
): readonly LiteralCommitmentBasis[] {
  if (view.seat !== req.seat) {
    throw new Error('coherence view seat does not match decision request')
  }
  return literalCommitmentBasis(commitments, req)
}
