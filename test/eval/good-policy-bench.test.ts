// test-lane: eval
// Migration phase 4D; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../server/engine/game.ts'
import { parseExternalDecisionReply } from '../../server/agents/external-reply.ts'
import { runArchitectureBench } from '../../server/eval/architecture-bench.ts'
import {
  architectureReport,
  renderArchitectureReport,
} from '../../server/eval/architecture-report.ts'
import { validateArchitectureBank } from '../../server/eval/architecture-bank.ts'
import {
  PHASE4_POLICY_BANK,
  PHASE4_POLICY_BANK_ID,
} from '../../server/eval/good-policy-bank.ts'
import {
  phase4PolicyVariants,
  PHASE4_POLICY_EVAL_VERSION,
} from '../../server/eval/good-policy-bench.ts'

test('Phase 4 policy bank freezes 180 good-side deals across every table size', () => {
  assert.equal(PHASE4_POLICY_BANK_ID, 'phase4-good-v1')
  assert.equal(PHASE4_POLICY_BANK.length, 180)
  assert.doesNotThrow(() =>
    validateArchitectureBank(PHASE4_POLICY_BANK, {
      requireCoverage: false,
    }))
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    const cases = PHASE4_POLICY_BANK.filter(
      (candidate) => candidate.playerCount === playerCount,
    )
    assert.equal(cases.length, 30)
    assert.deepEqual(
      [...new Set(cases.map((candidate) => candidate.targetRole))].sort(),
      ['merlin', 'percival', 'servant'],
    )
    for (const candidate of cases) {
      const game = createGame({
        seed: candidate.seed,
        playerCount: candidate.playerCount,
        roles: [...candidate.roles],
        talk: candidate.talk,
      })
      assert.equal(
        game.players.find(
          (player) => player.role === candidate.targetRole,
        )?.seat,
        candidate.expectedTargetSeat,
      )
    }
  }
})

test('Phase 4 policy comparison reports confidence, latency, safety, and variation', async () => {
  const artifacts = await runArchitectureBench({
    variants: phase4PolicyVariants(),
    cases: PHASE4_POLICY_BANK.slice(0, 1),
    bankId: PHASE4_POLICY_BANK_ID,
  })
  assert.equal(artifacts.length, 3)
  assert.ok(artifacts.every(
    (artifact) =>
      artifact.architecture?.components.evaluation
        === PHASE4_POLICY_EVAL_VERSION,
  ))
  assert.ok(artifacts.every(
    (artifact) =>
      artifact.telemetry?.decisionLatency?.samples.length,
  ))
  assert.ok(artifacts.every(
    (artifact) =>
      artifact.telemetry!.decisionLatency!.samples.every(
        (sample) =>
          Number.isFinite(sample.milliseconds)
          && sample.milliseconds >= 0,
      ),
  ))

  const report = architectureReport(artifacts)
  assert.deepEqual(architectureReport(artifacts), report)
  assert.equal(report.schema, 3)
  assert.deepEqual(
    report.variants.map((variant) => variant.id),
    ['compatibility', 'structured-only', 'hybrid'],
  )
  for (const variant of report.variants) {
    assert.ok(variant.latency.samples > 0)
    assert.equal(variant.safety.hiddenInformationViolations, 0)
    assert.equal(variant.safety.traceAttributionViolations, 0)
    assert.ok(variant.safety.hiddenInformationChecks > 0)
    assert.ok(variant.safety.traceAttributionChecks > 0)
    for (const estimate of [
      variant.decisionQuality.targetWinRate,
      variant.decisionQuality.cleanInitialProposalRate,
      variant.decisionQuality.voteTruthAccuracy,
    ]) {
      assert.ok(estimate.trials > 0)
      assert.ok(estimate.interval95)
      assert.ok(estimate.interval95!.low <= estimate.rate!)
      assert.ok(estimate.rate! <= estimate.interval95!.high)
    }
  }

  const hybridArtifact = artifacts.find(
    (artifact) => artifact.architecture?.variant === 'hybrid',
  )!
  const hybridSummary = report.variants.find(
    (variant) => variant.id === 'hybrid',
  )!
  const spokenTraceCount = hybridArtifact.decisionTraces!.filter((trace) =>
    (
      trace.action.kind === 'discuss'
      && Boolean(trace.action.say)
    )
    || (
      trace.action.kind === 'propose'
      && Boolean(trace.action.pitch)
    )
    || (
      trace.action.kind === 'finalize'
      && trace.action.stick === false
      && Boolean(trace.action.reason)
    )).length
  assert.equal(
    hybridSummary.safety.hiddenInformationChecks,
    1 + spokenTraceCount,
  )
  const admittedVote = hybridArtifact.decisionTraces?.find(
    (trace) =>
      trace.request.kind === 'vote'
      && trace.chosenCandidateId !== trace.structuredCandidateId
      && trace.plannerReasonCodes?.includes(
        'GOOD_VOTE_SEEDED_VIABLE_BAND',
      ),
  )
  assert.ok(admittedVote)
  assert.equal(
    admittedVote!.plannerCandidateId,
    admittedVote!.chosenCandidateId,
  )

  const rendered = renderArchitectureReport(report)
  assert.match(rendered, /95%/)
  assert.match(rendered, /clean-proposal/)
  assert.match(rendered, /seeded-vote/)
  assert.match(rendered, /latency/)
  assert.match(rendered, /safety hidden 0\//)

  const leaked = structuredClone(hybridArtifact)
  const proposalTrace = leaked.decisionTraces?.find(
    (trace) => trace.action.kind === 'propose',
  )
  assert.ok(proposalTrace)
  if (proposalTrace!.action.kind === 'propose') {
    proposalTrace!.action.pitch = proposalTrace!.beliefModelVersion
  }
  const leakedSummary = architectureReport([leaked]).variants[0]
  assert.ok(leakedSummary.safety.hiddenInformationViolations > 0)
  assert.ok(leakedSummary.safety.traceAttributionViolations > 0)
  assert.equal(
    leakedSummary.safety.hiddenInformationChecks,
    hybridSummary.safety.hiddenInformationChecks,
  )
  assert.equal(
    leakedSummary.componentEvidence!.decisions,
    hybridSummary.componentEvidence!.decisions - 1,
  )
})

test('external ingress rejects forged admitted planner reasons', async () => {
  const artifacts = await runArchitectureBench({
    variants: phase4PolicyVariants().filter(
      (variant) => variant.id === 'hybrid',
    ),
    cases: PHASE4_POLICY_BANK.slice(0, 1),
    bankId: 'phase4d-stdio-reasons',
  })
  const trace = artifacts[0].decisionTraces?.find(
    (candidate) => candidate.plannerReasonCodes?.length,
  )
  assert.ok(trace)
  assert.doesNotThrow(() =>
    parseExternalDecisionReply(
      trace!.request,
      { decision: trace!.action, trace },
      'phase4d-valid',
    ))
  const legacy = structuredClone(trace!)
  delete legacy.structuredCandidateId
  delete legacy.plannerReasonCodes
  assert.doesNotThrow(() =>
    parseExternalDecisionReply(
      legacy.request,
      { decision: legacy.action, trace: legacy },
      'phase4c-compatible',
    ))
  const forged = structuredClone(trace!)
  forged.plannerReasonCodes = ['INVENTED_PRIVATE_REASON']
  assert.deepEqual(
    parseExternalDecisionReply(
      forged.request,
      { decision: forged.action, trace: forged },
      'phase4d-forged',
    ),
    { decision: forged.action },
  )
})
