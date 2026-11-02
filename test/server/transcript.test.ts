// test-lane: fast
// The copyable debug transcript: the pure renderer, and the HTTP route's
// fidelity policy (full reveal when final or solo-vs-bots; scoped otherwise).
import { test, before, after } from 'node:test'
import { mutable } from '../support/mutable.ts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createGame } from '../../server/engine/game.ts'
import { viewFor } from '../../server/engine/view.ts'
import { createAgent } from '../../server/agents/registry.ts'
import { heuristicDecide } from '../../server/agents/heuristic.ts'
import { runGame } from '../../server/sim/runner.ts'
import { renderTranscript, type TranscriptSeat } from '../../server/transcript.ts'
import type { PostgameRecord } from '../../server/postgame/types.ts'
import type { AvalonAgent } from '../../server/agents/types.ts'
import type { Seat, PlayerView } from '../../server/engine/types.ts'

// The new full-transcript case finishes a real HTTP game, which starts the
// post-game runner and (with the archive on) writes a record. Isolate the data
// root before server.ts resolves it at boot.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-transcript-http-'))
process.env.AVALON_DATA_DIR = path.join(root, 'data')
process.env.AVALON_GAME_ARCHIVE = 'on'
process.env.AVALON_POSTGAME = 'on'
process.env.AVALON_INVITE_CODE = ''
delete process.env.RAILWAY_VOLUME_MOUNT_PATH
const { server } = await import('../../server/server.ts')

async function finishedGame(seed = 'transcript', playerCount = 5) {
  const game = createGame({ seed, playerCount, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [p.seat, createAgent({ type: 'heuristic' }, { seed, seat: p.seat })]),
  )
  const result = await runGame({ game, agents })
  return result.game
}

function seatsFor(game: Awaited<ReturnType<typeof finishedGame>>, revealed: boolean): TranscriptSeat[] {
  return game.players.map((p) => ({
    seat: p.seat, name: p.name, agent: 'Rule-based', descriptor: 'heuristic', model: 'rule-based',
    ...(revealed ? { role: p.role, alignment: p.alignment } : {}),
  }))
}

function postgameFixture(): PostgameRecord {
  return {
    version: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    status: 'complete',
    turnOrder: [0],
    seats: {
      0: {
        seat: 0,
        kind: 'agent',
        model: 'test/model',
        status: 'complete',
        review: {
          statement: 'I would have rejected the second team.',
          summary: 'A useful summary.',
          decisions: [],
          commentary: [],
          lesson: 'Trust the vote record.',
        },
      },
      1: {
        seat: 1,
        kind: 'human',
        status: 'complete',
        note: 'My own note.',
      },
    },
  }
}

test('full-reveal transcript appends the post-game review', async () => {
  const game = await finishedGame()
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: game.phase, round: game.round, proposalNum: game.proposalNum,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, true),
    log: game.log, revealed: true, postgame: postgameFixture(),
    capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: false,
  })
  assert.match(text, /## Post-game review/)
  assert.match(text, /### Table talk/)
  assert.match(text, /1\. .*\(seat 0\): "I would have rejected the second team\."/)
  assert.match(text, /A useful summary\./)
  assert.match(text, /Trust the vote record\./)
  assert.match(text, /My own note\./)
})

test('a scoped transcript refuses to render a review even if handed one', async () => {
  const game = await finishedGame()
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: 'vote', round: 2, proposalNum: 1,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, false),
    log: viewFor(game, 0).events, revealed: false, scopedTo: 0,
    postgame: postgameFixture(),
    capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: false,
  })
  assert.doesNotMatch(text, /## Post-game review/)
  assert.doesNotMatch(text, /A useful summary\./)
})

test('full-reveal transcript exposes roles, the whole log, and the raw JSONL', async () => {
  const game = await finishedGame()
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: game.phase, round: game.round, proposalNum: game.proposalNum,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, true),
    log: game.log, winner: game.outcome?.winner, winReason: game.outcome?.reason,
    revealed: true, capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: true,
  })
  assert.match(text, /FULL REVEAL/)
  assert.match(text, new RegExp(`\\*\\*${game.outcome!.winner.toUpperCase()}\\*\\*`))
  assert.match(text, /\*\*\* (GOOD|EVIL) wins/)
  // Every seat's role appears (from the seat table) and the raw JSONL carries
  // exactly one line per logged event.
  for (const p of game.players) assert.ok(text.includes(p.role), `role ${p.role} present`)
  const jsonl = text.split('```jsonl\n')[1]!.split('\n```')[0]!.trim().split('\n')
  assert.equal(jsonl.length, game.log.length)
  assert.equal(JSON.parse(jsonl[0]!).type, 'gameCreated')
})

test('scoped transcript hides roles and other seats\' private events', async () => {
  const game = await finishedGame()
  const seat: Seat = 0
  const scopedLog = viewFor(game, seat).events
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: 'vote', round: 2, proposalNum: 1,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, false),
    log: scopedLog, revealed: false, scopedTo: seat,
    capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: true,
  })
  assert.match(text, /SCOPED/)
  assert.doesNotMatch(text, /FULL REVEAL/)
  // The scoped log only carries public events plus seat 0's own private ones,
  // so no other seat's roleDealt leaks in the raw JSONL.
  const jsonl = text.split('```jsonl\n')[1]!.split('\n```')[0]!.trim().split('\n').map((l) => JSON.parse(l))
  const foreignDeal = jsonl.some((ev) => ev.type === 'roleDealt' && ev.payload.seat !== seat)
  assert.equal(foreignDeal, false, 'no other seat roleDealt in a scoped log')
})

