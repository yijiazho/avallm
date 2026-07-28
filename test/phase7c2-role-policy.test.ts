import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
} from '../server/agents/belief/exact.ts'
import {
  ROLE_UTILITY_CONSTANTS,
  ROLE_UTILITY_PROJECTION_VERSION,
  validatePrivateRoleUtilityProjection,
} from '../server/agents/analysis/role-utility.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../server/agents/analysis/role-objective-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
} from '../server/agents/belief/identity.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  MAX_DECISION_COMPONENT_RUN_JSON_BYTES,
} from '../server/agents/components/kernel.ts'
import {
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  createRoleObjectiveScorer,
  goodProposalVoteScorer,
  roleObjectiveScorer,
  seededRoleObjectiveScorer,
  validateCandidateScores,
  type CandidateScore,
} from '../server/agents/policy/score.ts'
import {
  candidateTeams,
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import { applyForcedPolicy } from '../server/agents/policy/forced.ts'
import {
  materialPosteriorUncertainty,
  posteriorUncertainty,
} from '../server/agents/policy/plan.ts'
import {
  parseStdioDecisionReply,
  validateComposedTraceHostJoin,
} from '../server/agents/stdio.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { architectureReport } from '../server/eval/architecture-report.ts'
import { createGame } from '../server/engine/game.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'
import { viewFor } from '../server/engine/view.ts'

const fixtures = readDecisionFixtures()
const merlin = fixtures.find((fixture) => fixture.view.role === 'merlin')!
const percival = fixtures.find((fixture) => fixture.view.role === 'percival')!
const servant = fixtures.find((fixture) => fixture.view.role === 'servant')!

const close = (actual: number, expected: number, tolerance = 1e-12) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  )

async function decide(
  fixture: typeof merlin,
  seeded = false,
  extra: Parameters<typeof createComposedAgent>[0] = { seed: 'unused' },
) {
  return createComposedAgent({
    ...extra,
    seed: extra.seed === 'unused' ? 'phase7c2-role-policy' : extra.seed,
    scorer: seeded ? seededRoleObjectiveScorer : roleObjectiveScorer,
  }).decide(fixture.req, fixture.view)
}

