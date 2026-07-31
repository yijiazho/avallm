// Repeatable, API-free cognition-cost benchmark.
//
// It answers the two Phase 3B/3C caching follow-ups with numbers rather than
// intuition: how much wall clock does the heuristic's reconstruct-per-decision
// cognition path actually cost across a population larger than the ten-game
// architecture bank, and how much does the composed agent's compatibility call
// add on top of the cognition that agent already advanced for the same view.
//
// Nothing here changes a decision. The corpus is collected by running normal
// heuristic games and recording the exact (request, view) pairs each deciding
// seat faced; every timed path then replays those recorded inputs.
//
// Methodology. `exactBelief` keeps a bounded 32-entry deal cache, so the first
// decision a seat makes in a game pays a full canonical world enumeration and
// every later one does not. Timing each path in its own sweep therefore makes
// each sweep re-pay those first touches, and that variance is large enough to
// report a nested call as costing more than the call containing it. So one
// interleaved sweep measures every path per decision instead: an untimed call
// first brings that view's deal key into cache, then the paths are timed
// against identical warmth. First-touch cost is reported separately rather
// than smeared across the comparisons, and repeated sweeps report the minimum,
// which is the least noise-contaminated estimator for elapsed time.

import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createGame } from '../../engine/game.ts'
import { MAX_PLAYERS, MIN_PLAYERS } from '../../engine/rules.ts'
import { runGame } from '../../sim/runner.ts'
import { heuristicDecide } from '../../agents/heuristic.ts'
import { createComposedAgent } from '../../agents/composed.ts'
import {
  advanceCognition,
  reconstructCognition,
} from '../../agents/cognition/state.ts'
import { exactBelief, visibleEventCursor } from '../../agents/belief/exact.ts'
import type { CognitionState } from '../../agents/cognition/types.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import type { AvalonAgent } from '../../agents/types.ts'
import { summarizeWarmTimings } from './belief-performance.ts'
import { sumOf } from '../core/statistics.ts'

export const COGNITION_PERFORMANCE_BENCHMARK =
  'cognition-reconstruct-cost-v1'

/** Default population: five games at each supported player count. */
export const DEFAULT_GAMES_PER_PLAYER_COUNT = 5

export interface DecisionSample {
  readonly gameId: string
  readonly seat: Seat
  readonly seed: string
  readonly req: DecisionRequest
  readonly view: PlayerView
}

export interface PathTiming {
  readonly calls: number
  /** Minimum elapsed milliseconds across the measured sweeps. */
  readonly totalMs: number
  readonly meanMs: number
  readonly medianMs: number
  readonly p95Ms: number
}

export interface HeuristicPathResult {
  readonly decisions: number
  readonly games: number
  /**
   * Distinct (game, seat, visible cursor) keys in the corpus. A per-view cache
   * can only ever hit on a decision whose key repeats, so this number decides
   * whether caching this path is possible at all.
   */
  readonly distinctViewKeys: number
  /** One complete `heuristicDecide` per recorded decision. */
  readonly decide: PathTiming
  /** The `reconstructCognition` call inside each of those decisions. */
  readonly reconstruct: PathTiming
  /** The exact-belief inference inside each reconstruct. */
  readonly belief: PathTiming
  /** Per seat, `advanceCognition` chained from the previous decision's state. */
  readonly incremental: PathTiming
  /**
   * Cognition for the first decision a seat makes in a game, which is the only
   * one that pays a cold canonical world enumeration.
   */
  readonly coldFirstTouch: PathTiming
}

export interface ComposedPathResult {
  readonly decisions: number
  readonly games: number
  /** One complete composed `decide` per decision, end to end. */
  readonly decide: PathTiming
  /**
   * `decide` minus the duplicate-cognition probe below. The probe runs inside
   * the timed call, so this is what an uninstrumented composed decision costs
   * and it is the honest denominator for the probe's share.
   */
  readonly decideExcludingProbeMs: number
  /** The compatibility policy call inside those decisions. */
  readonly compatibility: PathTiming
  /**
   * The cognition the compatibility call rebuilds, timed immediately after it
   * against the same warm cache. This is the work the composed agent already
   * did for the same seat and cursor, so it is the exact saving a cache on
   * this path could return.
   */
  readonly duplicateCognition: PathTiming
}

