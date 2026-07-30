import type {
  Alignment,
  Role,
  Seat,
} from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import type { PrivateIdentitySnapshot } from '../belief/identity.ts'
import type { PrivatePlanMemory } from './plan-memory.ts'
import type { PrivateRoleObjectiveSnapshot } from '../analysis/role-objective-types.ts'
import type { PrivateEvilRoleObjectiveSnapshot } from '../analysis/evil-objective-types.ts'
import type {
  LanguageEvidence,
  LanguageEvidenceCursor,
} from '../communication/language-types.ts'

export const COGNITION_SCHEMA_VERSION = 1
export const EVIDENCE_MODEL_VERSION = 'mechanical-evidence-v3'
export const COMMITMENT_MODEL_VERSION = 'public-commitments-v2'

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
  'private-knowledge': {
    knownEvil?: readonly Seat[]
    evilPartners?: readonly Seat[]
    merlinCandidates?: readonly Seat[]
  }
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
 * The only kinds a seat learns privately. Every other kind is table-visible.
 * `satisfies` is what keeps this honest: both `PublicEvidence` and the runtime
 * predicate derive from this one list, so a typo or a stale entry after a kind
 * rename fails to compile rather than quietly projecting private records.
 */
const PRIVATE_EVIDENCE_KINDS = [
  'private-role',
  'private-knowledge',
] as const satisfies readonly EvidenceKind[]

type PrivateEvidenceKind = (typeof PRIVATE_EVIDENCE_KINDS)[number]

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

/** Records that name one seat, the only ones carrying an `actor`. */
export type AttributedEvidence = Extract<Evidence, { actor: Seat }>

/** Records the whole table may see. Private kinds cannot inhabit this type. */
export type PublicEvidence = Exclude<Evidence, { kind: PrivateEvidenceKind }>

const privateKinds: ReadonlySet<EvidenceKind> = new Set(PRIVATE_EVIDENCE_KINDS)

export const isPublicEvidence = (record: Evidence): record is PublicEvidence =>
  !privateKinds.has(record.kind)

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

export type PublicCommitment = {
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
    | { type: 'utterance'; text: string; channel: 'discussion' | 'pitch' | 'revision-reason' }
} & SupersessionState

export interface CognitionVersions {
  schema: typeof COGNITION_SCHEMA_VERSION
  evidence: typeof EVIDENCE_MODEL_VERSION
  commitments: typeof COMMITMENT_MODEL_VERSION
  /** Actual version of the resolved snapshot stored in this state. */
  belief: string
  /** Stable identity of the configured rules/mechanical inference model. */
  mechanicalBelief: string
  /** Stable identity of the complete configured belief pipeline. */
  beliefPipeline: string
  /** Stable interpreter identity, or `off` when language inference is absent. */
  languageEvidence: string
  /** Present only while the private joint-identity projection is enabled. */
  identityModel?: string
  /** Present only while private post-legality plan memory is enabled. */
  planMemory?: string
  /** Present only with plan memory; literal structured coherence only. */
  coherence?: string
  /** Present only for an enabled Merlin/Percival private objective. */
  roleObjective?: string
  /** Present only when explicit role routing is configured. */
  roleObjectiveRouter?: string
}

export interface CognitionState {
  viewerSeat: Seat
  /** Maximum sequence visible to this seat, including ignored private events. */
  throughSeq: number
  evidence: readonly Evidence[]
  belief: BeliefSnapshot
  commitments: readonly PublicCommitment[]
  /** Private admitted interpretations. Never included in publicCognition. */
  languageReads: readonly LanguageEvidence[]
  /** Public projection cursor, distinct from the seat-visible belief cursor. */
  languageCursor: LanguageEvidenceCursor
  /** Private role/team identity projection. Never included in publicCognition. */
  identity?: PrivateIdentitySnapshot
  /** Private selected/applied history. Never included in publicCognition. */
  planMemory?: PrivatePlanMemory
  /** Private, mechanically inert Merlin/Percival objective substrate. */
  roleObjective?: PrivateRoleObjectiveSnapshot
  /** Private, mechanically inert visible-evil/Oberon objective substrate. */
  evilRoleObjective?: PrivateEvilRoleObjectiveSnapshot
  versions: CognitionVersions
}

export interface PublicCognitionProjection {
  /** Maximum public source sequence represented in evidence. */
  throughSeq: number
  evidence: readonly PublicEvidence[]
  commitments: readonly PublicCommitment[]
  versions: Pick<CognitionVersions, 'schema' | 'evidence' | 'commitments'>
}
