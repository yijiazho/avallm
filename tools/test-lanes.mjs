// Test lane classifier and runner.
//
// Every test file declares its own lane on one of its first lines:
//
//   // test-lane: contract
//
// and this tool walks the tree and reads those markers. It used to hold the
// classification itself, as five hand-maintained arrays of basenames, and
// those arrays were the reason `test:lanes` had to exist at all: a list kept
// by hand beside a directory kept by the filesystem drifts, so a separate gate
// was needed to notice. Deriving the classification removes the drift instead
// of checking for it. Both failure messages survive, because the invariant did
// not change: a file with no marker is unclassified, a file with two is
// double-classified, and each still fails closed before any test runs.
//
// The marker is a comment rather than an export so it costs the file nothing
// else: no import, no unused binding for the strict ratchet's noUnusedLocals
// to catch, and no edge in the module graph.
//
// Lane is a COST axis; the directory tree is a SUBJECT axis; the two do not
// line up. test/agents/belief/ alone holds fast, contract, eval, and perf
// members, and test/eval/ is mostly the eval lane but its statistics, norms,
// and probe tests are fast. Deriving lanes from the path instead would force a
// slow test to be filed away from the module it covers, which is the flat
// namespace this tree exists to escape. So the marker is the authority.
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const LANE_NAMES = Object.freeze(['fast', 'contract', 'eval', 'exhaustive', 'perf'])

const MARKER = /^\/\/ test-lane: ([a-z]+)$/
// How far into a file the marker may sit: generous enough that a file may lead
// with its explanatory header, small enough that the scan cannot read a
// marker-shaped line out of the test body.
const HEADER_LINES = 10

// Directories under test/ that hold no lane members: shared scaffolding,
// type-only contracts, and fixture data. Skipped rather than reported as
// unclassified, which is what the old tool did by only ever listing the top
// level.
const NON_LANE_DIRECTORIES = Object.freeze(['support', 'helpers', 'typecheck', 'fixtures'])

function normalize(value) {
  return value.replaceAll('\\', '/')
}

function discoverTests(root = 'test') {
  const found = []
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = normalize(path.join(directory, entry.name))
      if (entry.isDirectory()) {
        if (NON_LANE_DIRECTORIES.includes(entry.name)) continue
        pending.push(full)
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        found.push(full)
      }
    }
  }
  return found.sort()
}

function laneOf(file) {
  const header = readFileSync(file, 'utf8').split('\n').slice(0, HEADER_LINES)
  const hits = header
    .map((line) => MARKER.exec(line.trimEnd()))
    .filter(Boolean)
    .map((hit) => hit[1])
  if (hits.length === 0) {
    return { error: `${file} declares no "// test-lane:" marker` }
  }
  if (hits.length > 1) {
    return { error: `${file} is classified in both ${hits[0]} and ${hits[1]}` }
  }
  if (!LANE_NAMES.includes(hits[0])) {
    return { error: `${file} names unknown lane "${hits[0]}"` }
  }
  return { lane: hits[0] }
}

function classifiedTests() {
  const errors = []
  const lanes = Object.fromEntries(LANE_NAMES.map((name) => [name, []]))
  for (const file of discoverTests()) {
    const result = laneOf(file)
    if (result.error) {
      errors.push(result.error)
      continue
    }
    lanes[result.lane].push(file)
  }
  if (errors.length) {
    throw new Error(`test lane classification is stale:\n  ${errors.join('\n  ')}`)
  }
  return Object.freeze(lanes)
}

let LANES
try {
  LANES = classifiedTests()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const allTests = LANE_NAMES.flatMap((name) => LANES[name]).sort()

const requested = process.argv[2] ?? 'full'
if (requested === '--check') {
  console.log(
    `${allTests.length} test files classified across `
      + `${LANE_NAMES.length} lanes`,
  )
  process.exit(0)
}

if (requested !== 'full' && !LANES[requested]) {
  console.error(
    `unknown test lane "${requested}"; expected `
      + `${[...LANE_NAMES, 'full'].join(', ')}`,
  )
  process.exit(1)
}

function run(label, files) {
  console.log(`[test:${label}] ${files.length} files`)
  // Discovery already yields repo-relative paths, so nothing is prefixed here.
  const result = spawnSync(
    process.execPath,
    ['--test', ...files],
    { stdio: 'inherit' },
  )
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}

if (requested === 'full') {
  const perfFiles = new Set(LANES.perf)
  const correctness = allTests.filter((file) => !perfFiles.has(file))
  const correctnessStatus = run('full:correctness', correctness)
  if (correctnessStatus !== 0) process.exit(correctnessStatus)
  process.exit(run('full:perf', LANES.perf))
}

process.exit(run(requested, LANES[requested]))
