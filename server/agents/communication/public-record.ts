import type {
  Phase,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'

/**
 * The canonical public board record shared by deterministic prompt facts and
 * language interpretation.
 *
 * This deliberately mirrors only the public portion of PlayerView. It has no
 * viewer identity and never carries raw events, private role knowledge,
 * cognition, posterior state, plans, or language reads. Names remain public,
 * untrusted player data.
 */
export interface PublicRecord {
  playerCount: number
  rolesInPlay: readonly Role[]
  players: readonly { seat: Seat; name: string }[]
  phase: Phase
  round: number
  proposalNum: number
  leaderSeat: Seat
  quests: readonly {
    num: number
    teamSize: number
    failsRequired: number
    team?: readonly Seat[]
    result?: 'success' | 'fail'
    failCount?: number
  }[]
  proposals: readonly {
    round: number
    proposalNum: number
    leader: Seat
    team: readonly Seat[]
    revisedFrom?: readonly Seat[]
    votes?: readonly { seat: Seat; vote: 'approve' | 'reject' }[]
    approved?: boolean
    auto?: boolean
  }[]
  currentTeam?: readonly Seat[]
  discussionRound?: number
  discussionPostRevision?: boolean
  winner?: 'good' | 'evil'
  winReason?: string
}

/**
 * Project a seat view through the one public-board allow-list.
 *
 * Every returned array and nested row is copied so downstream consumers cannot
 * mutate PlayerView or each other's inputs.
 */
export function projectPublicRecord(view: PlayerView): PublicRecord {
  return {
    playerCount: view.playerCount,
    rolesInPlay: view.rolesInPlay.slice(),
    players: view.players.map((player) => ({
      seat: player.seat,
      name: player.name,
    })),
    phase: view.phase,
    round: view.round,
    proposalNum: view.proposalNum,
    leaderSeat: view.leaderSeat,
    quests: view.quests.map((quest) => ({
      num: quest.num,
      teamSize: quest.teamSize,
      failsRequired: quest.failsRequired,
      ...(quest.team ? { team: quest.team.slice() } : {}),
      ...(quest.result ? { result: quest.result } : {}),
      ...(quest.failCount === undefined ? {} : { failCount: quest.failCount }),
    })),
    proposals: view.proposals.map((proposal) => ({
      round: proposal.round,
      proposalNum: proposal.proposalNum,
      leader: proposal.leader,
      team: proposal.team.slice(),
      ...(proposal.revisedFrom
        ? { revisedFrom: proposal.revisedFrom.slice() }
        : {}),
      ...(proposal.votes
        ? {
            votes: proposal.votes.map((vote) => ({
              seat: vote.seat,
              vote: vote.vote,
            })),
          }
        : {}),
      ...(proposal.approved === undefined
        ? {}
        : { approved: proposal.approved }),
      ...(proposal.auto === undefined ? {} : { auto: proposal.auto }),
    })),
    ...(view.currentTeam ? { currentTeam: view.currentTeam.slice() } : {}),
    ...(view.discussionRound === undefined
      ? {}
      : { discussionRound: view.discussionRound }),
    ...(view.discussionPostRevision === undefined
      ? {}
      : { discussionPostRevision: view.discussionPostRevision }),
    ...(view.winner ? { winner: view.winner } : {}),
    ...(view.winReason ? { winReason: view.winReason } : {}),
  }
}
