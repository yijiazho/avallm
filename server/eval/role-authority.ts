// Migration phase 7F2B; see docs/agent-architecture-migration.md.

import { createHash } from 'node:crypto'
import { admitDecisionTrace } from '../agents/admission/composed-trace.ts'
import { createComposedAgent } from '../agents/composed.ts'
import {
  ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
  MORDRED_BLINDNESS_COMPONENT,
} from '../agents/components/native-role-components.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
} from '../agents/components/native-score-components.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../agents/components/robust-evil-quest-card.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../agents/components/resolved-brain.ts'
import { heuristicDecide } from '../agents/heuristic.ts'
import {
  FULL_ROLE_STACK_ATTRIBUTION_REASON,
  assassinMerlinTargetScorer,
  evilRoleObjectiveScorer,
  fullRolePolicyScorer,
  morganaRoleScorer,
  mordredBlindnessRoleScorer,
  roleObjectiveScorer,
  type CandidateScorer,
} from '../agents/policy/score.ts'
import type { AgentDecision } from '../agents/types.ts'
import { readDecisionFixtures } from './decision-fixtures.ts'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../engine/game.ts'
import { viewFor } from '../engine/view.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Role,
} from '../engine/types.ts'

export const PHASE7_ROLE_AUTHORITY_VERSION = 'phase7-role-authority-v1'

export type Phase7AuthorityFamily =
  | 'good-role'
  | 'shared-evil-oberon'
  | 'morgana'
  | 'mordred'
  | 'assassin'
  | 'robust-d3'

export interface Phase7RoleAuthorityRow {
  readonly schema: 1
  readonly version: typeof PHASE7_ROLE_AUTHORITY_VERSION
  readonly family: Phase7AuthorityFamily
  readonly caseId: string
  readonly targetRole: Role
  readonly requestKind: DecisionRequest['kind']
  readonly componentId: string
  readonly componentVersion: string
  readonly causalStages: readonly string[]
  readonly trustedAdmission: 'trusted-exact'
  readonly actionDigest: string
  readonly referenceActionDigest: string
  readonly mechanicsEquivalent: boolean
  readonly fullRoleTerminal: boolean
}

interface Fixture {
  readonly caseId: string
  readonly seed: string
  readonly req: DecisionRequest
  readonly view: PlayerView
}

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

function proposal(
  caseId: string,
  role: Role,
  roles: readonly Role[],
): Fixture {
  for (let attempt = 0; attempt < 200; attempt++) {
    const game = createGame({
      seed: `phase7-authority-${caseId}-${attempt}`,
      playerCount: roles.length,
      roles: [...roles],
    })
    const actor = game.players.find((player) => player.role === role)!
    if (actor.seat !== game.leaderSeat) continue
    return {
      caseId,
      seed: game.seed,
      req: {
        kind: 'propose',
        seat: actor.seat,
        round: game.round,
        proposalNum: game.proposalNum,
      },
      view: viewFor(game, actor.seat),
    }
  }
  throw new Error(`${caseId}: could not construct proposal fixture`)
}

