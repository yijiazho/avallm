import type { PlayerView } from '../../engine/types.ts'
import {
  exactWorldBeliefModel,
  visibleEventCursor,
} from '../belief/exact.ts'
import type { BeliefModel, BeliefSnapshot } from '../belief/types.ts'
import {
  initialLanguageEvidenceCursor,
  validateLanguageEvidenceCursor,
} from '../communication/language-contract.ts'
import type {
  LanguageEvidence,
  LanguageEvidenceCursor,
} from '../communication/language-types.ts'
import { buildCommitments } from './commitments.ts'
import { compareEvidence, extractEvidence } from './evidence.ts'
import {
  COGNITION_SCHEMA_VERSION,
  COMMITMENT_MODEL_VERSION,
  EVIDENCE_MODEL_VERSION,
  isPublicEvidence,
  type CognitionState,
  type Evidence,
  type PublicCognitionProjection,
} from './types.ts'
import {
  PLAN_MEMORY_VERSION,
  validatePrivatePlanMemory,
} from './plan-memory.ts'
import { COHERENCE_MODEL_VERSION } from './coherence.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../analysis/role-objective-types.ts'
import {
  validatePrivateRoleObjectiveSnapshot,
} from '../analysis/role-objectives.ts'
import {
  validatePrivateEvilRoleObjectiveSnapshot,
} from '../analysis/evil-objectives.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../analysis/evil-objective-types.ts'

interface ConfiguredCognitionVersions {
  mechanicalBelief: string
  beliefPipeline: string
  languageEvidence: string
}

/**
 * The single language-cognition invariant, shared by the earlier-state guard and
 * the freshly assembled state below so the two cannot drift. `countedSourceSeqs`
 * is compared as a serialized array on purpose: an order-sensitive structural
 * match, not a set membership check.
 */
function languageConsistent(
  reads: readonly LanguageEvidence[],
  cursor: LanguageEvidenceCursor,
  throughSeq: number,
  interpreterVersion: string,
): boolean {
  const readSeqs = reads.map((read) => read.sourceSeq)
  return (
    new Set(readSeqs).size === readSeqs.length
    && readSeqs.every((seq, index) => index === 0 || readSeqs[index - 1] < seq)
    && JSON.stringify(readSeqs) === JSON.stringify(cursor.countedSourceSeqs)
    && cursor.throughSeq <= throughSeq
    && reads.every((read) => read.interpreterVersion === interpreterVersion)
    && !(interpreterVersion === 'off' && reads.length > 0)
  )
}

function checkVersionCompat(
  earlier: CognitionState,
  configured: ConfiguredCognitionVersions,
): void {
  if (
    earlier.versions.schema !== COGNITION_SCHEMA_VERSION
    || earlier.versions.evidence !== EVIDENCE_MODEL_VERSION
    || earlier.versions.commitments !== COMMITMENT_MODEL_VERSION
    || earlier.versions.belief !== earlier.belief.modelVersion
    || earlier.versions.mechanicalBelief !== configured.mechanicalBelief
    || earlier.versions.beliefPipeline !== configured.beliefPipeline
    || earlier.versions.languageEvidence !== configured.languageEvidence
    || earlier.belief.throughSeq !== earlier.throughSeq
  ) {
    throw new Error('cannot advance cognition produced by incompatible component versions')
  }
}

function checkPlanMemory(earlier: CognitionState): void {
  const hasPlanMemory = earlier.planMemory !== undefined
  if (
    hasPlanMemory !== (earlier.versions.planMemory !== undefined)
    || hasPlanMemory !== (earlier.versions.coherence !== undefined)
    || (
      hasPlanMemory
      && (
        earlier.versions.planMemory !== PLAN_MEMORY_VERSION
        || earlier.versions.coherence !== COHERENCE_MODEL_VERSION
        || !validatePrivatePlanMemory(earlier.planMemory)
      )
    )
  ) {
    throw new Error('cannot advance malformed private plan memory')
  }
}

