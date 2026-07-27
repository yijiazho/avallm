import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import {
  brainComponents,
  COMPAT_CERTAINTIES_VISIBILITY,
  HEURISTIC_POLICY_VERSION,
  PROMPT_COMMUNICATION_VERSION,
  RANDOM_POLICY_VERSION,
  RAW_LLM_POLICY_VERSION,
  resolveBrain,
} from '../server/agents/brain.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../server/agents/belief/types.ts'
import { BELIEF_RENDERER_VERSION } from '../server/agents/communication/belief-summary.ts'
import { EXPERIMENTAL_BELIEF_MODE } from '../server/agents/experimental.ts'
import {
  publicInfo,
  validateDef,
  type AgentDef,
} from '../server/agents/defs.ts'
import { createLlmAgent } from '../server/agents/llm.ts'
import { buildMessages } from '../server/agents/prompts.ts'
import { defaultComponents } from '../server/eval/architecture-bench.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type { OpenRouterClient } from '../server/llm/openrouter.ts'

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
    communication: PROMPT_COMMUNICATION_VERSION,
    languageEvidence: 'off',
    observerModel: 'off',
  })

  const legacyExperimental = resolveBrain({
    type: 'llm',
    beliefMode: EXPERIMENTAL_BELIEF_MODE,
  })
  const configuredExperimental = resolveBrain({
    type: 'llm',
    brain: { beliefVisibility: BELIEF_RENDERER_VERSION },
  })
  assert.deepEqual(legacyExperimental, configuredExperimental)
  assert.equal(legacyExperimental.belief, EXACT_BELIEF_MODEL_VERSION)
  assert.equal(legacyExperimental.beliefVisibility, BELIEF_RENDERER_VERSION)
})

test('new architecture metadata is derived from the resolved runtime brain', () => {
  for (const def of [
    llmDef(),
    llmDef({ beliefMode: EXPERIMENTAL_BELIEF_MODE }),
    validateDef({ id: 'heuristic', name: 'Heuristic', engine: { type: 'heuristic' } }),
    validateDef({
      id: 'external',
      name: 'External',
      engine: { type: 'stdio', cmd: 'agent', args: [] },
    }),
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
  const experimental = defaultComponents(llmDef({
    beliefMode: EXPERIMENTAL_BELIEF_MODE,
  }))
  assert.equal(experimental.belief, EXACT_BELIEF_MODEL_VERSION)
  assert.equal(experimental.beliefVisibility, BELIEF_RENDERER_VERSION)
})

test('heuristic, random, and stdio component identities remain truthful', () => {
  assert.deepEqual(
    brainComponents(resolveBrain({ type: 'heuristic' })),
    {
      brain: 'brain-spec-v1',
      belief: 'none',
      beliefVisibility: 'none',
      policy: HEURISTIC_POLICY_VERSION,
      communication: 'none',
      languageEvidence: 'off',
      observerModel: 'off',
    },
  )
  assert.equal(resolveBrain({ type: 'random' }).policy, RANDOM_POLICY_VERSION)
  assert.equal(resolveBrain({ type: 'random' }).belief, 'none')
  assert.deepEqual(resolveBrain({ type: 'stdio' }), {
    version: 'brain-spec-v1',
    belief: 'external',
    beliefVisibility: 'external',
    policy: 'external',
    communication: 'external',
    languageEvidence: 'external',
    observerModel: 'external',
  })
})

test('invalid or contradictory brain configurations fail clearly', () => {
  assert.throws(
    () => llmDef({ brain: { belief: 'none' } }),
    /brain\.belief must be one of: exact-constraints-v1/,
  )
  assert.throws(
    () => llmDef({ brain: { policy: 'hybrid-v1' } }),
    /brain\.policy must be one of: prompt-guided-v1/,
  )
  assert.throws(
    () => llmDef({ brain: { mystery: 'x' } }),
    /unknown component "mystery"/,
  )
  assert.throws(
    () => llmDef({
      beliefMode: EXPERIMENTAL_BELIEF_MODE,
      brain: { beliefVisibility: COMPAT_CERTAINTIES_VISIBILITY },
    }),
    /beliefMode conflicts/,
  )
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
      return JSON.stringify({ say: 'I am considering the opening.', lean: 'uncertain' })
    },
    getTotalCost: () => 0,
    getSpend: () => ({}),
  }
}

test('legacy and BrainSpec paths preserve default and compact prompt bytes', async () => {
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

  const legacy: string[][] = []
  const configured: string[][] = []
  await createLlmAgent({
    modelId: 'deepseek-flash',
    client: captureClient(legacy),
    beliefMode: EXPERIMENTAL_BELIEF_MODE,
  }).decide(req, view)
  await createLlmAgent({
    modelId: 'deepseek-flash',
    client: captureClient(configured),
    brain: { beliefVisibility: BELIEF_RENDERER_VERSION },
  }).decide(req, view)
  assert.deepEqual(configured, legacy)
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

  // Generated from the Phase 2 master tree before introducing BrainSpec.
  // Together the fixtures cover every agent-boundary decision kind and every
  // private-knowledge shape in the architecture bank.
  assert.equal(
    digest(),
    'f931cc39468717af07c0188065669d26822441b17bad18153827ff5f364e1fdb',
  )
  assert.equal(
    digest(BELIEF_RENDERER_VERSION),
    'fc97263aa064c080b7004e853d7b0c0cdafe56b620d3cb877780b6257d62f102',
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
