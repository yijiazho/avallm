// NB-014 diagnosis: why the structured proposal value serves an
// information-poor seat worst.
//
// NB-010 measured that structured proposal value alone lowers the Servant's
// clean initial-proposal rate by `-10.6%` and its win rate by `-6.7%` while
// Merlin and Percival lose nothing on that channel. Clean-proposal rate cannot
// be the objective, because Merlin's cleanliness also falls while its win rate
// rises, so a reader that only counts clean teams cannot separate the two.
//
// This reader separates the proposal decision into the parts a value function
// actually owns. The good proposal value is exactly the joint posterior
// probability that a team carries no evil, so whenever the posterior cannot
// tell two teams apart their values are equal and the canonical candidate-id
// order picks the action. This module measures how much of each seat's
// proposal channel is decided that way, whether the resulting teams are more
// legible than the compatibility baseline's, whether the effect is confined to
// one proposal number, and whether a dirty proposal converts into a lost quest.
// It also pairs each arm's FIRST target proposal with the baseline's, which is
// the one proposal decision both arms reach from an identical game state.
//
// It reads artifacts already written by a bench run. It plays no games, makes
// no call, and joins the true role deal, so it is offline evaluation only.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { readArtifacts } from './artifact.ts'
import { compareCandidateIds } from '../agents/policy/candidates.ts'
import type { GameArtifact } from './artifact.ts'
import type { DecisionTrace } from '../agents/trace.ts'
import type { CandidateScore } from '../agents/policy/score.ts'
import type { Seat } from '../engine/types.ts'

export const PROPOSAL_VALUE_DIAGNOSIS_VERSION = 'proposal-value-diagnosis-v1'

const GOOD_PROPOSAL_FEATURES = 'good-proposal-features-v1'
const CANONICAL_TIE_BREAK = 'GOOD_PROPOSAL_CANONICAL_TIE_BREAK'

/** One proposal number within a round, so a regression can be localized. */
export interface ProposalNumberSlice {
  readonly proposalNum: number
  readonly proposals: number
  readonly cleanProposals: number
  readonly approved: number
  readonly approvedDirty: number
}

/**
 * One quest round. Hard constraints only arrive with quest results, so this
 * is the axis on which the posterior can sharpen at all.
 */
export interface ProposalRoundSlice {
  readonly round: number
  readonly proposals: number
  readonly cleanProposals: number
  readonly scoredProposals: number
  readonly argmaxTeams: number
  /** Paired with `argmaxTeams` so the tied share is free of team-size drift. */
  readonly viableTeams: number
  readonly tieDecided: number
}

export interface ProposalValueCell {
  readonly bank: string
  readonly targetRole: string
  readonly variant: string
  readonly games: number
  readonly targetWins: number

  // ---- the public proposal channel, joined to the archived deal ----
  /** Target-led `proposal` events; the same denominator the report uses. */
  readonly proposals: number
  readonly cleanProposals: number
  readonly byProposalNum: readonly ProposalNumberSlice[]
  readonly byRound: readonly ProposalRoundSlice[]
  /** Revisions of a target proposal at finalize; a separate policy channel. */
  readonly revisedAway: number
  readonly approved: number
  readonly approvedDirty: number
  /** The only path by which a dirty proposal costs a quest. */
  readonly approvedDirtyFailedQuest: number
  readonly selfIncluded: number
  /**
   * Legibility: how often the same target repeats an earlier team of the same
   * size in the same game, over the pairs where that was possible.
   */
  readonly sameSizeRepeatPairs: number
  readonly sameSizeRepeats: number

  // ---- candidate-surface facts, available from any scored propose trace ----
  readonly tracedProposals: number
  readonly viableTeams: number
  /**
   * Sum of the chosen team's normalized rank in the canonical candidate-id
   * order over the viable surface. Near zero means low-numbered seats.
   */
  readonly lexRankSum: number
  /**
   * Decisions that took the canonically first team of the whole viable
   * surface. An observer who can reproduce the removals predicts these
   * exactly, without knowing anything the seat knows.
   */
  readonly lexFloorChoices: number

