import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TYPESCRIPT_BIN = 'node_modules/typescript/bin/tsc'

// The client's React types live under client/, which is a separate install from
// the root dev tooling. The gate names that dependency so a missing install
// reports what to run instead of failing inside tsc with unresolved-module noise.
const CLIENT_TYPES = 'client/node_modules/@types/react/package.json'

const COMMON_GATES = Object.freeze([
  Object.freeze({
    label: 'strict server typecheck',
    args: Object.freeze([
      TYPESCRIPT_BIN,
      '-p',
      'tsconfig.server.json',
    ]),
  }),
  // vite build does not typecheck, so without this gate the client is the one
  // part of the tree that ships with no type coverage at all.
  Object.freeze({
    label: 'strict client typecheck',
    args: Object.freeze([
      TYPESCRIPT_BIN,
      '-p',
      'client/tsconfig.json',
    ]),
    requires: CLIENT_TYPES,
    missing: 'Client type dependencies are missing; '
      + 'run npm --prefix client install.',
  }),
  Object.freeze({
    label: 'strict test ratchet',
    args: Object.freeze(['tools/strict-test-ratchet.mjs']),
  }),
  Object.freeze({
    label: 'architecture fitness',
    args: Object.freeze(['tools/architecture-fitness.mjs']),
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
  // Every declared dependency is checked before anything spawns, so a missing
  // install reports once up front rather than after some gates have already run.
  for (const step of plan) {
    if (step.requires && !isAvailable(step.requires)) {
      // A gate that declares a dependency but forgets its message would
      // otherwise exit reporting the literal string "undefined", in the one
      // path whose whole job is naming the install command.
      reportError(step.missing
        ?? `${step.label} requires ${step.requires}, which is missing.`)
      return 1
    }
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
