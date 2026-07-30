// Core engine types. Engine purity is enforced by ARCH014, not by convention.

/**
 * Deep-readonly mapped type: recursively marks every property and array element
 * `readonly`. Compile-time only (erased at runtime) and structural — it encodes
 * an immutability contract in the type, while the engine still enforces the same
 * invariant at runtime via Object.freeze. Functions and primitives pass through
 * untouched; arrays (mutable or already-readonly) become ReadonlyArray.
 *
 * Scoped to JSON-shaped data (the wire/view types it is used on). It does NOT
 * special-case built-in collections — applied to a type containing a Map, Set,
 * Date, or Promise it would map over the instance's own keys instead of
 * preserving it, so keep those out of the shapes it wraps.
 */
export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer E)[] ? readonly DeepReadonly<E>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T

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

// A quest is one of two real states, never a half-state. Before it resolves it
// is `pending` and carries only its fixed parameters; the team currently on it
// (if any) lives in `Game.currentTeam`, not here. Once every card is in it flips
// to `complete` and the three outcome fields — the team that actually went, the
// result, and the fail count — arrive together and are then guaranteed. Modeling
// this as three independent optionals let the type express impossible shapes (a
// result with no team, a failCount with no result); the union rejects them.
interface QuestBase {
  num: number                    // 1..5
  teamSize: number
  failsRequired: number          // 1, or 2 for quest 4 at 7+ players
}

export type Quest =
  | (QuestBase & { status: 'pending' })
  | (QuestBase & {
      status: 'complete'
      team: Seat[]                 // the team that ran the quest
      result: 'success' | 'fail'
      failCount: number
    })

// The resolved member on its own, for the common filter-then-map over finished
// quests: `view.quests.filter(isCompletedQuest)` yields these, so the outcome
// fields are reachable in the map without re-narrowing. The guard lives in
// rules.ts (isCompletedQuest), next to the other pure engine helpers.
export type CompletedQuest = Extract<Quest, { status: 'complete' }>

export type Visibility = 'public' | { only: Seat[] }

export const EVENT_TYPES = Object.freeze([
  'gameCreated', 'roleDealt', 'knowledge', 'leadChange',
  'utterance', 'proposal', 'proposalLocked', 'proposalRevised',
  'voteCast', 'voteReveal',
  'questCard', 'questResult', 'assassination', 'gameOver',
  'thinking', 'rename', 'scratchpad',
] as const)

export type EventType = typeof EVENT_TYPES[number]

// The typed payload carried by each event kind. The map keys ARE EventType, so
// a missing/extra entry is a compile error and the two lists cannot drift. Each
// GameEvent below pairs a `type` literal with exactly its payload, so reading
// `ev.payload.<field>` after narrowing on `ev.type` needs no cast: the field is
// present (or a compile error), not `unknown`. Built stylistically like the
// PrivateInfo union further down. `emit` (game.ts) is keyed off this map, so
// every emit site is checked against the payload its event owns.
export interface EventPayloadMap {
  gameCreated: {
    playerCount: number
    names: string[]
    rolesInPlay: Role[]
    firstLeader: Seat
    talk: TalkConfig
  }
  roleDealt: { seat: Seat; role: Role; alignment: Alignment }
  // The seat's night-phase knowledge, tagged with the seat it belongs to.
  knowledge: { seat: Seat } & PrivateInfo
  leadChange: { seat: Seat; round: number; proposalNum: number }
  utterance: {
    seat: Seat
    text: string
    round: number            // the discussion round the utterance was spoken in
    postRevision?: true
  }
  proposal: {
    round: number
    proposalNum: number
    leader: Seat
    team: Seat[]
    pitch?: string
  }
  proposalLocked: {
    round: number
    proposalNum: number
    leader: Seat
    team: Seat[]
  }
  proposalRevised: {
    round: number
    proposalNum: number
    leader: Seat
    from: Seat[]
    to: Seat[]
    reason?: string
  }
  voteCast: { seat: Seat; vote: 'approve' | 'reject' }
  voteReveal: {
    round: number
    proposalNum: number
    team: Seat[]
    votes: { seat: Seat; vote: 'approve' | 'reject' }[]
    approved: boolean
    auto?: true               // the 5th ("hammer") proposal, auto-approved
  }
  questCard: { seat: Seat; card: 'success' | 'fail' }
  questResult: {
    round: number
    failCount: number
    result: 'success' | 'fail'
    failsRequired: number
  }
  assassination: { assassin: Seat; target: Seat; wasMerlin: boolean }
  gameOver: { winner: Alignment; reason: string }
  thinking: { seat: Seat; kind: DecisionKind; text: string }
  rename: { seat: Seat; from: string; to: string }
  scratchpad: { seat: Seat; round: number; text: string }
}

