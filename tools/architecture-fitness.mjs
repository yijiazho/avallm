import {
  readFileSync,
  readdirSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/
const ENGINE_TYPES = 'server/engine/types'
const COMPONENT_KERNEL = 'server/agents/components/kernel'
const GENERIC_SCORE_LAYER_PREFIX = 'server/agents/policy/score-layer/'
const CONCRETE_SCORE_LAYER_PREFIX = 'server/agents/score-layers/'
const CONFIGURED_SCORE_LAYER_SEAM =
  'server/agents/score-layers/configured'
const SCORE_LAYER_RUNNER = 'server/agents/policy/score-layer/runner'
const SCORE_LAYER_ADMISSION_REPLAY =
  'server/agents/policy/score-layer/admission-replay'
const GENERIC_DECISION_LAYER_PREFIX =
  'server/agents/policy/decision-layer/'
const DECISION_LAYER_RUNNER =
  'server/agents/policy/decision-layer/runner'
const DECISION_LAYER_ADMISSION_REPLAY =
  'server/agents/policy/decision-layer/admission-replay'
const POLICY_COMPONENT_RUNTIME =
  'server/agents/policy/component-runtime'
const POLICY_COMPONENT_RUNTIME_OWNERS = new Set([
  'server/agents/policy/decision-layer/runner.ts',
  'server/agents/policy/score-layer/components.ts',
])
const DECISION_LAYER_EXECUTION_OWNERS = new Set([
  'server/agents/policy/decision-frame.ts',
  'server/agents/policy/decision-layer/admission-replay.ts',
])
const SCORER_SITUATION_SURFACE =
  'server/agents/analysis/scorer-situation-surface'
const SCORER_SITUATION_SURFACE_CONSUMERS = new Set([
  'server/agents/policy/decision-frame.ts',
  'server/agents/admission/composed-trace.ts',
])
const TRACE_ADMISSION_OWNER =
  'server/agents/admission/composed-trace'
// Historical decision-trace-v1 role-specific projections live behind one
// isolated reader. Only the generic admission owner may consult it, so a new
// role never grows a flat v1 validator and no other consumer can revive the
// retired flat shapes.
const LEGACY_ROLE_TRACE_READER =
  'server/agents/admission/legacy-role-trace-v1'
const CANONICAL_JSON_OWNER =
  'server/agents/components/canonical-json'
// The shared payload shape guards. A module that imports one and then binds
// the same name in a nested scope has a guard that silently resolves to
// something else inside that scope, which is how the private copies these
// replaced drifted apart in the first place.
const SHARED_SHAPE_GUARDS =
  'server/agents/components/canonical-shape'
// Engine purity. The engine is the seeded, replayable core: every game is a
// pure function of its seed and its log, which is what lets the simulator
// replay a transcript and get the same game back. An ambient clock or an
// unseeded random breaks that silently, since a nondeterministic engine still
// passes every assertion that does not happen to compare two runs.
const AMBIENT_NONDETERMINISM = new Set([
  'Date.now',
  'new Date',
  'Math.random',
  'performance.now',
  'crypto.randomUUID',
  'crypto.getRandomValues',
])
// Pure standard-library modules the engine may still use. Everything else,
// node builtin or npm package, is either I/O or ambient state, and the
// production server carries no runtime dependencies to import anyway.
const PURE_MODULES = new Set(['node:util', 'node:assert'])
// Prompt builders. The stable system-prefix is assembled from module
// constants so provider prompt caches hit; a per-process value baked into that
// prefix busts the cache for every call of every process, costs real money,
// and reddens nothing, because no assertion compares two processes.
const PROMPT_BUILDERS = new Set([
  'server/agents/prompts.ts',
  'server/agents/facts.ts',
  'server/agents/board.ts',
])
// The one deliberate exception, documented at its call site: an eval-only
// global A/B lever for the facts dossier, read at call time so a harness can
// set it per process and tests can flip it. Enumerated here so that a second
// ambient read cannot join it silently, and so deleting the lever leaves a
// stale entry rather than a quiet re-opening.
const PROMPT_BUILDER_AMBIENT_ALLOWED = new Map([
  ['server/agents/facts.ts', new Set(['process.env.AVALON_NO_DOSSIER'])],
])
const TRANSPORT_CANONICALIZER_EXPORT = 'canonicalizeTransportJson'
const LEGACY_TRACE_ADMISSION_EXPORTS = new Set([
  'validateComposedTraceHostJoin',
  'validateFinalizedDiagnosticDecisionTrace',
  'validateSuppressedEvilQuestCardPolicyHostJoin',
])
const SCORE_LAYER_EXECUTION_OWNERS = new Set([
  'server/agents/policy/decision-frame.ts',
  'server/agents/policy/score-layer/admission-replay.ts',
])
const FORBIDDEN_SCORE_LAYER_ROLE_LITERALS = new Set([
  'assassin',
  'evil',
  'good',
  'merlin',
  'minion',
  'mordred',
  'morgana',
  'oberon',
  'percival',
  'servant',
])
const FORBIDDEN_SCORE_LAYER_IDENTIFIER =
  /(?:Assassin|EvilRole|GoodRole|Merlin|Minion|Mordred|Morgana|Oberon|Percival|RoleObjective|Servant)/i
const FORBIDDEN_AGENT_ENGINE_MODULES = new Set([
  'server/engine/game',
  'server/engine/view',
])
const TRUSTED_RUNTIME_IDENTIFIERS = new Set([
  'DecisionComponentTrustedHostInputProvider',
  'DecisionComponentTrustedHostInputProviders',
])
const TRUSTED_RUNTIME_OWNERS = new Set([
  'server/agents/components/kernel.ts',
  // The staged composition spine initiates component execution only after
  // universal policy and constructs trusted roots from that exact frame.
  'server/agents/policy/decision-frame.ts',
])

function normalizeRepoPath(value) {
  if (typeof value !== 'string') {
    throw new Error('repository path must be a string')
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
    .replace(/^\.\//, '')
  if (
    normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('/')
    || /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new Error(`path escapes the repository: ${value}`)
  }
  return normalized
}

function moduleIdentity(value) {
  return value
    .replace(/\.(?:[cm]?[jt]sx?)$/, '')
    .replace(/\/index$/, '')
}

function resolveModule(importer, specifier) {
  const normalized = specifier.replaceAll('\\', '/').replace(/[?#].*$/, '')
  let target
  if (normalized.startsWith('.')) {
    target = moduleIdentity(path.posix.normalize(path.posix.join(
      path.posix.dirname(importer),
      normalized,
    )))
  } else if (normalized.startsWith('/')) {
    target = moduleIdentity(path.posix.normalize(normalized.slice(1)))
  } else if (normalized.startsWith('server/')) {
    target = moduleIdentity(path.posix.normalize(normalized))
  } else {
    return undefined
  }
  if (target === '..' || target.startsWith('../')) {
    throw new Error('module target escapes the repository')
  }
  return target
}

function scriptKind(sourcePath) {
  if (sourcePath.endsWith('.js') || sourcePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }
  if (sourcePath.endsWith('.mjs')) return ts.ScriptKind.JS
  if (sourcePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (sourcePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  return ts.ScriptKind.TS
}

function literalModule(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined
}

function originalNames(elements) {
  return elements.map((element) => (
    element.propertyName?.text ?? element.name.text
  ))
}

/** True when this access is itself the base of a longer chain. */
function extendsIntoParent(node) {
  return Boolean(node.parent)
    && ts.isPropertyAccessExpression(node.parent)
    && node.parent.expression === node
}

/** `a.b.c` for a chain rooted at an identifier, otherwise undefined. */
function dottedChain(node) {
  const parts = []
  let current = node
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }
  if (!ts.isIdentifier(current)) return undefined
  parts.unshift(current.text)
  return parts.join('.')
}

/** The names an import binds locally, so `x as y` yields y rather than x. */
function localNames(elements) {
  return elements.map((element) => element.name.text)
}

/**
 * Every value name bound below module scope: parameters, destructured
 * parameter properties, locals, catch bindings, and nested declarations.
 *
 * Module-scope declarations are deliberately excluded, because those collide
 * with an import as a TypeScript duplicate-identifier error already. Anything
 * that both compiles and reuses an imported name is therefore nested, and
 * nested means block scope as much as function scope: a top-level
 * `for (const x of ...)`, a bare block, and a catch clause each introduce a
 * binding that hides a module import without any enclosing function.
 */
function collectScopedBindings(ast) {
  const bindings = new Set()
  function addBindingName(name) {
    if (!name) return
    if (ts.isIdentifier(name)) {
      bindings.add(name.text)
      return
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) addBindingName(element.name)
      }
    }
  }
  // A parameter of a function type, method signature, or call signature is a
  // label in type space. It binds no value and so hides no guard.
  function typePosition(node) {
    const parent = node.parent
    return Boolean(parent) && (
      ts.isFunctionTypeNode(parent)
      || ts.isConstructorTypeNode(parent)
      || ts.isMethodSignature(parent)
      || ts.isCallSignatureDeclaration(parent)
      || ts.isConstructSignatureDeclaration(parent)
      || ts.isIndexSignatureDeclaration(parent)
    )
  }
  function visit(node, scoped) {
    // A catch binding is block scoped wherever it appears, so it can never be
    // the module-level import itself and needs no enclosing-scope test.
    if (ts.isCatchClause(node)) {
      addBindingName(node.variableDeclaration?.name)
    } else if (scoped) {
      if (ts.isParameter(node)) {
        if (!typePosition(node)) addBindingName(node.name)
      } else if (ts.isVariableDeclaration(node)) {
        addBindingName(node.name)
      } else if (
        ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
      ) {
        addBindingName(node.name)
      }
    }
    const opens = ts.isFunctionDeclaration(node)
      || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node)
      || ts.isConstructorDeclaration(node)
      || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)
      || ts.isBlock(node)
      || ts.isForStatement(node)
      || ts.isForOfStatement(node)
      || ts.isForInStatement(node)
      || ts.isCatchClause(node)
      || ts.isCaseBlock(node)
    ts.forEachChild(node, (child) => visit(child, scoped || opens))
  }
  visit(ast, false)
  return bindings
}

function importTypeNames(qualifier) {
  if (!qualifier) return []
  let current = qualifier
  while (ts.isQualifiedName(current)) current = current.right
  return ts.isIdentifier(current) ? [current.text] : []
}

/**
 * Use the repository-pinned TypeScript parser to extract dependencies and
 * capability identifiers without evaluating source.
 */
export function inspectSource(sourcePath, source) {
  const ast = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(sourcePath),
  )
  if (ast.parseDiagnostics.length) {
    const diagnostic = ast.parseDiagnostics[0]
    const position = diagnostic.start === undefined
      ? undefined
      : ast.getLineAndCharacterOfPosition(diagnostic.start)
    const where = position ? `line ${position.line + 1}` : 'unknown location'
    throw new Error(
      `${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')} (${where})`,
    )
  }

  const edges = []
  const identifiers = new Set()
  const stringLiterals = new Set()
  const ambientReads = new Set()
  function addEdge(node, kind, specifier, names, namespace, locals = []) {
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast))
    edges.push({
      kind,
      specifier,
      names,
      namespace,
      locals,
      line: line + 1,
    })
  }
  function rejectUnclassifiable(node, kind) {
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast))
    throw new Error(
      `${kind} target must be a string literal (line ${line + 1})`,
    )
  }
  function visit(node) {
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    if (ts.isStringLiteralLike(node)) stringLiterals.add(node.text)
    // Qualified reads, so a local variable named `now` is not confused with
    // the `Date.now` that actually reads a clock. The whole chain is recorded,
    // not its first two segments, so an allowlist can name a single
    // environment variable rather than the whole of `process.env`.
    if (ts.isPropertyAccessExpression(node) && !extendsIntoParent(node)) {
      const chain = dottedChain(node)
      if (chain !== undefined) ambientReads.add(chain)
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      ambientReads.add(`new ${node.expression.text}`)
    }

    if (ts.isImportDeclaration(node)) {
      const specifier = literalModule(node.moduleSpecifier)
      if (specifier !== undefined) {
        const bindings = node.importClause?.namedBindings
        addEdge(
          node,
          'import',
          specifier,
          bindings && ts.isNamedImports(bindings)
            ? originalNames(bindings.elements)
            : [],
          Boolean(bindings && ts.isNamespaceImport(bindings)),
          bindings && ts.isNamedImports(bindings)
            ? localNames(bindings.elements)
            : [],
        )
      }
    } else if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier
        ? literalModule(node.moduleSpecifier)
        : undefined
      if (specifier !== undefined) {
        const clause = node.exportClause
        addEdge(
          node,
          'export',
          specifier,
          clause && ts.isNamedExports(clause)
            ? originalNames(clause.elements)
            : [],
          clause === undefined || ts.isNamespaceExport(clause),
        )
      }
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression
      const specifier = expression ? literalModule(expression) : undefined
      if (specifier !== undefined) {
        addEdge(node, 'import-equals', specifier, [], true)
      }
    } else if (ts.isImportTypeNode(node)) {
      const specifier = ts.isLiteralTypeNode(node.argument)
        ? literalModule(node.argument.literal)
        : undefined
      if (specifier !== undefined) {
        addEdge(
          node,
          'import-type',
          specifier,
          importTypeNames(node.qualifier),
          node.qualifier === undefined,
        )
      }
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const specifier = node.arguments[0]
        ? literalModule(node.arguments[0])
        : undefined
      if (specifier === undefined) rejectUnclassifiable(node, 'dynamic import')
      // A dynamic import yields a module namespace. Treat it as namespace
      // access even when an immediate property read happens afterward.
      addEdge(node, 'dynamic-import', specifier, [], true)
    } else if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
    ) {
      const specifier = node.arguments[0]
        ? literalModule(node.arguments[0])
        : undefined
      if (specifier === undefined) rejectUnclassifiable(node, 'require')
      addEdge(node, 'require', specifier, [], true)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return Object.freeze({
    edges: Object.freeze(edges),
    identifiers,
    stringLiterals,
    ambientReads,
    scopedBindings: collectScopedBindings(ast),
  })
}

