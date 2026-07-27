// External-agent adapter: newline-delimited JSON over a child process's stdio.
// Protocol:
//   child -> { type: 'hello', capabilities?: { discuss?: boolean } }   (once, on start)
//   us    -> { id, type: 'decide', request, view }
//   child -> { id, decision }
// Agents that declare discuss:false are auto-passed in table-talk rounds.
// Any protocol failure throws from decide(); the runner's fallback ladder
// (heuristic substitute) keeps the game moving.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { isDeepStrictEqual } from 'node:util'
import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import {
  ANALYSIS_FACT_CODES,
  FORCED_PLAY_REASON_CODES,
} from './analysis/types.ts'
import {
  FORCED_POLICY_VERSION,
  LEGAL_CANDIDATE_VERSION,
} from './policy/types.ts'
import {
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
} from './policy/score.ts'
import {
  DECISION_TRACE_VERSION,
  decisionTraceIdForRequest,
  type DecisionTrace,
} from './trace.ts'
import type { AgentOutput, AvalonAgent } from './types.ts'

export interface StdioAgentOpts {
  cmd: string
  args: string[]
  label?: string
  timeoutMs?: number
  onDecisionTrace?: (trace: DecisionTrace) => void
}

interface Hello {
  type: 'hello'
  capabilities?: { discuss?: boolean }
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function seatArray(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.every((entry) => Number.isInteger(entry) && entry >= 0)
}

function finiteProbability(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1
}

function validRelevantTeam(value: unknown): boolean {
  if (value === undefined) return true
  const team = value as Record<string, unknown>
  return !!team
    && typeof team === 'object'
    && seatArray(team.team)
    && finiteProbability(team.cleanProbability)
    && Array.isArray(team.evilCountDistribution)
    && team.evilCountDistribution.length === team.team.length + 1
    && team.evilCountDistribution.every(finiteProbability)
    && seatArray(team.knownFailsAboard)
}

function validComponentVersions(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const versions = value as Record<string, unknown>
  const required = [
    'brain', 'belief', 'beliefVisibility', 'factors', 'languageEvidence',
    'observerModel', 'analysis', 'candidates', 'forcedPolicy', 'policy',
    'scorer', 'planner', 'prompt', 'renderer', 'communication', 'voice',
  ]
  return required.every(
    (key) => typeof versions[key] === 'string' && versions[key].length > 0,
  )
}

function validCandidateScores(value: unknown): boolean {
  if (value === undefined) return true
  return Array.isArray(value) && value.every((entry) => {
    const score = entry as Record<string, unknown>
    const features = score?.features as Record<string, unknown> | undefined
    const distribution = features?.evilCountDistribution
    const team = features?.team
    const validFeatures = features === undefined || (
      !!features
      && typeof features === 'object'
      && !Array.isArray(features)
      && features.version === GOOD_PROPOSAL_FEATURE_VERSION
      && features.semantics === 'uniform-feasible-joint'
      && typeof features.beliefModelVersion === 'string'
      && features.beliefModelVersion.length > 0
      && Number.isInteger(features.beliefThroughSeq)
      && seatArray(team)
      && new Set(team).size === team.length
      && team.every((seat, index) => index === 0 || team[index - 1] < seat)
      && finiteProbability(features.cleanProbability)
      && Array.isArray(distribution)
      && distribution.length === team.length + 1
      && distribution.every(finiteProbability)
      && Math.abs(
        distribution.reduce((sum, probability) => sum + probability, 0) - 1,
      ) <= 1e-9
      && Math.abs(distribution[0] - features.cleanProbability) <= 1e-12
    )
    return !!score
      && typeof score === 'object'
      && typeof score.version === 'string'
      && score.version.length > 0
      && typeof score.candidateId === 'string'
      && score.candidateId.length > 0
      && typeof score.value === 'number'
      && Number.isFinite(score.value)
      && typeof score.viable === 'boolean'
      && stringArray(score.reasonCodes)
      && validFeatures
  })
}

function enumStringArray(
  value: unknown,
  allowed: readonly string[],
): value is readonly string[] {
  const choices = new Set(allowed)
  return stringArray(value) && value.every((entry) => choices.has(entry))
}

function validForcedPolicyResult(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const forced = value as Record<string, unknown>
  const allowed = stringArray(forced.allowedCandidateIds)
    ? forced.allowedCandidateIds
    : undefined
  return (
    forced.version === FORCED_POLICY_VERSION
    && typeof forced.applied === 'boolean'
    && enumStringArray(forced.reasonCodes, FORCED_PLAY_REASON_CODES)
    && allowed !== undefined
    && allowed.length > 0
    && new Set(allowed).size === allowed.length
    && (
      forced.selectedCandidateId === undefined
      || (
        typeof forced.selectedCandidateId === 'string'
        && allowed.includes(forced.selectedCandidateId)
      )
    )
    && (
      forced.applied
        ? (forced.reasonCodes as readonly string[]).length > 0
        : (
            (forced.reasonCodes as readonly string[]).length === 0
            && forced.selectedCandidateId === undefined
          )
    )
  )
}

function validComposedTraceRelations(trace: Record<string, unknown>): boolean {
  if (trace.candidateScores === undefined) {
    return trace.chosenCandidateId === undefined
      && trace.plannerCandidateId === undefined
  }
  const scores = trace.candidateScores as Array<Record<string, unknown>>
  const ids = scores.map((score) => score.candidateId)
  if (new Set(ids).size !== ids.length) return false
  const components = trace.componentVersions as Record<string, unknown> | undefined
  if (
    components
    && scores.some((score) => score.version !== components.scorer)
  ) {
    return false
  }
  if (
    scores.some((score) => {
      const features = score.features as Record<string, unknown> | undefined
      return features !== undefined && (
        score.version !== GOOD_PROPOSAL_SCORER_VERSION
        || features.beliefModelVersion !== trace.beliefModelVersion
        || features.beliefThroughSeq !== trace.beliefThroughSeq
        || score.candidateId !== (
          `${LEGAL_CANDIDATE_VERSION}:propose:`
          + (features.team as number[]).join(',')
        )
        || score.value !== (
          score.viable
            ? features.cleanProbability
            : -Number.MAX_SAFE_INTEGER
        )
      )
    })
  ) {
    return false
  }
  const chosen = trace.chosenCandidateId
  if (
    typeof chosen !== 'string'
    || !scores.some(
      (score) => score.candidateId === chosen && score.viable === true,
    )
  ) {
    return false
  }
  const chosenScore = scores.find((score) => score.candidateId === chosen)
  const chosenFeatures = chosenScore?.features as
    | Record<string, unknown>
    | undefined
  const action = trace.action as Record<string, unknown>
  const relevantTeam = trace.relevantTeam as Record<string, unknown> | undefined
  const featureScores = scores.filter((score) => score.features !== undefined)
  if (
    featureScores.length > 0
    && (
      action.kind !== 'propose'
      || featureScores.length !== scores.length
      || !chosenFeatures
    )
  ) {
    return false
  }
  if (chosenFeatures) {
    const actionTeam = [...(action.team as number[])].sort((left, right) =>
      left - right)
    if (
      !isDeepStrictEqual(chosenFeatures.team, actionTeam)
      || !relevantTeam
      || !isDeepStrictEqual(relevantTeam.team, actionTeam)
      || relevantTeam.cleanProbability !== chosenFeatures.cleanProbability
      || !isDeepStrictEqual(
        relevantTeam.evilCountDistribution,
        chosenFeatures.evilCountDistribution,
      )
    ) {
      return false
    }
  }
  const forced = trace.forcedPolicyResult as Record<string, unknown> | undefined
  if (forced) {
    const allowed = new Set(forced.allowedCandidateIds as string[])
    if ([...allowed].some((candidateId) => !ids.includes(candidateId))) {
      return false
    }
    if (scores.some((score) => score.viable === true && !allowed.has(
      score.candidateId as string,
    ))) {
      return false
    }
    if (
      forced.selectedCandidateId !== undefined
      && forced.selectedCandidateId !== chosen
    ) {
      return false
    }
    if (
      forced.applied === false
      && (
        allowed.size !== ids.length
        || ids.some((candidateId) => !allowed.has(candidateId))
      )
    ) {
      return false
    }
    const traceReasons = new Set(trace.reasonCodes as string[])
    if (
      (forced.reasonCodes as string[]).some(
        (reason) => !traceReasons.has(reason),
      )
    ) {
      return false
    }
  }
  return true
}

function validDecisionTrace(
  req: DecisionRequest,
  decision: Decision,
  value: unknown,
): value is DecisionTrace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const trace = value as Record<string, unknown>
  const throughSeq = trace.beliefThroughSeq
  const hypotheses = trace.topHypotheses
  return (
    trace.version === DECISION_TRACE_VERSION
    && typeof throughSeq === 'number'
    && Number.isInteger(throughSeq)
    && throughSeq >= 0
    && trace.decisionId === decisionTraceIdForRequest(req, throughSeq)
    && trace.viewerSeat === req.seat
    && isDeepStrictEqual(trace.request, req)
    && typeof trace.beliefModelVersion === 'string'
    && trace.beliefModelVersion.length > 0
    && trace.quality === 'constraints-only'
    && stringArray(trace.degradation)
    && Array.isArray(hypotheses)
    && hypotheses.every((entry) => {
      const hypothesis = entry as Record<string, unknown>
      return !!hypothesis
        && typeof hypothesis === 'object'
        && typeof hypothesis.worldKey === 'string'
        && finiteProbability(hypothesis.probability)
        && seatArray(hypothesis.evilSeats)
    })
    && validRelevantTeam(trace.relevantTeam)
    && enumStringArray(trace.factCodes, ANALYSIS_FACT_CODES)
    && enumStringArray(trace.reasonCodes, FORCED_PLAY_REASON_CODES)
    && isDeepStrictEqual(trace.action, decision)
    && (
      trace.statedReasoning === undefined
      || typeof trace.statedReasoning === 'string'
    )
    && validComponentVersions(trace.componentVersions)
    && validCandidateScores(trace.candidateScores)
    && (
      trace.chosenCandidateId === undefined
      || typeof trace.chosenCandidateId === 'string'
    )
    && (
      trace.plannerCandidateId === undefined
      || typeof trace.plannerCandidateId === 'string'
    )
    && (
      trace.decisionPlanVersion === undefined
      || typeof trace.decisionPlanVersion === 'string'
    )
    && validForcedPolicyResult(trace.forcedPolicyResult)
    && validComposedTraceRelations(trace)
  )
}

