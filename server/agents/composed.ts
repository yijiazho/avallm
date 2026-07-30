import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../engine/types.ts'
import { isDeepStrictEqual } from 'node:util'
import { SITUATION_ANALYSIS_VERSION } from './analysis/types.ts'
import { analyzeSituation } from './analysis/situation.ts'
import {
  combineSituationAnalysisRequirements,
} from './analysis/situation-plan.ts'
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
  mergeIdentityScopes,
  roleObjectiveIdentityScope,
} from './analysis/role-objectives.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
  type PrivateEvilRoleObjectiveSnapshot,
  type RoutedRoleObjectiveModel,
} from './analysis/evil-objective-types.ts'
import {
  routedRoleObjectiveModel,
} from './analysis/role-objective-router.ts'
import {
  MORGANA_COUNTERFEIT_DEGRADATION,
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  type PrivateMorganaCounterfeitObjective,
  type PublicCounterfeitMerlinReadSnapshot,
} from './analysis/morgana-counterfeit-types.ts'
import {
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateRoleUtilityProjection,
} from './analysis/role-utility.ts'
import {
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateEvilRoleUtilityProjection,
} from './analysis/evil-role-utility.ts'
import { onlyAllowedKeys } from './components/canonical-shape.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_SCORER_DEGRADATION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateMorganaRoleUtilityProjection,
} from './analysis/morgana-role-utility.ts'
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
  combinedLanguageFactorBundleVersion,
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  languageBeliefPipelineVersion,
  type LanguageLikelihoodFactor,
} from './belief/language-factor.ts'
import {
  COMPOSED_POLICY_VERSION,
  type AgentExecutionMode,
} from './brain.ts'
import {
  attributeComponentPolicyUse,
  attributeComponentPolicyUseBatch,
  componentPayload,
  decisionComponentPlan,
  type DecisionComponentPlan,
  type DecisionComponentRun,
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
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  PRIVATE_BELIEF_INPUT,
  PRIVATE_DETERMINISTIC_SEED_INPUT,
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_IDENTITY_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
  PRIVATE_SITUATION_INPUT,
} from './components/native-score-components.ts'
import {
  createProductionComponentRegistry,
} from './components/production-registry.ts'
import {
  projectResolvedArchitectureIdentity,
  resolveComposedBrain,
  resolvedArchitectureIdentityDigest,
  type ResolvedComposedBrain,
} from './components/resolved-brain.ts'
import type {
  ComponentRef,
  ComponentToken,
} from './components/types.ts'
import type {
  DecisionLayerRun,
} from './policy/decision-layer/types.ts'
import {
  projectDecisionLayerRun,
} from './policy/decision-layer/projection.ts'
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
  languageInterpreterVersionIdentity,
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
} from './policy/candidates.ts'
import {
  type EvilQuestCardPolicyMode,
} from './policy/evil-quest-card.ts'
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
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  isCustomCandidateScorer,
  type CandidateScore,
  type CandidateScorer,
  type CandidateScoringContext,
} from './policy/score.ts'
import { executeCustomScores } from './policy/custom-scoring.ts'
import {
  canonicalDecisionFrame,
  commitDecision,
  projectScoredFrameForCompatibility,
  projectScoringContext,
  projectVoicedFrameForLegacy,
  selectDecisionCandidate,
  selectedMechanicalDecision,
  withDecisionAnalysis,
  withDecisionVoice,
  withCustomScoring,
  withLegalCandidates,
  withNativeScoreLayers,
  withNativeScoringAuthority,
  prepareNativeScoreLayers,
  nativeDiagnosticOwnerVersion,
  nativeScorerVersion,
  withResolvedDecisionLayers,
  withResolvedComponents,
  withUniversalForcedPolicy,
  type LegacyPlannerResolution,
  type LegacyScoringBindings,
  type LegacyVoicedOutputProjection,
  type NativeScoreLayersResolvedDecisionFrame,
  type PostComponentDecisionFrame,
} from './policy/decision-frame.ts'
import type {
  ResolvedScoreLayerChain,
} from './policy/score-layer/types.ts'
import {
  configuredScoreLayerTerminalFor,
  configuredNativeFallbackTerminalFor,
  configuredScoreLayersApplyToDecision,
  createConfiguredScoreLayerRegistry,
} from './score-layers/configured.ts'
import {
  createConfiguredDecisionLayerRegistry,
} from './decision-layers/configured.ts'
import {
  ROBUST_EVIL_QUEST_CARD_DECISION_DEGRADATION,
  ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
} from './decision-layers/robust-evil-quest-card.ts'
import {
  projectConfiguredScoreDiagnostics,
} from './policy/score-compatibility.ts'
import {
  FORCED_POLICY_VERSION,
  LEGAL_CANDIDATE_VERSION,
  type ForcedPolicyResult,
} from './policy/types.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  createDecisionTrace,
  finalizeProvisionalAppliedTrace,
  projectBaseTraceComponentVersions,
  type DecisionTrace,
} from './trace.ts'
import type {
  AgentDecision,
  AppliedDecisionOutcome,
  AvalonAgent,
} from './types.ts'

