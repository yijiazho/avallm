// test-lane: fast
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Architecture fitness is an executable JavaScript tool, not a server module.
// @ts-expect-error The test supplies the narrow runtime contract below.
import * as architectureModule from '../../tools/architecture-fitness.mjs'

interface ArchitectureViolation {
  readonly rule: string
  readonly importer: string
  readonly specifier?: string
  readonly line?: number
  readonly message: string
}

const {
  AGENT_DIRECTORY_TIERS,
  auditArchitectureSources,
  checkRepositoryArchitecture,
  checkStrictTestRatchetOwnership,
  inspectSource,
} = architectureModule as {
  AGENT_DIRECTORY_TIERS: ReadonlyMap<string, number>
  auditArchitectureSources(
    sources: ReadonlyArray<readonly [string, unknown]>,
  ): readonly ArchitectureViolation[]
  checkRepositoryArchitecture(root?: string): readonly ArchitectureViolation[]
  checkStrictTestRatchetOwnership(
    root?: string,
  ): readonly ArchitectureViolation[]
  inspectSource(path: string, source: string): {
    readonly edges: readonly {
      readonly kind: 'import' | 'export'
      readonly specifier: string
      readonly names: readonly string[]
      readonly namespace: boolean
      readonly locals: readonly string[]
      /** Erased at compile time, so it carries no runtime behavior. */
      readonly typeOnly: boolean
      readonly line: number
    }[]
    readonly ambientReads: ReadonlySet<string>
    readonly scopedBindings: ReadonlySet<string>
  }
}

function rules(sources: ReadonlyArray<readonly [string, unknown]>): string[] {
  return auditArchitectureSources(sources).map((violation) => violation.rule)
}

test('repository sources satisfy the coarse architecture fitness rules', () => {
  assert.deepEqual(checkRepositoryArchitecture(), [])
})

test('runtime and admission cannot rebuild scorer-sensitive situation analysis', () => {
  for (const owner of [
    'server/agents/policy/decision-frame.ts',
    'server/agents/admission/composed-trace.ts',
  ]) {
    const violations = auditArchitectureSources([[
      owner,
      'import { analyzeSituation } from "../analysis/situation.ts"\n',
    ]])
    assert.deepEqual(
      violations.map(({ rule }) => rule),
      ['ARCH008'],
      owner,
    )
    assert.match(
      violations[0]!.message,
      /scorer-situation-surface/,
      owner,
    )
  }
})

test('server consumers cannot bypass closed trace admission results', () => {
  const admission = '../agents/admission/composed-trace.ts'
  const violations = auditArchitectureSources([
    [
      'server/eval/named.ts',
      `import {
        validateComposedTraceHostJoin
      } from "${admission}"\n`,
    ],
    [
      'server/eval/aliased.ts',
      `import {
        validateFinalizedDiagnosticDecisionTrace as validate
      } from "${admission}"\n`,
    ],
    [
      'server/eval/namespace.ts',
      `import * as admission from "${admission}"\n`,
    ],
    [
      'server/eval/dynamic.ts',
      `const admission = await import("${admission}")\n`,
    ],
    [
      'server/eval/export-star.ts',
      `export * from "${admission}"\n`,
    ],
    [
      'server/eval/re-export.ts',
      `export {
        validateSuppressedEvilQuestCardPolicyHostJoin as validate
      } from "${admission}"\n`,
    ],
  ])
  assert.deepEqual(
    violations.map(({ rule }) => rule),
    Array(6).fill('ARCH009'),
  )
  for (const violation of violations) {
    assert.match(violation.message, /closed trace admission result/)
  }
  assert.deepEqual(
    auditArchitectureSources([[
      'server/eval/example.ts',
      `import {
        admitDecisionTrace
      } from "../agents/admission/composed-trace.ts"\n`,
    ]]),
    [],
  )
})

test('transport canonicalization is confined to trace admission ingress', () => {
  const canonical = '../agents/canonical/canonical-json.ts'
  const violations = auditArchitectureSources([
    [
      'server/eval/named.ts',
      `import { canonicalizeTransportJson } from "${canonical}"\n`,
    ],
    [
      'server/eval/aliased.ts',
      `export {
        canonicalizeTransportJson as snapshot
      } from "${canonical}"\n`,
    ],
    [
      'server/eval/namespace.ts',
      `const canonical = await import("${canonical}")\n`,
    ],
  ])
  assert.deepEqual(
    violations.map(({ rule }) => rule),
    Array(3).fill('ARCH010'),
  )
  assert.deepEqual(
    auditArchitectureSources([[
      'server/eval/strict.ts',
      `import { canonicalizeJson } from "${canonical}"\n`,
    ]]),
    [],
  )
})

test('the strict test ratchet is the only test typecheck inventory', () => {
  assert.equal(existsSync('tsconfig.score-layer-contract.json'), false)

  const testConfigOwners = readdirSync('.')
    .filter((file) => /^tsconfig(?:\.[^.]+)*\.json$/.test(file))
    .filter((file) => {
      const config = JSON.parse(readFileSync(file, 'utf8'))
      return (config.include ?? []).some(
        (pattern: unknown) =>
          typeof pattern === 'string' && /^test[\\/]/.test(pattern),
      )
    })
  assert.deepEqual(testConfigOwners, [])

  const baselineOwners = readdirSync('tools')
    .filter((file) => file.endsWith('.mjs'))
    .filter((file) =>
      readFileSync(`tools/${file}`, 'utf8')
        .includes('strict-test-baseline.json'))
  assert.deepEqual(baselineOwners, ['strict-test-ratchet.mjs'])

  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(
    packageJson.scripts.typecheck,
    'tsc -p tsconfig.server.json && tsc -p client/tsconfig.json'
      + ' && node tools/strict-test-ratchet.mjs',
  )
  assert.doesNotMatch(
    readFileSync('tools/architecture-fitness.mjs', 'utf8'),
    /scoreLayerContractInventoryViolations/,
  )
})

