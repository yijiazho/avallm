// test-lane: fast
// HTTP-layer tests for the game server. The engine is covered elsewhere; this
// pins the reconnect-support endpoint the client relies on after a refresh:
// GET /api/game/:id/valid — 200 for a live seat, 403 for a wrong token, 404 for
// a game the server no longer has. The client probes this (EventSource can't
// read HTTP status) to tell a real reconnect from a game that's gone.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { server } from '../../server/server.ts'
import { TABLE_ALIAS_POOL } from '../../server/table-aliases.ts'

let base: string

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

after(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// A solo game: humanSeats defaults to 1, four autopilot (rule-based, offline) bots.
async function newSoloGame(): Promise<{ id: string; token: string }> {
  const res = await fetch(`${base}/api/game/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerCount: 5,
      table: ['autopilot', 'autopilot', 'autopilot', 'autopilot'],
      humanName: 'Tester',
    }),
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.ok(data.id && data.token, 'new game returns id + token')
  return data
}

test('/valid returns 200 for the seat token that started the game', async () => {
  const { id, token } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/valid?token=${token}`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ok: true })
})

test('live DTO separates table aliases from agent and model identity', async () => {
  const { id, token } = await newSoloGame()
  const controller = new AbortController()
  const response = await fetch(`${base}/api/game/${id}/events?token=${token}`, {
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  const reader = response.body!.getReader()
  const { value } = await reader.read()
  controller.abort()
  const text = new TextDecoder().decode(value)
  const line = text.split('\n').find((entry) => entry.startsWith('data: '))
  assert.ok(line, 'SSE sends an initial game payload')
  const payload = JSON.parse(line.slice(6)) as {
    view: { seat: number; players: { seat: number; name: string }[] }
    bots: Record<number, { name: string; model: string }>
  }
  const aliasPool = new Set<string>(TABLE_ALIAS_POOL)
  const botSeats = Object.keys(payload.bots).map(Number)
  assert.equal(botSeats.length, 4)
  for (const seat of botSeats) {
    assert.equal(payload.bots[seat].name, 'Rule-based', 'agent-card name is retained')
    assert.equal(payload.bots[seat].model, 'rule-based', 'model identity is retained')
    assert.ok(aliasPool.has(payload.view.players[seat].name), 'PlayerView uses a table alias')
  }
  assert.equal(new Set(payload.view.players.map((player) => player.name.toLowerCase())).size, 5)
})

test('game-start name allocation cannot collide with an existing numeric suffix', async () => {
  const created = await fetch(`${base}/api/lobby`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Alice', playerCount: 5, humanSeats: 3,
      table: ['autopilot', 'autopilot'],
    }),
  })
  assert.equal(created.status, 200)
  const lobby = await created.json() as { lobbyId: string }
  const join = async (name: string) => {
    const response = await fetch(`${base}/api/lobby/${lobby.lobbyId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mode: 'play' }),
    })
    assert.equal(response.status, 200)
    return response.json() as Promise<{ token: string; gameId?: string }>
  }
  await join('Alice 2')
  const started = await join('alice')
  assert.ok(started.gameId)

  const controller = new AbortController()
  const events = await fetch(`${base}/api/game/${started.gameId}/events?token=${started.token}`, {
    signal: controller.signal,
  })
  const { value } = await events.body!.getReader().read()
  controller.abort()
  const line = new TextDecoder().decode(value).split('\n')
    .find((entry) => entry.startsWith('data: '))
  assert.ok(line)
  const payload = JSON.parse(line.slice(6)) as { view: { players: { name: string }[] } }
  const normalized = payload.view.players.map((player) => player.name.toLowerCase())
  assert.equal(new Set(normalized).size, 5)
  assert.ok(normalized.includes('alice'))
  assert.ok(normalized.includes('alice 2'))
  assert.ok(normalized.includes('alice 3'))
})

test('/valid returns 403 for a wrong token on a live game', async () => {
  const { id } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/valid?token=not-the-real-token`)
  assert.equal(r.status, 403)
})

test('/valid returns 403 when no token is supplied', async () => {
  const { id } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/valid`)
  assert.equal(r.status, 403)
})

test('/valid returns 404 for a game the server does not have', async () => {
  // e.g. after a server restart dropped the in-memory session.
  const r = await fetch(`${base}/api/game/deadbeef99/valid?token=whatever`)
  assert.equal(r.status, 404)
})

test('/api/agents exposes two probabilistic choices and the Rule-based label', async () => {
  const response = await fetch(`${base}/api/agents`)
  assert.equal(response.status, 200)
  const payload = await response.json() as {
    agents: {
      id: string
      name: string
      model: string
      usesModel: boolean
      suggestedModel?: string
    }[]
  }
  const byId = (id: string) => payload.agents.find((agent) => agent.id === id)
  assert.equal(byId('autopilot')?.name, 'Rule-based')
  assert.equal(byId('autopilot')?.model, 'rule-based')
  assert.equal(byId('autopilot')?.usesModel, false)
  assert.equal(byId('probabilistic')?.name, 'Probabilistic')
  assert.equal(byId('probabilistic')?.model, 'probabilistic')
  assert.equal(byId('probabilistic')?.usesModel, false)
  assert.equal(byId('probabilistic-llm')?.name, 'Probabilistic + LLM')
  assert.equal(byId('probabilistic-llm')?.usesModel, true)
  assert.equal(typeof byId('probabilistic-llm')?.suggestedModel, 'string')
})

test('/api/agents/preview renders the exact belief block only when explicitly selected', async () => {
  const preview = async (config: Record<string, unknown> = {}) => {
    const response = await fetch(`${base}/api/agents/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'servant', kind: 'discuss', ...config }),
    })
    assert.equal(response.status, 200)
    return response.json() as Promise<{ messages: { content: string }[] }>
  }
  const normal = await preview()
  const typed = await preview({
    brain: { beliefVisibility: 'compact-belief-v1' },
  })
  assert.ok(normal.messages.every((message) =>
    !message.content.includes('EXACT BELIEF SUMMARY')))
  assert.ok(typed.messages.some((message) =>
    message.content.includes('EXACT BELIEF SUMMARY')))

  const invalid = await fetch(`${base}/api/agents/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'servant',
      kind: 'discuss',
      brain: { beliefVisibility: 'not-a-visibility' },
    }),
  })
  assert.equal(invalid.status, 400)
  assert.match(
    String((await invalid.json() as { error?: string }).error),
    /beliefVisibility must be one of/,
  )
})
