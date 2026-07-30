/**
 * The shared lifecycle skeleton for native role components.
 *
 * Every role projection, objective, and observer repeats the same five
 * mechanical steps: narrow the context to its declared privacy, assemble the
 * build input, wrap the built payload in an envelope, decode a detached
 * payload, and re-derive the payload for host admission. Only the input
 * assembly and the role semantics ever differ, so those are the only things a
 * caller supplies.
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
  DecisionComponentPrivacy,
  HostCapability,
  PrivateDecisionComponentApplicabilityContext,
  PublicDecisionComponentApplicabilityContext,
} from './types.ts'

/**
 * The payload bound every role component shares.
 *
 * Roles whose payload is bounded by its own much smaller structure state
 * their own cap at the definition instead of inheriting this one.
 */
export const DEFAULT_ROLE_PROJECTION_JSON_BYTES = 1_048_576

type ExecutionContext = Parameters<DecisionComponentDefinition['execute']>[0]

/** An execution context already narrowed to a private component. */
export type PrivateComponentContext =
  Extract<ExecutionContext, { privacy: 'private' }>

/** An execution context already narrowed to a public component. */
export type PublicComponentContext =
  Extract<ExecutionContext, { privacy: 'public' }>

interface ProjectionSpec<
  Payload,
  JoinInput,
  Applicability,
  Context,
> {
  readonly token: ComponentToken<Payload>
  readonly degradationCode: string
  readonly dependencies?: readonly ComponentRef[]
  readonly requiredHostInputs?: readonly ComponentHostInputRef[]
  readonly hostRequirements?: readonly HostCapability[]
  readonly brainContribution?:
    DecisionComponentDefinition<Payload>['brainContribution']
  readonly deterministicSeedDomain?: string
  /** Defaults to {@link DEFAULT_ROLE_PROJECTION_JSON_BYTES}. */
  readonly maxPayloadBytes?: number
  /**
   * Role applicability. The privacy check is already applied, so this states
   * only the role, phase, and decision-kind conditions.
   */
  applies(context: Applicability): boolean
  /**
   * Assemble the build and host-join input from one context.
   *
   * Execution and host admission must re-derive the payload from identical
   * inputs, so both paths call this rather than each assembling their own.
   */
  join(context: Context): JoinInput
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
   * Roles whose exactness depends on an upstream dependency or host input
   * read it from the join input rather than from the payload.
   */
  hostExact?(payload: Payload, input: JoinInput): boolean
}

export type RoleProjectionSpec<Payload, JoinInput> = ProjectionSpec<
  Payload,
  JoinInput,
  PrivateDecisionComponentApplicabilityContext,
  PrivateComponentContext
>

export type PublicRoleProjectionSpec<Payload, JoinInput> = ProjectionSpec<
  Payload,
  JoinInput,
  PublicDecisionComponentApplicabilityContext,
  PublicComponentContext
>

function define<Payload, JoinInput>(
  privacy: DecisionComponentPrivacy,
  spec: ProjectionSpec<Payload, JoinInput, never, never>,
): DecisionComponentDefinition<Payload> {
  const applies = spec.applies as (context: unknown) => boolean
  const join = spec.join as (context: ExecutionContext) => JoinInput
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

  // Execution asserts the declared privacy because a mismatch there is a
  // composition bug the kernel should surface. Host admission instead fails
  // closed, so a mismatched context can never admit a payload.
  const executionInput = (context: ExecutionContext): JoinInput => {
    if (context.privacy !== privacy) {
      throw new Error(
        `${privacy} native component received ${context.privacy} context`,
      )
    }
    return join(context)
  }

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
    ...(spec.deterministicSeedDomain === undefined
      ? {}
      : { deterministicSeedDomain: spec.deterministicSeedDomain }),
    applies(context) {
      return context.privacy === privacy && applies(context)
    },
    execute(context) {
      return {
        status: 'produced',
        envelope: componentEnvelope(
          spec.token,
          spec.build(executionInput(context)),
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
      if (host.privacy !== privacy) return reject()
      const input = join(host)
      return spec.hostJoin(payload, input)
        ? admit(payload, hostExact(payload, input))
        : reject()
    },
  }
}

/** Build one native private component definition from its role semantics. */
export function roleProjection<Payload, JoinInput>(
  spec: RoleProjectionSpec<Payload, JoinInput>,
): DecisionComponentDefinition<Payload> {
  return define('private', spec as ProjectionSpec<
    Payload,
    JoinInput,
    never,
    never
  >)
}

/** Build one native public component definition from its role semantics. */
export function publicRoleProjection<Payload, JoinInput>(
  spec: PublicRoleProjectionSpec<Payload, JoinInput>,
): DecisionComponentDefinition<Payload> {
  return define('public', spec as ProjectionSpec<
    Payload,
    JoinInput,
    never,
    never
  >)
}
