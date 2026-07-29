import type { Immutable } from '../trusted-data.ts'
import type {
  ScoreLayerRow,
  ScoreLayerRunCompletion,
  ScoreLayerSurface,
  ScoreLayerSurfaceDraft,
  ScoreLayerSurfaceFactory,
} from './types.ts'

export const MAX_SCORE_LAYER_SURFACE_JSON_BYTES = 1_048_576
export const MAX_SCORE_LAYER_REASON_CODES = 32
export const MAX_SCORE_LAYER_STRING_BYTES = 256
export const SCORE_LAYER_SURFACE_VERSION = 'score-layer-surface-v1'

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/

export interface ScoreLayerSurfaceWork {
  forcedCandidateIdsVisited: number
  candidateBoundaryIdsVisited: number
  legalCandidatesVisited: number
  surfaceBuildAttempts: number
  surfacePriorSurvivorsVisited: number
  surfaceDraftSurvivorsVisited: number
  surfaceRowsVisited: number
  surfaceReasonsVisited: number
  surfaceBytesConstructed: number
}

function jsonStringBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function fixedRowBytes(
  row: ScoreLayerRow,
  reasonBytes: number,
): number {
  return 2
    + jsonStringBytes('candidateId') + 1
      + jsonStringBytes(row.candidateId)
    + 1 + jsonStringBytes('value') + 1
      + Buffer.byteLength(JSON.stringify(row.value), 'utf8')
    + 1 + jsonStringBytes('viable') + 1
      + (row.viable ? 4 : 5)
    + 1 + jsonStringBytes('reasonCodes') + 1 + reasonBytes
}

function fixedSurfaceBytes(
  rowsBytes: number,
  rowCount: number,
  survivorBytes: number,
): number {
  const scoreBytes = 2 + rowsBytes + Math.max(0, rowCount - 1)
  return 2
    + jsonStringBytes('version') + 1
      + jsonStringBytes(SCORE_LAYER_SURFACE_VERSION)
    + 1 + jsonStringBytes('scores') + 1 + scoreBytes
    + 1 + jsonStringBytes('survivorCandidateIds') + 1 + survivorBytes
}

export function canonicalForcedPolicy(
  input: Pick<ScoreLayerRunCompletion, 'candidates' | 'forced'>,
  operations: ScoreLayerSurfaceWork,
): Immutable<ScoreLayerRunCompletion['forced']> {
  const source = input.forced.allowedCandidateIds
  if (source.length === 0 || source.length > input.candidates.length) {
    throw new Error('forced policy must retain a legal candidate')
  }
  const allowed = new Set<string>()
  for (const id of source) {
    operations.forcedCandidateIdsVisited++
    if (typeof id !== 'string' || allowed.has(id)) {
      throw new Error('forced policy candidate ids must be unique strings')
    }
    allowed.add(id)
  }
  const canonical: string[] = []
  const legalIds = new Set<string>()
  for (const candidate of input.candidates) {
    operations.legalCandidatesVisited++
    if (legalIds.has(candidate.id)) {
      throw new Error('legal score candidates must have unique ids')
    }
    legalIds.add(candidate.id)
    if (!allowed.has(candidate.id)) continue
    if (candidate.id !== source[canonical.length]) {
      throw new Error('forced policy candidates are not in canonical legal order')
    }
    canonical.push(candidate.id)
  }
  if (canonical.length !== source.length) {
    throw new Error('forced policy contains an unknown candidate')
  }
  if (
    input.forced.selectedCandidateId !== undefined
    && !allowed.has(input.forced.selectedCandidateId)
  ) throw new Error('forced selection is outside the allowed candidates')
  return Object.freeze({
    version: input.forced.version,
    applied: input.forced.applied,
    reasonCodes: input.forced.reasonCodes,
    allowedCandidateIds: Object.freeze(canonical),
    ...(input.forced.selectedCandidateId === undefined
      ? {}
      : { selectedCandidateId: input.forced.selectedCandidateId }),
  }) as Immutable<ScoreLayerRunCompletion['forced']>
}

