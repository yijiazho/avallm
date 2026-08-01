import {
  existsSync,
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
const CONCRETE_SCORE_LAYER_PREFIX = 'server/agents/role-score-layers/'
const CONFIGURED_SCORE_LAYER_SEAM =
  'server/agents/role-score-layers/configured'
const SCORE_LAYER_RUNNER = 'server/agents/policy/score-layer/runner'
const SCORE_LAYER_ADMISSION_REPLAY =
  'server/agents/policy/score-layer/admission-replay'
const GENERIC_DECISION_LAYER_PREFIX =
  'server/agents/policy/decision-layer/'
const DECISION_LAYER_RUNNER =
  'server/agents/policy/decision-layer/runner'
const DECISION_LAYER_ADMISSION_REPLAY =
  'server/agents/policy/decision-layer/admission-replay'
// The two replay modules are confined to trace admission. composed-trace.ts
// split into siblings and each replay travelled with its one caller:
// `replayNativeScoresForAdmission` to the native score replay, and
// `createDecisionLayerAdmissionAuthority` to the module that builds the
// production registries. The siblings that need only the admitted-trace TYPE
// take it re-exported from that registry module rather than earning an edge of
// their own. Exact paths, never the folder: a directory prefix here would let
// any future sibling replay the policy, which is the confinement itself.
const SCORE_LAYER_ADMISSION_REPLAY_OWNERS = new Set([
  'server/agents/admission/composed-trace.ts',
  'server/agents/admission/composed-trace/native-score-replay.ts',
])
const DECISION_LAYER_ADMISSION_REPLAY_OWNERS = new Set([
  'server/agents/admission/composed-trace.ts',
  'server/agents/admission/composed-trace/production-registries.ts',
])
// The skeleton the layer families and the component registry instantiate. It
// carries the identity grammar, the branded token mint, the component-read
// contract, and the trace projection, so an unrelated agent module importing it
// would be reaching past its own seam into shared registry internals. The
// owners are enumerated rather than prefixed because the legitimate consumers
// are registries and type modules in three named places, not a directory.
const LAYER_REGISTRY_COMMON =
  'server/agents/policy/layer-registry-common'
const LAYER_REGISTRY_COMMON_SOURCE = `${LAYER_REGISTRY_COMMON}.ts`
const LAYER_REGISTRY_COMMON_OWNERS = new Set([
  'server/agents/components/registry.ts',
  'server/agents/policy/decision-frame.ts',
  'server/agents/trace-builder.ts',
])
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
// Inverse list: naming a file here FORBIDS it from reading analysis/situation
// directly, forcing it through the surface builder, so an entry tightens rather
// than relaxes. `composed-trace.ts` split into siblings and
// `buildScorerSituationSurface` went with the policy host reconstruction, so
// that exact sibling is named too. The original entry stays: it still names a
// real file, and a fitness test builds a synthetic one.
const SCORER_SITUATION_SURFACE_CONSUMERS = new Set([
  'server/agents/policy/decision-frame.ts',
  'server/agents/admission/composed-trace.ts',
  'server/agents/admission/composed-trace/policy-host-surface.ts',
])
const TRACE_ADMISSION_OWNER =
  'server/agents/admission/composed-trace'
// The belief-only decision-trace-v1 role-component validators live behind one
// isolated reader. Only the generic admission owner may consult it, so a new
// role never grows a flat v1 validator and no other consumer can revive the
// retired flat shapes.
const ROLE_TRACE_V1_READER =
  'server/agents/admission/role-trace-v1'
// composed-trace.ts split into siblings, and the v1 readers travelled with the
// validators that call them: `validRoleTraceV1` to the detached validator and
// `validRoleTraceV1HostJoin` to the exact host join. The ingress file kept
// `validRoleDependencyHostJoinV1`, so its identity stays. Exact identities only,
// never the folder, or a sibling could revive a flat v1 validator merely by
// being born in the right directory.
const ROLE_TRACE_V1_OWNERS = new Set([
  TRACE_ADMISSION_OWNER,
  'server/agents/admission/composed-trace/detached',
  'server/agents/admission/composed-trace/exact-host-join',
])
const CANONICAL_JSON_OWNER =
  'server/agents/canonical/canonical-json'
// The shared payload shape guards. A module that imports one and then binds
// the same name in a nested scope has a guard that silently resolves to
// something else inside that scope, which is how the private copies these
// replaced drifted apart in the first place.
const SHARED_SHAPE_GUARDS =
  'server/agents/canonical/canonical-shape'
/**
 * The callable exports of that module, pinned here so ARCH016 can name them.
 *
 * Hand-listed and then checked against the module's real exports by
 * test/canonical-shape.test.ts, which reads the source and derives the set. A
 * guard added there without being added here would otherwise be a guard nobody
 * scans for.
 */
export const SHARED_SHAPE_GUARD_NAMES = Object.freeze([
  'canonicalCombinations',
  'canonicalRequestBlock',
  'canonicalRoles',
  'canonicalSeats',
  // The role comparator came down here with the role order it reads. It is a
  // comparator rather than a shape predicate, but it belongs in this set for
  // the reason the set exists: a hand-rolled role sort is exactly the private
  // copy that drifts, and now there is one owner for ARCH016 to name.
  'compareCanonicalRoles',
  'denseArray',
  'exactKeys',
  'onlyAllowedKeys',
  'plainDataRecord',
  'plainDetachedData',
  'plainRecord',
  'probability',
  'sequenceEqual',
  'signedUnit',
  'strictCanonicalArray',
  'tableSize',
  'validateBeliefSource',
])
/**
 * Whole names this repository has already decided are spellings of a guard.
 *
 * `embedsGuardName` catches a private copy that keeps the guard's own word and
 * affixes it, which is how validCanonicalSeats and finiteProbability were
 * found. It is blind to a copy that simply picks a different word, and two of
 * those were live when this table was written. `seatArray` in composed-trace
 * admission and in the Morgana role utility was canonicalSeats with the table
 * bound dropped, so an admitted trace could name seat 9999 at a five-handed
 * table. `isRecord` in the language factor and the language contract was
 * plainRecord with the proxy and prototype checks dropped. All four modules
 * already imported some other guard from the shared module, so the import
 * hatch did not cover them: that exemption is per guard, and it stays per
 * guard here.
 *
 * Matched on the whole predicate name rather than through embedsGuardName. A
 * synonym is a word this table asserts means the guard; an affix on top of a
 * synonym is a much weaker signal, and language-contract's validSeatArray is
 * the live counterexample. It is a bounded seat set in host order, and the
 * public record cannot promise ascending seats because the engine stores a
 * team in the order its leader supplied, so it is a deliberate neighbour of
 * canonicalSeats rather than a copy of it.
 *
 * A third spelling is a one-line addition here, and the rule then fails loudly
 * at whichever module wrote it.
 */
export const SHARED_SHAPE_GUARD_SYNONYMS = Object.freeze([
  Object.freeze({
    name: 'isRecord',
    guards: Object.freeze(['plainRecord', 'plainDataRecord']),
  }),
  Object.freeze({
    name: 'isPlainRecord',
    guards: Object.freeze(['plainRecord', 'plainDataRecord']),
  }),
  Object.freeze({
    name: 'plainRecordCheck',
    guards: Object.freeze(['plainRecord', 'plainDataRecord']),
  }),
  Object.freeze({
    name: 'seatArray',
    guards: Object.freeze(['canonicalSeats']),
  }),
  Object.freeze({
    name: 'seatList',
    guards: Object.freeze(['canonicalSeats']),
  }),
])
// The shared numeric arithmetic: tolerances, clamps, the tolerance comparator,
// the count-lattice check, and the log-space pair.
const SHARED_PROBABILITY_ARITHMETIC =
  'server/agents/canonical/probability-arithmetic'
/**
 * The callable exports of that module, pinned here so ARCH017 can name them.
 *
 * Hand-listed and then checked against the module's real exports by
 * test/probability-arithmetic.test.ts, exactly as SHARED_SHAPE_GUARD_NAMES is
 * checked by test/canonical-shape.test.ts. A helper added there without being
 * added here would be a helper nobody scans for.
 */
export const SHARED_ARITHMETIC_HELPER_NAMES = Object.freeze([
  'addProbability',
  'capLogLikelihood',
  'clampProbability',
  'clampProbabilityOrZero',
  'closeProbability',
  'compensatedSum',
  'countLatticeTolerance',
  'latticeCount',
  'logWeightsToProbabilities',
  'logWeightsToProbabilitiesPreservingSupport',
  'stableProbabilitySum',
])
/**
 * Whole names this repository has already decided are spellings of one of them.
 *
 * The same second arm SHARED_SHAPE_GUARD_SYNONYMS is for, and for the same
 * reason: `embedsGuardName` reads the helper's own word, so a copy that renames
 * the word outright walks past it. All four of these were live when the table
 * was written. `clamp01` was the unit clamp in four analysis modules and
 * `clamp` its bare spelling; `close` was the tolerance comparator in four more,
 * one of which had lost the constant and written `1e-12` by hand. Same escape
 * hatch as ARCH016, and still per helper: importing the clamp clears `clamp01`
 * and leaves a private `close` reported.
 */
export const SHARED_ARITHMETIC_HELPER_SYNONYMS = Object.freeze([
  Object.freeze({
    name: 'clamp01',
    helpers: Object.freeze(['clampProbability', 'clampProbabilityOrZero']),
  }),
  Object.freeze({
    name: 'clamp',
    helpers: Object.freeze(['clampProbability', 'clampProbabilityOrZero']),
  }),
  Object.freeze({
    name: 'close',
    helpers: Object.freeze(['closeProbability']),
  }),
  Object.freeze({
    name: 'nearlyEqual',
    helpers: Object.freeze(['closeProbability']),
  }),
])
/**
 * A positive numeric literal at or below this is a floating-point tolerance,
 * whatever the author called it.
 *
 * Nothing else in the agent tree is this small. The smallest deliberate
 * magnitude in `server/agents/` outside a tolerance is the `0.04` viability
 * band, four orders of magnitude above the ceiling, so the test is a clean
 * separator rather than a threshold that needs tuning. Picking a ceiling rather
 * than a set of known values is what makes a future `1e-10` a violation on the
 * day it is written instead of a fifth regime nobody notices.
 */
const TOLERANCE_LITERAL_CEILING = 1e-6
/**
 * Modules allowed to spell a tolerance literal anyway, by exact literal text.
 *
 * Empty, and that is the finding: every one of the 83 raw literals this rule was
 * written for had a name available and simply was not using it. An entry here is
 * a claim that some module needs a magnitude the owner module cannot name, which
 * is a claim worth making explicitly and out loud rather than by typing digits.
 */
const TOLERANCE_LITERAL_EXEMPTIONS = new Map([])
/**
 * Where a magnitude may be written down, by area.
 *
 * One owner per area rather than one for the tree: the agent layers and the
 * evaluation layers do different numeric work and their constants answer to
 * different contracts. probability-arithmetic.ts holds the slack a comparison
 * may spend; statistics.ts holds the bounds a published score is computed
 * with, including the log-loss clips, which are not tolerances at all. Pointing
 * eval at the agent module would either import the agent tree into eval or
 * force two unrelated regimes into one file, and that module's own header
 * spends a paragraph on why a second regime must not quietly join the first.
 */
// Declared here rather than beside isAgent because the magnitude-area table
// below needs it, and that table is read by ARCHITECTURE_SCOPE_LISTS earlier in
// the file than isAgent sits.
const AGENT_PREFIX = 'server/agents/'
const SHARED_EVAL_STATISTICS = 'server/eval/core/statistics'
/**
 * One table, so the two questions cannot drift apart. Which areas the rule
 * covers and which module each is told to use are the same fact, and encoding
 * them separately means a later widening updates one and silently leaves the
 * other pointing a new layer at the agent tree's module, which is the coupling
 * the per-area split exists to avoid.
 */
const TOLERANCE_MAGNITUDE_AREAS = Object.freeze([
  Object.freeze({
    prefix: 'server/eval/',
    owner: SHARED_EVAL_STATISTICS,
    label: 'eval/core/statistics.ts',
  }),
  Object.freeze({
    prefix: AGENT_PREFIX,
    owner: SHARED_PROBABILITY_ARITHMETIC,
    label: 'canonical/probability-arithmetic.ts',
  }),
])
const TOLERANCE_MAGNITUDE_OWNERS = new Set(
  TOLERANCE_MAGNITUDE_AREAS.map((area) => area.owner),
)

/** The area a file belongs to, or undefined when magnitudes are ungoverned. */
function magnitudeAreaFor(sourcePath) {
  return TOLERANCE_MAGNITUDE_AREAS.find(
    (area) => sourcePath.startsWith(area.prefix),
  )
}
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
  'console',
])
const AMBIENT_GLOBAL_CALLS = new Set([
  'Date',
  'fetch',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'queueMicrotask',
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
  'server/agents/raw-llm/prompts.ts',
  'server/agents/raw-llm/facts.ts',
  'server/agents/board.ts',
  // The voice norms moved out of prompts.ts to let communication/ stop
  // importing the agents root. They are still text a model is shown, so the
  // purity obligation follows the text rather than the filename it used to
  // sit behind: a prompt string assembled from an ambient read is the defect
  // this set exists to catch, and it does not care which module wrote it.
  'server/agents/communication/voice-norms.ts',
])
// The one deliberate exception, documented at its call site: an eval-only
// global A/B lever for the facts dossier, read at call time so a harness can
// set it per process and tests can flip it. Enumerated here so that a second
// ambient read cannot join it silently, and so deleting the lever leaves a
// stale entry rather than a quiet re-opening.
const PROMPT_BUILDER_AMBIENT_ALLOWED = new Map([
  ['server/agents/raw-llm/facts.ts', new Set(['process.env.AVALON_NO_DOSSIER'])],
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
// Every generic layer scope that must stay role-blind, each reported under its
// own code and named honestly so a violation points at the right owner. The
// shared skeleton is generic layer code too: without an entry here, moving a
// function out of a scanned family directory into it would silently exempt it.
const GENERIC_LAYER_ROLE_SCOPES = [
  {
    prefix: GENERIC_SCORE_LAYER_PREFIX,
    code: 'ARCH005',
    label: 'generic score-layer code',
  },
  {
    prefix: GENERIC_DECISION_LAYER_PREFIX,
    code: 'ARCH011',
    label: 'generic decision-layer code',
  },
  {
    prefix: LAYER_REGISTRY_COMMON_SOURCE,
    code: 'ARCH011',
    label: 'shared generic layer code',
  },
]
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

/**
 * Every hand-maintained list that decides which SOURCE FILES a rule applies to.
 *
 * These lists are the scope of the rules above, and a stale one fails silently
 * in the worst direction: a path that no longer exists means the rule quietly
 * stopped covering a file, and nothing reddens, because a rule with nothing to
 * check passes. The two lists that already had this problem solved,
 * SHARED_SHAPE_GUARD_NAMES and SHARED_ARITHMETIC_HELPER_NAMES, each got a test
 * that derives the truth from the tree and compares. Both of their test files
 * say why in as many words: a helper added to the module without being added to
 * the list is a helper nobody scans for. The same sentence was true of these ten
 * and none of them had it, so the guard is generalized here rather than written
 * an eleventh time.
 *
 * Exported as one manifest rather than ten constants so that adding a list is
 * the same edit as classifying it. `kind` records what the entries are, because
 * the liveness question is only meaningful for some of them:
 *
 *   'source'      paths to files the rule scopes itself to. Must exist. A stale
 *                 entry is lost enforcement.
 *   'identifier'  bare names, not paths. Nothing to resolve.
 *
 * Deliberately NOT covered: a forbidden import TARGET, such as ARCH005's ban on
 * `server/agents/policy/legacy-scoring`. That module was deleted in 5479bb1f and
 * the ban is kept on purpose, so that re-adding legacy scoring cannot quietly
 * re-open the import. Requiring those to exist would delete a working guard.
 * Those are written inline in their rule's condition, not in a Set here, which
 * is the line this manifest draws.
 */
export const ARCHITECTURE_SCOPE_LISTS = Object.freeze([
  ['SCORE_LAYER_ADMISSION_REPLAY_OWNERS', 'source', SCORE_LAYER_ADMISSION_REPLAY_OWNERS],
  ['DECISION_LAYER_ADMISSION_REPLAY_OWNERS', 'source', DECISION_LAYER_ADMISSION_REPLAY_OWNERS],
  ['LAYER_REGISTRY_COMMON_OWNERS', 'source', LAYER_REGISTRY_COMMON_OWNERS],
  ['POLICY_COMPONENT_RUNTIME_OWNERS', 'source', POLICY_COMPONENT_RUNTIME_OWNERS],
  ['DECISION_LAYER_EXECUTION_OWNERS', 'source', DECISION_LAYER_EXECUTION_OWNERS],
  ['SCORER_SITUATION_SURFACE_CONSUMERS', 'source', SCORER_SITUATION_SURFACE_CONSUMERS],
  // Found by the manifest's own meta-guard, not by reading the file: the hand
  // enumeration used the pattern `[A-Z_]*OWNERS`, which the `V1` defeats. That
  // is the failure mode this whole manifest exists for, arriving before the
  // first commit.
  ['ROLE_TRACE_V1_OWNERS', 'source', ROLE_TRACE_V1_OWNERS],
  ['PROMPT_BUILDERS', 'source', PROMPT_BUILDERS],
  ['SCORE_LAYER_EXECUTION_OWNERS', 'source', SCORE_LAYER_EXECUTION_OWNERS],
  ['TRUSTED_RUNTIME_OWNERS', 'source', TRUSTED_RUNTIME_OWNERS],
  // Caught by this manifest's own meta-guard the first time the list was added,
  // which is the second time that scan has found a list its author forgot.
  // Members are module identities rather than paths, which the liveness check
  // resolves through its `.ts` fallback.
  ['TOLERANCE_MAGNITUDE_OWNERS', 'source', TOLERANCE_MAGNITUDE_OWNERS],
  ['TRUSTED_RUNTIME_IDENTIFIERS', 'identifier', TRUSTED_RUNTIME_IDENTIFIERS],
].map(([name, kind, members]) =>
  Object.freeze({ name, kind, members: Object.freeze([...members]) })))

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

/**
 * Whether an import contributes nothing at runtime.
 *
 * `import type { X } from` and a named clause whose every member is `type X`
 * are both erased by the compiler, so they cannot carry an ambient read or any
 * other behavior into the importing module. A closure that counts them
 * over-reports: following type edges out of the prompt builders reaches
 * server/llm/openrouter.ts, whose `process.env` read is legitimate and can
 * never touch prompt text, and reporting it would be a false positive.
 *
 * The `!clause.name` guard is the case worth spelling out: `import D, { type A }`
 * has an all-type-only named clause but still binds `D` at runtime, so it is a
 * value edge. A bare `import './x.ts'` has no clause at all and runs the module
 * for its side effects, which is also a value edge.
 */
function isTypeOnlyImport(clause, bindings) {
  if (!clause) return false
  if (clause.isTypeOnly) return true
  return !clause.name
    && Boolean(bindings)
    && ts.isNamedImports(bindings)
    && bindings.elements.length > 0
    && bindings.elements.every((element) => element.isTypeOnly)
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
    && (
      (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
      || (ts.isElementAccessExpression(node.parent) && node.parent.expression === node)
    )
}

/** `a.b.c` for a chain rooted at an identifier, otherwise undefined. */
function dottedChain(node) {
  const parts = []
  let current = node
  while (
    ts.isPropertyAccessExpression(current)
    || ts.isElementAccessExpression(current)
  ) {
    if (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text)
      current = current.expression
      continue
    }
    const argument = current.argumentExpression
    if (!argument || !ts.isStringLiteralLike(argument)) return undefined
    parts.unshift(argument.text)
    current = current.expression
  }
  if (!ts.isIdentifier(current)) return undefined
  parts.unshift(current.text)
  const chain = parts.join('.')
  return chain.startsWith('globalThis.')
    ? chain.slice('globalThis.'.length)
    : chain
}

/** True when an identifier is the root of a dotted or bracketed access. */
function extendsIntoAccess(node) {
  return Boolean(node.parent)
    && (
      (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
      || (ts.isElementAccessExpression(node.parent) && node.parent.expression === node)
    )
}

function bindingContains(name, wanted) {
  if (!name) return false
  if (ts.isIdentifier(name)) return name.text === wanted
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.some((element) =>
      ts.isBindingElement(element) && bindingContains(element.name, wanted))
  }
  return false
}

function scopeBindsName(scope, wanted) {
  if (ts.isFunctionLike(scope)) {
    if (scope.name && ts.isIdentifier(scope.name) && scope.name.text === wanted) {
      return true
    }
    if (scope.parameters.some((parameter) =>
      bindingContains(parameter.name, wanted))) return true
  }
  if (ts.isCatchClause(scope)) {
    return bindingContains(scope.variableDeclaration?.name, wanted)
  }
  if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) return false
  for (const statement of scope.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && statement.name?.text === wanted
    ) return true
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (clause?.name?.text === wanted) return true
      const bindings = clause?.namedBindings
      if (
        bindings
        && ts.isNamespaceImport(bindings)
        && bindings.name.text === wanted
      ) return true
      if (
        bindings
        && ts.isNamedImports(bindings)
        && bindings.elements.some((element) => element.name.text === wanted)
      ) return true
    }
    if (!ts.isVariableStatement(statement)) continue
    if (statement.declarationList.declarations.some((declaration) =>
      bindingContains(declaration.name, wanted))) return true
  }
  return false
}

