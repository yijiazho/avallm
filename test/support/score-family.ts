import assert from 'node:assert/strict'
import test from 'node:test'
import { createComposedAgent } from '../../server/agents/composed.ts'
import type { ComposedAgentOptions } from '../../server/agents/composed.ts'
import { normalizeAgentOutput } from '../../server/agents/types.ts'
import type { AgentDecision } from '../../server/agents/types.ts'
import { componentPayload } from '../../server/agents/components/kernel.ts'
import type { ComponentToken } from '../../server/agents/components/types.ts'
import {
  createProductionComponentRegistry,
} from '../../server/agents/components/production-registry.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../../server/agents/components/resolved-brain.ts'
import type {
  ResolvedArchitectureIdentity,
} from '../../server/agents/components/resolved-brain.ts'
import {
  admitDecisionTrace,
} from '../../server/agents/admission/composed-trace.ts'
import type { CandidateScorer } from '../../server/agents/policy/score.ts'
import { legalCandidates } from '../../server/agents/policy/candidates.ts'
import { applyForcedPolicy } from '../../server/agents/policy/forced.ts'
import {
  replayNativeScoresForAdmission,
} from '../../server/agents/policy/score-layer/admission-replay.ts'
import {
  prepareScoreLayerRequirements,
} from '../../server/agents/policy/score-layer/preparation.ts'
import {
  combineSituationAnalysisRequirements,
} from '../../server/agents/analysis/situation-plan.ts'
import {
  buildScorerSituationSurface,
} from '../../server/agents/analysis/scorer-situation-surface.ts'
import { exactBelief } from '../../server/agents/belief/exact.ts'
import {
  configuredScoreLayerChainForVersion,
} from '../../server/agents/score-layers/configured.ts'
import type { DecisionTrace } from '../../server/agents/trace.ts'
import type {
  DecisionKind,
  DecisionRequest,
  PlayerView,
} from '../../server/engine/types.ts'

/**
 * One decision surface a score family either owns or delegates. Families build
 * these from real games or frozen fixtures; the harness only reads them.
 */
export interface ScoreFamilyDecisionCase {
  readonly label: string
  readonly req: DecisionRequest
  readonly view: PlayerView
  /**
   * Scorer version a delegating decision must actually resolve, keyed by the
   * configured specialization version. A decision the whole chain declines
   * resolves further back than the direct predecessor, so a case states the
   * truthful outcome instead of assuming exactly one step back.
   */
  readonly resolvedVersions?: Readonly<Record<string, string>>
}

export interface ScoreFamilyPredecessor {
  /** Omitted when the truthful predecessor is the compatibility default. */
  readonly scorer?: CandidateScorer
  readonly version: string
}

export interface ScoreFamilyVariant {
  readonly scorer: CandidateScorer
  readonly version: string
  /**
   * Family-owned private components this variant admits and causally uses.
   * Deterministic and seeded plans may own separate component identities.
   */
  readonly components: readonly ComponentToken<unknown>[]
  /** Truthful fallback for a decision this variant declines. */
  readonly predecessor: ScoreFamilyPredecessor
}

export interface ScoreFamilyDescriptor {
  /** Stable family label used in test names. */
  readonly family: string
  readonly seed: string
  /** Component opt-ins the family needs. Seed and scorer stay harness-owned. */
  readonly agent?: Omit<ComposedAgentOptions, 'seed' | 'scorer'>
  readonly deterministic: ScoreFamilyVariant
  readonly seeded?: ScoreFamilyVariant
  /** Decisions the family's layer owns. */
  readonly eligible: readonly ScoreFamilyDecisionCase[]
  /** Decisions the layer must decline, leaving the predecessor authoritative. */
  readonly delegating: readonly ScoreFamilyDecisionCase[]
  /**
   * Decision kinds whose seeded selection may differ across seeds. Every other
   * eligible kind must be seed invariant.
   */
  readonly seedVaryingKinds?: readonly DecisionKind[]
}

