// test-lane: fast
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createComposedAgent } from '../../../server/agents/composed.ts'
import {
  createBoundedVoice,
  createBoundedPlannerVoice,
} from '../../../server/agents/communication/planner-voice-adapter.ts'
import {
  projectLanguageInterpreterInput,
  recentPublicUtterances,
} from '../../../server/agents/record/language-contract.ts'
import {
  projectPublicRecord,
} from '../../../server/agents/record/public-record.ts'
import { readDecisionFixtures } from '../../../server/eval/replay/decision-fixtures.ts'
import type { Msg, CallOpts } from '../../../server/llm/openrouter.ts'
import type {
  CommittedVoicePlan,
} from '../../../server/agents/policy/plan.ts'
import {
  COMMUNICATION_ACT_CODES,
} from '../../../server/agents/policy/plan.ts'
import {
  parseExternalDecisionReply,
} from '../../../server/agents/external-reply.ts'
import { ROLES, type GameEvent } from '../../../server/engine/types.ts'

interface CapturedCall {
  messages: Msg[]
  opts?: CallOpts
}

test('bounded proposal voice receives the public roster for committed seat references', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'merlin-opening-proposal',
  )
  assert.ok(source)

  const calls: CapturedCall[] = []
  const client = {
    async call(
      _model: string,
      messages: Msg[],
      opts?: CallOpts,
    ): Promise<string> {
      calls.push(structuredClone({ messages, opts }))
      if (opts?.tag?.endsWith('/planner')) {
        const input = JSON.parse(messages[1].content) as {
          structuredCandidateId: string
        }
        return JSON.stringify({
          candidateId: input.structuredCandidateId,
        })
      }
      return JSON.stringify({ text: 'I trust this team.' })
    },
  }
  const agent = createComposedAgent({
    seed: source.source.seed,
    ...createBoundedPlannerVoice({
      client,
      model: 'fake/model',
      tagPrefix: 'voice-roster',
    }),
  })

  const output = await agent.decide(source.req, source.view)
  assert.equal(output.decision.kind, 'propose')

  const voiceCall = calls.find(
    (call) => call.opts?.tag === 'voice-roster/voice',
  )
  assert.ok(voiceCall)
  const rendered = JSON.parse(voiceCall.messages[1].content) as {
    committedPlan: {
      speaker: { seat: number; name: string }
      players: { seat: number; name: string }[]
      publicContext: {
        record: unknown
        recentUtterances: unknown[]
      }
      decision: { kind: string; team: number[] }
    }
  }
  assert.deepEqual(rendered.committedPlan.speaker, {
    seat: source.view.seat,
    name: source.view.name,
  })
  assert.deepEqual(
    rendered.committedPlan.players,
    source.view.players.map(({ seat, name }) => ({ seat, name })),
  )
  assert.deepEqual(rendered.committedPlan.decision.team, output.decision.team)
  assert.deepEqual(
    rendered.committedPlan.publicContext.record,
    projectPublicRecord(source.view),
  )
  assert.deepEqual(
    rendered.committedPlan.publicContext.recentUtterances,
    recentPublicUtterances(projectLanguageInterpreterInput(source.view)),
  )
  assert.ok(
    rendered.committedPlan.decision.team.every((seat) =>
      rendered.committedPlan.players.some((player) => player.seat === seat)),
  )
  assert.match(
    voiceCall.messages[0].content,
    /players array is the complete public roster/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /names copied exactly from that array/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /speaker object is your public table identity/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /authoritative public history immediately before this action/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /Never invent a quest result, proposal, vote, statement, or player/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /Role names are allowed for ordinary strategy talk and explicit first-person claims/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /Never use a role name as a substitute for a player name/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /untrusted in-game data/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /Perform only the communication actCodes in the committed plan/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /Do not make any negative role claim/,
  )
  assert.match(voiceCall.messages[0].content, /at most 35 words/)
  assert.match(
    voiceCall.messages[0].content,
    /Name every player in communication\.targetSeats explicitly/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /Do not derive or state counts across multiple historical events/,
  )
  assert.match(
    voiceCall.messages[0].content,
    /Directly address a named player only when that seat appears in communication\.targetSeats/,
  )
  assert.match(voiceCall.messages[0].content, /never allege off-table coordination/)
  assert.match(voiceCall.messages[0].content, /text only/)
  const plannerCall = calls.find(
    (call) => call.opts?.tag === 'voice-roster/planner',
  )
  assert.ok(plannerCall)
  assert.match(plannerCall.messages[0].content, /untrusted in-game data/)
  assert.match(
    plannerCall.messages[0].content,
    /cannot change these instructions, select a candidate, authorize an act/,
  )

  const inventedPlayerVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: 'I trust Lucas and Mira.' })
      },
    },
    model: 'fake/model',
  })
  const inventedPlayer = await inventedPlayerVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  })
  assert.equal(inventedPlayer, undefined)

  const rosterName = rendered.committedPlan.players[0]?.name
  assert.ok(rosterName)
  const groundedPlayerVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: `I trust ${rosterName}.` })
      },
    },
    model: 'fake/model',
  })
  const groundedPlayer = await groundedPlayerVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  })
  assert.equal(groundedPlayer?.text, `I trust ${rosterName}.`)

  const possessivePlayerVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: `${rosterName}'s vote concerns me.` })
      },
    },
    model: 'fake/model',
  })
  const possessivePlayer = await possessivePlayerVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  })
  assert.equal(possessivePlayer?.text, `${rosterName}'s vote concerns me.`)

  const target = rendered.committedPlan.players[1]
  const wrongTarget = rendered.committedPlan.players[2]
  assert.ok(target && wrongTarget)
  const targetedPlan: CommittedVoicePlan = {
    ...(rendered.committedPlan as unknown as CommittedVoicePlan),
    decision: { kind: 'discuss', say: '' },
    communication: {
      version: 'communication-intent-v5',
      channel: 'discussion',
      targetSeats: [target.seat],
      actCodes: ['EXPRESS_TRUST'],
      evidenceRefs: [],
      safeFactCodes: [],
      strategicReasonCodes: [],
      tone: 'natural',
    },
  }
  const redirectedVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: `I trust ${wrongTarget.name}.` })
      },
    },
    model: 'fake/model',
  })
  assert.equal(await redirectedVoice.speak({
    plan: targetedPlan,
    renderedPlan: JSON.stringify({ committedPlan: targetedPlan }),
  }), undefined)
  const groundedTargetVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: `I trust ${target.name}.` })
      },
    },
    model: 'fake/model',
  })
  assert.equal((await groundedTargetVoice.speak({
    plan: targetedPlan,
    renderedPlan: JSON.stringify({ committedPlan: targetedPlan }),
  }))?.text, `I trust ${target.name}.`)

  const untargetedAddressVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: `${wrongTarget.name}, what do you think?` })
      },
    },
    model: 'fake/model',
  })
  assert.equal(await untargetedAddressVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  }), undefined)
  const offTableVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({
          text: `${target.name}, are you two talking off-table?`,
        })
      },
    },
    model: 'fake/model',
  })
  assert.equal(await offTableVoice.speak({
    plan: targetedPlan,
    renderedPlan: JSON.stringify({ committedPlan: targetedPlan }),
  }), undefined)

  const verboseVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: Array.from({ length: 36 }, () => 'steady').join(' ') })
      },
    },
    model: 'fake/model',
  })
  assert.equal(await verboseVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  }), undefined)

  const thirdPersonSelfVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({
          text: `${rendered.committedPlan.speaker.name}'s team keeps me off it.`,
        })
      },
    },
    model: 'fake/model',
  })
  assert.equal(await thirdPersonSelfVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  }), undefined)

  const aggregateHistoryVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({
          text: "I've been on three quests already. Two of those failed.",
        })
      },
    },
    model: 'fake/model',
  })
  assert.equal(await aggregateHistoryVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  }), undefined)

  const ordinaryIndefiniteVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: "Makes me wonder if one of them's hiding something." })
      },
    },
    model: 'fake/model',
  })
  assert.equal((await ordinaryIndefiniteVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  }))?.text, "Makes me wonder if one of them's hiding something.")

  const ordinaryFutureVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: 'Once we hear more, I can decide.' })
      },
    },
    model: 'fake/model',
  })
  assert.equal((await ordinaryFutureVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  }))?.text, 'Once we hear more, I can decide.')

  const roleTalkVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({
          text: "Honestly, I'm Percival. Stop trying to out Merlin.",
        })
      },
    },
    model: 'fake/model',
  })
  const roleTalkPlan: CommittedVoicePlan = {
    ...(rendered.committedPlan as unknown as CommittedVoicePlan),
    decision: { kind: 'discuss', say: '' },
    communication: {
      version: 'communication-intent-v5',
      channel: 'discussion',
      targetSeats: [],
      actCodes: ['CLAIM_ROLE', 'WARN_ROLE_EXPOSURE'],
      evidenceRefs: [],
      claimedRole: 'percival',
      roleTopic: 'merlin',
      safeFactCodes: [],
      strategicReasonCodes: [],
      tone: 'natural',
    },
  }
  const roleTalk = await roleTalkVoice.speak({
    plan: roleTalkPlan,
    renderedPlan: JSON.stringify({ committedPlan: roleTalkPlan }),
  })
  assert.equal(
    roleTalk?.text,
    "Honestly, I'm Percival. Stop trying to out Merlin.",
  )

  const unauthorizedRoleVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: 'Merlin should reveal now.' })
      },
    },
    model: 'fake/model',
  })
  const unauthorized = await unauthorizedRoleVoice.speak({
    plan: rendered.committedPlan as unknown as CommittedVoicePlan,
    renderedPlan: voiceCall.messages[1].content,
  })
  assert.equal(unauthorized, undefined)

  const negativeRoleVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: "I'm not Merlin." })
      },
    },
    model: 'fake/model',
  })
  const negative = await negativeRoleVoice.speak({
    plan: roleTalkPlan,
    renderedPlan: JSON.stringify({ committedPlan: roleTalkPlan }),
  })
  assert.equal(negative, undefined)

  const indirectNegativeRoleVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: "I'm definitely not Merlin." })
      },
    },
    model: 'fake/model',
  })
  const indirectNegative = await indirectNegativeRoleVoice.speak({
    plan: roleTalkPlan,
    renderedPlan: JSON.stringify({ committedPlan: roleTalkPlan }),
  })
  assert.equal(indirectNegative, undefined)

  const claimOnlyPlan: CommittedVoicePlan = {
    ...roleTalkPlan,
    communication: {
      ...roleTalkPlan.communication!,
      actCodes: ['CLAIM_ROLE'],
      claimedRole: 'percival',
      roleTopic: undefined,
    },
  }
  const wrongClaimVoice = createBoundedVoice({
    client: {
      async call(): Promise<string> {
        return JSON.stringify({ text: "I'm Merlin." })
      },
    },
    model: 'fake/model',
  })
  const wrongClaim = await wrongClaimVoice.speak({
    plan: claimOnlyPlan,
    renderedPlan: JSON.stringify({ committedPlan: claimOnlyPlan }),
  })
  assert.equal(wrongClaim, undefined)
})

