// test-lane: fast
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDecision, createGame } from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { createLlmAgent } from '../../../server/agents/llm.ts'
import { buildMessages } from '../../../server/agents/prompts.ts'
import {
  experimentalBeliefContext,
} from '../../../server/agents/experimental.ts'
import { readDecisionFixtures } from '../../../server/eval/replay/decision-fixtures.ts'
import type { OpenRouterClient } from '../../../server/llm/openrouter.ts'
import type { DecisionTrace } from '../../../server/agents/trace.ts'
import { BELIEF_RENDERER_VERSION } from '../../../server/agents/communication/belief-summary.ts'

function captureClient(
  output: string,
  captures: string[][],
): OpenRouterClient {
  return {
    async call(_model, messages) {
      captures.push(messages.map((message) => message.content))
      return output
    },
    getTotalCost: () => 0,
    getSpend: () => ({}),
  }
}

test('compact rendering separates proof from uniform hypothesis shares and shows a joint fact', () => {
  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.id === 'percival-opening-discussion',
  )!
  const rendered = experimentalBeliefContext(fixture.view).rendered
  assert.match(rendered, /PROVEN GOOD:/)
  assert.match(rendered, /PROVEN EVIL:/)
  assert.match(rendered, /uniform share of feasible hypotheses/)
  assert.match(rendered, /Exactly one of .* is evil\./)
  assert.match(rendered, /Top joint alignment hypotheses:/)
  assert.doesNotMatch(rendered, /calibrated suspicion|behavioral likelihood: 100%/i)
  assert.doesNotMatch(rendered, /[\u2013\u2014]/)
  assert.doesNotMatch(rendered, /\bthat(?:'s| is) not\b[^.!?\n]*\bthat(?:'s| is)\b/i)
  const unresolvedLines = rendered
    .split('\n')
    .filter((line) => line.startsWith('  ') && line.includes('| evil uniform share'))
  assert.ok(unresolvedLines.length > 0)
  assert.ok(unresolvedLines.every((line) => !/: 0%|: 100%/.test(line)))
})

test('default LLM prompts omit belief visibility and experimental prompts receive it', async () => {
  const game = createGame({ seed: 'prompt-isolation', playerCount: 5 })
  const view = viewFor(game, game.leaderSeat)
  const req = { kind: 'propose' as const, seat: view.seat, round: 1, proposalNum: 1 }

  const defaults: string[][] = []
  const defaultAgent = createLlmAgent({
    modelId: 'deepseek-flash',
    client: captureClient(
      JSON.stringify({ thinking: 'plain', team: [view.seat, (view.seat + 1) % 5] }),
      defaults,
    ),
  })
  await defaultAgent.decide(req, view)
  assert.ok(defaults.flat().every((text) => !text.includes('EXACT BELIEF SUMMARY')))

  const experimental: string[][] = []
  const experimentalAgent = createLlmAgent({
    modelId: 'deepseek-flash',
    client: captureClient(
      JSON.stringify({ thinking: 'uses exact summary', team: [view.seat, (view.seat + 1) % 5] }),
      experimental,
    ),
    brain: { beliefVisibility: BELIEF_RENDERER_VERSION },
  })
  // The trace rides the decide() envelope now, so the host owns persisting it.
  const traces: DecisionTrace[] = []
  const experimentalOutput = await experimentalAgent.decide(req, view)
  if (experimentalOutput.trace) traces.push(experimentalOutput.trace)
  assert.ok(experimental.flat().some((text) => text.includes('EXACT BELIEF SUMMARY')))
  assert.equal(traces.length, 1)
  assert.equal(traces[0]!.statedReasoning, 'uses exact summary')
  assert.equal(traces[0]!.action.kind, 'propose')
  assert.ok(traces[0]!.degradation.includes('pitch-failed'))
  assert.equal(
    traces[0]!.beliefThroughSeq,
    view.events.reduce((cursor, event) => Math.max(cursor, event.seq), -1),
  )
})

test('parsed-but-unusable reflection output is recorded as trace degradation', async () => {
  const game = createGame({
    seed: 'reflection-trace-degradation',
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const team = [game.leaderSeat, (game.leaderSeat + 1) % game.config.playerCount]
  applyDecision(game, game.leaderSeat, { kind: 'propose', team })
  for (const player of game.players) {
    applyDecision(game, player.seat, { kind: 'vote', vote: 'approve' })
  }
  for (const seat of team) {
    applyDecision(game, seat, { kind: 'quest', card: 'success' })
  }

  const view = viewFor(game, game.leaderSeat)
  const outputs = [
    JSON.stringify({ suspicions: [] }),
    JSON.stringify({ vote: 'approve', thinking: 'continue' }),
  ]
  const agent = createLlmAgent({
    modelId: 'deepseek-flash',
    client: {
      async call() {
        return outputs.shift() ?? ''
      },
      getTotalCost: () => 0,
      getSpend: () => ({}),
    },
    brain: { beliefVisibility: BELIEF_RENDERER_VERSION },
  })
  const traces: DecisionTrace[] = []
  const reflected = await agent.decide({
    kind: 'vote',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }, view)
  if (reflected.trace) traces.push(reflected.trace)
  assert.deepEqual(traces[0]!.degradation, ['reflection-failed'])
})

test('live incremental block and fixed-view preview block use identical rendering', () => {
  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.id === 'servant-vote-after-evidence',
  )!
  const expected = experimentalBeliefContext(fixture.view).rendered
  const messages = buildMessages(
    fixture.req.kind,
    fixture.view,
    '',
    {},
    undefined,
    { beliefVisibility: BELIEF_RENDERER_VERSION },
  )
  assert.ok(messages[1]!.content.includes(expected))
})

test('seat-scoped belief prompts do not leak another seat private knowledge', () => {
  const game = createGame({ seed: 'belief-seat-leak', playerCount: 7 })
  const oberon = game.players.find((player) => player.role === 'oberon')!
  const otherEvil = game.players.find((player) =>
    player.alignment === 'evil' && player.role !== 'oberon')!
  const rendered = experimentalBeliefContext(viewFor(game, otherEvil.seat)).rendered
  const oberonName = game.players[oberon.seat]!.name
  const provenEvil = rendered.split('\n').find((line) => line.startsWith('PROVEN EVIL:'))!
  assert.ok(!provenEvil.includes(oberonName), 'unseen Oberon must not be rendered as proven evil')
})
