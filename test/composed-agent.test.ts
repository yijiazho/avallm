import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createComposedAgent } from '../server/agents/composed.ts'
import { createHeuristicAgent } from '../server/agents/heuristic.ts'
import { createRandomAgent } from '../server/agents/random.ts'
import {
  goodProposalScorer,
  compatibilityCandidateScores,
} from '../server/agents/policy/score.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import { createAgent } from '../server/agents/registry.ts'
import { parseExternalDecisionReply } from '../server/agents/external-reply.ts'
import { decisionTraceIdForRequest } from '../server/agents/trace.ts'
import { DECISION_COMPONENT_RUN_VERSION } from '../server/agents/components/kernel.ts'
import {
  ACTOR_TARGET_TREATMENT_COMPONENT,
} from '../server/agents/components/native-role-components.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { createGame } from '../server/engine/game.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../server/engine/types.ts'
import { runGame } from '../server/sim/runner.ts'

const fixture = (id: string) =>
  readDecisionFixtures().find((candidate) => candidate.id === id)!

async function composedDecision(
  id: string,
  options: Parameters<typeof createComposedAgent>[0],
) {
  const source = fixture(id)
  const agent = createComposedAgent(options)
  const output = await agent.decide(source.req, source.view)
  return { source, agent, output }
}

test('composed engine runs in ownership order and attributes every component', async () => {
  const stages: string[] = []
  const { output } = await composedDecision('merlin-opening-proposal', {
    seed: 'composed-order',
    planner: {
      version: 'fake-planner-v1',
      async choose(input) {
        assert.ok(input.renderedContext.includes('forcedPolicy'))
        assert.ok(input.context.viableCandidates.length)
        return { candidateId: input.structuredCandidateId }
      },
    },
    voice: {
      version: 'fake-voice-v1',
      async speak() {
        return { text: 'A concise pitch.' }
      },
    },
    onStage: (stage) => stages.push(stage),
  })
  assert.deepEqual(stages, [
    'cognition',
    'candidates',
    'analysis',
    'forced-policy',
    'scoring',
    'planner',
    'plan-committed',
    'voice',
  ])
  assert.deepEqual(output.trace!.componentVersions, {
    brain: 'brain-spec-v1',
    belief: 'exact-constraints-v1',
    beliefVisibility: 'none',
    factors: 'off',
    languageEvidence: 'off',
    observerModel: 'off',
    analysis: 'situation-analysis-v2',
    candidates: 'legal-candidates-v2',
    forcedPolicy: 'forced-policy-v1',
    policy: 'composed-policy-v1',
    scorer: 'compatibility-scorer-v1',
    planner: 'fake-planner-v1',
    prompt: 'composed-typed-context-v2',
    renderer: 'composed-policy-renderer-v2',
    communication: 'plan-voice-v2',
    voice: 'fake-voice-v1',
    decisionComponents: DECISION_COMPONENT_RUN_VERSION,
  })
  assert.ok(output.trace!.candidateScores?.length)
  assert.ok(output.trace!.chosenCandidateId)
  assert.equal(output.trace!.decisionPlanVersion, 'decision-plan-v2')
  assert.equal(output.trace!.forcedPolicyResult?.version, 'forced-policy-v1')
  assert.ok(output.trace!.forcedPolicyResult?.allowedCandidateIds.length)
  assert.deepEqual(
    output.trace!.relevantTeam?.team,
    (output.decision as Extract<Decision, { kind: 'propose' }>).team,
  )
  assert.ok(Number.isFinite(output.trace!.relevantTeam!.cleanProbability))
})

