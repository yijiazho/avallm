import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import {
  createComposedAgent,
  type CandidatePlanner,
} from '../server/agents/composed.ts'
import {
  componentPayload,
  runDecisionComponents,
} from '../server/agents/components/kernel.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  PRIVATE_IDENTITY_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
} from '../server/agents/components/legacy-role-adapters.ts'
import {
  roleObjectiveScorer,
  evilRoleObjectiveScorer,
} from '../server/agents/policy/score.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { parseStdioDecisionReply } from '../server/agents/stdio.ts'
import {
  LANGUAGE_EVIDENCE_VERSION,
} from '../server/agents/communication/language-types.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'

const fixtures = readDecisionFixtures()

function proposalFixture(role: Role): {
  req: DecisionRequest
  view: PlayerView
} {
  const source = fixtures.find((candidate) => candidate.view.role === role)!
  const view: PlayerView = {
    ...structuredClone(source.view),
    phase: 'proposal',
    leaderSeat: source.view.seat,
    currentTeam: undefined,
  }
  return {
    req: {
      kind: 'propose',
      seat: view.seat,
      round: view.round,
      proposalNum: view.proposalNum,
    },
    view,
  }
}

test('C1/C2 generic adapters exactly project unchanged Merlin trace payloads', async () => {
  const fixture = proposalFixture('merlin')
  const agent = createComposedAgent({
    seed: 'phase7r2b3a-good',
    scorer: roleObjectiveScorer,
  })
  const output = await agent.decide(fixture.req, fixture.view)
  const trace = output.trace!
  const brain = agent.resolvedBrain()
  const run = await runDecisionComponents(
    brain,
    fixture.req,
    fixture.view,
    {
      hostInputs: [
        {
          input: PRIVATE_IDENTITY_INPUT,
          value: trace.privateIdentity!,
        },
        {
          input: PRIVATE_PUBLIC_OBSERVER_INPUT,
          value: trace.publicObserver!,
        },
      ],
    },
  )

  assert.deepEqual(
    componentPayload(run, GOOD_ROLE_OBJECTIVE_COMPONENT),
    trace.privateRoleObjective,
  )
  assert.deepEqual(
    componentPayload(run, GOOD_ROLE_UTILITY_COMPONENT),
    trace.privateRoleUtility,
  )
  assert.ok(run.entries.every((entry) =>
    entry.status === 'admitted'
    && entry.verification === 'exact'
    && entry.promotionEligible))
  assert.ok(brain.configuredDefinitions.every(
    (definition) => definition.source === 'native',
  ))
  assert.doesNotThrow(() => parseStdioDecisionReply(
    fixture.req,
    output,
    'phase7r2b3a admitted native compatibility projection',
    fixture.view,
  ))
  const uses = new Map(
    trace.components!.policyUse.map((entry) => [
      entry.component.id,
      entry.stages,
    ]),
  )
  assert.deepEqual(
    uses.get(GOOD_ROLE_OBJECTIVE_COMPONENT.id),
    ['candidate-score', 'action-selection'],
  )
  assert.deepEqual(
    uses.get(GOOD_ROLE_UTILITY_COMPONENT.id),
    ['candidate-score', 'action-selection'],
  )

  const stripped = structuredClone(output)
  delete stripped.trace!.components
  delete stripped.trace!.componentVersions!.decisionComponents
  assert.throws(
    () => parseStdioDecisionReply(
      fixture.req,
      stripped,
      'phase7r2b3a stripped generic run',
      fixture.view,
    ),
    /invalid decision trace/,
  )
  const historical = structuredClone(stripped)
  delete historical.trace!.componentPlan
  historical.trace!.version = 'decision-trace-v1'
  assert.deepEqual(
    parseStdioDecisionReply(
      fixture.req,
      historical,
      'phase7r2b3a historical flat trace',
      fixture.view,
    ),
    historical,
  )
  const falseLegacy = structuredClone(output)
  falseLegacy.trace!.version = 'decision-trace-v1'
  assert.throws(
    () => parseStdioDecisionReply(
      fixture.req,
      falseLegacy,
      'phase7r2b3a legacy trace carrying generic provenance',
      fixture.view,
    ),
    /invalid decision trace/,
  )
  const mutated = structuredClone(output)
  const admitted = mutated.trace!.components!.entries.find(
    (entry) =>
      entry.component.id === GOOD_ROLE_UTILITY_COMPONENT.id
      && entry.status === 'admitted',
  )!
  if (admitted.status === 'admitted') {
    admitted.envelope.payload.assessments[0].roleValue = 0
  }
  assert.throws(
    () => parseStdioDecisionReply(
      fixture.req,
      mutated,
      'phase7r2b3a generic payload mutation',
      fixture.view,
    ),
    /invalid decision trace/,
  )
})

