// test-lane: fast
// HTTP-level archive wiring: the two post-game sinks (per-game archive and the
// optional AVALON_ARTIFACTS JSONL corpus), the opt-out switch, and the promise
// that a bookkeeping failure can never take down a finished game.
//
// The archive directory and the data root are isolated before server/server.ts
// is imported. That module resolves both once at boot, so a static import would
// race this setup; the dynamic imports below are deliberate.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { DecisionRequest, PlayerView } from '../../server/engine/types.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-archive-http-'))
const dataDir = path.join(root, 'data')
const gamesDir = path.join(dataDir, 'games')
const artifactFile = path.join(root, 'artifacts.jsonl')

process.env.AVALON_DATA_DIR = dataDir
process.env.AVALON_ARTIFACTS = artifactFile
process.env.AVALON_INVITE_CODE = ''
delete process.env.AVALON_GAME_ARCHIVE
delete process.env.RAILWAY_VOLUME_MOUNT_PATH

const { server } = await import('../../server/server.ts')
const { heuristicDecide } = await import('../../server/agents/heuristic.ts')

let base: string

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
})

async function newSoloGame(): Promise<{ id: string; token: string }> {
  const response = await fetch(`${base}/api/game/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerCount: 5,
      table: ['autopilot', 'autopilot', 'autopilot', 'autopilot'],
      humanName: 'Archivist',
    }),
  })
  assert.equal(response.status, 200)
  const data = await response.json() as { id: string; token: string }
  assert.ok(data.id && data.token)
  return data
}

interface GamePayload {
  view: PlayerView
  ask: DecisionRequest[]
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('timed out waiting for the game stream')),
          20_000,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Plays the human seat with the same heuristic the autopilot uses, so the game
// finishes quickly without a model call. The SSE payload is the only live state
// the client gets, and it is exactly what a browser has to act on.
async function finishGame(id: string, token: string): Promise<void> {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/game/${id}/events?token=${token}`, {
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const sent = new Set<string>()
  try {
    for (;;) {
      const { value, done } = await readWithTimeout(reader)
      if (done) throw new Error('game stream ended before gameOver')
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame
          .split('\n')
          .find((entry) => entry.startsWith('data: '))
        if (!line) continue
        const payload = JSON.parse(line.slice(6)) as GamePayload
        if (payload.view.phase === 'gameOver') return
        for (const req of payload.ask) {
          const key = `${req.kind}:${req.round}:${req.proposalNum}:${payload.view.events.length}`
          if (sent.has(key)) continue
          sent.add(key)
          const decision = heuristicDecide(req, payload.view, 'archive-http')
          const decided = await fetch(`${base}/api/game/${id}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, decision }),
          })
          if (!decided.ok) {
            throw new Error(`decision failed: ${await decided.text()}`)
          }
        }
      }
    }
  } finally {
    controller.abort()
  }
}

async function revealIsPlayable(id: string): Promise<void> {
  const response = await fetch(`${base}/api/game/${id}/reveal`)
  assert.equal(response.status, 200)
  const payload = await response.json() as { log: unknown[]; players: unknown[] }
  assert.ok(payload.log.length > 0)
  assert.equal(payload.players.length, 5)
}

test('boot scan does not create the archive directory', () => {
  assert.equal(fs.existsSync(gamesDir), false)
})

test('AVALON_GAME_ARCHIVE=off writes no record and leaves the game playable', async () => {
  process.env.AVALON_GAME_ARCHIVE = 'off'
  const { id, token } = await newSoloGame()
  await finishGame(id, token)
  await revealIsPlayable(id)

  assert.equal(fs.existsSync(gamesDir), false)
})

test('both sinks receive one record with the same id, roles, and winner', async () => {
  process.env.AVALON_GAME_ARCHIVE = 'on'
  fs.rmSync(artifactFile, { force: true })
  fs.rmSync(gamesDir, { recursive: true, force: true })

  const { id, token } = await newSoloGame()
  await finishGame(id, token)
  await revealIsPlayable(id)

  const jsonl = fs.readFileSync(artifactFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
  assert.equal(jsonl.length, 1, 'one finished game appends one JSONL line')
  const artifact = JSON.parse(jsonl[0]!) as {
    id: string
    roles: string[]
    winner: string
    log: unknown[]
  }

  const files = fs.readdirSync(gamesDir).filter((name) => name.endsWith('.json'))
  assert.equal(files.length, 1, 'one finished game writes one archive file')
  const record = JSON.parse(
    fs.readFileSync(path.join(gamesDir, files[0]!), 'utf8'),
  ) as {
    archiveVersion: number
    artifact: typeof artifact
    config: { humanSeats: number; botTable: unknown[]; fidelity: string; historyMode: string }
  }

  assert.equal(files[0], `${artifact.id}.json`)
  assert.equal(record.archiveVersion, 1)
  assert.deepEqual(record.artifact, artifact, 'both sinks carry the same artifact')
  assert.equal(record.artifact.id, artifact.id)
  assert.deepEqual(record.artifact.roles, artifact.roles)
  assert.equal(record.artifact.winner, artifact.winner)
  assert.equal(record.artifact.log.length, artifact.log.length)
  assert.equal(record.config.humanSeats, 1)
  assert.equal(record.config.botTable.length, 4)
  assert.equal(record.config.fidelity, 'full')
  assert.equal(record.config.historyMode, 'off')
})

test('a failed archive write is warned and swallowed while the game still finishes', async () => {
  process.env.AVALON_GAME_ARCHIVE = 'on'
  fs.rmSync(artifactFile, { force: true })
  fs.rmSync(gamesDir, { recursive: true, force: true })
  // A file where the archive directory belongs makes mkdir fail on every write.
  fs.mkdirSync(path.dirname(gamesDir), { recursive: true })
  fs.writeFileSync(gamesDir, 'not a directory')

  const { id, token } = await newSoloGame()
  await finishGame(id, token)
  await revealIsPlayable(id)

  // The other sink still wrote its line: one sink failing must not skip the
  // other, and the finished game remains fully readable from memory.
  const lines = fs.readFileSync(artifactFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
  assert.equal(lines.length, 1)
})
