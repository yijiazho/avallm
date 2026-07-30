// Migration phase 7D1; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readFileSync,
} from 'node:fs'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../server/agents/analysis/evil-objective-types.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  validatePrivateEvilRoleObjectiveHostJoin,
  validatePrivateEvilRoleObjectiveSnapshot,
} from '../server/agents/analysis/evil-objectives.ts'
import {
  routedRoleObjectiveModel,
} from '../server/agents/analysis/role-objective-router.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../server/agents/analysis/role-objective-types.ts'
import {
  createComposedAgent,
} from '../server/agents/composed.ts'
import {
  componentPayload,
} from '../server/agents/components/kernel.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import {
  publicCognition,
} from '../server/agents/cognition/state.ts'
import {
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  seededRoleObjectiveScorer,
} from '../server/agents/policy/score.ts'
import type {
  DecisionTrace,
} from '../server/agents/trace.ts'
import {
  parseStdioDecisionReply,
} from '../server/agents/stdio.ts'
import {
  normalizeAgentOutput,
} from '../server/agents/types.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'
import {
  createGame,
} from '../server/engine/game.ts'
import {
  viewFor,
} from '../server/engine/view.ts'
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
import {
  readDecisionFixtures,
} from '../server/eval/decision-fixtures.ts'
import {
  authoritativeDecisionSnapshots,
} from '../server/eval/trace-replay.ts'

const fixtures = readDecisionFixtures()
const fixture = (role: Role) =>
  fixtures.find((candidate) => candidate.view.role === role)!

// The retired flat fallback is refused at ingress, so an admitted trace can
// only carry its evil role objective in the generic component run.
const evilRoleObjective = (trace: DecisionTrace) =>
  trace.components
    ? componentPayload(
        trace.components,
        EVIL_ROLE_OBJECTIVE_COMPONENT,
      )
    : undefined
const goodRoleObjective = (trace: DecisionTrace) => componentPayload(
  trace.components!,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
)
const morganaRoleUtility = (trace: DecisionTrace) => componentPayload(
  trace.components!,
  GOOD_ROLE_UTILITY_COMPONENT,
)
const evilRoleObjectiveEntry = (trace: DecisionTrace) =>
  trace.components!.entries.find(
    (entry) => entry.component.id === EVIL_ROLE_OBJECTIVE_COMPONENT.id,
  )
const removeEvilRoleObjective = (trace: DecisionTrace) => {
  if (!trace.components) {
    // Nothing to remove: a componentless trace cannot carry the retired flat
    // objective, because ingress refuses the key.
    return
  }
  const index = trace.components!.entries.findIndex(
    (entry) => entry.component.id === EVIL_ROLE_OBJECTIVE_COMPONENT.id,
  )
  assert.notEqual(index, -1)
  trace.components!.entries.splice(index, 1)
}

async function routedOutput(role: Role) {
  const selected = fixture(role)
  return createComposedAgent({
    seed: 'phase7d1-router',
    roleObjectiveRouter: true,
  }).decide(selected.req, selected.view)
}

function forgeCoherentExactEvilChain(
  source: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
): DecisionTrace {
  const forged = structuredClone(source)
  const identity = forged.privateIdentity!
  const hypotheses = identity.hiddenTeamPosterior!.hypotheses
  assert.equal(hypotheses.length, 1)
  const actual = hypotheses[0].evilSeats
  const replaceable = actual.find((seat) => seat !== view.seat)!
  const replacement = Array.from(
    { length: view.playerCount },
    (_, seat) => seat,
  ).find((seat) => !actual.includes(seat))!
  identity.hiddenTeamPosterior = {
    hypotheses: [{
      evilSeats: actual
        .map((seat) => seat === replaceable ? replacement : seat)
        .sort((left, right) => left - right),
      probability: 1,
    }],
  }
  const evilBySeat = Array(view.playerCount).fill(0)
  for (const hypothesis of identity.hiddenTeamPosterior.hypotheses) {
    for (const seat of hypothesis.evilSeats) {
      evilBySeat[seat] += hypothesis.probability
    }
  }
  forged.beliefPlayerMarginals = evilBySeat.map(
    (evilProbability, seat) => ({
      seat,
      goodProbability: 1 - evilProbability,
      evilProbability,
    }),
  )
  // Deliberately presents a retired flat projection so admission refuses it.
  ;(forged as unknown as Record<string, unknown>).privateEvilRoleObjective =
    buildEvilRoleObjectiveSnapshot({
      req,
      view,
      identity,
      observer: forged.publicObserver!,
      candidates: legalCandidates(req, view),
    })
  return forged
}

