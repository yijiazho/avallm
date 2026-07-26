// Every cast validateRoles accepts. Shared test scaffolding, not a test file:
// `npm test` globs test/*.test.ts, so this is imported, never run directly.
//
// Extracted after the phantom-role audit found a live bug its hand-written cast
// list could not reach (a Percival with no Morgana, which the picker's Advanced
// preset builds at 5 and 6 players). A matrix assembled from imagination tests
// the casts you remembered; enumerating from the validator tests the casts that
// can actually be dealt. Any test making a claim about "all deals" should ask
// for the list rather than write one out, so a role or lattice edge added later
// widens every such test at once.
//
// The space is small: unique specials are a subset of {merlin, percival} on the
// good side and {assassin, morgana, mordred, oberon} on the evil side, with
// Servants and Minions filling the rest. 71 casts across 5 to 10 players.

import { EVIL_COUNT, validateRoles } from '../server/engine/rules.ts'
import type { Role } from '../server/engine/types.ts'

export interface Cast {
  label: string
  playerCount: number
  roles: Role[]
}

const GOOD_SPECIALS: Role[] = ['merlin', 'percival']
const EVIL_SPECIALS: Role[] = ['assassin', 'morgana', 'mordred', 'oberon']

const subsets = <T,>(xs: T[]): T[][] =>
  xs.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]])

export function legalCasts(): Cast[] {
  const out: Cast[] = []
  for (const playerCount of Object.keys(EVIL_COUNT).map(Number).sort((a, b) => a - b)) {
    const evil = EVIL_COUNT[playerCount]
    const good = playerCount - evil
    for (const gs of subsets(GOOD_SPECIALS)) {
      for (const es of subsets(EVIL_SPECIALS)) {
        const servants = good - gs.length
        const minions = evil - es.length
        if (servants < 0 || minions < 0) continue
        const roles: Role[] = [
          ...gs, ...Array<Role>(servants).fill('servant'),
          ...es, ...Array<Role>(minions).fill('minion'),
        ]
        // The validator is the authority on what is dealable, so ask it rather
        // than re-deriving the lattice here and risking the two drifting apart.
        try { validateRoles(playerCount, roles) } catch { continue }
        out.push({
          label: `${playerCount}p [${[...gs, ...es].join('+') || 'vanilla'}]`,
          playerCount, roles,
        })
      }
    }
  }
  return out
}
