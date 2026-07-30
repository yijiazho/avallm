// Private, read-only projection of one host-admitted composed decision.
//
// This module does not validate, replay, repair, or infer policy execution.
// Admission remains owned by agents/admission/composed-trace.ts. Every field
// below is selected from that admitted record, and unavailable stages remain
// unavailable rather than being reconstructed from component or scorer names.

import { isDeepStrictEqual } from 'node:util'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../engine/types.ts'
import { visibleEventCursor } from '../agents/belief/exact.ts'
import type {
  DecisionTraceAdmissionResult,
} from '../agents/admission/composed-trace.ts'
import type {
  CandidateScore,
} from '../agents/policy/score.ts'
import type {
  DecisionComponentEntry,
  DecisionComponentPolicyUse,
} from '../agents/components/kernel.ts'
import type {
  DecisionLayerJournalEntry,
} from '../agents/policy/decision-layer/types.ts'
import type {
  ScoreLayerJournalEntry,
} from '../agents/policy/score-layer/types.ts'
import type {
  DecisionTrace,
  TraceHypothesis,
} from '../agents/trace.ts'
import type {
  SeatViewInspection,
} from './seat-view-inspector.ts'
import { inspectSeatView } from './seat-view-inspector.ts'

export const SEAT_DECISION_INSPECTION_SCHEMA = 2

export interface InspectedBelief {
  modelVersion: string
  throughSeq: number
  quality: DecisionTrace['quality']
  degradation: readonly string[]
  topHypotheses: readonly TraceHypothesis[]
  playerMarginals: NonNullable<DecisionTrace['beliefPlayerMarginals']>
  teamAssessments: NonNullable<DecisionTrace['beliefTeamAssessments']>
  provenance: NonNullable<DecisionTrace['beliefProvenance']>
}

export interface InspectedComponent {
  component: DecisionComponentEntry['component']
  kind: DecisionComponentEntry['kind']
  privacy: DecisionComponentEntry['privacy']
  status: DecisionComponentEntry['status']
  verification?: 'exact' | 'structural'
  promotionEligible?: boolean
  reasonCode?: string
  degradationCode?: string
  failureCode?: string
  causalUse: {
    used: boolean
    stages: readonly string[]
  }
}

export interface InspectedCandidate {
  candidateId: string
  value: number
  viable: boolean
  reasonCodes: readonly string[]
  diagnosticFamilies: readonly string[]
}

export interface InspectedDecisionLayer {
  layer: DecisionLayerJournalEntry['layer']
  status: DecisionLayerJournalEntry['status']
  priorSurvivorCandidateIds: readonly string[]
  priorSelectedCandidateId?: string
  componentLookups: DecisionLayerJournalEntry['componentLookups']
  componentReads: DecisionLayerJournalEntry['componentReads']
  survivorCandidateIds?: readonly string[]
  selectedCandidateId?: string
  reasonCodes?: readonly string[]
  attributedComponents?: DecisionLayerJournalEntry['componentReads']
  suppressionCode?: string
  degradationCode?: string
  failureCode?: string
}

export interface InspectedPolicyRun {
  source: {
    admission: 'trusted-exact'
    lifecycle: 'finalized-artifact'
    traceVersion: DecisionTrace['version']
    decisionId: string
    promotionEvidenceEligible: boolean
  }
  belief: InspectedBelief
  components:
    | { status: 'present'; entries: readonly InspectedComponent[] }
    | { status: 'absent'; reason: string }
  candidates:
    | { status: 'present'; entries: readonly InspectedCandidate[] }
    | { status: 'absent'; reason: string }
  policyGate: {
    universalForced:
      | { status: 'present'; result: NonNullable<DecisionTrace['forcedPolicyResult']> }
      | { status: 'absent'; reason: string }
    strategicLayers:
      | {
          status: 'present'
          configured: readonly { id: string; version: string }[]
          journal: readonly InspectedDecisionLayer[]
          survivorCandidateIds: readonly string[]
          selectedCandidateId?: string
          reasonCodes: readonly string[]
        }
      | { status: 'absent'; reason: string }
  }
  scoreLayers: {
    status: 'present'
    configured: readonly { id: string; version: string }[]
    journal: readonly {
      layer: { id: string; version: string }
      status: ScoreLayerJournalEntry['status']
      analysisRequirements: readonly { id: string; version: string }[]
      analysisAdmission: ScoreLayerJournalEntry['analysisAdmission']
      componentLookups: readonly { id: string; version: string }[]
      componentReads: readonly { id: string; version: string }[]
      attributedComponents?: readonly { id: string; version: string }[]
      degradationCode?: string
      failureCode?: string
    }[]
    surface: {
      survivorCandidateIds: readonly string[]
      scores: readonly {
        candidateId: string
        value: number
        viable: boolean
        reasonCodes: readonly string[]
      }[]
    }
    scorerVersion?: string
    configuredScorerVersion?: string
  } | {
    status: 'absent'
    reason: string
  }
  commitment: {
    finalAction: Decision
    committedMechanicalAction?: Decision
    voice?: {
      version: string
      applied: boolean
    }
    chosenCandidateId?: string
    structuredCandidateId?: string
    plannerCandidateId?: string
    plannerReasonCodes: readonly string[]
    comparisons: {
      structuredEqualsCommitted: boolean | null
      plannerAttemptEqualsCommitted: boolean | null
      compatibilityCandidateId?: string
      compatibilityEqualsStructured: boolean | null
      compatibilityEqualsCommitted: boolean | null
      isolatedRoleAction: 'not-recorded'
      currentScorerVersion?: string
    }
  }
  communication:
    | {
        status: 'present'
        intent: NonNullable<DecisionTrace['communicationIntent']>
      }
    | { status: 'absent'; reason: string }
}

