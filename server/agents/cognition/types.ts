import type {
  Decision,
  DecisionRequest,
  Seat,
} from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import type { PrivateIdentitySnapshot } from '../belief/identity.ts'
import type { PrivateRoleObjectiveSnapshot } from '../analysis/role-objective-types.ts'
import type { PrivateEvilRoleObjectiveSnapshot } from '../analysis/evil-objective-types.ts'
import type {
  LanguageEvidence,
  LanguageEvidenceCursor,
} from '../record/language-types.ts'
import type { AppliedDecisionResolution } from './applied-decision.ts'
import type { StrategicIntent } from '../record/intent.ts'
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

export const COGNITION_SCHEMA_VERSION = 1
export const COMMITMENT_MODEL_VERSION = 'public-commitments-v2'

// The evidence transcript schema moved down to record/evidence.ts: it depends
// on nothing but engine vocabulary, while CognitionState below pulls in belief
// identity, role objectives and the language schema. Analysis sits below
// cognition and needs the records, which is why sharing this file was the last
// thing making the two mutually dependent. Re-exported for the consumers that
// legitimately read both halves through this module.
import { EVIDENCE_MODEL_VERSION } from '../record/evidence.ts'
import type { Evidence, PublicEvidence } from '../record/evidence.ts'

export {
  EVIDENCE_MODEL_VERSION,
  evidenceRecord,
  isPublicEvidence,
} from '../record/evidence.ts'
export type {
  AttributedEvidence,
  Evidence,
  EvidenceKind,
  PublicEvidence,
} from '../record/evidence.ts'
export const PLAN_MEMORY_VERSION = 'private-plan-memory-v3'

export interface SelectedPlanSummary {
  decision: Decision
  /** Never optional: a selected decision cannot be recorded without its plan. */
  plan: Readonly<{
    version: string
    candidateId: string
    policyId: string
    beliefThroughSeq: number
    strategicIntent?: StrategicIntent
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