test('strict test ownership rejects hidden roots, references, and malformed shapes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'avalon-strict-ownership-'))
  try {
    mkdirSync(path.join(root, 'tools'))
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          typecheck:
            'tsc -p tsconfig.server.json && tsc -p client/tsconfig.json'
              + ' && node tools/strict-test-ratchet.mjs',
        },
      }),
    )
    writeFileSync(path.join(root, 'tools', 'strict-test-ratchet.mjs'), '')
    mkdirSync(path.join(root, 'server'))
    mkdirSync(path.join(root, 'test'))
    writeFileSync(path.join(root, 'server', 'placeholder.ts'), 'export {}\n')
    writeFileSync(path.join(root, 'test', 'hidden.test.ts'), 'export {}\n')
    writeFileSync(
      path.join(root, 'tsconfig.server.json'),
      JSON.stringify({
        compilerOptions: { strict: true },
        include: ['server/**/*.ts'],
      }),
    )
    assert.deepEqual(checkStrictTestRatchetOwnership(root), [])

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ files: ['test\\hidden.test.ts'] }),
    )
    let violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.equal(violations[0]!.rule, 'ARCH021')
    assert.match(violations[0]!.message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0]!.message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['*/**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0]!.message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['./test/**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0]!.message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({
        files: ['server/placeholder.ts'],
        references: [{ path: './nested' }],
      }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0]!.message, /project references are rejected/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: {}, files: 'test/hidden.test.ts' }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0]!.message, /TypeScript config is invalid/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the engine cannot read a clock, a random, or the filesystem', () => {
  const engine = (body: string) =>
    rules([['server/engine/rules.ts', body]])
      .filter((rule) => rule === 'ARCH014')

  // A nondeterministic engine still passes every assertion that does not
  // happen to compare two runs, which is why this needs a rule and not a test.
  assert.deepEqual(engine('export const t = () => Date.now()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => new Date().getTime()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => Math.random()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => crypto.randomUUID()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => globalThis.crypto.randomUUID()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => Date()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => fetch("https://example.com")'), ['ARCH014'])
  assert.deepEqual(engine('export const t = process.env.SEED'), ['ARCH014'])
  assert.deepEqual(engine('export const t = process["env"].SEED'), ['ARCH014'])
  assert.deepEqual(engine('const { env } = process; export const t = env.SEED'), ['ARCH014'])
  assert.deepEqual(
    engine("import { readFileSync } from 'node:fs'"),
    ['ARCH014'],
    'I/O import',
  )
  assert.deepEqual(
    engine("import ky from 'ky'"),
    ['ARCH014'],
    'the production server carries no runtime dependencies',
  )

  // Qualified reads only: a parameter called `now` reads no clock, and the
  // pure corners of Date and the standard library stay available.
  assert.deepEqual(engine('export const t = (now: number) => now + 1'), [])
  assert.deepEqual(engine('export const t = () => Date.UTC(2026, 0, 1)'), [])
  assert.deepEqual(engine("import { isDeepStrictEqual } from 'node:util'"), [])
  assert.deepEqual(engine("import { x } from './types.ts'"), [])

  // `process` is an ordinary word for a handler or a field. Only a qualified
  // read reaches the global, and flagging the rest would demand renaming a
  // domain concept to satisfy a rule about ambient state.
  assert.deepEqual(engine('export interface H { process: boolean }'), [])
  assert.deepEqual(engine('export const h = { process: (x: number) => x }'), [])
  assert.deepEqual(engine('export const f = (process: number) => process + 1'), [])
  assert.deepEqual(engine('export const f = (fetch: () => number) => fetch()'), [])
  assert.deepEqual(engine('export const f = (h: { process: number }) => h.process'), [])
  assert.deepEqual(engine('export const t = () => process.hrtime()'), ['ARCH014'])

  // The rule is scoped to the engine. Everything above it may read a clock,
  // and several modules do.
  assert.deepEqual(
    rules([['server/eval/judge.ts', 'export const t = () => Date.now()']])
      .filter((rule) => rule === 'ARCH014'),
    [],
  )
})

test('shared primitives cannot acquire a domain or an ambient read', () => {
  const shared = (body: string) =>
    rules([['server/shared/lru.ts', body]])
      .filter((rule) => rule === 'ARCH019')

  // The domain half. Every one of these is the first step of the same slide:
  // the folder keeps its name and quietly stops being importable by anything.
  assert.deepEqual(
    shared("import type { Seat } from '../engine/types.ts'"),
    ['ARCH019'],
    'the engine is a domain, even for one type',
  )
  assert.deepEqual(
    shared("import { x } from '../agents/policy/decision-frame.ts'"),
    ['ARCH019'],
  )
  assert.deepEqual(shared("import { x } from '../eval/report.ts'"), ['ARCH019'])
  assert.deepEqual(shared("import { x } from '../llm/roster.ts'"), ['ARCH019'])
  assert.deepEqual(shared("import { x } from 'server/sim/sim.ts'"), ['ARCH019'])

  // Every in-repo target, not only the ones under server/. A relative
  // specifier is never bare, so the purity half cannot see these either: if
  // the domain half skipped them, client/ and tools/ would be an unguarded
  // way into the folder.
  assert.deepEqual(
    shared("export type { Foo } from '../../client/src/types.ts'"),
    ['ARCH019'],
    'sharing a type with the client is still acquiring a domain',
  )
  assert.deepEqual(shared("import { x } from '../../tools/hotspots.mjs'"), ['ARCH019'])

  // The purity half. The engine imports this folder, so an ambient read here
  // is engine impurity ARCH014 never sees: it inspects engine files only, and
  // the edge into server/shared/ is not a bare specifier.
  assert.deepEqual(shared('export const t = () => Date.now()'), ['ARCH019'])
  assert.deepEqual(shared('export const t = () => Math.random()'), ['ARCH019'])
  assert.deepEqual(shared('export const t = process.env.SEED'), ['ARCH019'])
  assert.deepEqual(shared("import { readFileSync } from 'node:fs'"), ['ARCH019'])

  // What the folder is for stays legal: siblings, pure standard library, and
  // the type-level and arithmetic work the four current modules actually do.
  assert.deepEqual(shared("import { LruMap } from './lru.ts'"), [])
  assert.deepEqual(shared("import { isDeepStrictEqual } from 'node:util'"), [])
  assert.deepEqual(shared('export const t = (seed: number) => Math.imul(seed, 3)'), [])

  // The rule is scoped to the folder. Every layer above it may import freely.
  assert.deepEqual(
    rules([['server/agents/heuristic.ts', "import { x } from '../engine/types.ts'"]])
      .filter((rule) => rule === 'ARCH019'),
    [],
  )
})

test('prompt builders cannot read ambient state into the cacheable prefix', () => {
  const at = (file: string, body: string) =>
    rules([[file, body]]).filter((rule) => rule === 'ARCH015')

  // The stable prefix is assembled from module constants so provider prompt
  // caches hit. A per-process value baked into it busts the cache for every
  // call of every process and reddens nothing, because no assertion in the
  // suite compares two processes.
  assert.deepEqual(
    at('server/agents/raw-llm/prompts.ts', 'export const t = `s ${Date.now()}`'),
    ['ARCH015'],
  )
  assert.deepEqual(
    at('server/agents/raw-llm/prompts.ts', 'export const t = Math.random()'),
    ['ARCH015'],
  )
  assert.deepEqual(
    at('server/agents/board.ts', 'export const t = process.env.X'),
    ['ARCH015'],
  )
  assert.deepEqual(
    at('server/agents/raw-llm/prompts.ts', "import { readFileSync } from 'node:fs'"),
    ['ARCH015'],
  )

  // The dossier lever is allowed by name, not by file. A second ambient read
  // in the same module is still a violation, so the exception cannot widen
  // into a general exemption.
  assert.deepEqual(
    at(
      'server/agents/raw-llm/facts.ts',
      "export const on = () => process.env.AVALON_NO_DOSSIER !== '1'",
    ),
    [],
    'the documented eval A/B lever',
  )
  assert.deepEqual(
    at('server/agents/raw-llm/facts.ts', 'export const t = () => Date.now()'),
    ['ARCH015'],
    'a second ambient read in the same module',
  )
  assert.deepEqual(
    at('server/agents/raw-llm/facts.ts', 'export const t = process.env.SOME_NEW_FLAG'),
    ['ARCH015'],
    'the allowlist names one variable, not the whole of process.env',
  )

  // Scoped to the builders. The LLM adapter reads its own env lever and is
  // not assembling a cacheable prefix.
  assert.deepEqual(
    at('server/agents/raw-llm/agent.ts', 'export const t = process.env.AVALON_REFLECT_CADENCE'),
    [],
  )
  assert.deepEqual(
    at('server/agents/raw-llm/prompts.ts', "import { isDeepStrictEqual } from 'node:util'"),
    [],
  )
})

test('an unowned magnitude is unowned in every area, not just the agent tree', () => {
  const arch017 = (file: string, body: string) =>
    rules([[file, body]]).filter((rule) => rule === 'ARCH017')

  // eval was out of scope on the grounds that it has its own numerics. That is
  // a reason for it to have its own owner, not for its magnitudes to go
  // unowned: it held two log-loss clips written independently at 1e-12 and
  // 1e-15 for the same job, which is the shape this rule exists to surface.
  assert.deepEqual(
    arch017('server/eval/runs/some-report.ts', 'export const t = 1e-12'),
    ['ARCH017'],
  )

  // The engine stays out, and not only because it has no probabilities: it
  // cannot import either owner (ARCH001), so reporting one would be advice it
  // has no way to take.
  assert.deepEqual(arch017('server/engine/probe.ts', 'const t = 1e-12'), [])
  // sim and llm stay out as before. Neither holds a magnitude today, and
  // widening on speculation would be inventing a rule for nobody.
  assert.deepEqual(arch017('server/sim/runner.ts', 'export const t = 1e-9'), [])

  // Each area is pointed at its own owner, because the two hold different
  // contracts: comparison slack on one side, published-score bounds on the
  // other.
  const evalMessage = auditArchitectureSources([
    ['server/eval/runs/some-report.ts', 'export const t = 1e-12'],
  ]).find((entry) => entry.rule === 'ARCH017')?.message
  assert.match(String(evalMessage), /eval\/core\/statistics\.ts/)
  const agentMessage = auditArchitectureSources([
    ['server/agents/policy/probe.ts', 'export const t = 1e-12'],
  ]).find((entry) => entry.rule === 'ARCH017')?.message
  assert.match(String(agentMessage), /canonical\/probability-arithmetic\.ts/)

  // Both owners may write magnitudes; that is what being the owner means.
  assert.deepEqual(
    arch017(
      'server/agents/canonical/probability-arithmetic.ts',
      'export const PROBABILITY_TOLERANCE = 1e-12',
    ),
    [],
  )
  assert.deepEqual(
    arch017('server/eval/core/statistics.ts', 'export const BINARY_LOG_LOSS_CLIP = 1e-15'),
    [],
  )
})

test('the engine cannot reach a layer no purity rule covers', () => {
  const arch014 = (entries: readonly (readonly [string, string])[]) =>
    rules(entries.map((entry) => [entry[0], entry[1]] as [string, string]))
      .filter((rule) => rule === 'ARCH014')

  // ARCH014 inspects engine files and ARCH019 inspects shared ones, so between
  // them the engine's reachable set is covered today. Nothing enforced that:
  // ARCH001 bans server/agents/ and server/eval/ by name, and the purity
  // module arm only sees bare specifiers, so a relative import into a third
  // layer satisfied every rule while putting unchecked code inside the
  // engine's closure. server/shared/ is exactly such a layer and ARCH019 was
  // written by hand when it appeared; this is what makes the next one loud.
  assert.deepEqual(
    arch014([
      ['server/engine/game.ts', "import { f } from '../helpers/util.ts'\nexport const g = f"],
      ['server/helpers/util.ts', 'export const f = 1'],
    ]),
    ['ARCH014'],
    'an uncovered layer inside the engine closure is reported',
  )
  assert.deepEqual(
    arch014([
      ['server/engine/game.ts', "import { f } from '../../client/src/util.ts'\nexport const g = f"],
    ]),
    ['ARCH014'],
    'an out-of-server target is rejected even though it is absent from the source index',
  )

  // Transitively, because the hop that escapes need not be the first one.
  assert.deepEqual(
    arch014([
      ['server/engine/game.ts', "import { a } from '../shared/prng.ts'\nexport const g = a"],
      ['server/shared/prng.ts', "export { a } from '../helpers/util.ts'"],
      ['server/helpers/util.ts', 'export const a = 1'],
    ]),
    ['ARCH014'],
    'the escape is found however many hops in it happens',
  )

  // The two layers that do carry the obligation are silent.
  assert.deepEqual(
    arch014([
      ['server/engine/game.ts', "import { a } from '../shared/prng.ts'\nexport const g = a"],
      ['server/shared/prng.ts', 'export const a = 1'],
    ]),
    [],
    'shared code carries the engine obligation under ARCH019',
  )
  assert.deepEqual(
    arch014([
      ['server/engine/game.ts', "import { a } from './rules.ts'\nexport const g = a"],
      ['server/engine/rules.ts', 'export const a = 1'],
    ]),
    [],
    'engine to engine is the ordinary case',
  )

  // A type-only edge is erased, so it cannot carry a clock into the engine and
  // must not drag its target into the obligation.
  assert.deepEqual(
    arch014([
      ['server/engine/game.ts', "import type { T } from '../helpers/util.ts'\nexport const g = 1"],
      ['server/helpers/util.ts', 'export type T = number'],
    ]),
    [],
    'a type-only edge does not extend the engine closure',
  )
})

test('the ambient ban follows prompt text through value imports', () => {
  // The rule used to check only the declared roots. Purity is a property of the
  // reachable graph, so that was sound only for text a root assembled entirely
  // by itself: measured on the real tree, the roots reach 55 modules and the
  // rule inspected 4. A helper one hop away could stamp a clock into prompt
  // text and pass, which is the hole these cases pin shut.
  const arch015 = (entries: readonly (readonly [string, string])[]) =>
    rules(entries.map((entry) => [entry[0], entry[1]] as [string, string]))
      .filter((rule) => rule === 'ARCH015')

  const ROOT = 'server/agents/raw-llm/prompts.ts'

  // One hop: a root imports a helper for a value, and the helper reads a clock.
  assert.deepEqual(
    arch015([
      [ROOT, "import { stamp } from './helper.ts'\nexport const t = `s ${stamp}`"],
      ['server/agents/raw-llm/helper.ts', 'export const stamp = Date.now()'],
    ]),
    ['ARCH015'],
    'a helper reached by a value import is inside the ban',
  )

  // Two hops, to show the walk is transitive rather than one level deep.
  assert.deepEqual(
    arch015([
      [ROOT, "import { a } from './one.ts'\nexport const t = `s ${a}`"],
      ['server/agents/raw-llm/one.ts', "export { a } from './two.ts'"],
      ['server/agents/raw-llm/two.ts', 'export const a = Math.random()'],
    ]),
    ['ARCH015'],
    'the closure is transitive',
  )

  // A type-only edge is erased by the compiler, so it cannot carry an ambient
  // read into prompt text and must not drag its target into the ban. Without
  // this exclusion the real closure reaches server/llm/openrouter.ts, whose
  // process.env read is legitimate, and the rule would report a false positive.
  assert.deepEqual(
    arch015([
      [ROOT, "import type { T } from './types-only.ts'\nexport const t = 's'"],
      ['server/agents/raw-llm/types-only.ts', 'export const stamp = Date.now()\nexport type T = number'],
    ]),
    [],
    'a type-only import does not extend the ban',
  )
  assert.deepEqual(
    arch015([
      [ROOT, "import type T = require('./types-only.ts')\nexport const t = 's'"],
      ['server/agents/raw-llm/types-only.ts', 'export const stamp = Date.now()\nexport type T = number'],
    ]),
    [],
    'a type-only import-equals edge does not extend the ban',
  )

  // A module nobody reaches from a prompt root is unaffected, so widening the
  // scope did not turn the rule into a tree-wide purity check.
  assert.deepEqual(
    arch015([
      [ROOT, "export const t = 's'"],
      ['server/agents/unreached.ts', 'export const stamp = Date.now()'],
    ]),
    [],
    'an unreached module is still outside the ban',
  )

  // The module arm stays scoped to the declared roots. Being reachable means a
  // module can put a value into prompt text, not that it must live on the pure
  // standard library; belief/exact.ts is in the real closure and imports across
  // the agent tree legitimately.
  assert.deepEqual(
    arch015([
      [ROOT, "import { a } from './helper.ts'\nexport const t = `s ${a}`"],
      ['server/agents/raw-llm/helper.ts', "import { readFileSync } from 'node:fs'\nexport const a = 1"],
    ]),
    [],
    'a reached module may still import beyond the standard library',
  )
})

test('a shared shape guard cannot be rebound in a nested scope', () => {
  const shadow = (body: string) =>
    rules([['server/agents/analysis/probe.ts', `
      import {
        plainDataRecord as plainRecord,
        probability,
      } from '../canonical/canonical-shape.ts'
      ${body}
    `]])

  // Every binding form that compiles. The named-function parameter is the one
  // a regular expression cannot separate from a wrapped interface field, and
  // the destructured parameter is the one a search for positional parameters
  // misses; both were live in this repository.
  assert.deepEqual(
    shadow('function add(a, probability) { return a + probability }'),
    ['ARCH013'],
    'named function parameter',
  )
  assert.deepEqual(
    shadow('const t = [].reduce((sum, probability) => sum + probability, 0)'),
    ['ARCH013'],
    'arrow parameter',
  )
  assert.deepEqual(
    shadow('const t = [].map(({ probability }) => probability)'),
    ['ARCH013'],
    'destructured parameter',
  )
  assert.deepEqual(
    shadow('function f() { const probability = 1; return probability }'),
    ['ARCH013'],
    'nested local',
  )
  assert.deepEqual(
    shadow('function f() { try { g() } catch (probability) { return 1 } }'),
    ['ARCH013'],
    'catch binding',
  )
  // The rule follows `x as y`: the local name is what a nested scope can hide.
  assert.deepEqual(
    shadow('function f(plainRecord) { return plainRecord }'),
    ['ARCH013'],
    'aliased import, local name shadowed',
  )
  assert.deepEqual(
    shadow('function f(plainDataRecord) { return plainDataRecord }'),
    [],
    'the pre-alias name binds nothing here',
  )

  // Block scope hides an import just as well as function scope, and none of
  // these needs an enclosing function to compile.
  assert.deepEqual(
    shadow('for (const probability of []) { fn(probability) }'),
    ['ARCH013'],
    'module-level for-of binding',
  )
  assert.deepEqual(
    shadow('{ const probability = 1; fn(probability) }'),
    ['ARCH013'],
    'module-level bare block',
  )
  assert.deepEqual(
    shadow('try { fn() } catch (probability) { fn(probability) }'),
    ['ARCH013'],
    'module-level catch binding',
  )
  assert.deepEqual(
    shadow('switch (1) { case 1: { const probability = 1; break } }'),
    ['ARCH013'],
    'module-level case block',
  )

  // A parameter in type space labels an argument, it does not bind a value,
  // so renaming it would satisfy the rule while fixing nothing.
  assert.deepEqual(
    shadow('function f() { type R = (probability: number) => number; fn() }'),
    [],
    'function type parameter inside a function body',
  )
  assert.deepEqual(
    shadow('function f() { interface X { go(probability: number): void } fn() }'),
    [],
    'method signature parameter inside a function body',
  )

  // Renaming the binding away is the fix, and it has to read as clean.
  assert.deepEqual(
    shadow('const t = [].map(({ probability: mass }) => mass)'),
    [],
    'destructuring renamed away',
  )
  assert.deepEqual(
    shadow('function f(mass) { return probability(mass) }'),
    [],
    'guard called, nothing rebound',
  )
})

test('a shared shape guard cannot be re-declared under an affixed name', () => {
  const copy = (body: string) =>
    rules([['server/agents/analysis/probe.ts', body]])
  const importing = (body: string) =>
    rules([['server/agents/analysis/probe.ts', `
      import { exactKeys, probability } from '../canonical/canonical-shape.ts'
      ${body}
    `]])

  // The four shapes that were live in this repository. Each is the shared guard
  // under a nearby name, and none of the four modules imported the guard, so the
  // exact-name scan in test/canonical-shape.test.ts saw nothing.
  assert.deepEqual(
    copy('function validProbability(v: unknown): v is number { return !!v }'),
    ['ARCH016'],
    'type predicate',
  )
  assert.deepEqual(
    copy('function finiteProbability(v: unknown): boolean { return !!v }'),
    ['ARCH016'],
    'plain boolean return',
  )
  assert.deepEqual(
    copy(
      'function assertExactKeys(v: unknown): asserts v is Record<string, 1> {}',
    ),
    ['ARCH016'],
    'assertion signature',
  )
  assert.deepEqual(
    copy('const isCanonicalSeatsish = (v: unknown): boolean => !!v'),
    ['ARCH016'],
    'arrow predicate',
  )
  assert.deepEqual(
    copy('const validProbability = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1'),
    ['ARCH016'],
    'an inferred boolean return cannot hide the copy',
  )

  // The two ways to spell the same copy without tripping the checks above: put
  // the return type on the variable rather than the arrow, and continue the
  // guard's name in lowercase instead of starting a new camelCase word.
  assert.deepEqual(
    copy('const validProbability: (v: unknown) => boolean = (v) => !!v'),
    ['ARCH016'],
    'return type annotated on the variable',
  )
  assert.deepEqual(
    copy('function denseArrays(v: unknown): boolean { return !!v }'),
    ['ARCH016'],
    'pluralized guard name',
  )

  // The discriminator is the return kind, not the name, because `probability`
  // is a shared guard and an ordinary domain noun at the same time. Every one of
  // these is a real declaration in the tree.
  assert.deepEqual(
    copy('function failProbability(d: readonly number[]): number { return d[0] }'),
    [],
    'numeric domain helper',
  )
  assert.deepEqual(
    copy('function probabilityLabel(p: number): string { return String(p) }'),
    [],
    'string domain helper',
  )
  assert.deepEqual(
    copy('function addProbability(a: { sum: number }, b: number): void {}'),
    [],
    'void domain helper',
  )
  assert.deepEqual(
    copy('function improbableThing(v: unknown): boolean { return !!v }'),
    [],
    'the guard name is not a camelCase component',
  )

  // Importing the guard is the escape hatch, and it has to be, or the wrappers
  // that deliberately sit beside a guard become unexpressible: a labelled throw
  // around exactKeys, and a half-open interval next to the closed one.
  assert.deepEqual(
    importing(`
      function assertExactKeys(v: object, k: readonly string[]): asserts v is object {
        if (!exactKeys(v, k)) throw new Error('no')
      }
    `),
    [],
    'wrapper with the guard in scope',
  )
  assert.deepEqual(
    importing(
      'const positiveProbability = (v: unknown): v is number =>'
        + ' probability(v) && v > 0',
    ),
    [],
    'deliberate neighbour with the guard in scope',
  )

  // A namespace import puts every guard in scope, so it opens the hatch for all
  // of them rather than for none.
  assert.deepEqual(
    rules([['server/agents/analysis/probe.ts', `
      import * as shapes from '../canonical/canonical-shape.ts'
      const validProbability = (v: unknown): boolean => shapes.probability(v)
    `]]),
    [],
    'namespace import',
  )

  // Module level only: a predicate inside a function body is not a definition a
  // later reader can pick up by mistake, and ARCH013 owns the case where it
  // hides an imported guard.
  assert.deepEqual(
    copy(`
      export function outer(v: unknown): boolean {
        function validProbability(x: unknown): boolean { return !!x }
        return validProbability(v)
      }
    `),
    [],
    'nested predicate',
  )

  // The guard module itself declares the names, so it is not its own offender.
  assert.deepEqual(
    rules([[
      'server/agents/canonical/canonical-shape.ts',
      'export const plainRecordOrArray = (v: unknown): boolean => !!v',
    ]]),
    [],
    'the guard module is exempt',
  )
})

// The affix arm above reads the guard's own word, so a copy that renames the
// word outright walks straight past it. Two did: `seatArray`, a canonicalSeats
// with the table bound dropped, and `isRecord`, a plainRecord with the proxy
// and prototype checks dropped. Both lived in modules that already imported
// some other guard from the shared module, so the import hatch did not cover
// them either.
test('a shared shape guard cannot be re-declared under a known synonym', () => {
  const copy = (body: string) =>
    rules([['server/agents/analysis/probe.ts', body]])
  const importing = (guard: string, body: string) =>
    rules([['server/agents/analysis/probe.ts', `
      import { ${guard} } from '../canonical/canonical-shape.ts'
      ${body}
    `]])

  assert.deepEqual(
    copy('function isRecord(v: unknown): v is Record<string, 1> { return !!v }'),
    ['ARCH016'],
    'the record synonym',
  )
  assert.deepEqual(
    copy('const seatArray = (v: unknown): boolean => Array.isArray(v)'),
    ['ARCH016'],
    'the seat-list synonym',
  )

  // Same escape hatch, and still per guard: importing the record guard clears
  // the record synonym and leaves the seat one reported.
  assert.deepEqual(
    importing(
      'plainRecord',
      'function isRecord(v: unknown): boolean { return plainRecord(v) }',
    ),
    [],
    'wrapper with the record guard in scope',
  )
  assert.deepEqual(
    importing(
      'plainDataRecord',
      'function isRecord(v: unknown): boolean { return plainDataRecord(v) }',
    ),
    [],
    'either record guard opens the hatch for the record synonym',
  )
  assert.deepEqual(
    importing(
      'plainRecord',
      'const seatArray = (v: unknown): boolean => plainRecord(v)',
    ),
    ['ARCH016'],
    'a different guard does not open the hatch',
  )

  // Whole names only. An affix on top of a synonym is a much weaker signal, and
  // language-contract's validSeatArray is the live counterexample: a bounded
  // seat set in the order the host stored it, which is a deliberate neighbour
  // of canonicalSeats rather than a copy of it, because the engine keeps a team
  // in whatever order its leader supplied.
  assert.deepEqual(
    copy('function validSeatArray(v: unknown, n: number): boolean { return !!v }'),
    [],
    'an affixed synonym is not the synonym',
  )
  // The return type still decides, exactly as it does for the affix arm.
  assert.deepEqual(
    copy('function seatArray(v: readonly number[]): string { return v.join() }'),
    [],
    'a non-predicate of the same name',
  )
})

// ARCH016 reads return types, so a helper returning a number never entered its
// set, and that documented exclusion is where the duplication went: 83 raw
// tolerance literals, six copies of the unit clamp, four private `close`
// comparators. ARCH017 is the numeric collector.
test('a shared numeric helper cannot be re-declared privately', () => {
  const copy = (body: string) =>
    rules([['server/agents/analysis/probe.ts', body]])
  const importing = (helper: string, body: string) =>
    rules([['server/agents/analysis/probe.ts', `
      import { ${helper} } from '../canonical/probability-arithmetic.ts'
      ${body}
    `]])

  // The affix arm, mirroring ARCH016's.
  assert.deepEqual(
    copy('function safeClampProbability(v: number): number { return v }'),
    ['ARCH017'],
    'affixed clamp',
  )
  assert.deepEqual(
    copy('const publicLatticeCount = (v: number): number | undefined => 1'),
    ['ARCH017'],
    'affixed lattice count, returning number or undefined',
  )
  // A boolean-returning copy is collected too. The owner module holds one
  // comparator, and a private copy of a tolerance comparator is the exact
  // defect this rule exists for. Any affix of `closeProbability` also embeds
  // the shared `probability` guard, so the two rules overlap here by
  // construction and both report; that is honest rather than a miscount,
  // because the module has neither name in scope.
  assert.deepEqual(
    copy('const isCloseProbability = (a: number, b: number): boolean => a === b'),
    ['ARCH016', 'ARCH017'],
    'affixed comparator',
  )

  // The synonym arm. All four of these were live in this repository.
  assert.deepEqual(
    copy('const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))'),
    ['ARCH017'],
    'the unit-clamp synonym',
  )
  assert.deepEqual(
    copy('const clamp01 = (v: number) => Math.max(0, Math.min(1, v))'),
    ['ARCH017'],
    'an inferred numeric return cannot hide the copy',
  )
  assert.deepEqual(
    copy('const close = (a: number, b: number): boolean => Math.abs(a - b) < 1'),
    ['ARCH017'],
    'the comparator synonym',
  )

  // Same escape hatch as ARCH016, and still per helper.
  assert.deepEqual(
    importing(
      'clampProbability',
      'const clamp01 = (v: number): number => clampProbability(v)',
    ),
    [],
    'wrapper with the clamp in scope',
  )
  assert.deepEqual(
    importing(
      'clampProbability',
      'const close = (a: number, b: number): boolean => a === b',
    ),
    ['ARCH017'],
    'a different helper does not open the hatch',
  )
  assert.deepEqual(
    rules([['server/agents/analysis/probe.ts', `
      import * as arithmetic from '../canonical/probability-arithmetic.ts'
      const clamp01 = (v: number): number => arithmetic.clampProbability(v)
    `]]),
    [],
    'namespace import opens the hatch for every helper',
  )

  // Neither a number nor a boolean, so it is not a copy of anything here.
  assert.deepEqual(
    copy('const clamp01 = (v: number): string => String(v)'),
    [],
    'the return type still decides',
  )
  // Module level only, as with ARCH016.
  assert.deepEqual(
    copy(`
      export function outer(v: number): number {
        const clamp01 = (x: number): number => x
        return clamp01(v)
      }
    `),
    [],
    'nested helper',
  )
  // The owner module declares the names, so it is not its own offender.
  assert.deepEqual(
    rules([[
      'server/agents/canonical/probability-arithmetic.ts',
      'export const clampProbabilityTwice = (v: number): number => v',
    ]]),
    [],
    'the arithmetic module is exempt',
  )
})

// The arm that would have caught the finding on the first file rather than the
// fourteenth. A name-based rule can only find a magnitude somebody named, and
// none of the 83 were named.
test('a bare tolerance literal in the agent tree has no owner', () => {
  const agent = (body: string) =>
    rules([['server/agents/analysis/probe.ts', body]])

  assert.deepEqual(agent('const t = 1e-12'), ['ARCH017'])
  assert.deepEqual(agent('const t = 1e-9'), ['ARCH017'])
  assert.deepEqual(agent('const t = 1e-15'), ['ARCH017'])
  // A future regime nobody has thought of yet is caught the day it is written,
  // which is what picking a ceiling buys over listing the known values.
  assert.deepEqual(agent('const t = 1e-10'), ['ARCH017'])
  assert.deepEqual(
    agent('const near = (a: number, b: number) => Math.abs(a - b) <= 0.0000001'),
    ['ARCH017'],
    'decimal spelling counts too',
  )
  assert.deepEqual(
    agent('const t = 5e-7\nconst u = 5e-8'),
    ['ARCH017', 'ARCH017'],
    'one violation per literal',
  )

  // The band constants and every other deliberate magnitude in the tree sit
  // orders of magnitude above the ceiling, so the separator is clean.
  assert.deepEqual(agent('const band = 0.04'), [])
  assert.deepEqual(agent('const cap = 3_628_800'), [])
  assert.deepEqual(agent('const zero = 0'), [])
  assert.deepEqual(agent('const half = 0.5'), [])

  // The engine stays out, for the reason this note always gave: it has no
  // probabilities. It also could not comply if it did, since ARCH001 forbids it
  // from importing either owner module, so a violation would be advice it
  // cannot take.
  assert.deepEqual(rules([['server/engine/probe.ts', 'const t = 1e-12']]), [])
  // eval used to be out on the grounds that it is "an offline calibration layer
  // with its own numerics". That is now a reason for it to have its own owner
  // rather than none: it held two log-loss clips at 1e-12 and 1e-15, written
  // independently for the same job. See the eval case below.
  assert.deepEqual(
    rules([['server/eval/probe.ts', 'const t = 1e-15']])
      .filter((rule) => rule === 'ARCH017'),
    ['ARCH017'],
  )
  // The owner module is where the magnitudes live.
  assert.deepEqual(
    rules([[
      'server/agents/canonical/probability-arithmetic.ts',
      'export const PROBABILITY_TOLERANCE = 1e-12',
    ]]),
    [],
  )
})

test('TypeScript AST recognizes multiline imports and export-from declarations', () => {
  const inspected = inspectSource('server/agents/example.ts', `
    import type {
      Game as RawGame,
      PlayerView,
    } from "../../engine/types.ts"
    export {
      toArtifact,
    } from "../../eval/artifact.ts"
  `)

  assert.deepEqual(inspected.edges, [
    {
      kind: 'import',
      specifier: '../../engine/types.ts',
      names: ['Game', 'PlayerView'],
      namespace: false,
      locals: ['RawGame', 'PlayerView'],
      // `import type` is erased, so this edge cannot carry runtime behavior.
      // The prompt-text closure reads this field to avoid following it.
      typeOnly: true,
      line: 2,
    },
    {
      kind: 'export',
      specifier: '../../eval/artifact.ts',
      names: ['toArtifact'],
      namespace: false,
      locals: ['toArtifact'],
      typeOnly: false,
      line: 6,
    },
  ])
})

test('type-only edges are distinguished from the value edges that look like them', () => {
  const edges = (source: string) =>
    inspectSource('server/agents/example.ts', source).edges
      .map((edge: { specifier: string; typeOnly: boolean }) =>
        [edge.specifier, edge.typeOnly])

  // Erased forms.
  assert.deepEqual(edges("import type { A } from './a.ts'"), [['./a.ts', true]])
  assert.deepEqual(edges("import { type A, type B } from './a.ts'"), [['./a.ts', true]])
  assert.deepEqual(edges("export type { A } from './a.ts'"), [['./a.ts', true]])
  assert.deepEqual(edges("import type A = require('./a.ts')"), [['./a.ts', true]])

  // Retained forms. The mixed clause is the one worth pinning: every named
  // member is type-only, but the default binding is still a value, so the
  // module runs.
  assert.deepEqual(edges("import D, { type A } from './a.ts'"), [['./a.ts', false]])
  assert.deepEqual(edges("import { type A, b } from './a.ts'"), [['./a.ts', false]])
  assert.deepEqual(edges("import { A } from './a.ts'"), [['./a.ts', false]])
  assert.deepEqual(edges("import * as ns from './a.ts'"), [['./a.ts', false]])
  // A bare specifier import has no clause at all and runs for side effects.
  assert.deepEqual(edges("import './a.ts'"), [['./a.ts', false]])
})

test('TypeScript AST ignores lexical decoys and regex contents', () => {
  const source = `
    // import { Game } from "../../engine/types.ts"
    /* export * from "../../eval/artifact.ts" */
    const first = 'import { Game } from "../../engine/types.ts"'
    const second = \`export * from "../../eval/architecture-report.ts"\`
    const detector = (value: string) =>
      /import { Game } from "..\\/..\\/engine\\/types.ts"/.test(value)
    export const safe = first + second
  `
  assert.deepEqual(
    auditArchitectureSources([['server/agents/policy/safe.ts', source]]),
    [],
  )
})

