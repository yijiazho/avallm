import { isDeepStrictEqual } from 'node:util'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../engine/types.ts'
import type { SituationAnalysis, SituationTeamAssessment } from './analysis/types.ts'
import type {
  BeliefSnapshot,
  EvidenceContribution,
  PlayerMarginal,
} from './belief/types.ts'
import type { PolicyCandidateTeamAssessment } from './analysis/types.ts'
import type { CandidateScore } from './policy/score.ts'
import type { ForcedPolicyResult } from './policy/types.ts'
import type { AgentExecutionMode } from './brain.ts'
import type { CommunicationIntent } from './policy/plan.ts'
import type { LanguageTraceAttribution } from './communication/language-orchestration.ts'
import type { PublicObserverSnapshot } from './analysis/observer-types.ts'
import type { PrivateRoleObjectiveSnapshot } from './analysis/role-objective-types.ts'
import type { PrivateEvilRoleObjectiveSnapshot } from './analysis/evil-objective-types.ts'
import type { PrivateRoleUtilityProjection } from './analysis/role-utility.ts'
import type { PrivateEvilRoleUtilityProjection } from './analysis/evil-role-utility.ts'
import type {
  PrivateEvilQuestCardPolicy,
} from './policy/evil-quest-card.ts'
import type { PrivateIdentitySnapshot } from './belief/identity.ts'
import type { AppliedPlanHistoryEntry } from './cognition/plan-memory.ts'
import {
  PLAN_MEMORY_VERSION,
  validateAppliedPlanOutcomeHostJoin,
} from './cognition/plan-memory.ts'
import {
  COHERENCE_MODEL_VERSION,
  type CoherenceIntent,
} from './cognition/coherence.ts'
import type { AppliedDecisionOutcome } from './types.ts'

export const DECISION_TRACE_VERSION = 'decision-trace-v1'
export const APPLIED_OUTCOME_DEGRADATION =
  'applied-outcome-acknowledgment-failed'

export interface TraceHypothesis {
  worldKey: string
  probability: number
  evilSeats: readonly Seat[]
}

export interface DecisionTrace {
  version: typeof DECISION_TRACE_VERSION
  decisionId: string
  viewerSeat: Seat
  request: DecisionRequest
  beliefModelVersion: string
  beliefThroughSeq: number
  quality: BeliefSnapshot['quality']
  degradation: readonly string[]
  beliefProvenance?: readonly EvidenceContribution[]
  beliefPlayerMarginals?: readonly PlayerMarginal[]
  beliefTeamAssessments?: readonly PolicyCandidateTeamAssessment[]
  topHypotheses: readonly TraceHypothesis[]
  relevantTeam?: SituationTeamAssessment
  factCodes: SituationAnalysis['factCodes']
  reasonCodes: SituationAnalysis['forcedPlayReasonCodes']
  action: Decision
  /** Explicit experiment cell; do not infer it from component versions. */
  agentMode?: AgentExecutionMode
  statedReasoning?: string
  /** Complete ownership/version attribution for composed decisions. */
  componentVersions?: Readonly<{
    brain: string
    /**
     * Actual version of the resolved snapshot used for this decision. This can
     * vary between decisions when an opt-in factor has no applicable evidence.
     */
    belief: string
    /** Stable configured identities, present only for opt-in belief pipelines. */
    mechanicalBelief?: string
    beliefPipeline?: string
    beliefVisibility: string
    factors: string
    languageEvidence: string
    observerModel: string
    /** Absent means the private identity model is off. */
    identityModel?: string
    /** Absent means post-legality private plan memory is off. */
    planMemory?: string
    /** Absent means literal commitment coherence is off. */
    coherence?: string
    /** Absent means Merlin/Percival role-objective analysis is off. */
    roleObjective?: string
    /** Configured role router; concrete roleObjective remains separately named. */
    roleObjectiveRouter?: string
    /** Absent unless the C2 decision-ready role projection was built. */
    roleUtility?: string
    /** Absent unless the D2 evil/Oberon projection was built. */
    evilRoleUtility?: string
    /** Resolved D3 policy, present only on applicable evil quest decisions. */
    evilQuestCardPolicy?: string
    /** Configured D3 policy; resolved payload remains quest/applicability-only. */
    configuredEvilQuestCardPolicy?: string
    analysis: string
    candidates: string
    forcedPolicy: string
    policy: string
    /** Configured scorer when applicability/degradation resolved to another. */
    configuredScorer?: string
    scorer: string
    planner: string
    prompt: string
    renderer: string
    communication: string
    voice: string
  }>
  candidateScores?: readonly CandidateScore[]
  /** Structured scorer choice before any admitted planner selection. */
  structuredCandidateId?: string
  chosenCandidateId?: string
  /** Last planner attempt, including attempts rejected by the boundary. */
  plannerCandidateId?: string
  /** Reason subset admitted for the chosen planner selection. */
  plannerReasonCodes?: readonly string[]
  decisionPlanVersion?: string
  forcedPolicyResult?: ForcedPolicyResult
  communicationIntent?: CommunicationIntent
  /**
   * Private component attribution only. It deliberately excludes player text,
   * names, rationales, and provider payloads.
   */
  languageEvidence?: LanguageTraceAttribution
  /** Public-only observer output, absent unless the observer is enabled. */
  publicObserver?: PublicObserverSnapshot
  /** Bounded private identity output, absent unless explicitly enabled. */
  privateIdentity?: PrivateIdentitySnapshot
  /** Private mechanically inert Merlin/Percival objective output. */
  privateRoleObjective?: PrivateRoleObjectiveSnapshot
  /** Private mechanically inert visible-evil/Oberon objective output. */
  privateEvilRoleObjective?: PrivateEvilRoleObjectiveSnapshot
  /** Private decision-ready role utility, absent off/inapplicable/degraded. */
  privateRoleUtility?: PrivateRoleUtilityProjection
  /** Private D2 evil/Oberon utility, absent off/inapplicable/degraded. */
  privateEvilRoleUtility?: PrivateEvilRoleUtilityProjection
  /** Private D3 convention, absent unless explicitly configured. */
  privateEvilQuestCardPolicy?: PrivateEvilQuestCardPolicy
  /** Private finalized outcome for this decision, absent unless enabled. */
  privatePlanOutcome?: AppliedPlanHistoryEntry
  /** Pre-apply finite intent committed with an enabled plan trace. */
  coherenceIntent?: CoherenceIntent
}

