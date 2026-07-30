// Game artifacts — the persistence format of the eval pipeline
// (docs/design-evaluation.md §9 step 1). One artifact = one COMPLETED game,
// fully self-contained: the unredacted event log, the role deal, and a
// per-seat agent descriptor. Everything downstream (metrics, judge,
// situation bank, reports) consumes artifacts, never live Game objects —
// so a game is analyzable forever, by tools that didn't exist when it ran.

import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { DegradedDecision } from '../sim/runner.ts'
import type { SpendEntry } from '../llm/openrouter.ts'
import type { Alignment, Game, GameEvent, Role, Seat, TalkConfig } from '../engine/types.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  type DecisionTrace,
} from '../agents/trace.ts'
import {
  DECISION_COMPONENT_PLAN_VERSION,
  DECISION_COMPONENT_RUN_VERSION,
  validateDecisionComponentPlan,
  type DecisionComponentPlan,
} from '../agents/components/kernel.ts'
import {
  resolvedArchitectureIdentityTraceJoin,
} from '../agents/components/architecture-metadata.ts'
import {
  admitResolvedArchitectureIdentity,
  projectResolvedArchitectureIdentity,
  resolvedArchitectureIdentityDigest,
  type ResolvedArchitectureDescriptor,
  type ResolvedArchitectureIdentity,
} from '../agents/components/resolved-brain.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../agents/components/robust-evil-quest-card.ts'

// Bump on any BREAKING artifact-shape change. Additive fields (like `roles`,
// added in v2) don't require a bump for readers that tolerate their absence —
// readArtifacts accepts anything <= current so old corpora stay analyzable
// (the whole premise of the format), and only refuses artifacts from a FUTURE
// schema it cannot understand.
// v3: the proposal-flow redesign (propose -> discuss -> finalize -> vote,
// TalkConfig reshaped to maxRounds/maxRoundsAfterChange).
// v4: the declared-lean signal removed. Utterances no longer carry `lean`, and
// discussion runs a fixed number of rounds instead of ending on lean
// settlement, so a v3 log's segment lengths are not reproducible here.
// Pre-v4 artifacts remain readable as data but are NOT replayable — the engine
// that produced their logs no longer exists (replayGame refuses them).
export const ARTIFACT_SCHEMA = 4
// The oldest schema replayGame can still reconstruct. Separate from
// ARTIFACT_SCHEMA on purpose: an ADDITIVE bump raises the current schema
// without making older logs unreplayable, so only a breaking engine change
// moves this. Raise both together when the engine stops reproducing old logs
// — the pair drifting apart is how a v3 log once slipped past a `< 3` guard
// into an engine that no longer produced its discussion segments.
export const MIN_REPLAYABLE_SCHEMA = 4
export const MAX_ARTIFACT_DECISION_COMPONENT_MANIFEST_JSON_BYTES =
  720_896

export interface ArtifactPlayer {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
  agent: string // descriptor: 'heuristic' | 'random' | 'llm:<roster id>' | 'def:<agent id>' | 'stdio' | 'human'
}

export interface ArchitectureRunMetadata {
  bank: string
  caseId: string
  targetRole: Role
  targetSeat: Seat
  variant: string
  // Open-ended on purpose: Phase 0 can name the current agent/model/policy
  // versions without importing future belief or policy domain types.
  components: Record<string, string>
}

export interface ArtifactStrategyVersions {
  schema: 1
  agentDescriptors: readonly string[]
  models: readonly string[]
  prompts: readonly string[]
  policies: readonly string[]
  factors: readonly string[]
  beliefs: readonly string[]
  observers: readonly string[]
  /** Added in Phase 7B1; absent on historical and identity-off artifacts. */
  identities?: readonly string[]
  /** Added in Phase 7B2; absent on historical and plan-memory-off artifacts. */
  planMemories?: readonly string[]
  /** Literal coherence component paired with planMemories. */
  coherences?: readonly string[]
  /** Added in Phase 7C1; absent on role-objective-off artifacts. */
  roleObjectives?: readonly string[]
  /** Added in Phase 7D1; configured router is separate from resolved models. */
  roleObjectiveRouters?: readonly string[]
  /** Added in Phase 7C2; absent when the role scorer input is inactive. */
  roleUtilities?: readonly string[]
  /** Added in Phase 7D2; distinct from Merlin/Percival roleUtilities. */
  evilRoleUtilities?: readonly string[]
  /** Added in Phase 7D3; current robust quest policy identity. */
  evilQuestCardPolicies?: readonly string[]
  /** Added in Phase 7E1A; configured and resolved private substrates. */
  morganaCounterfeitObjectives?: readonly string[]
  /** Added in Phase 7E1B; bounded causal Morgana policy projections. */
  morganaRoleUtilities?: readonly string[]
  /**
   * Generic component manifest captured independently from the trusted
   * producer's resolved brain. It is never inferred from a returned trace.
   */
  decisionComponents?: ArtifactDecisionComponentManifest
  /**
   * Current descriptor-derived identity. Unlike the schema-1 component-plan
   * manifest, this is the complete stable configuration owner for one target
   * seat and never contains migration compatibility data.
   */
  resolvedArchitecture?: ArtifactResolvedArchitectureManifest
}

