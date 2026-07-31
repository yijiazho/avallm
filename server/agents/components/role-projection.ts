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
import {
  DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
  type CanonicalJsonValue,
} from '../canonical/canonical-json.ts'
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
  /** Defaults to {@link DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES}. */
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
  /**
   * Optional execution-time suppression. When it returns a reason code the
   * component emits a suppressed entry instead of a payload; host admission of
   * a payload then fails closed while that reason holds. Returning undefined
   * produces the payload as usual. A suppressible component additionally gains
   * an admitSuppressed proof that re-derives the same reason from host state, so
   * a suppressed entry can only be re-admitted when the reason still holds.
   */
  suppress?(input: JoinInput): string | undefined
  /**
   * Whether a detached payload is promotion-eligible, for roles where that is
   * not simply its exactness. Defaults to {@link detachedExact}.
   */
  detachedPromotion?(payload: Payload): boolean
  /**
   * Host-side promotion eligibility. Defaults to {@link hostExact}. Roles whose
   * eligibility is carried in the payload read it from the payload here.
   */
  hostPromotion?(payload: Payload, input: JoinInput): boolean
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
  const detachedPromotion = spec.detachedPromotion ?? detachedExact
  const hostPromotion = spec.hostPromotion
    ?? ((payload: Payload, input: JoinInput): boolean =>
        hostExact(payload, input))
  const suppress = spec.suppress

  const admit = (
    payload: Payload,
    exact: boolean,
    promotionEligible: boolean,
  ): ComponentAdmissionResult<Payload> => ({
    admitted: true,
    payload,
    verification: exact ? 'exact' : 'structural',
    promotionEligible,
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

  const definition: DecisionComponentDefinition<Payload> = {
    token: spec.token,
    source: 'native',
    ...(spec.brainContribution === undefined
      ? {}
      : { brainContribution: spec.brainContribution }),
    dependencies: spec.dependencies ?? [],
    requiredHostInputs: spec.requiredHostInputs ?? [],
    hostRequirements: spec.hostRequirements ?? [],
    maxPayloadBytes:
      spec.maxPayloadBytes ?? DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    degradationCode: spec.degradationCode,
    ...(spec.deterministicSeedDomain === undefined
      ? {}
      : { deterministicSeedDomain: spec.deterministicSeedDomain }),
    applies(context) {
      return context.privacy === privacy && applies(context)
    },
    execute(context) {
      const input = executionInput(context)
      const reason = suppress?.(input)
      if (reason !== undefined) {
        return { status: 'suppressed', reasonCode: reason }
      }
      return {
        status: 'produced',
        envelope: componentEnvelope(spec.token, spec.build(input)),
      }
    },
    validateDetached(payload) {
      const decoded = spec.decode(payload)
      return decoded
        ? admit(decoded, detachedExact(decoded), detachedPromotion(decoded))
        : reject()
    },
    admitHost({ payload, host }) {
      if (host.privacy !== privacy) return reject()
      const input = join(host)
      // A payload cannot be host-admitted while suppression holds; the entry
      // must be the suppressed one, admitted through admitSuppressed instead.
      if (suppress?.(input) !== undefined) return reject()
      return spec.hostJoin(payload, input)
        ? admit(payload, hostExact(payload, input), hostPromotion(payload, input))
        : reject()
    },
  }
  // Only a suppressible component carries the suppressed-entry proof, so a
  // non-suppressing component's definition shape is unchanged.
  if (suppress) {
    definition.admitSuppressed = ({ reasonCode, host }) => {
      if (host.privacy !== privacy) return false
      return suppress(join(host)) === reasonCode
    }
  }
  return definition
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

/**
 * A private decision-rule spec: a role projection that additionally uses host
 * inputs, execution-time suppression, and payload-carried promotion. The extra
 * capabilities are the optional suppress / detachedPromotion / hostPromotion
 * fields on the shared spec; this alias names the intended combination.
 */
export type RoleDecisionRuleSpec<Payload, JoinInput> =
  RoleProjectionSpec<Payload, JoinInput>

/**
 * Build one native private decision-rule definition. This is the same wiring as
 * {@link roleProjection}; the distinct name marks the suppressible, host-input
 * reading variant so a decision rule stops hand-rolling the component contract.
 */
export function roleDecisionRule<Payload, JoinInput>(
  spec: RoleDecisionRuleSpec<Payload, JoinInput>,
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
