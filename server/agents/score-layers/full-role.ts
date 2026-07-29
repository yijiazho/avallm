import {
  FULL_ROLE_POLICY_SCORER_VERSION,
  FULL_ROLE_STACK_ATTRIBUTION_REASON,
} from '../policy/full-role-score-contract.ts'
import {
  fullRolePolicyScorer,
  type CandidateScorer,
} from '../policy/score.ts'
import {
  scoreLayerToken,
  type ScoreLayerDefinition,
  type ScoreLayerToken,
  type ScoreLayerTransformDefinition,
} from '../policy/score-layer/types.ts'

export const FULL_ROLE_POLICY_SCORE_LAYER = scoreLayerToken(
  'full-role-policy-score',
  FULL_ROLE_POLICY_SCORER_VERSION,
)

export function fullRoleScoreLayerTerminalFor(
  scorer: CandidateScorer | undefined,
): ScoreLayerToken | undefined {
  return scorer === fullRolePolicyScorer
    ? FULL_ROLE_POLICY_SCORE_LAYER
    : undefined
}

/**
 * Give the complete role stack one truthful configured identity without
 * changing the mechanical result of the last applicable role layer.
 */
export function fullRoleScoreLayerDefinitions(
  predecessor: ScoreLayerToken,
): readonly ScoreLayerDefinition[] {
  const definition: ScoreLayerTransformDefinition = {
    kind: 'transform',
    token: FULL_ROLE_POLICY_SCORE_LAYER,
    predecessor,
    requiredComponents: Object.freeze([]),
    degradationCode: 'full-role-policy-score-failed',
    diagnosticOwner: 'predecessor',
    analysisRequirements: () => Object.freeze([]),
    admitAnalysis: ({ requirements }) => requirements.length === 0,
    applies: () => true,
    execute: (context) => ({
      status: 'applied',
      surface: context.surface.create({
        scores: context.prior.scores.map((row) => ({
          ...row,
          reasonCodes: row.viable
            ? [...row.reasonCodes, FULL_ROLE_STACK_ATTRIBUTION_REASON]
            : row.reasonCodes,
        })),
        survivorCandidateIds: context.prior.survivorCandidateIds,
      }),
    }),
  }
  return Object.freeze([Object.freeze(definition)])
}