function locallyBound(node, wanted) {
  let current = node.parent
  while (current) {
    if (scopeBindsName(current, wanted)) return true
    current = current.parent
  }
  return false
}

function accessRootIdentifier(node) {
  let current = node
  while (
    ts.isPropertyAccessExpression(current)
    || ts.isElementAccessExpression(current)
  ) current = current.expression
  return ts.isIdentifier(current) ? current : undefined
}

function identifierIsSyntacticName(node) {
  const parent = node.parent
  if (!parent) return false
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isFunctionExpression(parent) && parent.name === node)
    || (ts.isClassDeclaration(parent) && parent.name === node)
    || (ts.isTypeAliasDeclaration(parent) && parent.name === node)
    || (ts.isInterfaceDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || ts.isImportSpecifier(parent)
    || ts.isExportSpecifier(parent)
    || ts.isNamespaceImport(parent)
    || ts.isImportClause(parent)
    || (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isMethodSignature(parent) && parent.name === node)
    || (ts.isQualifiedName(parent) && parent.right === node)
    || ts.isBindingElement(parent)
  )
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

/**
 * Module-level predicate declarations, by name and line.
 *
 * Only the *signature* is read, never the body: a declaration counts when its
 * annotated return type is `boolean`, `x is T`, or `asserts x is T`. That is
 * what makes ARCH016 usable on names like `probability`, which is both a shared
 * guard and an ordinary domain noun. `failProbability`, `clampProbability`, and
 * `probabilityLabel` return a number or a string, so they never enter this set;
 * `validProbability` and `finiteProbability`, the two private copies that were
 * live when this was written, are predicates and do.
 *
 * An explicit annotation is authoritative. For an unannotated helper, a small
 * syntax-only inference recognizes unambiguous boolean expressions so omitting
 * `: boolean` cannot become an easy way around the shared-owner rule. Ambiguous
 * bodies stay outside the heuristic rather than pretending to be typechecked.
 */
