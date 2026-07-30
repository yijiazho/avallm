// Migration phase 7R3B2B; see docs/agent-architecture-migration.md.

import test from 'node:test'
import { mutable } from './support/mutable.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pendingQuest, resolveQuest } from './support/quests.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
} from '../server/agents/decision-layers/robust-evil-quest-card.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../server/agents/components/robust-evil-quest-card.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'
import {
  admitDecisionTrace,
} from '../server/agents/admission/composed-trace.ts'
import {
  parseExternalDecisionReply,
} from '../server/agents/external-reply.ts'
import {
  composedPolicyContext,
} from '../server/agents/communication/composed-renderer.ts'
import {
  analyzeSituation,
} from '../server/agents/analysis/situation.ts'
import {
  candidateIdForDecision,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  readDecisionFixtures,
} from '../server/eval/decision-fixtures.ts'
import type {
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'

function robustQuestFixture(decisive = false): {
  req: DecisionRequest
  view: PlayerView
} {
  const source = readDecisionFixtures()
    .find((fixture) => fixture.id === 'oberon-two-fail-quest')!
  const view = structuredClone(source.view)
  mutable(view).seat = 4
  mutable(view).name = view.players[4].name
  mutable(view).role = 'assassin'
  mutable(view).alignment = 'evil'
  mutable(view).privateInfo = { kind: 'evil', evilPartners: [5] }
  if (!decisive) {
    mutable(view).quests[0] = resolveQuest(view.quests[0], { result: 'success', failCount: 0 })
    mutable(view).quests[1] = resolveQuest(view.quests[1], { result: 'fail', failCount: 1 })
    mutable(view).quests[2] = pendingQuest(view.quests[2])
  }
  return {
    req: { ...source.req, seat: view.seat },
    view,
  }
}

test('robust D3 owns one strategic boundary and no legacy flat authority', async () => {
  const { req, view } = robustQuestFixture()
  const plannerInputs: string[][] = []
  const agent = createComposedAgent({
    seed: 'phase7r3b2b-native-authority',
    evilQuestCardPolicy: 'robust-heterogeneous',
    scorer: {
      version: 'hostile-reopen-v1',
      score(context) {
        return context.candidates.map((candidate) => ({
          version: 'hostile-reopen-v1',
          candidateId: candidate.id,
          value: candidate.decision.kind === 'quest'
              && candidate.decision.card === 'fail'
            ? 1_000
            : 0,
          viable: true,
          reasonCodes: [],
        }))
      },
    },
    planner: {
      version: 'hostile-planner-v1',
      async choose(input) {
        plannerInputs.push(
          input.context.viableCandidates.map((candidate) => candidate.id),
        )
        return {
          candidateId: 'legal-candidates-v1:quest:fail',
          reasonCodes: ['HOSTILE_REOPEN'],
        }
      },
    },
  })
  const output = await agent.decide(req, view)
  const trace = output.trace!
  const surface = trace.decisionLayerRun!.surface

  assert.deepEqual(trace.decisionLayerRun!.configured, [
    ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
  ])
  assert.equal(trace.decisionLayerRun!.journal[0].status, 'applied')
  assert.deepEqual(surface.survivorCandidateIds, [
    surface.selectedCandidateId,
  ])
  assert.equal(trace.chosenCandidateId, surface.selectedCandidateId)
  assert.ok(trace.degradation.includes('scorer-invalid-output'))
  assert.deepEqual(
    plannerInputs,
    [],
    'a committed strategic singleton does not invoke a reopening planner',
  )
  assert.deepEqual(
    trace.components!.policyUse.find(
      (entry) =>
        entry.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
    )?.stages,
    ['strategic-decision'],
  )
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace,
    req,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: 'phase7r3b2b-native-authority',
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  }).kind, 'trusted-exact')
})

