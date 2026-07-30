// Migration phase 7B2; see docs/agent-architecture-migration.md.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDecision,
  applyDecisionWithOutcome,
  createGame,
  expectedDecisions,
} from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../server/engine/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  assessLiteralCoherence,
  COHERENCE_CONFLICT_CODES,
  type CoherenceIntent,
  type LiteralCommitmentBasis,
} from '../server/agents/cognition/coherence.ts'
import {
  PLAN_MEMORY_HISTORY_LIMIT,
  PLAN_MEMORY_SERIALIZED_LIMIT,
  recordAppliedPlan,
  validateAppliedPlanOutcomeHostJoin,
  validatePrivatePlanMemory,
  type PrivatePlanMemory,
} from '../server/agents/cognition/plan-memory.ts'
import type { DecisionPlan } from '../server/agents/policy/plan.ts'
import {
  type AvalonAgent,
} from '../server/agents/types.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import { createAgent } from '../server/agents/registry.ts'
import { runGame } from '../server/sim/runner.ts'
import { publicCognition, reconstructCognition } from '../server/agents/cognition/state.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import { architectureReport } from '../server/eval/architecture-report.ts'
import { toArtifact } from '../server/eval/artifact.ts'
import { snapshotAt } from '../server/eval/replay.ts'
import {
  PLAN_MEMORY_VERSION,
} from '../server/agents/cognition/plan-memory.ts'
import { COHERENCE_MODEL_VERSION } from '../server/agents/cognition/coherence.ts'
import { parseStdioDecisionReply } from '../server/agents/stdio.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  validateFinalizedAppliedTraceHostJoin,
} from '../server/agents/trace.ts'

function firstRequest(seed = 'phase7b2-fixture') {
  const game = createGame({ seed, playerCount: 5, talk: false })
  const req = expectedDecisions(game)[0]
  const view = viewFor(game, req.seat)
  return { game, req, view }
}

function selectedPlan(
  req: DecisionRequest,
  decision: Decision,
  throughSeq: number,
): DecisionPlan {
  return {
    version: 'decision-plan-v2',
    request: { ...req },
    decision: structuredClone(decision),
    candidateId: 'test-candidate',
    policyId: 'test-policy',
    reasons: [],
    beliefThroughSeq: throughSeq,
    candidateScores: [],
  }
}

async function decideAndAcknowledge(
  agent: ReturnType<typeof createComposedAgent>,
  req: DecisionRequest,
  view: PlayerView,
) {
  const output = await agent.decide(req, view)
  const finalized = agent.finalizeAppliedTrace!({
    request: req,
    view,
    selectedDecision: output.decision,
    appliedDecision: output.decision,
    resolution: 'selected-applied',
    provisionalTrace: output.trace!,
  })
  return { output, finalized }
}

test('plan memory commits only after legality acknowledgment and returns a detached finalized trace', async () => {
  const { req, view } = firstRequest()
  const agent = createComposedAgent({ seed: 'phase7b2-fixture', planMemory: true })
  const output = await agent.decide(req, view)
  assert.equal(agent.planMemorySnapshot(), undefined)
  assert.equal(output.trace!.privatePlanOutcome, undefined)
  assert.equal(output.trace!.coherenceIntent, 'maintain')

  const finalized = agent.finalizeAppliedTrace!({
    request: req,
    view,
    selectedDecision: output.decision,
    appliedDecision: output.decision,
    resolution: 'selected-applied',
    provisionalTrace: output.trace!,
  })!
  assert.notEqual(finalized, output.trace)
  assert.equal(output.trace!.privatePlanOutcome, undefined)
  assert.equal(finalized.privatePlanOutcome!.resolution, 'selected-applied')
  assert.equal(finalized.privatePlanOutcome!.coherence.intent, 'maintain')
  assert.equal(
    finalized.privatePlanOutcome!.coherence.intent,
    finalized.coherenceIntent,
  )
  assert.equal(finalized.privatePlanOutcome!.coherence.classification, 'consistent')
  assert.ok(validateAppliedPlanOutcomeHostJoin(
    finalized.privatePlanOutcome,
    req,
    finalized.action,
    view,
  ))
  assert.equal(agent.planMemorySnapshot()!.history.length, 1)
})

test('selected, applied fallback, agent-error fallback, and supersession histories are explicit', async () => {
  const { req, view } = firstRequest('phase7b2-history')
  const agent = createComposedAgent({ seed: 'phase7b2-history', planMemory: true })
  const first = await agent.decide(req, view)
  const fallback = heuristicDecide(req, view, 'phase7b2-history')
  agent.finalizeAppliedTrace!({
    request: req,
    view,
    selectedDecision: first.decision,
    appliedDecision: fallback,
    resolution: 'fallback-after-illegal-decision',
    provisionalTrace: first.trace!,
  })
  assert.equal(
    agent.planMemorySnapshot()!.history[0].resolution,
    'fallback-after-illegal-decision',
  )

  const second = await agent.decide(req, view)
  agent.finalizeAppliedTrace!({
    request: req,
    view,
    selectedDecision: second.decision,
    appliedDecision: second.decision,
    resolution: 'selected-applied',
    provisionalTrace: second.trace!,
  })
  let memory = agent.planMemorySnapshot()!
  assert.equal(memory.history[0].status, 'superseded')
  assert.equal(memory.history[0].supersededBy, memory.history[1].id)
  assert.equal(memory.history[1].status, 'current')

  const errorAgent = createComposedAgent({
    seed: 'phase7b2-history',
    planMemory: true,
  })
  errorAgent.finalizeAppliedTrace!({
    request: req,
    view,
    appliedDecision: fallback,
    resolution: 'fallback-after-agent-error',
  })
  memory = errorAgent.planMemorySnapshot()!
  assert.equal(memory.history[0].selected, undefined)
  assert.equal(memory.history[0].resolution, 'fallback-after-agent-error')
})

