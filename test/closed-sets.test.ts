// Contract: a closed set of string literals is spelled out in exactly one
// module, and every other module reads that list or a predicate over it.
//
// The bug this exists to prevent is specific. A set declared only as a type
// union has no runtime representation, so every validator that has to decide
// whether an incoming string is a member is forced to restate the literals.
// The compiler cannot tie those copies back to the union, so they survive a
// change to it without reddening anything, and the restatements silently
// disagree with the type. That is how the retired `external` execution mode
// stayed alive in four separate lists, and how `CoherenceIntent` came to be
// restated nine times across six files while the correct idiom sat four lines
// above it in its own module.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { AGENT_EXECUTION_MODES } from '../server/agents/brain.ts'
import { COHERENCE_INTENTS } from '../server/agents/cognition/coherence.ts'
import { DECISION_KINDS } from '../server/engine/types.ts'

interface ClosedSet {
  readonly name: string
  /** The one module allowed to spell the members out. */
  readonly owner: string
  readonly members: readonly string[]
}

/** Adding a consolidated set here is what protects it. */
const CLOSED_SETS: readonly ClosedSet[] = [
  {
    name: 'AGENT_EXECUTION_MODES',
    owner: 'server/agents/brain.ts',
    members: AGENT_EXECUTION_MODES,
  },
  {
    name: 'COHERENCE_INTENTS',
    owner: 'server/agents/cognition/coherence.ts',
    members: COHERENCE_INTENTS,
  },
  {
    name: 'DECISION_KINDS',
    owner: 'server/engine/types.ts',
    members: DECISION_KINDS,
  },
]

function serverSources(): readonly string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) found.push(full)
    }
  }
  walk('server')
  return found.sort()
}

/**
 * Matches the members as an adjacent run, in array or union form, across
 * lines. Built from the members themselves so growing a set grows its own
 * guard; hardcoding the literals here would reintroduce the very restatement
 * this rejects. Naming a proper subset stays legal, because several helpers
 * legitimately accept two of three modes or the three team-applicable
 * decision kinds.
 */
function restatementPattern(members: readonly string[]): RegExp {
  const separator = String.raw`\s*(?:,|\|)\s*`
  return new RegExp(members.map((member) => `'${member}'`).join(separator))
}

test('every closed set is stated in exactly one module', () => {
  const sources = serverSources()
  for (const { name, owner, members } of CLOSED_SETS) {
    assert.ok(
      sources.includes(owner),
      `${name} names a missing owner ${owner}`,
    )
    const pattern = restatementPattern(members)
    assert.ok(
      pattern.test(fs.readFileSync(owner, 'utf8')),
      `${name} is not actually stated in its declared owner ${owner}`,
    )
    const offenders = sources.filter(
      (file) => file !== owner && pattern.test(fs.readFileSync(file, 'utf8')),
    )
    assert.deepEqual(
      offenders,
      [],
      `${name} is restated outside ${owner}; import the list or its predicate instead`,
    )
  }
})

test('closed set members are unique and non-empty', () => {
  for (const { name, members } of CLOSED_SETS) {
    assert.ok(members.length > 0, `${name} is empty`)
    assert.equal(
      new Set(members).size,
      members.length,
      `${name} repeats a member`,
    )
  }
})
