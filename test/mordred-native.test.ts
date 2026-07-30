// Migration phase 7E2A; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { assertWallClockBelow } from './helpers/performance-gate.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  componentPayload,
  componentEnvelope,
  decisionComponentPlan,
  publicDecisionComponentRun,
  runDecisionComponents,
  validateDecisionComponentRunHostJoin,
} from '../server/agents/components/kernel.ts'
import {
  MORDRED_BLINDNESS_COMPONENT,
  ACTOR_TARGET_TREATMENT_COMPONENT,
} from '../server/agents/components/native-role-components.ts'
import {
  createProductionComponentRegistry,
} from '../server/agents/components/production-registry.ts'
import {
  createDecisionComponentRegistry,
} from '../server/agents/components/registry.ts'
import {
  PRIVATE_PUBLIC_OBSERVER_INPUT,
} from '../server/agents/components/native-score-components.ts'
import {
  projectPrivateResolvedComposedBrainCompatibility,
  projectResolvedArchitectureIdentity,
  resolveComposedBrain,
} from '../server/agents/components/resolved-brain.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'
import type {
  ComponentHostInputDefinition,
  ComponentHostInputToken,
  ComponentToken,
  DecisionComponentDefinition,
} from '../server/agents/components/types.ts'
import {
  observePublicRecord,
} from '../server/agents/analysis/observer.ts'
import {
  buildPrivateMordredBlindnessObjective,
  validatePrivateMordredBlindnessHostJoin,
  validatePrivateMordredBlindnessObjective,
} from '../server/agents/analysis/mordred-blindness.ts'
import {
  buildPrivateActorTargetTreatmentRead,
  validatePrivateActorTargetTreatmentRead,
} from '../server/agents/analysis/actor-target-treatment.ts'
import {
  MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
} from '../server/agents/analysis/actor-target-treatment-types.ts'
import {
  MAX_MORDRED_BLINDNESS_ASSESSMENTS,
} from '../server/agents/analysis/mordred-blindness-types.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
} from '../server/agents/belief/exact.ts'
import { projectPublicRecord } from '../server/agents/communication/public-record.ts'
import { legalCandidates } from '../server/agents/policy/candidates.ts'
import {
  admitDecisionTrace,
} from '../server/agents/admission/composed-trace.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import {
  architectureReport,
  renderArchitectureReport,
} from '../server/eval/architecture-report.ts'
import {
  rotatePlayerView,
} from './support/player-view-metamorphic.ts'
import { DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES } from '../server/agents/components/canonical-json.ts'

const ROLES: Record<number, Role[]> = {
  5: ['merlin', 'servant', 'servant', 'assassin', 'mordred'],
  6: ['merlin', 'percival', 'servant', 'servant', 'assassin', 'mordred'],
  7: [
    'merlin', 'percival', 'servant', 'servant',
    'assassin', 'mordred', 'minion',
  ],
  8: [
    'merlin', 'percival', 'servant', 'servant', 'servant',
    'assassin', 'mordred', 'minion',
  ],
  9: [
    'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
    'assassin', 'morgana', 'mordred',
  ],
  10: [
    'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
    'assassin', 'morgana', 'mordred', 'oberon',
  ],
}

function mordredProposal(
  playerCount = 9,
  round = 1,
): {
  game: ReturnType<typeof createGame>
  view: PlayerView
  req: DecisionRequest
} {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const game = createGame({
      seed: `phase7e2a-${playerCount}-${round}-${attempt}`,
      playerCount,
      roles: ROLES[playerCount],
    })
    const mordred = game.players.find(
      (player) => player.role === 'mordred',
    )!
    if (mordred.seat !== game.leaderSeat) continue
    const view = viewFor(game, mordred.seat)
    view.round = round
    view.proposalNum = 1
    view.phase = 'proposal'
    return {
      game,
      view,
      req: {
        kind: 'propose',
        seat: mordred.seat,
        round,
        proposalNum: 1,
      },
    }
  }
  throw new Error('could not find Mordred proposal fixture')
}

function nativeAgent(
  seed: string,
  extra: Parameters<typeof createComposedAgent>[0] = { seed },
) {
  return createComposedAgent({
    ...extra,
    seed,
    decisionComponents: [MORDRED_BLINDNESS_COMPONENT],
  })
}

