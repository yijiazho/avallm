// Validation harness for caller-supplied candidate score surfaces. Kept apart
// from the built-in scorer identities in score.ts: this is the quarantine that
// runs on untrusted plugin output, and it depends on score.ts only for the
// CandidateScore/CandidateScoringContext shapes and the surface byte ceiling.
import {
  plainDetachedData,
  probability,
  sequenceEqual,
} from '../components/canonical-shape.ts'
import {
  stableProbabilitySum,
  PROBABILITY_TOLERANCE,
  SEEDED_SELECTION_MARGIN,
  SELECTION_ADJUSTMENT_REPLAY_TOLERANCE,
} from '../components/probability-arithmetic.ts'
import { canonicalTeam } from '../../engine/seatset.ts'
import { GOOD_VOTE_SITUATION_VERSION } from '../analysis/situation-types.ts'
import type { PolicyCandidate } from './types.ts'
import {
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  goodVoteValue,
  isGoodVoteUtilityVersion,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  stablePolicyBucket,
  type GoodProposalFeatures,
  type GoodVoteFeatures,
  type GoodVoteSelectionMode,
  type GoodVoteUtilityVersion,
} from './good-score-contract.ts'
import { compareCandidateIds } from './candidates.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
} from './evil-score-contract.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
} from '../analysis/morgana-role-utility.ts'
import {
  MAX_CANDIDATE_SCORE_SURFACE_JSON_BYTES,
  type CandidateScore,
  type CandidateScoringContext,
} from './score.ts'

function validGoodProposalFeatures(
  features: GoodProposalFeatures,
  context: CandidateScoringContext,
  candidate: PolicyCandidate,
): boolean {
  const decision = candidate.decision
  if (decision.kind !== 'propose') return false
  const assessment = context.analysis.policyCandidateAssessments.find(
    (candidateAssessment) =>
      candidateAssessment.candidateId === candidate.id,
  )
  if (
    !assessment
    || features.version !== GOOD_PROPOSAL_FEATURE_VERSION
    || features.semantics !== assessment.probabilitySemantics
    || features.beliefModelVersion !== assessment.beliefModelVersion
    || features.beliefThroughSeq !== assessment.beliefThroughSeq
    || features.beliefThroughSeq !== context.analysis.throughSeq
    || !Array.isArray(features.team)
    || features.team.some((seat) => !Number.isInteger(seat))
    || features.team.length !== decision.team.length
    || features.team.some((seat, index) =>
      seat !== [...decision.team].sort((a, b) => a - b)[index])
    || !probability(features.cleanProbability)
    || !Array.isArray(features.evilCountDistribution)
    || features.evilCountDistribution.length !== decision.team.length + 1
    || features.evilCountDistribution.length
      !== assessment.evilCountDistribution.length
    || features.evilCountDistribution.some((value) => !probability(value))
    || features.evilCountDistribution.some(
      (value, index) =>
        Math.abs(value - assessment.evilCountDistribution[index]) > PROBABILITY_TOLERANCE,
    )
  ) {
    return false
  }
  const total = stableProbabilitySum(
    features.evilCountDistribution,
    (value) => value,
  )
  return Math.abs(total - 1) <= PROBABILITY_TOLERANCE
    && Math.abs(
      features.cleanProbability - features.evilCountDistribution[0],
    ) <= PROBABILITY_TOLERANCE
    && Math.abs(
      features.cleanProbability - assessment.cleanProbability,
    ) <= PROBABILITY_TOLERANCE
}

function sameDistribution(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length
    && left.every(
      (value, index) => Math.abs(value - right[index]) <= PROBABILITY_TOLERANCE,
    )
}

interface GoodVoteUtility {
  currentTeam: readonly number[]
  currentCleanProbability: number
  currentEvilCountDistribution: readonly number[]
  bestAlternativeCandidateId: string
  bestAlternativeTeam: readonly number[]
  bestAlternativeCleanProbability: number
  bestAlternativeEvilCountDistribution: readonly number[]
  futureQuestsRemain: boolean
  stake: number
  alternativeRealization: number
  hammerPenalty: number
  informationBonus: number
  dirtyApprovalCost: number
  approveUtility: number
  rejectUtility: number
}

/**
 * Recompute the good-side vote projection from the situation analysis and
 * cross-check every recorded join (team surface, current team, best
 * alternative, distributions). Any inconsistency throws rather than returning a
 * partial value, and validGoodVoteFeatures relies on that throw to reject a
 * feature set whose numbers do not restate.
 */
