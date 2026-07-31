import assert from 'node:assert/strict'
import {
  publicDecisionComponentRun,
  runDecisionComponents,
  validateDecisionComponentRunHostJoin,
} from '../../server/agents/components/kernel.ts'
import type {
  DecisionComponentRegistry,
} from '../../server/agents/components/registry.ts'
import type {
  ResolvedComposedBrain,
} from '../../server/agents/components/resolved-brain.ts'
import {
  canonicalizeJson,
  type CanonicalJsonValue,
} from '../../server/agents/canonical/canonical-json.ts'
import type {
  ComponentHostInputBinding,
  ComponentToken,
  ComponentVerification,
} from '../../server/agents/components/types.ts'
import type {
  DecisionRequest,
  PlayerView,
} from '../../server/engine/types.ts'
import { structurallyHostileRecords } from './hostile-data.ts'

interface NativeCodecFixture<Payload extends object> {
  readonly label: string
  readonly value: Payload
  readonly maxBytes: number
  readonly validate: (value: unknown) => boolean
  readonly decode: (value: CanonicalJsonValue) => Payload | undefined
  readonly invalidValue: unknown
}

/**
 * Prove one component-owned payload codec after the shared canonical JSON
 * boundary. Raw hostile-value construction stays in hostile-data.ts.
 */
export function assertNativeCodecContract<Payload extends object>(
  fixture: NativeCodecFixture<Payload>,
): void {
  const canonical = canonicalizeJson(fixture.value, fixture.maxBytes)
  assert.equal(canonical.ok, true, `${fixture.label}: canonical payload`)
  if (!canonical.ok) return
  assert.equal(fixture.validate(fixture.value), true, fixture.label)
  assert.ok(fixture.decode(canonical.payload), fixture.label)

  const invalidCanonical = canonicalizeJson(
    fixture.invalidValue,
    fixture.maxBytes,
  )
  assert.equal(invalidCanonical.ok, true, `${fixture.label}: semantic forgery`)
  if (invalidCanonical.ok) {
    assert.equal(fixture.validate(fixture.invalidValue), false, fixture.label)
    assert.equal(
      fixture.decode(invalidCanonical.payload),
      undefined,
      fixture.label,
    )
  }

  for (const hostile of structurallyHostileRecords(
    fixture.value,
  )) {
    assert.equal(fixture.validate(hostile), false, fixture.label)
    assert.equal(
      canonicalizeJson(hostile, fixture.maxBytes).ok,
      false,
      fixture.label,
    )
  }
}

interface NativeExecutionEntryFixture {
  readonly token: ComponentToken
  readonly verification: ComponentVerification
  readonly promotionEligible: boolean
  readonly missingRootFailure: string
}

interface NativeExecutionFixture {
  readonly label: string
  readonly registry: DecisionComponentRegistry
  readonly brain: ResolvedComposedBrain
  readonly request: DecisionRequest
  readonly view: PlayerView
  readonly hostInputs: readonly ComponentHostInputBinding[]
  readonly entries: readonly NativeExecutionEntryFixture[]
}

/**
 * Prove the native seam, not the kernel implementation. Generic hostile
 * envelopes, result wrappers, dependency ordering, and attribution rules
 * remain covered once in component-kernel.test.ts.
 */
export async function assertNativeExecutionContract(
  fixture: NativeExecutionFixture,
): Promise<void> {
  const invocation = { hostInputs: fixture.hostInputs }
  const execute = () => runDecisionComponents(
    fixture.brain,
    structuredClone(fixture.request),
    structuredClone(fixture.view),
    structuredClone(invocation),
  )
  const first = await execute()
  assert.deepEqual(
    await execute(),
    first,
    `${fixture.label}: deterministic replay`,
  )
  assert.deepEqual(
    first.entries.map((entry) => ({
      id: entry.component.id,
      kind: entry.kind,
      privacy: entry.privacy,
      status: entry.status,
      ...(entry.status === 'admitted'
        ? {
            verification: entry.verification,
            promotionEligible: entry.promotionEligible,
          }
        : {}),
    })),
    fixture.entries.map((entry) => ({
      id: entry.token.id,
      kind: entry.token.kind,
      privacy: entry.token.privacy,
      status: 'admitted',
      verification: entry.verification,
      promotionEligible: entry.promotionEligible,
    })),
    `${fixture.label}: admitted graph`,
  )
  for (const entry of first.entries) {
    assert.equal(entry.status, 'admitted', fixture.label)
    if (entry.status !== 'admitted') continue
    const definition = fixture.registry.definition(entry.component)
    assert.ok(definition, `${fixture.label}: registered definition`)
    assert.ok(
      entry.payloadBytes <= definition.maxPayloadBytes,
      `${fixture.label}: bounded ${entry.component.id}`,
    )
    assert.ok(
      Object.isFrozen(entry.envelope.payload),
      `${fixture.label}: detached ${entry.component.id}`,
    )
  }
  assert.equal(validateDecisionComponentRunHostJoin({
    registry: fixture.registry,
    run: first,
    request: fixture.request,
    view: fixture.view,
    hostInputs: fixture.hostInputs,
  }), true, `${fixture.label}: host join`)
  for (let omitted = 0; omitted < fixture.hostInputs.length; omitted++) {
    assert.equal(validateDecisionComponentRunHostJoin({
      registry: fixture.registry,
      run: first,
      request: fixture.request,
      view: fixture.view,
      hostInputs: fixture.hostInputs.filter((_, index) => index !== omitted),
    }), false, `${fixture.label}: partial host join ${omitted}`)
  }

  const privateIds = new Set(fixture.entries
    .filter((entry) => entry.token.privacy === 'private')
    .map((entry) => entry.token.id))
  const projected = publicDecisionComponentRun(first)
  assert.ok(
    projected.entries.every((entry) => !privateIds.has(entry.component.id)),
    `${fixture.label}: private entries projected`,
  )
  assert.ok(
    projected.configured.every((entry) => !privateIds.has(entry.id)),
    `${fixture.label}: private graph projected`,
  )
  const publicCount = fixture.entries.filter(
    (entry) => entry.token.privacy === 'public',
  ).length
  assert.equal(projected.entries.length, publicCount, fixture.label)
  assert.equal(projected.configured.length, publicCount, fixture.label)

  const missingRoots = await runDecisionComponents(
    fixture.brain,
    fixture.request,
    fixture.view,
  )
  assert.deepEqual(
    missingRoots.entries.map((entry) =>
      entry.status === 'degraded'
        ? [entry.component.id, entry.failureCode]
        : [entry.component.id, entry.status]),
    fixture.entries.map((entry) => [
      entry.token.id,
      entry.missingRootFailure,
    ]),
    `${fixture.label}: root degradation`,
  )
}