test('native Mordred graph is private, inert, exact, and host-admitted', async () => {
  const input = mordredProposal()
  const baseline = await createComposedAgent({
    seed: input.game.seed,
  }).decide(input.req, input.view)
  const agent = nativeAgent(input.game.seed)
  const output = await agent.decide(input.req, input.view)
  const trace = output.trace!
  const plan = decisionComponentPlan(agent.resolvedBrain())
  assert.deepEqual(
    plan.configured.map((component) => component.id),
    [ACTOR_TARGET_TREATMENT_COMPONENT.id, MORDRED_BLINDNESS_COMPONENT.id],
  )
  assert.equal(
    agent.resolvedBrain().description.base.observerModel,
    'exact-public-observer-v1',
  )
  assert.equal(
    projectPrivateResolvedComposedBrainCompatibility(
      agent.resolvedBrain().description,
    ).baseComponentVersions.observerModel,
    'exact-public-observer-v1',
  )
  assert.equal(
    trace.componentVersions?.observerModel,
    'exact-public-observer-v1',
  )
  assert.deepEqual(output.decision, baseline.decision)
  assert.deepEqual(trace.candidateScores, baseline.trace!.candidateScores)
  const treatment = componentPayload(
    trace.components!,
    ACTOR_TARGET_TREATMENT_COMPONENT,
  )!
  const objective = componentPayload(
    trace.components!,
    MORDRED_BLINDNESS_COMPONENT,
  )!
  assert.ok(validatePrivateActorTargetTreatmentRead(treatment))
  assert.ok(validatePrivateMordredBlindnessObjective(objective))
  for (const component of plan.configured) {
    const entry = trace.components!.entries.find(
      (candidate) => candidate.component.id === component.id,
    )!
    assert.equal(entry.status, 'admitted')
    if (entry.status !== 'admitted') throw new Error('expected admission')
    assert.equal(entry.verification, 'exact')
    assert.equal(entry.promotionEligible, true)
    assert.equal(
      trace.components!.policyUse.find(
        (candidate) => candidate.component.id === component.id,
      )!.used,
      false,
    )
  }
  assert.deepEqual(publicDecisionComponentRun(trace.components!), {
    version: trace.components!.version,
    configured: [],
    entries: [],
    policyUse: [],
  })
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace,
    req: input.req,
    view: input.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: input.game.seed,
    expectedComponentPlan: plan,
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
    expectComponentTrace: true,
  }).kind, 'trusted-exact')
  assert.equal(
    (trace as unknown as Record<string, unknown>).mordredBlindness,
    undefined,
  )
  assert.doesNotMatch(
    JSON.stringify(trace.componentVersions),
    /mordred/i,
  )
})

test('hand-worked worlds expose blindness separately from public treatment', () => {
  const input = mordredProposal()
  const record = projectPublicRecord(input.view)
  const observer = observePublicRecord(record)
  const treatment = buildPrivateActorTargetTreatmentRead(record, observer)
  const belief = exactBelief(input.view)
  const objective = buildPrivateMordredBlindnessObjective({
    req: input.req,
    view: input.view,
    belief,
    treatment,
    candidates: legalCandidates(input.req, input.view),
  })
  const visiblePartners = new Set(input.view.privateInfo.evilPartners ?? [])
  const selfTeam = objective.assessments.find(
    (assessment) =>
      assessment.team.seats.includes(input.view.seat)
      && assessment.team.seats.every(
        (seat) => seat === input.view.seat || !visiblePartners.has(seat),
      ),
  )!
  const otherTeam = objective.assessments.find(
    (assessment) => !assessment.team.seats.includes(input.view.seat),
  )!
  assert.equal(selfTeam.merlinBlindWindowProbability, 1)
  assert.equal(selfTeam.hiddenThresholdCrossingProbability, 1)
  assert.equal(selfTeam.treatmentObservationAvailable, false)
  assert.equal(selfTeam.anomalousBlindWindowMass, 0)
  assert.ok(Math.abs(selfTeam.opportunityValue - 0.75) < 1e-12)
  assert.equal(otherTeam.merlinBlindWindowProbability, 0)
  assert.equal(otherTeam.hiddenThresholdCrossingProbability, 0)
  assert.equal(otherTeam.opportunityValue, 0)
  assert.equal(
    selfTeam.jointSemantics,
    'direct-joint-world-sums-no-marginal-products',
  )
  assert.equal(
    selfTeam.policySemantics,
    'team-opportunity-not-action-utility',
  )
})

test('two-Fail threshold and anomalous treatment use direct joint worlds', () => {
  const input = mordredProposal(9, 4)
  const visiblePartner = input.view.privateInfo.evilPartners![0]
  const filler = input.view.players
    .map((player) => player.seat)
    .filter(
      (seat) =>
        seat !== input.view.seat
        && !input.view.privateInfo.evilPartners!.includes(seat),
    )
    .slice(0, 3)
  const team = [
    input.view.seat,
    visiblePartner,
    ...filler,
  ].sort((left, right) => left - right)
  const merlin = input.game.players.find(
    (player) => player.role === 'merlin',
  )!.seat
  input.view.quests[0] = {
    ...input.view.quests[0],
    team: [input.view.seat, filler[0]].sort((a, b) => a - b),
    result: 'success',
    failCount: 0,
  }
  input.view.proposals = [{
    round: 1,
    proposalNum: 1,
    leader: merlin,
    team: [...input.view.quests[0].team!],
    votes: [],
    approved: true,
  }]
  const observer = observePublicRecord(projectPublicRecord(input.view))
  const treatment = buildPrivateActorTargetTreatmentRead(
    projectPublicRecord(input.view),
    observer,
  )
  const objective = buildPrivateMordredBlindnessObjective({
    req: input.req,
    view: input.view,
    belief: exactBelief(input.view),
    treatment,
    candidates: legalCandidates(input.req, input.view),
  })
  const assessment = objective.assessments.find(
    (candidate) =>
      candidate.team.seats.length === team.length
      && candidate.team.seats.every((seat, index) => seat === team[index]),
  )!
  assert.ok(Math.abs(assessment.merlinBlindWindowProbability - 1) < 1e-12)
  assert.ok(
    Math.abs(assessment.hiddenThresholdCrossingProbability - 1) < 1e-12,
  )
  const actualMerlin = objective.merlinHypotheses.find(
    (hypothesis) => hypothesis.seat === merlin,
  )!
  assert.ok(actualMerlin.worldMass > 0)
  assert.ok(actualMerlin.observationCoverageMass > 0)
  assert.equal(actualMerlin.conditionalAnomalousTreatmentIndex, 1)
  assert.ok(assessment.anomalousBlindWindowMass > 0)
  const selfOnly = objective.assessments.find(
    (candidate) =>
      candidate.team.seats.includes(input.view.seat)
      && candidate.team.seats.every(
        (seat) =>
          seat === input.view.seat
          || !input.view.privateInfo.evilPartners!.includes(seat),
      ),
  )!
  assert.equal(selfOnly.merlinBlindWindowProbability, 1)
  assert.equal(selfOnly.hiddenThresholdCrossingProbability, 0)
})

