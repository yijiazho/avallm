import fs from 'node:fs'
import readline from 'node:readline'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { applyDecision } from '../../engine/game.ts'
import { viewFor } from '../../engine/view.ts'
import type { GameEvent, Seat } from '../../engine/types.ts'
import { exactBelief } from '../../agents/belief/exact.ts'
import {
  buildPrivateEvilSeatMerlinPosterior,
} from '../../agents/analysis/assassin-merlin-posterior.ts'
import { createComposedAgent } from '../../agents/composed.ts'
import { composedBrainOptions } from '../../agents/registry.ts'
import { candidateIdForDecision } from '../../agents/candidate/candidates.ts'
import {
  FULL_ROLE_POLICY_SCORER_VERSION,
  type CandidateScore,
} from '../../agents/policy/score.ts'
import {
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
  GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  type GoodVoteFeatures,
} from '../../agents/policy/good-score-contract.ts'
import type { MerlinRoleUtilityAssessment } from '../../agents/analysis/role-utility.ts'
import type { DecisionTrace } from '../../agents/trace.ts'
import type { GameArtifact } from '../core/artifact.ts'
import {
  decisionReplayTimeline,
  replayGame,
  type DecisionSnapshot,
} from '../replay/replay.ts'
import {
  MERLIN_CONCEALMENT_VALUE_VERSION,
  valueOutcomeAwareMerlinVote,
  type MerlinConcealmentCandidateInput,
  type MerlinVote,
} from './merlin-concealment-value.ts'

export const MERLIN_CONCEALMENT_REPLAY_VERSION =
  'merlin-outcome-aware-concealment-replay-v1'

const APPROVE_ID = candidateIdForDecision({ kind: 'vote', vote: 'approve' })
const REJECT_ID = candidateIdForDecision({ kind: 'vote', vote: 'reject' })
const DEFAULT_RATES = Object.freeze([0, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1])

interface VoteOutcome {
  readonly approved: boolean
  readonly assassinPosteriorOnMerlin: number
}

interface PreparedVote {
  readonly artifactId: string
  readonly population: string
  readonly playerCount: number
  readonly candidateInputs: readonly MerlinConcealmentCandidateInput[]
  readonly baselineCandidateId: string
  readonly teamClean: boolean
  readonly outcomes: ReadonlyMap<string, VoteOutcome>
}

interface MutableMetrics {
  games: Set<string>
  decisions: number
  changed: number
  baselineCleanTeamRejections: number
  candidateCleanTeamRejections: number
  baselineDirtyTeamApprovals: number
  candidateDirtyTeamApprovals: number
  cleanApprovalsLost: number
  cleanApprovalsRecovered: number
  dirtyApprovalsIntroduced: number
  dirtyApprovalsPrevented: number
  baselineExposure: number
  candidateExposure: number
  exposureLower: number
  exposureHigher: number
  proxyExposureDelta: number
  boardUtilityDelta: number
  expectedStrategicDelta: number
  expectedConcealmentDelta: number
}

export interface MerlinConcealmentReplayMetrics {
  readonly population: string
  readonly concealmentExchangeRate: number
  readonly games: number
  readonly decisions: number
  readonly changed: number
  readonly baselineCleanTeamRejections: number
  readonly candidateCleanTeamRejections: number
  readonly baselineDirtyTeamApprovals: number
  readonly candidateDirtyTeamApprovals: number
  readonly cleanApprovalsLost: number
  readonly cleanApprovalsRecovered: number
  readonly dirtyApprovalsIntroduced: number
  readonly dirtyApprovalsPrevented: number
  readonly meanBaselineExposure: number
  readonly meanCandidateExposure: number
  readonly meanExposureDelta: number
  readonly exposureLower: number
  readonly exposureHigher: number
  readonly meanProxyExposureDelta: number
  readonly meanBoardUtilityDelta: number
  readonly meanExpectedStrategicDelta: number
  readonly meanExpectedConcealmentDelta: number
}