function goodVoteUtility(
  context: CandidateScoringContext,
  utilityVersion: GoodVoteUtilityVersion,
): GoodVoteUtility {
  const projection = context.analysis.goodVote
  const surface = context.hypotheticalTeamCandidates
  if (
    context.request.kind !== 'vote'
    || context.view.alignment !== 'good'
    || !projection
    || projection.version !== GOOD_VOTE_SITUATION_VERSION
    || !['uniform-feasible-joint', 'weighted-joint'].includes(
      projection.probabilitySemantics,
    )
    || projection.beliefModelVersion !== context.analysis.goodVote?.beliefModelVersion
    || projection.beliefThroughSeq !== context.analysis.throughSeq
    || !surface?.length
    || !context.view.currentTeam?.length
  ) {
    throw new Error('good vote scorer requires a complete vote projection')
  }

  const expected = new Map<string, readonly number[]>()
  for (const candidate of surface) {
    if (candidate.decision.kind !== 'propose' || expected.has(candidate.id)) {
      throw new Error('good vote scorer received an invalid team surface')
    }
    expected.set(candidate.id, canonicalTeam(candidate.decision.team))
  }
  const assessments = new Map(
    context.analysis.policyCandidateAssessments.map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  )
  if (
    assessments.size !== context.analysis.policyCandidateAssessments.length
    || assessments.size !== expected.size
  ) {
    throw new Error('good vote scorer requires one assessment per legal team')
  }
  for (const [candidateId, team] of expected) {
    const assessment = assessments.get(candidateId)
    if (
      !assessment
      || !sequenceEqual(assessment.team, team)
      || assessment.beliefModelVersion !== projection.beliefModelVersion
      || assessment.beliefThroughSeq !== projection.beliefThroughSeq
      || assessment.probabilitySemantics
        !== projection.probabilitySemantics
    ) {
      throw new Error(`good vote assessment mismatch for ${candidateId}`)
    }
  }

  const currentTeam = canonicalTeam(context.view.currentTeam)
  const currentMatches = [...expected.entries()].filter(
    ([, team]) => sequenceEqual(team, currentTeam),
  )
  if (
    currentMatches.length !== 1
    || projection.currentCandidateId !== currentMatches[0][0]
    || !sequenceEqual(projection.currentTeam.team, currentTeam)
  ) {
    throw new Error('good vote current-team join mismatch')
  }
  const alternatives = [...assessments.values()]
    .filter(
      (assessment) => assessment.candidateId !== projection.currentCandidateId,
    )
    .sort((left, right) =>
      right.cleanProbability - left.cleanProbability
      || compareCandidateIds(left.candidateId, right.candidateId))
  const best = alternatives[0]
  if (
    !best
    || projection.bestAlternative.candidateId !== best.candidateId
    || !sequenceEqual(projection.bestAlternative.team, best.team)
    || Math.abs(
      projection.bestAlternative.cleanProbability - best.cleanProbability,
    ) > PROBABILITY_TOLERANCE
    || !sameDistribution(
      projection.bestAlternative.evilCountDistribution,
      best.evilCountDistribution,
    )
    || Math.abs(
      projection.currentTeam.cleanProbability
      - context.analysis.currentTeam!.cleanProbability,
    ) > PROBABILITY_TOLERANCE
    || !sameDistribution(
      projection.currentTeam.evilCountDistribution,
      context.analysis.currentTeam!.evilCountDistribution,
    )
  ) {
    throw new Error('good vote best-alternative join mismatch')
  }

  const futureQuestsRemain =
    context.view.round < context.view.quests.length
    && !context.analysis.matchPoint.good
    && !context.analysis.matchPoint.evil
  const value = goodVoteValue({
    currentCleanProbability: projection.currentTeam.cleanProbability,
    bestAlternativeCleanProbability: best.cleanProbability,
    matchPointGood: context.analysis.matchPoint.good,
    matchPointEvil: context.analysis.matchPoint.evil,
    futureQuestsRemain,
    rejectionsBeforeHammer: context.analysis.rejectionsBeforeHammer,
  }, utilityVersion)
  return {
    currentTeam,
    currentCleanProbability: projection.currentTeam.cleanProbability,
    currentEvilCountDistribution:
      projection.currentTeam.evilCountDistribution,
    bestAlternativeCandidateId: projection.bestAlternative.candidateId,
    bestAlternativeTeam: projection.bestAlternative.team,
    bestAlternativeCleanProbability:
      projection.bestAlternative.cleanProbability,
    bestAlternativeEvilCountDistribution:
      projection.bestAlternative.evilCountDistribution,
    futureQuestsRemain,
    stake: value.stake,
    alternativeRealization: value.alternativeRealization,
    hammerPenalty: value.hammerPenalty,
    informationBonus: value.informationBonus,
    dirtyApprovalCost: value.dirtyApprovalCost,
    approveUtility: value.approveUtility,
    rejectUtility: value.rejectUtility,
  }
}