function forgeUnverifiableWeightedDeletion(
  source: DecisionTrace,
): DecisionTrace {
  const forged = structuredClone(source)
  forged.beliefModelVersion = 'phase7d1-external-weighted-v1'
  forged.quality = 'weighted'
  forged.componentVersions!.belief = forged.beliefModelVersion
  forged.componentVersions!.factors = 'phase7d1-external-factor-v1'
  forged.componentVersions!.roleObjective =
    EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  forged.beliefProvenance = [{
    factorId: 'phase7d1-external-factor',
    factorVersion: 'phase7d1-external-factor-v1',
    evidenceIds: ['external:1'],
    logLikelihoodCap: 1,
    minLogLikelihood: 0,
    maxLogLikelihood: 0,
  }]
  forged.beliefTeamAssessments = undefined
  delete forged.components
  delete forged.componentPlan
  delete forged.componentVersions!.decisionComponents
  forged.version = 'decision-trace-v1'
  delete forged.privateIdentity
  forged.degradation.push(
    'identity-projection-failed',
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
  )
  return forged
}

function forgeWeightedComplete(
  source: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
): DecisionTrace {
  const forged = structuredClone(source)
  forged.beliefModelVersion = 'phase7d1-external-weighted-v1'
  forged.quality = 'weighted'
  forged.componentVersions!.belief = forged.beliefModelVersion
  forged.componentVersions!.factors = 'phase7d1-external-factor-v1'
  forged.componentVersions!.roleObjective =
    EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  forged.beliefProvenance = [{
    factorId: 'phase7d1-external-factor',
    factorVersion: 'phase7d1-external-factor-v1',
    evidenceIds: ['external:1'],
    logLikelihoodCap: 1,
    minLogLikelihood: 0,
    maxLogLikelihood: 0,
  }]
  forged.beliefTeamAssessments = undefined
  delete forged.components
  delete forged.componentPlan
  delete forged.componentVersions!.decisionComponents
  forged.version = 'decision-trace-v1'
  forged.privateIdentity!.sourceBelief.modelVersion =
    forged.beliefModelVersion
  forged.privateIdentity!.sourceBelief.quality = 'weighted'
  // Deliberately presents a retired flat projection so admission refuses it.
  ;(forged as unknown as Record<string, unknown>).privateEvilRoleObjective =
    buildEvilRoleObjectiveSnapshot({
      req,
      view,
      identity: forged.privateIdentity!,
      observer: forged.publicObserver!,
      candidates: legalCandidates(req, view),
    })
  return forged
}

function forgePublicObserver(
  source: DecisionTrace,
): DecisionTrace {
  const forged = structuredClone(source)
  const behavior = forged.publicObserver!.seats[0].behavior
  behavior.approvalIndex = behavior.approvalIndex === 0 ? 1 : 0
  return forged
}

test('role objective router is explicit, exhaustive, and policy inert', async () => {
  const expected: Record<Role, string> = {
    merlin: ROLE_OBJECTIVE_MODEL_VERSION,
    percival: ROLE_OBJECTIVE_MODEL_VERSION,
    servant: 'off',
    assassin: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
    morgana: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
    mordred: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
    oberon: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
    minion: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  }
  for (const [role, model] of Object.entries(expected) as [Role, string][]) {
    assert.equal(routedRoleObjectiveModel(role), model)
  }

  for (const role of ['assassin', 'mordred', 'oberon', 'minion'] as const) {
    const selected = fixture(role)
    const off = await createComposedAgent({
      seed: 'phase7d1-router',
    }).decide(selected.req, selected.view)
    const on = await routedOutput(role)
    assert.deepEqual(on.decision, off.decision)
    assert.deepEqual(on.trace!.candidateScores, off.trace!.candidateScores)
    assert.deepEqual(
      on.trace!.forcedPolicyResult,
      off.trace!.forcedPolicyResult,
    )
    assert.equal(
      on.trace!.componentVersions!.roleObjectiveRouter,
      ROLE_OBJECTIVE_ROUTER_VERSION,
    )
    assert.equal(
      evilRoleObjective(on.trace!)?.version,
      EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
    )
    assert.ok(evilRoleObjective(on.trace!))
    assert.equal(
      on.trace!.degradation.includes(EVIL_ROLE_OBJECTIVE_DEGRADATION),
      false,
    )
  }

  const servant = fixture('servant')
  const routedServant = await createComposedAgent({
    seed: 'phase7d1-router',
    roleObjectiveRouter: true,
  }).decide(servant.req, servant.view)
  assert.equal(
    routedServant.trace!.componentVersions!.roleObjectiveRouter,
    ROLE_OBJECTIVE_ROUTER_VERSION,
  )
  assert.equal(goodRoleObjective(routedServant.trace!), undefined)
  assert.equal(evilRoleObjective(routedServant.trace!), undefined)
  assert.equal(
    routedServant.trace!.degradation.includes(
      EVIL_ROLE_OBJECTIVE_DEGRADATION,
    ),
    false,
  )

  for (const role of ['merlin', 'percival'] as const) {
    const selected = fixture(role)
    const legacy = await createComposedAgent({
      seed: 'phase7d1-router',
      roleObjectives: true,
    }).decide(selected.req, selected.view)
    const routed = await createComposedAgent({
      seed: 'phase7d1-router',
      roleObjectiveRouter: true,
    }).decide(selected.req, selected.view)
    assert.deepEqual(routed.decision, legacy.decision)
    assert.deepEqual(
      goodRoleObjective(routed.trace!),
      goodRoleObjective(legacy.trace!),
    )
    assert.equal(evilRoleObjective(routed.trace!), undefined)
  }
})

