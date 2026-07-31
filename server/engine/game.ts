// The game engine: createGame, expectedDecisions, applyDecision.
// applyDecision validates every decision regardless of source (LLM, heuristic,
// human, external process) — invalid decisions throw EngineError and never
// touch state. NOTE: applyDecision mutates `game` and returns it.

import {
  DEFAULT_ROLES, MAX_PLAYERS, MAX_PROPOSALS, MIN_PLAYERS,
  QUESTS_PER_GAME, QUESTS_TO_WIN, ROLE_ALIGNMENT, TEAM_SIZES,
  failsRequired, validateRoles,
} from './rules.ts'
import { capSpeech, nameIsReserved, stripSeatRefs } from './names.ts'
import { canonicalTeam, teamsEqual } from './seatset.ts'
import { computeKnowledge } from './knowledge.ts'
import { makeRng } from '../shared/prng.ts'
import type {
  Decision, DecisionRequest, EventPayloadMap, EventType, Game, GameEvent, Player,
  Quest, Role, Seat, TalkConfig, Visibility,
} from './types.ts'

export class EngineError extends Error {}

export interface CreateGameOpts {
  seed: string
  playerCount?: number
  roles?: Role[]
  names?: string[]
  talk?: Partial<TalkConfig>
  id?: string
}

function freezeEventValue<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  for (const nested of Object.values(value)) freezeEventValue(nested)
  return Object.freeze(value)
}

function emit<K extends EventType>(
  game: Game,
  type: K,
  payload: EventPayloadMap[K],
  visibility: Visibility,
): void {
  const seq = game.log.length
  const event = freezeEventValue({
    seq,
    type,
    payload: structuredClone(payload),
    visibility: structuredClone(visibility),
  } as GameEvent)
  // The one place the append-only log grows. The public type is
  // `readonly GameEvent[]` so no consumer can extend or rewrite it; the engine
  // owns this single write and casts to the mutable view to perform it, then
  // pins the new index non-writable so even the engine cannot overwrite it.
  ;(game.log as GameEvent[]).push(event)
  Object.defineProperty(game.log, seq, {
    value: event,
    enumerable: true,
    writable: false,
    configurable: false,
  })
}

export function createGame(opts: CreateGameOpts): Game {
  const playerCount = opts.playerCount ?? 7
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new EngineError(`playerCount must be ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${playerCount}`)
  }
  const roles = opts.roles ?? DEFAULT_ROLES[playerCount]
  validateRoles(playerCount, roles)
  const names = opts.names ?? Array.from({ length: playerCount }, (_, i) => `P${i}`)
  if (names.length !== playerCount) throw new EngineError('names length mismatch')
  // THE game default, for every caller that does not pass one: web games go
  // through here without a talk override on purpose, so this line is the single
  // place the shipped pacing is set. Was 3,2 and cut to 2,1 on playback feedback
  // that rounds drag: at 3 rounds the table was reliably out of new arguments by
  // the third and spent it restating the second (a 5p game ran 18 of 70 bot
  // utterances re-litigating one quest). The sim, the bench, terminal play and
  // the /api/agents fixture all pass their own talk config and are unaffected.
  const talk: TalkConfig = {
    maxRounds: 2, maxRoundsAfterChange: 1, leaderInDiscussion: 'last', ...opts.talk,
  }

  const rng = makeRng(`deal:${opts.seed}`)
  const dealtRoles = rng.shuffle(roles)
  const players: Player[] = dealtRoles.map((role, seat) => ({
    seat, name: names[seat], role, alignment: ROLE_ALIGNMENT[role],
  }))
  const leaderSeat = rng.int(playerCount)

  const quests: Quest[] = Array.from({ length: QUESTS_PER_GAME }, (_, i) => ({
    num: i + 1,
    teamSize: TEAM_SIZES[playerCount][i],
    failsRequired: failsRequired(playerCount, i + 1),
    status: 'pending',
  }))

  const game: Game = {
    id: opts.id ?? `game-${opts.seed}`,
    seed: opts.seed,
    config: { playerCount, roles, names, talk },
    phase: 'proposal',
    round: 1,
    proposalNum: 1,
    leaderSeat,
    players,
    quests,
    pendingVotes: {},
    pendingCards: {},
    log: [],
  }
  Object.defineProperty(game, 'log', {
    value: game.log,
    enumerable: true,
    writable: false,
    configurable: false,
  })

  emit(game, 'gameCreated', {
    playerCount,
    names,
    rolesInPlay: roles.slice().sort(),
    firstLeader: leaderSeat,
    talk,
  }, 'public')
  for (const p of players) {
    emit(game, 'roleDealt', { seat: p.seat, role: p.role, alignment: p.alignment }, { only: [p.seat] })
    const info = computeKnowledge(players, p.seat)
    emit(game, 'knowledge', { seat: p.seat, ...info }, { only: [p.seat] })
  }

  enterProposalCycle(game)
  return game
}