export interface CognitionPerformanceResult {
  readonly benchmark: typeof COGNITION_PERFORMANCE_BENCHMARK
  readonly node: string
  readonly gamesPerPlayerCount: number
  readonly sweeps: number
  readonly heuristic: HeuristicPathResult
  readonly composed: ComposedPathResult
}

class Samples {
  readonly #values: number[] = []

  time<T>(action: () => T): T {
    const started = performance.now()
    try {
      return action()
    } finally {
      this.#values.push(performance.now() - started)
    }
  }

  /** Awaited separately: a synchronous stop clocks the promise, not the work. */
  async timeAwaited<T>(action: () => Promise<T>): Promise<T> {
    const started = performance.now()
    try {
      return await action()
    } finally {
      this.#values.push(performance.now() - started)
    }
  }

  record(milliseconds: number): void {
    this.#values.push(milliseconds)
  }

  summarize(): PathTiming {
    const warm = summarizeWarmTimings(this.#values)
    const totalMs = sumOf(this.#values, (value) => value)
    return {
      calls: this.#values.length,
      totalMs,
      meanMs: totalMs / this.#values.length,
      medianMs: warm.medianMs,
      p95Ms: warm.p95Ms,
    }
  }
}

function bestOf(sweeps: readonly PathTiming[]): PathTiming {
  if (!sweeps.length) throw new Error('timing needs at least one sweep')
  return sweeps.reduce((best, sweep) =>
    sweep.totalMs < best.totalMs ? sweep : best)
}

function validSweeps(sweeps: number): number {
  if (!Number.isInteger(sweeps) || sweeps < 1) {
    throw new Error('sweeps must be a positive integer')
  }
  return sweeps
}

export function benchmarkSeeds(gamesPerPlayerCount: number): {
  playerCount: number
  seed: string
}[] {
  if (!Number.isInteger(gamesPerPlayerCount) || gamesPerPlayerCount < 1) {
    throw new Error('games per player count must be a positive integer')
  }
  const cases: { playerCount: number; seed: string }[] = []
  for (
    let playerCount = MIN_PLAYERS;
    playerCount <= MAX_PLAYERS;
    playerCount++
  ) {
    for (let index = 0; index < gamesPerPlayerCount; index++) {
      cases.push({
        playerCount,
        seed: `cognition-performance-${playerCount}-${index}`,
      })
    }
  }
  return cases
}

/** Record every decision a normal heuristic table actually faces. */
export async function collectHeuristicCorpus(
  gamesPerPlayerCount = DEFAULT_GAMES_PER_PLAYER_COUNT,
): Promise<DecisionSample[]> {
  const corpus: DecisionSample[] = []
  for (const { playerCount, seed } of benchmarkSeeds(gamesPerPlayerCount)) {
    const game = createGame({ seed, playerCount })
    const agents = new Map<Seat, AvalonAgent>()
    for (const player of game.players) {
      agents.set(player.seat, {
        decide: async (req: DecisionRequest, view: PlayerView) => {
          corpus.push({
            gameId: game.id,
            seat: req.seat,
            seed: game.seed,
            req: structuredClone(req),
            view: structuredClone(view),
          })
          return { decision: heuristicDecide(req, view, game.seed) }
        },
      })
    }
    await runGame({ game, agents })
  }
  return corpus
}

/**
 * The key a per-view cognition cache would use. Cognition is a pure function
 * of the seat-filtered view, so two decisions can share a cached state only
 * when they share a seat and a visible-event cursor.
 */
export function countDistinctViewKeys(
  corpus: readonly DecisionSample[],
): number {
  return new Set(corpus.map((sample) =>
    `${sample.gameId}:${sample.seat}:${visibleEventCursor(sample.view)}`)).size
}

interface HeuristicSweep {
  readonly decide: PathTiming
  readonly reconstruct: PathTiming
  readonly belief: PathTiming
  readonly incremental: PathTiming
  readonly coldFirstTouch: PathTiming
}

function heuristicSweep(corpus: readonly DecisionSample[]): HeuristicSweep {
  const decide = new Samples()
  const reconstruct = new Samples()
  const belief = new Samples()
  const incremental = new Samples()
  const coldFirstTouch = new Samples()
  const carried = new Map<string, CognitionState>()
  const touched = new Set<string>()
  for (const sample of corpus) {
    const dealKey = `${sample.gameId}:${sample.seat}`
    // Untimed except on a seat's first decision, where it is the only cold
    // enumeration the deal cache will make for that seat.
    const started = performance.now()
    reconstructCognition(sample.view)
    const firstTouchMs = performance.now() - started
    if (!touched.has(dealKey)) {
      touched.add(dealKey)
      coldFirstTouch.record(firstTouchMs)
    }
    decide.time(() => heuristicDecide(sample.req, sample.view, sample.seed))
    reconstruct.time(() => reconstructCognition(sample.view))
    belief.time(() => exactBelief(sample.view))
    carried.set(
      dealKey,
      incremental.time(() =>
        advanceCognition(carried.get(dealKey), sample.view)),
    )
  }
  return {
    decide: decide.summarize(),
    reconstruct: reconstruct.summarize(),
    belief: belief.summarize(),
    incremental: incremental.summarize(),
    coldFirstTouch: coldFirstTouch.summarize(),
  }
}

export function measureHeuristicPath(
  corpus: readonly DecisionSample[],
  sweeps = 1,
): HeuristicPathResult {
  if (!corpus.length) throw new Error('heuristic corpus must not be empty')
  const measured = Array.from(
    { length: validSweeps(sweeps) },
    () => heuristicSweep(corpus),
  )
  return {
    decisions: corpus.length,
    games: new Set(corpus.map((sample) => sample.gameId)).size,
    distinctViewKeys: countDistinctViewKeys(corpus),
    decide: bestOf(measured.map((sweep) => sweep.decide)),
    reconstruct: bestOf(measured.map((sweep) => sweep.reconstruct)),
    belief: bestOf(measured.map((sweep) => sweep.belief)),
    incremental: bestOf(measured.map((sweep) => sweep.incremental)),
    coldFirstTouch: bestOf(measured.map((sweep) => sweep.coldFirstTouch)),
  }
}

interface ComposedSweep {
  readonly games: number
  readonly decide: PathTiming
  readonly compatibility: PathTiming
  readonly duplicateCognition: PathTiming
}

async function composedSweep(
  gamesPerPlayerCount: number,
): Promise<ComposedSweep> {
  const decide = new Samples()
  const compatibility = new Samples()
  const duplicateCognition = new Samples()
  let games = 0
  for (const { playerCount, seed } of benchmarkSeeds(gamesPerPlayerCount)) {
    const game = createGame({ seed, playerCount })
    const agents = new Map<Seat, AvalonAgent>()
    for (const player of game.players) {
      // The timing wrapper calls the same compatibility policy the default
      // constructor would, so the decisions are byte-identical to an
      // uninstrumented run.
      const composed = createComposedAgent({
        seed: game.seed,
        compatibilityDecision: (
          req: DecisionRequest,
          view: PlayerView,
          compatibilitySeed: string,
        ): Decision => {
          const decision = compatibility.time(() =>
            heuristicDecide(req, view, compatibilitySeed))
          // The compatibility call just reconstructed this exact cognition,
          // and the composed agent advanced it before that, so this timing is
          // the marginal cost of the duplicate rather than a cold enumeration.
          duplicateCognition.time(() => reconstructCognition(view))
          return decision
        },
      })
      agents.set(player.seat, {
        decide: (req: DecisionRequest, view: PlayerView) =>
          decide.timeAwaited(() => composed.decide(req, view)),
      })
    }
    await runGame({ game, agents })
    games++
  }
  return {
    games,
    decide: decide.summarize(),
    compatibility: compatibility.summarize(),
    duplicateCognition: duplicateCognition.summarize(),
  }
}

/**
 * Run the opt-in composed constructor over the same population and split its
 * decision cost into the whole call, the compatibility policy inside it, and
 * the cognition that compatibility policy rebuilds from scratch.
 */
export async function measureComposedPath(
  gamesPerPlayerCount = DEFAULT_GAMES_PER_PLAYER_COUNT,
  sweeps = 1,
): Promise<ComposedPathResult> {
  const measured: ComposedSweep[] = []
  for (let index = 0; index < validSweeps(sweeps); index++) {
    measured.push(await composedSweep(gamesPerPlayerCount))
  }
  // The whole sweep is the unit here: `decide` and its probe must come from
  // the same run or the subtraction below would mix two populations.
  const best = measured.reduce((winner, sweep) =>
    sweep.decide.totalMs < winner.decide.totalMs ? sweep : winner)
  return {
    decisions: best.decide.calls,
    games: best.games,
    decide: best.decide,
    decideExcludingProbeMs:
      best.decide.totalMs - best.duplicateCognition.totalMs,
    compatibility: best.compatibility,
    duplicateCognition: best.duplicateCognition,
  }
}

export async function runCognitionPerformance(
  gamesPerPlayerCount = DEFAULT_GAMES_PER_PLAYER_COUNT,
  sweeps = 1,
): Promise<CognitionPerformanceResult> {
  const corpus = await collectHeuristicCorpus(gamesPerPlayerCount)
  return {
    benchmark: COGNITION_PERFORMANCE_BENCHMARK,
    node: process.version,
    gamesPerPlayerCount,
    sweeps: validSweeps(sweeps),
    heuristic: measureHeuristicPath(corpus, sweeps),
    composed: await measureComposedPath(gamesPerPlayerCount, sweeps),
  }
}

function formatTiming(label: string, timing: PathTiming): string {
  return `  ${label.padEnd(20)} ${String(timing.calls).padStart(5)} calls`
    + ` | total ${timing.totalMs.toFixed(1).padStart(9)} ms`
    + ` | mean ${timing.meanMs.toFixed(4).padStart(8)} ms`
    + ` | median ${timing.medianMs.toFixed(4).padStart(8)} ms`
    + ` | p95 ${timing.p95Ms.toFixed(4).padStart(8)} ms`
}

function share(part: PathTiming, whole: PathTiming): string {
  return `${((part.totalMs / whole.totalMs) * 100).toFixed(1)}%`
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      games: { type: 'string', default: String(DEFAULT_GAMES_PER_PLAYER_COUNT) },
      sweeps: { type: 'string', default: '1' },
      json: { type: 'boolean', default: false },
    },
  })
  const result = await runCognitionPerformance(
    Number(values.games),
    Number(values.sweeps),
  )
  if (values.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(
    `${result.benchmark} (${result.node}, `
    + `${result.gamesPerPlayerCount} games per player count, `
    + `best of ${result.sweeps})`,
  )
  console.log(
    `heuristic path: ${result.heuristic.games} games, `
    + `${result.heuristic.decisions} decisions, `
    + `${result.heuristic.distinctViewKeys} distinct view keys`,
  )
  console.log(formatTiming('heuristicDecide', result.heuristic.decide))
  console.log(formatTiming('reconstruct', result.heuristic.reconstruct))
  console.log(formatTiming('exact belief', result.heuristic.belief))
  console.log(formatTiming('incremental advance', result.heuristic.incremental))
  console.log(formatTiming('cold first touch', result.heuristic.coldFirstTouch))
  console.log(
    `  reconstruct is ${share(result.heuristic.reconstruct, result.heuristic.decide)}`
    + ` of the heuristic decision; incrementing keeps `
    + `${share(result.heuristic.incremental, result.heuristic.reconstruct)}`
    + ` of the reconstruct cost`,
  )
  console.log(
    `composed path: ${result.composed.games} games, `
    + `${result.composed.decisions} decisions`,
  )
  console.log(formatTiming('composed decide', result.composed.decide))
  console.log(formatTiming('compatibility', result.composed.compatibility))
  console.log(
    formatTiming('duplicate cognition', result.composed.duplicateCognition),
  )
  const net = result.composed.decideExcludingProbeMs
  console.log(
    `  composed decide without the probe: ${net.toFixed(1)} ms`,
  )
  console.log(
    `  compatibility is `
    + `${((result.composed.compatibility.totalMs / net) * 100).toFixed(1)}%`
    + ` of the composed decision; its duplicate cognition is `
    + `${((result.composed.duplicateCognition.totalMs / net) * 100).toFixed(1)}%`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