export const NO_PLANNER_VERSION = 'planner-off'
export const NO_VOICE_VERSION = 'voice-off'
export const CANDIDATE_PLANNER_PROTOCOL_VERSION =
  'candidate-planner-protocol-v1'
export const PLAN_VOICE_PROTOCOL_VERSION = 'plan-voice-protocol-v1'

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

/** A real LLM adapter implements this bounded contract; tests inject fakes. */
export interface CandidatePlanner {
  version: string
  choose(input: PlannerInput): Promise<PlannerOutput | undefined>
}

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
  | 'morgana-counterfeit'
  | 'quest-card-policy'
  | 'analysis'
  | 'candidates'
  | 'forced-policy'
  | 'scoring'
  | 'planner'
  | 'plan-committed'
  | 'voice'

export interface ComposedAgentOptions {
  seed: string
  /**
   * Generic opt-in component roots. Dependencies are resolved by the
   * production registry; no requested component receives policy authority
   * unless it is also registered in a later policy layer.
   */
  decisionComponents?: readonly ComponentRef[]
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
  /**
   * Explicit opt-in Phase 7D router. It resolves the actual seat role to one
   * objective model but grants no scoring or quest-card policy authority.
   */
  roleObjectiveRouter?: boolean
  /**
   * Opt-in Phase 7E1A Morgana counterfeit-read substrate. It is mechanically
   * inert and resolves only for Morgana proposal and vote decisions.
   */
  morganaCounterfeitObjectives?: boolean
  /** Opt-in heterogeneous-safe private evil quest-card strategy. */
  evilQuestCardPolicy?: EvilQuestCardPolicyMode
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
  /** Immutable construction-time description; per-decision resolution is B2. */
  resolvedBrain(): ResolvedComposedBrain
  /** Detached private snapshot for tests and offline diagnostics. */
  planMemorySnapshot(): PrivatePlanMemory | undefined
}

function snapshotPlanner(
  source: CandidatePlanner | undefined,
): CandidatePlanner | undefined {
  if (!source) return undefined
  const version = source.version
  const choose = source.choose.bind(source)
  const snapshot: CandidatePlanner = {
    version,
    choose(input: PlannerInput) {
      return choose(input)
    },
  }
  return Object.freeze(snapshot)
}

function snapshotVoice(source: PlanVoice | undefined): PlanVoice | undefined {
  if (!source) return undefined
  const version = source.version
  const speak = source.speak.bind(source)
  const snapshot: PlanVoice = {
    version,
    speak(input: VoiceInput) {
      return speak(input)
    },
  }
  return Object.freeze(snapshot)
}

function snapshotBeliefModel(source: BeliefModel): BeliefModel {
  const version = source.version
  const factorsVersion = source.factorsVersion
  const infer = source.infer.bind(source)
  const snapshot: BeliefModel = {
    version,
    factorsVersion,
    infer(view: PlayerView) {
      return infer(view)
    },
  }
  return Object.freeze(snapshot)
}

function snapshotLanguageInterpreter(
  source: LanguageInterpreter | undefined,
): LanguageInterpreter | undefined {
  if (!source) return undefined
  const interpret = source.interpret.bind(source)
  const snapshot: LanguageInterpreter = {
    get interpreterVersion() {
      return source.interpreterVersion
    },
    interpret(input: LanguageInterpreterInput) {
      return interpret(input)
    },
  }
  return Object.freeze(snapshot)
}

function snapshotLanguageFactor(
  source: LanguageLikelihoodFactor,
): LanguageLikelihoodFactor {
  const id = source.id
  const version = source.version
  const logLikelihood = source.logLikelihood.bind(source)
  const snapshot: LanguageLikelihoodFactor = {
    id,
    version,
    logLikelihood(world, evidence) {
      return logLikelihood(world, evidence)
    },
  }
  return Object.freeze(snapshot)
}

function snapshotScorer(
  source: CandidateScorer,
  seen = new Map<CandidateScorer, CandidateScorer>(),
): CandidateScorer {
  const existing = seen.get(source)
  if (existing) return existing
  const score = source.score?.bind(source)
  const snapshot: CandidateScorer = {
    version: source.version,
    ...(source.analysisRequirement
      ? { analysisRequirement: source.analysisRequirement }
      : {}),
    ...(source.roleUtilityRequirement
      ? { roleUtilityRequirement: source.roleUtilityRequirement }
      : {}),
    ...(source.evilRoleUtilityRequirement
      ? { evilRoleUtilityRequirement: source.evilRoleUtilityRequirement }
      : {}),
    ...(source.morganaRoleUtilityRequirement
      ? { morganaRoleUtilityRequirement: source.morganaRoleUtilityRequirement }
      : {}),
    ...(score
      ? {
          score(context: CandidateScoringContext) {
            return score(context)
          },
        }
      : {}),
  }
  seen.set(source, snapshot)
  if (source.baseScorer) {
    snapshot.baseScorer = snapshotScorer(source.baseScorer, seen)
  }
  return Object.freeze(snapshot)
}