test('the independent plan witness preserves configured inapplicable adapters', async () => {
  const fixture = fixtures.find(
    (candidate) => candidate.id === 'servant-vote-after-evidence',
  )!
  const output = await createComposedAgent({
    seed: 'phase7r2b3a-inapplicable-witness',
    roleObjectives: true,
  }).decide(fixture.req, fixture.view)
  assert.deepEqual(
    output.trace!.componentPlan!.configured,
    [{
      id: GOOD_ROLE_OBJECTIVE_COMPONENT.id,
      version: GOOD_ROLE_OBJECTIVE_COMPONENT.version,
    }],
  )
  assert.equal(output.trace!.components!.entries[0].status, 'inapplicable')
  assert.doesNotThrow(() => parseStdioDecisionReply(
    fixture.req,
    output,
    'phase7r2b3a inapplicable native compatibility projection',
    fixture.view,
  ))

  const erasedRun = structuredClone(output)
  erasedRun.trace!.components!.configured = []
  erasedRun.trace!.components!.entries = []
  erasedRun.trace!.components!.policyUse = []
  assert.throws(() => parseStdioDecisionReply(
    fixture.req,
    erasedRun,
    'phase7r2b3a erased inapplicable run',
    fixture.view,
  ), /invalid decision trace/)

  const mismatchedWitness = structuredClone(output)
  mismatchedWitness.trace!.componentPlan!.configured = []
  assert.throws(() => parseStdioDecisionReply(
    fixture.req,
    mismatchedWitness,
    'phase7r2b3a mismatched plan witness',
    fixture.view,
  ), /invalid decision trace/)
})

for (const role of ['assassin', 'oberon'] as const) {
  test(`D1/D2 generic adapters exactly project unchanged ${role} trace payloads`, async () => {
    const fixture = proposalFixture(role)
    const agent = createComposedAgent({
      seed: `phase7r2b3a-${role}`,
      roleObjectiveRouter: true,
      scorer: evilRoleObjectiveScorer,
    })
    const output = await agent.decide(fixture.req, fixture.view)
    const trace = output.trace!
    const run = await runDecisionComponents(
      agent.resolvedBrain(),
      fixture.req,
      fixture.view,
      {
        hostInputs: [
          {
            input: PRIVATE_IDENTITY_INPUT,
            value: trace.privateIdentity!,
          },
          {
            input: PRIVATE_PUBLIC_OBSERVER_INPUT,
            value: trace.publicObserver!,
          },
        ],
      },
    )

    assert.deepEqual(
      componentPayload(run, EVIL_ROLE_OBJECTIVE_COMPONENT),
      trace.privateEvilRoleObjective,
    )
    assert.deepEqual(
      componentPayload(run, EVIL_ROLE_UTILITY_COMPONENT),
      trace.privateEvilRoleUtility,
    )
    const evilEntries = run.entries.filter((entry) =>
      entry.component.id === EVIL_ROLE_OBJECTIVE_COMPONENT.id
      || entry.component.id === EVIL_ROLE_UTILITY_COMPONENT.id)
    assert.equal(evilEntries.length, 2)
    assert.ok(evilEntries.every((entry) =>
      entry.status === 'admitted'
      && entry.verification === 'exact'
      && entry.promotionEligible))
  })
}

