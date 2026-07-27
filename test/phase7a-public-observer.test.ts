import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import {
  observePublicRecord,
  validatePublicObserverSnapshot,
} from '../server/agents/analysis/observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../server/agents/analysis/observer-types.ts'
import {
  questFailEvidenceFromQuests,
  worldSatisfiesQuestEvidence,
} from '../server/agents/belief/quest-constraints.ts'
import {
  visitCanonicalWorlds,
} from '../server/agents/belief/worlds.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  projectPublicRecord,
  type PublicRecord,
} from '../server/agents/communication/public-record.ts'
import { parseStdioDecisionReply } from '../server/agents/stdio.ts'
import { createGame } from '../server/engine/game.ts'
import type {
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'
import { viewFor } from '../server/engine/view.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { architectureReport } from '../server/eval/architecture-report.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'

const VANILLA_5: Role[] = [
  'servant', 'servant', 'servant', 'minion', 'minion',
]

function close(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) <= 1e-12,
    `expected ${expected}, got ${actual}`,
  )
}

function baseRecord(rolesInPlay: readonly Role[] = VANILLA_5): PublicRecord {
  return {
    playerCount: 5,
    rolesInPlay,
    players: Array.from({ length: 5 }, (_, seat) => ({
      seat,
      name: `P${seat}`,
    })),
    phase: 'propose',
    round: 1,
    proposalNum: 1,
    leaderSeat: 0,
    quests: Array.from({ length: 5 }, (_, index) => ({
      num: index + 1,
      teamSize: index < 2 ? 2 : 3,
      failsRequired: 1,
    })),
    proposals: [],
  }
}

test('hand-worked public worlds, marginals, and quest constraints are exact', () => {
  const prior = observePublicRecord(baseRecord())
  assert.equal(prior.feasibleWorldCount, 10)
  close(prior.entropy, Math.log2(10))
  for (const seat of prior.seats) {
    close(seat.goodProbability, 3 / 5)
    close(seat.evilProbability, 2 / 5)
    close(
      seat.roleMarginals.find((entry) => entry.role === 'servant')!.probability,
      3 / 5,
    )
    close(
      seat.roleMarginals.find((entry) => entry.role === 'minion')!.probability,
      2 / 5,
    )
  }

  const failed = structuredClone(baseRecord())
  failed.quests[0] = {
    ...failed.quests[0],
    team: [0, 1],
    result: 'fail',
    failCount: 1,
  }
  const posterior = observePublicRecord(failed)
  assert.equal(posterior.feasibleWorldCount, 7)
  close(posterior.seats[0].evilProbability, 4 / 7)
  close(posterior.seats[1].evilProbability, 4 / 7)
  for (const seat of [2, 3, 4]) {
    close(posterior.seats[seat].evilProbability, 2 / 7)
  }

  const impossible = structuredClone(failed)
  impossible.quests[0] = {
    ...impossible.quests[0],
    team: [0, 1],
    result: 'fail',
    failCount: 2,
  }
  const forced = observePublicRecord(impossible)
  assert.equal(forced.feasibleWorldCount, 1)
  close(forced.seats[0].evilProbability, 1)
  close(forced.seats[1].evilProbability, 1)
  for (const seat of [2, 3, 4]) close(forced.seats[seat].evilProbability, 0)
})

test('complete-world posterior is normalized and impossible worlds are absent', () => {
  const record = structuredClone(baseRecord())
  record.quests[0] = {
    ...record.quests[0],
    team: [0, 1],
    result: 'fail',
    failCount: 1,
  }
  const snapshot = observePublicRecord(record)
  assert.ok(validatePublicObserverSnapshot(snapshot))
  for (const seat of snapshot.seats) {
    close(seat.goodProbability + seat.evilProbability, 1)
    close(
      seat.roleMarginals.reduce((sum, role) => sum + role.probability, 0),
      1,
    )
  }

  const evidence = questFailEvidenceFromQuests(record.quests)
  let feasible = 0
  let impossible = 0
  visitCanonicalWorlds(
    { playerCount: record.playerCount, rolesInPlay: record.rolesInPlay },
    (world) => {
      if (worldSatisfiesQuestEvidence(world, evidence)) {
        feasible++
        assert.ok(
          [0, 1].some((seat) => world.alignmentBySeat[seat] === 'evil'),
        )
      } else {
        impossible++
      }
    },
  )
  assert.equal(feasible, snapshot.feasibleWorldCount)
  assert.equal(impossible, 3)
})

