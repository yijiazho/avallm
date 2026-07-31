// test-lane: fast
// Migration phase 4C; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPOSED_POLICY_VERSION,
  RAW_LLM_POLICY_VERSION,
} from '../../../server/agents/brain.ts'
import {
  createComposedAgent,
} from '../../../server/agents/composed.ts'
import {
  createBoundedPlanner,
  createBoundedPlannerVoice,
  type PlannerInput,
  type PlannerOutput,
} from '../../../server/agents/communication/planner-voice-adapter.ts'
import {
  goodProposalScorer,
  goodProposalVoteScorer,
} from '../../../server/agents/policy/score.ts'
import {
  defaultComponents,
  runArchitectureBench,
} from '../../../server/eval/harness/architecture-bench.ts'
import { composedBrainOptions } from '../../../server/agents/registry.ts'
import { architectureReport } from '../../../server/eval/architecture-report.ts'
import { readDecisionFixtures } from '../../../server/eval/replay/decision-fixtures.ts'
import type { AgentDef } from '../../../server/agents/defs.ts'
import type { Msg, CallOpts } from '../../../server/llm/openrouter.ts'

const fixture = (id: string) =>
  readDecisionFixtures().find((candidate) => candidate.id === id)!

interface FakeCall {
  model: string
  messages: Msg[]
  opts?: CallOpts
}

function fakeClient(
  reply: (call: FakeCall) => string | Promise<string>,
): { calls: FakeCall[]; call: (
  model: string,
  messages: Msg[],
  opts?: CallOpts,
) => Promise<string> } {
  const calls: FakeCall[] = []
  return {
    calls,
    async call(model, messages, opts) {
      const call = structuredClone({ model, messages, opts })
      calls.push(call)
      return reply(call)
    },
  }
}

function plannerInput(call: FakeCall): {
  structuredCandidateId: string
  context: PlannerInput['context']
} {
  return JSON.parse(call.messages[1].content) as {
    structuredCandidateId: string
    context: PlannerInput['context']
  }
}

interface PromptSchema {
  type?: string
  const?: unknown
  enum?: readonly unknown[]
  required?: readonly string[]
  properties?: Readonly<Record<string, PromptSchema>>
  items?: PromptSchema
  allOf?: readonly PromptSchema[]
  if?: PromptSchema
  then?: PromptSchema
  not?: PromptSchema
}

function plannerPrompt(call: FakeCall): {
  structuredCandidateId: string
  context: PlannerInput['context']
  outputSchema: PromptSchema
} {
  return JSON.parse(call.messages[1].content) as {
    structuredCandidateId: string
    context: PlannerInput['context']
    outputSchema: PromptSchema
  }
}

function schemaProperty(
  schema: PromptSchema,
  key: string,
): PromptSchema {
  const property = schema.properties?.[key]
  assert.ok(property, `missing schema property ${key}`)
  return property
}