test('one composed agent serializes overlapping decisions and releases after failure', async () => {
  const fixture = proposalFixture('merlin')
  let calls = 0
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const planner: CandidatePlanner = {
    version: 'phase7r2b3a-fifo-planner-v1',
    async choose(input) {
      calls++
      if (calls === 1) {
        await firstGate
        throw new Error('intentional first-call failure')
      }
      assert.equal(input.context.phase, 'proposal')
      return undefined
    },
  }
  const agent = createComposedAgent({
    seed: 'phase7r2b3a-fifo',
    planner,
    planMemory: true,
  })

  const first = agent.decide(fixture.req, structuredClone(fixture.view))
  const secondRequest = structuredClone(fixture.req)
  const secondView = structuredClone(fixture.view)
  const second = agent.decide(secondRequest, secondView)
  Object.assign(secondRequest, { kind: 'vote' })
  secondView.phase = 'quest'
  let replacementCalls = 0
  agent.setPlanner({
    version: 'phase7r2b3a-replacement-planner-v1',
    async choose() {
      replacementCalls++
      return undefined
    },
  })
  await nextTurn()
  assert.equal(calls, 1)
  releaseFirst()
  const [firstOutput, secondOutput] = await Promise.all([first, second])

  assert.equal(calls, 2)
  assert.equal(replacementCalls, 0)
  assert.ok(firstOutput.trace!.degradation.includes('planner-failed'))
  assert.ok(
    secondOutput.trace!.degradation.includes('planner-no-choice'),
    JSON.stringify(secondOutput.trace!.degradation),
  )
  assert.equal(secondOutput.trace!.request.kind, 'propose')
  assert.deepEqual(firstOutput.decision, secondOutput.decision)
  assert.throws(
    () => agent.recordAppliedDecisionOutcome!({
      request: {
        ...fixture.req,
        proposalNum: fixture.req.proposalNum + 1,
      },
      view: fixture.view,
      selectedDecision: firstOutput.decision,
      appliedDecision: firstOutput.decision,
      resolution: 'selected-applied',
      provisionalTrace: firstOutput.trace,
    }),
    /does not match the pending selected plan/,
  )
  for (const output of [firstOutput, secondOutput]) {
    agent.recordAppliedDecisionOutcome!({
      request: fixture.req,
      view: fixture.view,
      selectedDecision: output.decision,
      appliedDecision: output.decision,
      resolution: 'selected-applied',
      provisionalTrace: output.trace,
    })
  }
  assert.equal(agent.planMemorySnapshot()!.history.length, 2)
})

test('adapter invocation is deterministic and does not add a second belief pass', async () => {
  const fixture = proposalFixture('percival')
  let inferenceCalls = 0
  const countedModel = {
    version: 'counted-exact-v1',
    factorsVersion: 'off',
    infer(view: PlayerView) {
      inferenceCalls++
      return {
        ...structuredClone(exactBelief(view)),
        modelVersion: 'counted-exact-v1',
        quality: 'weighted' as const,
      }
    },
  }
  const agent = createComposedAgent({
    seed: 'phase7r2b3a-single-cognition',
    scorer: roleObjectiveScorer,
    beliefModel: countedModel,
  })
  const first = await agent.decide(fixture.req, fixture.view)
  assert.equal(inferenceCalls, 1)
  const replay = await createComposedAgent({
    seed: 'phase7r2b3a-single-cognition',
    scorer: roleObjectiveScorer,
    beliefModel: countedModel,
  }).decide(fixture.req, structuredClone(fixture.view))
  assert.equal(inferenceCalls, 2)
  assert.deepEqual(first.decision, replay.decision)
  assert.deepEqual(first.trace!.privateRoleUtility, replay.trace!.privateRoleUtility)
  assert.ok(first.trace!.components!.entries.every((entry) =>
    entry.status !== 'admitted'
    || (
      entry.verification === 'structural'
      && entry.promotionEligible === false
    )))
  const coherentGenericForgery = structuredClone(first)
  coherentGenericForgery.trace!.privateRoleObjective!.source
    .beliefThroughSeq += 1
  const genericObjective =
    coherentGenericForgery.trace!.components!.entries.find(
      (entry) =>
        entry.component.id === GOOD_ROLE_OBJECTIVE_COMPONENT.id,
    )!
  assert.equal(genericObjective.status, 'admitted')
  if (genericObjective.status === 'admitted') {
    const payload = genericObjective.envelope.payload as
      typeof coherentGenericForgery.trace.privateRoleObjective
    payload!.source.beliefThroughSeq += 1
    genericObjective.payloadBytes = Buffer.byteLength(
      JSON.stringify(payload),
      'utf8',
    )
  }
  assert.throws(
    () => parseStdioDecisionReply(
      fixture.req,
      coherentGenericForgery,
      'phase7r2b3a weighted generic and legacy host forgery',
      fixture.view,
    ),
    /invalid decision trace/,
  )
})

