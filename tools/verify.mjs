import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TYPESCRIPT_BIN = 'node_modules/typescript/bin/tsc'

const COMMON_GATES = Object.freeze([
  Object.freeze({
    label: 'strict server typecheck',
    args: Object.freeze([
      TYPESCRIPT_BIN,
      '-p',
      'tsconfig.server.json',
    ]),
  }),
  Object.freeze({
    label: 'test lane inventory',
    args: Object.freeze(['tools/test-lanes.mjs', '--check']),
  }),
])

const TEST_STEPS = Object.freeze({
  quick: Object.freeze([
    Object.freeze({
      label: 'fast tests',
      args: Object.freeze(['tools/test-lanes.mjs', 'fast']),
    }),
  ]),
  contract: Object.freeze([
    Object.freeze({
      label: 'fast tests',
      args: Object.freeze(['tools/test-lanes.mjs', 'fast']),
    }),
    Object.freeze({
      label: 'contract tests',
      args: Object.freeze(['tools/test-lanes.mjs', 'contract']),
    }),
  ]),
  full: Object.freeze([
    Object.freeze({
      label: 'complete API-free suite',
      args: Object.freeze(['tools/test-lanes.mjs', 'full']),
    }),
  ]),
})

export function verificationPlan(requested) {
  const testSteps = TEST_STEPS[requested]
  if (!testSteps) {
    throw new Error(
      `unknown verification level "${requested}"; expected `
        + `${Object.keys(TEST_STEPS).join(', ')}`,
    )
  }
  return Object.freeze([...COMMON_GATES, ...testSteps])
}

export function runVerification(
  requested,
  spawn = spawnSync,
  isAvailable = existsSync,
  reportError = console.error,
) {
  const plan = verificationPlan(requested)
  if (!isAvailable(TYPESCRIPT_BIN)) {
    reportError('TypeScript dev tooling is missing; run npm ci.')
    return 1
  }
  for (const step of plan) {
    console.log(`[verify:${requested}] ${step.label}`)
    const result = spawn(process.execPath, [...step.args], { stdio: 'inherit' })
    if (result.error) {
      console.error(result.error.message)
      return 1
    }
    if (result.status !== 0) return result.status ?? 1
  }
  return 0
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  const requested = process.argv[2]
  try {
    process.exitCode = runVerification(requested)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