  // ---- posterior structure, only where proposal features were recorded ----
  readonly scoredProposals: number
  /** Teams sharing the maximum posterior clean probability. */
  readonly argmaxTeams: number
  readonly chosenInArgmax: number
  /** Decisions whose posterior argmax has more than one team. */
  readonly tieDecided: number
  readonly tieDecidedClean: number
  readonly uniqueDecided: number
  readonly uniqueDecidedClean: number
  /** Sum of the chosen team's own posterior clean probability. */
  readonly chosenPosteriorSum: number
  /**
   * Sum, over tie-decided decisions only, of the realized clean fraction of
   * the argmax set. Divided by `tieDecided` this is the coin-flip null the
   * canonical order replaces, on exactly the decisions where it applies.
   */
  readonly tieArgmaxCleanFractionSum: number
  /** Same restriction for the posterior the scorer believed. */
  readonly tieChosenPosteriorSum: number
  /** Sum of the realized clean fraction of the whole viable surface. */
  readonly viableCleanFractionSum: number
  /** Decisions where at least one viable team was in fact clean. */
  readonly cleanTeamAvailable: number
  readonly valueSpreadSum: number
  /**
   * Sum of the gap from the maximum to the next distinct value. This measures
   * how far the posterior separates the argmax SET from the rest, which is a
   * different question from whether it separates the teams inside that set:
   * a wide margin and a large argmax can hold at the same decision.
   */
  readonly decisiveMarginSum: number
}

/**
 * The first target proposal of a case is the one proposal decision every arm
 * reaches from an identical prefix, because these arms differ only in the
 * proposal action. Pairing there gives a matched comparison that later
 * proposals cannot support.
 */
export interface FirstProposalPairing {
  readonly bank: string
  readonly targetRole: string
  readonly baseline: string
  readonly candidate: string
  readonly cases: number
  readonly pairs: number
  /** Both arms proposed, but from different positions: excluded, not hidden. */
  readonly unmatchedPosition: number
  readonly onlyBaseline: number
  readonly onlyCandidate: number
  readonly agreed: number
  readonly baselineClean: number
  readonly candidateClean: number
  readonly baselineCleanCandidateDirty: number
  readonly candidateCleanBaselineDirty: number
  /**
   * Pairs where the candidate arm recorded a posterior for the surface, which
   * is what the next four fields need.
   */
  readonly scoredPairs: number
  /** The baseline's team survived forced policy in the candidate arm too. */
  readonly baselineTeamViable: number
  /**
   * The baseline's team already shared the candidate's top posterior value.
   * Where this holds, the value function could have chosen it and only the
   * tie-break did not, so a better tie-break would close the gap. Where it
   * does not, the posterior ranked the baseline's team strictly lower and the
   * gap belongs to the value function itself.
   */
  readonly baselineTeamInArgmax: number
  /** Posterior the candidate arm assigned to the baseline's team. */
  readonly baselineTeamPosteriorSum: number
  /** Posterior of the candidate's own team, which is the surface maximum. */
  readonly candidateTeamPosteriorSum: number
}

export interface ProposalValueDiagnosis {
  readonly version: typeof PROPOSAL_VALUE_DIAGNOSIS_VERSION
  readonly cells: readonly ProposalValueCell[]
  readonly pairings: readonly FirstProposalPairing[]
}

export interface ProposalValueDiagnosisOptions {
  /**
   * Baseline arm for the matched first-proposal comparison. Defaults to the
   * first variant each bank/role group presents, which is the bench's own
   * declared baseline order.
   */
  readonly baselineVariant?: string
}

interface MutableSlice {
  proposals: number
  cleanProposals: number
  approved: number
  approvedDirty: number
}

interface MutableRound {
  proposals: number
  cleanProposals: number
  scoredProposals: number
  argmaxTeams: number
  viableTeams: number
  tieDecided: number
}

interface MutableCell {
  bank: string
  targetRole: string
  variant: string
  games: number
  targetWins: number
  proposals: number
  cleanProposals: number
  byProposalNum: Map<number, MutableSlice>
  byRound: Map<number, MutableRound>
  revisedAway: number
  approved: number
  approvedDirty: number
  approvedDirtyFailedQuest: number
  selfIncluded: number
  sameSizeRepeatPairs: number
  sameSizeRepeats: number
  tracedProposals: number
  viableTeams: number
  lexRankSum: number
  lexFloorChoices: number
  scoredProposals: number
  argmaxTeams: number
  chosenInArgmax: number
  tieDecided: number
  tieDecidedClean: number
  uniqueDecided: number
  uniqueDecidedClean: number
  chosenPosteriorSum: number
  tieArgmaxCleanFractionSum: number
  tieChosenPosteriorSum: number
  viableCleanFractionSum: number
  cleanTeamAvailable: number
  valueSpreadSum: number
  decisiveMarginSum: number
}

interface Architecture {
  readonly bank: string
  readonly caseId: string
  readonly variant: string
  readonly targetRole: string
  readonly targetSeat: number
}

