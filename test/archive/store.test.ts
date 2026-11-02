// test-lane: fast
// The durable archive record: round-trip, idempotence, a tolerant boot scan,
// and the metadata index. Engine games run headless through the heuristic
// agent, so this file never touches HTTP or a model.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAgent } from '../../server/agents/registry.ts'
import {
  ArchiveCorruptError,
  ArchiveVersionError,
  archiveDir,
  archiveFile,
  archiveMeta,
  getArchiveMeta,
  listArchiveMeta,
  loadArchive,
  readArchivedGame,
  toArchivedGame,
  useArchiveDir,
  writeArchivedGame,
} from '../../server/archive/store.ts'
import type { ArchivedGame } from '../../server/archive/types.ts'
import { createGame } from '../../server/engine/game.ts'
import { ARTIFACT_SCHEMA } from '../../server/eval/core/artifact.ts'
import type { Game, Seat } from '../../server/engine/types.ts'
import { runGame } from '../../server/sim/runner.ts'
import type { AvalonAgent } from '../../server/agents/types.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-archive-store-'))

after(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

async function finishedFixture(seed = 'archive-store'): Promise<Game> {
  const game = createGame({
    seed,
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      createAgent({ type: 'heuristic' }, { seed, seat: player.seat }),
    ]),
  )
  return (await runGame({ game, agents })).game
}

function recordFor(game: Game): ArchivedGame {
  return toArchivedGame(game, {
    // Mixed descriptors exercise the index's model extraction without needing
    // a real LLM: the artifact only stores the per-seat descriptor string.
    agents: ['human', 'llm:openrouter/alpha', 'def:reader:llm:beta/gamma', 'heuristic', 'heuristic'],
    degraded: [],
    steps: game.log.length,
    config: {
      humanSeats: 1,
      fidelity: 'full',
      historyMode: 'off',
      botTable: game.players.slice(1).map((player) => ({ agent: `bot-${player.seat}` })),
    },
  })
}

function tempDir(name: string): string {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

test('one finished game round-trips as one full archive record', async () => {
  const game = await finishedFixture('archive-roundtrip')
  const dir = tempDir('roundtrip')
  useArchiveDir(dir)

  const meta = writeArchivedGame(recordFor(game))
  const file = archiveFile(game.id)
  assert.equal(file, path.join(dir, `${game.id}.json`))
  assert.equal(fs.existsSync(file), true)
  assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith('.json')).length, 1)

  const read = readArchivedGame(game.id)
  assert.ok(read)
  assert.equal(read.archiveVersion, 1)
  assert.equal(read.artifact.id, game.id)
  assert.equal(read.artifact.schema, ARTIFACT_SCHEMA)
  assert.deepEqual(read.artifact.log, game.log)
  assert.equal(read.artifact.log.length, game.log.length)
  assert.deepEqual(read.artifact.roles, game.config.roles)
  assert.equal(read.artifact.winner, game.outcome!.winner)
  assert.equal(read.artifact.winReason, game.outcome!.reason)
  assert.deepEqual(read.config, {
    humanSeats: 1,
    fidelity: 'full',
    historyMode: 'off',
    botTable: game.players.slice(1).map((player) => ({ agent: `bot-${player.seat}` })),
  })
  assert.deepEqual(
    read.artifact.players.map((player) => player.agent),
    ['human', 'llm:openrouter/alpha', 'def:reader:llm:beta/gamma', 'heuristic', 'heuristic'],
  )
  assert.equal(meta.id, game.id)
})

test('writing the same game twice is a no-op tracked by game id', async () => {
  const game = await finishedFixture('archive-idempotent')
  const dir = tempDir('idempotent')
  const record = recordFor(game)
  useArchiveDir(dir)
  writeArchivedGame(record)

  const file = archiveFile(game.id)
  const sentinel = new Date(1_000_000)
  fs.utimesSync(file, sentinel, sentinel)

  // Clear the in-memory cache but keep the same directory: the store must still
  // notice the file on disk rather than rewrite it.
  useArchiveDir(dir)
  writeArchivedGame(record)

  assert.equal(fs.statSync(file).mtimeMs, 1_000_000)
  assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith('.json')).length, 1)
  assert.equal(listArchiveMeta().length, 1)
})

test('the index exposes metadata without reading the full log', async () => {
  const game = await finishedFixture('archive-index')
  const dir = tempDir('index')
  useArchiveDir(dir)
  const record = recordFor(game)
  writeArchivedGame(record)

  const scan = loadArchive()
  assert.equal(scan.problems.length, 0)
  assert.equal(scan.metas.length, 1)

  const meta = getArchiveMeta(game.id)
  assert.ok(meta)
  assert.equal(meta.id, game.id)
  assert.equal(meta.createdAt, record.artifact.createdAt)
  assert.equal(meta.playerCount, 5)
  assert.deepEqual(meta.roles, game.config.roles)
  assert.equal(meta.winner, game.outcome!.winner)
  assert.equal(meta.winReason, game.outcome!.reason)
  assert.equal(meta.postgame, 'none')
  assert.deepEqual(meta.agents, [
    { seat: 0, descriptor: 'human' },
    { seat: 1, descriptor: 'llm:openrouter/alpha', model: 'openrouter/alpha' },
    { seat: 2, descriptor: 'def:reader:llm:beta/gamma', model: 'beta/gamma' },
    { seat: 3, descriptor: 'heuristic' },
    { seat: 4, descriptor: 'heuristic' },
  ])
  assert.deepEqual(listArchiveMeta(), [meta])
})

