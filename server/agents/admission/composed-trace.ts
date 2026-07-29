// Agent-owned detached validation, host reconstruction, and promotion
// admission for composed decision traces. Transport and evaluation consume
// this module; neither owns or mirrors these equations.

import { isDeepStrictEqual } from 'node:util'
import { isProxy } from 'node:util/types'
import { MAX_PROPOSALS, QUESTS_TO_WIN } from '../../engine/rules.ts'
import type { Decision, DecisionRequest, PlayerView } from '../../engine/types.ts'
import {
  ANALYSIS_FACT_CODES,
  FORCED_PLAY_REASON_CODES,
  type SituationAnalysis,
} from '../analysis/types.ts'
import {
  combineSituationAnalysisRequirements,
} from '../analysis/situation-plan.ts'
import {
  buildScorerSituationSurface,
} from '../analysis/scorer-situation-surface.ts'
import {
  FORCED_POLICY_VERSION,
  LEGAL_CANDIDATE_VERSION,
  type ForcedPolicyResult,
} from '../policy/types.ts'
import {
  CANDIDATE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  EVIL_ROLE_OBJECTIVE_UTILITY_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  GOOD_VOTE_UTILITY_VERSION,
  ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  ROLE_OBJECTIVE_UTILITY_VERSION,
  stablePolicyBucket,
  structuredChoice,
  type CandidateScore,
  type CandidateScoringContext,
} from '../policy/score.ts'
import { projectConfiguredScoreDiagnostics } from '../policy/score-compatibility.ts'
import { GOOD_VOTE_SITUATION_VERSION } from '../analysis/types.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  COMPONENT_DECISION_TRACE_VERSION,
  DECISION_TRACE_VERSION,
  decisionTraceIdForRequest,
  type DecisionTrace,
} from '../trace.ts'
import type { AgentExecutionMode } from '../brain.ts'
import {
  LANGUAGE_BELIEF_VERSION_SUFFIX,
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
} from '../belief/language-factor.ts'
import {
  INVALID_LANGUAGE_INTERPRETER_VERSION,
} from '../communication/language-orchestration.ts'
import {
  LANGUAGE_CURSOR_VERSION,
  LANGUAGE_INTERPRETER_INPUT_VERSION,
} from '../communication/language-types.ts'
import {
  COMMUNICATION_CLAIM_CODES,
  COMMUNICATION_INTENT_VERSION,
  DECISION_PLAN_VERSION,
  POSTERIOR_UNCERTAINTY_VERSION,
  communicationFactProjection,
  plannerOverrideReasonCodes,
  selectedStrategicReasonCodes,
} from '../policy/plan.ts'
import {
  validatePublicObserverSnapshot,
  observePublicRecord,
} from '../analysis/observer.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from '../analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  projectJointIdentity,
  validatePrivateIdentityHostJoin,
} from '../belief/identity.ts'
import { exactBelief } from '../belief/exact.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../belief/types.ts'
import {
  PLAN_MEMORY_VERSION,
} from '../cognition/plan-memory.ts'
import { COHERENCE_MODEL_VERSION } from '../cognition/coherence.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
  type RoleObjectiveRole,
} from '../analysis/role-objective-types.ts'
import {
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
  buildRoleUtilityProjection,
  validatePrivateRoleUtilityHostJoin,
  validatePrivateRoleUtilityProjection,
} from '../analysis/role-utility.ts'
import {
  buildRoleObjectiveSnapshot,
  roleObjectiveIdentityScope,
  validatePrivateRoleObjectiveHostJoin,
} from '../analysis/role-objectives.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  validatePrivateEvilRoleObjectiveHostJoin,
} from '../analysis/evil-objectives.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../analysis/evil-objective-types.ts'
import {
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  buildEvilRoleUtilityProjection,
  validatePrivateEvilRoleUtilityHostJoin,
  validatePrivateEvilRoleUtilityProjection,
} from '../analysis/evil-role-utility.ts'

type TraceValidationInput = Record<string, unknown> | DecisionTrace
import { routedRoleObjectiveModel } from '../analysis/role-objective-router.ts'
import { projectPublicRecord } from '../communication/public-record.ts'
import {
  candidateIdForDecision,
  compareCandidateIds,
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../policy/candidates.ts'
import { applyForcedPolicy } from '../policy/forced.ts'
import { heuristicDecide } from '../heuristic.ts'
import {
  replayNativeScoresForAdmission,
} from '../policy/score-layer/admission-replay.ts'
import {
  prepareScoreLayerRequirements,
} from '../policy/score-layer/preparation.ts'
import {
  configuredScoreLayerChainForVersion,
  createConfiguredScoreLayerRegistry,
} from '../score-layers/configured.ts'
import type {
  ResolvedScoreLayerChain,
} from '../policy/score-layer/types.ts'
import {
  DECISION_COMPONENT_PLAN_VERSION,
  DECISION_COMPONENT_RUN_VERSION,
  MAX_DECISION_COMPONENT_PLAN_JSON_BYTES,
  MAX_DECISION_COMPONENT_RUN_JSON_BYTES,
  componentPayload,
  type DecisionComponentPlan,
  type DecisionComponentRun,
  validateDecisionComponentRunHostJoin,
} from '../components/kernel.ts'
import {
  createDecisionLayerAdmissionAuthority,
  type AdmittedDecisionLayerTrace,
} from '../policy/decision-layer/admission-replay.ts'
import type {
  DecisionCandidateBoundary,
  DecisionLayerRun,
} from '../policy/decision-layer/types.ts'
import {
  createConfiguredDecisionLayerRegistry,
} from '../decision-layers/configured.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../components/robust-evil-quest-card.ts'
import {
  ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
} from '../decision-layers/robust-evil-quest-card.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
} from '../components/native-score-components.ts'
import {
  reconstructScoreComponentHostInputs,
} from './component-host-inputs.ts'
import {
  resolvedArchitectureIdentityTraceJoin,
} from '../components/architecture-metadata.ts'
import type {
  ResolvedArchitectureIdentity,
} from '../components/resolved-brain.ts'
import {
  createProductionComponentRegistry,
} from '../components/production-registry.ts'
import {
  canonicalizeJson,
  canonicalizeTransportJson,
  canonicalJsonEqual,
  type CanonicalJsonValue,
} from '../components/canonical-json.ts'
import {
  buildMorganaCounterfeitObjective,
  buildPublicCounterfeitMerlinRead,
  validatePrivateMorganaCounterfeitHostJoin,
  validatePrivateMorganaCounterfeitObjective,
  validatePublicCounterfeitMerlinRead,
  validatePublicCounterfeitMerlinReadHostJoin,
} from '../analysis/morgana-counterfeit.ts'
import {
  MORGANA_COUNTERFEIT_DEGRADATION,
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
} from '../analysis/morgana-counterfeit-types.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_SCORER_DEGRADATION,
  MORGANA_ROLE_SCORE_FEATURE_VERSION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_CONSTANTS,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  buildMorganaRoleUtilityProjection,
  validatePrivateMorganaRoleUtilityHostJoin,
  validatePrivateMorganaRoleUtilityProjection,
} from '../analysis/morgana-role-utility.ts'

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function seatArray(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.every((entry) => Number.isInteger(entry) && entry >= 0)
}

function finiteProbability(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1
}

function validRelevantTeam(value: unknown): boolean {
  if (value === undefined) return true
  const team = value as Record<string, unknown>
  return !!team
    && typeof team === 'object'
    && seatArray(team.team)
    && finiteProbability(team.cleanProbability)
    && Array.isArray(team.evilCountDistribution)
    && team.evilCountDistribution.length === team.team.length + 1
    && team.evilCountDistribution.every(finiteProbability)
    && seatArray(team.knownFailsAboard)
}

function validComponentVersions(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const versions = value as Record<string, unknown>
  const required = [
    'brain', 'belief', 'beliefVisibility', 'factors', 'languageEvidence',
    'observerModel', 'analysis', 'candidates', 'forcedPolicy', 'policy',
    'scorer', 'planner', 'prompt', 'renderer', 'communication', 'voice',
  ]
  return required.every(
    (key) => typeof versions[key] === 'string' && versions[key].length > 0,
  )
    && (
      versions.mechanicalBelief === undefined
      || (
        typeof versions.mechanicalBelief === 'string'
        && versions.mechanicalBelief.length > 0
      )
    )
    && (
      versions.beliefPipeline === undefined
      || (
        typeof versions.beliefPipeline === 'string'
        && versions.beliefPipeline.length > 0
      )
    )
    && (
      versions.identityModel === undefined
      || (
        typeof versions.identityModel === 'string'
        && versions.identityModel.length > 0
      )
    )
    && (
      versions.planMemory === undefined
      || versions.planMemory === PLAN_MEMORY_VERSION
    )
    && (
      versions.coherence === undefined
      || versions.coherence === COHERENCE_MODEL_VERSION
    )
    && (
      versions.decisionComponents === undefined
      || versions.decisionComponents === DECISION_COMPONENT_RUN_VERSION
    )
    && (
      versions.roleObjective === undefined
      || versions.roleObjective === ROLE_OBJECTIVE_MODEL_VERSION
      || versions.roleObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    )
    && (
      versions.roleObjectiveRouter === undefined
      || versions.roleObjectiveRouter === ROLE_OBJECTIVE_ROUTER_VERSION
    )
    && (
      versions.roleUtility === undefined
      || versions.roleUtility === ROLE_UTILITY_PROJECTION_VERSION
    )
    && (
      versions.evilRoleUtility === undefined
      || versions.evilRoleUtility === EVIL_ROLE_UTILITY_PROJECTION_VERSION
    )
    && (
      versions.morganaCounterfeitPublicRead === undefined
      || versions.morganaCounterfeitPublicRead
        === MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
    )
    && (
      versions.morganaCounterfeitObjective === undefined
      || versions.morganaCounterfeitObjective
        === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    )
    && (
      versions.configuredMorganaCounterfeitObjective === undefined
      || versions.configuredMorganaCounterfeitObjective
        === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    )
    && (
      versions.morganaRoleUtility === undefined
      || versions.morganaRoleUtility
        === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    )
    && (
      versions.configuredMorganaRoleUtility === undefined
      || versions.configuredMorganaRoleUtility
        === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    )
    && (
      versions.configuredScorer === undefined
      || (
        typeof versions.configuredScorer === 'string'
        && versions.configuredScorer.length > 0
        && versions.configuredScorer !== versions.scorer
      )
    )
    && (
      versions.roleUtility === undefined
      || versions.roleObjective === ROLE_OBJECTIVE_MODEL_VERSION
    )
    && (
      versions.evilRoleUtility === undefined
      || versions.roleObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    )
    && (
      versions.morganaRoleUtility === undefined
      || (
        versions.evilRoleUtility === EVIL_ROLE_UTILITY_PROJECTION_VERSION
        && versions.morganaCounterfeitObjective
          === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
      )
    )
    && (
      (versions.planMemory === undefined)
      === (versions.coherence === undefined)
    )
}

function validMorganaCounterfeitTrace(
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const configured = components?.configuredMorganaCounterfeitObjective
  const readVersion = components?.morganaCounterfeitPublicRead
  const objectiveVersion = components?.morganaCounterfeitObjective
  const read = trace.publicMorganaCounterfeitRead
  const objective = trace.privateMorganaCounterfeitObjective
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
  const degraded = degradation.includes(MORGANA_COUNTERFEIT_DEGRADATION)
  if (configured === undefined) {
    return readVersion === undefined
      && objectiveVersion === undefined
      && read === undefined
      && objective === undefined
      && !degraded
  }
  if (
    configured !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    || !hostView
  ) return false
  const applicable =
    hostView.role === 'morgana'
    && (req.kind === 'propose' || req.kind === 'vote')
  if (!applicable) {
    return readVersion === undefined
      && objectiveVersion === undefined
      && read === undefined
      && objective === undefined
      && !degraded
  }
  if (degraded) {
    const atomic = readVersion === undefined
      && objectiveVersion === undefined
      && read === undefined
      && objective === undefined
    if (!atomic) return false
    const exactReconstructable =
      trace.beliefModelVersion === EXACT_BELIEF_MODEL_VERSION
      && components?.belief === EXACT_BELIEF_MODEL_VERSION
      && components?.factors === 'off'
      && components?.languageEvidence === 'off'
    if (!exactReconstructable) return true
    try {
      const belief = exactBelief(hostView)
      const publicRead = buildPublicCounterfeitMerlinRead(
        projectPublicRecord(hostView),
      )
      buildMorganaCounterfeitObjective({
        req,
        view: hostView,
        belief,
        publicRead,
        candidates: legalCandidates(req, hostView),
      })
      return false
    } catch {
      return true
    }
  }
  if (
    readVersion !== MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
    || objectiveVersion !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    || components?.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
    || !validatePublicCounterfeitMerlinRead(read)
    || !validatePrivateMorganaCounterfeitObjective(objective)
  ) return false
  const publicRecord = projectPublicRecord(hostView)
  if (!validatePublicCounterfeitMerlinReadHostJoin(read, publicRecord)) {
    return false
  }
  if (
    trace.beliefModelVersion !== EXACT_BELIEF_MODEL_VERSION
    || components?.belief !== EXACT_BELIEF_MODEL_VERSION
    || components?.factors !== 'off'
    || components?.languageEvidence !== 'off'
  ) {
    // Weighted transport does not carry the complete world list. The generic
    // entry may remain structurally readable, but it cannot claim exact host
    // verification or promotion eligibility.
    const genericObjective =
      (trace.components as DecisionTrace['components'])?.entries.find(
        (entry) =>
          entry.component.id === MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
      )
    return genericObjective?.status === 'admitted'
      && genericObjective.verification === 'structural'
      && genericObjective.promotionEligible === false
  }
  try {
    const belief = exactBelief(hostView)
    return (
      belief.throughSeq === trace.beliefThroughSeq
      && belief.quality === trace.quality
      && isDeepStrictEqual(
        trace.beliefPlayerMarginals,
        belief.playerMarginals,
      )
      && validatePrivateMorganaCounterfeitHostJoin(objective, {
        req,
        view: hostView,
        belief,
        publicRead: read,
        candidates: legalCandidates(req, hostView),
      })
    )
  } catch {
    return false
  }
}

function validMorganaRolePolicyTrace(
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
  deterministicSeed?: string,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const configured = components?.configuredMorganaRoleUtility
  const resolved = components?.morganaRoleUtility
  const projection = trace.privateMorganaRoleUtility
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
  const degraded = degradation.includes(MORGANA_ROLE_UTILITY_DEGRADATION)
  if (configured === undefined) {
    return resolved === undefined
      && projection === undefined
      && !degraded
  }
  if (
    configured !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    || !hostView
  ) return false
  const applicable =
    hostView.role === 'morgana'
    && (req.kind === 'propose' || req.kind === 'vote')
  if (!applicable) {
    return resolved === undefined
      && projection === undefined
      && !degraded
  }
  if (degraded) {
    const atomic = resolved === undefined
      && projection === undefined
      && components?.scorer !== MORGANA_ROLE_SCORER_VERSION
      && components?.scorer !== MORGANA_ROLE_SEEDED_SCORER_VERSION
    if (!atomic) return false
    const exactReconstructable =
      trace.beliefModelVersion === EXACT_BELIEF_MODEL_VERSION
      && components?.belief === EXACT_BELIEF_MODEL_VERSION
      && components?.factors === 'off'
      && components?.languageEvidence === 'off'
    if (!exactReconstructable) return true
    const configuredScorer =
      components?.configuredScorer ?? components?.scorer
    if (
      configuredScorer !== MORGANA_ROLE_SCORER_VERSION
      && configuredScorer !== MORGANA_ROLE_SEEDED_SCORER_VERSION
    ) return false
    const forcedResult = trace.forcedPolicyResult
    if (
      !validatePrivateMorganaCounterfeitObjective(
        trace.privateMorganaCounterfeitObjective,
      )
      || !validatePrivateEvilRoleUtilityProjection(
        trace.privateEvilRoleUtility,
      )
      || forcedResult === undefined
      || !validForcedPolicyResult(forcedResult)
    ) {
      // Upstream exact-dependency admission independently decides whether an
      // absent or malformed prerequisite is an honest narrow degradation.
      return true
    }
    const candidates = legalCandidates(req, hostView)
    const selectionMode =
      configuredScorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
        ? 'seeded-near-equal-vote-within-d2-band'
        : 'top-counterfeit-within-d2-band'
    // The stdio envelope does not receive the private game seed. Any stable
    // seed is sufficient to prove that projection construction succeeds;
    // persisted and generation-time host replay supplies the authoritative
    // seed and validates the selected bucket separately.
    const reconstructionSeed = deterministicSeed ?? [
      'morgana-role-external-admission-v1',
      req.seat,
      req.kind,
      req.round,
      req.proposalNum,
      trace.beliefThroughSeq,
      configuredScorer,
    ].join(':')
    try {
      const input = {
        req,
        view: hostView,
        candidates,
        forced: forcedResult,
        counterfeitObjective: trace.privateMorganaCounterfeitObjective,
        evilRoleUtility: trace.privateEvilRoleUtility,
        selectionMode,
        deterministicSeed: reconstructionSeed,
      } as const
      const rebuilt = buildMorganaRoleUtilityProjection(input)
      // Exact E1A + D2 + forced inputs that can reconstruct E1B cannot claim
      // projection failure merely by coherently substituting the D2 surface.
      return !validatePrivateMorganaRoleUtilityHostJoin(rebuilt, input)
    } catch {
      return true
    }
  }
  return resolved === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    && validatePrivateMorganaRoleUtilityProjection(projection)
    && components?.morganaCounterfeitObjective
      === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    && components?.evilRoleUtility === EVIL_ROLE_UTILITY_PROJECTION_VERSION
}

function validPlanOutcomeTrace(
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  decision: Decision,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  // Stdio replies arrive before engine legality. A child cannot truthfully
  // serialize a post-apply outcome in this protocol version.
  return value === undefined
    && components?.planMemory === undefined
    && components?.coherence === undefined
    && trace.coherenceIntent === undefined
}

