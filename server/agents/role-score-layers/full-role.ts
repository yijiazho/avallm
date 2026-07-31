import {
  FULL_ROLE_POLICY_SCORER_VERSION,
  FULL_ROLE_STACK_ATTRIBUTION_REASON,
  fullRolePolicyScorer,
  type CandidateScorer,
} from '../policy/score.ts'
import {
  scoreLayerToken,
  type ScoreLayerDefinition,
  type ScoreLayerToken,
} from '../policy/score-layer/types.ts'
import {
  noAnalysisTransformLayer,
  terminalForIdentities,
  type ScoreLayerTerminalIdentity,
} from '../policy/score-layer/definition.ts'

export const FULL_ROLE_POLICY_SCORE_LAYER = scoreLayerToken(
  'full-role-policy-score',
  FULL_ROLE_POLICY_SCORER_VERSION,
)

/** The family's terminal identities; terminalFor and the seam both derive from it. */
export const fullRoleScoreLayerTerminals:
readonly ScoreLayerTerminalIdentity<CandidateScorer>[] =
  Object.freeze([
    Object.freeze({
      scorer: fullRolePolicyScorer,
      token: FULL_ROLE_POLICY_SCORE_LAYER,
    }),
  ])

/** Exact built-in identity mapping; custom same-version writers stay legacy. */
export const fullRoleScoreLayerTerminalFor = terminalForIdentities(
  fullRoleScoreLayerTerminals,
)

/**
 * Give the complete role stack one truthful configured identity without
 * changing the mechanical result of the last applicable role layer.
 */
export function fullRoleScoreLayerDefinitions(
  predecessor: ScoreLayerToken,
): readonly ScoreLayerDefinition[] {
  const definition = noAnalysisTransformLayer({
    token: FULL_ROLE_POLICY_SCORE_LAYER,
    predecessor,
    requiredComponents: Object.freeze([]),
    diagnosticOwner: 'predecessor',
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
  })
  return Object.freeze([definition])
}
