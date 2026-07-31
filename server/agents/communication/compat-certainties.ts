import type {
  Alignment,
  PlayerView,
  Role,
  Seat,
  SeatSet,
} from '../../engine/types.ts'
import { rolePossibilities } from '../belief/worlds.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import type { SituationAnalysis } from '../analysis/types.ts'

export interface SeatCertainty {
  seat: Seat
  possibleRoles: Role[]
  // Non-null when the typed situation analysis proves this seat's side.
  alignment: Alignment | null
}

export interface RoleCertainties {
  seats: SeatCertainty[]           // one per seat, indexed by seat number
  knownGood: SeatSet               // provably good, excluding the viewer
  knownEvil: SeatSet               // provably evil, excluding the viewer
  unresolved: SeatSet              // side still genuinely open
  merlinCandidates: SeatSet        // seats that could still hold Merlin (empty if no Merlin dealt)
  alignmentComplete: boolean       // true when no seat's side is open
  // Seats the DEAL alone leaves open and the resolved quests close. Separated so
  // a caller can state the new deduction and the evidence for it, instead of
  // folding it into the deal lines where it would read as private sight.
  fromRecord: Array<{ seat: Seat; alignment: Alignment; questNum?: number }>
}

/**
 * Project the explicit belief and typed situation analysis into the legacy
 * certainty shape consumed by compatibility prompt prose.
 *
 * Role possibilities come from feasible-world support, never posterior
 * thresholds. Proven sides and record provenance come from SituationAnalysis,
 * keeping communication downstream of the shared cognition boundary.
 */
export function compatibilityCertainties(
  view: PlayerView,
  belief: BeliefSnapshot,
  analysis: SituationAnalysis,
): RoleCertainties {
  if (
    belief.throughSeq !== analysis.throughSeq
    || belief.throughSeq !== Math.max(-1, ...view.events.map((event) => event.seq))
  ) {
    throw new Error('compatibility certainty inputs must describe the same visible cursor')
  }

  const worlds = belief.worlds.map((weighted) => weighted.world)
  const provenGood = new Set(analysis.provenGood)
  const provenEvil = new Set(analysis.provenEvil)
  const seats: SeatCertainty[] = view.players.map((player) => ({
    seat: player.seat,
    possibleRoles: [...rolePossibilities(worlds, player.seat)],
    alignment: provenGood.has(player.seat)
      ? 'good'
      : provenEvil.has(player.seat)
        ? 'evil'
        : null,
  }))
  const withoutViewer = (seat: Seat): boolean => seat !== view.seat
  const fromRecord = analysis.deductions
    .filter((deduction) =>
      withoutViewer(deduction.seat)
      && (
        deduction.provenance.kind === 'quest-record'
        || deduction.provenance.kind === 'joint-constraints'
      ))
    .map((deduction) => ({
      seat: deduction.seat,
      alignment: deduction.alignment,
      ...((deduction.provenance.kind === 'quest-record'
        || (
          deduction.provenance.kind === 'joint-constraints'
          && deduction.alignment === 'evil'
        ))
        && deduction.provenance.questNums.length === 1
        ? { questNum: deduction.provenance.questNums[0] }
        : {}),
    }))

  return {
    seats,
    knownGood: analysis.provenGood.filter(withoutViewer),
    knownEvil: analysis.provenEvil.filter(withoutViewer),
    unresolved: analysis.unresolved.filter(withoutViewer),
    merlinCandidates: seats
      .filter((seat) => seat.possibleRoles.includes('merlin'))
      .map((seat) => seat.seat),
    alignmentComplete: seats.every((seat) => seat.alignment !== null),
    fromRecord,
  }
}