/** Fixed seed sweep for the seeded-domain law. */
const SEEDS = Object.freeze([
  'domain-a',
  'domain-b',
  'domain-c',
  'domain-d',
  'domain-e',
  'domain-f',
  'domain-g',
  'domain-h',
])

/** Rebuild a fixture view as a proposal by its own seat. */
export function asProposal(
  view: PlayerView,
): { req: DecisionRequest; view: PlayerView } {
  const proposalView: PlayerView = {
    ...structuredClone(view),
    phase: 'proposal',
    leaderSeat: view.seat,
    currentTeam: undefined,
  }
  return {
    view: proposalView,
    req: {
      kind: 'propose',
      seat: proposalView.seat,
      round: proposalView.round,
      proposalNum: proposalView.proposalNum,
    },
  }
}

/**
 * Rebuild a fixture view as a vote. The default team is the current round's
 * lowest-seat legal team, which every player count admits.
 */
export function asVote(
  view: PlayerView,
  team?: readonly number[],
): { req: DecisionRequest; view: PlayerView } {
  const voteView: PlayerView = {
    ...structuredClone(view),
    phase: 'vote',
    currentTeam: [...(team ?? view.players
      .slice(0, view.quests[view.round - 1].teamSize)
      .map((player) => player.seat))]
      .sort((left, right) => left - right),
  }
  return {
    view: voteView,
    req: {
      kind: 'vote',
      seat: voteView.seat,
      round: voteView.round,
      proposalNum: voteView.proposalNum,
    },
  }
}

function agentFor(
  descriptor: ScoreFamilyDescriptor,
  scorer: CandidateScorer | undefined,
  seed = descriptor.seed,
): ReturnType<typeof createComposedAgent> {
  return createComposedAgent({
    ...descriptor.agent,
    seed,
    ...(scorer ? { scorer } : {}),
  })
}

async function decide(
  descriptor: ScoreFamilyDescriptor,
  scorer: CandidateScorer | undefined,
  decision: ScoreFamilyDecisionCase,
  seed = descriptor.seed,
): Promise<AgentDecision> {
  return normalizeAgentOutput(
    await agentFor(descriptor, scorer, seed).decide(decision.req, decision.view),
  )
}

function identityFor(
  descriptor: ScoreFamilyDescriptor,
  scorer: CandidateScorer | undefined,
): ResolvedArchitectureIdentity {
  return projectResolvedArchitectureIdentity(
    agentFor(descriptor, scorer).resolvedBrain().description,
  )
}

function traceOf(output: AgentDecision, label: string): DecisionTrace {
  const trace = output.trace
  if (!trace) throw new Error(`${label} produced no decision trace`)
  return trace
}

/**
 * Admit one live composed output exactly as a finalized artifact. The expected
 * identity always comes from the same configuration that produced it.
 */
function admitFamilyDecision(input: {
  readonly descriptor: ScoreFamilyDescriptor
  readonly scorer: CandidateScorer | undefined
  readonly decision: ScoreFamilyDecisionCase
  readonly output: AgentDecision
  readonly seed?: string
  readonly identity?: ResolvedArchitectureIdentity
  readonly trace?: DecisionTrace
}): ReturnType<typeof admitDecisionTrace> {
  return admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: input.trace ?? traceOf(input.output, input.decision.label),
    req: input.decision.req,
    view: input.decision.view,
    authoritativeAction: input.output.decision,
    selectedDecision: input.output.decision,
    deterministicSeed: input.seed ?? input.descriptor.seed,
    expectedArchitectureIdentity:
      input.identity ?? identityFor(input.descriptor, input.scorer),
  })
}

/**
 * Replay one configured native chain from a synthesized hard candidate
 * boundary. This is the generic host surface admission itself builds, so a
 * family cannot claim forced dominance through a family-shaped fake context.
 */
