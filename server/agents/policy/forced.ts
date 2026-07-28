import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import { teamsEqual } from '../../engine/rules.ts'
import type {
  ForcedPlayReasonCode,
  SituationAnalysis,
} from '../analysis/types.ts'
import {
  candidateIdForDecision,
} from './candidates.ts'
import {
  FORCED_POLICY_VERSION,
  type ForcedPolicyResult,
  type PolicyCandidate,
} from './types.ts'
import type {
  PrivateEvilQuestCardPolicy,
} from './evil-quest-card.ts'

const ids = (candidates: readonly PolicyCandidate[]): readonly string[] =>
  candidates.map((candidate) => candidate.id)

function teamForCandidate(
  candidate: PolicyCandidate,
  view: PlayerView,
): readonly Seat[] | undefined {
  const decision = candidate.decision
  if (decision.kind === 'propose') return decision.team
  if (decision.kind === 'finalize') {
    return decision.stick ? view.currentTeam : decision.team
  }
  return undefined
}

function constrained(
  candidates: readonly PolicyCandidate[],
  allowedCandidateIds: readonly string[],
  reasonCodes: readonly ForcedPlayReasonCode[],
): ForcedPolicyResult {
  if (!allowedCandidateIds.length) {
    throw new Error(
      `forced policy ${reasonCodes.join('+')} removed every legal candidate`,
    )
  }
  return {
    version: FORCED_POLICY_VERSION,
    applied: true,
    reasonCodes,
    allowedCandidateIds,
    ...(allowedCandidateIds.length === 1
      ? { selectedCandidateId: allowedCandidateIds[0] }
      : {}),
  }
}

const select = (
  candidates: readonly PolicyCandidate[],
  decision: Parameters<typeof candidateIdForDecision>[0],
  reasonCodes: readonly ForcedPlayReasonCode[],
): ForcedPolicyResult => {
  const id = candidateIdForDecision(decision)
  if (!candidates.some((candidate) => candidate.id === id)) {
    throw new Error(`forced policy selected absent candidate ${id}`)
  }
  return constrained(candidates, [id], reasonCodes)
}

export interface ForcedVoteChoice {
  decision: Extract<Decision, { kind: 'vote' }>
  reasonCodes: readonly ForcedPlayReasonCode[]
}

/** Shared by the vote policy and discussion's non-binding lean projection. */
export function forcedVoteChoice(
  view: PlayerView,
  analysis: SituationAnalysis,
): ForcedVoteChoice | undefined {
  if (view.alignment !== 'evil') return undefined
  const canSink = analysis.factCodes.includes(
    'CURRENT_TEAM_CAN_MEET_FAIL_REQUIREMENT',
  )
  if (
    canSink
    && (analysis.matchPoint.good || analysis.matchPoint.evil)
    && analysis.voteLeverage.approveCouldMatter
  ) {
    return {
      decision: { kind: 'vote', vote: 'approve' },
      reasonCodes: ['EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED'],
    }
  }
  if (
    analysis.matchPoint.good
    && !canSink
    && analysis.voteLeverage.rejectCouldMatter
  ) {
    return {
      decision: { kind: 'vote', vote: 'reject' },
      reasonCodes: ['EVIL_TEAM_CANNOT_SINK_GOOD_MATCH_POINT'],
    }
  }
  return undefined
}

/**
 * Apply only mechanically forced T1 rules. Cover timing and other strategic
 * defaults deliberately remain in the ordinary policy.
 */
