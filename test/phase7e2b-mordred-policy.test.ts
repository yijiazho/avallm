import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  normalizeAgentOutput,
} from '../server/agents/types.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'
import {
  admitDecisionTrace,
} from '../server/agents/admission/composed-trace.ts'
import {
  evilRoleObjectiveScorer,
  mordredBlindnessRoleScorer,
  seededMordredBlindnessRoleScorer,
} from '../server/agents/policy/score.ts'
import {
  MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
  MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
} from '../server/agents/policy/mordred-score-contract.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/evil.ts'
import {
  mordredScoreLayerDefinitions,
} from '../server/agents/score-layers/mordred.ts'
import type {
  ScoreLayerTransformContext,
} from '../server/agents/policy/score-layer/types.ts'

const ROLES: Role[] = [
  'merlin',
  'percival',
  'servant',
  'servant',
  'servant',
  'servant',
  'assassin',
  'morgana',
  'mordred',
]

function mordredProposal(): {
  game: ReturnType<typeof createGame>
  view: PlayerView
  req: DecisionRequest & { kind: 'propose' }
} {
  const game = createGame({
    seed: 'find-4',
    playerCount: 9,
    roles: ROLES,
  })
  const mordred = game.players.find((player) => player.role === 'mordred')!
  assert.equal(mordred.seat, game.leaderSeat)
  const view = viewFor(game, mordred.seat)
  return {
    game,
    view,
    req: {
      kind: 'propose',
      seat: mordred.seat,
      round: game.round,
      proposalNum: game.proposalNum,
    },
  }
}

test('Mordred specialization changes a D2-viable proposal and admits exactly', async () => {
  const input = mordredProposal()
  const d2 = normalizeAgentOutput(await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: evilRoleObjectiveScorer,
  }).decide(input.req, input.view))
  const agent = createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: mordredBlindnessRoleScorer,
  })
  const result = normalizeAgentOutput(
    await agent.decide(input.req, input.view),
  )
  const trace = result.trace!
  assert.notDeepEqual(result.decision, d2.decision)
  assert.equal(
    trace.componentVersions?.scorer,
    MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
  )
  const chosen = trace.candidateScores!.find(
    (score) => score.candidateId === trace.structuredCandidateId,
  )!
  assert.deepEqual(chosen.reasonCodes, [
    'FORCED_POLICY_ALLOWED',
    'MORDRED_D2_VIABLE_BAND',
    'MORDRED_BLINDNESS_OPPORTUNITY',
  ])
  assert.equal(
    trace.candidateScores!.filter((score) => score.viable).length,
    1,
  )
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace,
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

test('seeded proposals remain deterministic and ineligible requests delegate', async () => {
  const input = mordredProposal()
  const first = normalizeAgentOutput(await createComposedAgent({
    seed: 'proposal-seed-a',
    roleObjectiveRouter: true,
    scorer: seededMordredBlindnessRoleScorer,
  }).decide(input.req, input.view))
  const second = normalizeAgentOutput(await createComposedAgent({
    seed: 'proposal-seed-b',
    roleObjectiveRouter: true,
    scorer: seededMordredBlindnessRoleScorer,
  }).decide(input.req, input.view))
  assert.deepEqual(first.decision, second.decision)
  assert.equal(
    first.trace!.componentVersions?.scorer,
    MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
  )

  const discussView = structuredClone(input.view)
  discussView.phase = 'discussion'
  const discuss = normalizeAgentOutput(await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: mordredBlindnessRoleScorer,
  }).decide({
    kind: 'discuss',
    seat: discussView.seat,
    round: discussView.round,
    proposalNum: discussView.proposalNum,
  }, discussView))
  assert.equal(
    discuss.trace!.componentVersions?.scorer,
    'good-proposal-vote-scorer-v1',
  )
})

const APPROVE_ID = 'legal-candidates-v1:vote:approve'
const REJECT_ID = 'legal-candidates-v1:vote:reject'

