// The untrusted-reply ingress boundary: an outside producer's decision
// envelope becomes an AgentDecision here, or it throws.
//
// Optional trace telemetry is non-authoritative: rejection strips the trace
// without changing a legal external action.

import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import type { AgentDecision } from './types.ts'
import {
  admitDecisionTrace,
} from './admission/composed-trace.ts'

/**
 * External producers may return a private trace alongside their decision. The
 * wire stays permissive, but this is the boundary that converts it: a reply
 * without an admitted trace becomes a trace-less envelope, so nothing
 * downstream of here has to handle two shapes.
 */
export function parseExternalDecisionReply(
  req: DecisionRequest,
  reply: unknown,
  label = 'external agent',
  hostView?: Pick<PlayerView, 'rolesInPlay'>,
): AgentDecision {
  const record = reply as Record<string, unknown>
  const decision = record?.decision as Decision | undefined
  if (!decision || decision.kind !== req.kind) {
    throw new Error(`${label} returned invalid decision for ${req.kind}`)
  }
  if (record.trace === undefined) return { decision }
  const admission = admitDecisionTrace({
    kind: 'pre-apply-external',
    req,
    decision,
    trace: record.trace,
    ...(hostView ? { hostView } : {}),
  })
  if (admission.kind !== 'external-diagnostic') {
    return { decision }
  }
  return { decision, trace: admission.trace }
}
