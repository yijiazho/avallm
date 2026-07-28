import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../engine/types.ts'
import { isDeepStrictEqual } from 'node:util'
import { SITUATION_ANALYSIS_VERSION } from './analysis/types.ts'
import { analyzeSituation } from './analysis/situation.ts'
import { observePublicRecord } from './analysis/observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicObserverSnapshot,
} from './analysis/observer-types.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
  type PrivateRoleObjectiveSnapshot,
  type RoleObjectiveRole,
} from './analysis/role-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
  mergeIdentityScopes,
  roleObjectiveIdentityScope,
} from './analysis/role-objectives.ts'
import { exactWorldBeliefModel } from './belief/exact.ts'
import type { BeliefModel } from './belief/types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  projectJointIdentity,
  type IdentityProjectionScope,
  type PrivateIdentitySnapshot,
} from './belief/identity.ts'
import {
  applyBoundedLanguageEvidence,
  boundedLanguageLikelihoodFactor,
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  type LanguageLikelihoodFactor,
} from './belief/language-factor.ts'
import {
  brainComponents,
  COMPOSED_POLICY_VERSION,
  resolveBrain,
  type AgentExecutionMode,
} from './brain.ts'
import {
  advanceCognition,
  advanceCognitionFromBelief,
} from './cognition/state.ts'
import type { CognitionState } from './cognition/types.ts'
import {
  PLAN_MEMORY_VERSION,
  recordAppliedPlan,
  type PrivatePlanMemory,
} from './cognition/plan-memory.ts'
import {
  COHERENCE_MODEL_VERSION,
  type CoherenceIntent,
} from './cognition/coherence.ts'
import { buildCommitments } from './cognition/commitments.ts'
import { extractEvidence } from './cognition/evidence.ts'
import {
  orchestrateLanguageEvidence,
  type LanguageTraceAttribution,
} from './communication/language-orchestration.ts'
import type {
  LanguageInterpreter,
  LanguageInterpreterInput,
} from './communication/language-types.ts'
import { projectPublicRecord } from './communication/public-record.ts'
import {
  COMPOSED_RENDERER_VERSION,
  COMPOSED_PROMPT_VERSION,
  composedPolicyContext,
  renderCommittedVoicePlan,
  renderComposedPolicyContext,
  type ComposedPolicyContext,
} from './communication/composed-renderer.ts'
import { heuristicDecide } from './heuristic.ts'
import {
  candidateIdForDecision,
  candidateTeams,
  hypotheticalProposalCandidates,
  legalCandidates,
} from './policy/candidates.ts'
import { applyForcedPolicy } from './policy/forced.ts'
import {
  COMMUNICATION_CLAIM_CODES,
  COMMUNICATION_INTENT_VERSION,
  DECISION_PLAN_VERSION,
  defaultCommunicationIntent,
  plannerOverrideReasonCodes,
  selectedStrategicReasonCodes,
  voiceUncertainty,
  type CommittedVoicePlan,
  type DecisionPlan,
  type PlannerCommunicationDirection,
} from './policy/plan.ts'
import {
  CANDIDATE_SCORER_VERSION,
  scoreCandidates,
  structuredChoice,
  validateCandidateScores,
  type CandidateScore,
  type CandidateScorer,
  type CandidateScoringContext,
} from './policy/score.ts'
import {
  FORCED_POLICY_VERSION,
  LEGAL_CANDIDATE_VERSION,
  type ForcedPolicyResult,
  type PolicyCandidate,
} from './policy/types.ts'
import { createDecisionTrace, type DecisionTrace } from './trace.ts'
import type {
  AgentDecision,
  AppliedDecisionOutcome,
  AvalonAgent,
} from './types.ts'

export const NO_PLANNER_VERSION = 'planner-off'
export const NO_VOICE_VERSION = 'voice-off'

export interface PlannerInput {
  context: ComposedPolicyContext
  renderedContext: string
  structuredCandidateId: string
}