function scorerVersions(source: CandidateScorer): readonly string[] {
  const versions: string[] = []
  const seen = new Set<CandidateScorer>()
  let current: CandidateScorer | undefined = source
  while (current && !seen.has(current)) {
    seen.add(current)
    versions.push(current.version)
    current = current.baseScorer
  }
  return Object.freeze(versions)
}

function scorerRequires(
  source: CandidateScorer,
  requirement:
    | 'roleUtilityRequirement'
    | 'evilRoleUtilityRequirement'
    | 'morganaRoleUtilityRequirement',
): boolean {
  const seen = new Set<CandidateScorer>()
  let current: CandidateScorer | undefined = source
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current[requirement] !== undefined) return true
    current = current.baseScorer
  }
  return false
}

function attributeLegacyRolePolicyUse(
  run: DecisionComponentRun,
  appliedScorer: CandidateScorer,
  scores: readonly CandidateScore[],
  morganaRoleUtilityComponent:
    typeof MORGANA_ROLE_UTILITY_COMPONENT | undefined,
): DecisionComponentRun {
  const goodUsed =
    appliedScorer.roleUtilityRequirement
      === ROLE_UTILITY_PROJECTION_VERSION
    && scores.every((score) => score.roleObjectiveFeatures !== undefined)
  const evilUsed =
    appliedScorer.evilRoleUtilityRequirement
      === EVIL_ROLE_UTILITY_PROJECTION_VERSION
    && scores.every((score) =>
      score.evilRoleObjectiveFeatures !== undefined
      || (
        (
          appliedScorer.morganaRoleUtilityRequirement
            === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
        )
        && score.morganaRoleObjectiveFeatures !== undefined
      ))
  const morganaUsed =
    appliedScorer.morganaRoleUtilityRequirement
      === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    && scores.every(
      (score) => score.morganaRoleObjectiveFeatures !== undefined,
    )
  let attributed = run
  if (goodUsed) {
    attributed = attributeComponentPolicyUse(
      attributed,
      GOOD_ROLE_OBJECTIVE_COMPONENT,
      'candidate-score',
    )
    attributed = attributeComponentPolicyUse(
      attributed,
      GOOD_ROLE_UTILITY_COMPONENT,
      'candidate-score',
    )
  }
  if (evilUsed) {
    attributed = attributeComponentPolicyUse(
      attributed,
      EVIL_ROLE_OBJECTIVE_COMPONENT,
      'candidate-score',
    )
    attributed = attributeComponentPolicyUse(
      attributed,
      EVIL_ROLE_UTILITY_COMPONENT,
      'candidate-score',
    )
  }
  if (morganaUsed) {
    attributed = attributeComponentPolicyUse(
      attributed,
      MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
      'candidate-score',
    )
    attributed = attributeComponentPolicyUse(
      attributed,
      MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
      'candidate-score',
    )
    attributed = attributeComponentPolicyUse(
      attributed,
      morganaRoleUtilityComponent!,
      'candidate-score',
    )
  }
  const used = new Map(
    attributed.policyUse.map((entry) => [entry.component.id, entry.used]),
  )
  if (
    (
      used.has(GOOD_ROLE_OBJECTIVE_COMPONENT.id)
      && used.get(GOOD_ROLE_OBJECTIVE_COMPONENT.id) !== goodUsed
    )
    || (
      used.has(GOOD_ROLE_UTILITY_COMPONENT.id)
      && used.get(GOOD_ROLE_UTILITY_COMPONENT.id) !== goodUsed
    )
    || (
      used.has(EVIL_ROLE_OBJECTIVE_COMPONENT.id)
      && used.get(EVIL_ROLE_OBJECTIVE_COMPONENT.id) !== evilUsed
    )
    || (
      used.has(EVIL_ROLE_UTILITY_COMPONENT.id)
      && used.get(EVIL_ROLE_UTILITY_COMPONENT.id) !== evilUsed
    )
    || (
      used.has(MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id)
      && used.get(MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id)
        !== morganaUsed
    )
    || [MORGANA_ROLE_UTILITY_COMPONENT, MORGANA_ROLE_UTILITY_SEEDED_COMPONENT]
      .some((token) =>
        used.has(token.id) && used.get(token.id) !== morganaUsed)
  ) {
    throw new Error('generic adapter causal policy-use mismatch')
  }
  return attributed
}

function attributeRoleActionSelection(
  run: DecisionComponentRun,
): DecisionComponentRun {
  const selected = new Set(
    run.policyUse
      .filter((entry) =>
        entry.used && entry.stages.includes('candidate-score'))
      .map((entry) =>
        `${entry.component.id}@${entry.component.version}`),
  )
  const tokens = run.entries.flatMap((entry) =>
    entry.status === 'admitted'
    && selected.has(`${entry.component.id}@${entry.component.version}`)
      ? [{
          ...entry.component,
          kind: entry.kind,
          privacy: entry.privacy,
        }]
      : [])
  return attributeComponentPolicyUseBatch(
    run,
    tokens,
    'action-selection',
  ).run
}

