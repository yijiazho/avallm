#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_ARTIFACTS = 'data/transcripts/artifacts.jsonl'

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`${file}:${index + 1}: ${error.message}`)
      }
    })
}

function descriptorKind(descriptor) {
  if (descriptor === 'human') return 'human'
  if (descriptor === 'heuristic' || descriptor === 'random') return descriptor
  if (descriptor.startsWith('def:probabilistic-llm:llm:')) return 'probabilistic-llm'
  if (descriptor === 'def:probabilistic') return 'probabilistic'
  if (descriptor.startsWith('llm:')) return 'raw-llm'
  if (descriptor.startsWith('def:')) return 'definition'
  return 'legacy-or-unknown'
}

function tracesFor(artifact, seat) {
  return (artifact.decisionTraces ?? []).filter((trace) => trace.viewerSeat === seat)
}

function thinkingCount(artifact, seat) {
  return artifact.log.filter((event) =>
    event.type === 'thinking' && event.payload?.seat === seat).length
}

function executionEvidence(artifact, player) {
  const traces = tracesFor(artifact, player.seat)
  const thinking = thinkingCount(artifact, player.seat)
  const descriptor = descriptorKind(player.agent)
  const inferred = traces.length > 0
    ? 'probabilistic-llm'
    : thinking > 0 ? 'raw-llm' : descriptor
  return {
    seat: player.seat,
    name: player.name,
    role: player.role,
    descriptor: player.agent,
    descriptorKind: descriptor,
    inferredExecution: inferred,
    decisionTraces: traces.length,
    thinkingEvents: thinking,
  }
}

function identityFindings(artifact, seats) {
  return seats.flatMap((seat) => {
    if (seat.decisionTraces === 0) return []
    if (seat.descriptorKind === 'probabilistic-llm') return []
    return [{
      signature: 'IDENTITY_DESCRIPTOR_LOSS',
      priority: 'P1',
      confidence: 'confirmed',
      scope: 'instrumentation',
      seat: seat.seat,
      title: 'Persisted agent identity disagrees with composed execution trace',
      evidence: `${seat.name} (#${seat.seat}) has ${seat.decisionTraces} composed decision traces but descriptor ${JSON.stringify(seat.descriptor)} does not identify the probabilistic+LLM definition.`,
    }]
  })
}

function objectiveOf(trace) {
  return trace.privatePlanOutcome?.selected?.plan?.strategicIntent?.objective
}

function voteContradictionFindings(artifact) {
  const traces = artifact.decisionTraces ?? []
  return traces.flatMap((vote) => {
    if (vote.request?.kind !== 'vote') return []
    const actualVote = vote.action?.vote
    if (actualVote !== 'approve' && actualVote !== 'reject') return []
    const earlier = traces.filter((candidate) =>
      candidate.viewerSeat === vote.viewerSeat
      && candidate.request?.kind === 'discuss'
      && candidate.request.round === vote.request.round
      && candidate.request.proposalNum === vote.request.proposalNum
      && candidate.beliefThroughSeq < vote.beliefThroughSeq)
      .sort((a, b) => b.beliefThroughSeq - a.beliefThroughSeq)[0]
    const objective = earlier && objectiveOf(earlier)
    const contradicts = (objective === 'SUPPORT_TEAM' && actualVote === 'reject')
      || (objective === 'OPPOSE_TEAM' && actualVote === 'approve')
    if (!contradicts) return []
    const player = artifact.players.find((entry) => entry.seat === vote.viewerSeat)
    return [{
      signature: 'PLAN_VOTE_CONTRADICTION',
      priority: 'P1',
      confidence: 'confirmed',
      scope: 'probabilistic-llm',
      seat: vote.viewerSeat,
      title: 'Committed discussion objective reverses at the vote',
      evidence: `${player?.name ?? `seat ${vote.viewerSeat}`} committed ${objective} at seq ${earlier.beliefThroughSeq}, then voted ${actualVote} on Q${vote.request.round}.${vote.request.proposalNum} at seq ${vote.beliefThroughSeq}.`,
    }]
  })
}

function merlinExposureFindings(artifact) {
  const merlin = artifact.players.find((player) => player.role === 'merlin')
  if (!merlin || tracesFor(artifact, merlin.seat).length === 0) return []
  const evil = new Set(artifact.players
    .filter((player) => player.alignment === 'evil')
    .map((player) => player.seat))
  const samples = artifact.log.flatMap((event) => {
    if (event.type !== 'voteReveal') return []
    const ballot = event.payload.votes.find((vote) => vote.seat === merlin.seat)
    if (!ballot) return []
    const clean = event.payload.team.every((seat) => !evil.has(seat))
    const truthTracking = clean ? ballot.vote === 'approve' : ballot.vote === 'reject'
    return [{ round: event.payload.round, proposalNum: event.payload.proposalNum, truthTracking }]
  })
  if (samples.length < 3 || samples.some((sample) => !sample.truthTracking)) return []
  return [{
    signature: 'MERLIN_PERFECT_TRUTH_VOTING',
    priority: 'P2',
    confidence: 'review',
    scope: 'probabilistic-llm',
    seat: merlin.seat,
    title: 'Merlin ballot pattern perfectly tracks hidden team truth',
    evidence: `${merlin.name} (#${merlin.seat}) voted with hidden team truth on all ${samples.length} observed proposals; review exposure control and assassination outcome.`,
  }]
}