export interface SeatDecisionInspection extends Omit<SeatViewInspection, 'schema'> {
  schema: typeof SEAT_DECISION_INSPECTION_SCHEMA
  policyRun:
    | { status: 'present'; value: InspectedPolicyRun }
    | { status: 'absent'; reason: string }
}

const copyRefs = (
  refs: readonly { id: string; version: string }[],
): readonly { id: string; version: string }[] =>
  refs.map(({ id, version }) => ({ id, version }))

function useFor(
  uses: readonly DecisionComponentPolicyUse[],
  entry: DecisionComponentEntry,
): DecisionComponentPolicyUse | undefined {
  return uses.find(({ component }) =>
    component.id === entry.component.id
    && component.version === entry.component.version)
}

function inspectComponent(
  entry: DecisionComponentEntry,
  uses: readonly DecisionComponentPolicyUse[],
): InspectedComponent {
  const use = useFor(uses, entry)
  const base = {
    component: {
      id: entry.component.id,
      version: entry.component.version,
    },
    kind: entry.kind,
    privacy: entry.privacy,
    status: entry.status,
    causalUse: {
      used: use?.used ?? false,
      stages: [...(use?.stages ?? [])],
    },
  }
  if (entry.status === 'admitted') {
    return {
      ...base,
      verification: entry.verification,
      promotionEligible: entry.promotionEligible,
    }
  }
  if (entry.status === 'suppressed') {
    return { ...base, reasonCode: entry.reasonCode }
  }
  if (entry.status === 'degraded') {
    return {
      ...base,
      degradationCode: entry.degradationCode,
      failureCode: entry.failureCode,
    }
  }
  return base
}

function diagnosticFamilies(score: CandidateScore): readonly string[] {
  return [
    ...(score.features ? ['base'] : []),
    ...(score.roleObjectiveFeatures ? ['good-role'] : []),
    ...(score.evilRoleObjectiveFeatures ? ['evil-role'] : []),
    ...(score.morganaRoleObjectiveFeatures ? ['morgana'] : []),
  ]
}

function inspectCandidate(score: CandidateScore): InspectedCandidate {
  return {
    candidateId: score.candidateId,
    value: score.value,
    viable: score.viable,
    reasonCodes: [...score.reasonCodes],
    diagnosticFamilies: diagnosticFamilies(score),
  }
}

function inspectDecisionLayer(
  entry: DecisionLayerJournalEntry,
): InspectedDecisionLayer {
  const base: InspectedDecisionLayer = {
    layer: { id: entry.layer.id, version: entry.layer.version },
    status: entry.status,
    priorSurvivorCandidateIds: [...entry.priorSurvivorCandidateIds],
    ...(entry.priorSelectedCandidateId === undefined
      ? {}
      : { priorSelectedCandidateId: entry.priorSelectedCandidateId }),
    componentLookups: copyRefs(entry.componentLookups),
    componentReads: copyRefs(entry.componentReads),
  }
  if (entry.status === 'applied') {
    return {
      ...base,
      survivorCandidateIds: [...entry.survivorCandidateIds],
      ...(entry.selectedCandidateId === undefined
        ? {}
        : { selectedCandidateId: entry.selectedCandidateId }),
      reasonCodes: [...entry.reasonCodes],
      attributedComponents: copyRefs(entry.attributedComponents),
    }
  }
  if (entry.status === 'suppressed') {
    return { ...base, suppressionCode: entry.suppressionCode }
  }
  if (entry.status === 'degraded') {
    return {
      ...base,
      degradationCode: entry.degradationCode,
      failureCode: entry.failureCode,
    }
  }
  return base
}

