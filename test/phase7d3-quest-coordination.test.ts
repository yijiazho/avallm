import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../server/agents/components/robust-evil-quest-card.ts'
import {
  ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
} from '../server/agents/decision-layers/robust-evil-quest-card.ts'

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
