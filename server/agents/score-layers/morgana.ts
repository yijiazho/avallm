import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SCORE_FEATURE_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_CONSTANTS,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/morgana-role-utility.ts'
import {
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
} from '../components/native-score-components.ts'
import {
  morganaRoleScorer,
  seededMorganaRoleScorer,
  type CandidateScorer,
} from '../policy/score.ts'
import {
  scoreLayerToken,
  type ScoreLayerDefinition,
  type ScoreLayerToken,
  type ScoreLayerTransformContext,
  type ScoreLayerTransformDefinition,
} from '../policy/score-layer/types.ts'

export const MORGANA_ROLE_SCORE_LAYER = scoreLayerToken(
  'morgana-role-score',
  MORGANA_ROLE_SCORER_VERSION,
)
export const SEEDED_MORGANA_ROLE_SCORE_LAYER = scoreLayerToken(
  'seeded-morgana-role-score',
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
)

export interface MorganaScoreLayerPredecessors {
  readonly deterministic: ScoreLayerToken
  readonly seeded: ScoreLayerToken
}

/** Exact built-in identity mapping; custom same-version writers stay legacy. */
export function morganaScoreLayerTerminalFor(
  scorer: CandidateScorer | undefined,
): ScoreLayerToken | undefined {
  if (scorer === morganaRoleScorer) return MORGANA_ROLE_SCORE_LAYER
  if (scorer === seededMorganaRoleScorer) {
    return SEEDED_MORGANA_ROLE_SCORE_LAYER
  }
  return undefined
}

const REMOVED_VALUE = -Number.MAX_SAFE_INTEGER

function morganaDefinition(
  token: ScoreLayerToken,
  predecessor: ScoreLayerToken,
  utilityToken:
    | typeof MORGANA_ROLE_UTILITY_COMPONENT
    | typeof MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  selectionMode:
    | 'top-counterfeit-within-d2-band'
    | 'seeded-near-equal-vote-within-d2-band',
): ScoreLayerTransformDefinition {
  const definition: ScoreLayerTransformDefinition = {
    kind: 'transform',
    token,
    predecessor,
    requiredComponents: Object.freeze([utilityToken]),
    degradationCode: `${token.id}-failed`,
    analysisRequirements: () => Object.freeze([]),
    admitAnalysis: ({ requirements }) => requirements.length === 0,
    applies: (context) =>
      context.view.role === 'morgana'
      && (
        context.request.kind === 'propose'
        || context.request.kind === 'vote'
      ),
    execute(context: ScoreLayerTransformContext) {
      const projection = context.components.require(utilityToken)
      if (
        projection.version !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
        || projection.role !== 'morgana'
        || projection.selectionMode !== selectionMode
        || projection.request.kind !== context.request.kind
        || projection.request.seat !== context.request.seat
        || projection.request.round !== context.request.round
        || projection.request.proposalNum !== context.request.proposalNum
        || projection.source.beliefThroughSeq !== context.analysis.throughSeq
        || projection.candidates.length !== context.candidates.length
      ) throw new Error('Morgana score layer component join mismatch')

      const rows = new Map(
        projection.candidates.map((candidate) => [
          candidate.candidateId,
          candidate,
        ]),
      )
      const allowed = new Set(context.forced.allowedCandidateIds)
      if (
        rows.size !== context.candidates.length
        || !allowed.has(projection.selectedCandidateId)
        || (
          context.forced.selectedCandidateId !== undefined
          && context.forced.selectedCandidateId
            !== projection.selectedCandidateId
        )
      ) throw new Error('Morgana score layer received inconsistent selection')

      return {
        status: 'applied',
        surface: context.surface.create({
          scores: context.candidates.map((candidate) => {
            const utility = rows.get(candidate.id)
            if (
              !utility
              || utility.forcedAllowed !== allowed.has(candidate.id)
              || utility.kind !== context.request.kind
            ) throw new Error('Morgana score layer candidate join mismatch')
            const selected = candidate.id === projection.selectedCandidateId
            return {
              candidateId: candidate.id,
              value: utility.forcedAllowed
                ? utility.counterfeitValue
                : REMOVED_VALUE,
              viable: utility.forcedAllowed && selected,
              reasonCodes: [
                utility.forcedAllowed
                  ? 'FORCED_POLICY_ALLOWED'
                  : 'FORCED_POLICY_REMOVED',
                utility.inD2ViableBand
                  ? 'MORGANA_D2_VIABLE_BAND'
                  : 'MORGANA_D2_OUTSIDE_VIABLE_BAND',
                ...(selected ? ['MORGANA_COUNTERFEIT_SELECTED'] : []),
                ...(projection.seedBucket === undefined
                  ? []
                  : ['MORGANA_COUNTERFEIT_SEEDED_VOTE_BAND']),
              ],
            }
          }),
          survivorCandidateIds: context.prior.survivorCandidateIds,
        }),
      }
    },
  }
  return Object.freeze(definition)
}

export function morganaScoreLayerDefinitions(
  predecessors: MorganaScoreLayerPredecessors,
): readonly ScoreLayerDefinition[] {
  return Object.freeze([
    morganaDefinition(
      MORGANA_ROLE_SCORE_LAYER,
      predecessors.deterministic,
      MORGANA_ROLE_UTILITY_COMPONENT,
      'top-counterfeit-within-d2-band',
    ),
    morganaDefinition(
      SEEDED_MORGANA_ROLE_SCORE_LAYER,
      predecessors.seeded,
      MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
      'seeded-near-equal-vote-within-d2-band',
    ),
  ])
}
