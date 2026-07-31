// test-lane: contract
// Migration phase 7D2; see docs/agent-architecture-migration.md.

import test from 'node:test'
import { mutable } from './support/mutable.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { componentPayload } from '../server/agents/components/kernel.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import type { DecisionTrace } from '../server/agents/trace.ts'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import {
  candidateTeams,
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  createProductionComponentRegistry,
} from '../server/agents/components/production-registry.ts'
import {
  revalidatedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'
import {
  replayNativeScoresForAdmission,
} from '../server/agents/policy/score-layer/admission-replay.ts'
import {
  configuredScoreLayerChainForVersion,
} from '../server/agents/role-score-layers/configured.ts'
import {
  projectConfiguredScoreDiagnostics,
} from '../server/agents/score-diagnostics/project-score-diagnostics.ts'
import {
  EVIL_ROLE_UTILITY_CONSTANTS,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  validatePrivateEvilRoleUtilityProjection,
} from '../server/agents/analysis/evil-role-utility.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../server/agents/analysis/evil-objective-types.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  evilRoleObjectiveScorer,
  roleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededEvilRoleObjectiveScorer,
  seededRoleObjectiveScorer,
} from '../server/agents/policy/score.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import { architectureReport } from '../server/eval/architecture-report.ts'
import {
  parseExternalDecisionReply,
} from '../server/agents/external-reply.ts'
import {
  admitDecisionTrace,
} from '../server/agents/admission/composed-trace.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import {
  asProposal,
  assertScoreFamilyConformance,
  asVote,
  mutableClone,
  type Mutable,
} from './support/score-family.ts'
import { DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES } from '../server/agents/canonical/canonical-json.ts'

const fixtures = readDecisionFixtures()
const fixture = (role: Role) =>
  fixtures.find((candidate) => candidate.view.role === role)!

const evilObjective = (trace: DecisionTrace) => componentPayload(
  trace.components!,
  EVIL_ROLE_OBJECTIVE_COMPONENT,
)
const evilUtility = (trace: DecisionTrace) => componentPayload(
  trace.components!,
  EVIL_ROLE_UTILITY_COMPONENT,
)
const goodUtility = (trace: DecisionTrace) => componentPayload(
  trace.components!,
  GOOD_ROLE_UTILITY_COMPONENT,
)
const seededEvilPolicyIdentity = revalidatedArchitectureIdentity(
  createComposedAgent({
  seed: 'identity',
  roleObjectiveRouter: true,
  scorer: seededEvilRoleObjectiveScorer,
  }).resolvedBrain().description,
)

const proposalFixture = (role: Role) => asProposal(fixture(role).view)
const voteFixture = (role: Role) => asVote(fixture(role).view)

function setLegalTwoOneBoard(view: PlayerView, evilSeat: number): void {
  const seats = view.players.map((player) => player.seat)
  const team = (questIndex: number, requiredSeat?: number) => {
    const size = view.quests[questIndex].teamSize
    const selected = requiredSeat === undefined
      ? seats.slice(0, size)
      : [
          requiredSeat,
          ...seats.filter((seat) => seat !== requiredSeat),
        ].slice(0, size).sort((left, right) => left - right)
    return selected
  }
  mutable(view).quests[0] = {
    ...view.quests[0],
    status: 'complete',
    team: team(0),
    result: 'success',
    failCount: 0,
  }
  mutable(view).quests[1] = {
    ...view.quests[1],
    status: 'complete',
    team: team(1),
    result: 'success',
    failCount: 0,
  }
  mutable(view).quests[2] = {
    ...view.quests[2],
    status: 'complete',
    team: team(2, evilSeat),
    result: 'fail',
    failCount: 1,
  }
}

async function decide(
  input: { req: DecisionRequest; view: PlayerView },
  seeded = true,
) {
  return createComposedAgent({
    seed: 'phase7d2-evil-policy',
    roleObjectiveRouter: true,
    scorer: seeded
      ? seededEvilRoleObjectiveScorer
      : evilRoleObjectiveScorer,
  }).decide(input.req, input.view)
}

const familyCase = (
  label: string,
  input: { req: DecisionRequest; view: PlayerView },
  resolvedVersions?: Readonly<Record<string, string>>,
) => ({
  label,
  req: input.req,
  view: input.view,
  ...(resolvedVersions ? { resolvedVersions } : {}),
})

assertScoreFamilyConformance({
  family: 'evil-role',
  seed: 'phase7d2-evil-policy',
  agent: { roleObjectiveRouter: true },
  deterministic: {
    scorer: evilRoleObjectiveScorer,
    version: EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
    components: [EVIL_ROLE_UTILITY_COMPONENT],
    predecessor: {
      scorer: roleObjectiveScorer,
      version: ROLE_OBJECTIVE_SCORER_VERSION,
    },
  },
  seeded: {
    scorer: seededEvilRoleObjectiveScorer,
    version: EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    components: [EVIL_ROLE_UTILITY_COMPONENT],
    predecessor: {
      scorer: seededRoleObjectiveScorer,
      version: ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    },
  },
  eligible: [
    familyCase('Mordred vote', voteFixture('mordred')),
    familyCase('Oberon proposal', proposalFixture('oberon')),
  ],
  delegating: [
    // Merlin resolves the C2 role scorer; a Servant falls through to Phase 4.
    familyCase('Merlin proposal', proposalFixture('merlin')),
    familyCase('Servant vote', voteFixture('servant'), {
      [EVIL_ROLE_OBJECTIVE_SCORER_VERSION]: GOOD_PROPOSAL_VOTE_SCORER_VERSION,
      [EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION]:
        GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
    }),
  ],
})

