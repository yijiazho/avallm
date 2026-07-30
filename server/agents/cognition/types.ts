import type {
  Alignment,
  Decision,
  DecisionRequest,
  PrivateInfo,
  Role,
  Seat,
} from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import type { PrivateIdentitySnapshot } from '../belief/identity.ts'
import type { PrivateRoleObjectiveSnapshot } from '../analysis/role-objective-types.ts'
import type { PrivateEvilRoleObjectiveSnapshot } from '../analysis/evil-objective-types.ts'

/**
 * The private objective substrate a seat carries, discriminated on `team`. A
 * seat gets the Merlin/Percival objective, the visible-evil/Oberon objective,
 * or neither: a Servant gets none, and the good and evil roles are disjoint.
 * Modelling it as one union rather than two optional fields makes "both at
 * once" unrepresentable.
 */
export type PrivateObjectiveSnapshot =
  | PrivateRoleObjectiveSnapshot
  | PrivateEvilRoleObjectiveSnapshot
import type {
  LanguageEvidence,
  LanguageEvidenceCursor,
} from '../communication/language-types.ts'
import type { AppliedDecisionResolution } from '../applied-decision.ts'
import { COHERENCE_MODEL_VERSION } from './coherence.ts'
import type { CoherenceAssessment } from './coherence.ts'
import type {
  PublicCommitment,
  SupersessionState,
} from './commitment-types.ts'

// The commitment ledger shapes live in commitment-types.ts so coherence.ts can
// name them without importing this module back; re-exported here because
// callers have always read them from `./types.ts`.
export type {
  CommitmentContext,
  CommitmentKind,
  PublicCommitment,
  SupersessionState,
} from './commitment-types.ts'

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

/** Records that name one seat, the only ones carrying an `actor`. */
export type AttributedEvidence = Extract<Evidence, { actor: Seat }>

/** Records the whole table may see. Private kinds cannot inhabit this type. */
export type PublicEvidence = Exclude<Evidence, { kind: PrivateEvidenceKind }>

export const isPublicEvidence = (record: Evidence): record is PublicEvidence =>
  EVIDENCE_SCOPE[record.kind] === 'public'

export const PLAN_MEMORY_VERSION = 'private-plan-memory-v2'

export interface SelectedPlanSummary {
  decision: Decision
  /** Never optional: a selected decision cannot be recorded without its plan. */
  plan: Readonly<{
    version: string
    candidateId: string
    policyId: string
    beliefThroughSeq: number
  }>
}

// The private post-legality plan-memory shapes. CognitionState.planMemory holds
// one, so the shape belongs with the other cognition shapes here rather than in
// plan-memory.ts, which imports this module for PublicCommitment and would close
// a cycle if this module reached back for the memory shape. plan-memory.ts owns
// the recording and validation logic and re-exports these for its callers.
export type AppliedPlanHistoryEntry = {
  id: string
  request: DecisionRequest
  viewThroughSeq: number
  selected?: SelectedPlanSummary
  appliedDecision: Decision
  resolution: AppliedDecisionResolution
  coherence: CoherenceAssessment
} & SupersessionState

export interface PrivatePlanMemory {
  version: typeof PLAN_MEMORY_VERSION
  coherenceVersion: typeof COHERENCE_MODEL_VERSION
  viewerSeat: Seat
  nextOrdinal: number
  history: readonly AppliedPlanHistoryEntry[]
}

/**
 * The opt-in component version identities shared verbatim by the internal
 * cognition state ({@link CognitionVersions}) and the wire/trace attribution
 * (`DecisionTrace.componentVersions`). Each field is a feature flag: absent
 * means that component was off for this decision, present carries its resolved
 * version. Both records embed this same set by intersection so a newly added
 * opt-in component is declared once, here, rather than hand-mirrored in two
 * places that silently drift.
 *
 * Only the genuinely shared subset lives here. `componentVersions` carries
 * further opt-ins of its own (the Morgana counterfeit/role-utility projections,
 * `roleUtility`/`evilRoleUtility`, `decisionComponents`, `configuredScorer`,
 * and an optional `mechanicalBelief`/`beliefPipeline` that CognitionVersions
 * instead requires); those stay declared on that type deliberately.
 */
export interface OptInComponentVersions {
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

export interface CognitionVersions extends OptInComponentVersions {
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
  /**
   * Private, mechanically inert objective substrate: the good or evil private
   * objective for this seat, or absent. One field, discriminated on `team`, so
   * a good and an evil objective can never both be present. Never included in
   * publicCognition.
   */
  roleObjective?: PrivateObjectiveSnapshot
  versions: CognitionVersions
}

export interface PublicCognitionProjection {
  /** Maximum public source sequence represented in evidence. */
  throughSeq: number
  evidence: readonly PublicEvidence[]
  commitments: readonly PublicCommitment[]
  versions: Pick<CognitionVersions, 'schema' | 'evidence' | 'commitments'>
}