test('visible evil and Oberon expose distinct exact joint knowledge', async () => {
  const assassin = evilRoleObjective(
    (await routedOutput('assassin')).trace!,
  )!
  assert.ok(validatePrivateEvilRoleObjectiveSnapshot(assassin))
  assert.equal(assassin.role, 'assassin')
  assert.equal(assassin.posture.kind, 'assassin-shot-preservation')
  assert.equal(assassin.coordination.kind, 'visible-partners')
  if (assassin.coordination.kind === 'visible-partners') {
    assert.deepEqual(
      assassin.coordination.seats,
      [
        fixture('assassin').view.seat,
        ...fixture('assassin').view.privateInfo.evilPartners!,
      ].sort((left, right) => left - right),
    )
    assert.equal(assassin.coordination.excludesUnseenOberon, true)
    assert.equal(assassin.coordination.knowsPartnerSpecialRoles, false)
  }
  assert.equal(assassin.oberonUnseenEvilPosterior, undefined)

  const oberon = evilRoleObjective(
    (await routedOutput('oberon')).trace!,
  )!
  assert.ok(validatePrivateEvilRoleObjectiveSnapshot(oberon))
  assert.equal(oberon.posture.kind, 'oberon-uncoordinated-disruption')
  assert.deepEqual(oberon.coordination, {
    kind: 'self-only-uncoordinated',
    semantics: 'oberon-has-no-visible-evil-partners',
    self: fixture('oberon').view.seat,
    visiblePartnerSeats: [],
    knowsPartnerSpecialRoles: false,
  })
  assert.equal(
    oberon.oberonUnseenEvilPosterior!.hypotheses.reduce(
      (sum, hypothesis) => sum + hypothesis.probability,
      0,
    ),
    1,
  )
  assert.equal(
    oberon.oberonUnseenEvilPosterior!.countDistribution.reduce(
      (sum, probability) => sum + probability,
      0,
    ),
    1,
  )
})

test('candidate failure capacity is a joint world sum with two-Fail semantics', async () => {
  const base = fixture('oberon')
  const view: PlayerView = structuredClone(base.view)
  view.phase = 'vote'
  view.currentTeam = view.players.slice(0, view.quests[3].teamSize)
    .map((player) => player.seat)
  const req: DecisionRequest = {
    kind: 'vote',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const output = await createComposedAgent({
    seed: 'phase7d1-two-fail',
    roleObjectiveRouter: true,
  }).decide(req, view)
  const snapshot = evilRoleObjective(output.trace!)!
  assert.equal(snapshot.request.failsRequired, 2)
  for (const assessment of snapshot.assessments) {
    assert.equal(
      assessment.teamFailureCapabilityProbability,
      assessment.evilCountDistribution.slice(2)
        .reduce((sum, probability) => sum + probability, 0),
    )
    assert.equal(
      assessment.publicTeamFailureCapabilityProbability,
      assessment.publicEvilCountDistribution.slice(2)
        .reduce((sum, probability) => sum + probability, 0),
    )
    assert.equal(assessment.coordination.kind, 'self-only-uncoordinated')
    assert.ok('unseenEvilOnTeamProbability' in assessment)
  }

  // A deliberately correlated hidden-team posterior: exactly one of A/B is
  // evil in every complete hypothesis. P(any) is 1, while multiplying the two
  // 0.5 marginals would incorrectly give 0.75.
  const identity = structuredClone(output.trace!.privateIdentity!)
  const self = view.seat
  const others = view.players.map((player) => player.seat)
    .filter((seat) => seat !== self)
  const [a, b, common] = others
  identity.hiddenTeamPosterior = {
    hypotheses: [
      {
        evilSeats: [self, a, common].sort((left, right) => left - right),
        probability: 0.5,
      },
      {
        evilSeats: [self, b, common].sort((left, right) => left - right),
        probability: 0.5,
      },
    ],
  }
  view.round = 1
  view.proposalNum = 1
  view.currentTeam = [a, b].sort((left, right) => left - right)
  const correlatedReq = { ...req, round: 1, proposalNum: 1 }
  const correlated = buildEvilRoleObjectiveSnapshot({
    req: correlatedReq,
    view,
    identity,
    observer: output.trace!.publicObserver!,
    candidates: legalCandidates(correlatedReq, view),
  })
  const approve = correlated.assessments.find(
    (assessment) => assessment.direction === 'support',
  )!
  assert.deepEqual(approve.evilCountDistribution, [0, 1, 0])
  assert.equal(approve.teamFailureCapabilityProbability, 1)
  assert.notEqual(approve.teamFailureCapabilityProbability, 0.75)
})

test('public standing keeps exact counts and represents no data as null', async () => {
  const game = createGame({
    seed: 'phase7d1-no-public-data',
    playerCount: 5,
  })
  const assassin = game.players.find((player) => player.role === 'assassin')!
  const view = viewFor(game, assassin.seat)
  const req: DecisionRequest = {
    kind: 'propose',
    seat: assassin.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const snapshot = evilRoleObjective((await createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
  }).decide(req, view)).trace!)!
  for (const standing of snapshot.publicStanding) {
    assert.equal(
      standing.evilWorldNumerator / standing.feasibleWorldDenominator,
      standing.evilProbability,
    )
    for (const observation of [
      standing.selection,
      standing.approval,
      standing.failedQuestExposure,
    ]) {
      assert.equal(observation.denominator, 0)
      assert.equal(observation.numerator, 0)
      assert.equal(observation.index, null)
    }
    assert.equal(standing.burnProxyIndex, null)
    assert.equal(standing.coverProxyIndex, null)
    assert.equal(standing.standingProxyIndex, null)
  }
})