test('dynamic imports remain governed, including template expressions', () => {
  const violations = auditArchitectureSources([
    [
      'server/engine/lazy.ts',
      'const agent = await import("../agents/composed.ts")',
    ],
    [
      'server/agents/lazy.ts',
      'const report = `${await import("../eval/architecture-report.ts")}`',
    ],
    [
      'server/agents/lazy-game.ts',
      'type Raw = import("../engine/types.ts").Game',
    ],
    [
      'server/agents/lazy-game-namespace.ts',
      `const ns = await import("../engine/types.ts")
       const raw: ns.Game = value`,
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer, specifier }) => [
      rule,
      importer,
      specifier,
    ]),
    [
      ['ARCH001', 'server/engine/lazy.ts', '../agents/composed.ts'],
      [
        'ARCH002',
        'server/agents/lazy.ts',
        '../eval/architecture-report.ts',
      ],
      ['ARCH002', 'server/agents/lazy-game.ts', '../engine/types.ts'],
      [
        'ARCH002',
        'server/agents/lazy-game-namespace.ts',
        '../engine/types.ts',
      ],
    ],
  )
})

test('non-literal dynamic imports fail closed', () => {
  const violations = auditArchitectureSources([
    [
      'server/agents/variable.ts',
      'const moduleValue = await import(modulePath)',
    ],
    [
      'server/engine/template.ts',
      'const moduleValue = await import(`../agents/${name}.ts`)',
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer }) => [rule, importer]),
    [
      ['ARCH000', 'server/agents/variable.ts'],
      ['ARCH000', 'server/engine/template.ts'],
    ],
  )
  assert.match(violations[0]!.message, /dynamic import target must be a string literal/)
  assert.match(violations[1]!.message, /dynamic import target must be a string literal/)
})