function architectureOf(artifact: GameArtifact): Architecture {
  const architecture = artifact.architecture
  if (
    !architecture
    || typeof architecture.bank !== 'string'
    || typeof architecture.caseId !== 'string'
    || typeof architecture.variant !== 'string'
    || typeof architecture.targetRole !== 'string'
    || !Number.isInteger(architecture.targetSeat)
  ) {
    throw new Error('artifact is not an architecture bench result')
  }
  return architecture as Architecture
}

function evilSeatsOf(artifact: GameArtifact): ReadonlySet<number> {
  return new Set(
    artifact.players
      .filter((player) => player.alignment === 'evil')
      .map((player) => player.seat),
  )
}

const teamIsClean = (
  team: readonly number[],
  evilSeats: ReadonlySet<number>,
): boolean => team.every((seat) => !evilSeats.has(seat))

const teamKey = (team: readonly number[]): string =>
  [...team].sort((left, right) => left - right).join(',')

function emptyCell(architecture: Architecture): MutableCell {
  return {
    bank: architecture.bank,
    targetRole: architecture.targetRole,
    variant: architecture.variant,
    games: 0,
    targetWins: 0,
    proposals: 0,
    cleanProposals: 0,
    byProposalNum: new Map(),
    byRound: new Map(),
    revisedAway: 0,
    approved: 0,
    approvedDirty: 0,
    approvedDirtyFailedQuest: 0,
    selfIncluded: 0,
    sameSizeRepeatPairs: 0,
    sameSizeRepeats: 0,
    tracedProposals: 0,
    viableTeams: 0,
    lexRankSum: 0,
    lexFloorChoices: 0,
    scoredProposals: 0,
    argmaxTeams: 0,
    chosenInArgmax: 0,
    tieDecided: 0,
    tieDecidedClean: 0,
    uniqueDecided: 0,
    uniqueDecidedClean: 0,
    chosenPosteriorSum: 0,
    tieArgmaxCleanFractionSum: 0,
    tieChosenPosteriorSum: 0,
    viableCleanFractionSum: 0,
    cleanTeamAvailable: 0,
    valueSpreadSum: 0,
    decisiveMarginSum: 0,
  }
}

function slice(cell: MutableCell, proposalNum: number): MutableSlice {
  let entry = cell.byProposalNum.get(proposalNum)
  if (!entry) {
    entry = { proposals: 0, cleanProposals: 0, approved: 0, approvedDirty: 0 }
    cell.byProposalNum.set(proposalNum, entry)
  }
  return entry
}

function roundSlice(cell: MutableCell, round: number): MutableRound {
  let entry = cell.byRound.get(round)
  if (!entry) {
    entry = {
      proposals: 0,
      cleanProposals: 0,
      scoredProposals: 0,
      argmaxTeams: 0,
      viableTeams: 0,
      tieDecided: 0,
    }
    cell.byRound.set(round, entry)
  }
  return entry
}

interface LoggedProposal {
  readonly round: number
  readonly proposalNum: number
  readonly team: readonly number[]
}

/** Target-led initial proposals, in log order. */
function loggedProposals(
  artifact: GameArtifact,
  targetSeat: number,
): readonly LoggedProposal[] {
  const rows: LoggedProposal[] = []
  for (const event of artifact.log) {
    if (event.type !== 'proposal') continue
    const payload = event.payload as Record<string, unknown>
    if (payload.leader !== targetSeat) continue
    const team = payload.team
    if (
      !Array.isArray(team)
      || !Number.isInteger(payload.round)
      || !Number.isInteger(payload.proposalNum)
    ) {
      throw new Error(`artifact ${artifact.id} has a malformed proposal event`)
    }
    rows.push({
      round: payload.round as number,
      proposalNum: payload.proposalNum as number,
      team: team as readonly number[],
    })
  }
  return rows
}

interface Resolution {
  readonly revised: boolean
  readonly approved: boolean
  readonly questFailed: boolean
}

/**
 * Follow one proposal to the vote it reached and, if it ran, to the quest
 * result. A revision at finalize replaces the team, so the initial proposal
 * never reached that vote and is scored as revised rather than approved.
 */