function isEngine(sourcePath) {
  return sourcePath.startsWith('server/engine/')
}

function isAgent(sourcePath) {
  return sourcePath.startsWith('server/agents/')
}

function isGenericPolicyOrComponent(sourcePath) {
  return sourcePath.startsWith('server/agents/policy/')
    || sourcePath.startsWith('server/agents/components/')
}

function isArtifactOrArchitectureReport(target, names) {
  const basename = path.posix.basename(target)
  return basename === 'artifact'
    || basename === 'architecture-report'
    || names.some((name) => (
      name === 'GameArtifact'
      || name.startsWith('Artifact')
      || name.startsWith('ArchitectureReport')
      || name === 'ArchitectureBenchmarkReport'
    ))
}

/**
 * One implementation of "this module is pure" for every layer that claims it.
 *
 * Two copies of this predicate is how the guards it protects drifted apart in
 * the first place: extending the ambient prefixes or fixing the bare-specifier
 * test must upgrade every purity rule at once, not whichever one the author
 * happened to be editing.
 */
function collectPurityViolations(violations, rule, sourcePath, inspected, text) {
  for (const read of inspected.ambientReads) {
    const ambient = AMBIENT_NONDETERMINISM.has(read)
      || [...AMBIENT_NONDETERMINISM].some((entry) => read.startsWith(`${entry}.`))
      || read.startsWith('process.')
    if (!ambient || text.allowed?.has(read)) continue
    violations.push(violation(
      rule,
      sourcePath,
      undefined,
      `${text.ambient} ${read}, ${text.ambientWhy}`,
    ))
  }
  for (const edge of inspected.edges) {
    const bare = !edge.specifier.startsWith('.')
      && !edge.specifier.startsWith('/')
      && !edge.specifier.startsWith('server/')
    if (!bare || PURE_MODULES.has(edge.specifier)) continue
    violations.push(violation(rule, sourcePath, edge, text.module))
  }
}