export interface PlannerOutput {
  candidateId: string
  reasonCodes?: readonly string[]
  communication?: PlannerCommunicationDirection
}

export interface CandidatePlanner {
  version: string
  choose(input: PlannerInput): Promise<PlannerOutput | undefined>
}

/** A real LLM adapter implements this bounded contract; tests inject fakes. */
export type LlmCandidatePlanner = CandidatePlanner

export interface VoiceInput {
  plan: CommittedVoicePlan
  renderedPlan: string
}

export interface VoiceOutput {
  text?: string
  thinking?: string
}

export interface PlanVoice {
  version: string
  speak(input: VoiceInput): Promise<VoiceOutput | undefined>
}

export type ComposedStage =
  | 'language'
  | 'cognition'
  | 'identity'
  | 'observer'
  | 'role-objective'
  | 'analysis'
  | 'candidates'
  | 'forced-policy'
  | 'scoring'
  | 'planner'
  | 'plan-committed'
  | 'voice'

export interface ComposedAgentOptions {
  seed: string
  beliefModel?: BeliefModel
  /** Opt-in public-language interpretation. Never configured by the registry. */
  languageInterpreter?: LanguageInterpreter
  /** API-free factor injection for contract and failure testing. */
  languageFactor?: LanguageLikelihoodFactor
  planner?: CandidatePlanner
  voice?: PlanVoice
  onDecisionTrace?: (trace: DecisionTrace) => void
  onStage?: (stage: ComposedStage) => void
  scorer?: CandidateScorer
  /** Opt-in exact public observer. It cannot influence Phase 7A policy. */
  publicObserver?: boolean
  /**
   * Opt-in private joint identity projection. It consumes the resolved belief
   * and remains mechanically inert in Phase 7B1.
   */
  privateIdentity?: IdentityProjectionScope
  /**
   * Opt-in Phase 7C substrate. It activates only for actual Merlin/Percival
   * seats and remains mechanically inert until a later policy phase.
   */
  roleObjectives?: boolean
  /** Opt-in Phase 7B2 private selected/applied plan memory. */
  planMemory?: boolean
  /** Literal conflict classification intent. Defaults to maintain when enabled. */
  coherenceIntent?: CoherenceIntent
  /** Compatibility policy used by the intentionally basic Phase 3 scorer. */
  compatibilityDecision?: (
    req: DecisionRequest,
    view: PlayerView,
    seed: string,
  ) => Decision
}

export interface ComposedAvalonAgent extends AvalonAgent {
  setPlanner(planner: CandidatePlanner | undefined): void
  setVoice(voice: PlanVoice | undefined): void
  cognitionCursor(): number | undefined
  /** Detached private snapshot for tests and offline diagnostics. */
  planMemorySnapshot(): PrivatePlanMemory | undefined
}

function byId(
  candidates: readonly PolicyCandidate[],
  candidateId: string,
): PolicyCandidate {
  const candidate = candidates.find((entry) => entry.id === candidateId)
  if (!candidate) throw new Error(`composed policy selected absent candidate ${candidateId}`)
  return candidate
}

