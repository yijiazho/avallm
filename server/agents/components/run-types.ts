// The component-execution RESULT and PLAN data shapes: what a resolved graph
// produces, with none of the execution, admission, or validation logic. That
// logic lives in kernel.ts, which re-exports every shape here so callers still
// read them from `./kernel.ts`.
//
// The shapes live in this leaf so the policy score/decision layers can name a
// DecisionComponentRun without importing kernel.ts. kernel.ts imports the
// resolved brain, which pulls in the layer registries and their types; if those
// types reached back into kernel.ts for the run shape, the whole component and
// policy-layer stack would be one cycle. Naming the shapes below breaks it.

import type {
  ComponentPayloadEnvelope,
  ComponentRef,
  ComponentVerification,
  DecisionComponentKind,
  DecisionComponentPrivacy,
} from './types.ts'

export const DECISION_COMPONENT_RUN_VERSION =
  'decision-component-run-v1'
export const DECISION_COMPONENT_PLAN_VERSION =
  'decision-component-plan-v1'

export interface DecisionComponentPlan {
  readonly version: typeof DECISION_COMPONENT_PLAN_VERSION
  readonly configured: readonly ComponentRef[]
}

export type DecisionComponentStatus =
  | 'inapplicable'
  | 'suppressed'
  | 'degraded'
  | 'admitted'

export interface DecisionComponentEntryBase {
  readonly component: ComponentRef
  readonly kind: DecisionComponentKind
  readonly privacy: DecisionComponentPrivacy
}

export type DecisionComponentEntry =
  | Readonly<DecisionComponentEntryBase & {
      status: 'inapplicable'
    }>
  | Readonly<DecisionComponentEntryBase & {
      status: 'suppressed'
      reasonCode: string
    }>
  | Readonly<DecisionComponentEntryBase & {
      status: 'degraded'
      degradationCode: string
      failureCode:
        | 'construction-ineligible'
        | 'applicability-failed'
        | 'dependency-unavailable'
        | 'host-input-unavailable'
        | 'host-input-invalid'
        | 'execution-failed'
        | 'malformed-result'
        | 'tag-mismatch'
        | 'payload-json-unsafe'
        | 'payload-too-large'
        | 'detached-validation-failed'
        | 'host-admission-failed'
    }>
  | Readonly<DecisionComponentEntryBase & {
      status: 'admitted'
      envelope: ComponentPayloadEnvelope
      verification: ComponentVerification
      promotionEligible: boolean
      payloadBytes: number
    }>

export interface DecisionComponentPolicyUse {
  readonly component: ComponentRef
  readonly used: boolean
  /**
   * Generic policy-stage identifiers in causal application order. The array
   * stays empty until later scorer or decision layers explicitly attribute
   * use, and can retain more than one distinct causal stage.
   */
  readonly stages: readonly string[]
}

export interface DecisionComponentRun {
  readonly version: typeof DECISION_COMPONENT_RUN_VERSION
  readonly configured: readonly ComponentRef[]
  readonly entries: readonly DecisionComponentEntry[]
  readonly policyUse: readonly DecisionComponentPolicyUse[]
}

export type PublicDecisionComponentEntry =
  DecisionComponentEntry

export interface PublicDecisionComponentRun {
  readonly version: typeof DECISION_COMPONENT_RUN_VERSION
  readonly configured: readonly ComponentRef[]
  readonly entries: readonly PublicDecisionComponentEntry[]
  /**
   * Causal policy use is always private. A public component may still feed a
   * private role policy, so even its stage name or used bit cannot be
   * projected into speech or public logs.
   */
  readonly policyUse: readonly DecisionComponentPolicyUse[]
}
