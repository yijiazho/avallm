// Phase 5C conversion diagnostics over completed architecture artifacts.
//
// This module is intentionally post-hoc. It uses the archived full reveal to
// label good-side votes and follows public quest/assassination events through
// the outcome funnel. None of these labels enter a running agent.

import type {
  ArchitectureRunMetadata,
  GameArtifact,
} from './artifact.ts'
import { assertMatchedVariants } from './architecture-report.ts'
import {
  pairedBootstrapRateDelta,
  rate,
  seededRandom,
  sumOf,
} from './statistics.ts'
import type {
  RateCount,
  RateDeltaEstimate,
  RateEstimate,
} from './statistics.ts'
import {
  addVoteConfusion,
  countVoteByDirection,
  emptyVoteConfusion,
  teamIsDirty,
  voteRateCount,
} from './vote-direction.ts'
import type {
  VoteConfusionCounts,
  VoteConfusionRate,
} from './vote-direction.ts'
import { renderDelta, renderRate } from './report-format.ts'
import type { Role } from '../engine/types.ts'

export const PHASE5_VOTE_CONVERSION_REPORT_SCHEMA = 1

export interface VoteConfusion extends VoteConfusionCounts {
  cleanRejectRate: RateEstimate
  dirtyApproveRate: RateEstimate
  truthAccuracy: RateEstimate
}

export interface ConversionFunnel {
  games: number
  resolvedQuests: number
  successfulQuests: number
  reachedAssassination: number
  survivedAssassination: number
  wins: number
  questSuccessRate: RateEstimate
  assassinationReachRate: RateEstimate
  conditionalAssassinationConversion: RateEstimate
  winRate: RateEstimate
}

export interface ConversionSlice {
  games: number
  funnel: ConversionFunnel
  votes: VoteConfusion
  winReasons: Record<string, number>
}

export interface ConversionRoleSlice extends ConversionSlice {
  role: Role
}

export interface ConversionPlayerCountSlice extends ConversionSlice {
  playerCount: number
}

export interface VoteConversionVariant extends ConversionSlice {
  id: string
  components: Record<string, string>
  byRole: ConversionRoleSlice[]
  byPlayerCount: ConversionPlayerCountSlice[]
}

export interface WinReasonTransition {
  from: string
  to: string
  games: number
}

export interface VoteConversionComparison {
  baseline: string
  candidate: string
  matchedCases: number
  winReasonTransitions: WinReasonTransition[]
  questSuccessRateDelta: RateDeltaEstimate
  assassinationReachRateDelta: RateDeltaEstimate
  conditionalAssassinationConversionDelta: RateDeltaEstimate
  targetWinRateDelta: RateDeltaEstimate
  cleanRejectRateDelta: RateDeltaEstimate
  dirtyApproveRateDelta: RateDeltaEstimate
}

export interface VoteConversionReport {
  schema: number
  bank: string
  population: string
  cases: string[]
  variants: VoteConversionVariant[]
  comparisons: VoteConversionComparison[]
}

interface ConversionObservation {
  artifact: GameArtifact
  meta: ArchitectureRunMetadata
  population: string
  resolvedQuests: number
  successfulQuests: number
  reachedAssassination: number
  survivedAssassination: number
  won: number
  votes: VoteConfusionCounts
}

const rateOf = (
  counts: VoteConfusionCounts,
  of: VoteConfusionRate,
): RateEstimate => {
  const { successes, trials } = voteRateCount(counts, of)
  return rate(successes, trials)
}

function observe(artifact: GameArtifact): ConversionObservation {
  const meta = artifact.architecture
  if (!meta) {
    throw new Error(`artifact ${artifact.id} has no architecture metadata`)
  }
  const target = artifact.players[meta.targetSeat]
  if (
    !target
    || target.role !== meta.targetRole
    || target.alignment !== 'good'
  ) {
    throw new Error(
      `${artifact.id}: Phase 5C requires the declared good-side target`,
    )
  }
  let resolvedQuests = 0
  let successfulQuests = 0
  let reachedAssassination = 0
  let survivedAssassination = 0
  const votes = emptyVoteConfusion()
  for (const event of artifact.log) {
    if (event.visibility !== 'public') continue
    if (event.type === 'questResult') {
      resolvedQuests++
      if (event.payload.result === 'success') successfulQuests++
    } else if (event.type === 'assassination') {
      reachedAssassination++
      if (event.payload.wasMerlin === false) survivedAssassination++
    } else if (event.type === 'voteReveal') {
      const targetVote = event.payload.votes
        .find((vote) => vote.seat === meta.targetSeat)
      if (!targetVote) continue
      countVoteByDirection(
        votes,
        targetVote.vote,
        teamIsDirty(
          artifact.players,
          event.payload.team,
          artifact.id,
        ),
      )
    }
  }
  if (reachedAssassination > 1 || survivedAssassination > reachedAssassination) {
    throw new Error(`${artifact.id}: invalid assassination funnel`)
  }
  return {
    artifact,
    meta,
    population:
      artifact.tags?.opponentPopulation ?? 'heuristic-opponents',
    resolvedQuests,
    successfulQuests,
    reachedAssassination,
    survivedAssassination,
    won: Number(target.alignment === artifact.winner),
    votes,
  }
}