export function canonicalCandidateBoundary(
  input: Pick<
    ScoreLayerRunCompletion,
    'candidateBoundary' | 'candidates'
  >,
  operations: ScoreLayerSurfaceWork,
): Immutable<ScoreLayerRunCompletion['candidateBoundary']> {
  const source = input.candidateBoundary.survivorCandidateIds
  if (source.length === 0 || source.length > input.candidates.length) {
    throw new Error('candidate boundary must retain a legal candidate')
  }
  const retained = new Set<string>()
  for (const id of source) {
    operations.candidateBoundaryIdsVisited++
    if (typeof id !== 'string' || retained.has(id)) {
      throw new Error('candidate boundary ids must be unique strings')
    }
    retained.add(id)
  }
  const canonical: string[] = []
  const legalIds = new Set<string>()
  for (const candidate of input.candidates) {
    operations.legalCandidatesVisited++
    if (legalIds.has(candidate.id)) {
      throw new Error('legal score candidates must have unique ids')
    }
    legalIds.add(candidate.id)
    if (!retained.has(candidate.id)) continue
    if (candidate.id !== source[canonical.length]) {
      throw new Error(
        'candidate boundary is not in canonical legal order',
      )
    }
    canonical.push(candidate.id)
  }
  if (canonical.length !== source.length) {
    throw new Error('candidate boundary contains an unknown candidate')
  }
  const selected = input.candidateBoundary.selectedCandidateId
  if (selected !== undefined && !retained.has(selected)) {
    throw new Error('candidate boundary selected outside its survivors')
  }
  if (selected !== undefined && canonical.length !== 1) {
    throw new Error('candidate boundary selection must be its sole survivor')
  }
  return Object.freeze({
    survivorCandidateIds: Object.freeze(canonical),
    ...(selected === undefined ? {} : { selectedCandidateId: selected }),
    reasonCodes: input.candidateBoundary.reasonCodes,
  }) as Immutable<ScoreLayerRunCompletion['candidateBoundary']>
}

export interface ScoreLayerSurfaceLease {
  readonly factory: ScoreLayerSurfaceFactory
  accepts(surface: Immutable<ScoreLayerSurface>): boolean
}

export interface ScoreLayerSurfaceRuntime {
  layer(prior: Immutable<ScoreLayerSurface> | undefined):
    ScoreLayerSurfaceLease
}

