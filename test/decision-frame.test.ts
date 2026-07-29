import test from 'node:test'
import assert from 'node:assert/strict'
import { reconstructCognition } from '../server/agents/cognition/state.ts'
import type { SituationAnalysis } from '../server/agents/analysis/types.ts'
import {
  createComposedAgent,
  NO_VOICE_VERSION,
} from '../server/agents/composed.ts'
import {
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_SITUATION_INPUT,
} from '../server/agents/components/native-score-components.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../server/agents/components/robust-evil-quest-card.ts'
import {
  componentEnvelope,
  componentPayload,
  runDecisionComponents,
  type DecisionComponentTrustedHostInputProviders,
} from '../server/agents/components/kernel.ts'
import {
  createDecisionComponentRegistry,
} from '../server/agents/components/registry.ts'
import {
  resolveComposedBrain,
  type ResolvedComposedBrain,
} from '../server/agents/components/resolved-brain.ts'
import type {
  ComponentToken,
  DecisionComponentDefinition,
} from '../server/agents/components/types.ts'
import {
  canonicalDecisionFrame,
  commitDecision,
  prepareNativeScoreLayers,
  selectDecisionCandidate,
  withDecisionAnalysis,
  withDecisionVoice,
  withCustomScoring,
  withLegalCandidates,
  withNativeResolvedComponents,
  withResolvedDecisionLayers,
  withResolvedComponents,
  withUniversalForcedPolicy,
  type ComponentsResolvedDecisionFrame,
  type DecisionAnalysisPlan,
  type ScoredDecisionFrame,
} from '../server/agents/policy/decision-frame.ts'
import {
  DECISION_PLAN_VERSION,
  defaultCommunicationIntent,
  selectedStrategicReasonCodes,
  type CommunicationIntent,
  type DecisionPlan,
} from '../server/agents/policy/plan.ts'
import { COMPOSED_POLICY_VERSION } from '../server/agents/brain.ts'
import type { ForcedPolicyResult } from '../server/agents/policy/types.ts'
import {
  roleObjectiveScorer,
  type CandidateScore,
  type CandidateScorer,
} from '../server/agents/policy/score.ts'
import {
  detachTrustedPolicyData,
} from '../server/agents/policy/trusted-data.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'

const EMPTY_BRAIN = resolveComposedBrain({
  requestedComponents: [],
  hostCapabilities: [],
  configuredPipeline: testConfiguredPipeline(),
}, createDecisionComponentRegistry([]))

interface SnapshotProbe {
  readonly requestSeat: number
  readonly firstPlayerName: string
}

const SNAPSHOT_PROBE: ComponentToken<SnapshotProbe> = {
  id: 'decision-frame.snapshot-probe',
  version: 'v1',
  kind: 'projection',
  privacy: 'private',
}

function admitSnapshotProbe(
  value: unknown,
): ReturnType<
  DecisionComponentDefinition<SnapshotProbe>['validateDetached']
> {
  const candidate = value as Partial<SnapshotProbe>
  if (
    candidate
    && Number.isSafeInteger(candidate.requestSeat)
    && typeof candidate.firstPlayerName === 'string'
  ) {
    return {
      admitted: true,
      payload: {
        requestSeat: candidate.requestSeat!,
        firstPlayerName: candidate.firstPlayerName,
      },
      verification: 'exact',
      promotionEligible: true,
    }
  }
  return {
    admitted: false,
    degradationCode: 'snapshot-probe-invalid',
  }
}

const SNAPSHOT_PROBE_COMPONENT: DecisionComponentDefinition<SnapshotProbe> = {
  token: SNAPSHOT_PROBE,
  source: 'native',
  dependencies: [],
  requiredHostInputs: [],
  hostRequirements: [],
  maxPayloadBytes: 256,
  degradationCode: 'snapshot-probe-failed',
  applies: (context) => context.privacy === 'private',
  execute(context) {
    if (context.privacy !== 'private') {
      throw new Error('private snapshot probe received public context')
    }
    return {
      status: 'produced',
      envelope: componentEnvelope(SNAPSHOT_PROBE, {
        requestSeat: context.request.seat,
        firstPlayerName: context.view.players[0].name,
      }),
    }
  },
  validateDetached: admitSnapshotProbe,
  admitHost({ payload, host }) {
    if (
      host.privacy === 'private'
      && payload.requestSeat === host.request.seat
      && payload.firstPlayerName === host.view.players[0].name
    ) return admitSnapshotProbe(payload)
    return {
      admitted: false,
      degradationCode: 'snapshot-probe-host-mismatch',
    }
  },
}

