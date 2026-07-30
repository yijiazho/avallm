// Migration phase 7R2C4B; see docs/agent-architecture-migration.md.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const fixtureFile = 'test/fixtures/decision-frame-oracle.json'
const captureTool = 'tools/capture-decision-frame-oracle.mjs'
const expectedBase = '5354c2c3a973355af1d66b03e2213dc1e5c93cb8'

interface BaselineScenario {
  id: string
  decision: unknown
  traceHash: string
  stages: string[]
  plannerInputHash: string | null
  voiceInputHash: string | null
}

interface Baseline {
  schema: number
  capturedFrom: string
  sourceDirty: boolean
  scenarios: BaselineScenario[]
}

function correctedStageOrder(stages: readonly string[]): readonly string[] {
  const result = [...stages]
  const analysis = result.indexOf('analysis')
  const candidates = result.indexOf('candidates')
  if (analysis >= 0 && candidates === analysis + 1) {
    result.splice(analysis, 2, 'candidates', 'analysis')
  }
  return result
}

test('live DecisionFrame execution matches the independent pre-C4 oracle', () => {
  const expected = JSON.parse(
    fs.readFileSync(fixtureFile, 'utf8'),
  ) as Baseline
  assert.equal(expected.schema, 1)
  assert.equal(expected.capturedFrom, expectedBase)
  assert.equal(expected.sourceDirty, false)

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'avallm-c4b-'))
  const currentFile = path.join(temp, 'current.json')
  try {
    execFileSync(
      process.execPath,
      [captureTool, '.', currentFile],
      { stdio: 'pipe' },
    )
    const current = JSON.parse(
      fs.readFileSync(currentFile, 'utf8'),
    ) as Baseline
    assert.deepEqual(
      current.scenarios,
      expected.scenarios.map((scenario) => ({
        ...scenario,
        stages: correctedStageOrder(scenario.stages),
      })),
    )
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