test('plan memory retains illegal selected output syntax while applied decisions remain legal', () => {
  const { req, view } = firstRequest('phase7b2-illegal-memory')
  const illegal = { kind: 'propose', team: [] } as Decision
  const applied = heuristicDecide(req, view, 'phase7b2-illegal-memory')
  const memory = recordAppliedPlan({
    req,
    view,
    commitments: reconstructCognition(view).commitments,
    selectedDecision: illegal,
    selectedPlan: selectedPlan(
      req,
      illegal,
      Math.max(...view.events.map((event) => event.seq)),
    ),
    appliedDecision: applied,
    resolution: 'fallback-after-illegal-decision',
    intent: 'maintain',
  })
  assert.ok(validatePrivatePlanMemory(memory))
  assert.deepEqual(JSON.parse(JSON.stringify(memory)), memory)
  assert.deepEqual(memory.history[0].selected!.decision, illegal)
  assert.deepEqual(memory.history[0].appliedDecision, applied)
})

test('history is finite, monotonic, and retains one current entry', () => {
  const { req, view } = firstRequest('phase7b2-cap')
  const decision = heuristicDecide(req, view, 'phase7b2-cap')
  let memory: PrivatePlanMemory | undefined
  for (let index = 0; index < PLAN_MEMORY_HISTORY_LIMIT + 7; index++) {
    memory = recordAppliedPlan({
      memory,
      req,
      view,
      commitments: [],
      selectedDecision: decision,
      selectedPlan: selectedPlan(req, decision, -1),
      appliedDecision: decision,
      resolution: 'selected-applied',
      intent: 'maintain',
    })
  }
  assert.equal(memory!.history.length, PLAN_MEMORY_HISTORY_LIMIT)
  assert.equal(memory!.history.filter((entry) => entry.status === 'current').length, 1)
  assert.ok(validatePrivatePlanMemory(memory))
})

const teamBasis: LiteralCommitmentBasis = {
  id: 'commitment:team',
  sourceSeq: 3,
  actor: 0,
  kind: 'team',
  round: 1,
  proposalNum: 1,
  payload: { type: 'team', action: 'proposed', team: [0, 1] },
}
const coherenceReq: DecisionRequest = {
  kind: 'vote',
  seat: 0,
  round: 1,
  proposalNum: 1,
}

test('every literal conflict code has a narrow deterministic trigger', () => {
  const cases: Array<{
    decision: Decision
    basis: LiteralCommitmentBasis[]
    currentTeam?: Seat[]
    code: typeof COHERENCE_CONFLICT_CODES[number]
    kind?: DecisionRequest['kind']
  }> = [
    {
      decision: { kind: 'vote', vote: 'reject' },
      basis: [teamBasis],
      currentTeam: [0, 1],
      code: 'VOTE_OPPOSES_OWN_TEAM',
    },
    {
      decision: { kind: 'finalize', stick: false, team: [2, 3], reason: 'New evidence.' },
      basis: [teamBasis],
      currentTeam: [0, 1],
      code: 'TEAM_REVERSES_CURRENT_TEAM',
      kind: 'finalize',
    },
    {
      decision: { kind: 'finalize', stick: false, team: [0, 2] },
      basis: [teamBasis],
      currentTeam: [0, 1],
      code: 'REVISION_MISSING_EXPLANATION',
      kind: 'finalize',
    },
  ]
  for (const item of cases) {
    const assessment = assessLiteralCoherence(
      { ...coherenceReq, kind: item.kind ?? coherenceReq.kind },
      item.decision,
      'maintain',
      item.basis,
      item.currentTeam,
    )
    assert.ok(assessment.conflictCodes.includes(item.code), item.code)
  }
  const ordinaryRevision = assessLiteralCoherence(
    { ...coherenceReq, kind: 'finalize' },
    { kind: 'finalize', stick: false, team: [0, 2], reason: 'New evidence.' },
    'maintain',
    [teamBasis],
    [0, 1],
  )
  assert.deepEqual(ordinaryRevision.conflictCodes, [])
})

test('maintain, conceal, and deceive classify only detected literal conflicts', () => {
  const expected = new Map<CoherenceIntent, string>([
    ['maintain', 'accidental-conflict'],
    ['conceal', 'intentional-concealment'],
    ['deceive', 'strategic-deception'],
  ])
  for (const [intent, classification] of expected) {
    assert.equal(
      assessLiteralCoherence(
        coherenceReq,
        { kind: 'vote', vote: 'reject' },
        intent,
        [teamBasis],
        [0, 1],
      ).classification,
      classification,
    )
    assert.equal(
      assessLiteralCoherence(
        coherenceReq,
        { kind: 'vote', vote: 'approve' },
        intent,
        [teamBasis],
        [0, 1],
      ).classification,
      'consistent',
    )
  }
})

test('same-view replay and plan-memory-off decisions are byte-equivalent', async () => {
  const { req, view } = firstRequest('phase7b2-replay')
  const offAgent = createComposedAgent({
    seed: 'phase7b2-replay',
  })
  const off = await offAgent.decide(req, view)
  const offOutcome = {
    request: { ...req },
    view: structuredClone(view),
    selectedDecision: structuredClone(off.decision),
    appliedDecision: structuredClone(off.decision),
    resolution: 'selected-applied' as const,
    provisionalTrace: structuredClone(off.trace!),
  }
  const offFinalized = offAgent.finalizeAppliedTrace!(
    structuredClone(offOutcome),
  )!
  assert.deepEqual(offFinalized, off.trace)
  assert.ok(validateFinalizedAppliedTraceHostJoin(offFinalized, offOutcome))
  assert.equal(
    offFinalized.degradation.includes(APPLIED_OUTCOME_DEGRADATION),
    false,
  )
  const one = createComposedAgent({ seed: 'phase7b2-replay', planMemory: true })
  const two = createComposedAgent({ seed: 'phase7b2-replay', planMemory: true })
  const first = await decideAndAcknowledge(one, req, view)
  const second = await decideAndAcknowledge(two, req, structuredClone(view))
  assert.deepEqual(first.output.decision, off.decision)
  assert.deepEqual(second.output.decision, off.decision)
  assert.deepEqual(first.finalized, second.finalized)
})

