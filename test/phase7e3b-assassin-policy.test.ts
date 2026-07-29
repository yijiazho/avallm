import assert from 'node:assert/strict'
import test from 'node:test'
import { createComposedAgent } from '../server/agents/composed.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type { DecisionRequest, Role } from '../server/engine/types.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import {
  admitDecisionTrace,
} from '../server/agents/admission/composed-trace.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'
import {
  assassinMerlinTargetScorer,
} from '../server/agents/policy/score.ts'
import {
  ASSASSIN_MERLIN_TARGET_SCORER_VERSION,
} from '../server/agents/policy/assassin-score-contract.ts'
import {
  ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
} from '../server/agents/components/native-role-components.ts'
import {
  assassinScoreLayerDefinitions,
} from '../server/agents/score-layers/assassin.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/evil.ts'
import type {
  ScoreLayerTransformContext,
} from '../server/agents/policy/score-layer/types.ts'

const ROLES: Role[] = [
  'merlin', 'servant', 'servant', 'assassin', 'mordred',
]

function fixture() {
  const game = createGame({
    seed: 'e3b-real', playerCount: 5, roles: ROLES,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  while (game.phase !== 'assassination') {
    const req = expectedDecisions(game)[0]
    const view = viewFor(game, req.seat)
    const decision = req.kind === 'quest'
      ? { kind: 'quest' as const, card: 'success' as const }
      : heuristicDecide(req, view, game.seed)
    applyDecision(game, req.seat, decision)
  }
  const req = expectedDecisions(game)[0] as DecisionRequest
  const view = viewFor(game, req.seat)
  return { game, view, req }
}

test('Assassin posterior owns the shot and exact causal attribution', async () => {
  const input = fixture()
  const base = normalizeAgentOutput(await createComposedAgent({
    seed: input.game.seed, roleObjectiveRouter: true,
  }).decide(input.req, input.view))
  const agent = createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: assassinMerlinTargetScorer,
  })
  const result = normalizeAgentOutput(await agent.decide(input.req, input.view))
  assert.notDeepEqual(result.decision, base.decision)
  assert.equal(
    result.trace!.componentVersions?.scorer,
    ASSASSIN_MERLIN_TARGET_SCORER_VERSION,
  )
  const use = result.trace!.components!.policyUse.find(
    (entry) => entry.component.id === ASSASSIN_MERLIN_POSTERIOR_COMPONENT.id,
  )
  assert.equal(use?.component.version, ASSASSIN_MERLIN_POSTERIOR_COMPONENT.version)
  assert.equal(use?.used, true)
  assert.deepEqual(use?.stages, ['candidate-score', 'action-selection'])
  assert.deepEqual(
    result.trace!.candidateScores!.filter((row) => row.viable)
      .map((row) => row.candidateId),
    [result.trace!.structuredCandidateId],
  )
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: result.trace!,
    req: input.req,
    view: input.view,
    authoritativeAction: result.decision,
    selectedDecision: result.decision,
    deterministicSeed: input.game.seed,
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  }).kind, 'trusted-exact')
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