test('a planner reaffirming the structured candidate suppresses action-selection attribution', async () => {
  const fixture = proposalFixture('merlin')
  const output = await createComposedAgent({
    seed: 'phase7r2b3a-planner-reaffirmation',
    scorer: roleObjectiveScorer,
    planner: {
      version: 'phase7r2b3a-reaffirming-planner-v1',
      async choose(input) {
        return { candidateId: input.structuredCandidateId }
      },
    },
  }).decide(fixture.req, fixture.view)
  for (const use of output.trace!.components!.policyUse) {
    assert.deepEqual(use.stages, ['candidate-score'])
  }
})

test('a forced committed choice retains scorer consumption but not action selection', async () => {
  const fixture = structuredClone(
    fixtures.find((candidate) => candidate.id === 'mordred-late-vote')!,
  )
  fixture.view.quests[0].result = 'success'
  fixture.view.quests[0].failCount = 0
  fixture.view.quests[1].result = 'success'
  fixture.view.quests[1].failCount = 0
  const output = await createComposedAgent({
    seed: 'phase7r2b3a-forced-selection',
    roleObjectiveRouter: true,
    scorer: evilRoleObjectiveScorer,
  }).decide(fixture.req, fixture.view)
  assert.ok(output.trace!.forcedPolicyResult?.selectedCandidateId)
  const evilUses = output.trace!.components!.policyUse.filter(
    (use) =>
      use.component.id === EVIL_ROLE_OBJECTIVE_COMPONENT.id
      || use.component.id === EVIL_ROLE_UTILITY_COMPONENT.id,
  )
  assert.ok(evilUses.length === 2)
  for (const use of evilUses) {
    assert.deepEqual(use.stages, ['candidate-score'])
  }
  assert.doesNotThrow(() => parseStdioDecisionReply(
    fixture.req,
    output,
    'phase7r2b3a forced selection attribution',
    fixture.view,
  ))
})