function checkRoleObjective(earlier: CognitionState): void {
  // One union field, discriminated on team: "both a good and an evil objective"
  // is unrepresentable, so the branches below narrow rather than guard it.
  const objective = earlier.roleObjective
  if (
    (objective !== undefined) !== (earlier.versions.roleObjective !== undefined)
    || (
      objective?.team === 'good'
      && (
        earlier.versions.roleObjective !== ROLE_OBJECTIVE_MODEL_VERSION
        || !validatePrivateRoleObjectiveSnapshot(objective)
      )
    )
    || (
      objective?.team === 'evil'
      && (
        earlier.versions.roleObjective !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        || earlier.versions.roleObjectiveRouter
          !== ROLE_OBJECTIVE_ROUTER_VERSION
        || !validatePrivateEvilRoleObjectiveSnapshot(objective)
      )
    )
    || (
      earlier.versions.roleObjectiveRouter !== undefined
      && earlier.versions.roleObjectiveRouter !== ROLE_OBJECTIVE_ROUTER_VERSION
    )
  ) {
    throw new Error('cannot advance malformed private role objective')
  }
}

function checkLanguage(
  earlier: CognitionState,
  configured: ConfiguredCognitionVersions,
): void {
  validateLanguageEvidenceCursor(earlier.languageCursor)
  if (
    !languageConsistent(
      earlier.languageReads,
      earlier.languageCursor,
      earlier.throughSeq,
      configured.languageEvidence,
    )
  ) {
    throw new Error('cannot advance malformed private language cognition')
  }
}

function checkSeat(earlier: CognitionState, view: PlayerView): void {
  if (earlier.viewerSeat !== view.seat) {
    throw new Error(
      `cannot advance seat ${earlier.viewerSeat} cognition with seat ${view.seat} view`,
    )
  }
}

function checkEvidenceVisible(earlier: CognitionState, view: PlayerView): void {
  const visible = new Map(view.events.map((event) => [event.seq, event]))
  for (const evidence of earlier.evidence) {
    if (!visible.has(evidence.sourceSeq)) {
      throw new Error(
        `new view is missing prior visible event ${evidence.sourceSeq} (${evidence.id})`,
      )
    }
  }
}

/**
 * Reject an earlier cognition state the new view cannot legally advance. Each
 * invariant is a named check throwing its own diagnosable message; they run in a
 * fixed order so the first violated invariant reports.
 */
function validateEarlier(
  earlier: CognitionState,
  view: PlayerView,
  configured: ConfiguredCognitionVersions,
): void {
  checkVersionCompat(earlier, configured)
  checkPlanMemory(earlier)
  checkRoleObjective(earlier)
  checkLanguage(earlier, configured)
  checkSeat(earlier, view)
  checkEvidenceVisible(earlier, view)
}

export interface ResolvedCognitionInput {
  belief: BeliefSnapshot
  mechanicalBelief: string
  beliefPipeline: string
  languageEvidence: string
  languageReads?: readonly LanguageEvidence[]
  languageCursor?: LanguageEvidenceCursor
}

/**
 * Atomically assemble cognition around a belief already resolved by the
 * configured pipeline. Callers assign the returned object only after every
 * invariant succeeds.
 */
