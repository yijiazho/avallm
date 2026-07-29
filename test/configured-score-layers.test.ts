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
  MORGANA_ROLE_SCORE_LAYER,
  SEEDED_MORGANA_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/morgana.ts'
import {
  MORDRED_ROLE_SCORE_LAYER,
  SEEDED_MORDRED_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/mordred.ts'
import {
  ASSASSIN_MERLIN_TARGET_SCORE_LAYER,
} from '../server/agents/score-layers/assassin.ts'
import {
  FULL_ROLE_POLICY_SCORE_LAYER,
} from '../server/agents/score-layers/full-role.ts'
import {
  compareCandidateIds,
} from '../server/agents/policy/candidates.ts'
import {
  projectConfiguredScoreDiagnostics,
} from '../server/agents/policy/score-compatibility.ts'
import {
  combineSituationAnalysisRequirements,
  GOOD_PROPOSAL_ANALYSIS,
  GOOD_VOTE_ANALYSIS,
} from '../server/agents/analysis/situation-plan.ts'
import {
  createEvilRoleObjectiveScorer,
  createGoodProposalVoteScorer,
  createMorganaRoleScorer,
  createMordredBlindnessRoleScorer,
  createRoleObjectiveScorer,
  evilRoleObjectiveScorer,
  goodProposalScorer,
  goodProposalVoteScorer,
  morganaRoleScorer,
  mordredBlindnessRoleScorer,
  roleObjectiveScorer,
  seededEvilRoleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededMorganaRoleScorer,
  seededMordredBlindnessRoleScorer,
  seededRoleObjectiveScorer,
  assassinMerlinTargetScorer,
  fullRolePolicyScorer,
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
    [morganaRoleScorer, MORGANA_ROLE_SCORE_LAYER],
    [seededMorganaRoleScorer, SEEDED_MORGANA_ROLE_SCORE_LAYER],
    [mordredBlindnessRoleScorer, MORDRED_ROLE_SCORE_LAYER],
    [
      seededMordredBlindnessRoleScorer,
      SEEDED_MORDRED_ROLE_SCORE_LAYER,
    ],
    [assassinMerlinTargetScorer, ASSASSIN_MERLIN_TARGET_SCORE_LAYER],
    [fullRolePolicyScorer, FULL_ROLE_POLICY_SCORE_LAYER],
  ] as const
  const registry = createConfiguredScoreLayerRegistry()
  assert.equal(registry.size, 14)
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
  assert.equal(
    configuredScoreLayerTerminalFor({ ...morganaRoleScorer }),
    undefined,
  )
  assert.equal(
    configuredScoreLayerTerminalFor({ ...mordredBlindnessRoleScorer }),
    undefined,
  )
  assert.equal(
    configuredScoreLayerTerminalFor({ ...assassinMerlinTargetScorer }),
    undefined,
  )
  assert.equal(
    configuredScoreLayerTerminalFor({ ...fullRolePolicyScorer }),
    undefined,
  )
  assert.equal(
    createGoodProposalVoteScorer({ selectionMode: 'top-utility' }),
    goodProposalVoteScorer,
  )
  assert.equal(
    createRoleObjectiveScorer({ selectionMode: 'seeded-composite-band' }),
    seededRoleObjectiveScorer,
  )
  assert.equal(
    createEvilRoleObjectiveScorer({
      selectionMode: 'seeded-role-utility-band',
    }),
    seededEvilRoleObjectiveScorer,
  )
  assert.equal(
    createMorganaRoleScorer({
      selectionMode: 'top-counterfeit-within-d2-band',
    }),
    morganaRoleScorer,
  )
  assert.equal(
    createMordredBlindnessRoleScorer({
      selectionMode: 'seeded-near-equal-vote-within-d2-band',
    }),
    seededMordredBlindnessRoleScorer,
  )
})

test('native family chains preserve exact predecessor order', () => {
  const registry = createConfiguredScoreLayerRegistry()
  assert.deepEqual(
    registry.resolve({ terminal: GOOD_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      GOOD_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: SEEDED_GOOD_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      SEEDED_GOOD_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: EVIL_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      GOOD_ROLE_SCORE_LAYER,
      EVIL_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: SEEDED_EVIL_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      SEEDED_GOOD_ROLE_SCORE_LAYER,
      SEEDED_EVIL_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: MORGANA_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      GOOD_ROLE_SCORE_LAYER,
      EVIL_ROLE_SCORE_LAYER,
      MORGANA_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: SEEDED_MORGANA_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      SEEDED_GOOD_ROLE_SCORE_LAYER,
      SEEDED_EVIL_ROLE_SCORE_LAYER,
      SEEDED_MORGANA_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: MORDRED_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      GOOD_ROLE_SCORE_LAYER,
      EVIL_ROLE_SCORE_LAYER,
      MORGANA_ROLE_SCORE_LAYER,
      MORDRED_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: SEEDED_MORDRED_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      SEEDED_GOOD_ROLE_SCORE_LAYER,
      SEEDED_EVIL_ROLE_SCORE_LAYER,
      SEEDED_MORDRED_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: ASSASSIN_MERLIN_TARGET_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      GOOD_ROLE_SCORE_LAYER,
      EVIL_ROLE_SCORE_LAYER,
      MORGANA_ROLE_SCORE_LAYER,
      MORDRED_ROLE_SCORE_LAYER,
      ASSASSIN_MERLIN_TARGET_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: FULL_ROLE_POLICY_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      GOOD_ROLE_SCORE_LAYER,
      EVIL_ROLE_SCORE_LAYER,
      MORGANA_ROLE_SCORE_LAYER,
      MORDRED_ROLE_SCORE_LAYER,
      ASSASSIN_MERLIN_TARGET_SCORE_LAYER,
      FULL_ROLE_POLICY_SCORE_LAYER,
    ],
  )
})

test('featureless diagnostics require resolved native registry membership', () => {
  const rows = [{
    candidateId: 'legal-candidates-v1:vote:approve',
    value: 0.5,
    viable: true,
    reasonCodes: ['GENERIC'],
  }]
  assert.throws(
    () => projectConfiguredScoreDiagnostics(
      {} as never,
      rows,
      'unknown-native-scorer-v1',
    ),
    /no admitted native diagnostic owner/,
  )
  assert.deepEqual(
    projectConfiguredScoreDiagnostics(
      {} as never,
      rows,
      'registered-featureless-scorer-v1',
      ['registered-featureless-scorer-v1'],
    ),
    [{
      ...rows[0],
      version: 'registered-featureless-scorer-v1',
    }],
  )
})

test('native analysis requirements compile to one executable plan', () => {
  assert.equal(combineSituationAnalysisRequirements([]), 'candidate-teams')
  assert.equal(
    combineSituationAnalysisRequirements([GOOD_PROPOSAL_ANALYSIS]),
    'good-proposal',
  )
  assert.equal(
    combineSituationAnalysisRequirements([
      GOOD_PROPOSAL_ANALYSIS,
      GOOD_VOTE_ANALYSIS,
    ]),
    'good-vote',
  )
  assert.throws(
    () => combineSituationAnalysisRequirements([{
      id: 'foreign',
      version: 'v1',
    }]),
    /unsupported situation analysis requirement/,
  )
})

test('default compatibility root owns every decision kind', () => {
  for (const kind of [
    'propose',
    'vote',
    'discuss',
    'finalize',
    'quest',
    'assassinate',
  ] as const) {
    assert.equal(configuredScoreLayersApplyToDecision(kind), true)
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