export function createScoreLayerSurfaceRuntime(
  candidates: ScoreLayerRunCompletion['candidates'],
  boundary: Immutable<ScoreLayerRunCompletion['candidateBoundary']>,
  operations: ScoreLayerSurfaceWork,
): ScoreLayerSurfaceRuntime {
  const provenance = new WeakMap<object, object>()
  return Object.freeze({
    layer(
      priorSurface: Immutable<ScoreLayerSurface> | undefined,
    ): ScoreLayerSurfaceLease {
      const owner = Object.freeze({})
      let created = false
      const factory: ScoreLayerSurfaceFactory = Object.freeze({
        create(draft: ScoreLayerSurfaceDraft): Immutable<ScoreLayerSurface> {
          operations.surfaceBuildAttempts++
          if (created) throw new Error('score layer built more than one surface')
          created = true
          if (
            draft.scores.length !== candidates.length
            || draft.survivorCandidateIds.length === 0
            || draft.survivorCandidateIds.length > candidates.length
          ) throw new Error('invalid score layer surface draft')

          const allowedPrior =
            priorSurface?.survivorCandidateIds
            ?? boundary.survivorCandidateIds
          const survivors: string[] = []
          const survivorSet = new Set<string>()
          let priorIndex = 0
          let selectedSeen = false
          let survivorBytes = 2
          let changedFromPrior = priorSurface === undefined
            || draft.survivorCandidateIds.length
              !== priorSurface.survivorCandidateIds.length
          for (const value of draft.survivorCandidateIds) {
            operations.surfaceDraftSurvivorsVisited++
            if (
              typeof value !== 'string'
              || value.length > MAX_SCORE_LAYER_STRING_BYTES
              || Buffer.byteLength(value, 'utf8')
                > MAX_SCORE_LAYER_STRING_BYTES
            ) throw new Error('invalid score layer survivor id')
            let matched = false
            while (priorIndex < allowedPrior.length) {
              operations.surfacePriorSurvivorsVisited++
              const prior = allowedPrior[priorIndex++]
              if (prior === value) {
                matched = true
                break
              }
            }
            if (!matched) {
              throw new Error(
                'score layer survivors did not narrow monotonically',
              )
            }
            if (
              priorSurface
              && value
                !== priorSurface.survivorCandidateIds[survivors.length]
            ) changedFromPrior = true
            if (value === boundary.selectedCandidateId) selectedSeen = true
            survivorBytes += jsonStringBytes(value)
              + (survivors.length === 0 ? 0 : 1)
            survivorSet.add(value)
            survivors.push(value)
          }
          if (
            priorSurface === undefined
            && survivors.length !== allowedPrior.length
          ) throw new Error('score layer root changed forced survivors')
          if (
            boundary.selectedCandidateId !== undefined
            && !selectedSeen
          ) throw new Error('score layer removed the hard selection')

          const rows: ScoreLayerRow[] = []
          let rowsBytes = 0
          let viableSurvivors = 0
          for (let index = 0; index < draft.scores.length; index++) {
            operations.surfaceRowsVisited++
            const source = draft.scores[index]
            if (
              source.candidateId !== candidates[index].id
              || typeof source.value !== 'number'
              || !Number.isFinite(source.value)
              || typeof source.viable !== 'boolean'
              || source.reasonCodes.length > MAX_SCORE_LAYER_REASON_CODES
              || (!survivorSet.has(source.candidateId) && source.viable)
              || (
                boundary.selectedCandidateId !== undefined
                && source.candidateId !== boundary.selectedCandidateId
                && source.viable
              )
            ) throw new Error('invalid score layer row draft')
            const priorRow = priorSurface?.scores[index]
            if (
              priorRow
              && (
                source.candidateId !== priorRow.candidateId
                || !Object.is(source.value, priorRow.value)
                || source.viable !== priorRow.viable
                || source.reasonCodes.length !== priorRow.reasonCodes.length
              )
            ) changedFromPrior = true
            const reasons: string[] = []
            let reasonBytes = 2
            for (
              let reasonIndex = 0;
              reasonIndex < source.reasonCodes.length;
              reasonIndex++
            ) {
              operations.surfaceReasonsVisited++
              const reason = source.reasonCodes[reasonIndex]
              if (
                typeof reason !== 'string'
                || reason.length > MAX_SCORE_LAYER_STRING_BYTES
                || !CODE_PATTERN.test(reason)
                || Buffer.byteLength(reason, 'utf8')
                  > MAX_SCORE_LAYER_STRING_BYTES
              ) throw new Error('invalid score layer reason code')
              if (
                priorRow
                && reason !== priorRow.reasonCodes[reasonIndex]
              ) changedFromPrior = true
              reasonBytes += jsonStringBytes(reason)
                + (reasons.length === 0 ? 0 : 1)
              reasons.push(reason)
            }
            const row: ScoreLayerRow = Object.freeze({
              candidateId: source.candidateId,
              value: source.value,
              viable: source.viable,
              reasonCodes: Object.freeze(reasons),
            })
            rowsBytes += fixedRowBytes(row, reasonBytes)
            if (
              fixedSurfaceBytes(rowsBytes, rows.length + 1, survivorBytes)
                > MAX_SCORE_LAYER_SURFACE_JSON_BYTES
            ) {
              throw new Error(
                'score layer surface exceeds constructed byte bound',
              )
            }
            if (
              survivorSet.has(row.candidateId)
              && row.viable
              && (
                boundary.selectedCandidateId === undefined
                || row.candidateId === boundary.selectedCandidateId
              )
            ) viableSurvivors++
            rows.push(row)
          }
          if (viableSurvivors === 0) {
            throw new Error('score layer surface has no viable survivor')
          }
          if (priorSurface && !changedFromPrior) {
            throw new Error('score layer no-op must be inapplicable')
          }
          const bytes = fixedSurfaceBytes(
            rowsBytes,
            rows.length,
            survivorBytes,
          )
          if (bytes > MAX_SCORE_LAYER_SURFACE_JSON_BYTES) {
            throw new Error('score layer surface exceeds retained byte bound')
          }
          const surface = Object.freeze({
            version: SCORE_LAYER_SURFACE_VERSION,
            scores: Object.freeze(rows),
            survivorCandidateIds: Object.freeze(survivors),
          }) as Immutable<ScoreLayerSurface>
          provenance.set(surface, owner)
          operations.surfaceBytesConstructed += bytes
          return surface
        },
      })
      return Object.freeze({
        factory,
        accepts: (surface: Immutable<ScoreLayerSurface>) =>
          provenance.get(surface) === owner,
      })
    },
  })
}