function collectModulePredicates(ast) {
  return collectModuleSignatures(ast, (type) => (
    ts.isTypePredicateNode(type)
    || type.kind === ts.SyntaxKind.BooleanKeyword
  ), 'boolean')
}

/**
 * Module-level numeric helper declarations, by name and line.
 *
 * The exact counterpart of collectModulePredicates, reading the same
 * signatures through the same walk, and it exists because that function's
 * exclusion turned out to be a hole rather than a boundary. `clampProbability`
 * returns a number and so never entered the predicate set, which is precisely
 * why six copies of the unit clamp could accumulate while ARCH016 was
 * successfully preventing a seventh copy of a shape guard. A collector that
 * reads `number` is a different collector, not a widening of that one.
 *
 * `number | undefined` counts: latticeCount returns the integer or nothing, and
 * a private copy of it would be written the same way.
 */
function collectModuleNumericHelpers(ast) {
  const numeric = (type) => type.kind === ts.SyntaxKind.NumberKeyword
  return collectModuleSignatures(ast, (type) => (
    numeric(type)
    || (ts.isUnionTypeNode(type) && type.types.some(numeric))
  ), 'number')
}

/** A conservative syntax-only return kind for unannotated small helpers. */
function inferredExpressionKind(expression) {
  if (!expression) return undefined
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword
    || expression.kind === ts.SyntaxKind.FalseKeyword
  ) return 'boolean'
  if (ts.isNumericLiteral(expression)) return 'number'
  if (ts.isParenthesizedExpression(expression)) {
    return inferredExpressionKind(expression.expression)
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    if (expression.operator === ts.SyntaxKind.ExclamationToken) return 'boolean'
    if (
      expression.operator === ts.SyntaxKind.PlusToken
      || expression.operator === ts.SyntaxKind.MinusToken
      || expression.operator === ts.SyntaxKind.TildeToken
    ) return 'number'
  }
  if (ts.isConditionalExpression(expression)) {
    const left = inferredExpressionKind(expression.whenTrue)
    const right = inferredExpressionKind(expression.whenFalse)
    return left === right ? left : undefined
  }
  if (ts.isBinaryExpression(expression)) {
    const booleanOperators = new Set([
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.LessThanToken,
      ts.SyntaxKind.LessThanEqualsToken,
      ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.GreaterThanEqualsToken,
      ts.SyntaxKind.InKeyword,
      ts.SyntaxKind.InstanceOfKeyword,
    ])
    if (booleanOperators.has(expression.operatorToken.kind)) return 'boolean'
    if (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      const left = inferredExpressionKind(expression.left)
      const right = inferredExpressionKind(expression.right)
      return left === 'boolean' && right === 'boolean' ? 'boolean' : undefined
    }
    const numericOperators = new Set([
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.AsteriskToken,
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.PercentToken,
      ts.SyntaxKind.AsteriskAsteriskToken,
      ts.SyntaxKind.AmpersandToken,
      ts.SyntaxKind.BarToken,
      ts.SyntaxKind.CaretToken,
      ts.SyntaxKind.LessThanLessThanToken,
      ts.SyntaxKind.GreaterThanGreaterThanToken,
      ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
    ])
    if (numericOperators.has(expression.operatorToken.kind)) return 'number'
  }
  if (ts.isCallExpression(expression)) {
    const call = dottedChain(expression.expression)
    if (
      call === 'Boolean'
      || call === 'Number.isFinite'
      || call === 'Number.isInteger'
      || call === 'Number.isNaN'
      || call === 'Array.isArray'
      || call === 'Object.hasOwn'
    ) return 'boolean'
    if (
      call === 'Number'
      || call === 'parseFloat'
      || call === 'parseInt'
      || call?.startsWith('Math.')
    ) return 'number'
  }
  return undefined
}

function inferredReturnKind(signature) {
  if (!signature.body) return undefined
  if (!ts.isBlock(signature.body)) return inferredExpressionKind(signature.body)
  const kinds = []
  const visit = (node) => {
    if (node !== signature.body && ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.expression) {
      kinds.push(inferredExpressionKind(node.expression))
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(signature.body)
  if (!kinds.length || kinds.some((kind) => kind === undefined)) return undefined
  return kinds.every((kind) => kind === kinds[0]) ? kinds[0] : undefined
}

/**
 * The shared walk behind both collectors: every module-level function or
 * arrow declaration whose annotated return type satisfies `acceptType`.
 *
 * Explicit annotations are authoritative. Unannotated bodies use the
 * conservative syntax-only inference above; it recognizes clear boolean and
 * numeric expressions without turning this architecture pass into a second
 * typechecker.
 */
function collectModuleSignatures(ast, acceptType, inferredKind) {
  const collected = []
  const record = (name, signature) => {
    if (!name || !ts.isIdentifier(name)) return
    if (
      signature.type
        ? !acceptType(signature.type)
        : inferredReturnKind(signature) !== inferredKind
    ) return
    const { line } = ast.getLineAndCharacterOfPosition(name.getStart(ast))
    collected.push(Object.freeze({ name: name.text, line: line + 1 }))
  }
  // Module level only. A declaration nested inside a function is not a second
  // definition a later reader can pick up by mistake, and ARCH013 already
  // rejects one that hides an imported guard.
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      record(statement.name, statement)
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
      if (
        !initializer
        || (
          !ts.isArrowFunction(initializer)
          && !ts.isFunctionExpression(initializer)
        )
      ) continue
      // The return type sits on the initializer in `= (v): boolean =>` and on
      // the variable in `: (v: unknown) => boolean = (v) =>`. Both spell the
      // same predicate, and a function type is a signature too, so either end
      // reads the same way; any other annotation carries no return type of its
      // own and drops out of `record`.
      record(
        declaration.name,
        initializer.type ? initializer : declaration.type ?? initializer,
      )
    }
  }
  return Object.freeze(collected)
}

/**
 * Every positive numeric literal below TOLERANCE_LITERAL_CEILING, by text and
 * line.
 *
 * A name-based rule cannot see a magnitude that was never given a name, and the
 * whole finding was 83 magnitudes with no name. This is the arm that would have
 * caught it on the first file rather than on the fourteenth.
 */
