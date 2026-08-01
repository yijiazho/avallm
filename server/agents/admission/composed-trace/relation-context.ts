// The context object every cross-field relation validator is handed, and the
// seeded-selection ladder several of them share. Both are common ground: put
// either in one relation module and the other relation modules import that one
// sideways for a reason that has nothing to do with what it is named for.

import type {
  PlayerView,
  Role,
} from '../../../engine/types.ts'
import {
  LEGAL_CANDIDATE_VERSION,
} from '../../candidate/types.ts'
import {
  SEEDED_SELECTION_MARGIN,
  SELECTION_ADJUSTMENT_REPLAY_TOLERANCE,
} from '../../canonical/probability-arithmetic.ts'
import type {
  DecisionComponentRun,
} from '../../components/kernel.ts'
import type {
  TraceValidationInput,
} from '../trace-primitives.ts'

export interface ComposedTraceContext {
  readonly trace: TraceValidationInput
  /** Host table size for seat bounds, undefined when no host view was given. */
  readonly playerCount: number | undefined
  /** Exact public evidence host, present at live and finalized host joins. */
  readonly hostView?: PlayerView
  /** Public cast, available from either a partial or full host view. */
  readonly hostRolesInPlay?: readonly Role[]
  readonly scores: Array<Record<string, unknown>>
  readonly ids: string[]
  readonly components: Record<string, unknown> | undefined
  readonly componentRun: DecisionComponentRun | undefined
  readonly hasPlanner: boolean
  readonly chosen: string
  readonly chosenScore: Record<string, unknown> | undefined
  readonly chosenFeatures: Record<string, unknown> | undefined
  readonly action: Record<string, unknown>
  readonly relevantTeam: Record<string, unknown> | undefined
  readonly intent: Record<string, unknown> | undefined
  readonly structured: unknown
  readonly plannerReasons: unknown
  readonly phase4c: boolean
  readonly proposalFeatureScores: Array<Record<string, unknown>>
  readonly voteFeatureScores: Array<Record<string, unknown>>
  readonly roleFeatureScores: Array<Record<string, unknown>>
  readonly evilRoleFeatureScores: Array<Record<string, unknown>>
  readonly morganaRoleFeatureScores: Array<Record<string, unknown>>
}

/**
 * The seeded-band selection ladder shared verbatim by the good-role and
 * evil-role composite validators. Returns true when the replayed selection is
 * INVALID (the operand that forces the enclosing validator to reject), so each
 * call site keeps its `|| seededSelectionReplayInvalid(...)` shape.
 *
 * The three arms are: a forced pick (exactly one viable row equal to the forced
 * id, no adjustment, no seed bucket); an active seeded band (two viable rows,
 * seed bucket 0 or 1, and each row's adjustment within tolerance of the seeded
 * lift for the seeded candidate and zero otherwise); and the plain canonical top
 * (exactly one viable row equal to the canonical winner, no adjustment, no seed
 * bucket). The good and evil copies differed only in which feature object and
 * value field the rows carry, both captured by featuresOf and valueKey; the
 * vote-feature arm is deliberately NOT routed here because it omits the forced
 * arm, adds an available-length guard, and coerces differently.
 */
export function seededSelectionReplayInvalid(params: {
  readonly rows: ReadonlyArray<Record<string, unknown>>
  readonly viable: ReadonlyArray<Record<string, unknown>>
  readonly featuresOf: (score: Record<string, unknown>) => Record<string, unknown>
  readonly valueKey: string
  readonly maxValue: number
  readonly forcedSelected: string | undefined
  readonly bandActive: boolean
  readonly seedBucket: unknown
  readonly canonicalTop: string | undefined
}): boolean {
  const {
    rows, viable, featuresOf, valueKey, maxValue,
    forcedSelected, bandActive, seedBucket, canonicalTop,
  } = params
  if (forcedSelected) {
    return viable.length !== 1
      || viable[0]!.candidateId !== forcedSelected
      || rows.some((score) => {
        const feature = featuresOf(score)
        return feature.seedBucket !== undefined
          || feature.selectionAdjustment !== 0
      })
  }
  if (bandActive) {
    return viable.length !== 2
      || (seedBucket !== 0 && seedBucket !== 1)
      || rows.some((score) => {
        const feature = featuresOf(score)
        const selectedId = seedBucket === 0
          ? `${LEGAL_CANDIDATE_VERSION}:vote:approve`
          : `${LEGAL_CANDIDATE_VERSION}:vote:reject`
        return feature.seedBucket !== seedBucket
          || Math.abs(
            Number(feature.selectionAdjustment)
              - (
                score.candidateId === selectedId
                  ? maxValue - Number(feature[valueKey]) + SEEDED_SELECTION_MARGIN
                  : 0
              ),
          ) > SELECTION_ADJUSTMENT_REPLAY_TOLERANCE
      })
  }
  return viable.length !== 1
    || viable[0]!.candidateId !== canonicalTop
    || rows.some((score) => {
      const feature = featuresOf(score)
      return feature.seedBucket !== undefined
        || feature.selectionAdjustment !== 0
    })
}
