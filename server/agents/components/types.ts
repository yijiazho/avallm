/**
 * Generic construction-time and per-decision contracts for decision components.
 *
 * These types deliberately do not import cognition, trace, transport,
 * artifact, or evaluation shapes. Those consumers project the same generic
 * decision records instead of extending this boundary with named fields.
 */

import type {
  DecisionKind,
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import type {
  PublicRecord,
} from '../communication/public-record.ts'

export type DecisionComponentKind =
  | 'observer'
  | 'objective'
  | 'projection'
  | 'decision-rule'

export type DecisionComponentPrivacy = 'public' | 'private'

export interface ComponentRef {
  readonly id: string
  readonly version: string
}

export interface ComponentToken<Payload = unknown> extends ComponentRef {
  readonly kind: DecisionComponentKind
  readonly privacy: DecisionComponentPrivacy
  /**
   * Compile-time payload witness. It has no runtime representation.
   */
  readonly __payload?: Payload
}

/**
 * Invocation-local, data-only values supplied by the composed-agent host.
 *
 * Host inputs have their own identity namespace. They are not decision
 * components, do not participate in policy attribution, and are never
 * projected into a component run. Values are already-derived operational
 * data, never raw Game/evaluation truth, services, callbacks, or clients.
 */
export interface ComponentHostInputRef extends ComponentRef {
  readonly privacy: DecisionComponentPrivacy
}

export interface ComponentHostInputToken<Value = unknown>
extends ComponentHostInputRef {
  /**
   * Compile-time value witness. It has no runtime representation.
   */
  readonly __value?: Value
}

export type ComponentHostInputValidationResult<Value> =
  | Readonly<{
      valid: true
      value: Value
    }>
  | Readonly<{
      valid: false
      degradationCode: string
    }>

export interface ComponentHostInputDefinition<Value = unknown> {
  readonly token: ComponentHostInputToken<Value>
  readonly maxPayloadBytes: number
  /**
   * Validate one snapshotted value without substituting or normalizing it.
   * Implementations must be synchronous and data-only.
   */
  validate(value: unknown): ComponentHostInputValidationResult<Value>
}

export interface ComponentHostInputBinding<Value = unknown> {
  readonly input: ComponentHostInputToken<Value>
  readonly value: Value
}

export interface ComponentHostInputReader {
  get<Value>(token: ComponentHostInputToken<Value>): Value | undefined
  require<Value>(token: ComponentHostInputToken<Value>): Value
}

export type HostCapability = string

export type ComponentVerification = 'exact' | 'structural'

export type ComponentAdmissionResult<Payload> =
  | Readonly<{
      admitted: true
      payload: Payload
      verification: ComponentVerification
      promotionEligible: boolean
    }>
  | Readonly<{
      admitted: false
      degradationCode: string
    }>

export interface ComponentHostAdmissionInput<
  Payload,
  HostContext = unknown,
> {
  readonly payload: Payload
  readonly host: HostContext
}

export interface ComponentDependencyReader {
  get<Payload>(token: ComponentToken<Payload>): Payload | undefined
  require<Payload>(token: ComponentToken<Payload>): Payload
}

export interface PublicDecisionInformation {
  /**
   * The requested action class is public game-flow information. Acting seat,
   * private targeting choices, and all other request fields are deliberately
   * absent.
   */
  readonly kind: DecisionKind
}

export interface PublicDecisionComponentApplicabilityContext {
  readonly privacy: 'public'
  readonly decision: PublicDecisionInformation
  readonly publicRecord: Readonly<PublicRecord>
}

export interface PrivateDecisionComponentApplicabilityContext {
  readonly privacy: 'private'
  readonly request: Readonly<DecisionRequest>
  readonly view: Readonly<PlayerView>
}

export type DecisionComponentApplicabilityContext =
  | PublicDecisionComponentApplicabilityContext
  | PrivateDecisionComponentApplicabilityContext

export type DecisionComponentContext =
  | Readonly<PublicDecisionComponentApplicabilityContext & {
      /**
       * Only declared public dependencies that were admitted earlier in the
       * resolved dependency order are visible through this reader.
       */
      readonly dependencies: ComponentDependencyReader
      /**
       * V1 forbids public components from declaring host inputs because root
       * bindings do not carry reconstructable public provenance.
       */
      readonly hostInputs: ComponentHostInputReader
    }>
  | Readonly<PrivateDecisionComponentApplicabilityContext & {
      /**
       * Only declared dependencies that were admitted earlier in the resolved
       * dependency order are visible through this reader.
       */
      readonly dependencies: ComponentDependencyReader
      /**
       * Only host inputs declared by this component are visible.
       */
      readonly hostInputs: ComponentHostInputReader
    }>

export type ComponentApplicability =
  | boolean
  | Readonly<{ status: 'applicable' }>
  | Readonly<{ status: 'inapplicable' }>
  | Readonly<{
      status: 'suppressed'
      reasonCode: string
    }>

export interface ComponentPayloadEnvelope<Payload = unknown> {
  readonly component: ComponentRef
  readonly kind: DecisionComponentKind
  readonly privacy: DecisionComponentPrivacy
  readonly payload: Payload
}

export type ComponentExecutionResult<Payload> =
  | Readonly<{
      status: 'produced'
      envelope: ComponentPayloadEnvelope<Payload>
    }>
  | Readonly<{
      status: 'suppressed'
      reasonCode: string
    }>

export interface DecisionComponentDefinition<Payload = unknown> {
  readonly token: ComponentToken<Payload>
  readonly source: 'native' | 'legacy-adapter'
  readonly dependencies: readonly ComponentRef[]
  readonly requiredHostInputs: readonly ComponentHostInputRef[]
  readonly hostRequirements: readonly HostCapability[]
  readonly maxPayloadBytes: number
  readonly degradationCode: string
  readonly deterministicSeedDomain?: string
  applies(
    context: DecisionComponentApplicabilityContext,
  ): ComponentApplicability | Promise<ComponentApplicability>
  execute(
    context: DecisionComponentContext,
  ): ComponentExecutionResult<Payload>
    | Promise<ComponentExecutionResult<Payload>>
  validateDetached(payload: unknown): ComponentAdmissionResult<Payload>
  admitHost(
    input: ComponentHostAdmissionInput<
      Payload,
      DecisionComponentContext
    >,
  ): ComponentAdmissionResult<Payload>
}

export interface IneligibleComponent {
  readonly component: ComponentRef
  readonly missingHostRequirements: readonly HostCapability[]
  readonly ineligibleDependencies: readonly ComponentRef[]
}

export interface ResolvedComponentGraph {
  /** Construction-time intent, in caller-declared order. */
  readonly requested: readonly ComponentRef[]
  /** Requested components plus dependencies, in stable dependency-first order. */
  readonly configured: readonly ComponentRef[]
  /** Configured entries whose dependencies and host requirements are eligible. */
  readonly eligible: readonly ComponentRef[]
  /** Configured entries excluded before any per-decision applicability check. */
  readonly ineligible: readonly IneligibleComponent[]
}
