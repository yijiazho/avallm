// test-lane: contract
import assert from 'node:assert/strict'
import { mutable } from '../support/mutable.ts'
import test from 'node:test'
import { createGame } from '../../server/engine/game.ts'
import { knownEvilOf } from '../../server/engine/knowledge.ts'
import type {
  Game,
} from '../../server/engine/types.ts'
import {
  replayDecisionScenario,
  type LegalReplayStep,
} from '../support/decision-scenario.ts'

function proposalAndApprovalSteps(
  game: Game,
  team: readonly number[] = [0, 1],
): readonly LegalReplayStep[] {
  return [
    {
      request: {
        kind: 'propose',
        seat: game.leaderSeat,
        round: 1,
        proposalNum: 1,
      },
      decision: { kind: 'propose', team: [...team] },
    },
    ...game.players.map((player) => ({
      request: {
        kind: 'vote' as const,
        seat: player.seat,
        round: 1,
        proposalNum: 1,
      },
      decision: { kind: 'vote' as const, vote: 'approve' as const },
    })),
  ]
}

test('legal replay derives a real proposal, vote, and quest surface', () => {
  const game = createGame({
    seed: 'decision-scenario-path',
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const originalLogLength = game.log.length
  const scenario = replayDecisionScenario(
    game,
    proposalAndApprovalSteps(game),
    { kind: 'quest', seat: 0, round: 1, proposalNum: 1 },
  )

  assert.deepEqual(scenario.request, {
    kind: 'quest',
    seat: 0,
    round: 1,
    proposalNum: 1,
  })
  assert.equal(scenario.view.phase, 'quest')
  assert.deepEqual(scenario.view.currentTeam, [0, 1])
  assert.deepEqual(Object.keys(scenario).sort(), [
    'request',
    'source',
    'view',
  ])
  assert.equal('game' in scenario, false)
  assert.equal(scenario.source.gameId, game.id)
  assert.equal(scenario.source.seed, game.seed)
  assert.equal(
    scenario.source.throughSeq,
    scenario.view.events.at(-1)?.seq,
  )

  assert.equal(game.phase, 'proposal')
  assert.equal(game.currentTeam, undefined)
  assert.equal(game.log.length, originalLogLength)
  assert.equal(Object.isFrozen(scenario), true)
  assert.equal(Object.isFrozen(scenario.view), true)
  assert.equal(Object.isFrozen(scenario.view.events), true)
  assert.throws(
    () => mutable(scenario.view).events.push(
      mutable(scenario.view.events[0])!,
    ),
    TypeError,
  )
})

test('legal replay rejects wrong and stale exact coordinates clearly', () => {
  const game = createGame({
    seed: 'decision-scenario-stale',
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  assert.throws(
    () => replayDecisionScenario(
      game,
      [],
      {
        kind: 'propose',
        seat: game.leaderSeat,
        round: 2,
        proposalNum: 1,
      },
    ),
    /target coordinate is wrong or stale: propose .*round=2/,
  )

  const firstVote: LegalReplayStep = {
    request: {
      kind: 'vote',
      seat: 0,
      round: 1,
      proposalNum: 1,
    },
    decision: { kind: 'vote', vote: 'approve' },
  }
  assert.throws(
    () => replayDecisionScenario(
      game,
      [
        {
          request: {
            kind: 'propose',
            seat: game.leaderSeat,
            round: 1,
            proposalNum: 1,
          },
          decision: { kind: 'propose', team: [0, 1] },
        },
        firstVote,
        firstVote,
      ],
      { kind: 'vote', seat: 1, round: 1, proposalNum: 1 },
    ),
    /replay step 2 coordinate is wrong or stale: vote seat=0/,
  )
})

test('scenario view remains filtered to the target seat', () => {
  const game = createGame({
    seed: 'decision-scenario-hidden-info',
    playerCount: 7,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const merlin = game.players.find((player) => player.role === 'merlin')
  assert.ok(merlin)
  const scenario = replayDecisionScenario(
    game,
    [{
      request: {
        kind: 'propose',
        seat: game.leaderSeat,
        round: 1,
        proposalNum: 1,
      },
      decision: { kind: 'propose', team: [0, 1] },
    }],
    {
      kind: 'vote',
      seat: merlin.seat,
      round: 1,
      proposalNum: 1,
    },
  )

  assert.equal(scenario.view.seat, merlin.seat)
  assert.equal(scenario.view.role, 'merlin')
  assert.ok(knownEvilOf(scenario.view.privateInfo).length)
  const dealt = scenario.view.events.filter((event) =>
    event.type === 'roleDealt')
  assert.deepEqual(
    dealt.map((event) => event.payload.seat),
    [merlin.seat],
  )
  assert.ok(scenario.view.players.every((player) =>
    !('role' in player) && !('alignment' in player)))
})