test('bounded fake-client planner and voice use chosen posterior reasons without changing mechanics', async () => {
  const source = fixture('merlin-opening-proposal')
  let expectedCandidateId = ''
  let expectedReasonCodes: readonly string[] = []
  let offeredCandidateIds: readonly string[] = []
  let voicePayload = ''
  const plannerContexts: PlannerInput['context'][] = []
  const client = fakeClient((call) => {
    if (call.opts?.tag === 'phase4c/planner') {
      const input = plannerInput(call)
      plannerContexts.push(structuredClone(input.context))
      offeredCandidateIds = input.context.viableCandidates.map(
        (candidate) => candidate.id,
      )
      const selected = input.context.viableCandidates.at(-1)!
      expectedCandidateId = selected.id
      expectedReasonCodes = selected.reasonCodes
      return JSON.stringify({
        candidateId: selected.id,
        reasonCodes: selected.reasonCodes,
        strategicIntent: {
          version: 'strategic-intent-v1',
          objective: 'BUILD_TRUST',
          targetSeats: selected.decision.kind === 'propose'
            ? selected.decision.team.slice(0, 1)
            : [],
          horizon: 'NEXT_QUEST',
          evidenceRefs: [],
        },
        communication: {
          version: 'communication-intent-v3',
          channel: 'proposal-pitch',
          targetSeats: selected.decision.kind === 'propose'
            ? selected.decision.team
            : [],
          actCodes: [
            'EXPLAIN_COMMITTED_TEAM',
            'ACKNOWLEDGE_UNCERTAINTY',
          ],
          evidenceRefs: [],
          tone: 'natural',
        },
      })
    }
    voicePayload = call.messages[1].content
    return JSON.stringify({
      text: 'I prefer this team, though I am not fully certain.',
    })
  })
  const adapters = createBoundedPlannerVoice({
    client,
    model: 'fake/model',
    tagPrefix: 'phase4c',
  })
  const agent = createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    planMemory: true,
    ...adapters,
  })

  const output = await agent.decide(source.req, source.view)
  assert.notEqual(output.trace!.componentVersions!.planner, 'planner-off')
  assert.equal(output.trace!.chosenCandidateId, expectedCandidateId)
  assert.equal(output.decision.kind, 'propose')
  assert.deepEqual(
    output.decision.team,
    expectedCandidateId.split(':').at(-1)!.split(',').map(Number),
  )
  assert.equal(
    output.decision.pitch,
    'I prefer this team, though I am not fully certain.',
  )
  assert.deepEqual(
    output.trace!.communicationIntent?.strategicReasonCodes,
    expectedReasonCodes,
  )
  assert.equal(
    output.trace!.communicationIntent?.uncertainty?.kind,
    'selected-team-clean',
  )
  assert.equal(
    output.trace!.communicationIntent?.uncertainty?.semantics,
    'uniform-feasible-joint',
  )
  const proposalScores = output.trace!.candidateScores!.filter(
    (score) => score.features?.version === 'good-proposal-features-v1',
  )
  const maxClean = Math.max(...proposalScores
    .filter((score) => score.viable)
    .map((score) => score.features!.cleanProbability))
  assert.ok(offeredCandidateIds.every((candidateId) => {
    const score = proposalScores.find(
      (candidate) => candidate.candidateId === candidateId,
    )!
    return score.features!.cleanProbability === maxClean
  }))

  const renderedVoice = JSON.parse(voicePayload)
  assert.deepEqual(
    renderedVoice.committedPlan.decision,
    {
      kind: 'propose',
      team: output.decision.team,
    },
  )
  assert.equal(renderedVoice.viableCandidates, undefined)
  assert.equal(renderedVoice.privateInfo, undefined)
  assert.equal(renderedVoice.plannerCognition, undefined)
  assert.equal(renderedVoice.committedPlan.strategicIntent, undefined)
  assert.equal(renderedVoice.committedPlan.reasons, undefined)
  assert.equal(
    renderedVoice.committedPlan.communication.conceal,
    undefined,
  )
  assert.equal(
    renderedVoice.committedPlan.communication.uncertainty
      .cleanProbability,
    undefined,
  )
  assert.equal(
    renderedVoice.committedPlan.communication.uncertainty
      .beliefModelVersion,
    undefined,
  )
  if (
    output.trace!.communicationIntent?.uncertainty?.kind
      === 'selected-team-clean'
    && output.trace.communicationIntent.uncertainty.residualProbability === 0
  ) {
    assert.ok(
      !renderedVoice.committedPlan.communication.actCodes.includes(
        'ACKNOWLEDGE_UNCERTAINTY',
      ),
    )
  }
  assert.doesNotMatch(voicePayload, /roleBySeat|alignmentBySeat|topHypotheses/)

  assert.equal(agent.planMemorySnapshot(), undefined)
  agent.finalizeAppliedTrace!({
    request: source.req,
    view: source.view,
    selectedDecision: output.decision,
    appliedDecision: output.decision,
    resolution: 'selected-applied',
    provisionalTrace: output.trace!,
  })
  const remembered = agent.planMemorySnapshot()!.history.at(-1)!
  assert.deepEqual(remembered.selected?.plan.strategicIntent, {
    version: 'strategic-intent-v1',
    objective: 'BUILD_TRUST',
    targetSeats: expectedCandidateId.split(':').at(-1)!
      .split(',').map(Number).slice(0, 1),
    horizon: 'NEXT_QUEST',
    evidenceRefs: [],
  })

  await agent.decide(source.req, source.view)
  assert.equal(plannerContexts.length, 2)
  assert.deepEqual(
    plannerContexts[0].plannerCognition.privateKnowledge,
    source.view.privateInfo,
  )
  assert.ok(
    plannerContexts[0].plannerCognition.currentCommitments.every(
      (commitment) =>
        commitment.kind !== 'utterance'
        || !Object.hasOwn(commitment.payload, 'text'),
    ),
  )
  assert.equal(
    plannerContexts[0].plannerCognition.recentAppliedPlans.length,
    0,
  )
  assert.deepEqual(
    plannerContexts[1].plannerCognition.recentAppliedPlans.at(-1)?.selected
      ?.strategicIntent,
    remembered.selected?.plan.strategicIntent,
  )
  assert.ok(
    plannerContexts[1].plannerCognition.belief.players.every((player) =>
      !Object.hasOwn(player, 'goodProbability')
      && !Object.hasOwn(player, 'evilProbability')),
  )
})

