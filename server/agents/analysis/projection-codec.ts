/**
 * The codec tail every role projection and objective module repeats.
 *
 * Each module exposes the same two entry points over one semantic schema:
 * a hostile-boundary validator that must canonicalize and byte-bound an
 * untrusted value first, and a decoder for a value the component kernel has
 * already canonicalized, which must not re-canonicalize its own input. The
 * only thing that differs per role is the schema check between them.
 *
 * Writing that pair by hand once per role is how the two drifted apart in
 * the first place, so the pair is built here from the schema alone.
 */

import { isDeepStrictEqual } from 'node:util'
import {
  canonicalizeJson,
  DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
  type CanonicalJsonValue,
} from '../canonical/canonical-json.ts'

export interface ProjectionCodec<Payload> {
  /**
   * Validate an untrusted value: canonicalize and byte-bound it, then check
   * the role schema. Never throws.
   */
  validate(value: unknown): value is Payload
  /**
   * Check the role schema of a value the kernel already canonicalized.
   * Deliberately does not re-canonicalize. Never throws.
   */
  decode(value: CanonicalJsonValue): Payload | undefined
}

/**
 * Build a role's validator and decoder from its schema check.
 *
 * `schema` receives a value that is already canonical, so it only states
 * role semantics. It may throw; both entry points fail closed.
 */
export function projectionCodec<Payload>(
  schema: (detached: unknown) => boolean,
  maxPayloadBytes: number = DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
): ProjectionCodec<Payload> {
  const check = (value: unknown, hostileBoundary: boolean): boolean => {
    try {
      const canonical = hostileBoundary
        ? canonicalizeJson(value, maxPayloadBytes)
        : { ok: true as const, payload: value }
      return canonical.ok && schema(canonical.payload)
    } catch {
      return false
    }
  }
  return {
    validate: (value): value is Payload => check(value, true),
    decode: (value) => (check(value, false)
      ? value as unknown as Payload
      : undefined),
  }
}

/**
 * The host-join rule shared by every exactly reconstructable component: a
 * payload is admitted only if the host rebuilds it byte for byte.
 *
 * Building can legitimately throw when the host state does not support the
 * component, which is a rejection rather than an error.
 */
export function exactHostJoin<Payload, Input>(
  build: (input: Input) => Payload,
): (value: Payload, input: Input) => boolean {
  return (value, input) => {
    try {
      return isDeepStrictEqual(value, build(input))
    } catch {
      return false
    }
  }
}