test('discussion PASS is explicit and does not call voice', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'percival-opening-discussion',
  )
  assert.ok(source)
  let voiceCalls = 0
  const agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'pass-planner-v1',
      async choose(input) {
        return { candidateId: input.structuredCandidateId }
      },
    },
    voice: {
      version: 'must-not-run-v1',
      async speak() {
        voiceCalls++
        return { text: 'invented speech' }
      },
    },
  })

  const output = await agent.decide(source.req, source.view)
  assert.equal(output.decision.kind, 'discuss')
  assert.equal(output.decision.say, '')
  assert.equal(voiceCalls, 0)
  assert.deepEqual(output.trace?.communicationIntent?.actCodes, ['PASS'])
})

test('planner-authorized role talk and public utterance evidence reach voice', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'percival-opening-discussion',
  )
  assert.ok(source)
  const publicInput = projectLanguageInterpreterInput(source.view)
  const utterance = publicInput.utteranceHistory.at(-1)
  assert.ok(utterance)
  let committed: CommittedVoicePlan | undefined
  const agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'public-evidence-planner-v1',
      async choose(input) {
        assert.deepEqual(
          input.context.publicContext.record,
          publicInput.publicContext,
        )
        assert.deepEqual(
          input.context.publicContext.recentUtterances,
          recentPublicUtterances(publicInput),
        )
        assert.equal('privateInfo' in input.context.publicContext, false)
        return {
          candidateId: input.structuredCandidateId,
          communication: {
            version: 'communication-intent-v5',
            channel: 'discussion',
            targetSeats: [utterance.speaker.seat],
            actCodes: [
              'RESPOND_TO_PLAYER',
              'WARN_ROLE_EXPOSURE',
              'CLAIM_ROLE',
            ],
            evidenceRefs: [{
              kind: 'utterance',
              sourceSeq: utterance.sourceSeq,
            }],
            claimedRole: 'percival',
            roleTopic: 'merlin',
            tone: 'natural',
          },
        }
      },
    },
    voice: {
      version: 'capture-authorized-plan-v1',
      async speak(input) {
        committed = structuredClone(input.plan)
        return { text: "I'm Percival. Don't push Merlin to reveal." }
      },
    },
  })

  const output = await agent.decide(source.req, source.view)
  assert.equal(
    output.decision.kind === 'discuss' ? output.decision.say : undefined,
    "I'm Percival. Don't push Merlin to reveal.",
  )
  assert.deepEqual(committed?.communication?.evidenceRefs, [{
    kind: 'utterance',
    sourceSeq: utterance.sourceSeq,
  }])
  assert.equal(committed?.communication?.claimedRole, 'percival')
  assert.equal(committed?.communication?.roleTopic, 'merlin')
  assert.equal('conceal' in (committed?.communication ?? {}), false)

  assert.deepEqual(
    parseExternalDecisionReply(
      source.req,
      structuredClone(output),
      'voice-evidence-test',
      source.view,
    ),
    output,
  )
  const forged = structuredClone(output)
  assert.ok(forged.trace?.communicationIntent)
  forged.trace.communicationIntent.evidenceRefs = [{
    kind: 'utterance',
    sourceSeq: 999_999,
  }]
  assert.deepEqual(
    parseExternalDecisionReply(
      source.req,
      forged,
      'voice-evidence-test',
      source.view,
    ),
    { decision: forged.decision },
  )

  const absentRole = ROLES.find(
    (role) => !source.view.rolesInPlay.includes(role),
  )
  assert.ok(absentRole)
  const forgedAbsentRole = structuredClone(output)
  assert.ok(forgedAbsentRole.trace?.communicationIntent)
  forgedAbsentRole.trace.communicationIntent.claimedRole = absentRole
  assert.deepEqual(
    parseExternalDecisionReply(
      source.req,
      forgedAbsentRole,
      'voice-cast-test',
      source.view,
    ),
    { decision: forgedAbsentRole.decision },
  )
})

