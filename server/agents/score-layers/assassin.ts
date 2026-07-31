import {
  ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
} from '../components/native-role-components.ts'
import { compareCandidateIds } from '../policy/candidates.ts'
import {
  ASSASSIN_MERLIN_TARGET_SCORER_VERSION,
  assassinMerlinTargetScorer,
  type CandidateScorer,
} from '../policy/score.ts'
import {
  scoreLayerToken,
  type ScoreLayerDefinition,
  type ScoreLayerToken,
  type ScoreLayerTransformContext,
} from '../policy/score-layer/types.ts'
import {
  noAnalysisTransformLayer,
  REMOVED_VALUE,
  terminalForIdentities,
  type ScoreLayerTerminalIdentity,
} from '../policy/score-layer/definition.ts'

export const ASSASSIN_MERLIN_TARGET_SCORE_LAYER = scoreLayerToken(
  'assassin-merlin-target-score',
  ASSASSIN_MERLIN_TARGET_SCORER_VERSION,
)

/** The family's terminal identities; terminalFor and the seam both derive from it. */
export const assassinScoreLayerTerminals:
readonly ScoreLayerTerminalIdentity<CandidateScorer>[] =
  Object.freeze([
    Object.freeze({
      scorer: assassinMerlinTargetScorer,
      token: ASSASSIN_MERLIN_TARGET_SCORE_LAYER,
    }),
  ])

/** Exact built-in identity mapping; custom same-version writers stay legacy. */
export const assassinScoreLayerTerminalFor = terminalForIdentities(
  assassinScoreLayerTerminals,
)

export function assassinScoreLayerDefinitions(
  predecessor: ScoreLayerToken,
): readonly ScoreLayerDefinition[] {
  const definition = noAnalysisTransformLayer({
    token: ASSASSIN_MERLIN_TARGET_SCORE_LAYER,
    predecessor,
    requiredComponents: Object.freeze([
      ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
    ]),
    // No Merlin check: validateRoles adds Merlin and the Assassin together, and
    // the engine only issues an assassinate decision with Merlin seated, so an
    // assassinate request already guarantees it.
    applies: (context) =>
      context.view.role === 'assassin'
      && context.request.kind === 'assassinate',
    execute(context: ScoreLayerTransformContext) {
      const posterior = context.components.require(
        ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
      )
      if (
        posterior.source.beliefThroughSeq !== context.analysis.throughSeq
        || posterior.targets.length !== context.candidates.length
      ) throw new Error('Assassin target score component join mismatch')

      const targets = new Map(
        posterior.targets.map((target) => [target.seat, target]),
      )
      const allowed = new Set(
        context.candidateBoundary.survivorCandidateIds,
      )
      const joined = context.candidates.map((candidate) => {
        if (candidate.decision.kind !== 'assassinate') {
          throw new Error('Assassin target layer received foreign candidate')
        }
        const target = targets.get(candidate.decision.target)
        if (!target) {
          throw new Error('Assassin target layer candidate join mismatch')
        }
        return { candidate, target }
      })
      if (targets.size !== joined.length) {
        throw new Error('Assassin target layer requires complete targets')
      }
      const survivors = joined.filter(({ candidate }) =>
        allowed.has(candidate.id))
      if (!survivors.length) {
        throw new Error('Assassin target layer received no hard survivors')
      }
      const hardSelection = context.candidateBoundary.selectedCandidateId
      if (hardSelection && !allowed.has(hardSelection)) {
        throw new Error('Assassin target layer received invalid hard selection')
      }
      const maximum = Math.max(
        ...survivors.map(({ target }) => target.posteriorProbability),
      )
      const posteriorSelection = survivors
        .filter(({ target }) => target.posteriorProbability === maximum)
        .map(({ candidate }) => candidate.id)
        .sort(compareCandidateIds)[0]
      const selectedId = hardSelection ?? posteriorSelection

      return {
        status: 'applied',
        surface: context.surface.create({
          scores: joined.map(({ candidate, target }) => {
            const forcedAllowed = allowed.has(candidate.id)
            const selected = candidate.id === selectedId
            return {
              candidateId: candidate.id,
              value: forcedAllowed
                ? target.posteriorProbability
                : REMOVED_VALUE,
              viable: forcedAllowed && selected,
              reasonCodes: [
                forcedAllowed
                  ? 'FORCED_POLICY_ALLOWED'
                  : 'FORCED_POLICY_REMOVED',
                ...(forcedAllowed
                  ? ['ASSASSIN_MERLIN_POSTERIOR']
                  : []),
                ...(selected
                  ? ['ASSASSIN_MERLIN_TARGET_SELECTED']
                  : []),
              ],
            }
          }),
          survivorCandidateIds: context.prior.survivorCandidateIds,
        }),
      }
    },
  })
  return Object.freeze([definition])
}