test('bounded planner v4 renders scalar intent and context-specific evidence and speech schemas', async () => {
  const calls = new Map<string, FakeCall>()
  for (const fixtureId of [
    'merlin-opening-proposal',
    'servant-vote-after-evidence',
    'minion-late-discussion',
    'assassin-late-finalize',
  ]) {
    const source = fixture(fixtureId)
    const client = fakeClient((call) => {
      if (call.opts?.tag?.endsWith('/voice')) {
        return '{"text":"I support the committed team."}'
      }
      calls.set(fixtureId, call)
      const input = plannerInput(call)
      const selected = input.context.viableCandidates.find(
        (candidate) => candidate.id === input.structuredCandidateId,
      )!
      const strategicIntent = {
        version: 'strategic-intent-v1',
        objective: source.req.kind === 'vote'
          ? 'OPPOSE_TEAM'
          : source.req.kind === 'discuss'
            ? 'PRESERVE_COVER'
            : 'BUILD_TRUST',
        targetSeats: selected.decision.kind === 'propose'
          ? selected.decision.team
          : [],
        horizon: source.req.kind === 'vote'
          ? 'CURRENT_PROPOSAL'
          : 'THIS_ACTION',
        evidenceRefs: source.req.kind === 'vote'
          ? [{ kind: 'proposal', round: 3, proposalNum: 1 }]
          : [],
      }
      const revision = selected.decision.kind === 'finalize'
        && !selected.decision.stick
      return JSON.stringify({
        candidateId: input.structuredCandidateId,
        strategicIntent,
        ...(source.req.kind === 'propose'
          ? {
              communication: {
                version: 'communication-intent-v3',
                channel: 'proposal-pitch',
                targetSeats: selected.decision.kind === 'propose'
                  ? selected.decision.team
                  : [],
                actCodes: ['EXPLAIN_COMMITTED_TEAM'],
                evidenceRefs: [],
                tone: 'natural',
              },
            }
            : source.req.kind === 'discuss'
            ? {
                communication: {
                  version: 'communication-intent-v3',
                  channel: 'discussion',
                  targetSeats: [],
                  actCodes: ['PASS'],
                  evidenceRefs: [],
                  tone: 'natural',
                },
              }
            : revision
              ? {
                  communication: {
                    version: 'communication-intent-v3',
                    channel: 'revision-reason',
                    targetSeats: selected.decision.team,
                    actCodes: ['EXPLAIN_COMMITTED_REVISION'],
                    evidenceRefs: [],
                    tone: 'natural',
                  },
                }
              : {}),
      })
    })
    const output = await createComposedAgent({
      seed: source.source.seed,
      ...composedBrainOptions('full-role'),
      planMemory: true,
      pinReads: true,
      ...createBoundedPlannerVoice({
        client,
        model: 'fake/model',
        tagPrefix: `v4-${fixtureId}`,
      }),
    }).decide(source.req, source.view)
    assert.ok(
      !output.trace!.degradation.some((code) => code.startsWith('planner-')),
      `${fixtureId}: ${output.trace!.degradation.join(',')}`,
    )
  }

  const proposalCall = calls.get('merlin-opening-proposal')!
  const proposalPrompt = plannerPrompt(proposalCall)
  const proposalIntent = schemaProperty(
    schemaProperty(proposalPrompt.outputSchema, 'strategicIntent'),
    'objective',
  )
  const proposalHorizon = schemaProperty(
    schemaProperty(proposalPrompt.outputSchema, 'strategicIntent'),
    'horizon',
  )
  assert.equal(proposalIntent.type, 'string')
  assert.ok(proposalIntent.enum?.includes('BUILD_TRUST'))
  assert.equal(proposalHorizon.type, 'string')
  assert.ok(proposalHorizon.enum?.includes('THIS_ACTION'))
  const proposalCommunication = schemaProperty(
    proposalPrompt.outputSchema,
    'communication',
  )
  assert.equal(
    schemaProperty(proposalCommunication, 'channel').const,
    'proposal-pitch',
  )
  assert.ok(proposalCommunication.properties?.claimedRole)
  assert.ok(proposalCommunication.properties?.roleTopic)
  assert.ok(!proposalCommunication.required?.includes('claimedRole'))
  assert.ok(!proposalCommunication.required?.includes('roleTopic'))
  const proposalTargetSeats = schemaProperty(
    proposalCommunication,
    'targetSeats',
  )
  assert.deepEqual(
    proposalTargetSeats.items?.enum,
    proposalPrompt.context.publicContext.record.players.map(
      (player) => player.seat,
    ),
  )
  assert.match(proposalCall.messages[0].content, /concise bare JSON object/)
  assert.match(proposalCall.messages[0].content, /exactly one objective/)

  const votePrompt = plannerPrompt(calls.get('servant-vote-after-evidence')!)
  assert.equal(votePrompt.outputSchema.properties?.communication, undefined)
  const voteEvidence = schemaProperty(
    schemaProperty(votePrompt.outputSchema, 'strategicIntent'),
    'evidenceRefs',
  )
  assert.ok(voteEvidence.items?.enum?.some((reference) =>
    JSON.stringify(reference) === JSON.stringify({ kind: 'quest', questNum: 1 })))
  assert.ok(voteEvidence.items?.enum?.some((reference) =>
    JSON.stringify(reference) === JSON.stringify({ kind: 'quest', questNum: 2 })))
  assert.ok(!voteEvidence.items?.enum?.some((reference) =>
    JSON.stringify(reference) === JSON.stringify({ kind: 'quest', questNum: 3 })))
  assert.ok((voteEvidence.items?.enum?.length ?? 0) <= 46)

  const passPrompt = plannerPrompt(calls.get('minion-late-discussion')!)
  const passCommunication = schemaProperty(
    passPrompt.outputSchema,
    'communication',
  )
  assert.deepEqual(
    schemaProperty(passCommunication, 'targetSeats').const,
    [],
  )
  assert.deepEqual(
    schemaProperty(passCommunication, 'actCodes').const,
    ['PASS'],
  )
  assert.deepEqual(
    schemaProperty(passCommunication, 'evidenceRefs').const,
    [],
  )
  assert.equal(passCommunication.properties?.claimedRole, undefined)
  assert.equal(passCommunication.properties?.roleTopic, undefined)

  const finalizeBase = plannerPrompt(calls.get('assassin-late-finalize')!)
  const stickCandidate = finalizeBase.context.viableCandidates.find(
    (candidate) =>
      candidate.decision.kind === 'finalize' && candidate.decision.stick,
  )!
  const revisionCandidate = {
    id: 'test:finalize:revise',
    decision: {
      kind: 'finalize' as const,
      stick: false as const,
      team: finalizeBase.context.publicContext.record.currentTeam?.slice()
        .reverse() ?? [0, 1],
    },
    score: stickCandidate.score - 1,
    reasonCodes: ['TEST_REVISION'],
  }
  let mixedFinalizeCall: FakeCall | undefined
  await createBoundedPlanner({
    client: fakeClient((call) => {
      mixedFinalizeCall = call
      return JSON.stringify({
        candidateId: stickCandidate.id,
        strategicIntent: {
          version: 'strategic-intent-v1',
          objective: 'PRESERVE_COVER',
          targetSeats: [],
          horizon: 'THIS_ACTION',
          evidenceRefs: [],
        },
      })
    }),
    model: 'fake/model',
  }).choose({
    context: {
      ...finalizeBase.context,
      viableCandidates: [stickCandidate, revisionCandidate],
    },
    renderedContext: JSON.stringify({
      ...finalizeBase.context,
      viableCandidates: [stickCandidate, revisionCandidate],
    }),
    structuredCandidateId: stickCandidate.id,
  })
  assert.ok(mixedFinalizeCall)
  const finalizePrompt = plannerPrompt(mixedFinalizeCall)
  const silentFinalizeIds = finalizePrompt.context.viableCandidates
    .filter((candidate) =>
      candidate.decision.kind === 'finalize' && candidate.decision.stick)
    .map((candidate) => candidate.id)
  const revisionFinalizeIds = finalizePrompt.context.viableCandidates
    .filter((candidate) =>
      candidate.decision.kind === 'finalize' && !candidate.decision.stick)
    .map((candidate) => candidate.id)
  assert.ok(silentFinalizeIds.length > 0)
  assert.ok(revisionFinalizeIds.length > 0)
  assert.deepEqual(
    finalizePrompt.outputSchema.allOf?.[0]?.if?.properties?.candidateId?.enum,
    silentFinalizeIds,
  )
  assert.deepEqual(
    finalizePrompt.outputSchema.allOf?.[0]?.then?.not?.required,
    ['communication'],
  )
  assert.deepEqual(
    finalizePrompt.outputSchema.allOf?.[1]?.if?.properties?.candidateId?.enum,
    revisionFinalizeIds,
  )
  assert.deepEqual(
    finalizePrompt.outputSchema.allOf?.[1]?.then?.required,
    ['communication'],
  )
})

