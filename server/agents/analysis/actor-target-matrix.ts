import type { Seat } from '../../engine/types.ts'

/** Row-major index for a dense actor-by-target matrix. */
export function actorTargetMatrixIndex(
  playerCount: number,
  actor: Seat,
  target: Seat,
): number {
  return actor * playerCount + target
}
