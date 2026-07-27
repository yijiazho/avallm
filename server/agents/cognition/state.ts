import type { PlayerView } from '../../engine/types.ts'
import {
  exactWorldBeliefModel,
  visibleEventCursor,
} from '../belief/exact.ts'
import type { BeliefModel } from '../belief/types.ts'
import { buildCommitments } from './commitments.ts'
import { compareEvidence, extractEvidence } from './evidence.ts'
import {
  COGNITION_SCHEMA_VERSION,
  COMMITMENT_MODEL_VERSION,
  EVIDENCE_MODEL_VERSION,
  type CognitionState,
  type Evidence,
  type PublicCognitionProjection,
} from './types.ts'

function validateEarlier(
  earlier: CognitionState,
  view: PlayerView,
  beliefModel: BeliefModel,
): void {
  if (
    earlier.versions.schema !== COGNITION_SCHEMA_VERSION
    || earlier.versions.evidence !== EVIDENCE_MODEL_VERSION
    || earlier.versions.commitments !== COMMITMENT_MODEL_VERSION
    || earlier.versions.belief !== beliefModel.version
  ) {
    throw new Error('cannot advance cognition produced by incompatible component versions')
  }
  if (earlier.viewerSeat !== view.seat) {
    throw new Error(
      `cannot advance seat ${earlier.viewerSeat} cognition with seat ${view.seat} view`,
    )
  }
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
 * Incrementally advance typed cognition. Every visible event at or below the
 * earlier cursor is treated as already processed, including events that do not
 * produce evidence records.
 */
export function advanceCognition(
  earlier: CognitionState | undefined,
  view: PlayerView,
  beliefModel: BeliefModel = exactWorldBeliefModel,
): CognitionState {
  if (earlier) validateEarlier(earlier, view, beliefModel)
  const throughSeq = visibleEventCursor(view)
  if (earlier && throughSeq < earlier.throughSeq) {
    throw new Error(
      `cannot move cognition cursor backward from ${earlier.throughSeq} to ${throughSeq}`,
    )
  }

  const byId = new Map<string, Evidence>()
  for (const evidence of earlier?.evidence ?? []) byId.set(evidence.id, evidence)
  for (const evidence of extractEvidence(view, earlier?.throughSeq ?? -1)) {
    const existing = byId.get(evidence.id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(evidence)) {
      throw new Error(`conflicting evidence identity ${evidence.id}`)
    }
    byId.set(evidence.id, evidence)
  }
  const evidence = [...byId.values()].sort(compareEvidence)
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
  return {
    viewerSeat: view.seat,
    throughSeq,
    evidence,
    belief,
    commitments: buildCommitments(evidence),
    versions: {
      schema: COGNITION_SCHEMA_VERSION,
      evidence: EVIDENCE_MODEL_VERSION,
      commitments: COMMITMENT_MODEL_VERSION,
      belief: belief.modelVersion,
    },
  }
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
  const evidence = state.evidence.filter((record) => record.scope === 'public')
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