export function decisionTraceId(
  req: DecisionRequest,
  view: PlayerView,
  beliefThroughSeq: number,
): string {
  return decisionTraceIdForRequest(req, beliefThroughSeq)
}

export function decisionTraceIdForRequest(
  req: DecisionRequest,
  beliefThroughSeq: number,
): string {
  return `decision:${req.seat}:${req.kind}:q${req.round}:p${req.proposalNum}:v${beliefThroughSeq}`
}

function relevantTeam(
  action: Decision,
  analysis: SituationAnalysis,
): SituationTeamAssessment | undefined {
  if (action.kind === 'propose' || (action.kind === 'finalize' && !action.stick)) {
    return analysis.candidateTeams[0]
  }
  return analysis.currentTeam
}

export function createDecisionTrace(
  req: DecisionRequest,
  view: PlayerView,
  belief: BeliefSnapshot,
  analysis: SituationAnalysis,
  action: Decision,
  degradation: readonly string[] = [],
): DecisionTrace {
  const recordedAction = structuredClone(action)
  if (
    recordedAction.kind === 'propose'
    || (recordedAction.kind === 'finalize' && !recordedAction.stick)
  ) {
    recordedAction.team.sort((a, b) => a - b)
  }
  if (
    recordedAction.kind === 'discuss'
    && recordedAction.lean !== undefined
    && view.seat === view.leaderSeat
  ) {
    delete recordedAction.lean
  }
  if (recordedAction.kind === 'quest' && view.alignment === 'good') {
    recordedAction.card = 'success'
  }
  return {
    version: DECISION_TRACE_VERSION,
    decisionId: decisionTraceId(req, view, belief.throughSeq),
    viewerSeat: view.seat,
    request: { ...req },
    beliefModelVersion: belief.modelVersion,
    beliefThroughSeq: belief.throughSeq,
    quality: belief.quality,
    degradation: [...belief.degradation, ...degradation],
    ...(belief.provenance.length
      ? { beliefProvenance: structuredClone(belief.provenance) }
      : {}),
    beliefPlayerMarginals: structuredClone(belief.playerMarginals),
    ...(analysis.policyCandidateAssessments.length
      ? {
          beliefTeamAssessments: structuredClone(
            analysis.policyCandidateAssessments,
          ),
        }
      : {}),
    topHypotheses: belief.topWorlds.slice(0, 3).map((weighted) => ({
      worldKey: weighted.world.key,
      probability: weighted.probability,
      evilSeats: weighted.world.alignmentBySeat
        .map((alignment, seat) => ({ alignment, seat }))
        .filter(({ alignment }) => alignment === 'evil')
        .map(({ seat }) => seat),
    })),
    ...(relevantTeam(action, analysis)
      ? { relevantTeam: relevantTeam(action, analysis) }
      : {}),
    factCodes: analysis.factCodes,
    reasonCodes: analysis.forcedPlayReasonCodes,
    action: recordedAction,
    ...(action.thinking ? { statedReasoning: action.thinking } : {}),
  }
}

/** Keep one ultimate trace per stable decision identity. */
export function upsertDecisionTrace(
  traces: DecisionTrace[],
  trace: DecisionTrace,
): void {
  const existing = traces.findIndex(
    (candidate) => candidate.decisionId === trace.decisionId,
  )
  if (existing === -1) traces.push(trace)
  else traces[existing] = trace
}

/**
 * Bind a hook-finalized plan outcome to the independent host request, view,
 * and legal action while those values are still available.
 */
