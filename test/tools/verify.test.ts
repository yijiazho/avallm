// test-lane: fast
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Verification is an executable JavaScript tool, not a server module.
// @ts-expect-error The test supplies the narrow runtime contract below.
import * as verificationModule from '../../tools/verify.mjs'

const {
  runVerification,
  verificationPlan,
} = verificationModule as {
  verificationPlan(requested: string): readonly {
    readonly label: string
    readonly args: string[]
  }[]
  runVerification(
    requested: string,
    spawn?: (
      command: string,
      args: string[],
    ) => { status: number | null; error?: Error },
    isAvailable?: (path: string) => boolean,
    reportError?: (message: string) => void,
  ): number
}

const TYPECHECK = [
  'node_modules/typescript/bin/tsc',
  '-p',
  'tsconfig.server.json',
]
const CLIENT_TYPECHECK = [
  'node_modules/typescript/bin/tsc',
  '-p',
  'client/tsconfig.json',
]
const TEST_RATCHET = ['tools/strict-test-ratchet.mjs']
const ARCHITECTURE = ['tools/architecture-fitness.mjs']
const ACYCLICITY = ['tools/import-cycles.mjs']
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
      CLIENT_TYPECHECK,
      TEST_RATCHET,
      ARCHITECTURE,
      ACYCLICITY,
      INVENTORY,
      ['tools/test-lanes.mjs', 'fast'],
    ],
  )
  assert.deepEqual(
    verificationPlan('contract').map((step) => step.args),
    [
      TYPECHECK,
      CLIENT_TYPECHECK,
      TEST_RATCHET,
      ARCHITECTURE,
      ACYCLICITY,
      INVENTORY,
      ['tools/test-lanes.mjs', 'fast'],
      ['tools/test-lanes.mjs', 'contract'],
    ],
  )
  assert.deepEqual(
    verificationPlan('full').map((step) => step.args),
    [
      TYPECHECK,
      CLIENT_TYPECHECK,
      TEST_RATCHET,
      ARCHITECTURE,
      ACYCLICITY,
      INVENTORY,
      ['tools/test-lanes.mjs', 'full'],
    ],
  )
})

test('verification fails closed before tests when lane inventory fails', () => {
  const calls: string[][] = []
  const status = runVerification('full', (_command, args) => {
    calls.push(args)
    return { status: calls.length === 6 ? 17 : 0 }
  }, () => true)

  assert.equal(status, 17)
  assert.deepEqual(calls, [
    TYPECHECK,
    CLIENT_TYPECHECK,
    TEST_RATCHET,
    ARCHITECTURE,
    ACYCLICITY,
    INVENTORY,
  ])
})

test('verification stops at the first failing test lane', () => {
  const calls: string[][] = []
  const status = runVerification('contract', (_command, args) => {
    calls.push(args)
    return { status: calls.length === 7 ? 23 : 0 }
  }, () => true)

  assert.equal(status, 23)
  assert.deepEqual(calls, [
    TYPECHECK,
    CLIENT_TYPECHECK,
    TEST_RATCHET,
    ARCHITECTURE,
    ACYCLICITY,
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
      return { status: calls.length === 4 ? 19 : 0 }
    },
    () => true,
  )

  assert.equal(status, 19)
  assert.deepEqual(calls, [
    TYPECHECK,
    CLIENT_TYPECHECK,
    TEST_RATCHET,
    ARCHITECTURE,
  ])
})

test('verification stops before test inventory when import cycles are found', () => {
  const calls: string[][] = []
  const status = runVerification(
    'quick',
    (_command, args) => {
      calls.push(args)
      return { status: calls.length === 5 ? 21 : 0 }
    },
    () => true,
  )

  assert.equal(status, 21)
  assert.deepEqual(calls, [
    TYPECHECK,
    CLIENT_TYPECHECK,
    TEST_RATCHET,
    ARCHITECTURE,
    ACYCLICITY,
  ])
})

test('verification stops before architecture when the strict test ratchet fails', () => {
  const calls: string[][] = []
  const status = runVerification(
    'quick',
    (_command, args) => {
      calls.push(args)
      return { status: calls.length === 3 ? 29 : 0 }
    },
    () => true,
  )

  assert.equal(status, 29)
  assert.deepEqual(calls, [TYPECHECK, CLIENT_TYPECHECK, TEST_RATCHET])
})

test('verification explains missing client type deps without spawning', () => {
  const calls: string[][] = []
  const errors: string[] = []
  const status = runVerification(
    'quick',
    (_command, args) => {
      calls.push(args)
      return { status: 0 }
    },
    (path) => path !== 'client/node_modules/@types/react/package.json',
    (message) => errors.push(message),
  )

  // The client typecheck is the one gate whose dependency lives outside the
  // root install, so a checkout that ran npm ci but not the client install has
  // to be told which command to run rather than dropped into tsc's
  // unresolved-module output. Nothing spawns: the gate is refused up front,
  // including the server typecheck that would otherwise have passed.
  assert.equal(status, 1)
  assert.deepEqual(calls, [])
  assert.deepEqual(errors, [
    'Client type dependencies are missing; run npm --prefix client install.',
  ])
})
