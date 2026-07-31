// test-lane: fast
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { DEFAULT_ROLES } from '../server/engine/rules.ts'
import { evilPartnersOf, knownEvilOf, merlinCandidatesOf } from '../server/engine/knowledge.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import { assessTeam } from '../server/agents/belief/team-assessment.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
} from '../server/agents/belief/types.ts'
import {
  PROBABILITY_TOLERANCE,
} from '../server/agents/canonical/probability-arithmetic.ts'
import {
  canonicalWorldKey,
  enumerateCanonicalWorlds,
} from '../server/agents/belief/worlds.ts'
import type {
  Game,
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'
import type {
  BeliefSnapshot,
  HiddenWorld,
} from '../server/agents/belief/types.ts'

const VANILLA_5: Role[] = [
  'servant', 'servant', 'servant', 'minion', 'minion',
]

function seatOf(game: Game, role: Role): Seat {
  const player = game.players.find((candidate) => candidate.role === role)
  assert.ok(player, `expected ${role} in deal`)
  return player.seat
}

function viewAs(game: Game, role: Role): PlayerView {
  return viewFor(game, seatOf(game, role))
}

function close(actual: number, expected: number, tolerance = PROBABILITY_TOLERANCE): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected} ± ${tolerance}, got ${actual}`,
  )
}

function roleProbability(
  snapshot: BeliefSnapshot,
  seat: Seat,
  role: Role,
): number {
  return snapshot.roleMarginals.find(
    (marginal) => marginal.seat === seat && marginal.role === role,
  )?.probability ?? 0
}

function withQuest(
  view: PlayerView,
  questNum: number,
  team: readonly Seat[],
  failCount: number,
  result: 'success' | 'fail',
): PlayerView {
  return {
    ...view,
    quests: view.quests.map((quest) => quest.num === questNum
      ? { ...quest, status: 'complete' as const, team: [...team], failCount, result }
      : { ...quest }),
  }
}

test('hand-worked casts have exact canonical world counts', () => {
  const standard = createGame({
    seed: 'belief-count-standard',
    playerCount: 5,
    roles: DEFAULT_ROLES[5],
  })
  assert.equal(exactBelief(viewAs(standard, 'servant')).worlds.length, 24)
  assert.equal(exactBelief(viewAs(standard, 'merlin')).worlds.length, 4)
  assert.equal(exactBelief(viewAs(standard, 'morgana')).worlds.length, 6)
  assert.equal(exactBelief(viewAs(standard, 'percival')).worlds.length, 4)

  const vanilla = createGame({
    seed: 'belief-count-vanilla',
    playerCount: 5,
    roles: VANILLA_5,
  })
  assert.equal(exactBelief(viewAs(vanilla, 'servant')).worlds.length, 6)
})

test('duplicate Servants and Minions never produce duplicate worlds', () => {
  const game = createGame({
    seed: 'belief-duplicates',
    playerCount: 5,
    roles: VANILLA_5,
  })
  for (const [role, expected] of [['servant', 6], ['minion', 1]] as const) {
    const snapshot = exactBelief(viewAs(game, role))
    assert.equal(snapshot.worlds.length, expected)
    const keys = snapshot.worlds.map(({ world }) => world.key)
    assert.equal(new Set(keys).size, keys.length)
  }
})

test('canonical enumeration is independent of rolesInPlay input ordering', () => {
  const evidence = { playerCount: 5, rolesInPlay: VANILLA_5 }
  const forward = enumerateCanonicalWorlds(evidence, { seat: 0, role: 'servant' })
  const reversed = enumerateCanonicalWorlds(
    { ...evidence, rolesInPlay: [...VANILLA_5].reverse() },
    { seat: 0, role: 'servant' },
  )
  assert.deepEqual(
    reversed.map(({ key }) => key),
    forward.map(({ key }) => key),
  )
})

test('every feasible world pins the viewer own role', () => {
  const game = createGame({
    seed: 'belief-own-role',
    playerCount: 10,
    roles: DEFAULT_ROLES[10],
  })
  for (const player of game.players) {
    const snapshot = exactBelief(viewFor(game, player.seat))
    assert.ok(snapshot.worlds.every(
      ({ world }) => world.roleBySeat[player.seat] === player.role,
    ))
  }
})

test('Merlin sees every non-Mordred evil while Mordred remains hidden', () => {
  const game = createGame({
    seed: 'belief-merlin-mordred',
    playerCount: 9,
    roles: DEFAULT_ROLES[9],
  })
  const view = viewAs(game, 'merlin')
  const visible = knownEvilOf(view.privateInfo)
  const mordred = seatOf(game, 'mordred')
  assert.ok(!visible.includes(mordred))

  const snapshot = exactBelief(view)
  for (const { world } of snapshot.worlds) {
    const worldVisible = world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(({ role, seat }) =>
        world.alignmentBySeat[seat] === 'evil'
        && role !== 'mordred')
      .map(({ seat }) => seat)
      .sort((a, b) => a - b)
    assert.deepEqual(worldVisible, visible)
  }
  assert.ok(snapshot.worlds.some(
    ({ world }) => world.roleBySeat[mordred] !== 'mordred',
  ), 'Merlin must not infer the true Mordred seat from hidden truth')
})

test('evil partner lists are complete except for Oberon, who learns no partners', () => {
  const game = createGame({
    seed: 'belief-oberon',
    playerCount: 7,
    roles: DEFAULT_ROLES[7],
  })
  const morganaView = viewAs(game, 'morgana')
  const partners = evilPartnersOf(morganaView.privateInfo)
  const morganaSnapshot = exactBelief(morganaView)
  for (const { world } of morganaSnapshot.worlds) {
    const worldPartners = world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(({ role, seat }) =>
        seat !== morganaView.seat
        && world.alignmentBySeat[seat] === 'evil'
        && role !== 'oberon')
      .map(({ seat }) => seat)
      .sort((a, b) => a - b)
    assert.deepEqual(worldPartners, partners)
  }

  const oberonView = viewAs(game, 'oberon')
  assert.deepEqual(oberonView.privateInfo, { kind: 'none' })
  assert.equal(exactBelief(oberonView).worlds.length, 360)
})

test('Percival candidates hold Merlin and Morgana between them', () => {
  const game = createGame({
    seed: 'belief-percival',
    playerCount: 5,
    roles: DEFAULT_ROLES[5],
  })
  const view = viewAs(game, 'percival')
  const candidates = merlinCandidatesOf(view.privateInfo)
  assert.equal(candidates.length, 2)
  for (const { world } of exactBelief(view).worlds) {
    assert.deepEqual(
      candidates.map((seat) => world.roleBySeat[seat]).sort(),
      ['merlin', 'morgana'],
    )
    assert.ok(world.roleBySeat.every(
      (role, seat) =>
        candidates.includes(seat) || (role !== 'merlin' && role !== 'morgana'),
    ))
  }
})

test('Fail counts impose minimum evil cardinality, including multiple Fails', () => {
  const game = createGame({
    seed: 'belief-fails',
    playerCount: 5,
    roles: VANILLA_5,
  })
  const base = viewAs(game, 'servant')
  const others = base.players.map(({ seat }) => seat).filter((seat) => seat !== base.seat)

  const oneFail = exactBelief(withQuest(base, 1, [base.seat, others[0]], 1, 'fail'))
  assert.equal(oneFail.worlds.length, 3)
  assert.ok(oneFail.worlds.every(
    ({ world }) => world.alignmentBySeat[others[0]] === 'evil',
  ))

  const twoFails = exactBelief(
    withQuest(base, 2, [base.seat, others[0], others[1]], 2, 'fail'),
  )
  assert.equal(twoFails.worlds.length, 1)
  assert.ok(twoFails.worlds.every(({ world }) =>
    [others[0], others[1]].every((seat) => world.alignmentBySeat[seat] === 'evil')))
})

test('a zero-Fail quest does not clear evil players from its team', () => {
  const game = createGame({
    seed: 'belief-zero-fail',
    playerCount: 5,
    roles: VANILLA_5,
  })
  const base = viewAs(game, 'servant')
  const other = base.players.find(({ seat }) => seat !== base.seat)!.seat
  const snapshot = exactBelief(withQuest(base, 1, [base.seat, other], 0, 'success'))
  assert.equal(snapshot.worlds.length, 6)
  assert.ok(snapshot.worlds.some(
    ({ world }) => world.alignmentBySeat[other] === 'evil',
  ))
})

test('a one-Fail success on the two-Fail quest still requires evil aboard', () => {
  const roles: Role[] = [
    'servant', 'servant', 'servant', 'servant',
    'minion', 'minion', 'minion',
  ]
  const game = createGame({
    seed: 'belief-one-fail-success',
    playerCount: 7,
    roles,
  })
  const base = viewAs(game, 'servant')
  const others = base.players.map(({ seat }) => seat).filter((seat) => seat !== base.seat)
  const team = [base.seat, others[0], others[1], others[2]]
  const snapshot = exactBelief(withQuest(base, 4, team, 1, 'success'))
  assert.equal(snapshot.worlds.length, 19)
  assert.ok(snapshot.worlds.every(({ world }) =>
    team.some((seat) => world.alignmentBySeat[seat] === 'evil')))
})

test('uniform posterior, marginals, entropy, and model metadata match a hand-worked cast', () => {
  const game = createGame({
    seed: 'belief-marginals',
    playerCount: 5,
    roles: VANILLA_5,
  })
  const view = viewAs(game, 'servant')
  const snapshot = exactBelief(view)
  assert.equal(snapshot.modelVersion, EXACT_BELIEF_MODEL_VERSION)
  assert.equal(snapshot.quality, 'constraints-only')
  assert.equal(snapshot.throughSeq, Math.max(...view.events.map(({ seq }) => seq)))
  close(snapshot.worlds.reduce((sum, world) => sum + world.probability, 0), 1)
  close(snapshot.entropy, Math.log2(6))

  for (const marginal of snapshot.playerMarginals) {
    if (marginal.seat === view.seat) {
      close(marginal.goodProbability, 1)
      close(marginal.evilProbability, 0)
    } else {
      close(marginal.goodProbability, 0.5)
      close(marginal.evilProbability, 0.5)
      close(roleProbability(snapshot, marginal.seat, 'servant'), 0.5)
      close(roleProbability(snapshot, marginal.seat, 'minion'), 0.5)
    }
  }
})

test('team-clean probability and full evil-count distribution use joint worlds', () => {
  const game = createGame({
    seed: 'belief-team',
    playerCount: 5,
    roles: VANILLA_5,
  })
  const view = viewAs(game, 'servant')
  const snapshot = exactBelief(view)
  const others = view.players.map(({ seat }) => seat).filter((seat) => seat !== view.seat)

  const withViewer = assessTeam(snapshot, [others[0], view.seat])
  close(withViewer.cleanProbability, 0.5)
  assert.deepEqual(withViewer.team, [view.seat, others[0]].sort((a, b) => a - b))
  withViewer.evilCountDistribution.forEach((probability, count) =>
    close(probability, [0.5, 0.5, 0][count]))

  const pair = assessTeam(snapshot, [others[0], others[1]])
  close(pair.cleanProbability, 1 / 6)
  pair.evilCountDistribution.forEach((probability, count) =>
    close(probability, [1 / 6, 4 / 6, 1 / 6][count]))
})

test('world and top-world ordering are deterministic under tied probabilities', () => {
  const game = createGame({
    seed: 'belief-determinism',
    playerCount: 5,
    roles: VANILLA_5,
  })
  const view = viewAs(game, 'servant')
  const first = exactBelief(view)
  const second = exactBelief(view)
  assert.deepEqual(second, first)
  const keys = first.worlds.map(({ world }) => world.key)
  assert.deepEqual(keys, [...keys].sort())
  assert.deepEqual(
    first.topWorlds.map(({ world }) => world.key),
    keys.slice(0, 10),
  )
})

function rotateSeat(seat: Seat, playerCount: number, shift: number): Seat {
  return (seat + shift) % playerCount
}

function rotateView(view: PlayerView, shift: number): PlayerView {
  const rotate = (seat: Seat) => rotateSeat(seat, view.playerCount, shift)
  const rotateSeats = (seats: readonly Seat[] | undefined) =>
    seats?.map(rotate).sort((a, b) => a - b)
  return {
    ...view,
    seat: rotate(view.seat),
    players: view.players
      .map((player) => ({ ...player, seat: rotate(player.seat) }))
      .sort((a, b) => a.seat - b.seat),
    privateInfo: ((info) => {
      switch (info.kind) {
        case 'merlin': return { kind: 'merlin' as const, knownEvil: rotateSeats(info.knownEvil)! }
        case 'percival': return { kind: 'percival' as const, merlinCandidates: rotateSeats(info.merlinCandidates)! }
        case 'evil': return { kind: 'evil' as const, evilPartners: rotateSeats(info.evilPartners)! }
        case 'none': return { kind: 'none' as const }
      }
    })(view.privateInfo),
    quests: view.quests.map((quest) =>
      quest.status === 'complete'
        ? { ...quest, team: quest.team.map(rotate).sort((a, b) => a - b) }
        : quest),
    events: [],
  }
}

function rotateWorld(world: HiddenWorld, shift: number): string {
  const roles = Array<Role>(world.roleBySeat.length)
  for (let seat = 0; seat < roles.length; seat++) {
    roles[rotateSeat(seat, roles.length, shift)] = world.roleBySeat[seat]
  }
  return canonicalWorldKey(roles)
}

test('seat rotation rotates worlds and projections without changing probabilities', () => {
  const game = createGame({
    seed: 'belief-rotation',
    playerCount: 5,
    roles: DEFAULT_ROLES[5],
  })
  const originalView = { ...viewAs(game, 'percival'), events: [] }
  const shift = 2
  const original = exactBelief(originalView)
  const rotated = exactBelief(rotateView(originalView, shift))
  const rotatedProbabilities = new Map(
    rotated.worlds.map(({ world, probability }) => [world.key, probability]),
  )
  for (const { world, probability } of original.worlds) {
    close(rotatedProbabilities.get(rotateWorld(world, shift)) ?? -1, probability)
  }
  for (const marginal of original.playerMarginals) {
    const other = rotated.playerMarginals[rotateSeat(
      marginal.seat,
      originalView.playerCount,
      shift,
    )]
    close(other.goodProbability, marginal.goodProbability)
    close(other.evilProbability, marginal.evilProbability)
  }
  for (const marginal of original.roleMarginals) {
    close(
      roleProbability(
        rotated,
        rotateSeat(marginal.seat, originalView.playerCount, shift),
        marginal.role,
      ),
      marginal.probability,
    )
  }
  close(rotated.entropy, original.entropy)
})

test('a legal PlayerView always retains the true world', () => {
  const game = createGame({
    seed: 'belief-truth-retention',
    playerCount: 7,
    roles: DEFAULT_ROLES[7],
  })
  const trueKey = canonicalWorldKey(game.players.map(({ role }) => role))
  for (const player of game.players) {
    assert.ok(
      exactBelief(viewFor(game, player.seat)).worlds.some(
        ({ world }) => world.key === trueKey,
      ),
      `seat ${player.seat} (${player.role}) lost the true world`,
    )
  }
})

test('inconsistent legal-shape evidence fails clearly instead of returning an empty posterior', () => {
  const game = createGame({
    seed: 'belief-no-world',
    playerCount: 5,
    roles: DEFAULT_ROLES[5],
  })
  const view = viewAs(game, 'merlin')
  assert.throws(
    () => exactBelief({ ...view, privateInfo: { kind: 'merlin', knownEvil: [] } }),
    /found no feasible worlds for seat \d+ \(merlin\)/,
  )
})

test('runtime belief modules have no raw Game dependency', () => {
  const files = [
    'server/agents/belief/types.ts',
    'server/agents/belief/worlds.ts',
    'server/agents/belief/constraints.ts',
    'server/agents/belief/exact.ts',
    'server/agents/belief/team-assessment.ts',
  ]
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /from ['"].*engine\/game\.ts['"]/, file)
    assert.doesNotMatch(source, /import type \{[^}]*\bGame\b[^}]*\}/s, file)
  }
})
