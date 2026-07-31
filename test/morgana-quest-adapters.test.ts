// Migration phase 7R2B3B; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { pendingQuest, resolveQuest } from './support/quests.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'
import {
  createComposedAgent,
} from '../server/agents/composed.ts'
import {
  MAX_DECISION_COMPONENT_RUN_JSON_BYTES,
  decisionComponentPlan,
  publicDecisionComponentRun,
} from '../server/agents/components/kernel.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../server/agents/components/robust-evil-quest-card.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  createNativeScoreComponentRegistry,
} from '../server/agents/components/native-score-components.ts'
import {
  revalidatedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'
import {
  morganaRoleScorer,
  seededMorganaRoleScorer,
} from '../server/agents/policy/score.ts'
import {
  admitDecisionTrace,
} from '../server/agents/admission/composed-trace.ts'
import {
  readDecisionFixtures,
} from '../server/eval/decision-fixtures.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import {
  ARCHITECTURE_BANK,
} from '../server/eval/architecture-bank.ts'
import {
  exactBelief,
} from '../server/agents/belief/exact.ts'

function morganaProposal(
  playerCount = 9,
): {
  game: ReturnType<typeof createGame>
  view: PlayerView
  req: DecisionRequest
} {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const game = createGame({
      seed: `phase7r2b3b-propose-${playerCount}-${attempt}`,
      playerCount,
    })
    const morgana = game.players.find(
      (player) => player.role === 'morgana',
    )!
    if (morgana.seat !== game.leaderSeat) continue
    const view = viewFor(game, morgana.seat)
    return {
      game,
      view,
      req: {
        kind: 'propose',
        seat: morgana.seat,
        round: game.round,
        proposalNum: game.proposalNum,
      },
    }
  }
  throw new Error('could not find a Morgana proposal fixture')
}

const decisionFixtures = readDecisionFixtures()
const questSource = decisionFixtures.find(
  (fixture) => fixture.id === 'oberon-two-fail-quest',
)!

function coordinatedQuestView(
  seat: Seat,
  visibleEvil: readonly Seat[],
  role: Role = 'assassin',
): PlayerView {
  const players = questSource.view.players.map((player) => ({
    ...player,
    name: `Seat ${player.seat}`,
  }))
  return {
    ...structuredClone(questSource.view),
    seat,
    name: players.find((player) => player.seat === seat)!.name,
    role,
    alignment: 'evil',
    privateInfo: {
      kind: 'evil',
      evilPartners: visibleEvil.filter((partner) => partner !== seat),
    },
    players,
  }
}

function nondecisive(view: PlayerView): PlayerView {
  const copy = structuredClone(view)
  copy.quests[0] = resolveQuest(copy.quests[0], { result: 'success', failCount: 0 })
  copy.quests[1] = resolveQuest(copy.quests[1], { result: 'fail', failCount: 1 })
  copy.quests[2] = pendingQuest(copy.quests[2])
  return copy
}