// ---- phase transitions ----

// Discussion rotation: non-leaders in seat order from the leader's left. The
// leader's proposal pitch was their opening statement, so they don't re-open
// the round — under 'last' they close each round instead, having heard the
// whole table before their turn and before finalize.
function speakerOrder(game: Game): Seat[] {
  const n = game.config.playerCount
  const order = Array.from({ length: n - 1 }, (_, i) => (game.leaderSeat + 1 + i) % n)
  if (game.config.talk.leaderInDiscussion === 'last') order.push(game.leaderSeat)
  return order
}

function startDiscussion(game: Game, postRevision: boolean): boolean {
  const cap = postRevision
    ? game.config.talk.maxRoundsAfterChange
    : game.config.talk.maxRounds
  if (cap <= 0) return false
  game.phase = 'discussion'
  game.discussion = {
    remaining: speakerOrder(game), roundNum: 1, maxRounds: cap,
    postRevision,
  }
  return true
}

function endDiscussion(game: Game): void {
  const postRevision = game.discussion!.postRevision
  game.discussion = undefined
  // The initial discussion segment ends in the leader's stick-or-change turn;
  // the post-revision segment goes straight to the vote — one revision only.
  if (postRevision) goToVoteOrQuest(game)
  else game.phase = 'finalize'
}

function enterProposalCycle(game: Game): void {
  game.currentTeam = undefined
  game.pendingVotes = {}
  // Public marker for whose turn it is to lead. The leader is otherwise only
  // implicit in the eventual proposal event, so the human feed and the
  // bot-visible log had no explicit "X now leads" beat — easy to lose track of,
  // and easy for the leader to forget it is on them to open the discussion.
  // Emitted at every cycle (initial deal, post-rejection, post-quest), which is
  // exactly where the leader is (re)established.
  emit(game, 'leadChange', {
    seat: game.leaderSeat, round: game.round, proposalNum: game.proposalNum,
  }, 'public')
  game.phase = 'proposal'
}

function afterProposal(game: Game): void {
  // maxRounds 0 = no discussion and nothing to finalize against: straight to
  // the vote (or the hammer auto-approve).
  if (!startDiscussion(game, false)) goToVoteOrQuest(game)
}

// The single exit from a proposal cycle toward resolution — and the one place
// the hammer lives. House rule: the 5th ("hammer") proposal is approved
// automatically, no vote. Under the official rule a 5th rejection ends the
// game for evil, so a rational table always approves it anyway; auto-approving
// removes the pure-blunder loss. Recorded as a public voteReveal
// (votes: [], auto: true) so the proposal record, history UI, and bot prompts
// all see the outcome through the usual event. The hammer still gets full
// discussion and the finalize turn — the leader's one revision is the only
// check on a team that goes straight to the quest.
function goToVoteOrQuest(game: Game): void {
  if (game.proposalNum >= MAX_PROPOSALS) {
    emit(game, 'voteReveal', {
      round: game.round, proposalNum: game.proposalNum,
      team: teamOnTable(game), votes: [], approved: true, auto: true,
    }, 'public')
    startQuest(game)
    return
  }
  game.phase = 'vote'
}

