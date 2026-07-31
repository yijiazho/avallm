// The servant score family: the layer that finally ranks the per-candidate
// propose utility.
//
// What makes this family worth testing differently from its siblings is that
// its base is TIED. Over the 60 servant cases of the phase-4 bank, 75 of 76
// servant proposals score every viable candidate at exactly the same value and
// the winner falls out of a lexicographic sort on candidate id. So the two
// claims here are behavioral and narrow: the layer changes the pick, and the
// team it picks reads publicly cleaner than the one the sort produced.
//
// The claim deliberately NOT made is that this cannot regress the objective.
// That argument comes from the model's own scoring, since the candidates being
// reordered are tied as the servant sees them. If the flat proposal score is
// itself the defect, none of this fixes it.

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../server/engine/game.ts'
import { validateRoles } from '../server/engine/rules.ts'
import { viewFor } from '../server/engine/view.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import { createHeuristicAgent } from '../server/agents/heuristic.ts'
import {
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  roleObjectiveScorer,
  seededRoleObjectiveScorer,
  seededServantRoleScorer,
  servantRoleScorer,
} from '../server/agents/policy/score.ts'
import {
  SERVANT_ROLE_SCORER_VERSION,
  SERVANT_ROLE_SEEDED_SCORER_VERSION,
  SERVANT_ROLE_UTILITY_CONSTANTS,
} from '../server/agents/policy/servant-score-contract.ts'
import {
  buildServantRoleUtilityProjection,
} from '../server/agents/analysis/servant-role-utility.ts'
import {
  SERVANT_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import { legalCandidates } from '../server/agents/policy/candidates.ts'
import { assertScoreFamilyConformance } from './support/score-family.ts'

interface ServantFixture {
  readonly seed: string
  readonly view: PlayerView
  readonly req: DecisionRequest & { kind: 'propose' }
}

function proposalFor(view: PlayerView, seed: string): ServantFixture {
  return {
    seed,
    view,
    req: {
      kind: 'propose',
      seat: view.seat,
      round: view.round,
      proposalNum: view.proposalNum,
    },
  }
}

/** A servant in the chair on an opening board, found the way its siblings are. */
function openingServantProposal(): ServantFixture {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const seed = `servant-policy-${attempt}`
    const game = createGame({ seed, playerCount: 7 })
    if (game.players[game.leaderSeat].role !== 'servant') continue
    return proposalFor(viewFor(game, game.leaderSeat), seed)
  }
  throw new Error('no servant reached the chair within the seed budget')
}

/**
 * The same seat after the board has produced evidence, played forward with
 * heuristic agents. Hand-building it would not do: the separation this layer
 * exists for comes from real resolved quests, and an opening board is flat by
 * construction, so a suite built only on fresh deals would stay green if the
 * ranking broke outright.
 */
async function lateServantProposal(): Promise<ServantFixture> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const seed = `servant-policy-late-${attempt}`
    const game = createGame({ seed, playerCount: 7 })
    const agents = game.players.map((player) =>
      createHeuristicAgent({ seed: 'h', seat: player.seat }))
    for (let step = 0; step < 400; step++) {
      const pending = expectedDecisions(game)
      if (pending.length === 0) break
      for (const req of pending) {
        const view = viewFor(game, req.seat)
        if (
          req.kind === 'propose'
          && view.role === 'servant'
          && view.round >= 3
        ) return proposalFor(view, seed)
        applyDecision(
          game,
          req.seat,
          (await agents[req.seat].decide(req, view)).decision,
        )
      }
    }
  }
  throw new Error('no late servant proposal was reachable')
}

/** A servant proposal in a legal cast that seats no Merlin at all. */
function merlinlessServantProposal(): ServantFixture {
  const roles: Role[] = ['servant', 'servant', 'servant', 'minion', 'oberon']
  assert.doesNotThrow(() => validateRoles(roles.length, [...roles]))
  for (let attempt = 0; attempt < 300; attempt++) {
    const seed = `servant-policy-no-merlin-${attempt}`
    const game = createGame({
      seed,
      playerCount: roles.length,
      roles: [...roles],
    })
    if (game.players[game.leaderSeat].role !== 'servant') continue
    const view = viewFor(game, game.leaderSeat)
    if (view.phase !== 'proposal') continue
    return proposalFor(view, seed)
  }
  throw new Error('no Merlin-less servant proposal was reachable')
}

const opening = openingServantProposal()
const merlinless = merlinlessServantProposal()

const roleValues = (fixture: ServantFixture): ReadonlyMap<string, number> =>
  new Map(buildServantRoleUtilityProjection({
    view: fixture.view,
    candidates: legalCandidates(fixture.req, fixture.view),
  }).assessments.map((entry) => [entry.candidateId, entry.roleValue]))

