// Core engine types. Engine purity is enforced by ARCH014, not by convention.

export const ROLES = Object.freeze([
  'merlin', 'percival', 'servant',
  'assassin', 'morgana', 'mordred', 'oberon', 'minion',
] as const)

export type Role = typeof ROLES[number]

export function isRole(value: unknown): value is Role {
  return (ROLES as readonly unknown[]).includes(value)
}

export type Alignment = 'good' | 'evil'

export type Seat = number

// An unordered set of seats whose membership is the only thing that matters.
// Represented on the wire as an array, never a JS Set: a Set serializes to {},
// and these values cross game.log / PlayerView / the client boundary as arrays.
// The alias names set-ness at the type level for values that are NOT teams (a
// proposed/quest team keeps the Seat[] "team" spelling); it is structurally
// identical to readonly Seat[], so it documents intent and forbids in-place
// mutation but adds no nominal safety. canonicalTeam sorts one; teamsEqual
// compares two.
export type SeatSet = readonly Seat[]

export const PHASES = Object.freeze([
  'discussion', 'proposal', 'finalize', 'vote', 'quest', 'assassination', 'gameOver',
] as const)

export type Phase = typeof PHASES[number]

export interface TalkConfig {
  // Discussion rounds after the initial proposal — a fixed count, not a cap:
  // every segment runs exactly this many rounds. 0 = no discussion AND no
  // finalize — the proposal goes straight to vote (test/sim scaffolding).
  maxRounds: number
  // Discussion rounds after a revised proposal. 0 = a revision goes straight
  // to vote; revising is still allowed, there is just no talk after.
  maxRoundsAfterChange: number
  // Whether the leader takes a speaking turn at the END of each discussion
  // round ('last'), or is excluded from the rotation ('none') — the leader
  // already speaks via the proposal pitch and the finalize turn.
  leaderInDiscussion: 'none' | 'last'
}

export interface GameConfig {
  playerCount: number
  roles: Role[]         // length === playerCount
  names: string[]       // length === playerCount
  talk: TalkConfig
}

export interface Player {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
}

export interface Quest {
  num: number                    // 1..5
  teamSize: number
  failsRequired: number          // 1, or 2 for quest 4 at 7+ players
  team?: Seat[]
  result?: 'success' | 'fail'
  failCount?: number
}

export type Visibility = 'public' | { only: Seat[] }

export const EVENT_TYPES = Object.freeze([
  'gameCreated', 'roleDealt', 'knowledge', 'leadChange',
  'utterance', 'proposal', 'proposalLocked', 'proposalRevised',
  'voteCast', 'voteReveal',
  'questCard', 'questResult', 'assassination', 'gameOver',
  'thinking', 'rename', 'scratchpad',
] as const)

export type EventType = typeof EVENT_TYPES[number]

export interface GameEvent {
  seq: number
  type: EventType
  payload: Record<string, unknown>
  visibility: Visibility
}

export interface Game {
  id: string
  seed: string
  config: GameConfig
  phase: Phase
  round: number          // 1..5, current quest
  proposalNum: number    // 1..5 within the round
  leaderSeat: Seat
  players: Player[]
  quests: Quest[]
  discussion?: {
    remaining: Seat[]     // speakers left in the current round
    roundNum: number      // 1-based; restarts at 1 after a revision
    maxRounds: number     // snapshot of the applicable round count
    postRevision: boolean // false = initial segment, true = after proposalRevised
  }
  currentTeam?: Seat[]
  pendingVotes: Record<Seat, 'approve' | 'reject'>
  pendingCards: Record<Seat, 'success' | 'fail'>
  // Present iff the game is finished (phase === 'gameOver'). A single nested
  // object rather than two correlated optionals: a winner never exists without
  // the reason that produced it, and neither exists mid-game.
  outcome?: { winner: Alignment; reason: string }
  log: GameEvent[]
}

// ---- Decisions (the agent boundary) ----

export const DECISION_KINDS = Object.freeze([
  'discuss',
  'propose',
  'finalize',
  'vote',
  'quest',
  'assassinate',
] as const)

export type DecisionKind = typeof DECISION_KINDS[number]

/**
 * The runtime half of the union, so a validator outside the engine can ask
 * whether a stored kind is real without restating the six literals. Frozen
 * data only: the engine stays a pure function of its seed and log.
 */