test('absent, malformed, and failed adapters degrade to the structured committed action', async () => {
  const source = fixture('merlin-opening-proposal')
  const structured = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
  }).decide(source.req, source.view)

  const malformed = fakeClient((call) =>
    call.opts?.tag?.endsWith('/planner')
      ? '{}'
      : '{"unexpected":"voice"}')
  const malformedAgent = createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    ...createBoundedPlannerVoice({
      client: malformed,
      model: 'fake/model',
    }),
  })
  const degraded = await malformedAgent.decide(source.req, source.view)
  assert.deepEqual(degraded.decision.team, structured.decision.team)
  assert.equal(degraded.decision.pitch, undefined)
  assert.ok(degraded.trace!.degradation.includes('planner-no-choice'))
  assert.ok(degraded.trace!.degradation.includes('voice-no-output'))

  const failed = fakeClient(() => {
    throw new Error('offline')
  })
  const failedAgent = createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    ...createBoundedPlannerVoice({ client: failed, model: 'fake/model' }),
  })
  const failure = await failedAgent.decide(source.req, source.view)
  assert.deepEqual(failure.decision.team, structured.decision.team)
  assert.ok(failure.trace!.degradation.includes('planner-failed'))
  assert.ok(failure.trace!.degradation.includes('voice-failed'))
})

