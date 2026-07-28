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
  DECISION_COMPONENT_RUN_VERSION,
  attributeComponentPolicyUse,
  componentPayload,
  decisionComponentPlan,
  runDecisionComponents,
  type DecisionComponentPlan,
  type DecisionComponentRun,
} from './components/kernel.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT,
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
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
  createLegacyRoleAdapterRegistry,
} from './components/legacy-role-adapters.ts'
import {
  resolveComposedBrain,
  type ResolvedComposedBrain,
} from './components/resolved-brain.ts'
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
  EVIL_QUEST_CARD_POLICY_DEGRADATION,
  EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  EVIL_QUEST_ROBUST_POLICY_VERSION,
  type EvilQuestCardPolicyMode,
  type PrivateEvilQuestCardPolicy,
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
import {
  COMPONENT_DECISION_TRACE_VERSION,
  createDecisionTrace,
  type DecisionTrace,
} from './trace.ts'
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
  /**
   * Opt-in Phase 7D3 private quest-card convention. It is independent of the
   * proposal/vote role scorer and never reaches communication.
   */
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
  const score = source.score.bind(source)
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
    score(context: CandidateScoringContext) {
      return score(context)
    },
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
  let attributed = run
  for (const token of [
    GOOD_ROLE_OBJECTIVE_COMPONENT,
    GOOD_ROLE_UTILITY_COMPONENT,
    EVIL_ROLE_OBJECTIVE_COMPONENT,
    EVIL_ROLE_UTILITY_COMPONENT,
    MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
    MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
    MORGANA_ROLE_UTILITY_COMPONENT,
    MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  ]) {
    const use = attributed.policyUse.find(
      (entry) =>
        entry.component.id === token.id
        && entry.component.version === token.version,
    )
    if (use?.used) {
      attributed = attributeComponentPolicyUse(
        attributed,
        token,
        'action-selection',
      )
    }
  }
  return attributed
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
  configuredScorerVersion: string,
  degradation: readonly string[],
  componentPlan: DecisionComponentPlan,
  decisionComponents: DecisionComponentRun,
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
  privateEvilRoleObjective?: PrivateEvilRoleObjectiveSnapshot,
  resolvedRoleObjective: RoutedRoleObjectiveModel = 'off',
  roleObjectiveRouterEnabled = false,
  privateRoleUtility?: PrivateRoleUtilityProjection,
  privateEvilRoleUtility?: PrivateEvilRoleUtilityProjection,
  configuredEvilQuestCardPolicy?: string,
  privateEvilQuestCardPolicy?: PrivateEvilQuestCardPolicy,
  configuredMorganaCounterfeitObjective?: string,
  publicMorganaCounterfeitRead?: PublicCounterfeitMerlinReadSnapshot,
  privateMorganaCounterfeitObjective?: PrivateMorganaCounterfeitObjective,
  configuredMorganaRoleUtility?: string,
  privateMorganaRoleUtility?: PrivateMorganaRoleUtilityProjection,
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
    version: COMPONENT_DECISION_TRACE_VERSION,
    reasonCodes: [
      ...new Set([
        ...analysis.forcedPlayReasonCodes,
        ...forced.reasonCodes,
      ]),
    ],
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
      ...(resolvedRoleObjective === 'off'
        ? {}
        : { roleObjective: resolvedRoleObjective }),
      ...(roleObjectiveRouterEnabled
        ? { roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION }
        : {}),
      ...(privateRoleUtility
        ? { roleUtility: ROLE_UTILITY_PROJECTION_VERSION }
        : {}),
      ...(privateEvilRoleUtility
        ? { evilRoleUtility: EVIL_ROLE_UTILITY_PROJECTION_VERSION }
        : {}),
      ...(privateEvilQuestCardPolicy
        ? {
            evilQuestCardPolicy:
              privateEvilQuestCardPolicy.policyVersion,
          }
        : {}),
      ...(configuredEvilQuestCardPolicy
        ? { configuredEvilQuestCardPolicy }
        : {}),
      ...(publicMorganaCounterfeitRead
        ? {
            morganaCounterfeitPublicRead:
              MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
          }
        : {}),
      ...(privateMorganaCounterfeitObjective
        ? {
            morganaCounterfeitObjective:
              MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
          }
        : {}),
      ...(configuredMorganaCounterfeitObjective
        ? { configuredMorganaCounterfeitObjective }
        : {}),
      ...(privateMorganaRoleUtility
        ? { morganaRoleUtility: MORGANA_ROLE_UTILITY_PROJECTION_VERSION }
        : {}),
      ...(configuredMorganaRoleUtility
        ? { configuredMorganaRoleUtility }
        : {}),
      ...(planMemoryEnabled
        ? {
            planMemory: PLAN_MEMORY_VERSION,
            coherence: COHERENCE_MODEL_VERSION,
          }
        : {}),
      decisionComponents: DECISION_COMPONENT_RUN_VERSION,
      analysis: SITUATION_ANALYSIS_VERSION,
      candidates: LEGAL_CANDIDATE_VERSION,
      forcedPolicy: FORCED_POLICY_VERSION,
      policy: brain.policy,
      scorer: scorerVersion,
      ...(configuredScorerVersion !== scorerVersion
        ? { configuredScorer: configuredScorerVersion }
        : {}),
      planner: plannerVersion,
      prompt: COMPOSED_PROMPT_VERSION,
      renderer: COMPOSED_RENDERER_VERSION,
      communication: brain.communication,
      voice: voiceVersion,
    },
    ...(planMemoryEnabled ? { coherenceIntent } : {}),
    componentPlan: structuredClone(componentPlan),
    components: structuredClone(decisionComponents),
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
    ...(privateEvilRoleObjective
      ? { privateEvilRoleObjective: structuredClone(privateEvilRoleObjective) }
      : {}),
    ...(privateRoleUtility
      ? { privateRoleUtility: structuredClone(privateRoleUtility) }
      : {}),
    ...(privateEvilRoleUtility
      ? { privateEvilRoleUtility: structuredClone(privateEvilRoleUtility) }
      : {}),
    ...(privateEvilQuestCardPolicy
      ? {
          privateEvilQuestCardPolicy:
            structuredClone(privateEvilQuestCardPolicy),
        }
      : {}),
    ...(publicMorganaCounterfeitRead
      ? {
          publicMorganaCounterfeitRead:
            structuredClone(publicMorganaCounterfeitRead),
        }
      : {}),
    ...(privateMorganaCounterfeitObjective
      ? {
          privateMorganaCounterfeitObjective:
            structuredClone(privateMorganaCounterfeitObjective),
        }
      : {}),
    ...(privateMorganaRoleUtility
      ? {
          privateMorganaRoleUtility:
            structuredClone(privateMorganaRoleUtility),
        }
      : {}),
  }
}