function questRequest(view: PlayerView): DecisionRequest {
  return {
    kind: 'quest',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
}

test('E1A/E1B generic entries solely own Morgana policy payloads', async () => {
  const input = morganaProposal()
  const agent = createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
  })
  const output = await agent.decide(input.req, input.view)
  const trace = output.trace!
  const byId = new Map(
    trace.components!.entries.map((entry) => [
      entry.component.id,
      entry,
    ]),
  )
  const read = byId.get(MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id)!
  const objective = byId.get(MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id)!
  const utility = byId.get(MORGANA_ROLE_UTILITY_COMPONENT.id)!
  assert.equal(read.status, 'admitted')
  assert.equal(objective.status, 'admitted')
  assert.equal(utility.status, 'admitted')
  if (
    read.status !== 'admitted'
    || objective.status !== 'admitted'
    || utility.status !== 'admitted'
  ) throw new Error('expected admitted Morgana component chain')
  assert.equal(trace.publicMorganaCounterfeitRead, undefined)
  assert.equal(trace.privateMorganaCounterfeitObjective, undefined)
  assert.equal(trace.privateMorganaRoleUtility, undefined)
  assert.equal(trace.componentVersions!.morganaCounterfeitPublicRead, undefined)
  assert.equal(trace.componentVersions!.morganaCounterfeitObjective, undefined)
  assert.equal(trace.componentVersions!.morganaRoleUtility, undefined)
  for (const entry of [read, objective, utility]) {
    assert.equal(entry.verification, 'exact')
    assert.equal(entry.promotionEligible, true)
  }
  for (const component of [
    MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
    MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
    MORGANA_ROLE_UTILITY_COMPONENT,
  ]) {
    const use = trace.components!.policyUse.find(
      (candidate) => candidate.component.id === component.id,
    )!
    assert.deepEqual(
      use.stages,
      ['candidate-score', 'action-selection'],
    )
  }
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace,
    req: input.req,
    view: input.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: input.game.seed,
    expectComponentTrace: true,
    expectedComponentPlan: decisionComponentPlan(agent.resolvedBrain()),
    expectedArchitectureIdentity: revalidatedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  }).kind, 'trusted-exact')

  const forgedDependency = structuredClone(trace)
  const forgedObjective = forgedDependency.components!.entries.find(
    (entry) =>
      entry.component.id === MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
  )!
  assert.equal(forgedObjective.status, 'admitted')
  if (forgedObjective.status !== 'admitted') {
    throw new Error('expected admitted Morgana objective')
  }
  const otherInput = morganaProposal(10)
  const otherOutput = await createComposedAgent({
    seed: otherInput.game.seed,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
  }).decide(otherInput.req, otherInput.view)
  const forgedPayload = structuredClone(
    (otherOutput.trace!.components!.entries.find(
      (entry) =>
        entry.component.id === MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
    ) as typeof forgedObjective).envelope.payload,
  )
  ;(forgedObjective.envelope as any).payload = forgedPayload
  ;(forgedObjective as any).payloadBytes = Buffer.byteLength(
    JSON.stringify(forgedPayload),
    'utf8',
  )
  assert.equal(
    createNativeScoreComponentRegistry({
      goodObjectiveAllDecisionKinds: true,
    }).definition(MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT)!
      .validateDetached(forgedPayload).admitted,
    true,
  )
  const forgedDependencyAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: forgedDependency,
    req: input.req,
    view: input.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: input.game.seed,
    expectComponentTrace: true,
    expectedComponentPlan: decisionComponentPlan(agent.resolvedBrain()),
    expectedArchitectureIdentity: revalidatedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  })
  assert.equal(forgedDependencyAdmission.kind, 'rejected')
  if (forgedDependencyAdmission.kind === 'rejected') {
    assert.equal(
      forgedDependencyAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }
})

