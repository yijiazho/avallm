// Agent packs: every curated pack resolves against the shipped library, a
// broken member surfaces instead of silently shrinking the pack, and seating a
// pack fills leftovers from the default library with sane models.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PACKS, randomModels, resolvePacks, seatPack } from '../server/agents/packs.ts'
import { loadAgentLibrary, validateDef } from '../server/agents/defs.ts'
import { CORE_TABLE, DEFAULT_TABLE, ROSTER } from '../server/llm/roster.ts'
import { makeRng } from '../server/engine/prng.ts'
import type { AgentDef } from '../server/agents/defs.ts'

const rng = () => makeRng('packs-test')

test('every curated pack resolves: real ids, no duplicates, seatable members', () => {
  const lib = loadAgentLibrary()
  assert.ok(PACKS.length > 0)
  for (const pack of PACKS) {
    assert.match(pack.id, /^[a-z0-9][a-z0-9-]{1,40}$/)
    assert.ok(pack.name.length > 0 && pack.blurb.length > 0)
    assert.ok(pack.agents.length > 0, `${pack.id} has no members`)
    assert.equal(new Set(pack.agents).size, pack.agents.length, `${pack.id} lists a member twice`)
    for (const id of pack.agents) {
      const def = lib.agents.find((a) => a.id === id)
      assert.ok(def, `pack ${pack.id} names missing agent "${id}"`)
      assert.ok(!def.unavailable, `pack ${pack.id} member "${id}" is unavailable`)
    }
  }
  // The shipped library must produce no pack problems at all.
  assert.deepEqual(lib.problems.filter((p) => p.file.startsWith('pack/')), [])
})

test('a missing member is surfaced as a problem, not silently dropped', () => {
  const agents: AgentDef[] = [validateDef({ id: 'sherlock', name: 'Sherlock Holmes', engine: { type: 'llm' } })]
  const { packs, problems } = resolvePacks(agents)
  const detectives = packs.find((p) => p.id === 'detectives')!
  assert.deepEqual(detectives.agents, ['sherlock'])
  assert.ok(problems.some((p) => p.file === 'pack/detectives' && /poirot/.test(p.reason)))
})

test('an unavailable member is dropped with its reason; an empty pack is reported', () => {
  const dead = validateDef(
    { id: 'sherlock', name: 'Sherlock Holmes', engine: { type: 'llm', model: 'gone' } },
    { allowUnknownModel: true },
  )
  dead.unavailable = 'model "gone" is no longer in the roster; pick a new model'
  const { packs, problems } = resolvePacks([dead])
  assert.ok(!packs.some((p) => p.id === 'detectives'))
  assert.ok(problems.some((p) => /no seatable members/.test(p.reason)))
})

test('seatPack: every member seated first, leftovers from the default library, no doubles', () => {
  const lib = loadAgentLibrary()
  const pack = lib.packs.find((p) => p.id === 'detectives')!
  const table = seatPack(pack, 7, lib.agents, rng())
  assert.equal(table.length, 7)
  const seated = table.slice(0, pack.agents.length).map((s) => s.agent)
  assert.deepEqual([...seated].sort(), [...pack.agents].sort(), 'a full-size table seats the whole pack')
  const leftovers = table.slice(pack.agents.length).map((s) => s.agent)
  // CORE_TABLE, not DEFAULT_TABLE: the latter lists every seated model, so
  // asserting against it would still pass if the two-tier preference in
  // leftoverPool collapsed into a flat draw over the whole roster. Leftovers
  // must come from the curated core while the core still has seats to give.
  assert.ok(leftovers.every((id) => CORE_TABLE.includes(id)), `unexpected leftovers: ${leftovers}`)
  assert.ok(leftovers.every((id) => !pack.agents.includes(id)))
  assert.ok(CORE_TABLE.length < DEFAULT_TABLE.length, 'the two tiers must stay distinct for the check above to bite')
})

test('seatPack: a table smaller than the pack draws a subset, and rotates across seeds', () => {
  const lib = loadAgentLibrary()
  const pack = lib.packs.find((p) => p.id === 'detectives')!
  const cast = (seed: string) => seatPack(pack, 4, lib.agents, makeRng(seed)).map((s) => s.agent)
  const first = cast('game-1')
  assert.equal(first.length, 4)
  assert.equal(new Set(first).size, 4, 'no member seated twice')
  assert.ok(first.every((id) => pack.agents.includes(id)), 'a short table is all pack, no leftovers')
  // Variety is the point: across seeds, every member should get seated
  // eventually rather than the same first four every game.
  const seen = new Set<string>()
  for (let i = 0; i < 40; i++) for (const id of cast(`game-${i}`)) seen.add(id)
  assert.deepEqual([...seen].sort(), [...pack.agents].sort(), 'some member never gets a seat')
})

test('seatPack: leftovers are built-in models only, never another pack\'s character', () => {
  const lib = loadAgentLibrary()
  const pack = lib.packs.find((p) => p.id === 'detectives')!
  // 9 bots against a 6-member pack forces the leftover pool to be exercised.
  const leftovers = seatPack(pack, 9, lib.agents, rng()).slice(pack.agents.length)
  for (const seat of leftovers) {
    const def = lib.agents.find((a) => a.id === seat.agent)!
    assert.equal(def.tier, 'builtin', `${seat.agent} is a ${def.tier} agent, not a model`)
  }
})

test('seatPack: personality-only agents get a rolled model, prescribed ones keep theirs', () => {
  const lib = loadAgentLibrary()
  const pack = lib.packs.find((p) => p.id === 'detectives')!
  const table = seatPack(pack, 7, lib.agents, rng())
  for (const seat of table) {
    const def = lib.agents.find((a) => a.id === seat.agent)!
    if (def.engine.type !== 'llm') continue
    if (def.engine.model === undefined) {
      assert.ok(seat.model, `${seat.agent} should have been dealt a model`)
      assert.ok(ROSTER.some((r) => r.id === seat.model))
    } else {
      assert.equal(seat.model, undefined, `${seat.agent} prescribes a model; the seat must not override it`)
    }
  }
})

test('randomModels: distinct until the roster runs out, then cycles', () => {
  const few = randomModels(ROSTER.length, rng())
  assert.equal(new Set(few).size, ROSTER.length)
  const many = randomModels(ROSTER.length + 2, rng())
  assert.equal(many.length, ROSTER.length + 2)
  assert.ok(many.every((id) => ROSTER.some((r) => r.id === id)))
})
