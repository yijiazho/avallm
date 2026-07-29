import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configuredScoreLayerTerminalFor,
  configuredScoreLayersApplyToDecision,
  createConfiguredScoreLayerRegistry,
} from '../server/agents/score-layers/configured.ts'
import {
  COMPATIBILITY_SCORE_LAYER,
  GOOD_PROPOSAL_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/good.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/evil.ts'
import {
  compareCandidateIds,
} from '../server/agents/policy/candidates.ts'
import {
  evilRoleObjectiveScorer,
  goodProposalScorer,
  goodProposalVoteScorer,
  roleObjectiveScorer,
  seededEvilRoleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededRoleObjectiveScorer,
} from '../server/agents/policy/score.ts'

test('configured score seam owns family selection and registry construction', () => {
  const cases = [
    [undefined, COMPATIBILITY_SCORE_LAYER],
    [goodProposalScorer, GOOD_PROPOSAL_SCORE_LAYER],
    [goodProposalVoteScorer, GOOD_PROPOSAL_VOTE_SCORE_LAYER],
    [
      seededGoodProposalVoteScorer,
      SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
    ],
    [roleObjectiveScorer, GOOD_ROLE_SCORE_LAYER],
    [seededRoleObjectiveScorer, SEEDED_GOOD_ROLE_SCORE_LAYER],
    [evilRoleObjectiveScorer, EVIL_ROLE_SCORE_LAYER],
    [seededEvilRoleObjectiveScorer, SEEDED_EVIL_ROLE_SCORE_LAYER],
  ] as const
  const registry = createConfiguredScoreLayerRegistry()
  assert.equal(registry.size, 8)
  for (const [scorer, terminal] of cases) {
    assert.equal(configuredScoreLayerTerminalFor(scorer), terminal)
    const chain = registry.resolve({ terminal })
    assert.equal(chain.order[0].id, COMPATIBILITY_SCORE_LAYER.id)
    assert.equal(chain.order.at(-1)?.id, terminal.id)
  }
  assert.equal(
    configuredScoreLayerTerminalFor({ ...goodProposalScorer }),
    undefined,
  )
  assert.equal(
    configuredScoreLayerTerminalFor({ ...evilRoleObjectiveScorer }),
    undefined,
  )
})

test('configured applicability remains narrow pending later families', () => {
  assert.equal(configuredScoreLayersApplyToDecision('propose'), true)
  assert.equal(configuredScoreLayersApplyToDecision('vote'), true)
  for (const kind of [
    'discuss',
    'finalize',
    'quest',
    'assassinate',
  ] as const) {
    assert.equal(configuredScoreLayersApplyToDecision(kind), false)
  }
})

test('candidate ties use deterministic UTF-16 code-unit lexical ordering', () => {
  const ids = ['z', 'aa', 'a', 'A', 'ä', '😀']
  assert.deepEqual(
    [...ids].sort(compareCandidateIds),
    ['A', 'a', 'aa', 'z', 'ä', '😀'],
  )
  for (const left of ids) {
    for (const right of ids) {
      if (left === right) {
        assert.equal(compareCandidateIds(left, right), 0)
      } else {
        assert.equal(
          Math.sign(compareCandidateIds(left, right)),
          -Math.sign(compareCandidateIds(right, left)),
        )
      }
    }
  }
})