test('public E1 read resolves from public record without a Morgana flat projection', async () => {
  const source = decisionFixtures.find(
    (fixture) => fixture.view.role === 'servant',
  )!
  const view: PlayerView = {
    ...structuredClone(source.view),
    phase: 'proposal',
    leaderSeat: source.view.seat,
    currentTeam: undefined,
  }
  const req: DecisionRequest = {
    kind: 'propose',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const agent = createComposedAgent({
    seed: 'phase7r2b3b-public-read',
    morganaCounterfeitObjectives: true,
  })
  const output = await agent.decide(req, view)
  const trace = output.trace!
  const read = trace.components!.entries.find(
    (entry) =>
      entry.component.id === MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id,
  )!
  const privateObjective = trace.components!.entries.find(
    (entry) =>
      entry.component.id === MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
  )!
  assert.equal(read.status, 'admitted')
  assert.equal(read.privacy, 'public')
  assert.equal(privateObjective.status, 'inapplicable')
  assert.equal(trace.publicMorganaCounterfeitRead, undefined)
  assert.equal(
    trace.componentVersions!.morganaCounterfeitPublicRead,
    undefined,
  )
  const publicRun = publicDecisionComponentRun(trace.components!)
  assert.deepEqual(
    publicRun.entries.map((entry) => entry.component.id),
    [MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id],
  )
  assert.deepEqual(publicRun.policyUse, [])
  assert.doesNotMatch(
    JSON.stringify(publicRun),
    /private-resolved-belief|private-deterministic-seed|evil-quest-card/,
  )
  const hostInput = {
    req,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: 'phase7r2b3b-public-read',
    expectComponentTrace: true,
    expectedComponentPlan: decisionComponentPlan(agent.resolvedBrain()),
    expectedArchitectureIdentity: revalidatedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  } as const
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace,
    ...hostInput,
  }).kind, 'trusted-exact')

  const forged = structuredClone(trace)
  const forgedRead = forged.components!.entries.find(
    (entry) =>
      entry.component.id === MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id,
  )!
  assert.equal(forgedRead.status, 'admitted')
  if (forgedRead.status !== 'admitted') {
    throw new Error('expected admitted public read')
  }
  const payload = forgedRead.envelope.payload as typeof read.envelope.payload
  const seat = (payload as any).seats[0]
  seat.voteTruthTracking.numerator = 1
  seat.voteTruthTracking.index = 0.5
  seat.totalTruthTracking.numerator = 1
  seat.totalTruthTracking.index = 0.5
  seat.smoothedTruthTrackingIndex = 0.5
  seat.counterfeitReadProxyIndex = 0.4
  ;(forgedRead as any).payloadBytes = Buffer.byteLength(
    JSON.stringify(payload),
    'utf8',
  )
  assert.equal(
    createNativeScoreComponentRegistry({
      goodObjectiveAllDecisionKinds: true,
    }).definition(MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT)!
      .validateDetached(payload).admitted,
    true,
  )
  const forgedAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: forged,
    ...hostInput,
  })
  assert.equal(forgedAdmission.kind, 'rejected')
  if (forgedAdmission.kind === 'rejected') {
    assert.equal(
      forgedAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }
})

test('weighted Morgana outputs remain structural and nonpromotable', async () => {
  const input = morganaProposal()
  const agent = createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
    beliefModel: {
      version: 'phase7r2b3b-weighted-v1',
      factorsVersion: 'phase7r2b3b-weighted-factor-v1',
      infer(view) {
        return {
          ...structuredClone(exactBelief(view)),
          modelVersion: 'phase7r2b3b-weighted-v1',
          quality: 'weighted' as const,
        }
      },
    },
  })
  const output = await agent.decide(input.req, input.view)
  const byId = new Map(
    output.trace!.components!.entries.map((entry) => [
      entry.component.id,
      entry,
    ]),
  )
  const read = byId.get(MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id)!
  assert.equal(read.status, 'admitted')
  if (read.status === 'admitted') {
    assert.equal(read.verification, 'exact')
    assert.equal(read.promotionEligible, true)
  }
  for (const component of [
    MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
    MORGANA_ROLE_UTILITY_COMPONENT,
  ]) {
    const entry = byId.get(component.id)!
    assert.equal(entry.status, 'admitted')
    if (entry.status === 'admitted') {
      assert.equal(entry.verification, 'structural')
      assert.equal(entry.promotionEligible, false)
    }
  }
  const weightedAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace!,
    req: input.req,
    view: input.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: input.game.seed,
    expectComponentTrace: true,
    expectedComponentPlan: decisionComponentPlan(agent.resolvedBrain()),
    expectedArchitectureIdentity: revalidatedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  })
  assert.equal(weightedAdmission.kind, 'trusted-exact')
  assert.equal(weightedAdmission.promotionEvidenceEligible, false)
})

