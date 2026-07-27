// External-agent adapter: newline-delimited JSON over a child process's stdio.
// Protocol:
//   child -> { type: 'hello', capabilities?: { discuss?: boolean } }   (once, on start)
//   us    -> { id, type: 'decide', request, view }
//   child -> { id, decision }
// Agents that declare discuss:false are auto-passed in table-talk rounds.
// Any protocol failure throws from decide(); the runner's fallback ladder
// (heuristic substitute) keeps the game moving.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { isDeepStrictEqual } from 'node:util'
import { MAX_PROPOSALS, QUESTS_TO_WIN } from '../engine/rules.ts'
import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import {
  ANALYSIS_FACT_CODES,
  FORCED_PLAY_REASON_CODES,
} from './analysis/types.ts'
import {
  FORCED_POLICY_VERSION,
  LEGAL_CANDIDATE_VERSION,
} from './policy/types.ts'
import {
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  GOOD_VOTE_UTILITY_VERSION,
  type CandidateScore,
} from './policy/score.ts'
import { GOOD_VOTE_SITUATION_VERSION } from './analysis/types.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  DECISION_TRACE_VERSION,
  decisionTraceIdForRequest,
  type DecisionTrace,
} from './trace.ts'
import type { AgentOutput, AvalonAgent } from './types.ts'
import type { AgentExecutionMode } from './brain.ts'
import {
  LANGUAGE_BELIEF_VERSION_SUFFIX,
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
} from './belief/language-factor.ts'
import {
  INVALID_LANGUAGE_INTERPRETER_VERSION,
} from './communication/language-orchestration.ts'
import {
  LANGUAGE_CURSOR_VERSION,
  LANGUAGE_INTERPRETER_INPUT_VERSION,
} from './communication/language-types.ts'
import {
  COMMUNICATION_CLAIM_CODES,
  COMMUNICATION_INTENT_VERSION,
  DECISION_PLAN_VERSION,
  POSTERIOR_UNCERTAINTY_VERSION,
  communicationFactProjection,
  plannerOverrideReasonCodes,
  selectedStrategicReasonCodes,
} from './policy/plan.ts'
import {
  validatePublicObserverSnapshot,
} from './analysis/observer.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from './analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  validatePrivateIdentityHostJoin,
} from './belief/identity.ts'
import {
  PLAN_MEMORY_VERSION,
} from './cognition/plan-memory.ts'
import { COHERENCE_MODEL_VERSION } from './cognition/coherence.ts'

export interface StdioAgentOpts {
  cmd: string
  args: string[]
  label?: string
  timeoutMs?: number
  onDecisionTrace?: (trace: DecisionTrace) => void
}

interface Hello {
  type: 'hello'
  capabilities?: { discuss?: boolean }
}

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
      (versions.planMemory === undefined)
      === (versions.coherence === undefined)
    )
}

function validPlanOutcomeTrace(
  value: unknown,
  trace: Record<string, unknown>,
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
  trace: Record<string, unknown>,
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
    && canonicalSeqs(admitted)
    && canonicalSeqs(cumulative)
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
  trace: Record<string, unknown>,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const enabled =
    components?.observerModel === PUBLIC_OBSERVER_MODEL_VERSION
  if (!enabled) return value === undefined
  return validatePublicObserverSnapshot(value)
}

function validPrivateIdentityTrace(
  value: unknown,
  trace: Record<string, unknown>,
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
  })
}

function enumStringArray(
  value: unknown,
  allowed: readonly string[],
): value is readonly string[] {
  const choices = new Set(allowed)
  return stringArray(value) && value.every((entry) => choices.has(entry))
}

