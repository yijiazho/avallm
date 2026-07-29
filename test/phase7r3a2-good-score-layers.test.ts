import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  goodProposalScorer,
  goodProposalVoteScorer,
  roleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededRoleObjectiveScorer,
  type CandidateScorer,
} from '../server/agents/policy/score.ts'
import {
  combineSituationAnalysisRequirements,
  GOOD_PROPOSAL_ANALYSIS,
  GOOD_VOTE_ANALYSIS,
} from '../server/agents/analysis/situation-plan.ts'
import {
  COMPATIBILITY_SCORE_LAYER,
  GOOD_PROPOSAL_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
  createGoodScoreLayerRegistry,
  goodScoreLayerTerminalFor,
  goodScoreLayersApplyToDecision,
} from '../server/agents/score-layers/good.ts'
import {
  assertGoodScoreLayerLegacyEquality,
} from '../server/agents/score-layers/legacy-equality.ts'
import type {
  NativeScoreLayersResolvedDecisionFrame,
  ScoredDecisionFrame,
} from '../server/agents/policy/decision-frame.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'
import type { DecisionTrace } from '../server/agents/trace.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'
import {
  readPhase7R3AScoreOracle,
} from './support/phase7r3a-score-oracle.ts'

const oracle = readPhase7R3AScoreOracle()

const digest = (value: string): string => createHash('sha256')
  .update(value)
  .digest('hex')

const malformed = (source: CandidateScorer): CandidateScorer =>
  Object.freeze({ ...source, score: () => [] })

