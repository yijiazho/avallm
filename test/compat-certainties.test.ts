import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../server/engine/game.ts'
import { DEFAULT_ROLES } from '../server/engine/rules.ts'
import type { Game, PlayerView, Role, Seat } from '../server/engine/types.ts'
import { viewFor } from '../server/engine/view.ts'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
} from '../server/agents/belief/exact.ts'
import { roleCertainties } from '../server/agents/board.ts'
import { compatibilityCertainties } from '../server/agents/communication/compat-certainties.ts'
import { knowledgeText } from '../server/agents/prompts.ts'
import { legalCasts } from './casts.ts'

function explicitCertainties(view: PlayerView) {
  const belief = exactBelief(view)
  const analysis = analyzeSituation(view, { belief })
  return compatibilityCertainties(view, belief, analysis)
}

function seatOf(game: Game, role: Role): Seat {
  const player = game.players.find((candidate) => candidate.role === role)
  assert.ok(player, `no ${role} in this deal`)
  return player.seat
}

function runTalk(game: Game): void {
  for (const decision of expectedDecisions(game)) {
    if (decision.kind === 'pitch') {
      applyDecision(game, game.leaderSeat, { kind: 'pitch', pitch: 'go' })
    }
  }
  while (game.phase === 'discussion') {
    const [decision] = expectedDecisions(game)
    applyDecision(game, decision.seat, { kind: 'discuss', say: '' })
  }
  if (game.phase === 'finalize') {
    applyDecision(game, game.leaderSeat, { kind: 'finalize', stick: true })
  }
}

test('explicit compatibility projection equals the transitional delegate for every legal cast and seat', () => {
  let checked = 0
  for (const cast of legalCasts()) {
    const game = createGame({
      seed: `compat-certainties-${cast.label}`,
      playerCount: cast.playerCount,
      roles: [...cast.roles],
    })
    for (const player of game.players) {
      const view = viewFor(game, player.seat)
      assert.deepEqual(
        explicitCertainties(view),
        roleCertainties(view),
        `${cast.label} seat ${player.seat} (${player.role})`,
      )
      checked++
    }
  }
  assert.ok(checked > 400, `expected the whole legal cast space, checked ${checked}`)
})

test('explicit compatibility projection preserves single-quest attribution', () => {
  const game = createGame({
    seed: 'compat-certainties-record',
    playerCount: 5,
    roles: DEFAULT_ROLES[5],
  })
  const percival = seatOf(game, 'percival')
  const morgana = seatOf(game, 'morgana')
  applyDecision(game, game.leaderSeat, {
    kind: 'propose',
    team: [percival, morgana],
  })
  runTalk(game)
  for (const player of game.players) {
    applyDecision(game, player.seat, { kind: 'vote', vote: 'approve' })
  }
  applyDecision(game, percival, { kind: 'quest', card: 'success' })
  applyDecision(game, morgana, { kind: 'quest', card: 'fail' })

  const view = viewFor(game, percival)
  const explicit = explicitCertainties(view)
  assert.deepEqual(explicit, roleCertainties(view))
  assert.deepEqual(
    explicit.fromRecord.find((deduction) => deduction.seat === morgana),
    { seat: morgana, alignment: 'evil', questNum: 1 },
  )
})

test('explicit compatibility projection preserves joint multi-quest deductions', () => {
  const roles: Role[] = [
    'servant', 'servant', 'servant', 'minion', 'minion',
  ]
  const game = createGame({
    seed: 'compat-certainties-joint',
    playerCount: 5,
    roles,
  })
  const viewer = game.players.find((player) => player.role === 'servant')!.seat
  const [evilA, evilB] = game.players
    .filter((player) => player.alignment === 'evil')
    .map((player) => player.seat)
  const [goodC, settledGood] = game.players
    .filter((player) => player.alignment === 'good' && player.seat !== viewer)
    .map((player) => player.seat)
  const base = viewFor(game, viewer)
  const view: PlayerView = {
    ...base,
    quests: base.quests.map((quest) => {
      if (quest.num === 1) {
        return { ...quest, status: 'complete' as const, team: [evilA, evilB], result: 'fail' as const, failCount: 1 }
      }
      if (quest.num === 2) {
        return {
          ...quest,
          status: 'complete' as const,
          team: [evilA, goodC, viewer],
          result: 'fail' as const,
          failCount: 1,
        }
      }
      if (quest.num === 3) {
        return { ...quest, status: 'complete' as const, team: [evilB, goodC], result: 'fail' as const, failCount: 1 }
      }
      return quest
    }),
  }

  const explicit = explicitCertainties(view)
  assert.deepEqual(explicit, roleCertainties(view))
  assert.deepEqual(
    explicit.fromRecord.find((deduction) => deduction.seat === settledGood),
    { seat: settledGood, alignment: 'good' },
  )
})

test('hard certainties follow positive world support even below floating-point marginal resolution', () => {
  const game = createGame({
    seed: 'compat-certainties-support',
    playerCount: 5,
    roles: DEFAULT_ROLES[5],
  })
  const servant = seatOf(game, 'servant')
  const view = viewFor(game, servant)
  const exact = exactBelief(view)
  const target = view.players.find((player) => {
    if (player.seat === view.seat) return false
    const sides = new Set(
      exact.worlds.map((entry) => entry.world.alignmentBySeat[player.seat]),
    )
    return sides.size > 1
  })!.seat
  const dominant = exact.worlds.find((entry) =>
    entry.world.alignmentBySeat[target] === 'good')!.world.key
  const tinyWeight = 1e-300
  const weighted = beliefFromWeightedWorlds(
    view,
    exact.worlds.map((entry) => ({
      world: entry.world,
      probability: entry.world.key === dominant ? 1 : tinyWeight,
    })),
    {
      modelVersion: 'test-weighted-support-v1',
      quality: 'weighted',
    },
  )
  const analysis = analyzeSituation(view, { belief: weighted })
  const projected = compatibilityCertainties(view, weighted, analysis)
  const support = new Set(
    weighted.worlds.map((entry) => entry.world.roleBySeat[target]),
  )
  const targetMarginal = weighted.playerMarginals[target]

  assert.equal(
    targetMarginal.goodProbability,
    1,
    'the regression must exercise floating-point rounding to apparent certainty',
  )
  assert.deepEqual(
    new Set(projected.seats[target].possibleRoles),
    support,
    'no supported role may disappear because its posterior probability is tiny',
  )
  assert.equal(projected.seats[target].alignment, null)
  assert.ok(projected.unresolved.includes(target))
  assert.ok(!projected.knownGood.includes(target))
  assert.ok(!projected.knownEvil.includes(target))
  assert.equal(projected.alignmentComplete, false)
  const prompt = knowledgeText(view, weighted)
  assert.match(prompt, /Only your own loyalty is certain to you/)
  assert.ok(
    !prompt.includes(view.players[target].name),
    'compatibility prose must not name the unresolved seat in a hard claim',
  )
})
