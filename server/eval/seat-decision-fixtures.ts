// Deterministic, API-free policy-run fixtures for the loopback inspector.
//
// This is execution plumbing, separate from the read-only Inspector projection.
// It retains the seed, resolved identity, raw trace, and admission server-side.

import {
  admitDecisionTrace,
  type DecisionTraceAdmissionResult,
} from '../agents/admission/composed-trace.ts'
import { createComposedAgent } from '../agents/composed.ts'
import {
  revalidatedArchitectureIdentity,
} from '../agents/components/resolved-brain.ts'
import {
  composedBrainOptions,
} from '../agents/registry.ts'
import type { SeatViewSnapshotFileEntry } from './seat-view-inspector.ts'
import { validateSeatViewBoundary } from './seat-view-inspector.ts'
import {
  inspectSeatDecision,
  type SeatDecisionInspection,
} from './seat-decision-inspector.ts'

type TrustedAdmission = Extract<
  DecisionTraceAdmissionResult,
  { kind: 'trusted-exact' }
>

function fixtureId(entry: SeatViewSnapshotFileEntry, index: number): string {
  return entry.id ?? `snapshot-${index + 1}`
}

async function trustedRun(
  entry: SeatViewSnapshotFileEntry,
  index: number,
): Promise<TrustedAdmission> {
  validateSeatViewBoundary(entry.req, entry.view)
  const seed = `seat-decision-inspector-v2:${fixtureId(entry, index)}`
  const agent = createComposedAgent({
    seed,
    ...composedBrainOptions('full-role'),
  })
  const output = await agent.decide(entry.req, entry.view)
  if (!output.trace) {
    throw new Error('native inspector fixture produced no decision trace')
  }
  const admission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace,
    req: entry.req,
    view: entry.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: seed,
    expectedArchitectureIdentity: revalidatedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  })
  if (admission.kind !== 'trusted-exact') {
    throw new Error(
      `native inspector fixture admission failed: ${admission.kind}`
      + (admission.kind === 'rejected' ? `/${admission.reason}` : ''),
    )
  }
  return admission
}

export async function inspectNativeSeatDecisionFixtures(
  entries: readonly SeatViewSnapshotFileEntry[],
): Promise<readonly {
  id: string
  inspection: SeatDecisionInspection
}[]> {
  return Promise.all(entries.map(async (entry, index) => ({
    id: fixtureId(entry, index),
    inspection: inspectSeatDecision(
      entry.req,
      entry.view,
      await trustedRun(entry, index),
    ),
  })))
}