test('offline truth retention joins only after public inference', () => {
  const game = createGame({
    seed: 'phase7a-truth-retention',
    playerCount: 7,
  })
  const record = projectPublicRecord(viewFor(game, 0))
  const truthRoles = game.players
    .slice()
    .sort((left, right) => left.seat - right.seat)
    .map((player) => player.role)
  const evidence = questFailEvidenceFromQuests(record.quests)
  let truthRetained = false
  visitCanonicalWorlds(
    { playerCount: record.playerCount, rolesInPlay: record.rolesInPlay },
    (world) => {
      if (
        world.roleBySeat.every((role, seat) => role === truthRoles[seat])
        && worldSatisfiesQuestEvidence(world, evidence)
      ) {
        truthRetained = true
      }
    },
  )
  assert.ok(truthRetained)
  assert.ok(!JSON.stringify(observePublicRecord(record)).includes(
    truthRoles.join('|'),
  ))
})

function rotateRecord(record: PublicRecord, shift: number): PublicRecord {
  const rotate = (seat: Seat): Seat => (seat + shift) % record.playerCount
  const rotateTeam = (team: readonly Seat[] | undefined) =>
    team?.map(rotate).sort((left, right) => left - right)
  return {
    ...structuredClone(record),
    players: record.players
      .map((player) => ({
        seat: rotate(player.seat),
        name: `renamed-${rotate(player.seat)}`,
      }))
      .sort((left, right) => left.seat - right.seat),
    leaderSeat: rotate(record.leaderSeat),
    quests: record.quests.map((quest) => ({
      ...quest,
      ...(quest.team ? { team: rotateTeam(quest.team) } : {}),
    })),
    proposals: record.proposals.map((proposal) => ({
      ...proposal,
      leader: rotate(proposal.leader),
      team: rotateTeam(proposal.team)!,
      ...(proposal.revisedFrom
        ? { revisedFrom: rotateTeam(proposal.revisedFrom) }
        : {}),
      ...(proposal.votes
        ? {
            votes: proposal.votes
              .map((vote) => ({ ...vote, seat: rotate(vote.seat) }))
              .sort((left, right) => left.seat - right.seat),
          }
        : {}),
    })),
    ...(record.currentTeam
      ? { currentTeam: rotateTeam(record.currentTeam) }
      : {}),
  }
}

test('role order, names, seat rotation, and replay preserve exact semantics', () => {
  const record = structuredClone(baseRecord())
  record.quests[0] = {
    ...record.quests[0],
    team: [0, 1],
    result: 'fail',
    failCount: 1,
  }
  record.proposals = [{
    round: 1,
    proposalNum: 1,
    leader: 0,
    team: [0, 1],
    votes: Array.from({ length: 5 }, (_, seat) => ({
      seat,
      vote: seat < 3 ? 'approve' as const : 'reject' as const,
    })),
    approved: true,
  }]
  const first = observePublicRecord(record)
  assert.deepEqual(observePublicRecord(record), first)

  const reordered = {
    ...structuredClone(record),
    rolesInPlay: [...record.rolesInPlay].reverse(),
    players: record.players.map((player) => ({
      ...player,
      name: `adversarial-${player.seat}-MERLIN`,
    })),
  }
  assert.deepEqual(
    observePublicRecord(reordered),
    first,
    'names and role input order must not affect arithmetic or ordering',
  )

  const shift = 2
  const rotated = observePublicRecord(rotateRecord(record, shift))
  for (const seat of first.seats) {
    const target = rotated.seats[(seat.seat + shift) % record.playerCount]
    close(target.goodProbability, seat.goodProbability)
    close(target.evilProbability, seat.evilProbability)
    assert.deepEqual(target.roleMarginals, seat.roleMarginals)
    assert.deepEqual(target.behavior, seat.behavior)
  }
})

