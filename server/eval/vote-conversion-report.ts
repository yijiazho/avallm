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
import type {
  RateDeltaEstimate,
  RateEstimate,
} from './architecture-report.ts'
import type { Role } from '../engine/types.ts'

export const PHASE5_VOTE_CONVERSION_REPORT_SCHEMA = 1

interface RateCount {
  successes: number
  trials: number
}

export interface VoteConfusion {
  cleanApprovals: number
  cleanRejects: number
  dirtyApprovals: number
  dirtyRejects: number
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
  cleanApprovals: number
  cleanRejects: number
  dirtyApprovals: number
  dirtyRejects: number
}

function rate(successes: number, trials: number): RateEstimate {
  if (!trials) {
    return { successes, trials, rate: null, interval95: null }
  }
  const estimate = successes / trials
  const z = 1.959963984540054
  const z2 = z * z
  const denominator = 1 + z2 / trials
  const center = (estimate + z2 / (2 * trials)) / denominator
  const radius = z * Math.sqrt(
    estimate * (1 - estimate) / trials
    + z2 / (4 * trials * trials),
  ) / denominator
  return {
    successes,
    trials,
    rate: estimate,
    interval95: {
      low: Math.max(0, center - radius),
      high: Math.min(1, center + radius),
    },
  }
}

function nearestRank(
  values: readonly number[],
  probability: number,
): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(
    0,
    Math.ceil(probability * ordered.length) - 1,
  )]
}

function seededState(value: string): number {
  let state = 2166136261
  for (const character of value) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }
  return state >>> 0 || 1
}

/**
 * Deterministic game-paired bootstrap. Count selectors may expose per-game
 * denominators, so quest- and vote-level rates retain deal pairing.
 */
export function pairedConversionRateDelta<T>(
  pairs: readonly Readonly<{ baseline: T; candidate: T }>[],
  select: (value: T) => RateCount,
  seed: string,
): RateDeltaEstimate {
  const aggregate = (
    selected: readonly T[],
  ): RateCount => selected.reduce<RateCount>(
    (total, value) => {
      const count = select(value)
      return {
        successes: total.successes + count.successes,
        trials: total.trials + count.trials,
      }
    },
    { successes: 0, trials: 0 },
  )
  const baseline = aggregate(pairs.map((pair) => pair.baseline))
  const candidate = aggregate(pairs.map((pair) => pair.candidate))
  if (!pairs.length || !baseline.trials || !candidate.trials) {
    return { delta: null, interval95: null }
  }
  const delta =
    candidate.successes / candidate.trials
    - baseline.successes / baseline.trials
  let state = seededState(seed)
  const random = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
  const samples: number[] = []
  for (let repetition = 0; repetition < 5_000; repetition++) {
    const selected: Array<(typeof pairs)[number]> = []
    for (let index = 0; index < pairs.length; index++) {
      selected.push(pairs[Math.floor(random() * pairs.length)])
    }
    const sampledBaseline = aggregate(
      selected.map((pair) => pair.baseline),
    )
    const sampledCandidate = aggregate(
      selected.map((pair) => pair.candidate),
    )
    if (!sampledBaseline.trials || !sampledCandidate.trials) continue
    samples.push(
      sampledCandidate.successes / sampledCandidate.trials
      - sampledBaseline.successes / sampledBaseline.trials,
    )
  }
  return {
    delta,
    interval95: samples.length
      ? {
          low: nearestRank(samples, 0.025)!,
          high: nearestRank(samples, 0.975)!,
        }
      : null,
  }
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
  let cleanApprovals = 0
  let cleanRejects = 0
  let dirtyApprovals = 0
  let dirtyRejects = 0
  for (const event of artifact.log) {
    if (event.visibility !== 'public') continue
    const payload = event.payload
    if (event.type === 'questResult') {
      resolvedQuests++
      if (payload.result === 'success') successfulQuests++
    } else if (event.type === 'assassination') {
      reachedAssassination++
      if (payload.wasMerlin === false) survivedAssassination++
    } else if (event.type === 'voteReveal') {
      const targetVote = (
        payload.votes as Array<{ seat: number; vote: string }>
      ).find((vote) => vote.seat === meta.targetSeat)
      if (!targetVote) continue
      const team = payload.team as number[]
      if (team.some((seat) => artifact.players[seat] === undefined)) {
        throw new Error(`${artifact.id}: vote team contains an unknown seat`)
      }
      const dirty = team.some(
        (seat) => artifact.players[seat].alignment === 'evil',
      )
      if (dirty) {
        if (targetVote.vote === 'approve') dirtyApprovals++
        else if (targetVote.vote === 'reject') dirtyRejects++
      } else {
        if (targetVote.vote === 'approve') cleanApprovals++
        else if (targetVote.vote === 'reject') cleanRejects++
      }
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
    cleanApprovals,
    cleanRejects,
    dirtyApprovals,
    dirtyRejects,
  }
}

function sum(
  games: readonly ConversionObservation[],
  select: (game: ConversionObservation) => number,
): number {
  return games.reduce((total, game) => total + select(game), 0)
}

function summarize(
  games: readonly ConversionObservation[],
): ConversionSlice {
  const resolvedQuests = sum(games, (game) => game.resolvedQuests)
  const successfulQuests = sum(games, (game) => game.successfulQuests)
  const reachedAssassination = sum(
    games,
    (game) => game.reachedAssassination,
  )
  const survivedAssassination = sum(
    games,
    (game) => game.survivedAssassination,
  )
  const wins = sum(games, (game) => game.won)
  const cleanApprovals = sum(games, (game) => game.cleanApprovals)
  const cleanRejects = sum(games, (game) => game.cleanRejects)
  const dirtyApprovals = sum(games, (game) => game.dirtyApprovals)
  const dirtyRejects = sum(games, (game) => game.dirtyRejects)
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
      cleanApprovals,
      cleanRejects,
      dirtyApprovals,
      dirtyRejects,
      cleanRejectRate: rate(
        cleanRejects,
        cleanApprovals + cleanRejects,
      ),
      dirtyApproveRate: rate(
        dirtyApprovals,
        dirtyApprovals + dirtyRejects,
      ),
      truthAccuracy: rate(
        cleanApprovals + dirtyRejects,
        cleanApprovals + cleanRejects + dirtyApprovals + dirtyRejects,
      ),
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
  ) => pairedConversionRateDelta(
    pairs,
    select,
    `${bank}:${baselineId}:${candidateId}:${name}`,
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
    cleanRejectRateDelta: delta('clean-reject', (game) => ({
      successes: game.cleanRejects,
      trials: game.cleanApprovals + game.cleanRejects,
    })),
    dirtyApproveRateDelta: delta('dirty-approve', (game) => ({
      successes: game.dirtyApprovals,
      trials: game.dirtyApprovals + game.dirtyRejects,
    })),
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

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`
const renderRate = (value: RateEstimate): string =>
  value.rate === null
    ? `n/a (${value.successes}/${value.trials})`
    : `${percent(value.rate)} (${value.successes}/${value.trials})`
const renderDelta = (value: RateDeltaEstimate): string =>
  value.delta === null || !value.interval95
    ? 'n/a'
    : `${value.delta >= 0 ? '+' : ''}${percent(value.delta)} `
      + `(95% ${percent(value.interval95.low)} to `
      + `${percent(value.interval95.high)})`

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
