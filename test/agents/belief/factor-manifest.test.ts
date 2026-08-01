// test-lane: contract
//
// The watcher for BELIEF_FACTORS.
//
// The manifest states which soft factors run. A hand-maintained statement of
// that kind fails in the silent direction: a factor added to the tree without
// an entry is simply unlisted, and nothing reddens.
//
// So the factor set is never taken from the manifest. It is derived from
// `belief/*-factor.ts` on disk and the manifest is the thing compared against.
// That is the first test, and it is the one carrying real weight.
//
// The seating tests are deliberately weaker than they look, and saying so
// matters more than the assertions do. `composedBrainOptions` now obtains its
// model FROM the manifest, so asking whether the two agree is close to asking
// whether the manifest equals itself. What survives that circularity is the
// plumbing: these fail if the registry stops calling `beliefModelFor`, or if a
// hardcoded `beliefModel:` is reintroduced after the spread and shadows it,
// which is exactly the regression the inversion was meant to prevent. They are
// not evidence that the table is correct; the table is correct because the
// registry has no other source.
//
// Deliberately NOT tested: that each entry's version strings match its module's
// constants. The manifest imports those constants rather than copying their
// text, so the compiler already guarantees it and a test would assert
// `X === X`. The same is true of each belief model's `factorsVersion`, which is
// built from the same shared constant.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BELIEF_FACTORS } from '../../../server/agents/belief/factor-manifest.ts'
import { composedBrainOptions } from '../../../server/agents/registry.ts'
import { COMPOSED_BRAIN_PRESETS } from '../../../server/agents/types.ts'

const BELIEF_DIR = fileURLToPath(
  new URL('../../../server/agents/belief/', import.meta.url),
)

/** Every `*-factor.ts` module in belief/, by basename. */
function factorModulesOnDisk(): string[] {
  return readdirSync(BELIEF_DIR)
    .filter((name) => name.endsWith('-factor.ts'))
    .map((name) => name.slice(0, -'.ts'.length))
    .sort()
}

/** The bundle version each preset actually seats, when it seats one. */
function seatedBundleByPreset(): Map<string, string> {
  const seated = new Map<string, string>()
  for (const preset of COMPOSED_BRAIN_PRESETS) {
    const bundle = composedBrainOptions(preset).beliefModel?.factorsVersion
    if (bundle !== undefined) seated.set(preset, bundle)
  }
  return seated
}

test('the manifest names exactly the factor modules on disk', () => {
  // The whole point. A new factor file that nobody listed would otherwise sit
  // in belief/ with no stated status, which is the confusion this table exists
  // to end.
  assert.deepEqual(
    Object.keys(BELIEF_FACTORS).sort(),
    factorModulesOnDisk(),
    'BELIEF_FACTORS and belief/*-factor.ts disagree: add the missing entry, or '
      + 'remove the entry for a factor that no longer exists',
  )
})

test('every factor claiming a preset is actually seated by that preset', () => {
  const seated = seatedBundleByPreset()
  for (const [module, entry] of Object.entries(BELIEF_FACTORS)) {
    if (entry.seating.kind !== 'preset') continue
    for (const preset of entry.seating.presets) {
      assert.equal(
        seated.get(preset),
        entry.bundleVersion,
        `${module} claims preset ${preset}, but composedBrainOptions('${preset}') `
          + `seats ${String(seated.get(preset))}`,
      )
    }
  }
})

test('every factor claiming no preset is seated by no preset', () => {
  // Catches a hardcoded `beliefModel:` reintroduced into a preset's returned
  // options, where it would shadow the spread and seat a factor this table
  // still records as unseated.
  const seated = [...seatedBundleByPreset()]
  for (const [module, entry] of Object.entries(BELIEF_FACTORS)) {
    if (entry.seating.kind === 'preset') continue
    for (const [preset, bundle] of seated) {
      assert.notEqual(
        bundle,
        entry.bundleVersion,
        `${module} is recorded as ${entry.seating.kind}, but preset ${preset} `
          + 'seats it. Update its seating entry',
      )
    }
  }
})

test('every seated bundle is claimed by some manifest entry', () => {
  // Catches the reverse of the first test: a belief model seated in the
  // registry that no factor module in belief/ accounts for, such as a future
  // model combining two factors into one bundle. That needs its own entry
  // rather than passing unlisted.
  // Widened on purpose: `as const` makes the entry versions a literal union,
  // and a seated bundle that matches none of them is exactly what this test
  // exists to catch, not a type error at the comparison.
  const claimed = new Set<string>(
    Object.values(BELIEF_FACTORS).map((entry) => entry.bundleVersion),
  )
  for (const [preset, bundle] of seatedBundleByPreset()) {
    assert.ok(
      claimed.has(bundle),
      `preset ${preset} seats bundle ${bundle}, which no BELIEF_FACTORS entry `
        + 'claims',
    )
  }
})

test('no preset injects a language interpreter', () => {
  // The language factor's seating is 'injected', which is a claim about every
  // shipped agent and not just about the presets. This pins the half that
  // registry.ts owns: if a preset ever supplies an interpreter, the factor is
  // live by a second mechanism and its entry is wrong.
  for (const preset of COMPOSED_BRAIN_PRESETS) {
    assert.ok(
      !('languageInterpreter' in composedBrainOptions(preset)),
      `preset ${preset} supplies a languageInterpreter; the language factor is `
        + 'no longer merely injectable',
    )
  }
})
