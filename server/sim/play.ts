// Interactive CLI play: you at seat 0, heuristic bots elsewhere.
//   node server/sim/play.ts --players 7 --seed mygame
// Milestone-1 exit criterion: a human can play a full game against heuristics.

import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline'
import { createGame } from '../engine/game.ts'
import { hasDistinctSeats, teamsEqual } from '../engine/seatset.ts'
import { evilPartnersOf, knownEvilOf, merlinCandidatesOf } from '../engine/knowledge.ts'
import { eventVisibleTo } from '../engine/view.ts'
import { createHeuristicAgent } from '../agents/heuristic.ts'
import { runGame } from './runner.ts'
import { renderEvent, revealRoles } from './render.ts'
import type { AvalonAgent } from '../agents/types.ts'
import type { Decision, DecisionRequest, PlayerView, Seat } from '../engine/types.ts'
import { tableAliases } from '../table-aliases.ts'

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '7' },
    seed: { type: 'string', default: `play-${Math.floor(Math.random() * 1e9)}` },
  },
})

const playerCount = Number(values.players)
const HUMAN: Seat = 0

// Line-queue instead of rl.question: readline drops lines that arrive while
// no question is pending, which breaks scripted/piped play (the smoke test).
const rl = createInterface({ input: process.stdin })
const lineQueue: string[] = []
const waiters: ((s: string) => void)[] = []
let stdinClosed = false
rl.on('line', (raw) => {
  const line = raw.replace(/^﻿/, '').replace(/\r$/, '')
  const w = waiters.shift()
  if (w) w(line)
  else lineQueue.push(line)
})
rl.on('close', () => {
  stdinClosed = true
  for (const w of waiters.splice(0)) w('')
})
function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt)
  const queued = lineQueue.shift()
  if (queued !== undefined) {
    process.stdout.write(queued + '\n')
    return Promise.resolve(queued)
  }
  if (stdinClosed) throw new Error('stdin closed before the game finished')
  return new Promise((resolve) => waiters.push(resolve))
}

const names = ['Human', ...tableAliases(values.seed!, playerCount - 1, ['Human'])]

const game = createGame({
  seed: values.seed!, playerCount, names,
  talk: { maxRounds: 1, maxRoundsAfterChange: 1 },
})

// Parse a human-typed seat list into a validated team, or null on any bad
// input: wrong count, a non-integer/out-of-range seat, or a repeated seat.
// Propose and finalize share this so the parse-validate rules live in one place.
function parseTeam(raw: string, size: number): Seat[] | null {
  const team = raw.split(/[\s,]+/).filter(Boolean).map(Number)
  if (team.length !== size) return null
  if (!team.every((s) => Number.isInteger(s) && s >= 0 && s < playerCount)) return null
  if (!hasDistinctSeats(team)) return null
  return team
}

function questBoard(view: PlayerView): string {
  const discs = view.quests.map((q) => {
    if (q.status === 'complete') return ` [${q.teamSize}${q.result === 'success' ? '✓' : '✗'}]`
    return ` [${q.teamSize}${q.failsRequired === 2 ? '*' : ' '}]`
  }).join('')
  return `Quests:${discs}   proposal ${view.proposalNum}/5`
}

