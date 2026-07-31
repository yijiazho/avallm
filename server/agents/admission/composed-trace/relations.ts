// The single entry point that runs every cross-field relation in order. It holds
// the sequencing and nothing else, so which relation is attempted first, and
// therefore which rejection a malformed trace reports, is readable on one screen
// instead of being reconstructed from a scroll through the validators.

import type {
  PlayerView,
} from '../../../engine/types.ts'
import {
  NO_PLANNER_VERSION,
} from '../../communication/planner-voice-adapter.ts'
import type {
  DecisionComponentRun,
} from '../../components/kernel.ts'
import {
  DECISION_PLAN_VERSION,
} from '../../policy/plan.ts'
import {
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
} from '../../policy/score.ts'
import {
  componentVersionsOf,
} from '../trace-primitives.ts'
import type {
  TraceValidationInput,
} from '../trace-primitives.ts'
import {
  validCommunicationIntent,
  validPlannerRelations,
} from './communication-relations.ts'
import {
  validAbsentCandidateScores,
  validCandidateScoreIdentity,
  validForcedPolicyRelation,
  validProposalFeatureScores,
  validVoteFeatureScores,
} from './feature-score-relations.ts'
import type {
  ComposedTraceContext,
} from './relation-context.ts'
import {
  validEvilRoleCompositeSelection,
  validGoodRoleCompositeSelection,
  validMorganaRoleCompositeSelection,
} from './role-composite-relations.ts'
import {
  isFullPlayerView,
} from './trace-shape.ts'

export function validComposedTraceRelations(
  trace: TraceValidationInput,
  playerCount: number | undefined,
  hostView?: PlayerView | Pick<PlayerView, 'rolesInPlay'>,
): boolean {
  if (trace.candidateScores === undefined) {
    return validAbsentCandidateScores(trace)
  }
  const scores = trace.candidateScores as Array<Record<string, unknown>>
  const ids = scores.map((score) => String(score.candidateId))
  if (new Set(ids).size !== ids.length) return false
  const components = componentVersionsOf(trace)
  const componentRun = trace.components as DecisionComponentRun | undefined
  const hasPlanner =
    components !== undefined && components.planner !== NO_PLANNER_VERSION
  if (!validCandidateScoreIdentity(trace, scores, components)) {
    return false
  }
  const chosen = trace.chosenCandidateId
  if (
    typeof chosen !== 'string'
    || !scores.some(
      (score) => score.candidateId === chosen && score.viable === true,
    )
  ) {
    return false
  }
  const chosenScore = scores.find((score) => score.candidateId === chosen)
  const structured = trace.structuredCandidateId
  const plannerReasons = trace.plannerReasonCodes
  const chosenFeatures = chosenScore?.features as
    | Record<string, unknown>
    | undefined
  const action = trace.action as Record<string, unknown>
  const relevantTeam = trace.relevantTeam as Record<string, unknown> | undefined
  const featureScores = scores.filter((score) => score.features !== undefined)
  const intent = trace.communicationIntent as
    | Record<string, unknown>
    | undefined
  const phase4c = trace.decisionPlanVersion === DECISION_PLAN_VERSION
  const speechAction =
    action.kind === 'discuss'
    || action.kind === 'propose'
    || (action.kind === 'finalize' && action.stick === false)
  const fullHostView = isFullPlayerView(hostView) ? hostView : undefined
  const ctx: ComposedTraceContext = {
    trace,
    playerCount,
    ...(fullHostView ? { hostView: fullHostView } : {}),
    ...(hostView ? { hostRolesInPlay: hostView.rolesInPlay } : {}),
    scores,
    ids,
    components,
    componentRun,
    hasPlanner,
    chosen,
    chosenScore,
    chosenFeatures,
    action,
    relevantTeam,
    intent,
    structured,
    plannerReasons,
    phase4c,
    proposalFeatureScores: featureScores.filter(
      (score) =>
        (score.features as Record<string, unknown>).version
        === GOOD_PROPOSAL_FEATURE_VERSION,
    ),
    voteFeatureScores: featureScores.filter(
      (score) =>
        (score.features as Record<string, unknown>).version
        === GOOD_VOTE_FEATURE_VERSION,
    ),
    roleFeatureScores: scores.filter(
      (score) => score.roleObjectiveFeatures !== undefined,
    ),
    evilRoleFeatureScores: scores.filter(
      (score) => score.evilRoleObjectiveFeatures !== undefined,
    ),
    morganaRoleFeatureScores: scores.filter(
      (score) => score.morganaRoleObjectiveFeatures !== undefined,
    ),
  }
  if (!validPlannerRelations(ctx)) return false
  if (phase4c && speechAction !== (intent !== undefined)) {
    return false
  }
  if (!validCommunicationIntent(ctx)) return false
  if (!validGoodRoleCompositeSelection(ctx)) return false
  if (!validEvilRoleCompositeSelection(ctx)) return false
  if (!validMorganaRoleCompositeSelection(ctx)) return false
  if (!validProposalFeatureScores(ctx)) return false
  if (!validVoteFeatureScores(ctx)) return false
  if (!validForcedPolicyRelation(ctx)) return false
  return true
}