export function advanceCognitionFromBelief(
  earlier: CognitionState | undefined,
  view: PlayerView,
  resolved: ResolvedCognitionInput,
): CognitionState {
  const configured = {
    mechanicalBelief: resolved.mechanicalBelief,
    beliefPipeline: resolved.beliefPipeline,
    languageEvidence: resolved.languageEvidence,
  }
  if (earlier) validateEarlier(earlier, view, configured)
  const throughSeq = visibleEventCursor(view)
  if (earlier && throughSeq < earlier.throughSeq) {
    throw new Error(
      `cannot move cognition cursor backward from ${earlier.throughSeq} to ${throughSeq}`,
    )
  }
  if (resolved.belief.throughSeq !== throughSeq) {
    throw new Error(
      `resolved belief returned cursor ${resolved.belief.throughSeq}, expected ${throughSeq}`,
    )
  }

  const languageReads: LanguageEvidence[] = [
    ...structuredClone(resolved.languageReads ?? earlier?.languageReads ?? []),
  ]
  languageReads.sort((left, right) => left.sourceSeq - right.sourceSeq)
  const languageCursor = structuredClone(
    resolved.languageCursor
      ?? earlier?.languageCursor
      ?? initialLanguageEvidenceCursor(),
  )
  validateLanguageEvidenceCursor(languageCursor)
  if (
    !languageConsistent(
      languageReads,
      languageCursor,
      throughSeq,
      resolved.languageEvidence,
    )
  ) {
    throw new Error('resolved language cognition is inconsistent')
  }

  const byId = new Map<string, Evidence>()
  for (const evidence of earlier?.evidence ?? []) byId.set(evidence.id, evidence)
  for (const evidence of extractEvidence(view, earlier?.throughSeq ?? -1)) {
    const existing = byId.get(evidence.id)
    // Full structural compare of the whole record; compareEvidence only orders
    // by sourceSeq/id and would miss a diverging payload under the same id.
    if (existing && JSON.stringify(existing) !== JSON.stringify(evidence)) {
      throw new Error(`conflicting evidence identity ${evidence.id}`)
    }
    byId.set(evidence.id, evidence)
  }
  const evidence = [...byId.values()].sort(compareEvidence)
  return {
    viewerSeat: view.seat,
    throughSeq,
    evidence,
    // Inference owns this fresh immutable-by-contract snapshot. Keeping the
    // reference avoids cloning every feasible world on every decision while
    // atomicity still comes from assigning the completed CognitionState once.
    belief: resolved.belief,
    commitments: buildCommitments(evidence),
    languageReads,
    languageCursor,
    ...(earlier?.planMemory
      ? { planMemory: structuredClone(earlier.planMemory) }
      : {}),
    versions: {
      schema: COGNITION_SCHEMA_VERSION,
      evidence: EVIDENCE_MODEL_VERSION,
      commitments: COMMITMENT_MODEL_VERSION,
      belief: resolved.belief.modelVersion,
      mechanicalBelief: resolved.mechanicalBelief,
      beliefPipeline: resolved.beliefPipeline,
      languageEvidence: resolved.languageEvidence,
      ...(earlier?.versions.planMemory
        ? { planMemory: earlier.versions.planMemory }
        : {}),
      ...(earlier?.versions.coherence
        ? { coherence: earlier.versions.coherence }
        : {}),
    },
  }
}

/**
 * Incrementally advance typed cognition. Every visible event at or below the
 * earlier cursor is treated as already processed, including events that do not
 * produce evidence records.
 */
export function advanceCognition(
  earlier: CognitionState | undefined,
  view: PlayerView,
  beliefModel: BeliefModel = exactWorldBeliefModel,
): CognitionState {
  const throughSeq = visibleEventCursor(view)
  const belief = beliefModel.infer(view)
  if (belief.modelVersion !== beliefModel.version) {
    throw new Error(
      `belief model ${beliefModel.version} returned snapshot ${belief.modelVersion}`,
    )
  }
  if (belief.throughSeq !== throughSeq) {
    throw new Error(
      `belief model ${beliefModel.version} returned cursor ${belief.throughSeq}, expected ${throughSeq}`,
    )
  }
  return advanceCognitionFromBelief(earlier, view, {
    belief,
    mechanicalBelief: beliefModel.version,
    beliefPipeline: beliefModel.version,
    languageEvidence: 'off',
  })
}

/** Replay/recovery path from a complete seat-filtered view. */
export function reconstructCognition(
  view: PlayerView,
  beliefModel: BeliefModel = exactWorldBeliefModel,
): CognitionState {
  return advanceCognition(undefined, view, beliefModel)
}

/** Strictly public evidence and literal public commitments, with no posterior. */
export function publicCognition(
  state: CognitionState,
): PublicCognitionProjection {
  const evidence = state.evidence.filter(isPublicEvidence)
  return {
    throughSeq: evidence.reduce(
      (cursor, record) => Math.max(cursor, record.sourceSeq),
      -1,
    ),
    evidence,
    commitments: state.commitments,
    versions: {
      schema: state.versions.schema,
      evidence: state.versions.evidence,
      commitments: state.versions.commitments,
    },
  }
}
