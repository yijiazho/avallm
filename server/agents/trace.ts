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
import type { CommunicationIntent } from './policy/plan.ts'
import type { LanguageTraceAttribution } from './communication/language-orchestration.ts'
import type { PublicObserverSnapshot } from './analysis/observer-types.ts'
import type { PrivateIdentitySnapshot } from './belief/identity.ts'
import type { AppliedPlanHistoryEntry } from './cognition/plan-memory.ts'
import type { OptInComponentVersions } from './cognition/types.ts'
import {
  PLAN_MEMORY_VERSION,
  validateAppliedPlanOutcomeHostJoin,
} from './cognition/plan-memory.ts'
import {
  COHERENCE_MODEL_VERSION,
  type CoherenceIntent,
  isCoherenceIntent,
} from './cognition/coherence.ts'
import type { AppliedDecisionResolution } from './applied-decision.ts'
import type {
  DecisionComponentPlan,
  DecisionComponentRun,
} from './components/kernel.ts'
import {
  DECISION_COMPONENT_RUN_VERSION,
} from './components/kernel.ts'
import type {
  ResolvedArchitectureDescriptor,
} from './components/resolved-brain.ts'
import type {
  DecisionLayerTrace,
} from './policy/decision-layer/types.ts'
import type {
  DecisionFrameTrace,
} from './policy/decision-frame.ts'
import type {
  ScoreLayerTrace,
} from './policy/score-layer/types.ts'

import { isComposedPolicy } from './brain.ts'

/**
 * A composed trace is named by its policy, the one component version that is
 * 1:1 with the agent kind. Readers ask this rather than carrying a second label.
 */
export function isComposedTrace(trace: Readonly<DecisionTrace>): boolean {
  return isComposedPolicy(trace.componentVersions?.policy)
}

export const DECISION_TRACE_VERSION = 'decision-trace-v1'
export const COMPONENT_DECISION_TRACE_VERSION = 'decision-trace-v2'
export const APPLIED_OUTCOME_DEGRADATION =
  'applied-outcome-acknowledgment-failed'

/**
 * What the host knows once the engine has accepted an action, handed to
 * finalizeAppliedTrace as a detached copy: mutating it cannot move the join the
 * host validates the returned trace against. `selectedDecision` is absent when
 * decide() failed, and `appliedDecision` can differ from it after a coercion or
 * a fallback.
 *
 * It lives here rather than in types.ts because it names a DecisionTrace, which
 * this module owns; keeping it here lets the agent boundary import it from this
 * module instead of this module importing the boundary back.
 */
export interface AppliedDecisionOutcome {
  request: DecisionRequest
  view: PlayerView
  selectedDecision?: Decision
  appliedDecision: Decision
  resolution: AppliedDecisionResolution
  provisionalTrace?: DecisionTrace
}

export interface TraceHypothesis {
  worldKey: string
  probability: number
  evilSeats: readonly Seat[]
}

export interface DecisionTrace {
  version:
    | typeof DECISION_TRACE_VERSION
    | typeof COMPONENT_DECISION_TRACE_VERSION
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
  /**
   * Exact configured architecture identity for current composed traces.
   * Optional at the generic transport boundary for legacy/external traces.
   */
  architectureIdentityDigest?: string
  statedReasoning?: string
  /** Complete ownership/version attribution for composed decisions. */
  componentVersions?: Readonly<TraceComponentVersions>
  /** Private generic component execution and causal-use attribution. */
  components?: DecisionComponentRun
  /** Ordered strategic survivor/selection transitions after universal policy. */
  decisionLayerRun?: DecisionLayerTrace
  /** Ordered native score transitions; component payloads remain in components. */
  scoreLayerRun?: ScoreLayerTrace
  /** Live frame-owned commitment and voice facts; never inferred from action. */
  decisionFrame?: DecisionFrameTrace
  /** Independent configured-graph witness for composed v2 traces. */
  componentPlan?: DecisionComponentPlan
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
  /*
   * The seven historical `decision-trace-v1` flat role projections were
   * retired: privateRoleObjective, privateEvilRoleObjective,
   * privateRoleUtility, privateEvilRoleUtility, publicMorganaCounterfeitRead,
   * privateMorganaCounterfeitObjective, and privateMorganaRoleUtility.
   *
   * Role objectives, utilities, and the Morgana projections travel in the
   * generic component run. No trace of any version may carry the retired keys:
   * canonical ingress refuses them, so a stored or external trace presenting
   * one is refused rather than reconstructed. Do not add a field here for a
   * new role; register a component instead.
   */
  /** Private finalized outcome for this decision, absent unless enabled. */
  privatePlanOutcome?: AppliedPlanHistoryEntry
  /** Pre-apply finite intent committed with an enabled plan trace. */
  coherenceIntent?: CoherenceIntent
}

