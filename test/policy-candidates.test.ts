import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import {
  candidateIdForDecision,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import { LEGAL_CANDIDATE_VERSION } from '../server/agents/policy/types.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import type { DecisionKind } from '../server/engine/types.ts'

test('candidate IDs and order are deterministic and player-name invariant', () => {
  for (const fixture of readDecisionFixtures()) {
    const first = legalCandidates(fixture.req, fixture.view)
    const repeated = legalCandidates(fixture.req, fixture.view)
    const renamed = legalCandidates(fixture.req, {
      ...fixture.view,
      name: 'Renamed self',
      players: fixture.view.players.map((player) => ({
        ...player,
        name: `Renamed ${player.seat}`,
      })),
    })
    assert.deepEqual(repeated, first, fixture.id)
    assert.deepEqual(
      renamed.map((candidate) => candidate.id),
      first.map((candidate) => candidate.id),
      fixture.id,
    )
    assert.ok(first.every(
      (candidate) => candidate.version === LEGAL_CANDIDATE_VERSION,
    ))
    assert.equal(new Set(first.map((candidate) => candidate.id)).size, first.length)
    assert.ok(
      first.some(
        (candidate) =>
          candidate.id === candidateIdForDecision(fixture.baselineDecision),
      ),
      fixture.id,
    )
  }
})

test('candidate generation rejects mismatched seats and decision phases', () => {
  const fixture = readDecisionFixtures()[0]
  assert.throws(
    () => legalCandidates({ ...fixture.req, seat: (fixture.req.seat + 1) % 5 }, fixture.view),
    /does not match view seat/,
  )
  assert.throws(
    () => legalCandidates({ ...fixture.req, kind: 'vote' }, fixture.view),
    /cannot generate vote candidates from proposal view/,
  )
  assert.throws(
    () => legalCandidates({ ...fixture.req, round: fixture.req.round + 1 }, fixture.view),
    /does not match view position/,
  )
  assert.throws(
    () => legalCandidates({
      ...fixture.req,
      proposalNum: fixture.req.proposalNum + 1,
    }, fixture.view),
    /does not match view position/,
  )
})

test('every generated candidate is accepted by the engine across the architecture bank', () => {
  const seen = new Set<DecisionKind>()
  const seenQuestSides = new Set<string>()
  for (const bankCase of ARCHITECTURE_BANK) {
    const game = createGame({
      seed: bankCase.seed,
      playerCount: bankCase.playerCount,
      roles: [...bankCase.roles],
      talk: {
        maxRounds: 1,
        maxRoundsAfterChange: 1,
        leaderInDiscussion: 'last',
      },
    })
    let guard = 0
    while (game.phase !== 'gameOver' && guard++ < 500) {
      const requests = expectedDecisions(game)
      assert.ok(requests.length)
      for (const req of requests) {
        const view = viewFor(game, req.seat)
        const candidates = legalCandidates(req, view)
        seen.add(req.kind)
        if (req.kind === 'quest') seenQuestSides.add(view.alignment)
        for (const candidate of candidates) {
          const clone = structuredClone(game)
          assert.doesNotThrow(
            () => applyDecision(clone, req.seat, candidate.decision),
            `${bankCase.id} ${req.kind} ${candidate.id}`,
          )
        }
        applyDecision(
          game,
          req.seat,
          heuristicDecide(req, view, bankCase.seed),
        )
      }
    }
    assert.equal(game.phase, 'gameOver', bankCase.id)
  }
  assert.deepEqual(
    [...seen].sort(),
    ['assassinate', 'discuss', 'finalize', 'propose', 'quest', 'vote'],
  )
  assert.deepEqual([...seenQuestSides].sort(), ['evil', 'good'])
})

test('policy modules have no raw Game dependency', () => {
  for (const file of [
    'server/agents/policy/candidates.ts',
    'server/agents/policy/forced.ts',
  ]) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /engine\/game/)
    assert.doesNotMatch(source, /type\s+Game(?:\s|,|\})/)
  }
})