async function askHuman(req: DecisionRequest, view: PlayerView): Promise<Decision> {
  console.log('\n--- ' + questBoard(view))
  switch (req.kind) {
    case 'discuss': {
      const say = await ask('Your table talk (enter to pass): ')
      return { kind: 'discuss', say }
    }
    case 'propose': {
      const size = view.quests[view.round - 1]!.teamSize
      const roster = view.players.map((p) => `${p.seat}=${p.name}`).join(' ')
      while (true) {
        const raw = await ask(`You lead. Pick ${size} seats (${roster}), comma-separated: `)
        const team = parseTeam(raw, size)
        if (team) return { kind: 'propose', team }
        console.log(`Need exactly ${size} distinct valid seats.`)
      }
    }
    case 'finalize': {
      const current = view.currentTeam ?? []
      const size = view.quests[view.round - 1]!.teamSize
      const teamLabel = current.map((s) => view.players[s]!.name).join(', ')
      const raw = (await ask(`Your team [${teamLabel}]. Enter to lock it in, or type a new comma-separated team: `)).trim()
      if (!raw) return { kind: 'finalize', stick: true }
      let input = raw
      while (true) {
        const team = parseTeam(input, size)
        if (team && !teamsEqual(team, current)) {
          const reason = await ask('One sentence to the table on why you changed: ')
          return { kind: 'finalize', stick: false, team, reason }
        }
        const retry = (await ask(`Need ${size} distinct valid seats, different from the current team (enter to lock instead): `)).trim()
        if (!retry) return { kind: 'finalize', stick: true }
        input = retry
      }
    }
    case 'vote': {
      const current = view.currentTeam ?? []
      const teamLabel = current.map((s) => view.players[s]!.name).join(', ')
      while (true) {
        const raw = (await ask(`Vote on [${teamLabel}] (a=approve, r=reject): `)).trim().toLowerCase()
        if (raw.startsWith('a')) return { kind: 'vote', vote: 'approve' }
        if (raw.startsWith('r')) return { kind: 'vote', vote: 'reject' }
      }
    }
    case 'quest': {
      if (view.alignment === 'good') {
        console.log('You are on the quest. Good must play Success, so Success is played for you.')
        return { kind: 'quest', card: 'success' }
      }
      while (true) {
        const raw = (await ask('Quest card (s=success, f=fail): ')).trim().toLowerCase()
        if (raw.startsWith('s')) return { kind: 'quest', card: 'success' }
        if (raw.startsWith('f')) return { kind: 'quest', card: 'fail' }
      }
    }
    case 'assassinate': {
      const roster = view.players.filter((p) => p.seat !== view.seat)
        .map((p) => `${p.seat}=${p.name}`).join(' ')
      while (true) {
        const raw = await ask(`ASSASSINATE. Who is Merlin? (${roster}): `)
        const target = Number(raw.trim())
        if (Number.isInteger(target) && target >= 0 && target < playerCount && target !== view.seat) {
          return { kind: 'assassinate', target }
        }
      }
    }
  }
}

const humanAgent: AvalonAgent = {
  decide: async (req, view) => ({ decision: await askHuman(req, view) }),
}
const agents = new Map<Seat, AvalonAgent>(
  game.players.map((p) => [
    p.seat,
    p.seat === HUMAN ? humanAgent : createHeuristicAgent({ seed: game.seed, seat: p.seat }),
  ]),
)

// Role card.
{
  const me = game.players[HUMAN]!
  console.log(`\nYou are ${me.role.toUpperCase()} (${me.alignment}).`)
  const knowledge = game.log.find((ev) => ev.type === 'knowledge' && ev.payload.seat === HUMAN)
  const info = knowledge?.type === 'knowledge' ? knowledge.payload : { kind: 'none' as const }
  const label = (seats: readonly Seat[]) => seats.map((s) => `${names[s]}(${s})`).join(', ')
  const knownEvil = knownEvilOf(info)
  const evilPartners = evilPartnersOf(info)
  const merlinCandidates = merlinCandidatesOf(info)
  if (knownEvil.length) console.log(`You see evil: ${label(knownEvil)}`)
  if (evilPartners.length) console.log(`Your fellow evil: ${label(evilPartners)}`)
  if (merlinCandidates.length) console.log(`Merlin is one of: ${label(merlinCandidates)}`)
}

const result = await runGame({
  game, agents,
  onEvent: (ev) => {
    if (!eventVisibleTo(ev, HUMAN)) return
    if (ev.type === 'roleDealt' || ev.type === 'knowledge' || ev.type === 'voteCast' || ev.type === 'questCard') return
    const line = renderEvent(ev, game)
    if (line) console.log(line)
  },
})

console.log('\n' + revealRoles(result.game))
rl.close()
