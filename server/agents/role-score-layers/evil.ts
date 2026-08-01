import {
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateEvilRoleUtilityProjection,
} from '../analysis/evil-role-utility.ts'
import {
  EVIL_ROLE_UTILITY_COMPONENT,
} from '../components/native-score-components.ts'
import { compareCandidateIds } from '../candidate/candidates.ts'
import { SEEDED_SELECTION_MARGIN } from '../canonical/probability-arithmetic.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS,
} from '../policy/evil-score-contract.ts'
import {
  evilRoleObjectiveScorer,
  seededEvilRoleObjectiveScorer,
  type CandidateScorer,
} from '../policy/score.ts'
import { stablePolicyBucket } from '../policy/deterministic-policy.ts'
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
import { appliesFrom, EVIL_CLAIM } from '../candidate/applicability.ts'

export const EVIL_ROLE_SCORE_LAYER = scoreLayerToken(
  'evil-role-score',
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
)
export const SEEDED_EVIL_ROLE_SCORE_LAYER = scoreLayerToken(
  'seeded-evil-role-score',
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
)

/** The family's terminal identities; terminalFor and the seam both derive from it. */
export const evilScoreLayerTerminals:
readonly ScoreLayerTerminalIdentity<CandidateScorer>[] =
  Object.freeze([
    Object.freeze({
      scorer: evilRoleObjectiveScorer,
      token: EVIL_ROLE_SCORE_LAYER,
    }),
    Object.freeze({
      scorer: seededEvilRoleObjectiveScorer,
      token: SEEDED_EVIL_ROLE_SCORE_LAYER,
    }),
  ])

/** Exact built-in identity mapping; custom same-version writers stay legacy. */
export const evilScoreLayerTerminalFor = terminalForIdentities(
  evilScoreLayerTerminals,
)

function evilDefinition(
  token: ScoreLayerToken,
  predecessor: ScoreLayerToken,
  seeded: boolean,
): ScoreLayerTransformDefinition {
  return noAnalysisTransformLayer({
    token,
    predecessor,
    requiredComponents: Object.freeze([EVIL_ROLE_UTILITY_COMPONENT]),
    applies: appliesFrom(EVIL_CLAIM),
    execute(context: ScoreLayerTransformContext) {
      const projection: PrivateEvilRoleUtilityProjection =
        context.components.require(EVIL_ROLE_UTILITY_COMPONENT)
      if (
        projection.version !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
        || projection.role !== context.view.role
        || projection.request.kind !== context.request.kind
        || projection.request.seat !== context.request.seat
        || projection.request.round !== context.request.round
        || projection.request.proposalNum !== context.request.proposalNum
        || projection.source.beliefThroughSeq !== context.analysis.throughSeq
      ) throw new Error('evil role layer component join mismatch')

      const utilityById = new Map(
        projection.assessments.map((entry) => [entry.candidateId, entry]),
      )
      if (
        utilityById.size !== projection.assessments.length
        || utilityById.size !== context.candidates.length
      ) throw new Error('evil role layer requires a complete utility surface')

      const allowed = new Set(
        context.candidateBoundary.survivorCandidateIds,
      )
      const allowedRows = context.candidates.map((candidate) => {
        const utility = utilityById.get(candidate.id)
        if (
          !utility
          || utility.kind !== context.request.kind
          || utility.role !== context.view.role
        ) throw new Error('evil role layer utility join mismatch')
        return { candidate, utility }
      }).filter(({ candidate }) => allowed.has(candidate.id))
      if (!allowedRows.length) {
        throw new Error('evil role layer received no forced survivors')
      }

      const maxValue = Math.max(
        ...allowedRows.map(({ utility }) => utility.roleValue),
      )
      const canonicalTopId = allowedRows
        .filter(({ utility }) => utility.roleValue === maxValue)
        .map(({ candidate }) => candidate.id)
        .sort(compareCandidateIds)[0]
      const forcedSelection = context.candidateBoundary.selectedCandidateId
      if (forcedSelection && !allowed.has(forcedSelection)) {
        throw new Error('evil role layer received invalid forced selection')
      }
      const voteRows = context.request.kind === 'vote' ? allowedRows : []
      const inViableBand =
        voteRows.length === 2
        && Math.abs(
          voteRows[0]!.utility.roleValue - voteRows[1]!.utility.roleValue,
        ) <= EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
      const bandActive = !forcedSelection && seeded && inViableBand
      const seedBucket = bandActive
        ? stablePolicyBucket([
            context.deterministicSeed,
            context.request.seat,
            context.request.kind,
            context.request.round,
            context.request.proposalNum,
            context.analysis.throughSeq,
            EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          ].join(':'))
        : undefined
      const seededVote = seedBucket === 0 ? 'approve' : 'reject'

      return {
        status: 'applied',
        surface: context.surface.create({
          scores: context.candidates.map((candidate) => {
            // Present for every candidate: the completeness guard above proved
            // utilityById covers all candidates. The check keeps the type honest.
            const utility = utilityById.get(candidate.id)
            if (!utility) {
              throw new Error('evil role layer utility join mismatch')
            }
            const forcedAllowed = allowed.has(candidate.id)
            const selectedBySeed =
              bandActive
              && candidate.decision.kind === 'vote'
              && candidate.decision.vote === seededVote
            const selectionAdjustment = selectedBySeed
              ? maxValue - utility.roleValue + SEEDED_SELECTION_MARGIN
              : 0
            const viable = forcedAllowed && (
              forcedSelection
                ? candidate.id === forcedSelection
                : bandActive || candidate.id === canonicalTopId
            )
            return {
              candidateId: candidate.id,
              value: forcedAllowed
                ? utility.roleValue + selectionAdjustment
                : REMOVED_VALUE,
              viable,
              reasonCodes: [
                forcedAllowed
                  ? 'FORCED_POLICY_ALLOWED'
                  : 'FORCED_POLICY_REMOVED',
                // Constant provenance stamped on every row, not per-candidate
                // signals: the evil objective always carries these three.
                'EVIL_ROLE_FAILURE_CAPACITY',
                'EVIL_ROLE_PUBLIC_COVER',
                'EVIL_ROLE_FUTURE_OPPORTUNITY',
                ...(viable ? ['EVIL_ROLE_OBJECTIVE_SELECTED_SET'] : []),
                ...(bandActive
                  ? ['EVIL_ROLE_OBJECTIVE_SEEDED_BAND']
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

export function evilScoreLayerDefinitions(
  predecessors: RoleScoreLayerPredecessors,
): readonly ScoreLayerDefinition[] {
  return Object.freeze([
    evilDefinition(
      EVIL_ROLE_SCORE_LAYER,
      predecessors.deterministic,
      false,
    ),
    evilDefinition(
      SEEDED_EVIL_ROLE_SCORE_LAYER,
      predecessors.seeded,
      true,
    ),
  ])
}