export function auditArtifact(artifact) {
  const seats = artifact.players.map((player) => executionEvidence(artifact, player))
  const findings = [
    ...identityFindings(artifact, seats),
    ...voteContradictionFindings(artifact),
    ...merlinExposureFindings(artifact),
  ]
  return {
    gameId: artifact.id,
    seed: artifact.seed,
    createdAt: artifact.createdAt,
    winner: artifact.winner,
    seats,
    findings,
  }
}

export function aggregateAudits(audits) {
  const bySignature = new Map()
  for (const audit of audits) {
    for (const finding of audit.findings) {
      const row = bySignature.get(finding.signature) ?? {
        signature: finding.signature,
        priority: finding.priority,
        confidence: finding.confidence,
        scope: finding.scope,
        occurrences: 0,
        games: new Set(),
        seats: new Set(),
      }
      row.occurrences++
      row.games.add(audit.gameId)
      row.seats.add(`${audit.gameId}#${finding.seat}`)
      bySignature.set(finding.signature, row)
    }
  }
  return [...bySignature.values()].map((row) => ({
    ...row,
    games: [...row.games].sort(),
    seats: [...row.seats].sort(),
  })).sort((a, b) => a.priority.localeCompare(b.priority)
    || b.occurrences - a.occurrences
    || a.signature.localeCompare(b.signature))
}

function markdown(result, artifactFile) {
  const out = [
    '# Avalon playtest audit',
    '',
    `- source: \`${artifactFile}\``,
    `- games: ${result.audits.length}`,
    `- findings: ${result.audits.reduce((sum, audit) => sum + audit.findings.length, 0)}`,
    '',
    '## Aggregate',
    '',
    '| signature | priority | scope | occurrences | games |',
    '| --------- | -------- | ----- | ----------- | ----- |',
    ...result.aggregate.map((row) =>
      `| ${row.signature} | ${row.priority} | ${row.scope} | ${row.occurrences} | ${row.games.join(', ')} |`),
  ]
  for (const audit of result.audits) {
    out.push('', `## ${audit.gameId}`, '', '### Execution evidence', '',
      '| seat | player | role | persisted descriptor | inferred | traces | thinking |',
      '| ---- | ------ | ---- | -------------------- | -------- | ------ | -------- |')
    for (const seat of audit.seats) {
      out.push(`| ${seat.seat} | ${seat.name} | ${seat.role} | ${seat.descriptor} | ${seat.inferredExecution} | ${seat.decisionTraces} | ${seat.thinkingEvents} |`)
    }
    out.push('', '### Findings', '')
    if (audit.findings.length === 0) out.push('- None detected by deterministic checks.')
    for (const finding of audit.findings) {
      out.push(`- **${finding.priority} ${finding.signature}** (${finding.confidence}, ${finding.scope}): ${finding.evidence}`)
    }
  }
  return out.join('\n') + '\n'
}

function parseArgs(argv) {
  const options = { artifacts: DEFAULT_ARTIFACTS, json: false, all: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--artifacts') options.artifacts = argv[++i]
    else if (arg === '--game') options.game = argv[++i]
    else if (arg === '--transcript') options.transcript = argv[++i]
    else if (arg === '--all') options.all = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function usage() {
  return [
    'Usage: node audit-artifact.mjs (--game ID | --transcript FILE | --all) [options]',
    '',
    'Options:',
    `  --artifacts FILE  JSONL corpus (default ${DEFAULT_ARTIFACTS})`,
    '  --game ID         audit one game',
    '  --transcript FILE extract the game id from a copied debug transcript',
    '  --all             audit every game in the corpus',
    '  --json            emit machine-readable JSON',
  ].join('\n')
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return console.log(usage())
  if (options.transcript) {
    const text = fs.readFileSync(options.transcript, 'utf8')
    options.game = text.match(/game\s+`([^`]+)`/)?.[1]
    if (!options.game) throw new Error('transcript does not contain a game id')
  }
  if (!options.all && !options.game) throw new Error('choose --game, --transcript, or --all')
  const artifactFile = path.resolve(options.artifacts)
  const artifacts = readJsonl(artifactFile)
  const selected = options.all
    ? artifacts
    : artifacts.filter((artifact) => artifact.id === options.game)
  if (selected.length === 0) throw new Error(`game not found: ${options.game}`)
  const audits = selected.map(auditArtifact)
  const result = { schema: 1, audits, aggregate: aggregateAudits(audits) }
  console.log(options.json ? JSON.stringify(result, null, 2) : markdown(result, artifactFile))
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(`audit-artifact: ${error.message}`)
    process.exitCode = 1
  }
}
