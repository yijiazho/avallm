import type { PlayerView } from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import type { Evidence } from '../cognition/types.ts'
import {
  candidateTeams,
  hypotheticalProposalCandidates,
} from '../candidate/candidates.ts'
import type { PolicyCandidate } from '../candidate/types.ts'
import { analyzeSituation } from './situation.ts'
import type { SituationAnalysisPlan } from './situation-plan.ts'
import type { SituationAnalysis } from './situation-types.ts'

export interface ScorerSituationSurface {
  readonly analysis: SituationAnalysis
  readonly hypotheticalTeamCandidates:
    | ReturnType<typeof hypotheticalProposalCandidates>
    | null
}

/**
 * Build the scorer-sensitive situation surface from trusted runtime or host
 * replay inputs. Plan compilation and trace admission remain outside this
 * pure projection.
 */
export function buildScorerSituationSurface(input: {
  readonly view: PlayerView
  readonly belief: BeliefSnapshot
  readonly evidence?: readonly Evidence[]
  readonly legalCandidates: readonly PolicyCandidate[]
  readonly plan: SituationAnalysisPlan
}): ScorerSituationSurface {
  const {
    view,
    belief,
    evidence,
    legalCandidates,
    plan,
  } = input
  const policyCandidateTeams = candidateTeams(legalCandidates, view)
  const hypotheticalTeamCandidates = plan === 'good-vote'
    ? hypotheticalProposalCandidates(view)
    : null
  const policyCandidateAssessments =
    plan === 'good-proposal'
      ? policyCandidateTeams
      : hypotheticalTeamCandidates
        ? candidateTeams(hypotheticalTeamCandidates, view)
        : undefined
  const analysis = analyzeSituation(view, {
    belief,
    ...(evidence ? { evidence } : {}),
    policyCandidateTeams,
    ...(policyCandidateAssessments
      ? { policyCandidateAssessments }
      : {}),
    ...(hypotheticalTeamCandidates ? { goodVote: true } : {}),
  })
  return Object.freeze({
    analysis,
    hypotheticalTeamCandidates,
  })
}