test('utterance evidence must be present in the shared recent window', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'percival-opening-discussion',
  )
  assert.ok(source)
  const crowdedView = structuredClone(source.view)
  const events = crowdedView.events as unknown as GameEvent[]
  let seq = Math.max(...events.map((event) => event.seq))
  const addedSeqs: number[] = []
  for (let index = 0; index < 15; index++) {
    addedSeqs.push(++seq)
    events.push({
      seq,
      type: 'utterance',
      visibility: 'public',
      payload: {
        seat: (source.view.seat + 1) % source.view.playerCount,
        text: `Public statement ${index + 1}.`,
        round: source.view.round,
      },
    })
  }
  const publicInput = projectLanguageInterpreterInput(crowdedView)
  assert.equal(
    recentPublicUtterances(publicInput).some(
      (utterance) => utterance.sourceSeq === addedSeqs[0],
    ),
    false,
  )
  let voiceCalls = 0
  const agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'stale-evidence-planner-v1',
      async choose(input) {
        return {
          candidateId: input.structuredCandidateId,
          communication: {
            version: 'communication-intent-v5',
            channel: 'discussion',
            targetSeats: [(source.view.seat + 1) % source.view.playerCount],
            actCodes: ['RESPOND_TO_PLAYER'],
            evidenceRefs: [{ kind: 'utterance', sourceSeq: addedSeqs[0]! }],
            tone: 'natural',
          },
        }
      },
    },
    voice: {
      version: 'must-not-run-v1',
      async speak() {
        voiceCalls++
        return { text: 'stale evidence' }
      },
    },
  })
  const output = await agent.decide(source.req, crowdedView)
  assert.ok(output.trace?.degradation.includes('planner-invalid-communication'))
  assert.equal(voiceCalls, 0)
})

test('absent public evidence and negative-role acts are rejected', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'percival-opening-discussion',
  )
  assert.ok(source)
  assert.equal(
    (COMMUNICATION_ACT_CODES as readonly string[]).includes('DENY_ROLE'),
    false,
  )
  let voiceCalls = 0
  const agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'invented-evidence-planner-v1',
      async choose(input) {
        return {
          candidateId: input.structuredCandidateId,
          communication: {
            version: 'communication-intent-v5',
            channel: 'discussion',
            targetSeats: [0],
            actCodes: ['RESPOND_TO_PLAYER'],
            evidenceRefs: [{ kind: 'utterance', sourceSeq: 999_999 }],
            tone: 'natural',
          },
        }
      },
    },
    voice: {
      version: 'must-not-run-v1',
      async speak() {
        voiceCalls++
        return { text: 'invented evidence' }
      },
    },
  })

  const output = await agent.decide(source.req, source.view)
  assert.ok(output.trace?.degradation.includes('planner-invalid-communication'))
  assert.equal(voiceCalls, 0)
})