test('strict validation rejects mutation, sparse data, accessors, and deletion', async () => {
  const selected = fixture('mordred')
  const output = await createComposedAgent({
    seed: 'phase7d1-router',
    privateIdentity: {
      roleQueries: [{ roles: ['merlin'] }],
      hiddenTeam: false,
    },
    roleObjectiveRouter: true,
  }).decide(selected.req, selected.view)
  const trace = output.trace!
  const objective = evilRoleObjective(trace)!
  assert.ok(validatePrivateEvilRoleObjectiveSnapshot(objective))
  assert.ok(validatePrivateEvilRoleObjectiveHostJoin(objective, {
    req: selected.req,
    view: selected.view,
    identity: trace.privateIdentity!,
    observer: trace.publicObserver!,
    candidates: legalCandidates(selected.req, selected.view),
  }))

  const arithmetic = structuredClone(objective)
  arithmetic.assessments[0].teamFailureCapabilityProbability =
    arithmetic.assessments[0].teamFailureCapabilityProbability === 1
      ? 0.99
      : arithmetic.assessments[0].teamFailureCapabilityProbability + 0.01
  assert.equal(validatePrivateEvilRoleObjectiveSnapshot(arithmetic), false)
  assert.equal(validatePrivateEvilRoleObjectiveHostJoin(arithmetic, {
    req: selected.req,
    view: selected.view,
    identity: trace.privateIdentity!,
    observer: trace.publicObserver!,
    candidates: legalCandidates(selected.req, selected.view),
  }), false)

  const sparse = structuredClone(objective)
  delete (sparse.publicStanding as unknown[])[0]
  assert.equal(validatePrivateEvilRoleObjectiveSnapshot(sparse), false)

  const accessor = structuredClone(objective)
  Object.defineProperty(accessor.source, 'beliefModelVersion', {
    enumerable: true,
    get: () => objective.source.beliefModelVersion,
  })
  assert.equal(validatePrivateEvilRoleObjectiveSnapshot(accessor), false)

  const parsed = parseStdioDecisionReply(
    selected.req,
    {
      decision: output.decision,
      trace,
    },
    'phase7d1 external',
    selected.view,
  )
  assert.deepEqual(normalizeAgentOutput(parsed).decision, output.decision)
  const deleted = structuredClone(trace)
  removeEvilRoleObjective(deleted)
  deleted.degradation.push(EVIL_ROLE_OBJECTIVE_DEGRADATION)
  assert.deepEqual(
    parseStdioDecisionReply(
      selected.req,
      { decision: output.decision, trace: deleted },
      'phase7d1 external',
      selected.view,
    ),
    output.decision,
  )

  const scopeAndPayloadDeletion = structuredClone(trace)
  scopeAndPayloadDeletion.privateIdentity!.scope.hiddenTeam = false
  delete scopeAndPayloadDeletion.privateIdentity!.hiddenTeamPosterior
  removeEvilRoleObjective(scopeAndPayloadDeletion)
  scopeAndPayloadDeletion.degradation.push(
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
  )
  assert.deepEqual(
    parseStdioDecisionReply(
      selected.req,
      {
        decision: output.decision,
        trace: scopeAndPayloadDeletion,
      },
      'phase7d1 exact scope substitution',
      selected.view,
    ),
    output.decision,
  )
})

