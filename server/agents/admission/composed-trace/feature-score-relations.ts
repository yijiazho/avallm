// Relations that tie a trace's candidate scores to the rest of it: score
// identity, the proposal and vote feature rows, and the forced-policy join.
// These are the relations that read the candidate score table, which no other
// relation family touches. Grouping them by the surface they interrogate is
// what keeps a change to the score shape from having to be chased through every
// relation in admission.

import {
  MAX_PROPOSALS,
  QUESTS_TO_WIN,
} from '../../../engine/rules.ts'
import type {
  DecisionRequest,
} from '../../../engine/types.ts'
import {
  isComposedPolicy,
} from '../../brain.ts'
import {
  compareCandidateIds,
} from '../../candidate/candidates.ts'
import {
  LEGAL_CANDIDATE_VERSION,
} from '../../candidate/types.ts'
import {
  SEEDED_SELECTION_MARGIN,
  SELECTION_ADJUSTMENT_REPLAY_TOLERANCE,
} from '../../canonical/probability-arithmetic.ts'
import {
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
} from '../../policy/score.ts'
import {
  componentVersionsOf,
} from '../trace-primitives.ts'
import type {
  TraceValidationInput,
} from '../trace-primitives.ts'
import {
  scorerAdmitsDiagnosticOwner,
} from './production-registries.ts'
import type {
  ComposedTraceContext,
} from './relation-context.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

export function validAbsentCandidateScores(trace: TraceValidationInput): boolean {
  const components = componentVersionsOf(trace)
  return trace.chosenCandidateId === undefined
    && trace.structuredCandidateId === undefined
    && trace.plannerCandidateId === undefined
    && trace.plannerReasonCodes === undefined
    && trace.communicationIntent === undefined
    && !isComposedPolicy(components?.policy)
}

export function validCandidateScoreIdentity(
  trace: TraceValidationInput,
  scores: Array<Record<string, unknown>>,
  components: Record<string, unknown> | undefined,
): boolean {
  if (
    components
    && scores.some((score) => score.version !== components.scorer)
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
            GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
            ROLE_OBJECTIVE_SCORER_VERSION,
            ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          ].some((owner) =>
            scorerAdmitsDiagnosticOwner(score.version, owner))
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
            GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
            ROLE_OBJECTIVE_SCORER_VERSION,
            ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          ].some((owner) =>
            scorerAdmitsDiagnosticOwner(score.version, owner))
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
  return true
}

export function validProposalFeatureScores(ctx: ComposedTraceContext): boolean {
  const { action, scores, proposalFeatureScores, chosenFeatures, relevantTeam } = ctx
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
  return true
}

export function validVoteFeatureScores(ctx: ComposedTraceContext): boolean {
  const {
    trace, scores, voteFeatureScores, roleFeatureScores, chosenFeatures, chosen,
    action, relevantTeam, components, structured,
  } = ctx
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
    const first = voteFeatureScores[0]!.features as Record<string, unknown>
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
    // NB-013 pairing law: the value function is part of the policy identity, so
    // selection mode alone no longer names the scorer. A trace that prices the
    // dirty branch has to say so, and one that does not cannot borrow the
    // weighted identity.
    const expectedScorer = mode === 'seeded-band'
      ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      : first.utilityVersion === GOOD_VOTE_BOARD_SWING_UTILITY_VERSION
        ? GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION
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
      !scorerAdmitsDiagnosticOwner(components?.scorer, expectedScorer)
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
                    ? maxBase - (features.baseUtility as number) + SEEDED_SELECTION_MARGIN
                    : 0
                return Math.abs(
                  (features.selectionAdjustment as number)
                  - expectedAdjustment,
                ) > SELECTION_ADJUSTMENT_REPLAY_TOLERANCE
              })
            )
          : (
              viable.length !== 1
              || viable[0]!.candidateId !== canonicalTop
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
  return true
}

export function validForcedPolicyRelation(ctx: ComposedTraceContext): boolean {
  const { trace, scores, ids, chosen } = ctx
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
