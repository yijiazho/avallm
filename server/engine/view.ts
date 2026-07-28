// viewFor is THE hidden-information chokepoint. No prompt builder, client
// payload, or agent ever touches raw Game; they consume viewFor(game, seat).
// Contract tests in test/knowledge.test.ts and test/leaks.test.ts pin this.

import { computeKnowledge } from './rules.ts'
import type {
  Game, GameEvent, PlayerView, ProposalRecord, Seat,
} from './types.ts'

export function eventVisibleTo(ev: GameEvent, seat: Seat): boolean {
  return ev.visibility === 'public' || ev.visibility.only.includes(seat)
}

type ProjectedTranscriptEntry = Omit<
  PlayerView['transcript'][number],
  'name'
>

export interface IncrementalPlayerViewProjection {
  /** Consume each newly appended engine event exactly once. */
  sync(game: Game): number
  /** Materialize one authoritative seat view from cached projections. */
  viewFor(game: Game, seat: Seat): PlayerView
  readonly projectedEventCount: number
}

/**
 * Incremental form of the hidden-information chokepoint.
 *
 * The projector caches only the same public/per-seat projections owned by
 * viewFor. It never exposes Game or raw player truth. Materializing a view
 * still copies its growing arrays, which is necessarily proportional to the
 * emitted PlayerView bytes, while historical log events are projected once.
 */
function createPlayerViewProjection(
  game: Game,
  onEventProjected: (() => void) | undefined,
  projectedSeats: readonly Seat[],
  requireAppendOnlyLog: boolean,
): IncrementalPlayerViewProjection {
  const boundGame = game
  const boundLog = game.log
  const playerCount = game.config.playerCount
  const visibleEvents = Array.from(
    { length: playerCount },
    () => [] as GameEvent[],
  )
  const proposals: ProposalRecord[] = []
  const transcript: ProjectedTranscriptEntry[] = []
  let curProp:
    | { round: number; proposalNum: number; leader: Seat; team: Seat[] }
    | undefined
  let nextEvent = 0
  let lastProjectedEvent: GameEvent | undefined

  const assertImmutableEvent = (
    value: unknown,
    seen = new Set<object>(),
  ): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    if (!Object.isFrozen(value)) {
      throw new Error('incremental player-view projection mutable event')
    }
    seen.add(value)
    for (const nested of Object.values(value)) {
      assertImmutableEvent(nested, seen)
    }
  }

  const assertAppendOnlySlot = (
    candidate: Game,
    index: number,
    event: GameEvent,
  ): void => {
    const descriptor = Object.getOwnPropertyDescriptor(candidate.log, index)
    if (
      descriptor?.value !== event
      || descriptor.writable !== false
      || descriptor.configurable !== false
    ) {
      throw new Error('incremental player-view projection mutable log')
    }
    assertImmutableEvent(event)
  }

  const assertGame = (candidate: Game): void => {
    if (
      candidate !== boundGame
      || candidate.log !== boundLog
      || candidate.log.length < nextEvent
    ) {
      throw new Error('incremental player-view projection game mismatch')
    }
    if (
      nextEvent > 0
      && (
        candidate.log[nextEvent - 1] !== lastProjectedEvent
        || candidate.log[nextEvent - 1].seq !== nextEvent - 1
      )
    ) {
      throw new Error('incremental player-view projection prefix mismatch')
    }
  }

  const projectEvent = (ev: GameEvent): void => {
    for (const seat of projectedSeats) {
      if (eventVisibleTo(ev, seat)) visibleEvents[seat].push(ev)
    }

    if (ev.type === 'proposal') {
      const team = (ev.payload.team as Seat[]).slice()
      proposals.push({
        round: ev.payload.round as number,
        proposalNum: ev.payload.proposalNum as number,
        leader: ev.payload.leader as Seat,
        team,
        ...(typeof ev.payload.pitch === 'string'
          ? { pitch: ev.payload.pitch }
          : {}),
      })
      curProp = {
        round: ev.payload.round as number,
        proposalNum: ev.payload.proposalNum as number,
        leader: ev.payload.leader as Seat,
        team: team.slice(),
      }
    } else if (ev.type === 'proposalRevised') {
      const rec = proposals[proposals.length - 1]
      rec.team = (ev.payload.to as Seat[]).slice()
      rec.revisedFrom = (ev.payload.from as Seat[]).slice()
      if (typeof ev.payload.reason === 'string') {
        rec.revisedReason = ev.payload.reason
      }
      curProp = {
        round: ev.payload.round as number,
        proposalNum: ev.payload.proposalNum as number,
        leader: ev.payload.leader as Seat,
        team: (ev.payload.to as Seat[]).slice(),
      }
    } else if (ev.type === 'voteReveal') {
      const rec = proposals[proposals.length - 1]
      rec.votes = (
        ev.payload.votes as ProposalRecord['votes']
      )!.map((vote) => ({ ...vote }))
      rec.approved = ev.payload.approved as boolean
      if (ev.payload.auto === true) rec.auto = true
    } else if (ev.type === 'rename') {
      transcript.push({
        seat: ev.payload.seat as Seat,
        text:
          `(changed display name from ${ev.payload.from} to ${ev.payload.to})`,
        ...(curProp ? { prop: curProp } : {}),
      })
    } else if (
      ev.type === 'utterance'
      && (
        (ev.payload.text as string).length > 0
        || ev.payload.lean !== undefined
      )
    ) {
      transcript.push({
        seat: ev.payload.seat as Seat,
        text: ev.payload.text as string,
        ...(ev.payload.lean !== undefined
          ? { lean: ev.payload.lean as any }
          : {}),
        ...(curProp ? { prop: curProp } : {}),
      })
    }
    onEventProjected?.()
  }

  const projection: IncrementalPlayerViewProjection = {
    sync(candidate) {
      assertGame(candidate)
      const from = nextEvent
      while (nextEvent < candidate.log.length) {
        const event = candidate.log[nextEvent]
        if (event.seq !== nextEvent) {
          throw new Error(
            `incremental player-view projection expected seq ${nextEvent}, got ${event.seq}`,
          )
        }
        if (requireAppendOnlyLog) {
          assertAppendOnlySlot(candidate, nextEvent, event)
        }
        projectEvent(event)
        lastProjectedEvent = event
        nextEvent++
      }
      return nextEvent - from
    },
    viewFor(candidate, seat) {
      assertGame(candidate)
      projection.sync(candidate)
      const me = candidate.players[seat]
      if (!me) throw new Error(`no player at seat ${seat}`)
      return {
        seat,
        name: me.name,
        role: me.role,
        alignment: me.alignment,
        privateInfo: computeKnowledge(candidate.players, seat),
        playerCount: candidate.config.playerCount,
        rolesInPlay: candidate.config.roles.slice().sort(),
        players: candidate.players.map((player) => ({
          seat: player.seat,
          name: player.name,
        })),
        phase: candidate.phase,
        round: candidate.round,
        proposalNum: candidate.proposalNum,
        leaderSeat: candidate.leaderSeat,
        quests: candidate.quests.map((quest) => ({
          ...quest,
          team: quest.team?.slice(),
        })),
        proposals: proposals.map((proposal) => ({
          ...proposal,
          team: proposal.team.slice(),
          ...(proposal.revisedFrom
            ? { revisedFrom: proposal.revisedFrom.slice() }
            : {}),
          ...(proposal.votes
            ? { votes: proposal.votes.map((vote) => ({ ...vote })) }
            : {}),
        })),
        currentTeam: candidate.currentTeam?.slice(),
        discussionRound: candidate.discussion?.roundNum,
        discussionPostRevision: candidate.discussion?.postRevision,
        transcript: transcript.map((entry) => ({
          seat: entry.seat,
          name: candidate.players[entry.seat].name,
          text: entry.text,
          ...(entry.lean !== undefined ? { lean: entry.lean } : {}),
          ...(entry.prop
            ? {
                prop: {
                  ...entry.prop,
                  team: entry.prop.team.slice(),
                },
              }
            : {}),
        })),
        events: visibleEvents[seat].slice(),
        winner: candidate.winner,
        winReason: candidate.winReason,
      }
    },
    get projectedEventCount() {
      return nextEvent
    },
  }
  projection.sync(game)
  return Object.freeze(projection)
}