test('generic observer roots stage only on causal use', async () => {
  const proposal = fixture('merlin-opening-proposal')
  const baseline = await createComposedAgent({
    seed: proposal.source.seed,
  }).decide(proposal.req, proposal.view)
  const genericStages: string[] = []
  const generic = await createComposedAgent({
    seed: proposal.source.seed,
    decisionComponents: [ACTOR_TARGET_TREATMENT_COMPONENT],
    onStage: (stage) => genericStages.push(stage),
  }).decide(proposal.req, proposal.view)
  assert.deepEqual(generic.decision, baseline.decision)
  assert.ok(
    genericStages.indexOf('observer')
      > genericStages.indexOf('candidates'),
  )

  const legacyStages: string[] = []
  await createComposedAgent({
    seed: proposal.source.seed,
    publicObserver: true,
    decisionComponents: [ACTOR_TARGET_TREATMENT_COMPONENT],
    onStage: (stage) => legacyStages.push(stage),
  }).decide(proposal.req, proposal.view)
  assert.ok(
    legacyStages.indexOf('observer')
      < legacyStages.indexOf('analysis'),
  )

  const quest = readDecisionFixtures().find(
    (candidate) => candidate.req.kind === 'quest',
  )
  assert.ok(quest)
  const inapplicableStages: string[] = []
  const inapplicable = await createComposedAgent({
    seed: quest.source.seed,
    decisionComponents: [ACTOR_TARGET_TREATMENT_COMPONENT],
    onStage: (stage) => inapplicableStages.push(stage),
  }).decide(quest.req, quest.view)
  assert.equal(
    inapplicable.trace!.components!.entries[0].status,
    'inapplicable',
  )
  assert.equal(inapplicableStages.includes('observer'), false)
})

test('candidate scoring is deterministic and JSON-safe', async () => {
  const source = fixture('merlin-opening-proposal')
  let first: ReturnType<typeof compatibilityCandidateScores> | undefined
  const scorer = {
    version: 'compatibility-scorer-v1',
    score(context: Parameters<typeof compatibilityCandidateScores>[0]) {
      const scores = compatibilityCandidateScores(context)
      first ??= structuredClone(scores)
      return scores
    },
  }
  const agent = createComposedAgent({ seed: source.source.seed, scorer })
  const one = await agent.decide(source.req, source.view)
  const two = await agent.decide(source.req, source.view)
  assert.deepEqual(two.trace!.candidateScores, first)
  assert.deepEqual(one.trace!.candidateScores, two.trace!.candidateScores)
  assert.doesNotMatch(JSON.stringify(one.trace), /null/)
  assert.ok(one.trace!.candidateScores!.every((score) => Number.isFinite(score.value)))
})

test('invalid scorer output cannot reopen forced candidates or remove totality', async () => {
  const source = fixture('oberon-two-fail-quest')
  const view: PlayerView = {
    ...source.view,
    role: 'servant',
    alignment: 'good',
    privateInfo: { kind: 'none' },
  }
  const agent = createComposedAgent({
    seed: source.source.seed,
    scorer: {
      version: 'hostile-scorer-v1',
      score(context) {
        return context.candidates.map((candidate) => ({
          version: 'hostile-scorer-v1',
          candidateId: candidate.id,
          value: candidate.decision.kind === 'quest'
            && candidate.decision.card === 'fail' ? 100 : 0,
          viable: !(
            candidate.decision.kind === 'quest'
            && candidate.decision.card === 'success'
          ),
          reasonCodes: [],
        }))
      },
    },
  })
  const output = await agent.decide(
    { ...source.req, seat: view.seat },
    view,
  )
  assert.deepEqual(output.decision, { kind: 'quest', card: 'success' })
  assert.ok(output.trace!.degradation.includes('scorer-invalid-output'))
  assert.equal(
    output.trace!.componentVersions!.scorer,
    'compatibility-scorer-v1',
  )
})

test('scorer viability must be a boolean', async () => {
  const source = fixture('merlin-opening-proposal')
  const agent = createComposedAgent({
    seed: source.source.seed,
    scorer: {
      version: 'malformed-scorer-v1',
      score(context) {
        return compatibilityCandidateScores(context).map((score) => ({
          ...score,
          version: 'malformed-scorer-v1',
          viable: 'yes',
        })) as never
      },
    },
  })
  const output = await agent.decide(source.req, source.view)
  assert.ok(output.trace!.degradation.includes('scorer-invalid-output'))
})

