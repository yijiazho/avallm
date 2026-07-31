/**
 * The servant score family: scoring authority for the per-candidate propose
 * utility.
 *
 * The measurement that motivates it is on the projection module. In short: 75
 * of 76 servant proposals in the phase-4 bank score every viable candidate at
 * EXACTLY the same value, through round five, and the winner is then picked by
 * sorting candidate ids. The flatness is structural rather than a bug, since a
 * servant holds no private role knowledge and the proposal base has already
 * filtered to the maximum-clean set.
 *
 * So this layer is a tie-breaker, not a competing objective. It adds a centered
 * adjustment to whatever the base scored, which is what keeps it from
 * overturning a proposal the base actually ranked: at the measured spread the
 * adjustment is around 0.05, decisive against a gap of 0.0000 and powerless
 * against a wider one.
 *
 * The honest caveat, stated here because it does not survive a diff. "It cannot
 * regress the primary objective" is an argument from the model's own scoring:
 * the candidates it reorders are tied AS THE SERVANT SEES THEM. If the flat
 * proposal score is itself the defect, this layer dresses up a deeper problem
 * rather than fixing it.
 *
 * It reads `context.prior.scores` rather than recomputing the good base.
 * ARCH007 forbids concrete families importing each other, and the prior surface
 * is the seam that already carries exactly what is needed.
 */