function validLanguageTrace(
  value: unknown,
  trace: TraceValidationInput,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const componentDeclaresLanguage =
    components?.languageEvidence === LANGUAGE_FACTOR_BUNDLE_VERSION
  const factorsDeclareLanguage =
    typeof components?.factors === 'string'
    && (
      components.factors === LANGUAGE_FACTOR_BUNDLE_VERSION
      || components.factors
        .split('+')
        .includes(LANGUAGE_FACTOR_BUNDLE_VERSION)
    )
  if (componentDeclaresLanguage !== factorsDeclareLanguage) return false
  if (
    componentDeclaresLanguage
      ? (
          typeof components?.mechanicalBelief !== 'string'
          || components.mechanicalBelief.length === 0
          || typeof components.beliefPipeline !== 'string'
          || components.beliefPipeline.length === 0
        )
      : (
          components?.mechanicalBelief !== undefined
          || components?.beliefPipeline !== undefined
        )
  ) {
    return false
  }
  if (value === undefined) return !componentDeclaresLanguage
  if (!componentDeclaresLanguage) return false
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const language = value as Record<string, unknown>
  if (!exactKeys(language, [
    'inputSchemaVersion',
    'cursorSchemaVersion',
    'interpreterVersion',
    'factorVersion',
    'factorBundleVersion',
    'cursorThroughSeq',
    'admittedSourceSeqs',
    'cumulativeSourceSeqs',
    'degradation',
  ])) {
    return false
  }
  const admitted = language.admittedSourceSeqs
  const cumulative = language.cumulativeSourceSeqs
  const degradation = language.degradation
  const allowedDegradation = new Set([
    'language-input-failed',
    'language-interpreter-invalid-version',
    'language-interpreter-failed',
    'language-evidence-invalid-output',
  ])
  const cursorThroughSeq = language.cursorThroughSeq
  const canonicalSeqs = (candidate: unknown): candidate is number[] =>
    Array.isArray(candidate)
    && candidate.every(
      (seq, index, all) =>
        Number.isSafeInteger(seq)
        && seq >= 0
        && Number.isSafeInteger(cursorThroughSeq)
        && seq <= (cursorThroughSeq as number)
        && (index === 0 || all[index - 1] < seq),
    )
  const interpreterVersion = language.interpreterVersion
  const validAttributedVersion =
    typeof interpreterVersion === 'string'
    && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(interpreterVersion)
  if (!canonicalSeqs(admitted) || !canonicalSeqs(cumulative)) {
    return false
  }
  const languageProvenance = Array.isArray(trace.beliefProvenance)
    ? trace.beliefProvenance.filter(
        (entry) =>
          !!entry
          && typeof entry === 'object'
          && (entry as Record<string, unknown>).factorId === 'language',
      )
    : []
  const beliefUsesLanguage =
    typeof trace.beliefModelVersion === 'string'
    && (
      trace.beliefModelVersion === LANGUAGE_BELIEF_VERSION_SUFFIX
      || trace.beliefModelVersion.endsWith(
        `+${LANGUAGE_BELIEF_VERSION_SUFFIX}`,
      )
    )
  const provenanceMatches = (
    beliefUsesLanguage
      ? languageProvenance.length === 1
      : languageProvenance.length === 0
  )
    && languageProvenance.every((entry) => {
      const contribution = entry as Record<string, unknown>
      if (
        contribution.factorVersion !== LANGUAGE_LIKELIHOOD_FACTOR_VERSION
        || !Array.isArray(contribution.evidenceIds)
        || contribution.evidenceIds.length === 0
      ) {
        return false
      }
      const provenanceSeqs = new Set<number>()
      return contribution.evidenceIds.every((id) => {
        if (typeof id !== 'string') return false
        const match = id.match(
          /^event:(\d+):language:([a-z0-9][a-z0-9._-]{0,99}):subject:/,
        )
        if (!match) return false
        const sourceSeq = Number(match[1])
        if (
          !Number.isSafeInteger(sourceSeq)
          || provenanceSeqs.has(sourceSeq)
          || !cumulative.includes(sourceSeq)
          || match[2] !== interpreterVersion
        ) {
          return false
        }
        provenanceSeqs.add(sourceSeq)
        return true
      })
    })
  return (
    language.inputSchemaVersion === LANGUAGE_INTERPRETER_INPUT_VERSION
    && language.cursorSchemaVersion === LANGUAGE_CURSOR_VERSION
    && validAttributedVersion
    && (
      interpreterVersion !== INVALID_LANGUAGE_INTERPRETER_VERSION
      || (
        Array.isArray(degradation)
        && (
          degradation.includes('language-interpreter-invalid-version')
          || degradation.includes('language-input-failed')
        )
      )
    )
    && language.factorVersion === LANGUAGE_LIKELIHOOD_FACTOR_VERSION
    && language.factorBundleVersion === LANGUAGE_FACTOR_BUNDLE_VERSION
    && Number.isSafeInteger(language.cursorThroughSeq)
    && (language.cursorThroughSeq as number) >= -1
    && (language.cursorThroughSeq as number)
      <= (trace.beliefThroughSeq as number)
    && admitted.every((seq) => cumulative.includes(seq))
    && Array.isArray(degradation)
    && new Set(degradation).size === degradation.length
    && degradation.every(
      (code) =>
        typeof code === 'string'
        && allowedDegradation.has(code)
        && (trace.degradation as string[]).includes(code),
    )
    && provenanceMatches
  )
}

function validPublicObserverTrace(
  value: unknown,
  trace: TraceValidationInput,
  hostView?: Pick<PlayerView, 'rolesInPlay'>,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const enabled =
    components?.observerModel === PUBLIC_OBSERVER_MODEL_VERSION
  if (!enabled) return value === undefined
  if (value === undefined) {
    const run = trace.components as
      | { entries?: readonly {
          component: { id: string; version: string }
          status: string
        }[] }
      | undefined
    const owners = run?.entries?.filter((entry) =>
      PRODUCTION_COMPONENT_REGISTRY.definition(entry.component)
        ?.brainContribution?.observerModel
          === PUBLIC_OBSERVER_MODEL_VERSION)
    return !!owners?.length
      && owners.every((entry) => entry.status !== 'admitted')
  }
  if (!validatePublicObserverSnapshot(value)) return false
  return !isFullPlayerView(hostView)
    || isDeepStrictEqual(
      value,
      observePublicRecord(projectPublicRecord(hostView)),
    )
}

function validPrivateIdentityTrace(
  value: unknown,
  trace: TraceValidationInput,
  hostRolesInPlay: readonly unknown[] | undefined,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const declared = components?.identityModel
  if (
    declared !== undefined
    && declared !== JOINT_IDENTITY_MODEL_VERSION
  ) return false
  const enabled = declared === JOINT_IDENTITY_MODEL_VERSION
  if (!enabled) return value === undefined
  if (value === undefined) {
    return Array.isArray(trace.degradation)
      && trace.degradation.includes('identity-projection-failed')
  }
  if (
    !validatePrivateIdentityHostJoin(
      value,
      hostRolesInPlay,
      trace.beliefPlayerMarginals,
    )
  ) return false
  return (
    value.sourceBelief.modelVersion === trace.beliefModelVersion
    && value.sourceBelief.throughSeq === trace.beliefThroughSeq
    && value.sourceBelief.quality === trace.quality
    && Number.isInteger(trace.viewerSeat)
    && (trace.viewerSeat as number) < value.sourceBelief.playerCount
  )
}

function validPrivateRoleObjectiveTrace(
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const declared = components?.roleObjective
  if (
    declared !== undefined
    && declared !== ROLE_OBJECTIVE_MODEL_VERSION
  ) {
    return value === undefined
      && !(
        Array.isArray(trace.degradation)
        && trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
      )
  }
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
  const roleDegraded = degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
  if (
    !hostView
    || (hostView.role !== 'merlin' && hostView.role !== 'percival')
  ) {
    return declared === undefined
      && value === undefined
      && !roleDegraded
  }
  if (
    components?.identityModel !== JOINT_IDENTITY_MODEL_VERSION
    || components.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
  ) return false
  if (value === undefined) {
    const degradedDeclaration =
      trace.version === DECISION_TRACE_VERSION
        ? declared === ROLE_OBJECTIVE_MODEL_VERSION
        : declared === undefined
    if (!degradedDeclaration || !roleDegraded) return false
    if (!trace.privateIdentity) {
      return degradation.includes('identity-projection-failed')
    }
    if (!trace.publicObserver) return false
    try {
      buildRoleObjectiveSnapshot({
        req,
        view: hostView,
        identity: trace.privateIdentity as never,
        observer: trace.publicObserver as never,
        candidates: legalCandidates(req, hostView),
      })
      return false
    } catch {
      return true
    }
  }
  if (
    declared !== ROLE_OBJECTIVE_MODEL_VERSION
    || roleDegraded
    || !trace.privateIdentity
    || !trace.publicObserver
  ) {
    return false
  }
  try {
    return validatePrivateRoleObjectiveHostJoin(value, {
      req,
      view: hostView,
      identity: trace.privateIdentity as never,
      observer: trace.publicObserver as never,
      candidates: legalCandidates(req, hostView),
    })
  } catch {
    return false
  }
}

function validPrivateEvilRoleObjectiveTrace(
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const router = components?.roleObjectiveRouter
  const declared = components?.roleObjective
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
  const roleDegraded = degradation.includes(
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
  )
  if (router === undefined) {
    return declared !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      && value === undefined
      && !roleDegraded
  }
  if (router !== ROLE_OBJECTIVE_ROUTER_VERSION || !hostView) return false
  const routed = routedRoleObjectiveModel(hostView.role)
  if (routed !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION) {
    return value === undefined && !roleDegraded
  }
  if (
    components?.identityModel !== JOINT_IDENTITY_MODEL_VERSION
    || components?.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
  ) return false
  const observer = observePublicRecord(projectPublicRecord(hostView))
  const candidates = legalCandidates(req, hostView)
  if (value === undefined) {
    const degradedDeclaration =
      trace.version === DECISION_TRACE_VERSION
        ? declared === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        : declared === undefined
    if (!degradedDeclaration || !roleDegraded) return false
    if (trace.privateIdentity) {
      try {
        buildEvilRoleObjectiveSnapshot({
          req,
          view: hostView,
          identity: trace.privateIdentity as never,
          observer,
          candidates,
        })
        return false
      } catch {
        return true
      }
    }
    const exactNonLanguage =
      components.belief === EXACT_BELIEF_MODEL_VERSION
      && components.languageEvidence === 'off'
      && components.factors === 'off'
    if (!exactNonLanguage) {
      return degradation.includes('identity-projection-failed')
    }
    try {
      const identity = projectJointIdentity(exactBelief(hostView), {
        roleQueries: [],
        hiddenTeam: true,
      })
      buildEvilRoleObjectiveSnapshot({
        req,
        view: hostView,
        identity,
        observer,
        candidates,
      })
      return false
    } catch {
      return true
    }
  }
  return declared === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    && !roleDegraded
    && !!trace.privateIdentity
    && validatePrivateEvilRoleObjectiveHostJoin(value, {
      req,
      view: hostView,
      identity: trace.privateIdentity as never,
      observer,
      candidates,
    })
}

function validRoleObjectiveRoute(
  trace: TraceValidationInput,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const router = components?.roleObjectiveRouter
  if (router === undefined) {
    return components?.roleObjective !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      && trace.privateEvilRoleObjective === undefined
  }
  if (router !== ROLE_OBJECTIVE_ROUTER_VERSION || !hostView) return false
  const expected = routedRoleObjectiveModel(hostView.role)
  return components?.roleObjective === (
    expected === 'off' ? undefined : expected
  )
}

function validPrivateRoleUtilityTrace(
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const declared = components?.roleUtility
  const configured = components?.configuredScorer ?? components?.scorer
  const configuredForRole = (
    configured === ROLE_OBJECTIVE_SCORER_VERSION
    || configured === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    || components?.scorer === ROLE_OBJECTIVE_SCORER_VERSION
    || components?.scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    || (
      (
        configured === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
        || configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      )
      && (hostView?.role === 'merlin' || hostView?.role === 'percival')
    )
  )
  const applicable =
    configuredForRole
    && (req.kind === 'propose' || req.kind === 'vote')
    && (hostView?.role === 'merlin' || hostView?.role === 'percival')
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
  if (!applicable) {
    return declared === undefined
      && value === undefined
      && !degradation.includes(ROLE_UTILITY_DEGRADATION)
  }
  if (value === undefined) {
    if (
      declared !== undefined
      || !degradation.includes(ROLE_UTILITY_DEGRADATION)
      || (
        components?.scorer !== GOOD_PROPOSAL_VOTE_SCORER_VERSION
        && components?.scorer !== GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      )
    ) return false
    if (
      hostView
      && trace.privateRoleObjective
      && trace.publicObserver
    ) {
      try {
        buildRoleUtilityProjection({
          req,
          view: hostView,
          objective: trace.privateRoleObjective as never,
          observer: trace.publicObserver as never,
          candidates: legalCandidates(req, hostView),
        })
        return false
      } catch {
        return true
      }
    }
    return true
  }
  if (
    declared !== ROLE_UTILITY_PROJECTION_VERSION
    || !hostView
    || !trace.privateRoleObjective
    || !trace.privateIdentity
    || !trace.publicObserver
    || !validatePrivateRoleUtilityProjection(value)
  ) return false
  try {
    return validatePrivateRoleUtilityHostJoin(value, {
      req,
      view: hostView,
      objective: trace.privateRoleObjective as never,
      identity: trace.privateIdentity as never,
      observer: trace.publicObserver as never,
      candidates: legalCandidates(req, hostView),
    })
  } catch {
    return false
  }
}

function validPrivateEvilRoleUtilityTrace(
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const configured = components?.configuredScorer ?? components?.scorer
  const applicable =
    (
      configured === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      || configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      || configured === MORGANA_ROLE_SCORER_VERSION
      || configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
    )
    && (req.kind === 'propose' || req.kind === 'vote')
    && hostView?.alignment === 'evil'
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
  const dependencyDegradation = [
    'identity-projection-failed',
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
    EVIL_ROLE_UTILITY_DEGRADATION,
  ]
  const atomicWeightedDependencyFailure =
    trace.quality === 'weighted'
    && value === undefined
    && trace.privateIdentity === undefined
    && trace.privateEvilRoleObjective === undefined
    && components?.evilRoleUtility === undefined
    && degradation.length === dependencyDegradation.length
    && dependencyDegradation.every((code) => degradation.includes(code))
    && (
      configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      || configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
        ? components?.scorer
          === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        : components?.scorer === GOOD_PROPOSAL_VOTE_SCORER_VERSION
    )
  if (!applicable) {
    return components?.evilRoleUtility === undefined
      && value === undefined
      && !degradation.includes(EVIL_ROLE_UTILITY_DEGRADATION)
  }
  if (!hostView || !trace.publicObserver) return false
  if (
    !trace.privateEvilRoleObjective
    || !trace.privateIdentity
  ) return atomicWeightedDependencyFailure
  if (atomicWeightedDependencyFailure) return false
  if (dependencyDegradation.some((code) => degradation.includes(code))) {
    return false
  }
  const candidates = legalCandidates(req, hostView)
  const alternativeObjective = req.kind === 'vote'
    ? buildEvilRoleObjectiveSnapshot({
        req: { ...req, kind: 'propose' },
        view: hostView,
        identity: trace.privateIdentity as never,
        observer: trace.publicObserver as never,
        candidates: hypotheticalProposalCandidates(hostView),
      })
    : undefined
  if (value === undefined) {
    if (
      components?.evilRoleUtility !== undefined
      || !degradation.includes(EVIL_ROLE_UTILITY_DEGRADATION)
      || (
        components?.scorer !== GOOD_PROPOSAL_VOTE_SCORER_VERSION
        && components?.scorer !== GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      )
    ) return false
    // A validated complete D1 chain is always enough to derive D2, including
    // weighted external beliefs. Do not admit fake utility degradation.
    try {
      buildEvilRoleUtilityProjection({
        req,
        view: hostView,
        objective: trace.privateEvilRoleObjective as never,
        candidates,
        ...(alternativeObjective ? { alternativeObjective } : {}),
      })
      return false
    } catch {
      return true
    }
  }
  if (
    components?.evilRoleUtility !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
    || degradation.includes(EVIL_ROLE_UTILITY_DEGRADATION)
    || !validatePrivateEvilRoleUtilityProjection(value)
  ) return false
  try {
    return validatePrivateEvilRoleUtilityHostJoin(value, {
      req,
      view: hostView,
      objective: trace.privateEvilRoleObjective as never,
      identity: trace.privateIdentity as never,
      observer: trace.publicObserver as never,
      candidates,
      ...(alternativeObjective ? { alternativeObjective } : {}),
      ...(alternativeObjective
        ? { alternativeCandidates: hypotheticalProposalCandidates(hostView) }
        : {}),
    })
  } catch {
    return false
  }
}

function validBeliefProvenance(value: unknown): boolean {
  if (value === undefined) return true
  return Array.isArray(value) && value.every((entry) => {
    const contribution = entry as Record<string, unknown>
    return !!contribution
      && typeof contribution === 'object'
      && typeof contribution.factorId === 'string'
      && contribution.factorId.length > 0
      && typeof contribution.factorVersion === 'string'
      && contribution.factorVersion.length > 0
      && stringArray(contribution.evidenceIds)
      && new Set(contribution.evidenceIds).size
        === contribution.evidenceIds.length
      && typeof contribution.logLikelihoodCap === 'number'
      && Number.isFinite(contribution.logLikelihoodCap)
      && contribution.logLikelihoodCap > 0
      && typeof contribution.minLogLikelihood === 'number'
      && Number.isFinite(contribution.minLogLikelihood)
      && typeof contribution.maxLogLikelihood === 'number'
      && Number.isFinite(contribution.maxLogLikelihood)
      && contribution.minLogLikelihood <= contribution.maxLogLikelihood
      && contribution.minLogLikelihood >= -contribution.logLikelihoodCap
      && contribution.maxLogLikelihood <= contribution.logLikelihoodCap
  })
}

function validBeliefPlayerMarginals(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  return value.every((entry, index) => {
    const marginal = entry as Record<string, unknown>
    return !!marginal
      && typeof marginal === 'object'
      && marginal.seat === index
      && finiteProbability(marginal.goodProbability)
      && finiteProbability(marginal.evilProbability)
      && Math.abs(
        marginal.goodProbability + marginal.evilProbability - 1,
      ) <= 1e-9
  })
}

function validBeliefTeamAssessments(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every((entry) => {
    const assessment = entry as Record<string, unknown>
    const team = assessment.team
    const distribution = assessment.evilCountDistribution
    const candidateId = assessment.candidateId
    const duplicate =
      typeof candidateId === 'string' && ids.has(candidateId)
    if (typeof candidateId === 'string') ids.add(candidateId)
    return !!assessment
      && typeof assessment === 'object'
      && typeof candidateId === 'string'
      && candidateId.length > 0
      && !duplicate
      && typeof assessment.beliefModelVersion === 'string'
      && assessment.beliefModelVersion.length > 0
      && Number.isInteger(assessment.beliefThroughSeq)
      && ['uniform-feasible-joint', 'weighted-joint'].includes(
        assessment.probabilitySemantics as string,
      )
      && seatArray(team)
      && new Set(team).size === team.length
      && team.every(
        (seat, index) => index === 0 || team[index - 1] < seat,
      )
      && finiteProbability(assessment.cleanProbability)
      && Array.isArray(distribution)
      && distribution.length === team.length + 1
      && distribution.every(finiteProbability)
      && Math.abs(
        distribution.reduce(
          (sum, probability) => sum + probability,
          0,
        ) - 1,
      ) <= 1e-9
      && Math.abs(distribution[0] - assessment.cleanProbability) <= 1e-12
      && seatArray(assessment.knownFailsAboard)
  })
}