function resolutionOf(
  artifact: GameArtifact,
  proposal: LoggedProposal,
): Resolution {
  let revised = false
  let approved = false
  for (const event of artifact.log) {
    const payload = event.payload as Record<string, unknown>
    if (payload.round !== proposal.round) continue
    if (
      event.type === 'proposalRevised'
      && payload.proposalNum === proposal.proposalNum
    ) {
      revised = true
    }
    if (
      event.type === 'voteReveal'
      && payload.proposalNum === proposal.proposalNum
    ) {
      const team = payload.team
      approved = payload.approved === true
        && Array.isArray(team)
        && teamKey(team as readonly number[]) === teamKey(proposal.team)
    }
  }
  if (!approved) return { revised, approved: false, questFailed: false }
  const result = artifact.log.find(
    (event) =>
      event.type === 'questResult'
      && (event.payload as Record<string, unknown>).round === proposal.round,
  )
  return {
    revised,
    approved: true,
    questFailed:
      (result?.payload as Record<string, unknown> | undefined)?.result
        === 'fail',
  }
}

interface ProposalTrace {
  readonly trace: DecisionTrace
  /** Absent for arms whose scorer records no candidate surface. */
  readonly scores?: readonly CandidateScore[]
  readonly team: readonly number[]
  readonly round: number
  readonly proposalNum: number
}

function proposalTraces(
  artifact: GameArtifact,
  targetSeat: number,
): readonly ProposalTrace[] {
  const rows: ProposalTrace[] = []
  for (const trace of artifact.decisionTraces ?? []) {
    if (trace.viewerSeat !== targetSeat) continue
    if (trace.request.kind !== 'propose') continue
    if (trace.action.kind !== 'propose') continue
    rows.push({
      trace,
      // The matched pairing needs only the position and the action, so a
      // scoreless arm still pairs; only the surface columns need the scores.
      ...(trace.candidateScores?.length
        ? { scores: trace.candidateScores }
        : {}),
      team: trace.action.team,
      round: trace.request.round,
      proposalNum: trace.request.proposalNum,
    })
  }
  return rows
}

function proposalCleanProbability(score: CandidateScore): number | undefined {
  const features = score.features
  return features?.version === GOOD_PROPOSAL_FEATURES
    ? features.cleanProbability
    : undefined
}

function teamOfScore(score: CandidateScore): readonly number[] | undefined {
  const features = score.features
  return features?.version === GOOD_PROPOSAL_FEATURES
    ? features.team
    : undefined
}

function foldSurface(
  cell: MutableCell,
  artifact: GameArtifact,
  row: ProposalTrace,
  evilSeats: ReadonlySet<number>,
): void {
  if (!row.scores) return
  const viable = row.scores.filter((score) => score.viable)
  if (!viable.length) {
    throw new Error(
      `artifact ${artifact.id} scored a proposal with no viable candidate`,
    )
  }
  const chosenId = row.trace.chosenCandidateId
  const ordered = [...viable].sort((left, right) =>
    compareCandidateIds(left.candidateId, right.candidateId))
  const lexRank = ordered.findIndex((score) => score.candidateId === chosenId)
  if (lexRank < 0) {
    throw new Error(
      `artifact ${artifact.id} chose a candidate outside its viable surface`,
    )
  }
  const round = roundSlice(cell, row.round)
  cell.tracedProposals++
  cell.viableTeams += viable.length
  cell.lexRankSum += viable.length > 1 ? lexRank / (viable.length - 1) : 0
  if (lexRank === 0) cell.lexFloorChoices++

  const withFeatures = viable.filter(
    (score) => proposalCleanProbability(score) !== undefined,
  )
  if (!withFeatures.length) return
  if (withFeatures.length !== viable.length) {
    throw new Error(
      `artifact ${artifact.id} recorded partial proposal features`,
    )
  }
  const values = withFeatures.map(
    (score) => proposalCleanProbability(score) as number,
  )
  const max = Math.max(...values)
  const min = Math.min(...values)
  const argmax = withFeatures.filter(
    (score) => proposalCleanProbability(score) === max,
  )
  const canonicalFirst = [...argmax].sort((left, right) =>
    compareCandidateIds(left.candidateId, right.candidateId))[0]
  // The scorer stamps this code on the canonically first tied row only, so a
  // corpus that disagrees with the recomputed argmax is refused rather than
  // averaged into a conclusion about tie-breaking.
  for (const score of withFeatures) {
    const stamped = score.reasonCodes.includes(CANONICAL_TIE_BREAK)
    if (
      stamped
      && (argmax.length < 2 || score.candidateId !== canonicalFirst.candidateId)
    ) {
      throw new Error(
        `artifact ${artifact.id} stamps a tie-break the posterior does not show`,
      )
    }
  }
  const belowMax = values.filter((value) => value < max)
  // The chosen id was found on the viable surface above, and every viable row
  // carries features here, so this lookup cannot miss.
  const chosen = withFeatures.find((score) => score.candidateId === chosenId)!
  const chosenValue = proposalCleanProbability(chosen) as number
  const cleanCount = (scores: readonly CandidateScore[]): number =>
    scores.filter((score) => {
      const team = teamOfScore(score)
      return team !== undefined && teamIsClean(team, evilSeats)
    }).length
  const chosenClean = teamIsClean(row.team, evilSeats)

  cell.scoredProposals++
  cell.argmaxTeams += argmax.length
  round.scoredProposals++
  round.argmaxTeams += argmax.length
  round.viableTeams += withFeatures.length
  if (argmax.some((score) => score.candidateId === chosenId)) {
    cell.chosenInArgmax++
  }
  if (argmax.length > 1) {
    cell.tieDecided++
    round.tieDecided++
    if (chosenClean) cell.tieDecidedClean++
    cell.tieArgmaxCleanFractionSum += cleanCount(argmax) / argmax.length
    cell.tieChosenPosteriorSum += chosenValue
  } else {
    cell.uniqueDecided++
    if (chosenClean) cell.uniqueDecidedClean++
  }
  cell.chosenPosteriorSum += chosenValue
  const viableClean = cleanCount(withFeatures)
  cell.viableCleanFractionSum += viableClean / withFeatures.length
  if (viableClean > 0) cell.cleanTeamAvailable++
  cell.valueSpreadSum += max - min
  cell.decisiveMarginSum += belowMax.length ? max - Math.max(...belowMax) : 0
}