function unitVoteContext(input: {
  seed: string
  approveD2: number
  rejectD2: number
  opportunity: number
  survivors?: readonly string[]
  selected?: string
}): ScoreLayerTransformContext {
  const candidates = [
    { id: APPROVE_ID, decision: { kind: 'vote', vote: 'approve' } },
    { id: REJECT_ID, decision: { kind: 'vote', vote: 'reject' } },
  ]
  return {
    request: { kind: 'vote', seat: 4, round: 2, proposalNum: 3 },
    view: {
      role: 'mordred',
      rolesInPlay: ['merlin', 'mordred'],
      currentTeam: [1, 4],
    },
    analysis: { throughSeq: 17 },
    candidates,
    candidateBoundary: {
      survivorCandidateIds:
        input.survivors ?? [APPROVE_ID, REJECT_ID],
      ...(input.selected ? { selectedCandidateId: input.selected } : {}),
    },
    deterministicSeed: input.seed,
    prior: {
      scores: candidates.map((candidate, index) => ({
        candidateId: candidate.id,
        value: index === 0 ? input.approveD2 : input.rejectD2,
        viable: true,
        reasonCodes: [],
      })),
      survivorCandidateIds: [APPROVE_ID, REJECT_ID],
    },
    components: {
      require: () => ({
        role: 'mordred',
        source: { beliefThroughSeq: 17 },
        request: { kind: 'vote', seat: 4, round: 2, proposalNum: 3 },
        assessments: [{
          team: {
            teamId: 'team:1,4',
            requestContext: 'vote',
          },
          opportunityValue: input.opportunity,
        }],
      }),
    },
    surface: { create: (draft: unknown) => draft },
  } as unknown as ScoreLayerTransformContext
}

test('seeded vote variation stays inside both bounded gates', () => {
  const definition = mordredScoreLayerDefinitions({
    deterministic: EVIL_ROLE_SCORE_LAYER,
    seeded: SEEDED_EVIL_ROLE_SCORE_LAYER,
  })[1]
  assert.equal(definition.kind, 'transform')
  if (definition.kind !== 'transform') throw new Error('expected transform')
  const applicable = unitVoteContext({
    seed: 'applicability',
    approveD2: 0.51,
    rejectD2: 0.5,
    opportunity: 0.51,
  })
  assert.equal(definition.applies(applicable), true)
  assert.equal(definition.applies({
    ...applicable,
    view: { ...applicable.view, role: 'servant' },
  }), false)
  assert.equal(definition.applies({
    ...applicable,
    view: { ...applicable.view, rolesInPlay: ['mordred'] },
  }), false)

  const decisions = new Set<string>()
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const result = definition.execute(unitVoteContext({
      seed,
      approveD2: 0.51,
      rejectD2: 0.5,
      opportunity: 0.51,
    }))
    assert.equal(result.status, 'applied')
    if (result.status !== 'applied') throw new Error('expected application')
    const selected = result.surface.scores.find((row) => row.viable)!
    decisions.add(selected.candidateId)
    assert.ok(selected.reasonCodes.includes('MORDRED_D2_VIABLE_BAND'))
    assert.ok(selected.reasonCodes.includes('MORDRED_SEEDED_VOTE_BAND'))
  }
  assert.equal(decisions.size, 2)

  const outside = definition.execute(unitVoteContext({
    seed: 'outside',
    approveD2: 0.4,
    rejectD2: 0.5,
    opportunity: 0.9,
  }))
  assert.equal(outside.status, 'applied')
  if (outside.status !== 'applied') throw new Error('expected application')
  assert.equal(
    outside.surface.scores.find((row) => row.viable)?.candidateId,
    REJECT_ID,
  )

  const hard = definition.execute(unitVoteContext({
    seed: 'hard',
    approveD2: 0.4,
    rejectD2: 0.5,
    opportunity: 0.1,
    survivors: [APPROVE_ID],
    selected: APPROVE_ID,
  }))
  assert.equal(hard.status, 'applied')
  if (hard.status !== 'applied') throw new Error('expected application')
  assert.equal(
    hard.surface.scores.find((row) => row.viable)?.candidateId,
    APPROVE_ID,
  )
})