test('a planner output that cannot be detached degrades instead of throwing', async () => {
  // resolvePlannerChoice() detaches the planner's reply with structuredClone
  // before validating it, so an unclonable reply throws from inside the phase
  // rather than from choose(). The catch has to span the detach for the same
  // reason it spans choose(): planning is optional strategy, and the frame can
  // already commit the structured choice. Without that span the DataCloneError
  // escapes decide() entirely, the runner falls back to its heuristic, and the
  // trace loses both the committed structured action and the typed degradation.
  const source = fixture('merlin-opening-proposal')
  const structured = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
  }).decide(source.req, source.view)

  const unclonable = createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    planner: {
      version: 'unclonable-planner-v1',
      async choose(input) {
        return {
          candidateId: input.structuredCandidateId,
          // A function value is unclonable, so the detach fails before any
          // key or reason validation can reject the shape.
          notCloneable: () => undefined,
        } as unknown as PlannerOutput
      },
    },
  })
  const output = await unclonable.decide(source.req, source.view)
  assert.deepEqual(output.decision, structured.decision)
  assert.ok(output.trace!.degradation.includes('planner-failed'))
  assert.equal(output.trace!.plannerCandidateId, undefined)
})

test('planner overrides require a viable candidate and a reason owned by that candidate', async () => {
  const source = fixture('merlin-opening-proposal')
  const base = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
  }).decide(source.req, source.view)
  for (const reply of [
    {
      candidateId: 'invented:team',
      reasonCodes: ['GOOD_PROPOSAL_JOINT_TEAM_CLEAN'],
    },
    {
      candidateId: 'last',
      reasonCodes: [],
    },
    {
      candidateId: 'last',
      reasonCodes: ['PRIVATE_ROLE_CERTAINTY'],
    },
  ]) {
    const agent = createComposedAgent({
      seed: source.source.seed,
      scorer: goodProposalScorer,
      planner: {
        version: 'hostile-planner-v1',
        async choose(input) {
          const candidateId = reply.candidateId === 'last'
            ? input.context.viableCandidates.at(-1)!.id
            : reply.candidateId
          return { ...reply, candidateId }
        },
      },
    })
    const output = await agent.decide(source.req, source.view)
    assert.deepEqual(output.decision.team, base.decision.team)
    assert.ok(output.trace!.degradation.some((code) =>
      code === 'planner-invalid-candidate'
      || code === 'planner-invalid-reason'))
  }
})