function foldArtifact(cell: MutableCell, artifact: GameArtifact): void {
  const architecture = architectureOf(artifact)
  const targetSeat = architecture.targetSeat
  const targetPlayer = artifact.players.find(
    (player) => player.seat === targetSeat,
  )
  if (!targetPlayer) {
    // Counting the game anyway would report a 0% win rate for a policy that
    // may have won it, which is worse than refusing the artifact.
    throw new Error(
      `artifact ${artifact.id} has no player at target seat ${targetSeat}`,
    )
  }
  const evilSeats = evilSeatsOf(artifact)
  cell.games++
  if (artifact.winner === targetPlayer.alignment) cell.targetWins++

  const seenSizes = new Map<number, Set<string>>()
  for (const proposal of loggedProposals(artifact, targetSeat)) {
    const clean = teamIsClean(proposal.team, evilSeats)
    const resolution = resolutionOf(artifact, proposal)
    const entry = slice(cell, proposal.proposalNum)
    const round = roundSlice(cell, proposal.round)
    cell.proposals++
    entry.proposals++
    round.proposals++
    if (clean) {
      cell.cleanProposals++
      entry.cleanProposals++
      round.cleanProposals++
    }
    if (resolution.revised) cell.revisedAway++
    if (resolution.approved) {
      cell.approved++
      entry.approved++
      if (!clean) {
        cell.approvedDirty++
        entry.approvedDirty++
        if (resolution.questFailed) cell.approvedDirtyFailedQuest++
      }
    }
    if (proposal.team.includes(targetSeat as Seat)) cell.selfIncluded++
    const size = proposal.team.length
    const seen = seenSizes.get(size)
    if (!seen) {
      seenSizes.set(size, new Set([teamKey(proposal.team)]))
    } else {
      cell.sameSizeRepeatPairs++
      if (seen.has(teamKey(proposal.team))) cell.sameSizeRepeats++
      seen.add(teamKey(proposal.team))
    }
  }

  for (const row of proposalTraces(artifact, targetSeat)) {
    foldSurface(cell, artifact, row, evilSeats)
  }
}

interface FirstProposal {
  readonly decisionId: string
  readonly clean: boolean
  readonly teamKey: string
  readonly scores?: readonly CandidateScore[]
}

function firstProposalOf(artifact: GameArtifact): FirstProposal | undefined {
  const architecture = architectureOf(artifact)
  const evilSeats = evilSeatsOf(artifact)
  const row = proposalTraces(artifact, architecture.targetSeat)[0]
  if (!row) return undefined
  return {
    decisionId: row.trace.decisionId,
    clean: teamIsClean(row.team, evilSeats),
    teamKey: teamKey(row.team),
    ...(row.scores ? { scores: row.scores } : {}),
  }
}

/**
 * Score the baseline's team on the candidate arm's own posterior. This is the
 * question a fix depends on: was the baseline's better team already at the top
 * of the value function, or did the value function rank it below?
 */