function summarize(
  games: readonly ConversionObservation[],
): ConversionSlice {
  const resolvedQuests = sumOf(games, (game) => game.resolvedQuests)
  const successfulQuests = sumOf(games, (game) => game.successfulQuests)
  const reachedAssassination = sumOf(
    games,
    (game) => game.reachedAssassination,
  )
  const survivedAssassination = sumOf(
    games,
    (game) => game.survivedAssassination,
  )
  const wins = sumOf(games, (game) => game.won)
  // Not a sum: this folds per-game confusion counts into one record, so it
  // stays a reduce rather than becoming a sumOf.
  const votes = games.reduce(
    (counts, game) => addVoteConfusion(counts, game.votes),
    emptyVoteConfusion(),
  )
  const winReasons: Record<string, number> = {}
  for (const game of games) {
    const reason = game.artifact.winReason
    winReasons[reason] = (winReasons[reason] ?? 0) + 1
  }
  return {
    games: games.length,
    funnel: {
      games: games.length,
      resolvedQuests,
      successfulQuests,
      reachedAssassination,
      survivedAssassination,
      wins,
      questSuccessRate: rate(successfulQuests, resolvedQuests),
      assassinationReachRate: rate(reachedAssassination, games.length),
      conditionalAssassinationConversion: rate(
        survivedAssassination,
        reachedAssassination,
      ),
      winRate: rate(wins, games.length),
    },
    votes: {
      ...votes,
      cleanRejectRate: rateOf(votes, 'clean-team-reject'),
      dirtyApproveRate: rateOf(votes, 'dirty-team-approve'),
      truthAccuracy: rateOf(votes, 'truth'),
    },
    winReasons: Object.fromEntries(
      Object.entries(winReasons).sort(([left], [right]) =>
        left.localeCompare(right)),
    ),
  }
}

function sameComponents(
  games: readonly ConversionObservation[],
): Record<string, string> {
  const first = games[0].meta.components
  for (const game of games.slice(1)) {
    if (JSON.stringify(game.meta.components) !== JSON.stringify(first)) {
      throw new Error(
        `variant ${game.meta.variant} changed component attribution`,
      )
    }
  }
  return { ...first }
}

/**
 * Deal, names, and the opponent cast come from the shared architecture-report
 * law, so this report cannot drift into accepting a pair that one would reject.
 * The opponent population is checked here because only this report splits its
 * corpus by it.
 */
function assertMatched(
  baseline: ConversionObservation,
  candidate: ConversionObservation,
): void {
  assertMatchedVariants(baseline, candidate)
  if (baseline.population !== candidate.population) {
    throw new Error(
      `${candidate.meta.caseId}: Phase 5C variants are not matched`
      + ` on opponent population`,
    )
  }
}

function comparison(
  bank: string,
  baselineId: string,
  candidateId: string,
  baselineGames: readonly ConversionObservation[],
  candidateGames: readonly ConversionObservation[],
): VoteConversionComparison {
  const baselineByCase = new Map(
    baselineGames.map((game) => [game.meta.caseId, game]),
  )
  const pairs = candidateGames.map((candidate) => {
    const baseline = baselineByCase.get(candidate.meta.caseId)
    if (!baseline) {
      throw new Error(
        `${candidate.meta.caseId}: missing Phase 5C baseline`,
      )
    }
    assertMatched(baseline, candidate)
    return { baseline, candidate }
  })
  if (pairs.length !== baselineGames.length) {
    throw new Error(`${candidateId}: incomplete Phase 5C pairing`)
  }
  const transitions = new Map<string, number>()
  for (const pair of pairs) {
    const key =
      `${pair.baseline.artifact.winReason}\0${pair.candidate.artifact.winReason}`
    transitions.set(key, (transitions.get(key) ?? 0) + 1)
  }
  const delta = (
    name: string,
    select: (game: ConversionObservation) => RateCount,
  ) => pairedBootstrapRateDelta(
    pairs,
    select,
    seededRandom(`${bank}:${baselineId}:${candidateId}:${name}`),
  )
  return {
    baseline: baselineId,
    candidate: candidateId,
    matchedCases: pairs.length,
    winReasonTransitions: [...transitions.entries()]
      .map(([key, games]) => {
        const [from, to] = key.split('\0')
        return { from, to, games }
      })
      .sort((left, right) =>
        left.from.localeCompare(right.from)
        || left.to.localeCompare(right.to)),
    questSuccessRateDelta: delta('quest-success', (game) => ({
      successes: game.successfulQuests,
      trials: game.resolvedQuests,
    })),
    assassinationReachRateDelta: delta('assassination-reach', (game) => ({
      successes: game.reachedAssassination,
      trials: 1,
    })),
    conditionalAssassinationConversionDelta: delta(
      'assassination-conversion',
      (game) => ({
        successes: game.survivedAssassination,
        trials: game.reachedAssassination,
      }),
    ),
    targetWinRateDelta: delta('wins', (game) => ({
      successes: game.won,
      trials: 1,
    })),
    cleanRejectRateDelta: delta(
      'clean-reject',
      (game) => voteRateCount(game.votes, 'clean-team-reject'),
    ),
    dirtyApproveRateDelta: delta(
      'dirty-approve',
      (game) => voteRateCount(game.votes, 'dirty-team-approve'),
    ),
  }
}