/** Optional protocol extension: external agents may return a private trace. */
export function parseStdioDecisionReply(
  req: DecisionRequest,
  reply: unknown,
  label = 'external agent',
): AgentOutput {
  const record = reply as Record<string, unknown>
  const decision = record?.decision as Decision | undefined
  if (!decision || decision.kind !== req.kind) {
    throw new Error(`${label} returned invalid decision for ${req.kind}`)
  }
  if (record.trace === undefined) return decision
  if (!validDecisionTrace(req, decision, record.trace)) {
    throw new Error(`${label} returned invalid decision trace for ${req.kind}`)
  }
  return { decision, trace: record.trace }
}

export function createStdioAgent(opts: StdioAgentOpts): AvalonAgent {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const label = opts.label ?? opts.cmd
  let child: ChildProcessWithoutNullStreams | null = null
  let nextId = 1
  const pending = new Map<number, (msg: unknown) => void>()
  let helloPromise: Promise<Hello> | null = null

  function start(): Promise<Hello> {
    if (helloPromise) return helloPromise
    helloPromise = new Promise<Hello>((resolveHello, rejectHello) => {
      const proc = spawn(opts.cmd, opts.args, { stdio: ['pipe', 'pipe', 'pipe'] })
      child = proc
      let helloSeen = false
      proc.on('error', (err) => rejectHello(new Error(`agent "${label}" failed to start: ${err.message}`)))
      proc.on('exit', () => {
        if (!helloSeen) rejectHello(new Error(`agent "${label}" exited before hello`))
        for (const resolve of pending.values()) {
          resolve(new Error(`agent "${label}" exited`))
        }
        pending.clear()
      })
      const rl = createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          return // ignore non-JSON noise on stdout
        }
        if (msg.type === 'hello' && !helloSeen) {
          helloSeen = true
          resolveHello(msg as unknown as Hello)
          return
        }
        const id = msg.id as number
        const resolve = pending.get(id)
        if (resolve) {
          pending.delete(id)
          resolve(msg)
        }
      })
      const t = setTimeout(() => {
        if (!helloSeen) rejectHello(new Error(`agent "${label}" hello timeout`))
      }, timeoutMs)
      t.unref?.()
    })
    return helloPromise
  }

  return {
    recordDecisionTrace(trace) {
      opts.onDecisionTrace?.(trace)
    },
    async decide(req: DecisionRequest, view: PlayerView): Promise<AgentOutput> {
      const hello = await start()
      if (req.kind === 'discuss' && hello.capabilities?.discuss === false) {
        return { kind: 'discuss', say: '' }
      }
      const id = nextId++
      const reply = await new Promise<unknown>((resolve, reject) => {
        pending.set(id, resolve)
        const t = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`agent "${label}" timed out on ${req.kind}`))
        }, timeoutMs)
        t.unref?.()
        child!.stdin.write(JSON.stringify({ id, type: 'decide', request: req, view }) + '\n')
      })
      if (reply instanceof Error) throw reply
      return parseStdioDecisionReply(req, reply, `agent "${label}"`)
    },
    dispose() {
      child?.kill()
      child = null
    },
  }
}
