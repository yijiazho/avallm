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
const FORBIDDEN_AGENT_ENGINE_MODULES = new Set([
  'server/engine/game',
  'server/engine/view',
])
const TRUSTED_RUNTIME_IDENTIFIERS = new Set([
  'DecisionComponentTrustedHostInputProvider',
  'DecisionComponentTrustedHostInputProviders',
])
const TRUSTED_RUNTIME_OWNERS = new Set([
  'server/agents/composed.ts',
  'server/agents/components/kernel.ts',
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
  function addEdge(node, kind, specifier, names, namespace) {
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast))
    edges.push({
      kind,
      specifier,
      names,
      namespace,
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
  return auditArchitectureSources(entries)
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