test('plan-off acknowledgment records canonical normalized voice without degradation', async () => {
  const { game, req, view } = firstRequest('phase7b2-plan-off-canonical')
  const agent = createComposedAgent({
    seed: game.seed,
    voice: {
      version: 'phase7b2-long-voice-v1',
      async speak() {
        return { text: `seat 0 ${'x'.repeat(800)}` }
      },
    },
  })
  const output = await agent.decide(req, view)
  const applied = applyDecisionWithOutcome(
    game,
    req.seat,
    output.decision,
  ).appliedDecision
  assert.notDeepEqual(applied, output.decision)
  const hostOutcome = {
    request: { ...req },
    view: structuredClone(view),
    selectedDecision: structuredClone(output.decision),
    appliedDecision: structuredClone(applied),
    resolution: 'selected-applied' as const,
    provisionalTrace: structuredClone(output.trace!),
  }
  const finalized = agent.finalizeAppliedTrace!(
    structuredClone(hostOutcome),
  )!
  assert.deepEqual(finalized.action, applied)
  assert.ok(validateFinalizedAppliedTraceHostJoin(finalized, hostOutcome))
  assert.equal(
    finalized.degradation.includes(APPLIED_OUTCOME_DEGRADATION),
    false,
  )
})

test('sim acknowledges only after apply, swallows hook failure, and never leaks private plans', async () => {
  const game = createGame({
    seed: 'phase7b2-sim-hook',
    playerCount: 5,
    talk: false,
  })
  let acknowledgedLogLength = -1
  let threw = false
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => {
      const base = createAgent(
        { type: 'heuristic' },
        { seed: game.seed, seat: player.seat },
      )
      return [player.seat, {
        decide: base.decide.bind(base),
        finalizeAppliedTrace() {
          acknowledgedLogLength = game.log.length
          if (!threw) {
            threw = true
            throw new Error('private hook failed')
          }
          return undefined
        },
      }]
    }),
  )
  const result = await runGame({ game, agents })
  assert.equal(result.game.phase, 'gameOver')
  assert.ok(acknowledgedLogLength > 0)
  assert.doesNotMatch(
    JSON.stringify(result.game.log),
    /privatePlan|planMemory|coherence/,
  )
  assert.doesNotMatch(
    JSON.stringify(viewFor(result.game, 0)),
    /privatePlan|planMemory|coherence/,
  )
})

test('serialized plan outcomes reject forged history, coherence, and host joins', async () => {
  const { req, view } = firstRequest('phase7b2-forgery')
  const agent = createComposedAgent({
    seed: 'phase7b2-forgery',
    planMemory: true,
  })
  const { finalized } = await decideAndAcknowledge(agent, req, view)
  const outcome = finalized!.privatePlanOutcome!
  const forgedClass = structuredClone(outcome)
  forgedClass.coherence.classification = 'strategic-deception'
  assert.equal(validateAppliedPlanOutcomeHostJoin(
    forgedClass,
    req,
    forgedClass.appliedDecision,
    view,
  ), false)
  const forgedBasis = structuredClone(outcome)
  forgedBasis.coherence.commitmentBasis = [teamBasis]
  assert.equal(validateAppliedPlanOutcomeHostJoin(
    forgedBasis,
    req,
    forgedBasis.appliedDecision,
    view,
  ), false)
  assert.equal(validateAppliedPlanOutcomeHostJoin(
    outcome,
    { ...req, proposalNum: req.proposalNum + 1 },
    outcome.appliedDecision,
    view,
  ), false)
  assert.deepEqual(
    parseStdioDecisionReply(
      req,
      { decision: finalized!.action, trace: finalized },
      'premature plan-memory child',
      view,
    ),
    { decision: finalized!.action },
  )
})

