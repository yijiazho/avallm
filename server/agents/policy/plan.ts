import type {
  Decision,
  DecisionRequest,
  Seat,
} from '../../engine/types.ts'
import type { ForcedPlayReasonCode } from '../analysis/types.ts'
import type { LanguageUtteranceChannel } from '../communication/language-types.ts'
import {
  type CandidateScore,
  type GoodProposalFeatures,
  type GoodVoteFeatures,
} from './score.ts'
import { compareCandidateIds } from './candidates.ts'
import {
  clampProbabilityOrZero as clampProbability,
  PROBABILITY_TOLERANCE,
} from '../components/probability-arithmetic.ts'

export const DECISION_PLAN_VERSION = 'decision-plan-v2'
export const COMMUNICATION_INTENT_VERSION = 'communication-intent-v2'
export const POSTERIOR_UNCERTAINTY_VERSION = 'posterior-uncertainty-v1'

export const COMMUNICATION_CLAIM_CODES = [
  'EXPLAIN_COMMITTED_TEAM',
  'EXPLAIN_COMMITTED_REVISION',
  'ADVOCATE_SELECTED_ACTION',
  'ACKNOWLEDGE_UNCERTAINTY',
] as const
export type CommunicationClaimCode =
  typeof COMMUNICATION_CLAIM_CODES[number]

export type PosteriorUncertainty =
  | {
      version: typeof POSTERIOR_UNCERTAINTY_VERSION
      kind: 'selected-team-clean'
      semantics: GoodProposalFeatures['semantics']
      beliefModelVersion: string
      beliefThroughSeq: number
      cleanProbability: number
      residualProbability: number
    }
  | {
      version: typeof POSTERIOR_UNCERTAINTY_VERSION
      kind: 'current-versus-alternative-team-clean'
      semantics: GoodVoteFeatures['semantics']
      beliefModelVersion: string
      beliefThroughSeq: number
      currentCleanProbability: number
      bestAlternativeCleanProbability: number
      utilityGap: number
    }
  | {
      version: typeof POSTERIOR_UNCERTAINTY_VERSION
      kind: 'role-composite-decision'
      semantics: GoodProposalFeatures['semantics'] | GoodVoteFeatures['semantics']
      beliefModelVersion: string
      beliefThroughSeq: number
      baseKind: 'proposal-team-clean' | 'vote-current-versus-alternative'
      compositeUtilityGap: number
    }

export interface PlannerCommunicationDirection {
  version: typeof COMMUNICATION_INTENT_VERSION
  channel: LanguageUtteranceChannel
  targetSeats: readonly Seat[]
  claimCodes: readonly CommunicationClaimCode[]
  tone: 'natural'
}

export interface CommunicationIntent extends PlannerCommunicationDirection {
  safeFactCodes: readonly string[]
  conceal: readonly string[]
  strategicReasonCodes: readonly string[]
  uncertainty?: PosteriorUncertainty
}

export interface DecisionPlan {
  version: typeof DECISION_PLAN_VERSION
  request: DecisionRequest
  decision: Decision
  candidateId: string
  policyId: string
  reasons: readonly (ForcedPlayReasonCode | string)[]
  beliefThroughSeq: number
  candidateScores: readonly CandidateScore[]
  communication?: CommunicationIntent
}

export interface CommittedVoicePlan {
  version: typeof DECISION_PLAN_VERSION
  decision: Decision
  candidateId: string
  communication?: Omit<
    CommunicationIntent,
    'conceal' | 'uncertainty'
  > & {
    uncertainty?: {
      version: 'voice-uncertainty-v1'
      kind:
        | 'selected-team-clean'
        | 'current-versus-alternative-team-clean'
        | 'decision-confidence'
      confidence: 'certain' | 'high' | 'moderate' | 'close'
    }
  }
}

const PUBLIC_SAFE_FACT_CODES = new Set([
  'GOOD_MATCH_POINT',
  'EVIL_MATCH_POINT',
  'HAMMER_NEAR',
  'HAMMER_NEXT',
  'HAMMER_AUTOMATIC',
])

