import { isDeepStrictEqual } from 'node:util'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  type DecisionTrace,
} from '../trace.ts'
import {
  DECISION_COMPONENT_RUN_VERSION,
  DECISION_COMPONENT_PLAN_VERSION,
  validateDecisionComponentPlan,
  type DecisionComponentPlan,
} from './kernel.ts'
import type {
  ResolvedArchitectureIdentity,
} from './resolved-brain.ts'
import {
  resolvedArchitectureIdentityDigest,
  resolvedArchitectureIdentityVersions,
} from './resolved-brain.ts'

export function architectureIdentityDecisionPlan(
  identity: ResolvedArchitectureIdentity,
): DecisionComponentPlan {
  const plan: DecisionComponentPlan = {
    version: DECISION_COMPONENT_PLAN_VERSION,
    configured: identity.components.configured.map((entry) => ({
      id: entry.id,
      version: entry.version,
    })),
  }
  if (!validateDecisionComponentPlan(plan)) {
    throw new Error('resolved architecture identity has an invalid plan')
  }
  return plan
}

/**
 * Exact configured-identity half of the descriptor/run join. Host admission
 * separately proves the runtime payloads against the reconstructed decision
 * context; neither artifacts nor reports may restate this predicate.
 */
export function resolvedArchitectureIdentityTraceJoin(
  identity: ResolvedArchitectureIdentity,
  trace: DecisionTrace,
): boolean {
  const versions = trace.componentVersions
  const expectedPlan = architectureIdentityDecisionPlan(identity)
  if (!versions) return false
  const eligible = new Set(
    identity.components.eligible.map(
      (entry) => `${entry.id}@${entry.version}`,
    ),
  )
  const ineligible = new Set(
    identity.components.ineligible.map(
      (entry) => `${entry.component.id}@${entry.component.version}`,
    ),
  )
  const runEntries = new Map(
    (trace.components?.entries ?? []).map((entry) => [
      `${entry.component.id}@${entry.component.version}`,
      entry,
    ]),
  )
  const configuredKeys = identity.components.configured.map(
    (entry) => `${entry.id}@${entry.version}`,
  )
  const exactRunCoverage = (
    trace.components?.entries.length === configuredKeys.length
    && runEntries.size === configuredKeys.length
    && configuredKeys.every((key) => runEntries.has(key))
  )
  const eligibilityMatchesRun = (
    exactRunCoverage
    && [...eligible].every((key) => {
      const entry = runEntries.get(key)
      return entry !== undefined && (
        entry.status !== 'degraded'
        || entry.failureCode !== 'construction-ineligible'
      )
    })
    && [...ineligible].every((key) => {
      const entry = runEntries.get(key)
      return entry?.status === 'inapplicable'
        || entry?.status === 'suppressed'
        || (
          entry?.status === 'degraded'
          && (
            entry.failureCode === 'applicability-failed'
            || entry.failureCode === 'construction-ineligible'
          )
        )
    })
  )
  return (
    trace.version === COMPONENT_DECISION_TRACE_VERSION
    && trace.agentMode === identity.executionMode
    && trace.architectureIdentityDigest
      === resolvedArchitectureIdentityDigest(identity)
    && versions?.decisionComponents === DECISION_COMPONENT_RUN_VERSION
    && isDeepStrictEqual(trace.componentPlan, expectedPlan)
    && trace.components?.version === DECISION_COMPONENT_RUN_VERSION
    && isDeepStrictEqual(
      trace.components.configured,
      identity.components.configured,
    )
    && eligibilityMatchesRun
  )
}

/**
 * Stable, generic report grouping. Runtime-selected adapter versions remain
 * trace facts and never overwrite this configured identity.
 */
export function architectureIdentityVersions(
  identity: ResolvedArchitectureIdentity,
): Record<string, string> {
  return resolvedArchitectureIdentityVersions(identity)
}

export function sameResolvedArchitectureIdentity(
  left: ResolvedArchitectureIdentity,
  right: ResolvedArchitectureIdentity,
): boolean {
  return isDeepStrictEqual(left, right)
}
