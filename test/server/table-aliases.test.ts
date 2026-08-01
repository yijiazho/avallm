// test-lane: fast
// Bot aliases are public prompt input: they must be stable, unique, safe, and
// independent of the agent/model implementation sitting behind each seat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../server/engine/game.ts'
import { nameIsReserved, normalizeName } from '../../server/engine/names.ts'
import { viewFor } from '../../server/engine/view.ts'
import { publicStateText } from '../../server/agents/prompts.ts'
import {
  FORBIDDEN_TABLE_ALIAS_NAMES,
  TABLE_ALIAS_POOL,
  tableAliases,
} from '../../server/table-aliases.ts'

test('table aliases are deterministic, unique, and seed-sensitive', () => {
  const first = tableAliases('same-game', 10)
  assert.deepEqual(tableAliases('same-game', 10), first)
  assert.equal(new Set(first.map(normalizeName)).size, 10)
  assert.notDeepEqual(tableAliases('another-game', 10), first)
})

test('table aliases exclude unavailable names case-insensitively', () => {
  const unavailable = TABLE_ALIAS_POOL.slice(0, 20)
  const aliases = tableAliases('crowded-table', 10, unavailable.map((name, i) =>
    i % 2 ? name.toUpperCase() : ` ${name.toLowerCase()} `))
  const blocked = new Set(unavailable.map(normalizeName))
  assert.ok(aliases.every((name) => !blocked.has(normalizeName(name))))
})

test('the alias pool contains no reserved, role, or Arthurian identity', () => {
  assert.ok(TABLE_ALIAS_POOL.length >= 20, 'pool has ample headroom beyond a ten-player table')
  for (const name of TABLE_ALIAS_POOL) {
    assert.equal(nameIsReserved(name), false, `${name} is not a reserved game identity`)
    assert.equal(FORBIDDEN_TABLE_ALIAS_NAMES.has(normalizeName(name)), false, `${name} is safe`)
  }
})

test('rendered agent state uses aliases rather than model labels', () => {
  const names = tableAliases('prompt-aliases', 5)
  const game = createGame({ seed: 'prompt-aliases', playerCount: 5, names })
  const rendered = publicStateText(viewFor(game, 0))
  for (const name of names) assert.ok(rendered.includes(name), `${name} reaches the prompt`)
  assert.doesNotMatch(rendered, /Kimi|DeepSeek|Probabilistic \+ LLM|Rule-based/)
})
