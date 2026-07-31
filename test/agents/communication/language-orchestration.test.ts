// test-lane: contract
// Migration phase 6C; see docs/agent-architecture-migration.md.

import test from 'node:test'
import { mutable } from '../../support/mutable.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createComposedAgent } from '../../../server/agents/composed.ts'
import {
  INVALID_LANGUAGE_INTERPRETER_VERSION,
} from '../../../server/agents/communication/language-orchestration.ts'
import {
  LANGUAGE_EVIDENCE_VERSION,
  type LanguageInterpreter,
  type LanguageInterpreterInput,
} from '../../../server/agents/record/language-types.ts'
import {
  goodProposalScorer,
} from '../../../server/agents/policy/score.ts'
import {
  LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
  type LanguageLikelihoodFactor,
} from '../../../server/agents/belief/language-factor.ts'
import {
  exactBelief,
} from '../../../server/agents/belief/exact.ts'
import {
  questWeightedBeliefModel,
} from '../../../server/agents/belief/quest-card-factor.ts'
import {
  createGame,
  applyDecision,
  expectedDecisions,
} from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { evilPartnersOf, knownEvilOf } from '../../../server/engine/knowledge.ts'
import type {
  DecisionRequest,
  GameEvent,
  PlayerView,
  Seat,
} from '../../../server/engine/types.ts'
import { parseExternalDecisionReply } from '../../../server/agents/external-reply.ts'
import { runArchitectureBench } from '../../../server/eval/architecture-bench.ts'

const INTERPRETER_VERSION = 'fake-phase6c-v1'

function proposalAfterPublicConversation(): {
  req: DecisionRequest
  view: PlayerView
  subject: Seat
} {
  const game = createGame({
    seed: 'phase6c-orchestration',
    playerCount: 5,
    talk: {
      maxRounds: 1,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'last',
    },
  })
  const leader = game.leaderSeat
  applyDecision(game, leader, {
    kind: 'propose',
    team: [leader, (leader + 1) % game.players.length],
    pitch: 'This opening team gives us a useful public baseline.',
  })
  let guard = 0
  while (game.phase === 'discussion') {
    const [request] = expectedDecisions(game)
    applyDecision(game, request.seat, {
      kind: 'discuss',
      say: `Seat ${request.seat + 1} states a public read.`,
    })
    if (++guard > 20) throw new Error('discussion did not terminate')
  }
  const [finalize] = expectedDecisions(game)
  assert.equal(finalize.kind, 'finalize')
  applyDecision(game, finalize.seat, { kind: 'finalize', stick: true })
  while (game.phase === 'vote') {
    for (const request of expectedDecisions(game)) {
      applyDecision(game, request.seat, { kind: 'vote', vote: 'reject' })
    }
  }
  const [req] = expectedDecisions(game)
  assert.equal(req.kind, 'propose')
  const view = viewFor(game, req.seat)
  const subject = view.players.find((player) =>
    player.seat !== view.seat
    && !knownEvilOf(view.privateInfo).includes(player.seat)
    && !evilPartnersOf(view.privateInfo).includes(player.seat)
  )?.seat
  assert.notEqual(subject, undefined)
  return { req, view, subject: subject! }
}

function evidenceFor(
  input: LanguageInterpreterInput,
  viewerSeat: Seat,
  subject: Seat,
  direction: 'moreEvil' | 'moreGood' | 'unchanged' = 'moreEvil',
): readonly unknown[] {
  const source = input.newUtterances.find(
    (utterance) => utterance.speaker.seat !== viewerSeat,
  ) ?? input.newUtterances[0]
  assert.ok(source)
  return [{
    schemaVersion: LANGUAGE_EVIDENCE_VERSION,
    sourceSeq: source.sourceSeq,
    subject,
    direction,
    class: 'truthTracking',
    confidence: 'high',
    publicRationale: 'Deterministic fake evidence for the orchestration contract.',
    interpreterVersion: INTERPRETER_VERSION,
  }]
}