test('planner may select only a supplied viable candidate ID', async () => {
  const source = fixture('merlin-opening-proposal')
  let selected = ''
  const valid = createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    planner: {
      version: 'fake-planner-v1',
      async choose(input) {
        const candidate = input.context.viableCandidates.at(-1)!
        selected = candidate.id
        return {
          candidateId: selected,
          reasonCodes: candidate.reasonCodes,
        }
      },
    },
  })
  const chosen = await valid.decide(source.req, source.view)
  assert.equal(chosen.trace!.chosenCandidateId, selected)
  assert.equal(chosen.trace!.plannerCandidateId, selected)

  const invalid = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'fake-planner-v1',
      async choose() {
        return { candidateId: 'invented:action' }
      },
    },
  })
  const degraded = await invalid.decide(source.req, source.view)
  assert.ok(degraded.trace!.degradation.includes('planner-invalid-candidate'))
  assert.notEqual(degraded.trace!.chosenCandidateId, 'invented:action')
  assert.deepEqual(degraded.decision.team, source.baselineDecision.team)
})

test('planner communication must match the committed action channel', async () => {
  const source = fixture('merlin-opening-proposal')
  const agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'fake-planner-v1',
      async choose(input) {
        return {
          candidateId: input.structuredCandidateId,
          communication: {
            version: 'communication-intent-v2',
            channel: 'discussion',
            targetSeats: [],
            claimCodes: [],
            tone: 'natural',
          },
        }
      },
    },
  })
  const output = await agent.decide(source.req, source.view)
  assert.ok(output.trace!.degradation.includes('planner-invalid-communication'))
})

test('planner cannot publish private analysis fact codes', async () => {
  const source = fixture('merlin-opening-proposal')
  const privateFacts = ['ALIGNMENT_PROVEN_PRIVATE']
  const view: PlayerView = {
    ...source.view,
    role: 'merlin',
    alignment: 'good',
  }
  const agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'unsafe-planner-v1',
      async choose(input) {
        return {
          candidateId: input.structuredCandidateId,
          communication: {
            version: 'communication-intent-v2',
            channel: 'proposal-pitch',
            targetSeats: [],
            claimCodes: privateFacts,
            tone: 'natural',
          },
        }
      },
    },
  })
  const output = await agent.decide(source.req, view)
  assert.ok(output.trace!.degradation.includes('planner-invalid-communication'))
})

test('forced policy dominates the planner', async () => {
  const source = fixture('oberon-two-fail-quest')
  const view: PlayerView = {
    ...source.view,
    role: 'servant',
    alignment: 'good',
    privateInfo: { kind: 'none' },
  }
  let calls = 0
  const agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'fake-planner-v1',
      async choose() {
        calls++
        return { candidateId: 'legal-candidates-v1:quest:fail' }
      },
    },
  })
  const output = await agent.decide(
    { ...source.req, seat: view.seat },
    view,
  )
  assert.equal(calls, 0)
  assert.deepEqual(output.decision, { kind: 'quest', card: 'success' })
  assert.match(output.trace!.chosenCandidateId!, /quest:success$/)
})

test('proposal action is committed before voice and voice cannot alter it', async () => {
  const source = fixture('merlin-opening-proposal')
  let committed: Decision | undefined
  const agent = createComposedAgent({
    seed: source.source.seed,
    voice: {
      version: 'fake-voice-v1',
      async speak(input) {
        committed = structuredClone(input.plan.decision)
        assert.equal('candidateScores' in input.plan, false)
        assert.equal(input.plan.communication?.channel, 'proposal-pitch')
        assert.ok(input.renderedPlan.includes(input.plan.candidateId))
        return { text: 'This team is my call.' }
      },
    },
  })
  const output = await agent.decide(source.req, source.view)
  assert.deepEqual(committed, {
    kind: 'propose',
    team: source.baselineDecision.team,
  })
  assert.deepEqual(output.decision.team, source.baselineDecision.team)
  assert.equal(output.decision.pitch, 'This team is my call.')
})

