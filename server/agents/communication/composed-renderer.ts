import type { PlayerView } from '../../engine/types.ts'
import type { SituationAnalysis } from '../analysis/types.ts'
import type { DecisionPlan } from '../policy/plan.ts'
import type { CandidateScore } from '../policy/score.ts'
import type { ForcedPolicyResult, PolicyCandidate } from '../policy/types.ts'

export const COMPOSED_RENDERER_VERSION = 'composed-policy-renderer-v1'
export const COMPOSED_PROMPT_VERSION = 'composed-typed-context-v1'

export interface ComposedPolicyContext {
  version: typeof COMPOSED_RENDERER_VERSION
  seat: number
  role: PlayerView['role']
  phase: PlayerView['phase']
  analysisFacts: {
    visibility: 'private-planning-only'
    codes: SituationAnalysis['factCodes']
  }
  forcedPolicy: {
    version: string
    applied: boolean
    reasonCodes: readonly string[]
    allowedCandidateIds: readonly string[]
    selectedCandidateId?: string
  }
  viableCandidates: readonly {
    id: string
    decision: PolicyCandidate['decision']
    score: number
    reasonCodes: readonly string[]
  }[]
}

/**
 * Typed renderer for composed planning and voice. Forced rules are rendered
 * from their executable result, so no strategic trigger is re-derived here.
 * The raw-LLM ASKS renderer remains untouched as a frozen baseline.
 */
export function composedPolicyContext(
  view: PlayerView,
  analysis: SituationAnalysis,
  candidates: readonly PolicyCandidate[],
  forced: ForcedPolicyResult,
  scores: readonly CandidateScore[],
): ComposedPolicyContext {
  const byScore = new Map(scores.map((score) => [score.candidateId, score]))
  return {
    version: COMPOSED_RENDERER_VERSION,
    seat: view.seat,
    role: view.role,
    phase: view.phase,
    analysisFacts: {
      visibility: 'private-planning-only',
      codes: analysis.factCodes,
    },
    forcedPolicy: {
      version: forced.version,
      applied: forced.applied,
      reasonCodes: forced.reasonCodes,
      allowedCandidateIds: forced.allowedCandidateIds,
      ...(forced.selectedCandidateId
        ? { selectedCandidateId: forced.selectedCandidateId }
        : {}),
    },
    viableCandidates: candidates.flatMap((candidate) => {
      const score = byScore.get(candidate.id)
      return score?.viable && forced.allowedCandidateIds.includes(candidate.id)
        ? [{
            id: candidate.id,
            decision: structuredClone(candidate.decision),
            score: score.value,
            reasonCodes: score.reasonCodes,
          }]
        : []
    }),
  }
}

export function renderComposedPolicyContext(
  context: ComposedPolicyContext,
  plan?: DecisionPlan,
): string {
  return JSON.stringify({
    ...context,
    ...(plan
      ? {
          committedPlan: {
            version: plan.version,
            candidateId: plan.candidateId,
            decision: plan.decision,
            reasons: plan.reasons,
            communication: plan.communication,
          },
        }
      : {}),
  })
}