function fakeInterpreter(
  viewerSeat: Seat,
  subject: Seat,
  calls: LanguageInterpreterInput[],
  direction: 'moreEvil' | 'moreGood' | 'unchanged' = 'moreEvil',
): LanguageInterpreter {
  return {
    interpreterVersion: INTERPRETER_VERSION,
    async interpret(input) {
      calls.push(structuredClone(input))
      return evidenceFor(input, viewerSeat, subject, direction)
    },
  }
}

test('opt-in orchestration is deterministic and causally reaches scoring', async () => {
  const { req, view, subject } = proposalAfterPublicConversation()
  const off = await createComposedAgent({
    seed: 'phase6c-causal',
    scorer: goodProposalScorer,
  }).decide(req, view)

  const callsA: LanguageInterpreterInput[] = []
  const callsB: LanguageInterpreterInput[] = []
  const stages: string[] = []
  const one = await createComposedAgent({
    seed: 'phase6c-causal',
    scorer: goodProposalScorer,
    languageInterpreter: fakeInterpreter(view.seat, subject, callsA),
    onStage: (stage) => stages.push(stage),
  }).decide(req, view)
  const two = await createComposedAgent({
    seed: 'phase6c-causal',
    scorer: goodProposalScorer,
    languageInterpreter: fakeInterpreter(view.seat, subject, callsB),
  }).decide(req, structuredClone(view))

  assert.deepEqual(one, two)
  assert.deepEqual(callsA, callsB)
  assert.equal(callsA.length, 1)
  // Candidate enumeration now completes before the candidate-aware analysis
  // that consumes that exact surface.
  assert.deepEqual(
    stages.slice(0, 4),
    ['language', 'cognition', 'candidates', 'analysis'],
  )
  assert.equal(one.trace!.beliefModelVersion, 'exact-constraints+bounded-language-v1')
  assert.equal(
    one.trace!.componentVersions?.languageEvidence,
    'bounded-language-only-v1',
  )
  assert.equal(one.trace!.componentVersions?.factors, 'bounded-language-only-v1')
  assert.notDeepEqual(
    one.trace!.beliefPlayerMarginals,
    off.trace!.beliefPlayerMarginals,
  )
  assert.notDeepEqual(
    one.trace!.candidateScores,
    off.trace!.candidateScores,
  )
  assert.deepEqual(
    one.trace!.languageEvidence?.admittedSourceSeqs,
    [callsA[0].newUtterances.find(
      (utterance) => utterance.speaker.seat !== view.seat,
    )!.sourceSeq],
  )
})

test('unchanged and viewer-authored reads preserve the exact posterior', async () => {
  const { req, view, subject } = proposalAfterPublicConversation()
  const baseline = await createComposedAgent({
    seed: 'phase6c-noop',
  }).decide(req, view)
  const unchanged = await createComposedAgent({
    seed: 'phase6c-noop',
    languageInterpreter: fakeInterpreter(view.seat, subject, [], 'unchanged'),
  }).decide(req, view)
  const own = await createComposedAgent({
    seed: 'phase6c-noop',
    languageInterpreter: {
      interpreterVersion: INTERPRETER_VERSION,
      async interpret(input) {
        const source = input.newUtterances.find(
          (utterance) => utterance.speaker.seat === view.seat,
        )
        assert.ok(source)
        return [{
          ...evidenceFor(input, view.seat, subject)[0] as object,
          sourceSeq: source.sourceSeq,
        }]
      },
    },
  }).decide(req, view)

  assert.deepEqual(
    unchanged.trace!.beliefPlayerMarginals,
    baseline.trace!.beliefPlayerMarginals,
  )
  assert.deepEqual(
    own.trace!.beliefPlayerMarginals,
    baseline.trace!.beliefPlayerMarginals,
  )
  assert.equal(unchanged.trace!.beliefModelVersion, 'exact-constraints-v1')
  assert.equal(own.trace!.beliefModelVersion, 'exact-constraints-v1')
})