function collectToleranceLiterals(ast) {
  const literals = []
  const visit = (node) => {
    if (ts.isNumericLiteral(node)) {
      const value = Number(node.text)
      if (value > 0 && value <= TOLERANCE_LITERAL_CEILING) {
        const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast))
        literals.push(Object.freeze({ text: node.text, line: line + 1 }))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return Object.freeze(literals)
}

/**
 * Whether `name` carries `guard`: `finiteProbability`, `probabilityOfClean`, and
 * `denseArrays` all do, `improbable` does not.
 *
 * A prefix counts however it continues. Requiring the next character to start a
 * new camelCase word would let a plural or an adjectival tail through, and
 * pluralizing an identifier is the cheapest way there is to write a second
 * definition of it. Mid-name the capitalized form is required, which is what
 * keeps `improbable` out.
 */
function embedsGuardName(name, guard) {
  return name.startsWith(guard)
    || name.includes(`${guard[0].toUpperCase()}${guard.slice(1)}`)
}

function importTypeNames(qualifier) {
  if (!qualifier) return []
  let current = qualifier
  while (ts.isQualifiedName(current)) current = current.right
  return ts.isIdentifier(current) ? [current.text] : []
}

/** Named members selected directly from a dynamic import expression. */
function dynamicImportNames(node) {
  let current = node
  while (
    current.parent
    && (
      ts.isAwaitExpression(current.parent)
      || ts.isParenthesizedExpression(current.parent)
    )
  ) current = current.parent
  const parent = current.parent
  if (
    parent
    && ts.isPropertyAccessExpression(parent)
    && parent.expression === current
  ) return [parent.name.text]
  if (
    parent
    && ts.isElementAccessExpression(parent)
    && parent.expression === current
    && parent.argumentExpression
    && ts.isStringLiteralLike(parent.argumentExpression)
  ) return [parent.argumentExpression.text]
  if (
    parent
    && ts.isVariableDeclaration(parent)
    && parent.initializer === current
    && ts.isObjectBindingPattern(parent.name)
  ) return originalNames(parent.name.elements)
  return []
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
  const localExports = []
  const typeAliases = []
  function addEdge(
    node,
    kind,
    specifier,
    names,
    namespace,
    locals = [],
    typeOnly = false,
  ) {
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast))
    edges.push({
      kind,
      specifier,
      names,
      namespace,
      locals,
      typeOnly,
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
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && !extendsIntoParent(node)
    ) {
      const chain = dottedChain(node)
      const root = accessRootIdentifier(node)
      if (
        chain !== undefined
        && (!root || !locallyBound(root, root.text))
      ) ambientReads.add(chain)
    }
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && !locallyBound(node.expression, node.expression.text)
    ) {
      ambientReads.add(`new ${node.expression.text}`)
    }
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && AMBIENT_GLOBAL_CALLS.has(node.expression.text)
      && !locallyBound(node.expression, node.expression.text)
    ) {
      ambientReads.add(node.expression.text)
    }
    if (
      ts.isIdentifier(node)
      && node.text === 'process'
      && !extendsIntoAccess(node)
      && !identifierIsSyntacticName(node)
      && !locallyBound(node, 'process')
    ) {
      ambientReads.add('process')
    }

    if (ts.isImportDeclaration(node)) {
      const specifier = literalModule(node.moduleSpecifier)
      if (specifier !== undefined) {
        const clause = node.importClause
        const bindings = clause?.namedBindings
        const importedNames = []
        const importedLocals = []
        if (clause?.name) {
          importedNames.push('default')
          importedLocals.push(clause.name.text)
        }
        if (bindings && ts.isNamedImports(bindings)) {
          importedNames.push(...originalNames(bindings.elements))
          importedLocals.push(...localNames(bindings.elements))
        } else if (bindings && ts.isNamespaceImport(bindings)) {
          importedLocals.push(bindings.name.text)
        }
        addEdge(
          node,
          'import',
          specifier,
          importedNames,
          Boolean(bindings && ts.isNamespaceImport(bindings)),
          importedLocals,
          isTypeOnlyImport(clause, bindings),
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
          clause && ts.isNamedExports(clause)
            ? localNames(clause.elements)
            : clause && ts.isNamespaceExport(clause)
              ? [clause.name.text]
              : [],
          // `export type { X } from` is erased exactly as the import form is, so
          // a type-only re-export must not extend the prompt closure either.
          node.isTypeOnly
            || Boolean(
              clause
              && ts.isNamedExports(clause)
              && clause.elements.length > 0
              && clause.elements.every((element) => element.isTypeOnly),
            ),
        )
      } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          localExports.push(Object.freeze({
            local: element.propertyName?.text ?? element.name.text,
            exported: element.name.text,
          }))
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression
      const specifier = expression ? literalModule(expression) : undefined
      if (specifier !== undefined) {
        addEdge(node, 'import-equals', specifier, [], true, [], node.isTypeOnly)
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
      addEdge(node, 'dynamic-import', specifier, dynamicImportNames(node), true)
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
    } else if (ts.isTypeAliasDeclaration(node)) {
      const dependencies = new Set()
      const collect = (part) => {
        if (ts.isIdentifier(part) && !identifierIsSyntacticName(part)) {
          dependencies.add(part.text)
        }
        ts.forEachChild(part, collect)
      }
      collect(node.type)
      typeAliases.push(Object.freeze({
        name: node.name.text,
        dependencies: Object.freeze([...dependencies]),
        exported: Boolean(node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )),
      }))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return Object.freeze({
    edges: Object.freeze(edges),
    identifiers,
    stringLiterals,
    ambientReads,
    localExports: Object.freeze(localExports),
    typeAliases: Object.freeze(typeAliases),
    scopedBindings: collectScopedBindings(ast),
    predicates: collectModulePredicates(ast),
    numericHelpers: collectModuleNumericHelpers(ast),
    toleranceLiterals: collectToleranceLiterals(ast),
  })
}

function isEngine(sourcePath) {
  return sourcePath.startsWith('server/engine/')
}

function isShared(sourcePath) {
  return sourcePath.startsWith('server/shared/')
}

function isAgent(sourcePath) {
  return sourcePath.startsWith(AGENT_PREFIX)
}

/**
 * The tier each server/agents/ subdirectory occupies, low to high.
 *
 * When this table was written the folders under server/agents/ were importing
 * and being imported by almost every other one: about eighty percent of a
 * complete mesh over nine folders. The file graph was a DAG throughout, so
 * nothing was broken; what was missing was any order the folder names could
 * carry. A folder that predicts nothing about what may depend on it is a filing
 * cabinet, not a boundary.
 *
 * The mesh turned out not to be made of mutual dependencies. It was made of
 * single imports pointing the wrong way, and each one made a whole folder
 * unplaceable. canonical-shape.ts held the domain-free shape guards that
 * analysis, belief, policy and communication all consume, and reached back up
 * into belief/types.ts for one role comparator. policy/types.ts held
 * PolicyCandidate, which fourteen analysis modules need, and reached up into
 * analysis for one string-literal union. Nothing was looking for edges of that
 * shape, so they accumulated.
 *
 * A rank rather than an adjacency list, because the question asked at review is
 * "may this file import that one", and a rank answers it without holding a
 * dozen sets in your head. Equal ranks are legal in both directions and are how
 * the one genuine mutual dependency is stated: see components and policy.
 *
 * The numbers are meaningless in themselves and only the comparison matters, so
 * inserting a tier means renumbering. That is deliberate: a new tier is a claim
 * about the whole order and should be read as one.
 */
const AGENT_DIRECTORY_TIERS = new Map([
  // Domain-free canonical shape guards and fixed-point probability arithmetic.
  // Imports nothing else in agents/ at all. Nothing here may know what a
  // belief, a candidate or a seat's role means.
  ['canonical/', 0],
  // The vocabulary of a legal move: PolicyCandidate, the candidate-id order,
  // role applicability, and why a play was forced. Named for the noun rather
  // than for policy, because analysis needs it and analysis is below policy.
  ['candidate/', 1],
  // What the table saw, what was said at it, and what a seat means to do about
  // it: the public record projection, the utterance schema, the mechanical
  // evidence transcript, and the strategic-intent vocabulary with its
  // validators. An input to belief, analysis and cognition rather than a
  // rendering of them, which is why it does not live under communication/.
  ['record/', 1],
  ['belief/', 2],
  ['analysis/', 3],
  ['cognition/', 4],
  // One tier, two directories. resolveComposedBrain turns a brain spec into a
  // component registry and a pair of layer chains at once; components/kernel.ts
  // imports it and policy/decision-frame.ts imports it, and the layer
  // registries and the component registry share layer-registry-common.
  // Ordering these two would mean either merging them, which costs the
  // score-layer/ and decision-layer/ prefixes that ARCH005 and ARCH011 are
  // written against, or inverting resolved-brain.ts through a callback across
  // forty consumers. Equal rank states the fact instead of asserting an order
  // that is not there, and every other tier is still ordered against both.
  ['components/', 5],
  ['policy/', 5],
  // The role tier. A concrete role may reach down into the kernel and the
  // analysis it specializes; nothing below may reach up into a role.
  ['role-score-layers/', 6],
  ['role-decision-layers/', 6],
  // Diagnostic projections OVER the configured role families, which is why
  // this is not itself a family: put it under role-score-layers/ and ARCH006
  // and ARCH007 correctly start treating it as one.
  ['score-diagnostics/', 7],
  // Rendering. It consumes belief, analysis, plans and the record, and produces
  // prose. Once the record vocabulary and its validators moved down to record/
  // it had no inbound edge from below at all.
  ['communication/', 8],
  // Trace admission, the last thing before the composition spine.
  ['admission/', 9],
  // Terminal selectable-agent lanes. They consume the shared stages above but
  // may not import one another; ARCH022 enforces that stronger peer boundary.
  ['heuristic/', 10],
  ['raw-llm/', 10],
  ['composed/', 10],
])

/**
 * Files sitting directly in server/agents/ are outside the order, and return
 * undefined here in both roles.
 *
 * The executable heuristic, raw-LLM, and composed implementations now live in
 * ranked terminal directories. Their old root paths are compatibility facades;
 * registry.ts imports the real lane entry points directly, and ARCH022 prevents
 * other root modules or peer lanes from laundering dependencies through them.
 *
 * The remaining root is shared vocabulary plus construction and transport
 * boundaries. trace.ts is why it cannot simply be ranked at the top: it imports
 * most of the subdirectories, and several admission modules import it back, so
 * it is at once the top of the order and a shape vocabulary near the bottom.
 * Bringing that vocabulary into the order still requires splitting trace shapes
 * from their builder. Until then, admission-to-root and components-to-root edges
 * remain the known debt.
 *
 * A nested directory keys on its FIRST segment, so every file under
 * policy/score-layer/ or admission/composed-trace/ carries its parent's rank.
 * The tiers describe the folders someone chose to separate concerns between,
 * not every directory that exists.
 */
function agentDirectoryTier(modulePath) {
  if (!modulePath.startsWith(AGENT_PREFIX)) return undefined
  const rest = modulePath.slice(AGENT_PREFIX.length)
  const boundary = rest.indexOf('/')
  if (boundary < 0) return undefined
  return AGENT_DIRECTORY_TIERS.get(rest.slice(0, boundary + 1))
}

export { AGENT_DIRECTORY_TIERS }

const AGENT_LANE_PREFIXES = Object.freeze([
  'server/agents/heuristic/',
  'server/agents/raw-llm/',
  'server/agents/composed/',
])

const AGENT_LANE_COMPATIBILITY_FACADES = new Map([
  ['server/agents/heuristic.ts', 'server/agents/heuristic/'],
  ['server/agents/llm.ts', 'server/agents/raw-llm/'],
  ['server/agents/composed.ts', 'server/agents/composed/'],
  ['server/agents/prompts.ts', 'server/agents/raw-llm/'],
  ['server/agents/facts.ts', 'server/agents/raw-llm/'],
  ['server/agents/knowledge-text.ts', 'server/agents/raw-llm/'],
  ['server/agents/prompt-format.ts', 'server/agents/raw-llm/'],
  ['server/agents/belief-summary-context.ts', 'server/agents/raw-llm/'],
  ['server/agents/parse.ts', 'server/agents/raw-llm/'],
])

