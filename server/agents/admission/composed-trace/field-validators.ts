// Per-field validators: each takes one field of a trace and decides whether it
// is admissible on its own terms. Held apart from the cross-field relation
// validators because the two answer different questions, and because a field
// validator that quietly starts reaching across fields is a relation in
// disguise. Having to move it to another file is the friction that makes that
// drift visible while it is still small.

import type {
  PlayerView,
} from '../../../engine/types.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  isEvilObjectiveRole,
} from '../../analysis/evil-objective-types.ts'
import {
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
} from '../../analysis/evil-role-utility.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
} from '../../analysis/morgana-counterfeit-types.ts'
import {
  MORGANA_ROLE_SCORE_FEATURE_VERSION,
  MORGANA_ROLE_UTILITY_CONSTANTS,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../../analysis/morgana-role-utility.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../../analysis/observer-types.ts'
import {
  observePublicRecord,
  validatePublicObserverSnapshot,
} from '../../analysis/observer.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../../analysis/role-objective-types.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../../analysis/role-utility.ts'
import {
  GOOD_VOTE_SITUATION_VERSION,
} from '../../analysis/situation-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  validatePrivateIdentityHostJoin,
} from '../../belief/identity.ts'
import {
  LANGUAGE_BELIEF_VERSION_SUFFIX,
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
} from '../../belief/language-factor.ts'
import {
  LEGAL_CANDIDATE_VERSION,
} from '../../candidate/types.ts'
import {
  exactKeys,
  onlyAllowedKeys,
  probability,
} from '../../canonical/canonical-shape.ts'
import {
  PROBABILITY_TOLERANCE,
  stableProbabilitySum,
} from '../../canonical/probability-arithmetic.ts'
import {
  INVALID_LANGUAGE_INTERPRETER_VERSION,
  LANGUAGE_ORCHESTRATION_DEGRADATIONS,
} from '../../communication/language-orchestration.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  EVIL_ROLE_OBJECTIVE_UTILITY_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  GOOD_VOTE_UTILITY_VERSION,
  ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  ROLE_OBJECTIVE_UTILITY_VERSION,
  goodVoteValue,
  isGoodVoteUtilityVersion,
} from '../../policy/score.ts'
import {
  LANGUAGE_CURSOR_VERSION,
  LANGUAGE_INTERPRETER_INPUT_VERSION,
} from '../../record/language-types.ts'
import {
  projectPublicRecord,
} from '../../record/public-record.ts'
import {
  componentVersionsOf,
  stringArray,
} from '../trace-primitives.ts'
import type {
  TraceValidationInput,
} from '../trace-primitives.ts'
import {
  EVIL_ROLE_OBJECTIVE_FEATURE_KEYS,
  LANGUAGE_TRACE_KEYS,
  MORGANA_ROLE_OBJECTIVE_FEATURE_KEYS,
  OPTIONAL_COMPONENT_VERSION_VALUES,
  OPTIONAL_FREEFORM_VERSION_KEYS,
  REQUIRED_COMPONENT_VERSION_KEYS,
  ROLE_OBJECTIVE_FEATURE_KEYS,
  validSeedBucket,
} from './key-lists.ts'
import {
  PRODUCTION_COMPONENT_REGISTRY,
} from './production-registries.ts'
import {
  canonicalTraceSeats,
  isFullPlayerView,
} from './trace-shape.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

export function validRelevantTeam(
  value: unknown,
  playerCount: number | undefined,
): boolean {
  if (value === undefined) return true
  const team = value as Record<string, unknown>
  return !!team
    && typeof team === 'object'
    && canonicalTraceSeats(team.team, playerCount)
    && probability(team.cleanProbability)
    && Array.isArray(team.evilCountDistribution)
    && team.evilCountDistribution.length === team.team.length + 1
    && team.evilCountDistribution.every(probability)
    // A good viewer knows no fails aboard, so the empty list is the norm here.
    && canonicalTraceSeats(team.knownFailsAboard, playerCount, true)
}