function validCandidateScores(value: unknown): boolean {
  if (value === undefined) return true
  return Array.isArray(value) && value.every((entry) => {
    const score = entry as Record<string, unknown>
    const features = score?.features as Record<string, unknown> | undefined
    const distribution = features?.evilCountDistribution
    const team = features?.team
    const validProposalFeatures = (
      !!features
      && typeof features === 'object'
      && !Array.isArray(features)
      && features.version === GOOD_PROPOSAL_FEATURE_VERSION
      && ['uniform-feasible-joint', 'weighted-joint'].includes(
        features.semantics as string,
      )
      && typeof features.beliefModelVersion === 'string'
      && features.beliefModelVersion.length > 0
      && Number.isInteger(features.beliefThroughSeq)
      && seatArray(team)
      && new Set(team).size === team.length
      && team.every((seat, index) => index === 0 || team[index - 1] < seat)
      && finiteProbability(features.cleanProbability)
      && Array.isArray(distribution)
      && distribution.length === team.length + 1
      && distribution.every(finiteProbability)
      && Math.abs(
        distribution.reduce((sum, probability) => sum + probability, 0) - 1,
      ) <= 1e-9
      && Math.abs(distribution[0] - features.cleanProbability) <= 1e-12
    )
    const currentDistribution = features?.currentEvilCountDistribution
    const alternativeDistribution =
      features?.bestAlternativeEvilCountDistribution
    const currentTeam = features?.currentTeam
    const alternativeTeam = features?.bestAlternativeTeam
    const boardScore = features?.boardScore as
      | Record<string, unknown>
      | undefined
    const expectedStake = boardScore
      ? (
          1
          + (boardScore.good === 2
            ? GOOD_VOTE_UTILITY_CONSTANTS.matchPointStakeBonus
            : 0)
          + (boardScore.evil === 2
            ? GOOD_VOTE_UTILITY_CONSTANTS.matchPointStakeBonus
            : 0)
        )
      : Number.NaN
    const expectedRealization =
      GOOD_VOTE_UTILITY_CONSTANTS.alternativeRealizationBase
      + GOOD_VOTE_UTILITY_CONSTANTS.alternativeRealizationPerRejection
        * Number(features?.rejectionsBeforeHammer)
    const expectedHammerPenalty =
      GOOD_VOTE_UTILITY_CONSTANTS.hammerPenaltyScale
      * (1 - Number(features?.rejectionsBeforeHammer) / 4)
      + (
        features?.rejectionsBeforeHammer === 1
          ? GOOD_VOTE_UTILITY_CONSTANTS.nextHammerPenalty
          : 0
      )
    const expectedInformationBonus = features?.futureQuestsRemain === true
      ? GOOD_VOTE_UTILITY_CONSTANTS.informationBonusScale
        * (1 - Number(features?.currentCleanProbability))
      : 0
    const validVoteFeatures = (
      !!features
      && typeof features === 'object'
      && !Array.isArray(features)
      && features.version === GOOD_VOTE_FEATURE_VERSION
      && features.utilityVersion === GOOD_VOTE_UTILITY_VERSION
      && features.situationVersion === GOOD_VOTE_SITUATION_VERSION
      && ['uniform-feasible-joint', 'weighted-joint'].includes(
        features.semantics as string,
      )
      && typeof features.beliefModelVersion === 'string'
      && features.beliefModelVersion.length > 0
      && Number.isInteger(features.beliefThroughSeq)
      && seatArray(currentTeam)
      && new Set(currentTeam).size === currentTeam.length
      && currentTeam.every(
        (seat, index) => index === 0 || currentTeam[index - 1] < seat,
      )
      && finiteProbability(features.currentCleanProbability)
      && Array.isArray(currentDistribution)
      && currentDistribution.length === currentTeam.length + 1
      && currentDistribution.every(finiteProbability)
      && Math.abs(
        currentDistribution.reduce(
          (sum, probability) => sum + probability,
          0,
        ) - 1,
      ) <= 1e-9
      && Math.abs(
        currentDistribution[0] - features.currentCleanProbability,
      ) <= 1e-12
      && typeof features.bestAlternativeCandidateId === 'string'
      && features.bestAlternativeCandidateId.startsWith(
        `${LEGAL_CANDIDATE_VERSION}:propose:`,
      )
      && seatArray(alternativeTeam)
      && new Set(alternativeTeam).size === alternativeTeam.length
      && alternativeTeam.every(
        (seat, index) => index === 0 || alternativeTeam[index - 1] < seat,
      )
      && features.bestAlternativeCandidateId === (
        `${LEGAL_CANDIDATE_VERSION}:propose:`
        + alternativeTeam.join(',')
      )
      && !isDeepStrictEqual(currentTeam, alternativeTeam)
      && finiteProbability(features.bestAlternativeCleanProbability)
      && Array.isArray(alternativeDistribution)
      && alternativeDistribution.length === alternativeTeam.length + 1
      && alternativeDistribution.every(finiteProbability)
      && Math.abs(
        alternativeDistribution.reduce(
          (sum, probability) => sum + probability,
          0,
        ) - 1,
      ) <= 1e-9
      && Math.abs(
        alternativeDistribution[0]
        - features.bestAlternativeCleanProbability,
      ) <= 1e-12
      && !!boardScore
      && typeof boardScore === 'object'
      && Number.isInteger(boardScore.good)
      && Number.isInteger(boardScore.evil)
      && Number.isInteger(features.proposalNumber)
      && Number.isInteger(features.rejectionsBeforeHammer)
      && typeof features.futureQuestsRemain === 'boolean'
      && typeof features.stake === 'number'
      && Number.isFinite(features.stake)
      && Math.abs(features.stake - expectedStake) <= 1e-12
      && typeof features.alternativeRealization === 'number'
      && Number.isFinite(features.alternativeRealization)
      && Math.abs(
        features.alternativeRealization - expectedRealization,
      ) <= 1e-12
      && typeof features.hammerPenalty === 'number'
      && Number.isFinite(features.hammerPenalty)
      && Math.abs(features.hammerPenalty - expectedHammerPenalty) <= 1e-12
      && typeof features.informationBonus === 'number'
      && Number.isFinite(features.informationBonus)
      && Math.abs(
        features.informationBonus - expectedInformationBonus,
      ) <= 1e-12
      && typeof features.approveUtility === 'number'
      && Number.isFinite(features.approveUtility)
      && Math.abs(
        features.approveUtility - (
          Number(features.stake)
          * Number(features.currentCleanProbability)
          + Number(features.informationBonus)
        ),
      ) <= 1e-12
      && typeof features.rejectUtility === 'number'
      && Number.isFinite(features.rejectUtility)
      && Math.abs(
        features.rejectUtility - (
          Number(features.stake)
          * Number(features.bestAlternativeCleanProbability)
          * Number(features.alternativeRealization)
          - Number(features.hammerPenalty)
        ),
      ) <= 1e-12
      && typeof features.baseUtility === 'number'
      && Number.isFinite(features.baseUtility)
      && typeof features.selectionAdjustment === 'number'
      && Number.isFinite(features.selectionAdjustment)
      && (
        features.selectionMode === 'top-utility'
        || features.selectionMode === 'seeded-band'
      )
      && features.viableBand === GOOD_VOTE_UTILITY_CONSTANTS.viableBand
      && features.inViableBand === (
        Math.abs(
          Number(features.approveUtility)
          - Number(features.rejectUtility),
        ) <= GOOD_VOTE_UTILITY_CONSTANTS.viableBand
      )
      && (
        features.seedBucket === undefined
        || features.seedBucket === 0
        || features.seedBucket === 1
      )
    )
    const validFeatures = features === undefined
      || validProposalFeatures
      || validVoteFeatures
    const role = score?.roleObjectiveFeatures as
      | Record<string, unknown>
      | undefined
    const roleKeys = [
      'version',
      'utilityVersion',
      'utilityProjectionVersion',
      'sourceObjectiveVersion',
      'role',
      'candidateId',
      'kind',
      'baseScorerVersion',
      'baseFeatureVersion',
      'baseValue',
      'roleValue',
      'survivorMeanRoleValue',
      'roleAdjustment',
      'combinedValue',
      'selectionMode',
      'viableBand',
      'inViableBand',
      'selectionAdjustment',
      ...(role?.seedBucket === undefined ? [] : ['seedBucket']),
      'utility',
    ]
    const validRole = role === undefined || (
      exactKeys(role, roleKeys)
      && role.version === ROLE_OBJECTIVE_SCORE_FEATURE_VERSION
      && role.utilityVersion === ROLE_OBJECTIVE_UTILITY_VERSION
      && role.utilityProjectionVersion === ROLE_UTILITY_PROJECTION_VERSION
      && role.sourceObjectiveVersion === ROLE_OBJECTIVE_MODEL_VERSION
      && ['merlin', 'percival'].includes(role.role as string)
      && role.candidateId === score.candidateId
      && ['propose', 'vote'].includes(role.kind as string)
      && role.baseScorerVersion === GOOD_PROPOSAL_VOTE_SCORER_VERSION
      && (
        role.baseFeatureVersion === GOOD_PROPOSAL_FEATURE_VERSION
        || role.baseFeatureVersion === GOOD_VOTE_FEATURE_VERSION
      )
      && typeof role.baseValue === 'number'
      && Number.isFinite(role.baseValue)
      && finiteProbability(role.roleValue)
      && finiteProbability(role.survivorMeanRoleValue)
      && typeof role.roleAdjustment === 'number'
      && Number.isFinite(role.roleAdjustment)
      && Math.abs(
        Number(role.roleAdjustment)
        - ROLE_OBJECTIVE_UTILITY_CONSTANTS.centeredAdjustmentScale
          * (
            Number(role.roleValue)
            - Number(role.survivorMeanRoleValue)
          ),
      ) <= 1e-12
      && typeof role.combinedValue === 'number'
      && Number.isFinite(role.combinedValue)
      && Math.abs(
        Number(role.combinedValue)
        - Number(role.baseValue)
        - Number(role.roleAdjustment),
      ) <= 1e-12
      && (
        role.selectionMode === 'top-composite'
        || role.selectionMode === 'seeded-composite-band'
      )
      && role.viableBand === ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
      && typeof role.inViableBand === 'boolean'
      && typeof role.selectionAdjustment === 'number'
      && Number.isFinite(role.selectionAdjustment)
      && (
        role.seedBucket === undefined
        || role.seedBucket === 0
        || role.seedBucket === 1
      )
      && !!role.utility
      && typeof role.utility === 'object'
      && !Array.isArray(role.utility)
    )
    const evilRole = score?.evilRoleObjectiveFeatures as
      | Record<string, unknown>
      | undefined
    const evilRoleKeys = [
      'version',
      'utilityVersion',
      'utilityProjectionVersion',
      'sourceObjectiveVersion',
      'role',
      'candidateId',
      'kind',
      'roleValue',
      'selectionMode',
      'viableBand',
      'inViableBand',
      'selectionAdjustment',
      ...(evilRole?.seedBucket === undefined ? [] : ['seedBucket']),
      'utility',
    ]
    const validEvilRole = evilRole === undefined || (
      exactKeys(evilRole, evilRoleKeys)
      && evilRole.version === EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION
      && evilRole.utilityVersion === EVIL_ROLE_OBJECTIVE_UTILITY_VERSION
      && evilRole.utilityProjectionVersion
        === EVIL_ROLE_UTILITY_PROJECTION_VERSION
      && evilRole.sourceObjectiveVersion
        === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      && ['assassin', 'morgana', 'mordred', 'minion', 'oberon']
        .includes(evilRole.role as string)
      && evilRole.candidateId === score.candidateId
      && ['propose', 'vote'].includes(evilRole.kind as string)
      && finiteProbability(evilRole.roleValue)
      && (
        evilRole.selectionMode === 'top-role-utility'
        || evilRole.selectionMode === 'seeded-role-utility-band'
      )
      && evilRole.viableBand === EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
      && typeof evilRole.inViableBand === 'boolean'
      && typeof evilRole.selectionAdjustment === 'number'
      && Number.isFinite(evilRole.selectionAdjustment)
      && (
        evilRole.seedBucket === undefined
        || evilRole.seedBucket === 0
        || evilRole.seedBucket === 1
      )
      && !!evilRole.utility
      && typeof evilRole.utility === 'object'
      && !Array.isArray(evilRole.utility)
    )
    const morganaRole = score?.morganaRoleObjectiveFeatures as
      | Record<string, unknown>
      | undefined
    const morganaRoleKeys = [
      'version',
      'utilityProjectionVersion',
      'sourceCounterfeitObjectiveVersion',
      'sourceEvilRoleUtilityVersion',
      'candidateId',
      'kind',
      'd2RoleValue',
      'maxD2RoleValue',
      'd2BandFloor',
      'd2ViableBand',
      'inD2ViableBand',
      'counterfeitValue',
      'counterfeitRank',
      'selectionMode',
      'seededVoteCounterfeitBand',
      'selectedByPolicy',
      ...(morganaRole?.seedBucket === undefined ? [] : ['seedBucket']),
      'utility',
    ]
    const validMorganaRole = morganaRole === undefined || (
      exactKeys(morganaRole, morganaRoleKeys)
      && Object.keys(morganaRole).length === morganaRoleKeys.length
      && morganaRole.version === MORGANA_ROLE_SCORE_FEATURE_VERSION
      && morganaRole.utilityProjectionVersion
        === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      && morganaRole.sourceCounterfeitObjectiveVersion
        === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
      && morganaRole.sourceEvilRoleUtilityVersion
        === EVIL_ROLE_UTILITY_PROJECTION_VERSION
      && morganaRole.candidateId === score.candidateId
      && ['propose', 'vote'].includes(String(morganaRole.kind))
      && finiteProbability(morganaRole.d2RoleValue)
      && finiteProbability(morganaRole.maxD2RoleValue)
      && typeof morganaRole.d2BandFloor === 'number'
      && Number.isFinite(morganaRole.d2BandFloor)
      && morganaRole.d2ViableBand
        === MORGANA_ROLE_UTILITY_CONSTANTS.d2ViableBand
      && typeof morganaRole.inD2ViableBand === 'boolean'
      && finiteProbability(morganaRole.counterfeitValue)
      && Number.isSafeInteger(morganaRole.counterfeitRank)
      && Number(morganaRole.counterfeitRank) >= 0
      && (
        morganaRole.selectionMode
          === 'top-counterfeit-within-d2-band'
        || morganaRole.selectionMode
          === 'seeded-near-equal-vote-within-d2-band'
      )
      && morganaRole.seededVoteCounterfeitBand
        === MORGANA_ROLE_UTILITY_CONSTANTS.seededVoteCounterfeitBand
      && typeof morganaRole.selectedByPolicy === 'boolean'
      && (
        morganaRole.seedBucket === undefined
        || morganaRole.seedBucket === 0
        || morganaRole.seedBucket === 1
      )
      && !!morganaRole.utility
      && typeof morganaRole.utility === 'object'
      && !Array.isArray(morganaRole.utility)
    )
    return !!score
      && typeof score === 'object'
      && typeof score.version === 'string'
      && score.version.length > 0
      && typeof score.candidateId === 'string'
      && score.candidateId.length > 0
      && typeof score.value === 'number'
      && Number.isFinite(score.value)
      && typeof score.viable === 'boolean'
      && stringArray(score.reasonCodes)
      && validFeatures
      && validRole
      && validEvilRole
      && validMorganaRole
      && Number(!!role) + Number(!!evilRole) + Number(!!morganaRole) <= 1
  })
}

function enumStringArray(
  value: unknown,
  allowed: readonly string[],
): value is readonly string[] {
  const choices = new Set(allowed)
  return stringArray(value) && value.every((entry) => choices.has(entry))
}

function isRoleObjectiveRole(role: string): role is RoleObjectiveRole {
  return role === 'merlin' || role === 'percival'
}

function validForcedPolicyResult(
  value: unknown,
): value is ForcedPolicyResult | undefined {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const forced = value as Record<string, unknown>
  const allowed = stringArray(forced.allowedCandidateIds)
    ? forced.allowedCandidateIds
    : undefined
  return (
    forced.version === FORCED_POLICY_VERSION
    && typeof forced.applied === 'boolean'
    && enumStringArray(forced.reasonCodes, FORCED_PLAY_REASON_CODES)
    && allowed !== undefined
    && allowed.length > 0
    && new Set(allowed).size === allowed.length
    && (
      forced.selectedCandidateId === undefined
      || (
        typeof forced.selectedCandidateId === 'string'
        && allowed.includes(forced.selectedCandidateId)
      )
    )
    && (
      forced.applied
        ? (forced.reasonCodes as readonly string[]).length > 0
        : (
            (forced.reasonCodes as readonly string[]).length === 0
            && forced.selectedCandidateId === undefined
          )
    )
  )
}

function validBeliefVersionRelation(trace: TraceValidationInput): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  return !components || components.belief === trace.beliefModelVersion
}

function validBeliefTraceRelations(trace: TraceValidationInput): boolean {
  if (!validBeliefVersionRelation(trace)) return false
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const provenance = trace.beliefProvenance as
    | Array<Record<string, unknown>>
    | undefined
  if (
    trace.quality === 'weighted'
    && (
      !provenance?.length
      || components?.factors === 'off'
    )
  ) {
    return false
  }
  const assessments = trace.beliefTeamAssessments as
    | Array<Record<string, unknown>>
    | undefined
  return !assessments?.some(
    (assessment) =>
      assessment.beliefModelVersion !== trace.beliefModelVersion
      || assessment.beliefThroughSeq !== trace.beliefThroughSeq
      || assessment.probabilitySemantics !== (
        trace.quality === 'weighted'
          ? 'weighted-joint'
          : 'uniform-feasible-joint'
      ),
  )
}