test('generic trace admission rejects hostile structure and attribution mutations', async () => {
  const fixture = proposalFixture('merlin')
  const output = await createComposedAgent({
    seed: 'phase7r2b3a-hostile-trace',
    scorer: roleObjectiveScorer,
  }).decide(fixture.req, fixture.view)
  const mutations: Array<(copy: typeof output) => void> = [
    (copy) => {
      copy.trace!.components!.entries[1] =
        structuredClone(copy.trace!.components!.entries[0])
    },
    (copy) => {
      copy.trace!.components!.policyUse[1] =
        structuredClone(copy.trace!.components!.policyUse[0])
    },
    (copy) => {
      copy.trace!.components!.configured[0].id = 'unknown-component'
      copy.trace!.components!.entries[0].component.id = 'unknown-component'
      copy.trace!.components!.policyUse[0].component.id = 'unknown-component'
    },
    (copy) => {
      copy.trace!.components!.entries[0].kind = 'observer'
    },
    (copy) => {
      copy.trace!.components!.entries[0].privacy = 'public'
    },
    (copy) => {
      copy.trace!.components!.entries[0].status = 'suppressed'
    },
    (copy) => {
      copy.trace!.components!.policyUse[0].stages = ['action-selection']
    },
    (copy) => {
      copy.trace!.components!.configured.shift()
      copy.trace!.components!.entries.shift()
      copy.trace!.components!.policyUse.shift()
    },
    (copy) => {
      copy.trace!.components!.configured.reverse()
      copy.trace!.components!.entries.reverse()
      copy.trace!.components!.policyUse.reverse()
    },
    (copy) => {
      copy.trace!.components!.configured.push({
        id: EVIL_ROLE_OBJECTIVE_COMPONENT.id,
        version: EVIL_ROLE_OBJECTIVE_COMPONENT.version,
      })
      copy.trace!.components!.entries.push({
        component: {
          id: EVIL_ROLE_OBJECTIVE_COMPONENT.id,
          version: EVIL_ROLE_OBJECTIVE_COMPONENT.version,
        },
        kind: EVIL_ROLE_OBJECTIVE_COMPONENT.kind,
        privacy: EVIL_ROLE_OBJECTIVE_COMPONENT.privacy,
        status: 'inapplicable',
      })
      copy.trace!.components!.policyUse.push({
        component: {
          id: EVIL_ROLE_OBJECTIVE_COMPONENT.id,
          version: EVIL_ROLE_OBJECTIVE_COMPONENT.version,
        },
        used: false,
        stages: [],
      })
    },
    (copy) => {
      copy.trace!.components!.policyUse[0].used = false
      copy.trace!.components!.policyUse[0].stages = []
    },
    (copy) => {
      const entry = copy.trace!.components!.entries[1]
      if (entry.status === 'admitted') {
        entry.envelope.payload = { oversized: 'x'.repeat(1_048_577) }
        entry.payloadBytes = 1_048_577
      }
    },
  ]
  for (const mutate of mutations) {
    const copy = structuredClone(output)
    mutate(copy)
    assert.throws(
      () => parseStdioDecisionReply(
        fixture.req,
        copy,
        'phase7r2b3a hostile generic trace',
        fixture.view,
      ),
      /invalid decision trace/,
    )
  }
})

test('generic plan and run arrays reject proxy, sparse, accessor, and alien shapes', async () => {
  const fixture = proposalFixture('merlin')
  const output = await createComposedAgent({
    seed: 'phase7r2b3a-hostile-arrays',
    scorer: roleObjectiveScorer,
  }).decide(fixture.req, fixture.view)
  let accessorInvoked = false
  const mutations: Array<(copy: typeof output) => void> = [
    (copy) => {
      copy.trace!.components!.configured = new Proxy(
        copy.trace!.components!.configured,
        {},
      )
    },
    (copy) => {
      const sparse = [...copy.trace!.components!.entries]
      delete sparse[0]
      copy.trace!.components!.entries = sparse
    },
    (copy) => {
      const original = copy.trace!.components!.policyUse[0]
      Object.defineProperty(copy.trace!.components!.policyUse, '0', {
        enumerable: true,
        configurable: true,
        get() {
          accessorInvoked = true
          return original
        },
      })
    },
    (copy) => {
      Object.setPrototypeOf(
        copy.trace!.components!.policyUse,
        Object.create(Array.prototype),
      )
    },
    (copy) => {
      copy.trace!.componentPlan!.configured = new Proxy(
        copy.trace!.componentPlan!.configured,
        {},
      )
    },
    (copy) => {
      copy.trace!.components!.policyUse[0].stages = new Proxy(
        copy.trace!.components!.policyUse[0].stages,
        {},
      )
    },
  ]
  for (const mutate of mutations) {
    const copy = structuredClone(output)
    mutate(copy)
    assert.throws(() => parseStdioDecisionReply(
      fixture.req,
      copy,
      'phase7r2b3a hostile generic array',
      fixture.view,
    ), /invalid decision trace/)
  }
  assert.equal(accessorInvoked, false)
})