// The team currently on the table. Defined in finalize | vote | quest — the
// phases between a proposed/locked team and its resolved quest. currentTeam is
// set on propose, cleared at round start and after a quest resolves, so at every
// caller below the phase guarantees it is present. Throwing rather than reading
// through `!` gives that invariant one owned home: a phase-logic bug surfaces
// here with the phase in hand, not as a silent `undefined.slice()` frames away.
function teamOnTable(game: Game): Seat[] {
  if (game.currentTeam === undefined) {
    throw new EngineError(`no team on the table in phase ${game.phase}`)
  }
  return game.currentTeam
}

function validateTeam(game: Game, team: unknown): Seat[] {
  const size = game.quests[game.round - 1].teamSize
  if (!Array.isArray(team) || team.length !== size) {
    throw new EngineError(`team must have exactly ${size} members`)
  }
  const seen = new Set<Seat>()
  for (const s of team) {
    if (!Number.isInteger(s) || s < 0 || s >= game.config.playerCount) {
      throw new EngineError(`invalid seat on team: ${s}`)
    }
    if (seen.has(s)) throw new EngineError(`duplicate seat on team: ${s}`)
    seen.add(s)
  }
  return team.slice().sort((a, b) => a - b)
}

function startQuest(game: Game): void {
  // The team that is about to run lives on the table (game.currentTeam, via
  // teamOnTable); it is stamped onto the quest record only once the quest
  // resolves (see the 'quest' case), so a pending quest never carries a team
  // it might not keep.
  game.pendingCards = {}
  game.phase = 'quest'
}

function rotateLeader(game: Game): void {
  game.leaderSeat = (game.leaderSeat + 1) % game.config.playerCount
}

function endGame(game: Game, winner: 'good' | 'evil', reason: string): void {
  game.outcome = { winner, reason }
  game.phase = 'gameOver'
  game.discussion = undefined
  emit(game, 'gameOver', { winner, reason }, 'public')
}

function assassinSeat(game: Game): Seat | undefined {
  return game.players.find((p) => p.role === 'assassin')?.seat
}

function successCount(game: Game): number {
  return game.quests.filter((q) => q.status === 'complete' && q.result === 'success').length
}
function failQuestCount(game: Game): number {
  return game.quests.filter((q) => q.status === 'complete' && q.result === 'fail').length
}

// Display-name change, announced as a PUBLIC event so every player — human
// and bot — learns the mapping the same way a table would. All game identity
// is seat-anchored; the name is presentation, so history re-renders under the
// new name automatically (views derive names live from players[seat]).
export function renamePlayer(game: Game, seat: Seat, rawName: string): void {
  const player = game.players[seat]
  if (!player) throw new EngineError(`no player at seat ${seat}`)
  const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 24)
  if (!name) throw new EngineError('name must not be empty')
  if (nameIsReserved(name)) throw new EngineError(`"${name}" is a reserved word; pick another name`)
  const from = player.name
  if (from === name) return
  if (game.players.some((p) => p.seat !== seat && p.name.toLowerCase() === name.toLowerCase())) {
    throw new EngineError(`the name "${name}" is already taken at this table`)
  }
  player.name = name
  game.config.names[seat] = name
  emit(game, 'rename', { seat, from, to: name }, 'public')
}

// ---- the decision surface ----

