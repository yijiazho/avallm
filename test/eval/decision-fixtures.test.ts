// test-lane: eval
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDecisionFixtures,
  DECISION_FIXTURE_SCHEMA,
  fixtureTextMatches,
  readDecisionFixtures,
} from '../../server/eval/decision-fixtures.ts'
import type { DeepReadonly, Visibility } from '../../server/engine/types.ts'

const visibleTo = (
  visibility: DeepReadonly<Visibility>,
  seat: number,
): boolean =>
  visibility === 'public' || visibility.only.includes(seat)

test('fixture freshness accepts CRLF checkouts but still detects content drift', () => {
  const expected = '[\n  {\n    "schema": 1\n  }\n]\n'
  const crlfCheckout = expected.replaceAll('\n', '\r\n')

  assert.equal(fixtureTextMatches(crlfCheckout, expected), true)
  assert.equal(fixtureTextMatches(crlfCheckout.replace('"schema": 1', '"schema": 2'), expected), false)
})

test('frozen decision fixtures match deterministic verified replay', async () => {
  const frozen = readDecisionFixtures()
  const regenerated = await buildDecisionFixtures()
  assert.deepEqual(regenerated, frozen)
})

test('frozen decision fixtures cover every decision kind and private-knowledge shape', () => {
  const fixtures = readDecisionFixtures()
  assert.ok(fixtures.every((fixture) => fixture.schema === DECISION_FIXTURE_SCHEMA))
  assert.deepEqual(
    [...new Set(fixtures.map((fixture) => fixture.req.kind))].sort(),
    ['assassinate', 'discuss', 'finalize', 'propose', 'quest', 'vote'],
  )
  assert.ok(fixtures.some((fixture) => fixture.view.privateInfo.kind === 'merlin'))
  assert.ok(fixtures.some((fixture) => fixture.view.privateInfo.kind === 'percival'))
  assert.ok(fixtures.some((fixture) => fixture.view.privateInfo.kind === 'evil'))
  assert.ok(fixtures.some((fixture) => fixture.view.privateInfo.kind === 'none'))
})

test('frozen decision fixtures expose only events visible to the viewing seat', () => {
  for (const fixture of readDecisionFixtures()) {
    assert.ok(
      fixture.view.events.every((event) => visibleTo(event.visibility, fixture.view.seat)),
      fixture.id,
    )
    assert.ok(fixture.view.players.every((player) =>
      !Object.hasOwn(player, 'role') && !Object.hasOwn(player, 'alignment')),
    )
  }
})