test('evil proposal utility is exact and failure capacity owns seventy percent', async () => {
  const output = await decide(proposalFixture('assassin'), false)
  const trace = output.trace!
  assert.equal(
    trace.componentVersions!.scorer,
    EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  )
  assert.equal(trace.componentVersions!.evilRoleUtility, undefined)
  assert.equal(
    EVIL_ROLE_UTILITY_COMPONENT.version,
    EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  )
  assert.ok(
    validatePrivateEvilRoleUtilityProjection(
      evilUtility(trace),
    ),
  )
  for (const assessment of evilUtility(trace)!.assessments) {
    assert.equal(
      assessment.failureCapacityContribution,
      EVIL_ROLE_UTILITY_CONSTANTS.failureCapacityWeight
        * assessment.failureCapacityValue,
    )
    assert.equal(
      assessment.publicCoverContribution,
      EVIL_ROLE_UTILITY_CONSTANTS.publicCoverWeight
        * assessment.publicCoverValue,
    )
    assert.equal(
      assessment.futureOpportunityContribution,
      EVIL_ROLE_UTILITY_CONSTANTS.futureOpportunityWeight
        * assessment.futureOpportunityValue,
    )
    assert.equal(
      assessment.roleValue,
      assessment.failureCapacityContribution
        + assessment.publicCoverContribution
        + assessment.futureOpportunityContribution,
    )
  }
  const viable = trace.candidateScores!.filter((score) => score.viable)
  assert.equal(viable.length, 1)
  assert.equal(trace.structuredCandidateId, viable[0].candidateId)
})

test('evil vote rejection compares the canonical best D1 alternative', async () => {
  const output = await decide(voteFixture('mordred'), false)
  const assessments = evilUtility(output.trace!)!.assessments
  const approve = assessments.find(
    (assessment) => assessment.direction === 'support',
  )!
  const reject = assessments.find(
    (assessment) => assessment.direction === 'oppose',
  )!
  assert.equal(approve.alternativeRealization, 1)
  assert.ok(reject.bestAlternativeCandidateId)
  assert.ok(reject.bestAlternativeTeam)
  assert.equal(
    reject.failureCapacityValue,
    reject.bestAlternativeFailureCapabilityProbability!
      * reject.alternativeRealization,
  )
  assert.equal(
    reject.alternativeRealization,
    Math.min(
      1,
      EVIL_ROLE_UTILITY_CONSTANTS.alternativeRealizationBase
        + EVIL_ROLE_UTILITY_CONSTANTS.alternativeRealizationPerRejection
          * (5 - output.trace!.request.proposalNum),
    ),
  )
})

test('the seeded evil vote band equation matches its own diagnostics', async () => {
  // Per-seed determinism and the seeded identity are family-harness laws.
  const input = voteFixture('mordred')
  const first = await decide(input)
  const scores = first.trace!.candidateScores!
  const inBand = scores[0].evilRoleObjectiveFeatures!.inViableBand
  assert.equal(
    inBand,
    Math.abs(
      scores[0].evilRoleObjectiveFeatures!.roleValue
        - scores[1].evilRoleObjectiveFeatures!.roleValue,
    ) <= 0.04,
  )
  if (!inBand) {
    assert.ok(scores.every(
      (score) =>
        score.evilRoleObjectiveFeatures!.seedBucket === undefined
        && score.evilRoleObjectiveFeatures!.selectionAdjustment === 0,
    ))
  }
})

test('a delegated decision keeps only its own predecessor utility', async () => {
  // Chain resolution and D2 utility absence are family-harness laws. What this
  // test owns is that C2 delegation still produces the good role utility while
  // a Phase 4 delegation produces none.
  const merlin = await decide(proposalFixture('merlin'))
  const servant = await decide(voteFixture('servant'))
  assert.ok(goodUtility(merlin.trace!))
  assert.equal(goodUtility(servant.trace!), undefined)
})

test('Oberon policy keeps self-only coordination distinct', async () => {
  const output = await decide(proposalFixture('oberon'))
  for (const assessment of evilUtility(output.trace!)!.assessments) {
    assert.equal(assessment.coordination.kind, 'self-only-uncoordinated')
    if (assessment.coordination.kind === 'self-only-uncoordinated') {
      assert.equal(
        typeof assessment.coordination.unseenEvilOnTeamProbability,
        'number',
      )
    }
  }
})

