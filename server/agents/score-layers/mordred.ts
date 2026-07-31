import {
  MORDRED_BLINDNESS_COMPONENT,
} from '../components/native-role-components.ts'
import {
  compareCandidateIds,
} from '../policy/candidates.ts'
import {
  stablePolicyBucket,
} from '../policy/deterministic-policy.ts'
import {
  EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS,
} from '../policy/evil-score-contract.ts'
import {
  MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
  MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
  MORDRED_BLINDNESS_ROLE_UTILITY_CONSTANTS,
  mordredBlindnessRoleScorer,
  seededMordredBlindnessRoleScorer,
  type CandidateScorer,
  type MordredBlindnessRoleSelectionMode,
} from '../policy/score.ts'
import {
  scoreLayerToken,
  type ScoreLayerDefinition,
  type ScoreLayerToken,
  type ScoreLayerTransformContext,
  type ScoreLayerTransformDefinition,
} from '../policy/score-layer/types.ts'
import {
  noAnalysisTransformLayer,
  REMOVED_VALUE,
  type RoleScoreLayerPredecessors,
} from '../policy/score-layer/definition.ts'

export const MORDRED_ROLE_SCORE_LAYER = scoreLayerToken(
  'mordred-role-score',
  MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
)
export const SEEDED_MORDRED_ROLE_SCORE_LAYER = scoreLayerToken(
  'seeded-mordred-role-score',
  MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
)

/** Exact built-in identity mapping; custom same-version writers stay legacy. */
export function mordredScoreLayerTerminalFor(
  scorer: CandidateScorer | undefined,
): ScoreLayerToken | undefined {
  if (scorer === mordredBlindnessRoleScorer) {
    return MORDRED_ROLE_SCORE_LAYER
  }
  if (scorer === seededMordredBlindnessRoleScorer) {
    return SEEDED_MORDRED_ROLE_SCORE_LAYER
  }
  return undefined
}

function teamId(team: readonly number[]): string {
  return `team:${[...team].sort((left, right) => left - right).join(',')}`
}