test('public cognition and live server source retain the private post-apply boundary', () => {
  const { view } = firstRequest('phase7b2-public')
  const projection = publicCognition(reconstructCognition(view))
  assert.doesNotMatch(JSON.stringify(projection), /planMemory|coherence/)
  const serverSource = readFileSync(
    new URL('../server/server.ts', import.meta.url),
    'utf8',
  )
  const applyAt = serverSource.indexOf(
    'appliedDecision = applyDecisionWithOutcome(',
  )
  const recordAt = serverSource.indexOf('recordAppliedDecision({', applyAt)
  assert.ok(applyAt >= 0 && recordAt > applyAt)
  // The lifecycle hook has exactly one caller, the owned helper, so no host can
  // reach it before the engine has accepted an action.
  for (const host of ['../server/server.ts', '../server/sim/runner.ts']) {
    assert.doesNotMatch(
      readFileSync(new URL(host, import.meta.url), 'utf8'),
      /\.finalizeAppliedTrace\(/,
    )
  }
})

test('engine outcome reports canonical good cards, teams, and speech', () => {
  const game = createGame({
    seed: 'phase7b2-engine-outcome',
    playerCount: 5,
    talk: { maxRounds: 2, maxRoundsAfterChange: 1, leaderInDiscussion: 'last' },
  })
  let leaderChecked = false
  let goodQuestChecked = false
  while (game.phase !== 'gameOver' && (!leaderChecked || !goodQuestChecked)) {
    const req = expectedDecisions(game)[0]
    const view = viewFor(game, req.seat)
    if (req.kind === 'discuss' && req.seat === game.leaderSeat) {
      const result = applyDecisionWithOutcome(game, req.seat, {
        kind: 'discuss',
        say: `seat 0 ${'x'.repeat(800)}`,
      })
      assert.equal(result.appliedDecision.kind, 'discuss')
      assert.ok(result.appliedDecision.say.length <= 600)
      assert.doesNotMatch(result.appliedDecision.say, /seat 0/i)
      leaderChecked = true
      continue
    }
    if (req.kind === 'quest' && view.alignment === 'good') {
      const result = applyDecisionWithOutcome(game, req.seat, {
        kind: 'quest',
        card: 'fail',
      })
      assert.deepEqual(result.appliedDecision, {
        kind: 'quest',
        card: 'success',
      })
      goodQuestChecked = true
      continue
    }
    applyDecision(game, req.seat, heuristicDecide(req, view, game.seed))
  }
  assert.ok(leaderChecked && goodQuestChecked)
})

test('illegal decisions emit no rejected preamble and fallback replay stays canonical', async () => {
  const game = createGame({
    seed: 'phase7b2-transactional-illegal',
    playerCount: 5,
    talk: false,
  })
  const req = expectedDecisions(game)[0]
  const view = viewFor(game, req.seat)
  const before = game.log.length
  assert.throws(
    () => applyDecisionWithOutcome(game, req.seat, {
      kind: 'propose',
      team: [req.seat, 99],
      thinking: 'rejected private reasoning',
      notes: 'rejected private scratchpad',
    }),
    /invalid seat/,
  )
  assert.equal(game.log.length, before)

  const fallback: Decision = {
    ...heuristicDecide(req, view, game.seed),
    thinking: 'fallback private reasoning',
    notes: 'fallback private scratchpad',
  }
  const runtime = applyDecisionWithOutcome(game, req.seat, fallback)
  assert.deepEqual(
    game.log.slice(before).map((event) => event.type),
    ['thinking', 'scratchpad', 'proposal'],
  )
  assert.doesNotMatch(JSON.stringify(game.log), /rejected private/)

  const agents = new Map<Seat, AvalonAgent>(game.players.map((player) => [
    player.seat,
    createAgent(
      { type: 'heuristic' },
      { seed: game.seed, seat: player.seat },
    ),
  ]))
  const completed = await runGame({ game, agents })
  const artifact = toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: completed.degraded,
    steps: completed.steps + 1,
  })
  const proposal = artifact.log.find(
    (event) => event.type === 'proposal'
      && event.payload.leader === req.seat
      && event.payload.round === req.round,
  )!
  assert.deepEqual(
    snapshotAt(artifact, proposal.seq).original,
    runtime.appliedDecision,
  )
})

test('engine snapshots accessor decisions once before legality and preamble', async () => {
  const game = createGame({
    seed: 'phase7b2-accessor-snapshot',
    playerCount: 5,
    talk: false,
  })
  const req = expectedDecisions(game)[0]
  const view = viewFor(game, req.seat)
  const legal = heuristicDecide(req, view, game.seed)
  assert.equal(legal.kind, 'propose')
  let teamReads = 0
  const supplied: Record<string, unknown> = {
    kind: 'propose',
    thinking: 'single snapshot reasoning',
    notes: 'single snapshot notes',
  }
  Object.defineProperty(supplied, 'team', {
    enumerable: true,
    get() {
      teamReads++
      return teamReads === 1 ? legal.team : [req.seat, 99]
    },
  })
  const runtime = applyDecisionWithOutcome(
    game,
    req.seat,
    supplied as Decision,
  )
  assert.equal(teamReads, 1)
  assert.deepEqual(
    game.log.slice(-3).map((event) => event.type),
    ['thinking', 'scratchpad', 'proposal'],
  )
  assert.deepEqual(runtime.appliedDecision, {
    kind: 'propose',
    team: legal.team,
    thinking: 'single snapshot reasoning',
    notes: 'single snapshot notes',
  })
})

test('runtime host outcome is immutable against hook mutation and forgery degrades', async () => {
  const game = createGame({
    seed: 'phase7b2-mutating-hook',
    playerCount: 5,
    talk: false,
  })
  const target = game.leaderSeat
  const traces: import('../server/agents/trace.ts').DecisionTrace[] = []
  const inner = createComposedAgent({ seed: game.seed, planMemory: true })
  const agents = new Map<Seat, AvalonAgent>(game.players.map((player) => [
    player.seat,
    player.seat === target
      ? {
          decide: inner.decide.bind(inner),
          finalizeAppliedTrace(outcome) {
            outcome.resolution = 'fallback-after-illegal-decision'
            outcome.selectedDecision = {
              kind: 'propose',
              team: [3, 4],
            }
            return inner.finalizeAppliedTrace!(outcome)
          },
        }
      : createAgent(
          { type: 'heuristic' },
          { seed: game.seed, seat: player.seat },
        ),
  ]))
  await runGame({ game, agents, onDecisionTrace: (trace) => traces.push(trace) })
  assert.ok(traces.length > 0)
  assert.ok(traces.every(
    (trace) =>
      trace.privatePlanOutcome === undefined
      && trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION),
  ))
})

test('finalized traces cannot mutate provisional stable telemetry', async () => {
  const mutations: Array<{
    name: string
    mutate: (trace: any) => void
  }> = [
    {
      name: 'decision identity',
      mutate: (trace) => { trace.decisionId += ':forged' },
    },
    {
      name: 'belief cursor',
      mutate: (trace) => { trace.beliefThroughSeq += 1 },
    },
    {
      name: 'component versions',
      mutate: (trace) => { trace.componentVersions.policy = 'forged-policy' },
    },
    {
      name: 'belief marginals',
      mutate: (trace) => { trace.beliefPlayerMarginals = [] },
    },
    {
      name: 'reason codes',
      mutate: (trace) => { trace.reasonCodes = [...trace.reasonCodes, 'forged'] },
    },
    {
      name: 'candidate telemetry',
      mutate: (trace) => { trace.candidateScores = [] },
    },
  ]
  for (const [index, probe] of mutations.entries()) {
    const { req, view } = firstRequest(`phase7b2-stable-${index}`)
    const agent = createComposedAgent({
      seed: `phase7b2-stable-${index}`,
      planMemory: true,
    })
    const output = await agent.decide(req, view)
    const hostOutcome = {
      request: { ...req },
      view: structuredClone(view),
      selectedDecision: structuredClone(output.decision),
      appliedDecision: structuredClone(output.decision),
      resolution: 'selected-applied' as const,
      provisionalTrace: structuredClone(output.trace!),
    }
    const supplied = structuredClone(hostOutcome)
    probe.mutate(supplied.provisionalTrace)
    if (probe.name === 'decision identity') {
      assert.throws(
        () => agent.finalizeAppliedTrace!(supplied),
        /does not match the pending selected plan/,
      )
      const recovered = agent.finalizeAppliedTrace!(
        structuredClone(hostOutcome),
      )!
      assert.equal(
        validateFinalizedAppliedTraceHostJoin(recovered, hostOutcome),
        true,
      )
      continue
    }
    const finalized = agent.finalizeAppliedTrace!(supplied)!
    assert.equal(
      validateFinalizedAppliedTraceHostJoin(finalized, hostOutcome),
      false,
      probe.name,
    )
  }
})