test('quest mechanical provenance composes with language attribution', async () => {
  const { req, view, subject } = proposalAfterPublicConversation()
  const output = await createComposedAgent({
    seed: 'phase6c-quest',
    beliefModel: questWeightedBeliefModel,
    languageInterpreter: fakeInterpreter(view.seat, subject, []),
  }).decide(req, view)

  assert.equal(
    output.trace!.componentVersions?.factors,
    'quest-card-only-v1+bounded-language-only-v1',
  )
  assert.equal(
    output.trace!.beliefModelVersion,
    'exact-constraints+quest-card-v1+bounded-language-v1',
  )
  assert.ok(output.trace!.beliefProvenance?.some(
    (entry) => entry.factorId === 'language',
  ))
  const possibleKeys = new Set(
    output.trace!.topHypotheses.map((hypothesis) => hypothesis.worldKey),
  )
  assert.ok(possibleKeys.size > 0)
})

test('admitted reads commit even when the language factor degrades', async () => {
  const { req, view, subject } = proposalAfterPublicConversation()
  const calls: LanguageInterpreterInput[] = []
  const failedFactor: LanguageLikelihoodFactor = {
    id: 'language',
    version: LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
    logLikelihood() {
      throw new Error('fake factor failure')
    },
  }
  const agent = createComposedAgent({
    seed: 'phase6c-factor-failure',
    languageInterpreter: fakeInterpreter(view.seat, subject, calls),
    languageFactor: failedFactor,
  })
  const first = await agent.decide(req, view)
  const second = await agent.decide(req, view)
  assert.equal(calls.length, 1)
  assert.ok(first.trace!.degradation.includes('language-factor-failed'))
  assert.deepEqual(
    first.trace!.languageEvidence?.admittedSourceSeqs,
    second.trace!.languageEvidence?.cumulativeSourceSeqs,
  )
  assert.deepEqual(first.decision, second.decision)
})

test('interpreter failures and malformed replies skip each batch once', async (t) => {
  const { req, view } = proposalAfterPublicConversation()
  const mechanical = await createComposedAgent({
    seed: 'phase6c-failure',
  }).decide(req, view)
  const cases: readonly {
    name: string
    expected: string
    interpret(): Promise<unknown>
  }[] = [
    {
      name: 'throw',
      expected: 'language-interpreter-failed',
      async interpret() {
        throw new Error('fake unavailable interpreter')
      },
    },
    {
      name: 'malformed',
      expected: 'language-evidence-invalid-output',
      async interpret() {
        return { forged: true }
      },
    },
  ]
  for (const item of cases) {
    await t.test(item.name, async () => {
      let calls = 0
      const agent = createComposedAgent({
        seed: 'phase6c-failure',
        languageInterpreter: {
          interpreterVersion: INTERPRETER_VERSION,
          async interpret() {
            calls += 1
            return item.interpret()
          },
        },
      })
      const first = await agent.decide(req, view)
      const second = await agent.decide(req, view)
      assert.equal(calls, 1)
      assert.ok(first.trace!.degradation.includes(item.expected))
      assert.deepEqual(first.decision, mechanical.decision)
      assert.deepEqual(second.decision, mechanical.decision)
      assert.equal(
        first.trace!.languageEvidence?.cursorThroughSeq,
        second.trace!.languageEvidence?.cursorThroughSeq,
      )
    })
  }
})