export function applyForcedPolicy(
  req: DecisionRequest,
  view: PlayerView,
  analysis: SituationAnalysis,
  candidates: readonly PolicyCandidate[],
  options: {
    /**
     * An explicitly configured private quest-card policy supplies the evil
     * quest choice. This owner validates capacity and selects the sole legal
     * candidate before any scorer or planner can act.
     */
    evilQuestCardPolicy?: PrivateEvilQuestCardPolicy
  } = {},
): ForcedPolicyResult {
  if (candidates.some((candidate) => candidate.kind !== req.kind)) {
    throw new Error(`forced policy received mixed candidates for ${req.kind}`)
  }

  if (req.kind === 'quest') {
    if (view.alignment === 'good') {
      return select(
        candidates,
        { kind: 'quest', card: 'success' },
        ['GOOD_QUEST_CARD_FORCED_SUCCESS'],
      )
    }
    const current = analysis.currentTeam
    const need = analysis.failsRequired
    const canSink = (current?.knownFailsAboard.length ?? 0) >= need
    if (!canSink && view.role !== 'oberon') {
      if (!analysis.forcedPlayReasonCodes.includes('EVIL_QUEST_CARD_CANNOT_SINK')) {
        throw new Error('analysis omitted EVIL_QUEST_CARD_CANNOT_SINK')
      }
      return select(
        candidates,
        { kind: 'quest', card: 'success' },
        ['EVIL_QUEST_CARD_CANNOT_SINK'],
      )
    }
    if (
      canSink
      && (analysis.matchPoint.good || analysis.matchPoint.evil)
    ) {
      const reasons: ForcedPlayReasonCode[] = []
      if (analysis.matchPoint.good) reasons.push('GOOD_MATCH_POINT_FAIL_REQUIRED')
      if (analysis.matchPoint.evil) reasons.push('EVIL_MATCH_POINT_FAIL_AVAILABLE')
      return select(candidates, { kind: 'quest', card: 'fail' }, reasons)
    }
    const questPolicy = options.evilQuestCardPolicy
    if (view.role !== 'oberon' && questPolicy?.selectedCard) {
      const reasonByPolicy = {
        EXACT_QUOTA_DESIGNATED_FAIL:
          'EVIL_EXACT_QUOTA_DESIGNATED_FAIL',
        EXACT_QUOTA_NONDESIGNATED_SUCCESS:
          'EVIL_EXACT_QUOTA_UNDESIGNATED_SUCCESS',
        INSUFFICIENT_VISIBLE_QUOTA_SUCCESS:
          'EVIL_INSUFFICIENT_VISIBLE_QUOTA_HOLD',
        SHARED_SLOW_PLAY_HOLD:
          'EVIL_SHARED_SLOW_PLAY_HOLD',
        ROBUST_DECISIVE_FAIL:
          'EVIL_ROBUST_DECISIVE_FAIL',
        ROBUST_LOCAL_SLOW_PLAY_FAIL:
          'EVIL_ROBUST_LOCAL_SLOW_PLAY_FAIL',
        ROBUST_LOCAL_SLOW_PLAY_HOLD:
          'EVIL_ROBUST_LOCAL_SLOW_PLAY_HOLD',
      } satisfies Partial<Record<
        typeof questPolicy.reason,
        ForcedPlayReasonCode
      >>
      const hasMappedReason = (
        reason: typeof questPolicy.reason,
      ): reason is keyof typeof reasonByPolicy =>
        Object.hasOwn(reasonByPolicy, reason)
      const reason = hasMappedReason(questPolicy.reason)
        ? reasonByPolicy[questPolicy.reason]
        : undefined
      if (!reason || (questPolicy.selectedCard === 'fail' && !canSink)) {
        throw new Error(
          `invalid forced quest-policy directive: ${questPolicy.reason}`,
        )
      }
      return select(
        candidates,
        { kind: 'quest', card: questPolicy.selectedCard },
        [reason],
      )
    }
  }

  if (req.kind === 'vote') {
    const forcedVote = forcedVoteChoice(view, analysis)
    if (forcedVote?.reasonCodes.includes('EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED')) {
      if (
        !analysis.forcedPlayReasonCodes.includes(
          'EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED',
        )
      ) {
        throw new Error('analysis omitted EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED')
      }
      return select(
        candidates,
        forcedVote.decision,
        forcedVote.reasonCodes,
      )
    }
    if (forcedVote) {
      return select(
        candidates,
        forcedVote.decision,
        forcedVote.reasonCodes,
      )
    }
  }

  if (
    (req.kind === 'propose' || req.kind === 'finalize')
    && view.alignment === 'evil'
    && analysis.matchPoint.good
  ) {
    const need = analysis.failsRequired
    const candidateFacts = new Map(
      analysis.policyCandidateTeams.map((facts) => [facts.candidateId, facts]),
    )
    if (candidateFacts.size !== analysis.policyCandidateTeams.length) {
      throw new Error('analysis contains duplicate policy candidate IDs')
    }
    const teamCandidates = candidates.filter(
      (candidate) =>
        candidate.kind === 'propose' || candidate.kind === 'finalize',
    )
    for (const candidate of teamCandidates) {
      const expectedTeam = teamForCandidate(candidate, view)
      const facts = candidateFacts.get(candidate.id)
      if (!expectedTeam || !facts || !teamsEqual([...expectedTeam], [...facts.team])) {
        throw new Error(`analysis mismatch for policy candidate ${candidate.id}`)
      }
    }
    if (
      analysis.policyCandidateTeams.some(
        (facts) => !teamCandidates.some((candidate) => candidate.id === facts.candidateId),
      )
    ) {
      throw new Error('analysis contains an absent policy candidate ID')
    }
    const sinkable = teamCandidates.filter((candidate) =>
      candidateFacts.get(candidate.id)!.knownFailsAboard.length >= need)
    if (sinkable.length) {
      if (
        !analysis.forcedPlayReasonCodes.includes(
          'EVIL_GOOD_MATCH_POINT_SINKABLE_PROPOSAL_REQUIRED',
        )
      ) {
        throw new Error(
          'analysis omitted EVIL_GOOD_MATCH_POINT_SINKABLE_PROPOSAL_REQUIRED',
        )
      }
      return constrained(
        candidates,
        sinkable.map((candidate) => candidate.id),
        ['EVIL_GOOD_MATCH_POINT_SINKABLE_PROPOSAL_REQUIRED'],
      )
    }
  }

  return {
    version: FORCED_POLICY_VERSION,
    applied: false,
    reasonCodes: [],
    allowedCandidateIds: ids(candidates),
  }
}