export interface CommunicationFactProjection {
  safeFactCodes: readonly string[]
  conceal: readonly string[]
}

export function selectedStrategicReasonCodes(
  score: CandidateScore,
  surface: readonly CandidateScore[] = [],
): readonly string[] {
  const features = score.features
  if (score.roleObjectiveFeatures) {
    if (features?.version === 'good-proposal-features-v1') {
      // Role utility may deliberately select a team below the base posterior
      // maximum. Public communication may name the joint basis, never the
      // private role adjustment or a false clean-probability maximum.
      return ['GOOD_PROPOSAL_JOINT_TEAM_CLEAN']
    }
    if (features?.version === 'good-vote-features-v1') {
      return [
        'GOOD_VOTE_CURRENT_TEAM_JOINT_CLEAN',
        'GOOD_VOTE_BEST_ALTERNATIVE_JOINT_CLEAN',
        'GOOD_VOTE_BOARD_STAKES',
        'GOOD_VOTE_PROPOSAL_RUNWAY',
        'GOOD_VOTE_HAMMER_RISK',
        ...(features.informationBonus > 0
          ? ['GOOD_VOTE_INFORMATION_FUTURE_QUEST']
          : []),
      ]
    }
    return []
  }
  if (features?.version === 'good-proposal-features-v1') {
    const reasons = ['GOOD_PROPOSAL_JOINT_TEAM_CLEAN']
    const comparable = surface.filter(
      (candidate) =>
        candidate.viable
        && candidate.features?.version === 'good-proposal-features-v1',
    )
    if (score.viable && comparable.length) {
      const best = Math.max(...comparable.map(
        (candidate) =>
          (candidate.features as GoodProposalFeatures).cleanProbability,
      ))
      if (features.cleanProbability === best) {
        reasons.push('GOOD_PROPOSAL_MAX_TEAM_CLEAN')
        const tied = comparable
          .filter(
            (candidate) =>
              (candidate.features as GoodProposalFeatures).cleanProbability
                === best,
          )
          .map((candidate) => candidate.candidateId)
          .sort(compareCandidateIds)
        if (tied.length > 1 && tied[0] === score.candidateId) {
          reasons.push('GOOD_PROPOSAL_CANONICAL_TIE_BREAK')
        }
      }
    }
    return reasons
  }
  if (features?.version === 'good-vote-features-v1') {
    return [
      'GOOD_VOTE_CURRENT_TEAM_JOINT_CLEAN',
      'GOOD_VOTE_BEST_ALTERNATIVE_JOINT_CLEAN',
      'GOOD_VOTE_BOARD_STAKES',
      'GOOD_VOTE_PROPOSAL_RUNWAY',
      'GOOD_VOTE_HAMMER_RISK',
      ...(features.informationBonus > 0
        ? ['GOOD_VOTE_INFORMATION_FUTURE_QUEST']
        : []),
      ...(
        features.selectionMode === 'seeded-band'
        && features.seedBucket !== undefined
          ? ['GOOD_VOTE_SEEDED_VIABLE_BAND']
          : score.viable ? ['GOOD_VOTE_TOP_UTILITY'] : []
      ),
    ]
  }
  return []
}

export function plannerOverrideReasonCodes(
  score: CandidateScore,
  surface: readonly CandidateScore[],
): readonly string[] {
  if (
    score.roleObjectiveFeatures?.selectionMode === 'seeded-composite-band'
    && score.roleObjectiveFeatures.inViableBand
    && score.viable
  ) {
    return ['PRIVATE_ROLE_OBJECTIVE_SEEDED_BAND']
  }
  return selectedStrategicReasonCodes(score, surface).filter(
    (reason) =>
      reason === 'GOOD_PROPOSAL_MAX_TEAM_CLEAN'
      || reason === 'GOOD_VOTE_SEEDED_VIABLE_BAND',
  )
}

