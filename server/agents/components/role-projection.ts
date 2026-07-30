/**
 * The shared lifecycle skeleton for native private role components.
 *
 * Every role projection, objective, and private observer repeats the same
 * five mechanical steps: narrow the private context, assemble the build
 * input, wrap the built payload in an envelope, decode a detached payload,
 * and re-derive the payload for host admission. Only the assembly and the
 * semantics differ per role, so those are the only things a caller supplies.
 *
 * Owning the skeleton here is what lets a new role be added by registering a
 * component rather than by copying a template (docs/probabilistic-agent-
 * architecture.md section 5.7). It deliberately imports no analysis module:
 * the helper stays generic over its payload and its build input.
 */

import { componentEnvelope } from './kernel.ts'
import type { CanonicalJsonValue } from './canonical-json.ts'
import type {
  ComponentAdmissionResult,
  ComponentHostInputRef,
  ComponentRef,
  ComponentToken,
  DecisionComponentDefinition,
  HostCapability,
  PrivateDecisionComponentApplicabilityContext,
} from './types.ts'

/**
 * The payload bound every private role component shares.
 *
 * Roles whose payload is bounded by its own much smaller structure state
 * their own cap at the definition instead of inheriting this one.
 */
export const DEFAULT_ROLE_PROJECTION_JSON_BYTES = 1_048_576

/**
 * A private component context: the applicability context plus the readers
 * the kernel grants once a component is eligible to run.
 */
export type PrivateComponentContext = Extract<
  Parameters<DecisionComponentDefinition['execute']>[0],
  { privacy: 'private' }
>

export interface RoleProjectionSpec<Payload, JoinInput> {
  readonly token: ComponentToken<Payload>
  readonly degradationCode: string
  readonly dependencies?: readonly ComponentRef[]
  readonly requiredHostInputs?: readonly ComponentHostInputRef[]
  readonly hostRequirements?: readonly HostCapability[]
  readonly brainContribution?:
    DecisionComponentDefinition<Payload>['brainContribution']
  /** Defaults to {@link DEFAULT_ROLE_PROJECTION_JSON_BYTES}. */
  readonly maxPayloadBytes?: number
  /**
   * Role applicability. The privacy check is already applied, so this only
   * states the role, phase, and decision-kind conditions.
   */
  applies(
    context: PrivateDecisionComponentApplicabilityContext,
  ): boolean
  /**
   * Assemble the build and host-join input from one private context.
   *
   * Execution and host admission must re-derive the payload from identical
   * inputs, so both paths call this rather than each assembling their own.
   */
  join(context: PrivateComponentContext): JoinInput
  build(input: JoinInput): Payload
  decode(value: CanonicalJsonValue): Payload | undefined
  hostJoin(payload: Payload, input: JoinInput): boolean
  /**
   * Whether a detached payload is an exact reconstruction rather than a
   * merely structurally valid one. Defaults to exact.
   */
  detachedExact?(payload: Payload): boolean
  /**
   * Whether a host-admitted payload is exact. Defaults to the detached rule.
   * Roles whose exactness depends on an upstream dependency read it from the
   * join input rather than from the payload.
   */
  hostExact?(payload: Payload, input: JoinInput): boolean
}

function privateContext(
  context: Parameters<DecisionComponentDefinition['execute']>[0],
): PrivateComponentContext {
  if (context.privacy !== 'private') {
    throw new Error('private native component received public context')
  }
  return context
}

/**
 * Build one native private component definition from its role semantics.
 */
export function roleProjection<Payload, JoinInput>(
  spec: RoleProjectionSpec<Payload, JoinInput>,
): DecisionComponentDefinition<Payload> {
  const detachedExact = spec.detachedExact ?? ((): boolean => true)
  const hostExact = spec.hostExact
    ?? ((payload: Payload): boolean => detachedExact(payload))

  const admit = (
    payload: Payload,
    exact: boolean,
  ): ComponentAdmissionResult<Payload> => ({
    admitted: true,
    payload,
    verification: exact ? 'exact' : 'structural',
    promotionEligible: exact,
  })
  const reject = (): ComponentAdmissionResult<Payload> => ({
    admitted: false,
    degradationCode: spec.degradationCode,
  })

  return {
    token: spec.token,
    source: 'native',
    ...(spec.brainContribution === undefined
      ? {}
      : { brainContribution: spec.brainContribution }),
    dependencies: spec.dependencies ?? [],
    requiredHostInputs: spec.requiredHostInputs ?? [],
    hostRequirements: spec.hostRequirements ?? [],
    maxPayloadBytes:
      spec.maxPayloadBytes ?? DEFAULT_ROLE_PROJECTION_JSON_BYTES,
    degradationCode: spec.degradationCode,
    applies(context) {
      return context.privacy === 'private' && spec.applies(context)
    },
    execute(context) {
      return {
        status: 'produced',
        envelope: componentEnvelope(
          spec.token,
          spec.build(spec.join(privateContext(context))),
        ),
      }
    },
    validateDetached(payload) {
      const decoded = spec.decode(payload)
      return decoded
        ? admit(decoded, detachedExact(decoded))
        : reject()
    },
    admitHost({ payload, host }) {
      const input = spec.join(privateContext(host))
      return spec.hostJoin(payload, input)
        ? admit(payload, hostExact(payload, input))
        : reject()
    },
  }
}