function foldBaselineTeamOnCandidateSurface(
  row: MutablePairing,
  baseline: FirstProposal,
  candidate: FirstProposal,
): void {
  const scored = (candidate.scores ?? []).filter(
    (score) => proposalCleanProbability(score) !== undefined,
  )
  if (!scored.length) return
  const viable = scored.filter((score) => score.viable)
  if (!viable.length) return
  const max = Math.max(
    ...viable.map((score) => proposalCleanProbability(score) as number),
  )
  const match = scored.find((score) => {
    const team = teamOfScore(score)
    return team !== undefined && teamKey(team) === baseline.teamKey
  })
  row.scoredPairs++
  row.candidateTeamPosteriorSum += max
  if (!match) return
  const value = proposalCleanProbability(match) as number
  row.baselineTeamPosteriorSum += value
  if (!match.viable) return
  row.baselineTeamViable++
  if (value === max) row.baselineTeamInArgmax++
}

interface MutablePairing {
  bank: string
  targetRole: string
  baseline: string
  candidate: string
  cases: number
  pairs: number
  unmatchedPosition: number
  onlyBaseline: number
  onlyCandidate: number
  agreed: number
  baselineClean: number
  candidateClean: number
  baselineCleanCandidateDirty: number
  candidateCleanBaselineDirty: number
  scoredPairs: number
  baselineTeamViable: number
  baselineTeamInArgmax: number
  baselineTeamPosteriorSum: number
  candidateTeamPosteriorSum: number
}

function pairFirstProposals(
  artifacts: readonly GameArtifact[],
  options: ProposalValueDiagnosisOptions,
): readonly FirstProposalPairing[] {
  const groups = new Map<string, {
    bank: string
    targetRole: string
    order: string[]
    byVariant: Map<string, Map<string, GameArtifact>>
  }>()
  for (const artifact of artifacts) {
    const architecture = architectureOf(artifact)
    const key = `${architecture.bank}\0${architecture.targetRole}`
    let group = groups.get(key)
    if (!group) {
      group = {
        bank: architecture.bank,
        targetRole: architecture.targetRole,
        order: [],
        byVariant: new Map(),
      }
      groups.set(key, group)
    }
    let cases = group.byVariant.get(architecture.variant)
    if (!cases) {
      cases = new Map()
      group.byVariant.set(architecture.variant, cases)
      group.order.push(architecture.variant)
    }
    if (cases.has(architecture.caseId)) {
      throw new Error(
        `duplicate case ${architecture.caseId} for variant `
        + `${architecture.variant} in bank ${architecture.bank}`,
      )
    }
    cases.set(architecture.caseId, artifact)
  }

  const pairings: FirstProposalPairing[] = []
  for (const group of groups.values()) {
    const baselineId = options.baselineVariant ?? group.order[0]
    const baselineCases = group.byVariant.get(baselineId)
    if (!baselineCases) continue
    for (const variant of group.order) {
      if (variant === baselineId) continue
      const candidateCases = group.byVariant.get(variant)!
      const row: MutablePairing = {
        bank: group.bank,
        targetRole: group.targetRole,
        baseline: baselineId,
        candidate: variant,
        cases: 0,
        pairs: 0,
        unmatchedPosition: 0,
        onlyBaseline: 0,
        onlyCandidate: 0,
        agreed: 0,
        baselineClean: 0,
        candidateClean: 0,
        baselineCleanCandidateDirty: 0,
        candidateCleanBaselineDirty: 0,
        scoredPairs: 0,
        baselineTeamViable: 0,
        baselineTeamInArgmax: 0,
        baselineTeamPosteriorSum: 0,
        candidateTeamPosteriorSum: 0,
      }
      for (const [caseId, baselineArtifact] of baselineCases) {
        const candidateArtifact = candidateCases.get(caseId)
        if (!candidateArtifact) continue
        row.cases++
        const left = firstProposalOf(baselineArtifact)
        const right = firstProposalOf(candidateArtifact)
        if (!left && !right) continue
        if (!right) {
          row.onlyBaseline++
          continue
        }
        if (!left) {
          row.onlyCandidate++
          continue
        }
        if (left.decisionId !== right.decisionId) {
          // Different positions mean different game states, so the pair is not
          // matched and must not be folded into a delta.
          row.unmatchedPosition++
          continue
        }
        row.pairs++
        if (left.teamKey === right.teamKey) row.agreed++
        if (left.clean) row.baselineClean++
        if (right.clean) row.candidateClean++
        if (left.clean && !right.clean) row.baselineCleanCandidateDirty++
        if (right.clean && !left.clean) row.candidateCleanBaselineDirty++
        foldBaselineTeamOnCandidateSurface(row, left, right)
      }
      pairings.push(Object.freeze(row))
    }
  }
  return pairings
}