test('full transcript labels runner fallbacks and trace degradation separately', async () => {
  const game = await finishedGame('transcript-degradation')
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: game.phase, round: game.round, proposalNum: game.proposalNum,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, true),
    log: game.log, revealed: true,
    degraded: [],
    traceDegraded: [{
      decisionId: 'trace-1', seat: 2, kind: 'vote',
      codes: ['planner-error', 'voice-error'],
    }],
    capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: false,
  })

  assert.match(text, /runner fallbacks: 0/)
  assert.match(text, /trace-degraded decisions: 1/)
  assert.match(text, /trace-1.*planner-error, voice-error/)
  assert.doesNotMatch(text, /degraded decisions: 0/)
})

test('backticks in free-form text do not break the code fences', async () => {
  const game = await finishedGame()
  // A pitch containing a triple backtick would close a fixed ``` fence early.
  mutable(game).log.push({
    seq: game.log.length,
    type: 'utterance',
    payload: { seat: 0, text: 'try ```rm -rf``` lol', round: 1 },
    visibility: 'public',
  })
  const text = renderTranscript({
    id: game.id, seed: game.seed, playerCount: game.config.playerCount,
    phase: game.phase, round: game.round, proposalNum: game.proposalNum,
    leaderSeat: game.leaderSeat, quests: game.quests, seats: seatsFor(game, true),
    log: game.log, winner: game.outcome?.winner, winReason: game.outcome?.reason,
    revealed: true, capturedAt: '2026-07-23T00:00:00.000Z', includeRaw: true,
  })
  // The play-by-play fence must be longer than the 3-backtick run in the body,
  // and the whole document must still parse into a clean set of fenced blocks
  // (an even number of fence lines).
  assert.match(text, /````+\n/, 'fence widened past three backticks')
  const openPbp = text.indexOf('\n## Play-by-play\n')
  const pbpBlock = text.slice(openPbp)
  assert.ok(pbpBlock.includes('try ```rm -rf``` lol'), 'content survives intact')
})

// ---- HTTP route ----
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

async function newSoloGame(
  table: string[] = ['autopilot', 'autopilot', 'autopilot', 'autopilot'],
) {
  const res = await fetch(`${base}/api/game/new`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerCount: 5, table, humanName: 'Tester' }),
  })
  return res.json() as Promise<{ id: string; token: string }>
}

interface GamePayload {
  view: PlayerView
  ask: { kind: string; seat: number; round: number; proposalNum: number }[]
}

async function finishGame(id: string, token: string): Promise<void> {
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
      const { value, done } = await reader.read()
      if (done) throw new Error('stream ended before gameOver')
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split('\n').find((entry) => entry.startsWith('data: '))
        if (!line) continue
        const payload = JSON.parse(line.slice(6)) as GamePayload
        if (payload.view.phase === 'gameOver') return
        for (const req of payload.ask) {
          const key = `${req.kind}:${req.round}:${req.proposalNum}:${payload.view.events.length}`
          if (sent.has(key)) continue
          sent.add(key)
          const decided = await fetch(`${base}/api/game/${id}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              decision: heuristicDecide(
                req as Parameters<typeof heuristicDecide>[0],
                payload.view,
                'transcript-http',
              ),
            }),
          })
          if (!decided.ok) throw new Error(`decision failed: ${await decided.text()}`)
        }
      }
    }
  } finally {
    controller.abort()
  }
}

test('a finished HTTP transcript carries the post-game review section', async () => {
  const { id, token } = await newSoloGame()
  await finishGame(id, token)
  const r = await fetch(`${base}/api/game/${id}/transcript?token=${token}`)
  assert.equal(r.status, 200)
  const text = await r.text()
  assert.match(text, /## Post-game review/)
  assert.match(text, /status: \*\*complete\*\*/)
  assert.match(text, /no model to ask for a review/)
})

test('a lone human gets a mid-game FULL REVEAL transcript', async () => {
  const { id, token } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/transcript?token=${token}`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') ?? '', /text\/plain/)
  const text = await r.text()
  assert.match(text, /FULL REVEAL/) // solo table: nobody to cheat
  assert.match(text, /# Avalon debug transcript/)
  assert.match(text, /\| name \| agent \| execution \| model \| role \|/)
  assert.match(text, /\| Rule-based \| heuristic \| rule-based \|/)
})

test('HTTP transcript preserves the definition apart from its display model', async () => {
  const { id, token } = await newSoloGame([
    'probabilistic', 'autopilot', 'autopilot', 'autopilot',
  ])
  const r = await fetch(`${base}/api/game/${id}/transcript?token=${token}`)
  assert.equal(r.status, 200)
  const text = await r.text()
  assert.match(
    text,
    /\| Probabilistic \| def:probabilistic \| probabilistic \|/,
  )
})

test('/transcript rejects a wrong token mid-game', async () => {
  const { id } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/transcript?token=nope`)
  assert.equal(r.status, 403)
})
