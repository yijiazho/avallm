// test-lane: fast
// REVIEW-003 HTTP surface: the review is public only after gameOver, only a
// seated human may write a note, and the note is trimmed, capped, durable in
// the archive, and visible again on a fresh read.
//
// The data root and archive directory are isolated before server.ts is
// imported. That module resolves both once at boot, so these dynamic imports
// are deliberate.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { DecisionRequest, PlayerView } from '../../server/engine/types.ts'
import type { PostgameRecord } from '../../server/postgame/types.ts'

interface ReviewPayload {
  postgame?: PostgameRecord
  canReview: boolean
  rev: number
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-review-http-'))
const dataDir = path.join(root, 'data')
const gamesDir = path.join(dataDir, 'games')

process.env.AVALON_DATA_DIR = dataDir
process.env.AVALON_GAME_ARCHIVE = 'on'
process.env.AVALON_POSTGAME = 'on'
process.env.AVALON_INVITE_CODE = ''
delete process.env.RAILWAY_VOLUME_MOUNT_PATH

const { server } = await import('../../server/server.ts')
const { heuristicDecide } = await import('../../server/agents/heuristic.ts')
const { loadArchive } = await import('../../server/archive/store.ts')

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
      humanName: 'Reviewer',
    }),
  })
  assert.equal(response.status, 200)
  const data = await response.json() as { id: string; token: string }
  assert.ok(data.id && data.token)
  return data
}

/** A lobby game with a human host and a second spectator token for that game. */
async function newHumanGameWithSpectator(): Promise<{
  id: string
  token: string
  spectator: string
}> {
  const lobby = await fetch(`${base}/api/lobby`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Host', playerCount: 5, humanSeats: 1,
      table: ['autopilot', 'autopilot', 'autopilot', 'autopilot'],
    }),
  })
  assert.equal(lobby.status, 200)
  const data = await lobby.json() as { lobbyId: string; token: string; gameId?: string }
  assert.ok(data.gameId, 'humanSeats=1 starts immediately')
  const joined = await fetch(`${base}/api/lobby/${data.lobbyId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Watcher', mode: 'spectate' }),
  })
  assert.equal(joined.status, 200)
  return {
    id: data.gameId,
    token: data.token,
    spectator: (await joined.json() as { token: string }).token,
  }
}

interface GamePayload {
  view: PlayerView
  ask: DecisionRequest[]
  postgame?: { status: string; completed: number; total: number; rev: number }
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

/** Drive the human seat with the heuristic and return the gameOver SSE frame. */
async function finishGame(id: string, token: string): Promise<GamePayload> {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/game/${id}/events?token=${token}`, {
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const sent = new Set<string>()
  let final: GamePayload | undefined
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
        if (payload.view.phase === 'gameOver') {
          final = payload
          continue
        }
        for (const req of payload.ask) {
          const key = `${req.kind}:${req.round}:${req.proposalNum}:${payload.view.events.length}`
          if (sent.has(key)) continue
          sent.add(key)
          const decision = heuristicDecide(req, payload.view, 'review-http')
          const decided = await fetch(`${base}/api/game/${id}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, decision }),
          })
          if (!decided.ok) throw new Error(`decision failed: ${await decided.text()}`)
        }
      }
      // The postgame record is created synchronously with the gameOver
      // broadcast, so the frame that ends the game already carries it.
      if (final) return final
    }
  } finally {
    controller.abort()
  }
}

async function review(id: string, token?: string): Promise<Response> {
  const query = token === undefined ? '' : `?token=${encodeURIComponent(token)}`
  return fetch(`${base}/api/game/${id}/review${query}`)
}

async function postNote(id: string, token: string, text: string): Promise<Response> {
  return fetch(`${base}/api/game/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, text }),
  })
}

interface ArchivedReview {
  artifact: { id: string }
  postgame?: PostgameRecord
}

function archivedReviews(): ArchivedReview[] {
  if (!fs.existsSync(gamesDir)) return []
  return fs.readdirSync(gamesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(
      fs.readFileSync(path.join(gamesDir, name), 'utf8'),
    ) as ArchivedReview)
}

