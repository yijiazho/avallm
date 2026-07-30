// Migration phase 6D; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { assertWallClockBelow } from './helpers/performance-gate.ts'
import {
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
  LANGUAGE_WEIGHTED_BELIEF_VERSION,
} from '../server/agents/belief/language-factor.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
} from '../server/agents/belief/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import { parseExternalDecisionReply } from '../server/agents/external-reply.ts'
import {
  ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID,
  ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE,
  ARCHITECTURE_BANK,
} from '../server/eval/architecture-bank.ts'
import {
  activeLanguageEvaluationVariant,
  ACTIVE_LANGUAGE_EVALUATION_PIPELINE,
  ACTIVE_LANGUAGE_EVALUATION_INTERPRETER_VERSION,
  type ActiveLanguageEvaluationStats,
} from '../server/eval/active-language-bank.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import {
  architectureReport,
} from '../server/eval/architecture-report.ts'
import type { GameArtifact } from '../server/eval/artifact.ts'

async function activeRun(stats?: ActiveLanguageEvaluationStats) {
  return runArchitectureBench({
    bankProfile: ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE,
    variants: [activeLanguageEvaluationVariant(stats)],
  })
}

function attributedViolations(artifact: GameArtifact): number {
  return architectureReport([artifact])
    .variants[0].safety.traceAttributionViolations
}

function staticTraceVariant(
  kind: 'language-off' | 'external',
  forgedStable?: 'mechanicalBelief' | 'beliefPipeline',
): ArchitectureVariant {
  const external = kind === 'external'
  return {
    id: `${kind}${forgedStable ? `-forged-${forgedStable}` : ''}`,
    paid: false,
    components: external
      ? {
          // A self-described producer the host does not reconstruct: the
          // component versions are opaque strings we do not own, declared
          // against a real non-composed execution mode.
          mode: 'raw-llm',
          brain: 'external',
          belief: 'external',
          factors: 'external',
          languageEvidence: 'external',
          policy: 'external',
          scorer: 'external',
          planner: 'external',
          voice: 'external',
        }
      : {
          mode: 'compatibility',
          brain: 'brain-spec-v1',
          belief: EXACT_BELIEF_MODEL_VERSION,
          factors: 'off',
          languageEvidence: 'off',
          policy: 'composed-policy-v1',
          scorer: 'compatibility-scorer-v1',
          planner: 'planner-off',
          voice: 'voice-off',
        },
    createTargetAgent: (context) => {
      const inner = createComposedAgent({ seed: context.seed })
      return {
        async decide(req, view) {
          const output = await inner.decide(req, view)
          const trace = structuredClone(output.trace!)
          if (external) {
            trace.agentMode = 'raw-llm'
            trace.beliefModelVersion = 'external'
            trace.componentVersions = {
              ...trace.componentVersions!,
              brain: 'external',
              belief: 'external',
              factors: 'external',
              languageEvidence: 'external',
              policy: 'external',
              scorer: 'external',
              planner: 'external',
              voice: 'external',
            }
          }
          if (forgedStable) {
            trace.componentVersions![forgedStable] =
              `forged-${forgedStable}-v1`
          }
          return { decision: output.decision, trace }
        },
        privateTraceSink(trace) {
          context.onDecisionTrace?.(trace)
        },
      }
    },
  }
}

test('active public-dialogue bank exercises mixed belief snapshots for free', async () => {
  const stats = { calls: 0, emittedReads: 0 }
  const [artifact] = await activeRun(stats)
  const traces = artifact.decisionTraces ?? []
  const beliefVersions = new Set(
    traces.map((trace) => trace.beliefModelVersion),
  )

  assert.equal(
    artifact.architecture?.bank,
    ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID,
  )
  assert.ok(stats.calls > 0)
  assert.ok(stats.emittedReads > 0)
  assert.ok(traces.some(
    (trace) => (trace.languageEvidence?.cumulativeSourceSeqs.length ?? 0) > 0,
  ))
  assert.deepEqual(
    [...beliefVersions].sort(),
    [
      EXACT_BELIEF_MODEL_VERSION,
      LANGUAGE_WEIGHTED_BELIEF_VERSION,
    ].sort(),
  )
  assert.ok(traces.every((trace) =>
    trace.componentVersions?.belief === trace.beliefModelVersion
    && trace.componentVersions.mechanicalBelief
      === EXACT_BELIEF_MODEL_VERSION
    && trace.componentVersions.beliefPipeline
      === ACTIVE_LANGUAGE_EVALUATION_PIPELINE
    && trace.componentVersions.languageEvidence
      === LANGUAGE_FACTOR_BUNDLE_VERSION))
  assert.ok(traces.every((trace) =>
    parseExternalDecisionReply(
      trace.request,
      { decision: trace.action, trace },
    ).trace?.decisionId === trace.decisionId))

  const report = architectureReport([artifact])
  const summary = report.variants[0]
  assert.equal(summary.calls, 0)
  assert.equal(summary.cost, 0)
  assert.equal(summary.degraded, 0)
  assert.equal(summary.safety.hiddenInformationViolations, 0)
  assert.equal(summary.safety.traceAttributionViolations, 0)
  assert.equal(
    summary.components.mechanicalBelief,
    EXACT_BELIEF_MODEL_VERSION,
  )
  assert.equal(
    summary.components.beliefPipeline,
    ACTIVE_LANGUAGE_EVALUATION_PIPELINE,
  )
  assert.equal(summary.components.factors, LANGUAGE_FACTOR_BUNDLE_VERSION)
  assert.equal(
    summary.components.languageInterpreter,
    ACTIVE_LANGUAGE_EVALUATION_INTERPRETER_VERSION,
  )
  assert.equal(
    summary.components.languageFactor,
    LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
  )
  assertWallClockBelow(
    summary.latency.p95Ms ?? Infinity,
    1_000,
    `active-language p95 was ${summary.latency.p95Ms ?? 'missing'}ms`,
  )
  assert.equal(artifact.telemetry?.llm, undefined)
  assert.deepEqual(
    artifact.strategyVersions?.beliefs,
    [
      EXACT_BELIEF_MODEL_VERSION,
      LANGUAGE_WEIGHTED_BELIEF_VERSION,
    ].sort(),
  )
})