test('native applicability distinguishes role, cast, and decision kind', () => {
  const input = mordredProposal()
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const treatment = registry.definition(ACTOR_TARGET_TREATMENT_COMPONENT)!
  const objective = registry.definition(MORDRED_BLINDNESS_COMPONENT)!
  const context = (
    view: PlayerView,
    req: DecisionRequest,
  ) => ({
    privacy: 'private' as const,
    view,
    request: req,
  })
  assert.equal(objective.applies(context(input.view, input.req)), true)
  assert.equal(treatment.applies(context(input.view, input.req)), true)

  const servant = structuredClone(input.view)
  servant.role = 'servant'
  servant.alignment = 'good'
  servant.privateInfo = {}
  assert.equal(objective.applies(context(servant, input.req)), false)
  assert.equal(treatment.applies(context(servant, input.req)), true)

  const noMerlin = structuredClone(input.view)
  noMerlin.rolesInPlay = noMerlin.rolesInPlay.map(
    (role) => role === 'merlin' ? 'servant' : role,
  )
  assert.equal(objective.applies(context(noMerlin, input.req)), false)

  const discuss: DecisionRequest = { ...input.req, kind: 'discuss' }
  assert.equal(objective.applies(context(input.view, discuss)), false)
  assert.equal(treatment.applies(context(input.view, discuss)), false)

  const observer = observePublicRecord(projectPublicRecord(input.view))
  const payload = buildPrivateMordredBlindnessObjective({
    req: input.req,
    view: input.view,
    belief: exactBelief(input.view),
    treatment: buildPrivateActorTargetTreatmentRead(
      projectPublicRecord(input.view),
      observer,
    ),
    candidates: legalCandidates(input.req, input.view),
  })
  const forged = structuredClone(payload)
  forged.source.rolesInPlay = forged.source.rolesInPlay.map(
    (role) => role === 'merlin' ? 'servant' : role,
  )
  assert.equal(validatePrivateMordredBlindnessObjective(forged), false)
})

test('vote payload has one team opportunity and no approve/reject utility', () => {
  const input = mordredProposal()
  const proposalCandidates = legalCandidates(input.req, input.view)
  const team = (proposalCandidates[0].decision as {
    kind: 'propose'
    team: number[]
  }).team
  const view = structuredClone(input.view)
  view.phase = 'vote'
  view.currentTeam = team
  const req: DecisionRequest = { ...input.req, kind: 'vote' }
  const observer = observePublicRecord(projectPublicRecord(view))
  const treatment = buildPrivateActorTargetTreatmentRead(
    projectPublicRecord(view),
    observer,
  )
  const objective = buildPrivateMordredBlindnessObjective({
    req,
    view,
    belief: exactBelief(view),
    treatment,
    candidates: legalCandidates(req, view),
  })
  assert.equal(objective.assessments.length, 1)
  assert.equal(objective.assessments[0].team.requestContext, 'vote')
  assert.equal(
    JSON.stringify(objective.assessments[0]).match(/approve|reject/g),
    null,
  )
})