test('external ingress and host replay reject utility, score, seed, and deletion forgeries', async () => {
  const input = voteFixture('mordred')
  const output = await decide(input)
  assert.ok(parseExternalDecisionReply(
    input.req,
    output,
    'phase7d2',
    input.view,
  ).trace)
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace!,
    req: input.req,
    view: input.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: 'phase7d2-evil-policy',
    expectedArchitectureIdentity: seededEvilPolicyIdentity,
  }).kind, 'trusted-exact')

  const mutations = [
    (trace: Mutable<NonNullable<typeof output.trace>>) => {
      evilUtility(trace)!.assessments[0]
        .failureCapacityContribution += 0.01
    },
    (trace: Mutable<NonNullable<typeof output.trace>>) => {
      trace.candidateScores![0].evilRoleObjectiveFeatures!.roleValue += 0.01
    },
    (trace: Mutable<NonNullable<typeof output.trace>>) => {
      const feature =
        trace.candidateScores![0].evilRoleObjectiveFeatures!
      feature.seedBucket = feature.seedBucket === 0 ? 1 : 0
    },
    (trace: Mutable<NonNullable<typeof output.trace>>) => {
      const request = evilUtility(trace)!.request
      request.completedGoodQuests =
        request.completedGoodQuests === 0 ? 1 : 0
    },
    (trace: Mutable<NonNullable<typeof output.trace>>) => {
      delete (trace as unknown as Record<string, unknown>)
        .privateEvilRoleUtility
      delete trace.componentVersions!.evilRoleUtility
      trace.componentVersions!.scorer =
        GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      trace.componentVersions!.configuredScorer =
        EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      trace.degradation.push('evil-role-utility-projection-failed')
    },
  ]
  for (const mutate of mutations) {
    const forged = mutableClone(output)
    mutate(forged.trace!)
    assert.deepEqual(
      parseExternalDecisionReply(
        input.req,
        forged,
        'phase7d2 forged',
        input.view,
      ),
      { decision: forged.decision },
    )
    const admission = admitDecisionTrace({
      kind: 'finalized-artifact',
      trace: forged.trace!,
      req: input.req,
      view: input.view,
      authoritativeAction: output.decision,
      selectedDecision: output.decision,
      deterministicSeed: 'phase7d2-evil-policy',
      expectedArchitectureIdentity: seededEvilPolicyIdentity,
    })
    assert.equal(admission.kind, 'rejected')
    if (admission.kind === 'rejected') {
      assert.equal(
        admission.reason,
        'trusted-identity-host-join-failed',
      )
    }
  }
})

test('forced D2 diagnostics are unseeded and malformed D2 falls through to Phase4', async () => {
  const input = voteFixture('mordred')
  const ordinary = await decide(input)
  const candidates = legalCandidates(input.req, input.view)
  const hypotheticalTeamCandidates =
    hypotheticalProposalCandidates(input.view)
  const analysis = analyzeSituation(input.view, {
    belief: exactBelief(input.view),
    policyCandidateAssessments:
      candidateTeams(hypotheticalTeamCandidates, input.view),
    goodVote: true,
  })
  const selectedCandidateId = candidates[0].id
  const forced = {
    ...ordinary.trace!.forcedPolicyResult!,
    applied: true,
    allowedCandidateIds: [selectedCandidateId],
    selectedCandidateId,
  }
  const replay = replayNativeScoresForAdmission({
    chain: configuredScoreLayerChainForVersion(
      EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    ),
    request: input.req,
    view: input.view,
    analysis,
    candidates,
    hypotheticalTeamCandidates,
    forced,
    candidateBoundary: {
      survivorCandidateIds: forced.allowedCandidateIds,
      selectedCandidateId: forced.selectedCandidateId,
      reasonCodes: forced.reasonCodes,
    },
    deterministicSeed: 'phase7d2-evil-policy',
    compatibilityCandidateId: candidates[0].id,
    expectedScorerVersion: EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    componentDefinitions: createProductionComponentRegistry({
      goodObjectiveAllDecisionKinds: true,
    }).definitions(),
    componentRun: ordinary.trace!.components!,
  })
  const scores = projectConfiguredScoreDiagnostics({
    deterministicSeed: 'phase7d2-evil-policy',
    request: input.req,
    view: input.view,
    analysis,
    candidates,
    hypotheticalTeamCandidates,
    forced,
    candidateBoundary: {
      survivorCandidateIds: forced.allowedCandidateIds,
      selectedCandidateId: forced.selectedCandidateId,
      reasonCodes: forced.reasonCodes,
    },
    evilRoleUtility: evilUtility(ordinary.trace!)!,
  }, replay.rows, EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION)
  // Survivor narrowing under force is a family-harness law. This test owns the
  // unseeded, non-material D2 diagnostics and the malformed fall-through below.
  assert.ok(scores.every((score) =>
    score.evilRoleObjectiveFeatures?.selectionAdjustment === 0
    && score.evilRoleObjectiveFeatures?.seedBucket === undefined))

  const malformed = {
    ...seededEvilRoleObjectiveScorer,
    score() {
      return []
    },
  }
  const degraded = await createComposedAgent({
    seed: 'phase7d2-fallback',
    roleObjectiveRouter: true,
    scorer: malformed,
  }).decide(input.req, input.view)
  assert.equal(
    degraded.trace!.componentVersions!.scorer,
    GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  )
  assert.equal(
    degraded.trace!.componentVersions!.configuredScorer,
    EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  )
  assert.ok(degraded.trace!.degradation.includes('scorer-invalid-output'))
  assert.ok(
    degraded.trace!.degradation.includes(
      'evil-role-objective-scorer-failed',
    ),
  )
})

test('two-Fail utility uses thresholded joint capacity and named cover/future equations', async () => {
  const bankCase = ARCHITECTURE_BANK.find(
    (candidate) =>
      candidate.playerCount >= 7 && candidate.targetRole === 'oberon',
  )!
  const game = createGame({
    seed: bankCase.seed,
    playerCount: bankCase.playerCount,
    roles: [...bankCase.roles],
    talk: bankCase.talk,
  })
  const target = game.players.find((player) => player.role === 'oberon')!
  const view = viewFor(game, target.seat)
  mutable(view).phase = 'proposal'
  mutable(view).round = 4
  mutable(view).proposalNum = 1
  setLegalTwoOneBoard(view, target.seat)
  const req: DecisionRequest = {
    kind: 'propose',
    seat: target.seat,
    round: 4,
    proposalNum: 1,
  }
  const output = await decide({ req, view }, false)
  assert.equal(
    evilUtility(output.trace!)!.request.failsRequired,
    2,
  )
  for (const utility of evilUtility(output.trace!)!.assessments) {
    const objective = evilObjective(output.trace!)!.assessments
      .find((assessment) => assessment.candidateId === utility.candidateId)!
    assert.equal(
      utility.teamFailureCapabilityProbability,
      objective.evilCountDistribution.slice(2)
        .reduce((sum, probability) => sum + probability, 0),
    )
    assert.equal(
      utility.publicCoverValue,
      0.5 * utility.publicActionPlausibilityValue
        + 0.5 * utility.participantCoverProxyIndex,
    )
    assert.equal(
      utility.publicCoverAvailable,
      utility.participantCoverAvailable,
    )
    if (
      utility.futureOpportunitySource.kind
        === 'oberon-unseen-placement-reserve'
    ) {
      assert.equal(
        utility.futureOpportunityValue,
        1 - utility.futureOpportunitySource
          .unseenEvilOnTeamProbability,
      )
    }
  }
})

