import { test } from 'node:test'
import { mutable } from './support/mutable.ts'
import assert from 'node:assert/strict'
import {
  admitDecisionTrace,
  type DecisionTraceAdmissionResult,
} from '../server/agents/admission/composed-trace.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'
import { composedBrainOptions } from '../server/agents/registry.ts'
import {
  inspectAdmittedPolicyRun,
  inspectSeatDecision,
  SEAT_DECISION_INSPECTION_SCHEMA,
} from '../server/eval/seat-decision-inspector.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

type Trusted = Extract<
  DecisionTraceAdmissionResult,
  { kind: 'trusted-exact' }
>

async function exactFixture() {
  const fixture = readDecisionFixtures().find(
    ({ id }) => id === 'merlin-opening-proposal',
  )!
  const seed = 'seat-decision-inspector-contract'
  const agent = createComposedAgent({
    seed,
    ...composedBrainOptions('full-role'),
  })
  const output = await agent.decide(fixture.req, fixture.view)
  assert.ok(output.trace)
  const identity = projectResolvedArchitectureIdentity(
    agent.resolvedBrain().description,
  )
  const admit = (trace: unknown) => admitDecisionTrace({
    kind: 'finalized-artifact',
    trace,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: seed,
    expectedArchitectureIdentity: identity,
  })
  return { fixture, output, admit }
}

test('v2 projects one exact admitted native run without reconstructing causal stages', async () => {
  const { fixture, output, admit } = await exactFixture()
  const admission = admit(output.trace)
  assert.equal(admission.kind, 'trusted-exact')
  const inspection = inspectSeatDecision(
    fixture.req,
    fixture.view,
    admission as Trusted,
  )

  assert.equal(inspection.schema, SEAT_DECISION_INSPECTION_SCHEMA)
  assert.equal(inspection.policyRun.status, 'present')
  const run = inspection.policyRun.value
  assert.equal(run.source.admission, 'trusted-exact')
  assert.ok(!Object.hasOwn(run.source, 'architectureIdentityDigest'))
  assert.equal(run.scoreLayers.status, 'present')
  assert.deepEqual(
    run.scoreLayers.journal.map(({ layer, status }) => ({ layer, status })),
    output.trace!.scoreLayerRun!.journal.map(({ layer, status }) => ({
      layer,
      status,
    })),
  )
  assert.deepEqual(
    run.commitment.committedMechanicalAction,
    output.trace!.decisionFrame!.committedMechanicalAction,
  )
  assert.deepEqual(run.commitment.voice, output.trace!.decisionFrame!.voice)
  assert.equal(run.components.status, 'present')
  assert.ok(run.components.entries.some(({ causalUse }) => causalUse.used))
  assert.ok(inspection.omissions.some(
    (omission) => omission.includes('exact-admitted private run'),
  ))
  assert.ok(inspection.omissions.some(
    (omission) => omission.includes('architecture identity witness'),
  ))
  assert.ok(!inspection.omissions.some(
    (omission) => omission.includes('No raw Game, posterior'),
  ))
})

test('exact admission rejects erased or relabeled native run and commitment facts', async () => {
  const { output, admit } = await exactFixture()
  type MutableRecord = Record<string, unknown>
  const record = (value: unknown): MutableRecord => {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value))
    return value as MutableRecord
  }
  const mutations: [string, (trace: MutableRecord) => void][] = [
    ['score-layer deletion', (trace) => { delete trace.scoreLayerRun }],
    ['score journal relabel', (trace) => {
      const journal = record(trace.scoreLayerRun).journal
      assert.ok(Array.isArray(journal))
      record(journal[0]).status = 'inapplicable'
    }],
    ['score operation rewrite', (trace) => {
      const operations = record(record(trace.scoreLayerRun).operations)
      const executed = operations.layersExecuted
      assert.equal(typeof executed, 'number')
      operations.layersExecuted = (executed as number) + 1
    }],
    ['decision-frame deletion', (trace) => { delete trace.decisionFrame }],
    ['commitment rewrite', (trace) => {
      const action = record(
        record(trace.decisionFrame).committedMechanicalAction,
      )
      action.team = [1, 2]
    }],
    ['voice relabel', (trace) => {
      const voice = record(record(trace.decisionFrame).voice)
      assert.equal(typeof voice.applied, 'boolean')
      voice.applied = !voice.applied
    }],
  ]
  for (const [label, mutate] of mutations) {
    const trace = structuredClone(output.trace) as unknown as MutableRecord
    mutate(trace)
    const admission = admit(trace)
    assert.equal(admission.kind, 'rejected', label)
    assert.equal(
      admission.kind === 'rejected' ? admission.reason : '',
      'trusted-identity-host-join-failed',
      label,
    )
  }
})

test('v2 allow-list drops unrelated trace properties and refuses a cross-view join', async () => {
  const { fixture, output, admit } = await exactFixture()
  const marker = 'hidden-marker-must-not-cross'
  const trace = structuredClone(output.trace) as typeof output.trace & {
    trueDeal?: string
  }
  trace.trueDeal = marker
  const admission = admit(trace)
  assert.equal(admission.kind, 'trusted-exact')
  const inspection = inspectSeatDecision(
    fixture.req,
    fixture.view,
    admission as Trusted,
  )
  assert.ok(!JSON.stringify(inspection).includes(marker))
  assert.ok(!JSON.stringify(inspection).includes('trueDeal'))

  const otherView = structuredClone(fixture.view)
  mutable(otherView).events.pop()
  assert.throws(
    () => inspectSeatDecision(
      fixture.req,
      otherView,
      admission as Trusted,
    ),
    /admitted trace does not match the seat view/,
  )
})

test('diagnostic admission cannot populate causal Inspector panels', async () => {
  const { fixture, output } = await exactFixture()
  const diagnostic = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: 'seat-decision-inspector-contract',
  })
  assert.equal(diagnostic.kind, 'artifact-diagnostic')
  const inspection = inspectSeatDecision(
    fixture.req,
    fixture.view,
    diagnostic,
  )
  assert.equal(inspection.policyRun.status, 'absent')
  assert.match(inspection.policyRun.reason, /cannot populate causal policy panels/)
  assert.throws(
    () => inspectAdmittedPolicyRun(diagnostic),
    /requires trusted-exact/,
  )
})
