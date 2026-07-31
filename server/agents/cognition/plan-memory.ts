import { isDeepStrictEqual } from 'node:util'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import type { StrategicIntent } from '../record/intent.ts'
import type { AppliedDecisionResolution } from './applied-decision.ts'
import {
  assessLiteralCoherence,
  COHERENCE_MODEL_VERSION,
  literalCommitmentBasis,
  type CoherenceIntent,
} from './coherence.ts'
import {
  PLAN_MEMORY_VERSION,
  type AppliedPlanHistoryEntry,
  type PrivatePlanMemory,
  type PublicCommitment,
  type SelectedPlanSummary,
} from './types.ts'
import {
  entryId,
  PLAN_MEMORY_HISTORY_LIMIT,
  validatePrivatePlanMemory,
  viewCursor,
} from './plan-memory-schema.ts'

// The plan-memory shapes live in cognition/types.ts, where CognitionState names
// PrivatePlanMemory; keeping them there rather than here is what lets that
// module avoid importing this one back. The recording logic below owns them, and
// they are re-exported so callers still read them from `./plan-memory.ts`. The
// untrusted-ingress schema validation lives in plan-memory-schema.ts, which this
// module depends on for the shared id/cursor helpers and the final validation.
export { PLAN_MEMORY_VERSION } from './types.ts'
export type {
  AppliedPlanHistoryEntry,
  PrivatePlanMemory,
  SelectedPlanSummary,
} from './types.ts'

/**
 * The part of a selected plan this module actually reads.
 *
 * Stated structurally rather than imported as policy/plan.ts's DecisionPlan,
 * which was the last edge making cognition and policy mutually dependent:
 * decision-frame.ts consumes the whole CognitionState, so policy genuinely
 * sits above cognition, and this one type reference was all that pointed back.
 * A plan is recorded here, never built or interpreted here. Structural typing
 * means every existing caller still passes a real DecisionPlan and nothing at
 * the call sites changed; what changed is that cognition no longer has to know
 * the shape policy chose.
 */
interface SelectedPlanIdentity {
  version: string
  candidateId: string
  policyId: string
  beliefThroughSeq: number
  request: DecisionRequest
  decision: Decision
  strategicIntent?: StrategicIntent
}

function planSummary(
  selectedDecision: Decision,
  plan: SelectedPlanIdentity,
): SelectedPlanSummary {
  return {
    decision: structuredClone(selectedDecision),
    plan: {
      version: plan.version,
      candidateId: plan.candidateId,
      policyId: plan.policyId,
      beliefThroughSeq: plan.beliefThroughSeq,
      ...(plan.strategicIntent
        ? { strategicIntent: structuredClone(plan.strategicIntent) }
        : {}),
    },
  }
}

export interface RecordAppliedPlanInput {
  memory?: PrivatePlanMemory
  req: DecisionRequest
  view: PlayerView
  commitments: readonly PublicCommitment[]
  selectedDecision?: Decision
  selectedPlan?: SelectedPlanIdentity
  appliedDecision: Decision
  resolution: AppliedDecisionResolution
  intent: CoherenceIntent
}

export function recordAppliedPlan(
  input: RecordAppliedPlanInput,
): PrivatePlanMemory {
  if (input.view.seat !== input.req.seat) {
    throw new Error('cannot record a plan from another seat view')
  }
  // Both fallback-after-illegal-decision and selected-applied carry what the
  // agent chose; only an agent error leaves nothing to have been selected.
  const expectsSelected = input.resolution !== 'fallback-after-agent-error'
  if (expectsSelected !== Boolean(input.selectedDecision)) {
    throw new Error('selected decision does not match applied resolution')
  }
  if (
    input.selectedPlan
    && (
      !input.selectedDecision
      || !isDeepStrictEqual(input.selectedPlan.request, input.req)
      || !isDeepStrictEqual(input.selectedPlan.decision, input.selectedDecision)
    )
  ) {
    throw new Error('selected plan does not match request and selected decision')
  }
  if (input.selectedDecision && !input.selectedPlan) {
    throw new Error('selected decisions require their selected structured plan')
  }
  if (
    input.memory
    && (
      input.memory.version !== PLAN_MEMORY_VERSION
      || input.memory.coherenceVersion !== COHERENCE_MODEL_VERSION
      || input.memory.viewerSeat !== input.req.seat
    )
  ) {
    throw new Error('cannot advance incompatible private plan memory')
  }
  const throughSeq = viewCursor(input.view)
  const ordinal = input.memory?.nextOrdinal ?? 0
  const id = entryId(input.req, throughSeq, ordinal)
  const basis = literalCommitmentBasis(input.commitments, input.req)
  const coherence = assessLiteralCoherence(
    input.req,
    input.appliedDecision,
    input.intent,
    basis,
    input.view.currentTeam,
  )
  const history: AppliedPlanHistoryEntry[] = (input.memory?.history ?? []).map(
    (entry) =>
      entry.status === 'current'
        ? { ...structuredClone(entry), status: 'superseded' as const, supersededBy: id }
        : structuredClone(entry))
  history.push({
    id,
    request: { ...input.req },
    viewThroughSeq: throughSeq,
    ...(input.selectedDecision && input.selectedPlan
      ? { selected: planSummary(input.selectedDecision, input.selectedPlan) }
      : {}),
    appliedDecision: structuredClone(input.appliedDecision),
    resolution: input.resolution,
    coherence,
    status: 'current',
  })
  while (history.length > PLAN_MEMORY_HISTORY_LIMIT) history.shift()
  const recorded: PrivatePlanMemory = {
    version: PLAN_MEMORY_VERSION,
    coherenceVersion: COHERENCE_MODEL_VERSION,
    viewerSeat: input.req.seat,
    nextOrdinal: ordinal + 1,
    history,
  }
  if (!validatePrivatePlanMemory(recorded)) {
    throw new Error('recorded private plan memory exceeds its bounded schema')
  }
  return recorded
}