function combinedFactorBundle(mechanical: string): string {
  return mechanical === 'off'
    ? LANGUAGE_FACTOR_BUNDLE_VERSION
    : `${mechanical}+${LANGUAGE_FACTOR_BUNDLE_VERSION}`
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
  const scorer = snapshotScorer(options.scorer ?? {
    version: CANDIDATE_SCORER_VERSION,
    score: scoreCandidates,
  })
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
    && evilQuestCardPolicyMode !== 'visible-exact-quota'
    && evilQuestCardPolicyMode !== 'robust-heterogeneous'
  ) {
    throw new Error('invalid evilQuestCardPolicy mode')
  }
  const configuredEvilQuestCardPolicy =
    evilQuestCardPolicyMode === 'visible-exact-quota'
      ? EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
      : evilQuestCardPolicyMode === 'robust-heterogeneous'
        ? EVIL_QUEST_ROBUST_POLICY_VERSION
        : undefined
  const configuredEvilQuestCardComponent =
    evilQuestCardPolicyMode === 'visible-exact-quota'
      ? EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT
      : evilQuestCardPolicyMode === 'robust-heterogeneous'
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
  const componentRegistry = createLegacyRoleAdapterRegistry(
    {
      goodObjectiveAllDecisionKinds:
        roleObjectivesConfigured || roleObjectiveRouterConfigured,
    },
  )
  const requestedComponents = [
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
    scoreLayerOrder: [],
    decisionLayerOrder: [],
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
        privateIdentity: configuredIdentityScope ?? null,
        roleObjectives: roleObjectivesConfigured,
        roleObjectiveRouter: roleObjectiveRouterConfigured,
        morganaCounterfeitObjectives: morganaCounterfeitConfigured,
        evilQuestCardPolicy: evilQuestCardPolicyMode ?? null,
        planMemory: planMemoryEnabled,
        coherenceIntent,
      },
      beliefModel: {
        version: beliefModel.version,
        factorsVersion: beliefModel.factorsVersion,
      },
      languageInterpreterVersion:
        configuredLanguageVersion ?? 'off',
      languageFactorVersion: languageFactor.version,
      scorerVersions: scorerVersions(scorer),
    },
  }, componentRegistry)
  const configuredComponentPlan = decisionComponentPlan(resolvedBrain)
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
    recordDecisionTrace(trace) {
      onDecisionTrace?.(trace)
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
                languageFactor,
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
        const routerConfigured = roleObjectiveRouterConfigured
        const routedObjective = routerConfigured
          ? routedRoleObjectiveModel(view.role)
          : 'off'
        let resolvedScorer = resolveRolePolicyScorer({
          configured: scorer,
          req,
          view,
          routedObjective,
        })
        const roleScorerApplicable =
          resolvedScorer.roleUtilityRequirement
            === ROLE_UTILITY_PROJECTION_VERSION
        const evilRoleScorerApplicable =
          resolvedScorer.evilRoleUtilityRequirement
            === EVIL_ROLE_UTILITY_PROJECTION_VERSION
        const roleObjectiveRole: RoleObjectiveRole | undefined =
          (roleObjectivesConfigured || roleScorerApplicable)
          && (view.role === 'merlin' || view.role === 'percival')
            ? view.role
            : routedObjective === ROLE_OBJECTIVE_MODEL_VERSION
              ? view.role as RoleObjectiveRole
              : undefined
        const evilRoleObjectiveApplicable =
          routedObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        const morganaCounterfeitApplicable =
          (
            morganaCounterfeitConfigured
            || resolvedScorer.morganaRoleUtilityRequirement
              === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
          )
          && view.role === 'morgana'
          && (req.kind === 'propose' || req.kind === 'vote')
        const decisionIdentityScope = roleObjectiveRole
          ? mergeIdentityScopes(
              configuredIdentityScope,
              roleObjectiveIdentityScope(roleObjectiveRole, view.rolesInPlay),
            )
          : evilRoleObjectiveApplicable
            ? mergeIdentityScopes(
                configuredIdentityScope,
                { roleQueries: [], hiddenTeam: true },
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
        const publicObserver = (
          publicObserverConfigured
          || roleObjectiveRole
          || evilRoleObjectiveApplicable
          || morganaCounterfeitApplicable
        )
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
        const policyTeams = candidateTeams(candidates, view)
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
        let privateEvilQuestCardPolicy:
          PrivateEvilQuestCardPolicy | undefined
        const universalForced =
          applyForcedPolicy(req, view, analysis, candidates)
        let forced = universalForced
        const configuredComponentIds = new Set(
          resolvedBrain.description.components.configured.map(
            (component) => component.id,
          ),
        )
        const requiredHostInputIds = new Set(
          resolvedBrain.description.requiredHostInputs.map(
            (input) => input.id,
          ),
        )
        const hostInputs = [
          ...(
            requiredHostInputIds.has(PRIVATE_IDENTITY_INPUT.id)
            && privateIdentity
              ? [{
                  input: PRIVATE_IDENTITY_INPUT,
                  value: privateIdentity,
                }]
              : []
          ),
          ...(
            requiredHostInputIds.has(PRIVATE_PUBLIC_OBSERVER_INPUT.id)
            && publicObserver
              ? [{
                  input: PRIVATE_PUBLIC_OBSERVER_INPUT,
                  value: publicObserver,
                }]
              : []
          ),
          ...(
            requiredHostInputIds.has(PRIVATE_BELIEF_INPUT.id)
              ? [{
                  input: PRIVATE_BELIEF_INPUT,
                  value: cognition.belief,
                }]
              : []
          ),
          ...(
            requiredHostInputIds.has(PRIVATE_SITUATION_INPUT.id)
              ? [{
                  input: PRIVATE_SITUATION_INPUT,
                  value: analysis,
                }]
              : []
          ),
          ...(
            requiredHostInputIds.has(PRIVATE_FORCED_POLICY_INPUT.id)
              ? [{
                  input: PRIVATE_FORCED_POLICY_INPUT,
                  value: universalForced,
                }]
              : []
          ),
          ...(
            requiredHostInputIds.has(PRIVATE_DETERMINISTIC_SEED_INPUT.id)
              ? [{
                  input: PRIVATE_DETERMINISTIC_SEED_INPUT,
                  value: seed,
                }]
              : []
          ),
        ]
        let decisionComponents = await runDecisionComponents(
          resolvedBrain,
          req,
          view,
          hostInputs.length ? { hostInputs } : undefined,
        )
        if (configuredComponentIds.has(GOOD_ROLE_OBJECTIVE_COMPONENT.id)) {
          privateRoleObjective = componentPayload(
            decisionComponents,
            GOOD_ROLE_OBJECTIVE_COMPONENT,
          )
          if (roleObjectiveRole && !privateRoleObjective) {
            degradation.push(ROLE_OBJECTIVE_DEGRADATION)
          }
        }
        if (configuredComponentIds.has(GOOD_ROLE_UTILITY_COMPONENT.id)) {
          privateRoleUtility = componentPayload(
            decisionComponents,
            GOOD_ROLE_UTILITY_COMPONENT,
          )
          if (roleScorerApplicable && !privateRoleUtility) {
            degradation.push(ROLE_UTILITY_DEGRADATION)
            resolvedScorer = resolveRolePolicyScorer({
              configured: resolvedScorer.baseScorer ?? resolvedScorer,
              req,
              view,
              routedObjective,
            })
          }
        }
        if (configuredComponentIds.has(EVIL_ROLE_OBJECTIVE_COMPONENT.id)) {
          privateEvilRoleObjective = componentPayload(
            decisionComponents,
            EVIL_ROLE_OBJECTIVE_COMPONENT,
          )
          if (evilRoleObjectiveApplicable && !privateEvilRoleObjective) {
            degradation.push(EVIL_ROLE_OBJECTIVE_DEGRADATION)
          }
        }
        if (configuredComponentIds.has(EVIL_ROLE_UTILITY_COMPONENT.id)) {
          privateEvilRoleUtility = componentPayload(
            decisionComponents,
            EVIL_ROLE_UTILITY_COMPONENT,
          )
          if (evilRoleScorerApplicable && !privateEvilRoleUtility) {
            degradation.push(EVIL_ROLE_UTILITY_DEGRADATION)
            resolvedScorer = resolveRolePolicyScorer({
              configured: resolvedScorer.baseScorer ?? resolvedScorer,
              req,
              view,
              routedObjective,
            })
          }
        }
        const genericPublicMorganaRead = componentPayload(
          decisionComponents,
          MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
        )
        if (morganaCounterfeitApplicable) {
          publicMorganaCounterfeitRead = genericPublicMorganaRead
          privateMorganaCounterfeitObjective = componentPayload(
            decisionComponents,
            MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
          )
          if (!privateMorganaCounterfeitObjective) {
            publicMorganaCounterfeitRead = undefined
            degradation.push(MORGANA_COUNTERFEIT_DEGRADATION)
          }
          stage('morgana-counterfeit')
        }
        if (
          configuredMorganaRoleUtilityComponent !== undefined
          && configuredComponentIds.has(
            configuredMorganaRoleUtilityComponent.id,
          )
        ) {
          privateMorganaRoleUtility = componentPayload(
            decisionComponents,
            configuredMorganaRoleUtilityComponent,
          )
          if (
            resolvedScorer.morganaRoleUtilityRequirement
              === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
            && !privateMorganaRoleUtility
          ) {
            degradation.push(MORGANA_ROLE_UTILITY_DEGRADATION)
            resolvedScorer = resolveRolePolicyScorer({
              configured: resolvedScorer.baseScorer ?? resolvedScorer,
              req,
              view,
              routedObjective,
            })
          }
        }
        if (configuredEvilQuestCardComponent) {
          privateEvilQuestCardPolicy = componentPayload(
            decisionComponents,
            configuredEvilQuestCardComponent,
          )
          if (privateEvilQuestCardPolicy) {
            stage('quest-card-policy')
            forced = applyForcedPolicy(req, view, analysis, candidates, {
              evilQuestCardPolicy: privateEvilQuestCardPolicy,
            })
            decisionComponents = attributeComponentPolicyUse(
              decisionComponents,
              configuredEvilQuestCardComponent,
              'action-selection',
            )
          } else if (
            !universalForced.applied
            && req.kind === 'quest'
            && view.alignment === 'evil'
            && view.role !== 'oberon'
          ) {
            degradation.push(EVIL_QUEST_CARD_POLICY_DEGRADATION)
          }
        }
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
        const scoringContext = {
          deterministicSeed: seed,
          request: req,
          view,
          analysis,
          candidates,
          ...(hypotheticalTeamCandidates
            ? { hypotheticalTeamCandidates }
            : {}),
          ...(privateRoleUtility ? { roleUtility: privateRoleUtility } : {}),
          ...(privateEvilRoleUtility
            ? { evilRoleUtility: privateEvilRoleUtility }
            : {}),
          ...(privateMorganaRoleUtility
            ? { morganaRoleUtility: privateMorganaRoleUtility }
            : {}),
          forced,
          compatibilityCandidateId,
        }
        let scorerVersion = resolvedScorer.version
        let scores: readonly CandidateScore[]
        let appliedScorer: CandidateScorer
        try {
          const suppliedScores =
            resolvedScorer.score(structuredClone(scoringContext))
          validateCandidateScores(scoringContext, suppliedScores, scorerVersion)
          scores = structuredClone(suppliedScores)
          appliedScorer = resolvedScorer
        } catch {
          degradation.push('scorer-invalid-output')
          const roleScorerFailed =
            resolvedScorer.version === ROLE_OBJECTIVE_SCORER_VERSION
            || resolvedScorer.version === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
            || resolvedScorer.version === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
            || resolvedScorer.version
              === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
            || resolvedScorer.version === MORGANA_ROLE_SCORER_VERSION
            || resolvedScorer.version === MORGANA_ROLE_SEEDED_SCORER_VERSION
          const baseScorer = roleScorerFailed
            ? resolveRolePolicyScorer({
                configured: resolvedScorer.baseScorer ?? resolvedScorer,
                req,
                view,
                routedObjective,
              })
            : undefined
          if (baseScorer) {
            degradation.push(
              resolvedScorer.version === MORGANA_ROLE_SCORER_VERSION
              || resolvedScorer.version === MORGANA_ROLE_SEEDED_SCORER_VERSION
                ? MORGANA_ROLE_SCORER_DEGRADATION
                : resolvedScorer.version === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
              || resolvedScorer.version
                === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                ? 'evil-role-objective-scorer-failed'
                : 'role-objective-scorer-failed',
            )
            try {
              const suppliedBase =
                baseScorer.score(structuredClone(scoringContext))
              validateCandidateScores(
                scoringContext,
                suppliedBase,
                baseScorer.version,
              )
              scorerVersion = baseScorer.version
              scores = structuredClone(suppliedBase)
              appliedScorer = baseScorer
            } catch {
              degradation.push('base-scorer-invalid-output')
              scorerVersion = CANDIDATE_SCORER_VERSION
              scores = scoreCandidates(scoringContext)
              appliedScorer = {
                version: CANDIDATE_SCORER_VERSION,
                score: scoreCandidates,
              }
              validateCandidateScores(
                scoringContext,
                scores,
                CANDIDATE_SCORER_VERSION,
              )
            }
          } else {
            scorerVersion = CANDIDATE_SCORER_VERSION
            scores = scoreCandidates(scoringContext)
            appliedScorer = {
              version: CANDIDATE_SCORER_VERSION,
              score: scoreCandidates,
            }
            validateCandidateScores(
              scoringContext,
              scores,
              CANDIDATE_SCORER_VERSION,
            )
          }
        }
        decisionComponents = attributeLegacyRolePolicyUse(
          decisionComponents,
          appliedScorer,
          scores,
          configuredMorganaRoleUtilityComponent,
        )
        const questCardPolicyCandidateId =
          privateEvilQuestCardPolicy?.selectedCard
            ? candidateIdForDecision({
                kind: 'quest',
                card: privateEvilQuestCardPolicy.selectedCard,
              })
            : undefined
        const structured = forced.selectedCandidateId
          ? scores.find((score) => score.candidateId === forced.selectedCandidateId)
          : questCardPolicyCandidateId
            ? scores.find((score) => score.candidateId === questCardPolicyCandidateId)
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
        let acceptedPlannerSelection = false
        if (
          activePlanner
          && !forced.selectedCandidateId
          && !questCardPolicyCandidateId
        ) {
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
                acceptedPlannerSelection = true
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
        if (
          !forced.selectedCandidateId
          && !questCardPolicyCandidateId
          && !acceptedPlannerSelection
          && chosenCandidateId === structured.candidateId
        ) {
          decisionComponents = attributeRoleActionSelection(
            decisionComponents,
          )
        }
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
          scorer.version,
          degradation,
          configuredComponentPlan,
          decisionComponents,
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
          privateEvilRoleObjective,
          privateRoleObjective
            ? ROLE_OBJECTIVE_MODEL_VERSION
            : privateEvilRoleObjective
              ? EVIL_ROLE_OBJECTIVE_MODEL_VERSION
              : 'off',
          routerConfigured,
          privateRoleUtility,
          privateEvilRoleUtility,
          configuredEvilQuestCardPolicy,
          privateEvilQuestCardPolicy,
          (
            morganaCounterfeitConfigured
            || scorer.morganaRoleUtilityRequirement
              === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
          )
            ? MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
            : undefined,
          publicMorganaCounterfeitRead,
          privateMorganaCounterfeitObjective,
          scorer.morganaRoleUtilityRequirement
            === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
            ? MORGANA_ROLE_UTILITY_PROJECTION_VERSION
            : undefined,
          privateMorganaRoleUtility,
          planMemoryEnabled,
          coherenceIntent,
        )
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