test('revision reason and discussion speech are plan-driven without changing mechanics', async () => {
  const final = fixture('assassin-late-finalize')
  let revisionId = ''
  const revision = createComposedAgent({
    seed: final.source.seed,
    scorer: {
      version: 'revision-test-scorer-v1',
      score(context) {
        return compatibilityCandidateScores(context).map((score, index) => {
          const candidate = context.candidates[index]
          const revise = candidate.decision.kind === 'finalize'
            && candidate.decision.stick === false
          if (revise) revisionId = candidate.id
          return {
            ...score,
            version: 'revision-test-scorer-v1',
            value: score.viable && revise ? 1_000_001 + index : score.value,
          }
        })
      },
    },
    voice: {
      version: 'fake-voice-v1',
      async speak(input) {
        assert.equal(input.plan.decision.kind, 'finalize')
        assert.equal(input.plan.decision.stick, false)
        assert.equal(input.plan.communication?.channel, 'revision-reason')
        return { text: 'The revision follows the table.' }
      },
    },
  })
  const revised = await revision.decide(final.req, final.view)
  assert.equal(revised.trace!.chosenCandidateId, revisionId)
  assert.equal(revised.decision.kind, 'finalize')
  assert.equal(revised.decision.stick, false)
  assert.equal(revised.decision.reason, 'The revision follows the table.')
  for (const reason of revised.trace!.forcedPolicyResult!.reasonCodes) {
    assert.ok(revised.trace!.reasonCodes.includes(reason))
  }

  const discuss = fixture('percival-opening-discussion')
  const talker = createComposedAgent({
    seed: discuss.source.seed,
    voice: {
      version: 'fake-voice-v1',
      async speak(input) {
        assert.equal(input.plan.communication?.channel, 'discussion')
        return { text: 'I will keep this grounded.' }
      },
    },
  })
  const spoken = await talker.decide(discuss.req, discuss.view)
  assert.equal(spoken.decision.kind, 'discuss')
  assert.equal(spoken.decision.say, 'I will keep this grounded.')
  assert.equal(
    spoken.decision.say !== undefined,
    (discuss.baselineDecision as Extract<Decision, { kind: 'discuss' }>).say !== undefined,
  )
})

test('voice failure keeps the committed action and becomes silent degradation', async () => {
  for (const id of [
    'merlin-opening-proposal',
    'percival-opening-discussion',
  ]) {
    const source = fixture(id)
    const agent = createComposedAgent({
      seed: source.source.seed,
      voice: {
        version: 'broken-voice-v1',
        async speak() {
          throw new Error('voice unavailable')
        },
      },
    })
    const output = await agent.decide(source.req, source.view)
    assert.ok(output.trace!.degradation.includes('voice-failed'))
    if (output.decision.kind === 'propose') assert.equal(output.decision.pitch, undefined)
    else if (output.decision.kind === 'discuss') assert.equal(output.decision.say, '')
  }
})

test('changing planner/model or voice identity does not reset persistent cognition', async () => {
  const source = fixture('percival-opening-discussion')
  const agent = createComposedAgent({
    seed: source.source.seed,
    voice: {
      version: 'persona-a',
      async speak() { return { text: 'A' } },
    },
  })
  const first = await agent.decide(source.req, source.view)
  const cursor = agent.cognitionCursor()
  agent.setPlanner({
    version: 'model-b',
    async choose(input) {
      return { candidateId: input.structuredCandidateId }
    },
  })
  agent.setVoice({
    version: 'persona-b',
    async speak() { return { text: 'B' } },
  })
  const second = await agent.decide(source.req, source.view)
  assert.equal(agent.cognitionCursor(), cursor)
  assert.equal(first.trace!.beliefThroughSeq, second.trace!.beliefThroughSeq)
  assert.equal(second.trace!.componentVersions!.planner, 'model-b')
  assert.equal(second.trace!.componentVersions!.communication, 'plan-voice-v2')
  assert.equal(second.trace!.componentVersions!.voice, 'persona-b')
})

