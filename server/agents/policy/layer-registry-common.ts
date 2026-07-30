import type { ComponentToken } from '../components/types.ts'
import { DECISION_COMPONENT_KINDS } from '../components/types.ts'

// Canonical id/version grammar shared by every layer and component registry.
export const LAYER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
export const LAYER_VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,99}$/
// `raiseInvalid` throws each registry's own error class, keeping this neutral.
export function assertLayerRef(
  ref: unknown,
  label: string,
  raiseInvalid: (message: string) => never,
): void {
  const candidate = ref as { id?: unknown; version?: unknown } | null
  if (
    !candidate
    || typeof candidate !== 'object'
    || typeof candidate.id !== 'string'
    || typeof candidate.version !== 'string'
    || !LAYER_ID_PATTERN.test(candidate.id)
    || !LAYER_VERSION_PATTERN.test(candidate.version)
  ) {
    raiseInvalid(`${label} must use canonical non-empty id and version strings`)
  }
}

// Both layer trees pin the identical component contract (kinds, privacies, no
// repeated read); only the raised error class differs. Validate, freeze, and
// dedup one layer's declared component reads.
export function freezeRequiredComponents(
  token: { readonly id: string; readonly version: string },
  requiredComponents: readonly ComponentToken[],
  raiseInvalid: (message: string) => never,
): readonly ComponentToken[] {
  const identity = `${token.id}@${token.version}`
  const frozen = requiredComponents.map((component, index) => {
    if (
      !component
      || typeof component !== 'object'
      || typeof component.id !== 'string'
      || typeof component.version !== 'string'
      || !LAYER_ID_PATTERN.test(component.id)
      || !LAYER_VERSION_PATTERN.test(component.version)
      || !DECISION_COMPONENT_KINDS.includes(component.kind)
      || !['public', 'private'].includes(component.privacy)
    ) {
      raiseInvalid(`${identity} component ${index} is invalid`)
    }
    return Object.freeze({
      id: component.id,
      version: component.version,
      kind: component.kind,
      privacy: component.privacy,
    })
  })
  const keys = frozen.map((entry) => `${entry.id}@${entry.version}`)
  if (new Set(keys).size !== keys.length) {
    raiseInvalid(`${identity} repeats a component read`)
  }
  return frozen
}

// Detach a resolved layer run into its observability trace: drop the live
// component run and deep-clone the rest, keeping component payload state
// single-owned by the trace's component field.
export function projectLayerRun<
  Run extends {
    readonly version: string
    readonly configured: unknown
    readonly journal: unknown
    readonly surface: unknown
    readonly componentRun: unknown
    readonly operations: unknown
  },
>(run: Run): Omit<Run, 'componentRun'> {
  return structuredClone({
    version: run.version,
    configured: run.configured,
    journal: run.journal,
    surface: run.surface,
    operations: run.operations,
  }) as Omit<Run, 'componentRun'>
}