const SNAPSHOT_BRAIN = resolveComposedBrain({
  requestedComponents: [SNAPSHOT_PROBE],
  hostCapabilities: [],
  configuredPipeline: testConfiguredPipeline(),
}, createDecisionComponentRegistry([SNAPSHOT_PROBE_COMPONENT]))

async function resolvedFrame(
  request: DecisionRequest,
  view: PlayerView,
  options: {
    brain?: ResolvedComposedBrain
    analysisPlan?: DecisionAnalysisPlan
    trusted?: (
      frame: ReturnType<typeof withUniversalForcedPolicy>,
    ) => DecisionComponentTrustedHostInputProviders
  } = {},
): Promise<ComponentsResolvedDecisionFrame> {
  const canonical = canonicalDecisionFrame(request, view)
  const candidates = withLegalCandidates(canonical)
  const analyzed = withDecisionAnalysis(
    candidates,
    reconstructCognition(view),
    options.analysisPlan ?? 'candidate-teams',
  )
  const universal = withUniversalForcedPolicy(analyzed)
  return withResolvedComponents(
    universal,
    options.brain ?? EMPTY_BRAIN,
    undefined,
    options.trusted,
  )
}

function completeFromCurrentTrace(
  frame: ComponentsResolvedDecisionFrame,
  trace: NonNullable<
    Awaited<ReturnType<ReturnType<typeof createComposedAgent>['decide']>>['trace']
  >,
  seed: string,
  degradation: readonly string[] = trace.degradation,
): ScoredDecisionFrame {
  const scorer = {
    version: trace.componentVersions!.scorer,
    score: () => trace.candidateScores!,
  }
  return withCustomScoring(
    withResolvedDecisionLayers(frame, EMPTY_BRAIN),
    () => ({
      deterministicSeed: seed,
      compatibilityCandidateId: trace.structuredCandidateId,
      ...(trace.privateRoleUtility
        ? { roleUtility: trace.privateRoleUtility }
        : {}),
      ...(trace.privateEvilRoleUtility
        ? { evilRoleUtility: trace.privateEvilRoleUtility }
        : {}),
      ...(trace.privateMorganaRoleUtility
        ? { morganaRoleUtility: trace.privateMorganaRoleUtility }
        : {}),
    }),
    (_context, run) => ({
      appliedScorer: scorer,
      scores: trace.candidateScores!,
      degradation,
      componentRun: run,
    }),
  )
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

function currentPlan(
  frame: ReturnType<typeof selectDecisionCandidate>,
  strategicReasons: readonly string[],
  communication?: CommunicationIntent,
): DecisionPlan {
  return {
    version: DECISION_PLAN_VERSION,
    request: structuredClone(frame.request) as DecisionRequest,
    decision: mechanical(frame.selected.candidate.decision as Decision),
    candidateId: frame.selected.candidate.id,
    policyId: COMPOSED_POLICY_VERSION,
    reasons: [
      ...frame.effectiveForced.reasonCodes,
      ...strategicReasons,
    ],
    beliefThroughSeq: frame.belief.throughSeq,
    candidateScores:
      structuredClone(frame.scores) as readonly CandidateScore[],
    ...(communication ? { communication } : {}),
  }
}

test('trusted detachment has one order-preserving deep-freeze contract', () => {
  const source = {
    zeta: 1,
    alpha: { second: 2, first: 1 },
    rows: [{ beta: 2, alpha: 1 }],
  }
  const bytes = JSON.stringify(source)
  const detached = detachTrustedPolicyData(source)
  assert.equal(JSON.stringify(detached), bytes)
  assert.notEqual(detached.alpha, source.alpha)
  assert.ok(Object.isFrozen(detached.rows[0]))
  source.alpha.second = 99
  assert.equal(JSON.stringify(detached), bytes)
})

test('the frame runs in actual order with one component-resolution transition', async () => {
  const fixture = readDecisionFixtures()[0]
  const canonical = canonicalDecisionFrame(fixture.req, fixture.view)
  assert.deepEqual(
    Object.keys(canonical),
    ['stage', 'version', 'request', 'view'],
  )
  const candidates = withLegalCandidates(canonical)
  assert.equal(candidates.stage, 'legal-candidates')
  const analyzed = withDecisionAnalysis(
    candidates,
    reconstructCognition(fixture.view),
    'candidate-teams',
  )
  assert.equal(analyzed.stage, 'analyzed')
  const universal = withUniversalForcedPolicy(analyzed)
  assert.equal(universal.stage, 'universal-forced')
  assert.equal('componentRun' in universal, false)

  let providerFrame: typeof universal | undefined
  const resolved = await withResolvedComponents(
    universal,
    EMPTY_BRAIN,
    undefined,
    (frame) => {
      providerFrame = frame
      assert.equal(frame.analysis, universal.analysis)
      assert.equal(frame.universalForced, universal.universalForced)
      return { providers: [] }
    },
  )
  assert.equal(resolved.stage, 'components-resolved')
  assert.equal(providerFrame, universal)
})

test('component execution cannot follow post-canonical source mutation', async () => {
  const fixture = readDecisionFixtures()[0]
  const request = structuredClone(fixture.req)
  const view = structuredClone(fixture.view)
  const canonical = canonicalDecisionFrame(request, view)
  const candidates = withLegalCandidates(canonical)
  const analyzed = withDecisionAnalysis(
    candidates,
    reconstructCognition(structuredClone(canonical.view) as PlayerView),
    'candidate-teams',
  )
  const universal = withUniversalForcedPolicy(analyzed)

  request.seat = (request.seat + 1) % fixture.view.players.length
  view.players[0].name = `${view.players[0].name} mutated`

  const resolved = await withResolvedComponents(
    universal,
    SNAPSHOT_BRAIN,
  )
  assert.deepEqual(
    componentPayload(resolved.componentRun, SNAPSHOT_PROBE),
    {
      requestSeat: fixture.req.seat,
      firstPlayerName: fixture.view.players[0].name,
    },
  )
})

test('ordinary empty component execution keeps its established singleton identity', async () => {
  const fixture = readDecisionFixtures()[0]
  const first = await runDecisionComponents(
    EMPTY_BRAIN,
    fixture.req,
    fixture.view,
  )
  const second = await runDecisionComponents(
    EMPTY_BRAIN,
    structuredClone(fixture.req),
    structuredClone(fixture.view),
  )
  assert.equal(first, second)
})

test('default frame composition preserves every frozen decision seam', async () => {
  for (const fixture of readDecisionFixtures()) {
    const output = await createComposedAgent({
      seed: fixture.source.seed,
    }).decide(fixture.req, fixture.view)
    const trace = output.trace!
    const resolved = await resolvedFrame(fixture.req, fixture.view)
    const scored = completeFromCurrentTrace(
      resolved,
      trace,
      fixture.source.seed,
    )
    const selected = selectDecisionCandidate(scored, { kind: 'not-run' })
    const scoreSurface =
      structuredClone(scored.scores) as readonly CandidateScore[]
    const chosenScore = scoreSurface.find(
      (score) => score.candidateId === selected.selected.candidate.id,
    )!
    const strategicReasons = selectedStrategicReasonCodes(
      chosenScore,
      scoreSurface,
    )
    const communication = defaultCommunicationIntent(
      mechanical(
        structuredClone(selected.selected.candidate.decision) as Decision,
      ),
      selected.analysis.factCodes,
      chosenScore,
      scoreSurface,
    )
    const committed = commitDecision(
      selected,
      currentPlan(selected, strategicReasons, communication),
    )
    const voiced = withDecisionVoice(committed, {
      version: NO_VOICE_VERSION,
      result: output.decision,
    })

    assert.equal(
      JSON.stringify(scored.scores),
      JSON.stringify(trace.candidateScores),
      fixture.id,
    )
    assert.equal(scored.structuredCandidateId, trace.structuredCandidateId)
    assert.equal(selected.selected.candidate.id, trace.chosenCandidateId)
    assert.equal(
      JSON.stringify(committed.plan.communication),
      JSON.stringify(trace.communicationIntent),
      fixture.id,
    )
    assert.equal(
      JSON.stringify(committed.plan.reasons),
      JSON.stringify([
        ...trace.forcedPolicyResult!.reasonCodes,
        ...strategicReasons,
      ]),
      fixture.id,
    )
    assert.equal(
      JSON.stringify(voiced.result),
      JSON.stringify(output.decision),
      fixture.id,
    )
    assert.equal(voiced.voice.applied, false, fixture.id)
    assert.equal(
      JSON.stringify(resolved.componentRun),
      JSON.stringify(trace.components),
      fixture.id,
    )
  }
})

const malformed = (source: CandidateScorer): CandidateScorer => ({
  ...source,
  score: () => [],
})

test('one frame-bound scoring capability preserves both fallback outcomes', async () => {
  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.id === 'merlin-opening-proposal',
  )!
  const matching = malformed(roleObjectiveScorer)
  const doubleFailure = malformed({
    ...roleObjectiveScorer,
    baseScorer: malformed(roleObjectiveScorer.baseScorer!),
  })
  for (const scenario of [
    {
      name: 'matching-base',
      scorer: matching,
      expected: [
        'scorer-invalid-output',
        'role-objective-scorer-failed',
      ],
    },
    {
      name: 'hard-double-failure',
      scorer: doubleFailure,
      expected: [
        'scorer-invalid-output',
        'role-objective-scorer-failed',
      ],
    },
  ]) {
    const output = await createComposedAgent({
      seed: fixture.source.seed,
      roleObjectives: true,
      scorer: scenario.scorer,
    }).decide(fixture.req, fixture.view)
    const trace = output.trace!
    const frame = await resolvedFrame(fixture.req, fixture.view, {
      analysisPlan: 'good-proposal',
    })
    const scored = completeFromCurrentTrace(
      frame,
      trace,
      fixture.source.seed,
    )
    assert.deepEqual(
      scored.degradation.slice(-scenario.expected.length),
      scenario.expected,
      scenario.name,
    )
    assert.equal(scored.scorerVersion, trace.componentVersions!.scorer)
    assert.equal(
      JSON.stringify(scored.scores),
      JSON.stringify(trace.candidateScores),
      scenario.name,
    )
  }
})

