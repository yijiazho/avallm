// test-lane: fast
// REVIEW-002's live wire contract: the game payload carries only the review
// status, counts, and a revision, never model prose. The off switch performs no
// runner work, and a human can still keep a note in a minimal record.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { DecisionRequest, PlayerView } from '../../server/engine/types.ts'
import type { PostgameRecord } from '../../server/postgame/types.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-postgame-status-'))
const dataDir = path.join(root, 'data')
process.env.AVALON_DATA_DIR = dataDir
process.env.AVALON_GAME_ARCHIVE = 'on'
process.env.AVALON_INVITE_CODE = ''
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
  delete process.env.AVALON_POSTGAME
})

interface GamePayload {
  view: PlayerView
  ask: DecisionRequest[]
  postgame?: Record<string, unknown>
}

async function newSoloGame(): Promise<{ id: string; token: string }> {
  const response = await fetch(`${base}/api/game/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerCount: 5,
      table: ['autopilot', 'autopilot', 'autopilot', 'autopilot'],
      humanName: 'Status',
    }),
  })
  assert.equal(response.status, 200)
  return response.json() as Promise<{ id: string; token: string }>
}

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('timed out waiting for the game stream')),
        20_000,
      )
    }),
  ]).finally(() => { if (timer) clearTimeout(timer) })
}

async function finishGame(id: string, token: string): Promise<GamePayload> {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/game/${id}/events?token=${token}`, {
    signal: controller.signal,
  })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const sent = new Set<string>()
  try {
    for (;;) {
      const { value, done } = await readWithTimeout(reader)
      if (done) throw new Error('stream ended before gameOver')
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split('\n').find((entry) => entry.startsWith('data: '))
        if (!line) continue
        const payload = JSON.parse(line.slice(6)) as GamePayload
        if (payload.view.phase === 'gameOver') return payload
        for (const req of payload.ask) {
          const key = `${req.kind}:${req.round}:${req.proposalNum}:${payload.view.events.length}`
          if (sent.has(key)) continue
          sent.add(key)
          const decided = await fetch(`${base}/api/game/${id}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, decision: heuristicDecide(req, payload.view, 'status') }),
          })
          if (!decided.ok) throw new Error(`decision failed: ${await decided.text()}`)
        }
      }
    }
  } finally {
    controller.abort()
  }
}

async function skipHumanTalk(id: string, token: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const response = await fetch(`${base}/api/game/${id}/review?token=${token}`)
    if (response.ok) {
      const payload = await response.json() as {
        postgame?: { phase?: string; status?: string }
      }
      if (payload.postgame?.phase === 'talk') {
        assert.equal(payload.postgame.status, 'running')
        const skipped = await fetch(`${base}/api/game/${id}/talk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, skip: true }),
        })
        assert.equal(skipped.status, 200)
        for (let j = 0; j < 100; j++) {
          const after = await fetch(`${base}/api/game/${id}/review?token=${token}`)
          if (after.ok) {
            const state = await after.json() as { postgame?: { phase?: string } }
            if (state.postgame?.phase === 'review') return
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error('postgame never reached the review phase after skip')
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('postgame never entered the talk phase')
}

test('the game payload carries status counts and a revision, never prose', async () => {
  process.env.AVALON_POSTGAME = 'on'
  const { id, token } = await newSoloGame()
  await finishGame(id, token)
  await skipHumanTalk(id, token)

  // Read a fresh initial SSE frame. The frame broadcast from the decide POST
  // can precede saveArtifact/runPostgame, so the first gameOver frame is not a
  // stable place to observe the review status.
  const controller = new AbortController()
  const events = await fetch(`${base}/api/game/${id}/events?token=${token}`, {
    signal: controller.signal,
  })
  const { value } = await events.body!.getReader().read()
  controller.abort()
  const line = new TextDecoder().decode(value)
    .split('\n')
    .find((entry) => entry.startsWith('data: '))
  assert.ok(line)
  const payload = JSON.parse(line.slice(6)) as GamePayload
  assert.ok(payload.postgame)
  assert.deepEqual(Object.keys(payload.postgame!).sort(), ['completed', 'rev', 'status', 'total'])
  assert.equal(payload.postgame!.status, 'complete')
  assert.equal(payload.postgame!.total, 5)
  assert.equal(typeof payload.postgame!.completed, 'number')
  assert.equal(typeof payload.postgame!.rev, 'number')
  const wire = JSON.stringify(payload.postgame)
  assert.doesNotMatch(wire, /summary|lesson|assessment/)
})

test('AVALON_POSTGAME=off starts no review but a human note still survives', async () => {
  process.env.AVALON_POSTGAME = 'off'
  const { id, token } = await newSoloGame()
  const final = await finishGame(id, token)
  assert.equal(final.postgame, undefined)

  const before = await fetch(`${base}/api/game/${id}/review?token=${token}`)
  assert.equal(before.status, 200)
  const empty = await before.json() as {
    postgame?: PostgameRecord
    canReview: boolean
    rev: number
  }
  assert.equal(empty.postgame, undefined)
  assert.equal(empty.canReview, true)
  assert.equal(empty.rev, 0)

  const saved = await fetch(`${base}/api/game/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, text: 'Worth keeping.' }),
  })
  assert.equal(saved.status, 200)
  const savedBody = await saved.json() as { seat: number; note: string }

  const after = await fetch(`${base}/api/game/${id}/review?token=${token}`)
  const payload = await after.json() as { postgame?: PostgameRecord }
  assert.equal(payload.postgame?.status, 'complete')
  // A minimal record keeps the note without inventing reviews for bot seats.
  assert.deepEqual(Object.keys(payload.postgame!.seats), [String(savedBody.seat)])
  assert.equal(payload.postgame!.seats[savedBody.seat]!.note, savedBody.note)
  assert.equal(payload.postgame!.seats[savedBody.seat]!.kind, 'human')
})