function validComponentVersion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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
    && onlyAllowedKeys(value, [
      'version',
      'channel',
      'targetSeats',
      'claimCodes',
      'tone',
    ])
    && value.version === COMMUNICATION_INTENT_VERSION
    && value.channel === expectedChannel
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
interface ComposedTraceInput {
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
  readonly scoreLayerRun: LegacyVoicedOutputProjection['scoreLayerRun']
  readonly decisionFrame: LegacyVoicedOutputProjection['decisionFrame']
  readonly descriptor: ResolvedComposedBrain['description']
  readonly architectureIdentityDigest: string
  readonly agentMode: AgentExecutionMode
  readonly communication: DecisionPlan['communication']
  readonly plannerCandidateId: string | undefined
  readonly plannerReasonCodes: readonly string[] | undefined
  readonly factorsVersion: string
  readonly languageTrace: LanguageTraceAttribution | undefined
  readonly legacyObserverProduced: boolean
  readonly publicObserver: PublicObserverSnapshot | undefined
  readonly privateIdentity: PrivateIdentitySnapshot | undefined
  readonly identityEnabled: boolean
  readonly roleObjectiveRouterEnabled: boolean
}

function composedTrace(input: ComposedTraceInput): DecisionTrace {
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
    agentMode,
    communication,
    plannerCandidateId,
    plannerReasonCodes,
    factorsVersion,
    languageTrace,
    legacyObserverProduced,
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
      legacyObserverProduced,
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
    && !['maintain', 'conceal', 'deceive'].includes(
      configuredCoherenceIntent,
    )
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
    agentMode,
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
    decisionLayerRun: projectDecisionLayerRun(decisionLayerRun),
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

/**
 * Speak the committed plan, when a voice is configured and the plan has anything
 * to say.
 *
 * Voice can decorate the committed action but never replace it, so every path
 * here returns the mechanical decision with at most speech attached, and each
 * failure names itself. The caller feeds the result through withDecisionVoice(),
 * which independently rejects a result that altered the committed mechanics, so
 * this function is the polite half of that contract rather than its enforcement.
 */
async function speakCommittedPlan(input: {
  voice: PlanVoice | undefined
  plan: DecisionPlan
  mechanicalDecision: Decision
  onSpeak: () => void
}): Promise<Readonly<{ action: Decision; degradationCode?: string }>> {
  const { voice, plan, mechanicalDecision } = input
  if (!voice || !plan.communication) {
    return { action: structuredClone(mechanicalDecision) }
  }
  input.onSpeak()
  try {
    const voicePlan = committedVoicePlan(plan)
    const output = await voice.speak({
      plan: structuredClone(voicePlan),
      renderedPlan: renderCommittedVoicePlan(voicePlan),
    })
    return output
      ? { action: withVoice(plan.decision, output) }
      : {
          action: structuredClone(mechanicalDecision),
          degradationCode: 'voice-no-output',
        }
  } catch {
    // Rebuilt from the plan's own copy rather than returning whatever the failed
    // attempt left behind, so a voice that throws midway cannot leak a partially
    // decorated action.
    return {
      action: structuredClone(plan.decision),
      degradationCode: 'voice-failed',
    }
  }
}

/**
 * The degradation code to record if this scorer fails, or undefined when it is
 * not a role scorer and has no role-specific code.
 *
 * This replaces a pair of overlapping version lists: one asked whether the
 * scorer was any of six role versions, the other mapped those versions to a
 * code with a bare `else` for the rest. They agreed only because the second was
 * read exclusively when the first was true, so adding a role family to one and
 * not the other would have silently attributed its failure to the good-side
 * code. One lookup cannot drift from itself.
 */
function roleScorerFallbackDegradation(
  scorer: CandidateScorer,
): string | undefined {
  switch (scorer.version) {
    case MORGANA_ROLE_SCORER_VERSION:
    case MORGANA_ROLE_SEEDED_SCORER_VERSION:
      return MORGANA_ROLE_SCORER_DEGRADATION
    case EVIL_ROLE_OBJECTIVE_SCORER_VERSION:
    case EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION:
      return 'evil-role-objective-scorer-failed'
    case ROLE_OBJECTIVE_SCORER_VERSION:
    case ROLE_OBJECTIVE_SEEDED_SCORER_VERSION:
      return 'role-objective-scorer-failed'
    default:
      return undefined
  }
}

/**
 * The additive per-candidate diagnostics the native score surface attaches.
 *
 * Every mechanical field still comes from the native layers; this only supplies
 * the private feature rows, and `withNativeScoringAuthority` rejects a
 * projection that tries to restate value, viability, or reason codes. The three
 * intermediate versions the projection needs are derived here rather than at the
 * call site because none of them outlives this computation.
 */
function nativeScoreDiagnostics(
  frame: NativeScoreLayersResolvedDecisionFrame,
  chain: ResolvedScoreLayerChain,
  bindings: LegacyScoringBindings,
): readonly CandidateScore[] {
  return projectConfiguredScoreDiagnostics(
    projectScoringContext(frame, bindings),
    frame.scores,
    nativeScorerVersion(frame),
    frame.scoreLayerRun.configured.map((layer) => layer.version),
    nativeDiagnosticOwnerVersion(frame, chain),
  )
}

/**
 * Project the acting seat's private identity posterior for one decision.
 *
 * Returns the cognition state to continue from instead of mutating one. A failed
 * projection has to leave cognition exactly as it was, carrying only a
 * degradation code, and that invariant is easy to misread when the success path
 * assigns a shared local from inside a try block.
 */
function projectDecisionIdentity(
  cognition: CognitionState,
  scope: IdentityProjectionScope,
): Readonly<{
  cognition: CognitionState
  identity?: PrivateIdentitySnapshot
  degradation: readonly string[]
}> {
  try {
    const identity = projectJointIdentity(cognition.belief, scope)
    return {
      cognition: {
        ...cognition,
        identity,
        versions: {
          ...cognition.versions,
          identityModel: JOINT_IDENTITY_MODEL_VERSION,
        },
      },
      identity,
      degradation: [],
    }
  } catch {
    return { cognition, degradation: ['identity-projection-failed'] }
  }
}

/**
 * The seat's public-observer projection, observed at most once and only when
 * something actually asks for it.
 *
 * Laziness is not an optimization here. Whether this seat observed the public
 * record at all is private evidence that the trace reports, and `onFirstUse`
 * marks the moment it became true, so the observation and the signal that it
 * happened have to stay welded together. Component host inputs pull `provide`
 * on demand, which is why the memo cannot be replaced by an eager value.
 */
function lazyPublicObserver(
  view: PlayerView,
  onFirstUse: () => void,
): Readonly<{
  provide: () => PublicObserverSnapshot
  observed: () => PublicObserverSnapshot | undefined
}> {
  let snapshot: PublicObserverSnapshot | undefined
  return {
    provide(): PublicObserverSnapshot {
      if (!snapshot) {
        snapshot = observePublicRecord(projectPublicRecord(view))
        onFirstUse()
      }
      return snapshot
    },
    observed: () => snapshot,
  }
}

/**
 * Offer the scored candidate set to the planner and admit at most one bounded
 * choice from it.
 *
 * Every failure is a typed rejection rather than a throw, including a planner
 * that throws, because planning is optional strategy layered over a decision the
 * frame can already make: selection falls back to the structured choice and the
 * decision still happens. The admission rules are narrow by design. A planner may
 * name only a candidate that scored viable, may cite only reasons its own score
 * supports, and loses invalid communication on its own without losing the
 * candidate, so a planner cannot widen the candidate set or reopen the mechanical
 * action it was handed.
 */
async function resolvePlannerChoice(input: {
  planner: CandidatePlanner
  context: ComposedPolicyContext
  scores: readonly CandidateScore[]
  structuredCandidateId: string
  view: PlayerView
}): Promise<LegacyPlannerResolution> {
  const { context, scores, structuredCandidateId, view } = input
  // The catch deliberately spans the clone and the validators, not just
  // choose(). A planner that returns something structuredClone rejects, or a
  // malformed output that trips a validator, is the same optional-strategy
  // failure as one that throws outright, and must degrade rather than end the
  // decision.
  try {
    const supplied = await input.planner.choose({
      context: structuredClone(context),
      renderedContext: renderComposedPolicyContext(context),
      structuredCandidateId,
    })
    const planned = supplied === undefined
      ? undefined
      : structuredClone(supplied)
    if (!planned) {
      return { kind: 'rejected', degradationCode: 'planner-no-choice' }
    }
    const plannedScore = scores.find(
      (score) => score.candidateId === planned.candidateId,
    )
    const plannedCandidate = context.viableCandidates.find(
      (candidate) => candidate.id === planned.candidateId,
    )
    if (!plannedCandidate || !plannedScore) {
      return {
        kind: 'rejected',
        degradationCode: 'planner-invalid-candidate',
        attemptedCandidateId: planned.candidateId,
      }
    }
    if (!validPlannerReasons(
      planned.reasonCodes,
      plannedScore,
      scores,
      structuredCandidateId,
    )) {
      return {
        kind: 'rejected',
        degradationCode: 'planner-invalid-reason',
        attemptedCandidateId: planned.candidateId,
      }
    }
    const communication = planned.communication !== undefined
      && validPlannerCommunication(
        planned.communication,
        plannedCandidate.decision,
        view,
      )
      ? structuredClone(planned.communication)
      : undefined
    return {
      kind: 'accepted',
      candidateId: planned.candidateId,
      ...(planned.reasonCodes === undefined
        ? {}
        : { reasonCodes: [...planned.reasonCodes] }),
      ...(communication ? { communication } : {}),
      ...(planned.communication !== undefined && !communication
        ? { degradationCode: 'planner-invalid-communication' }
        : {}),
    }
  } catch {
    return { kind: 'rejected', degradationCode: 'planner-failed' }
  }
}

/**
 * Advance typed cognition for one decision, through bounded language evidence
 * when an interpreter is configured and mechanically otherwise.
 *
 * Both arms end in the same place, a cognition state whose belief is the one
 * every later phase reads, which is why they belong in one owner rather than as
 * a branch in the middle of decide(). Only the language arm can degrade or
 * produce interpreter attribution, so those are optional in the result instead
 * of being threaded back as mutable locals.
 */
async function advanceDecisionCognition(input: {
  cognition: CognitionState | undefined
  view: PlayerView
  beliefModel: BeliefModel
  languageFactor: LanguageLikelihoodFactor
  interpreter: LanguageInterpreter | undefined
  configuredLanguageVersion: string | undefined
  onLanguageEvidence: () => void
}): Promise<Readonly<{
  cognition: CognitionState
  languageTrace?: LanguageTraceAttribution
  degradation: readonly string[]
}>> {
  const { cognition, view, beliefModel, interpreter } = input
  if (!interpreter) {
    return {
      cognition: advanceCognition(cognition, view, beliefModel),
      degradation: [],
    }
  }
  const interpret = interpreter.interpret.bind(interpreter)
  const language = await orchestrateLanguageEvidence(
    view,
    cognition,
    {
      interpreterVersion: interpreter.interpreterVersion,
      interpret(request: LanguageInterpreterInput) {
        return interpret(request)
      },
    },
    input.configuredLanguageVersion,
  )
  input.onLanguageEvidence()
  const mechanicalBelief = beliefModel.infer(view)
  if (mechanicalBelief.modelVersion !== beliefModel.version) {
    throw new Error(
      `belief model ${beliefModel.version} returned snapshot ${mechanicalBelief.modelVersion}`,
    )
  }
  const resolvedBelief = language.applyEvidence && language.inferenceContext
    ? applyBoundedLanguageEvidence(
        view,
        mechanicalBelief,
        language.inferenceContext,
        { evidence: language.reads, cursor: language.cursor },
        input.languageFactor,
      )
    : mechanicalBelief
  return {
    cognition: advanceCognitionFromBelief(cognition, view, {
      belief: resolvedBelief,
      mechanicalBelief: beliefModel.version,
      beliefPipeline: languageBeliefPipelineVersion(beliefModel.version),
      languageEvidence: language.trace.interpreterVersion,
      languageReads: language.reads,
      languageCursor: language.cursor,
    }),
    languageTrace: language.trace,
    degradation: language.degradation,
  }
}

/**
 * What the configured scorer and the acting seat imply for one decision.
 *
 * These eight values were derived inline in decide() and then read from a dozen
 * places further down. Resolving them together makes their dependency order
 * legible, which is not obvious from the reads: the role objective depends on
 * the resolved scorer's declared requirements, and the identity scope depends in
 * turn on the role objective. `scorer` is the entry scorer only. Component
 * results can still step it down its base chain, so decide() keeps that as a
 * mutable local rather than reading it back from here.
 */
interface DecisionRoleScope {
  readonly routedObjective: RoutedRoleObjectiveModel
  readonly scorer: CandidateScorer
  readonly roleObjectiveRole: RoleObjectiveRole | undefined
  readonly evilRoleObjectiveApplicable: boolean
  readonly morganaCounterfeitApplicable: boolean
  readonly identityScope: IdentityProjectionScope | undefined
}

function resolveDecisionRoleScope(input: {
  configuredScorer: CandidateScorer
  req: DecisionRequest
  view: PlayerView
  routerConfigured: boolean
  roleObjectivesConfigured: boolean
  morganaCounterfeitConfigured: boolean
  configuredIdentityScope: IdentityProjectionScope | undefined
}): DecisionRoleScope {
  const { req, view, configuredIdentityScope } = input
  const routedObjective = input.routerConfigured
    ? routedRoleObjectiveModel(view.role)
    : 'off'
  const scorer = resolveRolePolicyScorer({
    configured: input.configuredScorer,
    req,
    view,
    routedObjective,
  })
  const roleUtilityApplicable =
    scorer.roleUtilityRequirement === ROLE_UTILITY_PROJECTION_VERSION
  const evilRoleObjectiveApplicable =
    routedObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  const roleObjectiveRole: RoleObjectiveRole | undefined =
    (input.roleObjectivesConfigured || roleUtilityApplicable)
    && (view.role === 'merlin' || view.role === 'percival')
      ? view.role
      : routedObjective === ROLE_OBJECTIVE_MODEL_VERSION
        ? view.role as RoleObjectiveRole
        : undefined
  return {
    routedObjective,
    scorer,
    roleObjectiveRole,
    evilRoleObjectiveApplicable,
    morganaCounterfeitApplicable:
      (
        input.morganaCounterfeitConfigured
        || scorer.morganaRoleUtilityRequirement
          === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      )
      && view.role === 'morgana'
      && (req.kind === 'propose' || req.kind === 'vote'),
    identityScope: roleObjectiveRole
      ? mergeIdentityScopes(
          configuredIdentityScope,
          roleObjectiveIdentityScope(roleObjectiveRole, view.rolesInPlay),
        )
      : evilRoleObjectiveApplicable
        ? mergeIdentityScopes(
            configuredIdentityScope,
            { roleQueries: [], hiddenTeam: true },
          )
        : configuredIdentityScope,
  }
}

/**
 * One configured component whose admitted payload a scorer may depend on.
 *
 * `apply` captures the component's payload type in a closure so a decision can
 * hold bindings for unrelated roles in one list, and reports whether the
 * payload arrived. `requiredByScorer` is a thunk because the answer differs per
 * requirement: the good and evil requirements are read from the scorer that
 * entered the decision, while the Morgana requirement is read live, after any
 * earlier binding has already stepped the scorer down its base chain.
 */
interface ScorerPayloadBinding {
  readonly component: ComponentRef
  readonly requiredByScorer: () => boolean
  readonly apply: (run: DecisionComponentRun) => boolean
}

function scorerPayloadBinding<Payload>(
  component: ComponentToken<Payload>,
  requiredByScorer: () => boolean,
  assign: (payload: Payload | undefined) => void,
): ScorerPayloadBinding {
  return {
    component,
    requiredByScorer,
    apply(run: DecisionComponentRun): boolean {
      const payload = componentPayload(run, component)
      assign(payload)
      // Truthiness, not a defined check: every consumer of these payloads
      // tests them the same way, so a defined-but-falsy payload has to count
      // as absent here too or the scorer keeps a requirement it cannot read.
      return Boolean(payload)
    },
  }
}

function resolveRolePolicyScorer(input: {
  configured: CandidateScorer
  req: DecisionRequest
  view: PlayerView
  routedObjective: RoutedRoleObjectiveModel
}): CandidateScorer {
  let current = input.configured
  const visited = new Set<CandidateScorer>()
  while (true) {
    if (visited.has(current)) {
      throw new Error('candidate scorer fallback chain contains a cycle')
    }
    visited.add(current)
    const roleApplicable =
      current.roleUtilityRequirement === ROLE_UTILITY_PROJECTION_VERSION
      && (input.req.kind === 'propose' || input.req.kind === 'vote')
      && (input.view.role === 'merlin' || input.view.role === 'percival')
    const evilApplicable =
      current.evilRoleUtilityRequirement
        === EVIL_ROLE_UTILITY_PROJECTION_VERSION
      && (input.req.kind === 'propose' || input.req.kind === 'vote')
      && input.routedObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    const morganaApplicable =
      current.morganaRoleUtilityRequirement
        === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      && evilApplicable
      && input.view.role === 'morgana'
    if (
      (current.roleUtilityRequirement && !roleApplicable)
      || (current.evilRoleUtilityRequirement && !evilApplicable)
      || (current.morganaRoleUtilityRequirement && !morganaApplicable)
    ) {
      if (!current.baseScorer) return current
      current = current.baseScorer
      continue
    }
    return current
  }
}

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
  const publicObserverConfigured = options.publicObserver === true
  const roleObjectivesConfigured = options.roleObjectives === true
  const roleObjectiveRouterConfigured =
    options.roleObjectiveRouter === true
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
  if (!['maintain', 'conceal', 'deceive'].includes(coherenceIntent)) {
    throw new Error('coherenceIntent must be maintain, conceal, or deceive')
  }
  if (!planMemoryEnabled && options.coherenceIntent !== undefined) {
    throw new Error('coherenceIntent requires planMemory')
  }
  const componentRegistry = createProductionComponentRegistry(
    {
      goodObjectiveAllDecisionKinds:
        roleObjectivesConfigured || roleObjectiveRouterConfigured,
    },
  )
  const requestedComponents = [
    ...(options.decisionComponents ?? []),
    ...(
      roleObjectivesConfigured
      || roleObjectiveRouterConfigured
      || goodRoleUtilityConfigured
        ? [GOOD_ROLE_OBJECTIVE_COMPONENT]
        : []
    ),
    ...(goodRoleUtilityConfigured ? [GOOD_ROLE_UTILITY_COMPONENT] : []),
    ...(roleObjectiveRouterConfigured
      ? [EVIL_ROLE_OBJECTIVE_COMPONENT]
      : []),
    ...(
      roleObjectiveRouterConfigured && evilRoleUtilityConfigured
        ? [EVIL_ROLE_UTILITY_COMPONENT]
        : []
    ),
    ...(
      morganaCounterfeitConfigured || morganaRoleUtilityConfigured
        ? [MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT]
        : []
    ),
    ...(configuredMorganaRoleUtilityComponent
      ? [configuredMorganaRoleUtilityComponent]
      : []),
    ...(configuredEvilQuestCardComponent
      ? [configuredEvilQuestCardComponent]
      : []),
  ]
  const resolvedBrain = resolveComposedBrain({
    requestedComponents,
    hostCapabilities: [],
    ...(configuredScoreLayerTerminal
      ? { scoreLayerTerminal: configuredScoreLayerTerminal }
      : { scoreLayerOrder: [] }),
    decisionLayerOrder:
      evilQuestCardPolicyMode === 'robust-heterogeneous'
        ? [ROBUST_EVIL_QUEST_CARD_DECISION_LAYER]
        : [],
    executionMode: planner
      ? 'hybrid'
      : scorer.version === CANDIDATE_SCORER_VERSION
        ? 'compatibility'
        : 'structured-only',
    configuredPipeline: {
      belief: {
        model: beliefModel.version,
        factors: beliefModel.factorsVersion,
        languageInterpreter: configuredLanguageInterpreter
          ? languageInterpreterVersionIdentity(configuredLanguageVersion)
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
    publicObserverConfigured:
      publicObserverConfigured
      || roleObjectivesConfigured
      || roleObjectiveRouterConfigured
      || morganaCounterfeitConfigured
      || scorer.roleUtilityRequirement !== undefined
      || scorer.evilRoleUtilityRequirement !== undefined
      || scorer.morganaRoleUtilityRequirement !== undefined,
    compatibility: {
      requests: {
        publicObserver: publicObserverConfigured,
        privateIdentity: configuredIdentityScope
          ? {
              roleQueries: configuredIdentityScope.roleQueries.map((query) =>
                typeof query === 'string'
                  ? query
                  : { roles: [...query.roles] }),
              hiddenTeam: configuredIdentityScope.hiddenTeam,
            }
          : null,
        roleObjectives: roleObjectivesConfigured,
        roleObjectiveRouter: roleObjectiveRouterConfigured,
        morganaCounterfeitObjectives: morganaCounterfeitConfigured,
        evilQuestCardPolicy: evilQuestCardPolicyMode ?? null,
      },
    },
  }, componentRegistry, createConfiguredScoreLayerRegistry(),
  createConfiguredDecisionLayerRegistry())
  const architectureIdentityDigest = resolvedArchitectureIdentityDigest(
    projectResolvedArchitectureIdentity(resolvedBrain.description),
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
        const legacyPublicObserverApplicable = Boolean(
          publicObserverConfigured
          || roleObjectiveRole
          || evilRoleObjectiveApplicable
          || morganaCounterfeitApplicable
        )
        const observer = lazyPublicObserver(view, () => stage('observer'))
        const providePublicObserver = observer.provide
        if (legacyPublicObserverApplicable) {
          providePublicObserver()
        }
        let privateRoleObjective: PrivateRoleObjectiveSnapshot | undefined
        let privateEvilRoleObjective:
          PrivateEvilRoleObjectiveSnapshot | undefined
        let privateRoleUtility: PrivateRoleUtilityProjection | undefined
        let privateEvilRoleUtility:
          PrivateEvilRoleUtilityProjection | undefined
        let publicMorganaCounterfeitRead:
          PublicCounterfeitMerlinReadSnapshot | undefined
        let privateMorganaCounterfeitObjective:
          PrivateMorganaCounterfeitObjective | undefined
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
        const candidates = analyzedFrame.legalCandidates
        stage('analysis')
        const universalFrame = withUniversalForcedPolicy(analyzedFrame)
        const universalForced = universalFrame.universalForced
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
          legacyPublicObserverApplicable
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
        const genericPublicMorganaRead = componentPayload(
          componentRun,
          MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
        )
        if (morganaCounterfeitApplicable) {
          publicMorganaCounterfeitRead = genericPublicMorganaRead
          privateMorganaCounterfeitObjective = componentPayload(
            componentRun,
            MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
          )
          if (!privateMorganaCounterfeitObjective) {
            publicMorganaCounterfeitRead = undefined
          }
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
            evilRoleObjective: privateEvilRoleObjective,
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
                  componentRun: attributeLegacyRolePolicyUse(
                    exactRun,
                    appliedScorer,
                    scores,
                    configuredMorganaRoleUtilityComponent,
                  ),
                }
              },
            )
          } catch {
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
        )
        let plannerResolution: LegacyPlannerResolution = { kind: 'not-run' }
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
          ...(communication ? { communication } : {}),
        }
        const committedFrame = commitDecision(selectedFrame, plan)
        stage('plan-committed')

        const spoken = await speakCommittedPlan({
          voice: activeVoice,
          plan,
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
        const legacyOutput = projectVoicedFrameForLegacy(voicedFrame)
        action = legacyOutput.action

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
          scores: legacyOutput.scores,
          structuredCandidateId: legacyOutput.structuredCandidateId,
          chosenCandidateId: legacyOutput.selectedCandidateId,
          forced: legacyOutput.forced,
          plannerVersion,
          voiceVersion,
          scorerVersion: legacyOutput.scorerVersion,
          degradation: legacyOutput.degradation,
          componentPlan: configuredComponentPlan,
          decisionComponents: legacyOutput.componentRun,
          decisionLayerRun: legacyOutput.decisionLayerRun,
          scoreLayerRun: legacyOutput.scoreLayerRun,
          decisionFrame: legacyOutput.decisionFrame,
          descriptor: resolvedBrain.description,
          architectureIdentityDigest,
          agentMode: activePlanner
            ? 'hybrid'
            : legacyOutput.scorerVersion === CANDIDATE_SCORER_VERSION
              ? 'compatibility'
              : 'structured-only',
          communication: legacyOutput.plan.communication,
          plannerCandidateId,
          plannerReasonCodes,
          factorsVersion: configuredLanguageInterpreter
            ? combinedLanguageFactorBundleVersion(
                beliefModel.factorsVersion,
              )
            : beliefModel.factorsVersion,
          languageTrace,
          legacyObserverProduced: legacyPublicObserverApplicable,
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
