export interface SituationAnalysisRequirementRef {
  readonly id: string
  readonly version: string
}

export const CANDIDATE_TEAM_ANALYSIS = Object.freeze({
  id: 'candidate-team-analysis',
  version: 'situation-analysis-plan-v1',
})
export const GOOD_PROPOSAL_ANALYSIS = Object.freeze({
  id: 'good-proposal-analysis',
  version: 'situation-analysis-plan-v1',
})
export const GOOD_VOTE_ANALYSIS = Object.freeze({
  id: 'good-vote-analysis',
  version: 'situation-analysis-plan-v1',
})

export type SituationAnalysisPlan =
  | 'candidate-teams'
  | 'good-proposal'
  | 'good-vote'

/**
 * The analysis domain is the sole compiler from policy requirements to one
 * executable situation-analysis plan. Composition never switches on IDs.
 */
export function combineSituationAnalysisRequirements(
  requirements: readonly SituationAnalysisRequirementRef[],
): SituationAnalysisPlan {
  let plan: SituationAnalysisPlan = 'candidate-teams'
  const seen = new Set<string>()
  for (const requirement of requirements) {
    const key = `${requirement.id}@${requirement.version}`
    if (seen.has(key)) continue
    seen.add(key)
    if (
      requirement.id === GOOD_VOTE_ANALYSIS.id
      && requirement.version === GOOD_VOTE_ANALYSIS.version
    ) {
      plan = 'good-vote'
      continue
    }
    if (
      requirement.id === GOOD_PROPOSAL_ANALYSIS.id
      && requirement.version === GOOD_PROPOSAL_ANALYSIS.version
    ) {
      if (plan !== 'good-vote') plan = 'good-proposal'
      continue
    }
    if (
      requirement.id === CANDIDATE_TEAM_ANALYSIS.id
      && requirement.version === CANDIDATE_TEAM_ANALYSIS.version
    ) continue
    throw new Error(
      `unsupported situation analysis requirement ${key}`,
    )
  }
  return plan
}