const AGENT_LANE_COMPATIBILITY_FACADE_IDENTITIES = new Set(
  [...AGENT_LANE_COMPATIBILITY_FACADES.keys()].map(moduleIdentity),
)
const AGENT_LANE_COMPATIBILITY_FACADE_SOURCES = new Map([
  ['server/agents/heuristic.ts', "// Compatibility facade. New production imports should name the lane module.\nexport { createHeuristicAgent } from './heuristic/agent.ts'\nexport { heuristicDecide } from './policy/heuristic-fallback.ts'\n"],
  ['server/agents/llm.ts', "// Compatibility facade. New production imports should name the raw-LLM lane.\nexport { createLlmAgent, type LlmAgentOpts } from './raw-llm/agent.ts'\n"],
  ['server/agents/composed.ts', "// Compatibility facade. New production imports should name the lane module.\nexport {\n  createComposedAgent,\n  type ComposedAgentOptions,\n  type ComposedAvalonAgent,\n  type ComposedStage,\n} from './composed/agent.ts'\n"],
  ['server/agents/prompts.ts', "// Compatibility facade for raw-LLM prompt construction.\nexport * from './raw-llm/prompts.ts'\n"],
  ['server/agents/facts.ts', "// Compatibility facade for raw-LLM prompt facts.\nexport * from './raw-llm/facts.ts'\n"],
  ['server/agents/knowledge-text.ts', "// Compatibility facade for raw-LLM private-knowledge rendering.\nexport * from './raw-llm/knowledge-text.ts'\n"],
  ['server/agents/prompt-format.ts', "// Compatibility facade for raw-LLM prompt formatting.\nexport * from './raw-llm/prompt-format.ts'\n"],
  ['server/agents/belief-summary-context.ts', "// Compatibility facade for the raw-LLM belief-context adapter.\nexport * from './raw-llm/belief-context.ts'\n"],
  ['server/agents/parse.ts', "// Compatibility facade for the raw-LLM decision parser.\nexport * from './raw-llm/decision-parser.ts'\n"],
])
function agentLane(modulePath) {
  return AGENT_LANE_PREFIXES.find((prefix) => modulePath.startsWith(prefix))
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
      || AMBIENT_GLOBAL_CALLS.has(read)
      || [...AMBIENT_NONDETERMINISM].some((entry) => read.startsWith(`${entry}.`))
      || read === 'process'
      || read.startsWith('process.')
    if (!ambient || text.allowed?.has(read)) continue
    violations.push(violation(
      rule,
      sourcePath,
      undefined,
      `${text.ambient} ${read}, ${text.ambientWhy}`,
    ))
  }
  // An omitted module arm means the caller wants only the ambient check. ARCH015
  // uses that for modules it reaches through the prompt closure rather than
  // declares as roots: they can put a value into prompt text, so an ambient read
  // is theirs to answer for, but they are ordinary agent modules and are not
  // held to the roots' standard-library-only import diet.
  if (!text.module) return
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

/** Repository paths and module identities for one audit's sources. */
function indexSources(entries) {
  const sourceByPath = new Map()
  const pathByIdentity = new Map()
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    if (typeof entry[0] !== 'string' || typeof entry[1] !== 'string') continue
    let sourcePath
    try {
      sourcePath = normalizeRepoPath(entry[0])
    } catch {
      continue
    }
    // First occurrence wins, matching the main loop, which reports a duplicate
    // path as ARCH000 and analyses only the first. Letting a later duplicate
    // overwrite here would seed the shared parse memo from a source the loop
    // never looks at, and every rule for that file would then be evaluated
    // against text it was not given.
    if (sourceByPath.has(sourcePath)) continue
    sourceByPath.set(sourcePath, entry[1])
    pathByIdentity.set(moduleIdentity(sourcePath), sourcePath)
  }
  return { sourceByPath, pathByIdentity }
}

/**
 * Every module reachable from `roots` through value imports, roots included.
 *
 * Two rules need this and they need the same thing: a purity obligation is a
 * property of what a module can reach, and a per-file check can only stand in
 * for that while something bounds the reachable set. ARCH015 uses it for prompt
 * text, ARCH014 for the engine.
 *
 * What it bought ARCH015, since that is the case it was measured on. The rule
 * used to check exactly the four files in PROMPT_BUILDERS, which was sound only
 * for text those four assembled entirely by themselves. On the tree at the time,
 * the roots reached 55 modules at runtime and the rule inspected 4 of them,
 * roughly 7% of its own risk surface. The unchecked remainder included
 * prompt-format.ts, knowledge-text.ts, record/public-record.ts and
 * communication/belief-summary.ts, all text renderers, precisely the category
 * PROMPT_BUILDERS' own comment says the obligation follows: "a prompt string
 * assembled from an ambient read is the defect this set exists to catch, and it
 * does not care which module wrote it." The implementation cared, because it
 * did not traverse. Nothing in the unchecked 51 was reading ambient state, so
 * the widening fixed no live defect and needed no exemptions.
 *
 * Type-only edges are skipped, and that is load-bearing rather than tidy: see
 * isTypeOnlyImport for why counting them would manufacture a false positive on
 * the OpenRouter client.
 */
function valueImportClosure(roots, index, inspectOnce) {
  const { sourceByPath, pathByIdentity } = index
  const reached = new Set()
  const pending = [...roots]
  while (pending.length) {
    const sourcePath = pending.pop()
    if (reached.has(sourcePath)) continue
    reached.add(sourcePath)
    const source = sourceByPath.get(sourcePath)
    if (source === undefined) continue
    const { inspected } = inspectOnce(sourcePath, source)
    if (!inspected) continue
    for (const edge of inspected.edges) {
      if (edge.typeOnly) continue
      let target
      try {
        target = resolveModule(sourcePath, edge.specifier)
      } catch {
        continue
      }
      if (!target) continue
      const next = pathByIdentity.get(target)
      if (next && !reached.has(next)) pending.push(next)
    }
  }
  return reached
}

/**
 * Exported names whose type resolves, through imports, aliases, or re-exports,
 * to the engine's raw Game interface.
 *
 * ARCH002 used to inspect only the spelling on an agent's direct import. A
 * facade could therefore write `export type { Game as RawState }` and make the
 * raw state available to agents under a name the rule no longer recognized.
 * This fixed-point graph keeps the rule about provenance instead of spelling.
 */