function validComposedTraceRelations(trace: TraceValidationInput): boolean {
  if (trace.candidateScores === undefined) {
    const components = trace.componentVersions as
      | Record<string, unknown>
      | undefined
    return trace.chosenCandidateId === undefined
      && trace.structuredCandidateId === undefined
      && trace.plannerCandidateId === undefined
      && trace.plannerReasonCodes === undefined
      && trace.communicationIntent === undefined
      && components?.policy !== 'composed-policy-v1'
      && (
        trace.agentMode === undefined
        || (
          trace.agentMode !== 'compatibility'
          && trace.agentMode !== 'structured-only'
          && trace.agentMode !== 'hybrid'
        )
      )
  }
  const scores = trace.candidateScores as Array<Record<string, unknown>>
  const ids = scores.map((score) => String(score.candidateId))
  if (new Set(ids).size !== ids.length) return false
  const components = trace.componentVersions as Record<string, unknown> | undefined
  const componentRun = trace.components as DecisionComponentRun | undefined
  if (
    components
    && scores.some((score) => score.version !== components.scorer)
  ) {
    return false
  }
  if (
    trace.agentMode !== undefined
    && (
      !components
      || (
        trace.agentMode === 'compatibility'
          ? (
              components.scorer !== CANDIDATE_SCORER_VERSION
              || components.planner !== 'planner-off'
            )
          : trace.agentMode === 'structured-only'
            ? (
                components.scorer === CANDIDATE_SCORER_VERSION
                || components.planner !== 'planner-off'
              )
            : trace.agentMode === 'hybrid'
              ? components.planner === 'planner-off'
              : true
      )
    )
  ) {
    return false
  }
  if (
    scores.some((score) => {
      const features = score.features as Record<string, unknown> | undefined
      if (features === undefined) return false
      if (
        features.beliefModelVersion !== trace.beliefModelVersion
        || features.beliefThroughSeq !== trace.beliefThroughSeq
      ) {
        return true
      }
      if (features.version === GOOD_PROPOSAL_FEATURE_VERSION) {
        const role = score.roleObjectiveFeatures as
          | Record<string, unknown>
          | undefined
        return (
          ![
            GOOD_PROPOSAL_SCORER_VERSION,
            GOOD_PROPOSAL_VOTE_SCORER_VERSION,
            GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
            ROLE_OBJECTIVE_SCORER_VERSION,
            ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          ].includes(score.version as typeof GOOD_PROPOSAL_SCORER_VERSION)
          || score.candidateId !== (
            `${LEGAL_CANDIDATE_VERSION}:propose:`
            + (features.team as number[]).join(',')
          )
          || score.value !== (
            role
              ? (
                  score.value === -Number.MAX_SAFE_INTEGER
                    ? -Number.MAX_SAFE_INTEGER
                    : Number(role.combinedValue)
                      + Number(role.selectionAdjustment)
                )
              : score.viable
                ? features.cleanProbability
                : -Number.MAX_SAFE_INTEGER
          )
        )
      }
      if (features.version === GOOD_VOTE_FEATURE_VERSION) {
        const role = score.roleObjectiveFeatures as
          | Record<string, unknown>
          | undefined
        const vote = String(score.candidateId).split(':').at(-1)
        const base = vote === 'approve'
          ? features.approveUtility
          : vote === 'reject' ? features.rejectUtility : undefined
        return (
          ![
            GOOD_PROPOSAL_VOTE_SCORER_VERSION,
            GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
            ROLE_OBJECTIVE_SCORER_VERSION,
            ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          ].includes(score.version as typeof GOOD_PROPOSAL_VOTE_SCORER_VERSION)
          || base === undefined
          || features.baseUtility !== base
          || (
            score.value !== -Number.MAX_SAFE_INTEGER
            && score.value !== (
              role
                ? Number(role.combinedValue)
                  + Number(role.selectionAdjustment)
                : (base as number) + (features.selectionAdjustment as number)
            )
          )
        )
      }
      return true
    })
  ) {
    return false
  }
  const chosen = trace.chosenCandidateId
  if (
    typeof chosen !== 'string'
    || !scores.some(
      (score) => score.candidateId === chosen && score.viable === true,
    )
  ) {
    return false
  }
  const chosenScore = scores.find((score) => score.candidateId === chosen)
  const structured = trace.structuredCandidateId
  const plannerReasons = trace.plannerReasonCodes
  const chosenFeatures = chosenScore?.features as
    | Record<string, unknown>
    | undefined
  const action = trace.action as Record<string, unknown>
  const relevantTeam = trace.relevantTeam as Record<string, unknown> | undefined
  const featureScores = scores.filter((score) => score.features !== undefined)
  const intent = trace.communicationIntent as
    | Record<string, unknown>
    | undefined
  const phase4c = trace.decisionPlanVersion === DECISION_PLAN_VERSION
  const speechAction =
    action.kind === 'discuss'
    || action.kind === 'propose'
    || (action.kind === 'finalize' && action.stick === false)
  if (
    phase4c
    && (
      trace.agentMode !== 'compatibility'
      && trace.agentMode !== 'structured-only'
      && trace.agentMode !== 'hybrid'
    )
  ) {
    return false
  }
  if (
    phase4c
    && (
      (
        structured === undefined
        && plannerReasons !== undefined
      )
      || (
        structured !== undefined
        && (
          typeof structured !== 'string'
          || !scores.some(
            (score) =>
              score.candidateId === structured
              && score.viable === true,
          )
          || (
            trace.agentMode !== 'hybrid'
            && structured !== chosen
          )
          || (
            plannerReasons !== undefined
            && (
              !stringArray(plannerReasons)
              || new Set(plannerReasons).size !== plannerReasons.length
              || trace.plannerCandidateId !== chosen
              || !chosenScore
              || plannerReasons.some(
                (reason) => !(
                  trace.agentMode === 'hybrid'
                  && chosen !== structured
                    ? plannerOverrideReasonCodes(
                        chosenScore as unknown as CandidateScore,
                        scores as unknown as CandidateScore[],
                      )
                    : selectedStrategicReasonCodes(
                        chosenScore as unknown as CandidateScore,
                        scores as unknown as CandidateScore[],
                      )
                ).includes(reason),
              )
            )
          )
          || (
            trace.agentMode === 'hybrid'
            && chosen !== structured
            && (
              trace.plannerCandidateId !== chosen
              || !Array.isArray(plannerReasons)
              || plannerReasons.length === 0
              || !chosenScore
              || plannerReasons.some(
                (reason) =>
                  !plannerOverrideReasonCodes(
                    chosenScore as unknown as CandidateScore,
                    scores as unknown as CandidateScore[],
                  ).includes(reason),
              )
            )
          )
        )
      )
    )
  ) {
    return false
  }
  if (phase4c && speechAction !== (intent !== undefined)) {
    return false
  }
  if (intent !== undefined) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
      return false
    }
    const expectedChannel =
      action.kind === 'discuss' ? 'discussion'
        : action.kind === 'propose' ? 'proposal-pitch'
          : action.kind === 'finalize' && action.stick === false
            ? 'revision-reason'
            : undefined
    const facts = trace.factCodes as string[]
    const projection = communicationFactProjection(facts)
    const strategicReasons = intent.strategicReasonCodes
    const claimCodes = intent.claimCodes
    const decisionLayerRun =
      trace.decisionLayerRun as Record<string, unknown> | undefined
    const decisionLayerSurface =
      decisionLayerRun?.surface as Record<string, unknown> | undefined
    const committedPolicyReasons = stringArray(
      decisionLayerSurface?.reasonCodes,
    )
      ? decisionLayerSurface.reasonCodes
      : []
    const availableStrategicReasons = [
      ...(chosenScore
        ? selectedStrategicReasonCodes(
            chosenScore as unknown as CandidateScore,
            scores as unknown as CandidateScore[],
          )
        : []),
      ...committedPolicyReasons,
    ]
    if (
      !exactKeys(intent, [
        'version',
        'channel',
        'desiredLean',
        'targetSeats',
        'claimCodes',
        'safeFactCodes',
        'conceal',
        'strategicReasonCodes',
        'uncertainty',
        'tone',
      ])
      ||
      intent.version !== COMMUNICATION_INTENT_VERSION
      || intent.channel !== expectedChannel
      || !seatArray(intent.targetSeats)
      || new Set(intent.targetSeats as number[]).size
        !== (intent.targetSeats as number[]).length
      || !Array.isArray(claimCodes)
      || new Set(claimCodes).size !== claimCodes.length
      || !claimCodes.every((code) =>
        typeof code === 'string'
        && COMMUNICATION_CLAIM_CODES.includes(code as never))
      || !stringArray(intent.safeFactCodes)
      || new Set(intent.safeFactCodes as string[]).size
        !== (intent.safeFactCodes as string[]).length
      || !isDeepStrictEqual(intent.safeFactCodes, projection.safeFactCodes)
      || !stringArray(intent.conceal)
      || new Set(intent.conceal as string[]).size
        !== (intent.conceal as string[]).length
      || !isDeepStrictEqual(intent.conceal, projection.conceal)
      || !stringArray(strategicReasons)
      || new Set(strategicReasons).size !== strategicReasons.length
      || !chosenScore
      || strategicReasons.some(
        (reason) => !availableStrategicReasons.includes(reason),
      )
      || intent.tone !== 'natural'
      || (
        action.kind === 'discuss'
          ? (
              intent.desiredLean !== undefined
              && intent.desiredLean !== action.lean
            )
          : intent.desiredLean !== undefined
      )
    ) {
      return false
    }
    const uncertainty = intent.uncertainty as
      | Record<string, unknown>
      | undefined
    const expectsUncertainty =
      chosenFeatures?.version === GOOD_PROPOSAL_FEATURE_VERSION
      || chosenFeatures?.version === GOOD_VOTE_FEATURE_VERSION
    if (expectsUncertainty !== (uncertainty !== undefined)) {
      return false
    }
    if (uncertainty !== undefined) {
      const chosenRole = chosenScore?.roleObjectiveFeatures as
        | Record<string, unknown>
        | undefined
      if (
        !exactKeys(
          uncertainty,
          uncertainty.kind === 'role-composite-decision'
            ? [
                'version',
                'kind',
                'semantics',
                'beliefModelVersion',
                'beliefThroughSeq',
                'baseKind',
                'compositeUtilityGap',
              ]
            : uncertainty.kind === 'selected-team-clean'
            ? [
                'version',
                'kind',
                'semantics',
                'beliefModelVersion',
                'beliefThroughSeq',
                'cleanProbability',
                'residualProbability',
              ]
            : [
                'version',
                'kind',
                'semantics',
                'beliefModelVersion',
                'beliefThroughSeq',
                'currentCleanProbability',
                'bestAlternativeCleanProbability',
                'utilityGap',
              ],
        )
        ||
        uncertainty.version !== POSTERIOR_UNCERTAINTY_VERSION
        || uncertainty.semantics !== chosenFeatures?.semantics
        || !chosenFeatures
        || uncertainty.beliefModelVersion
          !== chosenFeatures.beliefModelVersion
        || uncertainty.beliefThroughSeq !== trace.beliefThroughSeq
      ) {
        return false
      }
      if (chosenRole) {
        const alternatives = scores.filter(
          (score) =>
            score.candidateId !== chosen
            && score.value !== -Number.MAX_SAFE_INTEGER
            && score.roleObjectiveFeatures !== undefined,
        )
        const expectedGap = alternatives.length
          ? Math.min(...alternatives.map((score) =>
              Math.abs(
                Number(chosenRole.combinedValue)
                - Number(
                  (
                    score.roleObjectiveFeatures as Record<string, unknown>
                  ).combinedValue,
                ),
              )))
          : 1
        if (
          uncertainty.kind !== 'role-composite-decision'
          || uncertainty.baseKind !== (
            chosenFeatures.version === GOOD_PROPOSAL_FEATURE_VERSION
              ? 'proposal-team-clean'
              : 'vote-current-versus-alternative'
          )
          || typeof uncertainty.compositeUtilityGap !== 'number'
          || !Number.isFinite(uncertainty.compositeUtilityGap)
          || Math.abs(
            Number(uncertainty.compositeUtilityGap) - expectedGap,
          ) > 1e-12
        ) return false
      } else if (chosenFeatures.version === GOOD_PROPOSAL_FEATURE_VERSION) {
        if (
          uncertainty.kind !== 'selected-team-clean'
          || !finiteProbability(uncertainty.cleanProbability)
          || !finiteProbability(uncertainty.residualProbability)
          || uncertainty.cleanProbability
            !== chosenFeatures.cleanProbability
          || Math.abs(
            (uncertainty.residualProbability as number)
            - (1 - (chosenFeatures.cleanProbability as number)),
          ) > 1e-12
        ) {
          return false
        }
      } else if (chosenFeatures.version === GOOD_VOTE_FEATURE_VERSION) {
        if (
          uncertainty.kind !== 'current-versus-alternative-team-clean'
          || !finiteProbability(uncertainty.currentCleanProbability)
          || !finiteProbability(
            uncertainty.bestAlternativeCleanProbability,
          )
          || typeof uncertainty.utilityGap !== 'number'
          || !Number.isFinite(uncertainty.utilityGap)
          || uncertainty.utilityGap < 0
          || uncertainty.currentCleanProbability
            !== chosenFeatures.currentCleanProbability
          || uncertainty.bestAlternativeCleanProbability
            !== chosenFeatures.bestAlternativeCleanProbability
          || Math.abs(
            (uncertainty.utilityGap as number)
            - Math.abs(
              (chosenFeatures.approveUtility as number)
              - (chosenFeatures.rejectUtility as number),
            ),
          ) > 1e-12
        ) {
          return false
        }
      } else {
        return false
      }
    }
  }
  const proposalFeatureScores = featureScores.filter(
    (score) =>
      (score.features as Record<string, unknown>).version
      === GOOD_PROPOSAL_FEATURE_VERSION,
  )
  const voteFeatureScores = featureScores.filter(
    (score) =>
      (score.features as Record<string, unknown>).version
      === GOOD_VOTE_FEATURE_VERSION,
  )
  const roleFeatureScores = scores.filter(
    (score) => score.roleObjectiveFeatures !== undefined,
  )
  if (roleFeatureScores.length > 0) {
    const roleProjection = (
      componentRun
        ? componentPayload(componentRun, GOOD_ROLE_UTILITY_COMPONENT)
        : trace.privateRoleUtility
    ) as Record<string, unknown> | undefined
    const forced = trace.forcedPolicyResult as
      | Record<string, unknown>
      | undefined
    if (
      roleFeatureScores.length !== scores.length
      || !roleProjection
      || !forced
      || !Array.isArray(roleProjection.assessments)
      || ![
        ROLE_OBJECTIVE_SCORER_VERSION,
        ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ].includes(components?.scorer as typeof ROLE_OBJECTIVE_SCORER_VERSION)
    ) return false
    const utilities = new Map(
      (roleProjection.assessments as Array<Record<string, unknown>>)
        .map((assessment) => [assessment.candidateId, assessment]),
    )
    const allowed = new Set(forced.allowedCandidateIds as string[])
    const allowedRole = roleFeatureScores.filter((score) =>
      allowed.has(score.candidateId as string))
    if (!allowedRole.length) return false
    const mean = allowedRole.reduce(
      (sum, score) =>
        sum + Number(
          (score.roleObjectiveFeatures as Record<string, unknown>).roleValue,
        ),
      0,
    ) / allowedRole.length
    for (const score of roleFeatureScores) {
      const role = score.roleObjectiveFeatures as Record<string, unknown>
      const utility = utilities.get(score.candidateId)
      const base = score.features as Record<string, unknown>
      const expectedBase = base.version === GOOD_PROPOSAL_FEATURE_VERSION
        ? base.cleanProbability
        : base.baseUtility
      if (
        !utility
        || !isDeepStrictEqual(role.utility, utility)
        || role.role !== roleProjection.role
        || role.kind !== (trace.request as DecisionRequest).kind
        || role.baseValue !== expectedBase
        || Math.abs(Number(role.survivorMeanRoleValue) - mean) > 1e-12
      ) return false
    }
    const mode = (
      roleFeatureScores[0].roleObjectiveFeatures as Record<string, unknown>
    ).selectionMode
    const expectedScorer = mode === 'seeded-composite-band'
      ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      : ROLE_OBJECTIVE_SCORER_VERSION
    const maxCombined = Math.max(...allowedRole.map((score) =>
      Number(
        (score.roleObjectiveFeatures as Record<string, unknown>).combinedValue,
      )))
    const canonicalTop = allowedRole
      .filter((score) =>
        (score.roleObjectiveFeatures as Record<string, unknown>)
          .combinedValue === maxCombined)
      .map((score) => score.candidateId as string)
      .sort(compareCandidateIds)[0]
    const viable = roleFeatureScores.filter((score) => score.viable === true)
    const selectedByValue = viable.slice().sort((left, right) =>
      Number(right.value) - Number(left.value)
      || compareCandidateIds(
        String(left.candidateId),
        String(right.candidateId),
      ))[0]
    const forcedSelected = forced.selectedCandidateId as string | undefined
    const bandActive =
      !forcedSelected
      && mode === 'seeded-composite-band'
      && (trace.request as DecisionRequest).kind === 'vote'
      && allowedRole.length === 2
      && Math.abs(
        Number(
          (allowedRole[0].roleObjectiveFeatures as Record<string, unknown>)
            .combinedValue,
        )
        - Number(
          (allowedRole[1].roleObjectiveFeatures as Record<string, unknown>)
            .combinedValue,
        ),
      ) <= ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
    const firstRole =
      roleFeatureScores[0].roleObjectiveFeatures as Record<string, unknown>
    if (
      components?.scorer !== expectedScorer
      || !selectedByValue
      || selectedByValue.candidateId !== structured
      || roleFeatureScores.some((score) => {
        const role = score.roleObjectiveFeatures as Record<string, unknown>
        return role.selectionMode !== mode
          || role.inViableBand !== (
            (trace.request as DecisionRequest).kind === 'vote'
            && allowedRole.length === 2
            && Math.abs(
              Number(
                (allowedRole[0].roleObjectiveFeatures as Record<string, unknown>)
                  .combinedValue,
              )
              - Number(
                (allowedRole[1].roleObjectiveFeatures as Record<string, unknown>)
                  .combinedValue,
              ),
            ) <= ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
          )
          || (
            !allowed.has(score.candidateId as string)
            && (
              score.value !== -Number.MAX_SAFE_INTEGER
              || score.viable === true
            )
          )
      })
      || (
        forcedSelected
          ? (
              viable.length !== 1
              || viable[0].candidateId !== forcedSelected
              || roleFeatureScores.some((score) =>
                (score.roleObjectiveFeatures as Record<string, unknown>)
                  .selectionAdjustment !== 0
                || (score.roleObjectiveFeatures as Record<string, unknown>)
                  .seedBucket !== undefined)
            )
          : bandActive
            ? (
                viable.length !== 2
                || ![0, 1].includes(firstRole.seedBucket as number)
                || roleFeatureScores.some((score) =>
                  (
                    score.roleObjectiveFeatures as Record<string, unknown>
                  ).seedBucket !== firstRole.seedBucket
                  || Math.abs(
                    Number(
                      (
                        score.roleObjectiveFeatures as Record<string, unknown>
                      ).selectionAdjustment,
                    )
                    - (
                      score.candidateId === (
                        firstRole.seedBucket === 0
                          ? `${LEGAL_CANDIDATE_VERSION}:vote:approve`
                          : `${LEGAL_CANDIDATE_VERSION}:vote:reject`
                      )
                        ? maxCombined - Number(
                            (
                              score.roleObjectiveFeatures as
                                Record<string, unknown>
                            ).combinedValue,
                          ) + 1e-9
                        : 0
                    ),
                  ) > 1e-15)
              )
            : (
                viable.length !== 1
                || viable[0].candidateId !== canonicalTop
                || roleFeatureScores.some((score) =>
                  (score.roleObjectiveFeatures as Record<string, unknown>)
                    .selectionAdjustment !== 0
                  || (score.roleObjectiveFeatures as Record<string, unknown>)
                    .seedBucket !== undefined)
              )
      )
    ) return false
  }
  const evilRoleFeatureScores = scores.filter(
    (score) => score.evilRoleObjectiveFeatures !== undefined,
  )
  if (evilRoleFeatureScores.length > 0) {
    const projection = (
      componentRun
        ? componentPayload(componentRun, EVIL_ROLE_UTILITY_COMPONENT)
        : trace.privateEvilRoleUtility
    ) as Record<string, unknown> | undefined
    const forced = trace.forcedPolicyResult as
      | Record<string, unknown>
      | undefined
    if (
      evilRoleFeatureScores.length !== scores.length
      || !projection
      || !forced
      || !Array.isArray(projection.assessments)
      || ![
        EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
        EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ].includes(
        components?.scorer as typeof EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
      )
    ) return false
    const utilities = new Map(
      (projection.assessments as Array<Record<string, unknown>>)
        .map((assessment) => [assessment.candidateId, assessment]),
    )
    const allowed = new Set(forced.allowedCandidateIds as string[])
    const allowedRows = evilRoleFeatureScores.filter((score) =>
      allowed.has(score.candidateId as string))
    if (!allowedRows.length) return false
    for (const score of evilRoleFeatureScores) {
      const feature =
        score.evilRoleObjectiveFeatures as Record<string, unknown>
      const utility = utilities.get(score.candidateId)
      if (
        !utility
        || !isDeepStrictEqual(feature.utility, utility)
        || feature.role !== projection.role
        || feature.kind !== (trace.request as DecisionRequest).kind
        || feature.roleValue !== utility.roleValue
      ) return false
    }
    const first =
      evilRoleFeatureScores[0].evilRoleObjectiveFeatures as
        Record<string, unknown>
    const mode = first.selectionMode
    const expectedScorer = mode === 'seeded-role-utility-band'
      ? EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      : EVIL_ROLE_OBJECTIVE_SCORER_VERSION
    const maxValue = Math.max(...allowedRows.map((score) =>
      Number(
        (score.evilRoleObjectiveFeatures as Record<string, unknown>)
          .roleValue,
      )))
    const canonicalTop = allowedRows
      .filter((score) =>
        (score.evilRoleObjectiveFeatures as Record<string, unknown>)
          .roleValue === maxValue)
      .map((score) => score.candidateId as string)
      .sort(compareCandidateIds)[0]
    const viable = evilRoleFeatureScores.filter(
      (score) => score.viable === true,
    )
    const forcedSelected = forced.selectedCandidateId as string | undefined
    const inBand =
      (trace.request as DecisionRequest).kind === 'vote'
      && allowedRows.length === 2
      && Math.abs(
        Number(
          (allowedRows[0].evilRoleObjectiveFeatures as Record<string, unknown>)
            .roleValue,
        ) - Number(
          (allowedRows[1].evilRoleObjectiveFeatures as Record<string, unknown>)
            .roleValue,
        ),
      ) <= EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
    const bandActive =
      !forcedSelected
      && mode === 'seeded-role-utility-band'
      && inBand
    const seededBucket = first.seedBucket
    if (
      components?.scorer !== expectedScorer
      || evilRoleFeatureScores.some((score) => {
        const feature =
          score.evilRoleObjectiveFeatures as Record<string, unknown>
        return feature.selectionMode !== mode
          || feature.inViableBand !== inBand
          || (
            !allowed.has(score.candidateId as string)
            && (
              score.value !== -Number.MAX_SAFE_INTEGER
              || score.viable === true
            )
          )
      })
      || (
        forcedSelected
          ? (
              viable.length !== 1
              || viable[0].candidateId !== forcedSelected
              || evilRoleFeatureScores.some((score) => {
                const feature = score.evilRoleObjectiveFeatures as
                  Record<string, unknown>
                return feature.seedBucket !== undefined
                  || feature.selectionAdjustment !== 0
              })
            )
          : bandActive
            ? (
                viable.length !== 2
                || (seededBucket !== 0 && seededBucket !== 1)
                || evilRoleFeatureScores.some((score) => {
                  const feature = score.evilRoleObjectiveFeatures as
                    Record<string, unknown>
                  const selectedId = seededBucket === 0
                    ? `${LEGAL_CANDIDATE_VERSION}:vote:approve`
                    : `${LEGAL_CANDIDATE_VERSION}:vote:reject`
                  return feature.seedBucket !== seededBucket
                    || Math.abs(
                      Number(feature.selectionAdjustment)
                        - (
                          score.candidateId === selectedId
                            ? maxValue - Number(feature.roleValue) + 1e-9
                            : 0
                        ),
                    ) > 1e-15
                })
              )
            : (
                viable.length !== 1
                || viable[0].candidateId !== canonicalTop
                || evilRoleFeatureScores.some((score) => {
                  const feature = score.evilRoleObjectiveFeatures as
                    Record<string, unknown>
                  return feature.seedBucket !== undefined
                    || feature.selectionAdjustment !== 0
                })
              )
      )
    ) return false
  }
  const morganaRoleFeatureScores = scores.filter(
    (score) => score.morganaRoleObjectiveFeatures !== undefined,
  )
  if (morganaRoleFeatureScores.length > 0) {
    const projection = (
      componentRun
        ? componentPayload(
            componentRun,
            components?.scorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
              ? MORGANA_ROLE_UTILITY_SEEDED_COMPONENT
              : MORGANA_ROLE_UTILITY_COMPONENT,
          )
        : trace.privateMorganaRoleUtility
    ) as Record<string, unknown> | undefined
    const projectionRows = Array.isArray(projection?.candidates)
      ? projection.candidates as Record<string, unknown>[]
      : []
    const rows = new Map(
      projectionRows.map((row) => [row.candidateId as string, row]),
    )
    const selectedId = projection?.selectedCandidateId
    const mode = projection?.selectionMode
    const expectedScorer =
      mode === 'seeded-near-equal-vote-within-d2-band'
        ? MORGANA_ROLE_SEEDED_SCORER_VERSION
        : MORGANA_ROLE_SCORER_VERSION
    if (
      !projection
      || !validatePrivateMorganaRoleUtilityProjection(projection)
      || morganaRoleFeatureScores.length !== scores.length
      || rows.size !== scores.length
      || components?.scorer !== expectedScorer
      || structured !== selectedId
      || chosen !== selectedId
      || morganaRoleFeatureScores.filter(
        (score) => score.viable === true,
      ).length !== 1
      || morganaRoleFeatureScores.some((score) => {
        const row = rows.get(score.candidateId as string)
        const feature = score.morganaRoleObjectiveFeatures as
          Record<string, unknown>
        if (!row) return true
        const selected = score.candidateId === selectedId
        return (
          score.viable !== selected
          || score.value !== (
            row.forcedAllowed === true
              ? row.counterfeitValue
              : -Number.MAX_SAFE_INTEGER
          )
          || feature.candidateId !== row.candidateId
          || feature.kind !== row.kind
          || feature.d2RoleValue !== row.d2RoleValue
          || feature.maxD2RoleValue !== projection.maxD2RoleValue
          || feature.d2BandFloor !== projection.d2BandFloor
          || feature.inD2ViableBand !== row.inD2ViableBand
          || feature.counterfeitValue !== row.counterfeitValue
          || feature.counterfeitRank !== row.counterfeitRank
          || feature.selectionMode !== mode
          || feature.selectedByPolicy !== selected
          || feature.seedBucket !== projection.seedBucket
          || !isDeepStrictEqual(feature.utility, row)
        )
      })
    ) return false
  }
  if (
    proposalFeatureScores.length > 0
    && (
      action.kind !== 'propose'
      || proposalFeatureScores.length !== scores.length
      || !chosenFeatures
    )
  ) {
    return false
  }
  if (
    chosenFeatures?.version === GOOD_PROPOSAL_FEATURE_VERSION
  ) {
    const actionTeam = [...(action.team as number[])].sort((left, right) =>
      left - right)
    if (
      !isDeepStrictEqual(chosenFeatures.team, actionTeam)
      || !relevantTeam
      || !isDeepStrictEqual(relevantTeam.team, actionTeam)
      || relevantTeam.cleanProbability !== chosenFeatures.cleanProbability
      || !isDeepStrictEqual(
        relevantTeam.evilCountDistribution,
        chosenFeatures.evilCountDistribution,
      )
    ) {
      return false
    }
  }
  if (voteFeatureScores.length > 0) {
    if (
      action.kind !== 'vote'
      || voteFeatureScores.length !== scores.length
      || scores.length !== 2
      || !chosenFeatures
      || chosenFeatures.version !== GOOD_VOTE_FEATURE_VERSION
      || chosen !== `${LEGAL_CANDIDATE_VERSION}:vote:${action.vote}`
      || !relevantTeam
      || !isDeepStrictEqual(
        relevantTeam.team,
        chosenFeatures.currentTeam,
      )
      || relevantTeam.cleanProbability
        !== chosenFeatures.currentCleanProbability
      || !isDeepStrictEqual(
        relevantTeam.evilCountDistribution,
        chosenFeatures.currentEvilCountDistribution,
      )
    ) {
      return false
    }
    const first = voteFeatureScores[0].features as Record<string, unknown>
    const request = trace.request as DecisionRequest
    const boardScore = first.boardScore as Record<string, unknown>
    const sharedKeys = [
      'utilityVersion', 'situationVersion', 'semantics',
      'beliefModelVersion', 'beliefThroughSeq', 'currentTeam',
      'currentCleanProbability', 'currentEvilCountDistribution',
      'bestAlternativeCandidateId', 'bestAlternativeTeam',
      'bestAlternativeCleanProbability',
      'bestAlternativeEvilCountDistribution', 'boardScore',
      'proposalNumber', 'rejectionsBeforeHammer', 'futureQuestsRemain',
      'stake', 'alternativeRealization', 'hammerPenalty',
      'informationBonus', 'approveUtility', 'rejectUtility',
      'selectionMode', 'viableBand', 'inViableBand', 'seedBucket',
    ]
    if (
      voteFeatureScores.some((score) => {
        const features = score.features as Record<string, unknown>
        return sharedKeys.some(
          (key) => !isDeepStrictEqual(features[key], first[key]),
        )
      })
      || first.proposalNumber !== request.proposalNum
      || first.rejectionsBeforeHammer
        !== MAX_PROPOSALS - request.proposalNum
      || first.futureQuestsRemain !== (
        request.round < 5
        && boardScore.good !== QUESTS_TO_WIN - 1
        && boardScore.evil !== QUESTS_TO_WIN - 1
      )
    ) {
      return false
    }
    if (roleFeatureScores.length > 0) {
      // Role-composite viability was host-recomputed above. The preserved
      // Phase-4 vote features remain attributable but do not own selection.
    } else {
    const mode = first.selectionMode
    const expectedScorer = mode === 'seeded-band'
      ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      : GOOD_PROPOSAL_VOTE_SCORER_VERSION
    const available = voteFeatureScores.filter(
      (score) => score.value !== -Number.MAX_SAFE_INTEGER,
    )
    const viable = voteFeatureScores.filter((score) => score.viable === true)
    const maxBase = Math.max(
      ...available.map(
        (score) =>
          (score.features as Record<string, unknown>).baseUtility as number,
      ),
    )
    const canonicalTop = available
      .filter(
        (score) =>
          (score.features as Record<string, unknown>).baseUtility === maxBase,
      )
      .map((score) => score.candidateId as string)
      .sort(compareCandidateIds)[0]
    const selectedByValue = viable
      .slice()
      .sort((left, right) =>
        (right.value as number) - (left.value as number)
        || compareCandidateIds(
          String(left.candidateId),
          String(right.candidateId),
        ))[0]
    const bandActive =
      mode === 'seeded-band'
      && first.inViableBand === true
      && first.seedBucket !== undefined
    const seededCandidateId = first.seedBucket === 0
      ? `${LEGAL_CANDIDATE_VERSION}:vote:approve`
      : `${LEGAL_CANDIDATE_VERSION}:vote:reject`
    if (
      components?.scorer !== expectedScorer
      || !available.length
      || !selectedByValue
      || selectedByValue.candidateId !== structured
      || (
        bandActive
          ? (
              available.length !== 2
              || viable.length !== 2
              || voteFeatureScores.some((score) => {
                const features =
                  score.features as Record<string, unknown>
                const expectedAdjustment =
                  score.candidateId === seededCandidateId
                    ? maxBase - (features.baseUtility as number) + 1e-9
                    : 0
                return Math.abs(
                  (features.selectionAdjustment as number)
                  - expectedAdjustment,
                ) > 1e-15
              })
            )
          : (
              viable.length !== 1
              || viable[0].candidateId !== canonicalTop
              || voteFeatureScores.some(
                (score) =>
                  (
                    score.features as Record<string, unknown>
                  ).selectionAdjustment !== 0
                  || (
                    score.features as Record<string, unknown>
                  ).seedBucket !== undefined,
              )
            )
      )
    ) {
      return false
    }
    }
  }
  const forced = trace.forcedPolicyResult as Record<string, unknown> | undefined
  if (forced) {
    const allowed = new Set(forced.allowedCandidateIds as string[])
    if ([...allowed].some((candidateId) => !ids.includes(candidateId))) {
      return false
    }
    if (scores.some((score) => score.viable === true && !allowed.has(
      score.candidateId as string,
    ))) {
      return false
    }
    if (
      forced.selectedCandidateId !== undefined
      && forced.selectedCandidateId !== chosen
    ) {
      return false
    }
    if (
      forced.applied === false
      && (
        allowed.size !== ids.length
        || ids.some((candidateId) => !allowed.has(candidateId))
      )
    ) {
      return false
    }
    const traceReasons = new Set(trace.reasonCodes as string[])
    if (
      (forced.reasonCodes as string[]).some(
        (reason) => !traceReasons.has(reason),
      )
    ) {
      return false
    }
  }
  return true
}