export function phase5VoteConversionReport(
  artifacts: readonly GameArtifact[],
): VoteConversionReport {
  if (!artifacts.length) {
    throw new Error('Phase 5C report requires at least one artifact')
  }
  const games = artifacts.map(observe)
  const banks = new Set(games.map((game) => game.meta.bank))
  const populations = new Set(games.map((game) => game.population))
  if (banks.size !== 1 || populations.size !== 1) {
    throw new Error('Phase 5C report requires one bank and one population')
  }
  const cells = new Set<string>()
  for (const game of games) {
    const cell = `${game.meta.variant}\0${game.meta.caseId}`
    if (cells.has(cell)) {
      throw new Error(
        `duplicate Phase 5C result for ${game.meta.variant}/${game.meta.caseId}`,
      )
    }
    cells.add(cell)
  }
  const variantIds = [...new Set(games.map((game) => game.meta.variant))]
  const byVariant = new Map(
    variantIds.map((id) => [
      id,
      games.filter((game) => game.meta.variant === id),
    ]),
  )
  const variants = variantIds.map((id): VoteConversionVariant => {
    const selected = byVariant.get(id)!
    const roleIds = [...new Set(
      selected.map((game) => game.meta.targetRole),
    )].sort()
    const playerCounts = [...new Set(
      selected.map((game) => game.artifact.playerCount),
    )].sort((left, right) => left - right)
    return {
      id,
      components: sameComponents(selected),
      ...summarize(selected),
      byRole: roleIds.map((role) => ({
        role,
        ...summarize(
          selected.filter((game) => game.meta.targetRole === role),
        ),
      })),
      byPlayerCount: playerCounts.map((playerCount) => ({
        playerCount,
        ...summarize(
          selected.filter(
            (game) => game.artifact.playerCount === playerCount,
          ),
        ),
      })),
    }
  })
  const baseline = variantIds[0]
  return {
    schema: PHASE5_VOTE_CONVERSION_REPORT_SCHEMA,
    bank: [...banks][0],
    population: [...populations][0],
    cases: [...new Set(games.map((game) => game.meta.caseId))].sort(),
    variants,
    comparisons: variantIds.slice(1).map((candidate) =>
      comparison(
        [...banks][0],
        baseline,
        candidate,
        byVariant.get(baseline)!,
        byVariant.get(candidate)!,
      )),
  }
}

export function renderPhase5VoteConversionReport(
  report: VoteConversionReport,
): string {
  const lines = [
    `PHASE 5C ${report.bank} / ${report.population}`,
  ]
  for (const variant of report.variants) {
    lines.push(
      `${variant.id}: win ${renderRate(variant.funnel.winRate)}, `
      + `quest ${renderRate(variant.funnel.questSuccessRate)}, `
      + `reach assassination ${
        renderRate(variant.funnel.assassinationReachRate)
      }, survive ${
        renderRate(variant.funnel.conditionalAssassinationConversion)
      }`,
      `  votes clean-reject ${
        renderRate(variant.votes.cleanRejectRate)
      }, dirty-approve ${renderRate(variant.votes.dirtyApproveRate)}`,
      `  reasons ${JSON.stringify(variant.winReasons)}`,
    )
    for (const role of variant.byRole) {
      lines.push(
        `  role ${role.role}: win ${renderRate(role.funnel.winRate)}, `
        + `reach ${renderRate(role.funnel.assassinationReachRate)}, `
        + `survive ${
          renderRate(role.funnel.conditionalAssassinationConversion)
        }`,
      )
    }
    for (const count of variant.byPlayerCount) {
      lines.push(
        `  ${count.playerCount}p: win ${renderRate(count.funnel.winRate)}, `
        + `quest ${renderRate(count.funnel.questSuccessRate)}`,
      )
    }
  }
  for (const comparison of report.comparisons) {
    lines.push(
      `${comparison.candidate} - ${comparison.baseline}: `
      + `win ${renderDelta(comparison.targetWinRateDelta)}, `
      + `quest ${renderDelta(comparison.questSuccessRateDelta)}, `
      + `reach ${
        renderDelta(comparison.assassinationReachRateDelta)
      }, survive ${
        renderDelta(comparison.conditionalAssassinationConversionDelta)
      }`,
      `  vote errors clean-reject ${
        renderDelta(comparison.cleanRejectRateDelta)
      }, dirty-approve ${renderDelta(comparison.dirtyApproveRateDelta)}`,
      `  transitions ${comparison.winReasonTransitions.map(
        (transition) =>
          `${transition.from}->${transition.to}:${transition.games}`,
      ).join(', ')}`,
    )
  }
  return lines.join('\n')
}