function validGoodVoteFeatures(
  features: GoodVoteFeatures,
  context: CandidateScoringContext,
  candidate: PolicyCandidate,
): boolean {
  if (
    candidate.decision.kind !== 'vote'
    || features.version !== GOOD_VOTE_FEATURE_VERSION
    || !isGoodVoteUtilityVersion(features.utilityVersion)
    || features.situationVersion !== GOOD_VOTE_SITUATION_VERSION
    || features.semantics
      !== context.analysis.goodVote?.probabilitySemantics
  ) {
    return false
  }
  let expected: GoodVoteUtility
  try {
    // The declared version selects the formula, so a feature set cannot claim
    // one value function and carry the other one's numbers.
    expected = goodVoteUtility(context, features.utilityVersion)
  } catch {
    return false
  }
  const baseUtility = candidate.decision.vote === 'approve'
    ? expected.approveUtility
    : expected.rejectUtility
  return (
    features.beliefModelVersion
      === context.analysis.goodVote!.beliefModelVersion
    && features.beliefThroughSeq === context.analysis.throughSeq
    && sequenceEqual(features.currentTeam, expected.currentTeam)
    && Math.abs(
      features.currentCleanProbability - expected.currentCleanProbability,
    ) <= PROBABILITY_TOLERANCE
    && sameDistribution(
      features.currentEvilCountDistribution,
      expected.currentEvilCountDistribution,
    )
    && features.bestAlternativeCandidateId
      === expected.bestAlternativeCandidateId
    && sequenceEqual(
      features.bestAlternativeTeam,
      expected.bestAlternativeTeam,
    )
    && Math.abs(
      features.bestAlternativeCleanProbability
      - expected.bestAlternativeCleanProbability,
    ) <= PROBABILITY_TOLERANCE
    && sameDistribution(
      features.bestAlternativeEvilCountDistribution,
      expected.bestAlternativeEvilCountDistribution,
    )
    && features.boardScore.good === context.analysis.score.good
    && features.boardScore.evil === context.analysis.score.evil
    && features.proposalNumber === context.analysis.proposalNumber
    && features.rejectionsBeforeHammer
      === context.analysis.rejectionsBeforeHammer
    && features.futureQuestsRemain === expected.futureQuestsRemain
    && Math.abs(features.stake - expected.stake) <= PROBABILITY_TOLERANCE
    && Math.abs(
      features.alternativeRealization - expected.alternativeRealization,
    ) <= PROBABILITY_TOLERANCE
    && Math.abs(features.hammerPenalty - expected.hammerPenalty) <= PROBABILITY_TOLERANCE
    && Math.abs(features.informationBonus - expected.informationBonus) <= PROBABILITY_TOLERANCE
    && Math.abs(features.approveUtility - expected.approveUtility) <= PROBABILITY_TOLERANCE
    && Math.abs(features.rejectUtility - expected.rejectUtility) <= PROBABILITY_TOLERANCE
    && Math.abs(features.baseUtility - baseUtility) <= PROBABILITY_TOLERANCE
    && features.viableBand === GOOD_VOTE_UTILITY_CONSTANTS.viableBand
    && features.inViableBand === (
      Math.abs(expected.approveUtility - expected.rejectUtility)
      <= GOOD_VOTE_UTILITY_CONSTANTS.viableBand
    )
    && Number.isFinite(features.selectionAdjustment)
    && (
      features.seedBucket === undefined
      || features.seedBucket === 0
      || features.seedBucket === 1
    )
  )
}

/**
 * Enforce the scorer/plugin boundary. A scorer may remove additional
 * dominated candidates, but it cannot reopen a forced-policy removal or
 * change the legal candidate surface.
 */
