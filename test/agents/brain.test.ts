// test-lane: fast
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import {
  brainComponents,
  COMPAT_CERTAINTIES_VISIBILITY,
  COMPOSED_POLICY_VERSION,
  isComposedPolicy,
  isNonComposedPolicy,
  NON_COMPOSED_POLICIES,
  HEURISTIC_POLICY_VERSION,
  RANDOM_POLICY_VERSION,
  RAW_LLM_POLICY_VERSION,
  resolveBrain,
} from '../../server/agents/brain.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../../server/agents/belief/types.ts'
import { BELIEF_RENDERER_VERSION } from '../../server/agents/communication/belief-summary.ts'
import {
  publicInfo,
  validateDef,
  type AgentDef,
} from '../../server/agents/defs.ts'
import { createLlmAgent } from '../../server/agents/llm.ts'
import { buildMessages } from '../../server/agents/prompts.ts'
import { defaultComponents } from '../../server/eval/harness/architecture-bench.ts'
import { readDecisionFixtures } from '../../server/eval/replay/decision-fixtures.ts'
import { createGame } from '../../server/engine/game.ts'
import { viewFor } from '../../server/engine/view.ts'
import type { OpenRouterClient } from '../../server/llm/openrouter.ts'

const llmDef = (engine: Record<string, unknown> = {}): AgentDef => validateDef({
  id: 'test-llm',
  name: 'Test LLM',
  version: 1,
  engine: { type: 'llm', model: 'deepseek-flash', ...engine },
})

test('resolved LLM brains separate exact inference from compatibility and compact visibility', () => {
  const normal = resolveBrain({ type: 'llm' })
  assert.deepEqual(normal, {
    version: 'brain-spec-v1',
    belief: EXACT_BELIEF_MODEL_VERSION,
    beliefVisibility: COMPAT_CERTAINTIES_VISIBILITY,
    policy: RAW_LLM_POLICY_VERSION,
    languageEvidence: 'off',
    observerModel: 'off',
  })

  const withBeliefSummary = resolveBrain({
    type: 'llm',
    brain: { beliefVisibility: BELIEF_RENDERER_VERSION },
  })
  assert.equal(withBeliefSummary.belief, EXACT_BELIEF_MODEL_VERSION)
  assert.equal(withBeliefSummary.beliefVisibility, BELIEF_RENDERER_VERSION)
})

test('new architecture metadata is derived from the resolved runtime brain', () => {
  for (const def of [
    llmDef(),
    llmDef({ brain: { beliefVisibility: BELIEF_RENDERER_VERSION } }),
    validateDef({ id: 'heuristic', name: 'Heuristic', engine: { type: 'heuristic' } }),
  ]) {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(defaultComponents(def))
          .filter(([key]) => Object.hasOwn(brainComponents(resolveBrain(def.engine)), key)),
      ),
      brainComponents(resolveBrain(def.engine)),
    )
  }

  const normal = defaultComponents(llmDef())
  assert.equal(normal.belief, EXACT_BELIEF_MODEL_VERSION)
  assert.equal(normal.beliefVisibility, COMPAT_CERTAINTIES_VISIBILITY)
  const withBeliefSummary = defaultComponents(llmDef({
    brain: { beliefVisibility: BELIEF_RENDERER_VERSION },
  }))
  assert.equal(withBeliefSummary.belief, EXACT_BELIEF_MODEL_VERSION)
  assert.equal(withBeliefSummary.beliefVisibility, BELIEF_RENDERER_VERSION)
})

test('heuristic, random, and composed component identities remain truthful', () => {
  assert.deepEqual(
    brainComponents(resolveBrain({ type: 'heuristic' })),
    {
      brain: 'brain-spec-v1',
      belief: EXACT_BELIEF_MODEL_VERSION,
      beliefVisibility: 'none',
      policy: HEURISTIC_POLICY_VERSION,
      languageEvidence: 'off',
      observerModel: 'off',
    },
  )
  assert.equal(resolveBrain({ type: 'random' }).policy, RANDOM_POLICY_VERSION)
  assert.equal(resolveBrain({ type: 'random' }).belief, 'none')
  assert.deepEqual(
    brainComponents(resolveBrain({ type: 'composed' })),
    {
      brain: 'brain-spec-v1',
      belief: EXACT_BELIEF_MODEL_VERSION,
      beliefVisibility: 'none',
      policy: 'composed-policy-v1',
      languageEvidence: 'off',
      observerModel: 'off',
    },
  )
})

test('invalid or contradictory brain configurations fail clearly', () => {
  // beliefVisibility is the only component with a second legal value, so it is
  // the only one whose VALUE is validated. The rest are not configurable at
  // all, and naming one is rejected the same way as inventing a component:
  // restating a default was never worth a bespoke error message.
  assert.throws(
    () => llmDef({ brain: { beliefVisibility: 'invented-v1' } }),
    /brain\.beliefVisibility must be one of: /,
  )
  for (const component of [
    'belief',
    'policy',
    'communication',
    'languageEvidence',
    'observerModel',
    'mystery',
  ]) {
    assert.throws(
      () => llmDef({ brain: { [component]: 'x' } }),
      new RegExp(`unknown component "${component}"`),
      component,
    )
  }
})