test('planner cannot trade exact posterior quality for an unqualified override', async () => {
  const source = fixture('merlin-opening-proposal')
  const structured = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
  }).decide(source.req, source.view)
  const scores = structured.trace!.candidateScores!
  const structuredId = structured.trace!.chosenCandidateId!
  const max = Math.max(...scores
    .filter((score) => score.viable)
    .map((score) => score.features!.cleanProbability))
  const dominated = scores.find(
    (score) =>
      score.viable
      && score.features!.cleanProbability < max,
  )!
  const alternateMax = scores.find(
    (score) =>
      score.viable
      && score.candidateId !== structuredId
      && score.features!.cleanProbability === max,
  )!
  assert.ok(dominated)
  assert.ok(alternateMax)

  const attempt = async (
    candidateId: string,
    reasonCodes: readonly string[],
  ) => await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    planner: {
      version: 'quality-probe-v1',
      async choose() {
        return { candidateId, reasonCodes }
      },
    },
  }).decide(source.req, source.view)

  const dominatedOutput = await attempt(
    dominated.candidateId,
    ['GOOD_PROPOSAL_JOINT_TEAM_CLEAN'],
  )
  assert.equal(dominatedOutput.trace!.chosenCandidateId, structuredId)
  assert.ok(
    dominatedOutput.trace!.degradation.includes(
      'planner-invalid-candidate',
    ),
  )

  const genericOutput = await attempt(
    alternateMax.candidateId,
    ['GOOD_PROPOSAL_JOINT_TEAM_CLEAN'],
  )
  assert.equal(genericOutput.trace!.chosenCandidateId, structuredId)
  assert.ok(
    genericOutput.trace!.degradation.includes('planner-invalid-reason'),
  )

  const qualifiedOutput = await attempt(
    alternateMax.candidateId,
    ['GOOD_PROPOSAL_MAX_TEAM_CLEAN'],
  )
  assert.equal(
    qualifiedOutput.trace!.chosenCandidateId,
    alternateMax.candidateId,
  )
  assert.deepEqual(
    qualifiedOutput.trace!.communicationIntent?.strategicReasonCodes,
    ['GOOD_PROPOSAL_MAX_TEAM_CLEAN'],
  )
})

test('planner inputs and admitted component versions are immutable boundaries', async () => {
  const source = fixture('merlin-opening-proposal')
  const planner = {
    version: 'planner-admitted-v1',
    async choose(input: PlannerInput) {
      const target = input.context.viableCandidates.at(-1)!
      ;(input.context.forcedPolicy.reasonCodes as string[]).push(
        'HAMMER_TEAM_AUTOMATIC',
      )
      ;(target.reasonCodes as string[]).push(
        'GOOD_PROPOSAL_JOINT_TEAM_CLEAN',
      )
      planner.version = 'planner-mutated-v2'
      return {
        candidateId: target.id,
        reasonCodes: target.reasonCodes,
      }
    },
  }
  const voice = {
    version: 'voice-admitted-v1',
    async speak() {
      voice.version = 'voice-mutated-v2'
      return {
        text: 'The committed team stands.',
        candidateId: 'invented:action',
      } as never
    },
  }
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    planner,
    voice,
  }).decide(source.req, source.view)
  assert.equal(
    output.trace!.componentVersions!.planner,
    'planner-admitted-v1',
  )
  assert.equal(
    output.trace!.componentVersions!.voice,
    'voice-admitted-v1',
  )
  assert.ok(
    !output.trace!.forcedPolicyResult!.reasonCodes.includes(
      'HAMMER_TEAM_AUTOMATIC',
    ),
  )
  assert.ok(
    output.trace!.candidateScores!.every(
      (score) =>
        score.reasonCodes.filter(
          (reason) => reason === 'GOOD_PROPOSAL_JOINT_TEAM_CLEAN',
        ).length <= 1,
    ),
  )
  assert.equal(output.decision.kind, 'propose')
  assert.equal(output.decision.pitch, 'The committed team stands.')
})