test('GET review is 404 for an unknown game and 403 mid-game', async () => {
  assert.equal((await review('deadbeef99')).status, 404)
  const { id, token } = await newSoloGame()
  assert.equal((await review(id, token)).status, 403)
})

test('GET review is public after the game and canReview needs a seated human', async () => {
  const { id, token, spectator } = await newHumanGameWithSpectator()
  await finishGame(id, token)

  const seated = await review(id, token)
  assert.equal(seated.status, 200)
  const payload = await seated.json() as ReviewPayload
  assert.equal(payload.canReview, true)
  assert.equal(payload.rev > 0, true)
  assert.ok(payload.postgame)
  assert.equal(payload.postgame!.status, 'complete')
  assert.equal(Object.keys(payload.postgame!.seats).length, 5)
  // The human's optional note is still pending without keeping the review running.
  const human = Object.values(payload.postgame!.seats).find((seat) => seat.kind === 'human')
  assert.ok(human)
  assert.equal(human.status, 'pending')

  const watcher = await review(id, spectator)
  assert.equal(watcher.status, 200)
  assert.equal((await watcher.json() as ReviewPayload).canReview, false)
  const anonymous = await review(id)
  assert.equal((await anonymous.json() as ReviewPayload).canReview, false)
})

test('POST stores a trimmed note for a seated human and a refresh reads it back', async () => {
  const { id, token } = await newSoloGame()
  await finishGame(id, token)

  const saved = await postNote(id, token, '  I should have rejected the second team.  ')
  assert.equal(saved.status, 200)
  const body = await saved.json() as { ok: boolean; seat: number; note: string }
  assert.equal(body.ok, true)
  assert.equal(body.note, 'I should have rejected the second team.')

  const again = await review(id, token)
  assert.equal(again.status, 200)
  const payload = await again.json() as { postgame?: PostgameRecord }
  assert.equal(payload.postgame!.seats[body.seat]!.note, body.note)
  assert.equal(payload.postgame!.seats[body.seat]!.status, 'complete')
  assert.equal(payload.postgame!.seats[body.seat]!.kind, 'human')

  // The durable record carries the note too, so a restart can surface it. The
  // archive is keyed by the engine game id, which is not the session URL id.
  const archived = archivedReviews().find(
    (record) => record.postgame?.seats[body.seat]?.note === body.note,
  )
  assert.ok(archived)
  const scan = loadArchive()
  assert.ok(scan.metas.some(
    (meta) => meta.id === archived.artifact.id && meta.postgame === 'complete',
  ))
})

test('POST rejects empty and over-cap notes with 400', async () => {
  const { id, token } = await newSoloGame()
  await finishGame(id, token)
  for (const text of ['   ', '', 'x'.repeat(2001)]) {
    const response = await postNote(id, token, text)
    assert.equal(response.status, 400)
  }
})

test('POST rejects spectators and unknown tokens after the game', async () => {
  const { id, token, spectator } = await newHumanGameWithSpectator()
  await finishGame(id, token)
  assert.equal((await postNote(id, spectator, 'hello')).status, 403)
  assert.equal((await postNote(id, 'not-a-token', 'hello')).status, 403)
})

test('POST rejects a running game with 409 for a seated human', async () => {
  const { id, token } = await newSoloGame()
  // The game has not been driven to gameOver.
  assert.equal((await postNote(id, token, 'hello')).status, 409)
})

test('a note survives an archive re-read after the game is over', async () => {
  const { id, token } = await newSoloGame()
  await finishGame(id, token)
  const saved = await postNote(id, token, 'The third quest was the tell.')
  assert.equal(saved.status, 200)
  const body = await saved.json() as { seat: number; note: string }

  const archived = archivedReviews().find(
    (record) => record.postgame?.seats[body.seat]?.note === body.note,
  )
  assert.ok(archived)
  const scan = loadArchive()
  assert.ok(scan.metas.some(
    (meta) => meta.id === archived.artifact.id && meta.postgame === 'complete',
  ))
})