test('weighted beliefs remain structural and cannot become promotion evidence', async () => {
  const input = mordredProposal()
  const weightedModel = {
    version: 'phase7e2a-weighted-v1',
    factorsVersion: 'phase7e2a-weight-v1',
    infer(view: PlayerView) {
      const base = exactBelief(view)
      return beliefFromWeightedWorlds(
        view,
        base.worlds.map((entry, index) => ({
          world: entry.world,
          probability: index === 0 ? 10 : 1,
        })),
        {
          modelVersion: 'phase7e2a-weighted-v1',
          quality: 'weighted',
          provenance: [{
            factorId: 'phase7e2a-weight',
            factorVersion: 'phase7e2a-weight-v1',
            evidenceIds: ['fixture'],
            logLikelihoodCap: 1,
            minLogLikelihood: 0,
            maxLogLikelihood: 1,
          }],
        },
      )
    },
  }
  const agent = nativeAgent(input.game.seed, {
    seed: input.game.seed,
    beliefModel: weightedModel,
  })
  const output = await agent.decide(input.req, input.view)
  const objective = output.trace!.components!.entries.find(
    (entry) => entry.component.id === MORDRED_BLINDNESS_COMPONENT.id,
  )!
  assert.equal(objective.status, 'admitted')
  if (objective.status !== 'admitted') throw new Error('expected admission')
  assert.equal(objective.verification, 'structural')
  assert.equal(objective.promotionEligible, false)
  const weightedAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace!,
    req: input.req,
    view: input.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: input.game.seed,
    expectedComponentPlan: decisionComponentPlan(agent.resolvedBrain()),
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
    expectComponentTrace: true,
  })
  assert.equal(weightedAdmission.kind, 'trusted-exact')
  assert.equal(weightedAdmission.promotionEvidenceEligible, false)
})

test('public treatment and weighted joint worlds change only their owned terms', () => {
  const input = mordredProposal()
  const openingBelief = exactBelief(input.view)
  const openingObserver = observePublicRecord(
    projectPublicRecord(input.view),
  )
  const opening = buildPrivateMordredBlindnessObjective({
    req: input.req,
    view: input.view,
    belief: openingBelief,
    treatment: buildPrivateActorTargetTreatmentRead(
      projectPublicRecord(input.view),
      openingObserver,
    ),
    candidates: legalCandidates(input.req, input.view),
  })

  const history = structuredClone(input.view)
  const merlin = input.game.players.find(
    (player) => player.role === 'merlin',
  )!.seat
  const safePartner = history.players
    .map((player) => player.seat)
    .find(
      (seat) =>
        seat !== history.seat
        && !history.privateInfo.evilPartners!.includes(seat),
    )!
  history.quests[0] = {
    ...history.quests[0],
    team: [history.seat, safePartner].sort((a, b) => a - b),
    result: 'success',
    failCount: 0,
  }
  history.proposals = [{
    round: 1,
    proposalNum: 1,
    leader: merlin,
    team: [...history.quests[0].team!],
    votes: [],
    approved: true,
  }]
  const historyBelief = exactBelief(history)
  const historyTreatment = buildPrivateActorTargetTreatmentRead(
    projectPublicRecord(history),
    observePublicRecord(projectPublicRecord(history)),
  )
  const observed = buildPrivateMordredBlindnessObjective({
    req: input.req,
    view: history,
    belief: historyBelief,
    treatment: historyTreatment,
    candidates: legalCandidates(input.req, history),
  })
  assert.deepEqual(
    observed.merlinHypotheses.map((entry) => entry.worldMass),
    opening.merlinHypotheses.map((entry) => entry.worldMass),
  )
  assert.notDeepEqual(
    observed.merlinHypotheses.map((entry) => entry.anomalousTreatmentMass),
    opening.merlinHypotheses.map((entry) => entry.anomalousTreatmentMass),
  )

  const weightedBelief = beliefFromWeightedWorlds(
    history,
    historyBelief.worlds.map((entry) => ({
      world: entry.world,
      probability:
        entry.world.roleBySeat[merlin] === 'merlin' ? 20 : 1,
    })),
    {
      modelVersion: 'phase7e2a-causal-weight-v1',
      quality: 'weighted',
    },
  )
  const weighted = buildPrivateMordredBlindnessObjective({
    req: input.req,
    view: history,
    belief: weightedBelief,
    treatment: historyTreatment,
    candidates: legalCandidates(input.req, history),
  })
  assert.notDeepEqual(
    weighted.merlinHypotheses.map((entry) => entry.worldMass),
    observed.merlinHypotheses.map((entry) => entry.worldMass),
  )
  const targetTeam = observed.assessments.find(
    (entry) =>
      entry.team.seats.includes(history.seat)
      && entry.team.seats.every(
        (seat) =>
          seat === history.seat
          || !history.privateInfo.evilPartners!.includes(seat),
      ),
  )!.team.teamId
  const exactValue = observed.assessments.find(
    (entry) => entry.team.teamId === targetTeam,
  )!.opportunityValue
  const weightedValue = weighted.assessments.find(
    (entry) => entry.team.teamId === targetTeam,
  )!.opportunityValue
  assert.notEqual(weightedValue, exactValue)
})