test('a corrupt file is reported and skipped while the rest of the archive loads', async () => {
  const game = await finishedFixture('archive-corrupt')
  const dir = tempDir('corrupt')
  useArchiveDir(dir)
  writeArchivedGame(recordFor(game))
  fs.writeFileSync(path.join(dir, 'broken.json'), '{')

  const scan = loadArchive()
  assert.equal(scan.metas.length, 1)
  assert.equal(scan.metas[0]!.id, game.id)
  assert.equal(scan.problems.length, 1)
  assert.match(scan.problems[0]!.file, /broken\.json$/)
  assert.match(scan.problems[0]!.reason, /not valid JSON|ArchiveCorruptError/)

  assert.throws(
    () => readArchivedGame('broken'),
    (err: unknown) => err instanceof ArchiveCorruptError && err.name === 'ArchiveCorruptError',
  )
})

test('a newer archive version is refused for that file only', async () => {
  const game = await finishedFixture('archive-version')
  const dir = tempDir('version')
  useArchiveDir(dir)
  const record = recordFor(game)
  writeArchivedGame(record)
  fs.writeFileSync(
    path.join(dir, 'future.json'),
    JSON.stringify({ ...record, archiveVersion: 2, artifact: { ...record.artifact, id: 'future' } }),
  )

  const scan = loadArchive()
  assert.equal(scan.metas.length, 1)
  assert.equal(scan.metas[0]!.id, game.id)
  assert.equal(scan.problems.length, 1)
  assert.match(scan.problems[0]!.reason, /newer than this server understands/)
  assert.throws(
    () => readArchivedGame('future'),
    (err: unknown) => err instanceof ArchiveVersionError && err.version === 2,
  )
})

test('boot scan is read-only and skips atomic temp files', () => {
  const dir = path.join(root, 'absent', 'games')
  useArchiveDir(dir)
  const scan = loadArchive()
  assert.deepEqual(scan, { metas: [], problems: [] })
  assert.equal(fs.existsSync(dir), false)

  const existing = tempDir('temp-files')
  fs.mkdirSync(existing, { recursive: true })
  useArchiveDir(existing)
  fs.writeFileSync(path.join(existing, 'record.tmp-42.json'), '{')
  fs.writeFileSync(path.join(existing, 'ignore.txt'), '{')
  const second = loadArchive()
  assert.deepEqual(second, { metas: [], problems: [] })
})

test('a write failure throws a named error and a caller can swallow it', async () => {
  const game = await finishedFixture('archive-write-failure')
  const blocked = path.join(root, 'blocked')
  fs.writeFileSync(blocked, 'not a directory')
  useArchiveDir(blocked)

  const record = recordFor(game)
  assert.throws(() => writeArchivedGame(record), /could not write/)

  // Mirrors saveArtifact: bookkeeping failures are warned, never thrown out.
  let warning = ''
  try {
    writeArchivedGame(record)
  } catch (err) {
    warning = (err as Error).message
  }
  assert.match(warning, /could not write/)
  assert.equal(archiveDir(), blocked)
})

test('archiveMeta does not depend on a cached index entry', async () => {
  const game = await finishedFixture('archive-meta-pure')
  const record = recordFor(game)
  const meta = archiveMeta(record)
  assert.equal(meta.id, game.id)
  assert.equal(meta.agents.length, game.config.playerCount)
})

test('boot scan settles an interrupted review without spending money', async () => {
  const game = await finishedFixture('archive-postgame-running')
  const dir = tempDir('postgame-running')
  useArchiveDir(dir)

  const record = recordFor(game)
  record.postgame = {
    version: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 'running',
    seats: {
      0: { seat: 0, kind: 'agent', model: 'test/model', status: 'complete' },
      1: { seat: 1, kind: 'agent', model: 'test/model', status: 'running' },
      2: { seat: 2, kind: 'human', status: 'pending' },
      3: { seat: 3, kind: 'agent', status: 'unavailable' },
      4: { seat: 4, kind: 'agent', status: 'unavailable' },
    },
  }
  writeArchivedGame(record)

  const scan = loadArchive()
  assert.deepEqual(scan.problems, [])
  const meta = getArchiveMeta(game.id)
  assert.equal(meta?.postgame, 'partial')
  const read = readArchivedGame(game.id)
  assert.equal(read?.postgame?.status, 'partial')
  assert.ok(read?.postgame?.completedAt)
  assert.equal(read?.postgame?.seats[1]?.status, 'failed')
  assert.match(read?.postgame?.seats[1]?.error ?? '', /interrupted/)
  assert.equal(read?.postgame?.seats[2]?.status, 'pending')
})