test('D2 utility validator is total over hostile detached data', async () => {
  const output = await decide(proposalFixture('assassin'), false)
  const utility = evilUtility(output.trace!)!
  assert.ok(validatePrivateEvilRoleUtilityProjection(utility))

  const sparse = mutableClone(utility)
  delete sparse.assessments[0]
  assert.equal(validatePrivateEvilRoleUtilityProjection(sparse), false)

  const accessor = structuredClone(utility) as unknown as Record<string, unknown>
  Object.defineProperty(accessor, 'role', {
    enumerable: true,
    get: () => 'assassin',
  })
  assert.equal(validatePrivateEvilRoleUtilityProjection(accessor), false)

  const cyclic = structuredClone(utility) as unknown as Record<string, unknown>
  cyclic.loop = cyclic
  assert.equal(validatePrivateEvilRoleUtilityProjection(cyclic), false)

  const oversized = structuredClone(utility)
  oversized.assessments[0].candidateId =
    'x'.repeat(DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES)
  assert.equal(validatePrivateEvilRoleUtilityProjection(oversized), false)

  const badTeam = structuredClone(utility)
  badTeam.assessments[0].team = [1, 0]
  assert.equal(validatePrivateEvilRoleUtilityProjection(badTeam), false)

  const badPosture = structuredClone(utility)
  badPosture.assessments[0].posture = 'mordred-deep-cover'
  assert.equal(validatePrivateEvilRoleUtilityProjection(badPosture), false)

  const visibleAsSelfOnly = structuredClone(utility)
  const visibleAssessment = visibleAsSelfOnly.assessments[0]
  visibleAssessment.coordination = {
    kind: 'self-only-uncoordinated',
    selfAboard: visibleAssessment.team.includes(
      visibleAsSelfOnly.request.seat,
    ),
    unseenEvilOnTeamProbability: 0,
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(visibleAsSelfOnly),
    false,
  )

  const oberonOutput = await decide(proposalFixture('oberon'), false)
  const oberonUtility = evilUtility(oberonOutput.trace!)!
  const oberonAsVisible = structuredClone(oberonUtility)
  oberonAsVisible.assessments[0].coordination = {
    kind: 'visible-coordination',
    coordinatedEvilAboard: 0,
    totalVisibleEvil: 1,
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(oberonAsVisible),
    false,
  )

  const visibleFutureAsOberon = structuredClone(utility)
  const futureAssessment = visibleFutureAsOberon.assessments[0]
  futureAssessment.futureOpportunityValue = 0
  futureAssessment.futureOpportunityAvailable = true
  futureAssessment.futureOpportunityContribution = 0
  futureAssessment.roleValue =
    futureAssessment.failureCapacityContribution
      + futureAssessment.publicCoverContribution
  futureAssessment.futureOpportunitySource = {
    kind: 'oberon-unseen-placement-reserve',
    unseenEvilOnTeamProbability: 1,
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(visibleFutureAsOberon),
    false,
  )

  const oberonFutureAsVisible = structuredClone(oberonUtility)
  const oberonFutureAssessment = oberonFutureAsVisible.assessments[0]
  oberonFutureAssessment.futureOpportunityValue = 0
  oberonFutureAssessment.futureOpportunityAvailable = true
  oberonFutureAssessment.futureOpportunityContribution = 0
  oberonFutureAssessment.roleValue =
    oberonFutureAssessment.failureCapacityContribution
      + oberonFutureAssessment.publicCoverContribution
  oberonFutureAssessment.futureOpportunitySource = {
    kind: 'visible-coordination-reserve',
    reservedVisibleEvil: 0,
    totalVisibleEvil: 1,
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(oberonFutureAsVisible),
    false,
  )

  const supportWithRejectionRunway = structuredClone(utility)
  const rejectionAssessment = supportWithRejectionRunway.assessments[0]
  rejectionAssessment.futureOpportunityValue = 0.5
  rejectionAssessment.futureOpportunityAvailable = true
  rejectionAssessment.futureOpportunityContribution =
    EVIL_ROLE_UTILITY_CONSTANTS.futureOpportunityWeight * 0.5
  rejectionAssessment.roleValue =
    rejectionAssessment.failureCapacityContribution
      + rejectionAssessment.publicCoverContribution
      + rejectionAssessment.futureOpportunityContribution
  rejectionAssessment.futureOpportunitySource = {
    kind: 'rejection-runway',
    rejectionsBeforeHammer: 2,
    runwayDenominator: 4,
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(supportWithRejectionRunway),
    false,
  )

  assert.notEqual(utility.request.round, 5)
  const prematureTerminal = structuredClone(utility)
  const terminalAssessment = prematureTerminal.assessments[0]
  terminalAssessment.futureOpportunityValue = 0
  terminalAssessment.futureOpportunityAvailable = false
  terminalAssessment.futureOpportunityContribution = 0
  terminalAssessment.roleValue =
    terminalAssessment.failureCapacityContribution
      + terminalAssessment.publicCoverContribution
  terminalAssessment.futureOpportunitySource = { kind: 'terminal-none' }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(prematureTerminal),
    false,
  )

  const freshCase = ARCHITECTURE_BANK.find(
    (candidate) =>
      candidate.targetRole === 'assassin'
      && candidate.playerCount === 5,
  )!
  const freshGame = createGame({
    seed: freshCase.seed,
    playerCount: freshCase.playerCount,
    roles: [...freshCase.roles],
    talk: freshCase.talk,
  })
  const freshTarget = freshGame.players.find(
    (player) => player.role === 'assassin',
  )!
  const freshProposalView = viewFor(freshGame, freshTarget.seat)
  const freshProposalReq: DecisionRequest = {
    kind: 'propose',
    seat: freshTarget.seat,
    round: freshProposalView.round,
    proposalNum: freshProposalView.proposalNum,
  }
  const freshProposal = await decide({
    req: freshProposalReq,
    view: freshProposalView,
  }, false)
  const freshVisibleUtility =
    evilUtility(freshProposal.trace!)!
  const withNoFuture = (
    kind: 'terminal-none' | 'decisive-board-none',
    round: number,
    completedGoodQuests: number,
    completedEvilQuests: number,
  ) => {
    const projection = structuredClone(freshVisibleUtility)
    projection.request.round = round
    projection.request.completedGoodQuests = completedGoodQuests
    projection.request.completedEvilQuests = completedEvilQuests
    for (const assessment of projection.assessments) {
      assessment.futureOpportunityValue = 0
      assessment.futureOpportunityAvailable = false
      assessment.futureOpportunityContribution = 0
      assessment.roleValue =
        assessment.failureCapacityContribution
          + assessment.publicCoverContribution
      assessment.futureOpportunitySource = { kind }
    }
    return projection
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 1, 0, 0),
    ),
    false,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 3, 2, 0),
    ),
    true,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 2, 2, 0),
    ),
    false,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 4, 2, 0),
    ),
    false,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 4, 0, 2),
    ),
    false,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 4, 2, 1),
    ),
    true,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 4, 1, 2),
    ),
    true,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 3, 0, 2),
    ),
    true,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('decisive-board-none', 5, 2, 2),
    ),
    false,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('terminal-none', 5, 2, 2),
    ),
    true,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('terminal-none', 3, 2, 0),
    ),
    false,
  )
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(
      withNoFuture('terminal-none', 5, 2, 1),
    ),
    false,
  )

  const wrongFivePlayerThreshold = structuredClone(freshVisibleUtility)
  assert.equal(wrongFivePlayerThreshold.source.playerCount, 5)
  wrongFivePlayerThreshold.request.failsRequired = 2
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(wrongFivePlayerThreshold),
    false,
  )
  const wrongSevenPlayerThreshold = withNoFuture(
    'decisive-board-none',
    4,
    2,
    1,
  )
  wrongSevenPlayerThreshold.source.playerCount = 7
  wrongSevenPlayerThreshold.request.failsRequired = 1
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(wrongSevenPlayerThreshold),
    false,
  )
  const wrongNonFourthThreshold = withNoFuture(
    'decisive-board-none',
    3,
    2,
    0,
  )
  wrongNonFourthThreshold.source.playerCount = 7
  wrongNonFourthThreshold.request.failsRequired = 2
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(wrongNonFourthThreshold),
    false,
  )

  const forgedDecisiveScore = structuredClone(freshVisibleUtility)
  forgedDecisiveScore.request.completedGoodQuests = 2
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(forgedDecisiveScore),
    false,
  )
  const visibleReserveIndex =
    freshVisibleUtility.assessments.findIndex(
      (assessment) =>
        assessment.futureOpportunitySource.kind
          === 'visible-coordination-reserve',
    )
  assert.notEqual(visibleReserveIndex, -1)

  const detachedCoordinatedCount = structuredClone(freshVisibleUtility)
  const detachedCoordination =
    detachedCoordinatedCount.assessments[visibleReserveIndex]
  assert.equal(detachedCoordination.coordination.kind, 'visible-coordination')
  if (detachedCoordination.coordination.kind === 'visible-coordination') {
    detachedCoordination.coordination.coordinatedEvilAboard =
      detachedCoordination.coordination.coordinatedEvilAboard === 0
        ? 1
        : detachedCoordination.coordination.coordinatedEvilAboard - 1
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(detachedCoordinatedCount),
    false,
  )

  const scaledVisibleReserve = structuredClone(freshVisibleUtility)
  const scaledAssessment =
    scaledVisibleReserve.assessments[visibleReserveIndex]
  const scaledSource = scaledAssessment.futureOpportunitySource
  assert.equal(scaledSource.kind, 'visible-coordination-reserve')
  if (scaledSource.kind === 'visible-coordination-reserve') {
    scaledSource.reservedVisibleEvil *= 2
    scaledSource.totalVisibleEvil *= 2
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(scaledVisibleReserve),
    false,
  )

  const freshOberonCase = ARCHITECTURE_BANK.find(
    (candidate) => candidate.targetRole === 'oberon',
  )!
  const freshOberonGame = createGame({
    seed: freshOberonCase.seed,
    playerCount: freshOberonCase.playerCount,
    roles: [...freshOberonCase.roles],
    talk: freshOberonCase.talk,
  })
  const freshOberonTarget = freshOberonGame.players.find(
    (player) => player.role === 'oberon',
  )!
  const freshOberonView = viewFor(
    freshOberonGame,
    freshOberonTarget.seat,
  )
  const freshOberon = await decide({
    req: {
      kind: 'propose',
      seat: freshOberonTarget.seat,
      round: freshOberonView.round,
      proposalNum: freshOberonView.proposalNum,
    },
    view: freshOberonView,
  }, false)
  const freshOberonUtility =
    evilUtility(freshOberon.trace!)!
  const unseenIndex = freshOberonUtility.assessments.findIndex(
    (assessment) =>
      assessment.futureOpportunitySource.kind
        === 'oberon-unseen-placement-reserve',
  )
  assert.notEqual(unseenIndex, -1)

  const detachedUnseenProbability = structuredClone(freshOberonUtility)
  const detachedUnseen =
    detachedUnseenProbability.assessments[unseenIndex]
  assert.equal(
    detachedUnseen.coordination.kind,
    'self-only-uncoordinated',
  )
  if (detachedUnseen.coordination.kind === 'self-only-uncoordinated') {
    detachedUnseen.coordination.unseenEvilOnTeamProbability =
      detachedUnseen.coordination.unseenEvilOnTeamProbability === 0
        ? 1
        : 0
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(detachedUnseenProbability),
    false,
  )

  const flippedSelfAboard = structuredClone(freshOberonUtility)
  const selfAssessment = flippedSelfAboard.assessments[0]
  assert.equal(
    selfAssessment.coordination.kind,
    'self-only-uncoordinated',
  )
  if (selfAssessment.coordination.kind === 'self-only-uncoordinated') {
    selfAssessment.coordination.selfAboard =
      !selfAssessment.coordination.selfAboard
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(flippedSelfAboard),
    false,
  )

  const freshVoteView = viewFor(freshGame, freshTarget.seat)
  mutable(freshVoteView).phase = 'vote'
  mutable(freshVoteView).currentTeam = freshVoteView.players
    .slice(0, freshVoteView.quests[0].teamSize)
    .map((player) => player.seat)
  const freshVote = await decide({
    req: {
      kind: 'vote',
      seat: freshTarget.seat,
      round: freshVoteView.round,
      proposalNum: freshVoteView.proposalNum,
    },
    view: freshVoteView,
  }, false)
  const detachedRunway = structuredClone(
    evilUtility(freshVote.trace!)!,
  )
  const runwayAssessment = detachedRunway.assessments.find(
    (assessment) =>
      assessment.futureOpportunitySource.kind === 'rejection-runway',
  )!
  assert.ok(runwayAssessment)
  const runwaySource = runwayAssessment.futureOpportunitySource
  assert.equal(runwaySource.kind, 'rejection-runway')
  if (runwaySource.kind === 'rejection-runway') {
    runwaySource.rejectionsBeforeHammer -= 1
    runwayAssessment.futureOpportunityValue =
      runwaySource.rejectionsBeforeHammer / runwaySource.runwayDenominator
    runwayAssessment.futureOpportunityContribution =
      EVIL_ROLE_UTILITY_CONSTANTS.futureOpportunityWeight
        * runwayAssessment.futureOpportunityValue
    runwayAssessment.roleValue =
      runwayAssessment.failureCapacityContribution
        + runwayAssessment.publicCoverContribution
        + runwayAssessment.futureOpportunityContribution
  }
  assert.equal(
    validatePrivateEvilRoleUtilityProjection(detachedRunway),
    false,
  )
})