test('seat rotation, names, and private canaries cannot change semantics', () => {
  const input = mordredProposal()
  const view = structuredClone(input.view)
  view.events = []
  view.transcript = []
  const record = projectPublicRecord(view)
  const observer = observePublicRecord(record)
  const treatment = buildPrivateActorTargetTreatmentRead(record, observer)
  const objective = buildPrivateMordredBlindnessObjective({
    req: input.req,
    view,
    belief: exactBelief(view),
    treatment,
    candidates: legalCandidates(input.req, view),
  })

  const renamed = structuredClone(record)
  renamed.players = renamed.players.map((player) => ({
    ...player,
    name: `MERLIN-CANARY-${player.seat}`,
  }))
  assert.deepEqual(
    buildPrivateActorTargetTreatmentRead(
      renamed,
      observePublicRecord(renamed),
    ),
    treatment,
  )
  const privateCanary = structuredClone(view)
  privateCanary.privateInfo = {
    evilPartners: [...(view.privateInfo.evilPartners ?? [])],
    knownEvil: [view.seat],
    merlinCandidates: [view.seat],
  }
  assert.deepEqual(
    projectPublicRecord(privateCanary),
    projectPublicRecord(view),
  )

  const shift = 2
  const rotatedView = rotatePlayerView(view, shift)
  const rotatedReq: DecisionRequest = {
    ...input.req,
    seat: (input.req.seat + shift) % view.playerCount,
  }
  const rotatedRecord = projectPublicRecord(rotatedView)
  const rotatedTreatment = buildPrivateActorTargetTreatmentRead(
    rotatedRecord,
    observePublicRecord(rotatedRecord),
  )
  const rotatedObjective = buildPrivateMordredBlindnessObjective({
    req: rotatedReq,
    view: rotatedView,
    belief: exactBelief(rotatedView),
    treatment: rotatedTreatment,
    candidates: legalCandidates(rotatedReq, rotatedView),
  })
  for (const row of treatment.rows) {
    const actor = (row.actor + shift) % view.playerCount
    const target = (row.target + shift) % view.playerCount
    assert.deepEqual(
      rotatedTreatment.rows[actor * view.playerCount + target]
        .proposalSelection,
      row.proposalSelection,
    )
    assert.deepEqual(
      rotatedTreatment.rows[actor * view.playerCount + target].voteApproval,
      row.voteApproval,
    )
  }
  for (const hypothesis of objective.merlinHypotheses) {
    const rotated = rotatedObjective.merlinHypotheses.find(
      (entry) =>
        entry.seat === (hypothesis.seat + shift) % view.playerCount,
    )!
    assert.equal(rotated.worldMass, hypothesis.worldMass)
    assert.equal(
      rotated.observationCoverageMass,
      hypothesis.observationCoverageMass,
    )
    assert.equal(
      rotated.anomalousTreatmentMass,
      hypothesis.anomalousTreatmentMass,
    )
  }
  for (const assessment of objective.assessments) {
    const rotatedTeam = assessment.team.seats
      .map((seat) => (seat + shift) % view.playerCount)
      .sort((left, right) => left - right)
    const rotated = rotatedObjective.assessments.find(
      (entry) =>
        entry.team.seats.length === rotatedTeam.length
        && entry.team.seats.every(
          (seat, index) => seat === rotatedTeam[index],
        ),
    )!
    assert.equal(rotated.opportunityValue, assessment.opportunityValue)
    assert.deepEqual(
      rotated.visibleEvilCountDistribution,
      assessment.visibleEvilCountDistribution,
    )
    assert.deepEqual(
      rotated.totalEvilCountDistribution,
      assessment.totalEvilCountDistribution,
    )
  }
})

test('missing roots degrade through generic status without changing policy', async () => {
  const input = mordredProposal()
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [MORDRED_BLINDNESS_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  const run = await runDecisionComponents(
    brain,
    input.req,
    input.view,
  )
  assert.deepEqual(
    run.entries.map((entry) => [
      entry.component.id,
      entry.status,
      entry.status === 'degraded' ? entry.failureCode : undefined,
    ]),
    [
      [ACTOR_TARGET_TREATMENT_COMPONENT.id, 'degraded', 'host-input-unavailable'],
      [MORDRED_BLINDNESS_COMPONENT.id, 'degraded', 'dependency-unavailable'],
    ],
  )
  assert.ok(run.policyUse.every((entry) => !entry.used))
  assert.ok(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request: input.req,
    view: input.view,
  }))
})

