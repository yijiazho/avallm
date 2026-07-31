// The composition spine. createComposedAgent is the only thing here: it wires
// the configured plugins into one resolved brain and then runs a decision
// through the pipeline in order.
//
// Everything the spine needs but does not itself sequence lives in composed/,
// one module per concern (options, plugin snapshots, planner admission, voice,
// the private per-decision reads, role scope, role features, native
// diagnostics). The split is not about file length: each of those modules owns
// an invariant that reads as an ordering accident when it is inlined as a local
// in decide(), and only this file may import them.
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../engine/types.ts'
import { isDeepStrictEqual } from 'node:util'
import { SITUATION_ANALYSIS_VERSION } from './analysis/situation-types.ts'
import { analyzeSituation } from './analysis/situation.ts'
import {
  combineSituationAnalysisRequirements,
} from './analysis/situation-plan.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
  type PrivateRoleObjectiveSnapshot,
} from './analysis/role-objective-types.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
  type PrivateEvilRoleObjectiveSnapshot,
} from './analysis/evil-objective-types.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateRoleUtilityProjection,
} from './analysis/role-utility.ts'
import {
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateEvilRoleUtilityProjection,
} from './analysis/evil-role-utility.ts'
import {
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateMorganaRoleUtilityProjection,
} from './analysis/morgana-role-utility.ts'
import { exactWorldBeliefModel } from './belief/exact.ts'
import {
  type PrivateIdentitySnapshot,
} from './belief/identity.ts'
import {
  boundedLanguageLikelihoodFactor,
  combinedLanguageFactorBundleVersion,
} from './belief/language-factor.ts'
import { COMPOSED_POLICY_VERSION } from './brain.ts'
import {
  componentPayload,
  decisionComponentPlan,
} from './components/kernel.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from './components/robust-evil-quest-card.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  PRIVATE_BELIEF_INPUT,
  PRIVATE_DETERMINISTIC_SEED_INPUT,
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_IDENTITY_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
  PRIVATE_SITUATION_INPUT,
  SERVANT_OBJECTIVE_COMPONENT,
  SERVANT_ROLE_UTILITY_COMPONENT,
} from './components/native-score-components.ts'
import {
  EVIL_EXPOSURE_READ_COMPONENT,
  PRIVATE_PIN_READ_COMPONENT,
} from './components/native-role-components.ts'
import {
  createProductionComponentRegistry,
} from './components/production-registry.ts'
import {
  revalidatedArchitectureIdentity,
  resolveComposedBrain,
  resolvedArchitectureIdentityDigest,
} from './components/resolved-brain.ts'
import type { CognitionState } from './cognition/types.ts'
import {
  PLAN_MEMORY_VERSION,
  recordAppliedPlan,
  type PrivatePlanMemory,
} from './cognition/plan-memory.ts'
import {
  COHERENCE_MODEL_VERSION,
  isCoherenceIntent,
} from './cognition/coherence.ts'
import { buildCommitments } from './cognition/commitments.ts'
import { extractEvidence } from './cognition/evidence.ts'
import {
  normalizeInterpreterVersion,
} from './communication/language-orchestration.ts'
import {
  COMPOSED_RENDERER_VERSION,
  COMPOSED_PROMPT_VERSION,
  composedPolicyContext,
} from './communication/composed-renderer.ts'
import {
  advanceDecisionCognition,
  lazyPublicObserver,
  projectDecisionIdentity,
} from './composed/decision-cognition.ts'
import {
  nativeScoreDiagnostics,
} from './composed/native-diagnostics.ts'
import {
  resolvePlannerChoice,
} from './composed/planner-admission.ts'
import {
  attributeRoleActionSelection,
} from './composed/policy-use-attribution.ts'
import {
  orderedRoleFeatureComponents,
  type RoleFeatureSetup,
} from './composed/role-features.ts'
import {
  resolveDecisionRoleScope,
  resolveRolePolicyScorer,
  roleScorerFallbackDegradation,
  scorerPayloadBinding,
  type ScorerPayloadBinding,
} from './composed/role-scope.ts'
import {
  scorerRequires,
  scorerVersions,
  snapshotBeliefModel,
  snapshotLanguageFactor,
  snapshotLanguageInterpreter,
  snapshotPlanner,
  snapshotScorer,
  snapshotVoice,
  validComponentVersion,
} from './composed/snapshots.ts'
import { speakCommittedPlan } from './composed/voice.ts'
import { heuristicDecide } from './heuristic.ts'
import {
  candidateIdForDecision,
} from './candidate/candidates.ts'
import {
  attributeCompatibilityRolePolicyUse,
  CompositionInvariantError,
} from './policy/role-adapter-attribution.ts'
import {
  COMMUNICATION_INTENT_VERSION,
  DECISION_PLAN_VERSION,
  type DecisionPlan,
} from './policy/plan.ts'
import {
  defaultCommunicationIntent,
  selectedStrategicReasonCodes,
} from './policy/communication-intent.ts'
import {
  CANDIDATE_SCORER_VERSION,
  isCustomCandidateScorer,
} from './policy/score.ts'
import { executeCustomScores } from './policy/custom-scoring.ts'
import {
  canonicalDecisionFrame,
  commitDecision,
  projectScoredFrameForCompatibility,
  projectVoicedFrameForCompatibility,
  selectDecisionCandidate,
  selectedMechanicalDecision,
  withDecisionAnalysis,
  withDecisionVoice,
  withCustomScoring,
  withLegalCandidates,
  withNativeScoreLayers,
  withNativeScoringAuthority,
  prepareNativeScoreLayers,
  withResolvedDecisionLayers,
  withResolvedComponents,
  withUniversalForcedPolicy,
  type CompatibilityPlannerResolution,
  type PostComponentDecisionFrame,
} from './policy/decision-frame.ts'
import {
  configuredScoreLayerTerminalFor,
  configuredNativeFallbackTerminalFor,
  configuredScoreLayersApplyToDecision,
  createConfiguredScoreLayerRegistry,
} from './role-score-layers/configured.ts'
import {
  createConfiguredDecisionLayerRegistry,
} from './role-decision-layers/configured.ts'
import {
  ROBUST_EVIL_QUEST_CARD_DECISION_DEGRADATION,
  ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
} from './role-decision-layers/robust-evil-quest-card.ts'
import {
  FORCED_POLICY_VERSION,
  LEGAL_CANDIDATE_VERSION,
} from './candidate/types.ts'
import {
  finalizeProvisionalAppliedTrace,
  type DecisionTrace,
} from './trace.ts'
import { composedTrace } from './trace-builder.ts'
import type {
  AgentDecision,
  AppliedDecisionOutcome,
} from './types.ts'
import {
  CANDIDATE_PLANNER_PROTOCOL_VERSION,
  NO_PLANNER_VERSION,
  NO_VOICE_VERSION,
  PLAN_VOICE_PROTOCOL_VERSION,
} from './communication/planner-voice-adapter.ts'
import type {
  ComposedAgentOptions,
  ComposedAvalonAgent,
  ComposedStage,
} from './composed/options.ts'