test('stdio rejects coherent exact forgery but preserves typed weighted degradation', async () => {
  const selected = fixture('mordred')
  const output = await createComposedAgent({
    seed: 'phase7d1-router',
    privateIdentity: {
      roleQueries: [{ roles: ['merlin'] }],
      hiddenTeam: false,
    },
    roleObjectiveRouter: true,
  }).decide(selected.req, selected.view)
  const coherentForgery = forgeCoherentExactEvilChain(
    output.trace!,
    selected.req,
    selected.view,
  )
  assert.deepEqual(
    parseStdioDecisionReply(
      selected.req,
      { decision: output.decision, trace: coherentForgery },
      'phase7d1 coherent exact forgery',
      selected.view,
    ),
    output.decision,
  )

  const weightedDeletion = forgeUnverifiableWeightedDeletion(
    output.trace!,
  )
  assert.deepEqual(
    normalizeAgentOutput(parseStdioDecisionReply(
      selected.req,
      { decision: output.decision, trace: weightedDeletion },
      'phase7d1 typed weighted degradation',
      selected.view,
    )).decision,
    output.decision,
  )
  assert.deepEqual(
    parseStdioDecisionReply(
      selected.req,
      {
        decision: output.decision,
        trace: forgePublicObserver(weightedDeletion),
      },
      'phase7d1 forged weighted observer',
      selected.view,
    ),
    output.decision,
  )

  const partialScope = forgeWeightedComplete(
    output.trace!,
    selected.req,
    selected.view,
  )
  partialScope.privateIdentity!.scope.hiddenTeam = false
  delete partialScope.privateIdentity!.hiddenTeamPosterior
  delete (partialScope as unknown as Record<string, unknown>)
    .privateEvilRoleObjective
  partialScope.degradation.push(EVIL_ROLE_OBJECTIVE_DEGRADATION)
  assert.deepEqual(
    parseStdioDecisionReply(
      selected.req,
      { decision: output.decision, trace: partialScope },
      'phase7d1 weighted partial hidden-team scope',
      selected.view,
    ),
    output.decision,
  )

  const labelPayloadMismatch = forgeWeightedComplete(
    output.trace!,
    selected.req,
    selected.view,
  )
  labelPayloadMismatch.degradation.push('identity-projection-failed')
  assert.deepEqual(
    parseStdioDecisionReply(
      selected.req,
      { decision: output.decision, trace: labelPayloadMismatch },
      'phase7d1 weighted identity label payload mismatch',
      selected.view,
    ),
    output.decision,
  )
})

test('evil objective remains private from public cognition, prompts, and client', async () => {
  const output = await routedOutput('assassin')
  const privateState = {
    viewerSeat: fixture('assassin').view.seat,
    throughSeq: output.trace!.beliefThroughSeq,
    evidence: [],
    belief: {} as never,
    commitments: [],
    languageReads: [],
    languageCursor: {} as never,
    evilRoleObjective: evilRoleObjective(output.trace!),
    versions: {
      schema: 'cognition-v1',
      evidence: 'typed-evidence-v1',
      commitments: 'literal-commitments-v1',
      belief: 'exact-constraints-v1',
      mechanicalBelief: 'exact-constraints-v1',
      beliefPipeline: 'exact-constraints-v1',
      languageEvidence: 'off',
      roleObjective: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
      roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
    },
  } as const
  assert.doesNotMatch(
    JSON.stringify(publicCognition(privateState as never)),
    /evilRoleObjective|unseenEvil|failureCapability/,
  )
  for (const owner of [
    'server/agents/prompts.ts',
    'server/agents/communication/composed-renderer.ts',
    'client/src/App.tsx',
  ]) {
    assert.doesNotMatch(
      readFileSync(owner, 'utf8'),
      /privateEvilRoleObjective|EVIL_ROLE_OBJECTIVE_MODEL_VERSION/,
    )
  }
})

