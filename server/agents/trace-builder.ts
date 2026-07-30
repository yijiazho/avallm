import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../engine/types.ts'
import type { analyzeSituation } from './analysis/situation.ts'
import type { PublicObserverSnapshot } from './analysis/observer-types.ts'
import { ROLE_OBJECTIVE_ROUTER_VERSION } from './analysis/evil-objective-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  type PrivateIdentitySnapshot,
} from './belief/identity.ts'
import type {
  DecisionComponentPlan,
  DecisionComponentRun,
} from './components/kernel.ts'
import type { ResolvedComposedBrain } from './components/resolved-brain.ts'
import type { DecisionLayerRun } from './policy/decision-layer/types.ts'
import { projectLayerRun } from './policy/layer-registry-common.ts'
import type { CognitionState } from './cognition/types.ts'
import type { CoherenceIntent } from './cognition/coherence.ts'
import { isCoherenceIntent } from './cognition/coherence.ts'
import type { LanguageTraceAttribution } from './communication/language-orchestration.ts'
import type { DecisionPlan } from './policy/plan.ts'
import type { CandidateScore } from './policy/score.ts'
import type { ForcedPolicyResult } from './policy/types.ts'
import type { CompatibilityVoicedOutputProjection } from './policy/decision-frame.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  createDecisionTrace,
  projectBaseTraceComponentVersions,
  type DecisionTrace,
} from './trace.ts'

/**
 * Everything one decision trace is assembled from.
 *
 * These arrive as one object rather than a positional list because the list had
 * grown past the point where a reader could check it. Its tail was a run of
 * same-typed values carrying no order a type could defend: `identityEnabled`
 * and `roleObjectiveRouterEnabled` sat adjacent, both booleans, and transposing
 * them typechecked while silently mislabelling which substrate the decision
 * used. Naming every argument at the call site removes that failure entirely.
 *
 * Every field is required, including the ones that are legitimately absent for
 * a given decision. Those declare `| undefined` instead of taking a default, so
 * a forgotten input fails the build rather than reading as a confident "off".
 */
export interface ComposedTraceInput {
  readonly req: DecisionRequest
  readonly view: PlayerView
  readonly cognition: CognitionState
  readonly analysis: ReturnType<typeof analyzeSituation>
  readonly action: Decision
  readonly scores: readonly CandidateScore[]
  readonly structuredCandidateId: string
  readonly chosenCandidateId: string
  readonly forced: ForcedPolicyResult
  readonly plannerVersion: string
  readonly voiceVersion: string
  readonly scorerVersion: string
  readonly degradation: readonly string[]
  readonly componentPlan: DecisionComponentPlan
  readonly decisionComponents: DecisionComponentRun
  readonly decisionLayerRun: DecisionLayerRun
  readonly scoreLayerRun: CompatibilityVoicedOutputProjection['scoreLayerRun']
  readonly decisionFrame: CompatibilityVoicedOutputProjection['decisionFrame']
  readonly descriptor: ResolvedComposedBrain['description']
  readonly architectureIdentityDigest: string
  readonly communication: DecisionPlan['communication']
  readonly plannerCandidateId: string | undefined
  readonly plannerReasonCodes: readonly string[] | undefined
  readonly factorsVersion: string
  readonly languageTrace: LanguageTraceAttribution | undefined
  readonly compatibilityObserverProduced: boolean
  readonly publicObserver: PublicObserverSnapshot | undefined
  readonly privateIdentity: PrivateIdentitySnapshot | undefined
  readonly identityEnabled: boolean
  readonly roleObjectiveRouterEnabled: boolean
}

export function composedTrace(input: ComposedTraceInput): DecisionTrace {
  const {
    req,
    view,
    cognition,
    analysis,
    action,
    scores,
    structuredCandidateId,
    chosenCandidateId,
    forced,
    plannerVersion,
    voiceVersion,
    scorerVersion,
    degradation,
    componentPlan,
    decisionComponents,
    decisionLayerRun,
    scoreLayerRun,
    decisionFrame,
    descriptor,
    architectureIdentityDigest,
    communication,
    plannerCandidateId,
    plannerReasonCodes,
    factorsVersion,
    languageTrace,
    compatibilityObserverProduced,
    publicObserver,
    privateIdentity,
    identityEnabled,
    roleObjectiveRouterEnabled,
  } = input
  const baseVersions = projectBaseTraceComponentVersions(
    descriptor,
    decisionComponents,
    {
      belief: cognition.belief.modelVersion,
      factors: factorsVersion,
      scorer: scorerVersion,
      planner: plannerVersion,
      voice: voiceVersion,
      compatibilityObserverProduced,
      ...(descriptor.base.languageEvidence !== 'off'
        ? {
            mechanicalBelief: cognition.versions.mechanicalBelief,
            beliefPipeline: cognition.versions.beliefPipeline,
          }
        : {}),
    },
  )
  const planMemoryEnabled =
    descriptor.configuredPipeline.planCoherence.memory !== 'off'
  const configuredCoherenceIntent =
    descriptor.configuredPipeline.planCoherence.intent
  if (
    planMemoryEnabled
    && !isCoherenceIntent(configuredCoherenceIntent)
  ) {
    throw new Error(
      'architecture descriptor has an invalid coherence intent',
    )
  }
  const traceCoherenceIntent =
    configuredCoherenceIntent as CoherenceIntent
  return {
    ...createDecisionTrace(
      req,
      view,
      cognition.belief,
      analysis,
      action,
      degradation,
    ),
    version: COMPONENT_DECISION_TRACE_VERSION,
    reasonCodes: [
      ...new Set([
        ...analysis.forcedPlayReasonCodes,
        ...forced.reasonCodes,
      ]),
    ],
    architectureIdentityDigest,
    componentVersions: {
      ...baseVersions.prefix,
      ...(identityEnabled
        ? { identityModel: JOINT_IDENTITY_MODEL_VERSION }
        : {}),
      ...(roleObjectiveRouterEnabled
        ? { roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION }
        : {}),
      ...baseVersions.suffix,
    },
    ...(planMemoryEnabled
      ? { coherenceIntent: traceCoherenceIntent }
      : {}),
    componentPlan: structuredClone(componentPlan),
    components: structuredClone(decisionComponents),
    decisionLayerRun: projectLayerRun(decisionLayerRun),
    ...(scoreLayerRun ? { scoreLayerRun: structuredClone(scoreLayerRun) } : {}),
    decisionFrame: structuredClone(decisionFrame),
    candidateScores: scores,
    structuredCandidateId,
    chosenCandidateId,
    ...(plannerCandidateId ? { plannerCandidateId } : {}),
    ...(plannerReasonCodes
      ? { plannerReasonCodes: [...plannerReasonCodes] }
      : {}),
    decisionPlanVersion:
      descriptor.configuredPipeline.planning.decisionPlan,
    forcedPolicyResult: structuredClone(forced),
    ...(communication
      ? { communicationIntent: structuredClone(communication) }
      : {}),
    ...(languageTrace
      ? { languageEvidence: structuredClone(languageTrace) }
      : {}),
    ...(publicObserver
      ? { publicObserver: structuredClone(publicObserver) }
      : {}),
    ...(privateIdentity
      ? { privateIdentity: structuredClone(privateIdentity) }
      : {}),
  }
}