test('bounded adapters reject wrapped JSON and action-shaped voice extras', async () => {
  const source = fixture('merlin-opening-proposal')
  for (const reply of [
    'preface {"candidateId":"invented"} after',
    '```json\n{"candidateId":"invented"}\n```',
  ]) {
    const client = fakeClient((call) =>
      call.opts?.tag?.endsWith('/planner')
        ? reply
        : '{"text":"should not matter"}')
    const output = await createComposedAgent({
      seed: source.source.seed,
      scorer: goodProposalScorer,
      ...createBoundedPlannerVoice({ client, model: 'fake/model' }),
    }).decide(source.req, source.view)
    assert.ok(output.trace!.degradation.includes('planner-no-choice'))
  }

  const extraVoice = fakeClient((call) => {
    if (call.opts?.tag?.endsWith('/planner')) {
      return JSON.stringify({
        candidateId: plannerInput(call).structuredCandidateId,
      })
    }
    return '{"text":"wrapped voice","candidateId":"invented"}'
  })
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    ...createBoundedPlannerVoice({
      client: extraVoice,
      model: 'fake/model',
    }),
  }).decide(source.req, source.view)
  assert.ok(output.trace!.degradation.includes('voice-no-output'))
  assert.equal(output.decision.kind, 'propose')
  assert.equal(output.decision.pitch, undefined)
})

test('direct planner communication rejects extra private-shaped fields', async () => {
  const source = fixture('merlin-opening-proposal')
  let renderedPlan = ''
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    planner: {
      version: 'extra-field-planner-v1',
      async choose(input) {
        return {
          candidateId: input.structuredCandidateId,
          communication: {
            version: 'communication-intent-v3',
            channel: 'proposal-pitch',
            targetSeats: [],
            actCodes: ['EXPLAIN_COMMITTED_TEAM'],
            evidenceRefs: [],
            tone: 'natural',
            privateInfo: { kind: 'merlin', knownEvil: [2, 3] },
          },
        } as never
      },
    },
    voice: {
      version: 'capture-voice-v1',
      async speak(input) {
        renderedPlan = input.renderedPlan
        return { text: 'The committed team stands.' }
      },
    },
  }).decide(source.req, source.view)
  assert.ok(
    output.trace!.degradation.includes('planner-invalid-communication'),
  )
  assert.doesNotMatch(renderedPlan, /privateInfo|knownEvil/)
})

test('invalid strategic intent is inert and cannot enter durable memory', async () => {
  const source = fixture('merlin-opening-proposal')
  let voicePlan = ''
  const agent = createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
    planMemory: true,
    planner: {
      version: 'invalid-intent-planner-v1',
      async choose(input) {
        return {
          candidateId: input.structuredCandidateId,
          strategicIntent: {
            version: 'strategic-intent-v1',
            objective: 'BUILD_TRUST',
            targetSeats: [999],
            horizon: 'NEXT_QUEST',
            evidenceRefs: [],
          },
        } as PlannerOutput
      },
    },
    voice: {
      version: 'intent-redaction-voice-v1',
      async speak(input) {
        voicePlan = input.renderedPlan
        return { text: 'The committed team stands.' }
      },
    },
  })
  const output = await agent.decide(source.req, source.view)
  assert.ok(
    output.trace!.degradation.includes('planner-invalid-strategic-intent'),
  )
  assert.doesNotMatch(voicePlan, /strategicIntent|plannerCognition/)

  agent.finalizeAppliedTrace!({
    request: source.req,
    view: source.view,
    selectedDecision: output.decision,
    appliedDecision: output.decision,
    resolution: 'selected-applied',
    provisionalTrace: output.trace!,
  })
  assert.equal(
    agent.planMemorySnapshot()!.history.at(-1)!.selected?.plan.strategicIntent,
    undefined,
  )
})