function violation(rule, importer, edge, detail) {
  const location = edge ? `:${edge.line}` : ''
  const dependency = edge ? ` -> ${edge.specifier}` : ''
  return Object.freeze({
    rule,
    importer,
    specifier: edge?.specifier,
    line: edge?.line,
    message: `${rule} ${importer}${location}${dependency}: ${detail}`,
  })
}

/**
 * Enforce coarse ownership rules over declared source dependencies.
 *
 * This is a fast architecture regression guard for trusted contributors, not
 * a sandbox against code deliberately loading modules through filesystem or
 * runtime-evaluation APIs. Runtime data and plugin boundaries remain
 * responsible for adversarial isolation.
 */
export function auditArchitectureSources(sourceEntries) {
  const violations = []
  const seenPaths = new Set()
  for (const entry of sourceEntries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      violations.push(violation(
        'ARCH000',
        '<unclassified>',
        undefined,
        'source entry must be a [repositoryPath, source] pair',
      ))
      continue
    }
    let sourcePath
    try {
      sourcePath = normalizeRepoPath(entry[0])
    } catch (error) {
      violations.push(violation(
        'ARCH000',
        String(entry[0]),
        undefined,
        error instanceof Error ? error.message : String(error),
      ))
      continue
    }
    if (!SOURCE_EXTENSION.test(sourcePath)) {
      violations.push(violation(
        'ARCH000',
        sourcePath,
        undefined,
        'governed source has an unsupported extension',
      ))
      continue
    }
    if (!sourcePath.startsWith('server/')) {
      violations.push(violation(
        'ARCH000',
        sourcePath,
        undefined,
        'source is outside the governed server tree',
      ))
      continue
    }
    if (seenPaths.has(sourcePath)) {
      violations.push(violation(
        'ARCH000',
        sourcePath,
        undefined,
        'duplicate normalized source path',
      ))
      continue
    }
    seenPaths.add(sourcePath)
    const source = entry[1]
    if (typeof source !== 'string') {
      violations.push(violation(
        'ARCH000',
        sourcePath,
        undefined,
        'source could not be read as text',
      ))
      continue
    }
    let inspected
    try {
      inspected = inspectSource(sourcePath, source)
    } catch (error) {
      violations.push(violation(
        'ARCH000',
        sourcePath,
        undefined,
        `source could not be parsed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ))
      continue
    }

    for (const edge of inspected.edges) {
      let target
      try {
        target = resolveModule(sourcePath, edge.specifier)
      } catch (error) {
        violations.push(violation(
          'ARCH000',
          sourcePath,
          edge,
          error instanceof Error ? error.message : String(error),
        ))
        continue
      }
      if (!target) continue
      if (
        target === TRACE_ADMISSION_OWNER
        && moduleIdentity(sourcePath) !== TRACE_ADMISSION_OWNER
        && (
          edge.namespace
          || edge.names.some((name) =>
            LEGACY_TRACE_ADMISSION_EXPORTS.has(name))
        )
      ) {
        violations.push(violation(
          'ARCH009',
          sourcePath,
          edge,
          'runtime and evaluation consumers must switch on the closed trace admission result',
        ))
        continue
      }
      if (
        target === LEGACY_ROLE_TRACE_READER
        && moduleIdentity(sourcePath) !== TRACE_ADMISSION_OWNER
      ) {
        violations.push(violation(
          'ARCH012',
          sourcePath,
          edge,
          'historical v1 role trace projections stay behind the isolated legacy reader',
        ))
        continue
      }
      if (target === SHARED_SHAPE_GUARDS && edge.kind === 'import') {
        for (const local of edge.locals) {
          if (!inspected.scopedBindings.has(local)) continue
          violations.push(violation(
            'ARCH013',
            sourcePath,
            edge,
            `${local} is rebound inside a nested scope, so the shared guard `
              + 'does not resolve there',
          ))
        }
      }
      if (
        target === CANONICAL_JSON_OWNER
        && moduleIdentity(sourcePath) !== TRACE_ADMISSION_OWNER
        && (
          edge.namespace
          || edge.names.includes(TRANSPORT_CANONICALIZER_EXPORT)
        )
      ) {
        violations.push(violation(
          'ARCH010',
          sourcePath,
          edge,
          'pre-serialization transport canonicalization is confined to trace admission ingress',
        ))
        continue
      }
      if (
        sourcePath === `${DECISION_LAYER_ADMISSION_REPLAY}.ts`
        && target === CANONICAL_JSON_OWNER
        && (
          edge.namespace
          || edge.names.includes('canonicalizeJson')
          || edge.names.includes(TRANSPORT_CANONICALIZER_EXPORT)
        )
      ) {
        violations.push(violation(
          'ARCH011',
          sourcePath,
          edge,
          'decision-layer domain admission must consume the single canonical trace ingress without recanonicalizing its child graph',
        ))
        continue
      }
      if (
        SCORER_SITUATION_SURFACE_CONSUMERS.has(sourcePath)
        && target === 'server/agents/analysis/situation'
      ) {
        violations.push(violation(
          'ARCH008',
          sourcePath,
          edge,
          `scorer-sensitive runtime and admission analysis must use ${SCORER_SITUATION_SURFACE}.ts`,
        ))
        continue
      }
      const sourceIsConcreteScoreFamily =
        sourcePath.startsWith(CONCRETE_SCORE_LAYER_PREFIX)
        && moduleIdentity(sourcePath) !== CONFIGURED_SCORE_LAYER_SEAM
      const targetIsConcreteScoreFamily =
        target.startsWith(CONCRETE_SCORE_LAYER_PREFIX)
        && target !== CONFIGURED_SCORE_LAYER_SEAM
      if (
        (
          targetIsConcreteScoreFamily
          && moduleIdentity(sourcePath) !== CONFIGURED_SCORE_LAYER_SEAM
        )
        || (
          sourceIsConcreteScoreFamily
          && target.startsWith(CONCRETE_SCORE_LAYER_PREFIX)
        )
      ) {
        violations.push(violation(
          'ARCH007',
          sourcePath,
          edge,
          'concrete score-family selection and equality aggregation are confined to score-layers/configured.ts',
        ))
        continue
      }
      if (
        sourcePath.startsWith(CONCRETE_SCORE_LAYER_PREFIX)
        && (
          target === 'server/agents/trace'
          || target === 'server/eval/architecture-report'
          || target === 'server/agents/stdio'
        )
      ) {
        violations.push(violation(
          'ARCH006',
          sourcePath,
          edge,
          'concrete score-layer families cannot depend on observability transports or the legacy CandidateScore shape',
        ))
        continue
      }
      if (
        target === SCORE_LAYER_RUNNER
        && !SCORE_LAYER_EXECUTION_OWNERS.has(sourcePath)
      ) {
        violations.push(violation(
          'ARCH006',
          sourcePath,
          edge,
          'the native score-layer runner is confined to live DecisionFrame and canonical admission replay',
        ))
        continue
      }
      if (
        target === SCORE_LAYER_ADMISSION_REPLAY
        && sourcePath !== 'server/agents/admission/composed-trace.ts'
      ) {
        violations.push(violation(
          'ARCH006',
          sourcePath,
          edge,
          'native score admission replay is confined to composed trace admission',
        ))
        continue
      }
      if (
        target === DECISION_LAYER_RUNNER
        && !DECISION_LAYER_EXECUTION_OWNERS.has(sourcePath)
      ) {
        violations.push(violation(
          'ARCH011',
          sourcePath,
          edge,
          'the strategic decision-layer runner is confined to live DecisionFrame and canonical admission replay',
        ))
        continue
      }
      if (
        target === DECISION_LAYER_ADMISSION_REPLAY
        && sourcePath !== 'server/agents/admission/composed-trace.ts'
      ) {
        violations.push(violation(
          'ARCH011',
          sourcePath,
          edge,
          'decision-layer admission replay is confined to composed trace admission',
        ))
        continue
      }
      if (
        target === POLICY_COMPONENT_RUNTIME
        && !POLICY_COMPONENT_RUNTIME_OWNERS.has(sourcePath)
      ) {
        violations.push(violation(
          'ARCH011',
          sourcePath,
          edge,
          'the shared policy-component reader and attribution runtime is confined to score and strategic layer kernels',
        ))
        continue
      }
      if (
        sourcePath.startsWith(GENERIC_SCORE_LAYER_PREFIX)
        && (
          target.startsWith('server/agents/analysis/')
          && target !== 'server/agents/analysis/types'
        )
      ) {
        violations.push(violation(
          'ARCH005',
          sourcePath,
          edge,
          'generic score-layer code cannot import role-specific analysis modules',
        ))
        continue
      }
      if (
        sourcePath.startsWith(GENERIC_DECISION_LAYER_PREFIX)
        && (
          (
            target.startsWith('server/agents/analysis/')
            && target !== 'server/agents/analysis/types'
          )
          || target === 'server/agents/components/native-role-components'
          || target.startsWith('server/agents/decision-layers/')
          || target === 'server/agents/policy/evil-quest-card'
          || target === 'server/agents/trace'
          || target.startsWith('server/eval/')
        )
      ) {
        violations.push(violation(
          'ARCH011',
          sourcePath,
          edge,
          'generic decision-layer code cannot import roles, concrete layers, traces, or evaluation shapes',
        ))
        continue
      }
      if (
        sourcePath.startsWith(GENERIC_SCORE_LAYER_PREFIX)
        && (
          target === 'server/agents/components/native-role-components'
          || target.startsWith('server/agents/score-layers/')
          || target === 'server/agents/policy/score'
          || target === 'server/agents/policy/legacy-scoring'
        )
      ) {
        violations.push(violation(
          'ARCH005',
          sourcePath,
          edge,
          'generic score-layer code cannot import concrete layers, legacy scorers, or role tokens',
        ))
        continue
      }
      if (
        isEngine(sourcePath)
        && (
          target.startsWith('server/agents/')
          || target.startsWith('server/eval/')
        )
      ) {
        violations.push(violation(
          'ARCH001',
          sourcePath,
          edge,
          'engine code cannot depend on agent or evaluation code',
        ))
        continue
      }
      if (
        isGenericPolicyOrComponent(sourcePath)
        && isArtifactOrArchitectureReport(target, edge.names)
      ) {
        violations.push(violation(
          'ARCH003',
          sourcePath,
          edge,
          'generic policy/component code cannot depend on artifact or report shapes',
        ))
        continue
      }
      if (isAgent(sourcePath) && target.startsWith('server/eval/')) {
        violations.push(violation(
          'ARCH002',
          sourcePath,
          edge,
          'runtime agent code cannot depend on evaluation code',
        ))
        continue
      }
      if (
        isAgent(sourcePath)
        && FORBIDDEN_AGENT_ENGINE_MODULES.has(target)
      ) {
        violations.push(violation(
          'ARCH002',
          sourcePath,
          edge,
          `runtime agent code cannot import raw game module ${target}`,
        ))
        continue
      }
      if (
        isAgent(sourcePath)
        && (
          edge.names.includes('Game')
          || (target === ENGINE_TYPES && edge.namespace)
        )
      ) {
        violations.push(violation(
          'ARCH002',
          sourcePath,
          edge,
          'runtime agent code cannot import the raw Game type',
        ))
      }
      if (
        !TRUSTED_RUNTIME_OWNERS.has(sourcePath)
        && target === COMPONENT_KERNEL
        && edge.namespace
      ) {
        violations.push(violation(
          'ARCH004',
          sourcePath,
          edge,
          'component-kernel namespace access is confined to the in-process composition/kernel boundary',
        ))
      }
    }

    if (sourcePath.startsWith(GENERIC_SCORE_LAYER_PREFIX)) {
      for (const identifier of inspected.identifiers) {
        if (FORBIDDEN_SCORE_LAYER_IDENTIFIER.test(identifier)) {
          violations.push(violation(
            'ARCH005',
            sourcePath,
            undefined,
            `generic score-layer code contains role-named identifier ${identifier}`,
          ))
        }
      }
      for (const literal of inspected.stringLiterals) {
        if (FORBIDDEN_SCORE_LAYER_ROLE_LITERALS.has(literal.toLowerCase())) {
          violations.push(violation(
            'ARCH005',
            sourcePath,
            undefined,
            `generic score-layer code contains role-named branch literal ${literal}`,
          ))
        }
      }
    }
    if (sourcePath.startsWith(GENERIC_DECISION_LAYER_PREFIX)) {
      for (const identifier of inspected.identifiers) {
        if (FORBIDDEN_SCORE_LAYER_IDENTIFIER.test(identifier)) {
          violations.push(violation(
            'ARCH011',
            sourcePath,
            undefined,
            `generic decision-layer code contains role-named identifier ${identifier}`,
          ))
        }
      }
      for (const literal of inspected.stringLiterals) {
        if (FORBIDDEN_SCORE_LAYER_ROLE_LITERALS.has(literal.toLowerCase())) {
          violations.push(violation(
            'ARCH011',
            sourcePath,
            undefined,
            `generic decision-layer code contains role-named branch literal ${literal}`,
          ))
        }
      }
    }
    if (isEngine(sourcePath)) {
      collectPurityViolations(violations, 'ARCH014', sourcePath, inspected, {
        ambient: 'engine code reads ambient',
        ambientWhy:
          'so a game stops being a pure function of its seed and log',
        module: 'engine code can only import pure standard-library modules',
      })
    }
    if (PROMPT_BUILDERS.has(sourcePath)) {
      collectPurityViolations(violations, 'ARCH015', sourcePath, inspected, {
        ambient: 'prompt builder reads ambient',
        ambientWhy:
          'so the cacheable prefix stops being a function of the PlayerView alone',
        module: 'prompt builders can only import pure standard-library modules',
        allowed: PROMPT_BUILDER_AMBIENT_ALLOWED.get(sourcePath),
      })
    }
    if (
      sourcePath.startsWith(CONCRETE_SCORE_LAYER_PREFIX)
      && inspected.identifiers.has('CandidateScore')
    ) {
      violations.push(violation(
        'ARCH006',
        sourcePath,
        undefined,
        'concrete score-layer families cannot use the legacy CandidateScore shape',
      ))
    }
    if (sourcePath === 'server/agents/composed.ts') {
      for (const literal of inspected.stringLiterals) {
        if (
          literal === 'good-proposal-analysis'
          || literal === 'good-vote-analysis'
        ) {
          violations.push(violation(
            'ARCH006',
            sourcePath,
            undefined,
            `composition cannot branch on concrete analysis requirement ${literal}`,
          ))
        }
      }
    }
    if (
      (
        sourcePath === `${GENERIC_SCORE_LAYER_PREFIX}preparation.ts`
        || sourcePath === `${GENERIC_SCORE_LAYER_PREFIX}runner.ts`
      )
      && (
        inspected.identifiers.has('WeakMap')
        || inspected.identifiers.has('WeakSet')
      )
    ) {
      violations.push(violation(
        'ARCH006',
        sourcePath,
        undefined,
        'score-layer preparation and execution cannot use global provenance registries',
      ))
    }

    if (!TRUSTED_RUNTIME_OWNERS.has(sourcePath)) {
      for (const identifier of TRUSTED_RUNTIME_IDENTIFIERS) {
        if (inspected.identifiers.has(identifier)) {
          violations.push(violation(
            'ARCH004',
            sourcePath,
            undefined,
            `${identifier} is confined to the in-process composition/kernel boundary`,
          ))
        }
      }
      if (inspected.identifiers.has('runDecisionComponents')) {
        violations.push(violation(
          'ARCH004',
          sourcePath,
          undefined,
          'runDecisionComponents is confined to the in-process composition/kernel boundary',
        ))
      }
    }
  }
  return Object.freeze(violations)
}

function collectServerSources(root) {
  const entries = []
  const pending = [path.join(root, 'server')]
  while (pending.length) {
    const directory = pending.pop()
    let children
    try {
      children = readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      throw new Error(
        `cannot enumerate ${path.relative(root, directory)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    for (const child of children) {
      const absolute = path.join(directory, child.name)
      if (child.isSymbolicLink()) {
        throw new Error(
          `cannot classify symbolic link ${path.relative(root, absolute)}`,
        )
      }
      if (child.isDirectory()) {
        pending.push(absolute)
        continue
      }
      if (!child.isFile() || !SOURCE_EXTENSION.test(child.name)) continue
      const relative = normalizeRepoPath(path.relative(root, absolute))
      try {
        entries.push([relative, readFileSync(absolute, 'utf8')])
      } catch (error) {
        entries.push([relative, {
          readError: error instanceof Error ? error.message : String(error),
        }])
      }
    }
  }
  return entries.sort(([left], [right]) => left.localeCompare(right))
}

export function checkStrictTestRatchetOwnership(root = process.cwd()) {
  const violations = []
  const packagePath = path.join(root, 'package.json')
  const authority = 'tools/strict-test-ratchet.mjs'
  const inventoryMarkers = [
    ['strict-test', 'baseline.json'].join('-'),
    ['test', 'support', '**', '*.ts'].join('/'),
    ['test', 'typecheck', '**', '*.ts'].join('/'),
  ]

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    // Pinned exactly, so any drift in the default gate is a fitness failure
    // rather than a silent weakening. The client typecheck sits between the two
    // because vite build does not typecheck: without it the client is the one
    // part of the tree with no type coverage. The ratchet stays last and stays
    // the single strict-test authority, which is what this rule guards.
    if (
      packageJson.scripts?.typecheck
      !== 'tsc -p tsconfig.server.json && tsc -p client/tsconfig.json'
        + ' && node tools/strict-test-ratchet.mjs'
    ) {
      violations.push(violation(
        'ARCH006',
        'package.json',
        undefined,
        'the default typecheck must use the single strict test ratchet authority',
      ))
    }
  } catch (error) {
    violations.push(violation(
      'ARCH006',
      'package.json',
      undefined,
      `cannot verify the default strict-test gate: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ))
  }

  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (
        !entry.isFile()
        || !/^tsconfig(?:\.[^.]+)*\.json$/.test(entry.name)
      ) continue
      const configPath = path.join(root, entry.name)
      const readResult = ts.readConfigFile(configPath, ts.sys.readFile)
      if (readResult.error) {
        violations.push(violation(
          'ARCH006',
          entry.name,
          undefined,
          `cannot read TypeScript config: ${
            ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n')
          }`,
        ))
        continue
      }
      const config = readResult.config
      if (
        Object.hasOwn(config, 'references')
        && (!Array.isArray(config.references) || config.references.length > 0)
      ) {
        violations.push(violation(
          'ARCH006',
          entry.name,
          undefined,
          'root TypeScript project references are rejected because they can hide a second test inventory',
        ))
      }
      const parsed = ts.parseJsonConfigFileContent(
        config,
        ts.sys,
        root,
        undefined,
        configPath,
      )
      if (parsed.errors.length) {
        violations.push(violation(
          'ARCH006',
          entry.name,
          undefined,
          `TypeScript config is invalid: ${parsed.errors.map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
          ).join('; ')}`,
        ))
        continue
      }
      const testRoot = path.resolve(root, 'test')
      const hasTestRoot = parsed.fileNames.some((fileName) => {
        const relative = path.relative(testRoot, fileName).replaceAll('\\', '/')
        return relative !== '..' && !relative.startsWith('../')
      })
      if (hasTestRoot) {
        violations.push(violation(
          'ARCH006',
          entry.name,
          undefined,
          `strict test roots belong to ${authority}, not ${entry.name}`,
        ))
      }
    }
  } catch (error) {
    violations.push(violation(
      'ARCH006',
      'tsconfig*.json',
      undefined,
      `cannot audit duplicate strict-test inventories: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ))
  }

  try {
    for (const entry of readdirSync(path.join(root, 'tools'), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
      const relative = `tools/${entry.name}`
      if (relative === authority) continue
      const source = readFileSync(path.join(root, relative), 'utf8')
      if (inventoryMarkers.some((marker) => source.includes(marker))) {
        violations.push(violation(
          'ARCH006',
          relative,
          undefined,
          `strict test inventory details belong only to ${authority}`,
        ))
      }
    }
  } catch (error) {
    violations.push(violation(
      'ARCH006',
      'tools',
      undefined,
      `cannot audit strict-test tool ownership: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ))
  }
  return violations
}

export function checkRepositoryArchitecture(root = process.cwd()) {
  let entries
  try {
    entries = collectServerSources(root)
  } catch (error) {
    return Object.freeze([violation(
      'ARCH000',
      'server',
      undefined,
      error instanceof Error ? error.message : String(error),
    )])
  }
  return Object.freeze([
    ...auditArchitectureSources(entries),
    ...checkStrictTestRatchetOwnership(root),
  ])
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  const violations = checkRepositoryArchitecture()
  if (violations.length) {
    for (const item of violations) console.error(item.message)
    process.exitCode = 1
  } else {
    console.log('architecture fitness: server dependency boundaries pass')
  }
}