const questFixture = readDecisionFixtures().find(
  (fixture) => fixture.id === 'oberon-two-fail-quest',
)!

function coordinatedQuestView(
  seat: Seat,
  visibleEvil: readonly Seat[],
  role: Role = 'assassin',
): PlayerView {
  const players = questFixture.view.players.map((player) => ({
    ...player,
    name: `Seat ${player.seat}`,
  }))
  return {
    ...structuredClone(questFixture.view),
    seat,
    name: players.find((player) => player.seat === seat)!.name,
    role,
    alignment: 'evil',
    privateInfo: {
      evilPartners: visibleEvil.filter((candidate) => candidate !== seat),
    },
    players,
  }
}

function nondecisive(view: PlayerView): PlayerView {
  const result = structuredClone(view)
  result.quests[0] = {
    ...result.quests[0],
    result: 'success',
    failCount: 0,
  }
  result.quests[1] = {
    ...result.quests[1],
    result: 'fail',
    failCount: 1,
  }
  result.quests[2] = {
    ...result.quests[2],
    result: undefined,
    failCount: undefined,
  }
  return result
}

function questRequest(view: PlayerView): DecisionRequest {
  return {
    kind: 'quest',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
}

async function d3Frame(
  view: PlayerView,
  seed: string,
): Promise<{
  resolved: ReturnType<typeof withResolvedDecisionLayers>
  output: Awaited<
    ReturnType<ReturnType<typeof createComposedAgent>['decide']>
  >
}> {
  const req = questRequest(view)
  const agent = createComposedAgent({
    seed,
    evilQuestCardPolicy: 'robust-heterogeneous',
  })
  const output = await agent.decide(req, view)
  const resolved = await resolvedFrame(req, view, {
    brain: agent.resolvedBrain(),
    trusted: (frame) => ({
      providers: [
        {
          input: PRIVATE_SITUATION_INPUT,
          provide: () =>
            structuredClone(frame.analysis) as SituationAnalysis,
        },
        {
          input: PRIVATE_FORCED_POLICY_INPUT,
          provide: () =>
            structuredClone(frame.universalForced) as ForcedPolicyResult,
        },
      ],
    }),
  })
  return {
    resolved: withResolvedDecisionLayers(
      resolved,
      agent.resolvedBrain(),
    ),
    output,
  }
}

test('real robust D3 is native strategic authority with exact attribution', async () => {
  const seed = 'decision-frame-real-d3'
  const view = nondecisive(coordinatedQuestView(4, [4, 5]))
  const { resolved, output } = await d3Frame(view, seed)
  assert.equal(resolved.universalForced.selectedCandidateId, undefined)
  assert.equal(resolved.stage, 'decision-layers-resolved')
  assert.deepEqual(
    resolved.decisionLayerRun.surface,
    output.trace!.decisionLayerRun!.surface,
  )
  assert.ok(componentPayload(
    resolved.componentRun,
    EVIL_QUEST_CARD_ROBUST_COMPONENT,
  ))
  assert.equal(
    JSON.stringify(resolved.universalForced),
    JSON.stringify(output.trace!.forcedPolicyResult),
  )
  assert.equal(
    JSON.stringify(resolved.componentRun.policyUse),
    JSON.stringify(output.trace!.components!.policyUse),
  )
})

test('universal quest-card dominance suppresses robust strategic execution', async () => {
  const view = coordinatedQuestView(4, [4, 5])
  const { resolved } = await d3Frame(view, 'decision-frame-forced-d3')
  assert.ok(resolved.universalForced.selectedCandidateId)
  assert.equal(
    resolved.decisionLayerRun.journal[0].status,
    'suppressed',
  )
  assert.deepEqual(
    resolved.decisionLayerRun.journal[0].componentReads,
    [],
  )
})

test('planner acceptance/rejection and voice/no-voice preserve current seams', async () => {
  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.id === 'merlin-opening-proposal',
  )!
  const baseline = await createComposedAgent({
    seed: fixture.source.seed,
  }).decide(fixture.req, fixture.view)
  const structuredId = baseline.trace!.structuredCandidateId!
  for (const scenario of [
    {
      name: 'accepted-and-voiced',
      planner: {
        version: 'frame-test-planner-v1',
        choose: async () => ({ candidateId: structuredId }),
      },
      voice: {
        version: 'frame-test-voice-v1',
        speak: async () => ({
          text: 'I support this team.',
          thinking: 'Keep the public explanation concise.',
        }),
      },
      resolution: {
        kind: 'accepted',
        candidateId: structuredId,
      } as const,
    },
    {
      name: 'rejected-and-silent',
      planner: {
        version: 'frame-test-planner-v1',
        choose: async () => ({ candidateId: 'missing-candidate' }),
      },
      voice: undefined,
      resolution: {
        kind: 'rejected',
        degradationCode: 'planner-invalid-candidate',
        attemptedCandidateId: 'missing-candidate',
      } as const,
    },
  ]) {
    const output = await createComposedAgent({
      seed: fixture.source.seed,
      planner: scenario.planner,
      ...(scenario.voice ? { voice: scenario.voice } : {}),
    }).decide(fixture.req, fixture.view)
    const trace = output.trace!
    const resolved = await resolvedFrame(fixture.req, fixture.view)
    const scored = completeFromCurrentTrace(
      resolved,
      trace,
      fixture.source.seed,
      scenario.resolution.kind === 'rejected'
        ? trace.degradation.slice(0, -1)
        : trace.degradation,
    )
    const selected = selectDecisionCandidate(scored, scenario.resolution)
    const chosenScore = selected.scores.find(
      (score) => score.candidateId === selected.selected.candidate.id,
    )!
    const scoreSurface =
      structuredClone(selected.scores) as readonly CandidateScore[]
    const reasons = trace.plannerReasonCodes
      ?? selectedStrategicReasonCodes(
        structuredClone(chosenScore) as CandidateScore,
        scoreSurface,
      )
    const committed = commitDecision(
      selected,
      currentPlan(selected, reasons, trace.communicationIntent),
    )
    const voiced = withDecisionVoice(committed, {
      version: scenario.voice?.version ?? NO_VOICE_VERSION,
      result: output.decision,
    })
    assert.equal(selected.selected.candidate.id, trace.chosenCandidateId)
    assert.deepEqual(selected.degradation, trace.degradation)
    assert.equal(
      JSON.stringify(committed.plan.communication),
      JSON.stringify(trace.communicationIntent),
      scenario.name,
    )
    assert.equal(
      JSON.stringify(voiced.result),
      JSON.stringify(output.decision),
      scenario.name,
    )
    assert.equal(voiced.voice.applied, Boolean(scenario.voice), scenario.name)
    if (scenario.voice) {
      assert.equal(
        voiced.result.thinking,
        'Keep the public explanation concise.',
      )
      const annotated = withDecisionVoice(committed, {
        version: scenario.voice.version,
        result: {
          ...output.decision,
          notes: 'Private owner annotation.',
        },
      })
      assert.equal(annotated.result.notes, 'Private owner annotation.')
      assert.equal(annotated.voice.applied, true)
    }
  }
})