export interface ArtifactDecisionComponentManifest {
  schema: 1
  seats: readonly ArtifactDecisionComponentSeatManifest[]
}

export interface ArtifactDecisionComponentSeatManifest {
  seat: Seat
  plan: DecisionComponentPlan
}

export interface ArtifactResolvedArchitectureManifest {
  schema: 1
  targetSeat: Seat
  /**
   * Detects accidental or partial storage relabeling across every identity
   * field. This is provenance integrity, not a signature against an artifact
   * author who deliberately rewrites identity, digest, and traces together.
   */
  identityDigest: string
  identity: ResolvedArchitectureIdentity
}

export interface ArtifactTelemetry {
  // Run-local deltas copied from the shared OpenRouter client's per-tag spend
  // map. Architecture benchmarks run variants sequentially, so each artifact
  // owns the exact calls and cost caused by that game.
  llm?: { tags: Record<string, SpendEntry> }
  /** Wall-clock target-seat decision samples; evaluation-only and never replayed. */
  decisionLatency?: {
    samples: Array<{
      kind: DecisionTrace['request']['kind']
      milliseconds: number
    }>
  }
}

export interface GameArtifact {
  schema: number
  id: string
  seed: string
  createdAt: string // ISO — stamped by the I/O layer; the engine stays clock-free
  playerCount: number
  // The roles array IN CONFIG ORDER (pre-shuffle). The gameCreated event only
  // carries rolesInPlay SORTED, which loses the deal, so replay could otherwise
  // only reconstruct default-role games. Persisting this makes every artifact —
  // including custom-role tables creatable via the live server — replayable.
  roles: Role[]
  talk: TalkConfig
  players: ArtifactPlayer[]
  winner: Alignment
  winReason: string
  steps: number
  degraded: DegradedDecision[]
  log: GameEvent[]
  architecture?: ArchitectureRunMetadata
  /** Stable identifiers required to interpret or train from this artifact. */
  strategyVersions?: ArtifactStrategyVersions
  telemetry?: ArtifactTelemetry
  /**
   * Private full-reveal evaluation data. Server payload builders never read
   * this field; it exists only in opt-in artifacts and offline tooling.
   */
  decisionTraces?: DecisionTrace[]
  // Free-form labels attached by the producer. The bench runner sets
  // { bench: <role>, variant: 'candidate'|'baseline', pairSeed, agentId } —
  // the report CLI groups paired runs by these.
  tags?: Record<string, string>
  // Post-hoc LLM analyses, written back into the artifact by their CLIs
  // (probe.ts, judge.ts) so a game accumulates its analyses in one record.
  probes?: { virtualAssassin?: VirtualAssassinResult }
  judge?: JudgeResult
}

// ---- post-hoc analysis results ----

export interface VirtualAssassinResult {
  model: string       // roster id used
  samples: number
  picks: (number | null)[] // per-sample seat picked (null = unparseable)
  merlinSeat: number
  hits: number
  hitRate: number
  ranAt: string
}

export interface JudgeScorecard {
  seat: number
  concealment: number | null // 0-10; null where the axis doesn't apply
  deduction: number | null
  influence: number | null
  tableTalk: number | null
  note: string
}

export interface JudgeIncident {
  seat: number
  seq: number
  family: string      // knowledge-leak | commitment-failure | hammer-blindness |
                      // fail-coordination | vote-speech-incoherence | blunder | good-play | other
  description: string
}