export function materialPosteriorUncertainty(
  uncertainty: PosteriorUncertainty | undefined,
): boolean {
  if (!uncertainty) return false
  return uncertainty.kind === 'selected-team-clean'
    ? uncertainty.residualProbability > PROBABILITY_TOLERANCE
    : uncertainty.kind === 'current-versus-alternative-team-clean'
      ? uncertainty.utilityGap <= 0.04
      : uncertainty.compositeUtilityGap <= 0.04
}

export function voiceUncertainty(
  uncertainty: PosteriorUncertainty | undefined,
): NonNullable<
  NonNullable<CommittedVoicePlan['communication']>['uncertainty']
> | undefined {
  if (!uncertainty) return undefined
  if (uncertainty.kind === 'selected-team-clean') {
    return {
      version: 'voice-uncertainty-v1',
      kind: uncertainty.kind,
      confidence:
        uncertainty.residualProbability <= PROBABILITY_TOLERANCE ? 'certain'
          : uncertainty.cleanProbability >= 0.75 ? 'high'
            : uncertainty.cleanProbability >= 0.5 ? 'moderate'
              : 'close',
    }
  }
  if (uncertainty.kind === 'role-composite-decision') {
    return {
      version: 'voice-uncertainty-v1',
      // The private planner trace retains the composite role-policy marker and
      // exact utility gap. Voice gets only a role-neutral qualitative signal.
      kind: 'decision-confidence',
      confidence:
        uncertainty.compositeUtilityGap > 0.25 ? 'high'
          : uncertainty.compositeUtilityGap > 0.04 ? 'moderate'
            : 'close',
    }
  }
  return {
    version: 'voice-uncertainty-v1',
    kind: uncertainty.kind,
    confidence:
      uncertainty.utilityGap > 0.25 ? 'high'
        : uncertainty.utilityGap > 0.04 ? 'moderate'
          : 'close',
  }
}

export function posteriorUncertainty(
  score: CandidateScore,
  surface: readonly CandidateScore[] = [],
): PosteriorUncertainty | undefined {
  const features = score.features
  const role = score.roleObjectiveFeatures
  if (role && features) {
    const alternatives = surface.filter(
      (candidate) =>
        candidate.candidateId !== score.candidateId
        && candidate.value !== -Number.MAX_SAFE_INTEGER
        && candidate.roleObjectiveFeatures?.version === role.version,
    )
    const nearest = alternatives.length
      ? Math.min(...alternatives.map((candidate) =>
          Math.abs(
            role.combinedValue
            - candidate.roleObjectiveFeatures!.combinedValue,
          )))
      : 1
    return {
      version: POSTERIOR_UNCERTAINTY_VERSION,
      kind: 'role-composite-decision',
      semantics: features.semantics,
      beliefModelVersion: features.beliefModelVersion,
      beliefThroughSeq: features.beliefThroughSeq,
      baseKind: features.version === 'good-proposal-features-v1'
        ? 'proposal-team-clean'
        : 'vote-current-versus-alternative',
      compositeUtilityGap: nearest,
    }
  }
  if (features?.version === 'good-proposal-features-v1') {
    const cleanProbability = clampProbability(features.cleanProbability)
    return {
      version: POSTERIOR_UNCERTAINTY_VERSION,
      kind: 'selected-team-clean',
      semantics: features.semantics,
      beliefModelVersion: features.beliefModelVersion,
      beliefThroughSeq: features.beliefThroughSeq,
      cleanProbability,
      residualProbability: 1 - cleanProbability,
    }
  }
  if (features?.version === 'good-vote-features-v1') {
    return {
      version: POSTERIOR_UNCERTAINTY_VERSION,
      kind: 'current-versus-alternative-team-clean',
      semantics: features.semantics,
      beliefModelVersion: features.beliefModelVersion,
      beliefThroughSeq: features.beliefThroughSeq,
      currentCleanProbability: clampProbability(
        features.currentCleanProbability,
      ),
      bestAlternativeCleanProbability: clampProbability(
        features.bestAlternativeCleanProbability,
      ),
      utilityGap: Math.abs(
        features.approveUtility - features.rejectUtility,
      ),
    }
  }
  return undefined
}