const PRODUCTION_COMPONENT_REGISTRY = createProductionComponentRegistry({
  goodObjectiveAllDecisionKinds: true,
})
const PRODUCTION_DECISION_LAYER_REGISTRY =
  createConfiguredDecisionLayerRegistry()
const DECISION_LAYER_ADMISSION =
  createDecisionLayerAdmissionAuthority()

const COMPONENT_FAILURE_CODES = new Set([
  'construction-ineligible',
  'applicability-failed',
  'dependency-unavailable',
  'host-input-unavailable',
  'host-input-invalid',
  'execution-failed',
  'malformed-result',
  'tag-mismatch',
  'payload-json-unsafe',
  'payload-too-large',
  'detached-validation-failed',
  'host-admission-failed',
])

function componentKey(value: { id: string; version: string }): string {
  return `${value.id}@${value.version}`
}

function exactGenericRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || isProxy(value)
  ) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual(
      [...ownKeys as string[]].sort(),
      [...keys].sort(),
    )
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return keys.every((key) => {
    const descriptor = descriptors[key]
    return !!descriptor
      && descriptor.enumerable === true
      && 'value' in descriptor
      && descriptor.get === undefined
      && descriptor.set === undefined
  })
}

function exactGenericArray(value: unknown): value is unknown[] {
  if (
    !Array.isArray(value)
    || isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
  ) return false
  const expectedKeys = [
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    'length',
  ]
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual(
      [...ownKeys as string[]].sort(),
      [...expectedKeys].sort(),
    )
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !length
    || !('value' in length)
    || length.value !== value.length
    || length.enumerable !== false
    || Object.hasOwn(length, 'get')
    || Object.hasOwn(length, 'set')
  ) return false
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)]
    if (!(
      !!descriptor
      && descriptor.enumerable === true
      && 'value' in descriptor
      && !Object.hasOwn(descriptor, 'get')
      && !Object.hasOwn(descriptor, 'set')
    )) return false
  }
  return true
}

function validDecisionTraceProvenance(trace: DecisionTrace): boolean {
  const marked =
    trace.componentVersions?.decisionComponents
      === DECISION_COMPONENT_RUN_VERSION
  if (trace.version === DECISION_TRACE_VERSION) {
    return (
      trace.componentPlan === undefined
      && trace.components === undefined
      && !marked
    )
  }
  if (trace.version === COMPONENT_DECISION_TRACE_VERSION) {
    return (
      trace.componentPlan !== undefined
      && trace.components !== undefined
      && marked
    )
  }
  return false
}

const MIGRATED_FLAT_DEGRADATIONS = new Set([
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_UTILITY_DEGRADATION,
  MORGANA_COUNTERFEIT_DEGRADATION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
])

function currentTraceOmitsMigratedFlatState(
  trace: DecisionTrace,
): boolean {
  if (trace.version === DECISION_TRACE_VERSION) return true
  const versions = trace.componentVersions
  return (
    trace.privateRoleObjective === undefined
    && trace.privateEvilRoleObjective === undefined
    && trace.privateRoleUtility === undefined
    && trace.privateEvilRoleUtility === undefined
    && trace.publicMorganaCounterfeitRead === undefined
    && trace.privateMorganaCounterfeitObjective === undefined
    && trace.privateMorganaRoleUtility === undefined
    && versions?.roleObjective === undefined
    && versions?.roleUtility === undefined
    && versions?.evilRoleUtility === undefined
    && versions?.morganaCounterfeitPublicRead === undefined
    && versions?.morganaCounterfeitObjective === undefined
    && versions?.configuredMorganaCounterfeitObjective === undefined
    && versions?.morganaRoleUtility === undefined
    && versions?.configuredMorganaRoleUtility === undefined
    && !trace.degradation.some((code) =>
      MIGRATED_FLAT_DEGRADATIONS.has(code))
  )
}

function expectedNativeTraceStages(
  componentId: string,
  trace: DecisionTrace,
): readonly string[] | undefined {
  const strategic = trace.decisionLayerRun?.journal.some(
    (entry) =>
      entry.status === 'applied'
      && entry.attributedComponents.some(
        (component) => component.id === componentId,
      ),
  )
  if (strategic) return ['strategic-decision']
  if (!NATIVE_SCORE_COMPONENT_IDS.has(componentId)) return undefined
  const scores = trace.candidateScores ?? []
  const goodRole =
    componentId === GOOD_ROLE_OBJECTIVE_COMPONENT.id
    || componentId === GOOD_ROLE_UTILITY_COMPONENT.id
  const evilRole =
    componentId === EVIL_ROLE_OBJECTIVE_COMPONENT.id
    || componentId === EVIL_ROLE_UTILITY_COMPONENT.id
  const morganaRole =
    componentId === MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id
    || componentId === MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id
    || componentId === MORGANA_ROLE_UTILITY_COMPONENT.id
    || componentId === MORGANA_ROLE_UTILITY_SEEDED_COMPONENT.id
  const consumed = scores.length > 0 && scores.every((score) =>
    goodRole
      ? score.roleObjectiveFeatures !== undefined
      : evilRole
        ? score.evilRoleObjectiveFeatures !== undefined
          || score.morganaRoleObjectiveFeatures !== undefined
        : morganaRole
          ? score.morganaRoleObjectiveFeatures !== undefined
          : false)
  return consumed
    ? nativeScoreSelectionSurvived(trace)
      ? ['candidate-score', 'action-selection']
      : ['candidate-score']
    : []
}

