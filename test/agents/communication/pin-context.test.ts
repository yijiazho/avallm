// test-lane: contract
// Step B of the perception-pin wiring: with the opt-in pinReads flag, the pin
// reads resolve and their summary is rendered into the planner's
// private-planning-only context. Merlin at the opening is the deterministic
// case: it pins every evil it sees (the table, with no quests yet, is unsure),
// so those seats appear as leverageEvil.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createComposedAgent } from '../../../server/agents/composed.ts'
import { roleObjectiveScorer } from '../../../server/agents/policy/score.ts'
import { readDecisionFixtures } from '../../../server/eval/replay/decision-fixtures.ts'
import { knownEvilOf } from '../../../server/engine/knowledge.ts'
import type { ComposedPolicyContext } from '../../../server/agents/communication/composed-renderer.ts'
import type { CandidatePlanner } from '../../../server/agents/communication/planner-voice-adapter.ts'
import type { DecisionRequest, PlayerView } from '../../../server/engine/types.ts'

const fixtures = readDecisionFixtures()

function merlinPropose(): { req: DecisionRequest; view: PlayerView } {
  const source = fixtures.find((candidate) => candidate.view.role === 'merlin')!
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

function capturingPlanner(sink: { context?: ComposedPolicyContext }): CandidatePlanner {
  return {
    version: 'pin-context-capture-v1',
    async choose(input) {
      sink.context = input.context
      return { candidateId: input.structuredCandidateId }
    },
  }
}

test('pinReads renders the pin leverage into the planner context', async () => {
  const { req, view } = merlinPropose()
  const sink: { context?: ComposedPolicyContext } = {}
  await createComposedAgent({
    seed: 'pin-context-leverage',
    scorer: roleObjectiveScorer,
    planner: capturingPlanner(sink),
    pinReads: true,
  }).decide(req, view)

  assert.ok(sink.context, 'the planner should have run and captured the context')
  const pins = sink.context!.analysisFacts.pins
  assert.ok(pins, 'pins should be present under analysisFacts when pinReads is on')
  // Merlin pins exactly the evil it sees, all publicly open at the opening.
  const seen = [...knownEvilOf(view.privateInfo)].sort((a, b) => a - b)
  assert.ok(seen.length > 0, 'the fixture Merlin must see at least one evil')
  assert.deepEqual([...pins!.leverageEvil].sort((a, b) => a - b), seen)
  // Merlin is good, so the evil-exposure read never resolves for it.
  assert.deepEqual(pins!.exposedTo, [])
  assert.equal(sink.context!.analysisFacts.visibility, 'private-planning-only')
})

test('without pinReads the planner context carries no pins', async () => {
  const { req, view } = merlinPropose()
  const sink: { context?: ComposedPolicyContext } = {}
  await createComposedAgent({
    seed: 'pin-context-off',
    scorer: roleObjectiveScorer,
    planner: capturingPlanner(sink),
  }).decide(req, view)

  assert.ok(sink.context, 'the planner should have run')
  assert.equal(sink.context!.analysisFacts.pins, undefined)
})
