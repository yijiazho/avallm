// test-lane: perf
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  benchmarkSeeds,
  collectHeuristicCorpus,
  countDistinctViewKeys,
  DEFAULT_GAMES_PER_PLAYER_COUNT,
} from '../server/eval/cognition-performance.ts'
import {
  advanceCognition,
  reconstructCognition,
} from '../server/agents/cognition/state.ts'
import { MAX_PLAYERS, MIN_PLAYERS } from '../server/engine/rules.ts'
import type { CognitionState } from '../server/agents/cognition/types.ts'

test('the cognition benchmark population covers every player count', () => {
  const cases = benchmarkSeeds(DEFAULT_GAMES_PER_PLAYER_COUNT)
  assert.equal(
    cases.length,
    (MAX_PLAYERS - MIN_PLAYERS + 1) * DEFAULT_GAMES_PER_PLAYER_COUNT,
  )
  assert.equal(new Set(cases.map((c) => c.seed)).size, cases.length)
  for (
    let playerCount = MIN_PLAYERS;
    playerCount <= MAX_PLAYERS;
    playerCount++
  ) {
    assert.equal(
      cases.filter((c) => c.playerCount === playerCount).length,
      DEFAULT_GAMES_PER_PLAYER_COUNT,
    )
  }
})

test('the cognition benchmark population rejects a nonpositive size', () => {
  assert.throws(() => benchmarkSeeds(0), /positive integer/)
  assert.throws(() => benchmarkSeeds(1.5), /positive integer/)
})

/**
 * The two laws behind the closed Phase 3B/3C caching follow-ups
 * (docs/agent-architecture-migration.md §16). Both are asserted over one
 * corpus because collecting it is the expensive part.
 *
 * First: a per-view cognition cache cannot hit unless some seat decides twice
 * at the same visible cursor, and no seat ever does, which is why caching the
 * heuristic path returns nothing.
 *
 * Second: chaining `advanceCognition` produces byte-identical state to a fresh
 * `reconstructCognition`. That equality is the precondition for ever handing a
 * composed agent's advanced cognition to the compatibility policy, so it is
 * pinned here rather than left for a future reader to re-derive.
 */
test('cognition caching laws hold across a full heuristic corpus', async () => {
  const corpus = await collectHeuristicCorpus(1)
  assert.ok(corpus.length > 100)
  assert.equal(countDistinctViewKeys(corpus), corpus.length)

  const carried = new Map<string, CognitionState>()
  for (const sample of corpus) {
    const key = `${sample.gameId}:${sample.seat}`
    const advanced = advanceCognition(carried.get(key), sample.view)
    carried.set(key, advanced)
    assert.deepEqual(
      advanced,
      reconstructCognition(sample.view),
      `${key}@${advanced.throughSeq}`,
    )
  }
})