export function validateFinalizedAppliedTraceHostJoin(
  trace: DecisionTrace,
  outcome: AppliedDecisionOutcome,
): boolean {
  try {
    const provisional = outcome.provisionalTrace
    if (!provisional) return false
    const hostSelected = outcome.selectedDecision
    const resolutionShapeMatches = outcome.resolution === 'selected-applied'
      ? hostSelected !== undefined
      : outcome.resolution === 'fallback-after-agent-error'
        ? hostSelected === undefined
        : hostSelected !== undefined
    if (!resolutionShapeMatches) return false

    const provisionalVersions = provisional.componentVersions
    const planEnabled =
      provisionalVersions?.planMemory === PLAN_MEMORY_VERSION
      && provisionalVersions?.coherence === COHERENCE_MODEL_VERSION
    const planOff =
      provisionalVersions?.planMemory === undefined
      && provisionalVersions?.coherence === undefined
    if (!planEnabled && !planOff) return false
    const returnedPlanEnabled =
      trace.componentVersions?.planMemory === PLAN_MEMORY_VERSION
      && trace.componentVersions?.coherence === COHERENCE_MODEL_VERSION
    const returnedPlanOff =
      trace.componentVersions?.planMemory === undefined
      && trace.componentVersions?.coherence === undefined
    if (
      planEnabled !== returnedPlanEnabled
      || planOff !== returnedPlanOff
      || provisional.privatePlanOutcome !== undefined
      || provisional.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
      || (
        planEnabled
          ? (
              !['maintain', 'conceal', 'deceive'].includes(
                String(provisional.coherenceIntent),
              )
              || trace.coherenceIntent !== provisional.coherenceIntent
            )
          : (
              provisional.coherenceIntent !== undefined
              || trace.coherenceIntent !== undefined
              || trace.privatePlanOutcome !== undefined
              || provisional.degradation.includes(
                APPLIED_OUTCOME_DEGRADATION,
              )
              || trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
            )
      )
    ) {
      return false
    }

    // Derive the only admissible finalized shape from the untouched host copy.
    // Everything except the canonical action, post-apply payload/component
    // declarations, and resolution markers remains byte-for-byte structural
    // telemetry from the provisional trace.
    const expected = structuredClone(provisional)
    expected.action = structuredClone(outcome.appliedDecision)
    if (
      outcome.resolution !== 'selected-applied'
      && !expected.degradation.includes('decision-fallback')
    ) {
      expected.degradation = [...expected.degradation, 'decision-fallback']
    }

    const recorded = trace.privatePlanOutcome
    if (recorded === undefined) {
      delete expected.privatePlanOutcome
      if (!planEnabled) {
        return isDeepStrictEqual(trace, expected)
      }
      if (
        !trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
      ) {
        return false
      }
      if (!expected.degradation.includes(APPLIED_OUTCOME_DEGRADATION)) {
        expected.degradation = [
          ...expected.degradation,
          APPLIED_OUTCOME_DEGRADATION,
        ]
      }
      return isDeepStrictEqual(trace, expected)
    }
    if (!planEnabled) return false
    expected.privatePlanOutcome = structuredClone(recorded)
    if (!isDeepStrictEqual(trace, expected)) return false

    const selectedMatches = hostSelected === undefined
      ? recorded.selected === undefined
      : (
          recorded.selected !== undefined
          && isDeepStrictEqual(recorded.selected.decision, hostSelected)
        )
    const plan = recorded.selected?.plan
    const planMatches = hostSelected === undefined
      ? plan === undefined
      : (
          !!plan
          && plan.version === provisional.decisionPlanVersion
          && plan.candidateId === provisional.chosenCandidateId
          && plan.policyId === provisional.componentVersions?.policy
          && plan.beliefThroughSeq === provisional.beliefThroughSeq
        )
    return (
      recorded.resolution === outcome.resolution
      && recorded.coherence.intent === provisional.coherenceIntent
      && selectedMatches
      && planMatches
      && validateAppliedPlanOutcomeHostJoin(
        recorded,
        outcome.request,
        outcome.appliedDecision,
        outcome.view,
      )
    )
  } catch {
    return false
  }
}

/** A detached, applied-action trace for a failed optional acknowledgment. */
export function degradedAppliedOutcomeTrace(
  provisional: DecisionTrace | undefined,
  appliedDecision: Decision,
  resolution: AppliedDecisionOutcome['resolution'] = 'selected-applied',
): DecisionTrace | undefined {
  if (!provisional) return undefined
  try {
    const finalized = structuredClone(provisional)
    finalized.action = structuredClone(appliedDecision)
    delete finalized.privatePlanOutcome
    if (!finalized.degradation.includes(APPLIED_OUTCOME_DEGRADATION)) {
      finalized.degradation = [
        ...finalized.degradation,
        APPLIED_OUTCOME_DEGRADATION,
      ]
    }
    if (
      resolution !== 'selected-applied'
      && !finalized.degradation.includes('decision-fallback')
    ) {
      finalized.degradation = [...finalized.degradation, 'decision-fallback']
    }
    return finalized
  } catch {
    return undefined
  }
}