test('ten-player D2 surface is bounded, name-invariant, and private from voice/client', async () => {
  const bankCase = ARCHITECTURE_BANK.find(
    (candidate) =>
      candidate.playerCount === 10 && candidate.targetRole === 'oberon',
  )!
  const game = createGame({
    seed: bankCase.seed,
    playerCount: bankCase.playerCount,
    roles: [...bankCase.roles],
    talk: bankCase.talk,
  })
  const target = game.players.find((player) => player.role === 'oberon')!
  const view = viewFor(game, target.seat)
  mutable(view).phase = 'proposal'
  mutable(view).round = 4
  mutable(view).proposalNum = 1
  setLegalTwoOneBoard(view, target.seat)
  const req: DecisionRequest = {
    kind: 'propose',
    seat: target.seat,
    round: 4,
    proposalNum: 1,
  }
  let renderedVoice = ''
  const agent = createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
    scorer: seededEvilRoleObjectiveScorer,
    voice: {
      version: 'phase7d2-fake-voice',
      async speak(input) {
        renderedVoice = JSON.stringify(input)
        return { text: 'A bounded public pitch.' }
      },
    },
  })
  const first = await agent.decide(req, view)
  assert.equal(first.trace!.candidateScores!.length, 252)
  assert.equal(
    evilUtility(first.trace!)!.assessments.length,
    252,
  )
  assert.ok(
    Buffer.byteLength(
      JSON.stringify(evilUtility(first.trace!)),
      'utf8',
    ) <= DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
  )
  assert.doesNotMatch(
    renderedVoice,
    /privateEvilRoleUtility|evilRoleObjectiveFeatures|failureCapacity|unseenEvil/,
  )

  const renamed = structuredClone(view)
  mutable(renamed).name = 'Renamed Target'
  mutable(renamed).players = renamed.players.map((player) => ({
    ...player,
    name: `Renamed ${player.seat}`,
  }))
  const second = await createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
    scorer: seededEvilRoleObjectiveScorer,
  }).decide(req, renamed)
  assert.deepEqual(
    evilUtility(second.trace!),
    evilUtility(first.trace!),
  )
  assert.equal(second.decision.kind, 'propose')
  assert.equal(first.decision.kind, 'propose')
  if (second.decision.kind === 'propose' && first.decision.kind === 'propose') {
    assert.deepEqual(second.decision.team, first.decision.team)
  }
  const clientSource = readFileSync(
    new URL('../client/src/App.tsx', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(
    clientSource,
    /privateEvilRoleUtility|evilRoleObjectiveFeatures/,
  )
})