test('structured intent and hybrid adapter replay deterministically', async () => {
  const source = fixture('merlin-opening-proposal')
  const decide = async () => {
    const client = fakeClient((call) => {
      if (call.opts?.tag?.endsWith('/planner')) {
        const input = plannerInput(call)
        return JSON.stringify({
          candidateId: input.structuredCandidateId,
        })
      }
      return '{"text":"The plan stands."}'
    })
    return await createComposedAgent({
      seed: source.source.seed,
      scorer: goodProposalScorer,
      ...createBoundedPlannerVoice({ client, model: 'fake/model' }),
    }).decide(source.req, source.view)
  }
  assert.deepEqual(await decide(), await decide())
})

test('architecture bank can compare free compatibility, structured-only, and hybrid factories', async () => {
  const baseComponents = {
    brain: 'brain-spec-v1',
    policy: 'composed-policy-v1',
    voice: 'voice-off',
  }
  const client = fakeClient((call) => {
    if (call.opts?.tag?.endsWith('/planner')) {
      return JSON.stringify({
        candidateId: plannerInput(call).structuredCandidateId,
      })
    }
    return '{"text":"The committed plan stands."}'
  })
  const adapters = createBoundedPlannerVoice({
    client,
    model: 'fake/model',
    tagPrefix: 'architecture-fake',
  })
  const bankCase = {
    id: 'phase4c-5p-merlin',
    seed: 'architecture-v1-5-merlin',
    playerCount: 5,
    roles: [
      'merlin',
      'percival',
      'servant',
      'morgana',
      'assassin',
    ] as const,
    talk: {
      maxRounds: 0,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'none' as const,
    },
    targetRole: 'merlin' as const,
    expectedTargetSeat: 4,
  }
  const artifacts = await runArchitectureBench({
    bankId: 'phase4c-modes',
    cases: [bankCase],
    variants: [
      {
        id: 'compatibility',
        components: {
          ...baseComponents,
          scorer: 'compatibility-scorer-v1',
          planner: 'planner-off',
        },
        paid: false,
        createTargetAgent: (context) => createComposedAgent({
          seed: context.seed,
          onDecisionTrace: context.onDecisionTrace,
        }),
      },
      {
        id: 'structured-only',
        components: {
          ...baseComponents,
          scorer: 'good-proposal-vote-scorer-v1',
          planner: 'planner-off',
        },
        paid: false,
        createTargetAgent: (context) => createComposedAgent({
          seed: context.seed,
          scorer: goodProposalVoteScorer,
          onDecisionTrace: context.onDecisionTrace,
        }),
      },
      {
        id: 'hybrid',
        components: {
          ...baseComponents,
          scorer: 'good-proposal-vote-scorer-v1',
          planner: 'bounded-llm-planner-v2',
          voice: 'bounded-llm-voice-v1',
        },
        paid: false,
        createTargetAgent: (context) => createComposedAgent({
          seed: context.seed,
          scorer: goodProposalVoteScorer,
          onDecisionTrace: context.onDecisionTrace,
          ...adapters,
        }),
      },
    ],
  })
  const report = architectureReport(artifacts)
  assert.deepEqual(
    report.variants.map((variant) => variant.id),
    ['compatibility', 'structured-only', 'hybrid'],
  )
  assert.equal(report.comparisons.length, 2)
  // The policy is the kind: every variant here runs the composed pipeline.
  assert.ok(report.variants.every(
    (variant) => variant.components.policy === COMPOSED_POLICY_VERSION,
  ))
  await assert.rejects(
    runArchitectureBench({
      bankId: 'phase4c-mislabeled',
      cases: [bankCase],
      variants: [{
        id: 'mislabeled',
        components: {
          ...baseComponents,
          scorer: 'dishonest-scorer-label',
          planner: 'planner-off',
        },
        paid: false,
        createTargetAgent: (context) => createComposedAgent({
          seed: context.seed,
          scorer: goodProposalVoteScorer,
          onDecisionTrace: context.onDecisionTrace,
        }),
      }],
    }),
    /trace components do not match declared components/,
  )
})

test('raw LLM remains an attributable paid-gated architecture mode', async () => {
  const raw: AgentDef = {
    id: 'raw-mode',
    name: 'Raw Mode',
    version: 1,
    engine: { type: 'llm', model: 'deepseek-flash' },
  }
  assert.equal(defaultComponents(raw).policy, RAW_LLM_POLICY_VERSION)
  await assert.rejects(
    runArchitectureBench({
      cases: [],
      variants: [{
        id: 'raw-llm',
        agent: raw,
        components: defaultComponents(raw),
      }],
    }),
    /allowPaid: true/,
  )
})