function options(configuration: string, seed: string) {
  switch (configuration) {
    case 'compatibility': return { seed }
    case 'phase4-proposal-only':
      return { seed, scorer: goodProposalScorer }
    case 'phase4-deterministic':
      return { seed, scorer: goodProposalVoteScorer }
    case 'phase4-seeded':
      return { seed, scorer: seededGoodProposalVoteScorer }
    case 'c2-deterministic':
      return { seed, scorer: roleObjectiveScorer }
    case 'c2-seeded':
      return { seed, scorer: seededRoleObjectiveScorer }
    case 'c2-malformed-fallback':
      return { seed, scorer: malformed(roleObjectiveScorer) }
    default: throw new Error(`not an A2 scenario: ${configuration}`)
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

function causalUse(trace: DecisionTrace) {
  return {
    configured: structuredClone(trace.components?.configured ?? []),
    entries: (trace.components?.entries ?? []).map((entry) => ({
      component: entry.component,
      kind: entry.kind,
      privacy: entry.privacy,
      status: entry.status,
      verification: entry.status === 'admitted'
        ? entry.verification
        : undefined,
      promotionEligible: entry.status === 'admitted'
        ? entry.promotionEligible
        : undefined,
    })).map((entry) => Object.fromEntries(
      Object.entries(entry).filter(([, value]) => value !== undefined),
    )),
    policyUse: structuredClone(trace.components?.policyUse ?? []),
  }
}

function appliedVersions(trace: DecisionTrace) {
  const versions = trace.componentVersions
  return {
    belief: versions?.belief,
    factors: versions?.factors,
    roleObjective: versions?.roleObjective,
    roleObjectiveRouter: versions?.roleObjectiveRouter,
    roleUtility: versions?.roleUtility,
    evilRoleUtility: versions?.evilRoleUtility,
    morganaCounterfeitPublicRead: versions?.morganaCounterfeitPublicRead,
    morganaCounterfeitObjective: versions?.morganaCounterfeitObjective,
    morganaRoleUtility: versions?.morganaRoleUtility,
    configuredScorer: versions?.configuredScorer,
    scorer: versions?.scorer,
    forcedPolicy: versions?.forcedPolicy,
    policy: versions?.policy,
    planner: versions?.planner,
    communication: versions?.communication,
    voice: versions?.voice,
  }
}

test('A2 exact built-ins resolve canonical family-owned chains', () => {
  const cases = [
    [undefined, COMPATIBILITY_SCORE_LAYER],
    [goodProposalScorer, GOOD_PROPOSAL_SCORE_LAYER],
    [goodProposalVoteScorer, GOOD_PROPOSAL_VOTE_SCORE_LAYER],
    [seededGoodProposalVoteScorer, SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER],
    [roleObjectiveScorer, GOOD_ROLE_SCORE_LAYER],
    [seededRoleObjectiveScorer, SEEDED_GOOD_ROLE_SCORE_LAYER],
  ] as const
  const registry = createGoodScoreLayerRegistry()
  for (const [scorer, terminal] of cases) {
    assert.equal(goodScoreLayerTerminalFor(scorer), terminal)
    const chain = registry.resolve({ terminal })
    assert.equal(chain.order.at(-1)?.id, terminal.id)
    assert.equal(chain.order.at(-1)?.version, terminal.version)
    assert.equal(chain.order[0].id, COMPATIBILITY_SCORE_LAYER.id)
  }
  assert.equal(
    goodScoreLayerTerminalFor(malformed(roleObjectiveScorer)),
    undefined,
  )
  assert.equal(
    goodScoreLayerTerminalFor({ ...goodProposalScorer }),
    undefined,
  )
  assert.equal(goodScoreLayersApplyToDecision('propose'), true)
  assert.equal(goodScoreLayersApplyToDecision('vote'), true)
  for (const kind of [
    'discuss',
    'finalize',
    'quest',
    'assassinate',
  ] as const) assert.equal(goodScoreLayersApplyToDecision(kind), false)
})

test('analysis-domain compiler combines executable family requirements', () => {
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

test('A2 live dual-run is exactly equal to the independent frozen oracle', async () => {
  const scenarios = oracle.scenarios.filter((scenario) =>
    scenario.coverage.some((entry: string) =>
      entry === 'base' || entry === 'phase4' || entry === 'c2'))
  assert.equal(scenarios.length, 8)
  for (const scenario of scenarios) {
    let plannerInput: unknown = null
    let voiceInput: unknown = null
    const result = normalizeAgentOutput(await createComposedAgent({
      ...options(scenario.input.configuration, scenario.input.seed),
      planner: {
        version: 'phase7r3a-oracle-planner-v1',
        async choose(input) {
          plannerInput = {
            context: structuredClone(input.context),
            structuredCandidateId: input.structuredCandidateId,
            renderedContextSha256: digest(input.renderedContext),
            renderedContextBytes:
              Buffer.byteLength(input.renderedContext, 'utf8'),
          }
          return { candidateId: input.structuredCandidateId }
        },
      },
      voice: {
        version: 'phase7r3a-oracle-voice-v1',
        async speak(input) {
          voiceInput = {
            plan: structuredClone(input.plan),
            renderedPlanSha256: digest(input.renderedPlan),
            renderedPlanBytes:
              Buffer.byteLength(input.renderedPlan, 'utf8'),
          }
          return {}
        },
      },
    }).decide(
      scenario.input.req as DecisionRequest,
      scenario.input.view as PlayerView,
    ))
    const trace = result.trace!
    const expected = scenario.expected
    assert.deepEqual(mechanical(result.decision), expected.mechanicalDecision,
      scenario.id)
    assert.deepEqual(
      JSON.parse(JSON.stringify(trace.candidateScores)),
      expected.candidateScores,
      scenario.id)
    assert.deepEqual(trace.forcedPolicyResult, expected.forcedPolicyResult,
      scenario.id)
    assert.equal(trace.structuredCandidateId, expected.structuredCandidateId,
      scenario.id)
    assert.equal(trace.chosenCandidateId, expected.selectedCandidateId,
      scenario.id)
    assert.deepEqual(trace.degradation, expected.degradation, scenario.id)
    assert.deepEqual(causalUse(trace), expected.causalUse, scenario.id)
    assert.equal(trace.agentMode, expected.agentMode, scenario.id)
    assert.deepEqual(trace.componentPlan, expected.componentPlan, scenario.id)
    assert.deepEqual(
      JSON.parse(JSON.stringify(appliedVersions(trace))),
      expected.appliedVersions,
      scenario.id)
    assert.deepEqual(plannerInput, expected.plannerInput, scenario.id)
    assert.deepEqual(voiceInput, expected.voiceInput, scenario.id)
  }
})

test('Phase 4A singleton covers proposal, delegated vote, descriptor, and forced survivors', async () => {
  const proposal = oracle.scenarios.find(
    (scenario) => scenario.id === 'phase4:good-proposal-deterministic',
  )
  assert.ok(proposal)
  const agent = createComposedAgent({
    seed: proposal.input.seed,
    scorer: goodProposalScorer,
  })
  assert.deepEqual(agent.resolvedBrain().scoreLayerChain?.terminal, {
    id: GOOD_PROPOSAL_SCORE_LAYER.id,
    version: GOOD_PROPOSAL_SCORE_LAYER.version,
  })
  const proposed = normalizeAgentOutput(await agent.decide(
    proposal.input.req as DecisionRequest,
    proposal.input.view as PlayerView,
  ))
  assert.deepEqual(
    mechanical(proposed.decision),
    proposal.expected.mechanicalDecision,
  )
  assert.deepEqual(
    proposed.trace!.candidateScores!.map((score) => ({
      candidateId: score.candidateId,
      value: score.value,
      viable: score.viable,
      reasonCodes: score.reasonCodes,
    })),
    proposal.expected.candidateScores.map((score) => ({
      candidateId: score.candidateId,
      value: score.value,
      viable: score.viable,
      reasonCodes: score.reasonCodes,
    })),
  )

  const vote = oracle.scenarios.find(
    (scenario) => scenario.id === 'base:compatibility-vote',
  )
  assert.ok(vote)
  const delegated = normalizeAgentOutput(await createComposedAgent({
    seed: vote.input.seed,
    scorer: goodProposalScorer,
  }).decide(
    vote.input.req as DecisionRequest,
    vote.input.view as PlayerView,
  ))
  assert.deepEqual(
    mechanical(delegated.decision),
    vote.expected.mechanicalDecision,
  )
  assert.ok(delegated.trace!.candidateScores!.every((score) =>
    score.reasonCodes.includes(
      'GOOD_PROPOSAL_OUT_OF_SCOPE_COMPATIBILITY',
    )))

  const forcedFixture = readDecisionFixtures().find(
    (fixture) => fixture.id === 'assassin-late-finalize',
  )!
  const forcedView: PlayerView = {
    ...structuredClone(forcedFixture.view),
    phase: 'proposal',
  }
  const forcedRequest: DecisionRequest = {
    ...forcedFixture.req,
    kind: 'propose',
  }
  const forced = normalizeAgentOutput(await createComposedAgent({
    seed: forcedFixture.source.seed,
    scorer: goodProposalScorer,
  }).decide(forcedRequest, forcedView))
  assert.equal(forced.trace!.forcedPolicyResult!.applied, true)
  const allowed = new Set(
    forced.trace!.forcedPolicyResult!.allowedCandidateIds,
  )
  assert.ok(allowed.size > 0)
  assert.ok(allowed.size < forced.trace!.candidateScores!.length)
  for (const score of forced.trace!.candidateScores!) {
    assert.equal(score.viable, allowed.has(score.candidateId))
  }
  assert.ok(allowed.has(forced.trace!.structuredCandidateId!))
})

test('D3 configuration leaves A2 active for proposal/vote and absent for quest', async () => {
  for (const kind of ['propose', 'vote'] as const) {
    const scenario = oracle.scenarios.find((candidate) =>
      candidate.input.req.kind === kind
      && candidate.input.configuration === 'phase4-deterministic')
    assert.ok(scenario)
    const result = normalizeAgentOutput(await createComposedAgent({
      seed: scenario.input.seed,
      scorer: goodProposalVoteScorer,
      evilQuestCardPolicy: 'robust-heterogeneous',
    }).decide(
      scenario.input.req as DecisionRequest,
      scenario.input.view as PlayerView,
    ))
    assert.deepEqual(
      mechanical(result.decision),
      scenario.expected.mechanicalDecision,
    )
    assert.deepEqual(
      JSON.parse(JSON.stringify(result.trace!.candidateScores)),
      scenario.expected.candidateScores,
    )
    assert.equal(result.trace!.privateEvilQuestCardPolicy, undefined)
  }

  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.id === 'oberon-two-fail-quest',
  )!
  const questView: PlayerView = {
    ...structuredClone(fixture.view),
    seat: 4,
    name: fixture.view.players.find((player) => player.seat === 4)!.name,
    role: 'assassin',
    alignment: 'evil',
    privateInfo: { evilPartners: [5] },
    quests: fixture.view.quests.map((quest, index) =>
      index === 0
        ? { ...quest, result: 'success', failCount: 0 }
        : index === 1
          ? { ...quest, result: 'fail', failCount: 1 }
          : index === 2
            ? { ...quest, result: undefined, failCount: undefined }
            : quest),
  }
  const questRequest: DecisionRequest = {
    ...fixture.req,
    seat: questView.seat,
  }
  const quest = normalizeAgentOutput(await createComposedAgent({
    seed: fixture.source.seed,
    scorer: goodProposalVoteScorer,
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(questRequest, questView))
  assert.ok(quest.trace!.privateEvilQuestCardPolicy)
  assert.equal(quest.trace!.privateEvilQuestCardPolicy!.mode,
    'robust-heterogeneous')
})

test('temporary equality failures identify the first delta with bounded run context', () => {
  const row = Object.freeze({
    candidateId: 'vote:approve',
    value: 1,
    viable: true,
    reasonCodes: Object.freeze(['COMPATIBILITY_PREFERRED']),
  })
  const policyUse = Object.freeze([])
  const native = {
    scores: Object.freeze([row]),
    survivorCandidateIds: Object.freeze(['vote:approve']),
    structuredCandidateId: 'vote:approve',
    componentRun: { policyUse },
    scoreLayerRun: {
      configured: Object.freeze([COMPATIBILITY_SCORE_LAYER]),
      journal: Object.freeze([{
        layer: COMPATIBILITY_SCORE_LAYER,
        status: 'generated',
        analysisRequirements: Object.freeze([]),
        analysisAdmission: 'not-run',
        componentLookups: Object.freeze([]),
        componentReads: Object.freeze([]),
        attributedComponents: Object.freeze([]),
      }]),
    },
  } as unknown as NativeScoreLayersResolvedDecisionFrame
  const legacy = {
    scores: Object.freeze([{
      ...row,
      value: 0,
    }]),
    effectiveForced: {
      allowedCandidateIds: Object.freeze(['vote:approve']),
    },
    structuredCandidateId: 'vote:approve',
    componentRun: { policyUse },
  } as unknown as ScoredDecisionFrame
  assert.throws(
    () => assertGoodScoreLayerLegacyEquality(native, legacy),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /"field":"scores"/)
      assert.match(error.message, /"candidateId":"vote:approve"/)
      assert.match(error.message, /"configuredChain"/)
      assert.match(error.message, /"nativeJournal"/)
      assert.match(error.message, /"survivors"/)
      assert.match(error.message, /"componentPolicyUse"/)
      assert.ok(Buffer.byteLength(error.message, 'utf8') < 9 * 1024)
      return true
    },
  )
})
