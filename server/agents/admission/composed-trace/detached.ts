// Detached validation: everything admission can decide about a trace with no
// host context at all. This is the surface a cross-language producer meets
// first, so it is kept clear of every host-join validator. Interleave the two
// families and a detached check acquires a host dependency by accident, which
// widens what an untrusted producer is trusted to assert.

import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../../../engine/types.ts'
import {
  ANALYSIS_FACT_CODES,
} from '../../analysis/situation-types.ts'
import {
  FORCED_PLAY_REASON_CODES,
} from '../../candidate/types.ts'
import {
  probability,
} from '../../canonical/canonical-shape.ts'
import {
  DECISION_FRAME_VERSION,
} from '../../policy/decision-frame.ts'
import type {
  AdmittedDecisionLayerTrace,
} from './production-registries.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  COMPONENT_DECISION_TRACE_VERSION,
  DECISION_TRACE_VERSION,
  decisionTraceIdForRequest,
} from '../../trace.ts'
import type {
  DecisionTrace,
} from '../../trace.ts'
import {
  validRoleTraceV1,
} from '../role-trace-v1.ts'
import {
  enumStringArray,
  stringArray,
  validForcedPolicyResult,
} from '../trace-primitives.ts'
import {
  validGenericComponentRun,
} from './component-run.ts'
import {
  validBeliefPlayerMarginals,
  validBeliefProvenance,
  validBeliefTeamAssessments,
  validBeliefTraceRelations,
  validCandidateScores,
  validComponentVersions,
  validLanguageTrace,
  validPlanOutcomeTrace,
  validPrivateIdentityTrace,
  validPublicObserverTrace,
  validRelevantTeam,
} from './field-validators.ts'
import {
  validComposedTraceRelations,
} from './relations.ts'
import {
  canonicalTraceSeats,
  exactGenericRecord,
  hostTableSize,
  isFullPlayerView,
} from './trace-shape.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

export function validDecisionTrace(
  req: DecisionRequest,
  decision: Decision,
  value: unknown,
  hostView?: PlayerView | Pick<PlayerView, 'rolesInPlay'>,
  decisionLayerAdmission?: AdmittedDecisionLayerTrace,
): value is DecisionTrace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const trace = value as Record<string, unknown>
  const fullHostView = isFullPlayerView(hostView) ? hostView : undefined
  const playerCount = hostTableSize(hostView)
  const throughSeq = trace.beliefThroughSeq
  const hypotheses = trace.topHypotheses
  return (
    (
      trace.version === DECISION_TRACE_VERSION
      || trace.version === COMPONENT_DECISION_TRACE_VERSION
    )
    && typeof throughSeq === 'number'
    && Number.isInteger(throughSeq)
    && throughSeq >= 0
    && trace.decisionId === decisionTraceIdForRequest(req, throughSeq)
    && trace.viewerSeat === req.seat
    && isDeepStrictEqual(trace.request, req)
    && typeof trace.beliefModelVersion === 'string'
    && trace.beliefModelVersion.length > 0
    && ['constraints-only', 'weighted', 'degraded'].includes(
      trace.quality as string,
    )
    && stringArray(trace.degradation)
    && !(trace.degradation as string[]).includes(
      APPLIED_OUTCOME_DEGRADATION,
    )
    && validBeliefProvenance(trace.beliefProvenance)
    && validBeliefPlayerMarginals(trace.beliefPlayerMarginals)
    && validBeliefTeamAssessments(trace.beliefTeamAssessments, playerCount)
    && validBeliefTraceRelations(trace)
    && Array.isArray(hypotheses)
    && hypotheses.every((entry) => {
      const hypothesis = entry as Record<string, unknown>
      return !!hypothesis
        && typeof hypothesis === 'object'
        && typeof hypothesis.worldKey === 'string'
        && probability(hypothesis.probability)
        && canonicalTraceSeats(hypothesis.evilSeats, playerCount)
    })
    && validRelevantTeam(trace.relevantTeam, playerCount)
    && enumStringArray(trace.factCodes, ANALYSIS_FACT_CODES)
    && enumStringArray(trace.reasonCodes, FORCED_PLAY_REASON_CODES)
    && isDeepStrictEqual(trace.action, decision)
    && (
      trace.architectureIdentityDigest === undefined
      || (
        typeof trace.architectureIdentityDigest === 'string'
        && /^[0-9a-f]{64}$/.test(trace.architectureIdentityDigest)
      )
    )
    && (
      trace.statedReasoning === undefined
      || typeof trace.statedReasoning === 'string'
    )
    && validComponentVersions(trace.componentVersions)
    && validGenericComponentRun(
      trace as unknown as DecisionTrace,
      fullHostView,
    )
    && (
      trace.version === DECISION_TRACE_VERSION
      || decisionLayerAdmission !== undefined
    )
    && validLanguageTrace(trace.languageEvidence, trace)
    && validPublicObserverTrace(trace.publicObserver, trace, hostView)
    && validPrivateIdentityTrace(
      trace.privateIdentity,
      trace,
      hostView?.rolesInPlay,
    )
    && (
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      || validRoleTraceV1({ trace, req, view: fullHostView })
    )
    && validPlanOutcomeTrace(
      trace.privatePlanOutcome,
      trace,
    )
    && validCandidateScores(trace.candidateScores, playerCount)
    && (
      trace.structuredCandidateId === undefined
      || typeof trace.structuredCandidateId === 'string'
    )
    && (
      trace.chosenCandidateId === undefined
      || typeof trace.chosenCandidateId === 'string'
    )
    && (
      trace.plannerCandidateId === undefined
      || typeof trace.plannerCandidateId === 'string'
    )
    && (
      trace.plannerReasonCodes === undefined
      || stringArray(trace.plannerReasonCodes)
    )
    && (
      trace.decisionPlanVersion === undefined
      || typeof trace.decisionPlanVersion === 'string'
    )
    && validForcedPolicyResult(trace.forcedPolicyResult)
    && validDecisionFrameTrace(trace.decisionFrame)
    && validComposedTraceRelations(trace, playerCount, hostView)
  )
}

function validDecisionFrameTrace(value: unknown): boolean {
  if (value === undefined) return true
  if (!exactGenericRecord(value, [
    'committedMechanicalAction',
    'version',
    'voice',
  ])) return false
  const frame = value
  if (frame.version !== DECISION_FRAME_VERSION) return false
  const action = frame.committedMechanicalAction
  if (!exactGenericRecord(frame.voice, ['applied', 'version'])) return false
  const voice = frame.voice
  return !!action
    && typeof action === 'object'
    && !Array.isArray(action)
    && typeof (action as Record<string, unknown>).kind === 'string'
    && typeof voice.version === 'string'
    && typeof voice.applied === 'boolean'
}
