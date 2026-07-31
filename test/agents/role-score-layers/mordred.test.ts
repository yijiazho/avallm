// test-lane: contract
// Migration phase 7E2B; see docs/agent-architecture-migration.md.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame } from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../../../server/engine/types.ts'
import { createComposedAgent } from '../../../server/agents/composed.ts'
import {
  MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
  MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
  evilRoleObjectiveScorer,
  mordredBlindnessRoleScorer,
  seededMordredBlindnessRoleScorer,
} from '../../../server/agents/policy/score.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
} from '../../../server/agents/role-score-layers/evil.ts'
import {
  mordredScoreLayerDefinitions,
} from '../../../server/agents/role-score-layers/mordred.ts'
import type {
  ScoreLayerTransformContext,
} from '../../../server/agents/policy/score-layer/types.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  seededEvilRoleObjectiveScorer,
} from '../../../server/agents/policy/score.ts'
import {
  MORDRED_BLINDNESS_COMPONENT,
} from '../../../server/agents/components/native-role-components.ts'
import {
  asVote,
  assertScoreFamilyConformance,
} from '../../support/score-family.ts'

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

const mordredFixture = mordredProposal()

assertScoreFamilyConformance({
  family: 'mordred',
  seed: mordredFixture.game.seed,
  agent: { roleObjectiveRouter: true },
  deterministic: {
    scorer: mordredBlindnessRoleScorer,
    version: MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
    components: [MORDRED_BLINDNESS_COMPONENT],
    predecessor: {
      scorer: evilRoleObjectiveScorer,
      version: EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
    },
  },
  seeded: {
    scorer: seededMordredBlindnessRoleScorer,
    version: MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
    components: [MORDRED_BLINDNESS_COMPONENT],
    predecessor: {
      scorer: seededEvilRoleObjectiveScorer,
      version: EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    },
  },
  eligible: [
    {
      label: 'Mordred proposal',
      req: mordredFixture.req,
      view: mordredFixture.view,
    },
    {
      label: 'Mordred vote',
      ...asVote(mordredFixture.view),
    },
  ],
  delegating: [
    {
      label: 'Mordred discussion',
      req: {
        kind: 'discuss',
        seat: mordredFixture.view.seat,
        round: mordredFixture.view.round,
        proposalNum: mordredFixture.view.proposalNum,
      },
      view: { ...structuredClone(mordredFixture.view), phase: 'discussion' },
      resolvedVersions: {
        [MORDRED_BLINDNESS_ROLE_SCORER_VERSION]:
          GOOD_PROPOSAL_VOTE_SCORER_VERSION,
        [MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION]:
          GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
      },
    },
  ],
  // This real 9-player deal never lands inside the seeded near-equal D2 band,
  // so both kinds are invariant here. The band itself is hand-worked below.
})

test('Mordred blindness value causally changes a D2-viable proposal', async () => {
  const input = mordredFixture
  const d2 = await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: evilRoleObjectiveScorer,
  }).decide(input.req, input.view)
  const result = await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: mordredBlindnessRoleScorer,
  }).decide(input.req, input.view)
  const trace = result.trace!
  assert.notDeepEqual(result.decision, d2.decision)
  const chosen = trace.candidateScores!.find(
    (score) => score.candidateId === trace.structuredCandidateId,
  )!
  assert.deepEqual(chosen.reasonCodes, [
    'FORCED_POLICY_ALLOWED',
    'MORDRED_D2_VIABLE_BAND',
    'MORDRED_BLINDNESS_OPPORTUNITY',
  ])
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
  // Applicability gates on role and kind only. validateRoles guarantees Merlin
  // wherever Mordred is seated, so applicability does not re-check rolesInPlay:
  // a Mordred seat still applies on vote without it.
  assert.equal(definition.applies({
    ...applicable,
    view: { ...applicable.view, rolesInPlay: ['mordred'] },
  }), true)

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