test('native trace admission rejects coherent payload and graph forgeries', async () => {
  const input = mordredProposal()
  const agent = nativeAgent(input.game.seed)
  const output = await agent.decide(input.req, input.view)
  const original = output.trace!
  const plan = decisionComponentPlan(agent.resolvedBrain())
  const admissionContext = {
    kind: 'finalized-artifact',
    req: input.req,
    view: input.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: input.game.seed,
    expectedComponentPlan: plan,
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
    expectComponentTrace: true,
  } as const
  assert.equal(admitDecisionTrace({
    ...admissionContext,
    trace: original,
  }).kind, 'trusted-exact')

  const coherentPayload = structuredClone(original)
  const objectiveEntry = coherentPayload.components!.entries.find(
    (entry) => entry.component.id === MORDRED_BLINDNESS_COMPONENT.id,
  )!
  assert.equal(objectiveEntry.status, 'admitted')
  if (objectiveEntry.status !== 'admitted') {
    throw new Error('expected admitted native objective')
  }
  const payload = objectiveEntry.envelope.payload as ReturnType<
    typeof buildPrivateMordredBlindnessObjective
  >
  const positive = payload.merlinHypotheses.filter(
    (entry) => entry.worldMass > 0.02,
  )
  assert.ok(positive.length >= 2)
  positive[0].worldMass -= 0.01
  positive[1].worldMass += 0.01
  assert.ok(validatePrivateMordredBlindnessObjective(payload))
  ;(objectiveEntry as any).payloadBytes = Buffer.byteLength(
    JSON.stringify(payload),
    'utf8',
  )
  const coherentPayloadAdmission = admitDecisionTrace({
    ...admissionContext,
    trace: coherentPayload,
  })
  assert.equal(coherentPayloadAdmission.kind, 'rejected')
  if (coherentPayloadAdmission.kind === 'rejected') {
    assert.equal(
      coherentPayloadAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }

  for (const [index, mutate] of [
    (trace: typeof original) => {
      const entry = trace.components!.entries[1]
      ;(entry.component as any).id = 'forged-native'
    },
    (trace: typeof original) => {
      const entry = trace.components!.entries[1]
      ;(entry as any).privacy = 'public'
    },
    (trace: typeof original) => {
      trace.componentPlan!.configured.shift()
      trace.components!.configured.shift()
      trace.components!.entries.shift()
      trace.components!.policyUse.shift()
    },
    (trace: typeof original) => {
      const use = trace.components!.policyUse[1] as any
      use.used = true
      use.stages = ['candidate-score']
    },
    (trace: typeof original) => {
      const entry = trace.components!.entries[1]
      trace.components!.entries[1] = {
        component: structuredClone(entry.component),
        kind: entry.kind,
        privacy: entry.privacy,
        status: 'inapplicable',
      }
    },
  ].entries()) {
    const forged = structuredClone(original)
    mutate(forged)
    const admission = admitDecisionTrace({
      ...admissionContext,
      trace: forged,
    })
    assert.equal(admission.kind, 'rejected', `graph mutation ${index}`)
    if (admission.kind === 'rejected') {
      assert.equal(
        admission.reason,
        'trusted-identity-host-join-failed',
        `graph mutation ${index}`,
      )
    }
  }

  let getterCalls = 0
  const getterTrace = structuredClone(original)
  const getterEntry = getterTrace.components!.entries[1]
  assert.equal(getterEntry.status, 'admitted')
  if (getterEntry.status !== 'admitted') {
    throw new Error('expected admitted native objective')
  }
  const getterPayload = structuredClone(getterEntry.envelope.payload)
  Object.defineProperty(getterPayload, 'role', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls++
      return 'mordred'
    },
  })
  ;(getterEntry.envelope as any).payload = getterPayload
  const getterAdmission = admitDecisionTrace({
    ...admissionContext,
    trace: getterTrace,
  })
  assert.equal(getterAdmission.kind, 'rejected')
  if (getterAdmission.kind === 'rejected') {
    assert.equal(getterAdmission.reason, 'trace-json-unsafe')
  }
  assert.equal(getterCalls, 0)

  let proxyCalls = 0
  const proxyTrace = structuredClone(original)
  const proxyEntry = proxyTrace.components!.entries[1]
  assert.equal(proxyEntry.status, 'admitted')
  if (proxyEntry.status !== 'admitted') {
    throw new Error('expected admitted native objective')
  }
  ;(proxyEntry.envelope as any).payload = new Proxy(
    structuredClone(proxyEntry.envelope.payload) as object,
    {
      get(target, property, receiver) {
        proxyCalls++
        return Reflect.get(target, property, receiver)
      },
    },
  )
  const proxyAdmission = admitDecisionTrace({
    ...admissionContext,
    trace: proxyTrace,
  })
  assert.equal(proxyAdmission.kind, 'rejected')
  if (proxyAdmission.kind === 'rejected') {
    assert.equal(proxyAdmission.reason, 'trace-json-unsafe')
  }
  assert.equal(proxyCalls, 0)

  const oversizedTrace = structuredClone(original)
  const oversizedEntry = oversizedTrace.components!.entries[1]
  assert.equal(oversizedEntry.status, 'admitted')
  if (oversizedEntry.status !== 'admitted') {
    throw new Error('expected admitted native objective')
  }
  ;(oversizedEntry.envelope as any).payload = {
    value: 'x'.repeat(DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES + 1),
  }
  ;(oversizedEntry as any).payloadBytes =
    DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES
  const oversizedAdmission = admitDecisionTrace({
    ...admissionContext,
    trace: oversizedTrace,
  })
  assert.equal(oversizedAdmission.kind, 'rejected')
  if (oversizedAdmission.kind === 'rejected') {
    assert.equal(
      oversizedAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }

  const hugeLengthTrace = structuredClone(original)
  const hugeLengthEntry = hugeLengthTrace.components!.entries[1]
  assert.equal(hugeLengthEntry.status, 'admitted')
  if (hugeLengthEntry.status !== 'admitted') {
    throw new Error('expected admitted native objective')
  }
  const hugeLengthPayload = structuredClone(
    hugeLengthEntry.envelope.payload,
  ) as any
  hugeLengthPayload.assessments = new Array(0xffff_ffff)
  ;(hugeLengthEntry.envelope as any).payload = hugeLengthPayload
  const hugeLengthAdmission = admitDecisionTrace({
    ...admissionContext,
    trace: hugeLengthTrace,
  })
  assert.equal(hugeLengthAdmission.kind, 'rejected')
  if (hugeLengthAdmission.kind === 'rejected') {
    assert.equal(hugeLengthAdmission.reason, 'trace-too-large')
  }
})