test('active public-dialogue evaluation replays deterministically', async () => {
  const firstStats = { calls: 0, emittedReads: 0 }
  const secondStats = { calls: 0, emittedReads: 0 }
  const [first] = await activeRun(firstStats)
  const [second] = await activeRun(secondStats)

  assert.deepEqual(firstStats, secondStats)
  assert.deepEqual(first.log, second.log)
  assert.deepEqual(first.decisionTraces, second.decisionTraces)
  assert.deepEqual(first.architecture, second.architecture)
  assert.deepEqual(first.strategyVersions, second.strategyVersions)
})

test('report binds configured identity by digest and actual belief separately', async () => {
  const [artifact] = await activeRun()
  const firstTrace = artifact.decisionTraces?.[0]
  assert.ok(firstTrace?.componentVersions)

  const forgedIdentity = structuredClone(artifact)
  forgedIdentity.decisionTraces![0].architectureIdentityDigest =
    '0'.repeat(64)
  assert.ok(attributedViolations(forgedIdentity) > 0)

  const forgedActual = structuredClone(artifact)
  forgedActual.decisionTraces![0].componentVersions!.belief =
    'forged-snapshot-v1'
  assert.ok(attributedViolations(forgedActual) > 0)

  const forgedDeclaration = structuredClone(artifact)
  forgedDeclaration.architecture!.components.beliefPipeline =
    'forged-declared-pipeline-v1'
  const canonical = architectureReport([forgedDeclaration]).variants[0]
  assert.equal(canonical.safety.traceAttributionViolations, 0)
  assert.equal(canonical.safety.promotionEvidenceEligible, true)
  assert.equal(
    canonical.components.beliefPipeline,
    ACTIVE_LANGUAGE_EVALUATION_PIPELINE,
  )
})

test('bench requires truthful stable declarations for active language', async () => {
  const valid = activeLanguageEvaluationVariant()
  const invalidActualDeclaration: ArchitectureVariant = {
    ...valid,
    components: {
      ...valid.components,
      belief: EXACT_BELIEF_MODEL_VERSION,
    },
  }
  await assert.rejects(
    runArchitectureBench({
      bankId: ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID,
      bankProfile: ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE,
      cases: [],
      variants: [invalidActualDeclaration],
    }),
    /actual belief versions in decision traces/,
  )

  const missingPipeline: ArchitectureVariant = {
    ...valid,
    components: {
      ...valid.components,
      beliefPipeline: '',
    },
  }
  await assert.rejects(
    runArchitectureBench({
      bankId: ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID,
      bankProfile: ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE,
      cases: [],
      variants: [missingPipeline],
    }),
    /requires component beliefPipeline/,
  )
})

test('active-language bank id cannot silently use the Phase 0 profile', async () => {
  await assert.rejects(
    runArchitectureBench({
      bankId: ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID,
      cases: [],
      variants: [activeLanguageEvaluationVariant()],
    }),
    /requires the matching .* bank profile/,
  )
})

test('non-bounded bench and report reject stable trace keys', async () => {
  const runStatic = (variant: ArchitectureVariant) =>
    runArchitectureBench({
      bankId: 'external-static-contract-v1',
      cases: [ARCHITECTURE_BANK[0]],
      variants: [variant],
    })

  const externalArtifacts = await runStatic(
    staticTraceVariant('external'),
  )
  const languageOffArtifacts = await runStatic(
    staticTraceVariant('language-off'),
  )
  assert.equal(externalArtifacts.length, 1)
  assert.equal(languageOffArtifacts.length, 1)
  assert.equal(
    externalArtifacts[0].architecture?.components.belief,
    'external',
  )
  assert.equal(
    externalArtifacts[0].architecture?.components.mechanicalBelief,
    undefined,
  )
  assert.equal(
    attributedViolations(externalArtifacts[0]),
    0,
  )
  assert.equal(
    attributedViolations(languageOffArtifacts[0]),
    0,
  )

  await assert.rejects(
    runStatic(staticTraceVariant('external', 'mechanicalBelief')),
    /trace components do not match declared components/,
  )
  await assert.rejects(
    runStatic(staticTraceVariant('language-off', 'beliefPipeline')),
    /trace components do not match declared components/,
  )

  const forgedExternal = structuredClone(externalArtifacts[0])
  forgedExternal.decisionTraces![0].componentVersions!.mechanicalBelief =
    'forged-mechanical-v1'
  assert.ok(attributedViolations(forgedExternal) > 0)

  const forgedLanguageOff = structuredClone(languageOffArtifacts[0])
  forgedLanguageOff.decisionTraces![0].componentVersions!.beliefPipeline =
    'forged-pipeline-v1'
  assert.ok(attributedViolations(forgedLanguageOff) > 0)
})

test('report flags a bounded-language artifact with no trace attribution', async () => {
  const [artifact] = await activeRun()
  const missing = structuredClone(artifact)
  delete missing.decisionTraces
  assert.equal(
    architectureReport([missing])
      .variants[0].safety.traceAttributionViolations,
    1,
  )
  assert.equal(
    architectureReport([missing])
      .variants[0].safety.traceAttributionChecks,
    1,
  )
})