function validGenericRoleComponents(
  trace: DecisionTrace,
  hostView?: PlayerView,
): boolean {
  if (
    !validDecisionTraceProvenance(trace)
    || !currentTraceOmitsMigratedFlatState(trace)
  ) return false
  if (trace.version === DECISION_TRACE_VERSION) return true
  const safePlan = canonicalizeJson(
    trace.componentPlan,
    MAX_DECISION_COMPONENT_PLAN_JSON_BYTES,
  )
  const safeRun = canonicalizeJson(
    trace.components,
    MAX_DECISION_COMPONENT_RUN_JSON_BYTES,
  )
  if (!safePlan.ok || !safeRun.ok) return false
  const planRecord: unknown = safePlan.payload
  const runRecord: unknown = safeRun.payload
  if (
    !exactGenericRecord(planRecord, ['version', 'configured'])
    || planRecord.version !== DECISION_COMPONENT_PLAN_VERSION
    || !exactGenericArray(planRecord.configured)
    || !exactGenericRecord(
      runRecord,
      ['version', 'configured', 'entries', 'policyUse'],
    )
    || runRecord.version !== DECISION_COMPONENT_RUN_VERSION
    || !exactGenericArray(runRecord.configured)
    || !exactGenericArray(runRecord.entries)
    || !exactGenericArray(runRecord.policyUse)
    || planRecord.configured.length !== runRecord.configured.length
  ) return false
  // The strict canonical boundary and exact top-level shape checks above make
  // these the typed structural views consumed by the remaining semantic join.
  const plan = planRecord as unknown as DecisionComponentPlan
  const run =
    runRecord as unknown as NonNullable<DecisionTrace['components']>
  const configuredKeys: string[] = []
  for (let index = 0; index < plan.configured.length; index++) {
    const ref = plan.configured[index]
    const runRef = run.configured[index]
    if (
      !exactGenericRecord(ref, ['id', 'version'])
      || !exactGenericRecord(runRef, ['id', 'version'])
      || typeof ref.id !== 'string'
      || typeof ref.version !== 'string'
      || !isDeepStrictEqual(ref, runRef)
      || !PRODUCTION_COMPONENT_REGISTRY.definition(ref)
    ) return false
    configuredKeys.push(componentKey(ref))
  }
  if (new Set(configuredKeys).size !== configuredKeys.length) return false
  const dependencyKeys = new Set(
    plan.configured.flatMap((ref) =>
      PRODUCTION_COMPONENT_REGISTRY.definition(ref)!.dependencies
        .map(componentKey)),
  )
  const leaves = plan.configured.filter(
    (ref) => !dependencyKeys.has(componentKey(ref)),
  )
  const expectedGraph = PRODUCTION_COMPONENT_REGISTRY.resolve({
    requested: leaves,
  })
  if (!isDeepStrictEqual(expectedGraph.configured, plan.configured)) {
    return false
  }
  if (
    run.entries.length !== run.configured.length
    || run.policyUse.length !== run.configured.length
  ) return false

  const nativeDegradationCodes = new Set(
    PRODUCTION_COMPONENT_REGISTRY.definitions()
      .filter((definition) => definition.source === 'native')
      .map((definition) => definition.degradationCode),
  )
  // Native failures live only on their generic run entry.
  if (
    trace.degradation.some((code) => nativeDegradationCodes.has(code))
  ) return false
  for (let index = 0; index < run.configured.length; index++) {
    const ref = run.configured[index]
    const entry = run.entries[index]
    const use = run.policyUse[index]
    const definition = PRODUCTION_COMPONENT_REGISTRY.definition(ref)!
    if (
      !exactGenericRecord(entry.component, ['id', 'version'])
      || !isDeepStrictEqual(entry.component, ref)
      || entry.kind !== definition.token.kind
      || entry.privacy !== definition.token.privacy
      || !exactGenericRecord(use, ['component', 'used', 'stages'])
      || !exactGenericRecord(use.component, ['id', 'version'])
      || !isDeepStrictEqual(use.component, ref)
    ) return false

    if (entry.status === 'admitted') {
      if (
        !exactGenericRecord(entry, [
          'component', 'kind', 'privacy', 'status', 'envelope',
          'verification', 'promotionEligible', 'payloadBytes',
        ])
        || !exactGenericRecord(entry.envelope, [
          'component', 'kind', 'privacy', 'payload',
        ])
        || !exactGenericRecord(entry.envelope.component, ['id', 'version'])
        || !isDeepStrictEqual(entry.envelope.component, ref)
        || entry.envelope.kind !== definition.token.kind
        || entry.envelope.privacy !== definition.token.privacy
        || !Number.isSafeInteger(entry.payloadBytes)
        || entry.payloadBytes < 0
        || entry.payloadBytes > definition.maxPayloadBytes
      ) return false
      const canonicalPayload = canonicalizeJson(
        entry.envelope.payload,
        definition.maxPayloadBytes,
      )
      if (
        !canonicalPayload.ok
        || entry.payloadBytes !== canonicalPayload.bytes
      ) return false
      let detached: unknown
      try {
        detached = definition.validateDetached(canonicalPayload.payload)
      } catch {
        return false
      }
      if (
        !exactGenericRecord(detached, [
          'admitted', 'payload', 'promotionEligible', 'verification',
        ])
        || detached.admitted !== true
      ) return false
      const canonicalDetached = canonicalizeJson(
        detached.payload,
        definition.maxPayloadBytes,
      )
      if (
        !canonicalDetached.ok
        || !canonicalJsonEqual(
          canonicalDetached.payload,
          canonicalPayload.payload,
        )
      ) return false
      if (
        entry.verification === 'exact'
          ? (
              detached.verification !== 'exact'
              || entry.promotionEligible !== detached.promotionEligible
            )
          : (
              entry.verification !== 'structural'
              || entry.promotionEligible
            )
      ) return false
    } else if (entry.status === 'degraded') {
      if (
        !exactGenericRecord(entry, [
          'component', 'kind', 'privacy', 'status',
          'degradationCode', 'failureCode',
        ])
        || entry.degradationCode !== definition.degradationCode
        || !COMPONENT_FAILURE_CODES.has(entry.failureCode)
      ) return false
    } else if (entry.status === 'inapplicable') {
      if (
        !exactGenericRecord(
          entry,
          ['component', 'kind', 'privacy', 'status'],
        )
      ) return false
    } else if (entry.status === 'suppressed') {
      if (
        !exactGenericRecord(
          entry,
          ['component', 'kind', 'privacy', 'status', 'reasonCode'],
        )
        || typeof entry.reasonCode !== 'string'
      ) return false
    } else {
      return false
    }

    const expectedStages = entry.status === 'admitted'
      ? expectedNativeTraceStages(ref.id, trace)
      : []
    if (
      typeof use.used !== 'boolean'
      || !exactGenericArray(use.stages)
      || !use.stages.every(
        (stage) =>
          stage === 'candidate-score'
          || stage === 'action-selection'
          || stage === 'strategic-decision',
      )
      || new Set(use.stages).size !== use.stages.length
      || (
        expectedStages !== undefined
        && !isDeepStrictEqual(use.stages, expectedStages)
      )
      || use.used !== (use.stages.length > 0)
    ) return false
  }

  return true
}

function validGenericRoleComponentsHostJoin(
  trace: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
  deterministicSeed: string,
): boolean {
  if (trace.version === DECISION_TRACE_VERSION) return true
  const plan = trace.componentPlan!
  return validateDecisionComponentRunHostJoin({
    registry: PRODUCTION_COMPONENT_REGISTRY,
    run: trace.components!,
    request: req,
    view,
    hostInputs: reconstructScoreComponentHostInputs({
      trace,
      plan,
      req,
      view,
      deterministicSeed,
      registry: PRODUCTION_COMPONENT_REGISTRY,
    }),
  })
}

function validDecisionTrace(
  req: DecisionRequest,
  decision: Decision,
  value: unknown,
  hostView?: PlayerView | Pick<PlayerView, 'rolesInPlay'>,
  decisionLayerAdmission?: AdmittedDecisionLayerTrace,
): value is DecisionTrace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const trace = value as Record<string, unknown>
  const fullHostView = isFullPlayerView(hostView) ? hostView : undefined
  const throughSeq = trace.beliefThroughSeq
  const hypotheses = trace.topHypotheses
  const agentModes: readonly AgentExecutionMode[] = [
    'raw-llm',
    'heuristic',
    'random',
    'external',
    'compatibility',
    'structured-only',
    'hybrid',
  ]
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
    && validBeliefTeamAssessments(trace.beliefTeamAssessments)
    && validBeliefTraceRelations(trace)
    && Array.isArray(hypotheses)
    && hypotheses.every((entry) => {
      const hypothesis = entry as Record<string, unknown>
      return !!hypothesis
        && typeof hypothesis === 'object'
        && typeof hypothesis.worldKey === 'string'
        && finiteProbability(hypothesis.probability)
        && seatArray(hypothesis.evilSeats)
    })
    && validRelevantTeam(trace.relevantTeam)
    && enumStringArray(trace.factCodes, ANALYSIS_FACT_CODES)
    && enumStringArray(trace.reasonCodes, FORCED_PLAY_REASON_CODES)
    && isDeepStrictEqual(trace.action, decision)
    && (
      trace.agentMode === undefined
      || agentModes.includes(trace.agentMode as AgentExecutionMode)
    )
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
    && validGenericRoleComponents(
      trace as unknown as DecisionTrace,
      fullHostView,
    )
    && (
      trace.version === DECISION_TRACE_VERSION
      || decisionLayerAdmission !== undefined
    )
    && (
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      || validRoleObjectiveRoute(trace, fullHostView)
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
      || (
        validPrivateRoleObjectiveTrace(
          trace.privateRoleObjective,
          trace,
          req,
          fullHostView,
        )
        && validPrivateEvilRoleObjectiveTrace(
          trace.privateEvilRoleObjective,
          trace,
          req,
          fullHostView,
        )
        && validPrivateRoleUtilityTrace(
          trace.privateRoleUtility,
          trace,
          req,
          fullHostView,
        )
        && validPrivateEvilRoleUtilityTrace(
          trace.privateEvilRoleUtility,
          trace,
          req,
          fullHostView,
        )
      )
    )
    && (
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      || (
        validMorganaCounterfeitTrace(trace, req, fullHostView)
        && validMorganaRolePolicyTrace(trace, req, fullHostView)
      )
    )
    && validPlanOutcomeTrace(
      trace.privatePlanOutcome,
      trace,
      req,
      decision,
      fullHostView,
    )
    && validCandidateScores(trace.candidateScores)
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
    && validComposedTraceRelations(trace)
  )
}

/**
 * Shared strict composed-trace admission for persisted artifacts and
 * generation-time benchmark capture. Unlike the stdio envelope validator,
 * this accepts finalized applied-outcome telemetry and validates score/action
 * relations against the selected decision supplied by replay.
 */
interface ExactComposedTraceHostJoinInput {
  trace: DecisionTrace
  decisionLayerAdmission?: AdmittedDecisionLayerTrace
  req: DecisionRequest
  view: PlayerView
  /** Authoritative applied/replayed action, including normalized communication. */
  authoritativeAction: Decision
  /** Selected mechanical decision, before any engine fallback replacement. */
  selectedDecision: Decision
  deterministicSeed: string
  /**
   * Trusted construction-time witness, when the caller owns the producing
   * resolved brain. Self-contained stdio and stored traces cannot supply it.
   */
  expectedComponentPlan?: DecisionComponentPlan
  /**
   * Out-of-band configured identity owned by the producing resolved brain.
   * Current exact score replay never accepts trace scorer labels as
   * provenance.
   */
  expectedArchitectureIdentity?: ResolvedArchitectureIdentity
  /** Require the component-bearing producer schema even for an empty plan. */
  expectComponentTrace?: boolean
}

function validExactComposedTraceHostJoin(
  input: ExactComposedTraceHostJoinInput,
): boolean {
  try {
    const {
      trace,
      decisionLayerAdmission,
      req,
      view,
      authoritativeAction,
      selectedDecision,
      deterministicSeed,
      expectedComponentPlan,
      expectedArchitectureIdentity,
      expectComponentTrace,
    } = input
    const policyHostSurface = exactPolicyHostSurface(
      req,
      view,
      expectedArchitectureIdentity,
    )
    const decisionLayerReplay =
      policyHostSurface && expectedArchitectureIdentity
        ? replayExactDecisionLayerHostJoin(
            trace,
            decisionLayerAdmission,
            req,
            view,
            policyHostSurface,
            expectedArchitectureIdentity,
          )
        : undefined
    const strategicHostSurface =
      policyHostSurface && decisionLayerReplay
        ? {
            ...policyHostSurface,
            candidateBoundary: decisionLayerReplay.surface,
          }
        : policyHostSurface
    const genericRoleComponentsValid = validGenericRoleComponents(trace, view)
    const genericRoleHostJoinValid = validGenericRoleComponentsHostJoin(
      trace,
      req,
      view,
      deterministicSeed,
    )
    if (
      !strategicHostSurface
      || !validMechanicalDecisionTraceHostJoin({
        trace,
        req,
        view,
        authoritativeAction,
        selectedDecision,
      })
      || !validDecisionTraceProvenance(trace)
      || !validComponentVersions(trace.componentVersions)
      || !validBeliefVersionRelation(trace)
      || !genericRoleComponentsValid
      || !genericRoleHostJoinValid
      || (
        expectedArchitectureIdentity !== undefined
        && (
          !policyHostSurface
          || !decisionLayerReplay
        )
      )
      || (
        expectComponentTrace === true
        && trace.version !== COMPONENT_DECISION_TRACE_VERSION
      )
      || (
        expectedArchitectureIdentity !== undefined
        && !resolvedArchitectureIdentityTraceJoin(
          expectedArchitectureIdentity,
          trace,
        )
      )
      || (
        expectedComponentPlan !== undefined
        && (
          trace.version !== COMPONENT_DECISION_TRACE_VERSION
          || expectedArchitectureIdentity === undefined
          || !isDeepStrictEqual(
            trace.componentPlan,
            expectedComponentPlan,
          )
          || !validTrustedPassiveComponentAttribution(trace)
        )
      )
      || (
        trace.version === DECISION_TRACE_VERSION
        && !validRoleObjectiveRoute(trace, view)
      )
      || !validCandidateScores(trace.candidateScores)
      || !validForcedPolicyResult(trace.forcedPolicyResult)
      || !validPublicObserverTrace(
        trace.publicObserver,
        trace,
        view,
      )
      || !validPrivateIdentityTrace(
        trace.privateIdentity,
        trace,
        view.rolesInPlay,
      )
      || (
        trace.version === DECISION_TRACE_VERSION
        && !validPrivateEvilRoleObjectiveTrace(
          trace.privateEvilRoleObjective,
          trace,
          req,
          view,
        )
      )
      || (
        trace.version === DECISION_TRACE_VERSION
        && !validMorganaCounterfeitTrace(trace, req, view)
      )
      || (
        trace.version === DECISION_TRACE_VERSION
        && !validMorganaRolePolicyTrace(
          trace,
          req,
          view,
          deterministicSeed,
        )
      )
    ) return false
    const components = trace.componentVersions!
    if (
      trace.version === DECISION_TRACE_VERSION
      && !validateExactRoleDependencyHostJoin(trace, req, view)
    ) return false
    if (
      trace.version === DECISION_TRACE_VERSION
      && !validateRoutedEvilDependencyHostJoin(trace, req, view)
    ) return false
    const hasRoleObjective =
      components.roleObjective !== undefined
      || trace.privateRoleObjective !== undefined
      || trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
    if (
      trace.version === DECISION_TRACE_VERSION
      &&
      hasRoleObjective
      && !validPrivateRoleObjectiveTrace(
        trace.privateRoleObjective,
        trace,
        req,
        view,
      )
    ) return false
    if (
      trace.version === DECISION_TRACE_VERSION
      && !validPrivateRoleUtilityTrace(
      trace.privateRoleUtility,
      trace,
      req,
      view,
    )) return false
    if (
      trace.version === DECISION_TRACE_VERSION
      && !validPrivateEvilRoleUtilityTrace(
      trace.privateEvilRoleUtility,
      trace,
      req,
      view,
    )) return false

    const legal = legalCandidates(req, view)
    const scores = trace.candidateScores ?? []
    if (
      scores.length !== legal.length
      || scores.some(
        (score, index) => score.candidateId !== legal[index].id,
      )
    ) return false

    const configured = components.configuredScorer ?? components.scorer
    const nativeRun = trace.components
    const roleUtility = nativeRun
      ? componentPayload(nativeRun, GOOD_ROLE_UTILITY_COMPONENT)
      : trace.privateRoleUtility
    const evilRoleUtility = nativeRun
      ? componentPayload(nativeRun, EVIL_ROLE_UTILITY_COMPONENT)
      : trace.privateEvilRoleUtility
    const morganaObjective = nativeRun
      ? componentPayload(
          nativeRun,
          MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
        )
      : trace.privateMorganaCounterfeitObjective
    const morganaUtility = nativeRun
      ? componentPayload(
          nativeRun,
          configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
            ? MORGANA_ROLE_UTILITY_SEEDED_COMPONENT
            : MORGANA_ROLE_UTILITY_COMPONENT,
        )
      : trace.privateMorganaRoleUtility
    const morganaConfigured =
      configured === MORGANA_ROLE_SCORER_VERSION
      || configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
    const d2Configured =
      configured === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      || configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    const c2Configured =
      configured === ROLE_OBJECTIVE_SCORER_VERSION
      || configured === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    const c2Resolved =
      components.scorer === ROLE_OBJECTIVE_SCORER_VERSION
      || components.scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    const exactNativeInputs =
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      && components.belief === EXACT_BELIEF_MODEL_VERSION
      && components.languageEvidence === 'off'
      && components.factors === 'off'
    if (
      morganaConfigured
      && trace.version === DECISION_TRACE_VERSION
    ) {
      const seeded = configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
      const applicable =
        view.role === 'morgana'
        && (req.kind === 'propose' || req.kind === 'vote')
      const applied =
        applicable
        && morganaUtility !== undefined
        && !trace.degradation.includes(MORGANA_ROLE_SCORER_DEGRADATION)
      const d2Base = seeded
        ? EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
        : EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      const downstream = (
        (req.kind === 'propose' || req.kind === 'vote')
        && view.alignment === 'evil'
      )
        ? d2Base
        : (
            (req.kind === 'propose' || req.kind === 'vote')
            && (view.role === 'merlin' || view.role === 'percival')
          )
          ? seeded
            ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
            : ROLE_OBJECTIVE_SCORER_VERSION
          : seeded
            ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
            : GOOD_PROPOSAL_VOTE_SCORER_VERSION
      const expectedResolved = applied ? configured : downstream
      if (
        components.scorer !== expectedResolved
        || components.configuredScorer !== (
          expectedResolved === configured ? undefined : configured
        )
      ) return false
      if (applied) {
        const projection = morganaUtility!
        const selectionMode =
          configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
            ? 'seeded-near-equal-vote-within-d2-band'
            : 'top-counterfeit-within-d2-band'
        if (
          !morganaObjective
          || !evilRoleUtility
          || !validatePrivateMorganaRoleUtilityHostJoin(projection, {
            req,
            view,
            candidates: legal,
            forced: trace.forcedPolicyResult!,
            counterfeitObjective: morganaObjective,
            evilRoleUtility,
            selectionMode,
            deterministicSeed,
          })
        ) return false
      }
    }
    if (
      (c2Configured || c2Resolved)
      && trace.version === DECISION_TRACE_VERSION
    ) {
      const applicable =
        (req.kind === 'propose' || req.kind === 'vote')
        && (view.role === 'merlin' || view.role === 'percival')
      const roleApplied =
        applicable
        && roleUtility !== undefined
        && !trace.degradation.includes('role-objective-scorer-failed')
      const seeded =
        configured === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
        || components.scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      const base = seeded
        ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        : GOOD_PROPOSAL_VOTE_SCORER_VERSION
      const expectedResolved = roleApplied
        ? seeded
          ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          : ROLE_OBJECTIVE_SCORER_VERSION
        : base
      if (components.scorer !== expectedResolved) return false
    }
    if (
      d2Configured
      && trace.version === DECISION_TRACE_VERSION
    ) {
      const eligible =
        (req.kind === 'propose' || req.kind === 'vote')
        && view.alignment === 'evil'
      const d2Applied =
        eligible
        && evilRoleUtility !== undefined
        && !trace.degradation.includes('evil-role-objective-scorer-failed')
      const seeded =
        configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      const expectedResolved = d2Applied
        ? configured
        : (
            (req.kind === 'propose' || req.kind === 'vote')
            && (view.role === 'merlin' || view.role === 'percival')
          )
          ? seeded
            ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
            : ROLE_OBJECTIVE_SCORER_VERSION
          : seeded
            ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
            : GOOD_PROPOSAL_VOTE_SCORER_VERSION
      if (
        components.scorer !== expectedResolved
        || components.configuredScorer !== (
          expectedResolved === configured ? undefined : configured
        )
      ) return false
    }

    if (
      exactNativeInputs
      && NATIVE_SCORER_VERSIONS.has(components.scorer)
      && (
        expectedArchitectureIdentity === undefined
        || !validateExactNativeScoreSurface(
          trace,
          req,
          view,
          deterministicSeed,
          strategicHostSurface,
          expectedArchitectureIdentity,
        )
      )
    ) return false

    const expectedBucket = stablePolicyBucket([
      deterministicSeed,
      req.seat,
      req.kind,
      req.round,
      req.proposalNum,
      trace.beliefThroughSeq,
    ].join(':'))
    const invalidSeedBucket = scores.some((score) => {
      const baseBucket = score.features?.version === GOOD_VOTE_FEATURE_VERSION
        ? score.features.seedBucket
        : undefined
      const roleBucket = score.roleObjectiveFeatures?.seedBucket
      const evilBucket = score.evilRoleObjectiveFeatures?.seedBucket
      const morganaBucket =
        score.morganaRoleObjectiveFeatures?.seedBucket
      const expectedEvilBucket = stablePolicyBucket([
        deterministicSeed,
        req.seat,
        req.kind,
        req.round,
        req.proposalNum,
        trace.beliefThroughSeq,
        EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ].join(':'))
      return (
        baseBucket !== undefined && baseBucket !== expectedBucket
      ) || (
        roleBucket !== undefined && roleBucket !== expectedBucket
      ) || (
        evilBucket !== undefined && evilBucket !== expectedEvilBucket
      ) || (
        morganaBucket !== undefined
        && morganaBucket !== stablePolicyBucket([
          deterministicSeed,
          req.seat,
          req.kind,
          req.round,
          req.proposalNum,
          trace.beliefThroughSeq,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].join(':'))
      )
    })
    if (invalidSeedBucket) return false

    const relationTrace = structuredClone(trace) as unknown as
      Record<string, unknown>
    relationTrace.action = structuredClone(selectedDecision)
    return validComposedTraceRelations(relationTrace)
  } catch {
    return false
  }
}