test('seeded E1B has its own plan identity and host descriptor', async () => {
  const source = morganaProposal()
  const view: PlayerView = {
    ...structuredClone(source.view),
    phase: 'vote',
    currentTeam: source.view.players
      .slice(0, source.view.quests[source.view.round - 1].teamSize)
      .map((player) => player.seat),
  }
  const req: DecisionRequest = {
    kind: 'vote',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const agent = createComposedAgent({
    seed: source.game.seed,
    roleObjectiveRouter: true,
    scorer: seededMorganaRoleScorer,
  })
  const output = await agent.decide(req, view)
  const plan = decisionComponentPlan(agent.resolvedBrain())
  assert.ok(plan.configured.some(
    (component) =>
      component.id === MORGANA_ROLE_UTILITY_SEEDED_COMPONENT.id,
  ))
  assert.ok(!plan.configured.some(
    (component) => component.id === MORGANA_ROLE_UTILITY_COMPONENT.id,
  ))
  const utility = output.trace!.components!.entries.find(
    (entry) =>
      entry.component.id === MORGANA_ROLE_UTILITY_SEEDED_COMPONENT.id,
  )!
  assert.equal(utility.status, 'admitted')
  if (utility.status !== 'admitted') {
    throw new Error('expected admitted seeded Morgana utility')
  }
  assert.equal(
    (utility.envelope.payload as any).selectionMode,
    'seeded-near-equal-vote-within-d2-band',
  )
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace!,
    req,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: source.game.seed,
    expectComponentTrace: true,
    expectedComponentPlan: plan,
    expectedArchitectureIdentity: revalidatedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  }).kind, 'trusted-exact')
})

test('robust D3 generic status and promotion remain policy-owned', async () => {
  const discretionaryView = nondecisive(
    coordinatedQuestView(4, [4, 5]),
  )
  const req = questRequest(discretionaryView)
  const output = await createComposedAgent({
    seed: 'phase7r2b3b-robust-heterogeneous',
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(req, discretionaryView)
  const entry = output.trace!.components!.entries.find(
    (candidate) =>
      candidate.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
  )!
  assert.equal(entry.status, 'admitted')
  if (entry.status === 'admitted') {
    assert.equal(entry.verification, 'exact')
    assert.equal(entry.promotionEligible, true)
  }
  const use = output.trace!.components!.policyUse.find(
    (candidate) =>
      candidate.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
  )!
  assert.deepEqual(use.stages, ['strategic-decision'])

  const forcedView = coordinatedQuestView(4, [4, 5])
  const forcedReq = questRequest(forcedView)
  const forced = await createComposedAgent({
    seed: 'phase7r2b3b-suppressed',
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(forcedReq, forcedView)
  const forcedEntry = forced.trace!.components!.entries.find(
    (candidate) =>
      candidate.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
  )!
  assert.equal(forcedEntry.status, 'suppressed')
  if (forcedEntry.status === 'suppressed') {
    assert.equal(forcedEntry.reasonCode, 'universal-forced-policy')
  }
  assert.deepEqual(
    forced.trace!.components!.policyUse.find(
      (candidate) =>
        candidate.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
    )!.stages,
    [],
  )
})

test('trusted construction plan rejects coherent rewrites and v1 downgrade', async () => {
  const source = decisionFixtures.find(
    (fixture) => fixture.id === 'servant-vote-after-evidence',
  )!
  const agent = createComposedAgent({
    seed: 'phase7r2b3b-trusted-plan',
    roleObjectives: true,
  })
  const output = await agent.decide(source.req, source.view)
  const expectedComponentPlan = decisionComponentPlan(
    agent.resolvedBrain(),
  )
  const expectedArchitectureIdentity = revalidatedArchitectureIdentity(
    agent.resolvedBrain().description,
  )
  const input = {
    req: source.req,
    view: source.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: 'phase7r2b3b-trusted-plan',
    expectComponentTrace: true,
    expectedComponentPlan,
    expectedArchitectureIdentity,
  } as const
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace!,
    ...input,
  }).kind, 'trusted-exact')

  const coherentErasure = structuredClone(output.trace!)
  coherentErasure.componentPlan!.configured = []
  coherentErasure.components!.configured = []
  coherentErasure.components!.entries = []
  coherentErasure.components!.policyUse = []
  const erasedAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: coherentErasure,
    ...input,
  })
  assert.equal(erasedAdmission.kind, 'rejected')
  if (erasedAdmission.kind === 'rejected') {
    assert.equal(
      erasedAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }

  const downgrade = structuredClone(output.trace!)
  downgrade.version = 'decision-trace-v1'
  delete downgrade.componentPlan
  delete downgrade.components
  delete downgrade.componentVersions!.decisionComponents
  const downgradeAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: downgrade,
    ...input,
  })
  assert.equal(downgradeAdmission.kind, 'rejected')
  if (downgradeAdmission.kind === 'rejected') {
    assert.equal(
      downgradeAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }
})