assertScoreFamilyConformance({
  family: 'servant',
  seed: opening.seed,
  deterministic: {
    scorer: servantRoleScorer,
    version: SERVANT_ROLE_SCORER_VERSION,
    components: [SERVANT_ROLE_UTILITY_COMPONENT],
    predecessor: {
      scorer: roleObjectiveScorer,
      version: ROLE_OBJECTIVE_SCORER_VERSION,
    },
  },
  seeded: {
    scorer: seededServantRoleScorer,
    version: SERVANT_ROLE_SEEDED_SCORER_VERSION,
    components: [SERVANT_ROLE_UTILITY_COMPONENT],
    predecessor: {
      scorer: seededRoleObjectiveScorer,
      version: ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    },
  },
  eligible: [
    { label: 'servant proposal', req: opening.req, view: opening.view },
  ],
  delegating: [
    {
      // Servant VOTES already separate under the joint probability, so the
      // claim stops at propose and the good base stays authoritative here.
      label: 'servant vote',
      req: {
        kind: 'vote',
        seat: opening.view.seat,
        round: opening.view.round,
        proposalNum: opening.view.proposalNum,
      },
      view: {
        ...structuredClone(opening.view),
        phase: 'vote',
        currentTeam: [...opening.view.players]
          .slice(0, opening.view.quests[opening.view.round - 1].teamSize)
          .map((player) => player.seat),
      },
      resolvedVersions: {
        [SERVANT_ROLE_SCORER_VERSION]: GOOD_PROPOSAL_VOTE_SCORER_VERSION,
        [SERVANT_ROLE_SEEDED_SCORER_VERSION]:
          GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
      },
    },
    {
      // The condition no claim carries. validateRoles accepts a cast with no
      // Merlin, the shared read has no Merlin-likeness axis there, and the
      // layer has to decline for the same reason its component does.
      label: 'Merlin-less servant proposal',
      req: merlinless.req,
      view: merlinless.view,
      resolvedVersions: {
        [SERVANT_ROLE_SCORER_VERSION]: GOOD_PROPOSAL_VOTE_SCORER_VERSION,
        [SERVANT_ROLE_SEEDED_SCORER_VERSION]:
          GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
      },
    },
  ],
})

// The whole point, on a board that has produced evidence. Both halves matter:
// a layer that moved the pick to a WORSE-reading team would satisfy the first
// assertion alone.
test('a board with evidence moves the pick to a cleaner-reading team', async () => {
  const late = await lateServantProposal()
  const values = roleValues(late)
  const base = await createComposedAgent({
    seed: late.seed,
    scorer: roleObjectiveScorer,
  }).decide(late.req, late.view)
  const refined = await createComposedAgent({
    seed: late.seed,
    scorer: servantRoleScorer,
  }).decide(late.req, late.view)

  const baseId = base.trace!.structuredCandidateId!
  const refinedId = refined.trace!.structuredCandidateId!
  assert.notEqual(
    refinedId,
    baseId,
    `round ${late.view.round} left the pick unchanged; the layer is inert`,
  )
  assert.ok(
    values.get(refinedId)! > values.get(baseId)!,
    'the layer moved the pick to a team that reads no cleaner',
  )
  // And it moved it to the BEST-reading survivor, not merely a better one:
  // the base is tied, so the centered adjustment is the whole ordering.
  const viable = refined.trace!.candidateScores!
    .filter((score) => score.viable)
    .map((score) => score.candidateId)
  assert.deepEqual(viable, [refinedId])
  assert.equal(values.get(refinedId), Math.max(...values.values()))

  const chosen = refined.trace!.candidateScores!.find(
    (score) => score.candidateId === refinedId,
  )!
  assert.ok(
    chosen.reasonCodes.includes('SERVANT_ROLE_PUBLIC_READ_SEPARATED'),
    'a board that separated must say so',
  )
  assert.ok(chosen.reasonCodes.includes('SERVANT_ROLE_PUBLIC_READ_SELECTED'))
})

// The honest half, and the reason separationBand exists. On an opening board
// nobody has done anything, every team averages the same, and the layer has
// nothing to add. It still has to say which case it is in, because a reader of
// one trace cannot otherwise tell a decisive ranking from float residue.
test('an opening board reports its own flatness and keeps the base pick', async () => {
  const values = [...roleValues(opening).values()]
  assert.ok(
    Math.max(...values) - Math.min(...values)
      <= SERVANT_ROLE_UTILITY_CONSTANTS.separationBand,
    'this fixture is meant to be flat; pick another seed',
  )
  const base = await createComposedAgent({
    seed: opening.seed,
    scorer: roleObjectiveScorer,
  }).decide(opening.req, opening.view)
  const refined = await createComposedAgent({
    seed: opening.seed,
    scorer: servantRoleScorer,
  }).decide(opening.req, opening.view)

  assert.deepEqual(refined.decision, base.decision)
  const chosen = refined.trace!.candidateScores!.find(
    (score) => score.candidateId === refined.trace!.structuredCandidateId,
  )!
  assert.ok(chosen.reasonCodes.includes('SERVANT_ROLE_PUBLIC_READ_FLAT'))
  assert.ok(
    !chosen.reasonCodes.includes('GOOD_PROPOSAL_CANONICAL_TIE_BREAK'),
    'the base tie-break stops speaking for a pick this layer now owns',
  )
})

// The magnitude claim, asserted rather than argued. The adjustment is a
// tie-breaker: it decides a base gap of 0.0000 and cannot overturn a wider one.
test('the centered adjustment is bounded by the scale it declares', async () => {
  const late = await lateServantProposal()
  const values = roleValues(late)
  const base = await createComposedAgent({
    seed: late.seed,
    scorer: roleObjectiveScorer,
  }).decide(late.req, late.view)
  const refined = await createComposedAgent({
    seed: late.seed,
    scorer: servantRoleScorer,
  }).decide(late.req, late.view)

  const baseById = new Map(
    base.trace!.candidateScores!.map((score) => [score.candidateId, score]),
  )
  const survivors = refined.trace!.candidateScores!.filter((score) =>
    baseById.get(score.candidateId)!.value > -1)
  assert.ok(survivors.length > 1, 'a single survivor proves nothing here')
  const mean = survivors.reduce(
    (sum, score) => sum + values.get(score.candidateId)!,
    0,
  ) / survivors.length
  for (const score of survivors) {
    assert.ok(
      Math.abs(
        score.value - baseById.get(score.candidateId)!.value
        - SERVANT_ROLE_UTILITY_CONSTANTS.centeredAdjustmentScale
          * (values.get(score.candidateId)! - mean),
      ) < 1e-12,
      'the layer added something other than its declared centered adjustment',
    )
  }
})
