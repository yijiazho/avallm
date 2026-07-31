import type { PlayerView } from '../../engine/types.ts'
import type { PublicAttributedUtterance } from './language-types.ts'
import type { PublicRecord } from './public-record.ts'
import {
  projectLanguageInterpreterInput,
  recentPublicUtterances,
} from './language-contract.ts'
import type { SituationAnalysis } from '../analysis/types.ts'
import {
  plannerOverrideReasonCodes,
  selectedStrategicReasonCodes,
  type CommittedVoicePlan,
} from '../policy/plan.ts'
import type { CandidateScore } from '../policy/score.ts'
import type {
  DecisionCandidateBoundary,
} from '../policy/decision-layer/types.ts'
import type { ForcedPolicyResult, PolicyCandidate } from '../policy/types.ts'
import type {
  EvilExposureRead,
  PrivatePinRead,
} from '../analysis/private-pin-types.ts'

export const COMPOSED_RENDERER_VERSION = 'composed-policy-renderer-v3'
export const COMPOSED_PROMPT_VERSION = 'composed-typed-context-v3'

export interface ComposedPolicyContext {
  version: typeof COMPOSED_RENDERER_VERSION
  seat: number
  role: PlayerView['role']
  phase: PlayerView['phase']
  publicContext: {
    record: PublicRecord
    recentUtterances: readonly PublicAttributedUtterance[]
  }
  analysisFacts: {
    visibility: 'private-planning-only'
    codes: SituationAnalysis['factCodes']
    /**
     * Private pin reads, present only when their components resolved (planner
     * decisions). Advisory context for planning: alignments this seat is
     * certain of that the table is not, and the good seats certain this (evil)
     * seat is evil. Never a public claim, so it stays under this
     * private-planning-only section and is never handed to voice.
     */
    pins?: {
      readonly leverageEvil: readonly number[]
      readonly leverageGood: readonly number[]
      readonly exposedTo: readonly number[]
    }
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
 * from their executable result rather than re-deriving the strategic triggers
 * that produced them. The viable-candidate list is the exception: it is
 * filtered here from the scored candidates, the planner-override reason codes,
 * and the decision boundary's survivors. The raw-LLM ASKS renderer remains
 * untouched as a frozen baseline.
 */
/**
 * The private pin summary for the planning context, or nothing when neither
 * read resolved. Leverage rows exclude the acting seat's own row (its cover),
 * so they name only what the seat knows about OTHERS; exposure names the good
 * seats certain the acting seat is evil.
 */
function pinAnalysisFacts(
  actingSeat: number,
  privatePin: PrivatePinRead | undefined,
  evilExposure: EvilExposureRead | undefined,
): Pick<ComposedPolicyContext['analysisFacts'], 'pins'> {
  if (!privatePin && !evilExposure) return {}
  const others = privatePin
    ? privatePin.rows.filter((row) => row.seat !== actingSeat)
    : []
  return {
    pins: {
      leverageEvil: others
        .filter((row) => row.pin === 'evil').map((row) => row.seat),
      leverageGood: others
        .filter((row) => row.pin === 'good').map((row) => row.seat),
      exposedTo: evilExposure
        ? evilExposure.pinners.map((pinner) => pinner.seat)
        : [],
    },
  }
}

export function composedPolicyContext(
  view: PlayerView,
  analysis: SituationAnalysis,
  candidates: readonly PolicyCandidate[],
  forced: ForcedPolicyResult,
  candidateBoundary: DecisionCandidateBoundary,
  scores: readonly CandidateScore[],
  structuredCandidateId?: string,
  privatePin?: PrivatePinRead,
  evilExposure?: EvilExposureRead,
): ComposedPolicyContext {
  const byScore = new Map(scores.map((score) => [score.candidateId, score]))
  const publicInput = projectLanguageInterpreterInput(view)
  return {
    version: COMPOSED_RENDERER_VERSION,
    seat: view.seat,
    role: view.role,
    phase: view.phase,
    publicContext: {
      record: publicInput.publicContext,
      recentUtterances: recentPublicUtterances(publicInput),
    },
    analysisFacts: {
      visibility: 'private-planning-only',
      codes: analysis.factCodes,
      ...pinAnalysisFacts(view.seat, privatePin, evilExposure),
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
      const plannerReasons = score && structuredCandidateId
        && candidate.id !== structuredCandidateId
        ? plannerOverrideReasonCodes(score, scores)
        : score ? selectedStrategicReasonCodes(score, scores) : []
      const plannerViable = score?.features?.version === 'good-vote-features-v1'
        ? score.viable
        : candidate.id === structuredCandidateId
          || plannerReasons.length > 0
      return score?.viable
        && plannerViable
        && candidateBoundary.survivorCandidateIds.includes(candidate.id)
        ? [{
            id: candidate.id,
            decision: structuredClone(candidate.decision),
            score: score.value,
            reasonCodes: plannerReasons,
          }]
        : []
    }),
  }
}

export function renderComposedPolicyContext(
  context: ComposedPolicyContext,
): string {
  return JSON.stringify(context)
}

export function renderCommittedVoicePlan(
  plan: CommittedVoicePlan,
): string {
  return JSON.stringify({ committedPlan: plan })
}