test('path normalization closes Windows and POSIX dependency bypasses', () => {
  const violations = auditArchitectureSources([
    [
      'server\\engine\\nested\\rules.ts',
      'import { decide } from "..\\\\..\\\\agents\\\\heuristic.ts"',
    ],
    [
      'server/agents/policy/../policy/score.ts',
      'export * from "../../eval/artifact.ts"',
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer }) => [rule, importer]),
    [
      ['ARCH001', 'server/engine/nested/rules.ts'],
      ['ARCH003', 'server/agents/policy/score.ts'],
    ],
  )
})

test('engine cannot import or re-export agent and evaluation modules', () => {
  assert.deepEqual(
    rules([
      [
        'server/engine/one.ts',
        'import { decide } from "../agents/heuristic.ts"',
      ],
      [
        'server/engine/two.ts',
        'export * from "../eval/artifact.ts"',
      ],
    ]),
    ['ARCH001', 'ARCH001'],
  )
})

test('runtime agents cannot depend on evaluation code', () => {
  const violations = auditArchitectureSources([
    [
      'server/agents/analysis/one.ts',
      'import { score } from "../../eval/metrics.ts"',
    ],
  ])
  assert.equal(violations.length, 1)
  assert.equal(violations[0]!.rule, 'ARCH002')
  assert.match(violations[0]!.message, /one\.ts:1 -> \.\.\/\.\.\/eval\/metrics/)
})