export interface MerlinConcealmentReplayReport {
  readonly schema: 1
  readonly version: typeof MERLIN_CONCEALMENT_REPLAY_VERSION
  readonly valueModelVersion: typeof MERLIN_CONCEALMENT_VALUE_VERSION
  readonly sourceFiles: readonly string[]
  readonly artifactsScanned: number
  readonly boardSwingArtifacts: number
  readonly rates: readonly number[]
  readonly metrics: readonly MerlinConcealmentReplayMetrics[]
}

function voteForCandidate(candidateId: string): MerlinVote {
  if (candidateId === APPROVE_ID) return 'approve'
  if (candidateId === REJECT_ID) return 'reject'
  throw new Error(`unexpected vote candidate ${candidateId}`)
}

function chosenVote(candidateId: string): MerlinVote {
  return voteForCandidate(candidateId)
}

function voteReveal(
  events: readonly GameEvent[],
  round: number,
  proposalNum: number,
): Extract<GameEvent, { type: 'voteReveal' }> | undefined {
  return events.findLast((event): event is Extract<GameEvent, { type: 'voteReveal' }> =>
    event.type === 'voteReveal'
    && event.payload.round === round
    && event.payload.proposalNum === proposalNum)
}

function posteriorOnTrueMerlin(
  artifact: GameArtifact,
  eventsThroughVote: ReturnType<typeof replayGame>,
): number {
  const merlin = artifact.players.find((player) => player.role === 'merlin')
  const assassin = artifact.players.find((player) => player.role === 'assassin')
  if (!merlin || !assassin) {
    throw new Error(`${artifact.id}: Merlin replay requires Merlin and assassin`)
  }
  const view = viewFor(eventsThroughVote, assassin.seat)
  const posterior = buildPrivateEvilSeatMerlinPosterior({
    view,
    belief: exactBelief(view),
  })
  return posterior.targets.find((target) => target.seat === merlin.seat)
    ?.posteriorProbability ?? 0
}

/**
 * Replay one alternate ballot only through the public reveal. Downstream game
 * play is intentionally excluded: this is an isolated decision fixture, not a
 * claim that the original future remains valid after a changed proposal.
 */
function outcomeAfterVote(
  artifact: GameArtifact,
  snapshot: DecisionSnapshot,
  vote: MerlinVote,
): VoteOutcome {
  const originalReveal = artifact.log.find((event): event is Extract<GameEvent, { type: 'voteReveal' }> =>
    event.seq > snapshot.seq
    && event.type === 'voteReveal'
    && event.payload.round === snapshot.req.round
    && event.payload.proposalNum === snapshot.req.proposalNum)
  if (!originalReveal) {
    throw new Error(`${artifact.id}: vote fixture has no following reveal`)
  }
  const game = replayGame(artifact, snapshot.firstSeq)
  applyDecision(game, snapshot.seat, { kind: 'vote', vote })
  if (!voteReveal(game.log, snapshot.req.round, snapshot.req.proposalNum)) {
    for (const event of artifact.log) {
      if (event.seq <= snapshot.seq || event.seq >= originalReveal.seq) continue
      if (event.type !== 'voteCast') continue
      applyDecision(game, event.payload.seat, {
        kind: 'vote',
        vote: event.payload.vote,
      })
    }
  }
  const reveal = voteReveal(
    game.log,
    snapshot.req.round,
    snapshot.req.proposalNum,
  )
  if (!reveal) {
    throw new Error(`${artifact.id}: alternate ballot did not reach a reveal`)
  }
  return Object.freeze({
    approved: reveal.payload.approved,
    assassinPosteriorOnMerlin: posteriorOnTrueMerlin(artifact, game),
  })
}

function boardRows(trace: DecisionTrace, artifactId: string): readonly CandidateScore[] {
  if (
    trace.componentVersions?.scorer
      !== GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION
    || trace.request.kind !== 'vote'
    || !trace.candidateScores
    || trace.candidateScores.length !== 2
  ) throw new Error(`${artifactId}: board-swing vote trace is incomplete`)
  for (const row of trace.candidateScores) {
    if (
      row.version !== GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION
      || row.features?.version !== GOOD_VOTE_FEATURE_VERSION
      || row.features.utilityVersion !== GOOD_VOTE_BOARD_SWING_UTILITY_VERSION
    ) throw new Error(`${artifactId}: board-swing vote features are invalid`)
  }
  return trace.candidateScores
}