test('legal no-Merlin view admits treatment but not Mordred objective', async () => {
  let game: ReturnType<typeof createGame> | undefined
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = createGame({
      seed: `phase7e2a-no-merlin-${attempt}`,
      playerCount: 5,
      roles: ['servant', 'servant', 'servant', 'minion', 'oberon'],
    })
    const leader = candidate.players[candidate.leaderSeat]
    if (leader.role === 'servant') {
      game = candidate
      break
    }
  }
  assert.ok(game)
  const view = viewFor(game!, game!.leaderSeat)
  const req: DecisionRequest = {
    kind: 'propose',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [MORDRED_BLINDNESS_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  const observer = observePublicRecord(projectPublicRecord(view))
  const run = await runDecisionComponents(brain, req, view, {
    hostInputs: [{
      input: PRIVATE_PUBLIC_OBSERVER_INPUT,
      value: observer,
    }],
  })
  assert.equal(run.entries[0].status, 'admitted')
  assert.equal(run.entries[1].status, 'inapplicable')
  assert.ok(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request: req,
    view,
    hostInputs: [{
      input: PRIVATE_PUBLIC_OBSERVER_INPUT,
      value: observer,
    }],
  }))

  const forged = structuredClone(run)
  const payloadInput = mordredProposal()
  const source = await nativeAgent(payloadInput.game.seed)
    .decide(payloadInput.req, payloadInput.view)
  const sourceEntry = source.trace!.components!.entries.find(
    (entry) => entry.component.id === MORDRED_BLINDNESS_COMPONENT.id,
  )!
  forged.entries[1] = structuredClone(sourceEntry)
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run: forged,
    request: req,
    view,
    hostInputs: [{
      input: PRIVATE_PUBLIC_OBSERVER_INPUT,
      value: observer,
    }],
  }), false)
})

test('required-root brain contributions dedupe and reject unsupported models', () => {
  const root = (id: string): {
    token: ComponentHostInputToken<number>
    definition: ComponentHostInputDefinition<number>
  } => {
    const token: ComponentHostInputToken<number> = {
      id,
      version: 'root-v1',
      privacy: 'private',
    }
    return {
      token,
      definition: {
        token,
        maxPayloadBytes: 32,
        validate(value) {
          return typeof value === 'number' && Number.isFinite(value)
            ? { valid: true as const, value }
            : { valid: false as const, degradationCode: 'bad-root' }
        },
      },
    }
  }
  const component = (
    id: string,
    input?: ComponentHostInputToken<number>,
    observerModel?: 'exact-public-observer-v1',
  ): {
    token: ComponentToken<number>
    definition: DecisionComponentDefinition<number>
  } => {
    const token: ComponentToken<number> = {
      id,
      version: 'component-v1',
      kind: 'objective',
      privacy: 'private',
    }
    return {
      token,
      definition: {
        token,
        source: 'native',
        ...(observerModel
          ? { brainContribution: { observerModel } }
          : {}),
        dependencies: [],
        requiredHostInputs: input ? [input] : [],
        hostRequirements: [],
        maxPayloadBytes: 32,
        degradationCode: 'fixture-failed',
        applies: () => false,
        execute: () => ({
          status: 'produced',
          envelope: componentEnvelope(token, 1),
        }),
        validateDetached: (payload) =>
          payload === 1
            ? {
                admitted: true,
                payload,
                verification: 'exact',
                promotionEligible: true,
              }
            : { admitted: false, degradationCode: 'fixture-failed' },
        admitHost: ({ payload }) => ({
          admitted: true,
          payload,
          verification: 'exact',
          promotionEligible: true,
        }),
      },
    }
  }

  const first = root('observer-root-a')
  const second = root('observer-root-b')
  const firstComponent = component(
    'observer-consumer-a',
    first.token,
    'exact-public-observer-v1',
  )
  const secondComponent = component(
    'observer-consumer-b',
    second.token,
    'exact-public-observer-v1',
  )
  const deduped = createDecisionComponentRegistry(
    [firstComponent.definition, secondComponent.definition],
    { hostInputs: [first.definition, second.definition] },
  )
  assert.equal(
    resolveComposedBrain({
      requestedComponents: [firstComponent.token, secondComponent.token],
      configuredPipeline: testConfiguredPipeline(),
    }, deduped).description.base.observerModel,
    'exact-public-observer-v1',
  )

  const conflicting = root('observer-root-c')
  const conflictingComponent = component(
    'observer-consumer-c',
    conflicting.token,
  )
  const unsupportedDefinition = {
    ...conflictingComponent.definition,
    brainContribution: { observerModel: 'other-observer-v1' },
  } as unknown as DecisionComponentDefinition<number>
  assert.throws(
    () => createDecisionComponentRegistry(
      [firstComponent.definition, unsupportedDefinition],
      { hostInputs: [first.definition, conflicting.definition] },
    ),
    /invalid brain contribution/,
  )

  assert.equal(
    resolveComposedBrain({
      requestedComponents: [firstComponent.token],
      publicObserverConfigured: true,
      configuredPipeline: testConfiguredPipeline(),
    }, deduped).description.base.observerModel,
    'exact-public-observer-v1',
  )

  const unrelated = component('unrelated-native')
  const unrelatedRegistry = createDecisionComponentRegistry(
    [unrelated.definition],
  )
  assert.equal(
    resolveComposedBrain({
      requestedComponents: [unrelated.token],
      configuredPipeline: testConfiguredPipeline(),
    }, unrelatedRegistry).description.base.observerModel,
    'off',
  )
})