test('runtime agents reject raw Game while allowing narrow domain types', () => {
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/allowed.ts',
        `import type {
          DecisionRequest,
          GameEvent,
          PlayerView,
          Role,
          Seat,
        } from "../engine/types.ts"`,
      ],
      [
        'server/agents/safe-rules.ts',
        'import * as rules from "../engine/rules.ts"',
      ],
    ]),
    [],
  )

  assert.deepEqual(
    rules([
      [
        'server/agents/named.ts',
        'import type { Game as Raw } from "../engine/types.ts"',
      ],
      [
        'server/agents/namespace.ts',
        'import type * as EngineTypes from "../engine/types.ts"',
      ],
      [
        'server/agents/type-expression.ts',
        'type Raw = import("../engine/types.ts").Game',
      ],
      [
        'server/agents/barrel.ts',
        'import type { Game as Raw } from "../shared/engine-barrel.ts"',
      ],
      [
        'server/agents/constructor.ts',
        'import { createGame } from "../engine/game.ts"',
      ],
      [
        'server/agents/view-bypass.ts',
        'export { viewFor } from "../engine/view.ts"',
      ],
    ]),
    [
      'ARCH002',
      'ARCH002',
      'ARCH002',
      'ARCH002',
      'ARCH002',
      'ARCH002',
    ],
  )

  assert.deepEqual(
    rules([
      [
        'server/llm/raw-state.ts',
        'export type { Game as RawState } from "../engine/types.ts"',
      ],
      [
        'server/agents/transitive.ts',
        'import type { RawState } from "../llm/raw-state.ts"',
      ],
    ]),
    ['ARCH002'],
    'a renamed re-export retains raw Game provenance',
  )
  assert.deepEqual(
    rules([
      [
        'server/llm/raw-state.ts',
        [
          'import type { Game as InternalState } from "../engine/types.ts"',
          'export type { InternalState as RawState }',
        ].join('\n'),
      ],
      [
        'server/agents/transitive.ts',
        'import type { RawState } from "../llm/raw-state.ts"',
      ],
    ]),
    ['ARCH002'],
    'a local re-export retains raw Game provenance',
  )
  assert.deepEqual(
    rules([
      [
        'server/llm/raw-state.ts',
        [
          'import type { Game } from "../engine/types.ts"',
          'export type RawState = Game',
        ].join('\n'),
      ],
      [
        'server/agents/transitive.ts',
        'import type { RawState } from "../llm/raw-state.ts"',
      ],
    ]),
    ['ARCH002'],
    'a type alias retains raw Game provenance',
  )
})