export function expectedDecisions(game: Game): DecisionRequest[] {
  const base = { round: game.round, proposalNum: game.proposalNum }
  switch (game.phase) {
    case 'discussion':
      return [{ kind: 'discuss', seat: game.discussion!.remaining[0], ...base }]
    case 'proposal':
      return [{ kind: 'propose', seat: game.leaderSeat, ...base }]
    case 'finalize':
      return [{ kind: 'finalize', seat: game.leaderSeat, ...base }]
    case 'vote':
      return game.players
        .filter((p) => game.pendingVotes[p.seat] === undefined)
        .map((p) => ({ kind: 'vote' as const, seat: p.seat, ...base }))
    case 'quest':
      return teamOnTable(game)
        .filter((seat) => game.pendingCards[seat] === undefined)
        .map((seat) => ({ kind: 'quest' as const, seat, ...base }))
    case 'assassination':
      return [{ kind: 'assassinate', seat: assassinSeat(game)!, ...base }]
    case 'gameOver':
      return []
  }
}

/**
 * Complete every decision-shape legality check before emitting its private
 * preamble. A rejected action must leave the event log unchanged so a later
 * fallback cannot inherit rejected thinking or scratchpad text during replay.
 */
function validateDecisionBeforePreamble(
  game: Game,
  seat: Seat,
  decision: Decision,
): void {
  switch (decision.kind) {
    case 'discuss':
      if (typeof decision.say !== 'string') {
        throw new EngineError('say must be a string')
      }
      return
    case 'propose':
      validateTeam(game, decision.team)
      return
    case 'finalize':
      if (decision.stick === true) return
      if (decision.stick !== false) {
        throw new EngineError('stick must be true or false')
      }
      {
        const revised = validateTeam(game, decision.team)
        if (teamsEqual(revised, teamOnTable(game))) {
          throw new EngineError(
            'revised team is identical to the proposal — use stick: true',
          )
        }
      }
      return
    case 'vote':
      if (decision.vote !== 'approve' && decision.vote !== 'reject') {
        throw new EngineError(`invalid vote: ${String(decision.vote)}`)
      }
      return
    case 'quest':
      if (decision.card !== 'success' && decision.card !== 'fail') {
        throw new EngineError(`invalid quest card: ${String(decision.card)}`)
      }
      return
    case 'assassinate':
      if (
        !Number.isInteger(decision.target)
        || decision.target < 0
        || decision.target >= game.config.playerCount
      ) {
        throw new EngineError(
          `invalid assassination target: ${String(decision.target)}`,
        )
      }
      if (decision.target === seat) {
        throw new EngineError('assassin cannot target self')
      }
      return
  }
}

export interface AppliedDecisionResult {
  game: Game
  /** The canonical, normalized action the engine recorded for this decision. */
  appliedDecision: Decision
}

/**
 * The single authoritative apply path. Validates the decision (illegal input
 * throws EngineError and leaves the log untouched), emits its private preamble
 * and public events, mutates `game`, and returns BOTH the game and the exact
 * normalized Decision it recorded — team sorted, speech capped, the good-plays-
 * success rule applied, thinking/notes trimmed. The canonical action is built
 * here as the events are emitted, never scraped back out of the log.
 *
 * The public entry points are thin wrappers: applyDecision for callers that
 * only advance the game, applyDecisionWithOutcome for callers that also need the
 * recorded action.
 */