test('public metadata exposes resolved brain identity apart from model and persona', () => {
  const info = publicInfo(llmDef({ personality: 'quietly skeptical' }))
  assert.equal(info.personality, 'quietly skeptical')
  assert.equal(info.brain?.belief, EXACT_BELIEF_MODEL_VERSION)
  assert.equal(info.brain?.beliefVisibility, COMPAT_CERTAINTIES_VISIBILITY)
  assert.ok(info.model.includes('/'))
})

function captureClient(captures: string[][]): OpenRouterClient {
  return {
    async call(_model, messages) {
      captures.push(messages.map((message) => message.content))
      return JSON.stringify({ say: 'I am considering the opening.' })
    },
    getTotalCost: () => 0,
    getSpend: () => ({}),
  }
}

test('default and compact visibility select the expected prompt bytes', async () => {
  const game = createGame({ seed: 'brain-prompt-identity', playerCount: 5 })
  const view = viewFor(game, game.leaderSeat)
  const req = {
    kind: 'discuss' as const,
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }

  assert.deepEqual(
    buildMessages('discuss', view, ''),
    buildMessages(
      'discuss',
      view,
      '',
      {},
      undefined,
      { beliefVisibility: COMPAT_CERTAINTIES_VISIBILITY },
    ),
  )

  const configured: string[][] = []
  await createLlmAgent({
    modelId: 'deepseek-flash',
    client: captureClient(configured),
    brain: { beliefVisibility: BELIEF_RENDERER_VERSION },
  }).decide(req, view)
  assert.ok(configured.flat().some((text) => text.includes('EXACT BELIEF SUMMARY')))
})

test('Phase 2 prompt bytes remain frozen across every decision fixture', () => {
  const fixtures = readDecisionFixtures()
  const digest = (beliefVisibility?: typeof BELIEF_RENDERER_VERSION): string =>
    crypto.createHash('sha256').update(JSON.stringify(
      fixtures.map((fixture) => buildMessages(
        fixture.req.kind,
        fixture.view,
        '',
        {},
        undefined,
        beliefVisibility ? { beliefVisibility } : {},
      )),
    )).digest('hex')

  // First generated from the Phase 2 master tree before introducing BrainSpec.
  // Together the fixtures cover every agent-boundary decision kind and every
  // private-knowledge shape in the architecture bank. Re-baseline these only in
  // the same commit as a deliberate prompt-copy change, and say which one here.
  // Last moved when the finalize ASK stopped claiming discussion had "wound
  // down": leans are gone, so table talk now just runs out its configured
  // rounds rather than settling.
  assert.equal(
    digest(),
    '36868ab196ea84eb493a6c9b20ef418ec2bca2104358d4db569eb6a591027c3b',
  )
  // The compact digest moved when promotion removed the stale status marker from the heading.
  assert.equal(
    digest(BELIEF_RENDERER_VERSION),
    'f8ffd30dec12debd9bae70b1f21b97b9341359c1230f2d0f2f45ae529b94b820',
  )
})

test('committed Phase 0 metadata remains historical rather than relabelled', () => {
  const heuristic = JSON.parse(
    fs.readFileSync('docs/baselines/phase0-heuristic-standard-v1.json', 'utf8'),
  )
  const observed = JSON.parse(
    fs.readFileSync('docs/baselines/phase0-prompt-guided-observed.json', 'utf8'),
  )
  assert.equal(heuristic.variants[0].components.belief, 'none')
  assert.equal(heuristic.variants[0].components.beliefVisibility, undefined)
  assert.equal(observed.architecture.belief, 'none')
})

test('the policy sets partition the agent kinds exactly once', () => {
  // The policy is the agent kind now: there is no separate mode to keep in step
  // with it. Every policy is composed or non-composed, never both and never
  // neither, so a reader can always tell which kind it is holding.
  assert.deepEqual(
    [...NON_COMPOSED_POLICIES].sort(),
    [
      HEURISTIC_POLICY_VERSION,
      RANDOM_POLICY_VERSION,
      RAW_LLM_POLICY_VERSION,
    ].sort(),
  )
  for (const policy of [...NON_COMPOSED_POLICIES, COMPOSED_POLICY_VERSION]) {
    assert.equal(isComposedPolicy(policy), !isNonComposedPolicy(policy), policy)
  }
  // The retired mode labels were never policies and must not become them.
  for (const retired of [
    'external',
    'compatibility',
    'structured-only',
    'hybrid',
  ]) {
    assert.equal(isComposedPolicy(retired), false, retired)
    assert.equal(isNonComposedPolicy(retired), false, retired)
  }
})