test('generic policies and components cannot import artifact/report shapes', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/scorer.ts',
        'import type { GameArtifact } from "../../eval/barrel.ts"',
      ],
      [
        'server/agents/components/projector.ts',
        'export { architectureReport } from "../../eval/architecture-report.ts"',
      ],
    ]),
    ['ARCH003', 'ARCH003'],
  )
})

test('generic score-layer kernel cannot grow role-specific dependencies or branches', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/score-layer/role-import.ts',
        'import { utility } from "../../analysis/morgana-role-utility.ts"',
      ],
      [
        'server/agents/policy/score-layer/token-import.ts',
        'import { TOKEN } from "../../components/native-role-components.ts"',
      ],
      [
        'server/agents/policy/score-layer/role-branch.ts',
        'const selected = view.role === "merlin"',
      ],
      [
        'server/agents/policy/score-layer/role-name.ts',
        'function applyMorganaRolePolicy() {}',
      ],
      [
        'server/agents/policy/score-layer/lower-morgana.ts',
        'const morganaUtility = 1',
      ],
      [
        'server/agents/policy/score-layer/lower-evil.ts',
        'const evilRolePolicy = 1',
      ],
      [
        'server/agents/policy/score-layer/lower-merlin.ts',
        'const merlinScore = 1',
      ],
      [
        'server/agents/policy/score-layer/legacy-score-import.ts',
        'import { scoreCandidates } from "../score.ts"',
      ],
      [
        'server/agents/policy/score-layer/legacy-wrapper-import.ts',
        'import { withLegacyScoring } from "../legacy-scoring.ts"',
      ],
    ]),
    [
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
    ],
  )
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/role-score-layers/morgana.ts',
        'import type { ScoreLayerDefinition } from "../policy/score-layer/types.ts"',
      ],
      [
        'server/agents/policy/score-layer/types.ts',
        'import type { SituationAnalysis } from "../../analysis/situation-types.ts"',
      ],
    ]),
    [],
  )
})

test('generic decision-layer kernel cannot grow role or observability coupling', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/decision-layer/role-import.ts',
        'import { utility } from "../../analysis/morgana-role-utility.ts"',
      ],
      [
        'server/agents/policy/decision-layer/token-import.ts',
        'import { TOKEN } from "../../components/native-role-components.ts"',
      ],
      [
        'server/agents/policy/decision-layer/concrete-import.ts',
        'import { POLICY } from "../../role-decision-layers/evil-quest-card.ts"',
      ],
      [
        'server/agents/policy/decision-layer/trace-import.ts',
        'import type { DecisionTrace } from "../../trace.ts"',
      ],
      [
        'server/agents/policy/decision-layer/role-branch.ts',
        'const selected = view.role === "merlin"',
      ],
      [
        'server/agents/policy/decision-layer/role-name.ts',
        'function applyMorganaRolePolicy() {}',
      ],
      [
        'server/agents/policy/decision-layer/admission-replay.ts',
        'import { canonicalizeJson } from "../../canonical/canonical-json.ts"',
      ],
      [
        'server/agents/composed/agent.ts',
        'import { createPolicyComponentRuntime } from "../policy/component-runtime.ts"',
      ],
    ]),
    Array(8).fill('ARCH011'),
  )
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/policy/decision-frame.ts',
        'import { runDecisionLayers } from "./decision-layer/runner.ts"',
      ],
      [
        'server/agents/policy/decision-layer/admission-replay.ts',
        'import { runDecisionLayers } from "./runner.ts"',
      ],
      [
        'server/agents/admission/composed-trace.ts',
        'import { replayDecisionLayersForAdmission } from "../policy/decision-layer/admission-replay.ts"',
      ],
      [
        'server/agents/role-decision-layers/configured.ts',
        'import type { DecisionLayerDefinition } from "../policy/decision-layer/types.ts"',
      ],
      [
        'server/agents/policy/decision-layer/runner.ts',
        'import { createPolicyComponentRuntime } from "../component-runtime.ts"',
      ],
      [
        'server/agents/policy/score-layer/components.ts',
        'import { createPolicyComponentRuntime } from "../component-runtime.ts"',
      ],
    ]),
    [],
  )
})

test('shared layer registry skeleton stays confined and role-blind', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/composed/agent.ts',
        'import { layerToken } from "../policy/layer-registry-common.ts"',
      ],
      [
        // A policy file that is not one of the three owners. The specifier is
        // resolved relative to this path, so the source has to sit in policy/
        // for it to name the confined module at all.
        'server/agents/policy/forced.ts',
        'import { layerToken } from "./layer-registry-common.ts"',
      ],
      [
        'server/agents/role-score-layers/good.ts',
        'import { indexLayerDefinitions } from "../policy/layer-registry-common.ts"',
      ],
      [
        // One source: the audit refuses a repeated path, and this file is the
        // only one the shared role scope matches.
        'server/agents/policy/layer-registry-common.ts',
        'function applyMorganaRolePolicy() { return "merlin" }',
      ],
    ]),
    Array(5).fill('ARCH011'),
  )
  // Both layer families, the component registry, and the trace writers are the
  // legitimate consumers.
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/policy/score-layer/registry.ts',
        'import { indexLayerDefinitions } from "../layer-registry-common.ts"',
      ],
      [
        'server/agents/policy/decision-layer/types.ts',
        'import { layerToken } from "../layer-registry-common.ts"',
      ],
      [
        'server/agents/components/registry.ts',
        'import { assertLayerRef } from "../policy/layer-registry-common.ts"',
      ],
      [
        'server/agents/policy/decision-frame.ts',
        'import { projectLayerRun } from "./layer-registry-common.ts"',
      ],
      [
        'server/agents/trace-builder.ts',
        'import { projectLayerRun } from "./policy/layer-registry-common.ts"',
      ],
    ]),
    [],
  )
})