/**
 * Complete ownership/version attribution carried on a composed decision trace.
 *
 * Extends {@link OptInComponentVersions} so the opt-in `identityModel`/
 * `planMemory`/`coherence`/`roleObjective`/`roleObjectiveRouter` set is shared
 * verbatim with the internal {@link CognitionVersions} and cannot drift. The
 * remaining opt-ins here (Morgana projections, `roleUtility`/`evilRoleUtility`,
 * `decisionComponents`, `configuredScorer`, and the optional `mechanicalBelief`/
 * `beliefPipeline` that CognitionVersions instead requires) are wire-only.
 */
export interface TraceComponentVersions extends OptInComponentVersions {
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
  /** Additive discriminator for the private generic component run. */
  decisionComponents?: string
  /** Absent unless the C2 decision-ready role projection was built. */
  roleUtility?: string
  /** Absent unless the D2 evil/Oberon projection was built. */
  evilRoleUtility?: string
  /** Resolved public-only Phase 7E1A counterfeit-read projection. */
  morganaCounterfeitPublicRead?: string
  /** Resolved private Phase 7E1A candidate objective. */
  morganaCounterfeitObjective?: string
  /** Configured Phase 7E1A objective; resolved only for Morgana propose/vote. */
  configuredMorganaCounterfeitObjective?: string
  /** Resolved private E1B policy projection. */
  morganaRoleUtility?: string
  /** Configured E1B projection, including ineligible/fallback decisions. */
  configuredMorganaRoleUtility?: string
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
}

export interface BaseTraceRuntimeActuals {
  readonly belief: string
  readonly factors: string
  readonly scorer: string
  readonly planner: string
  readonly voice: string
  /** Whether the invocation actually produced the compatibility flat observer. */
  readonly compatibilityObserverProduced: boolean
  readonly mechanicalBelief?: string
  readonly beliefPipeline?: string
}

export interface BaseTraceComponentVersionProjection {
  /**
   * Stable and runtime identities historically serialized before the
   * role-specific attribution fields.
   */
  readonly prefix: Readonly<
    Pick<
      TraceComponentVersions,
      | 'brain'
      | 'belief'
      | 'beliefVisibility'
      | 'factors'
      | 'languageEvidence'
      | 'observerModel'
    >
    & Pick<
      Partial<TraceComponentVersions>,
      'mechanicalBelief' | 'beliefPipeline'
    >
  >
  /**
   * Stable and runtime identities historically serialized after the
   * role-specific attribution fields.
   */
  readonly suffix: Readonly<
    Pick<
      TraceComponentVersions,
      | 'decisionComponents'
      | 'analysis'
      | 'candidates'
      | 'forcedPolicy'
      | 'policy'
      | 'scorer'
      | 'planner'
      | 'prompt'
      | 'renderer'
      | 'communication'
      | 'voice'
    >
    & Pick<
      Partial<TraceComponentVersions>,
      'planMemory' | 'coherence' | 'configuredScorer'
    >
  >
}

/**
 * Project the generic composed-trace identities from the one construction
 * descriptor and the admitted runtime facts.
 *
 * The split projection preserves the historical JSON property order around
 * role-specific fields. The run join is exact and fail-closed so a trace can
 * never pair one configured graph with another descriptor.
 */