async function roleRows(
  artifact: GameArtifact,
  snapshot: DecisionSnapshot,
): Promise<readonly CandidateScore[]> {
  const agent = createComposedAgent({
    seed: artifact.seed,
    ...composedBrainOptions('full-role'),
  })
  const output = await agent.decide(snapshot.req, snapshot.view)
  const trace = output.trace
  if (
    !trace
    || trace.componentVersions?.scorer !== FULL_ROLE_POLICY_SCORER_VERSION
    || trace.degradation.length
    || !trace.candidateScores
    || trace.candidateScores.length !== 2
  ) throw new Error(`${artifact.id}: full-role fixture replay degraded`)
  return trace.candidateScores
}

function merlinUtility(row: CandidateScore, artifactId: string): MerlinRoleUtilityAssessment {
  const features = row.roleObjectiveFeatures
  const utility = features?.utility
  if (
    !features
    || features.role !== 'merlin'
    || features.kind !== 'vote'
    || utility?.role !== 'merlin'
    || utility.kind !== 'vote'
    || utility.candidateId !== row.candidateId
  ) throw new Error(`${artifactId}: full-role replay lacks Merlin vote utility`)
  return utility
}

async function prepareVote(
  artifact: GameArtifact,
  snapshot: DecisionSnapshot,
  population: string,
): Promise<PreparedVote> {
  const trace = snapshot.trace
  if (!trace || trace.chosenCandidateId === undefined) {
    throw new Error(`${artifact.id}: board-swing snapshot lacks a chosen trace`)
  }
  const strategic = boardRows(trace, artifact.id)
  const role = await roleRows(artifact, snapshot)
  const roleById = new Map(role.map((row) => [row.candidateId, row]))
  const candidateInputs = strategic.map((row): MerlinConcealmentCandidateInput => {
    const features = row.features as GoodVoteFeatures
    const roleRow = roleById.get(row.candidateId)
    if (!roleRow) throw new Error(`${artifact.id}: role replay candidate join failed`)
    const utility = merlinUtility(roleRow, artifact.id)
    return Object.freeze({
      candidateId: row.candidateId,
      vote: voteForCandidate(row.candidateId),
      boardUtility: row.value,
      currentCleanProbability: features.currentCleanProbability,
      rejectionsBeforeHammer: features.rejectionsBeforeHammer,
      correctedExposureProxyIndex: utility.correctedExposureProxyIndex,
    })
  })
  const team = snapshot.view.currentTeam
  if (!team) throw new Error(`${artifact.id}: vote fixture lacks a current team`)
  const teamClean = team.every((seat) => artifact.players[seat]?.alignment === 'good')
  const outcomes = new Map<string, VoteOutcome>()
  for (const input of candidateInputs) {
    outcomes.set(
      input.candidateId,
      outcomeAfterVote(artifact, snapshot, input.vote),
    )
  }
  const originalVote = snapshot.original.kind === 'vote'
    ? snapshot.original.vote
    : undefined
  if (
    originalVote === undefined
    || chosenVote(trace.chosenCandidateId) !== originalVote
  ) throw new Error(`${artifact.id}: board-swing trace disagrees with applied vote`)
  return Object.freeze({
    artifactId: artifact.id,
    population,
    playerCount: artifact.playerCount,
    candidateInputs: Object.freeze(candidateInputs),
    baselineCandidateId: trace.chosenCandidateId,
    teamClean,
    outcomes,
  })
}

async function* artifactsFrom(file: string): AsyncGenerator<GameArtifact> {
  const input = fs.createReadStream(file, { encoding: 'utf8' })
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0
  for await (const line of lines) {
    lineNumber++
    if (!line.trim()) continue
    try {
      yield JSON.parse(line) as GameArtifact
    } catch {
      throw new Error(`${file}:${lineNumber}: not valid JSON`)
    }
  }
}