function replayUnderForcedBoundary(input: {
  readonly decision: ScoreFamilyDecisionCase
  readonly scorerVersion: string
  readonly identity: ResolvedArchitectureIdentity
  readonly trace: DecisionTrace
  readonly seed: string
  readonly forcedCandidateId?: string
}): {
  readonly forcedCandidateId: string
  readonly chainVersions: readonly string[]
  readonly replay: ReturnType<typeof replayNativeScoresForAdmission>
} {
  const { req, view } = input.decision
  const candidates = legalCandidates(req, view)
  const chain = configuredScoreLayerChainForVersion(input.scorerVersion)
  const plan = combineSituationAnalysisRequirements(
    prepareScoreLayerRequirements(chain, {
      request: Object.freeze(structuredClone(req)),
      view: Object.freeze(structuredClone(view)),
    }).requirements,
  )
  const surface = buildScorerSituationSurface({
    view,
    belief: exactBelief(view),
    legalCandidates: candidates,
    plan,
  })
  const universalForced = applyForcedPolicy(
    req,
    view,
    surface.analysis,
    candidates,
  )
  const forcedCandidateId = input.forcedCandidateId ?? candidates[0].id
  const forced = {
    ...universalForced,
    applied: true,
    allowedCandidateIds: [forcedCandidateId],
    selectedCandidateId: forcedCandidateId,
  }
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const componentDefinitions = input.identity.components.eligible.flatMap(
    (ref) => {
      const definition = registry.definition(ref)
      return definition ? [definition] : []
    },
  )
  const components = input.trace.components
  if (!components) throw new Error('forced replay requires a component run')
  return {
    forcedCandidateId,
    chainVersions: chain.order.map((layer) => layer.version),
    replay: replayNativeScoresForAdmission({
      chain,
      request: req,
      view,
      analysis: surface.analysis,
      candidates,
      ...(surface.hypotheticalTeamCandidates
        ? { hypotheticalTeamCandidates: surface.hypotheticalTeamCandidates }
        : {}),
      forced,
      candidateBoundary: {
        survivorCandidateIds: forced.allowedCandidateIds,
        selectedCandidateId: forced.selectedCandidateId,
        reasonCodes: forced.reasonCodes,
      },
      deterministicSeed: input.seed,
      compatibilityCandidateId: candidates[0].id,
      componentDefinitions,
      componentRun: components,
    }),
  }
}

/**
 * Register the five shared laws every native score family must satisfy.
 *
 * These are the cross-family contracts only. Hand-worked equations, band
 * arithmetic, hostile payload forgeries, privacy canaries, and bank joins stay
 * in each family's own suite, and the generic registry, admission, and replay
 * suites remain the owners of their boundaries.
 */