function voteFixture(source: typeof merlin) {
  const view: PlayerView = {
    ...structuredClone(source.view),
    phase: 'vote',
    currentTeam: source.view.players
      .slice(0, source.view.quests[source.view.round - 1].teamSize)
      .map((player) => player.seat)
      .sort((left, right) => left - right),
  }
  const req: DecisionRequest = {
    kind: 'vote',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  return { ...source, req, view }
}

function proposalFixture(source: typeof merlin) {
  const view: PlayerView = {
    ...structuredClone(source.view),
    phase: 'proposal',
    leaderSeat: source.view.seat,
    currentTeam: undefined,
  }
  const req: DecisionRequest = {
    kind: 'propose',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  return { ...source, req, view }
}

test('Merlin proposal role utility is exact, centered, and causally authoritative', async () => {
  const output = await decide(merlin)
  const trace = output.trace!
  assert.equal(trace.componentVersions!.scorer, ROLE_OBJECTIVE_SCORER_VERSION)
  assert.equal(
    trace.componentVersions!.roleUtility,
    ROLE_UTILITY_PROJECTION_VERSION,
  )
  assert.ok(validatePrivateRoleUtilityProjection(trace.privateRoleUtility))
  const scores = trace.candidateScores!
  const allowed = new Set(trace.forcedPolicyResult!.allowedCandidateIds)
  const mean = scores
    .filter((score) => allowed.has(score.candidateId))
    .reduce(
      (sum, score) => sum + score.roleObjectiveFeatures!.roleValue,
      0,
    ) / allowed.size
  for (const score of scores) {
    const feature = score.roleObjectiveFeatures!
    assert.equal(feature.utility.role, 'merlin')
    close(feature.survivorMeanRoleValue, mean)
    close(
      feature.roleAdjustment,
      ROLE_OBJECTIVE_UTILITY_CONSTANTS.centeredAdjustmentScale
        * (feature.roleValue - mean),
    )
    close(feature.combinedValue, feature.baseValue + feature.roleAdjustment)
    const utility = feature.utility
    assert.equal(utility.role, 'merlin')
    close(
      utility.publicTeamFailureCapabilityProbability,
      utility.publicEvilCountDistribution
        .slice(trace.privateRoleUtility!.request.failsRequired)
        .reduce((sum, value) => sum + value, 0),
    )
    close(
      utility.roleValue,
      ROLE_UTILITY_CONSTANTS.primaryInfluenceWeight
        * ((utility.privateInfluenceValue + 1) / 2)
        + ROLE_UTILITY_CONSTANTS.concealmentOrDecoyWeight
          * (1 - utility.correctedExposureProxyIndex),
    )
  }
  assert.equal(scores.filter((score) => score.viable).length, 1)
  const selected = scores.find(
    (score) => score.candidateId === trace.structuredCandidateId,
  )!
  assert.equal(
    selected.roleObjectiveFeatures!.combinedValue,
    Math.max(...scores
      .filter((score) => allowed.has(score.candidateId))
      .map((score) => score.roleObjectiveFeatures!.combinedValue)),
  )
})

test('quest-four public one-evil mass is neutral rather than fail-capable', async () => {
  const fixture = structuredClone(merlin)
  fixture.view.round = 4
  fixture.req.round = 4
  fixture.view.quests = fixture.view.quests.map((quest, index) => ({
    ...quest,
    failsRequired: index === 3 ? 2 : quest.failsRequired,
  }))
  const output = await decide(fixture)
  const utility = output.trace!.privateRoleUtility!.assessments.find(
    (assessment) =>
      assessment.role === 'merlin'
      && assessment.publicEvilCountDistribution[1] > 0,
  )!
  assert.equal(utility.role, 'merlin')
  const distribution = utility.publicEvilCountDistribution
  close(
    utility.publicTeamFailureCapabilityProbability,
    distribution.slice(2).reduce((sum, value) => sum + value, 0),
  )
  close(
    utility.publicInfluenceValue,
    utility.publicTeamCleanProbability
      - utility.publicTeamFailureCapabilityProbability,
  )
  assert.ok(distribution[1] > 0)
})

test('Percival proposal and vote consume pair influence and self-decoy utility', async () => {
  for (const fixture of [proposalFixture(percival), voteFixture(percival)]) {
    const output = await decide(fixture)
    const utilities = output.trace!.privateRoleUtility!.assessments
    assert.ok(utilities.every((utility) => utility.role === 'percival'))
    for (const utility of utilities) {
      if (utility.role !== 'percival') continue
      close(
        utility.roleValue,
        ROLE_UTILITY_CONSTANTS.primaryInfluenceWeight
          * ((utility.pairInfluenceValue + 1) / 2)
          + ROLE_UTILITY_CONSTANTS.concealmentOrDecoyWeight
            * utility.selfDecoyOpportunityProxyIndex,
      )
    }
  }
  const favored = percival.view.privateInfo.merlinCandidates![0]
  const weighted = {
    version: 'phase7c2-percival-weighted-v1',
    factorsVersion: 'phase7c2-test-factor-v1',
    infer(view: PlayerView) {
      const exact = exactBelief(view)
      return beliefFromWeightedWorlds(
        view,
        exact.worlds.map((world) => ({
          world: world.world,
          probability:
            world.world.roleBySeat[favored] === 'merlin' ? 9 : 1,
        })),
        {
          modelVersion: 'phase7c2-percival-weighted-v1',
          quality: 'weighted',
        },
      )
    },
  }
  const causal = await decide(proposalFixture(percival), false, {
    seed: 'phase7c2-percival-weighted',
    beliefModel: weighted,
  })
  assert.ok(new Set(
    causal.trace!.privateRoleUtility!.assessments.map(
      (utility) => utility.roleValue,
    ),
  ).size > 1)

  const weightedFor = (favoredSeat: number) => ({
    version: `phase7c2-percival-vote-${favoredSeat}-v1`,
    factorsVersion: 'phase7c2-test-factor-v1',
    infer(view: PlayerView) {
      const exact = exactBelief(view)
      return beliefFromWeightedWorlds(
        view,
        exact.worlds.map((world) => ({
          world: world.world,
          probability:
            world.world.roleBySeat[favoredSeat] === 'merlin' ? 100 : 1,
        })),
        {
          modelVersion: `phase7c2-percival-vote-${favoredSeat}-v1`,
          quality: 'weighted',
        },
      )
    },
  })
  const vote = voteFixture(percival)
  vote.view.currentTeam = [1, 2]
  const [favorFirst, favorSecond] = await Promise.all(
    percival.view.privateInfo.merlinCandidates!.map((favoredSeat) =>
      decide(vote, false, {
        seed: 'phase7c2-percival-vote-flip',
        beliefModel: weightedFor(favoredSeat),
      })),
  )
  assert.notDeepEqual(favorFirst.decision, favorSecond.decision)
})

test('Percival without Morgana retains the explicit null-pair semantics', async () => {
  const roles: Role[] = [
    'merlin', 'percival', 'servant', 'assassin', 'minion',
  ]
  const game = createGame({
    seed: 'phase7c2-no-morgana',
    playerCount: 5,
    roles,
  })
  const seat = game.players.find((player) => player.role === 'percival')!.seat
  const view: PlayerView = { ...viewFor(game, seat), leaderSeat: seat }
  const req: DecisionRequest = {
    kind: 'propose',
    seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const output = await createComposedAgent({
    seed: 'phase7c2-no-morgana',
    scorer: roleObjectiveScorer,
  }).decide(req, view)
  const objective = output.trace!.privateRoleObjective!.objective
  assert.equal(objective.role, 'percival')
  assert.equal(objective.pairPosterior.includesMorgana, false)
  assert.ok(objective.pairPosterior.hypotheses.every(
    (hypothesis) => hypothesis.morganaSeat === null,
  ))
  assert.ok(validatePrivateRoleUtilityProjection(
    output.trace!.privateRoleUtility,
  ))
})

test('role scorer is opt-in and ineligible decisions resolve exactly to base', async () => {
  const role = await decide(servant)
  const base = await createComposedAgent({
    seed: 'phase7c2-role-policy',
    scorer: goodProposalVoteScorer,
  }).decide(servant.req, servant.view)
  assert.deepEqual(role.decision, base.decision)
  assert.deepEqual(role.trace!.candidateScores, base.trace!.candidateScores)
  assert.equal(
    role.trace!.componentVersions!.configuredScorer,
    ROLE_OBJECTIVE_SCORER_VERSION,
  )
  assert.equal(
    role.trace!.componentVersions!.scorer,
    GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  )
  assert.equal(role.trace!.componentVersions!.roleObjective, undefined)
  assert.equal(role.trace!.componentVersions!.roleUtility, undefined)
  assert.equal(role.trace!.privateRoleObjective, undefined)
  assert.equal(role.trace!.privateRoleUtility, undefined)
  const proposal = proposalFixture(servant)
  const roleProposal = await decide(proposal)
  assert.equal(validateComposedTraceHostJoin({
    trace: roleProposal.trace!,
    req: proposal.req,
    view: proposal.view,
    authoritativeAction: roleProposal.decision,
    selectedDecision: roleProposal.decision,
    deterministicSeed: 'phase7c2-role-policy',
  }), true)
  const forgedBase = structuredClone(roleProposal)
  const forgedScore = forgedBase.trace!.candidateScores!.find(
    (score) =>
      score.candidateId !== forgedBase.trace!.chosenCandidateId
      && score.features?.version === 'good-proposal-features-v1',
  )!
  assert.equal(forgedScore.features!.version, 'good-proposal-features-v1')
  if (forgedScore.features!.version === 'good-proposal-features-v1') {
    const distribution =
      forgedScore.features.evilCountDistribution as number[]
    const delta = Math.min(0.01, distribution[1] / 2)
    assert.ok(delta > 0)
    forgedScore.features.cleanProbability += delta
    distribution[0] += delta
    distribution[1] -= delta
    forgedScore.value += delta
  }
  assert.equal(validateComposedTraceHostJoin({
    trace: forgedBase.trace!,
    req: proposal.req,
    view: proposal.view,
    authoritativeAction: forgedBase.decision,
    selectedDecision: forgedBase.decision,
    deterministicSeed: 'phase7c2-role-policy',
  }), false)
})

test('seeded role votes vary only inside the combined band and replay exactly', async () => {
  const fixture = voteFixture(merlin)
  const outputs = await Promise.all([
    decide(fixture, true, { seed: 'role-seed-a' }),
    decide(fixture, true, { seed: 'role-seed-a' }),
    decide(fixture, true, { seed: 'role-seed-b' }),
  ])
  assert.deepEqual(outputs[0], outputs[1])
  for (const output of outputs) {
    assert.equal(
      output.trace!.componentVersions!.scorer,
      ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    )
    const scores = output.trace!.candidateScores!
    const role = scores[0].roleObjectiveFeatures!
    const gap = Math.abs(
      scores[0].roleObjectiveFeatures!.combinedValue
      - scores[1].roleObjectiveFeatures!.combinedValue,
    )
    assert.equal(
      role.inViableBand,
      gap <= ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand,
    )
    assert.deepEqual(
      parseStdioDecisionReply(
        fixture.req,
        structuredClone(output),
        'phase7c2-seeded-role',
        fixture.view,
      ),
      output,
    )
    if (!role.inViableBand) {
      assert.equal(scores.filter((score) => score.viable).length, 1)
      assert.ok(scores.every(
        (score) =>
          score.roleObjectiveFeatures!.selectionAdjustment === 0
          && score.roleObjectiveFeatures!.seedBucket === undefined,
      ))
    } else {
      const forged = structuredClone(output)
      forged.trace!.candidateScores![0]
        .roleObjectiveFeatures!.selectionAdjustment += 0.01
      forged.trace!.candidateScores![0].value += 0.01
      assert.throws(() => parseStdioDecisionReply(
        fixture.req,
        forged,
        'phase7c2-seeded-role',
        fixture.view,
      ))
    }
  }
  const bandFixture = voteFixture(percival)
  bandFixture.view.currentTeam = [0, 2]
  const bandOutput = await decide(
    bandFixture,
    true,
    { seed: 'phase7c2-explicit-band' },
  )
  assert.equal(
    bandOutput.trace!.candidateScores![0]
      .roleObjectiveFeatures!.inViableBand,
    true,
  )
  assert.equal(validateComposedTraceHostJoin({
    trace: bandOutput.trace!,
    req: bandFixture.req,
    view: bandFixture.view,
    authoritativeAction: bandOutput.decision,
    selectedDecision: bandOutput.decision,
    deterministicSeed: 'phase7c2-explicit-band',
  }), true)
  const expectedBucket = bandOutput.trace!.candidateScores![0]
    .roleObjectiveFeatures!.seedBucket
  let oppositeSeedOutput: Awaited<ReturnType<typeof decide>> | undefined
  for (let index = 0; index < 32; index++) {
    const candidate = await decide(
      bandFixture,
      true,
      { seed: `phase7c2-opposite-band-${index}` },
    )
    if (
      candidate.trace!.candidateScores![0]
        .roleObjectiveFeatures!.seedBucket !== expectedBucket
    ) {
      oppositeSeedOutput = candidate
      break
    }
  }
  assert.ok(oppositeSeedOutput)
  assert.equal(validateComposedTraceHostJoin({
    trace: oppositeSeedOutput.trace!,
    req: bandFixture.req,
    view: bandFixture.view,
    authoritativeAction: oppositeSeedOutput.decision,
    selectedDecision: oppositeSeedOutput.decision,
    deterministicSeed: 'phase7c2-explicit-band',
  }), false)
  const forged = structuredClone(bandOutput)
  forged.trace!.candidateScores![0]
    .roleObjectiveFeatures!.selectionAdjustment += 0.01
  forged.trace!.candidateScores![0].value += 0.01
  assert.throws(() => parseStdioDecisionReply(
    bandFixture.req,
    forged,
    'phase7c2-seeded-role',
    bandFixture.view,
  ))

  const structuredCandidateId = bandOutput.trace!.structuredCandidateId!
  const alternateCandidateId = bandOutput.trace!.candidateScores!.find(
    (score) => score.viable && score.candidateId !== structuredCandidateId,
  )!.candidateId
  let voiceCalls = 0
  const planned = await createComposedAgent({
    seed: 'phase7c2-explicit-band',
    scorer: seededRoleObjectiveScorer,
    planner: {
      version: 'phase7c2-private-band-planner-v1',
      async choose() {
        return {
          candidateId: alternateCandidateId,
          reasonCodes: ['PRIVATE_ROLE_OBJECTIVE_SEEDED_BAND'],
        }
      },
    },
    voice: {
      version: 'phase7c2-private-band-voice-v1',
      async speak() {
        voiceCalls++
        return { text: 'A close decision.' }
      },
    },
  }).decide(bandFixture.req, bandFixture.view)
  assert.equal(planned.trace!.chosenCandidateId, alternateCandidateId)
  assert.deepEqual(
    planned.trace!.plannerReasonCodes,
    ['PRIVATE_ROLE_OBJECTIVE_SEEDED_BAND'],
  )
  assert.equal(voiceCalls, 0)
  assert.deepEqual(
    parseStdioDecisionReply(
      bandFixture.req,
      structuredClone(planned),
      'phase7c2-private-band',
      bandFixture.view,
    ),
    planned,
  )
})

test('forced selection bypasses role ranking and reports a non-material gap', async () => {
  const fixture = voteFixture(merlin)
  const output = await decide(fixture, true)
  const candidates = legalCandidates(fixture.req, fixture.view)
  const hypotheticalTeamCandidates =
    hypotheticalProposalCandidates(fixture.view)
  const analysis = analyzeSituation(fixture.view, {
    belief: exactBelief(fixture.view),
    policyCandidateAssessments:
      candidateTeams(hypotheticalTeamCandidates, fixture.view),
    goodVote: true,
  })
  const ordinary = applyForcedPolicy(
    fixture.req,
    fixture.view,
    analysis,
    candidates,
  )
  const selectedCandidateId = candidates[0].id
  const forced = {
    ...ordinary,
    applied: true,
    allowedCandidateIds: [selectedCandidateId],
    selectedCandidateId,
  }
  const context = {
    deterministicSeed: 'forced-role-seed',
    request: fixture.req,
    view: fixture.view,
    analysis,
    candidates,
    hypotheticalTeamCandidates,
    forced,
    roleUtility: output.trace!.privateRoleUtility!,
  }
  const scores = seededRoleObjectiveScorer.score(context)
  validateCandidateScores(
    context,
    scores,
    seededRoleObjectiveScorer.version,
  )
  assert.equal(scores.filter((score) => score.viable).length, 1)
  assert.equal(scores.find((score) => score.viable)!.candidateId, selectedCandidateId)
  assert.ok(scores.every(
    (score) => score.roleObjectiveFeatures!.seedBucket === undefined,
  ))
  const uncertainty = posteriorUncertainty(
    scores.find((score) => score.viable)!,
    scores,
  )
  assert.equal(uncertainty?.kind, 'role-composite-decision')
  assert.equal(materialPosteriorUncertainty(uncertainty), false)
})

test('malformed role output degrades to the matching base and compatibility is last', async () => {
  for (const seeded of [false, true]) {
    const source = createRoleObjectiveScorer({
      selectionMode: seeded ? 'seeded-composite-band' : 'top-composite',
    })
    const malformed = {
      ...source,
      score(context: Parameters<typeof source.score>[0]) {
        const scores = structuredClone(source.score(context))
        scores[0].roleObjectiveFeatures!.combinedValue += 0.25
        return scores
      },
    }
    const output = await createComposedAgent({
      seed: 'phase7c2-malformed',
      scorer: malformed,
    }).decide(merlin.req, merlin.view)
    assert.equal(
      output.trace!.componentVersions!.scorer,
      seeded
        ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        : GOOD_PROPOSAL_VOTE_SCORER_VERSION,
    )
    assert.notEqual(
      output.trace!.componentVersions!.scorer,
      CANDIDATE_SCORER_VERSION,
    )
    assert.ok(output.trace!.degradation.includes('role-objective-scorer-failed'))
    assert.ok(output.trace!.candidateScores!.every(
      (score) => score.roleObjectiveFeatures === undefined,
    ))
  }
  let invoked = false
  const accessorScorer = {
    ...roleObjectiveScorer,
    score(context: Parameters<typeof roleObjectiveScorer.score>[0]) {
      const scores = structuredClone(roleObjectiveScorer.score(context))
      Object.defineProperty(scores[0].roleObjectiveFeatures!, 'roleValue', {
        enumerable: true,
        get() {
          invoked = true
          return 0
        },
      })
      return scores
    },
  }
  const accessor = await createComposedAgent({
    seed: 'phase7c2-accessor-score',
    scorer: accessorScorer,
  }).decide(merlin.req, merlin.view)
  assert.equal(invoked, false)
  assert.equal(
    accessor.trace!.componentVersions!.scorer,
    GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  )
})

test('base scorers cannot inject role telemetry at the score boundary', () => {
  const tracePromise = createComposedAgent({
    seed: 'phase7c2-injection',
    scorer: goodProposalVoteScorer,
  }).decide(merlin.req, merlin.view)
  return tracePromise.then((output) => {
    const trace = output.trace!
    const context = {
      deterministicSeed: 'phase7c2-injection',
      request: trace.request,
      view: merlin.view,
      analysis: {
        ...output.trace,
      },
    }
    const forged = structuredClone(trace.candidateScores!) as CandidateScore[]
    forged[0].roleObjectiveFeatures = {
      version: 'merlin-percival-role-score-features-v1',
    } as never
    // The composed boundary already accepted the authoritative surface. A
    // custom base scorer returning the forged clone must degrade instead.
    const injecting = {
      ...goodProposalVoteScorer,
      score() {
        return forged
      },
    }
    return createComposedAgent({
      seed: 'phase7c2-injection',
      scorer: injecting,
    }).decide(merlin.req, merlin.view).then((degraded) => {
      assert.equal(
        degraded.trace!.componentVersions!.scorer,
        CANDIDATE_SCORER_VERSION,
      )
      assert.ok(degraded.trace!.candidateScores!.every(
        (score) => score.roleObjectiveFeatures === undefined,
      ))
      assert.ok(context)
    })
  })
})

test('private role utility is stdio-safe, host-joined, and absent from public voice', async () => {
  const voiceInputs: unknown[] = []
  const output = await createComposedAgent({
    seed: 'phase7c2-stdio',
    scorer: roleObjectiveScorer,
    voice: {
      version: 'phase7c2-fake-voice-v1',
      async speak(input) {
        voiceInputs.push(structuredClone(input))
        return {
          text: JSON.stringify(input.plan.communication?.uncertainty),
        }
      },
    },
  }).decide(merlin.req, merlin.view)
  const parsed = parseStdioDecisionReply(
    merlin.req,
    structuredClone(output),
    'phase7c2',
    merlin.view,
  )
  assert.deepEqual(parsed, output)
  assert.doesNotMatch(JSON.stringify(voiceInputs), /PRIVATE_ROLE|roleValue|merlin/)
  assert.doesNotMatch(JSON.stringify(voiceInputs), /role-composite-decision/)
  assert.doesNotMatch(
    output.decision.kind === 'propose' ? output.decision.pitch ?? '' : '',
    /role-composite-decision|roleValue|compositeUtilityGap/,
  )
  assert.doesNotMatch(
    JSON.stringify(output.trace!.communicationIntent),
    /PRIVATE_ROLE|roleValue|pairInfluence|exposure/i,
  )
  const deleted = structuredClone(output)
  delete deleted.trace!.privateRoleUtility
  delete deleted.trace!.componentVersions!.roleUtility
  deleted.trace!.componentVersions!.scorer = GOOD_PROPOSAL_VOTE_SCORER_VERSION
  deleted.trace!.componentVersions!.configuredScorer =
    ROLE_OBJECTIVE_SCORER_VERSION
  deleted.trace!.degradation = [
    ...deleted.trace!.degradation,
    'role-utility-projection-failed',
  ]
  assert.throws(() => parseStdioDecisionReply(
    merlin.req,
    deleted,
    'phase7c2',
    merlin.view,
  ))

  const baseOutput = await createComposedAgent({
    seed: 'phase7c2-stdio',
    scorer: goodProposalVoteScorer,
    publicObserver: true,
  }).decide(merlin.req, merlin.view)
  const fullChainDeletion = structuredClone(baseOutput)
  fullChainDeletion.trace!.componentVersions!.identityModel =
    JOINT_IDENTITY_MODEL_VERSION
  fullChainDeletion.trace!.componentVersions!.roleObjective =
    ROLE_OBJECTIVE_MODEL_VERSION
  fullChainDeletion.trace!.componentVersions!.configuredScorer =
    ROLE_OBJECTIVE_SCORER_VERSION
  fullChainDeletion.trace!.degradation = [
    ...fullChainDeletion.trace!.degradation,
    'identity-projection-failed',
    ROLE_OBJECTIVE_DEGRADATION,
    'role-utility-projection-failed',
  ]
  assert.throws(() => parseStdioDecisionReply(
    merlin.req,
    fullChainDeletion,
    'phase7c2-full-chain-deletion',
    merlin.view,
  ))
})

test('role utility validator rejects accessors, sparse data, and forged equations', async () => {
  const output = await decide(merlin)
  const projection = output.trace!.privateRoleUtility!
  const forged = structuredClone(projection)
  const first = forged.assessments[0]
  assert.equal(first.role, 'merlin')
  first.correctedExposureProxyIndex = 0
  assert.equal(validatePrivateRoleUtilityProjection(forged), false)

  const sparse = structuredClone(projection)
  delete (sparse.assessments as unknown[])[0]
  assert.equal(validatePrivateRoleUtilityProjection(sparse), false)

  let invoked = false
  const accessor = structuredClone(projection) as unknown as Record<string, unknown>
  Object.defineProperty(accessor, 'role', {
    enumerable: true,
    get() {
      invoked = true
      return 'merlin'
    },
  })
  assert.equal(validatePrivateRoleUtilityProjection(accessor), false)
  assert.equal(invoked, false)
})

test('role scorer remains bounded at ten players', async () => {
  const roles: Role[] = [
    'merlin', 'percival', 'servant', 'servant', 'servant',
    'servant', 'morgana', 'assassin', 'mordred', 'oberon',
  ]
  const game = createGame({
    seed: 'phase7c2-ten-player',
    playerCount: 10,
    roles,
  })
  const seat = game.players.find((player) => player.role === 'merlin')!.seat
  const view: PlayerView = { ...viewFor(game, seat), leaderSeat: seat }
  view.round = 4
  view.quests = view.quests.map((quest, index) => ({
    ...quest,
    failsRequired: index === 3 ? 2 : quest.failsRequired,
  }))
  const req: DecisionRequest = {
    kind: 'propose',
    seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const started = performance.now()
  const output = await createComposedAgent({
    seed: 'phase7c2-ten-player',
    scorer: roleObjectiveScorer,
  }).decide(req, view)
  const elapsed = performance.now() - started
  assert.equal(output.trace!.candidateScores!.length, 252)
  assert.equal(output.trace!.privateRoleUtility!.assessments.length, 252)
  // B3 dual-write temporarily retains the full generic payload and unchanged
  // legacy projection. B4 measures the additive artifact cost before cleanup.
  const componentRunBytes = Buffer.byteLength(
    JSON.stringify(output.trace!.components),
    'utf8',
  )
  assert.ok(componentRunBytes <= MAX_DECISION_COMPONENT_RUN_JSON_BYTES)
  assert.ok(
    Buffer.byteLength(JSON.stringify(output.trace), 'utf8') < 2_097_152,
  )
  assert.ok(elapsed < 2_500, `10p role decision took ${elapsed}ms`)
})

test('architecture artifacts and reports host-join applicable role policy', async () => {
  const variant: ArchitectureVariant = {
    id: 'phase7c2-role-policy',
    paid: false,
    components: {
      mode: 'structured-only',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      identityModel: 'joint-identity-projection-v1',
      roleObjective: ROLE_OBJECTIVE_MODEL_VERSION,
      roleUtility: ROLE_UTILITY_PROJECTION_VERSION,
      policy: 'composed-policy-v1',
      scorer: ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      planner: 'planner-off',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      scorer: seededRoleObjectiveScorer,
      roleObjectives: true,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: true,
      },
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  const merlinCase = ARCHITECTURE_BANK.find(
    (candidate) => candidate.targetRole === 'merlin',
  )!
  const [artifact] = await runArchitectureBench({
    variants: [variant],
    cases: [merlinCase],
    bankId: 'phase7c2-role-policy',
  })
  assert.deepEqual(
    artifact.strategyVersions?.roleUtilities,
    [ROLE_UTILITY_PROJECTION_VERSION],
  )
  assert.equal(
    architectureReport([artifact]).variants[0]
      .safety.traceAttributionViolations,
    0,
  )
  const withoutTraces = structuredClone(artifact)
  delete withoutTraces.decisionTraces
  assert.ok(
    architectureReport([withoutTraces]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const forged = structuredClone(artifact)
  const applicable = forged.decisionTraces!.find(
    (trace) => trace.privateRoleUtility,
  )!
  delete applicable.privateRoleUtility
  delete applicable.componentVersions!.roleUtility
  applicable.componentVersions!.scorer =
    GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
  applicable.componentVersions!.configuredScorer =
    ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
  applicable.degradation.push('role-utility-projection-failed')
  assert.ok(
    architectureReport([forged]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedEquation = structuredClone(artifact)
  const equationTrace = forgedEquation.decisionTraces!.find(
    (trace) =>
      trace.request.kind === 'propose'
      && trace.privateRoleUtility
      && trace.candidateScores!.length > 1,
  )!
  const equationScore = equationTrace.candidateScores!.find(
    (score) => score.candidateId !== equationTrace.chosenCandidateId,
  )!
  equationScore.roleObjectiveFeatures!.roleAdjustment += 0.123
  equationScore.roleObjectiveFeatures!.combinedValue += 0.123
  equationScore.value += 0.123
  assert.ok(
    architectureReport([forgedEquation]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedBaseSurface = structuredClone(artifact)
  const baseTrace = forgedBaseSurface.decisionTraces!.find(
    (trace) =>
      trace.request.kind === 'propose'
      && trace.privateRoleUtility
      && trace.candidateScores!.length > 1,
  )!
  const baseScore = baseTrace.candidateScores!.find(
    (score) => score.candidateId !== baseTrace.chosenCandidateId,
  )!
  assert.equal(baseScore.features!.version, 'good-proposal-features-v1')
  if (baseScore.features!.version === 'good-proposal-features-v1') {
    const distribution =
      baseScore.features.evilCountDistribution as number[]
    const delta = Math.min(0.01, distribution[1] / 2)
    assert.ok(delta > 0)
    baseScore.features.cleanProbability += delta
    distribution[0] += delta
    distribution[1] -= delta
    baseScore.roleObjectiveFeatures!.baseValue += delta
    baseScore.roleObjectiveFeatures!.combinedValue += delta
    baseScore.value += delta
  }
  assert.ok(
    architectureReport([forgedBaseSurface]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedChoice = structuredClone(artifact)
  const choiceTrace = forgedChoice.decisionTraces!.find(
    (trace) =>
      trace.request.kind === 'propose'
      && trace.privateRoleUtility
      && trace.candidateScores!.length > 1,
  )!
  const alternate = choiceTrace.candidateScores!.find(
    (score) => score.candidateId !== choiceTrace.chosenCandidateId,
  )!
  alternate.viable = true
  choiceTrace.structuredCandidateId = alternate.candidateId
  choiceTrace.chosenCandidateId = alternate.candidateId
  choiceTrace.action = {
    ...choiceTrace.action,
    kind: 'propose',
    team: [...(
      alternate.features!.version === 'good-proposal-features-v1'
        ? alternate.features.team
        : []
    )],
  }
  assert.ok(
    architectureReport([forgedChoice]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedAppliedAction = structuredClone(artifact)
  const appliedTrace = forgedAppliedAction.decisionTraces!.find(
    (trace) =>
      trace.request.kind === 'propose'
      && trace.action.kind === 'propose'
      && trace.candidateScores!.length > 1,
  )!
  const alternateActionScore = appliedTrace.candidateScores!.find(
    (score) =>
      score.candidateId !== appliedTrace.chosenCandidateId
      && score.features?.version === 'good-proposal-features-v1',
  )!
  assert.equal(
    alternateActionScore.features!.version,
    'good-proposal-features-v1',
  )
  if (
    appliedTrace.action.kind === 'propose'
    && alternateActionScore.features!.version
      === 'good-proposal-features-v1'
  ) {
    appliedTrace.action.team = [
      ...alternateActionScore.features.team,
    ]
  }
  assert.ok(
    architectureReport([forgedAppliedAction]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedSpeech = structuredClone(artifact)
  const speechTrace = forgedSpeech.decisionTraces!.find(
    (trace) => trace.action.kind === 'propose',
  )!
  if (speechTrace.action.kind === 'propose') {
    speechTrace.action.pitch = 'role-composite-decision'
  }
  assert.ok(
    architectureReport([forgedSpeech]).variants[0]
      .safety.hiddenInformationViolations > 0,
  )

  const degradedVariant: ArchitectureVariant = {
    ...variant,
    id: 'phase7c2-role-policy-degraded',
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: true,
      },
      roleObjectives: true,
      scorer: {
        ...seededRoleObjectiveScorer,
        score(input) {
          const scores = structuredClone(
            seededRoleObjectiveScorer.score(input),
          )
          scores[0].roleObjectiveFeatures!.combinedValue += 0.125
          return scores
        },
      },
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  const [degradedArtifact] = await runArchitectureBench({
    variants: [degradedVariant],
    cases: [merlinCase],
    bankId: 'phase7c2-role-policy-degraded',
  })
  assert.ok(degradedArtifact.decisionTraces!.some(
    (trace) => trace.degradation.includes('role-objective-scorer-failed'),
  ))
  assert.equal(
    architectureReport([degradedArtifact]).variants[0]
      .safety.traceAttributionViolations,
    0,
  )

  const fullChainDeletion = structuredClone(degradedArtifact)
  const deletedChainTrace = fullChainDeletion.decisionTraces!.find(
    (trace) =>
      trace.request.kind === 'propose'
      && trace.privateRoleUtility !== undefined,
  )!
  delete deletedChainTrace.privateIdentity
  delete deletedChainTrace.privateRoleObjective
  delete deletedChainTrace.privateRoleUtility
  delete deletedChainTrace.componentVersions!.roleUtility
  deletedChainTrace.degradation = [
    ...deletedChainTrace.degradation,
    'identity-projection-failed',
    ROLE_OBJECTIVE_DEGRADATION,
    'role-utility-projection-failed',
  ]
  assert.ok(
    architectureReport([fullChainDeletion]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const generationForgery: ArchitectureVariant = {
    ...variant,
    id: 'phase7c2-role-policy-generation-forgery',
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      scorer: seededRoleObjectiveScorer,
      roleObjectives: true,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: true,
      },
      onDecisionTrace(trace) {
        const forgedTrace = structuredClone(trace)
        if (
          forgedTrace.request.kind === 'propose'
          && forgedTrace.privateRoleUtility
        ) {
          const score = forgedTrace.candidateScores![0]
          score.roleObjectiveFeatures!.roleAdjustment += 0.123
          score.roleObjectiveFeatures!.combinedValue += 0.123
          score.value += 0.123
        }
        context.onDecisionTrace(forgedTrace)
      },
    }),
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [generationForgery],
      cases: [merlinCase],
      bankId: 'phase7c2-role-policy-generation-forgery',
    }),
    /trace components do not match declared components/,
  )

  const generationActionForgery: ArchitectureVariant = {
    ...variant,
    id: 'phase7c2-role-policy-generation-action-forgery',
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      scorer: seededRoleObjectiveScorer,
      roleObjectives: true,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: true,
      },
      onDecisionTrace(trace) {
        const forgedTrace = structuredClone(trace)
        if (
          forgedTrace.request.kind === 'propose'
          && forgedTrace.action.kind === 'propose'
        ) {
          const alternate = forgedTrace.candidateScores!.find(
            (score) =>
              score.candidateId !== forgedTrace.chosenCandidateId
              && score.features?.version === 'good-proposal-features-v1',
          )
          if (alternate?.features?.version === 'good-proposal-features-v1') {
            forgedTrace.action.team = [...alternate.features.team]
          }
        }
        context.onDecisionTrace(forgedTrace)
      },
    }),
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [generationActionForgery],
      cases: [merlinCase],
      bankId: 'phase7c2-role-policy-generation-action-forgery',
    }),
    /trace components do not match declared components/,
  )

  const generationChainDeletion: ArchitectureVariant = {
    ...degradedVariant,
    id: 'phase7c2-role-policy-generation-chain-deletion',
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: true,
      },
      roleObjectives: true,
      scorer: {
        ...seededRoleObjectiveScorer,
        score(input) {
          const scores = structuredClone(
            seededRoleObjectiveScorer.score(input),
          )
          scores[0].roleObjectiveFeatures!.combinedValue += 0.125
          return scores
        },
      },
      onDecisionTrace(trace) {
        const forgedTrace = structuredClone(trace)
        if (
          forgedTrace.request.kind === 'propose'
          && forgedTrace.privateRoleUtility
        ) {
          delete forgedTrace.privateIdentity
          delete forgedTrace.privateRoleObjective
          delete forgedTrace.privateRoleUtility
          delete forgedTrace.componentVersions!.roleUtility
          forgedTrace.degradation = [
            ...forgedTrace.degradation,
            'identity-projection-failed',
            ROLE_OBJECTIVE_DEGRADATION,
            'role-utility-projection-failed',
          ]
        }
        context.onDecisionTrace(forgedTrace)
      },
    }),
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [generationChainDeletion],
      cases: [merlinCase],
      bankId: 'phase7c2-role-policy-generation-chain-deletion',
    }),
    /trace components do not match declared components/,
  )
})