function routerVariant(): ArchitectureVariant {
  return {
    id: 'phase7d1-router',
    paid: false,
    components: {
      mode: 'compatibility',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      beliefVisibility: 'none',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      identityModel: 'joint-identity-projection-v1',
      roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
      decisionComponents: 'decision-component-run-v1',
      analysis: 'situation-analysis-v1',
      candidates: 'legal-candidates-v1',
      forcedPolicy: 'forced-policy-v1',
      policy: 'composed-policy-v1',
      scorer: 'compatibility-scorer-v1',
      planner: 'planner-off',
      prompt: 'composed-typed-context-v2',
      renderer: 'composed-policy-renderer-v2',
      communication: 'plan-voice-v2',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: false,
      },
      roleObjectiveRouter: true,
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
}

test('architecture bank binds router, resolved model, artifact, and report', async () => {
  const artifacts = await runArchitectureBench({
    variants: [routerVariant()],
    cases: ARCHITECTURE_BANK,
    bankId: 'phase7d1-router',
  })
  assert.equal(artifacts.length, ARCHITECTURE_BANK.length)
  const report = architectureReport(artifacts)
  assert.ok(report.variants.every(
    (variant) => variant.safety.traceAttributionViolations === 0,
  ))
  for (const artifact of artifacts) {
    const expected = routedRoleObjectiveModel(
      artifact.architecture!.targetRole,
    )
    assert.deepEqual(
      artifact.strategyVersions?.roleObjectiveRouters,
      [ROLE_OBJECTIVE_ROUTER_VERSION],
    )
    assert.equal(artifact.strategyVersions?.roleObjectives, undefined)
    for (const trace of artifact.decisionTraces!) {
      assert.equal(
        goodRoleObjective(trace)?.version
          ?? evilRoleObjective(trace)?.version,
        expected === 'off' ? undefined : expected,
      )
      assert.equal(
        evilRoleObjective(trace) !== undefined,
        expected === EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
      )
      const postures: Partial<Record<Role, string>> = {
        assassin: 'assassin-shot-preservation',
        morgana: 'morgana-counterfeit-cover',
        mordred: 'mordred-deep-cover',
        minion: 'minion-failure-banking',
        oberon: 'oberon-uncoordinated-disruption',
      }
      if (evilRoleObjective(trace)) {
        assert.equal(
          evilRoleObjective(trace).posture.kind,
          postures[artifact.architecture!.targetRole],
        )
      }
    }
  }

  const evilArtifact = artifacts.find(
    (artifact) => artifact.architecture!.targetRole === 'oberon',
  )!
  const forged = structuredClone(evilArtifact)
  removeEvilRoleObjective(forged.decisionTraces![0])
  forged.decisionTraces![0].degradation.push(
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
  )
  assert.ok(
    architectureReport([forged]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedRouter = structuredClone(evilArtifact)
  delete forgedRouter.strategyVersions!.roleObjectiveRouters
  const descriptorOwned = architectureReport([forgedRouter]).variants[0]
  assert.equal(descriptorOwned.safety.traceAttributionViolations, 0)
  assert.equal(descriptorOwned.safety.promotionEvidenceEligible, true)

  const mordredArtifact = artifacts.find(
    (artifact) => artifact.architecture!.targetRole === 'mordred',
  )!
  const coMutated = structuredClone(mordredArtifact)
  const coMutatedTrace = coMutated.decisionTraces![0]
  coMutatedTrace.privateIdentity!.scope.hiddenTeam = false
  delete coMutatedTrace.privateIdentity!.hiddenTeamPosterior
  removeEvilRoleObjective(coMutatedTrace)
  coMutatedTrace.degradation.push(EVIL_ROLE_OBJECTIVE_DEGRADATION)
  assert.ok(
    architectureReport([coMutated]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const coherentArtifact = structuredClone(mordredArtifact)
  const coherentTrace = coherentArtifact.decisionTraces![0]
  const coherentSnapshot = authoritativeDecisionSnapshots(
    coherentArtifact,
    coherentArtifact.architecture!.targetSeat,
  ).get(coherentTrace.decisionId)!
  coherentArtifact.decisionTraces![0] = forgeCoherentExactEvilChain(
    coherentTrace,
    coherentSnapshot.req,
    coherentSnapshot.view,
  )
  assert.ok(
    architectureReport([coherentArtifact]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const generationForgery: ArchitectureVariant = {
    ...routerVariant(),
    id: 'phase7d1-router-generation-forgery',
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: false,
      },
      roleObjectiveRouter: true,
      onDecisionTrace: (captured) => {
        const forged = structuredClone(captured)
        forged.privateIdentity!.scope.hiddenTeam = false
        delete forged.privateIdentity!.hiddenTeamPosterior
        removeEvilRoleObjective(forged)
        forged.degradation.push(EVIL_ROLE_OBJECTIVE_DEGRADATION)
        context.onDecisionTrace?.(forged)
      },
    }),
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [generationForgery],
      cases: [
        ARCHITECTURE_BANK.find(
          (candidate) => candidate.targetRole === 'mordred',
        )!,
      ],
      bankId: 'phase7d1-router-generation-forgery',
    }),
    /trace components do not match declared components/,
  )

  const coherentGenerationForgery: ArchitectureVariant = {
    ...routerVariant(),
    id: 'phase7d1-router-coherent-generation-forgery',
    createTargetAgent: (context) => {
      let forgedOnce = false
      const inner = createComposedAgent({
        seed: context.seed,
        roleObjectiveRouter: true,
      })
      return {
        async decide(req, view) {
          const output = await inner.decide(req, view)
          const normalized = normalizeAgentOutput(output)
          const captured = normalized.trace!
          const hypotheses =
            captured.privateIdentity?.hiddenTeamPosterior?.hypotheses
          if (!forgedOnce && hypotheses?.length === 1) {
            forgedOnce = true
            context.onDecisionTrace?.(forgeCoherentExactEvilChain(
              captured,
              captured.request,
              view,
            ))
          } else {
            context.onDecisionTrace?.(captured)
          }
          return output
        },
      }
    },
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [coherentGenerationForgery],
      cases: [
        ARCHITECTURE_BANK.find(
          (candidate) => candidate.targetRole === 'mordred',
        )!,
      ],
      bankId: 'phase7d1-router-coherent-generation-forgery',
    }),
    /trace components do not match declared components/,
  )

  const {
    decisionComponents: _weightedDecisionComponents,
    ...weightedComponents
  } = routerVariant().components
  const weightedCompleteVariant: ArchitectureVariant = {
    ...routerVariant(),
    id: 'phase7d1-weighted-complete',
    components: {
      ...weightedComponents,
      belief: 'phase7d1-external-weighted-v1',
      factors: 'phase7d1-external-factor-v1',
    },
    createTargetAgent: (context) => {
      const inner = createComposedAgent({
        seed: context.seed,
        privateIdentity: {
          roleQueries: [{ roles: ['merlin'] }],
          hiddenTeam: false,
        },
        roleObjectiveRouter: true,
      })
      return {
        async decide(req, view) {
          const output = await inner.decide(req, view)
          const captured = normalizeAgentOutput(output).trace!
          context.onDecisionTrace?.(forgeWeightedComplete(
            captured,
            req,
            view,
          ))
          return output
        },
      }
    },
  }
  // An external producer can no longer present a complete flat role objective.
  // The retired payload is refused at canonical ingress, so generation fails
  // before any report rather than yielding a diagnostic artifact. The declared
  // plus degraded shape exercised by the weighted-external-degradation variant
  // below remains the readable external weighted case.
  await assert.rejects(
    runArchitectureBench({
      variants: [weightedCompleteVariant],
      cases: [
        ARCHITECTURE_BANK.find(
          (candidate) => candidate.targetRole === 'mordred',
        )!,
      ],
      bankId: 'phase7d1-weighted-complete',
    }),
    /trace components do not match declared components/,
  )

  const partialGenerationVariant: ArchitectureVariant = {
    ...weightedCompleteVariant,
    id: 'phase7d1-weighted-partial-generation',
    createTargetAgent: (context) => {
      const inner = createComposedAgent({
        seed: context.seed,
        privateIdentity: {
          roleQueries: [{ roles: ['merlin'] }],
          hiddenTeam: false,
        },
        roleObjectiveRouter: true,
      })
      return {
        async decide(req, view) {
          const output = await inner.decide(req, view)
          const captured = forgeWeightedComplete(
            normalizeAgentOutput(output).trace!,
            req,
            view,
          )
          captured.privateIdentity!.scope.hiddenTeam = false
          delete captured.privateIdentity!.hiddenTeamPosterior
          removeEvilRoleObjective(captured)
          captured.degradation.push(EVIL_ROLE_OBJECTIVE_DEGRADATION)
          context.onDecisionTrace?.(captured)
          return output
        },
      }
    },
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [partialGenerationVariant],
      cases: [
        ARCHITECTURE_BANK.find(
          (candidate) => candidate.targetRole === 'mordred',
        )!,
      ],
      bankId: 'phase7d1-weighted-partial-generation',
    }),
    /trace components do not match declared components/,
  )
})