test('concrete score families stay separate from observability and composition IDs', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/role-score-layers/trace-coupled.ts',
        'import type { DecisionTrace } from "../trace.ts"',
      ],
      [
        'server/agents/role-score-layers/report-coupled.ts',
        'import { architectureReport } from "../../eval/architecture-report.ts"',
      ],
      [
        'server/agents/role-score-layers/transport-coupled.ts',
        'import { parseExternalDecisionReply } from "../external-reply.ts"',
      ],
      [
        'server/agents/role-score-layers/legacy-row.ts',
        'import type { CandidateScore } from "../candidate/types.ts"',
      ],
      [
        'server/agents/role-score-layers/legacy-namespace.ts',
        `import type * as Legacy from "../candidate/types.ts"
         type Row = Legacy.CandidateScore`,
      ],
      [
        'server/agents/composed/agent.ts',
        `const proposal = "good-proposal-analysis"
         const vote = "good-vote-analysis"`,
      ],
    ]),
    [
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
    ],
  )
})

test('configured score seam exclusively aggregates concrete families', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/composed/agent.ts',
        'import { createGoodScoreLayerRegistry } from "../role-score-layers/good.ts"',
      ],
      [
        'server/agents/policy/decision-frame.ts',
        'import { family as selected } from "../role-score-layers/good.ts"',
      ],
      [
        'server/agents/components/family.ts',
        'import * as family from "../role-score-layers/good.ts"',
      ],
      [
        'server/agents/policy/family.ts',
        'export { family } from "../role-score-layers/good.ts"',
      ],
      [
        'server/agents/composed-dynamic.ts',
        'const family = await import("./role-score-layers/good.ts")',
      ],
      [
        'server/agents/composed-require.ts',
        'const family = require("./role-score-layers/good.ts")',
      ],
      [
        'server/agents/role-score-layers/evil.ts',
        'import { GOOD } from "./good.ts"',
      ],
      [
        'server/agents/role-score-layers/good.ts',
        'export * from "./configured.ts"',
      ],
    ]),
    [
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
    ],
  )
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/role-score-layers/configured.ts',
        `import { GOOD } from "./good.ts"
         import * as equality from "./legacy-equality.ts"`,
      ],
      [
        'server/agents/composed/agent.ts',
        'import { registry } from "../role-score-layers/configured.ts"',
      ],
    ]),
    [],
  )
})

test('native score-layer preparation and execution stay locally owned', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/composed/agent.ts',
        'import { executePreparedScoreLayerRun } from "../policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/composed-namespace.ts',
        'import * as runner from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/composed-alias.ts',
        'import { executePreparedScoreLayerRun as run } from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/composed-default.ts',
        'import runner from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/composed-dynamic.ts',
        'const runner = await import("./policy/score-layer/runner.ts")',
      ],
      [
        'server/agents/composed-require.ts',
        'const runner = require("./policy/score-layer/runner.ts")',
      ],
      [
        'server/agents/composed-export.ts',
        'export * from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/policy/score-layer/preparation.ts',
        'const PROVENANCE = new WeakMap<object, object>()',
      ],
    ]),
    [
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
    ],
  )
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/policy/decision-frame.ts',
        'import { executePreparedScoreLayerRun, prepareScoreLayerRunLease } from "./score-layer/runner.ts"',
      ],
      [
        'server/agents/policy/score-layer/admission-replay.ts',
        'import { executePreparedScoreLayerRun } from "./runner.ts"',
      ],
      [
        'server/agents/admission/composed-trace.ts',
        'import { replayNativeScoresForAdmission } from "../policy/score-layer/admission-replay.ts"',
      ],
    ]),
    [],
  )
})

test('score admission replay uses only the configured family catalog', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/score-layer/admission-replay.ts',
        `import { GOOD_ROLE_SCORE_LAYER } from "../../role-score-layers/good.ts"
         import * as evil from "../../role-score-layers/evil.ts"`,
      ],
    ]),
    ['ARCH007', 'ARCH007'],
  )
  assert.deepEqual(
    auditArchitectureSources([[
      'server/agents/admission/composed-trace.ts',
      'import { configuredScoreLayerChainForVersion } from "../role-score-layers/configured.ts"',
    ]]),
    [],
  )
})

test('trusted provider capabilities remain inside composition and kernel', () => {
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/components/kernel.ts',
        'export interface DecisionComponentTrustedHostInputProviders {}',
      ],
      [
        'server/agents/policy/decision-frame.ts',
        'const roots: DecisionComponentTrustedHostInputProviders = factory(frame)',
      ],
    ]),
    [],
  )

  const violations = auditArchitectureSources([
    [
      'server/agents/composed/agent.ts',
      'const value: DecisionComponentTrustedHostInputProvider<unknown> = root',
    ],
    [
      'server/agents/external-reply.ts',
      'import type { DecisionComponentTrustedHostInputProvider } from "./components/kernel.ts"',
    ],
    [
      'server/agents/trace.ts',
      'runDecisionComponents(brain, request, view, invocation, trusted)',
    ],
    [
      'server/eval/artifact.ts',
      'const hidden: DecisionComponentTrustedHostInputProviders = value',
    ],
    [
      'server/eval/architecture-report.ts',
      'runDecisionComponents(brain, request, view, invocation, trusted)',
    ],
    [
      'server/server.ts',
      'runDecisionComponents(brain, request, view, invocation, trusted)',
    ],
    [
      'server/agents/analysis/new-owner.ts',
      'runDecisionComponents(brain, request, view)',
    ],
    // These two sit in admission/ rather than analysis/ so the case isolates
    // ARCH004. analysis/ ranks BELOW components/, so an analysis file importing
    // the kernel is also an ARCH020 order violation, and the fixture would then
    // be asserting two rules at once while claiming to be about one.
    [
      'server/agents/admission/namespace-bypass.ts',
      `import * as kernel from "../components/kernel.ts"
       kernel["runDecisionComponents"](brain, request, view, invocation, trusted)`,
    ],
    [
      'server/agents/admission/dynamic-namespace-bypass.ts',
      `const kernel = await import("../components/kernel.ts")
       kernel["runDecisionComponents"](brain, request, view, invocation, trusted)`,
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer }) => [rule, importer]),
    [
      ['ARCH004', 'server/agents/composed/agent.ts'],
      ['ARCH004', 'server/agents/external-reply.ts'],
      ['ARCH004', 'server/agents/trace.ts'],
      ['ARCH004', 'server/eval/artifact.ts'],
      ['ARCH004', 'server/eval/architecture-report.ts'],
      ['ARCH004', 'server/server.ts'],
      ['ARCH004', 'server/agents/analysis/new-owner.ts'],
      ['ARCH004', 'server/agents/admission/namespace-bypass.ts'],
      ['ARCH004', 'server/agents/admission/dynamic-namespace-bypass.ts'],
    ],
  )
})

test('audit fails closed on unreadable, duplicate, and malformed sources', () => {
  const violations = auditArchitectureSources([
    ['server/agents/unreadable.ts', undefined],
    ['server\\agents\\same.ts', 'export const first = true'],
    ['server/agents/same.ts', 'export const second = true'],
    ['server/engine/broken.ts', 'import { nope }'],
    ['server/agents/not-source.txt', 'export const ignored = false'],
    ['client/escaped.ts', 'export const ignored = false'],
    [
      'server/engine/escaped-import.ts',
      'import "../../../outside.ts"',
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      'ARCH000',
      'ARCH000',
      'ARCH000',
      'ARCH000',
      'ARCH000',
      'ARCH000',
    ],
  )
  assert.match(violations[0]!.message, /could not be read/)
  assert.match(violations[1]!.message, /duplicate normalized source path/)
  assert.match(violations[2]!.message, /could not be parsed/)
  assert.match(violations[3]!.message, /unsupported extension/)
  assert.match(violations[4]!.message, /outside the governed server tree/)
  assert.match(violations[5]!.message, /module target escapes the repository/)
})

// ARCH018. The repository already fails the build on dead declarations, but
// that check reports unused locals inside test roots, so an exported
// production helper a test imports reads as live whatever production does.
// assertProbability sat in that hole until it was found by reading.
test('a production export reached only from the suite is reported', () => {
  const audit = (
    server: [string, string][],
    tests: [string, string][],
  ): string[] =>
    (architectureModule as unknown as {
      auditTestOnlyProductionExports: (
        s: [string, string][],
        t: [string, string][],
      ) => readonly { rule: string }[]
    }).auditTestOnlyProductionExports(server, tests).map((item) => item.rule)

  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', 'export const onlyTested = 1']],
      [[
        'test/probe.test.ts',
        'import { onlyTested } from "../server/agents/probe.ts"; void onlyTested',
      ]],
    ),
    ['ARCH018'],
    'a value export whose sole consumer is a test',
  )
  assert.deepEqual(
    audit(
      [
        ['server/agents/probe.ts', 'export const shared = 1'],
        [
          'server/agents/other.ts',
          'import { shared } from "./probe.ts"; void shared',
        ],
      ],
      [[
        'test/probe.test.ts',
        'import { shared } from "../server/agents/probe.ts"; void shared',
      ]],
    ),
    [],
    'a production consumer anywhere clears it',
  )
  // Same-file use is production use. A version constant referenced once inside
  // its own module is live, and missing this is what made an earlier census
  // report 126 instead of 22.
  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', [
        'export const VERSION = "v1"',
        'export const build = (): string => VERSION',
      ].join('\n')]],
      [[
        'test/probe.test.ts',
        'import { VERSION } from "../server/agents/probe.ts"; void VERSION',
      ]],
    ),
    [],
    'a constant used inside its own module is not test-only',
  )
  // Nothing references it at all, which is the dead-declaration check's job.
  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', 'export const orphan = 1']],
      [['test/probe.test.ts', 'const unrelated = 1']],
    ),
    [],
    'an export with no consumer at all is a different rule',
  )
  assert.deepEqual(
    audit(
      [
        ['server/agents/probe.ts', 'export const onlyTested = 1'],
        ['server/agents/other.ts', 'const onlyTested = 2; void onlyTested'],
      ],
      [[
        'test/probe.test.ts',
        'import { onlyTested } from "../server/agents/probe.ts"; void onlyTested',
      ]],
    ),
    ['ARCH018'],
    'an unrelated production identifier is not a consumer',
  )
  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', 'export const orphan = 1']],
      [['test/probe.test.ts', 'const orphan = 2; void orphan']],
    ),
    [],
    'an unrelated test identifier does not invent reachability',
  )
  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', 'const listed = 1; export { listed }']],
      [[
        'test/probe.test.ts',
        'import { listed } from "../server/agents/probe.ts"; void listed',
      ]],
    ),
    ['ARCH018'],
    'an export-list declaration is part of the production surface',
  )
  // Types and classes are out of scope: a type is consumed in type position,
  // and a class can be thrown in production while only the test names it.
  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', [
        'export interface Shape { a: number }',
        'export class Failure extends Error {}',
      ].join('\n')]],
      [['test/probe.test.ts', 'const s: Shape = { a: 1 }; throw new Failure()']],
    ),
    [],
    'type and class exports are deliberately not collected',
  )
})

