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
import * as architectureModule from '../tools/architecture-fitness.mjs'

interface ArchitectureViolation {
  readonly rule: string
  readonly importer: string
  readonly specifier?: string
  readonly line?: number
  readonly message: string
}

const {
  auditArchitectureSources,
  checkRepositoryArchitecture,
  checkStrictTestRatchetOwnership,
  inspectSource,
} = architectureModule as {
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
      readonly line: number
    }[]
  }
}

function rules(sources: ReadonlyArray<readonly [string, unknown]>): string[] {
  return auditArchitectureSources(sources).map((violation) => violation.rule)
}

test('repository sources satisfy the coarse architecture fitness rules', () => {
  assert.deepEqual(checkRepositoryArchitecture(), [])
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
    'tsc -p tsconfig.server.json && node tools/strict-test-ratchet.mjs',
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
            'tsc -p tsconfig.server.json && node tools/strict-test-ratchet.mjs',
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
    assert.match(violations[0].message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['*/**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['./test/**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({
        files: ['server/placeholder.ts'],
        references: [{ path: './nested' }],
      }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /project references are rejected/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: {}, files: 'test/hidden.test.ts' }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /TypeScript config is invalid/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
      line: 2,
    },
    {
      kind: 'export',
      specifier: '../../eval/artifact.ts',
      names: ['toArtifact'],
      namespace: false,
      line: 6,
    },
  ])
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
  assert.match(violations[0].message, /dynamic import target must be a string literal/)
  assert.match(violations[1].message, /dynamic import target must be a string literal/)
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
  assert.equal(violations[0].rule, 'ARCH002')
  assert.match(violations[0].message, /one\.ts:1 -> \.\.\/\.\.\/eval\/metrics/)
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
        'import { TOKEN } from "../../components/legacy-role-adapters.ts"',
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
        'server/agents/score-layers/morgana.ts',
        'import type { ScoreLayerDefinition } from "../policy/score-layer/types.ts"',
      ],
      [
        'server/agents/policy/score-layer/types.ts',
        'import type { SituationAnalysis } from "../../analysis/types.ts"',
      ],
    ]),
    [],
  )
})

test('concrete score families stay separate from observability and composition IDs', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/score-layers/trace-coupled.ts',
        'import type { DecisionTrace } from "../trace.ts"',
      ],
      [
        'server/agents/score-layers/report-coupled.ts',
        'import { architectureReport } from "../../eval/architecture-report.ts"',
      ],
      [
        'server/agents/score-layers/transport-coupled.ts',
        'import { parseStdioDecisionReply } from "../stdio.ts"',
      ],
      [
        'server/agents/score-layers/legacy-row.ts',
        'import type { CandidateScore } from "../policy/types.ts"',
      ],
      [
        'server/agents/score-layers/legacy-namespace.ts',
        `import type * as Legacy from "../policy/types.ts"
         type Row = Legacy.CandidateScore`,
      ],
      [
        'server/agents/composed.ts',
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
        'server/agents/composed.ts',
        'import { createGoodScoreLayerRegistry } from "./score-layers/good.ts"',
      ],
      [
        'server/agents/policy/decision-frame.ts',
        'import { family as selected } from "../score-layers/good.ts"',
      ],
      [
        'server/agents/components/family.ts',
        'import * as family from "../score-layers/good.ts"',
      ],
      [
        'server/agents/policy/family.ts',
        'export { family } from "../score-layers/good.ts"',
      ],
      [
        'server/agents/composed-dynamic.ts',
        'const family = await import("./score-layers/good.ts")',
      ],
      [
        'server/agents/composed-require.ts',
        'const family = require("./score-layers/good.ts")',
      ],
      [
        'server/agents/score-layers/evil.ts',
        'import { GOOD } from "./good.ts"',
      ],
      [
        'server/agents/score-layers/good.ts',
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
        'server/agents/score-layers/configured.ts',
        `import { GOOD } from "./good.ts"
         import * as equality from "./legacy-equality.ts"`,
      ],
      [
        'server/agents/composed.ts',
        'import { registry } from "./score-layers/configured.ts"',
      ],
    ]),
    [],
  )
})

test('native score-layer preparation and execution stay locally owned', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/composed.ts',
        'import { executePreparedScoreLayerRun } from "./policy/score-layer/runner.ts"',
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
    ]),
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
      'server/agents/composed.ts',
      'const value: DecisionComponentTrustedHostInputProvider<unknown> = root',
    ],
    [
      'server/agents/stdio.ts',
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
    [
      'server/agents/analysis/namespace-bypass.ts',
      `import * as kernel from "../components/kernel.ts"
       kernel["runDecisionComponents"](brain, request, view, invocation, trusted)`,
    ],
    [
      'server/agents/analysis/dynamic-namespace-bypass.ts',
      `const kernel = await import("../components/kernel.ts")
       kernel["runDecisionComponents"](brain, request, view, invocation, trusted)`,
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer }) => [rule, importer]),
    [
      ['ARCH004', 'server/agents/composed.ts'],
      ['ARCH004', 'server/agents/stdio.ts'],
      ['ARCH004', 'server/agents/trace.ts'],
      ['ARCH004', 'server/eval/artifact.ts'],
      ['ARCH004', 'server/eval/architecture-report.ts'],
      ['ARCH004', 'server/server.ts'],
      ['ARCH004', 'server/agents/analysis/new-owner.ts'],
      ['ARCH004', 'server/agents/analysis/namespace-bypass.ts'],
      ['ARCH004', 'server/agents/analysis/dynamic-namespace-bypass.ts'],
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
  assert.match(violations[0].message, /could not be read/)
  assert.match(violations[1].message, /duplicate normalized source path/)
  assert.match(violations[2].message, /could not be parsed/)
  assert.match(violations[3].message, /unsupported extension/)
  assert.match(violations[4].message, /outside the governed server tree/)
  assert.match(violations[5].message, /module target escapes the repository/)
})
