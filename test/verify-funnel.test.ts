import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  runVerification,
  verificationPlan,
} from '../tools/verify.mjs'

const TYPECHECK = [
  'node_modules/typescript/bin/tsc',
  '-p',
  'tsconfig.server.json',
]
const ARCHITECTURE = ['tools/architecture-fitness.mjs']
const INVENTORY = ['tools/test-lanes.mjs', '--check']

test('root verification scripts cannot bypass the funnel', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.deepEqual(
    {
      test: packageJson.scripts.test,
      testFull: packageJson.scripts['test:full'],
      quick: packageJson.scripts['verify:quick'],
      contract: packageJson.scripts['verify:contract'],
      full: packageJson.scripts['verify:full'],
    },
    {
      test: 'node tools/verify.mjs full',
      testFull: 'node tools/verify.mjs full',
      quick: 'node tools/verify.mjs quick',
      contract: 'node tools/verify.mjs contract',
      full: 'node tools/verify.mjs full',
    },
  )
})

test('verification levels compose the intended cumulative checks', () => {
  assert.deepEqual(
    verificationPlan('quick').map((step) => step.args),
    [
      TYPECHECK,
      ARCHITECTURE,
      INVENTORY,
      ['tools/test-lanes.mjs', 'fast'],
    ],
  )
  assert.deepEqual(
    verificationPlan('contract').map((step) => step.args),
    [
      TYPECHECK,
      ARCHITECTURE,
      INVENTORY,
      ['tools/test-lanes.mjs', 'fast'],
      ['tools/test-lanes.mjs', 'contract'],
    ],
  )
  assert.deepEqual(
    verificationPlan('full').map((step) => step.args),
    [
      TYPECHECK,
      ARCHITECTURE,
      INVENTORY,
      ['tools/test-lanes.mjs', 'full'],
    ],
  )
})

test('verification fails closed before tests when lane inventory fails', () => {
  const calls: string[][] = []
  const status = runVerification('full', (_command, args) => {
    calls.push(args)
    return { status: calls.length === 3 ? 17 : 0 }
  }, () => true)

  assert.equal(status, 17)
  assert.deepEqual(calls, [TYPECHECK, ARCHITECTURE, INVENTORY])
})

test('verification stops at the first failing test lane', () => {
  const calls: string[][] = []
  const status = runVerification('contract', (_command, args) => {
    calls.push(args)
    return { status: calls.length === 4 ? 23 : 0 }
  }, () => true)

  assert.equal(status, 23)
  assert.deepEqual(calls, [
    TYPECHECK,
    ARCHITECTURE,
    INVENTORY,
    ['tools/test-lanes.mjs', 'fast'],
  ])
})

test('verification rejects unknown levels without spawning work', () => {
  let called = false
  assert.throws(
    () => runVerification('typo', () => {
      called = true
      return { status: 0 }
    }, () => true),
    /unknown verification level/,
  )
  assert.equal(called, false)
})

test('verification explains missing development tooling without spawning', () => {
  const calls: string[][] = []
  const errors: string[] = []
  const status = runVerification(
    'quick',
    (_command, args) => {
      calls.push(args)
      return { status: 0 }
    },
    (path) => {
      assert.equal(path, 'node_modules/typescript/bin/tsc')
      return false
    },
    (message) => errors.push(message),
  )

  assert.equal(status, 1)
  assert.deepEqual(calls, [])
  assert.deepEqual(errors, ['TypeScript dev tooling is missing; run npm ci.'])
})

test('verification stops before test inventory when architecture fails', () => {
  const calls: string[][] = []
  const status = runVerification(
    'quick',
    (_command, args) => {
      calls.push(args)
      return { status: calls.length === 2 ? 19 : 0 }
    },
    () => true,
  )

  assert.equal(status, 19)
  assert.deepEqual(calls, [TYPECHECK, ARCHITECTURE])
})