function rawGameExports(index, inspectOnce) {
  const { sourceByPath } = index
  const exportsByModule = new Map([[ENGINE_TYPES, new Set(['Game'])]])
  let changed = true
  while (changed) {
    changed = false
    for (const [sourcePath, source] of sourceByPath) {
      const identity = moduleIdentity(sourcePath)
      const { inspected } = inspectOnce(sourcePath, source)
      if (!inspected) continue
      const locals = new Set(identity === ENGINE_TYPES ? ['Game'] : [])

      for (const edge of inspected.edges) {
        if (edge.kind !== 'import' && edge.kind !== 'import-equals') continue
        let target
        try {
          target = resolveModule(sourcePath, edge.specifier)
        } catch {
          continue
        }
        const targetExports = target && exportsByModule.get(target)
        if (!targetExports?.size) continue
        if (edge.namespace) {
          for (const local of edge.locals) locals.add(local)
          continue
        }
        for (let index = 0; index < edge.names.length; index += 1) {
          if (!targetExports.has(edge.names[index])) continue
          locals.add(edge.locals[index] ?? edge.names[index])
        }
      }

      let aliasesChanged = true
      while (aliasesChanged) {
        aliasesChanged = false
        for (const alias of inspected.typeAliases) {
          if (
            locals.has(alias.name)
            || !alias.dependencies.some((name) => locals.has(name))
          ) continue
          locals.add(alias.name)
          aliasesChanged = true
        }
      }

      const exported = new Set(exportsByModule.get(identity) ?? [])
      for (const edge of inspected.edges) {
        if (edge.kind !== 'export') continue
        let target
        try {
          target = resolveModule(sourcePath, edge.specifier)
        } catch {
          continue
        }
        const targetExports = target && exportsByModule.get(target)
        if (!targetExports?.size) continue
        if (edge.namespace) {
          if (edge.locals.length) {
            for (const local of edge.locals) exported.add(local)
          } else {
            for (const name of targetExports) exported.add(name)
          }
          continue
        }
        for (let index = 0; index < edge.names.length; index += 1) {
          if (!targetExports.has(edge.names[index])) continue
          exported.add(edge.locals[index] ?? edge.names[index])
        }
      }
      for (const item of inspected.localExports) {
        if (locals.has(item.local)) exported.add(item.exported)
      }
      for (const alias of inspected.typeAliases) {
        if (alias.exported && locals.has(alias.name)) exported.add(alias.name)
      }

      const prior = exportsByModule.get(identity)
      if (prior && exported.size === prior.size) continue
      exportsByModule.set(identity, exported)
      changed = true
    }
  }
  return exportsByModule
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
  // Materialized because the prompt-text closure below needs a second look at
  // the same sources, and the caller may hand us a generator.
  const entries = [...sourceEntries]
  const parseMemo = new Map()
  /**
   * Parse once per path, however many passes ask. The closure pass visits only
   * the modules it can reach, and the main loop then reuses those results, so
   * deriving the scope costs no additional parsing.
   */
  const inspectOnce = (sourcePath, source) => {
    if (parseMemo.has(sourcePath)) return parseMemo.get(sourcePath)
    let result
    try {
      result = { inspected: inspectSource(sourcePath, source), error: undefined }
    } catch (error) {
      result = { inspected: undefined, error }
    }
    parseMemo.set(sourcePath, result)
    return result
  }
  const sourceIndex = indexSources(entries)
  const rawGameExportsByModule = rawGameExports(sourceIndex, inspectOnce)
  const promptTextModules = valueImportClosure(
    PROMPT_BUILDERS,
    sourceIndex,
    inspectOnce,
  )
  // The engine's purity obligation, as a reachability question rather than a
  // per-file one. ARCH014 inspects files under server/engine/ and ARCH019 does
  // the same for server/shared/, which the engine imports; between them every
  // module the engine can currently reach is covered. Nothing enforced that,
  // though. ARCH001 bans only server/agents/ and server/eval/ by name, and the
  // purity check's own module arm sees bare specifiers only, so a relative
  // import into a third layer would satisfy every rule while putting
  // unchecked code inside the engine's closure.
  //
  // That is not hypothetical drift: server/shared/ is exactly such a layer, and
  // ARCH019 exists because somebody noticed in time and wrote the rule by hand.
  // This makes the next one impossible to miss instead of relying on that.
  const engineReach = valueImportClosure(
    [...sourceIndex.sourceByPath.keys()].filter(isEngine),
    sourceIndex,
    inspectOnce,
  )
  for (const reachedPath of engineReach) {
    if (isEngine(reachedPath) || isShared(reachedPath)) continue
    violations.push(violation(
      'ARCH014',
      reachedPath,
      undefined,
      'the engine reaches this module through value imports, but no purity '
        + 'rule covers it, so a clock or an unseeded random here would make a '
        + 'game stop being a pure function of its seed and log',
    ))
  }
  for (const entry of entries) {
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
    const parsed = inspectOnce(sourcePath, source)
    const inspected = parsed.inspected
    if (!inspected) {
      const error = parsed.error
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

    const expectedFacadeSource =
      AGENT_LANE_COMPATIBILITY_FACADE_SOURCES.get(sourcePath)
    if (
      expectedFacadeSource !== undefined
      && source
        .replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10))
        .replaceAll(String.fromCharCode(13), String.fromCharCode(10))
        !== expectedFacadeSource
    ) {
      violations.push(violation(
        'ARCH022',
        sourcePath,
        undefined,
        'agent compatibility facades must remain exact re-exports of their '
          + 'ranked implementation owners',
      ))
    }
    // Which shared guards this module has in scope, by their exported names, so
    // ARCH016 below can tell a wrapper around the shared predicate from a second
    // definition of it.
    const guardsInScope = new Set()
    // The same idea for the numeric half, read by ARCH017 below.
    const arithmeticInScope = new Set()
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
        target === ROLE_TRACE_V1_READER
        && !ROLE_TRACE_V1_OWNERS.has(moduleIdentity(sourcePath))
      ) {
        violations.push(violation(
          'ARCH012',
          sourcePath,
          edge,
          'historical v1 role trace projections stay behind the isolated legacy reader',
        ))
        continue
      }
      if (
        target === SHARED_PROBABILITY_ARITHMETIC
        && edge.kind === 'import'
      ) {
        if (edge.namespace) {
          for (const name of SHARED_ARITHMETIC_HELPER_NAMES) {
            arithmeticInScope.add(name)
          }
        }
        for (const name of edge.names) arithmeticInScope.add(name)
      }
      if (target === SHARED_SHAPE_GUARDS && edge.kind === 'import') {
        if (edge.namespace) {
          for (const name of SHARED_SHAPE_GUARD_NAMES) guardsInScope.add(name)
        }
        for (const name of edge.names) guardsInScope.add(name)
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
          'concrete score-family selection and equality aggregation are confined to role-score-layers/configured.ts',
        ))
        continue
      }
      if (
        sourcePath.startsWith(CONCRETE_SCORE_LAYER_PREFIX)
        && (
          target === 'server/agents/trace'
          || target === 'server/eval/architecture-report'
          || target === 'server/agents/external-reply'
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
        && !SCORE_LAYER_ADMISSION_REPLAY_OWNERS.has(sourcePath)
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
        && !DECISION_LAYER_ADMISSION_REPLAY_OWNERS.has(sourcePath)
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
        target === LAYER_REGISTRY_COMMON
        && !LAYER_REGISTRY_COMMON_OWNERS.has(sourcePath)
        && !sourcePath.startsWith(GENERIC_SCORE_LAYER_PREFIX)
        && !sourcePath.startsWith(GENERIC_DECISION_LAYER_PREFIX)
      ) {
        violations.push(violation(
          'ARCH011',
          sourcePath,
          edge,
          'the shared layer registry skeleton is confined to the layer families, the component registry, and the trace writers',
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
          && target !== 'server/agents/analysis/situation-types'
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
            && target !== 'server/agents/analysis/situation-types'
          )
          || target === 'server/agents/components/native-role-components'
          || target.startsWith('server/agents/role-decision-layers/')
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
          || target.startsWith('server/agents/role-score-layers/')
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
        isEngine(sourcePath)
        && !edge.typeOnly
        && !sourceIndex.pathByIdentity.has(target)
        && !target.startsWith('server/engine/')
        && !target.startsWith('server/shared/')
      ) {
        violations.push(violation(
          'ARCH014',
          sourcePath,
          edge,
          'engine value imports must stay inside engine/ or shared/ so every '
            + 'reachable module carries a purity rule',
        ))
        continue
      }
      // ARCH019. server/shared/ holds the primitives with no domain in them:
      // a seeded PRNG, DeepReadonly, an LRU map, key-list type guards. The
      // folder is only worth having while that stays true, and the failure
      // mode is gradual. One helper reaches into engine/types.ts for a Seat,
      // the next imports a policy shape, and within a year "shared" names
      // wherever something was put down rather than a layer anything may
      // depend on. A one-way door is cheaper than the judgement call at each
      // future addition.
      //
      // Every in-repo target counts, not just the ones under server/.
      // `resolveModule` has already returned undefined for bare specifiers, so
      // reaching here means a real path in this repository, and a shared
      // primitive importing `../../client/src/types.ts` has acquired a domain
      // exactly as surely as one importing the engine. Restricting this to
      // server/ targets would leave client/, tools/, and data/ as a way around
      // it that the purity half cannot see either, since a relative specifier
      // is never bare.
      if (isShared(sourcePath) && !isShared(target)) {
        violations.push(violation(
          'ARCH019',
          sourcePath,
          edge,
          'shared primitives cannot depend on any layer that has a domain in it',
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
      const rawGameNames = rawGameExportsByModule.get(target)
      if (
        isAgent(sourcePath)
        && (
          edge.names.includes('Game')
          || (
            rawGameNames
            && (
              (edge.namespace && rawGameNames.size > 0)
              || edge.names.some((name) => rawGameNames.has(name))
            )
          )
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
      // ARCH022. Terminal agent lanes are selectable siblings, not extension
      // layers. Cross-lane imports make one implementation a hidden fallback or
      // adapter of another and turn the registry's explicit construction into a
      // polite fiction. Shared mechanics belong in a ranked lower tier.
      const importerLane = agentLane(sourcePath)
      const targetLane = agentLane(target)
      const expectedFacadeLane = AGENT_LANE_COMPATIBILITY_FACADES.get(sourcePath)
      const targetsAgentFacade =
        AGENT_LANE_COMPATIBILITY_FACADE_IDENTITIES.has(target)
      if (
        (importerLane && targetLane && importerLane !== targetLane)
        || (importerLane && targetsAgentFacade)
        || (
          targetLane
          && !importerLane
          && sourcePath !== 'server/agents/registry.ts'
          && expectedFacadeLane !== targetLane
        )
      ) {
        violations.push(violation(
          'ARCH022',
          sourcePath,
          edge,
          'selectable agent lanes cannot import one another or be reached '
            + 'through an unapproved root module. Move shared behavior to a '
            + 'ranked lower tier and keep cross-lane construction in registry.ts',
        ))
        continue
      }

      // ARCH020. An agent subdirectory importing one that is above it.
      //
      // Last among the edge rules on purpose. Every narrower rule above
      // describes a specific seam and says something a reader can act on; this
      // one only says the folders are in the wrong order, which is the less
      // useful message when both apply. Each of those rules already continues,
      // so an edge reaching here is one no narrower rule claimed.
      //
      // Both ends must be ranked. An unranked end is a root file or a directory
      // nobody has placed yet, and failing open there is deliberate: a new
      // subdirectory should be ranked by the person who knows where it belongs,
      // not rejected by default at whatever rank the rule happened to guess.
      // test/architecture-fitness.test.ts asserts that every directory on disk
      // is ranked, so "nobody has placed it yet" cannot outlive the commit that
      // creates it.
      const importerTier = agentDirectoryTier(sourcePath)
      const targetTier = agentDirectoryTier(target)
      if (
        importerTier !== undefined
        && targetTier !== undefined
        && targetTier > importerTier
      ) {
        violations.push(violation(
          'ARCH020',
          sourcePath,
          edge,
          'agent directory layering is a partial order, and this edge points '
            + 'up it, so neither directory is below the other and the folder '
            + 'names stop predicting what may depend on what. Move the '
            + 'imported symbol down to the tier that needs it rather than '
            + 'widening the tier that has it',
        ))
      }
    }

    // ARCH016. A private copy of a shared shape guard, wearing an affixed name.
    //
    // test/canonical-shape.test.ts already rejects a module-level declaration
    // that spells a guard's name exactly, importer or not. What it cannot see is
    // the same predicate under a nearby name, which is how four of them survived
    // that scan: assertExactKeys in the role report, validProbability in the
    // scorer, finiteProbability in trace admission, validCanonicalSeats in
    // identity. Each was semantically the shared guard, none of them imported it,
    // and the last one was also weaker than it.
    //
    // The escape hatch is the import: a module with the guard in scope is taken
    // to be wrapping it rather than replacing it, which is what keeps the
    // deliberate neighbours legal. positiveProbability wants a half-open
    // interval, validProbabilityLattice checks a normalized sum, and
    // assertExactKeys wants a labelled throw around the shared predicate; all
    // three sit next to the guard they are named after, where a reader can see
    // both. A module that names its predicate after a guard it never imported is
    // telling the reader nothing about which of the two contracts is in force.
    //
    // The affix arm reads the guard's own word, so a copy that renames the word
    // outright walks past it. SHARED_SHAPE_GUARD_SYNONYMS is the second arm: a
    // short list of whole names that mean a shared guard, each with the guards
    // whose import would make it a wrapper. Same escape hatch, same per-guard
    // scope.
    if (moduleIdentity(sourcePath) !== SHARED_SHAPE_GUARDS) {
      for (const predicate of inspected.predicates) {
        for (const guard of SHARED_SHAPE_GUARD_NAMES) {
          if (
            predicate.name === guard
            || guardsInScope.has(guard)
            || !embedsGuardName(predicate.name, guard)
          ) continue
          violations.push(violation(
            'ARCH016',
            sourcePath,
            undefined,
            `predicate ${predicate.name} (line ${predicate.line}) is named `
              + `after the shared guard ${guard} without importing it, so the `
              + 'reader cannot tell which contract holds',
          ))
        }
        for (const synonym of SHARED_SHAPE_GUARD_SYNONYMS) {
          if (
            predicate.name !== synonym.name
            || synonym.guards.some((guard) => guardsInScope.has(guard))
          ) continue
          violations.push(violation(
            'ARCH016',
            sourcePath,
            undefined,
            `predicate ${predicate.name} (line ${predicate.line}) is a known `
              + `spelling of the shared guard ${synonym.guards.join(' or ')} `
              + 'without importing it, so the reader cannot tell which '
              + 'contract holds',
          ))
        }
      }
    }

    // ARCH017. The numeric half of the same defect: a private copy of a shared
    // arithmetic helper, or a tolerance magnitude written as digits.
    //
    // ARCH016 works, and the duplication moved to where it was not looking.
    // collectModulePredicates reads return types and its doc comment records
    // the exclusion in as many words: `failProbability`, `clampProbability`,
    // and `probabilityLabel` return a number or a string, so they never enter
    // that set. The consequence, measured when this rule was written: against
    // the one named tolerance constant the tree held 83 raw tolerance literals
    // across 14 files, six copies of the unit clamp under two names plus five
    // more spelled inline, and four private `close` comparators, one of which
    // had dropped the constant and written `1e-12` by hand. Mixed inside single
    // functions, so one validator checked a sum at 1e-9 and the value beside it
    // at 1e-12 with nothing naming the difference.
    //
    // Three arms, in ascending order of how much they assume.
    //
    // The first two mirror ARCH016 exactly, including its per-helper import
    // hatch: a module with the helper in scope is taken to be wrapping it.
    // `clamp01` and `close` are the synonyms, because renaming the word is how
    // eight of the copies stayed invisible.
    //
    // The third arm is the one that would have caught the whole finding: in the
    // agent tree, a positive numeric literal small enough to be a tolerance is
    // a violation wherever it is not the owner module. A name-based rule can
    // only ever find a magnitude somebody named, and none of these were named.
    // The exemption table is deliberately empty; see it for what an entry
    // would mean.
    const arithmeticOwner =
      moduleIdentity(sourcePath) === SHARED_PROBABILITY_ARITHMETIC
    if (!arithmeticOwner) {
      const helpers = [...inspected.predicates, ...inspected.numericHelpers]
      for (const helper of helpers) {
        for (const shared of SHARED_ARITHMETIC_HELPER_NAMES) {
          if (
            helper.name === shared
            || arithmeticInScope.has(shared)
            || !embedsGuardName(helper.name, shared)
          ) continue
          violations.push(violation(
            'ARCH017',
            sourcePath,
            undefined,
            `helper ${helper.name} (line ${helper.line}) is named after the `
              + `shared arithmetic helper ${shared} without importing it, so `
              + 'the reader cannot tell which contract holds',
          ))
        }
        for (const synonym of SHARED_ARITHMETIC_HELPER_SYNONYMS) {
          if (
            helper.name !== synonym.name
            || synonym.helpers.some((name) => arithmeticInScope.has(name))
          ) continue
          violations.push(violation(
            'ARCH017',
            sourcePath,
            undefined,
            `helper ${helper.name} (line ${helper.line}) is a known spelling `
              + `of the shared ${synonym.helpers.join(' or ')} without `
              + 'importing it, so the reader cannot tell which contract holds',
          ))
        }
      }
    }
    // Agents and eval, each answering to its own owner module.
    //
    // The arm was scoped to the agent tree deliberately, not by oversight: the
    // note on the case below argued the engine has no probabilities and that
    // eval "is an offline calibration layer with its own numerics". The first
    // half still holds and is why the engine stays out; it also could not
    // comply, since ARCH001 forbids it from importing either owner, so a
    // violation there would be advice it cannot take.
    //
    // The second half is what changed. Having its own numerics is a reason for
    // eval to have its own owner, not a reason for its magnitudes to go
    // unowned, and the difference showed: eval held two log-loss clips written
    // independently at 1e-12 and 1e-15 for the same job. They are named in
    // eval/core/statistics.ts now, which is where that layer's numbers already
    // live. sim and llm stay out as before; neither has a magnitude today and
    // widening on speculation would be inventing a rule for nobody.
    const magnitudeOwner = TOLERANCE_MAGNITUDE_OWNERS.has(
      moduleIdentity(sourcePath),
    )
    const magnitudeArea = magnitudeAreaFor(sourcePath)
    if (magnitudeArea && !magnitudeOwner) {
      const owner = magnitudeArea.label
      const exempt = TOLERANCE_LITERAL_EXEMPTIONS.get(sourcePath)
      for (const literal of inspected.toleranceLiterals) {
        if (exempt?.has(literal.text)) continue
        violations.push(violation(
          'ARCH017',
          sourcePath,
          undefined,
          `tolerance literal ${literal.text} (line ${literal.line}) has no `
            + `owner; name it in ${owner} so a call site says which regime it `
            + 'wanted',
        ))
      }
    }

    // One scan over every generic layer scope. The blocks per scope differed
    // only in violation code and the noun in their message, and the shared
    // skeleton was covered by none of them.
    for (const scope of GENERIC_LAYER_ROLE_SCOPES) {
      if (!sourcePath.startsWith(scope.prefix)) continue
      for (const identifier of inspected.identifiers) {
        if (FORBIDDEN_SCORE_LAYER_IDENTIFIER.test(identifier)) {
          violations.push(violation(
            scope.code,
            sourcePath,
            undefined,
            `${scope.label} contains role-named identifier ${identifier}`,
          ))
        }
      }
      for (const literal of inspected.stringLiterals) {
        if (FORBIDDEN_SCORE_LAYER_ROLE_LITERALS.has(literal.toLowerCase())) {
          violations.push(violation(
            scope.code,
            sourcePath,
            undefined,
            `${scope.label} contains role-named branch literal ${literal}`,
          ))
        }
      }
    }
    if (isEngine(sourcePath)) {
      collectPurityViolations(violations, 'ARCH014', sourcePath, inspected, {
        ambient: 'engine code reads ambient',
        ambientWhy:
          'so a game stops being a pure function of its seed and log',
        // Says what it checks. The old wording, "engine code can only import
        // pure standard-library modules", claimed a great deal more than this
        // arm delivers: it inspects bare specifiers only, so every relative
        // import in the tree walks past it untouched. What actually keeps the
        // engine's in-repo imports honest is ARCH001 for agents and eval, and
        // the reachability check above for anything else.
        module: 'engine code can only import pure standard-library packages; '
          + 'in-repo imports are governed by the engine reachability rule',
      })
    }
    // The engine imports shared primitives, so a clock or an I/O import here
    // would be engine impurity that ARCH014 cannot see: it inspects engine
    // files only, and an import edge into server/shared/ is not a bare
    // specifier. Shared code carries the engine's purity obligation because
    // the engine depends on it.
    if (isShared(sourcePath)) {
      collectPurityViolations(violations, 'ARCH019', sourcePath, inspected, {
        ambient: 'shared code reads ambient',
        ambientWhy:
          'so every engine result that flows through it stops being a pure'
          + ' function of the seed and log',
        module: 'shared code can only import pure standard-library modules',
      })
    }
    if (promptTextModules.has(sourcePath)) {
      collectPurityViolations(violations, 'ARCH015', sourcePath, inspected, {
        // Named for what the module actually is. The scope is now the closure,
        // so most modules it covers are not prompt builders at all: the engine's
        // rules, names, knowledge and seatset all sit in it. Reporting those as
        // prompt builders reads as a misconfigured rule and sends the reader
        // after the scope list instead of the ambient read.
        ambient: PROMPT_BUILDERS.has(sourcePath)
          ? 'prompt builder reads ambient'
          : 'module reached from a prompt builder reads ambient',
        ambientWhy:
          'so the cacheable prefix stops being a function of the PlayerView alone',
        // The module arm stays scoped to the declared roots. Reaching a module
        // through a value import means it can put a value into prompt text,
        // which is what the ambient arm above is about; it does not mean the
        // module is itself a prompt builder that must live on the pure
        // standard library. belief/exact.ts is in the closure and legitimately
        // imports across the agent tree.
        module: PROMPT_BUILDERS.has(sourcePath)
          ? 'prompt builders can only import pure standard-library modules'
          : undefined,
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
    if (sourcePath === 'server/agents/composed/agent.ts') {
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

/** ARCH021. The strict-test inventory has one owner and one default gate. */
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
        'ARCH021',
        'package.json',
        undefined,
        'the default typecheck must use the single strict test ratchet authority',
      ))
    }
  } catch (error) {
    violations.push(violation(
      'ARCH021',
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
          'ARCH021',
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
          'ARCH021',
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
          'ARCH021',
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
          'ARCH021',
          entry.name,
          undefined,
          `strict test roots belong to ${authority}, not ${entry.name}`,
        ))
      }
    }
  } catch (error) {
    violations.push(violation(
      'ARCH021',
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
          'ARCH021',
          relative,
          undefined,
          `strict test inventory details belong only to ${authority}`,
        ))
      }
    }
  } catch (error) {
    violations.push(violation(
      'ARCH021',
      'tools',
      undefined,
      `cannot audit strict-test tool ownership: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ))
  }
  return violations
}

/**
 * ARCH018. A production export whose only consumer is a test.
 *
 * The repository already fails the build on dead declarations, but that check
 * reports unused locals inside test roots, so an exported production helper
 * that a test imports reads as live no matter what production does. That is
 * the hole `assertProbability` sat in: exported from belief/invariants.ts,
 * covered by its own test, never called by any production code, and structurally
 * unnecessary because every probability that layer emits belongs to a
 * distribution already checked as one. It was found by reading, not by a tool.
 *
 * Only `function` and `const` exports count. Types and interfaces remain outside
 * this runtime-surface rule, and a class can be thrown in production while its
 * name appears only in the test that asserts on it, which is exactly the shape
 * of BeliefInvariantError.
 *
 * Same-file use counts as production use. A version constant referenced once as
 * `version: QUEST_CARD_FACTOR_VERSION` inside its own module is live even
 * though nothing else names it, and an earlier census that missed this reported
 * 126 violations instead of 22.
 */
export const TEST_ONLY_EXPORT_EXEMPTIONS = new Map([
  // The one deliberate member. Its own doc comment states that it has no
  // production caller and that the arm exists because it is the only path
  // reaching validDecisionTrace, so deleting it would drop those structural
  // checks rather than relocate them. Kept, and kept explained there.
  ['server/agents/external-reply.ts', new Set(['parseExternalDecisionReply'])],
  ['server/agents/cognition/state.ts', new Set(['publicCognition'])],
  ['server/agents/analysis/actor-target-treatment.ts', new Set([
    'validatePrivateActorTargetTreatmentHostJoin',
  ])],
  ['server/agents/analysis/evil-role-utility.ts', new Set([
    'buildEvilRoleUtilityProjection',
  ])],
  ['server/agents/analysis/mordred-blindness.ts', new Set([
    'validatePrivateMordredBlindnessHostJoin',
  ])],
  ['server/agents/analysis/observer.ts', new Set([
    'publicAlignmentMaskHistogram',
  ])],
  // The shared two-axis public read and its first consumer, both landed as
  // inert substrate ahead of the scoring that will reach them, the same way
  // role-utility.ts between them was. The servant objective additionally waits
  // on role-objective-router.ts, which cannot route servants to a model until
  // composed.ts emits one, since trace admission checks the two agree.
  //
  // All three entries go when scoring arrives, and the staleness check above
  // is what will say so: left here past that point they fail rather than rot.
  ['server/agents/analysis/public-self-read.ts', new Set([
    'validateAdmittedPublicSelfReadHostJoin',
    'validatePublicSelfReadSnapshot',
  ])],
  // The private pin read and its evil-exposure mirror. Both are now registered
  // as native role components (native-role-components.ts), so their builders,
  // decoders, and host joins have production consumers and are off this list.
  // What remains is the hostile-boundary validate() on each, which the kernel
  // does not call (it decodes an already-canonical payload); those go if an
  // ingress or artifact reader ever needs them, reported by the staleness check.
  ['server/agents/analysis/private-pin.ts', new Set([
    'validatePrivatePinReadSnapshot',
    'validateEvilExposureReadSnapshot',
  ])],
  ['server/agents/analysis/role-utility.ts', new Set([
    'buildRoleUtilityProjection',
    'validatePrivateRoleUtilityProjection',
  ])],
  // The host join came off this list the moment the component registered it,
  // reported by the staleness check rather than remembered. What is left is
  // the strict-JSON validator, which the kernel does not call: it decodes an
  // already-canonical payload instead. That one goes if an ingress or artifact
  // reader ever needs it.
  ['server/agents/analysis/servant-objective.ts', new Set([
    'validateServantObjectiveSnapshot',
  ])],
  // Same shape as its sibling above: the kernel decodes an already-canonical
  // payload, so the strict-JSON validator waits for an ingress or artifact
  // reader. Its host join and decoder are both live in the component.
  ['server/agents/analysis/servant-role-utility.ts', new Set([
    'validateServantRoleUtilityProjection',
  ])],
  ['server/agents/board.ts', new Set(['roleCertainties'])],
  ['server/agents/policy/score.ts', new Set([
    'createEvilRoleObjectiveScorer',
    'createMordredBlindnessRoleScorer',
    'createMorganaRoleScorer',
    'createRoleObjectiveScorer',
  ])],
  ['server/agents/role-score-layers/configured.ts', new Set([
    'configuredScoreFamilyWiring',
  ])],
  // createGoodScoreLayerRegistry is deliberately absent: the census that built
  // this list scanned text, and counted its name inside a synthetic source
  // string in the fitness suite as a reference. It has no consumer at all, in
  // production or in a test, which is a different rule's territory than this
  // one and is why the staleness check flagged the entry on its first run.
  ['server/agents/role-score-layers/good.ts', new Set([
    'calculateGoodProposalCandidateScores',
    'calculateGoodProposalVoteCandidateScores',
  ])],
  ['server/eval/banks/active-language-bank.ts', new Set([
    'activeLanguageEvaluationVariant',
  ])],
  ['server/eval/banks/evil-policy-bank.ts', new Set([
    'PHASE7_EVIL_DEALS_PER_TARGET_ROLE',
  ])],
  ['server/eval/core/mechanical-data.ts', new Set(['mechanicalDataset'])],
  ['server/eval/inspect/seat-view-inspector-ui.ts', new Set([
    'createSeatViewInspectorUiServer',
  ])],
  ['server/eval/replay/trace-replay.ts', new Set([
    'authoritativeDecisionSnapshots',
  ])],
])

/** Module-level function/const export surfaces, including `export { local }`. */
function exportedValueNames(ast) {
  const declarations = new Map()
  const out = new Map()
  const lineOf = (node) =>
    ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
  for (const statement of ast.statements) {
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const declared = {
        localName: statement.name.text,
        line: lineOf(statement.name),
      }
      declarations.set(declared.localName, declared)
      if (exported) out.set(declared.localName, {
        name: declared.localName,
        ...declared,
      })
      continue
    }
    if (ts.isVariableStatement(statement)) {
      const isConst = Boolean(
        statement.declarationList.flags & ts.NodeFlags.Const,
      )
      if (!isConst) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const declared = {
          localName: declaration.name.text,
          line: lineOf(declaration.name),
        }
        declarations.set(declared.localName, declared)
        if (exported) out.set(declared.localName, {
          name: declared.localName,
          ...declared,
        })
      }
    }
  }
  for (const statement of ast.statements) {
    if (
      !ts.isExportDeclaration(statement)
      || statement.moduleSpecifier
      || !statement.exportClause
      || !ts.isNamedExports(statement.exportClause)
    ) continue
    for (const element of statement.exportClause.elements) {
      const localName = element.propertyName?.text ?? element.name.text
      const declared = declarations.get(localName)
      if (!declared) continue
      out.set(element.name.text, {
        name: element.name.text,
        ...declared,
      })
    }
  }
  return [...out.values()]
}

/** Identifier references, excluding declarations, property keys, and exports. */
function localReferenceCounts(ast) {
  const counts = new Map()
  const visit = (node) => {
    if (ts.isIdentifier(node) && !identifierIsSyntacticName(node)) {
      counts.set(node.text, (counts.get(node.text) ?? 0) + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return counts
}

function namespaceUsesExport(ast, namespace, exportedName) {
  let found = false
  const visit = (node) => {
    if (found) return
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === namespace
      && node.name.text === exportedName
    ) {
      found = true
      return
    }
    if (
      ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === namespace
      && node.argumentExpression
      && ts.isStringLiteralLike(node.argumentExpression)
      && node.argumentExpression.text === exportedName
    ) {
      found = true
      return
    }
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.initializer)
      && node.initializer.text === namespace
      && ts.isObjectBindingPattern(node.name)
      && node.name.elements.some((element) => (
        (element.propertyName?.getText(ast) ?? element.name.getText(ast))
        === exportedName
      ))
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return found
}

function consumesExport(module, ownerIdentity, exportedName) {
  for (const edge of module.inspected.edges) {
    let target
    try {
      target = resolveModule(module.sourcePath, edge.specifier)
    } catch {
      continue
    }
    if (target !== ownerIdentity) continue
    if (edge.names.includes(exportedName)) return true
    if (!edge.namespace) continue
    if (edge.kind === 'export' || edge.kind === 'require') return true
    if (edge.locals.some((local) =>
      namespaceUsesExport(module.ast, local, exportedName))) return true
  }
  return false
}

/**
 * Every source under `directory`, or a throw naming what could not be read.
 *
 * A partial list is the one result this must never return. ARCH018 decides that
 * an export has no production consumer by not finding one, so a subtree that
 * silently failed to enumerate reads as a subtree that referenced nothing, and
 * the rule reports real exports as dead. Failing loud is the only safe
 * direction for a check whose verdict is an absence, which is why
 * collectServerSources next door throws for the same reason.
 *
 * A missing top-level directory is not an error: a checkout with no test tree
 * has nothing for this rule to say, and the caller turns an empty side into no
 * violations rather than into every export being unreferenced.
 */
function collectDirectorySources(root, directory) {
  const entries = []
  const base = path.join(root, directory)
  if (!existsSync(base)) return entries
  const pending = [base]
  const describe = (error) =>
    error instanceof Error ? error.message : String(error)
  while (pending.length) {
    const current = pending.pop()
    let children
    try {
      children = readdirSync(current, { withFileTypes: true })
    } catch (error) {
      throw new Error(
        `cannot enumerate ${
          normalizeRepoPath(path.relative(root, current))
        }: ${describe(error)}`,
      )
    }
    for (const child of children) {
      const absolute = path.join(current, child.name)
      if (child.isSymbolicLink()) continue
      if (child.isDirectory()) {
        pending.push(absolute)
        continue
      }
      if (!child.isFile() || !SOURCE_EXTENSION.test(child.name)) continue
      const relative = normalizeRepoPath(path.relative(root, absolute))
      try {
        entries.push([relative, readFileSync(absolute, 'utf8')])
      } catch (error) {
        throw new Error(`cannot read ${relative}: ${describe(error)}`)
      }
    }
  }
  return entries.sort(([left], [right]) => left.localeCompare(right))
}

export function checkTestOnlyProductionExports(root = process.cwd()) {
  let server
  let tests
  try {
    server = collectDirectorySources(root, 'server')
    tests = collectDirectorySources(root, 'test')
  } catch (error) {
    return Object.freeze([violation(
      'ARCH018',
      'server',
      undefined,
      error instanceof Error ? error.message : String(error),
    )])
  }
  // Whether an exempt path still exists is deliberately not asserted here.
  // This function is generic over `root`, and the fitness suite points it at
  // synthetic trees, where every real baseline path is legitimately absent.
  // test/architecture-fitness.test.ts pins existence against the repository
  // itself, which is the only place the question is well posed.
  return auditTestOnlyProductionExports(server, tests)
}

/**
 * The disk-free half, so the rule is exercised over synthetic sources by the
 * same harness every other rule here uses rather than only against the tree it
 * is scanning.
 */
export function auditTestOnlyProductionExports(server, tests) {
  if (!server.length || !tests.length) return Object.freeze([])

  const parse = ([sourcePath, source]) => {
    const ast = ts.createSourceFile(
      sourcePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(sourcePath),
    )
    return {
      sourcePath,
      identity: moduleIdentity(sourcePath),
      references: localReferenceCounts(ast),
      inspected: inspectSource(sourcePath, source),
      ast,
    }
  }
  const serverModules = server.map(parse)
  const testModules = tests.map(parse)

  const violations = []
  // Every exemption that actually suppressed something this run. An entry that
  // suppresses nothing is reported below rather than left in place: the list is
  // a ratchet, so it has to be observable when a member is worked off, and a
  // lingering entry silently pre-exempts a future export that reuses the name.
  // tools/strict-test-ratchet.mjs treats its own stale exemptions the same way.
  const consumed = new Map()
  for (const module of serverModules) {
    const exempt = TEST_ONLY_EXPORT_EXEMPTIONS.get(module.sourcePath)
    for (const declared of exportedValueNames(module.ast)) {
      const suppressed = exempt?.has(declared.name) === true
      if ((module.references.get(declared.localName) ?? 0) > 0) continue
      if (serverModules.some((other) =>
        other !== module
        && consumesExport(other, module.identity, declared.name))) continue
      if (!testModules.some((testModule) =>
        consumesExport(testModule, module.identity, declared.name))) continue
      if (suppressed) {
        const names = consumed.get(module.sourcePath) ?? new Set()
        names.add(declared.name)
        consumed.set(module.sourcePath, names)
        continue
      }
      violations.push(violation(
        'ARCH018',
        module.sourcePath,
        undefined,
        `export ${declared.name} (line ${declared.line}) has no production `
          + 'consumer and is reached only from the suite, so the tests are '
          + 'pinning a surface nothing uses',
      ))
    }
  }
  // Only modules this scan actually saw. The auditor is also driven with
  // synthetic entries by the fitness suite, and a baseline entry for a real
  // path is not stale merely because a synthetic scan did not include it.
  // Whether an exempt path still exists at all is the disk-reading caller's
  // question, since only it knows it enumerated the whole tree.
  const scanned = new Set(serverModules.map((module) => module.sourcePath))
  for (const [sourcePath, names] of TEST_ONLY_EXPORT_EXEMPTIONS) {
    if (!scanned.has(sourcePath)) continue
    const used = consumed.get(sourcePath)
    for (const name of names) {
      if (used?.has(name)) continue
      violations.push(violation(
        'ARCH018',
        sourcePath,
        undefined,
        `exemption for ${name} is stale: it no longer names a production `
          + 'export that only the suite reaches, so drop the entry rather '
          + 'than leave it pre-exempting the next export of that name',
      ))
    }
  }
  return Object.freeze(violations)
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
    ...checkTestOnlyProductionExports(root),
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