test('architecture generation captures the producer plan before wrapping', async () => {
  const architectureCase = ARCHITECTURE_BANK.find(
    (candidate) => candidate.targetRole === 'servant',
  )!
  const variant = (
    mutation: 'erase' | 'downgrade',
  ): ArchitectureVariant => ({
    id: `phase7r2b3b-trusted-${mutation}`,
    paid: false,
    components: {
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      identityModel: 'joint-identity-projection-v1',
      roleObjective: 'merlin-percival-objectives-v1',
      policy: 'composed-policy-v1',
      scorer: 'compatibility-scorer-v1',
      planner: 'planner-off',
      voice: 'voice-off',
    },
    createTargetAgent(context) {
      const agent = createComposedAgent({
        seed: context.seed,
        publicObserver: true,
        privateIdentity: {
          roleQueries: [{ roles: ['merlin'] }],
          hiddenTeam: false,
        },
        roleObjectives: true,
        onDecisionTrace: context.onDecisionTrace,
      })
      return {
        ...agent,
        async decide(req, view) {
          const output = await agent.decide(req, view)
          if (mutation === 'erase') {
            output.trace!.componentPlan!.configured = []
            output.trace!.components!.configured = []
            output.trace!.components!.entries = []
            output.trace!.components!.policyUse = []
          } else {
            output.trace!.version = 'decision-trace-v1'
            delete output.trace!.componentPlan
            delete output.trace!.components
            delete output.trace!.componentVersions!.decisionComponents
          }
          return output
        },
      }
    },
  })
  for (const mutation of ['erase', 'downgrade'] as const) {
    await assert.rejects(
      runArchitectureBench({
        variants: [variant(mutation)],
        cases: [architectureCase],
        bankId: `phase7r2b3b-trusted-${mutation}`,
      }),
      /trace components do not match declared components/,
    )
  }
})

test('the 10-player 252-candidate E1 chain stays below the unchanged run cap', async () => {
  const input = morganaProposal(10)
  input.view.round = 4
  input.view.proposalNum = 1
  input.req.round = 4
  input.req.proposalNum = 1
  const seats = input.view.players.map((player) => player.seat)
  const team = (index: number, required?: number): readonly Seat[] => {
    const size = input.view.quests[index].teamSize
    return required === undefined
      ? seats.slice(0, size)
      : [
          required,
          ...seats.filter((seat) => seat !== required),
        ].slice(0, size).sort((left, right) => left - right)
  }
  input.view.quests[0] = {
    ...input.view.quests[0],
    status: 'complete',
    team: team(0),
    result: 'success',
    failCount: 0,
  }
  input.view.quests[1] = {
    ...input.view.quests[1],
    status: 'complete',
    team: team(1),
    result: 'success',
    failCount: 0,
  }
  input.view.quests[2] = {
    ...input.view.quests[2],
    status: 'complete',
    team: team(2, input.view.seat),
    result: 'fail',
    failCount: 1,
  }
  const output = await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
  }).decide(input.req, input.view)
  assert.equal(
    (output.trace!.components!.entries.find(
      (entry) =>
        entry.component.id === MORGANA_ROLE_UTILITY_COMPONENT.id,
    ) as {
      status: 'admitted'
      envelope: { payload: { candidates: readonly unknown[] } }
    }).envelope.payload.candidates.length,
    252,
  )
  const runBytes = Buffer.byteLength(
    JSON.stringify(output.trace!.components),
    'utf8',
  )
  assert.ok(runBytes < MAX_DECISION_COMPONENT_RUN_JSON_BYTES)
  assert.equal(runBytes, 1_404_055)
})