function validComponentVersion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function exactKeys(
  value: object,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function silenceMechanicalCommunication(decision: Decision): Decision {
  const copy = structuredClone(decision)
  if (copy.kind === 'discuss') copy.say = ''
  if (copy.kind === 'propose') delete copy.pitch
  if (copy.kind === 'finalize' && !copy.stick) delete copy.reason
  return copy
}

function validPlannerCommunication(
  value: PlannerCommunicationDirection | undefined,
  decision: Decision,
  view: PlayerView,
): value is PlannerCommunicationDirection {
  const expectedChannel =
    decision.kind === 'discuss' ? 'discussion'
      : decision.kind === 'propose' ? 'proposal-pitch'
        : decision.kind === 'finalize' && !decision.stick
          ? 'revision-reason'
          : undefined
  const claimCodes = new Set<string>(COMMUNICATION_CLAIM_CODES)
  const claimsByChannel: Record<
    NonNullable<typeof expectedChannel>,
    ReadonlySet<string>
  > = {
    discussion: new Set([
      'STATE_COMMITTED_LEAN',
      'ADVOCATE_SELECTED_ACTION',
      'ACKNOWLEDGE_UNCERTAINTY',
    ]),
    'proposal-pitch': new Set([
      'EXPLAIN_COMMITTED_TEAM',
      'ADVOCATE_SELECTED_ACTION',
      'ACKNOWLEDGE_UNCERTAINTY',
    ]),
    'revision-reason': new Set([
      'EXPLAIN_COMMITTED_REVISION',
      'ADVOCATE_SELECTED_ACTION',
      'ACKNOWLEDGE_UNCERTAINTY',
    ]),
  }
  return (
    expectedChannel !== undefined
    &&
    !!value
    && exactKeys(value, [
      'version',
      'channel',
      'desiredLean',
      'targetSeats',
      'claimCodes',
      'tone',
    ])
    && value.version === COMMUNICATION_INTENT_VERSION
    && value.channel === expectedChannel
    && (
      decision.kind !== 'discuss'
      || value.desiredLean === undefined
      || value.desiredLean === decision.lean
    )
    && (decision.kind === 'discuss' || value.desiredLean === undefined)
    && Array.isArray(value.targetSeats)
    && new Set(value.targetSeats).size === value.targetSeats.length
    && value.targetSeats.every(
      (seat) => Number.isInteger(seat)
        && view.players.some((player) => player.seat === seat),
    )
    && Array.isArray(value.claimCodes)
    && new Set(value.claimCodes).size === value.claimCodes.length
    && value.claimCodes.every(
      (code) =>
        typeof code === 'string'
        && claimCodes.has(code)
        && claimsByChannel[expectedChannel].has(code),
    )
    && value.tone === 'natural'
  )
}

function validPlannerReasons(
  reasons: readonly string[] | undefined,
  chosenScore: CandidateScore,
  scores: readonly CandidateScore[],
  structuredCandidateId: string,
): reasons is readonly string[] {
  if (reasons === undefined) {
    return chosenScore.candidateId === structuredCandidateId
  }
  const permitted = chosenScore.candidateId === structuredCandidateId
    ? selectedStrategicReasonCodes(chosenScore, scores)
    : plannerOverrideReasonCodes(chosenScore, scores)
  if (
    !Array.isArray(reasons)
    || new Set(reasons).size !== reasons.length
    || reasons.some(
      (code) =>
        typeof code !== 'string'
        || !permitted.includes(code),
    )
  ) {
    return false
  }
  return chosenScore.candidateId === structuredCandidateId || reasons.length > 0
}

function withVoice(decision: Decision, output: VoiceOutput | undefined): Decision {
  const voiced = structuredClone(decision)
  const text = output?.text?.trim()
  if (voiced.kind === 'discuss') voiced.say = text ?? ''
  else if (voiced.kind === 'propose' && text) voiced.pitch = text
  else if (voiced.kind === 'finalize' && !voiced.stick && text) voiced.reason = text
  if (output?.thinking?.trim()) voiced.thinking = output.thinking.trim()
  return voiced
}

function committedVoicePlan(
  plan: DecisionPlan,
): CommittedVoicePlan {
  const communication = plan.communication
    ? (() => {
        const {
          conceal: _conceal,
          uncertainty,
          ...publicIntent
        } = plan.communication
        return structuredClone({
          ...publicIntent,
          strategicReasonCodes: publicIntent.strategicReasonCodes.filter(
            (reason) => reason !== 'GOOD_PROPOSAL_CANONICAL_TIE_BREAK',
          ),
          ...(uncertainty
            ? { uncertainty: voiceUncertainty(uncertainty) }
            : {}),
        })
      })()
    : undefined
  return {
    version: plan.version,
    decision: structuredClone(plan.decision),
    candidateId: plan.candidateId,
    ...(communication ? { communication } : {}),
  }
}

function composedTrace(
  req: DecisionRequest,
  view: PlayerView,
  cognition: CognitionState,
  analysis: ReturnType<typeof analyzeSituation>,
  action: Decision,
  scores: readonly CandidateScore[],
  structuredCandidateId: string,
  chosenCandidateId: string,
  forced: ForcedPolicyResult,
  plannerVersion: string,
  voiceVersion: string,
  scorerVersion: string,
  degradation: readonly string[],
  agentMode: AgentExecutionMode,
  communication: DecisionPlan['communication'],
  plannerCandidateId?: string,
  plannerReasonCodes?: readonly string[],
  factorsVersion = 'off',
  languageTrace?: LanguageTraceAttribution,
  languageEnabled = false,
  publicObserver?: PublicObserverSnapshot,
  privateIdentity?: PrivateIdentitySnapshot,
  identityEnabled = false,
  privateRoleObjective?: PrivateRoleObjectiveSnapshot,
  roleObjectiveEnabled = false,
  planMemoryEnabled = false,
  coherenceIntent: CoherenceIntent = 'maintain',
): DecisionTrace {
  const brain = brainComponents(resolveBrain({
    type: 'composed',
    ...(languageEnabled
      ? { languageEvidence: LANGUAGE_FACTOR_BUNDLE_VERSION }
      : {}),
    ...(publicObserver
      ? { observerModel: PUBLIC_OBSERVER_MODEL_VERSION }
      : {}),
  }))
  return {
    ...createDecisionTrace(
      req,
      view,
      cognition.belief,
      analysis,
      action,
      degradation,
    ),
    agentMode,
    componentVersions: {
      brain: brain.brain,
      belief: cognition.belief.modelVersion,
      ...(languageEnabled
        ? {
            mechanicalBelief: cognition.versions.mechanicalBelief,
            beliefPipeline: cognition.versions.beliefPipeline,
          }
        : {}),
      beliefVisibility: brain.beliefVisibility,
      factors: factorsVersion,
      languageEvidence: brain.languageEvidence,
      observerModel: brain.observerModel,
      ...(identityEnabled
        ? { identityModel: JOINT_IDENTITY_MODEL_VERSION }
        : {}),
      ...(roleObjectiveEnabled
        ? { roleObjective: ROLE_OBJECTIVE_MODEL_VERSION }
        : {}),
      ...(planMemoryEnabled
        ? {
            planMemory: PLAN_MEMORY_VERSION,
            coherence: COHERENCE_MODEL_VERSION,
          }
        : {}),
      analysis: SITUATION_ANALYSIS_VERSION,
      candidates: LEGAL_CANDIDATE_VERSION,
      forcedPolicy: FORCED_POLICY_VERSION,
      policy: brain.policy,
      scorer: scorerVersion,
      planner: plannerVersion,
      prompt: COMPOSED_PROMPT_VERSION,
      renderer: COMPOSED_RENDERER_VERSION,
      communication: brain.communication,
      voice: voiceVersion,
    },
    ...(planMemoryEnabled ? { coherenceIntent } : {}),
    candidateScores: scores,
    structuredCandidateId,
    chosenCandidateId,
    ...(plannerCandidateId ? { plannerCandidateId } : {}),
    ...(plannerReasonCodes
      ? { plannerReasonCodes: [...plannerReasonCodes] }
      : {}),
    decisionPlanVersion: DECISION_PLAN_VERSION,
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
    ...(privateRoleObjective
      ? { privateRoleObjective: structuredClone(privateRoleObjective) }
      : {}),
  }
}

function combinedFactorBundle(mechanical: string): string {
  return mechanical === 'off'
    ? LANGUAGE_FACTOR_BUNDLE_VERSION
    : `${mechanical}+${LANGUAGE_FACTOR_BUNDLE_VERSION}`
}

/**
 * Opt-in Phase 3 hybrid. It owns strategic state independently of planner,
 * model, persona, and voice identity and never receives a raw Game.
 */
export function createComposedAgent(
  options: ComposedAgentOptions,
): ComposedAvalonAgent {
  let cognition: CognitionState | undefined
  let planner = options.planner
  let voice = options.voice
  const compatibilityDecision =
    options.compatibilityDecision ?? heuristicDecide
  const scorer: CandidateScorer = options.scorer ?? {
    version: CANDIDATE_SCORER_VERSION,
    score: scoreCandidates,
  }
  const stage = (value: ComposedStage): void => options.onStage?.(value)
  const beliefModel = options.beliefModel ?? exactWorldBeliefModel
  const configuredLanguageInterpreter = options.languageInterpreter
  const configuredLanguageVersion =
    configuredLanguageInterpreter?.interpreterVersion
  const configuredIdentityScope = options.privateIdentity
    ? structuredClone(options.privateIdentity)
    : undefined
  const planMemoryEnabled = options.planMemory === true
  const coherenceIntent = options.coherenceIntent ?? 'maintain'
  if (!['maintain', 'conceal', 'deceive'].includes(coherenceIntent)) {
    throw new Error('coherenceIntent must be maintain, conceal, or deceive')
  }
  if (!planMemoryEnabled && options.coherenceIntent !== undefined) {
    throw new Error('coherenceIntent requires planMemory')
  }
  let pendingPlan: {
    request: DecisionRequest
    selectedDecision: Decision
    plan: DecisionPlan
  } | undefined
  let appliedPlanMemory: PrivatePlanMemory | undefined

  return {
    setPlanner(next) {
      planner = next
    },
    setVoice(next) {
      voice = next
    },
    cognitionCursor() {
      return cognition?.throughSeq
    },
    planMemorySnapshot() {
      return appliedPlanMemory
        ? structuredClone(appliedPlanMemory)
        : undefined
    },
    recordDecisionTrace(trace) {
      options.onDecisionTrace?.(trace)
    },
    recordAppliedDecisionOutcome(
      outcome: AppliedDecisionOutcome,
    ): DecisionTrace | undefined {
      if (!planMemoryEnabled) {
        if (!outcome.provisionalTrace) return undefined
        const finalized = structuredClone(outcome.provisionalTrace)
        finalized.action = structuredClone(outcome.appliedDecision)
        if (
          outcome.resolution !== 'selected-applied'
          && !finalized.degradation.includes('decision-fallback')
        ) {
          finalized.degradation = [
            ...finalized.degradation,
            'decision-fallback',
          ]
        }
        return finalized
      }
      if (outcome.request.seat !== outcome.view.seat) {
        throw new Error('applied outcome view seat does not match request')
      }
      const matchingPending = pendingPlan
        && isDeepStrictEqual(pendingPlan.request, outcome.request)
        && outcome.selectedDecision !== undefined
        && isDeepStrictEqual(
          pendingPlan.selectedDecision,
          outcome.selectedDecision,
        )
        ? pendingPlan
        : undefined
      if (
        outcome.resolution !== 'fallback-after-agent-error'
        && !matchingPending
      ) {
        pendingPlan = undefined
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
        pendingPlan = undefined
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
      const finalized = structuredClone(outcome.provisionalTrace)
      finalized.privatePlanOutcome = structuredClone(memory.history.at(-1)!)
      finalized.componentVersions = {
        ...finalized.componentVersions!,
        planMemory: PLAN_MEMORY_VERSION,
        coherence: COHERENCE_MODEL_VERSION,
      }
      finalized.action = structuredClone(outcome.appliedDecision)
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
      req: DecisionRequest,
      view: PlayerView,
    ): Promise<AgentDecision> {
      const degradation: string[] = []
      const activePlanner = planner && validComponentVersion(planner.version)
        ? planner
        : undefined
      const activeVoice = voice && validComponentVersion(voice.version)
        ? voice
        : undefined
      const plannerVersion =
        activePlanner?.version ?? NO_PLANNER_VERSION
      const voiceVersion = activeVoice?.version ?? NO_VOICE_VERSION
      if (planner && !activePlanner) degradation.push('planner-invalid-version')
      if (voice && !activeVoice) degradation.push('voice-invalid-version')
      const interpreter = configuredLanguageInterpreter
      let languageTrace: LanguageTraceAttribution | undefined
      if (interpreter) {
        const interpreterVersion = interpreter.interpreterVersion
        const interpret = interpreter.interpret.bind(interpreter)
        const interpreterSnapshot: LanguageInterpreter = {
          interpreterVersion,
          interpret(input: LanguageInterpreterInput) {
            return interpret(input)
          },
        }
        const language = await orchestrateLanguageEvidence(
          view,
          cognition,
          interpreterSnapshot,
          configuredLanguageVersion,
        )
        stage('language')
        degradation.push(...language.degradation)

        const mechanicalBelief = beliefModel.infer(view)
        if (mechanicalBelief.modelVersion !== beliefModel.version) {
          throw new Error(
            `belief model ${beliefModel.version} returned snapshot ${mechanicalBelief.modelVersion}`,
          )
        }
        const resolvedBelief = language.applyEvidence
          && language.inferenceContext
          ? applyBoundedLanguageEvidence(
              view,
              mechanicalBelief,
              language.inferenceContext,
              {
                evidence: language.reads,
                cursor: language.cursor,
              },
              options.languageFactor ?? boundedLanguageLikelihoodFactor,
            )
          : mechanicalBelief
        const nextCognition = advanceCognitionFromBelief(
          cognition,
          view,
          {
            belief: resolvedBelief,
            mechanicalBelief: beliefModel.version,
            beliefPipeline:
              `${beliefModel.version}+${LANGUAGE_FACTOR_BUNDLE_VERSION}`,
            languageEvidence: language.trace.interpreterVersion,
            languageReads: language.reads,
            languageCursor: language.cursor,
          },
        )
        cognition = nextCognition
        languageTrace = language.trace
      } else {
        cognition = advanceCognition(cognition, view, beliefModel)
      }
      stage('cognition')
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
      const roleObjectiveRole: RoleObjectiveRole | undefined =
        options.roleObjectives === true
        && (view.role === 'merlin' || view.role === 'percival')
          ? view.role
          : undefined
      const decisionIdentityScope = roleObjectiveRole
        ? mergeIdentityScopes(
            configuredIdentityScope,
            roleObjectiveIdentityScope(roleObjectiveRole, view.rolesInPlay),
          )
        : configuredIdentityScope
      let privateIdentity: PrivateIdentitySnapshot | undefined
      if (decisionIdentityScope) {
        try {
          privateIdentity = projectJointIdentity(
            cognition.belief,
            decisionIdentityScope,
          )
          cognition = {
            ...cognition,
            identity: privateIdentity,
            versions: {
              ...cognition.versions,
              identityModel: JOINT_IDENTITY_MODEL_VERSION,
            },
          }
        } catch {
          degradation.push('identity-projection-failed')
        }
        stage('identity')
      }
      const publicObserver = (options.publicObserver || roleObjectiveRole)
        ? observePublicRecord(projectPublicRecord(view))
        : undefined
      if (publicObserver) stage('observer')
      let analysis = analyzeSituation(view, {
        belief: cognition.belief,
        evidence: cognition.evidence,
      })
      stage('analysis')
      const candidates = legalCandidates(req, view)
      stage('candidates')
      let privateRoleObjective: PrivateRoleObjectiveSnapshot | undefined
      if (roleObjectiveRole) {
        try {
          if (!privateIdentity || !publicObserver) {
            throw new Error('role objective dependencies unavailable')
          }
          privateRoleObjective = buildRoleObjectiveSnapshot({
            req,
            view,
            identity: privateIdentity,
            observer: publicObserver,
            candidates,
          })
          cognition = {
            ...cognition,
            roleObjective: privateRoleObjective,
            versions: {
              ...cognition.versions,
              roleObjective: ROLE_OBJECTIVE_MODEL_VERSION,
            },
          }
        } catch {
          degradation.push(ROLE_OBJECTIVE_DEGRADATION)
        }
        stage('role-objective')
      }
      const policyTeams = candidateTeams(candidates, view)
      const wantsJointProposalAssessments =
        (
          scorer.analysisRequirement === 'joint-proposal-team-assessments'
          || scorer.analysisRequirement
            === 'joint-proposal-vote-team-assessments'
        )
        && req.kind === 'propose'
        && view.alignment === 'good'
      const wantsJointVoteAssessments =
        scorer.analysisRequirement
          === 'joint-proposal-vote-team-assessments'
        && req.kind === 'vote'
        && view.alignment === 'good'
      const hypotheticalTeamCandidates = wantsJointVoteAssessments
        ? hypotheticalProposalCandidates(view)
        : undefined
      const hypotheticalTeams = hypotheticalTeamCandidates
        ? candidateTeams(hypotheticalTeamCandidates, view)
        : undefined
      analysis = analyzeSituation(view, {
        belief: cognition.belief,
        evidence: cognition.evidence,
        policyCandidateTeams: policyTeams,
        ...(wantsJointProposalAssessments
          ? { policyCandidateAssessments: policyTeams }
          : {}),
        ...(hypotheticalTeams
          ? {
              policyCandidateAssessments: hypotheticalTeams,
              goodVote: true,
            }
          : {}),
      })
      const forced = applyForcedPolicy(req, view, analysis, candidates)
      stage('forced-policy')

      const compatibility = compatibilityDecision(req, view, options.seed)
      const compatibilityCandidateId = candidateIdForDecision(compatibility)
      const scoringContext = {
        deterministicSeed: options.seed,
        request: req,
        view,
        analysis,
        candidates,
        ...(hypotheticalTeamCandidates
          ? { hypotheticalTeamCandidates }
          : {}),
        forced,
        compatibilityCandidateId,
      }
      let scorerVersion = scorer.version
      let scores: readonly CandidateScore[]
      try {
        const suppliedScores = scorer.score(structuredClone(scoringContext))
        validateCandidateScores(scoringContext, suppliedScores, scorerVersion)
        scores = structuredClone(suppliedScores)
      } catch {
        degradation.push('scorer-invalid-output')
        scorerVersion = CANDIDATE_SCORER_VERSION
        scores = scoreCandidates(scoringContext)
        validateCandidateScores(
          scoringContext,
          scores,
          CANDIDATE_SCORER_VERSION,
        )
      }
      const structured = forced.selectedCandidateId
        ? scores.find((score) => score.candidateId === forced.selectedCandidateId)
        : structuredChoice(scores)
      if (!structured || !structured.viable) {
        throw new Error('forced policy selected a non-viable candidate')
      }
      stage('scoring')

      const context = composedPolicyContext(
        view,
        analysis,
        candidates,
        forced,
        scores,
        structured.candidateId,
      )
      const viableIds = new Set(
        context.viableCandidates.map((candidate) => candidate.id),
      )
      let chosenCandidateId = structured.candidateId
      let plannerCandidateId: string | undefined
      let plannerCommunication: PlannerCommunicationDirection | undefined
      let plannerReasonCodes: readonly string[] | undefined
      if (activePlanner && !forced.selectedCandidateId) {
        stage('planner')
        try {
          const suppliedPlan = await activePlanner.choose({
            context: structuredClone(context),
            renderedContext: renderComposedPolicyContext(context),
            structuredCandidateId: structured.candidateId,
          })
          const planned = suppliedPlan === undefined
            ? undefined
            : structuredClone(suppliedPlan)
          if (!planned) {
            degradation.push('planner-no-choice')
          } else {
            plannerCandidateId = planned.candidateId
            const plannedScore = scores.find(
              (score) => score.candidateId === planned.candidateId,
            )
            if (!viableIds.has(planned.candidateId) || !plannedScore) {
              degradation.push('planner-invalid-candidate')
            } else if (!validPlannerReasons(
              planned.reasonCodes,
              plannedScore,
              scores,
              structured.candidateId,
            )) {
              degradation.push('planner-invalid-reason')
            } else {
              chosenCandidateId = planned.candidateId
              plannerReasonCodes = planned.reasonCodes === undefined
                ? undefined
                : [...planned.reasonCodes]
              if (planned.communication !== undefined) {
                if (validPlannerCommunication(
                  planned.communication,
                  byId(candidates, planned.candidateId).decision,
                  view,
                )) {
                  plannerCommunication = structuredClone(
                    planned.communication,
                  )
                } else {
                  degradation.push('planner-invalid-communication')
                }
              }
            }
          }
        } catch {
          degradation.push('planner-failed')
        }
      }

      const candidate = byId(candidates, chosenCandidateId)
      const chosenScore = scores.find(
        (score) => score.candidateId === chosenCandidateId,
      )
      if (!chosenScore) {
        throw new Error('composed policy selected candidate without a score')
      }
      const mechanicalDecision = silenceMechanicalCommunication(candidate.decision)
      const communication = defaultCommunicationIntent(
        mechanicalDecision,
        analysis.factCodes,
        chosenScore,
        scores,
        plannerCommunication,
        plannerReasonCodes,
      )
      const planStrategicReasons = plannerReasonCodes
        ?? selectedStrategicReasonCodes(chosenScore, scores)
      const plan: DecisionPlan = {
        version: DECISION_PLAN_VERSION,
        request: { ...req },
        decision: structuredClone(mechanicalDecision),
        candidateId: chosenCandidateId,
        policyId: COMPOSED_POLICY_VERSION,
        reasons: [
          ...forced.reasonCodes,
          ...planStrategicReasons,
        ],
        beliefThroughSeq: cognition.throughSeq,
        candidateScores: scores,
        ...(communication ? { communication } : {}),
      }
      stage('plan-committed')

      let action = structuredClone(plan.decision)
      if (activeVoice && plan.communication) {
        stage('voice')
        try {
          const voicePlan = committedVoicePlan(plan)
          const output = await activeVoice.speak({
            plan: structuredClone(voicePlan),
            renderedPlan: renderCommittedVoicePlan(voicePlan),
          })
          if (!output) {
            degradation.push('voice-no-output')
          } else {
            action = withVoice(plan.decision, output)
          }
        } catch {
          degradation.push('voice-failed')
          action = structuredClone(plan.decision)
        }
      }

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
      const trace = composedTrace(
        req,
        view,
        cognition,
        traceAnalysis,
        action,
        scores,
        structured.candidateId,
        chosenCandidateId,
        forced,
        plannerVersion,
        voiceVersion,
        scorerVersion,
        degradation,
        activePlanner
          ? 'hybrid'
          : scorerVersion === CANDIDATE_SCORER_VERSION
            ? 'compatibility'
            : 'structured-only',
        plan.communication,
        plannerCandidateId,
        plannerReasonCodes,
        interpreter
          ? combinedFactorBundle(beliefModel.factorsVersion)
          : beliefModel.factorsVersion,
        languageTrace,
        !!interpreter,
        publicObserver,
        privateIdentity,
        !!decisionIdentityScope,
        privateRoleObjective,
        !!roleObjectiveRole,
        planMemoryEnabled,
        coherenceIntent,
      )
      if (planMemoryEnabled) {
        pendingPlan = {
          request: { ...req },
          selectedDecision: structuredClone(action),
          plan: structuredClone({
            ...plan,
            decision: action,
          }),
        }
      }
      return { decision: action, trace }
    },
  }
}
