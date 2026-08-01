// Stable conversational identities for bot seats. Agent-card names and model
// names describe implementation; these aliases are the people at the table.
// Keeping the allocator outside the engine lets frozen engine/eval fixtures
// retain explicit P0-style names while web games and simulators share one
// deterministic presentation policy.

import { normalizeName, RESERVED_NAMES } from './engine/names.ts'
import { makeRng } from './shared/prng.ts'

// Medieval-flavoured, easy-to-address names with no Avalon roles or familiar
// Arthurian characters. In particular, avoid names such as Arthur, Guinevere,
// Lancelot, Galahad, Gawain, Tristan and Isolde: even though they are not roles
// in this ruleset, putting one on a bot could look like a hidden-role hint.
export const TABLE_ALIAS_POOL = Object.freeze([
  'Adela', 'Alden', 'Ansel', 'Beatrix', 'Bertram', 'Cecily', 'Corin', 'Edith',
  'Elowen', 'Fenric', 'Hadwin', 'Hawise', 'Heloise', 'Ivo', 'Jocelyn', 'Leofric',
  'Mabel', 'Martin', 'Maud', 'Nerys', 'Odo', 'Oswin', 'Petronilla', 'Ralf',
  'Rosamund', 'Sabine', 'Tamsin', 'Theobald', 'Willa', 'Winifred', 'Wulfric',
] as const)

// Defense in depth for future edits to TABLE_ALIAS_POOL. The formal roles are
// already in RESERVED_NAMES; this adds recognizable Arthurian identities and
// table terms that would make an alias read like privileged game information.
export const FORBIDDEN_TABLE_ALIAS_NAMES: ReadonlySet<string> = new Set([
  ...RESERVED_NAMES,
  'arthur', 'guinevere', 'gwen', 'gawain', 'lancelot', 'galahad', 'tristan',
  'isolde', 'morgause', 'nimue', 'viviane', 'lady of the lake',
  'player', 'human', 'bot', 'spectator', 'host', 'quest', 'proposal',
].map(normalizeName))

export function tableAliases(
  seed: string,
  count: number,
  unavailableNames: readonly string[] = [],
): string[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`alias count must be a non-negative integer, got ${count}`)
  }
  const unavailable = new Set(unavailableNames.map(normalizeName))
  const candidates = TABLE_ALIAS_POOL.filter((name) => {
    const normalized = normalizeName(name)
    return !unavailable.has(normalized) && !FORBIDDEN_TABLE_ALIAS_NAMES.has(normalized)
  })
  if (candidates.length < count) {
    throw new RangeError(`not enough table aliases: need ${count}, have ${candidates.length}`)
  }
  return makeRng(`table-aliases:${seed}`).shuffle(candidates).slice(0, count)
}
