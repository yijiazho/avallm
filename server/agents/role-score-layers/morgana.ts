import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
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
import {
  noAnalysisTransformLayer,
  REMOVED_VALUE,
  terminalForIdentities,
  type RoleScoreLayerPredecessors,
  type ScoreLayerTerminalIdentity,
} from '../policy/score-layer/definition.ts'
import { appliesFrom, MORGANA_CLAIM } from '../policy/applicability.ts'

export const MORGANA_ROLE_SCORE_LAYER = scoreLayerToken(
  'morgana-role-score',
  MORGANA_ROLE_SCORER_VERSION,
)
export const SEEDED_MORGANA_ROLE_SCORE_LAYER = scoreLayerToken(
  'seeded-morgana-role-score',
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
)

/** The family's terminal identities; terminalFor and the seam both derive from it. */
export const morganaScoreLayerTerminals:
readonly ScoreLayerTerminalIdentity<CandidateScorer>[] =
  Object.freeze([
    Object.freeze({
      scorer: morganaRoleScorer,
      token: MORGANA_ROLE_SCORE_LAYER,
    }),
    Object.freeze({
      scorer: seededMorganaRoleScorer,
      token: SEEDED_MORGANA_ROLE_SCORE_LAYER,
    }),
  ])

/** Exact built-in identity mapping; custom same-version writers stay legacy. */
export const morganaScoreLayerTerminalFor = terminalForIdentities(
  morganaScoreLayerTerminals,
)

function morganaDefinition(
  token: ScoreLayerToken,
  predecessor: ScoreLayerToken,
  seeded: boolean,
): ScoreLayerTransformDefinition {
  const utilityToken = seeded
    ? MORGANA_ROLE_UTILITY_SEEDED_COMPONENT
    : MORGANA_ROLE_UTILITY_COMPONENT
  const selectionMode = seeded
    ? 'seeded-near-equal-vote-within-d2-band'
    : 'top-counterfeit-within-d2-band'
  return noAnalysisTransformLayer({
    token,
    predecessor,
    requiredComponents: Object.freeze([utilityToken]),
    applies: appliesFrom(MORGANA_CLAIM),
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
      const allowed = new Set(
        context.candidateBoundary.survivorCandidateIds,
      )
      if (
        rows.size !== context.candidates.length
        || !allowed.has(projection.selectedCandidateId)
        || (
          context.candidateBoundary.selectedCandidateId !== undefined
          && context.candidateBoundary.selectedCandidateId
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
  })
}

export function morganaScoreLayerDefinitions(
  predecessors: RoleScoreLayerPredecessors,
): readonly ScoreLayerDefinition[] {
  return Object.freeze([
    morganaDefinition(
      MORGANA_ROLE_SCORE_LAYER,
      predecessors.deterministic,
      false,
    ),
    morganaDefinition(
      SEEDED_MORGANA_ROLE_SCORE_LAYER,
      predecessors.seeded,
      true,
    ),
  ])
}