export interface JudgeResult {
  model: string
  blinded: {
    evil: number[]           // seats predicted evil from the public record alone
    merlin: number | null    // seat predicted as Merlin
    confidence: number
    evilCorrect: number      // |predicted ∩ actual evil|
    merlinCorrect: boolean
  }
  scorecards: JudgeScorecard[]
  incidents: JudgeIncident[]
  ranAt: string
}

export interface ToArtifactOpts {
  agents: string[] // per-seat descriptors, index = seat
  degraded: DegradedDecision[]
  steps: number
  tags?: Record<string, string>
  architecture?: ArchitectureRunMetadata
  telemetry?: ArtifactTelemetry
  decisionTraces?: DecisionTrace[]
  /**
   * Host-assigned producer provenance for generic composed traces. External
   * agents cannot mint this by returning a self-described component plan.
   */
  trustedComponentPlans?: readonly ArtifactDecisionComponentSeatManifest[]
  /**
   * Current trusted producer input. Only the stable identity is persisted;
   * the descriptor's migration compatibility projection remains in-process.
   */
  trustedArchitecture?: Readonly<{
    seat: Seat
    descriptor: ResolvedArchitectureDescriptor
  }>
}

function sortedUnique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  ))].sort()
}

function strategyVersions(opts: ToArtifactOpts): ArtifactStrategyVersions {
  const traces = opts.decisionTraces ?? []
  const architecture = opts.architecture?.components ?? {}
  const identities = sortedUnique([
    architecture.identityModel,
    ...traces.map((trace) => trace.componentVersions?.identityModel),
  ])
  const planMemories = sortedUnique([
    architecture.planMemory,
    ...traces.map((trace) => trace.componentVersions?.planMemory),
  ])
  const coherences = sortedUnique([
    architecture.coherence,
    ...traces.map((trace) => trace.componentVersions?.coherence),
  ])
  const roleObjectives = sortedUnique([
    architecture.roleObjective,
    ...traces.map((trace) => trace.componentVersions?.roleObjective),
  ])
  const roleObjectiveRouters = sortedUnique([
    architecture.roleObjectiveRouter,
    ...traces.map(
      (trace) => trace.componentVersions?.roleObjectiveRouter,
    ),
  ])
  const roleUtilities = sortedUnique([
    architecture.roleUtility,
    ...traces.map((trace) => trace.componentVersions?.roleUtility),
  ])
  const evilRoleUtilities = sortedUnique([
    architecture.evilRoleUtility,
    ...traces.map((trace) => trace.componentVersions?.evilRoleUtility),
  ])
  const trustedIdentity = opts.trustedArchitecture === undefined
    ? undefined
    : projectResolvedArchitectureIdentity(
        opts.trustedArchitecture.descriptor,
      )
  const evilQuestCardPolicies = sortedUnique(
    trustedIdentity?.components.configured.some(
      (component) =>
        component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id
        && component.version === EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
    )
      ? [EVIL_QUEST_CARD_ROBUST_COMPONENT.version]
      : [],
  )
  const morganaCounterfeitObjectives = sortedUnique([
    architecture.morganaCounterfeitObjective,
    ...traces.map(
      (trace) =>
        trace.componentVersions?.configuredMorganaCounterfeitObjective,
    ),
    ...traces.map(
      (trace) => trace.componentVersions?.morganaCounterfeitObjective,
    ),
  ])
  const morganaRoleUtilities = sortedUnique([
    architecture.morganaRoleUtility,
    ...traces.map(
      (trace) => trace.componentVersions?.configuredMorganaRoleUtility,
    ),
    ...traces.map(
      (trace) => trace.componentVersions?.morganaRoleUtility,
    ),
  ])
  const decisionComponents = opts.trustedComponentPlans === undefined
    ? undefined
    : trustedDecisionComponentManifest(
        opts.trustedComponentPlans,
        traces,
        opts.agents.length,
      )
  const resolvedArchitecture = opts.trustedArchitecture === undefined
    ? undefined
    : trustedResolvedArchitectureManifest(
        opts.trustedArchitecture,
        traces,
        opts.agents.length,
      )
  return {
    schema: 1,
    agentDescriptors: sortedUnique(opts.agents),
    models: sortedUnique([
      architecture.model,
      ...opts.agents.map((agent) =>
        agent.startsWith('llm:') ? agent.slice('llm:'.length) : undefined),
    ]),
    prompts: sortedUnique([
      architecture.prompt,
      ...traces.map((trace) => trace.componentVersions?.prompt),
    ]),
    policies: sortedUnique([
      architecture.policy,
      ...traces.map((trace) => trace.componentVersions?.policy),
    ]),
    factors: sortedUnique([
      architecture.factors,
      ...traces.map((trace) => trace.componentVersions?.factors),
    ]),
    beliefs: sortedUnique([
      architecture.belief,
      ...traces.map((trace) => trace.beliefModelVersion),
    ]),
    observers: sortedUnique([
      architecture.observerModel,
      ...traces.map((trace) => trace.componentVersions?.observerModel),
    ]),
    ...(identities.length ? { identities } : {}),
    ...(planMemories.length ? { planMemories } : {}),
    ...(coherences.length ? { coherences } : {}),
    ...(roleObjectives.length ? { roleObjectives } : {}),
    ...(roleObjectiveRouters.length ? { roleObjectiveRouters } : {}),
    ...(roleUtilities.length ? { roleUtilities } : {}),
    ...(evilRoleUtilities.length ? { evilRoleUtilities } : {}),
    ...(evilQuestCardPolicies.length ? { evilQuestCardPolicies } : {}),
    ...(morganaCounterfeitObjectives.length
      ? { morganaCounterfeitObjectives }
      : {}),
    ...(morganaRoleUtilities.length ? { morganaRoleUtilities } : {}),
    ...(decisionComponents ? { decisionComponents } : {}),
    ...(resolvedArchitecture ? { resolvedArchitecture } : {}),
  }
}

