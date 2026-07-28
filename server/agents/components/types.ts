/**
 * Generic construction-time contracts for decision components.
 *
 * These types deliberately do not import cognition, trace, transport,
 * artifact, or evaluation shapes. Per-decision applicability and execution
 * belong to the Phase 7R2B2 kernel.
 */

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

export interface DecisionComponentDefinition<
  Payload = unknown,
  HostContext = unknown,
> {
  readonly token: ComponentToken<Payload>
  readonly source: 'native' | 'legacy-adapter'
  readonly dependencies: readonly ComponentRef[]
  readonly hostRequirements: readonly HostCapability[]
  readonly maxPayloadBytes: number
  readonly degradationCode: string
  readonly deterministicSeedDomain?: string
  validateDetached(payload: unknown): ComponentAdmissionResult<Payload>
  admitHost(
    input: ComponentHostAdmissionInput<Payload, HostContext>,
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
