import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDecision,
  createGame,
} from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import {
  ROLE_ALIGNMENT,
} from '../server/engine/rules.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  buildPrivateMordredBlindnessObjective,
  validatePrivateMordredBlindnessHostJoin,
  validatePrivateMordredBlindnessObjective,
} from '../server/agents/analysis/mordred-blindness.ts'
import {
  buildPrivateActorTargetTreatmentRead,
  validatePrivateActorTargetTreatmentHostJoin,
  validatePrivateActorTargetTreatmentRead,
} from '../server/agents/analysis/actor-target-treatment.ts'
import {
  MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
} from '../server/agents/analysis/actor-target-treatment-types.ts'
import {
  MAX_MORDRED_BLINDNESS_ASSESSMENTS,
  MAX_MORDRED_BLINDNESS_JSON_BYTES,
} from '../server/agents/analysis/mordred-blindness-types.ts'
import {
  observePublicRecord,
} from '../server/agents/analysis/observer.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
} from '../server/agents/belief/exact.ts'
import {
  projectPublicRecord,
} from '../server/agents/communication/public-record.ts'
import {
  componentPayload,
  decisionComponentPlan,
  publicDecisionComponentRun,
  runDecisionComponents,
  validateDecisionComponentRunHostJoin,
} from '../server/agents/components/kernel.ts'
import {
  PRIVATE_BELIEF_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
} from '../server/agents/components/native-score-components.ts'
import {
  MORDRED_BLINDNESS_COMPONENT,
  ACTOR_TARGET_TREATMENT_COMPONENT,
} from '../server/agents/components/native-role-components.ts'
import {
  createProductionComponentRegistry,
} from '../server/agents/components/production-registry.ts'
import {
  ComponentRegistryError,
} from '../server/agents/components/registry.ts'
import {
  projectPrivateResolvedComposedBrainLegacy,
  projectResolvedArchitectureIdentity,
  resolveComposedBrain,
} from '../server/agents/components/resolved-brain.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'
import type {
  ComponentRef,
} from '../server/agents/components/types.ts'
import {
  validateComposedTraceHostJoin,
} from '../server/agents/admission/composed-trace.ts'
import {
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  buildMessages,
} from '../server/agents/prompts.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import {
  ARCHITECTURE_BANK,
} from '../server/eval/architecture-bank.ts'
import {
  architectureReport,
} from '../server/eval/architecture-report.ts'

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
  for (let attempt = 0; attempt < 2_000; attempt++) {
    const game = createGame({
      seed: `phase7e2a-hostile-${playerCount}-${round}-${attempt}`,
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

function nativeAgent(seed: string, options: Record<string, unknown> = {}) {
  return createComposedAgent({
    ...options,
    seed,
    decisionComponents: [MORDRED_BLINDNESS_COMPONENT],
  })
}

function registryError(
  block: () => unknown,
): ComponentRegistryError {
  try {
    block()
  } catch (error) {
    assert.ok(error instanceof ComponentRegistryError)
    return error
  }
  assert.fail('expected component registry rejection')
}

test('production registry rejects hostile refs atomically', () => {
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const before = registry.definitions().map((definition) => ({
    token: definition.token,
    dependencies: definition.dependencies,
  }))
  const hostile: Array<{
    requested: ComponentRef[]
    code: ComponentRegistryError['code']
  }> = [
    {
      requested: [{ id: 'unknown-component', version: 'v1' }],
      code: 'unknown-request',
    },
    {
      requested: [
        MORDRED_BLINDNESS_COMPONENT,
        MORDRED_BLINDNESS_COMPONENT,
      ],
      code: 'duplicate-request',
    },
    {
      requested: [{ id: 'Mordred-Blindness', version: 'v1' }],
      code: 'invalid-definition',
    },
    {
      requested: [{
        id: MORDRED_BLINDNESS_COMPONENT.id,
        version: `${MORDRED_BLINDNESS_COMPONENT.version} wrong`,
      }],
      code: 'invalid-definition',
    },
    {
      requested: [{
        id: MORDRED_BLINDNESS_COMPONENT.id,
        version: 'mordred-blindness-objective-v999',
      }],
      code: 'conflicting-version',
    },
  ]
  for (const attack of hostile) {
    const error = registryError(() => registry.resolve({
      requested: attack.requested,
    }))
    assert.equal(error.code, attack.code)
    assert.deepEqual(
      registry.definitions().map((definition) => ({
        token: definition.token,
        dependencies: definition.dependencies,
      })),
      before,
    )
  }
  assert.deepEqual(
    registry.resolve({
      requested: [MORDRED_BLINDNESS_COMPONENT],
    }).configured,
    [ACTOR_TARGET_TREATMENT_COMPONENT, MORDRED_BLINDNESS_COMPONENT].map(
      ({ id, version }) => ({ id, version }),
    ),
  )
})

test('treatment is exactly reconstructed from public executed quests only', () => {
  const input = mordredProposal()
  const merlin = input.game.players.find(
    (player) => player.role === 'merlin',
  )!.seat
  const team = legalCandidates(input.req, input.view)[0].decision
  assert.equal(team.kind, 'propose')
  if (team.kind !== 'propose') throw new Error('expected proposal')
  input.view.quests[0] = {
    ...input.view.quests[0],
    team: [...team.team],
    result: 'success',
    failCount: 0,
  }
  input.view.proposals = [{
    round: 1,
    proposalNum: 1,
    leader: merlin,
    team: [...team.team],
    votes: input.view.players.map((player) => ({
      seat: player.seat,
      vote: player.seat % 2 === 0 ? 'approve' : 'reject',
    })),
    approved: true,
  }]

  const forbidden = new Set([
    'seat',
    'name',
    'role',
    'alignment',
    'privateInfo',
    'transcript',
    'events',
  ])
  const isolatedView = new Proxy(input.view, {
    get(target, property, receiver) {
      if (typeof property === 'string' && forbidden.has(property)) {
        throw new Error(`private field accessed: ${property}`)
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const publicRecord = projectPublicRecord(isolatedView)
  const observer = observePublicRecord(publicRecord)
  const treatment = buildPrivateActorTargetTreatmentRead(
    publicRecord,
    observer,
  )
  assert.ok(validatePrivateActorTargetTreatmentRead(treatment))
  assert.ok(validatePrivateActorTargetTreatmentHostJoin(treatment, {
    record: publicRecord,
    observer,
  }))
  const selected = new Set(team.team)
  for (const target of input.view.players.map((player) => player.seat)) {
    const row = treatment.rows.find(
      (candidate) =>
        candidate.actor === merlin && candidate.target === target,
    )!
    assert.equal(row.proposalSelection.denominator, 1)
    assert.equal(
      row.proposalSelection.numerator,
      selected.has(target) ? 1 : 0,
    )
    assert.equal(row.voteApproval.denominator, selected.has(target) ? 1 : 0)
  }

  const privateMutation = structuredClone(input.view)
  privateMutation.privateInfo = {
    evilPartners: input.view.players.map((player) => player.seat),
    knownEvil: [],
    merlinCandidates: [],
  }
  privateMutation.events = []
  privateMutation.transcript = []
  assert.deepEqual(
    buildPrivateActorTargetTreatmentRead(
      projectPublicRecord(privateMutation),
      observePublicRecord(projectPublicRecord(privateMutation)),
    ),
    treatment,
  )

  const forged = structuredClone(treatment)
  const forgedFraction =
    forged.rows[merlin * input.view.playerCount + team.team[0]]
      .proposalSelection
  forgedFraction.numerator = 0
  forgedFraction.index = 0
  assert.equal(validatePrivateActorTargetTreatmentRead(forged), true)
  assert.equal(validatePrivateActorTargetTreatmentHostJoin(forged, {
    record: publicRecord,
    observer,
  }), false)
})

test('weighted correlated worlds use exact joint sums, not marginal products', () => {
  const input = mordredProposal(10, 4)
  input.view.events = []
  const base = exactBelief(input.view)
  const visiblePartners = new Set(
    input.view.privateInfo.evilPartners ?? [],
  )
  const uncertain = input.view.players
    .map((player) => player.seat)
    .filter(
      (seat) => seat !== input.view.seat && !visiblePartners.has(seat),
    )
  const team = [input.view.seat, ...uncertain.slice(0, 4)]
    .sort((left, right) => left - right)
  const weighted = beliefFromWeightedWorlds(
    input.view,
    base.worlds.map((entry, index) => ({
      world: entry.world,
      probability:
        team.includes(entry.world.roleBySeat.indexOf('oberon'))
          ? 11 + (index % 3)
          : 1 + (index % 2),
    })),
    {
      modelVersion: 'phase7e2a-hostile-correlated-v1',
      quality: 'weighted',
      provenance: [{
        factorId: 'phase7e2a-hostile-correlated',
        factorVersion: 'phase7e2a-hostile-correlated-v1',
        evidenceIds: ['synthetic-correlation'],
        logLikelihoodCap: 3,
        minLogLikelihood: 0,
        maxLogLikelihood: 3,
      }],
    },
  )
  const record = projectPublicRecord(input.view)
  const treatment = buildPrivateActorTargetTreatmentRead(
    record,
    observePublicRecord(record),
  )
  const candidates = legalCandidates(input.req, input.view)
  const objective = buildPrivateMordredBlindnessObjective({
    req: input.req,
    view: input.view,
    belief: weighted,
    treatment,
    candidates,
  })
  assert.ok(validatePrivateMordredBlindnessObjective(objective))
  assert.ok(validatePrivateMordredBlindnessHostJoin(objective, {
    req: input.req,
    view: input.view,
    belief: weighted,
    treatment,
    candidates,
  }))
  const assessment = objective.assessments.find(
    (candidate) =>
      candidate.team.seats.length === team.length
      && candidate.team.seats.every(
        (seat, index) => seat === team[index],
      ),
  )!

  const expectedVisible = Array<number>(team.length + 1).fill(0)
  const expectedTotal = Array<number>(team.length + 1).fill(0)
  let expectedBlind = 0
  let expectedCrossing = 0
  const oberonMarginals = new Map<Seat, number>(
    team.map((seat) => [seat, 0]),
  )
  for (const entry of weighted.worlds) {
    const visible = team.filter((seat) =>
      ROLE_ALIGNMENT[entry.world.roleBySeat[seat]] === 'evil'
      && entry.world.roleBySeat[seat] !== 'mordred')
    const total = team.filter(
      (seat) => entry.world.alignmentBySeat[seat] === 'evil',
    )
    expectedVisible[visible.length] += entry.probability
    expectedTotal[total.length] += entry.probability
    const blind =
      team.includes(input.view.seat)
      && visible.length < input.view.quests[3].failsRequired
    if (blind) {
      expectedBlind += entry.probability
      if (total.length >= input.view.quests[3].failsRequired) {
        expectedCrossing += entry.probability
      }
    }
    const oberon = entry.world.roleBySeat.indexOf('oberon')
    if (oberonMarginals.has(oberon)) {
      oberonMarginals.set(
        oberon,
        oberonMarginals.get(oberon)! + entry.probability,
      )
    }
  }
  assert.deepEqual(
    assessment.visibleEvilCountDistribution,
    expectedVisible,
  )
  assert.deepEqual(
    assessment.totalEvilCountDistribution,
    expectedTotal,
  )
  assert.ok(
    Math.abs(assessment.merlinBlindWindowProbability - expectedBlind)
      < 1e-12,
  )
  assert.ok(
    Math.abs(
      assessment.hiddenThresholdCrossingProbability
        - expectedCrossing,
    ) < 1e-12,
  )
  const independentProduct =
    1 - [...oberonMarginals.values()].reduce(
      (product, marginal) => product * (1 - marginal),
      1,
    )
  assert.ok(
    Math.abs(expectedCrossing - independentProduct) > 1e-3,
    'fixture must expose the marginal-product trap',
  )
  assert.equal(
    assessment.hiddenThresholdCrossingProbability,
    expectedCrossing,
  )
})

function rotateView(source: PlayerView, offset: number): PlayerView {
  const count = source.playerCount
  const rotate = (seat: Seat): Seat => (seat + offset) % count
  const seats = (value: readonly Seat[] | undefined) =>
    value?.map(rotate).sort((left, right) => left - right)
  const view = structuredClone(source)
  view.events = []
  view.transcript = []
  view.seat = rotate(source.seat)
  view.name = `rotated-${view.seat}`
  view.leaderSeat = rotate(source.leaderSeat)
  view.players = source.players
    .map((player) => ({
      seat: rotate(player.seat),
      name: `rotated-${rotate(player.seat)}`,
    }))
    .sort((left, right) => left.seat - right.seat)
  view.privateInfo = {
    ...(source.privateInfo.evilPartners
      ? { evilPartners: seats(source.privateInfo.evilPartners) }
      : {}),
    ...(source.privateInfo.knownEvil
      ? { knownEvil: seats(source.privateInfo.knownEvil) }
      : {}),
    ...(source.privateInfo.merlinCandidates
      ? { merlinCandidates: seats(source.privateInfo.merlinCandidates) }
      : {}),
  }
  view.quests = source.quests.map((quest) => ({
    ...quest,
    ...(quest.team ? { team: seats(quest.team) } : {}),
  }))
  view.proposals = source.proposals.map((proposal) => ({
    ...proposal,
    leader: rotate(proposal.leader),
    team: seats(proposal.team)!,
    ...(proposal.revisedFrom
      ? { revisedFrom: seats(proposal.revisedFrom) }
      : {}),
    ...(proposal.votes
      ? {
          votes: proposal.votes
            .map((vote) => ({ ...vote, seat: rotate(vote.seat) }))
            .sort((left, right) => left.seat - right.seat),
        }
      : {}),
  }))
  view.currentTeam = seats(source.currentTeam)
  return view
}

function canonicalObjective(
  objective: ReturnType<typeof buildPrivateMordredBlindnessObjective>,
  unrotate: (seat: Seat) => Seat,
) {
  const seats = (value: readonly Seat[]) =>
    value.map(unrotate).sort((left, right) => left - right)
  return {
    ...objective,
    request: {
      ...objective.request,
      seat: unrotate(objective.request.seat),
      ...(objective.request.currentTeam
        ? { currentTeam: seats(objective.request.currentTeam) }
        : {}),
    },
    merlinHypotheses: objective.merlinHypotheses
      .map((hypothesis) => ({
        ...hypothesis,
        seat: unrotate(hypothesis.seat),
      }))
      .sort((left, right) => left.seat - right.seat),
    assessments: objective.assessments
      .map((assessment) => {
        const team = seats(assessment.team.seats)
        return {
          ...assessment,
          team: {
            ...assessment.team,
            teamId: `team:${team.join(',')}`,
            seats: team,
          },
        }
      })
      .sort((left, right) =>
        left.team.teamId.localeCompare(right.team.teamId, 'en')),
  }
}

test('Mordred treatment and objective are name- and seat-rotation invariant', () => {
  const input = mordredProposal(5)
  input.view.events = []
  input.view.transcript = []
  const renamed = structuredClone(input.view)
  renamed.name = 'observer-name-ignored'
  renamed.players.forEach((player) => {
    player.name = `renamed-${player.seat}`
  })

  const build = (view: PlayerView, req: DecisionRequest) => {
    const record = projectPublicRecord(view)
    const treatment = buildPrivateActorTargetTreatmentRead(
      record,
      observePublicRecord(record),
    )
    return {
      treatment,
      objective: buildPrivateMordredBlindnessObjective({
        req,
        view,
        belief: exactBelief(view),
        treatment,
        candidates: legalCandidates(req, view),
      }),
    }
  }
  const original = build(input.view, input.req)
  const renamedResult = build(renamed, input.req)
  assert.deepEqual(renamedResult, original)

  const offset = 2
  const rotatedView = rotateView(input.view, offset)
  const rotatedReq: DecisionRequest = {
    ...input.req,
    seat: (input.req.seat + offset) % input.view.playerCount,
  }
  const rotated = build(rotatedView, rotatedReq)
  const unrotate = (seat: Seat): Seat =>
    (seat - offset + input.view.playerCount) % input.view.playerCount
  const normalizedRows = rotated.treatment.rows
    .map((row) => ({
      ...row,
      actor: unrotate(row.actor),
      target: unrotate(row.target),
    }))
    .sort(
      (left, right) =>
        left.actor - right.actor || left.target - right.target,
    )
  assert.deepEqual(
    { ...rotated.treatment, rows: normalizedRows },
    original.treatment,
  )
  assert.deepEqual(
    canonicalObjective(rotated.objective, unrotate),
    canonicalObjective(original.objective, (seat) => seat),
  )
})

test('applicability excludes no-Merlin, non-Mordred, and wrong-kind hosts', async () => {
  const input = mordredProposal()
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [MORDRED_BLINDNESS_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  const cases: Array<{
    req: DecisionRequest
    view: PlayerView
    expected: readonly string[]
  }> = []

  const noMerlin = structuredClone(input.view)
  noMerlin.rolesInPlay = noMerlin.rolesInPlay.map(
    (role) => role === 'merlin' ? 'servant' : role,
  )
  cases.push({
    req: input.req,
    view: noMerlin,
    expected: ['degraded', 'inapplicable'],
  })

  const nonMordred = structuredClone(input.view)
  nonMordred.role = 'servant'
  nonMordred.alignment = 'good'
  nonMordred.privateInfo = {}
  cases.push({
    req: input.req,
    view: nonMordred,
    expected: ['degraded', 'inapplicable'],
  })

  const wrongKind = structuredClone(input.view)
  wrongKind.phase = 'discussion'
  cases.push({
    req: { ...input.req, kind: 'discuss' },
    view: wrongKind,
    expected: ['inapplicable', 'inapplicable'],
  })

  for (const fixture of cases) {
    const run = await runDecisionComponents(
      brain,
      fixture.req,
      fixture.view,
    )
    assert.deepEqual(
      run.entries.map((entry) => entry.status),
      fixture.expected,
    )
    assert.ok(run.policyUse.every(
      (use) => use.used === false && use.stages.length === 0,
    ))
  }
})

test('exact evidence is promotable; weighted and degraded native evidence is not', async () => {
  const input = mordredProposal()
  const exact = await nativeAgent(input.game.seed)
    .decide(input.req, input.view)
  assert.ok(exact.trace!.components!.entries.every(
    (entry) =>
      entry.status === 'admitted'
      && entry.verification === 'exact'
      && entry.promotionEligible,
  ))

  const weightedModel = {
    version: 'phase7e2a-hostile-weighted-v1',
    factorsVersion: 'phase7e2a-hostile-factor-v1',
    infer(view: PlayerView) {
      const base = exactBelief(view)
      return beliefFromWeightedWorlds(
        view,
        base.worlds.map((entry, index) => ({
          world: entry.world,
          probability: index % 2 === 0 ? 3 : 1,
        })),
        {
          modelVersion: 'phase7e2a-hostile-weighted-v1',
          quality: 'weighted',
          provenance: [{
            factorId: 'phase7e2a-hostile-weight',
            factorVersion: 'phase7e2a-hostile-factor-v1',
            evidenceIds: ['fixture'],
            logLikelihoodCap: 2,
            minLogLikelihood: 0,
            maxLogLikelihood: 2,
          }],
        },
      )
    },
  }
  const weighted = await nativeAgent(input.game.seed, {
    beliefModel: weightedModel,
  }).decide(input.req, input.view)
  const weightedEntries = weighted.trace!.components!.entries
  assert.equal(weightedEntries[0].status, 'admitted')
  assert.equal(weightedEntries[1].status, 'admitted')
  if (
    weightedEntries[0].status !== 'admitted'
    || weightedEntries[1].status !== 'admitted'
  ) throw new Error('expected weighted admissions')
  assert.equal(weightedEntries[0].verification, 'exact')
  assert.equal(weightedEntries[0].promotionEligible, true)
  assert.equal(weightedEntries[1].verification, 'structural')
  assert.equal(weightedEntries[1].promotionEligible, false)

  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [MORDRED_BLINDNESS_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  const degraded = await runDecisionComponents(
    brain,
    input.req,
    input.view,
  )
  assert.deepEqual(
    degraded.entries.map((entry) => entry.status),
    ['degraded', 'degraded'],
  )
  assert.ok(validateDecisionComponentRunHostJoin({
    registry,
    run: degraded,
    request: input.req,
    view: input.view,
  }))
  assert.ok(degraded.entries.every(
    (entry) =>
      entry.status !== 'admitted'
      && !Object.hasOwn(entry, 'promotionEligible'),
  ))
})

test('host admission rejects dependency, version, privacy, tag, use, and observer forgeries', async () => {
  const input = mordredProposal()
  const agent = nativeAgent(input.game.seed)
  const output = await agent.decide(input.req, input.view)
  const plan = decisionComponentPlan(agent.resolvedBrain())
  const valid = (candidate: typeof output): boolean =>
    validateComposedTraceHostJoin({
      trace: candidate.trace!,
      req: input.req,
      view: input.view,
      authoritativeAction: candidate.decision,
      selectedDecision: candidate.decision,
      deterministicSeed: input.game.seed,
      expectedComponentPlan: plan,
      expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
        agent.resolvedBrain().description,
      ),
      expectComponentTrace: true,
    })
  assert.ok(valid(output))

  const mutations: Array<(candidate: typeof output) => void> = [
    (candidate) => {
      candidate.trace!.componentPlan!.configured.shift()
      candidate.trace!.components!.configured.shift()
      candidate.trace!.components!.entries.shift()
      candidate.trace!.components!.policyUse.shift()
    },
    (candidate) => {
      for (const ref of [
        candidate.trace!.componentPlan!.configured[1],
        candidate.trace!.components!.configured[1],
        candidate.trace!.components!.entries[1].component,
        candidate.trace!.components!.policyUse[1].component,
      ]) ref.version = 'mordred-blindness-objective-v999'
    },
    (candidate) => {
      const entry = candidate.trace!.components!.entries[1]
      entry.privacy = 'public'
      if (entry.status === 'admitted') entry.envelope.privacy = 'public'
    },
    (candidate) => {
      const entry = candidate.trace!.components!.entries[1]
      if (entry.status === 'admitted') entry.envelope.kind = 'projection'
    },
    (candidate) => {
      const use = candidate.trace!.components!.policyUse[1]
      use.used = true
      use.stages = ['candidate-score']
    },
    (candidate) => {
      ;(candidate.trace!.publicObserver as { version: string }).version =
        'observer-off'
    },
  ]
  for (const [index, mutate] of mutations.entries()) {
    const candidate = structuredClone(output)
    mutate(candidate)
    assert.equal(valid(candidate), false, `host mutation ${index}`)
  }

  const metadataForgery = structuredClone(output)
  const treatmentEntry = metadataForgery.trace!.components!.entries[0]
  const objectiveEntry = metadataForgery.trace!.components!.entries[1]
  assert.equal(treatmentEntry.status, 'admitted')
  assert.equal(objectiveEntry.status, 'admitted')
  if (
    treatmentEntry.status !== 'admitted'
    || objectiveEntry.status !== 'admitted'
  ) throw new Error('expected admissions')
  const treatment = treatmentEntry.envelope.payload as ReturnType<
    typeof buildPrivateActorTargetTreatmentRead
  >
  const objective = objectiveEntry.envelope.payload as ReturnType<
    typeof buildPrivateMordredBlindnessObjective
  >
  treatment.observerFeasibleWorldCount += 1
  objective.source.observerFeasibleWorldCount += 1
  treatmentEntry.payloadBytes = Buffer.byteLength(
    JSON.stringify(treatment),
    'utf8',
  )
  objectiveEntry.payloadBytes = Buffer.byteLength(
    JSON.stringify(objective),
    'utf8',
  )
  assert.ok(validatePrivateActorTargetTreatmentRead(treatment))
  assert.ok(validatePrivateMordredBlindnessObjective(objective))
  assert.equal(valid(metadataForgery), false)
})

test('private E2A data is absent publicly and raw-truth mutation is inert', async () => {
  const input = mordredProposal(10)
  const changedTruth = structuredClone(input.game)
  const merlin = changedTruth.players.find(
    (player) => player.role === 'merlin',
  )!
  const swappableGood = changedTruth.players.find(
    (player) =>
      player.role === 'servant'
      && player.seat !== input.view.seat,
  )!
  ;[merlin.role, swappableGood.role] =
    [swappableGood.role, merlin.role]
  const originalView = viewFor(input.game, input.view.seat)
  const mutatedView = viewFor(changedTruth, input.view.seat)
  assert.deepEqual(mutatedView, originalView)

  const original = await nativeAgent(input.game.seed)
    .decide(input.req, originalView)
  const mutated = await nativeAgent(input.game.seed)
    .decide(input.req, mutatedView)
  assert.deepEqual(mutated.decision, original.decision)
  assert.deepEqual(mutated.trace!.components, original.trace!.components)
  assert.deepEqual(
    publicDecisionComponentRun(original.trace!.components!),
    {
      version: original.trace!.components!.version,
      configured: [],
      entries: [],
      policyUse: [],
    },
  )
  assert.doesNotMatch(
    JSON.stringify(projectPublicRecord(originalView)),
    /actor-target-treatment-read|mordred-blindness-objective|merlinHypotheses/,
  )
  assert.doesNotMatch(
    JSON.stringify(input.game.log),
    /actor-target-treatment-read|mordred-blindness-objective|merlinHypotheses/,
  )
})

test('native objective leaves decisions, prompts, logs, and replay deterministic', async () => {
  const input = mordredProposal()
  const baseline = await createComposedAgent({
    seed: input.game.seed,
  }).decide(input.req, structuredClone(input.view))
  const native = await nativeAgent(input.game.seed)
    .decide(input.req, structuredClone(input.view))
  const nativeReplay = await nativeAgent(input.game.seed)
    .decide(input.req, structuredClone(input.view))
  assert.deepEqual(native.decision, baseline.decision)
  assert.deepEqual(nativeReplay.decision, native.decision)
  assert.deepEqual(nativeReplay.trace!.components, native.trace!.components)
  assert.deepEqual(
    buildMessages('propose', input.view, ''),
    buildMessages('propose', structuredClone(input.view), ''),
  )

  const baselineGame = createGame({
    seed: input.game.seed,
    playerCount: input.game.config.playerCount,
    roles: [...input.game.config.roles],
  })
  const nativeGame = createGame({
    seed: input.game.seed,
    playerCount: input.game.config.playerCount,
    roles: [...input.game.config.roles],
  })
  applyDecision(baselineGame, baselineGame.leaderSeat, baseline.decision)
  applyDecision(nativeGame, nativeGame.leaderSeat, native.decision)
  assert.deepEqual(nativeGame.log, baselineGame.log)
  assert.deepEqual(
    viewFor(nativeGame, input.view.seat),
    viewFor(baselineGame, input.view.seat),
  )
})

test('resolved base, trace, and artifact agree on E2A observer metadata', async () => {
  const input = mordredProposal()
  const agent = nativeAgent(input.game.seed)
  const output = await agent.decide(input.req, input.view)
  const treatment = componentPayload(
    output.trace!.components!,
    ACTOR_TARGET_TREATMENT_COMPONENT,
  )!
  const objective = componentPayload(
    output.trace!.components!,
    MORDRED_BLINDNESS_COMPONENT,
  )!
  assert.equal(
    agent.resolvedBrain().description.base.observerModel,
    treatment.observerModelVersion,
  )
  assert.equal(
    projectPrivateResolvedComposedBrainLegacy(
      agent.resolvedBrain().description,
    ).baseComponentVersions.observerModel,
    treatment.observerModelVersion,
  )
  assert.equal(
    output.trace!.componentVersions!.observerModel,
    treatment.observerModelVersion,
  )
  assert.equal(
    objective.source.observerModelVersion,
    treatment.observerModelVersion,
  )
  assert.equal(
    objective.source.observerFeasibleWorldCount,
    treatment.observerFeasibleWorldCount,
  )

  const architectureCase = ARCHITECTURE_BANK.find(
    (candidate) => candidate.targetRole === 'mordred',
  )!
  const variant: ArchitectureVariant = {
    id: 'phase7e2a-hostile-observer',
    paid: false,
    components: {
      mode: 'compatibility',
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
  const [artifact] = await runArchitectureBench({
    variants: [variant],
    cases: [architectureCase],
    bankId: 'phase7e2a-hostile-observer',
  })
  assert.deepEqual(
    artifact.strategyVersions?.observers,
    ['exact-public-observer-v1'],
  )
  assert.equal(
    artifact.architecture?.components.observerModel,
    'exact-public-observer-v1',
  )
  const clean = architectureReport([artifact]).variants[0]
  assert.equal(clean.safety.traceAttributionViolations, 0)
  assert.equal(clean.componentEvidence.promotionEvidenceEligible, true)

  const forged = structuredClone(artifact)
  forged.architecture!.components.observerModel = 'observer-off'
  const descriptorOwned = architectureReport([forged]).variants[0]
  assert.equal(descriptorOwned.safety.traceAttributionViolations, 0)
  assert.equal(descriptorOwned.components.observerModel,
    'exact-public-observer-v1')
  assert.equal(
    descriptorOwned.componentEvidence.promotionEvidenceEligible,
    true,
  )

  const rawWithoutObserver = structuredClone(artifact)
  rawWithoutObserver.architecture!.components.mode = 'raw-llm'
  for (const trace of rawWithoutObserver.decisionTraces!) {
    trace.agentMode = 'raw-llm'
    delete trace.publicObserver
  }
  const rawRejected = architectureReport([rawWithoutObserver]).variants[0]
  assert.ok(rawRejected.safety.traceAttributionViolations > 0)
  assert.equal(
    rawRejected.componentEvidence.promotionEvidenceEligible,
    false,
  )
})

test('10-player quest four exhausts but never exceeds the 252 assessment cap', async () => {
  const input = mordredProposal(10, 4)
  const output = await nativeAgent(input.game.seed)
    .decide(input.req, input.view)
  const treatment = componentPayload(
    output.trace!.components!,
    ACTOR_TARGET_TREATMENT_COMPONENT,
  )!
  const objective = componentPayload(
    output.trace!.components!,
    MORDRED_BLINDNESS_COMPONENT,
  )!
  assert.equal(
    objective.assessments.length,
    MAX_MORDRED_BLINDNESS_ASSESSMENTS,
  )
  assert.equal(objective.assessments.length, 252)
  assert.ok(
    Buffer.byteLength(JSON.stringify(treatment), 'utf8')
      <= MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
  )
  assert.ok(
    Buffer.byteLength(JSON.stringify(objective), 'utf8')
      <= MAX_MORDRED_BLINDNESS_JSON_BYTES,
  )
})
