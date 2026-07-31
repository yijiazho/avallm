// test-lane: contract
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configuredScoreFamilyWiring,
  configuredScoreLayerTerminalFor,
  configuredScoreLayersApplyToDecision,
  createConfiguredScoreLayerRegistry,
} from '../server/agents/role-score-layers/configured.ts'
import {
  ScoreLayerFamilyError,
  resolveScoreLayerFamilyTree,
  type ScoreLayerFamilyDeclaration,
  type ScoreLayerLaneDeclaration,
} from '../server/agents/policy/score-layer/families.ts'
import { scoreLayerToken } from '../server/agents/policy/score-layer/types.ts'
import {
  COMPATIBILITY_SCORE_LAYER,
  GOOD_PROPOSAL_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
} from '../server/agents/role-score-layers/good.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
} from '../server/agents/role-score-layers/evil.ts'
import {
  MORGANA_ROLE_SCORE_LAYER,
  SEEDED_MORGANA_ROLE_SCORE_LAYER,
} from '../server/agents/role-score-layers/morgana.ts'
import {
  MORDRED_ROLE_SCORE_LAYER,
  SEEDED_MORDRED_ROLE_SCORE_LAYER,
} from '../server/agents/role-score-layers/mordred.ts'
import {
  ASSASSIN_MERLIN_TARGET_SCORE_LAYER,
} from '../server/agents/role-score-layers/assassin.ts'
import {
  FULL_ROLE_POLICY_SCORE_LAYER,
} from '../server/agents/role-score-layers/full-role.ts'
import {
  compareCandidateIds,
} from '../server/agents/policy/candidates.ts'
import {
  ASSASSIN_CLAIM,
  EVIL_CLAIM,
  MORDRED_CLAIM,
  MORGANA_CLAIM,
  appliesFrom,
  assertRoleClaimsPartition,
  type Applicability,
} from '../server/agents/policy/applicability.ts'
import {
  projectConfiguredScoreDiagnostics,
} from '../server/agents/policy/project-score-diagnostics.ts'
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
  boardSwingGoodProposalVoteScorer,
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
    [
      boardSwingGoodProposalVoteScorer,
      GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER,
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
  assert.equal(registry.size, 15)
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

test('family bases stay separate from the derived linear predecessors', () => {
  assert.deepEqual(
    configuredScoreFamilyWiring().map((entry) => [
      entry.family,
      entry.lane,
      entry.base,
      entry.predecessor.id,
      entry.viaSibling,
    ]),
    [
      // Every family names its truthful base. Only the composed lane routes a
      // family through an inapplicable sibling to reach that base's surface.
      ['evil', 'deterministic', 'good', GOOD_ROLE_SCORE_LAYER.id, false],
      ['evil', 'seeded', 'good', SEEDED_GOOD_ROLE_SCORE_LAYER.id, false],
      ['morgana', 'deterministic', 'evil', EVIL_ROLE_SCORE_LAYER.id, false],
      ['morgana', 'seeded', 'evil', SEEDED_EVIL_ROLE_SCORE_LAYER.id, false],
      // Mordred is a sibling of Morgana, so its base is evil in both lanes.
      // The composed lane still hands it Morgana because the full-role
      // terminal has to traverse both siblings; the seeded lane has no such
      // terminal and hangs Mordred straight off seeded evil.
      ['mordred', 'deterministic', 'evil', MORGANA_ROLE_SCORE_LAYER.id, true],
      ['mordred', 'seeded', 'evil', SEEDED_EVIL_ROLE_SCORE_LAYER.id, false],
      [
        'assassin',
        'deterministic',
        'evil',
        MORDRED_ROLE_SCORE_LAYER.id,
        true,
      ],
      [
        'full-role',
        'deterministic',
        null,
        ASSASSIN_MERLIN_TARGET_SCORE_LAYER.id,
        false,
      ],
    ],
  )
})

test('role claims derive applies and are enforced to partition', () => {
  const context = (
    fields: {
      role?: string
      alignment?: string
      kind: string
    },
  ) => ({
    view: {
      role: fields.role ?? 'servant',
      alignment: fields.alignment ?? 'good',
    },
    request: { kind: fields.kind },
  }) as never

  // Derived predicates gate on role/alignment and kind only.
  const evil = appliesFrom(EVIL_CLAIM)
  const morgana = appliesFrom(MORGANA_CLAIM)
  const assassin = appliesFrom(ASSASSIN_CLAIM)
  assert.equal(evil(context({ alignment: 'evil', kind: 'vote' })), true)
  assert.equal(evil(context({ alignment: 'good', kind: 'vote' })), false)
  assert.equal(evil(context({ alignment: 'evil', kind: 'assassinate' })), false)
  assert.equal(morgana(context({ role: 'morgana', kind: 'propose' })), true)
  assert.equal(morgana(context({ role: 'mordred', kind: 'propose' })), false)
  assert.equal(
    assassin(context({ role: 'assassin', kind: 'assassinate' })),
    true,
  )
  assert.equal(assassin(context({ role: 'assassin', kind: 'vote' })), false)

  // The real tree partitions, and the alignment base co-applies without
  // tripping the check.
  assert.doesNotThrow(() => assertRoleClaimsPartition([
    EVIL_CLAIM,
    MORGANA_CLAIM,
    MORDRED_CLAIM,
    ASSASSIN_CLAIM,
  ]))
  // A second layer claiming an already-claimed role is rejected, even when it
  // narrows to a different kind: a seat has one role and both would run.
  const shadowMorgana: Applicability = {
    by: 'role',
    role: 'morgana',
    kinds: ['assassinate'],
  }
  assert.throws(
    () => assertRoleClaimsPartition([MORGANA_CLAIM, shadowMorgana]),
    /both claim role morgana/,
  )
})

test('family tree derivation rejects declarations that would invert it', () => {
  const lanes: readonly ScoreLayerLaneDeclaration<'wide' | 'narrow'>[] = [
    { id: 'wide', rationale: 'the whole stack' },
    { id: 'narrow', rationale: 'selected one at a time' },
  ]
  const tip = (name: string) => scoreLayerToken(name, 'v1')
  const family = (
    overrides: Partial<ScoreLayerFamilyDeclaration<'wide' | 'narrow'>>,
  ): ScoreLayerFamilyDeclaration<'wide' | 'narrow'> => ({
    id: 'unnamed',
    kind: 'specialization',
    base: 'first',
    baseRationale: 'declared for this case',
    lanes: { wide: tip('unnamed-wide'), narrow: tip('unnamed-narrow') },
    register: () => [],
    ...overrides,
  })
  const root = family({
    id: 'first',
    kind: 'root',
    base: null,
    lanes: { wide: tip('first-wide'), narrow: tip('first-narrow') },
  })
  const second = family({
    id: 'second',
    lanes: { wide: tip('second-wide'), narrow: tip('second-narrow') },
  })

  // A composed lane places 'third' after 'second' even though its base is the
  // root, and the derived predecessor records that it arrived via a sibling.
  const third = family({
    id: 'third',
    lanes: { wide: tip('third-wide'), narrow: tip('third-narrow') },
  })
  const whole = family({
    id: 'whole',
    kind: 'composition',
    base: null,
    lanes: { wide: tip('whole-wide') },
  })
  assert.deepEqual(
    resolveScoreLayerFamilyTree({
      lanes,
      families: [root, second, third, whole],
    })
      .wiring
      .filter((entry) => entry.family === 'third')
      .map((entry) => [
        entry.lane,
        entry.mode,
        entry.predecessor.id,
        entry.viaSibling,
      ]),
    [
      // 'whole' joins only the wide lane, so only that lane is composed.
      ['wide', 'composed', 'second-wide', true],
      ['narrow', 'isolated', 'first-narrow', false],
    ],
  )

  // A base declared after its specialization cannot be linearized truthfully.
  assert.throws(
    () => resolveScoreLayerFamilyTree({
      lanes,
      families: [root, family({ id: 'early', base: 'late' }), family({
        id: 'late',
        lanes: { wide: tip('late-wide'), narrow: tip('late-narrow') },
      })],
    }),
    (error: unknown) => error instanceof ScoreLayerFamilyError
      && error.code === 'unknown-base',
  )

  // A family cannot join an isolated lane its base skipped.
  assert.throws(
    () => resolveScoreLayerFamilyTree({
      lanes,
      families: [
        root,
        family({ id: 'wide-only', lanes: { wide: tip('wide-only') } }),
        family({
          id: 'both',
          base: 'wide-only',
          lanes: { wide: tip('both-wide'), narrow: tip('both-narrow') },
        }),
      ],
    }),
    (error: unknown) => error instanceof ScoreLayerFamilyError
      && error.code === 'missing-lane-predecessor',
  )

  // A composition speaks for the whole stack, so nothing may follow it.
  assert.throws(
    () => resolveScoreLayerFamilyTree({
      lanes,
      families: [root, whole, second],
    }),
    (error: unknown) => error instanceof ScoreLayerFamilyError
      && error.code === 'misplaced-composition',
  )

  // Dropping the composition is the only way to make the wide lane isolated:
  // 'third' then hangs off its own base's tip rather than off its sibling.
  // A lane cannot claim a traversal no terminal needs, so there is no
  // composed-with-no-composition declaration to reject.
  assert.deepEqual(
    resolveScoreLayerFamilyTree({ lanes, families: [root, second, third] })
      .wiring
      .filter((entry) => entry.family === 'third')
      .map((entry) => [entry.lane, entry.mode, entry.predecessor.id]),
    [
      ['wide', 'isolated', 'first-wide'],
      ['narrow', 'isolated', 'first-narrow'],
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
