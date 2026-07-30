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