// The rule's verdict is an absence, so a tree it could not fully read must
// fail loudly rather than report the unread half as unreferenced.
test('an unreadable tree is reported, never treated as an empty one', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'arch018-'))
  try {
    mkdirSync(path.join(root, 'server', 'agents'), { recursive: true })
    mkdirSync(path.join(root, 'test'), { recursive: true })
    writeFileSync(
      path.join(root, 'server', 'agents', 'probe.ts'),
      'export const onlyTested = 1',
    )
    writeFileSync(
      path.join(root, 'test', 'probe.test.ts'),
      'import { onlyTested } from "../server/agents/probe.ts"; void onlyTested',
    )
    const found = (architectureModule as unknown as {
      checkTestOnlyProductionExports: (
        root: string,
      ) => readonly { rule: string }[]
    }).checkTestOnlyProductionExports(root)
    assert.deepEqual(found.map((item) => item.rule), ['ARCH018'])

    // A missing test tree is not a failure: there is nothing for the rule to
    // say, and the alternative is every export reading as unreferenced.
    rmSync(path.join(root, 'test'), { recursive: true, force: true })
    assert.deepEqual(
      (architectureModule as unknown as {
        checkTestOnlyProductionExports: (
          root: string,
        ) => readonly unknown[]
      }).checkTestOnlyProductionExports(root),
      [],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every exempted module still exists in the repository', () => {
  const { TEST_ONLY_EXPORT_EXEMPTIONS } = architectureModule as unknown as {
    TEST_ONLY_EXPORT_EXEMPTIONS: ReadonlyMap<string, ReadonlySet<string>>
  }
  // The audit is generic over its root, so it cannot ask this: a synthetic
  // tree legitimately lacks every real path. Here the repository is the
  // fixture, so a renamed or deleted exempt module is a stale entry.
  for (const sourcePath of TEST_ONLY_EXPORT_EXEMPTIONS.keys()) {
    assert.ok(
      existsSync(sourcePath),
      `exempted module ${sourcePath} no longer exists; drop its entry`,
    )
  }
})

test('an exemption that suppresses nothing is reported as stale', () => {
  const stale = (architectureModule as unknown as {
    checkTestOnlyProductionExports: (
      root: string,
    ) => readonly { message: string }[]
  })
  // The real tree is the fixture here: every pinned entry must still be
  // suppressing a live violation, or the ratchet cannot be observed shrinking.
  const violations = stale.checkTestOnlyProductionExports(process.cwd())
  assert.deepEqual(
    violations.filter((item) => item.message.includes('is stale')),
    [],
    'a pinned exemption stopped matching; drop the entry',
  )
})

// ARCH020. The subdirectories under server/agents/ carry a rank, and an import
// may only point at a rank at or below its own. These cases pin the three ways
// the rule can answer: it fires, it deliberately allows the peer tier both
// ways, and it stays out of the way of the unranked root.
test('agent directories may only import at or below their own tier', () => {
  const violations = auditArchitectureSources([
    [
      'server/agents/belief/exact.ts',
      'import { analyzeSituation } from "../analysis/situation.ts"',
    ],
    [
      'server/agents/canonical/canonical-shape.ts',
      'import { compareCanonicalRoles } from "../belief/types.ts"',
    ],
    [
      'server/agents/record/intent.ts',
      'export * from "../communication/direction-contract.ts"',
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer, specifier }) => [rule, importer, specifier]),
    [
      ['ARCH020', 'server/agents/belief/exact.ts', '../analysis/situation.ts'],
      [
        'ARCH020',
        'server/agents/canonical/canonical-shape.ts',
        '../belief/types.ts',
      ],
      [
        'ARCH020',
        'server/agents/record/intent.ts',
        '../communication/direction-contract.ts',
      ],
    ],
  )
})

test('the composition kernel peer tier imports both ways', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/decision-frame.ts',
        'import type { X } from "../components/resolved-brain.ts"',
      ],
      [
        'server/agents/components/registry.ts',
        'import type { Y } from "../policy/score-layer/types.ts"',
      ],
    ]),
    [],
  )
})

test('terminal agent lanes cannot import one another or bypass the registry', () => {
  const violations = auditArchitectureSources([
    [
      'server/agents/composed/agent.ts',
      'import { x } from "../heuristic/agent.ts"',
    ],
    [
      'server/agents/raw-llm/agent.ts',
      'import { x } from "../composed/options.ts"',
    ],
    [
      'server/agents/heuristic/agent.ts',
      'import { x } from "../llm.ts"',
    ],
    [
      'server/agents/defs.ts',
      'import { x } from "./raw-llm/agent.ts"',
    ],
    [
      'server/agents/registry.ts',
      'import { x } from "./raw-llm/agent.ts"',
    ],
    [
      'server/agents/composed.ts',
      "// Compatibility facade. New production imports should name the lane module.\nexport {\n  createComposedAgent,\n  type ComposedAgentOptions,\n  type ComposedAvalonAgent,\n  type ComposedStage,\n} from './composed/agent.ts'\n",
    ],
    [
      'server/agents/prompts.ts',
      'export * from "./raw-llm/facts.ts"',
    ],
  ])

  assert.deepEqual(
    violations
      .filter(({ rule }) => rule === 'ARCH022')
      .map(({ importer, specifier }) => [importer, specifier]),
    [
      ['server/agents/composed/agent.ts', '../heuristic/agent.ts'],
      ['server/agents/raw-llm/agent.ts', '../composed/options.ts'],
      ['server/agents/heuristic/agent.ts', '../llm.ts'],
      ['server/agents/defs.ts', './raw-llm/agent.ts'],
      ['server/agents/prompts.ts', undefined],
    ],
  )
})
test('agent root files are outside the directory order in both roles', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/admission/trace-primitives.ts',
        'import type { DecisionTrace } from "../trace.ts"',
      ],
      [
        'server/agents/brain.ts',
        'import type { Z } from "./admission/composed-trace.ts"',
      ],
    ]),
    [],
  )
})

// The table is only an order if it covers everything. A subdirectory missing
// from it is not rejected by ARCH020, it is SKIPPED, so an unranked folder
// would be silently ungoverned rather than loudly wrong. That failure mode is
// invisible by construction, which is exactly the kind this repository pins
// with a derived-from-disk check rather than trusting a hand-kept list.
test('every agent subdirectory carries a tier', () => {
  const directories = readdirSync('server/agents', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${entry.name}/`)
    .sort()

  assert.ok(directories.length > 0, 'expected agent subdirectories to exist')
  assert.deepEqual(
    directories.filter((name) => !AGENT_DIRECTORY_TIERS.has(name)),
    [],
    'an unranked agent subdirectory is skipped by ARCH020, not governed by it',
  )
  assert.deepEqual(
    [...AGENT_DIRECTORY_TIERS.keys()].filter(
      (name) => !directories.includes(name),
    ),
    [],
    'the tier table names a directory that no longer exists',
  )
})
