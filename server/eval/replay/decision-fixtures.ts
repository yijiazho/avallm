// Frozen PlayerView decision fixtures for architecture regression tests.
//
// Generation deliberately goes through a completed artifact plus snapshotAt:
// the same verified replay path used by the situation bank. The committed
// fixture contains only the agent boundary (request + seat-filtered view) and
// the Phase 0 heuristic decision. It never contains a raw Game or other seats'
// private deal information.

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createGame } from '../../engine/game.ts'
import { createAgent } from '../../agents/registry.ts'
import { runGame } from '../../sim/runner.ts'
import { toArtifact } from '../core/artifact.ts'
import {
  decisionReplayTimeline,
  type DecisionReplayTimeline,
  type DecisionSnapshot,
} from './replay.ts'
import { ARCHITECTURE_BANK, ARCHITECTURE_BANK_ID } from '../banks/architecture-bank.ts'
import type { ArchitectureBankCase } from '../banks/architecture-bank.ts'
import type { GameArtifact } from '../core/artifact.ts'
import type {
  Decision,
  DecisionKind,
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
  TalkConfig,
} from '../../engine/types.ts'
import type { AvalonAgent } from '../../agents/types.ts'

export const DECISION_FIXTURE_SCHEMA = 1
export const DEFAULT_DECISION_FIXTURE_FILE = 'test/fixtures/architecture-decision-views.json'

const FIXTURE_TALK: TalkConfig = {
  maxRounds: 1,
  maxRoundsAfterChange: 1,
  leaderInDiscussion: 'last',
}

interface FixtureSpec {
  id: string
  caseId: string
  role: Role
  kind: DecisionKind
  round: number
  proposalNum: number
}

// The set is intentionally small but covers every agent-boundary decision kind,
// every private-knowledge shape, early uncertainty, resolved quests, the
// two-Fail quest, and the assassination transition.
const FIXTURE_SPECS: readonly FixtureSpec[] = [
  {
    id: 'merlin-opening-proposal',
    caseId: '5p-merlin',
    role: 'merlin',
    kind: 'propose',
    round: 1,
    proposalNum: 1,
  },
  {
    id: 'percival-opening-discussion',
    caseId: '5p-percival',
    role: 'percival',
    kind: 'discuss',
    round: 1,
    proposalNum: 1,
  },
  {
    id: 'servant-vote-after-evidence',
    caseId: '5p-servant',
    role: 'servant',
    kind: 'vote',
    round: 3,
    proposalNum: 1,
  },
  {
    id: 'assassin-late-finalize',
    caseId: '5p-assassin',
    role: 'assassin',
    kind: 'finalize',
    round: 4,
    proposalNum: 1,
  },
  {
    id: 'oberon-two-fail-quest',
    caseId: '7p-oberon',
    role: 'oberon',
    kind: 'quest',
    round: 4,
    proposalNum: 5,
  },
  {
    id: 'minion-late-discussion',
    caseId: '8p-minion',
    role: 'minion',
    kind: 'discuss',
    round: 5,
    proposalNum: 4,
  },
  {
    id: 'mordred-late-vote',
    caseId: '9p-mordred',
    role: 'mordred',
    kind: 'vote',
    round: 3,
    proposalNum: 4,
  },
  {
    id: 'assassin-endgame-target',
    caseId: '5p-merlin',
    role: 'assassin',
    kind: 'assassinate',
    round: 3,
    proposalNum: 1,
  },
]

export interface FrozenDecisionFixture {
  schema: number
  id: string
  source: {
    bank: string
    caseId: string
    seed: string
    seq: number
  }
  req: DecisionRequest
  view: PlayerView
  baselineDecision: Decision
}

function fixtureSnapshot(
  timeline: DecisionReplayTimeline,
  spec: FixtureSpec,
): DecisionSnapshot | undefined {
  return timeline.snapshots.find((snapshot) =>
    snapshot.kind === spec.kind
    && snapshot.role === spec.role
    && snapshot.req.round === spec.round
    && snapshot.req.proposalNum === spec.proposalNum)
}

async function playFixtureSource(c: ArchitectureBankCase): Promise<GameArtifact> {
  const game = createGame({
    id: `decision-fixtures-${c.id}`,
    seed: c.seed,
    playerCount: c.playerCount,
    roles: [...c.roles],
    talk: FIXTURE_TALK,
  })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      createAgent({ type: 'heuristic' }, { seed: c.seed, seat: player.seat }),
    ]),
  )
  const result = await runGame({ game, agents })
  return toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
  })
}

export async function buildDecisionFixtures(): Promise<FrozenDecisionFixture[]> {
  const neededCases = new Set(FIXTURE_SPECS.map((spec) => spec.caseId))
  const artifacts = new Map<string, GameArtifact>()
  const timelines = new Map<string, DecisionReplayTimeline>()
  for (const c of ARCHITECTURE_BANK) {
    if (!neededCases.has(c.id)) continue
    const artifact = await playFixtureSource(c)
    artifacts.set(c.id, artifact)
    timelines.set(c.id, decisionReplayTimeline(artifact))
  }

  return FIXTURE_SPECS.map((spec) => {
    const artifact = artifacts.get(spec.caseId)
    const timeline = timelines.get(spec.caseId)
    if (!artifact) throw new Error(`fixture ${spec.id}: unknown architecture case ${spec.caseId}`)
    if (!timeline) throw new Error(`fixture ${spec.id}: missing replay timeline`)
    const snapshot = fixtureSnapshot(timeline, spec)
    if (!snapshot) {
      throw new Error(
        `fixture ${spec.id}: no ${spec.role} ${spec.kind} at Q${spec.round}.${spec.proposalNum}`,
      )
    }
    const fixture: FrozenDecisionFixture = {
      schema: DECISION_FIXTURE_SCHEMA,
      id: spec.id,
      source: {
        bank: ARCHITECTURE_BANK_ID,
        caseId: spec.caseId,
        seed: artifact.seed,
        seq: snapshot.seq,
      },
      req: snapshot.req,
      view: snapshot.view,
      baselineDecision: snapshot.original,
    }
    // Match the serialized contract consumed by future tests: omit undefined
    // values exactly as the JSON file does.
    return JSON.parse(JSON.stringify(fixture)) as FrozenDecisionFixture
  })
}

export function readDecisionFixtures(
  file = DEFAULT_DECISION_FIXTURE_FILE,
): FrozenDecisionFixture[] {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FrozenDecisionFixture[]
}

export function fixtureTextMatches(current: string, expected: string): boolean {
  const normalizeLineEndings = (text: string) => text.replaceAll('\r\n', '\n')
  return normalizeLineEndings(current) === normalizeLineEndings(expected)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      write: { type: 'string', default: DEFAULT_DECISION_FIXTURE_FILE },
      check: { type: 'boolean', default: false },
    },
  })
  const generated = await buildDecisionFixtures()
  const text = `${JSON.stringify(generated, null, 2)}\n`
  if (values.check) {
    const current = fs.readFileSync(values.write, 'utf8')
    if (!fixtureTextMatches(current, text)) {
      throw new Error(`${values.write} is stale; regenerate without --check`)
    }
    console.log(`${values.write}: ${generated.length} fixtures current`)
    return
  }
  fs.mkdirSync(path.dirname(path.resolve(values.write)), { recursive: true })
  fs.writeFileSync(values.write, text)
  console.log(`${values.write}: wrote ${generated.length} fixtures`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
