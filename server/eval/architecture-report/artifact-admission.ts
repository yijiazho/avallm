// Deciding what an archived artifact is allowed to claim about its own
// architecture, before any of it is believed.
//
// An artifact is a file on disk. Its strategyVersions block is attacker-shaped
// input as far as this report is concerned: it can carry getters, proxies,
// sparse arrays, inherited keys, or a manifest large enough to be a denial of
// service, and test/eval/hostile-artifact.ts exists because every one of those
// has to be answered with a provenance verdict rather than a thrown report.
// The own-data readers below are the shape of that answer: a value is admitted
// only if it is a plain, dense, enumerable data record with exactly the keys
// expected.
//
// It is separate from the safety readers because provenance is decided ONCE per
// artifact and then consumed by whichever reader that provenance selects. Fold
// it into either reader and the current path could fall back into the legacy
// one on failure, which is precisely the confusion the provenance labels exist
// to prevent.

import {
  isDeepStrictEqual,
} from 'node:util'
import {
  isProxy,
} from 'node:util/types'
import {
  MAX_ARTIFACT_DECISION_COMPONENT_MANIFEST_JSON_BYTES,
} from '../core/artifact.ts'
import type {
  GameArtifact,
} from '../core/artifact.ts'
import type {
  DecisionTrace,
} from '../../agents/trace.ts'
import {
  isNonComposedPolicy,
} from '../../agents/brain.ts'
import {
  exactOwnDataRecord as exactCurrentArchitectureRecord,
} from '../../agents/canonical/canonical-json.ts'
import {
  admitResolvedArchitectureIdentity,
  resolvedArchitectureIdentityDigest,
} from '../../agents/components/resolved-brain.ts'
import {
  architectureIdentityDecisionPlan,
} from '../../agents/components/architecture-metadata.ts'
import {
  validateDecisionComponentPlan,
  type DecisionComponentPlan,
} from '../../agents/components/kernel.ts'
import type {
  ArtifactArchitectureAdmission,
} from './types.ts'

export function artifactWithCanonicalDecisionTraces(
  artifact: GameArtifact,
  traces: readonly Readonly<DecisionTrace>[],
): GameArtifact {
  return {
    ...artifact,
    decisionTraces: Object.freeze([...traces]) as DecisionTrace[],
  }
}

function legacyExactOwnDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (!isDeepStrictEqual(Object.keys(descriptors).sort(), [...expectedKeys].sort())) {
    return undefined
  }
  const record: Record<string, unknown> = {}
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined
    ) {
      return undefined
    }
    record[key] = descriptor.value
  }
  return record
}

function denseOwnDataArray(value: unknown): readonly unknown[] | undefined {
  if (
    !Array.isArray(value)
    || isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return undefined
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const expected = Array.from(
    { length: value.length },
    (_, index) => `${index}`,
  )
  if (
    !isDeepStrictEqual(
      Object.keys(descriptors).filter((key) => key !== 'length').sort(),
      expected,
    )
    || expected.some((key) => {
      const descriptor = descriptors[key]
      return (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      )
    })
  ) {
    return undefined
  }
  return expected.map((key) => descriptors[key]!.value)
}

export function artifactArchitectureAdmission(
  artifact: GameArtifact,
): ArtifactArchitectureAdmission {
  try {
    const strategy = artifact.strategyVersions
    const currentDescriptor = strategy
      ? Object.getOwnPropertyDescriptor(strategy, 'resolvedArchitecture')
      : undefined
    if (currentDescriptor) {
      if (
        !Object.hasOwn(currentDescriptor, 'value')
        || currentDescriptor.get !== undefined
        || currentDescriptor.set !== undefined
      ) {
        throw new Error('current architecture manifest must be own data')
      }
      const current = exactCurrentArchitectureRecord(
        currentDescriptor.value,
        [
        'identity',
        'identityDigest',
        'schema',
        'targetSeat',
        ],
      )
      const identity = admitResolvedArchitectureIdentity(current?.identity)
      if (
        !current
        || current.schema !== 1
        || current.targetSeat !== artifact.architecture?.targetSeat
        || !identity
        || current.identityDigest
          !== resolvedArchitectureIdentityDigest(identity)
      ) {
        throw new Error('current architecture manifest is invalid')
      }
      return {
        provenance: 'descriptor-host-manifest-admitted',
        plan: architectureIdentityDecisionPlan(identity),
        identity,
      }
    }
    const legacy = admitLegacyHostComponentManifest(artifact)
    if (
      legacy.provenance === 'historical-absent'
      && isNonComposedPolicy(artifact.architecture?.components.policy)
    ) {
      return { provenance: 'non-composed-host-metadata-admitted' }
    }
    return legacy
  } catch (error) {
    if (
      error instanceof Error
      && error.message.startsWith('current architecture manifest')
    ) {
      throw error
    }
    return { provenance: 'legacy-host-manifest-invalid' }
  }
}

/**
 * Historical schema-1 adapter. Current descriptors never enter this reader
 * and a current-manifest failure cannot fall back to it.
 */
function admitLegacyHostComponentManifest(
  artifact: GameArtifact,
): ArtifactArchitectureAdmission {
  try {
    const strategy = artifact.strategyVersions
    const descriptor = strategy
      ? Object.getOwnPropertyDescriptor(strategy, 'decisionComponents')
      : undefined
    if (!descriptor) return { provenance: 'historical-absent' }
    const manifest = Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined
    const record = legacyExactOwnDataRecord(manifest, ['schema', 'seats'])
    const seats = denseOwnDataArray(record?.seats)
    if (
      !record
      || record.schema !== 1
      || !seats
      || !seats.length
      || seats.length > artifact.playerCount
    ) {
      return { provenance: 'legacy-host-manifest-invalid' }
    }
    const plans = new Map<number, DecisionComponentPlan>()
    const normalizedSeats: Array<{
      seat: number
      plan: DecisionComponentPlan
    }> = []
    let previousSeat = -1
    for (const candidate of seats) {
      const entry = legacyExactOwnDataRecord(candidate, ['plan', 'seat'])
      if (
        !entry
        || !Number.isInteger(entry.seat)
        || (entry.seat as number) < 0
        || (entry.seat as number) >= artifact.playerCount
        || (entry.seat as number) <= previousSeat
        || !validateDecisionComponentPlan(entry.plan)
      ) {
        return { provenance: 'legacy-host-manifest-invalid' }
      }
      previousSeat = entry.seat as number
      plans.set(
        entry.seat as number,
        entry.plan as DecisionComponentPlan,
      )
      normalizedSeats.push({
        seat: entry.seat as number,
        plan: entry.plan as DecisionComponentPlan,
      })
    }
    if (
      Buffer.byteLength(
        JSON.stringify({ schema: 1, seats: normalizedSeats }),
        'utf8',
      ) > MAX_ARTIFACT_DECISION_COMPONENT_MANIFEST_JSON_BYTES
    ) {
      return { provenance: 'legacy-host-manifest-invalid' }
    }
    const target = artifact.architecture?.targetSeat
    const plan = target === undefined ? undefined : plans.get(target)
    return plan
      ? { provenance: 'legacy-host-manifest-admitted', plan }
      : { provenance: 'legacy-host-manifest-invalid' }
  } catch {
    return { provenance: 'legacy-host-manifest-invalid' }
  }
}

export function hasComponentManifestClaim(
  admission: ArtifactArchitectureAdmission,
): boolean {
  return admission.provenance !== 'historical-absent'
    && admission.provenance !== 'non-composed-host-metadata-admitted'
}