test('invalid interpreter version is not called and advances the public cursor', async () => {
  const { req, view } = proposalAfterPublicConversation()
  let calls = 0
  const agent = createComposedAgent({
    seed: 'phase6c-invalid-version',
    languageInterpreter: {
      interpreterVersion: '',
      async interpret() {
        calls += 1
        return []
      },
    },
  })
  const first = await agent.decide(req, view)
  const second = await agent.decide(req, view)
  assert.equal(calls, 0)
  assert.ok(first.trace!.degradation.includes(
    'language-interpreter-invalid-version',
  ))
  assert.equal(
    first.trace!.languageEvidence?.interpreterVersion,
    INVALID_LANGUAGE_INTERPRETER_VERSION,
  )
  assert.equal(
    agent.resolvedBrain().description.configuredPipeline
      .belief.languageInterpreter,
    first.trace!.languageEvidence?.interpreterVersion,
  )
  assert.deepEqual(parseExternalDecisionReply(req, first), first)
  assert.equal(
    first.trace!.languageEvidence?.cursorThroughSeq,
    Math.max(...view.events
      .filter((event) => event.visibility === 'public')
      .map((event) => event.seq)),
  )
  assert.equal(
    first.trace!.languageEvidence?.cursorThroughSeq,
    second.trace!.languageEvidence?.cursorThroughSeq,
  )
})

test('runtime non-string interpreter versions fail closed before a call', async () => {
  const { req, view } = proposalAfterPublicConversation()
  let calls = 0
  const mechanical = await createComposedAgent({
    seed: 'phase6c-non-string-version',
  }).decide(req, view)
  const agent = createComposedAgent({
    seed: 'phase6c-non-string-version',
    languageInterpreter: {
      interpreterVersion: 123,
      async interpret() {
        calls += 1
        return []
      },
    } as unknown as LanguageInterpreter,
  })
  const output = await agent.decide(req, view)
  assert.equal(calls, 0)
  assert.deepEqual(output.decision, mechanical.decision)
  assert.ok(output.trace!.degradation.includes(
    'language-interpreter-invalid-version',
  ))
  assert.equal(
    output.trace!.languageEvidence?.interpreterVersion,
    INVALID_LANGUAGE_INTERPRETER_VERSION,
  )
  assert.equal(
    agent.resolvedBrain().description.configuredPipeline
      .belief.languageInterpreter,
    output.trace!.languageEvidence?.interpreterVersion,
  )
  assert.deepEqual(parseExternalDecisionReply(req, output), output)
})

test('interpreter version drift fails closed without corrupting cognition', async () => {
  const { req, view, subject } = proposalAfterPublicConversation()
  let calls = 0
  const mutable: {
    interpreterVersion: string
    interpret(input: LanguageInterpreterInput): Promise<unknown>
  } = {
    interpreterVersion: INTERPRETER_VERSION,
    async interpret(input) {
      calls += 1
      return evidenceFor(input, view.seat, subject)
    },
  }
  const agent = createComposedAgent({
    seed: 'phase6c-version-drift',
    languageInterpreter: mutable,
  })
  const first = await agent.decide(req, view)
  mutable.interpreterVersion = 'fake-phase6c-v2'
  const second = await agent.decide(req, view)
  assert.equal(calls, 1)
  assert.ok(second.trace!.degradation.includes(
    'language-interpreter-invalid-version',
  ))
  assert.deepEqual(
    second.trace!.beliefPlayerMarginals,
    first.trace!.beliefPlayerMarginals,
  )
  assert.deepEqual(second.decision, first.decision)
})

test('unexpected cognition commit failure advances no language state', async () => {
  const { req, view, subject } = proposalAfterPublicConversation()
  let calls = 0
  let returnBadCursor = false
  const beliefModel = {
    version: 'atomic-test-belief-v1',
    factorsVersion: 'off',
    infer(candidate: PlayerView) {
      const belief = exactBelief(candidate)
      return {
        ...belief,
        modelVersion: 'atomic-test-belief-v1',
        ...(returnBadCursor
          ? { throughSeq: belief.throughSeq - 1 }
          : {}),
      }
    },
  }
  const agent = createComposedAgent({
    seed: 'phase6c-atomic',
    beliefModel,
    languageInterpreter: {
      interpreterVersion: INTERPRETER_VERSION,
      async interpret(input) {
        calls += 1
        return evidenceFor(input, view.seat, subject)
      },
    },
  })
  await agent.decide(req, view)
  const advanced = structuredClone(view)
  const sourceSeq = Math.max(...advanced.events.map((event) => event.seq)) + 1
  const publicUtterance: GameEvent = {
    seq: sourceSeq,
    type: 'utterance',
    visibility: 'public',
    payload: {
      seat: (view.seat + 1) % view.playerCount,
      text: 'A new public batch for the atomic-state test.',
      round: view.round,
    },
  }
  mutable(advanced).events.push(mutable(publicUtterance))
  returnBadCursor = true
  await assert.rejects(agent.decide(req, advanced), /resolved belief returned cursor/)
  const callsAfterFailure = calls
  returnBadCursor = false
  await agent.decide(req, advanced)
  assert.equal(calls, callsAfterFailure + 1)
})