test('5-10 player payload and latency bounds remain deterministic', async () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    const input = mordredProposal(playerCount)
    const agent = nativeAgent(input.game.seed)
    const started = performance.now()
    const first = await agent.decide(input.req, input.view)
    const elapsed = performance.now() - started
    const second = await nativeAgent(input.game.seed)
      .decide(input.req, structuredClone(input.view))
    assert.deepEqual(first.decision, second.decision)
    assert.deepEqual(first.trace!.components, second.trace!.components)
    const treatment = componentPayload(
      first.trace!.components!,
      ACTOR_TARGET_TREATMENT_COMPONENT,
    )!
    const objective = componentPayload(
      first.trace!.components!,
      MORDRED_BLINDNESS_COMPONENT,
    )!
    assert.ok(
      Buffer.byteLength(JSON.stringify(treatment), 'utf8')
        <= MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
    )
    assert.ok(
      Buffer.byteLength(JSON.stringify(objective), 'utf8')
        <= DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    )
    assert.ok(objective.assessments.length <= MAX_MORDRED_BLINDNESS_ASSESSMENTS)
    // This is a deadlock/runaway guard, not a contested-CI latency SLO.
    // Deterministic candidate and byte bounds above are the stable gate.
    assertWallClockBelow(
      elapsed,
      2_000,
      `${playerCount}p took ${elapsed.toFixed(2)}ms`,
    )
  }
  const boundary = mordredProposal(10, 4)
  const output = await nativeAgent(boundary.game.seed)
    .decide(boundary.req, boundary.view)
  const objective = componentPayload(
    output.trace!.components!,
    MORDRED_BLINDNESS_COMPONENT,
  )!
  assert.equal(objective.assessments.length, 252)
})

const architectureCase = ARCHITECTURE_BANK.find(
  (candidate) => candidate.targetRole === 'mordred',
)!

const architectureVariant: ArchitectureVariant = {
  id: 'phase7e2a-native',
  paid: false,
  components: {
    brain: 'brain-spec-v1',
    belief: 'exact-constraints-v1',
    factors: 'off',
    languageEvidence: 'off',
    observerModel: 'exact-public-observer-v1',
    policy: 'composed-policy-v1',
    scorer: 'compatibility-scorer-v1',
    planner: 'planner-off',
    voice: 'voice-off',
  },
  createTargetAgent: (context) => createComposedAgent({
    seed: context.seed,
    decisionComponents: [MORDRED_BLINDNESS_COMPONENT],
    onDecisionTrace: context.onDecisionTrace,
  }),
}

test('artifact and report attribute only the trusted generic native graph', async () => {
  const [artifact] = await runArchitectureBench({
    variants: [architectureVariant],
    cases: [architectureCase],
    bankId: 'phase7e2a-native',
  })
  const configured = artifact.strategyVersions?.resolvedArchitecture
    ?.identity.components.configured
  assert.deepEqual(
    configured?.map((component) => component.id),
    [ACTOR_TARGET_TREATMENT_COMPONENT.id, MORDRED_BLINDNESS_COMPONENT.id],
  )
  assert.deepEqual(
    artifact.strategyVersions?.observers,
    ['exact-public-observer-v1'],
  )
  assert.equal(
    artifact.architecture?.components.observerModel,
    'exact-public-observer-v1',
  )
  assert.doesNotMatch(
    JSON.stringify(artifact.log),
    /actor-target-treatment-read|mordred-blindness-objective|componentPlan/,
  )
  const report = architectureReport([artifact])
  const componentEvidence = report.variants[0].componentEvidence
  assert.equal(
    componentEvidence.trust,
    'descriptor-host-manifest-admitted',
  )
  assert.equal(componentEvidence.promotionEvidenceEligible, true)
  assert.equal(componentEvidence.configured, 2)
  assert.deepEqual(
    report.variants[0].decisionComponents,
    [
      `${ACTOR_TARGET_TREATMENT_COMPONENT.id}@${ACTOR_TARGET_TREATMENT_COMPONENT.version}`,
      `${MORDRED_BLINDNESS_COMPONENT.id}@${MORDRED_BLINDNESS_COMPONENT.version}`,
    ],
  )
  assert.equal(componentEvidence.policyUses, 0)
  assert.equal(componentEvidence.policyStages, 0)
  assert.match(
    renderArchitectureReport(report),
    /descriptor-host-manifest-admitted, promotion-eligible/,
  )
})