test('trace attributes the exact planner and voice instances used across awaits', async () => {
  const source = fixture('merlin-opening-proposal')
  let agent: ReturnType<typeof createComposedAgent>
  agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'planner-used',
      async choose(input) {
        agent.setPlanner({
          version: 'planner-replacement',
          async choose() { return undefined },
        })
        return { candidateId: input.structuredCandidateId }
      },
    },
    voice: {
      version: 'voice-used',
      async speak() {
        agent.setVoice({
          version: 'voice-replacement',
          async speak() { return undefined },
        })
        return { text: 'Committed.' }
      },
    },
  })
  const output = await agent.decide(source.req, source.view)
  assert.equal(output.trace!.componentVersions!.planner, 'planner-used')
  assert.equal(output.trace!.componentVersions!.voice, 'voice-used')
})

test('sim runner unwraps composed decisions, records private traces, and keeps legacy adapters', async () => {
  const game = createGame({ seed: 'composed-runner', playerCount: 5, talk: false })
  const traces: unknown[] = []
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      player.seat === game.leaderSeat
        ? createComposedAgent({
            seed: game.seed,
            onDecisionTrace: (trace) => traces.push(trace),
          })
        : createAgent(
            { type: player.seat % 2 ? 'random' : 'heuristic' },
            { seed: game.seed, seat: player.seat },
          ),
    ]),
  )
  const result = await runGame({
    game,
    agents,
    onDecisionTrace: (trace) => traces.push(trace),
  })
  assert.equal(result.game.phase, 'gameOver')
  assert.ok(traces.length)
  assert.ok(!JSON.stringify(result.game).includes('componentVersions'))
  assert.ok(!JSON.stringify(result.game).includes('componentPlan'))
})

test('sim records an envelope trace only after its action passes engine legality', async () => {
  const game = createGame({
    seed: 'trace-after-legality',
    playerCount: 5,
    talk: false,
  })
  const attemptedTrace = {
    decisionId: 'illegal-attempt',
  }
  let attempted = false
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => {
      if (player.seat !== game.leaderSeat) {
        return [
          player.seat,
          createAgent(
            { type: 'heuristic' },
            { seed: game.seed, seat: player.seat },
          ),
        ]
      }
      return [
        player.seat,
        {
          async decide(req: DecisionRequest, view: PlayerView) {
            if (!attempted && req.kind === 'propose') {
              attempted = true
              return {
                decision: { kind: 'propose' as const, team: [] },
                trace: attemptedTrace as never,
              }
            }
            return heuristicDecide(req, view, game.seed)
          },
        },
      ]
    }),
  )
  const traces: Array<{ decisionId: string }> = []
  const result = await runGame({
    game,
    agents,
    onDecisionTrace: (trace) => traces.push(trace),
  })
  assert.ok(result.degraded.length)
  assert.ok(!traces.some((trace) => trace.decisionId === 'illegal-attempt'))
})

test('every built-in agent answers with the decision envelope', async () => {
  const source = fixture('servant-vote-after-evidence')
  const ctx = { seed: 'envelope-seed', seat: source.req.seat }
  const agents = {
    heuristic: createHeuristicAgent(ctx),
    random: createRandomAgent(ctx),
    composed: createComposedAgent({ seed: ctx.seed }),
  }
  for (const [label, agent] of Object.entries(agents)) {
    const output = await agent.decide(source.req, source.view)
    // The envelope is the only shape runners see. A bare Decision would still
    // carry `kind`, so that is what a regression here would look like.
    assert.equal('kind' in output, false, label)
    assert.equal(output.decision.kind, source.req.kind, label)
  }
})

