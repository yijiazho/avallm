// test-lane: fast
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentDef, TableSeat } from '../../server/agents/defs.ts'
import { agentDescriptor, publicInfo } from '../../server/agents/defs.ts'
import { buildBotSeatPlans } from '../../server/bot-seat-plan.ts'

const ruleBased: AgentDef = {
  id: 'autopilot',
  name: 'Rule-based',
  version: 1,
  engine: { type: 'heuristic' },
  tier: 'builtin',
}

const modelBacked: AgentDef = {
  id: 'raw-llm',
  name: 'Raw LLM',
  version: 1,
  engine: { type: 'llm', model: 'default-model' },
  tier: 'builtin',
}

const definitions = new Map([
  [ruleBased.id, ruleBased],
  [modelBacked.id, modelBacked],
])

function resolveDef(tableSeat: TableSeat): AgentDef {
  const def = definitions.get(tableSeat.agent)
  if (!def) throw new Error(`unknown test agent ${tableSeat.agent}`)
  return def
}

test('bot seat plans join each seat, table choice, alias, and identity once', () => {
  const table: TableSeat[] = [
    { agent: 'autopilot' },
    { agent: 'raw-llm', model: 'seat-model' },
  ]
  const plans = buildBotSeatPlans({
    playerCount: 5,
    seats: [1, 4],
    table,
    aliases: ['Ash', 'Vale'],
    resolveDef,
  })

  assert.deepEqual(plans.map(({ seat, alias }) => ({ seat, alias })), [
    { seat: 1, alias: 'Ash' },
    { seat: 4, alias: 'Vale' },
  ])
  assert.notStrictEqual(plans[0]!.identity.def, ruleBased, 'the seated definition is a snapshot')
  assert.deepEqual(plans[0]!.identity.info, publicInfo(ruleBased))
  assert.equal(plans[0]!.identity.descriptor, agentDescriptor(ruleBased))
  assert.equal(plans[1]!.identity.model, 'seat-model')
  assert.deepEqual(plans[1]!.identity.info, publicInfo(modelBacked, 'seat-model'))
  assert.equal(plans[1]!.identity.descriptor, agentDescriptor(modelBacked, 'seat-model'))
})

test('bot seat plans reject misaligned inputs before resolving any definition', () => {
  let resolveCalls = 0
  assert.throws(
    () => buildBotSeatPlans({
      playerCount: 5,
      seats: [1, 4],
      table: [{ agent: 'autopilot' }],
      aliases: ['Ash', 'Vale'],
      resolveDef: (tableSeat) => {
        resolveCalls += 1
        return resolveDef(tableSeat)
      },
    }),
    /inputs disagree: seats=2, table=1, aliases=2/,
  )
  assert.equal(resolveCalls, 0)
})

test('bot seat plans reject invalid rows before resolving any definition', () => {
  const unexpectedResolve = (_tableSeat: TableSeat): AgentDef => {
    throw new Error('resolved a definition before validating every row')
  }
  assert.throws(
    () => buildBotSeatPlans({
      playerCount: 5,
      seats: [2, 2],
      table: [{ agent: 'autopilot' }, { agent: 'raw-llm' }],
      aliases: ['Ash', 'Vale'],
      resolveDef: unexpectedResolve,
    }),
    /duplicate bot seat 2/,
  )

  const sparseTable = Array<TableSeat>(1)
  assert.throws(
    () => buildBotSeatPlans({
      playerCount: 5,
      seats: [2],
      table: sparseTable,
      aliases: ['Ash'],
      resolveDef: unexpectedResolve,
    }),
    /incomplete bot seat plan at index 0/,
  )

  assert.throws(
    () => buildBotSeatPlans({
      playerCount: 5,
      seats: [5],
      table: [{ agent: 'autopilot' }],
      aliases: ['Ash'],
      resolveDef: unexpectedResolve,
    }),
    /invalid bot seat 5 at index 0/,
  )
})