test('behavior reads all seats symmetrically but cannot reweight exact worlds', () => {
  const record = structuredClone(baseRecord())
  const baseline = observePublicRecord(record)
  record.proposals = [{
    round: 1,
    proposalNum: 1,
    leader: 2,
    team: [1, 2],
    votes: [
      { seat: 0, vote: 'reject' },
      { seat: 1, vote: 'approve' },
      { seat: 2, vote: 'approve' },
      { seat: 3, vote: 'reject' },
      { seat: 4, vote: 'approve' },
    ],
    approved: true,
  }]
  const behavioral = observePublicRecord(record)
  assert.equal(behavioral.seats[2].behavior.proposalLeadershipCount, 1)
  assert.equal(behavioral.seats[0].behavior.approvalIndex, 0)
  assert.equal(behavioral.seats[1].behavior.approvalIndex, 1)
  assert.deepEqual(
    behavioral.seats.map(({ behavior: _behavior, ...exact }) => exact),
    baseline.seats.map(({ behavior: _behavior, ...exact }) => exact),
  )
})

test('cached exact projections are detached from caller mutation', () => {
  const record = baseRecord()
  const first = observePublicRecord(record)
  ;(first.seats[0].roleMarginals as { role: Role; probability: number }[])[0]
    .probability = 123
  const second = observePublicRecord(record)
  assert.notEqual(second.seats[0].roleMarginals[0].probability, 123)
  assert.ok(validatePublicObserverSnapshot(second))
})

test('observer result is identical across seats and rejects private canaries 5-10', () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    const game = createGame({
      seed: `phase7a-cross-seat-${playerCount}`,
      playerCount,
    })
    const snapshots = game.players.map((player) =>
      observePublicRecord(projectPublicRecord(viewFor(game, player.seat))))
    for (const snapshot of snapshots.slice(1)) {
      assert.deepEqual(snapshot, snapshots[0], `${playerCount}p seat drift`)
    }

    const canary = structuredClone(viewFor(game, 0)) as PlayerView
    canary.name = 'PRIVATE_CANARY'
    canary.role = 'oberon'
    canary.alignment = 'evil'
    canary.privateInfo = {
      knownEvil: [1],
      evilPartners: [2],
      merlinCandidates: [3, 4],
    }
    Object.assign(canary, {
      cognition: 'PRIVATE_COGNITION',
      posterior: 'PRIVATE_POSTERIOR',
      plan: 'PRIVATE_PLAN',
      languageReads: 'PRIVATE_LANGUAGE',
      rawGame: 'PRIVATE_GAME',
    })
    assert.deepEqual(
      observePublicRecord(projectPublicRecord(canary)),
      snapshots[0],
    )
  }
})

test('10-player output is bounded and cached replay is fast', () => {
  const roles: Role[] = [
    'merlin', 'percival', 'servant', 'servant',
    'assassin', 'morgana', 'mordred', 'oberon', 'minion', 'minion',
  ]
  const record: PublicRecord = {
    ...baseRecord(roles),
    playerCount: 10,
    players: Array.from({ length: 10 }, (_, seat) => ({
      seat,
      name: `P${seat}`,
    })),
    quests: Array.from({ length: 5 }, (_, index) => ({
      num: index + 1,
      teamSize: index < 2 ? 3 : index === 3 ? 5 : 4,
      failsRequired: index === 3 ? 2 : 1,
    })),
  }
  const started = performance.now()
  const snapshot = observePublicRecord(record)
  const coldMs = performance.now() - started
  const replayStarted = performance.now()
  const replay = observePublicRecord(record)
  const replayMs = performance.now() - replayStarted

  assert.equal(snapshot.feasibleWorldCount, 907_200)
  assert.ok(validatePublicObserverSnapshot(snapshot))
  assert.deepEqual(replay, snapshot)
  assert.ok(JSON.stringify(snapshot).length < 15_000)
  assert.ok(coldMs < 5_000, `cold 10p observer took ${coldMs.toFixed(1)}ms`)
  assert.ok(replayMs < 50, `cached 10p observer took ${replayMs.toFixed(1)}ms`)
})

test('composed observer is opt-in, attributable, and mechanically inert', async () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.req.kind === 'vote',
  )!
  const off = await createComposedAgent({
    seed: 'phase7a-composed',
  }).decide(fixture.req, fixture.view)
  const on = await createComposedAgent({
    seed: 'phase7a-composed',
    publicObserver: true,
  }).decide(fixture.req, fixture.view)

  assert.deepEqual(on.decision, off.decision)
  assert.equal(off.trace!.componentVersions!.observerModel, 'off')
  assert.equal(off.trace!.publicObserver, undefined)
  assert.equal(
    on.trace!.componentVersions!.observerModel,
    PUBLIC_OBSERVER_MODEL_VERSION,
  )
  assert.ok(validatePublicObserverSnapshot(on.trace!.publicObserver))

  const accepted = parseStdioDecisionReply(
    fixture.req,
    on,
  )
  assert.deepEqual(accepted, on)
  const forgedOff = structuredClone(off)
  forgedOff.trace!.publicObserver = structuredClone(on.trace!.publicObserver)
  assert.throws(
    () => parseStdioDecisionReply(fixture.req, forgedOff),
    /invalid decision trace/,
  )
  const forgedOn = structuredClone(on)
  forgedOn.trace!.componentVersions!.observerModel = 'off'
  assert.throws(
    () => parseStdioDecisionReply(fixture.req, forgedOn),
    /invalid decision trace/,
  )
})