test('architecture evaluation preserves narrowly typed weighted dependency degradation', async () => {
  const {
    decisionComponents: _weightedDecisionComponents,
    ...weightedComponents
  } = routerVariant().components
  const weightedVariant: ArchitectureVariant = {
    ...routerVariant(),
    id: 'phase7d1-weighted-external-degradation',
    components: {
      ...weightedComponents,
      belief: 'phase7d1-external-weighted-v1',
      factors: 'phase7d1-external-factor-v1',
    },
    createTargetAgent: (context) => {
      const composed = createComposedAgent({
        seed: context.seed,
        roleObjectiveRouter: true,
        onDecisionTrace: (captured) => {
          context.onDecisionTrace?.(
            forgeUnverifiableWeightedDeletion(captured),
          )
        },
      })
      // This fixture deliberately models a self-contained external producer.
      // It must not expose the composed host's trusted resolved-brain witness.
      const { resolvedBrain: _resolvedBrain, ...external } = composed
      return external
    },
  }
  const [artifact] = await runArchitectureBench({
    variants: [weightedVariant],
    cases: [
      ARCHITECTURE_BANK.find(
        (candidate) => candidate.targetRole === 'oberon',
      )!,
    ],
    bankId: 'phase7d1-weighted-external-degradation',
  })
  const report = architectureReport([artifact])
  assert.equal(
    report.variants[0].safety.traceAttributionViolations,
    0,
  )
  assert.ok(artifact.decisionTraces!.every(
    (trace) =>
      trace.privateIdentity === undefined
      && evilRoleObjective(trace) === undefined
      && trace.degradation.includes('identity-projection-failed')
      && trace.degradation.includes(EVIL_ROLE_OBJECTIVE_DEGRADATION),
  ))

  const forgedArtifact = structuredClone(artifact)
  forgedArtifact.decisionTraces![0] = forgePublicObserver(
    forgedArtifact.decisionTraces![0],
  )
  assert.ok(
    architectureReport([forgedArtifact]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const forgedObserverVariant: ArchitectureVariant = {
    ...weightedVariant,
    id: 'phase7d1-weighted-forged-public-observer',
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      roleObjectiveRouter: true,
      onDecisionTrace: (captured) => {
        context.onDecisionTrace?.(forgePublicObserver(
          forgeUnverifiableWeightedDeletion(captured),
        ))
      },
    }),
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [forgedObserverVariant],
      cases: [
        ARCHITECTURE_BANK.find(
          (candidate) => candidate.targetRole === 'oberon',
        )!,
      ],
      bankId: 'phase7d1-weighted-forged-public-observer',
    }),
    /trace components do not match declared components/,
  )
})