test('no-speech public history never calls the interpreter', async () => {
  const game = createGame({
    seed: 'phase6c-no-speech',
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const [req] = expectedDecisions(game)
  const view = viewFor(game, req.seat)
  let calls = 0
  const agent = createComposedAgent({
    seed: 'phase6c-no-speech',
    languageInterpreter: {
      interpreterVersion: INTERPRETER_VERSION,
      async interpret() {
        calls += 1
        return []
      },
    },
  })
  const first = await agent.decide(req, view)
  const second = await agent.decide(req, view)
  assert.equal(calls, 0)
  assert.equal(
    first.trace!.languageEvidence?.cursorThroughSeq,
    second.trace!.languageEvidence?.cursorThroughSeq,
  )
  assert.deepEqual(first.decision, second.decision)
})

test('interpreter receives a clone of the public-only projection', async () => {
  const { req, view, subject } = proposalAfterPublicConversation()
  Object.assign(view.privateInfo, { sentinel: 'PRIVATE_CANARY' })
  let serialized = ''
  const output = await createComposedAgent({
    seed: 'phase6c-canary',
    languageInterpreter: {
      interpreterVersion: INTERPRETER_VERSION,
      async interpret(input) {
        serialized = JSON.stringify(input)
        ;(input as unknown as Record<string, unknown>).forged = 'MUTATION'
        return evidenceFor(input, view.seat, subject)
      },
    },
  }).decide(req, view)
  assert.ok(!serialized.includes('PRIVATE_CANARY'))
  assert.ok(!serialized.includes('"privateInfo"'))
  assert.ok(!JSON.stringify(output.trace).includes('MUTATION'))
  assert.ok(!JSON.stringify(output.trace).includes('publicRationale'))
})

test('language attribution survives external ingress validation and artifact JSON', async () => {
  const { req, view, subject } = proposalAfterPublicConversation()
  const output = await createComposedAgent({
    seed: 'phase6c-stdio-artifact',
    languageInterpreter: fakeInterpreter(view.seat, subject, []),
  }).decide(req, view)
  assert.deepEqual(parseExternalDecisionReply(req, output), output)
  const artifactRoundTrip = JSON.parse(JSON.stringify({
    decisionTraces: [output.trace],
  }))
  assert.deepEqual(
    artifactRoundTrip.decisionTraces[0].languageEvidence,
    output.trace!.languageEvidence,
  )

  const forged = structuredClone(output)
  ;(forged.trace!.languageEvidence as unknown as Record<string, unknown>)
    .publicRationale = 'must remain excluded'
  assert.deepEqual(parseExternalDecisionReply(req, forged), { decision: forged.decision })

  const missing = structuredClone(output)
  delete missing.trace!.languageEvidence
  assert.deepEqual(parseExternalDecisionReply(req, missing), { decision: missing.decision })

  const futureSource = structuredClone(output)
  futureSource.trace!.languageEvidence!.cumulativeSourceSeqs = [
    futureSource.trace!.languageEvidence!.cursorThroughSeq + 1,
  ]
  assert.deepEqual(
    parseExternalDecisionReply(req, futureSource),
    { decision: futureSource.decision },
  )

  const forgedProvenance = structuredClone(output)
  const languageContribution = forgedProvenance.trace!.beliefProvenance?.find(
    (entry) => entry.factorId === 'language',
  )
  assert.ok(languageContribution)
  ;(languageContribution.evidenceIds as string[])[0] =
    languageContribution.evidenceIds[0].replace(
      `language:${INTERPRETER_VERSION}`,
      'language:forged-interpreter-v1',
    )
  assert.deepEqual(
    parseExternalDecisionReply(req, forgedProvenance),
    { decision: forgedProvenance.decision },
  )
})

test('free architecture bank runs the attributed language pipeline', async () => {
  let calls = 0
  const artifacts = await runArchitectureBench({
    bankId: 'phase6c-language',
    cases: [{
      id: 'phase6c-5p-merlin',
      seed: 'architecture-v1-5-merlin',
      playerCount: 5,
      roles: [
        'merlin',
        'percival',
        'servant',
        'morgana',
        'assassin',
      ],
      talk: {
        maxRounds: 0,
        maxRoundsAfterChange: 0,
        leaderInDiscussion: 'none',
      },
      targetRole: 'merlin',
      expectedTargetSeat: 4,
    }],
    variants: [{
      id: 'language-structured',
      components: {
        brain: 'brain-spec-v1',
        mechanicalBelief: 'exact-constraints-v1',
        beliefPipeline:
          'exact-constraints-v1+bounded-language-only-v1',
        factors: 'bounded-language-only-v1',
        languageEvidence: 'bounded-language-only-v1',
        policy: 'composed-policy-v1',
        scorer: 'compatibility-scorer-v1',
        planner: 'planner-off',
        voice: 'voice-off',
      },
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
        languageInterpreter: {
          interpreterVersion: INTERPRETER_VERSION,
          async interpret(input) {
            calls += 1
            const source = input.newUtterances.find(
              (utterance) => utterance.speaker.seat !== context.seat,
            ) ?? input.newUtterances[0]
            if (!source) return []
            return [{
              schemaVersion: LANGUAGE_EVIDENCE_VERSION,
              sourceSeq: source.sourceSeq,
              subject: (context.seat + 1) % input.publicContext.playerCount,
              direction: 'moreEvil',
              class: 'other',
              confidence: 'low',
              publicRationale: 'Deterministic architecture-bank fake.',
              interpreterVersion: INTERPRETER_VERSION,
            }]
          },
        },
      }),
    }],
  })
  assert.equal(artifacts.length, 1)
  assert.equal(calls, 0)
  assert.equal(artifacts[0].telemetry?.llm, undefined)
  assert.ok(artifacts[0].decisionTraces?.every((trace) =>
    trace.componentVersions?.languageEvidence === 'bounded-language-only-v1'
    && trace.componentVersions.factors === 'bounded-language-only-v1'
    && trace.languageEvidence !== undefined))
})

test('language-off source and trace contracts remain unchanged', async () => {
  const { req, view } = proposalAfterPublicConversation()
  const stages: string[] = []
  const output = await createComposedAgent({
    seed: 'phase6c-off-regression',
    onStage: (stage) => stages.push(stage),
  }).decide(req, view)
  assert.equal(stages[0], 'cognition')
  assert.ok(!stages.includes('language'))
  assert.equal(output.trace!.componentVersions?.languageEvidence, 'off')
  assert.equal(output.trace!.componentVersions?.factors, 'off')
  assert.equal(output.trace!.componentVersions?.mechanicalBelief, undefined)
  assert.equal(output.trace!.componentVersions?.beliefPipeline, undefined)
  assert.equal(output.trace!.languageEvidence, undefined)

  const source = [
    readFileSync('server/agents/composed.ts', 'utf8'),
    readFileSync('server/agents/communication/language-orchestration.ts', 'utf8'),
  ].join('\n')
  assert.doesNotMatch(source, /from ['"].*llm\//)
  assert.doesNotMatch(source, /OpenRouter|OPENROUTER_API_KEY/)
})
