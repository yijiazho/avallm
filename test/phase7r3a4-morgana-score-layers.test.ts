import assert from 'node:assert/strict'
import test from 'node:test'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  observePublicRecord,
} from '../server/agents/analysis/observer.ts'
import {
  combineSituationAnalysisRequirements,
} from '../server/agents/analysis/situation-plan.ts'
import { projectJointIdentity } from '../server/agents/belief/identity.ts'
import { reconstructCognition } from '../server/agents/cognition/state.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  PRIVATE_BELIEF_INPUT,
  PRIVATE_DETERMINISTIC_SEED_INPUT,
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_IDENTITY_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
} from '../server/agents/components/legacy-role-adapters.ts'
import { projectPublicRecord } from '../server/agents/communication/public-record.ts'
import {
  canonicalDecisionFrame,
  prepareNativeScoreLayers,
  withDecisionAnalysis,
  withLegalCandidates,
  withNativeResolvedComponents,
  withNativeScoreLayers,
  withUniversalForcedPolicy,
} from '../server/agents/policy/decision-frame.ts'
import {
  evilRoleObjectiveScorer,
  morganaRoleScorer,
  seededMorganaRoleScorer,
  type CandidateScorer,
} from '../server/agents/policy/score.ts'
import {
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
} from '../server/agents/policy/evil-score-contract.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/evil.ts'
import {
  COMPATIBILITY_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/good.ts'
import {
  MORGANA_ROLE_SCORE_LAYER,
  SEEDED_MORGANA_ROLE_SCORE_LAYER,
  morganaScoreLayerTerminalFor,
} from '../server/agents/score-layers/morgana.ts'
import {
  createConfiguredScoreLayerRegistry,
} from '../server/agents/score-layers/configured.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'
import { createGame } from '../server/engine/game.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'
import {
  replayDecisionScenario,
  type DecisionScenario,
  type LegalReplayStep,
} from './support/decision-scenario.ts'
import {
  readPhase7R3AScoreOracle,
  type Phase7R3AOracleScenario,
} from './support/phase7r3a-score-oracle.ts'

const oracle = readPhase7R3AScoreOracle()

const malformed = (source: CandidateScorer): CandidateScorer =>
  Object.freeze({ ...source, score: () => [] })

function options(configuration: string, seed: string) {
  switch (configuration) {
    case 'e1-deterministic':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: morganaRoleScorer,
      }
    case 'e1-seeded':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: seededMorganaRoleScorer,
      }
    case 'e1-malformed-fallback':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: malformed(morganaRoleScorer),
      }
    default: throw new Error(`not an E1 scenario: ${configuration}`)
  }
}

function mechanical(decision: Decision): Decision {
  const result = structuredClone(decision)
  delete result.thinking
  delete result.notes
  if (result.kind === 'discuss') result.say = ''
  if (result.kind === 'propose') delete result.pitch
  if (result.kind === 'finalize' && !result.stick) delete result.reason
  return result
}

async function runOracleScenario(scenario: Phase7R3AOracleScenario) {
  return normalizeAgentOutput(await createComposedAgent(
    options(scenario.input.configuration, scenario.input.seed),
  ).decide(
    scenario.input.req as DecisionRequest,
    scenario.input.view as PlayerView,
  ))
}

function gameWithMorganaLeader(label: string) {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const game = createGame({
      seed: `${label}-${attempt}`,
      playerCount: 9,
      talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
    })
    if (game.players[game.leaderSeat].role === 'morgana') return game
  }
  throw new Error('could not derive Morgana leader scenario')
}

function deterministicProposalScenario(): DecisionScenario<'propose'> {
  const game = gameWithMorganaLeader('a4-proposal')
  return replayDecisionScenario(game, [], {
    kind: 'propose',
    seat: game.leaderSeat,
    round: 1,
    proposalNum: 1,
  })
}