test('untouched provisional trace owns plan enablement and coherence intent', async () => {
  const enabledSource = firstRequest('phase7b2-plan-ownership-enabled')
  const enabled = createComposedAgent({
    seed: 'phase7b2-plan-ownership-enabled',
    planMemory: true,
    coherenceIntent: 'conceal',
  })
  const selected = await enabled.decide(
    enabledSource.req,
    enabledSource.view,
  )
  const enabledOutcome = {
    request: { ...enabledSource.req },
    view: structuredClone(enabledSource.view),
    selectedDecision: structuredClone(selected.decision),
    appliedDecision: structuredClone(selected.decision),
    resolution: 'selected-applied' as const,
    provisionalTrace: structuredClone(selected.trace!),
  }
  const finalized = enabled.finalizeAppliedTrace!(
    structuredClone(enabledOutcome),
  )!
  assert.equal(finalized.coherenceIntent, 'conceal')
  assert.equal(finalized.privatePlanOutcome!.coherence.intent, 'conceal')
  assert.ok(validateFinalizedAppliedTraceHostJoin(finalized, enabledOutcome))

  const demoted = structuredClone(finalized)
  delete demoted.componentVersions!.planMemory
  delete demoted.componentVersions!.coherence
  delete demoted.coherenceIntent
  delete demoted.privatePlanOutcome
  assert.equal(
    validateFinalizedAppliedTraceHostJoin(demoted, enabledOutcome),
    false,
  )

  const relabeled = structuredClone(finalized)
  relabeled.coherenceIntent = 'maintain'
  relabeled.privatePlanOutcome!.coherence = assessLiteralCoherence(
    relabeled.privatePlanOutcome!.request,
    relabeled.privatePlanOutcome!.appliedDecision,
    'maintain',
    relabeled.privatePlanOutcome!.coherence.commitmentBasis,
    relabeled.privatePlanOutcome!.coherence.currentTeam,
  )
  assert.equal(
    validateFinalizedAppliedTraceHostJoin(relabeled, enabledOutcome),
    false,
  )

  const offSource = firstRequest('phase7b2-plan-ownership-off')
  const off = createComposedAgent({ seed: 'phase7b2-plan-ownership-off' })
  const offSelected = await off.decide(
    offSource.req,
    offSource.view,
  )
  const offOutcome = {
    request: { ...offSource.req },
    view: structuredClone(offSource.view),
    selectedDecision: structuredClone(offSelected.decision),
    appliedDecision: structuredClone(offSelected.decision),
    resolution: 'selected-applied' as const,
    provisionalTrace: structuredClone(offSelected.trace!),
  }
  const promoted = off.finalizeAppliedTrace!(
    structuredClone(offOutcome),
  )!
  promoted.componentVersions = {
    ...promoted.componentVersions!,
    planMemory: PLAN_MEMORY_VERSION,
    coherence: COHERENCE_MODEL_VERSION,
  }
  promoted.coherenceIntent = 'maintain'
  assert.equal(
    validateFinalizedAppliedTraceHostJoin(promoted, offOutcome),
    false,
  )
})

test('uncloneable provisional telemetry and a throwing hook cannot re-enter legality', async () => {
  const game = createGame({
    seed: 'phase7b2-uncloneable',
    playerCount: 5,
    talk: false,
  })
  let first = true
  const agents = new Map<Seat, AvalonAgent>(game.players.map((player) => [
    player.seat,
    {
      async decide(req, view) {
        const decision = heuristicDecide(req, view, game.seed)
        if (!first) return decision
        first = false
        return {
          decision,
          trace: {
            action: decision,
            uncloneable() {},
          } as never,
        }
      },
      finalizeAppliedTrace() {
        throw new Error('telemetry failed after apply')
      },
    },
  ]))
  const result = await runGame({ game, agents })
  assert.equal(result.game.phase, 'gameOver')
})

