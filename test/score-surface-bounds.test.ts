// The byte ceiling on a caller-supplied candidate score surface.
//
// This lives in its own file rather than beside the other scorer tests because
// every one of those files is a pinned legacy strict-typecheck exemption, and
// editing one invalidates its content hash. Freezing them is the point of the
// ratchet, so a new bound gets a new strict-checked file instead.
//
// validateCandidateScores checks in a fixed order: version, then detached
// shape, then this ceiling, then the semantic candidate-surface rules. Only the
// first three are exercised here, so the context below is deliberately minimal:
// nothing past `context.candidates.length` is read on any path these cases take.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_CANDIDATE_SCORE_SURFACE_JSON_BYTES,
  ROLE_OBJECTIVE_SCORER_VERSION,
  validateCandidateScores,
  type CandidateScore,
  type CandidateScoringContext,
} from '../server/agents/policy/score.ts'

/** Reads only `candidates.length`, and only after the ceiling has passed. */
const emptyContext = (): CandidateScoringContext =>
  ({ candidates: [] } as unknown as CandidateScoringContext)

/**
 * Rows built independently on every call. The surface has to survive the
 * detached-shape guard before the ceiling is reached, and that guard rejects
 * the same object appearing twice, so no array or object may be hoisted out of
 * this factory and shared between rows.
 */
function surface(rowCount: number, padding: number): CandidateScore[] {
  return Array.from({ length: rowCount }, (_, index) => ({
    version: 'third-party-scorer-v1',
    candidateId: `candidate-${index}`,
    value: index,
    viable: true,
    reasonCodes: padding > 0 && index === 0
      ? ['PADDED', 'X'.repeat(padding)]
      : ['PLAIN'],
  }))
}

test('the score surface byte ceiling applies to every scorer version', () => {
  // The ceiling used to be gated on six built-in role version strings, which
  // inverted the threat model. validateCandidateScores runs only on custom
  // scorers -- custom-scoring calls it directly, and decision-frame calls it
  // solely under authority 'custom' -- so the versions that skipped the cap
  // were exactly the ones the host does not vouch for. The native score-layer
  // ceiling that would otherwise bound them sits on a path they never take, so
  // a plugin declaring any other version was unbounded.
  const oversized = surface(2, 1_100_000)
  assert.ok(
    Buffer.byteLength(JSON.stringify(oversized), 'utf8')
      > MAX_CANDIDATE_SCORE_SURFACE_JSON_BYTES,
    'the fixture must actually exceed the ceiling',
  )

  // An arbitrary caller-supplied version: the case that used to slip through.
  assert.throws(
    () => validateCandidateScores(
      emptyContext(),
      oversized,
      'third-party-scorer-v1',
    ),
    /exceed 1 MiB/,
  )
  // A built-in role version, which was bounded before and still is.
  assert.throws(
    () => validateCandidateScores(
      emptyContext(),
      oversized,
      ROLE_OBJECTIVE_SCORER_VERSION,
    ),
    /exceed 1 MiB/,
  )
})

test('the ceiling is a size bound and nothing else', () => {
  // A surface under the ceiling must reach the semantic checks rather than be
  // refused for its size, or widening the bound would have quietly become a
  // rejection of every custom scorer.
  const small = surface(2, 0)
  assert.ok(
    Buffer.byteLength(JSON.stringify(small), 'utf8')
      < MAX_CANDIDATE_SCORE_SURFACE_JSON_BYTES,
  )
  assert.throws(
    () => validateCandidateScores(emptyContext(), small, 'third-party-v1'),
    (error: unknown) =>
      error instanceof Error && !/exceed 1 MiB/.test(error.message),
    'a small surface must fail on its contents, never on its size',
  )

  // Order matters: a malformed surface is reported as malformed even when it is
  // also oversized, so the ceiling cannot mask a shape rejection.
  const shared = { reused: true }
  const aliased = surface(2, 1_100_000).map((row) => ({
    ...row,
    features: shared as unknown as CandidateScore['features'],
  }))
  assert.throws(
    () => validateCandidateScores(emptyContext(), aliased, 'third-party-v1'),
    /detached JSON-shaped data/,
  )
})