function inspectScoreLayer(entry: ScoreLayerJournalEntry) {
  const base = {
    layer: { id: entry.layer.id, version: entry.layer.version },
    status: entry.status,
    analysisRequirements: copyRefs(entry.analysisRequirements),
    analysisAdmission: entry.analysisAdmission,
    componentLookups: copyRefs(entry.componentLookups),
    componentReads: copyRefs(entry.componentReads),
  }
  if (entry.status === 'generated' || entry.status === 'applied') {
    return {
      ...base,
      attributedComponents: copyRefs(entry.attributedComponents),
    }
  }
  if (entry.status === 'degraded') {
    return {
      ...base,
      degradationCode: entry.degradationCode,
      failureCode: entry.failureCode,
    }
  }
  return base
}

/**
 * Project one exact host-admitted trace. This function intentionally accepts
 * the closed admission result, not a trace-shaped object.
 */
export function inspectAdmittedPolicyRun(
  admission: DecisionTraceAdmissionResult,
): InspectedPolicyRun {
  if (admission.kind !== 'trusted-exact') {
    throw new Error(
      'policy-run inspection requires trusted-exact trace admission',
    )
  }
  const trace = admission.trace
  const components = trace.components
  const candidates = trace.candidateScores
  const strategic = trace.decisionLayerRun
  const scoreLayers = trace.scoreLayerRun
  const versions = trace.componentVersions
  const compatibilityCandidateId = candidates?.find(
    (candidate) => candidate.reasonCodes.includes('COMPATIBILITY_CHOICE'),
  )?.candidateId
  return {
    source: {
      admission: admission.kind,
      lifecycle: admission.lifecycle,
      traceVersion: trace.version,
      decisionId: trace.decisionId,
      promotionEvidenceEligible: admission.promotionEvidenceEligible,
    },
    belief: {
      modelVersion: trace.beliefModelVersion,
      throughSeq: trace.beliefThroughSeq,
      quality: trace.quality,
      degradation: [...trace.degradation],
      topHypotheses: structuredClone(trace.topHypotheses),
      playerMarginals: structuredClone(trace.beliefPlayerMarginals ?? []),
      teamAssessments: structuredClone(trace.beliefTeamAssessments ?? []),
      provenance: structuredClone(trace.beliefProvenance ?? []),
    },
    components: components
      ? {
          status: 'present',
          entries: components.entries.map((entry) =>
            inspectComponent(entry, components.policyUse)),
        }
      : {
          status: 'absent',
          reason: 'The admitted trace has no generic component run.',
        },
    candidates: candidates
      ? {
          status: 'present',
          entries: candidates.map(inspectCandidate),
        }
      : {
          status: 'absent',
          reason: 'The admitted trace has no candidate score surface.',
        },
    policyGate: {
      universalForced: trace.forcedPolicyResult
        ? {
            status: 'present',
            result: structuredClone(trace.forcedPolicyResult),
          }
        : {
            status: 'absent',
            reason: 'The admitted trace has no universal forced-policy result.',
          },
      strategicLayers: strategic
        ? {
            status: 'present',
            configured: copyRefs(strategic.configured),
            journal: strategic.journal.map(inspectDecisionLayer),
            survivorCandidateIds: [...strategic.surface.survivorCandidateIds],
            ...(strategic.surface.selectedCandidateId === undefined
              ? {}
              : { selectedCandidateId: strategic.surface.selectedCandidateId }),
            reasonCodes: [...strategic.surface.reasonCodes],
          }
        : {
            status: 'absent',
            reason: 'The admitted trace has no strategic decision-layer run.',
          },
    },
    scoreLayers: scoreLayers
      ? {
          status: 'present',
          configured: copyRefs(scoreLayers.configured),
          journal: scoreLayers.journal.map(inspectScoreLayer),
          surface: {
            survivorCandidateIds: [
              ...scoreLayers.surface.survivorCandidateIds,
            ],
            scores: scoreLayers.surface.scores.map((score) => ({
              candidateId: score.candidateId,
              value: score.value,
              viable: score.viable,
              reasonCodes: [...score.reasonCodes],
            })),
          },
          ...(versions?.scorer === undefined
            ? {}
            : { scorerVersion: versions.scorer }),
          ...(versions?.configuredScorer === undefined
            ? {}
            : { configuredScorerVersion: versions.configuredScorer }),
        }
      : {
          status: 'absent',
          reason: 'This admitted trace predates the native score-layer projection.',
        },
    commitment: {
      finalAction: structuredClone(trace.action),
      ...(trace.decisionFrame
        ? {
            committedMechanicalAction: structuredClone(
              trace.decisionFrame.committedMechanicalAction,
            ),
            voice: structuredClone(trace.decisionFrame.voice),
          }
        : {}),
      ...(trace.chosenCandidateId === undefined
        ? {}
        : { chosenCandidateId: trace.chosenCandidateId }),
      ...(trace.structuredCandidateId === undefined
        ? {}
        : { structuredCandidateId: trace.structuredCandidateId }),
      ...(trace.plannerCandidateId === undefined
        ? {}
        : { plannerCandidateId: trace.plannerCandidateId }),
      plannerReasonCodes: [...(trace.plannerReasonCodes ?? [])],
      comparisons: {
        structuredEqualsCommitted:
          trace.structuredCandidateId === undefined
          || trace.chosenCandidateId === undefined
            ? null
            : trace.structuredCandidateId === trace.chosenCandidateId,
        plannerAttemptEqualsCommitted:
          trace.plannerCandidateId === undefined
          || trace.chosenCandidateId === undefined
            ? null
            : trace.plannerCandidateId === trace.chosenCandidateId,
        ...(compatibilityCandidateId === undefined
          ? {}
          : { compatibilityCandidateId }),
        compatibilityEqualsStructured:
          compatibilityCandidateId === undefined
          || trace.structuredCandidateId === undefined
            ? null
            : compatibilityCandidateId === trace.structuredCandidateId,
        compatibilityEqualsCommitted:
          compatibilityCandidateId === undefined
          || trace.chosenCandidateId === undefined
            ? null
            : compatibilityCandidateId === trace.chosenCandidateId,
        isolatedRoleAction: 'not-recorded',
        ...(versions?.scorer === undefined
          ? {}
          : { currentScorerVersion: versions.scorer }),
      },
    },
    communication: trace.communicationIntent
      ? {
          status: 'present',
          intent: structuredClone(trace.communicationIntent),
        }
      : {
          status: 'absent',
          reason: 'No communication intent was committed for this decision.',
        },
  }
}

