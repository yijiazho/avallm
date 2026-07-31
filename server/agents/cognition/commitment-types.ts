// The public commitment ledger shapes, plus the supersession union both the
// ledger and the private plan-memory history share. These are the lowest-level
// cognition data shapes: no belief, no analysis, no plan memory.
//
// They live in this leaf so coherence.ts (and any other consumer that only
// needs the commitment vocabulary) can name a PublicCommitment without
// importing cognition/types.ts, which in turn names the plan-memory shapes that
// depend on coherence. cognition/types.ts re-exports everything here, so callers
// still read these from `./types.ts`.

import type { Seat } from '../../engine/types.ts'

export type CommitmentKind = 'team' | 'vote' | 'utterance'

/**
 * Whether a superseding record has replaced this one. A `superseded` record
 * always names its successor; a `current` one never carries a `supersededBy`.
 * Encoded as a discriminated union so the correlation cannot be violated by
 * construction (there is no representable `current`-with-successor state).
 * Shared by the public commitment ledger and the private plan-memory history,
 * which both track supersession this way.
 */
export type SupersessionState =
  | { status: 'current' }
  | { status: 'superseded'; supersededBy: string }

export interface CommitmentContext {
  round?: number
  proposalNum?: number
  questNum?: number
  team?: readonly Seat[]
}

interface PublicCommitmentBase {
  id: string
  sourceId: string
  sourceSeq: number
  actor: Seat
  visibility: 'public'
  context: CommitmentContext
}

/**
 * Discriminated on the single `kind` tag so that a `kind` narrows its own
 * payload shape: `kind: 'team'` implies `payload.type: 'team'`, and so on. The
 * payload keeps its own `type` field (identical serialized shape as before) but
 * it is no longer a free union that could disagree with `kind`, so consumers
 * narrow instead of guarding an unrepresentable mismatch.
 */
export type PublicCommitment = PublicCommitmentBase & SupersessionState & (
  | {
      kind: 'team'
      payload: { type: 'team'; action: 'proposed' | 'revised'; team: readonly Seat[] }
    }
  | {
      kind: 'vote'
      payload: { type: 'vote'; vote: 'approve' | 'reject' }
    }
  | {
      kind: 'utterance'
      payload: {
        type: 'utterance'
        text: string
        channel: 'discussion' | 'pitch' | 'revision-reason'
      }
    }
)