export type {
  ComposedStage,
  ComposedAgentOptions,
  ComposedAvalonAgent,
} from './composed/options.ts'

/**
 * Opt-in Phase 3 hybrid. It owns strategic state independently of planner,
 * model, persona, and voice identity and never receives a raw Game.
 */
export function createComposedAgent(
  options: ComposedAgentOptions,
): ComposedAvalonAgent {
  const seed = options.seed
  const onDecisionTrace = options.onDecisionTrace
  const onStage = options.onStage
  const pinReadsConfigured = options.pinReads === true
  const publicObserverConfigured = options.publicObserver === true
  const roleObjectivesConfigured = options.roleObjectives === true
  const roleObjectiveRouterConfigured =
    options.roleObjectiveRouter === true
  const servantObjectivesConfigured = options.servantObjectives === true
  const morganaCounterfeitConfigured =
    options.morganaCounterfeitObjectives === true
  let cognition: CognitionState | undefined
  let planner = snapshotPlanner(options.planner)
  let voice = snapshotVoice(options.voice)
  const compatibilityDecision =
    options.compatibilityDecision ?? heuristicDecide
  const configuredScorerSource = options.scorer
  const builtInScoreLayerTerminal = configuredScoreLayerTerminalFor(
    configuredScorerSource,
  )
  if (
    configuredScorerSource
    && !builtInScoreLayerTerminal
    && !isCustomCandidateScorer(configuredScorerSource)
  ) {
    throw new Error(
      'unknown scorer descriptors must provide a custom score function',
    )
  }
  const configuredScoreLayerTerminal =
    builtInScoreLayerTerminal
    ?? configuredNativeFallbackTerminalFor(configuredScorerSource)
  const scorer = snapshotScorer(options.scorer ?? {
    version: CANDIDATE_SCORER_VERSION,
  })
  const configuredScorerChain = scorerVersions(scorer)
  const goodRoleUtilityConfigured = scorerRequires(
    scorer,
    'roleUtilityRequirement',
  )
  const evilRoleUtilityConfigured = scorerRequires(
    scorer,
    'evilRoleUtilityRequirement',
  )
  const morganaRoleUtilityConfigured = scorerRequires(
    scorer,
    'morganaRoleUtilityRequirement',
  )
  const stage = (value: ComposedStage): void => onStage?.(value)
  const beliefModel = snapshotBeliefModel(
    options.beliefModel ?? exactWorldBeliefModel,
  )
  const configuredLanguageInterpreter = snapshotLanguageInterpreter(
    options.languageInterpreter,
  )
  const configuredLanguageVersion =
    configuredLanguageInterpreter?.interpreterVersion
  const languageFactor = snapshotLanguageFactor(
    options.languageFactor ?? boundedLanguageLikelihoodFactor,
  )
  const configuredIdentityScope = options.privateIdentity
    ? structuredClone(options.privateIdentity)
    : undefined
  const planMemoryEnabled = options.planMemory === true
  const evilQuestCardPolicyMode = options.evilQuestCardPolicy
  if (
    evilQuestCardPolicyMode !== undefined
    && evilQuestCardPolicyMode !== 'robust-heterogeneous'
  ) {
    throw new Error('invalid evilQuestCardPolicy mode')
  }
  const configuredEvilQuestCardComponent =
    evilQuestCardPolicyMode === 'robust-heterogeneous'
      ? EVIL_QUEST_CARD_ROBUST_COMPONENT
      : undefined
  const configuredMorganaRoleUtilityComponent =
    morganaRoleUtilityConfigured
      ? scorer.version === MORGANA_ROLE_SEEDED_SCORER_VERSION
        ? MORGANA_ROLE_UTILITY_SEEDED_COMPONENT
        : MORGANA_ROLE_UTILITY_COMPONENT
      : undefined
  const coherenceIntent = options.coherenceIntent ?? 'maintain'
  if (!isCoherenceIntent(coherenceIntent)) {
    throw new Error('coherenceIntent must be maintain, conceal, or deceive')
  }
  if (!planMemoryEnabled && options.coherenceIntent !== undefined) {
    throw new Error('coherenceIntent requires planMemory')
  }
  // The one table that owns every role feature's construction-time fan-out.
  // Rows force the public observer (through the entry scorer's own requirement,
  // which the chain walk can outrun) and contribute components; component order
  // is governed separately by ROLE_FEATURE_COMPONENT_ORDER.
  const roleFeatures: readonly RoleFeatureSetup[] = [
    {
      forcesPublicObserver: publicObserverConfigured,
    },
    {
      forcesPublicObserver: roleObjectivesConfigured,
      forcesGoodObjectiveAllKinds: roleObjectivesConfigured,
      components: roleObjectivesConfigured
        ? [GOOD_ROLE_OBJECTIVE_COMPONENT]
        : [],
    },
    {
      forcesPublicObserver: roleObjectiveRouterConfigured,
      forcesGoodObjectiveAllKinds: roleObjectiveRouterConfigured,
      components: roleObjectiveRouterConfigured
        ? [
            GOOD_ROLE_OBJECTIVE_COMPONENT,
            EVIL_ROLE_OBJECTIVE_COMPONENT,
            ...(evilRoleUtilityConfigured
              ? [EVIL_ROLE_UTILITY_COMPONENT]
              : []),
          ]
        : [],
    },
    {
      // No observer forcing: the servant objective reaches the public record
      // through the acting seat's own view, so it needs nothing hoisted here.
      forcesPublicObserver: false,
      components: servantObjectivesConfigured
        ? [SERVANT_OBJECTIVE_COMPONENT, SERVANT_ROLE_UTILITY_COMPONENT]
        : [],
    },
    {
      forcesPublicObserver: morganaCounterfeitConfigured,
      components: morganaCounterfeitConfigured
        ? [MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT]
        : [],
    },
    {
      forcesPublicObserver: false,
      components: configuredEvilQuestCardComponent
        ? [configuredEvilQuestCardComponent]
        : [],
    },
    {
      forcesPublicObserver: scorer.roleUtilityRequirement !== undefined,
      components: goodRoleUtilityConfigured
        ? [GOOD_ROLE_OBJECTIVE_COMPONENT, GOOD_ROLE_UTILITY_COMPONENT]
        : [],
    },
    {
      // The evil role utility component is requested only alongside the router,
      // so the router row owns it; this row exists for the observer disjunct.
      forcesPublicObserver: scorer.evilRoleUtilityRequirement !== undefined,
    },
    {
      forcesPublicObserver:
        scorer.morganaRoleUtilityRequirement !== undefined,
      components: morganaRoleUtilityConfigured
        ? [
            MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
            ...(configuredMorganaRoleUtilityComponent
              ? [configuredMorganaRoleUtilityComponent]
              : []),
          ]
        : [],
    },
  ]
  const componentRegistry = createProductionComponentRegistry(
    {
      goodObjectiveAllDecisionKinds: roleFeatures.some(
        (feature) => feature.forcesGoodObjectiveAllKinds,
      ),
    },
  )
  // The pin reads are an explicit opt-in (options.pinReads), rendered into the
  // planner's private-planning-only context and carrying no scoring authority.
  // Requested raw (not role-feature ordered), like decisionComponents. Off by
  // default so every existing agent's resolved component set is unchanged.
  const requestedComponents = [
    ...(options.decisionComponents ?? []),
    ...(pinReadsConfigured
      ? [PRIVATE_PIN_READ_COMPONENT, EVIL_EXPOSURE_READ_COMPONENT]
      : []),
    ...orderedRoleFeatureComponents(
      roleFeatures.flatMap((feature) => feature.components ?? []),
    ),
  ]
  const resolvedBrain = resolveComposedBrain({
    requestedComponents,
    hostCapabilities: [],
    ...(configuredScoreLayerTerminal
      ? { scoreLayerTerminal: configuredScoreLayerTerminal }
      : {}),
    decisionLayerOrder:
      evilQuestCardPolicyMode === 'robust-heterogeneous'
        ? [ROBUST_EVIL_QUEST_CARD_DECISION_LAYER]
        : [],
    configuredPipeline: {
      belief: {
        model: beliefModel.version,
        factors: beliefModel.factorsVersion,
        languageInterpreter: configuredLanguageInterpreter
          ? normalizeInterpreterVersion(configuredLanguageVersion)
          : 'off',
        languageFactor: languageFactor.version,
      },
      analysis: {
        situation: SITUATION_ANALYSIS_VERSION,
      },
      candidateGeneration: {
        legalCandidates: LEGAL_CANDIDATE_VERSION,
      },
      forcedPolicy: {
        policy: FORCED_POLICY_VERSION,
      },
      scoring: {
        configuredScorer: scorer.version,
        configuredBaseChain: configuredScorerChain.slice(1),
        invalidOutputFallback: CANDIDATE_SCORER_VERSION,
      },
      planning: {
        protocol: CANDIDATE_PLANNER_PROTOCOL_VERSION,
        decisionPlan: DECISION_PLAN_VERSION,
      },
      prompt: {
        prompt: COMPOSED_PROMPT_VERSION,
        renderer: COMPOSED_RENDERER_VERSION,
      },
      communication: {
        intent: COMMUNICATION_INTENT_VERSION,
        voiceProtocol: PLAN_VOICE_PROTOCOL_VERSION,
      },
      planCoherence: {
        memory: planMemoryEnabled ? PLAN_MEMORY_VERSION : 'off',
        model: planMemoryEnabled ? COHERENCE_MODEL_VERSION : 'off',
        intent: coherenceIntent,
      },
    },
    languageEvidenceEnabled:
      configuredLanguageInterpreter !== undefined,
    publicObserverConfigured: roleFeatures.some(
      (feature) => feature.forcesPublicObserver,
    ),
  }, componentRegistry, createConfiguredScoreLayerRegistry(),
  createConfiguredDecisionLayerRegistry())
  const architectureIdentityDigest = resolvedArchitectureIdentityDigest(
    revalidatedArchitectureIdentity(resolvedBrain.description),
  )
  const configuredComponentPlan = decisionComponentPlan(resolvedBrain)
  const requiredHostInputKeys = new Set(
    resolvedBrain.description.requiredHostInputs.map(
      (input) => `${input.id}@${input.version}`,
    ),
  )
  const requiresHostInput = (
    input: { readonly id: string; readonly version: string },
  ): boolean => requiredHostInputKeys.has(`${input.id}@${input.version}`)
  const pendingPlans: {
    decisionId: string
    request: DecisionRequest
    selectedDecision: Decision
    plan: DecisionPlan
  }[] = []
  let appliedPlanMemory: PrivatePlanMemory | undefined
  let decisionTail: Promise<void> = Promise.resolve()

  return {
    setPlanner(next) {
      planner = snapshotPlanner(next)
    },
    setVoice(next) {
      voice = snapshotVoice(next)
    },
    cognitionCursor() {
      return cognition?.throughSeq
    },
    resolvedBrain() {
      return resolvedBrain
    },
    planMemorySnapshot() {
      return appliedPlanMemory
        ? structuredClone(appliedPlanMemory)
        : undefined
    },
    privateTraceSink(trace) {
      onDecisionTrace?.(trace)
    },
    finalizeAppliedTrace(
      outcome: AppliedDecisionOutcome,
    ): DecisionTrace | undefined {
      // Without plan memory there is nothing to acknowledge, so the shared
      // default finalization is the whole answer.
      if (!planMemoryEnabled) return finalizeProvisionalAppliedTrace(outcome)
      if (outcome.request.seat !== outcome.view.seat) {
        throw new Error('applied outcome view seat does not match request')
      }
      const decisionId = outcome.provisionalTrace?.decisionId
      const matchesAcknowledgment = (
        pending: (typeof pendingPlans)[number],
      ): boolean =>
        isDeepStrictEqual(pending.request, outcome.request)
        && (
          outcome.selectedDecision === undefined
            ? outcome.resolution === 'fallback-after-agent-error'
            : isDeepStrictEqual(
                pending.selectedDecision,
                outcome.selectedDecision,
              )
        )
      let pendingIndex = decisionId === undefined
        ? -1
        : pendingPlans.findIndex(
            (pending) =>
              pending.decisionId === decisionId
              && matchesAcknowledgment(pending),
          )
      if (
        decisionId === undefined
        && outcome.selectedDecision !== undefined
      ) {
        const legacyMatches = pendingPlans
          .map((pending, index) => ({ pending, index }))
          .filter(({ pending }) => matchesAcknowledgment(pending))
        pendingIndex = legacyMatches.length === 1
          ? legacyMatches[0].index
          : -1
      }
      const matchingPending = pendingIndex < 0
        ? undefined
        : pendingPlans[pendingIndex]
      if (
        outcome.resolution !== 'fallback-after-agent-error'
        && !matchingPending
      ) {
        throw new Error('applied outcome does not match the pending selected plan')
      }
      let memory: PrivatePlanMemory
      try {
        memory = recordAppliedPlan({
          memory: appliedPlanMemory,
          req: outcome.request,
          view: outcome.view,
          commitments: buildCommitments(extractEvidence(outcome.view)),
          selectedDecision: outcome.selectedDecision,
          selectedPlan: matchingPending?.plan,
          appliedDecision: outcome.appliedDecision,
          resolution: outcome.resolution,
          intent: coherenceIntent,
        })
      } finally {
        if (pendingIndex >= 0) pendingPlans.splice(pendingIndex, 1)
      }
      appliedPlanMemory = memory
      if (cognition) {
        cognition = {
          ...cognition,
          planMemory: memory,
          versions: {
            ...cognition.versions,
            planMemory: PLAN_MEMORY_VERSION,
            coherence: COHERENCE_MODEL_VERSION,
          },
        }
      }
      if (!outcome.provisionalTrace) return undefined
      // Shallow: the outcome is frozen, every field written below is an own
      // property of this object, and the lifecycle detaches whatever a hook
      // returns. The plan entry stays cloned because that one is not about host
      // mutation: it copies this agent's own long-lived private memory out of
      // reach before a record of it leaves the agent.
      const finalized: DecisionTrace = { ...outcome.provisionalTrace }
      finalized.privatePlanOutcome = structuredClone(memory.history.at(-1)!)
      finalized.componentVersions = {
        ...finalized.componentVersions!,
        planMemory: PLAN_MEMORY_VERSION,
        coherence: COHERENCE_MODEL_VERSION,
      }
      finalized.action = outcome.appliedDecision
      if (outcome.resolution !== 'selected-applied') {
        if (!finalized.degradation.includes('decision-fallback')) {
          finalized.degradation = [
            ...finalized.degradation,
            'decision-fallback',
          ]
        }
      }
      return finalized
    },
    async decide(
      inputRequest: DecisionRequest,
      inputView: PlayerView,
    ): Promise<AgentDecision> {
      const req = structuredClone(inputRequest)
      const view = structuredClone(inputView)
      const invocationPlanner = planner
      const invocationVoice = voice
      const predecessor = decisionTail
      let release!: () => void
      decisionTail = new Promise<void>((resolve) => {
        release = resolve
      })
      await predecessor
      try {
        const degradation: string[] = []
        const activePlanner =
          invocationPlanner && validComponentVersion(invocationPlanner.version)
          ? invocationPlanner
          : undefined
        const activeVoice =
          invocationVoice && validComponentVersion(invocationVoice.version)
          ? invocationVoice
          : undefined
        const plannerVersion =
          activePlanner?.version ?? NO_PLANNER_VERSION
        const voiceVersion = activeVoice?.version ?? NO_VOICE_VERSION
        if (invocationPlanner && !activePlanner) {
          degradation.push('planner-invalid-version')
        }
        if (invocationVoice && !activeVoice) {
          degradation.push('voice-invalid-version')
        }
        const advanced = await advanceDecisionCognition({
          cognition,
          view,
          beliefModel,
          languageFactor,
          interpreter: configuredLanguageInterpreter,
          configuredLanguageVersion,
          onLanguageEvidence: () => stage('language'),
        })
        cognition = advanced.cognition
        const languageTrace = advanced.languageTrace
        degradation.push(...advanced.degradation)
        stage('cognition')
        if (roleObjectiveRouterConfigured) {
          cognition = {
            ...cognition,
            versions: {
              ...cognition.versions,
              roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
            },
          }
        }
        if (planMemoryEnabled && appliedPlanMemory) {
          cognition = {
            ...cognition,
            planMemory: appliedPlanMemory,
            versions: {
              ...cognition.versions,
              planMemory: PLAN_MEMORY_VERSION,
              coherence: COHERENCE_MODEL_VERSION,
            },
          }
        }
        const roleScope = resolveDecisionRoleScope({
          configuredScorer: scorer,
          req,
          view,
          routerConfigured: roleObjectiveRouterConfigured,
          roleObjectivesConfigured,
          morganaCounterfeitConfigured,
          configuredIdentityScope,
        })
        const {
          routedObjective,
          roleObjectiveRole,
          evilRoleObjectiveApplicable,
          morganaCounterfeitApplicable,
        } = roleScope
        const decisionIdentityScope = roleScope.identityScope
        // Component results can still step this down its base chain below.
        let resolvedScorer = roleScope.scorer
        let privateIdentity: PrivateIdentitySnapshot | undefined
        if (decisionIdentityScope) {
          const projected = projectDecisionIdentity(
            cognition,
            decisionIdentityScope,
          )
          cognition = projected.cognition
          privateIdentity = projected.identity
          degradation.push(...projected.degradation)
          // Staged whether or not the projection succeeded: the seat reached
          // the identity phase either way.
          stage('identity')
        }
        // The compatibility, config-driven observer path: a raw publicObserver
        // flag or a custom-scorer role read needs the observer up front, before
        // component resolution. It is unioned below with
        // genericPublicObserverApplicable, the component-driven path that
        // provisions the observer lazily when an admitted component declares the
        // observer host input. The two are not interchangeable: a role objective
        // computed by the compatibility custom-scorer chain has no component to
        // detect, so this eager provide is what puts the observer in its trace.
        const compatibilityPublicObserverApplicable = Boolean(
          publicObserverConfigured
          || roleObjectiveRole
          || evilRoleObjectiveApplicable
          || morganaCounterfeitApplicable
        )
        const observer = lazyPublicObserver(view, () => stage('observer'))
        const providePublicObserver = observer.provide
        if (compatibilityPublicObserverApplicable) {
          providePublicObserver()
        }
        let privateRoleObjective: PrivateRoleObjectiveSnapshot | undefined
        let privateEvilRoleObjective:
          PrivateEvilRoleObjectiveSnapshot | undefined
        let privateRoleUtility: PrivateRoleUtilityProjection | undefined
        let privateEvilRoleUtility:
          PrivateEvilRoleUtilityProjection | undefined
        let privateMorganaRoleUtility:
          PrivateMorganaRoleUtilityProjection | undefined
        const wantsJointProposalAssessments =
          (
            resolvedScorer.analysisRequirement === 'joint-proposal-team-assessments'
            || resolvedScorer.analysisRequirement
              === 'joint-proposal-vote-team-assessments'
          )
          && req.kind === 'propose'
          && view.alignment === 'good'
        const wantsJointVoteAssessments =
          resolvedScorer.analysisRequirement
            === 'joint-proposal-vote-team-assessments'
          && req.kind === 'vote'
          && view.alignment === 'good'
        const canonicalFrame = canonicalDecisionFrame(req, view)
        const candidateFrame = withLegalCandidates(canonicalFrame)
        const nativeScoreLayers =
          resolvedBrain.scoreLayerChain
          && configuredScoreLayersApplyToDecision(req.kind)
          ? prepareNativeScoreLayers(candidateFrame, resolvedBrain)
          : undefined
        stage('candidates')
        const analyzedFrame = withDecisionAnalysis(
          candidateFrame,
          cognition,
          wantsJointVoteAssessments
            ? 'good-vote'
            : wantsJointProposalAssessments
              ? 'good-proposal'
              : nativeScoreLayers
                ? combineSituationAnalysisRequirements(
                    nativeScoreLayers.requirements,
                  )
                : 'candidate-teams',
        )
        const analysis = analyzedFrame.analysis
        stage('analysis')
        const universalFrame = withUniversalForcedPolicy(analyzedFrame)
        const configuredComponentIds = new Set(
          resolvedBrain.description.components.configured.map(
            (component) => component.id,
          ),
        )
        const componentHost = (exactFrame: typeof universalFrame) => ({
            providers: [
              requiresHostInput(PRIVATE_IDENTITY_INPUT)
                ? { input: PRIVATE_IDENTITY_INPUT, provide: () => privateIdentity }
                : undefined,
              requiresHostInput(PRIVATE_PUBLIC_OBSERVER_INPUT)
                ? { input: PRIVATE_PUBLIC_OBSERVER_INPUT, provide: providePublicObserver }
                : undefined,
              requiresHostInput(PRIVATE_BELIEF_INPUT)
                ? { input: PRIVATE_BELIEF_INPUT, provide: () => exactFrame.belief }
                : undefined,
              requiresHostInput(PRIVATE_SITUATION_INPUT)
                ? { input: PRIVATE_SITUATION_INPUT, provide: () => exactFrame.analysis }
                : undefined,
              requiresHostInput(PRIVATE_FORCED_POLICY_INPUT)
                ? { input: PRIVATE_FORCED_POLICY_INPUT, provide: () => exactFrame.universalForced }
                : undefined,
              requiresHostInput(PRIVATE_DETERMINISTIC_SEED_INPUT)
                ? { input: PRIVATE_DETERMINISTIC_SEED_INPUT, provide: () => seed }
                : undefined,
            ].filter((provider) => provider !== undefined),
          })
        const componentFrame = await withResolvedComponents(
          universalFrame,
          resolvedBrain,
          undefined,
          componentHost,
        )
        const resolvedFrame = withResolvedDecisionLayers(
          componentFrame,
          resolvedBrain,
        )
        const postComponentFrame: PostComponentDecisionFrame = resolvedFrame
        const componentRun = resolvedFrame.componentRun
        const genericPublicObserverApplicable =
          componentRun.entries.some(
            (entry) =>
              entry.status === 'admitted'
              && componentRegistry.definition(entry.component)
                ?.requiredHostInputs.some(
                  (input) =>
                    input.id === PRIVATE_PUBLIC_OBSERVER_INPUT.id
                    && input.version
                      === PRIVATE_PUBLIC_OBSERVER_INPUT.version,
                ),
          )
        const tracePublicObserver = (
          compatibilityPublicObserverApplicable
          || genericPublicObserverApplicable
        )
          ? observer.observed()
          : undefined
        /**
         * Every configured payload a scorer may depend on, in the order the
         * scorer's base chain must be walked. The loop below owns the whole
         * fixpoint: a scorer that declared two requirements neither of its
         * components could satisfy steps down twice, once per binding, which is
         * why this stays a sequential pass rather than one combined check.
         */
        const scorerPayloadBindings: readonly ScorerPayloadBinding[] = [
          scorerPayloadBinding(
            GOOD_ROLE_OBJECTIVE_COMPONENT,
            () => false,
            (payload) => { privateRoleObjective = payload },
          ),
          scorerPayloadBinding(
            GOOD_ROLE_UTILITY_COMPONENT,
            () => resolvedScorer.roleUtilityRequirement
              === ROLE_UTILITY_PROJECTION_VERSION,
            (payload) => { privateRoleUtility = payload },
          ),
          scorerPayloadBinding(
            EVIL_ROLE_OBJECTIVE_COMPONENT,
            () => false,
            (payload) => { privateEvilRoleObjective = payload },
          ),
          scorerPayloadBinding(
            EVIL_ROLE_UTILITY_COMPONENT,
            () => resolvedScorer.evilRoleUtilityRequirement
              === EVIL_ROLE_UTILITY_PROJECTION_VERSION,
            (payload) => { privateEvilRoleUtility = payload },
          ),
          ...(configuredMorganaRoleUtilityComponent
            ? [scorerPayloadBinding(
                configuredMorganaRoleUtilityComponent,
                () => resolvedScorer.morganaRoleUtilityRequirement
                  === MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
                (payload) => { privateMorganaRoleUtility = payload },
              )]
            : []),
        ]
        // Each predicate reads the scorer the walk currently stands on, so one
        // unanswered binding can step more than once. It has to:
        // MORGANA_ROLE_SCORER_VERSION declares the Morgana requirement and the
        // evil one together, and the base a step lands on declares the evil one
        // again, so a decision that admitted neither payload would otherwise
        // stop on a scorer whose own requirement is just as unanswered.
        const walkedScorers = new Set([resolvedScorer])
        for (const binding of scorerPayloadBindings) {
          if (!configuredComponentIds.has(binding.component.id)) continue
          if (binding.apply(componentRun)) continue
          while (binding.requiredByScorer() && resolvedScorer.baseScorer) {
            const stepped = resolveRolePolicyScorer({
              configured: resolvedScorer.baseScorer,
              req,
              view,
              routedObjective,
            })
            // Snapshotting preserves whatever chain the caller supplied, so a
            // self-referential one has to terminate here rather than spin.
            if (walkedScorers.has(stepped)) break
            walkedScorers.add(stepped)
            resolvedScorer = stepped
          }
        }
        if (morganaCounterfeitApplicable) {
          stage('morgana-counterfeit')
        }
        if (configuredEvilQuestCardComponent) {
          const robustQuestCardPolicy = componentPayload(
            componentRun,
            configuredEvilQuestCardComponent,
          )
          if (evilQuestCardPolicyMode === 'robust-heterogeneous') {
            const robustJournal = resolvedFrame.decisionLayerRun.journal.find(
              (entry) =>
                entry.layer.id
                  === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.id
                && entry.layer.version
                  === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.version,
            )
            if (robustJournal?.status === 'degraded') {
              degradation.push(
                ROBUST_EVIL_QUEST_CARD_DECISION_DEGRADATION,
              )
            }
            if (robustQuestCardPolicy) stage('quest-card-policy')
          }
        }
        const forced = postComponentFrame.effectiveForced
        stage('forced-policy')
        if (roleObjectiveRole || evilRoleObjectiveApplicable) {
          stage('role-objective')
        }
        if (privateRoleObjective) {
          cognition = {
            ...cognition,
            roleObjective: privateRoleObjective,
            versions: {
              ...cognition.versions,
              roleObjective: ROLE_OBJECTIVE_MODEL_VERSION,
            },
          }
        }
        if (privateEvilRoleObjective) {
          cognition = {
            ...cognition,
            roleObjective: privateEvilRoleObjective,
            versions: {
              ...cognition.versions,
              roleObjective: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
              roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
            },
          }
        }

        const compatibility = compatibilityDecision(req, view, seed)
        const compatibilityCandidateId = candidateIdForDecision(compatibility)
        const fallbackDegradation =
          roleScorerFallbackDegradation(resolvedScorer)
        const nativeScoredFrame =
          nativeScoreLayers
          ? withNativeScoreLayers(
              postComponentFrame,
              nativeScoreLayers,
              {
                deterministicSeed: seed,
                compatibilityCandidateId,
              },
            )
          : undefined
        const scoringBindings = {
          deterministicSeed: seed,
          compatibilityCandidateId,
          ...(privateRoleUtility ? { roleUtility: privateRoleUtility } : {}),
          ...(privateEvilRoleUtility
            ? { evilRoleUtility: privateEvilRoleUtility }
            : {}),
          ...(privateMorganaRoleUtility
            ? { morganaRoleUtility: privateMorganaRoleUtility }
            : {}),
        }
        let customScoredFrame
        if (isCustomCandidateScorer(resolvedScorer)) {
          try {
            customScoredFrame = withCustomScoring(
              postComponentFrame,
              () => scoringBindings,
              (scoringContext, exactRun) => {
                const {
                  appliedScorer,
                  scores,
                  degradation: scorerDegradation,
                } = executeCustomScores(
                  scoringContext,
                  resolvedScorer,
                )
                return {
                  appliedScorer,
                  scores,
                  degradation: [...degradation, ...scorerDegradation],
                  componentRun: attributeCompatibilityRolePolicyUse(
                    exactRun,
                    appliedScorer,
                    scores,
                    configuredMorganaRoleUtilityComponent,
                  ),
                }
              },
            )
          } catch (error) {
            // This catch owns one thing: a custom scorer that returned output
            // this composition cannot use, which degrades to the native scorer.
            // An inconsistency in our own policy-use bookkeeping is not that,
            // and silently spending the scorer-fault budget on it would report
            // the plugin as the culprit and continue on a fallback that fixes
            // nothing. It leaves as itself; the agent boundary above records
            // the message and falls back to the heuristic.
            if (error instanceof CompositionInvariantError) throw error
            degradation.push('scorer-invalid-output')
            if (fallbackDegradation) degradation.push(fallbackDegradation)
          }
        }
        // Computed eagerly, before the custom result is consulted, because the
        // projection can reject an unadmitted diagnostic owner. Deferring it
        // into the fallback branch would let that rejection disappear whenever a
        // custom scorer happened to succeed.
        const nativeDiagnostics = nativeScoredFrame
          ? nativeScoreDiagnostics(
              nativeScoredFrame,
              resolvedBrain.scoreLayerChain!,
              scoringBindings,
            )
          : undefined
        const scoredFrame = customScoredFrame
          ?? (
            nativeScoredFrame
              ? withNativeScoringAuthority(
              nativeScoredFrame,
              scoringBindings,
              { scores: nativeDiagnostics!, degradation },
            )
              : (() => {
                  throw new Error('native scorer fallback was not prepared')
                })()
          )
        const compatibilityScored =
          projectScoredFrameForCompatibility(scoredFrame)
        stage('scoring')

        const context = composedPolicyContext(
          view,
          analysis,
          compatibilityScored.candidates,
          compatibilityScored.forced,
          compatibilityScored.candidateBoundary,
          compatibilityScored.scores,
          compatibilityScored.structuredCandidateId,
          componentPayload(componentRun, PRIVATE_PIN_READ_COMPONENT),
          componentPayload(componentRun, EVIL_EXPOSURE_READ_COMPONENT),
          cognition,
        )
        let plannerResolution: CompatibilityPlannerResolution = { kind: 'not-run' }
        if (
          activePlanner
          && !scoredFrame.candidateBoundary.selectedCandidateId
        ) {
          stage('planner')
          plannerResolution = await resolvePlannerChoice({
            planner: activePlanner,
            context,
            scores: compatibilityScored.scores,
            structuredCandidateId: compatibilityScored.structuredCandidateId,
            view,
          })
        }

        const selectedFrame = selectDecisionCandidate(
          scoredFrame,
          plannerResolution,
          attributeRoleActionSelection,
        )
        const chosenCandidateId = selectedFrame.selected.candidate.id
        const plannerCandidateId = selectedFrame.planner.kind === 'accepted'
          ? selectedFrame.planner.candidateId
          : selectedFrame.planner.kind === 'rejected'
            ? selectedFrame.planner.attemptedCandidateId
            : undefined
        const plannerCommunication =
          selectedFrame.planner.kind === 'accepted'
            ? selectedFrame.planner.communication
            : undefined
        const plannerReasonCodes =
          selectedFrame.planner.kind === 'accepted'
            ? selectedFrame.planner.reasonCodes
            : undefined
        const plannerStrategicIntent =
          selectedFrame.planner.kind === 'accepted'
            ? selectedFrame.planner.strategicIntent
            : undefined
        const chosenScore = compatibilityScored.scores.find(
          (score) => score.candidateId === chosenCandidateId,
        )
        if (!chosenScore) {
          throw new Error('composed policy selected candidate without a score')
        }
        const mechanicalDecision = selectedMechanicalDecision(selectedFrame)
        const communication = defaultCommunicationIntent({
          decision: mechanicalDecision,
          factCodes: analysis.factCodes,
          selectedScore: chosenScore,
          scoreSurface: compatibilityScored.scores,
          direction: plannerCommunication,
          selectedReasons: plannerReasonCodes,
          committedPolicyReasons: scoredFrame.candidateBoundary.reasonCodes,
        })
        const planStrategicReasons = plannerReasonCodes
          ?? selectedStrategicReasonCodes(
            chosenScore,
            compatibilityScored.scores,
          )
        const plan: DecisionPlan = {
          version: DECISION_PLAN_VERSION,
          request: { ...req },
          decision: structuredClone(mechanicalDecision),
          candidateId: chosenCandidateId,
          policyId: COMPOSED_POLICY_VERSION,
          reasons: [
            ...forced.reasonCodes,
            ...scoredFrame.candidateBoundary.reasonCodes,
            ...planStrategicReasons,
          ],
          beliefThroughSeq: cognition.throughSeq,
          candidateScores: compatibilityScored.scores,
          ...(plannerStrategicIntent
            ? { strategicIntent: plannerStrategicIntent }
            : {}),
          ...(communication ? { communication } : {}),
        }
        const committedFrame = commitDecision(selectedFrame, plan)
        stage('plan-committed')

        const spoken = await speakCommittedPlan({
          voice: activeVoice,
          plan,
          view,
          mechanicalDecision,
          onSpeak: () => stage('voice'),
        })
        let action = spoken.action
        const voicedFrame = withDecisionVoice(committedFrame, {
          version: activeVoice?.version ?? NO_VOICE_VERSION,
          result: action,
          ...(spoken.degradationCode
            ? { degradationCode: spoken.degradationCode }
            : {}),
        })
        const compatibilityOutput = projectVoicedFrameForCompatibility(voicedFrame)
        action = compatibilityOutput.action

        const chosenTeamAnalysis = (
          action.kind === 'propose'
          || (action.kind === 'finalize' && !action.stick)
        )
          ? analyzeSituation(view, {
              belief: cognition.belief,
              evidence: cognition.evidence,
              candidateTeams: [action.team],
            })
          : undefined
        const traceAnalysis = chosenTeamAnalysis
          ? {
              ...analysis,
              candidateTeams: chosenTeamAnalysis.candidateTeams,
            }
          : analysis
        const trace = composedTrace({
          req,
          view,
          cognition,
          analysis: traceAnalysis,
          action,
          scores: compatibilityOutput.scores,
          structuredCandidateId: compatibilityOutput.structuredCandidateId,
          chosenCandidateId: compatibilityOutput.selectedCandidateId,
          forced: compatibilityOutput.forced,
          plannerVersion,
          voiceVersion,
          scorerVersion: compatibilityOutput.scorerVersion,
          degradation: compatibilityOutput.degradation,
          componentPlan: configuredComponentPlan,
          decisionComponents: compatibilityOutput.componentRun,
          decisionLayerRun: compatibilityOutput.decisionLayerRun,
          scoreLayerRun: compatibilityOutput.scoreLayerRun,
          decisionFrame: compatibilityOutput.decisionFrame,
          descriptor: resolvedBrain.description,
          architectureIdentityDigest,
          communication: compatibilityOutput.plan.communication,
          plannerCandidateId,
          plannerReasonCodes,
          factorsVersion: configuredLanguageInterpreter
            ? combinedLanguageFactorBundleVersion(
                beliefModel.factorsVersion,
              )
            : beliefModel.factorsVersion,
          languageTrace,
          compatibilityObserverProduced: compatibilityPublicObserverApplicable,
          publicObserver: tracePublicObserver,
          privateIdentity,
          identityEnabled: !!decisionIdentityScope,
          roleObjectiveRouterEnabled: roleObjectiveRouterConfigured,
        })
        if (planMemoryEnabled) {
          if (pendingPlans.length >= 32) {
            throw new Error('pending plan acknowledgment bound exceeded')
          }
          pendingPlans.push({
            decisionId: trace.decisionId,
            request: { ...req },
            selectedDecision: structuredClone(action),
            plan: structuredClone({
              ...plan,
              decision: action,
            }),
          })
        }
        return { decision: action, trace }
      } finally {
        release()
      }
    },
  }
}