export function validateCandidateScores(
  context: CandidateScoringContext,
  scores: readonly CandidateScore[],
  scorerVersion: string,
): void {
  if (typeof scorerVersion !== 'string' || !scorerVersion.trim()) {
    throw new Error('candidate scorer must have a non-empty version')
  }
  // Both rejections below used to share one 'unsafe detached data' message, so
  // an oversized surface reported itself as a malformed one. They are also the
  // rejections a plugin author is least able to diagnose from the payload: a
  // scorer that reuses one frozen constant across rows is refused for the
  // reuse, which is invisible when inspecting any single row, and the throw is
  // swallowed by custom-scoring into the native fallback. So each says what it
  // actually found.
  if (!plainDetachedData(scores)) {
    throw new Error(
      'invalid candidate score surface: scores must be detached JSON-shaped '
        + 'data. Rejected for a proxy, an accessor, a non-enumerable or symbol '
        + 'key, an exotic prototype, a non-finite number, or the same object '
        + 'reachable by two paths (reusing one shared constant across rows '
        + 'counts, and so does a cycle). Build each row independently.',
    )
  }
  if (
    Buffer.byteLength(JSON.stringify(scores), 'utf8')
      > MAX_CANDIDATE_SCORE_SURFACE_JSON_BYTES
  ) {
    throw new Error(
      'invalid candidate score surface: serialized scores exceed '
        + `${MAX_CANDIDATE_SCORE_SURFACE_JSON_BYTES} bytes`,
    )
  }
  if (scores.length !== context.candidates.length) {
    throw new Error('candidate scorer did not score the complete legal surface')
  }
  const candidateIds = new Set(
    context.candidates.map((candidate) => candidate.id),
  )
  const candidatesById = new Map(
    context.candidates.map((candidate) => [candidate.id, candidate]),
  )
  const allowed = new Set(
    context.candidateBoundary.survivorCandidateIds,
  )
  const goodProposalSemantics =
    (
      scorerVersion === GOOD_PROPOSAL_SCORER_VERSION
      || scorerVersion === GOOD_PROPOSAL_VOTE_SCORER_VERSION
      || scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
    )
    && context.request.kind === 'propose'
    && context.view.alignment === 'good'
  const goodVoteSemantics =
    (
      scorerVersion === GOOD_PROPOSAL_VOTE_SCORER_VERSION
      || scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
    )
    && context.request.kind === 'vote'
    && context.view.alignment === 'good'
  const seen = new Set<string>()
  for (const score of scores) {
    const forcedAllowed = allowed.has(score.candidateId)
    const validGoodSemantics = !goodProposalSemantics || (
      score.features?.version === GOOD_PROPOSAL_FEATURE_VERSION
      && score.viable === forcedAllowed
      && score.value === (
        forcedAllowed
          ? score.features.cleanProbability
          : -Number.MAX_SAFE_INTEGER
      )
    )
    const candidate = candidatesById.get(score.candidateId)
    const validFeatures = score.features === undefined
      || (
        candidate !== undefined
        && (
          score.features.version === GOOD_PROPOSAL_FEATURE_VERSION
            ? validGoodProposalFeatures(score.features, context, candidate)
            : score.features.version === GOOD_VOTE_FEATURE_VERSION
              ? validGoodVoteFeatures(score.features, context, candidate)
              : false
        )
      )
    const validVoteSemantics = !goodVoteSemantics || (
      score.features?.version === GOOD_VOTE_FEATURE_VERSION
      && score.value === (
        forcedAllowed
          ? score.features.baseUtility + score.features.selectionAdjustment
          : -Number.MAX_SAFE_INTEGER
      )
    )
    if (
      score.version !== scorerVersion
      || !candidateIds.has(score.candidateId)
      || seen.has(score.candidateId)
      || !Number.isFinite(score.value)
      || typeof score.viable !== 'boolean'
      || !Array.isArray(score.reasonCodes)
      || score.reasonCodes.some((reason) => typeof reason !== 'string')
      || (
        score.roleObjectiveFeatures !== undefined
        && scorerVersion !== ROLE_OBJECTIVE_SCORER_VERSION
        && scorerVersion !== ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      )
      || (
        score.evilRoleObjectiveFeatures !== undefined
        && scorerVersion !== EVIL_ROLE_OBJECTIVE_SCORER_VERSION
        && scorerVersion !== EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      )
      || (
        score.morganaRoleObjectiveFeatures !== undefined
        && scorerVersion !== MORGANA_ROLE_SCORER_VERSION
        && scorerVersion !== MORGANA_ROLE_SEEDED_SCORER_VERSION
      )
      || !validFeatures
      || !validGoodSemantics
      || !validVoteSemantics
      || (
        score.features !== undefined
        && !goodProposalSemantics
        && !goodVoteSemantics
      )
      || (
        goodProposalSemantics
        && score.features?.version !== GOOD_PROPOSAL_FEATURE_VERSION
      )
      || (
        goodVoteSemantics
        && score.features?.version !== GOOD_VOTE_FEATURE_VERSION
      )
      || (
        (
          scorerVersion === GOOD_PROPOSAL_SCORER_VERSION
          || scorerVersion === GOOD_PROPOSAL_VOTE_SCORER_VERSION
          || scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        )
        && !goodProposalSemantics
        && !goodVoteSemantics
        && score.features !== undefined
      )
      || (score.viable && !allowed.has(score.candidateId))
    ) {
      throw new Error(`invalid candidate score for ${score.candidateId}`)
    }
    seen.add(score.candidateId)
  }
  if (goodVoteSemantics) {
    const voteScores = scores.map((score) => ({
      score,
      features: score.features as GoodVoteFeatures,
    }))
    const allowedVoteScores = voteScores.filter(({ score }) =>
      allowed.has(score.candidateId))
    const maxBase = Math.max(
      ...allowedVoteScores.map(({ features }) => features.baseUtility),
    )
    const topId = allowedVoteScores
      .filter(({ features }) => features.baseUtility === maxBase)
      .map(({ score }) => score.candidateId)
      .sort(compareCandidateIds)[0]
    const selectionMode: GoodVoteSelectionMode =
      scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        ? 'seeded-band'
        : 'top-utility'
    const bandActive =
      selectionMode === 'seeded-band'
      && allowedVoteScores.length > 1
      && allowedVoteScores.every(({ features }) => features.inViableBand)
    const expectedSeedBucket = bandActive
      ? stablePolicyBucket([
          context.deterministicSeed,
          context.request.seat,
          context.request.kind,
          context.request.round,
          context.request.proposalNum,
          context.analysis.throughSeq,
        ].join(':'))
      : undefined
    const expectedSeededVote =
      expectedSeedBucket === 0 ? 'approve' : 'reject'
    const isExpectedSeededVote = (candidateId: string): boolean => {
      const decision = candidatesById.get(candidateId)?.decision
      return decision?.kind === 'vote' && decision.vote === expectedSeededVote
    }
    if (
      voteScores.some(({ score, features }) =>
        features.selectionMode !== selectionMode
        || features.viableBand !== GOOD_VOTE_UTILITY_CONSTANTS.viableBand
        || (!allowed.has(score.candidateId) && score.viable)
        || (
          selectionMode === 'top-utility'
          && (
            features.selectionAdjustment !== 0
            || features.seedBucket !== undefined
            || score.viable !== (score.candidateId === topId)
          )
        )
        || (
          selectionMode === 'seeded-band'
          && !bandActive
          && (
            features.selectionAdjustment !== 0
            || features.seedBucket !== undefined
            || score.viable !== (score.candidateId === topId)
          )
        )
        || (
          bandActive
          && (
            !allowed.has(score.candidateId)
            || !score.viable
            || features.seedBucket !== expectedSeedBucket
            || Math.abs(
              features.selectionAdjustment
              - (
                (
                  isExpectedSeededVote(score.candidateId)
                )
                  ? maxBase - features.baseUtility + SEEDED_SELECTION_MARGIN
                  : 0
              ),
            ) > SELECTION_ADJUSTMENT_REPLAY_TOLERANCE
          )
        ))
    ) {
      throw new Error('invalid good vote selection semantics')
    }
  }
  const viable = scores.filter((score) => score.viable)
  if (!viable.length) {
    throw new Error('candidate scorer removed every forced-policy candidate')
  }
  if (
    context.candidateBoundary.selectedCandidateId
    && !viable.some(
      (score) =>
        score.candidateId === context.candidateBoundary.selectedCandidateId,
    )
  ) {
    throw new Error('candidate scorer removed the forced selection')
  }
}