export function diagnoseProposalValue(
  artifacts: readonly GameArtifact[],
  options: ProposalValueDiagnosisOptions = {},
): ProposalValueDiagnosis {
  const cells = new Map<string, MutableCell>()
  for (const artifact of artifacts) {
    const architecture = architectureOf(artifact)
    const key = [
      architecture.bank,
      architecture.targetRole,
      architecture.variant,
    ].join('\0')
    let cell = cells.get(key)
    if (!cell) {
      cell = emptyCell(architecture)
      cells.set(key, cell)
    }
    foldArtifact(cell, artifact)
  }
  return {
    version: PROPOSAL_VALUE_DIAGNOSIS_VERSION,
    cells: [...cells.values()].map((cell) => Object.freeze({
      ...cell,
      byProposalNum: Object.freeze(
        [...cell.byProposalNum.entries()]
          .sort(([left], [right]) => left - right)
          .map(([proposalNum, entry]) =>
            Object.freeze({ proposalNum, ...entry })),
      ),
      byRound: Object.freeze(
        [...cell.byRound.entries()]
          .sort(([left], [right]) => left - right)
          .map(([round, entry]) => Object.freeze({ round, ...entry })),
      ),
    })),
    pairings: pairFirstProposals(artifacts, options),
  }
}

const pct = (numerator: number, denominator: number): string =>
  denominator === 0
    ? '    n/a'
    : `${(100 * numerator / denominator).toFixed(1)}%`.padStart(7)

const per = (numerator: number, denominator: number): string =>
  denominator === 0
    ? '  n/a'
    : (numerator / denominator).toFixed(2).padStart(5)

const label = (cell: ProposalValueCell): string =>
  `  ${cell.targetRole.padEnd(9)} ${cell.variant.padEnd(21)}`

