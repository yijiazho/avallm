// The matched-pair law: when are two recorded games comparable at all?
//
// This is its own module because it is shared, and it is shared on purpose.
// vote-conversion-report.ts pairs the same corpus through a different lens, and
// a paired delta computed under a weaker matching rule than its counterpart's
// would publish a number that looks like the other report's and is not. The
// input type is deliberately the minimum an observation must expose rather than
// this report's GameObservation, so a second report can satisfy the law without
// adopting this report's accumulator.

import type {
  ArchitectureRunMetadata,
  GameArtifact,
} from '../core/artifact.ts'

/**
 * The minimum an observation must expose to be checked for matching. Any
 * paired-variant report can satisfy this, so the law below has one definition
 * rather than one per report.
 */
export interface MatchedVariantInput {
  artifact: Pick<GameArtifact, 'seed' | 'playerCount' | 'roles' | 'talk' | 'players'>
  meta: Pick<ArchitectureRunMetadata, 'caseId' | 'targetRole' | 'targetSeat'>
}

const matchedFacets = (game: MatchedVariantInput) => ({
  caseId: game.meta.caseId,
  seed: game.artifact.seed,
  playerCount: game.artifact.playerCount,
  roles: game.artifact.roles,
  talk: game.artifact.talk,
  deal: game.artifact.players.map((p) => p.role),
  targetRole: game.meta.targetRole,
  targetSeat: game.meta.targetSeat,
  names: game.artifact.players.map((p) => p.name),
  opponents: game.artifact.players.map(
    (p) => p.seat === game.meta.targetSeat ? '<variant>' : p.agent,
  ),
})

/**
 * A paired delta is only meaningful when the two games differ solely at the
 * target seat. Comparing the configured role list is not enough: the dealt
 * seat-to-role assignment, the seat names the prompts render, and the agent at
 * every other seat all change play, so every one of them is compared here.
 * The case identity is compared too. Both current callers look the baseline up
 * by the candidate's case, which makes it redundant there, but this is the
 * exported law and a caller that pairs some other way must not lose the check.
 */
export function assertMatchedVariants(
  a: MatchedVariantInput,
  b: MatchedVariantInput,
): void {
  if (JSON.stringify(matchedFacets(a)) !== JSON.stringify(matchedFacets(b))) {
    throw new Error(`${a.meta.caseId}: variants are not matched on deal and table configuration`)
  }
}