export function isDecisionKind(value: unknown): value is DecisionKind {
  return (DECISION_KINDS as readonly unknown[]).includes(value)
}

export interface DecisionRequest {
  kind: DecisionKind
  seat: Seat
  round: number
  proposalNum: number
}

// `thinking` is the deciding agent's private in-character reasoning — the
// engine records it as an event visible only to that seat (post-game reveal
// material). `pitch` on propose is public speech attached to the proposal.
// `notes` is the agent's refreshed private scratchpad, attached to the first
// decision after a reflect; the engine records it seat-private like thinking.
export type Decision =
  | { kind: 'discuss'; say: string; thinking?: string; notes?: string }
  | { kind: 'propose'; team: Seat[]; pitch?: string; thinking?: string; notes?: string }
  | { kind: 'finalize'; stick: true; thinking?: string; notes?: string }
  | { kind: 'finalize'; stick: false; team: Seat[]; reason?: string; thinking?: string; notes?: string }
  | { kind: 'vote'; vote: 'approve' | 'reject'; thinking?: string; notes?: string }
  | { kind: 'quest'; card: 'success' | 'fail'; thinking?: string; notes?: string }
  | { kind: 'assassinate'; target: Seat; thinking?: string; notes?: string }

// ---- Views (the hidden-information chokepoint) ----

// What a seat privately learns at deal time, discriminated by the role that
// produced the knowledge. Exactly one kind applies per seat, so the shapes are
// mutually exclusive by construction: a seat can never hold both `knownEvil`
// and `merlinCandidates`. Loyal Servants and Oberon learn nothing ('none').
// Built in one place (computeKnowledge in rules.ts) and read through the
// knownEvilOf/evilPartnersOf/merlinCandidatesOf accessors there.
export type PrivateInfo =
  | { kind: 'none' }
  | { kind: 'merlin'; knownEvil: SeatSet }        // all evil except Mordred
  | { kind: 'percival'; merlinCandidates: SeatSet } // {Merlin, Morgana}, unordered
  | { kind: 'evil'; evilPartners: SeatSet }       // fellow evil, minus Oberon, minus self

export interface ProposalRecord {
  round: number
  proposalNum: number
  leader: Seat
  team: Seat[]          // the FINAL team (post-revision if revised)
  pitch?: string
  revisedFrom?: Seat[]  // original team, present iff the leader revised at finalize
  revisedReason?: string
  votes?: { seat: Seat; vote: 'approve' | 'reject' }[]
  approved?: boolean
  auto?: boolean   // 5th ("hammer") proposal: approved automatically, no vote
}

export interface PublicPlayer {
  seat: Seat
  name: string
}

export interface PlayerView {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
  privateInfo: PrivateInfo
  playerCount: number
  rolesInPlay: Role[]           // the role multiset is public knowledge
  players: PublicPlayer[]       // no role/alignment for anyone
  phase: Phase
  round: number
  proposalNum: number
  leaderSeat: Seat
  quests: Quest[]               // quest teams/results/failCounts are public
  proposals: ProposalRecord[]
  currentTeam?: Seat[]
  discussionRound?: number
  discussionPostRevision?: boolean
  // `prop` tags the utterance with the proposal segment it was spoken under
  // (post-revision team if the leader revised), so a renderer can group table
  // talk by proposal and a stale "I don't like this team" can never be read as
  // a position on the team currently on the table. Absent only for utterances
  // before the first proposal (e.g. a lobby rename). team/leader are public
  // (proposals are).
  //
  // `leader` is here for the same reason `team` is: the speaker's AUTHORITY is
  // as perishable across a proposal boundary as their stated position. A leader saying
  // "I'll propose the clean trio" is stating an intent they can act on; read one
  // proposal later, when someone else holds the chair, the same words look like
  // an idle claim. That exact misread happened at a table: a bot opened the next
  // proposal attacking the previous leader for taking credit for a team, before
  // that player had said anything at all in the new segment.
  transcript: {
    seat: Seat; name: string; text: string
    prop?: { round: number; proposalNum: number; leader: Seat; team: Seat[] }
  }[]
  events: GameEvent[]           // only events visible to this seat
  // Present iff the game is finished; see Game.outcome. Winner and reason
  // travel together so a view can never show a winner without its reason.
  outcome?: { winner: Alignment; reason: string }
}