export function renderProposalValueDiagnosis(
  diagnosis: ProposalValueDiagnosis,
): string {
  const lines: string[] = []
  const banks = [...new Set(diagnosis.cells.map((cell) => cell.bank))].sort()
  for (const bank of banks) {
    const cells = diagnosis.cells.filter((row) => row.bank === bank)
    lines.push('', `bank ${bank}`)

    lines.push(
      '',
      '  value structure: how much the posterior discriminates. viable = legal',
      '  teams scored; argmax = teams sharing the top value; tie = decisions',
      '  whose argmax holds more than one team, so the canonical candidate-id',
      '  order picks; margin = gap from the top value to the next distinct one,',
      '  which separates the argmax set but never its members; lex = normalized',
      '  candidate-id rank of the chosen team; floor = took the canonically',
      '  first viable team, which any observer reproducing the removals sees',
      '  coming.',
      '  role      variant                props  viable  argmax     tie '
      + ' margin     lex   floor',
    )
    for (const cell of cells) {
      lines.push(
        `${label(cell)}${String(cell.proposals).padStart(6)}`
        + ` ${per(cell.viableTeams, cell.tracedProposals)}`
        + `  ${per(cell.argmaxTeams, cell.scoredProposals)}`
        + ` ${pct(cell.tieDecided, cell.scoredProposals)}`
        + ` ${per(cell.decisiveMarginSum, cell.scoredProposals)}`
        + ` ${per(cell.lexRankSum, cell.tracedProposals)}`
        + ` ${pct(cell.lexFloorChoices, cell.tracedProposals)}`,
      )
    }

    lines.push(
      '',
      '  realized cleanliness against its own nulls. base = clean share of the',
      '  whole legal surface; post = posterior clean probability the scorer',
      '  believed; on tie-decided decisions only, flip = clean share of the',
      '  argmax set (what a coin flip among tied teams would score) and',
      '  tieClean = what the canonical order actually scored.',
      '  role      variant                props   clean    base    post '
      + '    flip tieClean uniqClean',
    )
    for (const cell of cells) {
      lines.push(
        `${label(cell)}${String(cell.proposals).padStart(6)}`
        + ` ${pct(cell.cleanProposals, cell.proposals)}`
        + ` ${pct(cell.viableCleanFractionSum, cell.scoredProposals)}`
        + ` ${pct(cell.chosenPosteriorSum, cell.scoredProposals)}`
        + ` ${pct(cell.tieChosenPosteriorSum, cell.tieDecided)}`
        + ` ${pct(cell.tieArgmaxCleanFractionSum, cell.tieDecided)}`
        + ` ${pct(cell.tieDecidedClean, cell.tieDecided)}`
        + ` ${pct(cell.uniqueDecidedClean, cell.uniqueDecided)}`,
      )
    }

    lines.push(
      '',
      '  what the proposal cost. appr = target proposals that reached a vote',
      '  unrevised and passed; apprDirty = of all target proposals, those that',
      '  were dirty and approved; dirtyFail = of those, the ones whose quest',
      '  failed; rpt = repeated an earlier same-size team in the same game.',
      '  role      variant                 win   props    appr apprDirty '
      + 'dirtyFail     rpt  revised',
    )
    for (const cell of cells) {
      lines.push(
        `${label(cell)}${pct(cell.targetWins, cell.games)}`
        + `${String(cell.proposals).padStart(7)}`
        + ` ${pct(cell.approved, cell.proposals)}`
        + ` ${pct(cell.approvedDirty, cell.proposals)}`
        + ` ${pct(cell.approvedDirtyFailedQuest, cell.approvedDirty)}`
        + ` ${pct(cell.sameSizeRepeats, cell.sameSizeRepeatPairs)}`
        + `${String(cell.revisedAway).padStart(9)}`,
      )
    }

    lines.push(
      '',
      '  by proposal number: proposals / clean rate / approved dirty',
    )
    for (const cell of cells) {
      const slices = cell.byProposalNum
        .map((entry) =>
          `p${entry.proposalNum} ${entry.proposals}/`
          + `${pct(entry.cleanProposals, entry.proposals).trim()}/`
          + `${entry.approvedDirty}`)
        .join('  ')
      lines.push(`  ${label(cell).trim().padEnd(31)}${slices}`)
    }

    lines.push(
      '',
      '  by round: proposals / clean rate / tied share of the scored surface.',
      '  Hard constraints arrive only with quest results, so this is where the',
      '  posterior can sharpen at all, and the share removes team-size drift.',
    )
    for (const cell of cells) {
      const slices = cell.byRound
        .map((entry) =>
          `q${entry.round} ${entry.proposals}/`
          + `${pct(entry.cleanProposals, entry.proposals).trim()}/`
          + `${pct(entry.argmaxTeams, entry.viableTeams).trim()}`)
        .join('  ')
      lines.push(`  ${label(cell).trim().padEnd(31)}${slices}`)
    }
  }
  if (diagnosis.pairings.length) {
    lines.push(
      '',
      'matched first target proposal (identical prefix, so an exact pair)',
      '  role      candidate               pairs  agreed  baseClean  candClean'
      + '  base>cand  cand>base  unmatched',
    )
    for (const pairing of diagnosis.pairings) {
      lines.push(
        `  ${pairing.targetRole.padEnd(9)} ${pairing.candidate.padEnd(21)}`
        + `${String(pairing.pairs).padStart(6)}`
        + ` ${pct(pairing.agreed, pairing.pairs)}`
        + ` ${pct(pairing.baselineClean, pairing.pairs)}`
        + ` ${pct(pairing.candidateClean, pairing.pairs)}`
        + `${String(pairing.baselineCleanCandidateDirty).padStart(11)}`
        + `${String(pairing.candidateCleanBaselineDirty).padStart(11)}`
        + `${String(pairing.unmatchedPosition).padStart(11)}`,
      )
    }
    lines.push(
      '',
      '  the baseline team scored on the candidate posterior. inArgmax = the',
      '  value function already ranked it top, so only the tie-break passed it',
      '  over; basePost and candPost are the two posterior values.',
      '  role      candidate              scored  viable inArgmax basePost'
      + ' candPost',
    )
    for (const pairing of diagnosis.pairings) {
      lines.push(
        `  ${pairing.targetRole.padEnd(9)} ${pairing.candidate.padEnd(21)}`
        + `${String(pairing.scoredPairs).padStart(7)}`
        + ` ${pct(pairing.baselineTeamViable, pairing.scoredPairs)}`
        + ` ${pct(pairing.baselineTeamInArgmax, pairing.scoredPairs)}`
        + ` ${pct(pairing.baselineTeamPosteriorSum, pairing.scoredPairs)}`
        + ` ${pct(pairing.candidateTeamPosteriorSum, pairing.scoredPairs)}`,
      )
    }
  }
  return lines.join('\n')
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      baseline: { type: 'string' },
    },
  })
  if (positionals.length !== 1) {
    throw new Error(
      'usage: node server/eval/proposal-value-diagnosis.ts '
      + '<artifacts.jsonl> [--baseline <variant>] [--json]',
    )
  }
  const diagnosis = diagnoseProposalValue(readArtifacts(positionals[0]), {
    ...(values.baseline ? { baselineVariant: values.baseline } : {}),
  })
  process.stdout.write(
    values.json
      ? `${JSON.stringify(diagnosis, null, 2)}\n`
      : `${renderProposalValueDiagnosis(diagnosis)}\n`,
  )
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