test('external plan validators are total, dense, exact, and byte bounded', async () => {
  const { req, view } = firstRequest('phase7b2-hardening')
  const agent = createComposedAgent({
    seed: 'phase7b2-hardening',
    planMemory: true,
  })
  await decideAndAcknowledge(agent, req, view)
  const memory = agent.planMemorySnapshot()!
  const probes: unknown[] = []
  const sparseApplied = structuredClone(memory)
  sparseApplied.history[0].appliedDecision = {
    kind: 'propose',
    team: Array(1),
  }
  probes.push(sparseApplied)
  const hugeCandidate = structuredClone(memory)
  hugeCandidate.history[0].selected!.plan!.candidateId = 'x'.repeat(1_000_000)
  probes.push(hugeCandidate)
  const hugePitch = structuredClone(memory)
  hugePitch.history[0].appliedDecision = {
    kind: 'propose',
    team: [0, 1],
    pitch: 'x'.repeat(1_000_000),
  }
  probes.push(hugePitch)
  const selectedExtra = structuredClone(memory) as any
  selectedExtra.history[0].selected.decision.forged = true
  probes.push(selectedExtra)
  for (const numeric of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const unstable = structuredClone(memory)
    unstable.history[0].selected!.decision = {
      kind: 'propose',
      team: [0, numeric],
    }
    probes.push(unstable)
  }
  const sparseBasis = structuredClone(memory)
  sparseBasis.history[0].coherence.commitmentBasis = Array(1)
  const hiddenArrayExpando = structuredClone(memory) as any
  assert.equal(hiddenArrayExpando.history[0].appliedDecision.kind, 'propose')
  const expandoTeam = hiddenArrayExpando.history[0].appliedDecision.team
  delete expandoTeam[expandoTeam.length - 1]
  expandoTeam.hidden = 'x'.repeat(PLAN_MEMORY_SERIALIZED_LIMIT + 1)
  assert.equal(
    Buffer.byteLength(expandoTeam.hidden, 'utf8'),
    PLAN_MEMORY_SERIALIZED_LIMIT + 1,
  )
  assert.equal(Object.keys(expandoTeam).length, expandoTeam.length)
  probes.push(hiddenArrayExpando)
  probes.push(sparseBasis, {
    ...structuredClone(memory),
    history: [null],
  })
  for (const probe of probes) {
    assert.doesNotThrow(() => validatePrivatePlanMemory(probe))
    assert.equal(validatePrivatePlanMemory(probe), false)
  }

  const legalCoordinates = structuredClone(memory) as any
  legalCoordinates.viewerSeat = 9
  legalCoordinates.history[0].request.seat = 9
  legalCoordinates.history[0].request.round = 5
  legalCoordinates.history[0].request.proposalNum = 5
  legalCoordinates.history[0].id = legalCoordinates.history[0].id
    .replace(/^applied-plan:\d+:/, 'applied-plan:9:')
    .replace(/:q\d+:/, ':q5:')
    .replace(/:p\d+:/, ':p5:')
  for (const basis of legalCoordinates.history[0].coherence.commitmentBasis) {
    basis.actor = 9
    basis.round = 5
    basis.proposalNum = 5
  }
  assert.equal(validatePrivatePlanMemory(legalCoordinates), true)

  const outOfRangeSeat = structuredClone(legalCoordinates)
  outOfRangeSeat.viewerSeat = 999
  outOfRangeSeat.history[0].request.seat = 999
  outOfRangeSeat.history[0].id = outOfRangeSeat.history[0].id
    .replace(/^applied-plan:\d+:/, 'applied-plan:999:')
  for (const basis of outOfRangeSeat.history[0].coherence.commitmentBasis) {
    basis.actor = 999
  }
  const outOfRangeRound = structuredClone(legalCoordinates)
  outOfRangeRound.history[0].request.round = 999
  outOfRangeRound.history[0].id = outOfRangeRound.history[0].id
    .replace(/:q\d+:/, ':q999:')
  for (const basis of outOfRangeRound.history[0].coherence.commitmentBasis) {
    basis.round = 999
  }
  const outOfRangeProposal = structuredClone(legalCoordinates)
  outOfRangeProposal.history[0].request.proposalNum = 999
  outOfRangeProposal.history[0].id = outOfRangeProposal.history[0].id
    .replace(/:p\d+:/, ':p999:')
  for (const basis of outOfRangeProposal.history[0].coherence.commitmentBasis) {
    basis.proposalNum = 999
  }
  for (const outOfRange of [
    outOfRangeSeat,
    outOfRangeRound,
    outOfRangeProposal,
  ]) {
    assert.equal(validatePrivatePlanMemory(outOfRange), false)
  }

  const expandedMemory = (fill: string): PrivatePlanMemory => {
    const template = structuredClone(memory.history[0]) as any
    template.selected.decision.thinking = fill.repeat(6_000)
    template.selected.decision.notes = fill.repeat(6_000)
    template.appliedDecision.thinking = fill.repeat(7_000)
    template.appliedDecision.notes = fill.repeat(7_000)
    const stem = template.id.replace(/:n\d+$/, '')
    const history = Array.from(
      { length: PLAN_MEMORY_HISTORY_LIMIT },
      (_, ordinal) => {
        const entry = structuredClone(template)
        entry.id = `${stem}:n${ordinal}`
        entry.status = ordinal === PLAN_MEMORY_HISTORY_LIMIT - 1
          ? 'current'
          : 'superseded'
        if (entry.status === 'current') delete entry.supersededBy
        else entry.supersededBy = `${stem}:n${ordinal + 1}`
        return entry
      },
    )
    return {
      ...structuredClone(memory),
      nextOrdinal: PLAN_MEMORY_HISTORY_LIMIT,
      history,
    }
  }
  const ascii = expandedMemory('a')
  const multibyte = expandedMemory('界')
  const asciiEncoded = JSON.stringify(ascii)
  const multibyteEncoded = JSON.stringify(multibyte)
  assert.equal(asciiEncoded.length, multibyteEncoded.length)
  assert.ok(multibyteEncoded.length < PLAN_MEMORY_SERIALIZED_LIMIT)
  assert.ok(Buffer.byteLength(multibyteEncoded, 'utf8')
    > PLAN_MEMORY_SERIALIZED_LIMIT)
  assert.equal(validatePrivatePlanMemory(ascii), true)
  assert.equal(validatePrivatePlanMemory(multibyte), false)
  assert.deepEqual(JSON.parse(JSON.stringify(ascii)), ascii)

  const inheritedToJson = structuredClone(ascii)
  Object.setPrototypeOf(inheritedToJson, {
    toJSON() {
      return '界'.repeat(PLAN_MEMORY_SERIALIZED_LIMIT + 1)
    },
  })
  const hiddenToJson = structuredClone(ascii)
  Object.defineProperty(hiddenToJson, 'toJSON', {
    enumerable: false,
    value() {
      return '界'.repeat(PLAN_MEMORY_SERIALIZED_LIMIT + 1)
    },
  })
  for (const forged of [inheritedToJson, hiddenToJson]) {
    assert.doesNotThrow(() => validatePrivatePlanMemory(forged))
    assert.equal(validatePrivatePlanMemory(forged), false)
  }
})