export function assertScoreFamilyConformance(
  descriptor: ScoreFamilyDescriptor,
): void {
  const { family } = descriptor
  const variants = [descriptor.deterministic, descriptor.seeded].filter(
    (variant): variant is ScoreFamilyVariant => variant !== undefined,
  )
  const familyComponents = [
    ...new Map(
      variants.flatMap((variant) => variant.components)
        .map((token) => [`${token.id}@${token.version}`, token]),
    ).values(),
  ]
  assert.ok(
    descriptor.eligible.length > 0,
    `${family} declares no eligible decision`,
  )
  assert.ok(
    descriptor.delegating.length > 0,
    `${family} declares no delegating decision`,
  )
  assert.ok(
    familyComponents.length > 0,
    `${family} declares no owned component`,
  )

  test(`${family} conformance: predecessor owns delegated decisions`, async () => {
    for (const variant of variants) {
      for (const decision of descriptor.delegating) {
        const label = `${decision.label} (${variant.version})`
        const specialized = await decide(descriptor, variant.scorer, decision)
        const predecessor = await decide(
          descriptor,
          variant.predecessor.scorer,
          decision,
        )
        const trace = traceOf(specialized, label)
        assert.deepEqual(
          specialized.decision,
          predecessor.decision,
          `${family} ${label} must delegate its action`,
        )
        assert.deepEqual(
          trace.candidateScores,
          traceOf(predecessor, label).candidateScores,
          `${family} ${label} must delegate its scores`,
        )
        assert.equal(
          trace.componentVersions?.configuredScorer,
          variant.version,
          `${family} ${label} must report the configured specialization`,
        )
        assert.equal(
          trace.componentVersions?.scorer,
          decision.resolvedVersions?.[variant.version]
            ?? variant.predecessor.version,
          `${family} ${label} must resolve the predecessor truthfully`,
        )
        for (const token of familyComponents) {
          assert.equal(
            componentPayload(trace.components!, token),
            undefined,
            `${family} ${label} leaked ${token.id} while delegating`,
          )
        }
      }
    }
  })

  test(`${family} conformance: specialization is bounded and attributed`, async () => {
    for (const variant of variants) {
      for (const decision of descriptor.eligible) {
        const label = `${decision.label} (${variant.version})`
        const output = await decide(descriptor, variant.scorer, decision)
        const trace = traceOf(output, label)
        assert.equal(
          trace.componentVersions?.scorer,
          variant.version,
          `${family} ${label} must resolve its own scorer`,
        )
        const scores = trace.candidateScores
        assert.ok(scores, `${family} ${label} produced no candidate scores`)
        assert.deepEqual(
          scores.map((score) => score.candidateId),
          legalCandidates(decision.req, decision.view).map(
            (candidate) => candidate.id,
          ),
          `${family} ${label} must score every legal candidate in order`,
        )
        const viable = scores.filter((score) => score.viable)
          .map((score) => score.candidateId)
        if (variant === descriptor.deterministic) {
          assert.deepEqual(
            viable,
            [trace.structuredCandidateId],
            `${family} ${label} must leave exactly its structured choice`,
          )
        } else {
          // A seeded plan may leave its whole near-equal band viable. It still
          // must choose inside that band, and the band is a value, not a seed.
          assert.ok(
            viable.length > 0 && trace.structuredCandidateId !== undefined
              && viable.includes(trace.structuredCandidateId),
            `${family} ${label} must choose inside its own viable band`,
          )
        }
        for (const token of variant.components) {
          const use = trace.components!.policyUse.find(
            (entry) => entry.component.id === token.id,
          )
          assert.equal(
            use?.component.version,
            token.version,
            `${family} ${label} must attribute ${token.id}`,
          )
          assert.equal(
            use?.used,
            true,
            `${family} ${label} must record causal use of ${token.id}`,
          )
          assert.ok(
            use.stages.includes('candidate-score'),
            `${family} ${label} must attribute ${token.id} to scoring`,
          )
        }
      }
    }
  })

  test(`${family} conformance: seeded selection has an exact domain`, async () => {
    const seeded = descriptor.seeded
    if (!seeded) return
    const declared = descriptor.seedVaryingKinds ?? []
    const observed = new Set<DecisionKind>()
    for (const decision of descriptor.eligible) {
      const first = await decide(descriptor, seeded.scorer, decision, SEEDS[0])
      const repeat = await decide(descriptor, seeded.scorer, decision, SEEDS[0])
      assert.deepEqual(
        first,
        repeat,
        `${family} ${decision.label} must be deterministic per seed`,
      )
      assert.equal(
        traceOf(first, decision.label).componentVersions?.scorer,
        seeded.version,
        `${family} ${decision.label} must resolve the seeded scorer`,
      )
      const legal = legalCandidates(decision.req, decision.view)
      const chosen = new Set<string>()
      const bands = new Set<string>()
      for (const seed of SEEDS) {
        const trace = traceOf(
          await decide(descriptor, seeded.scorer, decision, seed),
          decision.label,
        )
        const structured = trace.structuredCandidateId
        assert.ok(
          structured !== undefined
            && legal.some((candidate) => candidate.id === structured),
          `${family} ${decision.label} chose an illegal candidate`,
        )
        chosen.add(structured)
        const viable = trace.candidateScores!.filter((score) => score.viable)
          .map((score) => score.candidateId)
        assert.ok(
          viable.includes(structured),
          `${family} ${decision.label} chose outside its own viable band`,
        )
        bands.add(viable.join(','))
      }
      // The seed selects inside the band. It must never resize the band.
      assert.equal(
        bands.size,
        1,
        `${family} ${decision.label} let the seed change its viable band`,
      )
      if (chosen.size > 1) observed.add(decision.req.kind)
      if (!declared.includes(decision.req.kind)) {
        assert.equal(
          chosen.size,
          1,
          `${family} ${decision.label} must be seed invariant`,
        )
      }
    }
    // An idle declaration would silently drop the invariance law for that kind.
    for (const kind of declared) {
      assert.ok(
        observed.has(kind),
        `${family} declares ${kind} seed varying but no eligible case varies; `
        + 'drop the declaration or supply a case inside the seeded band',
      )
    }
  })

  test(`${family} conformance: a hard boundary dominates family ranking`, async () => {
    for (const variant of variants) {
      const identity = identityFor(descriptor, variant.scorer)
      for (const decision of descriptor.eligible) {
        const output = await decide(descriptor, variant.scorer, decision)
        const {
          forcedCandidateId,
          chainVersions,
          replay,
        } = replayUnderForcedBoundary({
          decision,
          scorerVersion: variant.version,
          identity,
          trace: traceOf(output, decision.label),
          seed: descriptor.seed,
        })
        assert.deepEqual(
          replay.survivorCandidateIds,
          [forcedCandidateId],
          `${family} ${decision.label} widened a hard boundary`,
        )
        assert.deepEqual(
          replay.rows.filter((row) => row.viable).map((row) => row.candidateId),
          [forcedCandidateId],
          `${family} ${decision.label} ranked outside a hard boundary`,
        )
        // A family layer may legitimately decline a single-survivor boundary.
        // What it may never do is hand the decision to a foreign scorer.
        assert.ok(
          chainVersions.includes(replay.resolvedScorerVersion),
          `${family} ${decision.label} resolved a scorer outside its chain`,
        )
      }
    }
  })

  test(`${family} conformance: exact replay admits and rejects forgeries`, async () => {
    for (const variant of variants) {
      const identity = identityFor(descriptor, variant.scorer)
      for (const decision of descriptor.eligible) {
        const output = await decide(descriptor, variant.scorer, decision)
        assert.equal(
          admitFamilyDecision({
            descriptor,
            scorer: variant.scorer,
            decision,
            output,
            identity,
          }).kind,
          'trusted-exact',
          `${family} ${decision.label} must admit exactly`,
        )
        const forged = structuredClone(output)
        const rows = traceOf(forged, decision.label).candidateScores!
        const target = rows.find(
          (row) => row.candidateId !== forged.trace!.structuredCandidateId,
        ) ?? rows[0]
        target.value += 0.01
        const rejected = admitFamilyDecision({
          descriptor,
          scorer: variant.scorer,
          decision,
          output: forged,
          identity,
        })
        assert.equal(
          rejected.kind,
          'rejected',
          `${family} ${decision.label} admitted a forged score`,
        )
        if (rejected.kind === 'rejected') {
          assert.equal(
            rejected.reason,
            'trusted-identity-host-join-failed',
            `${family} ${decision.label} rejected a forged score for the wrong reason`,
          )
        }
        const detached = admitDecisionTrace({
          kind: 'finalized-artifact',
          trace: traceOf(output, decision.label),
          req: decision.req,
          view: decision.view,
          authoritativeAction: output.decision,
          selectedDecision: output.decision,
          deterministicSeed: descriptor.seed,
        })
        assert.equal(
          detached.kind,
          'artifact-diagnostic',
          `${family} ${decision.label} must stay diagnostic without identity`,
        )
      }
    }
  })
}
