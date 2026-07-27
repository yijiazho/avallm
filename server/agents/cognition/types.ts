import type {
  Alignment,
  Lean,
  Role,
  Seat,
} from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'

export const COGNITION_SCHEMA_VERSION = 1
export const EVIDENCE_MODEL_VERSION = 'mechanical-evidence-v1'
export const COMMITMENT_MODEL_VERSION = 'public-commitments-v1'

export type EvidenceScope = 'public' | 'private'
export type EvidenceStrength = 'hard' | 'observed'

interface EvidenceBase {
  /** Stable identity: `event:<visible seq>:<kind>`. */
  id: string
  sourceSeq: number
  scope: EvidenceScope
  strength: EvidenceStrength
  actor?: Seat
}

export type Evidence =
  | (EvidenceBase & {
      kind: 'game-setup'
      scope: 'public'
      payload: { playerCount: number; rolesInPlay: readonly Role[]; firstLeader: Seat }
    })
  | (EvidenceBase & {
      kind: 'private-role'
      scope: 'private'
      strength: 'hard'
      actor: Seat
      payload: { role: Role; alignment: Alignment }
    })
  | (EvidenceBase & {
      kind: 'private-knowledge'
      scope: 'private'
      strength: 'hard'
      actor: Seat
      payload: {
        knownEvil?: readonly Seat[]
        evilPartners?: readonly Seat[]
        merlinCandidates?: readonly Seat[]
      }
    })
  | (EvidenceBase & {
      kind: 'leader-change'
      scope: 'public'
      actor: Seat
      payload: { round: number; proposalNum: number }
    })
  | (EvidenceBase & {
      kind: 'proposal'
      scope: 'public'
      actor: Seat
      payload: {
        round: number
        proposalNum: number
        team: readonly Seat[]
        pitch?: string
      }
    })
  | (EvidenceBase & {
      kind: 'proposal-locked'
      scope: 'public'
      actor: Seat
      payload: { round: number; proposalNum: number; team: readonly Seat[] }
    })
  | (EvidenceBase & {
      kind: 'proposal-revised'
      scope: 'public'
      actor: Seat
      payload: {
        round: number
        proposalNum: number
        from: readonly Seat[]
        to: readonly Seat[]
        reason?: string
      }
    })
  | (EvidenceBase & {
      kind: 'utterance'
      scope: 'public'
      actor: Seat
      payload: {
        text: string
        discussionRound: number
        postRevision: boolean
        lean?: Lean
        round: number
        proposalNum: number
        team?: readonly Seat[]
      }
    })
  | (EvidenceBase & {
      kind: 'declared-lean'
      scope: 'public'
      actor: Seat
      payload: {
        lean: Lean
        discussionRound: number
        postRevision: boolean
        round: number
        proposalNum: number
        team?: readonly Seat[]
      }
    })
  | (EvidenceBase & {
      kind: 'vote-reveal'
      scope: 'public'
      payload: {
        round: number
        proposalNum: number
        team: readonly Seat[]
        votes: readonly { seat: Seat; vote: 'approve' | 'reject' }[]
        approved: boolean
        automatic: boolean
      }
    })
  | (EvidenceBase & {
      kind: 'quest-result'
      scope: 'public'
      payload: {
        questNum: number
        team: readonly Seat[]
        failCount: number
        failsRequired: number
        result: 'success' | 'fail'
      }
    })
  | (EvidenceBase & {
      kind: 'rename'
      scope: 'public'
      actor: Seat
      payload: { from: string; to: string }
    })
  | (EvidenceBase & {
      kind: 'assassination'
      scope: 'public'
      actor: Seat
      payload: { target: Seat; wasMerlin: boolean }
    })
  | (EvidenceBase & {
      kind: 'game-result'
      scope: 'public'
      payload: { winner: Alignment; reason: string }
    })

export type CommitmentKind = 'team' | 'vote' | 'lean' | 'utterance'
export type CommitmentStatus = 'current' | 'superseded'

export interface CommitmentContext {
  round?: number
  proposalNum?: number
  questNum?: number
  team?: readonly Seat[]
}

export interface PublicCommitment {
  id: string
  sourceId: string
  sourceSeq: number
  actor: Seat
  kind: CommitmentKind
  visibility: 'public'
  context: CommitmentContext
  payload:
    | { type: 'team'; action: 'proposed' | 'revised'; team: readonly Seat[] }
    | { type: 'vote'; vote: 'approve' | 'reject' }
    | { type: 'lean'; lean: Lean }
    | { type: 'utterance'; text: string; channel: 'discussion' | 'pitch' | 'revision-reason' }
  status: CommitmentStatus
  supersededBy?: string
}

export interface CognitionVersions {
  schema: typeof COGNITION_SCHEMA_VERSION
  evidence: typeof EVIDENCE_MODEL_VERSION
  commitments: typeof COMMITMENT_MODEL_VERSION
  belief: string
}

export interface CognitionState {
  viewerSeat: Seat
  /** Maximum sequence visible to this seat, including ignored private events. */
  throughSeq: number
  evidence: readonly Evidence[]
  belief: BeliefSnapshot
  commitments: readonly PublicCommitment[]
  versions: CognitionVersions
}

export interface PublicCognitionProjection {
  /** Maximum public source sequence represented in evidence. */
  throughSeq: number
  evidence: readonly Evidence[]
  commitments: readonly PublicCommitment[]
  versions: Pick<CognitionVersions, 'schema' | 'evidence' | 'commitments'>
}