export function inspectSeatViewOnlyDecision(
  seatView: SeatViewInspection,
): SeatDecisionInspection {
  return {
    ...structuredClone(seatView),
    schema: SEAT_DECISION_INSPECTION_SCHEMA,
    policyRun: {
      status: 'absent',
      reason: 'No exact admitted policy run was supplied for this snapshot.',
    },
  }
}

export function inspectSeatDecision(
  req: DecisionRequest,
  view: PlayerView,
  admission: DecisionTraceAdmissionResult,
): SeatDecisionInspection {
  if (admission.kind !== 'trusted-exact') {
    return {
      ...inspectSeatView(req, view),
      schema: SEAT_DECISION_INSPECTION_SCHEMA,
      policyRun: {
        status: 'absent',
        reason: `${admission.kind} admission cannot populate causal policy panels.`,
      },
    }
  }
  const trace = admission.trace
  if (
    trace.viewerSeat !== view.seat
    || !isDeepStrictEqual(trace.request, req)
    || trace.beliefThroughSeq !== visibleEventCursor(view)
  ) {
    throw new Error(
      'seat decision inspection rejected: admitted trace does not match the seat view',
    )
  }
  const seatView = inspectSeatView(req, view)
  return {
    ...seatView,
    schema: SEAT_DECISION_INSPECTION_SCHEMA,
    omissions: [
      ...seatView.omissions.filter(
        (omission) => !omission.startsWith('No raw Game, posterior,'),
      ),
      'The seat-view boundary projection itself consults only DecisionRequest '
        + 'and PlayerView.',
      'Policy panels consult only the exact-admitted private run joined to '
        + 'this same seat and visible event cursor.',
      'Raw Game, true deal, other-seat views, deterministic seed, architecture '
        + 'identity witness, and raw trace remain outside browser output.',
    ],
    policyRun: {
      status: 'present',
      value: inspectAdmittedPolicyRun(admission),
    },
  }
}