test('free architecture bank attributes the nested D2 to C2 to Phase4 chain', async () => {
  const variant: ArchitectureVariant = {
    id: 'phase7d2-evil-policy',
    paid: false,
    components: {
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      beliefVisibility: 'none',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      identityModel: 'joint-identity-projection-v1',
      decisionComponents: 'decision-component-run-v1',
      analysis: 'situation-analysis-v1',
      candidates: 'legal-candidates-v1',
      forcedPolicy: 'forced-policy-v1',
      roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
      policy: 'composed-policy-v1',
      scorer: EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      planner: 'planner-off',
      prompt: 'composed-typed-context-v4',
      renderer: 'composed-policy-renderer-v4',
      communication: 'plan-voice-v2',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      roleObjectiveRouter: true,
      scorer: seededEvilRoleObjectiveScorer,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [],
        hiddenTeam: true,
      },
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  const artifacts = await runArchitectureBench({
    variants: [variant],
    cases: ARCHITECTURE_BANK,
    bankId: 'phase7d2-evil-policy',
  })
  assert.equal(artifacts.length, ARCHITECTURE_BANK.length)
  assert.equal(
    architectureReport(artifacts).variants[0]
      .safety.traceAttributionViolations,
    0,
  )
  for (const artifact of artifacts) {
    const role = artifact.architecture!.targetRole
    const traces = artifact.decisionTraces!
    const applicable = traces.filter(
      (trace) =>
        trace.request.kind === 'propose'
        || trace.request.kind === 'vote',
    )
    if (['merlin', 'percival'].includes(role)) {
      assert.ok(applicable.every(
        (trace) =>
          goodUtility(trace) !== undefined
          && trace.componentVersions!.scorer
            === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ))
    } else if (role === 'servant') {
      assert.ok(applicable.every(
        (trace) =>
          goodUtility(trace) === undefined
          && evilUtility(trace) === undefined
          && trace.componentVersions!.scorer
            === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
      ))
    } else {
      assert.ok(applicable.every(
        (trace) =>
          evilUtility(trace) !== undefined
          && trace.componentVersions!.scorer
            === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ))
    }
  }

  const evilArtifact = artifacts.find((artifact) =>
    ['assassin', 'morgana', 'mordred', 'minion', 'oberon']
      .includes(artifact.architecture!.targetRole))!
  const forgedUtility = structuredClone(evilArtifact)
  const utilityTrace = forgedUtility.decisionTraces!.find(
    (trace) => evilUtility(trace) !== undefined,
  )!
  evilUtility(utilityTrace)!.assessments[0]
    .publicCoverContribution += 0.01
  assert.ok(
    architectureReport([forgedUtility]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedBoard = structuredClone(evilArtifact)
  const boardTrace = forgedBoard.decisionTraces!.find(
    (trace) => evilUtility(trace) !== undefined,
  )!
  const boardRequest = evilUtility(boardTrace)!.request
  boardRequest.completedEvilQuests =
    boardRequest.completedEvilQuests === 0 ? 1 : 0
  assert.ok(
    architectureReport([forgedBoard]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedAction = structuredClone(evilArtifact)
  const actionTrace = forgedAction.decisionTraces!.find(
    (trace) =>
      evilUtility(trace) !== undefined
      && trace.candidateScores!.length > 1,
  )!
  const alternate = actionTrace.candidateScores!.find(
    (score) => score.candidateId !== actionTrace.chosenCandidateId,
  )!
  if (actionTrace.action.kind === 'propose') {
    actionTrace.action.team = alternate
      .evilRoleObjectiveFeatures!.utility.team.slice()
  } else if (actionTrace.action.kind === 'vote') {
    actionTrace.action.vote =
      actionTrace.action.vote === 'approve' ? 'reject' : 'approve'
  }
  assert.ok(
    architectureReport([forgedAction]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedManifest = structuredClone(evilArtifact)
  delete forgedManifest.strategyVersions!.evilRoleUtilities
  const descriptorOwned = architectureReport([forgedManifest]).variants[0]
  assert.equal(descriptorOwned.safety.traceAttributionViolations, 0)
  assert.equal(descriptorOwned.safety.promotionEvidenceEligible, true)

  const generationForgery: ArchitectureVariant = {
    ...variant,
    id: 'phase7d2-generation-forgery',
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      roleObjectiveRouter: true,
      scorer: seededEvilRoleObjectiveScorer,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [],
        hiddenTeam: true,
      },
      onDecisionTrace(trace) {
        const forged = mutableClone(trace)
        if (evilUtility(forged)) {
          evilUtility(forged)!.assessments[0]
            .futureOpportunityContribution += 0.01
        }
        context.onDecisionTrace!(forged)
      },
    }),
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [generationForgery],
      cases: [
        ARCHITECTURE_BANK.find(
          (candidate) => candidate.targetRole === 'assassin',
        )!,
      ],
      bankId: 'phase7d2-generation-forgery',
    }),
    /trace components do not match declared components/,
  )
})

test('weighted D2 dependency failure is atomic at generation and report boundaries', async () => {
  const dependencyLabels = [
    'identity-projection-failed',
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
    'evil-role-utility-projection-failed',
  ]
  const degrade = (
    source: Parameters<NonNullable<
      Parameters<typeof createComposedAgent>[0]['onDecisionTrace']
    >>[0],
    req: DecisionRequest,
    view: PlayerView,
  ) => {
    const trace = mutableClone(source) as Mutable<DecisionTrace> & {
      privateEvilRoleObjective?: Mutable<
        NonNullable<ReturnType<typeof evilObjective>>
      >
      privateEvilRoleUtility?: unknown
    }
    const historicalObjective = evilObjective(trace)
    // Exercise the historical role-specific transport shape. New traces carry
    // a generic component projection whose equality cannot be retained after
    // this synthetic dependency rewrite.
    delete trace.components
    delete trace.componentPlan
    delete trace.componentVersions!.decisionComponents
    trace.version = 'decision-trace-v1'
    trace.beliefModelVersion = 'phase7d2-external-weighted-v1'
    trace.quality = 'weighted'
    trace.componentVersions!.belief = trace.beliefModelVersion
    trace.componentVersions!.factors = 'phase7d2-external-factor-v1'
    trace.componentVersions!.configuredScorer =
      EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    trace.componentVersions!.roleObjective =
      EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    trace.privateEvilRoleObjective = mutableClone(historicalObjective)
    delete trace.componentVersions!.evilRoleUtility
    trace.beliefProvenance = [{
      factorId: 'phase7d2-external-factor',
      factorVersion: 'phase7d2-external-factor-v1',
      evidenceIds: ['external:1'],
      logLikelihoodCap: 1,
      minLogLikelihood: 0,
      maxLogLikelihood: 0,
    }]
    trace.beliefTeamAssessments = undefined
    if (trace.privateIdentity) {
      trace.privateIdentity.sourceBelief.modelVersion =
        trace.beliefModelVersion
      trace.privateIdentity.sourceBelief.quality = 'weighted'
    }
    if (trace.privateIdentity && trace.privateEvilRoleObjective) {
      trace.privateEvilRoleObjective.source.beliefModelVersion =
        trace.beliefModelVersion
      trace.privateEvilRoleObjective.source.beliefQuality = 'weighted'
    }
    if (req.kind === 'propose' || req.kind === 'vote') {
      delete trace.privateIdentity
      delete trace.privateEvilRoleObjective
      delete trace.privateEvilRoleUtility
      trace.degradation = [...dependencyLabels]
    }
    return trace
  }
  const externalInput = voteFixture('mordred')
  const externalAgent = createComposedAgent({
    seed: 'phase7d2-weighted-atomic-stdio',
    roleObjectiveRouter: true,
    scorer: seededGoodProposalVoteScorer,
    publicObserver: true,
    privateIdentity: {
      roleQueries: [],
      hiddenTeam: true,
    },
  })
  const externalBase = await externalAgent.decide(externalInput.req, externalInput.view)
  const externalDegraded = {
    decision: externalBase.decision,
    trace: degrade(
      externalBase.trace!,
      externalInput.req,
      externalInput.view,
    ),
  }
  assert.ok(parseExternalDecisionReply(
    externalInput.req,
    externalDegraded,
    'phase7d2 weighted atomic',
    externalInput.view,
  ).trace)
  const externalAdmission = admitDecisionTrace({
    kind: 'pre-apply-external',
    trace: externalDegraded.trace,
    req: externalInput.req,
    decision: externalDegraded.decision,
    hostView: externalInput.view,
  })
  assert.equal(externalAdmission.kind, 'external-diagnostic')
  assert.equal(externalAdmission.promotionEvidenceEligible, false)
  const weightedAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: externalDegraded.trace,
    req: externalInput.req,
    view: externalInput.view,
    authoritativeAction: externalDegraded.decision,
    selectedDecision: externalDegraded.decision,
    deterministicSeed: 'phase7d2-weighted-atomic-stdio',
  })
  assert.equal(weightedAdmission.kind, 'artifact-diagnostic')
  assert.equal(weightedAdmission.promotionEvidenceEligible, false)
  const weightedVariant: ArchitectureVariant = {
    id: 'phase7d2-weighted-atomic-degradation',
    paid: false,
    components: {
      brain: 'brain-spec-v1',
      belief: 'phase7d2-external-weighted-v1',
      beliefVisibility: 'none',
      factors: 'phase7d2-external-factor-v1',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      identityModel: 'joint-identity-projection-v1',
      analysis: 'situation-analysis-v1',
      candidates: 'legal-candidates-v1',
      forcedPolicy: 'forced-policy-v1',
      roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
      policy: 'composed-policy-v1',
      scorer: EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      planner: 'planner-off',
      prompt: 'composed-typed-context-v4',
      renderer: 'composed-policy-renderer-v4',
      communication: 'plan-voice-v2',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => {
      let activeReq: DecisionRequest
      let activeView: PlayerView
      const inner = createComposedAgent({
        seed: context.seed,
        roleObjectiveRouter: true,
        scorer: seededGoodProposalVoteScorer,
        publicObserver: true,
        privateIdentity: {
          roleQueries: [],
          hiddenTeam: true,
        },
      })
      return {
        async decide(req, view) {
          activeReq = req
          activeView = view
          return inner.decide(req, view)
        },
        privateTraceSink(trace) {
          context.onDecisionTrace!(degrade(trace, activeReq, activeView))
        },
      }
    },
  }
  const weightedCase = ARCHITECTURE_BANK.find(
    (candidate) =>
      candidate.targetRole === 'oberon'
      && candidate.playerCount === 7,
  )!
  await assert.rejects(
    runArchitectureBench({
      variants: [weightedVariant],
      cases: [weightedCase],
      bankId: 'phase7d2-weighted-atomic-degradation',
    }),
    /trace components do not match declared components/,
  )
})
