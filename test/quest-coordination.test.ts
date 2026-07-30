// Migration phase 7D3; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createComposedAgent } from '../server/agents/composed.ts'
import { boardSituation } from '../server/agents/analysis/situation.ts'
import type { SituationAnalysis } from '../server/agents/analysis/types.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../server/agents/components/robust-evil-quest-card.ts'
import {
  publicDecisionComponentRun,
} from '../server/agents/components/kernel.ts'
import {
  ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
} from '../server/agents/decision-layers/robust-evil-quest-card.ts'
import {
  buildPrivateEvilQuestCardPolicy,
  decodeCanonicalRobustEvilQuestCardPolicy,
  type EvilQuestPublicContext,
  MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
} from '../server/agents/policy/evil-quest-card.ts'
import {
  canonicalizeJson,
} from '../server/agents/components/canonical-json.ts'
import {
  type AgentDecision,
} from '../server/agents/types.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { MAX_PROPOSALS } from '../server/engine/rules.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'

const source = readDecisionFixtures()
  .find((fixture) => fixture.id === 'oberon-two-fail-quest')!

function evilView(
  seat: Seat,
  visibleEvil: readonly Seat[],
  role: Role = 'assassin',
): PlayerView {
  const players = source.view.players.map((player) => ({
    ...player,
    name: `Seat ${player.seat}`,
  }))
  return {
    ...structuredClone(source.view),
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

function questRequest(view: PlayerView): DecisionRequest {
  return {
    kind: 'quest',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
}

function nondecisive(view: PlayerView): PlayerView {
  const next = structuredClone(view)
  next.quests[0] = {
    ...next.quests[0],
    result: 'success',
    failCount: 0,
  }
  next.quests[1] = {
    ...next.quests[1],
    result: 'fail',
    failCount: 1,
  }
  next.quests[2] = {
    ...next.quests[2],
    result: undefined,
    failCount: undefined,
  }
  return next
}

function robustPolicy(view: PlayerView) {
  return buildPrivateEvilQuestCardPolicy({
    req: questRequest(view),
    view,
    analysis: boardSituation(view) as SituationAnalysis,
  })
}

function decodes(value: unknown): boolean {
  const canonical = canonicalizeJson(
    value,
    MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
  )
  return canonical.ok
    && decodeCanonicalRobustEvilQuestCardPolicy(canonical.payload)
      !== undefined
}

function robustPayload(output: AgentDecision) {
  const entry = output.trace!.components!.entries.find(
    (candidate) =>
      candidate.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
  )
  assert.equal(entry?.status, 'admitted')
  if (entry?.status !== 'admitted') {
    throw new Error('robust component was not admitted')
  }
  return entry.envelope.payload
}

test('exact quota is absent from executable configuration and authority', () => {
  assert.throws(
    () => createComposedAgent({
      seed: 'phase7r3b3a-removed-exact',
      evilQuestCardPolicy: 'visible-exact-quota' as never,
    }),
    /invalid evilQuestCardPolicy mode/,
  )

  const composed = readFileSync(
    new URL('../server/agents/composed.ts', import.meta.url),
    'utf8',
  )
  const frame = readFileSync(
    new URL(
      '../server/agents/policy/decision-frame.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const forced = readFileSync(
    new URL('../server/agents/policy/forced.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(composed, /visible-exact-quota|withLegacyD3/)
  assert.doesNotMatch(
    frame,
    /legacy-d3-quest-card|LegacyD3|withLegacyD3/,
  )
  assert.doesNotMatch(
    forced,
    /evilQuestCardPolicy|EXACT_QUOTA|SHARED_SLOW_PLAY/,
  )
})

test('robust heterogeneous D3 resolves only through native component and layer', () => {
  const brain = createComposedAgent({
    seed: 'phase7r3b3a-robust-native',
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).resolvedBrain()
  assert.deepEqual(
    brain.description.components.configured.filter(
      (component) => component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
    ),
    [{
      id: EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
      version: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
    }],
  )
  assert.deepEqual(brain.decisionLayerOrder.order, [
    ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
  ])
  assert.equal(
    brain.description.components.configured.some(
      (component) => component.id.includes('exact-quota'),
    ),
    false,
  )
})

test('robust D3 obeys visible quota, decisive play, and Oberon exclusion', () => {
  const cases = [
    {
      label: 'below visible quota',
      view: evilView(4, [4]),
      selectedCard: 'success',
      reason: 'INSUFFICIENT_VISIBLE_QUOTA_SUCCESS',
      applicable: true,
    },
    {
      label: 'first independently sinkable seat',
      view: evilView(4, [4, 5]),
      selectedCard: 'fail',
      reason: 'ROBUST_DECISIVE_FAIL',
      applicable: true,
    },
    {
      label: 'second independently sinkable seat',
      view: evilView(5, [4, 5]),
      selectedCard: 'fail',
      reason: 'ROBUST_DECISIVE_FAIL',
      applicable: true,
    },
    {
      label: 'Oberon',
      view: evilView(source.view.seat, [source.view.seat], 'oberon'),
      selectedCard: undefined,
      reason: 'OBERON_UNCOORDINATED',
      applicable: false,
    },
  ] as const

  for (const expected of cases) {
    const policy = robustPolicy(expected.view)
    assert.equal(policy.selectedCard, expected.selectedCard, expected.label)
    assert.equal(policy.reason, expected.reason, expected.label)
    assert.equal(policy.applicable, expected.applicable, expected.label)
    assert.equal(policy.coordinationAssumption, 'none')
    assert.equal(policy.populationAssumption, 'heterogeneous-independent')
  }
})

test('nondecisive robust D3 is seat-local, deterministic, and assumption-free', async () => {
  const firstView = nondecisive(evilView(4, [4, 5]))
  const renamedView = structuredClone(firstView)
  renamedView.name = 'Untrusted acting name'
  renamedView.players = renamedView.players.map((player) => ({
    ...player,
    name: `Untrusted teammate ${player.seat}`,
  }))
  const teammateView = nondecisive(evilView(5, [4, 5]))
  const firstPolicy = robustPolicy(firstView)
  const renamedPolicy = robustPolicy(renamedView)
  const teammatePolicy = robustPolicy(teammateView)

  assert.deepEqual(renamedPolicy, firstPolicy)
  assert.equal(firstPolicy.sourceFingerprint, teammatePolicy.sourceFingerprint)
  assert.notEqual(firstPolicy.slowPlayBucket, teammatePolicy.slowPlayBucket)
  for (const policy of [firstPolicy, teammatePolicy]) {
    assert.equal(policy.decisiveBoard, false)
    assert.equal(policy.coordinationAssumption, 'none')
    assert.equal(policy.populationAssumption, 'heterogeneous-independent')
    assert.equal(typeof policy.slowPlayBucket, 'number')
    assert.equal(typeof policy.localSlowPlayFail, 'boolean')
    assert.equal(Object.hasOwn(policy, 'designation'), false)
    assert.equal(Object.hasOwn(policy, 'orderedVisibleEvilAboard'), false)
    assert.equal(Object.hasOwn(policy, 'sharedSlowPlayGateOpen'), false)
    assert.doesNotMatch(
      JSON.stringify(policy),
      /agent|model|seed|name/i,
    )
  }

  const outputs = (await Promise.all([
    createComposedAgent({
      seed: 'unrelated-seed-a',
      evilQuestCardPolicy: 'robust-heterogeneous',
    }).decide(questRequest(firstView), firstView),
    createComposedAgent({
      seed: 'unrelated-seed-b',
      evilQuestCardPolicy: 'robust-heterogeneous',
    }).decide(questRequest(renamedView), renamedView),
  ]))
  assert.deepEqual(outputs[1].decision, outputs[0].decision)
  assert.deepEqual(robustPayload(outputs[1]), robustPayload(outputs[0]))
})

test('robust D3 ingress derives the fail threshold from the board', () => {
  const view = nondecisive(evilView(4, [4, 5]))
  const policy = robustPolicy(view)
  // Seven players on quest four is the one board that needs two Fails, so the
  // honest fixture exercises the derivation on both sides of its only step.
  assert.equal(view.playerCount, 7)
  assert.equal(policy.sourceContext.round, 4)
  assert.equal(policy.failsRequired, 2)
  assert.equal(decodes(policy), true)

  // Each forgery is otherwise coherent: both copies of the threshold agree and
  // the request block tracks the context, so only the board rule under test
  // can reject it.
  const forged = (
    failsRequired: number,
    override: Partial<EvilQuestPublicContext> = {},
  ) => {
    const sourceContext = {
      ...policy.sourceContext,
      failsRequired,
      ...override,
    }
    return {
      ...policy,
      failsRequired,
      request: {
        ...policy.request,
        round: sourceContext.round,
        proposalNum: sourceContext.proposalNum,
      },
      sourceContext,
    }
  }
  for (const [label, value] of [
    ['a threshold above any quest', forged(7)],
    ['a threshold below the two-Fail quest', forged(1)],
    ['two Fails demanded on quest one', forged(2, { round: 1 })],
    ['a quest number off the board', forged(1, { round: 99 })],
    ['a quest number below the board', forged(1, { round: 0 })],
  ] as const) {
    assert.equal(decodes(value), false, label)
  }

  // Five players is the derivation's other side: quest four needs one Fail
  // there, not two. Shrinking the table means shrinking every seat with it,
  // or the seat bound rejects the payload before the threshold is consulted,
  // and the case would pass with the derivation deleted.
  const atFivePlayers = (failsRequired: number) =>
    forged(failsRequired, {
      playerCount: 5,
      leaderSeat: 0,
      currentTeam: [1, 2, 3],
      teamSize: 3,
    })
  assert.equal(decodes(atFivePlayers(1)), true)
  assert.equal(decodes(atFivePlayers(2)), false)
})

test('robust D3 ingress pins the request block to the bounded context', () => {
  const view = nondecisive(evilView(4, [4, 5]))
  const policy = robustPolicy(view)
  const { round, proposalNum } = policy.sourceContext
  assert.equal(policy.request.round, round)
  assert.equal(policy.request.proposalNum, proposalNum)
  assert.ok(proposalNum >= 1 && proposalNum <= MAX_PROPOSALS)

  // The request block carries no bounds of its own, so these cases pass only
  // if the tie to the context holds.
  const desynced = (request: Partial<DecisionRequest>) => ({
    ...policy,
    request: { ...policy.request, ...request },
  })
  // Both copies move together here, which leaves the context's own bounds as
  // the only thing standing between the payload and admission.
  const atProposalNum = (value: number) => ({
    ...policy,
    request: { ...policy.request, proposalNum: value },
    sourceContext: { ...policy.sourceContext, proposalNum: value },
  })
  for (const [label, value] of [
    [
      'a request naming another quest',
      desynced({ round: round === 1 ? 2 : 1 }),
    ],
    [
      'a request naming another proposal',
      desynced({ proposalNum: proposalNum + 1 }),
    ],
    ['a proposal number below the board', atProposalNum(0)],
    ['a proposal number past the hammer', atProposalNum(MAX_PROPOSALS + 1)],
  ] as const) {
    assert.equal(decodes(value), false, label)
  }
})

test('robust D3 private payload stays out of prompt, voice, client, and public surfaces', async () => {
  const view = nondecisive(evilView(4, [4, 5]))
  const output = await createComposedAgent({
    seed: 'phase7r3b3a-private-surface',
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(questRequest(view), view)
  assert.ok(robustPayload(output))
  assert.doesNotMatch(
    JSON.stringify(publicDecisionComponentRun(output.trace!.components!)),
    /evil-quest-card-robust|slowPlayBucket|localSlowPlayFail/,
  )
  assert.doesNotMatch(
    JSON.stringify(view),
    /privateEvilQuestCardPolicy|slowPlayBucket|localSlowPlayFail/,
  )
  for (const path of [
    '../server/agents/prompts.ts',
    '../server/agents/communication/composed-renderer.ts',
    '../client/src/App.tsx',
  ]) {
    assert.doesNotMatch(
      readFileSync(new URL(path, import.meta.url), 'utf8'),
      /privateEvilQuestCardPolicy|slowPlayBucket|localSlowPlayFail/,
    )
  }
})