test('stdio cannot claim post-legality degradation before apply', async () => {
  const { req, view } = firstRequest('phase7b2-stdio-temporal')
  const output = await createComposedAgent({
    seed: 'phase7b2-stdio-temporal',
  }).decide(req, view)
  const forgedIntent = structuredClone(output)
  forgedIntent.trace!.coherenceIntent = 'maintain'
  assert.deepEqual(
    parseStdioDecisionReply(
      req,
      forgedIntent,
      'premature intent child',
      view,
    ),
    { decision: forgedIntent.decision },
  )
  output.trace!.degradation = [
    ...output.trace!.degradation,
    APPLIED_OUTCOME_DEGRADATION,
  ]
  assert.deepEqual(
    parseStdioDecisionReply(
      req,
      { decision: output.decision, trace: output.trace },
      'premature degraded child',
      view,
    ),
    { decision: output.decision },
  )
})

test('agent-error fallback memory uses each exact supplied view without belief inference', async () => {
  const game = createGame({
    seed: 'phase7b2-failing-belief',
    playerCount: 5,
    talk: false,
  })
  const target = game.leaderSeat
  const inner = createComposedAgent({
    seed: game.seed,
    planMemory: true,
    beliefModel: {
      version: 'failing-belief-v1',
      factorsVersion: 'off',
      infer() {
        throw new Error('belief unavailable')
      },
    },
  })
  const outcomes: import('../server/agents/types.ts').AppliedDecisionOutcome[] = []
  const agents = new Map<Seat, AvalonAgent>(game.players.map((player) => [
    player.seat,
    player.seat === target
      ? {
          decide: inner.decide.bind(inner),
          finalizeAppliedTrace(outcome) {
            outcomes.push(structuredClone(outcome))
            return inner.finalizeAppliedTrace!(outcome)
          },
        }
      : createAgent(
          { type: 'heuristic' },
          { seed: game.seed, seat: player.seat },
        ),
  ]))
  await runGame({ game, agents })
  const memory = inner.planMemorySnapshot()!
  assert.equal(memory.history.length, outcomes.length)
  for (let index = 0; index < memory.history.length; index++) {
    const outcome = outcomes[index]
    const detached = structuredClone(memory.history[index])
    detached.status = 'current'
    delete detached.supersededBy
    assert.ok(validateAppliedPlanOutcomeHostJoin(
      detached,
      outcome.request,
      outcome.appliedDecision,
      outcome.view,
    ))
  }
})