function seededVoteScenario(): DecisionScenario<'vote'> {
  const game = createGame({
    seed: 'a4-vote-0',
    playerCount: 9,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const morgana = game.players.find((player) => player.role === 'morgana')
  assert.ok(morgana)
  const teamSize = game.quests[0].teamSize
  const steps: readonly LegalReplayStep[] = [{
    request: {
      kind: 'propose',
      seat: game.leaderSeat,
      round: 1,
      proposalNum: 1,
    },
    decision: {
      kind: 'propose',
      team: Array.from({ length: teamSize }, (_, seat) => seat),
    },
  }]
  return replayDecisionScenario(game, steps, {
    kind: 'vote',
    seat: morgana.seat,
    round: 1,
    proposalNum: 1,
  })
}

async function nativeFrame(
  scenario: DecisionScenario<'propose' | 'vote'>,
  scorer: typeof morganaRoleScorer | typeof seededMorganaRoleScorer,
) {
  const agent = createComposedAgent({
    seed: scenario.source.seed,
    roleObjectiveRouter: true,
    scorer,
  })
  const brain = agent.resolvedBrain()
  const canonical = canonicalDecisionFrame(scenario.request, scenario.view)
  const legal = withLegalCandidates(canonical)
  const lease = prepareNativeScoreLayers(legal, brain)
  const cognition = reconstructCognition(scenario.view)
  const analyzed = withDecisionAnalysis(
    legal,
    cognition,
    combineSituationAnalysisRequirements(lease.requirements),
  )
  const forced = withUniversalForcedPolicy(analyzed)
  const identity = projectJointIdentity(cognition.belief, {
    roleQueries: [],
    hiddenTeam: true,
  })
  const observer = observePublicRecord(projectPublicRecord(scenario.view))
  const components = await withNativeResolvedComponents(
    forced,
    brain,
    lease,
    undefined,
    (componentFrame) => ({
      providers: [
        { input: PRIVATE_IDENTITY_INPUT, provide: () => identity },
        { input: PRIVATE_PUBLIC_OBSERVER_INPUT, provide: () => observer },
        {
          input: PRIVATE_BELIEF_INPUT,
          provide: () => cognition.belief,
        },
        {
          input: PRIVATE_FORCED_POLICY_INPUT,
          provide: () => componentFrame.universalForced,
        },
        {
          input: PRIVATE_DETERMINISTIC_SEED_INPUT,
          provide: () => scenario.source.seed,
        },
      ],
    }),
  )
  return withNativeScoreLayers(components, lease, {
    deterministicSeed: scenario.source.seed,
    compatibilityCandidateId: legal.legalCandidates[0].id,
  })
}

test('A4A exact singletons resolve matching ordered Morgana chains', () => {
  const registry = createConfiguredScoreLayerRegistry()
  assert.equal(
    morganaScoreLayerTerminalFor(morganaRoleScorer),
    MORGANA_ROLE_SCORE_LAYER,
  )
  assert.equal(
    morganaScoreLayerTerminalFor(seededMorganaRoleScorer),
    SEEDED_MORGANA_ROLE_SCORE_LAYER,
  )
  assert.equal(
    morganaScoreLayerTerminalFor({ ...morganaRoleScorer }),
    undefined,
  )
  assert.equal(
    morganaScoreLayerTerminalFor(malformed(morganaRoleScorer)),
    undefined,
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
})

test('legal replay drives native Morgana rows and transitive attribution', async () => {
  const cases = [
    [
      deterministicProposalScenario(),
      morganaRoleScorer,
      MORGANA_ROLE_UTILITY_COMPONENT,
    ],
    [
      seededVoteScenario(),
      seededMorganaRoleScorer,
      MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
    ],
  ] as const
  for (const [scenario, scorer, utilityToken] of cases) {
    assert.equal(scenario.view.role, 'morgana')
    assert.equal(scenario.request.seat, scenario.view.seat)
    assert.equal(scenario.source.throughSeq,
      scenario.view.events.at(-1)?.seq ?? -1)
    assert.ok(!('game' in scenario))
    assert.ok(!('roleBySeat' in scenario.view))
    const frame = await nativeFrame(scenario, scorer)
    assert.deepEqual(
      frame.scoreLayerRun.journal.map((entry) => entry.status),
      ['generated', 'inapplicable', 'inapplicable', 'applied', 'applied'],
    )
    const terminal = frame.scoreLayerRun.journal.at(-1)!
    assert.equal(terminal.status, 'applied')
    if (terminal.status !== 'applied') {
      throw new Error('Morgana terminal did not apply')
    }
    assert.deepEqual(terminal.componentReads, [{
      id: utilityToken.id,
      version: utilityToken.version,
    }])
    const attributedIds = terminal.attributedComponents.map(
      (component) => component.id,
    )
    assert.deepEqual(attributedIds, [
      EVIL_ROLE_OBJECTIVE_COMPONENT.id,
      EVIL_ROLE_UTILITY_COMPONENT.id,
      MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id,
      MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
      utilityToken.id,
    ])
    for (const token of [
      EVIL_ROLE_OBJECTIVE_COMPONENT,
      EVIL_ROLE_UTILITY_COMPONENT,
      MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
      MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
      utilityToken,
    ]) {
      const use = frame.componentRun.policyUse.find(
        (entry) => entry.component.id === token.id,
      )
      assert.deepEqual(use, {
        component: { id: token.id, version: token.version },
        used: true,
        stages: ['candidate-score'],
      })
    }
    const allowed = new Set(frame.effectiveForced.allowedCandidateIds)
    assert.ok(allowed.has(frame.structuredCandidateId))
    assert.equal(
      frame.scores.filter((row) => row.viable).length,
      1,
    )
    assert.ok(frame.scores.every((row) =>
      allowed.has(row.candidateId)
        || (!row.viable && row.value === -Number.MAX_SAFE_INTEGER)))
    assert.deepEqual(
      frame.survivorCandidateIds,
      frame.effectiveForced.allowedCandidateIds,
    )
  }
})

test('A0 E1 cells remain exact and malformed Morgana stays D2', async () => {
  for (const id of [
    'e1:morgana-proposal-deterministic',
    'e1:morgana-vote-seeded',
    'e1:malformed-falls-to-d2',
  ]) {
    const scenario = oracle.scenarios.find((candidate) => candidate.id === id)
    assert.ok(scenario)
    const result = await runOracleScenario(scenario)
    assert.deepEqual(
      mechanical(result.decision),
      scenario.expected.mechanicalDecision,
      id,
    )
    assert.deepEqual(
      JSON.parse(JSON.stringify(result.trace!.candidateScores)),
      scenario.expected.candidateScores,
      id,
    )
    assert.deepEqual(
      result.trace!.forcedPolicyResult,
      scenario.expected.forcedPolicyResult,
      id,
    )
    assert.equal(
      result.trace!.structuredCandidateId,
      scenario.expected.structuredCandidateId,
      id,
    )
  }
  const fallback = oracle.scenarios.find(
    (scenario) => scenario.id === 'e1:malformed-falls-to-d2',
  )!
  const result = await runOracleScenario(fallback)
  assert.equal(
    result.trace!.componentVersions!.scorer,
    evilRoleObjectiveScorer.version,
  )
  assert.equal(
    createComposedAgent(
      options(fallback.input.configuration, fallback.input.seed),
    ).resolvedBrain().scoreLayerChain,
    null,
  )
})

test('Morgana delegates outside its role and custom identities stay legacy', async () => {
  const d2 = oracle.scenarios.find(
    (scenario) => scenario.id === 'd2:mordred-vote-seeded',
  )
  assert.ok(d2)
  const output = normalizeAgentOutput(await createComposedAgent({
    seed: d2.input.seed,
    roleObjectiveRouter: true,
    scorer: seededMorganaRoleScorer,
  }).decide(
    d2.input.req as DecisionRequest,
    d2.input.view as PlayerView,
  ))
  assert.equal(
    output.trace!.componentVersions!.scorer,
    EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  )

  const clone = Object.freeze({ ...morganaRoleScorer })
  assert.equal(
    createComposedAgent({
      seed: 'a4-custom-legacy',
      roleObjectiveRouter: true,
      scorer: clone,
    }).resolvedBrain().scoreLayerChain,
    null,
  )

  const scenario = seededVoteScenario()
  const first = await nativeFrame(scenario, seededMorganaRoleScorer)
  const second = await nativeFrame(scenario, seededMorganaRoleScorer)
  assert.deepEqual(first.scores, second.scores)
  assert.equal(first.structuredCandidateId, second.structuredCandidateId)
})