/** Private analysis facts are denied public use unless explicitly allowlisted. */
export function communicationFactProjection(
  factCodes: readonly string[],
): CommunicationFactProjection {
  return {
    safeFactCodes: factCodes.filter((code) => PUBLIC_SAFE_FACT_CODES.has(code)),
    conceal: factCodes.filter((code) => !PUBLIC_SAFE_FACT_CODES.has(code)),
  }
}

export interface CommunicationIntentInput {
  readonly decision: Decision
  readonly factCodes: readonly string[]
  readonly selectedScore?: CandidateScore
  readonly scoreSurface?: readonly CandidateScore[]
  /** A planner's admitted direction, which replaces the derived channel. */
  readonly direction?: PlannerCommunicationDirection
  /**
   * Absent means the caller applied no filter, so every available reason
   * survives. An empty array is the opposite instruction, filter to nothing,
   * so this stays optional rather than defaulting.
   */
  readonly selectedReasons?: readonly string[]
  readonly committedPolicyReasons?: readonly string[]
}

/**
 * Named arguments because the tail is five optional values, two of which
 * (`selectedReasons` and `committedPolicyReasons`) are both `readonly string[]`
 * and mean opposite things: one filters the reason set down, the other feeds
 * it. Positionally, transposing the two typechecked.
 */
export function defaultCommunicationIntent(
  input: CommunicationIntentInput,
): CommunicationIntent | undefined {
  const {
    decision,
    factCodes,
    selectedScore,
    scoreSurface,
    direction,
    selectedReasons,
    committedPolicyReasons = [],
  } = input
  const { safeFactCodes, conceal } = communicationFactProjection(factCodes)
  const availableReasons = [...new Set([
    ...(selectedScore
      ? selectedStrategicReasonCodes(selectedScore, scoreSurface)
      : []),
    ...committedPolicyReasons,
  ])]
  const strategicReasonCodes = selectedReasons === undefined
    ? availableReasons
    : selectedReasons.filter((reason) => availableReasons.includes(reason))
  const uncertainty = selectedScore
    ? posteriorUncertainty(selectedScore, scoreSurface)
    : undefined
  const enrich = (
    base: PlannerCommunicationDirection,
  ): CommunicationIntent => {
    const acknowledge = materialPosteriorUncertainty(uncertainty)
    return {
      ...base,
      claimCodes: acknowledge
        ? base.claimCodes
        : base.claimCodes.filter(
            (code) => code !== 'ACKNOWLEDGE_UNCERTAINTY',
          ),
      safeFactCodes,
      conceal,
      strategicReasonCodes,
      ...(uncertainty ? { uncertainty } : {}),
    }
  }
  if (direction) return enrich(structuredClone(direction))
  if (decision.kind === 'discuss') {
    return enrich({
      version: COMMUNICATION_INTENT_VERSION,
      channel: 'discussion',
      targetSeats: [],
      claimCodes: [],
      tone: 'natural',
    })
  }
  if (decision.kind === 'propose') {
    return enrich({
      version: COMMUNICATION_INTENT_VERSION,
      channel: 'proposal-pitch',
      targetSeats: [...decision.team],
      claimCodes: [
        'EXPLAIN_COMMITTED_TEAM',
        'ADVOCATE_SELECTED_ACTION',
        ...(materialPosteriorUncertainty(uncertainty)
          ? ['ACKNOWLEDGE_UNCERTAINTY' as const]
          : []),
      ],
      tone: 'natural',
    })
  }
  if (decision.kind === 'finalize' && !decision.stick) {
    return enrich({
      version: COMMUNICATION_INTENT_VERSION,
      channel: 'revision-reason',
      targetSeats: [...decision.team],
      claimCodes: [
        'EXPLAIN_COMMITTED_REVISION',
        'ADVOCATE_SELECTED_ACTION',
      ],
      tone: 'natural',
    })
  }
  return undefined
}