interface ExpectedNativeDiagnostics {
  readonly scores: readonly CandidateScore[]
  readonly componentRun: DecisionComponentRun
  readonly resolvedScorerVersion: string
}

const NATIVE_SCORE_COMPONENT_IDS = new Set([
  GOOD_ROLE_OBJECTIVE_COMPONENT.id,
  GOOD_ROLE_UTILITY_COMPONENT.id,
  EVIL_ROLE_OBJECTIVE_COMPONENT.id,
  EVIL_ROLE_UTILITY_COMPONENT.id,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
  MORGANA_ROLE_UTILITY_COMPONENT.id,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT.id,
])

function validTrustedPassiveComponentAttribution(
  trace: DecisionTrace,
): boolean {
  if (!trace.components) return false
  const strategicIds = new Set(
    PRODUCTION_DECISION_LAYER_REGISTRY.definitions()
      .flatMap((definition) =>
        definition.requiredComponents.map((component) => component.id)),
  )
  return trace.components.policyUse.every(
    (use) =>
      NATIVE_SCORE_COMPONENT_IDS.has(use.component.id)
      || strategicIds.has(use.component.id)
      || (!use.used && use.stages.length === 0),
  )
}

const NATIVE_SCORER_VERSIONS = new Set([
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
])

function nativeScoreSelectionSurvived(trace: DecisionTrace): boolean {
  const plannerSelectionAccepted =
    trace.plannerCandidateId !== undefined
    && trace.plannerCandidateId === trace.chosenCandidateId
    && !trace.degradation.some((code) => code.startsWith('planner-'))
  return trace.structuredCandidateId !== undefined
    && trace.chosenCandidateId === trace.structuredCandidateId
    && trace.forcedPolicyResult?.selectedCandidateId === undefined
    && trace.decisionLayerRun?.surface.selectedCandidateId === undefined
    && !plannerSelectionAccepted
}

function validNativeScoreAttribution(
  trace: DecisionTrace,
  replay: DecisionComponentRun,
): boolean {
  if (!trace.components) return false
  const selected = nativeScoreSelectionSurvived(trace)
  for (const expected of replay.policyUse) {
    if (!NATIVE_SCORE_COMPONENT_IDS.has(expected.component.id)) continue
    const actual = trace.components.policyUse.find(
      (use) => isDeepStrictEqual(use.component, expected.component),
    )
    if (!actual) return false
    const consumed = expected.stages.includes('candidate-score')
    const stages = [
      ...(consumed ? ['candidate-score'] : []),
      ...(consumed && selected ? ['action-selection'] : []),
    ]
    if (
      actual.used !== (stages.length > 0)
      || !isDeepStrictEqual(actual.stages, stages)
    ) return false
  }
  return true
}

function expectedNativeDiagnostics(
  context: CandidateScoringContext,
  trace: DecisionTrace,
  chain: ResolvedScoreLayerChain,
): ExpectedNativeDiagnostics {
  if (!trace.components) {
    throw new Error('native score replay requires the component run')
  }
  const compatibilityCandidateId = candidateIdForDecision(
    heuristicDecide(
      context.request,
      context.view,
      context.deterministicSeed,
    ),
  )
  const replay = replayNativeScoresForAdmission({
    chain,
    request: context.request,
    view: context.view,
    analysis: context.analysis,
    candidates: context.candidates,
    ...(context.hypotheticalTeamCandidates
      ? {
          hypotheticalTeamCandidates:
            context.hypotheticalTeamCandidates,
        }
      : {}),
    forced: context.forced,
    candidateBoundary: context.candidateBoundary,
    deterministicSeed: context.deterministicSeed,
    compatibilityCandidateId,
    componentDefinitions: PRODUCTION_COMPONENT_REGISTRY.definitions(),
    componentRun: trace.components,
  })
  const scorerVersion = replay.resolvedScorerVersion
  const morganaToken =
    scorerVersion === MORGANA_ROLE_SEEDED_SCORER_VERSION
      ? MORGANA_ROLE_UTILITY_SEEDED_COMPONENT
      : MORGANA_ROLE_UTILITY_COMPONENT
  const diagnosticContext: CandidateScoringContext = {
    ...context,
    ...(componentPayload(trace.components, GOOD_ROLE_UTILITY_COMPONENT)
      ? {
          roleUtility: componentPayload(
            trace.components,
            GOOD_ROLE_UTILITY_COMPONENT,
          ),
        }
      : {}),
    ...(componentPayload(trace.components, EVIL_ROLE_UTILITY_COMPONENT)
      ? {
          evilRoleUtility: componentPayload(
            trace.components,
            EVIL_ROLE_UTILITY_COMPONENT,
          ),
        }
      : {}),
    ...(componentPayload(trace.components, morganaToken)
      ? {
          morganaRoleUtility: componentPayload(
            trace.components,
            morganaToken,
          ),
        }
      : {}),
  }
  return Object.freeze({
    scores: projectConfiguredScoreDiagnostics(
      diagnosticContext,
      replay.rows,
      scorerVersion,
    ),
    componentRun: replay.componentRun,
    resolvedScorerVersion: scorerVersion,
  })
}

function validateExactNativeScoreSurface(
  trace: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
  deterministicSeed: string,
  d3HostSurface: ExactPolicyHostSurface,
  expectedArchitectureIdentity: ResolvedArchitectureIdentity,
): boolean {
  try {
    const {
      candidates,
      analysis,
      hypotheticalTeamCandidates,
      effectiveForced: forced,
      candidateBoundary,
    } = d3HostSurface
    const scorerVersion = trace.componentVersions?.scorer
    const configuredScorer =
      expectedArchitectureIdentity.configuredPipeline.scoring
        .configuredScorer
    const chain = trustedNativeScoreChain(expectedArchitectureIdentity)
    if (
      !scorerVersion
      || !NATIVE_SCORER_VERSIONS.has(scorerVersion)
      || !chain
    ) {
      return false
    }
    const expected = expectedNativeDiagnostics({
      deterministicSeed,
      request: req,
      view,
      analysis,
      candidates,
      ...(hypotheticalTeamCandidates
        ? { hypotheticalTeamCandidates }
        : {}),
      forced,
      candidateBoundary,
    }, trace, chain)
    const expectedConfiguredAttribution =
      expected.resolvedScorerVersion === configuredScorer
        ? undefined
        : configuredScorer
    return isDeepStrictEqual(trace.forcedPolicyResult, forced)
      && isDeepStrictEqual(trace.candidateScores, expected.scores)
      && scorerVersion === expected.resolvedScorerVersion
      && trace.componentVersions?.configuredScorer
        === expectedConfiguredAttribution
      && trace.structuredCandidateId === (
        candidateBoundary.selectedCandidateId
        ?? structuredChoice(expected.scores).candidateId
      )
      && validNativeScoreAttribution(trace, expected.componentRun)
  } catch {
    return false
  }
}

/**
 * For the exact, API-free role architecture, dependency failures are
 * host-recomputable from the authoritative PlayerView. Do not admit a trace
 * that hides a recoverable identity/objective/utility chain behind forged
 * degradation labels. Language-weighted variants are deliberately excluded:
 * their bounded external evidence must be validated by its own attribution
 * path rather than reconstructed as exact cognition.
 */
function validateExactRoleDependencyHostJoin(
  trace: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
): boolean {
  const components = trace.componentVersions
  if (!components) return false
  const configured = components.configuredScorer ?? components.scorer
  const roleConfigured =
    configured === ROLE_OBJECTIVE_SCORER_VERSION
    || configured === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    || components.scorer === ROLE_OBJECTIVE_SCORER_VERSION
    || components.scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
  const role = view.role
  const applicable =
    roleConfigured
    && (req.kind === 'propose' || req.kind === 'vote')
    && isRoleObjectiveRole(role)
  const exactNonLanguage =
    components.belief === EXACT_BELIEF_MODEL_VERSION
    && components.languageEvidence === 'off'
    && components.factors === 'off'
  if (!applicable || !exactNonLanguage) return true

  try {
    const belief = exactBelief(view)
    if (
      trace.beliefModelVersion !== belief.modelVersion
      || trace.beliefThroughSeq !== belief.throughSeq
      || trace.quality !== belief.quality
      || !isDeepStrictEqual(
        trace.beliefPlayerMarginals,
        belief.playerMarginals,
      )
    ) return false

    const scope = trace.privateIdentity
      ? {
          roleQueries: trace.privateIdentity.scope.roleQueries.map(
            (query) => ({ roles: [...query.queriedRoles] }),
          ),
          hiddenTeam: trace.privateIdentity.scope.hiddenTeam,
        }
      : roleObjectiveIdentityScope(role, view.rolesInPlay)
    const identity = projectJointIdentity(belief, scope)
    const observer = observePublicRecord(projectPublicRecord(view))
    const candidates = legalCandidates(req, view)
    const objective = buildRoleObjectiveSnapshot({
      req,
      view,
      identity,
      observer,
      candidates,
    })
    const utility = buildRoleUtilityProjection({
      req,
      view,
      objective,
      observer,
      candidates,
    })
    return (
      components.identityModel === JOINT_IDENTITY_MODEL_VERSION
      && components.roleObjective === ROLE_OBJECTIVE_MODEL_VERSION
      && components.roleUtility === ROLE_UTILITY_PROJECTION_VERSION
      && !trace.degradation.includes('identity-projection-failed')
      && !trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
      && !trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
      && isDeepStrictEqual(trace.privateIdentity, identity)
      && isDeepStrictEqual(trace.publicObserver, observer)
      && isDeepStrictEqual(trace.privateRoleObjective, objective)
      && isDeepStrictEqual(trace.privateRoleUtility, utility)
    )
  } catch {
    return false
  }
}

/**
 * Exact routed D1 dependencies are wholly reconstructable from PlayerView.
 * Rebuild the mandatory hidden-team scope and reject coordinated deletion or
 * scope substitution hidden behind degradation labels. Weighted dependencies
 * remain externally attributable through their narrowly typed paired
 * degradation because the host does not own their private world weights.
 */
function validateRoutedEvilDependencyHostJoin(
  trace: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
): boolean {
  const components = trace.componentVersions
  if (!components) return false
  const applicable =
    components.roleObjectiveRouter === ROLE_OBJECTIVE_ROUTER_VERSION
    && routedRoleObjectiveModel(view.role)
      === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  const exactNonLanguage =
    components.belief === EXACT_BELIEF_MODEL_VERSION
    && components.languageEvidence === 'off'
    && components.factors === 'off'
  if (!applicable) return true
  if (!exactNonLanguage) {
    const identityFailed = trace.degradation.includes(
      'identity-projection-failed',
    )
    const objectiveFailed = trace.degradation.includes(
      EVIL_ROLE_OBJECTIVE_DEGRADATION,
    )
    const complete =
      trace.privateIdentity !== undefined
      && trace.privateIdentity.scope.hiddenTeam
      && trace.privateEvilRoleObjective !== undefined
      && !identityFailed
      && !objectiveFailed
    const pairedFailure =
      trace.privateIdentity === undefined
      && trace.privateEvilRoleObjective === undefined
      && identityFailed
      && objectiveFailed
    return complete || pairedFailure
  }

  try {
    const belief = exactBelief(view)
    if (
      trace.beliefModelVersion !== belief.modelVersion
      || trace.beliefThroughSeq !== belief.throughSeq
      || trace.quality !== belief.quality
      || !isDeepStrictEqual(
        trace.beliefPlayerMarginals,
        belief.playerMarginals,
      )
    ) return false
    const identity = projectJointIdentity(belief, {
      roleQueries: trace.privateIdentity
        ? trace.privateIdentity.scope.roleQueries.map(
            (query) => ({ roles: [...query.queriedRoles] }),
          )
        : [],
      hiddenTeam: true,
    })
    const observer = observePublicRecord(projectPublicRecord(view))
    const candidates = legalCandidates(req, view)
    const objective = buildEvilRoleObjectiveSnapshot({
      req,
      view,
      identity,
      observer,
      candidates,
    })
    const d2Applied =
      components.scorer === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      || components.scorer === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      || components.scorer === MORGANA_ROLE_SCORER_VERSION
      || components.scorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
    const alternativeObjective = req.kind === 'vote'
      ? buildEvilRoleObjectiveSnapshot({
          req: { ...req, kind: 'propose' },
          view,
          identity,
          observer,
          candidates: hypotheticalProposalCandidates(view),
        })
      : undefined
    const utility = d2Applied
      ? buildEvilRoleUtilityProjection({
          req,
          view,
          objective,
          candidates,
          ...(alternativeObjective ? { alternativeObjective } : {}),
        })
      : undefined
    return (
      components.identityModel === JOINT_IDENTITY_MODEL_VERSION
      && components.observerModel === PUBLIC_OBSERVER_MODEL_VERSION
      && components.roleObjective
        === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      && !trace.degradation.includes('identity-projection-failed')
      && !trace.degradation.includes(
        EVIL_ROLE_OBJECTIVE_DEGRADATION,
      )
      && isDeepStrictEqual(trace.privateIdentity, identity)
      && isDeepStrictEqual(trace.publicObserver, observer)
      && isDeepStrictEqual(trace.privateEvilRoleObjective, objective)
      && (
        d2Applied
          ? (
              components.evilRoleUtility
                === EVIL_ROLE_UTILITY_PROJECTION_VERSION
              && !trace.degradation.includes(
                EVIL_ROLE_UTILITY_DEGRADATION,
              )
              && isDeepStrictEqual(trace.privateEvilRoleUtility, utility)
            )
          : (
              components.evilRoleUtility === undefined
              && trace.privateEvilRoleUtility === undefined
            )
      )
    )
  } catch {
    return false
  }
}

interface ExactPolicyHostSurface {
  readonly candidates: ReturnType<typeof legalCandidates>
  readonly analysis: SituationAnalysis
  readonly hypotheticalTeamCandidates?:
    ReturnType<typeof hypotheticalProposalCandidates>
  readonly universalForced: ForcedPolicyResult
  readonly effectiveForced: ForcedPolicyResult
  readonly candidateBoundary: DecisionCandidateBoundary
}

function trustedNativeScoreChain(
  identity: ResolvedArchitectureIdentity,
): ResolvedScoreLayerChain | undefined {
  try {
    const order = identity.scoreLayerOrder
    const terminal = order.at(-1)
    if (!terminal) return undefined
    const chain = createConfiguredScoreLayerRegistry().resolve({
      terminal,
      declaredOrder: order,
    })
    const scoring = identity.configuredPipeline.scoring
    const expectedTerminal = [
      scoring.configuredScorer,
      ...scoring.configuredBaseChain,
    ].find((version) => NATIVE_SCORER_VERSIONS.has(version))
      ?? CANDIDATE_SCORER_VERSION
    if (
      scoring.invalidOutputFallback !== CANDIDATE_SCORER_VERSION
      || terminal.version !== expectedTerminal
    ) return undefined
    return chain
  } catch {
    return undefined
  }
}

/**
 * Construct the one exact host-owned policy/scoring input surface. The
 * configured score chain comes only from an out-of-band resolved identity;
 * witnessless protocol traces receive the compatibility analysis shape and
 * remain diagnostic.
 */