import {
  SERVANT_ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateServantRoleUtilityProjection,
} from '../analysis/servant-role-utility.ts'
import {
  SERVANT_ROLE_UTILITY_COMPONENT,
} from '../components/native-score-components.ts'
import {
  compareCandidateIds,
} from '../policy/candidates.ts'
import {
  SERVANT_ROLE_SCORER_VERSION,
  SERVANT_ROLE_SEEDED_SCORER_VERSION,
  SERVANT_ROLE_UTILITY_CONSTANTS,
} from '../policy/servant-score-contract.ts'
import {
  servantRoleScorer,
  seededServantRoleScorer,
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
import {
  appliesFrom,
  merlinSeated,
  SERVANT_CLAIM,
} from '../policy/applicability.ts'

export const SERVANT_ROLE_SCORE_LAYER = scoreLayerToken(
  'servant-role-score',
  SERVANT_ROLE_SCORER_VERSION,
)
export const SEEDED_SERVANT_ROLE_SCORE_LAYER = scoreLayerToken(
  'seeded-servant-role-score',
  SERVANT_ROLE_SEEDED_SCORER_VERSION,
)

/** The family's terminal identities; terminalFor and the seam both derive from it. */
export const servantScoreLayerTerminals:
readonly ScoreLayerTerminalIdentity<CandidateScorer>[] =
  Object.freeze([
    Object.freeze({
      scorer: servantRoleScorer,
      token: SERVANT_ROLE_SCORE_LAYER,
    }),
    Object.freeze({
      scorer: seededServantRoleScorer,
      token: SEEDED_SERVANT_ROLE_SCORE_LAYER,
    }),
  ])

/** Exact built-in identity mapping; custom same-version writers stay legacy. */
export const servantScoreLayerTerminalFor = terminalForIdentities(
  servantScoreLayerTerminals,
)

const claimApplies = appliesFrom(SERVANT_CLAIM)

function servantDefinition(
  token: ScoreLayerToken,
  predecessor: ScoreLayerToken,
): ScoreLayerTransformDefinition {
  return noAnalysisTransformLayer({
    token,
    predecessor,
    requiredComponents: Object.freeze([SERVANT_ROLE_UTILITY_COMPONENT]),
    applies: (context) =>
      claimApplies(context) && merlinSeated(context),
    execute(context: ScoreLayerTransformContext) {
      const projection: PrivateServantRoleUtilityProjection =
        context.components.require(SERVANT_ROLE_UTILITY_COMPONENT)
      if (
        projection.version !== SERVANT_ROLE_UTILITY_PROJECTION_VERSION
        || projection.seat !== context.request.seat
        || projection.playerCount !== context.view.players.length
        || projection.assessments.length !== context.candidates.length
      ) throw new Error('servant score layer component join mismatch')

      const utilityById = new Map(
        projection.assessments.map((entry) => [entry.candidateId, entry]),
      )
      const priorById = new Map(
        context.prior.scores.map((row) => [row.candidateId, row]),
      )
      if (
        utilityById.size !== context.candidates.length
        || priorById.size !== context.candidates.length
      ) throw new Error('servant score layer requires complete surfaces')

      const allowed = new Set(context.candidateBoundary.survivorCandidateIds)
      const forcedSelection = context.candidateBoundary.selectedCandidateId
      if (forcedSelection && !allowed.has(forcedSelection)) {
        throw new Error('servant score layer received invalid forced selection')
      }
      const roleValueOf = (candidateId: string): number => {
        const utility = utilityById.get(candidateId)
        if (!utility || utility.kind !== 'propose') {
          throw new Error('servant score layer utility join mismatch')
        }
        return utility.roleValue
      }
      const survivorValues = context.candidates
        .filter((candidate) => allowed.has(candidate.id))
        .map((candidate) => roleValueOf(candidate.id))
      if (!survivorValues.length) {
        throw new Error('servant score layer received no forced survivors')
      }
      const survivorMean =
        survivorValues.reduce((sum, value) => sum + value, 0)
        / survivorValues.length
      // Reported, never branched on: a flat read and a decisive one are the
      // same arithmetic, and only the reason code tells them apart afterwards.
      const separated =
        Math.max(...survivorValues) - Math.min(...survivorValues)
        > SERVANT_ROLE_UTILITY_CONSTANTS.separationBand

      const rows = context.candidates.map((candidate) => {
        const base = priorById.get(candidate.id)
        if (!base) throw new Error('servant score layer prior join mismatch')
        return {
          candidate,
          base,
          combinedValue: base.value
            + SERVANT_ROLE_UTILITY_CONSTANTS.centeredAdjustmentScale
              * (roleValueOf(candidate.id) - survivorMean),
        }
      })
      const allowedRows = rows.filter(({ candidate }) =>
        allowed.has(candidate.id))
      const maxCombined = Math.max(
        ...allowedRows.map((row) => row.combinedValue),
      )
      const canonicalTopId = allowedRows
        .filter((row) => row.combinedValue === maxCombined)
        .map((row) => row.candidate.id)
        .sort(compareCandidateIds)[0]

      return {
        status: 'applied',
        surface: context.surface.create({
          scores: rows.map((row) => {
            const forcedAllowed = allowed.has(row.candidate.id)
            const viable = forcedAllowed && (
              forcedSelection
                ? row.candidate.id === forcedSelection
                : row.candidate.id === canonicalTopId
            )
            return {
              candidateId: row.candidate.id,
              value: forcedAllowed ? row.combinedValue : REMOVED_VALUE,
              viable,
              reasonCodes: [
                forcedAllowed
                  ? 'FORCED_POLICY_ALLOWED'
                  : 'FORCED_POLICY_REMOVED',
                // Two kinds of code are dropped from the prior row rather than
                // carried through.
                //
                // The forced-policy verdict, because it is restated above and
                // the prior row already opens with it: keeping both stamped it
                // twice on every row, which is a trace that reports one fact as
                // two and spends two of the 32 codes a row is allowed.
                //
                // The base's own selection statements, because this layer has
                // taken the pick over. Its maximal-clean set and its
                // lexicographic tie-break both describe a choice that no longer
                // stands, and leaving them on would have ten rows claiming to
                // be chosen beside the one that actually was. Everything the
                // base said about the candidates themselves still holds.
                ...row.base.reasonCodes.filter((reason) =>
                  reason !== 'FORCED_POLICY_ALLOWED'
                  && reason !== 'FORCED_POLICY_REMOVED'
                  && reason !== 'GOOD_PROPOSAL_MAX_TEAM_CLEAN'
                  && reason !== 'GOOD_PROPOSAL_CANONICAL_TIE_BREAK'),
                'SERVANT_ROLE_PUBLIC_READ_COMPOSITE',
                separated
                  ? 'SERVANT_ROLE_PUBLIC_READ_SEPARATED'
                  : 'SERVANT_ROLE_PUBLIC_READ_FLAT',
                ...(viable ? ['SERVANT_ROLE_PUBLIC_READ_SELECTED'] : []),
              ],
            }
          }),
          survivorCandidateIds: context.prior.survivorCandidateIds,
        }),
      }
    },
  })
}

export function servantScoreLayerDefinitions(
  predecessors: RoleScoreLayerPredecessors,
): readonly ScoreLayerDefinition[] {
  return Object.freeze([
    servantDefinition(SERVANT_ROLE_SCORE_LAYER, predecessors.deterministic),
    servantDefinition(
      SEEDED_SERVANT_ROLE_SCORE_LAYER,
      predecessors.seeded,
    ),
  ])
}