export function createIncrementalPlayerViewProjection(
  game: Game,
  onEventProjected?: () => void,
): IncrementalPlayerViewProjection {
  return createPlayerViewProjection(
    game,
    onEventProjected,
    Array.from({ length: game.config.playerCount }, (_, seat) => seat),
    true,
  )
}

// A role-less observer: strictly the public record. Client code gates all
// role/alignment UI on role === 'spectator'.
//
// Every field is named EXPLICITLY rather than spread from a seat's view: the
// seat-private fields (role, alignment, privateInfo, per-seat events) are
// neutralized here, and any PRIVATE field added to PlayerView later is
// excluded by default (opt-in public) instead of silently leaking. The
// remaining fields carried from base are seat-independent public record.
export function viewForSpectator(game: Game): PlayerView {
  const base = viewFor(game, 0)
  return {
    seat: -1,
    name: 'Spectator',
    role: 'spectator' as PlayerView['role'],
    alignment: 'good', // placeholder, never rendered for spectators
    privateInfo: {},
    events: game.log.filter((ev) => ev.visibility === 'public'),
    // public record, seat-independent
    playerCount: base.playerCount,
    rolesInPlay: base.rolesInPlay,
    players: base.players,
    phase: base.phase,
    round: base.round,
    proposalNum: base.proposalNum,
    leaderSeat: base.leaderSeat,
    quests: base.quests,
    proposals: base.proposals,
    currentTeam: base.currentTeam,
    discussionRound: base.discussionRound,
    discussionPostRevision: base.discussionPostRevision,
    transcript: base.transcript,
    winner: base.winner,
    winReason: base.winReason,
  }
}

export function viewFor(game: Game, seat: Seat): PlayerView {
  return createPlayerViewProjection(
    game,
    undefined,
    [seat],
    false,
  ).viewFor(game, seat)
}
