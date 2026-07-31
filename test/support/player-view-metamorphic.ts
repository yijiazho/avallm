import type { PlayerView } from '../../server/engine/types.ts'
import type { PublicRecord } from '../../server/agents/record/public-record.ts'

// Shared seat-rotation primitives for the metamorphic tests: rotate a seat index
// by a fixed shift, and rotate + re-sort a seat array. One home so a proposal
// shape change is a single edit rather than three parallel ones.
function seatRotator(count: number, shift: number) {
  const rotate = (seat: number): number => (seat + shift) % count
  const seats = (source: readonly number[] | undefined) =>
    source?.map(rotate).sort((left, right) => left - right)
  return { rotate, seats }
}

export function rotatePlayerView(
  view: PlayerView,
  shift: number,
): PlayerView {
  const { rotate, seats } = seatRotator(view.playerCount, shift)
  const copy = structuredClone(view)
  const players = copy.players
    .map((player) => ({
      seat: rotate(player.seat),
      name: `Rotated ${rotate(player.seat)}`,
    }))
    .sort((left, right) => left.seat - right.seat)
  return {
    ...copy,
    seat: rotate(copy.seat),
    name: players.find((player) => player.seat === rotate(copy.seat))!.name,
    players,
    leaderSeat: rotate(copy.leaderSeat),
    privateInfo: ((info) => {
      switch (info.kind) {
        case 'merlin': return { kind: 'merlin' as const, knownEvil: seats(info.knownEvil)! }
        case 'percival': return { kind: 'percival' as const, merlinCandidates: seats(info.merlinCandidates)! }
        case 'evil': return { kind: 'evil' as const, evilPartners: seats(info.evilPartners)! }
        case 'none': return { kind: 'none' as const }
      }
    })(copy.privateInfo),
    quests: copy.quests.map((quest) =>
      quest.status === 'complete'
        ? { ...quest, team: quest.team.map(rotate).sort((left, right) => left - right) }
        : quest),
    proposals: copy.proposals.map((proposal) => ({
      ...proposal,
      leader: rotate(proposal.leader),
      team: seats(proposal.team)!,
      ...(proposal.revision
        ? { revision: { ...proposal.revision, from: seats(proposal.revision.from)! } }
        : {}),
      ...(proposal.outcome === 'voted'
        ? {
            votes: proposal.votes
              .map((vote) => ({ ...vote, seat: rotate(vote.seat) }))
              .sort((left, right) => left.seat - right.seat),
          }
        : {}),
    })),
    ...(copy.currentTeam ? { currentTeam: seats(copy.currentTeam) } : {}),
    transcript: [],
    events: [],
  }
}

// The PublicRecord counterpart. The public board carries no viewer identity,
// private knowledge, transcript, or events, and its proposals keep `revisedFrom`
// flat (never the reason speech), so it rotates the same seats over a smaller
// shape.
export function rotatePublicRecord(
  record: PublicRecord,
  shift: number,
): PublicRecord {
  const { rotate, seats } = seatRotator(record.playerCount, shift)
  return {
    ...structuredClone(record),
    players: record.players
      .map((player) => ({
        seat: rotate(player.seat),
        name: `renamed-${rotate(player.seat)}`,
      }))
      .sort((left, right) => left.seat - right.seat),
    leaderSeat: rotate(record.leaderSeat),
    quests: record.quests.map((quest) => ({
      ...quest,
      ...(quest.team ? { team: seats(quest.team) } : {}),
    })),
    proposals: record.proposals.map((proposal) => ({
      ...proposal,
      leader: rotate(proposal.leader),
      team: seats(proposal.team)!,
      ...(proposal.revisedFrom
        ? { revisedFrom: seats(proposal.revisedFrom) }
        : {}),
      ...(proposal.outcome === 'voted'
        ? {
            votes: proposal.votes
              .map((vote) => ({ ...vote, seat: rotate(vote.seat) }))
              .sort((left, right) => left.seat - right.seat),
          }
        : {}),
    })),
    ...(record.currentTeam ? { currentTeam: seats(record.currentTeam) } : {}),
  }
}