function exactPolicyHostSurface(
  req: DecisionRequest,
  view: PlayerView,
  expectedArchitectureIdentity?: ResolvedArchitectureIdentity,
): ExactPolicyHostSurface | undefined {
  try {
    const candidates = legalCandidates(req, view)
    const chain = expectedArchitectureIdentity
      ? trustedNativeScoreChain(expectedArchitectureIdentity)
      : configuredScoreLayerChainForVersion(CANDIDATE_SCORER_VERSION)
    if (!chain) return undefined
    const analysisPlan = combineSituationAnalysisRequirements(
      prepareScoreLayerRequirements(chain, {
        request: Object.freeze(structuredClone(req)),
        view: Object.freeze(structuredClone(view)),
      }).requirements,
    )
    const {
      analysis,
      hypotheticalTeamCandidates,
    } = buildScorerSituationSurface({
      view,
      belief: exactBelief(view),
      legalCandidates: candidates,
      plan: analysisPlan,
    })
    const universalForced = applyForcedPolicy(
      req,
      view,
      analysis,
      candidates,
    )
    return {
      candidates,
      analysis,
      ...(hypotheticalTeamCandidates !== null
        ? { hypotheticalTeamCandidates }
        : {}),
      universalForced,
      effectiveForced: universalForced,
      candidateBoundary: {
        survivorCandidateIds: universalForced.allowedCandidateIds,
        ...(universalForced.selectedCandidateId === undefined
          ? {}
          : {
              selectedCandidateId:
                universalForced.selectedCandidateId,
            }),
        reasonCodes: universalForced.reasonCodes,
      },
    }
  } catch {
    return undefined
  }
}

/**
 * Replay the configured strategic seam from out-of-band architecture
 * identity. Detached traces can remain diagnostic, but cannot invent exact
 * order, journal, operation accounting, or causal component use.
 */
function replayExactDecisionLayerHostJoin(
  trace: DecisionTrace,
  admission: AdmittedDecisionLayerTrace | undefined,
  req: DecisionRequest,
  view: PlayerView,
  surface: ExactPolicyHostSurface,
  identity: ResolvedArchitectureIdentity,
): DecisionLayerRun | undefined {
  try {
    if (
      trace.version !== COMPONENT_DECISION_TRACE_VERSION
      || !trace.components
      || !trace.decisionLayerRun
      || !admission
    ) return undefined
    const componentDefinitions = identity.components.eligible.map(
      (ref) => PRODUCTION_COMPONENT_REGISTRY.definition(ref),
    )
    if (componentDefinitions.some(
      (definition) => definition === undefined,
    )) return undefined
    return DECISION_LAYER_ADMISSION.replay({
      registry: PRODUCTION_DECISION_LAYER_REGISTRY,
      configured: identity.decisionLayerOrder,
      request: req,
      view,
      analysis: surface.analysis,
      candidates: surface.candidates,
      universalForced: surface.universalForced,
      componentDefinitions: componentDefinitions.filter(
        (definition) => definition !== undefined,
      ),
      componentRun: trace.components,
      claimed: admission,
    })
  } catch {
    return undefined
  }
}

function isFullPlayerView(
  value: Pick<PlayerView, 'rolesInPlay'> | undefined,
): value is PlayerView {
  return !!value
    && 'events' in value
    && 'privateInfo' in value
    && 'quests' in value
    && 'players' in value
    && 'seat' in value
}

/**
 * Scorer-independent mechanical join shared by finalized admission paths.
 */
function validMechanicalDecisionTraceHostJoin(input: {
  trace: DecisionTrace
  req: DecisionRequest
  view: PlayerView
  authoritativeAction: Decision
  selectedDecision: Decision
}): boolean {
  const {
    trace,
    req,
    view,
    authoritativeAction,
    selectedDecision,
  } = input
  return req.seat === view.seat
    && selectedDecision.kind === req.kind
    && authoritativeAction.kind === req.kind
    && trace.viewerSeat === req.seat
    && isDeepStrictEqual(trace.request, req)
    && isDeepStrictEqual(trace.action, authoritativeAction)
    && trace.chosenCandidateId
      === candidateIdForDecision(selectedDecision)
}

function validFinalizedDiagnosticDecisionTrace(
  req: DecisionRequest,
  authoritativeDecision: Decision,
  selectedDecision: Decision,
  candidate: DecisionTrace,
  hostView: PlayerView,
): boolean {
  return (
    validMechanicalDecisionTraceHostJoin({
      trace: candidate,
      req,
      view: hostView,
      authoritativeAction: authoritativeDecision,
      selectedDecision,
    })
    && validDecisionTraceProvenance(candidate)
    && validComponentVersions(candidate.componentVersions)
    && validBeliefVersionRelation(candidate)
    && validGenericRoleComponents(candidate, hostView)
    && validPublicObserverTrace(
      candidate.publicObserver,
      candidate,
      hostView,
    )
    && validPrivateIdentityTrace(
      candidate.privateIdentity,
      candidate,
      hostView.rolesInPlay,
    )
  )
}

/**
 * A complete decision trace may contain the maximum two-megabyte component
 * run plus the surrounding belief, analysis, plan, and communication data.
 * Bound the entire hostile object before inspecting even its discriminator.
 */
export const MAX_DECISION_TRACE_JSON_BYTES = 4_194_304

declare const canonicalDecisionTraceCandidateBrand: unique symbol

/**
 * Strict JSON snapshot of one trace-shaped input. This state is safe to
 * inspect for replay lookup, but it is not host-admitted and carries no trust.
 */
export interface CanonicalDecisionTraceCandidate {
  readonly kind: 'canonical-decision-trace-candidate'
  readonly trace: Readonly<DecisionTrace>
  readonly bytes: number
  readonly [canonicalDecisionTraceCandidateBrand]: true
}

const canonicalDecisionTraceCandidates =
  new WeakSet<CanonicalDecisionTraceCandidate>()
const decisionLayerAdmissionByCandidate =
  new WeakMap<
    CanonicalDecisionTraceCandidate,
    AdmittedDecisionLayerTrace | null
  >()

export type DecisionTraceSnapshotRejection =
  | 'trace-json-unsafe'
  | 'trace-too-large'
  | 'trace-not-object'
  | 'removed-flat-field'

export type DecisionTraceSnapshotResult =
  | CanonicalDecisionTraceCandidate
  | Readonly<{
      kind: 'rejected'
      reason: DecisionTraceSnapshotRejection
    }>

/**
 * Snapshot hostile trace input exactly once. The returned graph is sorted,
 * detached, deeply frozen, accessor-free, proxy-free, dense, and bounded.
 * Domain admission must consume this snapshot rather than the caller object.
 */
export function snapshotDecisionTraceInput(
  value: unknown,
): DecisionTraceSnapshotResult {
  const canonical = canonicalizeTransportJson(
    value,
    MAX_DECISION_TRACE_JSON_BYTES,
  )
  if (!canonical.ok) {
    return Object.freeze({
      kind: 'rejected',
      reason: canonical.failureCode === 'payload-too-large'
        ? 'trace-too-large'
        : 'trace-json-unsafe',
    })
  }
  if (
    !canonical.payload
    || typeof canonical.payload !== 'object'
    || Array.isArray(canonical.payload)
  ) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'trace-not-object',
    })
  }
  const root = canonical.payload as Record<string, CanonicalJsonValue>
  const versions = root.componentVersions
  if (
    Object.hasOwn(root, 'privateEvilQuestCardPolicy')
    || (
      versions !== null
      && typeof versions === 'object'
      && !Array.isArray(versions)
      && (
        Object.hasOwn(versions, 'evilQuestCardPolicy')
        || Object.hasOwn(versions, 'configuredEvilQuestCardPolicy')
      )
    )
  ) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'removed-flat-field',
    })
  }
  const trace =
    canonical.payload as unknown as Readonly<DecisionTrace>
  const decisionLayerAdmission =
    trace.version === COMPONENT_DECISION_TRACE_VERSION
      ? DECISION_LAYER_ADMISSION.admitCanonical(
          trace.decisionLayerRun as unknown as CanonicalJsonValue,
        ) ?? null
      : null
  const candidate = Object.freeze({
    kind: 'canonical-decision-trace-candidate',
    trace,
    bytes: canonical.bytes,
  }) as CanonicalDecisionTraceCandidate
  canonicalDecisionTraceCandidates.add(candidate)
  decisionLayerAdmissionByCandidate.set(
    candidate,
    decisionLayerAdmission,
  )
  return candidate
}

export type DecisionTraceAdmissionRejection =
  | DecisionTraceSnapshotRejection
  | 'canonical-candidate-untrusted'
  | 'external-detached-invalid'
  | 'external-host-join-failed'
  | 'finalized-diagnostic-invalid'
  | 'trusted-identity-host-join-failed'

export type EvilQuestCardAdmissionState =
  | Readonly<{ state: 'not-configured' }>
  | Readonly<{
      state: 'configured-inactive'
      configuredVersion: string
    }>
  | Readonly<{
      state: 'resolved'
      configuredVersion: string
      resolvedVersion: string
    }>
  | Readonly<{
      state: 'universally-suppressed'
      configuredVersion: string
    }>

interface DecisionTraceAdmissionFacts {
  readonly evilQuestCardPolicy: EvilQuestCardAdmissionState
}

export type DecisionTraceAdmissionResult =
  | Readonly<{
      kind: 'trusted-exact'
      lifecycle: 'finalized-artifact'
      trace: Readonly<DecisionTrace>
      identity: ResolvedArchitectureIdentity
      promotionEvidenceEligible: boolean
      facts: DecisionTraceAdmissionFacts
    }>
  | Readonly<{
      kind: 'external-diagnostic'
      lifecycle: 'pre-apply-external'
      trace: Readonly<DecisionTrace>
      promotionEvidenceEligible: false
      facts: DecisionTraceAdmissionFacts
    }>
  | Readonly<{
      kind: 'artifact-diagnostic'
      lifecycle: 'finalized-artifact'
      trace: Readonly<DecisionTrace>
      promotionEvidenceEligible: false
      facts: DecisionTraceAdmissionFacts
    }>
  | Readonly<{
      kind: 'rejected'
      lifecycle: 'pre-apply-external' | 'finalized-artifact'
      reason: DecisionTraceAdmissionRejection
    }>

export interface ExternalDecisionTraceAdmissionInput {
  readonly kind: 'pre-apply-external'
  readonly trace: unknown
  readonly req: DecisionRequest
  readonly decision: Decision
  readonly hostView?: Pick<PlayerView, 'rolesInPlay'>
}

export interface FinalizedDecisionTraceAdmissionInput {
  readonly kind: 'finalized-artifact'
  readonly trace: unknown
  readonly req: DecisionRequest
  readonly view: PlayerView
  readonly authoritativeAction: Decision
  /**
   * A caller-owned selected action may be supplied by live capture. Stored
   * consumers omit it; admission then reads the canonical finalized outcome,
   * never the caller's raw object, and falls back to the applied action.
   */
  readonly selectedDecision?: Decision
  readonly deterministicSeed: string
  readonly expectedComponentPlan?: DecisionComponentPlan
  readonly expectedArchitectureIdentity?: ResolvedArchitectureIdentity
  readonly expectComponentTrace?: boolean
  /**
   * Temporary test-facade requirement. Runtime and evaluation diagnostics
   * retain structural host validation; the remaining B2 facade asks the
   * closed union for full generic replay until its callers migrate.
   */
  readonly diagnosticVerification?: 'structural' | 'exact'
}

export type DecisionTraceAdmissionInput =
  | ExternalDecisionTraceAdmissionInput
  | FinalizedDecisionTraceAdmissionInput

export type CanonicalDecisionTraceAdmissionInput =
  | (
      Omit<ExternalDecisionTraceAdmissionInput, 'trace'>
      & { readonly trace: CanonicalDecisionTraceCandidate }
    )
  | (
      Omit<FinalizedDecisionTraceAdmissionInput, 'trace'>
      & { readonly trace: CanonicalDecisionTraceCandidate }
    )

function evilQuestCardAdmissionState(
  trace: Readonly<DecisionTrace>,
  identity?: ResolvedArchitectureIdentity,
): EvilQuestCardAdmissionState {
  const robustConfigured = identity?.decisionLayerOrder.some(
    (layer) =>
      layer.id === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.id
      && layer.version === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.version,
  )
    && identity.components.configured.some(
      (component) =>
        component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id
        && component.version === EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
    )
  if (robustConfigured) {
    const journal = trace.decisionLayerRun?.journal.find(
      (entry) =>
        entry.layer.id === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.id
        && entry.layer.version
          === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.version,
    )
    const component = trace.components?.entries.find(
      (entry) =>
        entry.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id
        && entry.component.version
          === EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
    )
    if (
      journal?.status === 'applied'
      && component?.status === 'admitted'
      && journal.attributedComponents.some(
        (ref) =>
          ref.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id
          && ref.version === EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
      )
    ) {
      return Object.freeze({
        state: 'resolved',
        configuredVersion: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
        resolvedVersion: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
      })
    }
    if (
      journal?.status === 'suppressed'
      && journal.suppressionCode === 'universal-policy-selected'
      && component?.status === 'suppressed'
    ) {
      return Object.freeze({
        state: 'universally-suppressed',
        configuredVersion: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
      })
    }
    return Object.freeze({
      state: 'configured-inactive',
      configuredVersion: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
    })
  }
  return Object.freeze({ state: 'not-configured' })
}

function promotionEvidenceEligible(
  trace: Readonly<DecisionTrace>,
): boolean {
  return trace.version === COMPONENT_DECISION_TRACE_VERSION
    && trace.components !== undefined
    && trace.decisionLayerRun !== undefined
    && trace.decisionLayerRun.journal.every(
      (entry) => entry.status !== 'degraded',
    )
    && trace.components.entries.every((entry) =>
      entry.status !== 'degraded'
      && (
        entry.status !== 'admitted'
        || entry.promotionEligible
      ))
}

function rejectedAdmission(
  lifecycle: DecisionTraceAdmissionResult['lifecycle'],
  reason: DecisionTraceAdmissionRejection,
): DecisionTraceAdmissionResult {
  return Object.freeze({ kind: 'rejected', lifecycle, reason })
}

/**
 * Admit an already snapshotted trace candidate against its lifecycle and
 * host. This function never sees the caller's original object.
 */
export function admitCanonicalDecisionTrace(
  input: CanonicalDecisionTraceAdmissionInput,
): DecisionTraceAdmissionResult {
  const candidate = input.trace
  if (!canonicalDecisionTraceCandidates.has(candidate)) {
    return rejectedAdmission(
      input.kind === 'pre-apply-external'
        ? 'pre-apply-external'
        : 'finalized-artifact',
      'canonical-candidate-untrusted',
    )
  }
  const trace = candidate.trace as DecisionTrace
  const decisionLayerAdmission =
    decisionLayerAdmissionByCandidate.get(candidate) ?? null
  if (input.kind === 'pre-apply-external') {
    if (!validDecisionTrace(
      input.req,
      input.decision,
      trace,
      input.hostView,
      decisionLayerAdmission ?? undefined,
    )) {
      return rejectedAdmission(
        'pre-apply-external',
        'external-detached-invalid',
      )
    }
    if (
      isFullPlayerView(input.hostView)
      && (
        (
          trace.version !== COMPONENT_DECISION_TRACE_VERSION
          && (
            !validateExactRoleDependencyHostJoin(
              trace,
              input.req,
              input.hostView,
            )
            || !validateRoutedEvilDependencyHostJoin(
              trace,
              input.req,
              input.hostView,
            )
          )
        )
      )
    ) {
      return rejectedAdmission(
        'pre-apply-external',
        'external-host-join-failed',
      )
    }
    return Object.freeze({
      kind: 'external-diagnostic',
      lifecycle: 'pre-apply-external',
      trace,
      promotionEvidenceEligible: false,
      facts: Object.freeze({
        evilQuestCardPolicy: evilQuestCardAdmissionState(
          trace,
        ),
      }),
    })
  }

  const selectedDecision = input.selectedDecision
    ?? trace.privatePlanOutcome?.selected?.decision
    ?? input.authoritativeAction
  const exactInput: ExactComposedTraceHostJoinInput = {
    trace,
    ...(decisionLayerAdmission
      ? { decisionLayerAdmission }
      : {}),
    req: input.req,
    view: input.view,
    authoritativeAction: input.authoritativeAction,
    selectedDecision,
    deterministicSeed: input.deterministicSeed,
    ...(input.expectedComponentPlan
      ? { expectedComponentPlan: input.expectedComponentPlan }
      : {}),
    ...(input.expectedArchitectureIdentity
      ? {
          expectedArchitectureIdentity:
            input.expectedArchitectureIdentity,
        }
      : {}),
    ...(input.expectComponentTrace
      ? { expectComponentTrace: true }
      : {}),
  }
  const facts = Object.freeze({
    evilQuestCardPolicy: evilQuestCardAdmissionState(
      trace,
      input.expectedArchitectureIdentity,
    ),
  })
  if (
    trace.version === COMPONENT_DECISION_TRACE_VERSION
    && !decisionLayerAdmission
  ) {
    return rejectedAdmission(
      'finalized-artifact',
      input.expectedArchitectureIdentity !== undefined
        ? 'trusted-identity-host-join-failed'
        : 'finalized-diagnostic-invalid',
    )
  }
  if (input.expectedArchitectureIdentity !== undefined) {
    if (!validExactComposedTraceHostJoin(exactInput)) {
      return rejectedAdmission(
        'finalized-artifact',
        'trusted-identity-host-join-failed',
      )
    }
    return Object.freeze({
      kind: 'trusted-exact',
      lifecycle: 'finalized-artifact',
      trace,
      identity: input.expectedArchitectureIdentity,
      promotionEvidenceEligible: promotionEvidenceEligible(trace),
      facts,
    })
  }
  const diagnosticValid =
    input.diagnosticVerification === 'exact'
      ? validExactComposedTraceHostJoin(exactInput)
      : validFinalizedDiagnosticDecisionTrace(
          input.req,
          input.authoritativeAction,
          selectedDecision,
          trace,
          input.view,
        )
  if (!diagnosticValid) {
    return rejectedAdmission(
      'finalized-artifact',
      'finalized-diagnostic-invalid',
    )
  }
  return Object.freeze({
    kind: 'artifact-diagnostic',
    lifecycle: 'finalized-artifact',
    trace,
    promotionEvidenceEligible: false,
    facts,
  })
}

/**
 * Public one-shot ingress. Canonicalization happens before any trace field is
 * read, and admitted consumers receive only that detached snapshot.
 */
export function admitDecisionTrace(
  input: DecisionTraceAdmissionInput,
): DecisionTraceAdmissionResult {
  const snapshot = snapshotDecisionTraceInput(input.trace)
  if (snapshot.kind === 'rejected') {
    return rejectedAdmission(
      input.kind === 'pre-apply-external'
        ? 'pre-apply-external'
        : 'finalized-artifact',
      snapshot.reason,
    )
  }
  return admitCanonicalDecisionTrace({
    ...input,
    trace: snapshot,
  })
}
