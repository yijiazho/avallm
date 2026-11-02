// The durable game record: one finished game per file.
//
// The artifact is deliberately the existing eval format (`GameArtifact`) rather
// than a second game schema. The wrapper adds only runtime configuration and
// post-game state, which the eval format does not know about. The artifact
// already owns roles (pre-shuffle), players, agents, winner, and the full log.

import type { TableSeat } from '../agents/def-types.ts'
import type { Alignment, Role } from '../engine/types.ts'
import type { GameArtifact } from '../eval/core/artifact.ts'
import type { PostgameRecord } from '../postgame/types.ts'

export const ARCHIVE_VERSION = 1

export type ArchiveFidelity = 'public' | 'full'
export type HistoryMode = 'off' | 'digest' | 'full'

export interface ArchivedGame {
  archiveVersion: 1
  artifact: GameArtifact
  config: {
    humanSeats: number
    fidelity: ArchiveFidelity
    historyMode: HistoryMode
    botTable: TableSeat[]
  }
  /** The post-game review, written back after the base record. */
  postgame?: PostgameRecord
}

export type ArchivePostgameStatus =
  | 'none'
  | 'pending'
  | 'running'
  | 'complete'
  | 'partial'
  | 'failed'

export interface ArchiveMeta {
  id: string
  createdAt: string
  playerCount: number
  roles: Role[]
  winner: Alignment
  winReason: string
  postgame: ArchivePostgameStatus
  agents: { seat: number; descriptor: string; model?: string }[]
}

export interface ArchiveProblem {
  file: string
  reason: string
}

export interface ArchiveScan {
  metas: ArchiveMeta[]
  problems: ArchiveProblem[]
}
