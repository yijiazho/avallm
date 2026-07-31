import { MAX_PROPOSALS, QUESTS_TO_WIN } from '../../engine/rules.ts'
import { evilPartnersOf } from '../../engine/knowledge.ts'
import type {
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import {
  exactBelief,
  feasibleWorlds,
} from '../belief/exact.ts'
import {
  assessTeam,
  assessTeams,
} from '../belief/team-assessment.ts'
import { questFailEvidence } from '../belief/constraints.ts'
import type {
  BeliefSnapshot,
  HiddenWorld,
} from '../belief/types.ts'
import type { Evidence } from '../cognition/types.ts'
import { compareCandidateIds } from '../policy/candidates.ts'
import { alignmentOf, provenanceFor } from './deduction-provenance.ts'
import {
  SITUATION_ANALYSIS_VERSION,
  GOOD_VOTE_SITUATION_VERSION,
  type AnalysisFactCode,
  type BoardSituation,
  type CandidateTeamFacts,
  type ForcedPlayReasonCode,
  type GoodVoteSituation,
  type HardDeduction,
  type PolicyCandidateTeamAssessment,
  type SituationAnalysis,
  type SituationTeamAssessment,
} from './situation-types.ts'

export function boardSituation(
  view: {
    readonly quests: readonly {
      readonly result?: 'success' | 'fail'
      readonly failsRequired: number
    }[]
    readonly proposalNum: number
    readonly round: number
  },
): BoardSituation {
  const good = view.quests.filter((quest) => quest.result === 'success').length
  const evil = view.quests.filter((quest) => quest.result === 'fail').length
  const proposalsRemaining = Math.max(0, MAX_PROPOSALS - view.proposalNum)
  const automaticApproval = view.proposalNum === MAX_PROPOSALS
  const proximity =
    automaticApproval ? 'hammer'
      : view.proposalNum === MAX_PROPOSALS - 1 ? 'next'
        : view.proposalNum === MAX_PROPOSALS - 2 ? 'near'
          : 'normal'
  return {
    score: { good, evil },
    matchPoint: {
      good: good === QUESTS_TO_WIN - 1,
      evil: evil === QUESTS_TO_WIN - 1,
    },
    failsRequired: view.quests[view.round - 1]?.failsRequired ?? 1,
    proposalNumber: view.proposalNum,
    proposalsRemaining,
    rejectionsBeforeHammer: automaticApproval ? 0 : proposalsRemaining,
    hammer: { proximity, automaticApproval },
  }
}

/**
 * Evil seats this viewer can legally identify on a team. Oberon is absent from
 * partner lists and therefore remains invisible in both directions.
 */
export function knownFailsAboard(
  view: PlayerView,
  team: readonly Seat[] | undefined,
): readonly Seat[] {
  if (view.alignment !== 'evil' || !team) return []
  const legallyKnown = new Set<Seat>([
    view.seat,
    ...evilPartnersOf(view.privateInfo),
  ])
  return team.filter((seat) => legallyKnown.has(seat)).sort((a, b) => a - b)
}

function teamAssessment(
  view: PlayerView,
  snapshot: BeliefSnapshot,
  team: readonly Seat[],
): SituationTeamAssessment {
  return {
    ...assessTeam(snapshot, team),
    knownFailsAboard: knownFailsAboard(view, team),
  }
}

function factCodesFor(
  board: BoardSituation,
  current: SituationTeamAssessment | undefined,
  failsRequired: number,
  deductions: readonly HardDeduction[],
): readonly AnalysisFactCode[] {
  const codes = new Set<AnalysisFactCode>()
  if (board.matchPoint.good) codes.add('GOOD_MATCH_POINT')
  if (board.matchPoint.evil) codes.add('EVIL_MATCH_POINT')
  if (board.hammer.proximity === 'near') codes.add('HAMMER_NEAR')
  if (board.hammer.proximity === 'next') codes.add('HAMMER_NEXT')
  if (board.hammer.automaticApproval) codes.add('HAMMER_AUTOMATIC')
  if (current?.knownFailsAboard.length) codes.add('CURRENT_TEAM_HAS_KNOWN_EVIL')
  if ((current?.knownFailsAboard.length ?? 0) >= failsRequired) {
    codes.add('CURRENT_TEAM_CAN_MEET_FAIL_REQUIREMENT')
  }
  for (const deduction of deductions) {
    if (deduction.provenance.kind === 'private-deal') {
      codes.add('ALIGNMENT_PROVEN_PRIVATE')
    } else if (deduction.provenance.kind === 'role-cardinality-closure') {
      codes.add('ALIGNMENT_PROVEN_CLOSURE')
    } else if (deduction.provenance.kind === 'quest-record') {
      codes.add('ALIGNMENT_PROVEN_QUEST')
    } else {
      codes.add('ALIGNMENT_PROVEN_JOINT')
    }
  }
  return [...codes]
}

function forcedCodesFor(
  view: PlayerView,
  board: BoardSituation,
  current: SituationTeamAssessment | undefined,
  policyCandidateTeams: readonly CandidateTeamFacts[],
  failsRequired: number,
): readonly ForcedPlayReasonCode[] {
  const codes = new Set<ForcedPlayReasonCode>()
  if (
    view.phase === 'quest'
    && view.alignment === 'good'
    && current?.team.includes(view.seat)
  ) {
    codes.add('GOOD_QUEST_CARD_FORCED_SUCCESS')
  }
  if (board.hammer.automaticApproval) codes.add('HAMMER_TEAM_AUTOMATIC')
  if (view.alignment === 'evil' && current) {
    const canSink = current.knownFailsAboard.length >= failsRequired
    if (canSink) codes.add('EVIL_TEAM_CAN_SINK')
    if (
      view.phase === 'quest'
      && !canSink
      && view.role !== 'oberon'
    ) {
      codes.add('EVIL_QUEST_CARD_CANNOT_SINK')
    }
    if (board.matchPoint.evil && canSink) {
      codes.add('EVIL_MATCH_POINT_FAIL_AVAILABLE')
    }
    if (board.matchPoint.good) {
      if (canSink) codes.add('GOOD_MATCH_POINT_FAIL_REQUIRED')
      // No stand-down clause here any more. This used to fire only when the
      // declared leans left this seat's ballot able to change the outcome; a
      // live seat cannot see the tally in advance, and the leans it used to
      // read were never binding on anyone.
      else if (view.phase === 'vote') {
        codes.add('EVIL_TEAM_CANNOT_SINK_GOOD_MATCH_POINT')
      }
    }
    if (
      view.phase === 'vote'
      && canSink
      && (board.matchPoint.good || board.matchPoint.evil)
    ) {
      codes.add('EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED')
    }
  }
  if (
    (view.phase === 'proposal' || view.phase === 'finalize')
    && view.alignment === 'evil'
    && board.matchPoint.good
    && policyCandidateTeams.some(
      (candidate) => candidate.knownFailsAboard.length >= failsRequired,
    )
  ) {
    codes.add('EVIL_GOOD_MATCH_POINT_SINKABLE_PROPOSAL_REQUIRED')
  }
  return [...codes]
}

export interface AnalyzeSituationOptions {
  belief?: BeliefSnapshot
  evidence?: readonly Evidence[]
  candidateTeams?: readonly (readonly Seat[])[]
  // policyCandidateTeams and policyCandidateAssessments share this shape but are
  // NOT interchangeable. policyCandidateTeams drives the facts-only path
  // (knownFailsAboard per candidate, no belief batch); policyCandidateAssessments
  // drives the full per-candidate belief assessment (assessTeams). Passing one
  // where the other is expected silently drops the work the other would do.
  policyCandidateTeams?: readonly {
    candidateId: string
    team: readonly Seat[]
  }[]
  policyCandidateAssessments?: readonly {
    candidateId: string
    team: readonly Seat[]
  }[]
  /** Build the opt-in current-team versus best-alternative vote projection. */
  goodVote?: boolean
}

export function analyzeSituation(
  view: PlayerView,
  options: AnalyzeSituationOptions = {},
): SituationAnalysis {
  const belief = options.belief ?? exactBelief(view)
  const evidence = options.evidence ?? []
  const board = boardSituation(view)
  const questRecords = questFailEvidence(view)
  let dealWorldCache: readonly HiddenWorld[] | undefined
  const dealWorlds = (): readonly HiddenWorld[] =>
    dealWorldCache ??= feasibleWorlds(view, { questRecord: 'none' })
  const deductions: HardDeduction[] = []
  const provenGood: Seat[] = []
  const provenEvil: Seat[] = []
  const unresolved: Seat[] = []
  const supportedWorlds = belief.worlds.map((weighted) => weighted.world)
  for (const player of view.players) {
    const alignment = alignmentOf(supportedWorlds, player.seat)
    if (!alignment) {
      unresolved.push(player.seat)
      continue
    }
    if (alignment === 'good') provenGood.push(player.seat)
    else provenEvil.push(player.seat)
    // provenanceFor returns before touching dealWorlds for a directly known
    // seat, so the thunk keeps the deal-world computation lazy without the
    // separate inline pre-check this branch used to carry.
    const provenance = provenanceFor(
      view,
      evidence,
      dealWorlds,
      questRecords,
      player.seat,
      alignment,
    )
    deductions.push({
      seat: player.seat,
      alignment,
      provenance,
    })
  }

  const currentTeam = view.currentTeam?.length
    ? teamAssessment(view, belief, view.currentTeam)
    : undefined
  const candidateTeams = (options.candidateTeams ?? []).map((team) =>
    teamAssessment(view, belief, team))
  const policyCandidateTeams = (options.policyCandidateTeams ?? []).map(
    (candidate): CandidateTeamFacts => ({
      candidateId: candidate.candidateId,
      team: [...candidate.team].sort((a, b) => a - b),
      knownFailsAboard: knownFailsAboard(view, candidate.team),
    }),
  )
  const assessmentRequests = options.policyCandidateAssessments ?? []
  const assessmentIds = new Set<string>()
  for (const request of assessmentRequests) {
    if (!request.candidateId || assessmentIds.has(request.candidateId)) {
      throw new Error(
        `duplicate or empty policy assessment ID ${request.candidateId}`,
      )
    }
    assessmentIds.add(request.candidateId)
  }
  const batchAssessments = assessTeams(
    belief,
    assessmentRequests.map((request) => request.team),
  )
  const probabilitySemantics =
    belief.quality === 'weighted'
      ? 'weighted-joint' as const
      : 'uniform-feasible-joint' as const
  const policyCandidateAssessments = assessmentRequests.map(
    (request, index): PolicyCandidateTeamAssessment => {
      const assessment = batchAssessments[index]
      const requestedTeam = [...request.team].sort((a, b) => a - b)
      if (
        !assessment
        || assessment.team.length !== requestedTeam.length
        || assessment.team.some((seat, teamIndex) =>
          seat !== requestedTeam[teamIndex])
      ) {
        throw new Error(
          `analysis mismatch for policy assessment ${request.candidateId}`,
        )
      }
      return {
        candidateId: request.candidateId,
        beliefModelVersion: belief.modelVersion,
        beliefThroughSeq: belief.throughSeq,
        probabilitySemantics,
        ...assessment,
        knownFailsAboard: knownFailsAboard(view, assessment.team),
      }
    },
  )
  let goodVote: GoodVoteSituation | undefined
  if (options.goodVote) {
    if (!currentTeam || !view.currentTeam?.length) {
      throw new Error('good vote analysis requires a current team')
    }
    const canonicalCurrent = [...view.currentTeam].sort((a, b) => a - b)
    const currentMatches = policyCandidateAssessments.filter(
      (assessment) =>
        assessment.team.length === canonicalCurrent.length
        && assessment.team.every(
          (seat, index) => seat === canonicalCurrent[index],
        ),
    )
    if (currentMatches.length !== 1) {
      throw new Error(
        'good vote analysis requires exactly one current-team candidate',
      )
    }
    const alternatives = policyCandidateAssessments
      .filter((assessment) => assessment.candidateId !== currentMatches[0].candidateId)
      .sort((left, right) =>
        right.cleanProbability - left.cleanProbability
        || compareCandidateIds(left.candidateId, right.candidateId))
    if (!alternatives.length) {
      throw new Error('good vote analysis requires a different legal alternative')
    }
    goodVote = {
      version: GOOD_VOTE_SITUATION_VERSION,
      probabilitySemantics,
      beliefModelVersion: belief.modelVersion,
      beliefThroughSeq: belief.throughSeq,
      currentTeam,
      currentCandidateId: currentMatches[0].candidateId,
      bestAlternative: alternatives[0],
    }
  }
  return {
    throughSeq: belief.throughSeq,
    modelVersion: SITUATION_ANALYSIS_VERSION,
    ...board,
    ...(currentTeam ? { currentTeam } : {}),
    candidateTeams,
    policyCandidateTeams,
    policyCandidateAssessments,
    ...(goodVote ? { goodVote } : {}),
    provenGood,
    provenEvil,
    unresolved,
    deductions,
    factCodes: factCodesFor(
      board,
      currentTeam,
      board.failsRequired,
      deductions,
    ),
    forcedPlayReasonCodes: forcedCodesFor(
      view,
      board,
      currentTeam,
      policyCandidateTeams,
      board.failsRequired,
    ),
  }
}
