import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import {
  inspectSeatView,
  renderSeatViewInspection,
  SEAT_VIEW_INSPECTION_SCHEMA,
  SEAT_VIEW_INSPECTOR_USAGE,
} from '../server/eval/seat-view-inspector.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import type {
  DecisionRequest,
  Player,
  PlayerView,
  Role,
} from '../server/engine/types.ts'

function playerWithRole(players: Player[], role: Role): Player {
  const player = players.find((candidate) => candidate.role === role)
  assert.ok(player, `missing ${role}`)
  return player
}

function requestFor(view: PlayerView): DecisionRequest {
  return {
    kind: 'vote',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
}

test('inspects a frozen decision fixture deterministically from the agent boundary', () => {
  const fixture = readDecisionFixtures().find(({ id }) => id === 'merlin-opening-proposal')
  assert.ok(fixture)

  const first = inspectSeatView(fixture.req, fixture.view)
  const second = inspectSeatView(fixture.req, fixture.view)

  assert.equal(first.schema, SEAT_VIEW_INSPECTION_SCHEMA)
  assert.deepEqual(first, second)
  assert.equal(first.provenance.source, 'DecisionRequest + PlayerView')
  assert.equal(first.privateKnowledge.kind, 'known-evil')
  assert.equal(first.publicBoard.players.length, fixture.view.playerCount)
  assert.ok(first.publicBoard.players.every((player) =>
    Object.keys(player).sort().join(',') === 'name,seat'))
  assert.match(renderSeatViewInspection(first), /^Seat view inspection v1\n/)
  assert.match(SEAT_VIEW_INSPECTOR_USAGE, /--fixture <id>/)
})

test('different seats expose different private knowledge over the same public board', () => {
  const game = createGame({ seed: 'seat-view-inspector-roles', playerCount: 10 })
  const merlin = playerWithRole(game.players, 'merlin')
  const servant = playerWithRole(game.players, 'servant')
  const assassin = playerWithRole(game.players, 'assassin')
  const mordred = playerWithRole(game.players, 'mordred')
  const oberon = playerWithRole(game.players, 'oberon')

  const merlinInspection = inspectSeatView(
    requestFor(viewFor(game, merlin.seat)),
    viewFor(game, merlin.seat),
  )
  const servantInspection = inspectSeatView(
    requestFor(viewFor(game, servant.seat)),
    viewFor(game, servant.seat),
  )
  const assassinInspection = inspectSeatView(
    requestFor(viewFor(game, assassin.seat)),
    viewFor(game, assassin.seat),
  )

  assert.deepEqual(merlinInspection.publicBoard, servantInspection.publicBoard)
  assert.deepEqual(servantInspection.publicBoard, assassinInspection.publicBoard)
  assert.equal(merlinInspection.privateKnowledge.kind, 'known-evil')
  assert.ok(!merlinInspection.privateKnowledge.seats.some(({ seat }) => seat === mordred.seat))
  assert.equal(servantInspection.privateKnowledge.kind, 'none')
  assert.equal(assassinInspection.privateKnowledge.kind, 'evil-partners')
  assert.ok(!assassinInspection.privateKnowledge.seats.some(({ seat }) => seat === oberon.seat))
  assert.notDeepEqual(
    merlinInspection.visibleHistory.events,
    servantInspection.visibleHistory.events,
  )
  assert.ok(servantInspection.visibleHistory.events.every((event) =>
    event.scope === 'public'
      || event.scope === 'private-to-viewer'))
})

test('explicit nested output allow-lists do not copy hostile extra fields', () => {
  const fixture = readDecisionFixtures().find(({ id }) => id === 'servant-vote-after-evidence')
  assert.ok(fixture)
  const poisoned = structuredClone(fixture.view) as PlayerView
  const forbidden = 'not-for-inspector'
  Object.assign(poisoned, { trueDeal: forbidden })
  Object.assign(poisoned.privateInfo, { exactRoleMap: forbidden })
  Object.assign(poisoned.players[0], { secretNote: forbidden })
  Object.assign(poisoned.quests[0], { trueQuestCards: forbidden })
  Object.assign(poisoned.proposals[0], { trueDeal: forbidden })
  Object.assign(poisoned.proposals[0].votes![0], { voterRole: forbidden })
  Object.assign(poisoned.transcript[0], { privateScratchpad: forbidden })
  Object.assign(poisoned.transcript[0].prop!, { hiddenLeaderRole: forbidden })
  Object.assign(poisoned.events[0].payload, { trueDeal: forbidden })

  const inspection = inspectSeatView(fixture.req, poisoned)
  const rendered = JSON.stringify(inspection)

  for (const key of [
    'secretNote',
    'exactRoleMap',
    'trueQuestCards',
    'trueDeal',
    'voterRole',
    'privateScratchpad',
    'hiddenLeaderRole',
  ]) {
    assert.ok(!rendered.includes(key), key)
  }
  assert.ok(!rendered.includes(forbidden))
  assert.deepEqual(
    Object.keys(inspection.publicBoard.players[0]).sort(),
    ['name', 'seat'],
  )
  assert.deepEqual(
    Object.keys(inspection.visibleHistory.events[0]).sort(),
    ['scope', 'seq', 'type'],
  )
})

test('rejects raw-game-shaped data and hidden roles on public player records', () => {
  const fixture = readDecisionFixtures()[0]
  const rawGameShaped = structuredClone(fixture.view) as PlayerView
  Object.assign(rawGameShaped, { seed: 'must-not-cross-boundary' })
  assert.throws(
    () => inspectSeatView(fixture.req, rawGameShaped),
    /raw Game field "seed"/,
  )

  const roleLeak = structuredClone(fixture.view) as PlayerView
  Object.assign(roleLeak.players[0], { role: 'mordred', alignment: 'evil' })
  assert.throws(
    () => inspectSeatView(fixture.req, roleLeak),
    /carries hidden role or alignment/,
  )
})

test('rejects a mismatched decision cursor and an event invisible to the viewer', () => {
  const fixture = readDecisionFixtures()[0]
  assert.throws(
    () => inspectSeatView({ ...fixture.req, seat: (fixture.req.seat + 1) % 5 }, fixture.view),
    /request seat .* does not match view seat/,
  )

  const invisibleEvent = structuredClone(fixture.view) as PlayerView
  invisibleEvent.events.push({
    seq: 999,
    type: 'scratchpad',
    payload: { seat: (fixture.view.seat + 1) % fixture.view.playerCount, notes: 'hidden' },
    visibility: { only: [(fixture.view.seat + 1) % fixture.view.playerCount] },
  })
  assert.throws(
    () => inspectSeatView(fixture.req, invisibleEvent),
    /event seq=999 type=scratchpad is not visible/,
  )
})

test('malformed snapshot structures fail through the controlled boundary error', () => {
  const fixture = readDecisionFixtures()[0]
  const cases: [string, (view: PlayerView) => void][] = [
    ['privateInfo', (view) => { (view as any).privateInfo = null }],
    ['quests', (view) => { (view as any).quests = 'not-an-array' }],
    ['proposals[0]', (view) => { (view as any).proposals = [null] }],
    ['transcript[0]', (view) => { (view as any).transcript = [null] }],
    ['events[0].payload', (view) => {
      (view as any).events = [{
        seq: 0,
        type: 'gameCreated',
        visibility: 'public',
        payload: null,
      }]
    }],
  ]

  for (const [label, mutate] of cases) {
    const malformed = structuredClone(fixture.view) as PlayerView
    mutate(malformed)
    assert.throws(
      () => inspectSeatView(fixture.req, malformed),
      new RegExp(`^Error: seat-view inspection rejected: .*${label.replaceAll('[', '\\[').replaceAll(']', '\\]')}`),
      label,
    )
  }
})