export function validComponentVersions(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const versions = value as Record<string, unknown>
  const nonEmptyString = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && candidate.length > 0
  // Required keys are always present resolved version strings.
  if (!REQUIRED_COMPONENT_VERSION_KEYS.every((key) => nonEmptyString(versions[key]))) {
    return false
  }
  // Free-form opt-ins: absent, or any non-empty resolved version string.
  for (const key of OPTIONAL_FREEFORM_VERSION_KEYS) {
    if (versions[key] !== undefined && !nonEmptyString(versions[key])) return false
  }
  // Fixed-literal opt-ins: absent, or one of the allowed resolved versions.
  for (const [key, allowed] of Object.entries(
    OPTIONAL_COMPONENT_VERSION_VALUES as Record<string, readonly string[]>,
  )) {
    const present = versions[key]
    if (present !== undefined && !allowed.includes(present as string)) return false
  }
  // configuredScorer records a resolved-away configured choice, so it is present
  // only as a non-empty string distinct from the scorer actually run.
  if (
    versions.configuredScorer !== undefined
    && !(
      nonEmptyString(versions.configuredScorer)
      && versions.configuredScorer !== versions.scorer
    )
  ) {
    return false
  }
  // Relational invariants: each role-utility projection implies its source
  // objective, and plan memory and its coherence projection toggle together.
  if (
    versions.roleUtility !== undefined
    && versions.roleObjective !== ROLE_OBJECTIVE_MODEL_VERSION
  ) {
    return false
  }
  if (
    versions.evilRoleUtility !== undefined
    && versions.roleObjective !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  ) {
    return false
  }
  if (
    versions.morganaRoleUtility !== undefined
    && !(
      versions.evilRoleUtility === EVIL_ROLE_UTILITY_PROJECTION_VERSION
      && versions.morganaCounterfeitObjective
        === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    )
  ) {
    return false
  }
  return (versions.planMemory === undefined) === (versions.coherence === undefined)
}

export function validPlanOutcomeTrace(
  value: unknown,
  trace: TraceValidationInput,
): boolean {
  const components = componentVersionsOf(trace)
  // Stdio replies arrive before engine legality. A child cannot truthfully
  // serialize a post-apply outcome in this protocol version.
  return value === undefined
    && components?.planMemory === undefined
    && components?.coherence === undefined
    && trace.coherenceIntent === undefined
}