function trustedResolvedArchitectureManifest(
  trusted: NonNullable<ToArtifactOpts['trustedArchitecture']>,
  traces: readonly DecisionTrace[],
  playerCount: number,
): ArtifactResolvedArchitectureManifest {
  if (
    !Number.isInteger(trusted.seat)
    || trusted.seat < 0
    || trusted.seat >= playerCount
  ) {
    throw new Error('trusted architecture has an invalid target seat')
  }
  const identity = projectResolvedArchitectureIdentity(trusted.descriptor)
  const seatTraces = traces.filter((trace) =>
    trace.viewerSeat === trusted.seat)
  if (
    !seatTraces.length
    || seatTraces.some((trace) =>
      !resolvedArchitectureIdentityTraceJoin(identity, trace))
  ) {
    throw new Error(
      `trusted architecture does not match traces for seat ${trusted.seat}`,
    )
  }
  const detached = admitResolvedArchitectureIdentity(identity)
  if (!detached) {
    throw new Error('trusted architecture identity is not persistable')
  }
  return {
    schema: 1,
    targetSeat: trusted.seat,
    identityDigest: resolvedArchitectureIdentityDigest(detached),
    identity: detached,
  }
}

function trustedDecisionComponentManifest(
  seats: readonly ArtifactDecisionComponentSeatManifest[],
  traces: readonly DecisionTrace[],
  playerCount: number,
): ArtifactDecisionComponentManifest {
  if (!seats.length) {
    throw new Error('trusted component manifest requires at least one seat')
  }
  const seen = new Set<Seat>()
  const normalized = [...seats].sort((left, right) => left.seat - right.seat)
  for (const entry of normalized) {
    if (
      !Number.isInteger(entry.seat)
      || entry.seat < 0
      || entry.seat >= playerCount
      || seen.has(entry.seat)
      || !validateDecisionComponentPlan(entry.plan)
    ) {
      throw new Error(
        'trusted component manifest has an invalid seat or plan',
      )
    }
    seen.add(entry.seat)
    const seatTraces = traces.filter((trace) =>
      trace.viewerSeat === entry.seat)
    if (!seatTraces.length) {
      throw new Error(
        `trusted component manifest has no traces for seat ${entry.seat}`,
      )
    }
    if (seatTraces.some((trace) =>
      trace.version !== COMPONENT_DECISION_TRACE_VERSION
      || trace.componentVersions?.decisionComponents
        !== DECISION_COMPONENT_RUN_VERSION
      || !trace.componentPlan
      || !trace.components
      || !isDeepStrictEqual(trace.componentPlan, entry.plan))) {
      throw new Error(
        `trusted component plan does not match traces for seat ${entry.seat}`,
      )
    }
  }
  const manifest: ArtifactDecisionComponentManifest = {
    schema: 1,
    seats: normalized.map((entry) => ({
      seat: entry.seat,
      plan: {
        version: DECISION_COMPONENT_PLAN_VERSION,
        configured: entry.plan.configured.map((component) => ({
          id: component.id,
          version: component.version,
        })),
      },
    })),
  }
  if (
    Buffer.byteLength(JSON.stringify(manifest), 'utf8')
      > MAX_ARTIFACT_DECISION_COMPONENT_MANIFEST_JSON_BYTES
  ) {
    throw new Error('trusted component manifest exceeds artifact bound')
  }
  return manifest
}