function emptyMetrics(): MutableMetrics {
  return {
    games: new Set<string>(),
    decisions: 0,
    changed: 0,
    baselineCleanTeamRejections: 0,
    candidateCleanTeamRejections: 0,
    baselineDirtyTeamApprovals: 0,
    candidateDirtyTeamApprovals: 0,
    cleanApprovalsLost: 0,
    cleanApprovalsRecovered: 0,
    dirtyApprovalsIntroduced: 0,
    dirtyApprovalsPrevented: 0,
    baselineExposure: 0,
    candidateExposure: 0,
    exposureLower: 0,
    exposureHigher: 0,
    proxyExposureDelta: 0,
    boardUtilityDelta: 0,
    expectedStrategicDelta: 0,
    expectedConcealmentDelta: 0,
  }
}

function metricKey(population: string, rate: number): string {
  return `${population}\u0000${rate}`
}

function rowFor(
  result: ReturnType<typeof valueOutcomeAwareMerlinVote>,
  candidateId: string,
) {
  const row = result.candidates.find((candidate) =>
    candidate.candidateId === candidateId)
  if (!row) throw new Error(`value result lacks candidate ${candidateId}`)
  return row
}

function addVote(
  metrics: MutableMetrics,
  vote: PreparedVote,
  rate: number,
): void {
  const result = valueOutcomeAwareMerlinVote({
    playerCount: vote.playerCount,
    concealmentExchangeRate: rate,
    candidates: vote.candidateInputs,
  })
  const baseline = rowFor(result, vote.baselineCandidateId)
  const candidate = rowFor(result, result.chosenCandidateId)
  const baselineOutcome = vote.outcomes.get(baseline.candidateId)
  const candidateOutcome = vote.outcomes.get(candidate.candidateId)
  if (!baselineOutcome || !candidateOutcome) {
    throw new Error(`${vote.artifactId}: replay outcome join failed`)
  }
  metrics.games.add(vote.artifactId)
  metrics.decisions++
  if (baseline.candidateId !== candidate.candidateId) metrics.changed++
  if (vote.teamClean && baseline.vote === 'reject') {
    metrics.baselineCleanTeamRejections++
  }
  if (vote.teamClean && candidate.vote === 'reject') {
    metrics.candidateCleanTeamRejections++
  }
  if (!vote.teamClean && baseline.vote === 'approve') {
    metrics.baselineDirtyTeamApprovals++
  }
  if (!vote.teamClean && candidate.vote === 'approve') {
    metrics.candidateDirtyTeamApprovals++
  }
  if (baselineOutcome.approved !== candidateOutcome.approved) {
    if (vote.teamClean && baselineOutcome.approved && !candidateOutcome.approved) {
      metrics.cleanApprovalsLost++
    }
    if (vote.teamClean && !baselineOutcome.approved && candidateOutcome.approved) {
      metrics.cleanApprovalsRecovered++
    }
    if (!vote.teamClean && !baselineOutcome.approved && candidateOutcome.approved) {
      metrics.dirtyApprovalsIntroduced++
    }
    if (!vote.teamClean && baselineOutcome.approved && !candidateOutcome.approved) {
      metrics.dirtyApprovalsPrevented++
    }
  }
  const exposureDelta = candidateOutcome.assassinPosteriorOnMerlin
    - baselineOutcome.assassinPosteriorOnMerlin
  metrics.baselineExposure += baselineOutcome.assassinPosteriorOnMerlin
  metrics.candidateExposure += candidateOutcome.assassinPosteriorOnMerlin
  if (exposureDelta < 0) metrics.exposureLower++
  if (exposureDelta > 0) metrics.exposureHigher++
  metrics.proxyExposureDelta += candidate.correctedExposureProxyIndex
    - baseline.correctedExposureProxyIndex
  metrics.boardUtilityDelta += candidate.boardUtility - baseline.boardUtility
  metrics.expectedStrategicDelta += candidate.expectedStrategicValue
    - baseline.expectedStrategicValue
  metrics.expectedConcealmentDelta += candidate.expectedConcealmentValue
    - baseline.expectedConcealmentValue
}