test('generic degradation and passive policy attribution are registry-bound', async () => {
  const fixture = proposalFixture('merlin')
  const degraded = await createComposedAgent({
    seed: 'phase7r2b3a-degraded-contract',
    roleObjectives: true,
    privateIdentity: {
      roleQueries: [{ roles: ['merlin', 'merlin'] }],
      hiddenTeam: false,
    },
  }).decide(fixture.req, fixture.view)
  assert.doesNotThrow(() => parseStdioDecisionReply(
    fixture.req,
    degraded,
    'phase7r2b3a admitted degradation',
    fixture.view,
  ))
  const degradedEntry = degraded.trace!.components!.entries.find(
    (entry) => entry.status === 'degraded',
  )!
  assert.ok(degradedEntry)
  for (const mutate of [
    (copy: typeof degraded) => {
      const entry = copy.trace!.components!.entries.find(
        (candidate) => candidate.status === 'degraded',
      )!
      if (entry.status === 'degraded') {
        const original = entry.degradationCode
        entry.degradationCode = 'forged-degradation'
        copy.trace!.degradation = copy.trace!.degradation.map(
          (code) => code === original ? 'forged-degradation' : code,
        )
      }
    },
    (copy: typeof degraded) => {
      const entry = copy.trace!.components!.entries.find(
        (candidate) => candidate.status === 'degraded',
      )!
      if (entry.status === 'degraded') {
        entry.failureCode = 'forged-failure'
      }
    },
  ]) {
    const copy = structuredClone(degraded)
    mutate(copy)
    assert.throws(() => parseStdioDecisionReply(
      fixture.req,
      copy,
      'phase7r2b3a forged degradation',
      fixture.view,
    ), /invalid decision trace/)
  }

  const passive = await createComposedAgent({
    seed: 'phase7r2b3a-passive-objective',
    roleObjectives: true,
  }).decide(fixture.req, fixture.view)
  assert.ok(passive.trace!.components!.policyUse.every(
    (use) => !use.used && use.stages.length === 0,
  ))
  const forgedUse = structuredClone(passive)
  forgedUse.trace!.components!.policyUse[0].used = true
  forgedUse.trace!.components!.policyUse[0].stages = ['candidate-score']
  assert.throws(() => parseStdioDecisionReply(
    fixture.req,
    forgedUse,
    'phase7r2b3a passive objective forged as consumed',
    fixture.view,
  ), /invalid decision trace/)
})

test('active language resolves once before the generic role graph', async () => {
  const fixture = fixtures.find(
    (candidate) => candidate.id === 'percival-opening-discussion',
  )!
  let calls = 0
  const subject = fixture.view.players.find(
    (player) => player.seat !== fixture.view.seat,
  )!.seat
  const output = await createComposedAgent({
    seed: 'phase7r2b3a-active-language',
    roleObjectives: true,
    languageInterpreter: {
      interpreterVersion: 'phase7r2b3a-language-v1',
      async interpret(input) {
        calls++
        const source = input.newUtterances[0]
        return source
          ? [{
              schemaVersion: LANGUAGE_EVIDENCE_VERSION,
              sourceSeq: source.sourceSeq,
              subject,
              direction: 'moreEvil',
              class: 'truthTracking',
              confidence: 'medium',
              publicRationale: 'Bounded API-free adapter integration evidence.',
              interpreterVersion: 'phase7r2b3a-language-v1',
            }]
          : []
      },
    },
  }).decide(fixture.req, fixture.view)

  assert.equal(calls, 1)
  const entry = output.trace!.components!.entries.find(
    (candidate) =>
      candidate.component.id === GOOD_ROLE_OBJECTIVE_COMPONENT.id,
  )!
  assert.equal(entry.status, 'admitted')
  if (entry.status === 'admitted') {
    assert.equal(entry.verification, 'structural')
    assert.equal(entry.promotionEligible, false)
  }
})
