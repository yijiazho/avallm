// Team-level readings of a finished belief snapshot.
//
// Everything here consumes a projected BeliefSnapshot and never touches world
// enumeration, so it lives apart from exact.ts (which turns worlds into a
// snapshot). The only thing it borrows back is weightsAreUniform, the single
// predicate that selects the exact-counting path over the weighted-sum one.

import type { Seat } from '../../engine/types.ts'
import { assertDistribution } from './invariants.ts'
import { weightsAreUniform } from './exact.ts'
import type { BeliefSnapshot, TeamAssessment } from './types.ts'

function validateTeam(snapshot: BeliefSnapshot, team: readonly Seat[]): readonly Seat[] {
  const unique = new Set(team)
  if (unique.size !== team.length) throw new Error('team assessment requires distinct seats')
  const playerCount = snapshot.playerMarginals.length
  for (const seat of team) {
    if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount) {
      throw new Error(`invalid team seat ${seat} for ${playerCount} players`)
    }
  }
  return [...team].sort((a, b) => a - b)
}

export function assessTeam(
  snapshot: BeliefSnapshot,
  proposedTeam: readonly Seat[],
): TeamAssessment {
  const assessment = assessTeams(snapshot, [proposedTeam])[0]
  if (!assessment) throw new Error('team assessment produced no result')
  return assessment
}

const countBits = (value: number): number => {
  let remaining = value
  let count = 0
  while (remaining) {
    remaining &= remaining - 1
    count++
  }
  return count
}

/**
 * Batch the joint team projection so exhaustive 10-player proposal surfaces
 * scan each world's compact alignment mask rather than allocating a filtered
 * team for every world/candidate pair. The returned order matches the input;
 * decision-facing callers attach and validate stable candidate IDs.
 */
export function assessTeams(
  snapshot: BeliefSnapshot,
  proposedTeams: readonly (readonly Seat[])[],
): readonly TeamAssessment[] {
  if (!proposedTeams.length) return []
  const teams = proposedTeams.map((team) => validateTeam(snapshot, team))
  const uniform = weightsAreUniform(snapshot.worlds)
  const maskWeights = new Map<number, number>()
  for (const weightedWorld of snapshot.worlds) {
    let evilMask = 0
    for (
      let seat = 0;
      seat < weightedWorld.world.alignmentBySeat.length;
      seat++
    ) {
      if (weightedWorld.world.alignmentBySeat[seat] === 'evil') {
        evilMask |= 1 << seat
      }
    }
    maskWeights.set(
      evilMask,
      (maskWeights.get(evilMask) ?? 0)
        + (uniform ? 1 : weightedWorld.probability),
    )
  }
  return teams.map((team): TeamAssessment => {
    let teamMask = 0
    for (const seat of team) teamMask |= 1 << seat
    const evilWorldCounts = Array<number>(team.length + 1).fill(0)
    for (const [evilMask, weight] of maskWeights) {
      evilWorldCounts[countBits(teamMask & evilMask)]! += weight
    }
    const totalWeight = evilWorldCounts.reduce(
      (sum, weight) => sum + weight,
      0,
    )
    const evilCountDistribution = uniform
      ? evilWorldCounts.map((count) => count / snapshot.worlds.length)
      : evilWorldCounts.map((weight) => weight / totalWeight)
    // Postcondition guarding the two-denominator split above: the uniform branch
    // divides by the world count, the weighted branch by the accumulated weight.
    // If either denominator is wrong the masses stop summing to 1, and clean
    // probability (index 0) silently misreports how safe the team is.
    assertDistribution(
      evilCountDistribution,
      `team ${team.join('-')} evil-count distribution`,
    )
    return {
      team,
      cleanProbability: evilCountDistribution[0]!,
      evilCountDistribution,
    }
  })
}