test('planner context honors an unselected strategic narrowing', async () => {
  const { req, view } = robustQuestFixture()
  const successId = candidateIdForDecision({
    kind: 'quest',
    card: 'success',
  })
  const failId = candidateIdForDecision({ kind: 'quest', card: 'fail' })
  const candidates = legalCandidates(req, view)
  const forced = {
    version: 'forced-policy-v1' as const,
    applied: false,
    reasonCodes: [],
    allowedCandidateIds: [successId, failId],
  }
  const context = composedPolicyContext(
    view,
    analyzeSituation(view),
    candidates,
    forced,
    {
      survivorCandidateIds: [successId],
      reasonCodes: ['TEST_STRATEGIC_NARROWING'],
    },
    candidates.map((candidate) =>
      candidate.id === successId
        ? {
        version: 'hostile-score-v1',
        candidateId: candidate.id,
        value: 0,
        viable: true,
        reasonCodes: [],
          }
        : {
        version: 'hostile-score-v1',
        candidateId: candidate.id,
        value: 1_000,
        viable: true,
        reasonCodes: ['HOSTILE_REMOVED_PREFERENCE'],
          }),
    successId,
  )
  const hostilePlanner = {
    async choose() {
      return [...context.viableCandidates]
        .sort((left, right) => right.score - left.score)[0].id
    },
  }

  assert.deepEqual(context.forcedPolicy.allowedCandidateIds, [
    successId,
    failId,
  ])
  assert.deepEqual(
    context.viableCandidates.map((candidate) => candidate.id),
    [successId],
  )
  assert.equal(await hostilePlanner.choose(), successId)
})

test('universal selection suppresses robust execution and component use', async () => {
  const { req, view } = robustQuestFixture(true)
  const output = await createComposedAgent({
    seed: 'phase7r3b2b-universal-suppression',
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(req, view)
  const run = output.trace!.decisionLayerRun!
  const use = output.trace!.components!.policyUse.find(
    (entry) => entry.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
  )!

  assert.equal(run.journal[0].status, 'suppressed')
  assert.equal(run.operations.layersExecuted, 0)
  assert.equal(run.operations.componentPayloadReads, 0)
  assert.equal(use.used, false)
  assert.deepEqual(use.stages, [])
})

test('removed exact quota cannot be configured as a runtime mode', () => {
  assert.throws(
    () => createComposedAgent({
      seed: 'phase7r3b3a-exact-removed',
      evilQuestCardPolicy: 'visible-exact-quota' as never,
    }),
    /invalid evilQuestCardPolicy mode/,
  )
})

test('external ingress strips forged robust telemetry without discarding its legal action', async () => {
  const { req, view } = robustQuestFixture()
  const output = await createComposedAgent({
    seed: 'phase7r3b2b-stdio',
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(req, view)
  const forged = structuredClone(output.trace!)
  const forgedSurface = forged.decisionLayerRun!.surface as {
    selectedCandidateId?: string
  }
  forgedSurface.selectedCandidateId =
    forgedSurface.selectedCandidateId?.endsWith(':fail')
      ? 'legal-candidates-v1:quest:success'
      : 'legal-candidates-v1:quest:fail'

  assert.deepEqual(
    parseExternalDecisionReply(
      req,
      { decision: output.decision, trace: forged },
      'forged robust trace',
      view,
    ),
    { decision: output.decision },
  )
})

test('robust concrete authority stays outside universal and frame kernels', () => {
  const forced = readFileSync(
    new URL('../server/agents/policy/forced.ts', import.meta.url),
    'utf8',
  )
  const frame = readFileSync(
    new URL('../server/agents/policy/decision-frame.ts', import.meta.url),
    'utf8',
  )
  const concrete = readFileSync(
    new URL(
      '../server/agents/decision-layers/robust-evil-quest-card.ts',
      import.meta.url,
    ),
    'utf8',
  )

  assert.doesNotMatch(forced, /ROBUST_EVIL|robust-heterogeneous/)
  assert.doesNotMatch(frame, /ROBUST_EVIL|robust-heterogeneous/)
  assert.equal([...concrete.matchAll(/candidateIdForDecision\(/g)].length, 1)
})
