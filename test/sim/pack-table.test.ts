// test-lane: fast
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentDef, TableSeat } from '../../server/agents/defs.ts'
import { agentDescriptor, publicInfo } from '../../server/agents/defs.ts'
import { resolvePackSeatTable } from '../../server/sim/pack-table.ts'

const ruleBased: AgentDef = {
  id: 'autopilot',
  name: 'Rule-based',
  engine: { type: 'heuristic' },
  tier: 'builtin',
}

const modelBacked: AgentDef = {
  id: 'raw-llm',
  name: 'Raw LLM',
  engine: { type: 'llm', model: 'suggested-model' },
  tier: 'builtin',
}

test('a resolved pack table exposes one complete identity per seat', () => {
  const table = resolvePackSeatTable(
    [
      { agent: 'autopilot' },
      { agent: 'raw-llm', model: 'seat-model' },
    ],
    [ruleBased, modelBacked],
  )

  assert.equal(table.identities.length, 2)
  assert.notStrictEqual(table.identityAt(0).def, ruleBased, 'pack identities snapshot library defs')
  assert.deepEqual(table.identityAt(0).info, publicInfo(ruleBased))
  assert.equal(table.identityAt(0).descriptor, agentDescriptor(ruleBased))
  assert.equal(table.identityAt(1).model, 'seat-model')
  assert.deepEqual(table.identityAt(1).info, publicInfo(modelBacked, 'seat-model'))
  assert.equal(table.identityAt(1).descriptor, agentDescriptor(modelBacked, 'seat-model'))
})

test('pack table resolution rejects incomplete casts at construction', () => {
  assert.throws(
    () => resolvePackSeatTable([{ agent: 'missing' }], [ruleBased]),
    /pack seat 0 names missing agent "missing"/,
  )

  const sparse = Array<TableSeat>(1)
  assert.throws(
    () => resolvePackSeatTable(sparse, [ruleBased]),
    /pack seat table is sparse at seat 0/,
  )
  assert.throws(() => resolvePackSeatTable([], [ruleBased]), /cannot be empty/)
})

test('pack table seat lookup is total only inside the resolved cast', () => {
  const table = resolvePackSeatTable([{ agent: 'autopilot' }], [ruleBased])
  assert.throws(() => table.identityAt(-1), /missing pack seat -1/)
  assert.throws(() => table.identityAt(1), /missing pack seat 1/)
  assert.throws(() => table.identityAt(0.5), /missing pack seat 0.5/)
})