export function projectBaseTraceComponentVersions(
  descriptor: ResolvedArchitectureDescriptor,
  admittedRun: DecisionComponentRun,
  runtime: BaseTraceRuntimeActuals,
): BaseTraceComponentVersionProjection {
  if (
    admittedRun.version !== DECISION_COMPONENT_RUN_VERSION
    || !isDeepStrictEqual(
      admittedRun.configured,
      descriptor.components.configured,
    )
  ) {
    throw new Error(
      'decision component run does not match the architecture descriptor',
    )
  }
  const pipeline = descriptor.configuredPipeline
  const planEnabled =
    pipeline.planCoherence.memory !== 'off'
    && pipeline.planCoherence.model !== 'off'
  if (
    (
      pipeline.planCoherence.memory === 'off'
      && pipeline.planCoherence.model !== 'off'
    )
    || (
      pipeline.planCoherence.memory !== 'off'
      && pipeline.planCoherence.model === 'off'
    )
  ) {
    throw new Error(
      'architecture descriptor has inconsistent plan coherence versions',
    )
  }
  const languageEnabled = descriptor.base.languageEvidence !== 'off'
  if (
    languageEnabled
    !== (
      runtime.mechanicalBelief !== undefined
      && runtime.beliefPipeline !== undefined
    )
  ) {
    throw new Error(
      'runtime belief pipeline does not match the architecture descriptor',
    )
  }
  const componentObserverConfigured =
    descriptor.componentContributions.observerModel !== 'off'
  if (
    (
      runtime.compatibilityObserverProduced
      || componentObserverConfigured
    )
    && descriptor.base.observerModel === 'off'
  ) {
    throw new Error(
      'runtime observer does not match the architecture descriptor',
    )
  }
  return Object.freeze({
    prefix: Object.freeze({
      brain: descriptor.base.version,
      belief: runtime.belief,
      ...(languageEnabled
        ? {
            mechanicalBelief: runtime.mechanicalBelief!,
            beliefPipeline: runtime.beliefPipeline!,
          }
        : {}),
      beliefVisibility: descriptor.base.beliefVisibility,
      factors: runtime.factors,
      languageEvidence: descriptor.base.languageEvidence,
      observerModel: (
        runtime.compatibilityObserverProduced
        || componentObserverConfigured
      )
        ? descriptor.base.observerModel
        : 'off',
    }),
    suffix: Object.freeze({
      ...(planEnabled
        ? {
            planMemory: pipeline.planCoherence.memory,
            coherence: pipeline.planCoherence.model,
          }
        : {}),
      // The run protocol is an admitted runtime fact, not configuration.
      // Its exact version was checked above before it can be attributed.
      decisionComponents: admittedRun.version,
      analysis: pipeline.analysis.situation,
      candidates: pipeline.candidateGeneration.legalCandidates,
      forcedPolicy: pipeline.forcedPolicy.policy,
      policy: descriptor.base.policy,
      scorer: runtime.scorer,
      ...(pipeline.scoring.configuredScorer !== runtime.scorer
        ? { configuredScorer: pipeline.scoring.configuredScorer }
        : {}),
      planner: runtime.planner,
      prompt: pipeline.prompt.prompt,
      renderer: pipeline.prompt.renderer,
      communication: descriptor.base.communication,
      voice: runtime.voice,
    }),
  })
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
              !isCoherenceIntent(provisional.coherenceIntent)
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

    // A recorded summary always carries its plan, so plan presence is exactly
    // `selected`'s and needs no separate test: absent selected already means
    // absent plan. Decision and plan agreement travel together on the one
    // branch where a selection exists.
    const selectedMatches = hostSelected === undefined
      ? recorded.selected === undefined
      : (
          recorded.selected !== undefined
          && isDeepStrictEqual(recorded.selected.decision, hostSelected)
          && recorded.selected.plan.version === provisional.decisionPlanVersion
          && recorded.selected.plan.candidateId === provisional.chosenCandidateId
          && recorded.selected.plan.policyId
            === provisional.componentVersions?.policy
          && recorded.selected.plan.beliefThroughSeq
            === provisional.beliefThroughSeq
        )
    return (
      recorded.resolution === outcome.resolution
      && recorded.coherence.intent === provisional.coherenceIntent
      && selectedMatches
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

/**
 * The default finalization of an envelope trace, once the engine has accepted
 * an action: the provisional telemetry unchanged, renamed to the action that
 * actually applied, and marked when a fallback stood in for the selection.
 * Agents whose acknowledgment adds nothing of their own return this, so the
 * shape the host validates has exactly one definition.
 */
export function finalizeProvisionalAppliedTrace(
  outcome: AppliedDecisionOutcome,
): DecisionTrace | undefined {
  if (!outcome.provisionalTrace) return undefined
  const finalized = structuredClone(outcome.provisionalTrace)
  finalized.action = structuredClone(outcome.appliedDecision)
  if (
    outcome.resolution !== 'selected-applied'
    && !finalized.degradation.includes('decision-fallback')
  ) {
    finalized.degradation = [...finalized.degradation, 'decision-fallback']
  }
  return finalized
}

/**
 * Admit a trace an agent built for a decision it never returned (decide()
 * failed, so there is no provisional trace to join against). There is nothing
 * to compare it with, so bind it to the action the engine accepted rather than
 * trusting whichever action the agent named.
 */
export function bindFallbackAppliedTrace(
  trace: DecisionTrace,
  appliedDecision: Decision,
  resolution: AppliedDecisionOutcome['resolution'],
): DecisionTrace | undefined {
  try {
    const bound = structuredClone(trace)
    bound.action = structuredClone(appliedDecision)
    if (
      resolution !== 'selected-applied'
      && !bound.degradation.includes('decision-fallback')
    ) {
      bound.degradation = [...bound.degradation, 'decision-fallback']
    }
    return bound
  } catch {
    return undefined
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
