import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { assertWallClockBelow } from './helpers/performance-gate.ts'
import {
  assessPublicJointTeams,
  observePublicRecord,
  publicAlignmentMaskHistogram,
} from '../server/agents/analysis/observer.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../server/agents/analysis/role-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
  roleObjectiveIdentityScope,
  validatePrivateRoleObjectiveHostJoin,
  validatePrivateRoleObjectiveSnapshot,
} from '../server/agents/analysis/role-objectives.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
} from '../server/agents/belief/exact.ts'
import {
  projectJointIdentity,
  JOINT_IDENTITY_MODEL_VERSION,
} from '../server/agents/belief/identity.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../server/agents/analysis/observer-types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import { componentPayload } from '../server/agents/components/kernel.ts'
import {
  GOOD_ROLE_OBJECTIVE_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import {
  advanceCognition,
  advanceCognitionFromBelief,
  publicCognition,
} from '../server/agents/cognition/state.ts'
import { legalCandidates } from '../server/agents/policy/candidates.ts'
import { parseStdioDecisionReply } from '../server/agents/stdio.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'
import { createGame } from '../server/engine/game.ts'
import { EVIL_COUNT } from '../server/engine/rules.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'
import { viewFor } from '../server/engine/view.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { architectureReport } from '../server/eval/architecture-report.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { projectPublicRecord } from '../server/agents/communication/public-record.ts'
import type { DecisionTrace } from '../server/agents/trace.ts'

const fixtures = readDecisionFixtures()
const merlinFixture = fixtures.find((fixture) => fixture.view.role === 'merlin')!
const percivalFixture = fixtures.find((fixture) => fixture.view.role === 'percival')!
const servantFixture = fixtures.find((fixture) => fixture.view.role === 'servant')!

const roleObjective = (trace: DecisionTrace) => componentPayload(
  trace.components!,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
)
const roleObjectiveEntry = (trace: DecisionTrace) => trace.components!.entries
  .find((entry) => entry.component.id === GOOD_ROLE_OBJECTIVE_COMPONENT.id)
const removeRoleObjective = (trace: DecisionTrace) => {
  const index = trace.components!.entries.findIndex(
    (entry) => entry.component.id === GOOD_ROLE_OBJECTIVE_COMPONENT.id,
  )
  assert.notEqual(index, -1)
  trace.components!.entries.splice(index, 1)
}
const addRoleObjectiveFrom = (
  target: DecisionTrace,
  source: DecisionTrace,
) => {
  const entry = roleObjectiveEntry(source)
  assert.ok(entry)
  target.components!.entries.push(structuredClone(entry))
}

async function roleOutput(
  fixture: typeof merlinFixture,
  roleObjectives = true,
) {
  return createComposedAgent({
    seed: 'phase7c1-role-objective',
    ...(roleObjectives ? { roleObjectives: true } : {}),
  }).decide(fixture.req, fixture.view)
}

test('Merlin influence uses exact private joint teams and separate exact public teams', async () => {
  const output = await roleOutput(merlinFixture)
  const snapshot = roleObjective(output.trace!)!
  assert.ok(validatePrivateRoleObjectiveSnapshot(snapshot))
  assert.equal(snapshot.role, 'merlin')
  assert.equal(snapshot.objective.role, 'merlin')
  const identity = output.trace!.privateIdentity!
  const hidden = identity.hiddenTeamPosterior!
  const assessment = snapshot.objective.assessments[0]
  const team = assessment.candidate.team!
  const distribution = Array<number>(team.length + 1).fill(0)
  for (const hypothesis of hidden.hypotheses) {
    const evil = team.filter((seat) => hypothesis.evilSeats.includes(seat)).length
    distribution[evil] += hypothesis.probability
  }
  assert.deepEqual(assessment.evilCountDistribution, distribution)
  assert.equal(assessment.teamCleanProbability, distribution[0])
  assert.equal(
    assessment.teamFailureCapabilityProbability,
    distribution.slice(snapshot.request.failsRequired)
      .reduce((sum, probability) => sum + probability, 0),
  )

  const [publicTeam] = assessPublicJointTeams(
    projectPublicRecord(merlinFixture.view),
    [team],
  )
  assert.equal(
    assessment.publicTeamCleanProbability,
    publicTeam.cleanProbability,
  )
  assert.equal(
    assessment.publicProbabilitySemantics,
    'public-preaction-uniform-feasible-joint',
  )
  assert.equal(
    assessment.valueSemantics,
    'bounded-deterministic-indices-not-probabilities',
  )
  assert.ok('assassinExposureProxyIndex' in assessment)
  assert.ok(!('assassinProbability' in assessment))
})

test('Merlin approval extremity distinguishes no-vote sentinel from an observed vote', async () => {
  const fresh = await roleOutput(merlinFixture)
  const afterVoteView = structuredClone(merlinFixture.view)
  const priorLeader = afterVoteView.players.find(
    (player) => player.seat !== afterVoteView.seat,
  )!.seat
  const priorTeam = afterVoteView.players
    .filter((player) => player.seat !== afterVoteView.seat)
    .slice(0, afterVoteView.quests[0].teamSize)
    .map((player) => player.seat)
    .sort((left, right) => left - right)
  afterVoteView.proposalNum = 2
  afterVoteView.proposals = [{
    round: 1,
    proposalNum: 1,
    leader: priorLeader,
    team: priorTeam,
    votes: afterVoteView.players.map((player) => ({
      seat: player.seat,
      vote: 'reject' as const,
    })),
    approved: false,
  }]
  const afterVoteReq: DecisionRequest = {
    ...merlinFixture.req,
    proposalNum: 2,
  }
  const afterVote = await createComposedAgent({
    seed: 'phase7c1-role-objective',
    roleObjectives: true,
  }).decide(afterVoteReq, afterVoteView)
  const freshObjective = roleObjective(fresh.trace!)!.objective
  const afterObjective = roleObjective(afterVote.trace!)!.objective
  assert.equal(freshObjective.role, 'merlin')
  assert.equal(afterObjective.role, 'merlin')
  for (const freshAssessment of freshObjective.assessments) {
    const observedAssessment = afterObjective.assessments.find(
      (candidate) =>
        candidate.candidate.candidateId
          === freshAssessment.candidate.candidateId,
    )!
    assert.ok(
      Math.abs(
        observedAssessment.assassinExposureProxyIndex
          - freshAssessment.assassinExposureProxyIndex
          - 1 / 12,
      ) <= 1e-12,
    )
  }
})

test('Percival pair posterior is a complete-world sum bound to visible candidates', async () => {
  const output = await roleOutput(percivalFixture)
  const snapshot = roleObjective(output.trace!)!
  assert.ok(validatePrivateRoleObjectiveSnapshot(snapshot))
  assert.equal(snapshot.objective.role, 'percival')
  const pair = snapshot.objective.pairPosterior
  assert.equal(pair.includesMorgana, true)
  assert.deepEqual(
    pair.privateCandidateSeats,
    [...percivalFixture.view.privateInfo.merlinCandidates!]
      .sort((left, right) => left - right),
  )
  assert.equal(
    pair.hypotheses.reduce(
      (sum, hypothesis) => sum + hypothesis.probability,
      0,
    ),
    1,
  )
  for (const hypothesis of pair.hypotheses) {
    assert.deepEqual(
      [hypothesis.merlinSeat, hypothesis.morganaSeat!]
        .sort((left, right) => left - right),
      pair.privateCandidateSeats,
    )
  }
  const identityPair = output.trace!.privateIdentity!.rolePosteriors[0]
  assert.deepEqual(
    pair.hypotheses.map((hypothesis) => hypothesis.probability),
    identityPair.hypotheses.map((hypothesis) => hypothesis.probability),
  )
  assert.ok(snapshot.objective.assessments.every(
    (assessment) =>
      assessment.valueSemantics
        === 'bounded-deterministic-indices-not-probabilities'
      && 'merlinMimicryProxyIndex' in assessment
      && 'selfDecoyOpportunityProxyIndex' in assessment,
  ))

  const voteView: PlayerView = {
    ...structuredClone(percivalFixture.view),
    phase: 'vote',
    currentTeam: [
      percivalFixture.view.privateInfo.merlinCandidates![0],
      percivalFixture.view.players.find(
        (player) =>
          !percivalFixture.view.privateInfo.merlinCandidates!.includes(
            player.seat,
          ),
      )!.seat,
    ].sort((left, right) => left - right),
  }
  const voteReq: DecisionRequest = {
    kind: 'vote',
    seat: voteView.seat,
    round: voteView.round,
    proposalNum: voteView.proposalNum,
  }
  const favoredMerlin = percivalFixture.view.privateInfo.merlinCandidates![0]
  const pairWeightedModel = {
    version: 'phase7c1-percival-pair-weighted-v1',
    factorsVersion: 'phase7c1-pair-test-factor-v1',
    infer(view: PlayerView) {
      const exact = exactBelief(view)
      return beliefFromWeightedWorlds(
        view,
        exact.worlds.map((weighted) => ({
          world: weighted.world,
          probability:
            weighted.world.roleBySeat[favoredMerlin] === 'merlin' ? 9 : 1,
        })),
        {
          modelVersion: 'phase7c1-percival-pair-weighted-v1',
          quality: 'weighted',
        },
      )
    },
  }
  const vote = await createComposedAgent({
    seed: 'phase7c1-percival-vote',
    roleObjectives: true,
    beliefModel: pairWeightedModel,
  }).decide(voteReq, voteView)
  const voteObjective = roleObjective(vote.trace!)!.objective
  assert.equal(voteObjective.role, 'percival')
  const approve = voteObjective.assessments.find(
    (assessment) => assessment.candidate.direction === 'support',
  )!
  const reject = voteObjective.assessments.find(
    (assessment) => assessment.candidate.direction === 'oppose',
  )!
  assert.notEqual(approve.pairInfluenceValue, reject.pairInfluenceValue)
  assert.notEqual(
    approve.selfDecoyOpportunityProxyIndex,
    reject.selfDecoyOpportunityProxyIndex,
  )
})

test('Percival without Morgana uses the normal tagged null coordinate', () => {
  const roles: Role[] = [
    'merlin', 'percival', 'servant', 'assassin', 'minion',
  ]
  const game = createGame({
    seed: 'phase7c1-no-morgana',
    playerCount: 5,
    roles,
  })
  const seat = game.players.find((player) => player.role === 'percival')!.seat
  const view: PlayerView = {
    ...viewFor(game, seat),
    leaderSeat: seat,
  }
  const req: DecisionRequest = {
    kind: 'propose',
    seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const belief = exactBelief(view)
  const identity = projectJointIdentity(
    belief,
    roleObjectiveIdentityScope('percival', view.rolesInPlay),
  )
  const observer = observePublicRecord(projectPublicRecord(view))
  const candidates = legalCandidates(req, view)
  const snapshot = buildRoleObjectiveSnapshot({
    req,
    view,
    identity,
    observer,
    candidates,
  })
  assert.equal(snapshot.objective.role, 'percival')
  assert.equal(snapshot.objective.pairPosterior.includesMorgana, false)
  assert.ok(snapshot.objective.pairPosterior.hypotheses.every(
    (hypothesis) => hypothesis.morganaSeat === null,
  ))
  assert.ok(snapshot.objective.assessments.every(
    (assessment) =>
      assessment.morganaOnTeamProbability === 0
      && assessment.publicMorganaOnTeamProbability === 0,
  ))
  assert.ok(
    new Set(snapshot.objective.assessments.map(
      (assessment) => assessment.selfDecoyOpportunityProxyIndex,
    )).size > 1,
  )
  assert.deepEqual(
    snapshot.objective.pairPosterior.privateCandidateSeats,
    view.privateInfo.merlinCandidates,
  )
  assert.ok(validatePrivateRoleObjectiveHostJoin(snapshot, {
    req,
    view,
    identity,
    observer,
    candidates,
  }))
})

test('role objectives are opt-in, role-gated, deterministic, and mechanically inert', async () => {
  for (const fixture of [merlinFixture, percivalFixture]) {
    const off = await roleOutput(fixture, false)
    const first = await roleOutput(fixture)
    const second = await roleOutput(fixture)
    assert.deepEqual(first.decision, off.decision)
    assert.deepEqual(second, first)
    assert.equal(roleObjective(off.trace!), undefined)
    assert.equal(roleObjective(first.trace!)?.version, ROLE_OBJECTIVE_MODEL_VERSION)
  }

  const offServant = await roleOutput(servantFixture, false)
  const optedServant = await roleOutput(servantFixture, true)
  const offLegacy = structuredClone(offServant)
  const optedLegacy = structuredClone(optedServant)
  delete offLegacy.trace!.components
  delete optedLegacy.trace!.components
  delete offLegacy.trace!.componentPlan
  delete optedLegacy.trace!.componentPlan
  delete offLegacy.trace!.componentVersions!.decisionComponents
  delete optedLegacy.trace!.componentVersions!.decisionComponents
  delete offLegacy.trace!.architectureIdentityDigest
  delete optedLegacy.trace!.architectureIdentityDigest
  offLegacy.trace!.version = 'decision-trace-v1'
  optedLegacy.trace!.version = 'decision-trace-v1'
  assert.deepEqual(optedLegacy, offLegacy)
  assert.equal(roleObjective(optedServant.trace!), undefined)
  assert.equal(optedServant.trace!.componentVersions!.roleObjective, undefined)

  const renamedView = structuredClone(merlinFixture.view)
  renamedView.name = 'Renamed Merlin'
  renamedView.players = renamedView.players.map((player) => ({
    ...player,
    name: `Renamed ${player.seat}`,
  }))
  const renamed = await createComposedAgent({
    seed: 'phase7c1-role-objective',
    roleObjectives: true,
  }).decide(merlinFixture.req, renamedView)
  assert.deepEqual(
    roleObjective(renamed.trace!),
    roleObjective((await roleOutput(merlinFixture)).trace!),
  )

  const questView: PlayerView = {
    ...structuredClone(merlinFixture.view),
    phase: 'quest',
    currentTeam: [
      merlinFixture.view.seat,
      merlinFixture.view.players.find(
        (player) => player.seat !== merlinFixture.view.seat,
      )!.seat,
    ].sort((left, right) => left - right),
  }
  const questReq: DecisionRequest = {
    kind: 'quest',
    seat: questView.seat,
    round: questView.round,
    proposalNum: questView.proposalNum,
  }
  const quest = await createComposedAgent({
    seed: 'phase7c1-quest-not-applicable',
    roleObjectives: true,
  }).decide(questReq, questView)
  assert.equal(roleObjective(quest.trace!)!.role, 'merlin')
  assert.deepEqual(roleObjective(quest.trace!)!.objective.assessments, [])
})

test('private posterior weights causally change influence while public exposure inputs stay fixed', async () => {
  const game = createGame({
    seed: 'phase7c1-weighted-merlin',
    playerCount: 9,
  })
  const seat = game.players.find((player) => player.role === 'merlin')!.seat
  const view: PlayerView = { ...viewFor(game, seat), leaderSeat: seat }
  const req: DecisionRequest = {
    kind: 'propose',
    seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const base = await createComposedAgent({
    seed: 'phase7c1-role-objective-weighted',
    roleObjectives: true,
  }).decide(req, view)
  const baseMerlin = roleObjective(base.trace!)!.objective
  assert.equal(baseMerlin.role, 'merlin')
  const targetTeam = baseMerlin.assessments.find(
    (assessment) =>
      assessment.teamCleanProbability > 0
      && assessment.teamCleanProbability < 1,
  )!.candidate.team!
  const weightedModel = {
    version: 'phase7c1-weighted-test-v1',
    factorsVersion: 'phase7c1-test-factor-v1',
    infer(view: PlayerView) {
      const exact = exactBelief(view)
      return beliefFromWeightedWorlds(
        view,
        exact.worlds.map((weighted) => ({
          world: weighted.world,
          probability: targetTeam.every(
            (seat) => weighted.world.alignmentBySeat[seat] === 'good',
          ) ? 9 : 1,
        })),
        {
          modelVersion: 'phase7c1-weighted-test-v1',
          quality: 'weighted',
          provenance: [{
            factorId: 'phase7c1-test',
            factorVersion: 'phase7c1-test-factor-v1',
            evidenceIds: ['test:public'],
            logLikelihoodCap: Math.log(9),
            minLogLikelihood: 0,
            maxLogLikelihood: Math.log(9),
          }],
        },
      )
    },
  }
  const weighted = await createComposedAgent({
    seed: 'phase7c1-role-objective-weighted',
    roleObjectives: true,
    beliefModel: weightedModel,
  }).decide(req, view)
  const baseObjective = roleObjective(base.trace!)!
  const weightedObjective = roleObjective(weighted.trace!)!
  assert.equal(baseObjective.objective.role, 'merlin')
  assert.equal(weightedObjective.objective.role, 'merlin')
  const changed = weightedObjective.objective.assessments.find(
    (assessment) =>
      assessment.teamCleanProbability
      !== baseObjective.objective.assessments.find(
        (candidate) =>
          candidate.candidate.candidateId
            === assessment.candidate.candidateId,
      )!.teamCleanProbability,
  )!
  const original = baseObjective.objective.assessments.find(
    (assessment) =>
      assessment.candidate.candidateId === changed.candidate.candidateId,
  )!
  assert.notEqual(changed.teamCleanProbability, original.teamCleanProbability)
  assert.equal(
    changed.publicTeamCleanProbability,
    original.publicTeamCleanProbability,
  )
  assert.equal(
    weightedObjective.source.beliefModelVersion,
    weightedModel.version,
  )
  assert.equal(weighted.trace!.beliefProvenance![0].factorId, 'phase7c1-test')
})

test('host join rejects forged candidates, private candidates, sources, and arithmetic', async () => {
  const output = await roleOutput(percivalFixture)
  const trace = output.trace!
  const authority = {
    req: percivalFixture.req,
    view: percivalFixture.view,
    identity: trace.privateIdentity!,
    observer: trace.publicObserver!,
    candidates: legalCandidates(percivalFixture.req, percivalFixture.view),
  }
  assert.ok(validatePrivateRoleObjectiveHostJoin(
    roleObjective(trace),
    authority,
  ))
  for (const mutate of [
    (copy: NonNullable<ReturnType<typeof roleObjective>>) => {
      copy.source.beliefThroughSeq += 1
    },
    (copy: NonNullable<ReturnType<typeof roleObjective>>) => {
      copy.objective.assessments[0].candidate.candidateId += ':forged'
    },
    (copy: NonNullable<ReturnType<typeof roleObjective>>) => {
      if (copy.objective.role === 'percival') {
        copy.objective.pairPosterior.privateCandidateSeats = [0, 1]
      }
    },
    (copy: NonNullable<ReturnType<typeof roleObjective>>) => {
      copy.objective.assessments[0].pairInfluenceValue = 0.123
    },
  ]) {
    const copy = structuredClone(roleObjective(trace)!)
    mutate(copy)
    assert.equal(validatePrivateRoleObjectiveHostJoin(copy, authority), false)
  }
})

test('external validator rejects sparse, expanded, unsafe, nonfinite, oversized, and forged shapes', async () => {
  const valid = roleObjective((await roleOutput(merlinFixture)).trace!)!
  const malformed: unknown[] = []
  const sparse = structuredClone(valid)
  sparse.objective.assessments = Array(1)
  malformed.push(sparse)
  const expanded = structuredClone(valid)
  Object.assign(expanded.objective.assessments, { forged: true })
  malformed.push(expanded)
  const unsafe = structuredClone(valid)
  unsafe.request.seat = Number.MAX_SAFE_INTEGER + 1
  malformed.push(unsafe)
  const nonfinite = structuredClone(valid)
  nonfinite.objective.assessments[0].teamCleanProbability = Number.NaN
  malformed.push(nonfinite)
  const version = structuredClone(valid)
  ;(version as { version: string }).version = 'forged-v1'
  malformed.push(version)
  const oversized = structuredClone(valid)
  oversized.source.beliefModelVersion = 'x'.repeat(1_100_000)
  malformed.push(oversized)
  const hiddenToJson = structuredClone(valid)
  Object.defineProperty(hiddenToJson, 'toJSON', {
    value: () => ({ forged: true }),
    enumerable: false,
  })
  malformed.push(hiddenToJson)
  const inheritedToJson = Object.assign(
    Object.create({ toJSON: () => ({ forged: true }) }),
    structuredClone(valid),
  )
  malformed.push(inheritedToJson)
  const accessor = structuredClone(valid)
  let getterCalled = false
  Object.defineProperty(accessor.source, 'beliefModelVersion', {
    enumerable: true,
    get() {
      getterCalled = true
      return 'forged'
    },
  })
  malformed.push(accessor)
  const symbol = structuredClone(valid)
  Object.defineProperty(symbol.objective, Symbol('forged'), {
    value: true,
    enumerable: true,
  })
  malformed.push(symbol)
  const cycle = structuredClone(valid) as typeof valid & { cycle?: unknown }
  cycle.cycle = cycle
  malformed.push(cycle)
  for (const candidate of malformed) {
    assert.doesNotThrow(() => {
      assert.equal(validatePrivateRoleObjectiveSnapshot(candidate), false)
    })
  }
  assert.equal(getterCalled, false)
})

test('role objective degradation is typed and stale cognition is dropped before recomputation', async () => {
  const degraded = await createComposedAgent({
    seed: 'phase7c1-degraded',
    roleObjectives: true,
    privateIdentity: {
      roleQueries: [{ roles: ['merlin', 'merlin'] }],
      hiddenTeam: false,
    },
  }).decide(merlinFixture.req, merlinFixture.view)
  assert.equal(roleObjective(degraded.trace!), undefined)
  assert.ok(degraded.trace!.degradation.includes('identity-projection-failed'))
  assert.equal(roleObjectiveEntry(degraded.trace!)?.status, 'degraded')
  assert.equal(
    roleObjectiveEntry(degraded.trace!)?.status === 'degraded'
      ? roleObjectiveEntry(degraded.trace!)!.degradationCode
      : undefined,
    ROLE_OBJECTIVE_DEGRADATION,
  )

  const active = await roleOutput(merlinFixture)
  const base = advanceCognition(undefined, merlinFixture.view)
  const earlier = {
    ...base,
    roleObjective: structuredClone(roleObjective(active.trace!)!),
    versions: {
      ...base.versions,
      roleObjective: ROLE_OBJECTIVE_MODEL_VERSION,
    },
  }
  const advanced = advanceCognitionFromBelief(
    earlier,
    merlinFixture.view,
    {
      belief: exactBelief(merlinFixture.view),
      mechanicalBelief: base.versions.mechanicalBelief,
      beliefPipeline: base.versions.beliefPipeline,
      languageEvidence: base.versions.languageEvidence,
    },
  )
  assert.equal(advanced.roleObjective, undefined)
  assert.equal(advanced.versions.roleObjective, undefined)
})

test('stdio and private/public boundaries preserve role objective attribution', async () => {
  const merlin = await roleOutput(merlinFixture)
  assert.deepEqual(
    parseStdioDecisionReply(
      merlinFixture.req,
      merlin,
      'external',
      merlinFixture.view,
    ),
    merlin,
  )
  const forged = structuredClone(merlin)
  roleObjective(forged.trace!)!.objective.assessments[0]
    .publicTeamCleanProbability = 0
  assert.deepEqual(
    parseStdioDecisionReply(
      merlinFixture.req,
      forged,
      'external',
      merlinFixture.view,
    ),
    forged.decision,
  )
  const hiddenAsDegraded = structuredClone(merlin)
  removeRoleObjective(hiddenAsDegraded.trace!)
  hiddenAsDegraded.trace!.degradation.push(ROLE_OBJECTIVE_DEGRADATION)
  assert.deepEqual(
    parseStdioDecisionReply(
      merlinFixture.req,
      hiddenAsDegraded,
      'external',
      merlinFixture.view,
    ),
    hiddenAsDegraded.decision,
  )
  const dependencyDegraded = await createComposedAgent({
    seed: 'phase7c1-stdio-degraded',
    roleObjectives: true,
    privateIdentity: {
      roleQueries: [{ roles: ['merlin', 'merlin'] }],
      hiddenTeam: false,
    },
  }).decide(merlinFixture.req, merlinFixture.view)
  assert.equal(
    dependencyDegraded.trace!.componentVersions!.identityModel,
    JOINT_IDENTITY_MODEL_VERSION,
  )
  assert.equal(
    dependencyDegraded.trace!.componentVersions!.observerModel,
    PUBLIC_OBSERVER_MODEL_VERSION,
  )
  assert.deepEqual(
    parseStdioDecisionReply(
      merlinFixture.req,
      dependencyDegraded,
      'external',
      merlinFixture.view,
    ),
    dependencyDegraded,
  )
  for (const dependency of ['identityModel', 'observerModel'] as const) {
    const missingDependencyVersion = structuredClone(dependencyDegraded)
    delete missingDependencyVersion.trace!.componentVersions![dependency]
    assert.deepEqual(
      parseStdioDecisionReply(
        merlinFixture.req,
        missingDependencyVersion,
        'external',
        merlinFixture.view,
      ),
      dependency === 'identityModel'
        ? missingDependencyVersion
        : missingDependencyVersion.decision,
    )
  }

  const servant = await roleOutput(servantFixture)
  const roleForged = structuredClone(servant)
  addRoleObjectiveFrom(roleForged.trace!, merlin.trace!)
  roleForged.trace!.degradation.push(ROLE_OBJECTIVE_DEGRADATION)
  assert.deepEqual(
    parseStdioDecisionReply(
      servantFixture.req,
      roleForged,
      'external',
      servantFixture.view,
    ),
    roleForged.decision,
  )

  const baseCognition = advanceCognition(undefined, merlinFixture.view)
  const privateCognition = {
    ...baseCognition,
    roleObjective: structuredClone(roleObjective(merlin.trace!)!),
    versions: {
      ...baseCognition.versions,
      roleObjective: ROLE_OBJECTIVE_MODEL_VERSION,
    },
  }
  assert.doesNotMatch(JSON.stringify(merlinFixture.view), /roleObjective/)
  assert.doesNotMatch(
    JSON.stringify(publicCognition(privateCognition)),
    /roleObjective/,
  )
  for (const owner of [
    'server/agents/prompts.ts',
    'server/agents/communication/composed-renderer.ts',
    'server/agents/communication/planner-voice-adapter.ts',
    'client/src/App.tsx',
  ]) {
    assert.doesNotMatch(
      readFileSync(owner, 'utf8'),
      /privateRoleObjective|ROLE_OBJECTIVE_MODEL_VERSION/,
    )
  }
})

function roleObjectiveVariant(): ArchitectureVariant {
  return {
    id: 'phase7c1-role-objective',
    paid: false,
    components: {
      mode: 'compatibility',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      identityModel: 'joint-identity-projection-v1',
      roleObjective: ROLE_OBJECTIVE_MODEL_VERSION,
      policy: 'composed-policy-v1',
      scorer: 'compatibility-scorer-v1',
      planner: 'planner-off',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: false,
      },
      roleObjectives: true,
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
}

test('artifact and architecture admission distinguish configured from applicable role objectives', async () => {
  const artifacts = await runArchitectureBench({
    variants: [roleObjectiveVariant()],
    cases: ARCHITECTURE_BANK,
    bankId: 'phase7c1-role-objective',
  })
  assert.equal(artifacts.length, ARCHITECTURE_BANK.length)
  const report = architectureReport(artifacts)
  assert.ok(report.variants.every(
    (variant) => variant.safety.traceAttributionViolations === 0,
  ))
  for (const artifact of artifacts) {
    assert.deepEqual(
      artifact.strategyVersions?.roleObjectives,
      [ROLE_OBJECTIVE_MODEL_VERSION],
    )
    const applicable =
      artifact.architecture!.targetRole === 'merlin'
      || artifact.architecture!.targetRole === 'percival'
    for (const trace of artifact.decisionTraces!) {
      assert.equal(roleObjective(trace) !== undefined, applicable)
      assert.equal(
        trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION),
        false,
      )
    }
  }

  const artifact = artifacts[0]
  const noTraces = structuredClone(artifact)
  delete noTraces.decisionTraces
  assert.ok(
    architectureReport([noTraces]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const noManifest = structuredClone(artifact)
  delete noManifest.strategyVersions!.roleObjectives
  const descriptorOwned = architectureReport([noManifest]).variants[0]
  assert.equal(descriptorOwned.safety.traceAttributionViolations, 0)
  assert.equal(descriptorOwned.safety.promotionEvidenceEligible, true)
  const forged = structuredClone(artifact)
  roleObjective(forged.decisionTraces![0])!.request.round += 1
  assert.ok(
    architectureReport([forged]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const hiddenAsDegraded = structuredClone(artifact)
  removeRoleObjective(hiddenAsDegraded.decisionTraces![0])
  hiddenAsDegraded.decisionTraces![0].degradation.push(
    ROLE_OBJECTIVE_DEGRADATION,
  )
  assert.ok(
    architectureReport([hiddenAsDegraded]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const servant = artifacts.find(
    (candidate) => candidate.architecture!.targetRole === 'servant',
  )!
  for (const forge of [
    (candidate: typeof servant) => {
      addRoleObjectiveFrom(
        candidate.decisionTraces![0],
        artifact.decisionTraces![0],
      )
    },
    (candidate: typeof servant) => {
      candidate.decisionTraces![0].componentPlan!.configured.push(structuredClone(
        artifact.decisionTraces![0].componentPlan!.configured.find(
          (entry) => entry.id === GOOD_ROLE_OBJECTIVE_COMPONENT.id,
        )!,
      ))
    },
    (candidate: typeof servant) => {
      candidate.decisionTraces![0].degradation.push(
        ROLE_OBJECTIVE_DEGRADATION,
      )
    },
  ]) {
    const forgedIneligible = structuredClone(servant)
    forge(forgedIneligible)
    assert.ok(
      architectureReport([forgedIneligible]).variants[0]
        .safety.traceAttributionViolations > 0,
    )
  }
})

test('5-10 player exact public joint surfaces stay bounded and deterministic', () => {
  let slowest = 0
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    const game = createGame({
      seed: `phase7c1-bounds-${playerCount}`,
      playerCount,
    })
    const view = viewFor(game, 0)
    const teamSize = view.quests[0].teamSize
    const teams: number[][] = []
    const visit = (start: number, team: number[]): void => {
      if (team.length === teamSize) {
        teams.push([...team])
        return
      }
      for (let seat = start; seat < playerCount; seat++) {
        team.push(seat)
        visit(seat + 1, team)
        team.pop()
      }
    }
    visit(0, [])
    const record = projectPublicRecord(view)
    const observer = observePublicRecord(record)
    const histogram = publicAlignmentMaskHistogram(record)
    assert.equal(
      histogram.reduce((sum, entry) => sum + entry.count, 0),
      observer.feasibleWorldCount,
    )
    if (playerCount === 10) {
      const choose = (n: number, k: number): number => {
        let result = 1
        for (let index = 1; index <= k; index++) {
          result = result * (n - k + index) / index
        }
        return result
      }
      assert.ok(
        histogram.length <= choose(playerCount, EVIL_COUNT[playerCount]),
      )
    }
    const started = performance.now()
    const first = assessPublicJointTeams(record, teams)
    slowest = Math.max(slowest, performance.now() - started)
    assert.deepEqual(assessPublicJointTeams(record, teams), first)
    assert.ok(first.length <= 252)
    assert.ok(JSON.stringify(first).length < 250_000)
  }
  assertWallClockBelow(
    slowest,
    5_000,
    `slowest public joint surface ${slowest.toFixed(1)}ms`,
  )
})

test('10-player quest-four Merlin and Percival snapshots fit the 252-candidate bound', async () => {
  const game = createGame({
    seed: 'phase7c1-10p-role-surface',
    playerCount: 10,
  })
  for (const role of ['merlin', 'percival'] as const) {
    const seat = game.players.find((player) => player.role === role)!.seat
    const view: PlayerView = {
      ...viewFor(game, seat),
      phase: 'proposal',
      round: 4,
      proposalNum: 1,
      leaderSeat: seat,
    }
    const req: DecisionRequest = {
      kind: 'propose',
      seat,
      round: 4,
      proposalNum: 1,
    }
    const started = performance.now()
    const output = await createComposedAgent({
      seed: `phase7c1-10p-${role}`,
      roleObjectives: true,
    }).decide(req, view)
    const elapsed = performance.now() - started
    const snapshot = roleObjective(output.trace!)!
    assert.equal(snapshot.objective.assessments.length, 252)
    assert.ok(validatePrivateRoleObjectiveSnapshot(snapshot))
    assert.ok(JSON.stringify(snapshot).length < 1_048_576)
    assertWallClockBelow(
      elapsed,
      5_000,
      `${role} 10p surface took ${elapsed.toFixed(1)}ms`,
    )
  }
})
