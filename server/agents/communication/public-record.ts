import type {
  Phase,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'

// The public board's view of a proposal: the mechanical record only (no pitch or
// revision reason speech). Discriminated on `outcome` exactly like the engine's
// ProposalRecord, so the shared outcome predicates narrow it too. `revisedFrom`
// is a lone optional here (the public record never carried the reason), so it
// stays flat on the base rather than folding into a revision object.
export interface PublicProposalBase {
  round: number
  proposalNum: number
  leader: Seat
  team: readonly Seat[]
  revisedFrom?: readonly Seat[]
}
export interface PublicPendingProposal extends PublicProposalBase {
  outcome: 'pending'
}
export interface PublicVotedProposal extends PublicProposalBase {
  outcome: 'voted'
  votes: readonly { seat: Seat; vote: 'approve' | 'reject' }[]
  approved: boolean
}
export interface PublicAutoProposal extends PublicProposalBase {
  outcome: 'auto'
}
export type PublicProposal =
  | PublicPendingProposal
  | PublicVotedProposal
  | PublicAutoProposal

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
  proposals: readonly PublicProposal[]
  currentTeam?: readonly Seat[]
  discussionRound?: number
  discussionPostRevision?: boolean
  // Present iff the game is finished; mirrors PlayerView.outcome. Winner and
  // reason travel together so the board can never show one without the other.
  outcome?: { winner: 'good' | 'evil'; reason: string }
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
      ...(quest.status === 'complete'
        ? { team: quest.team.slice(), result: quest.result, failCount: quest.failCount }
        : {}),
    })),
    proposals: view.proposals.map((proposal): PublicProposal => {
      const base = {
        round: proposal.round,
        proposalNum: proposal.proposalNum,
        leader: proposal.leader,
        team: proposal.team.slice(),
        ...(proposal.revision
          ? { revisedFrom: proposal.revision.from.slice() }
          : {}),
      }
      // Carry the engine's outcome discriminant onto the public board; the
      // voted variant keeps its ballot and result, the others carry neither.
      if (proposal.outcome === 'voted') {
        return {
          ...base,
          outcome: 'voted',
          votes: proposal.votes.map((vote) => ({
            seat: vote.seat,
            vote: vote.vote,
          })),
          approved: proposal.approved,
        }
      }
      if (proposal.outcome === 'auto') return { ...base, outcome: 'auto' }
      return { ...base, outcome: 'pending' }
    }),
    ...(view.currentTeam ? { currentTeam: view.currentTeam.slice() } : {}),
    ...(view.discussionRound === undefined
      ? {}
      : { discussionRound: view.discussionRound }),
    ...(view.discussionPostRevision === undefined
      ? {}
      : { discussionPostRevision: view.discussionPostRevision }),
    ...(view.outcome ? { outcome: { ...view.outcome } } : {}),
  }
}