function observerVariant(forgeMissingPayload = false): ArchitectureVariant {
  return {
    id: forgeMissingPayload ? 'observer-forged' : 'observer',
    paid: false,
    components: {
      mode: 'compatibility',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
      policy: 'composed-policy-v1',
      scorer: 'compatibility-scorer-v1',
      planner: 'planner-off',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => {
      const inner = createComposedAgent({
        seed: context.seed,
        publicObserver: true,
      })
      return {
        recordDecisionTrace(trace) {
          context.onDecisionTrace?.(trace)
        },
        async decide(req, view) {
          const output = normalizeAgentOutput(await inner.decide(req, view))
          if (forgeMissingPayload) delete output.trace!.publicObserver
          return output
        },
      }
    },
  }
}

test('architecture bench and report enforce observer metadata and payload together', async () => {
  const [artifact] = await runArchitectureBench({
    variants: [observerVariant()],
    cases: ARCHITECTURE_BANK.slice(0, 1),
    bankId: 'phase7a-observer-attribution',
  })
  const summary = architectureReport([artifact]).variants[0]
  assert.equal(summary.safety.traceAttributionViolations, 0)
  assert.deepEqual(
    artifact.strategyVersions?.observers,
    [PUBLIC_OBSERVER_MODEL_VERSION],
  )

  const forgedMetadata = structuredClone(artifact)
  forgedMetadata.architecture!.components.observerModel = 'off'
  assert.ok(
    architectureReport([forgedMetadata])
      .variants[0].safety.traceAttributionViolations > 0,
  )

  const forgedTrace = structuredClone(artifact)
  forgedTrace.decisionTraces![0].componentVersions!.observerModel = 'off'
  delete forgedTrace.decisionTraces![0].publicObserver
  assert.ok(
    architectureReport([forgedTrace])
      .variants[0].safety.traceAttributionViolations > 0,
  )

  const historicalOff = structuredClone(artifact)
  delete historicalOff.architecture!.components.observerModel
  for (const trace of historicalOff.decisionTraces ?? []) {
    trace.componentVersions!.observerModel = 'off'
    delete trace.publicObserver
  }
  assert.equal(
    architectureReport([historicalOff])
      .variants[0].safety.traceAttributionViolations,
    0,
  )

  await assert.rejects(
    () => runArchitectureBench({
      variants: [observerVariant(true)],
      cases: ARCHITECTURE_BANK.slice(0, 1),
      bankId: 'phase7a-observer-forged-attribution',
    }),
    /trace components do not match declared components/,
  )
})

test('runtime observer dependency surface cannot access private authorities', () => {
  const observer = readFileSync(
    'server/agents/analysis/observer.ts',
    'utf8',
  )
  const observerTypes = readFileSync(
    'server/agents/analysis/observer-types.ts',
    'utf8',
  )
  const questConstraints = readFileSync(
    'server/agents/belief/quest-constraints.ts',
    'utf8',
  )
  const worlds = readFileSync(
    'server/agents/belief/worlds.ts',
    'utf8',
  )
  const projection = readFileSync(
    'server/agents/belief/projection.ts',
    'utf8',
  )
  for (
    const source of [
      observer,
      observerTypes,
      questConstraints,
      worlds,
      projection,
    ]
  ) {
    assert.doesNotMatch(source, /\bPlayerView\b/)
    assert.doesNotMatch(source, /\braw Game\b|\bGame\b/)
    assert.doesNotMatch(source, /privateInfo|cognition|languageReads|provider/)
    assert.doesNotMatch(source, /prompts?\.ts|server\/eval|truth/)
  }
  assert.match(
    observer,
    /observePublicRecord\(\s*record: PublicRecord/,
  )
})