export function toArtifact(game: Game, opts: ToArtifactOpts): GameArtifact {
  if (game.phase !== 'gameOver' || !game.winner || !game.winReason) {
    throw new Error(`artifact requires a finished game (phase: ${game.phase})`)
  }
  if (opts.agents.length !== game.config.playerCount) {
    throw new Error(`agents length ${opts.agents.length} !== playerCount ${game.config.playerCount}`)
  }
  if (
    opts.trustedComponentPlans !== undefined
    && (
      !opts.architecture
      || opts.trustedComponentPlans.length !== 1
      || opts.trustedComponentPlans[0].seat
        !== opts.architecture.targetSeat
    )
  ) {
    throw new Error(
      'trusted component plans require the architecture target seat',
    )
  }
  if (
    opts.trustedArchitecture !== undefined
    && (
      opts.trustedComponentPlans !== undefined
      || !opts.architecture
      || opts.trustedArchitecture.seat !== opts.architecture.targetSeat
    )
  ) {
    throw new Error(
      'trusted architecture requires the architecture target seat and cannot be combined with a legacy component manifest',
    )
  }
  return {
    schema: ARTIFACT_SCHEMA,
    id: game.id,
    seed: game.seed,
    createdAt: new Date().toISOString(),
    playerCount: game.config.playerCount,
    roles: game.config.roles.slice(),
    talk: game.config.talk,
    players: game.players.map((p) => ({
      seat: p.seat, name: p.name, role: p.role, alignment: p.alignment,
      agent: opts.agents[p.seat],
    })),
    winner: game.winner,
    winReason: game.winReason,
    steps: opts.steps,
    degraded: opts.degraded,
    log: structuredClone(game.log),
    strategyVersions: strategyVersions(opts),
    ...(opts.tags ? { tags: opts.tags } : {}),
    ...(opts.architecture ? { architecture: opts.architecture } : {}),
    ...(opts.telemetry ? { telemetry: opts.telemetry } : {}),
    ...(opts.decisionTraces?.length
      ? { decisionTraces: structuredClone(opts.decisionTraces) }
      : {}),
  }
}

// ---- JSONL storage (append-only; one game per line) ----

export function appendArtifact(file: string, artifact: GameArtifact): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(artifact) + '\n')
}

// Rewrite a JSONL file in place — used by the probe/judge CLIs to fold their
// results back into the artifacts they analyzed. Atomic (temp + rename, as
// master's saveCustomDef does): this file holds the WHOLE corpus plus every
// paid probe/judge result, so a crash/redeploy mid-write must not truncate it
// into an unparseable line that fails the entire readArtifacts.
export function writeArtifacts(file: string, artifacts: GameArtifact[]): void {
  const resolved = path.resolve(file)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const tmp = `${resolved}.tmp-${process.pid}`
  fs.writeFileSync(tmp, artifacts.map((a) => JSON.stringify(a)).join('\n') + '\n')
  fs.renameSync(tmp, resolved)
}

export function readArtifacts(file: string): GameArtifact[] {
  const out: GameArtifact[] = []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(`${file}:${i + 1}: not valid JSON`)
    }
    const a = parsed as GameArtifact
    // Accept current and older schemas (fields are additive; consumers tolerate
    // a missing `roles` etc.). Only a newer-than-known schema is unreadable.
    if (typeof a.schema !== 'number' || a.schema > ARTIFACT_SCHEMA) {
      throw new Error(`${file}:${i + 1}: schema ${String(a.schema)} is newer than this tool understands (max ${ARTIFACT_SCHEMA})`)
    }
    out.push(a)
  }
  return out
}