function mordredDefinition(
  token: ScoreLayerToken,
  predecessor: ScoreLayerToken,
  selectionMode: MordredBlindnessRoleSelectionMode,
): ScoreLayerTransformDefinition {
  const seeded = selectionMode
    === 'seeded-near-equal-vote-within-d2-band'
  return noAnalysisTransformLayer({
    token,
    predecessor,
    requiredComponents: Object.freeze([MORDRED_BLINDNESS_COMPONENT]),
    applies: (context) =>
      context.view.role === 'mordred'
      && context.view.rolesInPlay.includes('merlin')
      && (
        context.request.kind === 'propose'
        || context.request.kind === 'vote'
      ),
    execute(context: ScoreLayerTransformContext) {
      const objective = context.components.require(
        MORDRED_BLINDNESS_COMPONENT,
      )
      if (
        objective.role !== 'mordred'
        || objective.request.kind !== context.request.kind
        || objective.request.seat !== context.request.seat
        || objective.request.round !== context.request.round
        || objective.request.proposalNum !== context.request.proposalNum
        || objective.source.beliefThroughSeq !== context.analysis.throughSeq
      ) throw new Error('Mordred score layer component join mismatch')

      const allowed = new Set(
        context.candidateBoundary.survivorCandidateIds,
      )
      const priorById = new Map(
        context.prior.scores.map((row) => [row.candidateId, row]),
      )
      const assessmentByTeam = new Map(
        objective.assessments.map((assessment) => [
          assessment.team.teamId,
          assessment,
        ]),
      )
      if (
        priorById.size !== context.candidates.length
        || assessmentByTeam.size !== (
          context.request.kind === 'vote' ? 1 : context.candidates.length
        )
      ) throw new Error('Mordred score layer requires complete joined surfaces')

      const joined = context.candidates.map((candidate) => {
        const prior = priorById.get(candidate.id)
        let assessment
        let utility: number
        if (context.request.kind === 'propose') {
          if (candidate.decision.kind !== 'propose') {
            throw new Error('Mordred proposal layer received foreign candidate')
          }
          assessment = assessmentByTeam.get(teamId(candidate.decision.team))
          utility = assessment?.opportunityValue ?? Number.NaN
        } else {
          if (
            candidate.decision.kind !== 'vote'
            || !context.view.currentTeam
          ) {
            throw new Error('Mordred vote layer received foreign candidate')
          }
          assessment = assessmentByTeam.get(teamId(context.view.currentTeam))
          const opportunity = assessment?.opportunityValue ?? Number.NaN
          utility = candidate.decision.vote === 'approve'
            ? opportunity
            : 1 - opportunity
        }
        if (
          !prior
          || !assessment
          || assessment.team.requestContext !== context.request.kind
          || !Number.isFinite(utility)
        ) throw new Error('Mordred score layer candidate join mismatch')
        return { candidate, prior, utility }
      })
      const survivors = joined.filter(({ candidate }) =>
        allowed.has(candidate.id))
      if (!survivors.length) {
        throw new Error('Mordred score layer received no hard survivors')
      }
      const d2Max = Math.max(...survivors.map(({ prior }) => prior.value))
      const d2Band = EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
      const inD2Band = (row: typeof joined[number]): boolean =>
        row.prior.value >= d2Max - d2Band
      const viableBand = survivors.filter(inD2Band)
      if (!viableBand.length) {
        throw new Error('Mordred score layer received no D2-band survivor')
      }
      const opportunityMax = Math.max(
        ...viableBand.map(({ utility }) => utility),
      )
      const canonicalTopId = viableBand
        .filter(({ utility }) => utility === opportunityMax)
        .map(({ candidate }) => candidate.id)
        .sort(compareCandidateIds)[0]
      const hardSelection = context.candidateBoundary.selectedCandidateId
      if (hardSelection && !allowed.has(hardSelection)) {
        throw new Error('Mordred score layer received invalid hard selection')
      }
      const seededVoteBand =
        !hardSelection
        && seeded
        && context.request.kind === 'vote'
        && viableBand.length === 2
        && Math.abs(
          viableBand[0].utility - viableBand[1].utility,
        ) <= MORDRED_BLINDNESS_ROLE_UTILITY_CONSTANTS.seededVoteBand
      const seedBucket = seededVoteBand
        ? stablePolicyBucket([
            context.deterministicSeed,
            context.request.seat,
            context.request.kind,
            context.request.round,
            context.request.proposalNum,
            context.analysis.throughSeq,
            MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
          ].join(':'))
        : undefined
      const seededVote = seedBucket === 0 ? 'approve' : 'reject'
      const selectedId = hardSelection
        ?? (
          seededVoteBand
            ? viableBand.find(({ candidate }) =>
                candidate.decision.kind === 'vote'
                && candidate.decision.vote === seededVote)!.candidate.id
            : canonicalTopId
        )

      return {
        status: 'applied',
        surface: context.surface.create({
          scores: joined.map((row) => {
            const forcedAllowed = allowed.has(row.candidate.id)
            const insideBand = forcedAllowed && inD2Band(row)
            const selected = row.candidate.id === selectedId
            return {
              candidateId: row.candidate.id,
              value: forcedAllowed
                ? row.utility
                : REMOVED_VALUE,
              viable: forcedAllowed && selected,
              reasonCodes: [
                forcedAllowed
                  ? 'FORCED_POLICY_ALLOWED'
                  : 'FORCED_POLICY_REMOVED',
                ...(insideBand ? ['MORDRED_D2_VIABLE_BAND'] : []),
                ...(forcedAllowed
                  ? ['MORDRED_BLINDNESS_OPPORTUNITY']
                  : []),
                ...(seededVoteBand
                  ? ['MORDRED_SEEDED_VOTE_BAND']
                  : []),
              ],
            }
          }),
          survivorCandidateIds: context.prior.survivorCandidateIds,
        }),
      }
    },
  })
}

export function mordredScoreLayerDefinitions(
  predecessors: RoleScoreLayerPredecessors,
): readonly ScoreLayerDefinition[] {
  return Object.freeze([
    mordredDefinition(
      MORDRED_ROLE_SCORE_LAYER,
      predecessors.deterministic,
      'top-opportunity-within-d2-band',
    ),
    mordredDefinition(
      SEEDED_MORDRED_ROLE_SCORE_LAYER,
      predecessors.seeded,
      'seeded-near-equal-vote-within-d2-band',
    ),
  ])
}
