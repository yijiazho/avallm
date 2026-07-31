// How a decision the engine accepted relates to the one the agent selected:
// the selection applied unchanged, or a fallback stood in after the agent
// errored or returned an illegal decision.
//
// This lives in its own leaf because it is named at two ends that must not
// import each other: the agent boundary (types.ts, trace.ts) and private
// cognition (cognition/plan-memory.ts). A dependency-free vocabulary lets both
// name a resolution without either importing up to the other.

export const APPLIED_DECISION_RESOLUTIONS = Object.freeze([
  'selected-applied',
  'fallback-after-agent-error',
  'fallback-after-illegal-decision',
] as const)

export type AppliedDecisionResolution =
  typeof APPLIED_DECISION_RESOLUTIONS[number]

export function isAppliedDecisionResolution(
  value: unknown,
): value is AppliedDecisionResolution {
  return (APPLIED_DECISION_RESOLUTIONS as readonly unknown[]).includes(value)
}
