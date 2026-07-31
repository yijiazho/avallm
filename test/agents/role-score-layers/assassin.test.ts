// test-lane: contract
// Migration phase 7E3B; see docs/agent-architecture-migration.md.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createComposedAgent } from '../../../server/agents/composed.ts'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../../../server/engine/types.ts'
import { heuristicDecide } from '../../../server/agents/heuristic.ts'
import {
  ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
} from '../../../server/agents/components/native-role-components.ts'
import {
  assassinScoreLayerDefinitions,
} from '../../../server/agents/role-score-layers/assassin.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
} from '../../../server/agents/role-score-layers/evil.ts'
import type {
  ScoreLayerTransformContext,
} from '../../../server/agents/policy/score-layer/types.ts'
import {
  ASSASSIN_MERLIN_TARGET_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  assassinMerlinTargetScorer,
  evilRoleObjectiveScorer,
} from '../../../server/agents/policy/score.ts'
import {
  assertScoreFamilyConformance,
} from '../../support/score-family.ts'

const ROLES: Role[] = [
  'merlin', 'servant', 'servant', 'assassin', 'mordred',
]

function fixture() {
  const game = createGame({
    seed: 'e3b-real', playerCount: 5, roles: ROLES,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const assassinSeat = game.players.find(
    (player) => player.role === 'assassin',
  )!.seat
  let assassinVote: { req: DecisionRequest; view: PlayerView } | undefined
  while (game.phase !== 'assassination') {
    const req = expectedDecisions(game)[0]
    const view = viewFor(game, req.seat)
    if (req.kind === 'vote' && req.seat === assassinSeat && !assassinVote) {
      assassinVote = { req, view }
    }
    const decision = req.kind === 'quest'
      ? { kind: 'quest' as const, card: 'success' as const }
      : heuristicDecide(req, view, game.seed)
    applyDecision(game, req.seat, decision)
  }
  const req = expectedDecisions(game)[0] as DecisionRequest
  const view = viewFor(game, req.seat)
  if (!assassinVote) throw new Error('fixture reached no Assassin vote')
  return { game, view, req, assassinVote }
}

const assassinFixture = fixture()

assertScoreFamilyConformance({
  family: 'assassin',
  seed: assassinFixture.game.seed,
  agent: { roleObjectiveRouter: true },
  deterministic: {
    scorer: assassinMerlinTargetScorer,
    version: ASSASSIN_MERLIN_TARGET_SCORER_VERSION,
    components: [ASSASSIN_MERLIN_POSTERIOR_COMPONENT],
    predecessor: {
      scorer: evilRoleObjectiveScorer,
      version: EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
    },
  },
  eligible: [
    {
      label: 'Assassin shot',
      req: assassinFixture.req,
      view: assassinFixture.view,
    },
  ],
  delegating: [
    {
      label: 'Assassin vote',
      req: assassinFixture.assassinVote.req,
      view: assassinFixture.assassinVote.view,
    },
  ],
})

test('Assassin posterior owns the shot and separates it from generic evil value', async () => {
  const input = assassinFixture
  const base = await createComposedAgent({
    seed: input.game.seed, roleObjectiveRouter: true,
  }).decide(input.req, input.view)
  const result = await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: assassinMerlinTargetScorer,
  }).decide(input.req, input.view)
  assert.notDeepEqual(result.decision, base.decision)
  const use = result.trace!.components!.policyUse.find(
    (entry) => entry.component.id === ASSASSIN_MERLIN_POSTERIOR_COMPONENT.id,
  )
  assert.deepEqual(use?.stages, ['candidate-score', 'action-selection'])
})

function context(input: {
  survivors?: readonly string[]
  selected?: string
} = {}): ScoreLayerTransformContext {
  const candidates = [1, 2, 3].map((target) => ({
    id: `legal-candidates-v1:assassinate:${target}`,
    decision: { kind: 'assassinate' as const, target },
  }))
  return {
    request: { kind: 'assassinate', seat: 0, round: 3, proposalNum: 1 },
    view: { role: 'assassin', rolesInPlay: ['merlin', 'assassin'] },
    analysis: { throughSeq: 7 },
    candidates,
    candidateBoundary: {
      survivorCandidateIds: input.survivors ?? candidates.map(({ id }) => id),
      ...(input.selected ? { selectedCandidateId: input.selected } : {}),
    },
    deterministicSeed: 'unused',
    prior: {
      scores: candidates.map(({ id }) => ({
        candidateId: id, value: 0, viable: true, reasonCodes: [],
      })),
      survivorCandidateIds: candidates.map(({ id }) => id),
    },
    components: { require: () => ({
      source: { beliefThroughSeq: 7 },
      targets: candidates.map(({ decision }, index) => ({
        seat: decision.target,
        posteriorProbability: index === 2 ? 0.1 : 0.45,
      })),
    }) },
    surface: { create: (draft: unknown) => draft },
  } as unknown as ScoreLayerTransformContext
}

test('canonical ties and the hard boundary dominate target ranking', () => {
  const layer = assassinScoreLayerDefinitions(EVIL_ROLE_SCORE_LAYER)[0]
  assert.equal(layer.kind, 'transform')
  if (layer.kind !== 'transform') throw new Error('expected transform')
  const tie = layer.execute(context())
  assert.equal(tie.status, 'applied')
  if (tie.status !== 'applied') throw new Error('expected application')
  assert.equal(
    tie.surface.scores.find((row) => row.viable)?.candidateId,
    'legal-candidates-v1:assassinate:1',
  )
  const hardId = 'legal-candidates-v1:assassinate:3'
  const hard = layer.execute(context({ survivors: [hardId], selected: hardId }))
  assert.equal(hard.status, 'applied')
  if (hard.status !== 'applied') throw new Error('expected application')
  assert.deepEqual(
    hard.surface.scores.filter((row) => row.viable).map((row) => row.candidateId),
    [hardId],
  )
  assert.equal(layer.applies({
    ...context(),
    request: { kind: 'vote' },
  } as never), false)
  assert.equal(layer.applies({
    ...context(),
    view: { role: 'servant', rolesInPlay: ['merlin'] },
  } as never), false)
})