function validForcedPolicyResult(value: unknown): boolean {
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

function validBeliefTraceRelations(trace: Record<string, unknown>): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  if (
    components
    && components.belief !== trace.beliefModelVersion
  ) {
    return false
  }
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

function validComposedTraceRelations(trace: Record<string, unknown>): boolean {
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
  const ids = scores.map((score) => score.candidateId)
  if (new Set(ids).size !== ids.length) return false
  const components = trace.componentVersions as Record<string, unknown> | undefined
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
        return (
          ![
            GOOD_PROPOSAL_SCORER_VERSION,
            GOOD_PROPOSAL_VOTE_SCORER_VERSION,
            GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
          ].includes(score.version as typeof GOOD_PROPOSAL_SCORER_VERSION)
          || score.candidateId !== (
            `${LEGAL_CANDIDATE_VERSION}:propose:`
            + (features.team as number[]).join(',')
          )
          || score.value !== (
            score.viable
              ? features.cleanProbability
              : -Number.MAX_SAFE_INTEGER
          )
        )
      }
      if (features.version === GOOD_VOTE_FEATURE_VERSION) {
        const vote = String(score.candidateId).split(':').at(-1)
        const base = vote === 'approve'
          ? features.approveUtility
          : vote === 'reject' ? features.rejectUtility : undefined
        return (
          ![
            GOOD_PROPOSAL_VOTE_SCORER_VERSION,
            GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
          ].includes(score.version as typeof GOOD_PROPOSAL_VOTE_SCORER_VERSION)
          || base === undefined
          || features.baseUtility !== base
          || (
            score.value !== -Number.MAX_SAFE_INTEGER
            && score.value !== (
              (base as number) + (features.selectionAdjustment as number)
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
                (reason) =>
                  !selectedStrategicReasonCodes(
                    chosenScore as unknown as CandidateScore,
                    scores as unknown as CandidateScore[],
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
        (reason) =>
          !selectedStrategicReasonCodes(
            chosenScore as unknown as CandidateScore,
            scores as unknown as CandidateScore[],
          ).includes(reason),
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
      if (
        !exactKeys(
          uncertainty,
          uncertainty.kind === 'selected-team-clean'
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
        || uncertainty.semantics !== 'uniform-feasible-joint'
        || !chosenFeatures
        || uncertainty.beliefModelVersion
          !== chosenFeatures.beliefModelVersion
        || uncertainty.beliefThroughSeq !== trace.beliefThroughSeq
      ) {
        return false
      }
      if (chosenFeatures.version === GOOD_PROPOSAL_FEATURE_VERSION) {
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
      .sort()[0]
    const selectedByValue = viable
      .slice()
      .sort((left, right) =>
        (right.value as number) - (left.value as number)
        || String(left.candidateId).localeCompare(String(right.candidateId)))[0]
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
      || selectedByValue.candidateId !== chosen
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

function validDecisionTrace(
  req: DecisionRequest,
  decision: Decision,
  value: unknown,
  hostView?: PlayerView,
): value is DecisionTrace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const trace = value as Record<string, unknown>
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
    trace.version === DECISION_TRACE_VERSION
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
      trace.statedReasoning === undefined
      || typeof trace.statedReasoning === 'string'
    )
    && validComponentVersions(trace.componentVersions)
    && validLanguageTrace(trace.languageEvidence, trace)
    && validPublicObserverTrace(trace.publicObserver, trace)
    && validPrivateIdentityTrace(
      trace.privateIdentity,
      trace,
      hostView?.rolesInPlay,
    )
    && validPlanOutcomeTrace(
      trace.privatePlanOutcome,
      trace,
      req,
      decision,
      hostView,
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

/** Optional protocol extension: external agents may return a private trace. */
export function parseStdioDecisionReply(
  req: DecisionRequest,
  reply: unknown,
  label = 'external agent',
  hostView?: Pick<PlayerView, 'rolesInPlay'>,
): AgentOutput {
  const record = reply as Record<string, unknown>
  const decision = record?.decision as Decision | undefined
  if (!decision || decision.kind !== req.kind) {
    throw new Error(`${label} returned invalid decision for ${req.kind}`)
  }
  if (record.trace === undefined) return decision
  if (
    !validDecisionTrace(
      req,
      decision,
      record.trace,
      hostView,
    )
  ) {
    throw new Error(`${label} returned invalid decision trace for ${req.kind}`)
  }
  return { decision, trace: record.trace }
}

export function createStdioAgent(opts: StdioAgentOpts): AvalonAgent {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const label = opts.label ?? opts.cmd
  let child: ChildProcessWithoutNullStreams | null = null
  let nextId = 1
  const pending = new Map<number, (msg: unknown) => void>()
  let helloPromise: Promise<Hello> | null = null

  function start(): Promise<Hello> {
    if (helloPromise) return helloPromise
    helloPromise = new Promise<Hello>((resolveHello, rejectHello) => {
      const proc = spawn(opts.cmd, opts.args, { stdio: ['pipe', 'pipe', 'pipe'] })
      child = proc
      let helloSeen = false
      proc.on('error', (err) => rejectHello(new Error(`agent "${label}" failed to start: ${err.message}`)))
      proc.on('exit', () => {
        if (!helloSeen) rejectHello(new Error(`agent "${label}" exited before hello`))
        for (const resolve of pending.values()) {
          resolve(new Error(`agent "${label}" exited`))
        }
        pending.clear()
      })
      const rl = createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          return // ignore non-JSON noise on stdout
        }
        if (msg.type === 'hello' && !helloSeen) {
          helloSeen = true
          resolveHello(msg as unknown as Hello)
          return
        }
        const id = msg.id as number
        const resolve = pending.get(id)
        if (resolve) {
          pending.delete(id)
          resolve(msg)
        }
      })
      const t = setTimeout(() => {
        if (!helloSeen) rejectHello(new Error(`agent "${label}" hello timeout`))
      }, timeoutMs)
      t.unref?.()
    })
    return helloPromise
  }

  return {
    recordDecisionTrace(trace) {
      opts.onDecisionTrace?.(trace)
    },
    async decide(req: DecisionRequest, view: PlayerView): Promise<AgentOutput> {
      const hello = await start()
      if (req.kind === 'discuss' && hello.capabilities?.discuss === false) {
        return { kind: 'discuss', say: '' }
      }
      const id = nextId++
      const reply = await new Promise<unknown>((resolve, reject) => {
        pending.set(id, resolve)
        const t = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`agent "${label}" timed out on ${req.kind}`))
        }, timeoutMs)
        t.unref?.()
        child!.stdin.write(JSON.stringify({ id, type: 'decide', request: req, view }) + '\n')
      })
      if (reply instanceof Error) throw reply
      return parseStdioDecisionReply(
        req,
        reply,
        `agent "${label}"`,
        view,
      )
    },
    dispose() {
      child?.kill()
      child = null
    },
  }
}
