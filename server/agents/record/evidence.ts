// The mechanical evidence transcript: what happened at the table, as a closed
// set of typed records derived from the public log plus a seat's private info.
//
// This was the first half of cognition/types.ts, sharing a module with
// CognitionState. The two halves have nothing in common but a filename:
// CognitionState pulls in belief identity, role objectives and the language
// schema, while these records depend on nothing but engine vocabulary. Sharing
// the file made the evidence schema as expensive to reach as CognitionState is,
// and analysis, which is BELOW cognition, needs the records. Splitting it out
// here puts the schema in the tier that owns what was said and seen, beside the
// public record projection it is read alongside.

import type {
  Alignment,
  PrivateInfo,
  Role,
  Seat,
} from '../../engine/types.ts'

export const EVIDENCE_MODEL_VERSION = 'mechanical-evidence-v3'

/**
 * The payload of every evidence kind. Payload is the only part of a record that
 * varies freely: whether the record is private, and whether it names an actor,
 * are both functions of the kind, so they are stated once below rather than
 * restated on each variant.
 */
interface EvidencePayloads {
  'game-setup': {
    playerCount: number
    rolesInPlay: readonly Role[]
    firstLeader: Seat
  }
  'private-role': {
    role: Role
    alignment: Alignment
  }
  // The seat's deal-time private knowledge, verbatim from the engine. One
  // shared type, so the discriminant that makes the shapes mutually exclusive
  // holds here too rather than being re-flattened into three optionals.
  'private-knowledge': PrivateInfo
  'leader-change': {
    round: number
    proposalNum: number
  }
  'proposal': {
    round: number
    proposalNum: number
    team: readonly Seat[]
    pitch?: string
  }
  'proposal-locked': {
    round: number
    proposalNum: number
    team: readonly Seat[]
  }
  'proposal-revised': {
    round: number
    proposalNum: number
    from: readonly Seat[]
    to: readonly Seat[]
    reason?: string
  }
  'utterance': {
    text: string
    discussionRound: number
    postRevision: boolean
    round: number
    proposalNum: number
    team?: readonly Seat[]
  }
  'vote-reveal': {
    round: number
    proposalNum: number
    team: readonly Seat[]
    votes: readonly { seat: Seat; vote: 'approve' | 'reject' }[]
    approved: boolean
    automatic: boolean
  }
  'quest-result': {
    questNum: number
    team: readonly Seat[]
    failCount: number
    failsRequired: number
    result: 'success' | 'fail'
  }
  'rename': {
    from: string
    to: string
  }
  'assassination': {
    target: Seat
    wasMerlin: boolean
  }
  'game-result': {
    winner: Alignment
    reason: string
  }
}

export type EvidenceKind = keyof EvidencePayloads

/**
 * Who may see each kind. `Record<EvidenceKind, ...>` is total on purpose: a new
 * entry in `EvidencePayloads` fails to compile until it declares its audience.
 * A list of the private kinds would not do that, because a subset that omits a
 * newly added private kind is still a valid subset, and the kind would default
 * to table-visible and leak. `PublicEvidence` and `isPublicEvidence` both derive
 * from this table, so the type and the runtime check cannot disagree.
 */
const EVIDENCE_SCOPE = {
  'game-setup': 'public',
  'private-role': 'private',
  'private-knowledge': 'private',
  'leader-change': 'public',
  'proposal': 'public',
  'proposal-locked': 'public',
  'proposal-revised': 'public',
  'utterance': 'public',
  'vote-reveal': 'public',
  'quest-result': 'public',
  'rename': 'public',
  'assassination': 'public',
  'game-result': 'public',
} as const satisfies Record<EvidenceKind, 'public' | 'private'>

type PrivateEvidenceKind = {
  [K in EvidenceKind]: (typeof EVIDENCE_SCOPE)[K] extends 'private' ? K : never
}[EvidenceKind]

/** Table-level facts with no single author. Every other kind names one seat. */
type UnattributedEvidenceKind =
  | 'game-setup'
  | 'vote-reveal'
  | 'quest-result'
  | 'game-result'

interface EvidenceCore<K extends EvidenceKind> {
  /** Stable identity: `event:<visible seq>:<kind>`. */
  id: string
  sourceSeq: number
  kind: K
  payload: EvidencePayloads[K]
}

type EvidenceRecord<K extends EvidenceKind> =
  K extends UnattributedEvidenceKind
    ? EvidenceCore<K>
    : EvidenceCore<K> & { actor: Seat }

export type Evidence = { [K in EvidenceKind]: EvidenceRecord<K> }[EvidenceKind]

/**
 * The one way to build a record. `id` is derived from the same `sourceSeq` and
 * `kind` the record carries, so the identity cannot drift from the fields it
 * claims to name, and `rest` demands an `actor` exactly for the attributed
 * kinds. Returns a one-record tuple because every producer so far maps an event
 * to zero or one record.
 */
export const evidenceRecord = <K extends EvidenceKind>(
  sourceSeq: number,
  kind: K,
  rest: Omit<EvidenceRecord<K>, 'id' | 'sourceSeq' | 'kind'>,
): readonly [EvidenceRecord<K>] => [
  { id: `event:${sourceSeq}:${kind}`, sourceSeq, kind, ...rest } as EvidenceRecord<K>,
]

/** Records that name one seat, the only ones carrying an `actor`. */
export type AttributedEvidence = Extract<Evidence, { actor: Seat }>

/** Records the whole table may see. Private kinds cannot inhabit this type. */
export type PublicEvidence = Exclude<Evidence, { kind: PrivateEvidenceKind }>

export const isPublicEvidence = (record: Evidence): record is PublicEvidence =>
  EVIDENCE_SCOPE[record.kind] === 'public'

