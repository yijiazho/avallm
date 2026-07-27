// Repeatable, API-free Phase 2 performance benchmark.
//
// Measures the exact posterior alone and the complete experimental prompt
// rendering path on representative standard 5- and 10-player opening views.
// The first call is cold for that cast/view key; warm samples reuse the normal
// bounded solver caches. No result is written unless the caller redirects it.

import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createGame } from '../engine/game.ts'
import { viewFor } from '../engine/view.ts'
import { exactBelief } from '../agents/belief/exact.ts'
import { buildMessages } from '../agents/prompts.ts'
import { EXPERIMENTAL_BELIEF_MODE } from '../agents/experimental.ts'

interface Timing {
  coldMs: number
  warmMedianMs: number
  warmP95Ms: number
}

interface CaseResult {
  playerCount: number
  viewerRole: string
  worldCount: number
  promptChars: number
  exactBelief: Timing
  experimentalPrompt: Timing
}

const sortedValues = (values: readonly number[]): number[] => {
  if (!values.length) throw new Error('timing sample must not be empty')
  return [...values].sort((a, b) => a - b)
}

const median = (values: readonly number[]): number => {
  const sorted = sortedValues(values)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

const nearestRankPercentile = (
  values: readonly number[],
  fraction: number,
): number => {
  if (!(fraction > 0 && fraction <= 1)) {
    throw new Error(`percentile fraction must be in (0, 1], got ${fraction}`)
  }
  const sorted = sortedValues(values)
  const index = Math.ceil(sorted.length * fraction) - 1
  return sorted[index]
}

export function summarizeWarmTimings(values: readonly number[]): {
  medianMs: number
  p95Ms: number
} {
  return {
    medianMs: median(values),
    p95Ms: nearestRankPercentile(values, 0.95),
  }
}

function timed(action: () => void, warmIterations: number): Timing {
  const start = performance.now()
  action()
  const coldMs = performance.now() - start
  const warm: number[] = []
  for (let index = 0; index < warmIterations; index++) {
    const before = performance.now()
    action()
    warm.push(performance.now() - before)
  }
  const summary = summarizeWarmTimings(warm)
  return {
    coldMs,
    warmMedianMs: summary.medianMs,
    warmP95Ms: summary.p95Ms,
  }
}

function benchmarkCase(playerCount: 5 | 10, warmIterations: number): CaseResult {
  const game = createGame({
    seed: `phase2-performance-${playerCount}`,
    playerCount,
  })
  const viewer = game.players.find((player) => player.role === 'servant')!
  const view = viewFor(game, viewer.seat)

  let worldCount = 0
  const exact = timed(() => {
    worldCount = exactBelief(view).worlds.length
  }, warmIterations)

  let promptChars = 0
  const prompt = timed(() => {
    promptChars = buildMessages(
      'propose',
      view,
      '',
      {},
      undefined,
      { beliefMode: EXPERIMENTAL_BELIEF_MODE },
    ).reduce((sum, message) => sum + message.content.length, 0)
  }, warmIterations)

  return {
    playerCount,
    viewerRole: viewer.role,
    worldCount,
    promptChars,
    exactBelief: exact,
    experimentalPrompt: prompt,
  }
}

export function runBeliefPerformance(warmIterations = 20): CaseResult[] {
  if (!Number.isInteger(warmIterations) || warmIterations < 1) {
    throw new Error('warm iterations must be a positive integer')
  }
  return [
    benchmarkCase(5, warmIterations),
    benchmarkCase(10, warmIterations),
  ]
}

function formatTiming(timing: Timing): string {
  return `cold ${timing.coldMs.toFixed(3)} ms | warm median `
    + `${timing.warmMedianMs.toFixed(3)} ms | warm p95 ${timing.warmP95Ms.toFixed(3)} ms`
}

function main(): void {
  const { values } = parseArgs({
    options: {
      iterations: { type: 'string', default: '20' },
      json: { type: 'boolean', default: false },
    },
  })
  const results = runBeliefPerformance(Number(values.iterations))
  if (values.json) {
    console.log(JSON.stringify({
      benchmark: 'exact-belief-and-experimental-prompt-v1',
      node: process.version,
      warmIterations: Number(values.iterations),
      results,
    }, null, 2))
    return
  }
  console.log(`exact-belief-and-experimental-prompt-v1 (${process.version}, ${values.iterations} warm runs)`)
  for (const result of results) {
    console.log(
      `${result.playerCount} players, ${result.viewerRole}, ${result.worldCount} worlds, `
      + `${result.promptChars} prompt chars`,
    )
    console.log(`  exact belief:        ${formatTiming(result.exactBelief)}`)
    console.log(`  experimental prompt: ${formatTiming(result.experimentalPrompt)}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