function assassination(): Fixture {
  const game = createGame({
    seed: 'phase7-authority-assassin',
    playerCount: 5,
    roles: ['merlin', 'servant', 'servant', 'assassin', 'mordred'],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  while (game.phase !== 'assassination') {
    const req = expectedDecisions(game)[0]
    const view = viewFor(game, req.seat)
    applyDecision(
      game,
      req.seat,
      req.kind === 'quest'
        ? { kind: 'quest', card: 'success' }
        : heuristicDecide(req, view, game.seed),
    )
  }
  const req = expectedDecisions(game)[0]
  return {
    caseId: 'assassin-target',
    seed: game.seed,
    req,
    view: viewFor(game, req.seat),
  }
}

function robustD3(): Fixture {
  const source = readDecisionFixtures()
    .find((fixture) => fixture.id === 'oberon-two-fail-quest')
  if (!source) throw new Error('missing robust D3 decision fixture')
  const view = structuredClone(source.view)
  view.seat = 4
  view.name = view.players[4].name
  view.role = 'assassin'
  view.alignment = 'evil'
  view.privateInfo = { kind: 'evil', evilPartners: [5] }
  view.quests[1] = {
    ...view.quests[1],
    failCount: 1,
    result: 'fail',
  }
  view.quests[2] = {
    ...view.quests[2],
    failCount: undefined,
    result: undefined,
  }
  return {
    caseId: 'robust-d3',
    seed: 'phase7-authority-robust-d3',
    req: {
      kind: 'quest',
      seat: view.seat,
      round: view.round,
      proposalNum: view.proposalNum,
    },
    view,
  }
}

function mechanicalRows(trace: NonNullable<AgentDecision['trace']>): unknown {
  return trace.candidateScores?.map((row) => ({
    candidateId: row.candidateId,
    value: row.value,
    viable: row.viable,
    reasonCodes: row.reasonCodes.filter(
      (reason) => reason !== FULL_ROLE_STACK_ATTRIBUTION_REASON,
    ),
  }))
}

async function authorityRow(input: {
  family: Phase7AuthorityFamily
  fixture: Fixture
  referenceScorer: CandidateScorer
  component: Readonly<{ id: string; version: string }>
  robust?: boolean
}): Promise<Phase7RoleAuthorityRow> {
  const options = {
    seed: input.fixture.seed,
    roleObjectiveRouter: true,
    ...(input.robust
      ? { evilQuestCardPolicy: 'robust-heterogeneous' as const }
      : {}),
  }
  const reference = await createComposedAgent({
    ...options,
    scorer: input.referenceScorer,
  }).decide(input.fixture.req, input.fixture.view)
  const agent = createComposedAgent({
    ...options,
    scorer: fullRolePolicyScorer,
  })
  const full = await agent.decide(input.fixture.req, input.fixture.view)
  const admission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: full.trace!,
    req: input.fixture.req,
    view: input.fixture.view,
    authoritativeAction: full.decision,
    selectedDecision: full.decision,
    deterministicSeed: input.fixture.seed,
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  })
  if (admission.kind !== 'trusted-exact') {
    throw new Error(`${input.family}: expected exact trace admission`)
  }
  const use = full.trace!.components!.policyUse.find(
    (entry) => entry.component.id === input.component.id,
  )
  if (
    !use?.used
    || use.component.version !== input.component.version
    || !use.stages.length
  ) {
    throw new Error(`${input.family}: expected causal component use`)
  }
  const mechanicsEquivalent =
    JSON.stringify(full.decision) === JSON.stringify(reference.decision)
    && JSON.stringify(mechanicalRows(full.trace!))
      === JSON.stringify(mechanicalRows(reference.trace!))
  if (!mechanicsEquivalent) {
    throw new Error(`${input.family}: full and reference mechanics diverged`)
  }
  return Object.freeze({
    schema: 1,
    version: PHASE7_ROLE_AUTHORITY_VERSION,
    family: input.family,
    caseId: input.fixture.caseId,
    targetRole: input.fixture.view.role,
    requestKind: input.fixture.req.kind,
    componentId: use.component.id,
    componentVersion: use.component.version,
    causalStages: Object.freeze([...use.stages]),
    trustedAdmission: admission.kind,
    actionDigest: digest(full.decision satisfies Decision),
    referenceActionDigest: digest(reference.decision),
    mechanicsEquivalent,
    fullRoleTerminal:
      full.trace!.componentVersions?.scorer === fullRolePolicyScorer.version,
  })
}

export async function generatePhase7RoleAuthorityEvidence():
Promise<readonly Phase7RoleAuthorityRow[]> {
  const goodCast: Role[] =
    ['merlin', 'percival', 'servant', 'morgana', 'assassin']
  const mordredCast: Role[] =
    ['merlin', 'servant', 'servant', 'assassin', 'mordred']
  return Object.freeze(await Promise.all([
    authorityRow({
      family: 'good-role',
      fixture: proposal('good-role', 'merlin', goodCast),
      referenceScorer: roleObjectiveScorer,
      component: GOOD_ROLE_OBJECTIVE_COMPONENT,
    }),
    authorityRow({
      family: 'shared-evil-oberon',
      fixture: proposal(
        'shared-evil-oberon',
        'oberon',
        [...goodCast, 'servant', 'oberon'],
      ),
      referenceScorer: evilRoleObjectiveScorer,
      component: EVIL_ROLE_OBJECTIVE_COMPONENT,
    }),
    authorityRow({
      family: 'morgana',
      fixture: proposal('morgana', 'morgana', goodCast),
      referenceScorer: morganaRoleScorer,
      component: MORGANA_ROLE_UTILITY_COMPONENT,
    }),
    authorityRow({
      family: 'mordred',
      fixture: proposal('mordred', 'mordred', mordredCast),
      referenceScorer: mordredBlindnessRoleScorer,
      component: MORDRED_BLINDNESS_COMPONENT,
    }),
    authorityRow({
      family: 'assassin',
      fixture: assassination(),
      referenceScorer: assassinMerlinTargetScorer,
      component: ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
    }),
    authorityRow({
      family: 'robust-d3',
      fixture: robustD3(),
      referenceScorer: evilRoleObjectiveScorer,
      component: EVIL_QUEST_CARD_ROBUST_COMPONENT,
      robust: true,
    }),
  ]))
}