function finishMetrics(
  population: string,
  concealmentExchangeRate: number,
  mutable: MutableMetrics,
): MerlinConcealmentReplayMetrics {
  const denominator = mutable.decisions || 1
  return Object.freeze({
    population,
    concealmentExchangeRate,
    games: mutable.games.size,
    decisions: mutable.decisions,
    changed: mutable.changed,
    baselineCleanTeamRejections: mutable.baselineCleanTeamRejections,
    candidateCleanTeamRejections: mutable.candidateCleanTeamRejections,
    baselineDirtyTeamApprovals: mutable.baselineDirtyTeamApprovals,
    candidateDirtyTeamApprovals: mutable.candidateDirtyTeamApprovals,
    cleanApprovalsLost: mutable.cleanApprovalsLost,
    cleanApprovalsRecovered: mutable.cleanApprovalsRecovered,
    dirtyApprovalsIntroduced: mutable.dirtyApprovalsIntroduced,
    dirtyApprovalsPrevented: mutable.dirtyApprovalsPrevented,
    meanBaselineExposure: mutable.baselineExposure / denominator,
    meanCandidateExposure: mutable.candidateExposure / denominator,
    meanExposureDelta:
      (mutable.candidateExposure - mutable.baselineExposure) / denominator,
    exposureLower: mutable.exposureLower,
    exposureHigher: mutable.exposureHigher,
    meanProxyExposureDelta: mutable.proxyExposureDelta / denominator,
    meanBoardUtilityDelta: mutable.boardUtilityDelta / denominator,
    meanExpectedStrategicDelta:
      mutable.expectedStrategicDelta / denominator,
    meanExpectedConcealmentDelta:
      mutable.expectedConcealmentDelta / denominator,
  })
}

export async function replayOutcomeAwareMerlinVotes(
  sourceFiles: readonly string[],
  rates: readonly number[] = DEFAULT_RATES,
): Promise<MerlinConcealmentReplayReport> {
  if (!sourceFiles.length) throw new Error('at least one artifact file is required')
  if (
    !rates.length
    || rates.some((rate) => !Number.isFinite(rate) || rate < 0)
    || new Set(rates).size !== rates.length
  ) throw new Error('rates must be distinct finite nonnegative numbers')
  const metrics = new Map<string, MutableMetrics>()
  let artifactsScanned = 0
  let boardSwingArtifacts = 0
  for (const file of sourceFiles) {
    for await (const artifact of artifactsFrom(file)) {
      artifactsScanned++
      if (artifact.architecture?.variant !== 'board-swing') continue
      if (artifact.architecture.targetRole !== 'merlin') continue
      boardSwingArtifacts++
      const population = artifact.tags?.opponentPopulation ?? 'unknown'
      const targetSeat = artifact.architecture.targetSeat as Seat
      const timeline = decisionReplayTimeline(artifact)
      for (const snapshot of timeline.snapshots) {
        if (
          snapshot.seat !== targetSeat
          || snapshot.role !== 'merlin'
          || snapshot.kind !== 'vote'
        ) continue
        const prepared = await prepareVote(artifact, snapshot, population)
        for (const rate of rates) {
          const key = metricKey(population, rate)
          const mutable = metrics.get(key) ?? emptyMetrics()
          addVote(mutable, prepared, rate)
          metrics.set(key, mutable)
        }
      }
    }
  }
  const populations = [...new Set([...metrics.keys()].map((key) =>
    key.split('\u0000')[0]!))].sort()
  return Object.freeze({
    schema: 1,
    version: MERLIN_CONCEALMENT_REPLAY_VERSION,
    valueModelVersion: MERLIN_CONCEALMENT_VALUE_VERSION,
    sourceFiles: Object.freeze([...sourceFiles]),
    artifactsScanned,
    boardSwingArtifacts,
    rates: Object.freeze([...rates]),
    metrics: Object.freeze(populations.flatMap((population) =>
      rates.map((rate) => finishMetrics(
        population,
        rate,
        metrics.get(metricKey(population, rate)) ?? emptyMetrics(),
      )))),
  })
}

function ratesFrom(text: string | undefined): readonly number[] {
  if (text === undefined) return DEFAULT_RATES
  return text.split(',').map((entry) => Number(entry.trim()))
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      rates: { type: 'string' },
      output: { type: 'string' },
    },
  })
  const report = await replayOutcomeAwareMerlinVotes(
    positionals,
    ratesFrom(values.rates),
  )
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (values.output) fs.writeFileSync(values.output, text)
  console.log(text.trimEnd())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}