function planMemoryVariant(): ArchitectureVariant {
  return {
    id: 'phase7b2-plan-memory',
    paid: false,
    components: {
      mode: 'compatibility',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'off',
      planMemory: PLAN_MEMORY_VERSION,
      coherence: COHERENCE_MODEL_VERSION,
      coherenceIntent: 'maintain',
      policy: 'composed-policy-v1',
      scorer: 'compatibility-scorer-v1',
      planner: 'planner-off',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      planMemory: true,
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
}

test('artifacts, architecture bench, and report bind finalized plan attribution to replayed views', async () => {
  const [artifact] = await runArchitectureBench({
    variants: [planMemoryVariant()],
    cases: ARCHITECTURE_BANK.slice(0, 1),
    bankId: 'phase7b2-plan-attribution',
  })
  assert.deepEqual(
    artifact.strategyVersions?.planMemories,
    [PLAN_MEMORY_VERSION],
  )
  assert.deepEqual(
    artifact.strategyVersions?.coherences,
    [COHERENCE_MODEL_VERSION],
  )
  assert.equal(
    architectureReport([artifact]).variants[0]
      .safety.traceAttributionViolations,
    0,
  )

  const forged = structuredClone(artifact)
  const outcome = forged.decisionTraces![0].privatePlanOutcome!
  outcome.coherence.currentTeam = [0, 1]
  outcome.coherence = assessLiteralCoherence(
    outcome.request,
    outcome.appliedDecision,
    outcome.coherence.intent,
    outcome.coherence.commitmentBasis,
    outcome.coherence.currentTeam,
  )
  assert.ok(
    architectureReport([forged]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const forgedResolution = structuredClone(artifact)
  const resolutionOutcome =
    forgedResolution.decisionTraces![0].privatePlanOutcome!
  resolutionOutcome.resolution = 'fallback-after-illegal-decision'
  resolutionOutcome.selected!.decision = {
    kind: 'propose',
    team: [3, 4],
  }
  assert.ok(
    architectureReport([forgedResolution]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const forgedApplied = structuredClone(artifact)
  const appliedTrace = forgedApplied.decisionTraces!.find(
    (trace) => trace.action.kind === 'vote',
  )!
  const forgedVote = appliedTrace.action.kind === 'vote'
    && appliedTrace.action.vote === 'approve' ? 'reject' : 'approve'
  appliedTrace.action = { kind: 'vote', vote: forgedVote }
  appliedTrace.privatePlanOutcome!.appliedDecision = {
    kind: 'vote',
    vote: forgedVote,
  }
  appliedTrace.privatePlanOutcome!.coherence = assessLiteralCoherence(
    appliedTrace.request,
    appliedTrace.privatePlanOutcome!.appliedDecision,
    appliedTrace.privatePlanOutcome!.coherence.intent,
    appliedTrace.privatePlanOutcome!.coherence.commitmentBasis,
    appliedTrace.privatePlanOutcome!.coherence.currentTeam,
  )
  assert.ok(
    architectureReport([forgedApplied]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const forgedSelectedVote = structuredClone(artifact)
  const selectedVote = forgedSelectedVote.decisionTraces!.find(
    (trace) =>
      trace.privatePlanOutcome?.resolution === 'selected-applied'
      && trace.privatePlanOutcome.selected?.decision.kind === 'vote',
  )!
  const selectedVoteDecision =
    selectedVote.privatePlanOutcome!.selected!.decision
  if (selectedVoteDecision.kind !== 'vote') {
    throw new Error('expected selected vote outcome')
  }
  selectedVoteDecision.vote = selectedVoteDecision.vote === 'approve'
    ? 'reject'
    : 'approve'
  assert.ok(
    architectureReport([forgedSelectedVote]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const relabeledIntent = structuredClone(artifact)
  relabeledIntent.decisionTraces![0].coherenceIntent = 'conceal'
  const relabeledOutcome =
    relabeledIntent.decisionTraces![0].privatePlanOutcome!
  relabeledOutcome.coherence = assessLiteralCoherence(
    relabeledOutcome.request,
    relabeledOutcome.appliedDecision,
    'conceal',
    relabeledOutcome.coherence.commitmentBasis,
    relabeledOutcome.coherence.currentTeam,
  )
  assert.ok(
    architectureReport([relabeledIntent]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const forgedStatus = structuredClone(artifact)
  forgedStatus.decisionTraces![0].privatePlanOutcome!.status = 'superseded'
  forgedStatus.decisionTraces![0].privatePlanOutcome!.supersededBy =
    'forged-successor'
  assert.ok(
    architectureReport([forgedStatus]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  for (const missingIndex of [
    0,
    Math.floor(artifact.decisionTraces!.length / 2),
  ]) {
    const incomplete = structuredClone(artifact)
    incomplete.decisionTraces!.splice(missingIndex, 1)
    assert.ok(
      architectureReport([incomplete]).variants[0]
        .safety.traceAttributionViolations > 0,
    )
  }
  const duplicated = structuredClone(artifact)
  duplicated.decisionTraces!.push(
    structuredClone(duplicated.decisionTraces![0]),
  )
  assert.ok(
    architectureReport([duplicated]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const extra = structuredClone(artifact)
  const extraTrace = structuredClone(extra.decisionTraces![0])
  extraTrace.decisionId += ':extra'
  extra.decisionTraces!.push(extraTrace)
  assert.ok(
    architectureReport([extra]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const historicalOff = structuredClone(artifact)
  delete historicalOff.architecture!.components.planMemory
  delete historicalOff.architecture!.components.coherence
  delete historicalOff.architecture!.components.coherenceIntent
  delete historicalOff.strategyVersions!.planMemories
  delete historicalOff.strategyVersions!.coherences
  historicalOff.strategyVersions!.decisionComponents = {
    schema: 1,
    seats: [{
      seat: historicalOff.architecture!.targetSeat,
      plan: structuredClone(
        historicalOff.decisionTraces![0].componentPlan!,
      ),
    }],
  }
  delete historicalOff.strategyVersions!.resolvedArchitecture
  for (const trace of historicalOff.decisionTraces ?? []) {
    delete trace.componentVersions!.planMemory
    delete trace.componentVersions!.coherence
    delete trace.privatePlanOutcome
    delete trace.coherenceIntent
  }
  assert.equal(
    architectureReport([historicalOff]).variants[0]
      .safety.traceAttributionViolations,
    0,
  )
  const missingTraces = structuredClone(artifact)
  delete missingTraces.decisionTraces
  assert.ok(
    architectureReport([missingTraces]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const mutating = planMemoryVariant()
  mutating.id = 'phase7b2-mutating-bench'
  mutating.createTargetAgent = (context) => {
    const inner = createComposedAgent({
      seed: context.seed,
      planMemory: true,
    })
    return {
      decide: inner.decide.bind(inner),
      privateTraceSink(trace) {
        context.onDecisionTrace?.(trace)
      },
      finalizeAppliedTrace(outcome) {
        outcome.resolution = 'fallback-after-illegal-decision'
        return inner.finalizeAppliedTrace!(outcome)
      },
    }
  }
  const [degradedArtifact] = await runArchitectureBench({
    variants: [mutating],
    cases: ARCHITECTURE_BANK.slice(0, 1),
    bankId: 'phase7b2-mutating-host-outcome',
  })
  assert.ok(degradedArtifact.decisionTraces!.every(
    (trace) =>
      trace.privatePlanOutcome === undefined
      && trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION),
  ))
  assert.equal(
    architectureReport([degradedArtifact]).variants[0]
      .safety.traceAttributionViolations,
    0,
  )
  const forgedDegraded = structuredClone(degradedArtifact)
  const degradedVote = forgedDegraded.decisionTraces!.find(
    (trace) => trace.action.kind === 'vote',
  )!
  if (degradedVote.action.kind !== 'vote') {
    throw new Error('expected degraded vote trace')
  }
  degradedVote.action.vote = degradedVote.action.vote === 'approve'
    ? 'reject'
    : 'approve'
  assert.ok(
    architectureReport([forgedDegraded]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
})

test('architecture bench rejects generation-time target trace drops', async () => {
  const dropping = planMemoryVariant()
  dropping.id = 'phase7b2-dropping-trace'
  dropping.createTargetAgent = (context) => {
    const inner = createComposedAgent({
      seed: context.seed,
      planMemory: true,
    })
    let emitted = 0
    return {
      decide: inner.decide.bind(inner),
      finalizeAppliedTrace:
        inner.finalizeAppliedTrace!.bind(inner),
      privateTraceSink(trace) {
        emitted++
        if (emitted !== 2) context.onDecisionTrace?.(trace)
      },
    }
  }
  await assert.rejects(
    () => runArchitectureBench({
      variants: [dropping],
      cases: ARCHITECTURE_BANK.slice(0, 1),
      bankId: 'phase7b2-generation-drop',
    }),
    /exactly one trace per target decision/,
  )

  const missingIntent = planMemoryVariant()
  missingIntent.id = 'phase7b2-missing-intent'
  delete missingIntent.components.coherenceIntent
  await assert.rejects(
    () => runArchitectureBench({
      variants: [missingIntent],
      cases: ARCHITECTURE_BANK.slice(0, 1),
      bankId: 'phase7b2-missing-intent',
    }),
    /coherenceIntent iff plan memory|plan-memory\/coherence\/intent/,
  )
})