function applyDecisionCore(
  game: Game,
  seat: Seat,
  suppliedDecision: Decision,
): AppliedDecisionResult {
  // Snapshot the complete untrusted value before reading even its kind. This
  // prevents accessors or retained mutable references from changing a field
  // between validation, private preamble emission, and authoritative apply.
  const decision = structuredClone(suppliedDecision)
  const expected = expectedDecisions(game)
  const match = expected.find((r) => r.seat === seat && r.kind === decision.kind)
  if (!match) {
    throw new EngineError(
      `unexpected decision ${decision.kind} from seat ${seat} in phase ${game.phase}`,
    )
  }
  // The one legality gate. Everything below MAY ASSUME the decision is valid:
  // the switch normalizes and records, it does not re-check. Do not reintroduce
  // shape guards here — extend validateDecisionBeforePreamble instead.
  validateDecisionBeforePreamble(game, seat, decision)

  // Backstops against any decision source (LLM, heuristic, untrusted external
  // agent) emitting an unbounded blob. Kept independent from the agent-side
  // caps in parse.ts, but deliberately >= them so a well-behaved agent's own
  // thinking/scratchpad is never silently re-clipped here. The trimmed values
  // are what the events record, so they are also what appliedDecision carries.
  const privateFields: { thinking?: string; notes?: string } = {}
  if (typeof decision.thinking === 'string' && decision.thinking.trim()) {
    const text = decision.thinking.trim().slice(0, 3000)
    emit(game, 'thinking', { seat, kind: decision.kind, text }, { only: [seat] })
    privateFields.thinking = text
  }
  if (typeof decision.notes === 'string' && decision.notes.trim()) {
    const text = decision.notes.trim().slice(0, 8000)
    emit(game, 'scratchpad', { seat, round: game.round, text }, { only: [seat] })
    privateFields.notes = text
  }

  switch (decision.kind) {
    case 'discuss': {
      const say = capSpeech(stripSeatRefs(decision.say, game.players), 600)
      const d = game.discussion!
      emit(game, 'utterance', {
        seat, text: say, round: d.roundNum,
        ...(d.postRevision ? { postRevision: true } : {}),
      }, 'public')
      d.remaining.shift()
      if (d.remaining.length === 0) {
        // Every segment runs its configured number of rounds. There was once a
        // "lean settlement" early exit here, keyed on a declared-lean signal
        // that no longer exists; at the shipped 2,1 pacing it could only fire
        // in the degenerate round where nobody signalled at all, so nothing
        // replaced it.
        if (d.roundNum >= d.maxRounds) {
          endDiscussion(game)
        } else {
          d.roundNum += 1
          d.remaining = speakerOrder(game)
        }
      }
      return { game, appliedDecision: { kind: 'discuss', say, ...privateFields } }
    }

    case 'propose': {
      // Already validated; canonicalTeam just sorts the known-good seats.
      const team = canonicalTeam(decision.team).slice()
      game.currentTeam = team
      const pitch = typeof decision.pitch === 'string' && decision.pitch.trim()
        ? capSpeech(stripSeatRefs(decision.pitch.trim(), game.players), 400)
        : undefined
      emit(game, 'proposal', {
        round: game.round, proposalNum: game.proposalNum,
        leader: seat, team,
        ...(pitch !== undefined ? { pitch } : {}),
      }, 'public')
      afterProposal(game)
      return {
        game,
        appliedDecision: {
          kind: 'propose', team: team.slice(),
          ...(pitch !== undefined ? { pitch } : {}),
          ...privateFields,
        },
      }
    }

    case 'finalize': {
      if (decision.stick === true) {
        emit(game, 'proposalLocked', {
          round: game.round, proposalNum: game.proposalNum,
          leader: seat, team: teamOnTable(game).slice(),
        }, 'public')
        goToVoteOrQuest(game)
        return { game, appliedDecision: { kind: 'finalize', stick: true, ...privateFields } }
      }
      // Already validated: stick is false, the team is legal and differs from
      // the one on the table.
      const to = canonicalTeam(decision.team).slice()
      const from = teamOnTable(game)
      game.currentTeam = to
      const reason = typeof decision.reason === 'string' && decision.reason.trim()
        ? capSpeech(stripSeatRefs(decision.reason.trim(), game.players), 400)
        : undefined
      emit(game, 'proposalRevised', {
        round: game.round, proposalNum: game.proposalNum,
        leader: seat, from: from.slice(), to: to.slice(),
        ...(reason !== undefined ? { reason } : {}),
      }, 'public')
      if (!startDiscussion(game, true)) goToVoteOrQuest(game)
      return {
        game,
        appliedDecision: {
          kind: 'finalize', stick: false, team: to.slice(),
          ...(reason !== undefined ? { reason } : {}),
          ...privateFields,
        },
      }
    }

    case 'vote': {
      game.pendingVotes[seat] = decision.vote
      emit(game, 'voteCast', { seat, vote: decision.vote }, { only: [seat] })
      if (Object.keys(game.pendingVotes).length === game.config.playerCount) {
        const votes = game.players.map((p) => ({ seat: p.seat, vote: game.pendingVotes[p.seat] }))
        const approves = votes.filter((v) => v.vote === 'approve').length
        // Official rule: strict majority approves; a tie rejects.
        const approved = approves * 2 > game.config.playerCount
        emit(game, 'voteReveal', {
          round: game.round, proposalNum: game.proposalNum,
          team: teamOnTable(game), votes, approved,
        }, 'public')
        game.pendingVotes = {}
        if (approved) {
          startQuest(game)
        } else {
          // Only proposals 1-4 are ever voted on — the 5th is auto-approved
          // in goToVoteOrQuest — so a rejection always has a next proposal.
          game.proposalNum += 1
          rotateLeader(game)
          enterProposalCycle(game)
        }
      }
      return { game, appliedDecision: { kind: 'vote', vote: decision.vote, ...privateFields } }
    }

    case 'quest': {
      const player = game.players[seat]
      // Rule, not honor system: good cannot play fail.
      const card = player.alignment === 'good' ? 'success' : decision.card
      game.pendingCards[seat] = card
      emit(game, 'questCard', { seat, card }, { only: [seat] })
      if (Object.keys(game.pendingCards).length === teamOnTable(game).length) {
        const quest = game.quests[game.round - 1]
        const failCount = Object.values(game.pendingCards).filter((c) => c === 'fail').length
        const result = failCount >= quest.failsRequired ? 'fail' : 'success'
        // Flip the quest to `complete` in one assignment: team, result, and
        // failCount all arrive together, so the record can never sit in a
        // half-resolved shape. The team is the one that just ran (teamOnTable).
        game.quests[game.round - 1] = {
          num: quest.num,
          teamSize: quest.teamSize,
          failsRequired: quest.failsRequired,
          status: 'complete',
          team: teamOnTable(game).slice(),
          result,
          failCount,
        }
        emit(game, 'questResult', {
          round: game.round, failCount, result,
          failsRequired: quest.failsRequired,
        }, 'public')
        game.pendingCards = {}
        game.currentTeam = undefined

        if (successCount(game) >= QUESTS_TO_WIN) {
          if (assassinSeat(game) !== undefined && game.players.some((p) => p.role === 'merlin')) {
            game.phase = 'assassination'
          } else {
            endGame(game, 'good', 'threeQuests')
          }
        } else if (failQuestCount(game) >= QUESTS_TO_WIN) {
          endGame(game, 'evil', 'threeFails')
        } else {
          game.round += 1
          game.proposalNum = 1
          rotateLeader(game)
          enterProposalCycle(game)
        }
      }
      // The recorded card is the played card (good's fail is coerced to
      // success), so appliedDecision reports what actually went down.
      return { game, appliedDecision: { kind: 'quest', card, ...privateFields } }
    }

    case 'assassinate': {
      const target = decision.target
      const wasMerlin = game.players[target].role === 'merlin'
      emit(game, 'assassination', { assassin: seat, target, wasMerlin }, 'public')
      endGame(game, wasMerlin ? 'evil' : 'good', wasMerlin ? 'merlinAssassinated' : 'assassinMissed')
      return { game, appliedDecision: { kind: 'assassinate', target, ...privateFields } }
    }
  }
}

export function applyDecision(
  game: Game,
  seat: Seat,
  suppliedDecision: Decision,
): Game {
  return applyDecisionCore(game, seat, suppliedDecision).game
}

/**
 * Apply and return the exact normalized action the engine recorded, alongside
 * the mutated game. Shares applyDecisionCore with applyDecision, so there is
 * one apply path and the action is never reconstructed from the event log.
 */
export function applyDecisionWithOutcome(
  game: Game,
  seat: Seat,
  suppliedDecision: Decision,
): AppliedDecisionResult {
  return applyDecisionCore(game, seat, suppliedDecision)
}
