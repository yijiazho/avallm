// test-lane: contract
//
// The watcher for the architecture rules' own scope lists.
//
// A fitness rule is only as wide as the list that says which files it applies
// to, and those lists are hand-maintained. That fails in the silent direction:
// a path that stops existing means the rule stopped covering a file, and a rule
// with nothing to check passes. Nothing reddens.
//
// The repository had already solved this twice, for SHARED_SHAPE_GUARD_NAMES in
// test/contract/canonical-shape.test.ts and SHARED_ARITHMETIC_HELPER_NAMES in
// test/contract/probability-arithmetic.test.ts, each deriving the truth from the
// tree and comparing. Both say why in their own comments. Ten more lists carried
// the same risk with no such test; this generalizes the guard instead of writing
// it an eleventh time.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Architecture fitness is an executable JavaScript tool, not a server module.
// @ts-expect-error The test supplies the narrow runtime contract below.
import * as architectureModule from '../../tools/architecture-fitness.mjs'

const { ARCHITECTURE_SCOPE_LISTS } = architectureModule as {
  ARCHITECTURE_SCOPE_LISTS: readonly {
    readonly name: string
    readonly kind: 'source' | 'identifier'
    readonly members: readonly string[]
  }[]
}

const TOOL_SOURCE = 'tools/architecture-fitness.mjs'

function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url))
}

test('every scoped source path still exists', () => {
  // The whole point. A renamed or deleted file leaves the rule pointed at
  // nothing, which is indistinguishable from the rule passing. Master has moved
  // whole directories more than once (components/ -> canonical/,
  // communication/ -> record/), so this is a live hazard, not a theoretical one.
  const missing: string[] = []
  for (const list of ARCHITECTURE_SCOPE_LISTS) {
    if (list.kind !== 'source') continue
    for (const member of list.members) {
      // Some rules name a module identity without its extension; accept either.
      if (existsSync(repoPath(member)) || existsSync(repoPath(`${member}.ts`))) {
        continue
      }
      missing.push(`${list.name}: ${member}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('every scope list is non-empty and free of duplicates', () => {
  for (const list of ARCHITECTURE_SCOPE_LISTS) {
    assert.ok(list.members.length > 0, `${list.name} is empty, so its rule scopes nothing`)
    assert.equal(
      new Set(list.members).size,
      list.members.length,
      `${list.name} repeats a member`,
    )
    assert.ok(
      ['source', 'identifier'].includes(list.kind),
      `${list.name} has an unknown kind ${list.kind}`,
    )
  }
})

// The meta-guard, and the reason this file is not just a longer version of the
// problem it fixes. Without it, the manifest is an eleventh hand-maintained list
// with nothing watching it: a new `const X_OWNERS = new Set([...])` would scope
// a rule and never be checked, exactly as the ten before it were not. So the
// tool's own source is scanned for the declaration shape and every match must be
// declared in the manifest.
test('no scope list escapes the manifest', () => {
  const source = readFileSync(repoPath(TOOL_SOURCE), 'utf8')
  // The naming conventions the tool already uses for a set of scoped files.
  const declared = [...source.matchAll(
    /^const (\w*(?:OWNERS|BUILDERS|CONSUMERS|IDENTIFIERS))\s*=\s*new Set\(/gm,
  )].map((match) => match[1]!)
  assert.ok(declared.length > 0, 'the declaration scan matched nothing, so it is broken')
  const covered = new Set(ARCHITECTURE_SCOPE_LISTS.map((list) => list.name))
  assert.deepEqual(
    declared.filter((name) => !covered.has(name)),
    [],
    'a scope list is declared but not registered in ARCHITECTURE_SCOPE_LISTS',
  )
  // And the reverse, so a deleted list leaves a failing manifest entry rather
  // than a stale one nobody notices.
  assert.deepEqual(
    [...covered].filter((name) => !declared.includes(name)),
    [],
    'ARCHITECTURE_SCOPE_LISTS names a list that no longer exists',
  )
})