export function validLanguageTrace(
  value: unknown,
  trace: TraceValidationInput,
): boolean {
  const components = componentVersionsOf(trace)
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
  if (!onlyAllowedKeys(language, LANGUAGE_TRACE_KEYS)) {
    return false
  }
  const admitted = language.admittedSourceSeqs
  const cumulative = language.cumulativeSourceSeqs
  const degradation = language.degradation
  const allowedDegradation = new Set<string>(
    LANGUAGE_ORCHESTRATION_DEGRADATIONS,
  )
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

export function validPublicObserverTrace(
  value: unknown,
  trace: TraceValidationInput,
  hostView?: Pick<PlayerView, 'rolesInPlay'>,
): boolean {
  const components = componentVersionsOf(trace)
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

export function validPrivateIdentityTrace(
  value: unknown,
  trace: TraceValidationInput,
  hostRolesInPlay: readonly unknown[] | undefined,
): boolean {
  const components = componentVersionsOf(trace)
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

export function validBeliefProvenance(value: unknown): boolean {
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

export function validBeliefPlayerMarginals(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  return value.every((entry, index) => {
    const marginal = entry as Record<string, unknown>
    return !!marginal
      && typeof marginal === 'object'
      && marginal.seat === index
      && probability(marginal.goodProbability)
      && probability(marginal.evilProbability)
      && Math.abs(
        marginal.goodProbability + marginal.evilProbability - 1,
      ) <= PROBABILITY_TOLERANCE
  })
}

/**
 * A per-team evil-count distribution: a probability vector one longer than the
 * team, summing to one within tolerance, whose clean-team mass (index 0) matches
 * the separately declared cleanProbability. Callers pass the already-narrowed
 * team length and their own cleanProbability, and gate this behind their own
 * `probability(cleanProbability)` check exactly as before.
 */
function validEvilCountDistribution(
  distribution: unknown,
  teamLen: number,
  cleanProbability: number,
): boolean {
  return (
    Array.isArray(distribution)
    && distribution.length === teamLen + 1
    && distribution.every(probability)
    && Math.abs(
      stableProbabilitySum(distribution, (mass) => mass) - 1,
    ) <= PROBABILITY_TOLERANCE
    && Math.abs(distribution[0] - cleanProbability) <= PROBABILITY_TOLERANCE
  )
}

export function validBeliefTeamAssessments(
  value: unknown,
  playerCount: number | undefined,
): boolean {
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
      && canonicalTraceSeats(team, playerCount)
      && probability(assessment.cleanProbability)
      && validEvilCountDistribution(
        distribution,
        team.length,
        assessment.cleanProbability,
      )
      && canonicalTraceSeats(assessment.knownFailsAboard, playerCount, true)
  })
}

export function validCandidateScores(
  value: unknown,
  playerCount: number | undefined,
): boolean {
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
      && canonicalTraceSeats(team, playerCount)
      && probability(features.cleanProbability)
      && validEvilCountDistribution(
        distribution,
        team.length,
        features.cleanProbability,
      )
    )
    const currentDistribution = features?.currentEvilCountDistribution
    const alternativeDistribution =
      features?.bestAlternativeEvilCountDistribution
    const currentTeam = features?.currentTeam
    const alternativeTeam = features?.bestAlternativeTeam
    const boardScore = features?.boardScore as
      | Record<string, unknown>
      | undefined
    const declaredUtilityVersion =
      isGoodVoteUtilityVersion(features?.utilityVersion)
        ? features.utilityVersion
        : GOOD_VOTE_UTILITY_VERSION
    // Restated through the one shared value function rather than a fourth copy
    // of the arithmetic, and through the version the features declare, so a
    // trace cannot name one value function while carrying the other's numbers.
    // Absent or non-numeric inputs make these expectations NaN, and every
    // comparison below is a tolerance check, so an unusable trace fails closed.
    // The board score is additionally required outright further down.
    const expectedValue = goodVoteValue(
      {
        currentCleanProbability: Number(features?.currentCleanProbability),
        bestAlternativeCleanProbability: Number(
          features?.bestAlternativeCleanProbability,
        ),
        matchPointGood: boardScore?.good === 2,
        matchPointEvil: boardScore?.evil === 2,
        futureQuestsRemain: features?.futureQuestsRemain === true,
        rejectionsBeforeHammer: Number(features?.rejectionsBeforeHammer),
      },
      declaredUtilityVersion,
    )
    const validVoteFeatures = (
      !!features
      && typeof features === 'object'
      && !Array.isArray(features)
      && features.version === GOOD_VOTE_FEATURE_VERSION
      && isGoodVoteUtilityVersion(features.utilityVersion)
      && features.situationVersion === GOOD_VOTE_SITUATION_VERSION
      && ['uniform-feasible-joint', 'weighted-joint'].includes(
        features.semantics as string,
      )
      && typeof features.beliefModelVersion === 'string'
      && features.beliefModelVersion.length > 0
      && Number.isInteger(features.beliefThroughSeq)
      && canonicalTraceSeats(currentTeam, playerCount)
      && probability(features.currentCleanProbability)
      && validEvilCountDistribution(
        currentDistribution,
        currentTeam.length,
        features.currentCleanProbability,
      )
      && typeof features.bestAlternativeCandidateId === 'string'
      && features.bestAlternativeCandidateId.startsWith(
        `${LEGAL_CANDIDATE_VERSION}:propose:`,
      )
      && canonicalTraceSeats(alternativeTeam, playerCount)
      && features.bestAlternativeCandidateId === (
        `${LEGAL_CANDIDATE_VERSION}:propose:`
        + alternativeTeam.join(',')
      )
      && !isDeepStrictEqual(currentTeam, alternativeTeam)
      && probability(features.bestAlternativeCleanProbability)
      && validEvilCountDistribution(
        alternativeDistribution,
        alternativeTeam.length,
        features.bestAlternativeCleanProbability,
      )
      && !!boardScore
      && typeof boardScore === 'object'
      && Number.isInteger(boardScore.good)
      && Number.isInteger(boardScore.evil)
      && Number.isInteger(features.proposalNumber)
      && Number.isInteger(features.rejectionsBeforeHammer)
      && typeof features.futureQuestsRemain === 'boolean'
      && typeof features.stake === 'number'
      && Number.isFinite(features.stake)
      && Math.abs(features.stake - expectedValue.stake) <= PROBABILITY_TOLERANCE
      && typeof features.alternativeRealization === 'number'
      && Number.isFinite(features.alternativeRealization)
      && Math.abs(
        features.alternativeRealization - expectedValue.alternativeRealization,
      ) <= PROBABILITY_TOLERANCE
      && typeof features.hammerPenalty === 'number'
      && Number.isFinite(features.hammerPenalty)
      && Math.abs(
        features.hammerPenalty - expectedValue.hammerPenalty,
      ) <= PROBABILITY_TOLERANCE
      && typeof features.informationBonus === 'number'
      && Number.isFinite(features.informationBonus)
      && Math.abs(
        features.informationBonus - expectedValue.informationBonus,
      ) <= PROBABILITY_TOLERANCE
      && typeof features.approveUtility === 'number'
      && Number.isFinite(features.approveUtility)
      && Math.abs(
        features.approveUtility - expectedValue.approveUtility,
      ) <= PROBABILITY_TOLERANCE
      && typeof features.rejectUtility === 'number'
      && Number.isFinite(features.rejectUtility)
      && Math.abs(
        features.rejectUtility - expectedValue.rejectUtility,
      ) <= PROBABILITY_TOLERANCE
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
      && validSeedBucket(features.seedBucket)
    )
    const validFeatures = features === undefined
      || validProposalFeatures
      || validVoteFeatures
    const role = score?.roleObjectiveFeatures as
      | Record<string, unknown>
      | undefined
    const roleKeys = [
      ...ROLE_OBJECTIVE_FEATURE_KEYS,
      ...(role?.seedBucket === undefined ? [] : ['seedBucket']),
    ]
    const validRole = role === undefined || (
      onlyAllowedKeys(role, roleKeys)
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
      && probability(role.roleValue)
      && probability(role.survivorMeanRoleValue)
      && typeof role.roleAdjustment === 'number'
      && Number.isFinite(role.roleAdjustment)
      && Math.abs(
        Number(role.roleAdjustment)
        - ROLE_OBJECTIVE_UTILITY_CONSTANTS.centeredAdjustmentScale
          * (
            Number(role.roleValue)
            - Number(role.survivorMeanRoleValue)
          ),
      ) <= PROBABILITY_TOLERANCE
      && typeof role.combinedValue === 'number'
      && Number.isFinite(role.combinedValue)
      && Math.abs(
        Number(role.combinedValue)
        - Number(role.baseValue)
        - Number(role.roleAdjustment),
      ) <= PROBABILITY_TOLERANCE
      && (
        role.selectionMode === 'top-composite'
        || role.selectionMode === 'seeded-composite-band'
      )
      && role.viableBand === ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
      && typeof role.inViableBand === 'boolean'
      && typeof role.selectionAdjustment === 'number'
      && Number.isFinite(role.selectionAdjustment)
      && validSeedBucket(role.seedBucket)
      && !!role.utility
      && typeof role.utility === 'object'
      && !Array.isArray(role.utility)
    )
    const evilRole = score?.evilRoleObjectiveFeatures as
      | Record<string, unknown>
      | undefined
    const evilRoleKeys = [
      ...EVIL_ROLE_OBJECTIVE_FEATURE_KEYS,
      ...(evilRole?.seedBucket === undefined ? [] : ['seedBucket']),
    ]
    const validEvilRole = evilRole === undefined || (
      onlyAllowedKeys(evilRole, evilRoleKeys)
      && evilRole.version === EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION
      && evilRole.utilityVersion === EVIL_ROLE_OBJECTIVE_UTILITY_VERSION
      && evilRole.utilityProjectionVersion
        === EVIL_ROLE_UTILITY_PROJECTION_VERSION
      && evilRole.sourceObjectiveVersion
        === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      && isEvilObjectiveRole(evilRole.role)
      && evilRole.candidateId === score.candidateId
      && ['propose', 'vote'].includes(evilRole.kind as string)
      && probability(evilRole.roleValue)
      && (
        evilRole.selectionMode === 'top-role-utility'
        || evilRole.selectionMode === 'seeded-role-utility-band'
      )
      && evilRole.viableBand === EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
      && typeof evilRole.inViableBand === 'boolean'
      && typeof evilRole.selectionAdjustment === 'number'
      && Number.isFinite(evilRole.selectionAdjustment)
      && validSeedBucket(evilRole.seedBucket)
      && !!evilRole.utility
      && typeof evilRole.utility === 'object'
      && !Array.isArray(evilRole.utility)
    )
    const morganaRole = score?.morganaRoleObjectiveFeatures as
      | Record<string, unknown>
      | undefined
    const morganaRoleKeys = [
      ...MORGANA_ROLE_OBJECTIVE_FEATURE_KEYS,
      ...(morganaRole?.seedBucket === undefined ? [] : ['seedBucket']),
    ]
    const validMorganaRole = morganaRole === undefined || (
      exactKeys(morganaRole, morganaRoleKeys)
      && morganaRole.version === MORGANA_ROLE_SCORE_FEATURE_VERSION
      && morganaRole.utilityProjectionVersion
        === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      && morganaRole.sourceCounterfeitObjectiveVersion
        === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
      && morganaRole.sourceEvilRoleUtilityVersion
        === EVIL_ROLE_UTILITY_PROJECTION_VERSION
      && morganaRole.candidateId === score.candidateId
      && ['propose', 'vote'].includes(String(morganaRole.kind))
      && probability(morganaRole.d2RoleValue)
      && probability(morganaRole.maxD2RoleValue)
      && typeof morganaRole.d2BandFloor === 'number'
      && Number.isFinite(morganaRole.d2BandFloor)
      && morganaRole.d2ViableBand
        === MORGANA_ROLE_UTILITY_CONSTANTS.d2ViableBand
      && typeof morganaRole.inD2ViableBand === 'boolean'
      && probability(morganaRole.counterfeitValue)
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
      && validSeedBucket(morganaRole.seedBucket)
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

export function validBeliefVersionRelation(trace: TraceValidationInput): boolean {
  const components = componentVersionsOf(trace)
  return !components || components.belief === trace.beliefModelVersion
}

export function validBeliefTraceRelations(trace: TraceValidationInput): boolean {
  if (!validBeliefVersionRelation(trace)) return false
  const components = componentVersionsOf(trace)
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