// Events are the authoritative record and are deep-frozen the instant they are
// emitted (freezeEventValue in game.ts). The type mirrors that: an event is
// immutable once created, and game.log is an append-only sequence the engine
// alone extends (through emit's single owned cast) — no consumer may push,
// splice, reassign, or reach in and rewrite a payload field.
//
// A `type`-discriminated event: each member pairs one EventType literal with the
// payload that type owns (from EventPayloadMap). The distribution over EventType
// keeps this in lockstep with the map, so adding an event kind is a single edit.
export type GameEvent = {
  [K in EventType]: {
    readonly seq: number
    readonly type: K
    readonly payload: DeepReadonly<EventPayloadMap[K]>
    readonly visibility: DeepReadonly<Visibility>
  }
}[EventType]

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
  readonly log: readonly GameEvent[]
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

export type ProposalVote = { seat: Seat; vote: 'approve' | 'reject' }

// A leader's one-time revision at finalize. `from` is the ORIGINAL team; the
// final team lives in the record's `team`. `reason` is optional public speech.
// The pair travels as one object so a reason with no original team, or a delta
// with no team to diff against, is unrepresentable.
export interface ProposalRevision {
  from: Seat[]
  reason?: string
}

// Fields every proposal carries, whatever its outcome. `revision` is orthogonal
// to the outcome discriminant below: any variant may or may not have been revised.
interface ProposalRecordBase {
  round: number
  proposalNum: number
  leader: Seat
  team: Seat[]          // the FINAL team (post-revision if revised)
  pitch?: string
  revision?: ProposalRevision
}

// The proposal currently on the table, not yet resolved to a vote. Only the
// last element of a view's `proposals` is ever pending.
export interface PendingProposal extends ProposalRecordBase {
  outcome: 'pending'
}

// A normally-voted proposal (proposals 1-4): the full ballot and its result.
export interface VotedProposal extends ProposalRecordBase {
  outcome: 'voted'
  votes: ProposalVote[]
  approved: boolean
}

// The 5th ("hammer") proposal: approved automatically with no vote. Approval is
// implied by the variant, so there is no ballot or `approved` flag it could
// contradict. See MAX_PROPOSALS / goToVoteOrQuest for the house rule.
export interface AutoProposal extends ProposalRecordBase {
  outcome: 'auto'
}

// Discriminated on `outcome`: the correlated optionals of the old flat shape
// (votes+approved together, auto XOR votes, revisedFrom+revisedReason together)
// are now impossible to combine wrongly.
export type ProposalRecord = PendingProposal | VotedProposal | AutoProposal

export interface PublicPlayer {
  seat: Seat
  name: string
}

// The seat-scoped projection is a derived, read-only snapshot: viewFor builds it
// fresh from the log and hands it across the hidden-information chokepoint to
// prompt builders, the client payload, and every agent. None of them own the
// game, so none may mutate what they receive. `PlayerView` is therefore the
// DeepReadonly of its shape (below): every `view: PlayerView` parameter already
// means the immutable form, and an accidental in-place edit (sorting quests,
// pushing a transcript entry) is a compile error rather than a silent shared
// mutation of another seat's projection. The base `PlayerViewShape` types stay
// mutable for the engine, which owns and rewrites the underlying Game.
interface PlayerViewShape {
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

export type PlayerView = DeepReadonly<PlayerViewShape>
