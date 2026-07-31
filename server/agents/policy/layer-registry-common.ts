import type { ComponentToken } from '../components/types.ts'
import { DECISION_COMPONENT_KINDS } from '../components/types.ts'

// Canonical id/version grammar shared by every layer and component registry.
export const LAYER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
export const LAYER_VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,99}$/

// The canonical-code grammar for a layer's reason and degradation codes: a
// non-empty uppercase-alnum token (the leading class forbids the empty string).
// A layer produces these write-side and re-admits them read-side, so both sides
// route here rather than each restating the regex. The byte ceiling is a caller
// argument because it is a per-site bound, not part of the grammar; changing
// either the grammar or a site's bound is a real behavior change.
const CANONICAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/

export function isCanonicalCode(
  value: unknown,
  maxBytes: number,
): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= maxBytes
    && CANONICAL_CODE_PATTERN.test(value)
}

/**
 * One branded identity for the layer families.
 *
 * The brand is what makes a token unforgeable: LAYER_TOKEN_BRAND is never
 * exported, so no caller can write the property and only the minting function
 * below can produce a value satisfying the type.
 *
 * The Family parameter preserves the other half of the guarantee. The families
 * used to hold separate brand symbols, which is what kept one family's token
 * from standing in for another's; minting from one implementation would lose
 * that unless the family is part of the branded type.
 */
declare const LAYER_TOKEN_BRAND: unique symbol

/** Unbranded layer coordinates. Journals and resolved orders carry these. */
export interface LayerRef {
  readonly id: string
  readonly version: string
}

export interface LayerToken<Family extends string> extends LayerRef {
  readonly [LAYER_TOKEN_BRAND]: Family
}

/** Mint the only branded token for a family; the brand is erased at runtime. */
export function layerToken<Family extends string>(
  id: string,
  version: string,
): LayerToken<Family> {
  return Object.freeze({ id, version }) as LayerToken<Family>
}
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

export interface IndexedLayerDefinitions<Definition> {
  /** Every definition by `id@version`. */
  readonly byKey: ReadonlyMap<string, Definition>
  /** The same definitions in a stable key order, for public exposure. */
  readonly exposed: readonly Definition[]
}

/**
 * Index definitions by identity, refusing a repeated identity and refusing one
 * id that carries two versions. The second refusal is what keeps a resolved
 * order unambiguous: an id names one layer, not whichever version registered
 * first.
 *
 * `raiseDuplicate` and `raiseConflict` throw each registry's own error class,
 * which carries a distinct code per family, so the codes stay with the family
 * rather than being flattened into a shared vocabulary here.
 */
export function indexLayerDefinitions<
  Definition extends { readonly token: LayerRef },
>(
  definitions: readonly Definition[],
  label: string,
  raiseDuplicate: (message: string) => never,
  raiseConflict: (message: string) => never,
): IndexedLayerDefinitions<Definition> {
  const byKey = new Map<string, Definition>()
  const versionById = new Map<string, string>()
  for (const definition of definitions) {
    const key = `${definition.token.id}@${definition.token.version}`
    if (byKey.has(key)) {
      raiseDuplicate(`duplicate ${label} identity ${key}`)
    }
    const prior = versionById.get(definition.token.id)
    if (prior !== undefined && prior !== definition.token.version) {
      raiseConflict(`${label} ${definition.token.id} has conflicting versions`)
    }
    byKey.set(key, definition)
    versionById.set(definition.token.id, definition.token.version)
  }
  const exposed = Object.freeze([...definitions].sort((left, right) =>
    `${left.token.id}@${left.token.version}`.localeCompare(
      `${right.token.id}@${right.token.version}`,
      'en',
    )))
  return Object.freeze({ byKey, exposed })
}

/**
 * What a resolved layer run has to look like to be projectable.
 *
 * The input keeps naming every field even though the projection derives its
 * output by omission. The two are separate jobs: omission is what keeps the
 * result's type and value in agreement, while this constraint is what stops a
 * non-run from being projected at all. Requiring only componentRun would admit
 * any object carrying that one field, which matters because the argument at
 * decision-frame's score-layer call site is typed by a cast alone.
 */
export interface LayerRunShape {
  readonly version: string
  readonly configured: unknown
  readonly journal: unknown
  readonly surface: unknown
  readonly componentRun: unknown
  readonly operations: unknown
}

/** The detached trace of a layer run: everything about it except componentRun. */
export type LayerRunTrace<Run extends LayerRunShape> =
  Readonly<Omit<Run, 'componentRun'>>

/**
 * Detach a resolved layer run into its observability trace: drop the live
 * component run and deep-clone the rest, keeping component payload state
 * single-owned by the trace's component field.
 *
 * componentRun is dropped by omission rather than by listing the fields kept.
 * Listing them let the type and the value disagree: the result is typed as the
 * run minus componentRun, so a run type that gained a sixth field would have a
 * trace whose type promised it and whose value silently lacked it. The
 * asymmetry matters, because a stale allow-list loses observability quietly in
 * a trace nothing compares field by field, whereas a stale omission would leak
 * componentRun, which admission and the tests notice loudly.
 */
export function projectLayerRun<Run extends LayerRunShape>(
  run: Run,
): LayerRunTrace<Run> {
  const { componentRun: _componentRun, ...carried } = run
  return structuredClone(carried) as LayerRunTrace<Run>
}
