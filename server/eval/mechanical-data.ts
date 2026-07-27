// Public-only mechanical evidence rows for likelihood calibration.
//
// The extractor deliberately reads public log events and public artifact
// metadata only. Hidden roles may be used later as offline labels, but never
// as factor inputs or row features.

import type { Alignment, Seat } from '../engine/types.ts'
import type { GameArtifact } from './artifact.ts'

export const MECHANICAL_DATA_SCHEMA = 1
export const MECHANICAL_DATA_VERSION = 'mechanical-public-rows-v1'

export type DatasetSplit = 'train' | 'validation' | 'test'

interface MechanicalRowBase {
  schema: typeof MECHANICAL_DATA_SCHEMA
  extractorVersion: typeof MECHANICAL_DATA_VERSION
  gameId: string
  populationId: string
  split: DatasetSplit
  sourceSeq: number
  playerCount: number
  scoreBefore: Readonly<{ good: number; evil: number }>
}

export type MechanicalEvidenceRow =
  | (MechanicalRowBase & {
      kind: 'proposal'
      round: number
      proposalNum: number
      leader: Seat
      team: readonly Seat[]
    })
  | (MechanicalRowBase & {
      kind: 'vote'
      round: number
      proposalNum: number
      team: readonly Seat[]
      votes: readonly { seat: Seat; vote: 'approve' | 'reject' }[]
      approved: boolean
      automatic: boolean
    })
  | (MechanicalRowBase & {
      kind: 'quest'
      questNum: number
      team: readonly Seat[]
      failCount: number
      failsRequired: number
      result: 'success' | 'fail'
    })

export interface MechanicalDataset {
  schema: typeof MECHANICAL_DATA_SCHEMA
  extractorVersion: typeof MECHANICAL_DATA_VERSION
  rows: readonly MechanicalEvidenceRow[]
  excluded: readonly {
    gameId: string
    reason: 'evaluation-deal' | 'human-study'
  }[]
}

function fnv1a(value: string): number {
  let state = 2166136261
  for (const character of value) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }
  return state >>> 0
}

export function opponentPopulationId(artifact: GameArtifact): string {
  return [
    `${artifact.playerCount}p`,
    ...artifact.players.map((player) => player.agent).sort(),
  ].join('|')
}

export function datasetSplitFor(
  artifact: Pick<GameArtifact, 'id' | 'seed' | 'playerCount' | 'players'>,
): DatasetSplit {
  const populationId = [
    `${artifact.playerCount}p`,
    ...artifact.players.map((player) => player.agent).sort(),
  ].join('|')
  const bucket = fnv1a(
    `${populationId}\0${artifact.seed}`,
  ) % 100
  if (bucket < 70) return 'train'
  if (bucket < 85) return 'validation'
  return 'test'
}

function exclusion(
  artifact: GameArtifact,
): MechanicalDataset['excluded'][number]['reason'] | undefined {
  if (
    artifact.tags?.datasetUse === 'human-study'
    || artifact.tags?.humanStudy === 'true'
  ) {
    return 'human-study'
  }
  if (
    artifact.architecture
    || artifact.tags?.datasetUse === 'evaluation'
    || artifact.tags?.evaluationBank !== undefined
  ) {
    return 'evaluation-deal'
  }
  return undefined
}

export function mechanicalDataset(
  artifacts: readonly GameArtifact[],
): MechanicalDataset {
  const rows: MechanicalEvidenceRow[] = []
  const excluded: MechanicalDataset['excluded'][number][] = []
  for (const artifact of artifacts) {
    const excludedReason = exclusion(artifact)
    if (excludedReason) {
      excluded.push({ gameId: artifact.id, reason: excludedReason })
      continue
    }
    const populationId = opponentPopulationId(artifact)
    const split = datasetSplitFor(artifact)
    const score = { good: 0, evil: 0 }
    let approvedTeam: readonly Seat[] | undefined
    for (const event of artifact.log) {
      if (event.visibility !== 'public') continue
      const payload = event.payload
      const base = {
        schema: MECHANICAL_DATA_SCHEMA,
        extractorVersion: MECHANICAL_DATA_VERSION,
        gameId: artifact.id,
        populationId,
        split,
        sourceSeq: event.seq,
        playerCount: artifact.playerCount,
        scoreBefore: { ...score },
      } as const
      if (event.type === 'proposal') {
        rows.push({
          ...base,
          kind: 'proposal',
          round: payload.round as number,
          proposalNum: payload.proposalNum as number,
          leader: payload.leader as Seat,
          team: [...(payload.team as Seat[])],
        })
      } else if (event.type === 'voteReveal') {
        if (payload.approved === true) {
          approvedTeam = [...(payload.team as Seat[])]
        }
        rows.push({
          ...base,
          kind: 'vote',
          round: payload.round as number,
          proposalNum: payload.proposalNum as number,
          team: [...(payload.team as Seat[])],
          votes: (
            payload.votes as Array<{
              seat: Seat
              vote: 'approve' | 'reject'
            }>
          ).map((vote) => ({ ...vote })),
          approved: payload.approved as boolean,
          automatic: payload.auto === true,
        })
      } else if (event.type === 'questResult') {
        if (!approvedTeam) {
          throw new Error(
            `${artifact.id}:${event.seq}: quest result has no public approved team`,
          )
        }
        const result = payload.result as 'success' | 'fail'
        rows.push({
          ...base,
          kind: 'quest',
          questNum: payload.round as number,
          team: [...approvedTeam],
          failCount: payload.failCount as number,
          failsRequired: payload.failsRequired as number,
          result,
        })
        score[result === 'success' ? 'good' : 'evil']++
        approvedTeam = undefined
      }
    }
  }
  return {
    schema: MECHANICAL_DATA_SCHEMA,
    extractorVersion: MECHANICAL_DATA_VERSION,
    rows,
    excluded,
  }
}

/** Truth is an offline label and is never part of MechanicalEvidenceRow. */
export interface CalibrationTruth {
  playerAlignment?: Readonly<{ seat: Seat; alignment: Alignment }>
  teamClean?: Readonly<{ team: readonly Seat[]; clean: boolean }>
}
