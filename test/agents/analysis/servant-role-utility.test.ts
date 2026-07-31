// test-lane: contract
// The servant per-candidate propose utility. It exists because 75 of 76
// servant proposals in the phase-4 bank score every viable candidate at
// exactly the same value, leaving a lexicographic sort to pick the team. These
// tests pin the two things that make it worth having: it separates candidates
// the base cannot, and it says nothing when it has nothing to say.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildServantRoleUtilityProjection,
  validateAdmittedServantRoleUtilityHostJoin,
  validateServantRoleUtilityProjection,
  SERVANT_ROLE_UTILITY_PROJECTION_VERSION,
} from '../../../server/agents/analysis/servant-role-utility.ts'
import { legalCandidates } from '../../../server/agents/candidate/candidates.ts'
import { createHeuristicAgent } from '../../../server/agents/heuristic.ts'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../../server/engine/game.ts'
import type { DecisionRequest, PlayerView } from '../../../server/engine/types.ts'
import { viewFor } from '../../../server/engine/view.ts'

/** A servant in the chair, the way the conformance proof finds one. */
function servantPropose(): { view: PlayerView; req: DecisionRequest } {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const game = createGame({
      seed: `servant-utility-${attempt}`,
      playerCount: 7,
    })
    if (game.players[game.leaderSeat].role !== 'servant') continue
    const view = viewFor(game, game.leaderSeat)
    return {
      view,
      req: {
        kind: 'propose',
        seat: view.seat,
        round: view.round,
        proposalNum: view.proposalNum,
      },
    }
  }
  throw new Error('no servant reached the chair within the seed budget')
}

/**
 * The same seat, but after the board has produced evidence.
 *
 * Played forward with heuristic agents rather than hand-built, because the
 * projection reads a PlayerView and the separation it is being tested for
 * comes from real resolved quests rather than from a synthetic record.
 */
async function servantProposeWithEvidence(): Promise<{
  view: PlayerView
  req: DecisionRequest
}> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const game = createGame({
      seed: `servant-evidence-${attempt}`,
      playerCount: 7,
    })
    const agents = game.players.map((player) =>
      createHeuristicAgent({ seed: 'h', seat: player.seat }))
    for (let step = 0; step < 400; step++) {
      const pending = expectedDecisions(game)
      if (pending.length === 0) break
      for (const req of pending) {
        const view = viewFor(game, req.seat)
        if (
          req.kind === 'propose'
          && view.role === 'servant'
          && view.round >= 3
        ) {
          return { view, req }
        }
        applyDecision(
          game,
          req.seat,
          (await agents[req.seat].decide(req, view)).decision,
        )
      }
    }
  }
  throw new Error('no late servant proposal was reachable')
}

const projectionFor = (fixture: ReturnType<typeof servantPropose>) =>
  buildServantRoleUtilityProjection({
    view: fixture.view,
    candidates: legalCandidates(fixture.req, fixture.view),
  })

test('the projection covers every candidate exactly once', () => {
  const fixture = servantPropose()
  const candidates = legalCandidates(fixture.req, fixture.view)
  const projection = projectionFor(fixture)

  assert.equal(projection.version, SERVANT_ROLE_UTILITY_PROJECTION_VERSION)
  assert.equal(projection.seat, fixture.view.seat)
  assert.equal(projection.assessments.length, candidates.length)
  assert.deepEqual(
    [...projection.assessments.map((entry) => entry.candidateId)].sort(),
    [...candidates.map((candidate) => candidate.id)].sort(),
  )
  for (const entry of projection.assessments) {
    assert.equal(entry.kind, 'propose')
    assert.ok(entry.roleValue >= 0 && entry.roleValue <= 1)
  }
})

test('the projection validates and reconstructs from its input', () => {
  const fixture = servantPropose()
  const input = {
    view: fixture.view,
    candidates: legalCandidates(fixture.req, fixture.view),
  }
  const projection = buildServantRoleUtilityProjection(input)
  assert.ok(validateServantRoleUtilityProjection(projection))
  assert.ok(validateAdmittedServantRoleUtilityHostJoin(projection, input))
})

// The honest half. On an opening board no seat has done anything, the public
// read is flat, and every team averages the same. Reporting one value for all
// candidates is correct there: measured on real boards this layer separates 0%
// of round-one proposals and 100% of round-four and round-five ones, which is
// exactly the shape of the evidence available to it.
test('an opening board separates nothing, because nothing has happened', () => {
  const projection = projectionFor(servantPropose())
  const values = new Set(
    projection.assessments.map((entry) => entry.roleValue.toFixed(9)),
  )
  assert.equal(values.size, 1, 'a flat read must not invent a ranking')
})

// The case the module exists for, and the one every other test here misses:
// a board with evidence on it. Round one is flat by construction, so a suite
// built only on fresh games would pass unchanged if separation broke outright.
// Measured over the phase-4 servant bank, this separates 0% of round-one
// proposals and 100% of round-four and round-five ones.
test('a board with evidence on it separates the candidates', async () => {
  const late = await servantProposeWithEvidence()
  const projection = buildServantRoleUtilityProjection({
    view: late.view,
    candidates: legalCandidates(late.req, late.view),
  })
  const values = projection.assessments.map((entry) => entry.roleValue)
  const distinct = new Set(values.map((value) => value.toFixed(9)))
  assert.ok(
    distinct.size > 1,
    `round ${late.view.round} must rank the teams, got one value for all`,
  )
  assert.ok(
    Math.max(...values) - Math.min(...values) > 0.01,
    'the separation must be usable, not a rounding artifact',
  )
  assert.ok(validateServantRoleUtilityProjection(projection))
})

test('a tampered role value is rejected', () => {
  const fixture = servantPropose()
  const input = {
    view: fixture.view,
    candidates: legalCandidates(fixture.req, fixture.view),
  }
  const projection = buildServantRoleUtilityProjection(input)

  const moved = structuredClone(projection)
  moved.assessments[0].roleValue = 1 - moved.assessments[0].roleValue
  // Still structurally valid: only the host join can catch a wrong number,
  // since the schema has no public read to recompute the average against.
  assert.ok(validateServantRoleUtilityProjection(moved))
  assert.equal(validateAdmittedServantRoleUtilityHostJoin(moved, input), false)

  const outOfRange = structuredClone(projection)
  outOfRange.assessments[0].roleValue = 1.5
  assert.equal(validateServantRoleUtilityProjection(outOfRange), false)

  const duplicated = structuredClone(projection)
  duplicated.assessments[1].candidateId = duplicated.assessments[0].candidateId
  assert.equal(validateServantRoleUtilityProjection(duplicated), false)
})
