import type { PlayerView } from '../../server/engine/types.ts'

export function rotatePlayerView(
  view: PlayerView,
  shift: number,
): PlayerView {
  const rotate = (seat: number): number =>
    (seat + shift) % view.playerCount
  const seats = (source: readonly number[] | undefined) =>
    source?.map(rotate).sort((left, right) => left - right)
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
      ...(proposal.revisedFrom
        ? { revisedFrom: seats(proposal.revisedFrom) }
        : {}),
      ...(proposal.votes
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
