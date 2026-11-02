// Finished-game archive store: one atomic JSON file per game plus a boot-built
// metadata index.
//
// This module owns reads and writes of the durable record. It is server-layer
// code (not engine, not agents); the engine must never import it. The index is
// a cache derived from the files, never a second source of truth.

import fs, { type Dirent } from 'node:fs'
import path from 'node:path'
import type { TableSeat } from '../agents/def-types.ts'
import { plainRecord } from '../agents/canonical/canonical-shape.ts'
import type { DecisionTrace } from '../agents/trace.ts'
import { gamesDir } from '../data-dir.ts'
import { toArtifact } from '../eval/core/artifact.ts'
import type { Game } from '../engine/types.ts'
import { isTempFile, readJsonFile, writeJsonAtomic } from '../json-io.ts'
import type { DegradedDecision } from '../sim/runner.ts'
import {
  ARCHIVE_VERSION,
  type ArchiveFidelity,
  type ArchiveMeta,
  type ArchiveProblem,
  type ArchiveScan,
  type ArchivedGame,
  type HistoryMode,
} from './types.ts'

export interface ArchiveConfigInput {
  humanSeats: number
  fidelity?: ArchiveFidelity
  historyMode?: HistoryMode
  botTable: readonly TableSeat[]
}

export interface ToArchivedGameOpts {
  /** Per-seat descriptors, index = seat (same source as the eval artifact). */
  agents: string[]
  degraded: DegradedDecision[]
  steps: number
  decisionTraces?: DecisionTrace[]
  config: ArchiveConfigInput
}

// A named error lets the boot scan report one bad file without guessing from a
// message, while `readArchivedGame` callers can still catch a concrete type.
export class ArchiveError extends Error {
  readonly file: string

  constructor(name: string, file: string, message: string) {
    super(`${file}: ${message}`)
    this.name = name
    this.file = file
  }
}

export class ArchiveCorruptError extends ArchiveError {
  constructor(file: string, message: string) {
    super('ArchiveCorruptError', file, message)
  }
}

export class ArchiveVersionError extends ArchiveError {
  readonly version: number

  constructor(file: string, version: number) {
    super(
      'ArchiveVersionError',
      file,
      `archive version ${version} is newer than this server understands (max ${ARCHIVE_VERSION})`,
    )
    this.version = version
  }
}

let archiveDirOverride: string | undefined
const index = new Map<string, ArchiveMeta>()

// Called once at startup after the shared data root is resolved. Tests call it
// directly. An undefined/empty value follows the shared data root.
export function useArchiveDir(dir: string | undefined): void {
  archiveDirOverride = dir?.trim() || undefined
  index.clear()
}

export function archiveDir(): string {
  return archiveDirOverride ?? gamesDir()
}

export function archiveFile(gameId: string): string {
  return path.join(archiveDir(), `${gameId}.json`)
}

export function toArchivedGame(
  game: Game,
  opts: ToArchivedGameOpts,
): ArchivedGame {
  const artifact = toArtifact(game, {
    agents: opts.agents,
    degraded: opts.degraded,
    steps: opts.steps,
    ...(opts.decisionTraces === undefined
      ? {}
      : { decisionTraces: opts.decisionTraces }),
  })
  return {
    archiveVersion: ARCHIVE_VERSION,
    artifact,
    config: {
      humanSeats: opts.config.humanSeats,
      fidelity: opts.config.fidelity ?? 'full',
      historyMode: opts.config.historyMode ?? 'off',
      botTable: opts.config.botTable.map((seat) => ({ ...seat })),
    },
  }
}

// Idempotent by game id: the same finished game is written exactly once, even
// across pump re-entry. A file already on disk (including one indexed by the
// boot scan) is also a no-op, so a later process cannot clobber a record it did
// not create.
export function writeArchivedGame(record: ArchivedGame): ArchiveMeta {
  const id = record.artifact.id
  const cached = index.get(id)
  if (cached) return cached

  const file = archiveFile(id)
  if (fs.existsSync(file)) {
    const existing = readArchivedGameFile(file)
    const meta = archiveMeta(existing)
    index.set(meta.id, meta)
    return meta
  }

  writeJsonAtomic(file, record)
  const meta = archiveMeta(record)
  index.set(meta.id, meta)
  return meta
}

