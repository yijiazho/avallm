/**
 * Tail probability of an evil-count distribution at the quest's failure
 * threshold.
 *
 * Evil-count distributions use the count as their index. The counted channel
 * may be all evil seats, publicly possible evil seats, or only evil visible to
 * Merlin; in every case its failure-capability projection is the tail at
 * `failsRequired`. This function does not clamp or validate its inputs: callers
 * retain their existing boundary policy, while producers and admission replay
 * share the same summation order.
 */
export function questFailureCapabilityProbability(
  evilCountDistribution: readonly number[],
  failsRequired: number,
): number {
  return evilCountDistribution
    .slice(failsRequired)
    .reduce((sum, mass) => sum + mass, 0)
}