test('external ingress boundary admits valid telemetry and strips invalid optional traces', () => {
  const source = fixture('servant-vote-after-evidence')
  const action = { kind: 'vote' as const, vote: 'approve' as const }
  const trace = {
    version: 'decision-trace-v1' as const,
    decisionId: decisionTraceIdForRequest(source.req, 0),
    viewerSeat: source.req.seat,
    request: source.req,
    beliefModelVersion: 'external',
    beliefThroughSeq: 0,
    quality: 'constraints-only' as const,
    degradation: [],
    topHypotheses: [],
    factCodes: [],
    reasonCodes: [],
    action,
  }
  assert.deepEqual(
    parseExternalDecisionReply(source.req, { decision: action, trace }),
    { decision: action, trace },
  )
  const stripsTrace = (reply: unknown) => assert.deepEqual(
    parseExternalDecisionReply(source.req, reply),
    { decision: action },
  )
  stripsTrace({
      decision: action,
      trace: { version: 'unknown', request: source.req, action },
  })
  stripsTrace({
      decision: action,
      trace: { ...trace, forcedPolicyResult: {} },
  })
  stripsTrace({
      decision: action,
      trace: {
        ...trace,
        viewerSeat: source.req.seat + 1,
        action: { kind: 'vote', vote: 'reject' },
      },
  })
  stripsTrace({
      decision: action,
      trace: { ...trace, decisionId: 'colliding-id' },
  })
  stripsTrace({
      decision: action,
      trace: { ...trace, topHypotheses: [{}] },
  })
  stripsTrace({
      decision: action,
      trace: {
        ...trace,
        communicationIntent: {
          privateInfo: { knownEvil: [2, 3] },
        },
      },
  })
  assert.throws(
    () => parseExternalDecisionReply(source.req, {
      decision: { kind: 'propose', team: [0, 1] },
    }),
    /invalid decision/,
  )
})

test('external ingress boundary accepts the complete composed trace extension', async () => {
  const source = fixture('merlin-opening-proposal')
  const agent = createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
  })
  const output = await agent.decide(source.req, source.view)
  assert.deepEqual(
    parseExternalDecisionReply(source.req, output),
    output,
  )
  const stripsTrace = (reply: typeof output) => assert.deepEqual(
    parseExternalDecisionReply(source.req, reply),
    { decision: reply.decision },
  )
  const scorerMismatch = structuredClone(output)
  scorerMismatch.trace!.candidateScores = scorerMismatch.trace!.candidateScores!
    .map((score) => ({ ...score, version: 'wrong-scorer' }))
  stripsTrace(scorerMismatch)
  const impossibleForced = structuredClone(output)
  impossibleForced.trace!.forcedPolicyResult = {
    ...impossibleForced.trace!.forcedPolicyResult!,
    applied: true,
    reasonCodes: [],
  }
  stripsTrace(impossibleForced)
  const forgedIntent = structuredClone(output)
  if (forgedIntent.trace!.communicationIntent?.uncertainty) {
    forgedIntent.trace!.communicationIntent.uncertainty.beliefThroughSeq += 1
  }
  stripsTrace(forgedIntent)
  const missingIntent = structuredClone(output)
  delete missingIntent.trace!.communicationIntent
  stripsTrace(missingIntent)
  const extraIntent = structuredClone(output)
  Object.assign(extraIntent.trace!.communicationIntent!, {
    privateInfo: { knownEvil: [2, 3] },
  })
  stripsTrace(extraIntent)
  const duplicateTarget = structuredClone(output)
  const targets = duplicateTarget.trace!.communicationIntent!.targetSeats
  duplicateTarget.trace!.communicationIntent!.targetSeats = [
    ...targets,
    targets[0],
  ]
  stripsTrace(duplicateTarget)

})