export function readArchivedGame(id: string): ArchivedGame | undefined {
  const file = archiveFile(id)
  if (!fs.existsSync(file)) return undefined
  return readArchivedGameFile(file)
}

// Reads every record at boot and builds the in-memory metadata index. A bad
// file is reported and skipped; it never aborts the scan. The scan is
// read-only: a missing archive directory stays missing until the first write.
export function loadArchive(): ArchiveScan {
  index.clear()
  const dir = archiveDir()
  let entries: Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { metas: [], problems: [] }
    return {
      metas: [],
      problems: [{ file: dir, reason: errorMessage(err) }],
    }
  }

  const metas: ArchiveMeta[] = []
  const problems: ArchiveProblem[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || isTempFile(entry.name)) {
      continue
    }
    const file = path.join(dir, entry.name)
    try {
      const record = readArchivedGameFile(file)
      const meta = archiveMeta(record)
      metas.push(meta)
      index.set(meta.id, meta)
    } catch (err) {
      problems.push({ file, reason: errorMessage(err) })
    }
  }
  return { metas, problems }
}

export function archiveMeta(record: ArchivedGame): ArchiveMeta {
  const artifact = record.artifact
  return {
    id: artifact.id,
    createdAt: artifact.createdAt,
    playerCount: artifact.playerCount,
    roles: [...artifact.roles],
    winner: artifact.winner,
    winReason: artifact.winReason,
    // The post-game review lands in REVIEW-002; until then every record is
    // base-only. Keeping the field in the index now means the read API and UI
    // do not need a schema change to start showing the status.
    postgame: 'none',
    agents: artifact.players.map((player) => {
      const model = modelFromDescriptor(player.agent)
      return {
        seat: player.seat,
        descriptor: player.agent,
        ...(model === undefined ? {} : { model }),
      }
    }),
  }
}

export function getArchiveMeta(id: string): ArchiveMeta | undefined {
  return index.get(id)
}

export function listArchiveMeta(): ArchiveMeta[] {
  return [...index.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function readArchivedGameFile(file: string): ArchivedGame {
  let value: unknown
  try {
    value = readJsonFile<unknown>(file)
  } catch (err) {
    throw new ArchiveCorruptError(file, errorMessage(err))
  }
  return validateArchivedGame(file, value)
}

function validateArchivedGame(file: string, value: unknown): ArchivedGame {
  if (!plainRecord(value)) {
    throw new ArchiveCorruptError(file, 'record must be a JSON object')
  }
  const version = value.archiveVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ArchiveCorruptError(file, 'missing or invalid archiveVersion')
  }
  if (version > ARCHIVE_VERSION) throw new ArchiveVersionError(file, version)
  if (version !== ARCHIVE_VERSION) {
    throw new ArchiveCorruptError(file, `unsupported archiveVersion ${version}`)
  }

  const artifact = value.artifact
  if (!plainRecord(artifact)) {
    throw new ArchiveCorruptError(file, 'missing artifact')
  }
  if (typeof artifact.id !== 'string' || artifact.id.length === 0) {
    throw new ArchiveCorruptError(file, 'artifact.id must be a non-empty string')
  }
  if (
    !Array.isArray(artifact.roles)
    || !Array.isArray(artifact.players)
    || typeof artifact.playerCount !== 'number'
    || typeof artifact.createdAt !== 'string'
    || typeof artifact.winReason !== 'string'
    || (artifact.winner !== 'good' && artifact.winner !== 'evil')
  ) {
    throw new ArchiveCorruptError(file, 'artifact is missing required fields')
  }

  const config = value.config
  if (
    !plainRecord(config)
    || typeof config.humanSeats !== 'number'
    || (config.fidelity !== 'public' && config.fidelity !== 'full')
    || (config.historyMode !== 'off'
      && config.historyMode !== 'digest'
      && config.historyMode !== 'full')
    || !Array.isArray(config.botTable)
  ) {
    throw new ArchiveCorruptError(file, 'config is missing required fields')
  }
  return value as unknown as ArchivedGame
}

function modelFromDescriptor(descriptor: string): string | undefined {
  if (descriptor.startsWith('llm:')) return descriptor.slice('llm:'.length)
  const marker = ':llm:'
  const at = descriptor.lastIndexOf(marker)
  return at < 0 ? undefined : descriptor.slice(at + marker.length)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