test('ten-player quest-four surface is bounded and name invariant', async () => {
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
  view.phase = 'proposal'
  view.round = 4
  view.proposalNum = 1
  const req: DecisionRequest = {
    kind: 'propose',
    seat: target.seat,
    round: 4,
    proposalNum: 1,
  }
  const first = await createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
  }).decide(req, view)
  const renamed = structuredClone(view)
  renamed.name = 'Renamed Target'
  renamed.players = renamed.players.map((player) => ({
    ...player,
    name: `Renamed ${player.seat}`,
  }))
  const second = await createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
  }).decide(req, renamed)
  const objective = evilRoleObjective(first.trace!)!
  assert.equal(objective.assessments.length, 252)
  assert.ok(
    Buffer.byteLength(JSON.stringify(objective), 'utf8')
      <= MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
  )
  assert.deepEqual(
    evilRoleObjective(second.trace!),
    objective,
  )
  assert.deepEqual(second.decision, first.decision)
})

test('router composes with C2 while evil and Servant use the seeded base', async () => {
  const variant: ArchitectureVariant = {
    ...routerVariant(),
    id: 'phase7d1-router-c2',
    components: {
      ...routerVariant().components,
      mode: 'structured-only',
      scorer: ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: false,
      },
      roleObjectiveRouter: true,
      scorer: seededRoleObjectiveScorer,
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  const cases = [
    ARCHITECTURE_BANK.find((candidate) => candidate.targetRole === 'merlin')!,
    ARCHITECTURE_BANK.find((candidate) => candidate.targetRole === 'morgana')!,
    ARCHITECTURE_BANK.find((candidate) => candidate.targetRole === 'servant')!,
  ]
  const artifacts = await runArchitectureBench({
    variants: [variant],
    cases,
    bankId: 'phase7d1-router-c2',
  })
  assert.equal(
    architectureReport(artifacts).variants[0]
      .safety.traceAttributionViolations,
    0,
  )
  for (const artifact of artifacts) {
    const role = artifact.architecture!.targetRole
    for (const trace of artifact.decisionTraces!) {
      const c2Applicable =
        role === 'merlin'
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
      assert.equal(
        morganaRoleUtility(trace) !== undefined,
        c2Applicable,
      )
      assert.equal(
        trace.componentVersions?.scorer,
        c2Applicable
          ? 'merlin-percival-role-seeded-band-v1'
          : 'good-proposal-vote-seeded-band-v1',
      )
      assert.equal(
        trace.componentVersions?.configuredScorer,
        c2Applicable ? undefined : ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      )
      assert.equal(
        evilRoleObjective(trace) !== undefined,
        role === 'morgana',
      )
    }
  }
})
