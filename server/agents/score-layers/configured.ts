import type { DecisionKind } from '../../engine/types.ts'
import type { CandidateScorer } from '../policy/score.ts'
import type {
  ScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import {
  createScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import type {
  ScoreLayerFamilyDeclaration,
  ScoreLayerLaneDeclaration,
} from '../policy/score-layer/families.ts'
import {
  resolveScoreLayerFamilyTree,
} from '../policy/score-layer/families.ts'
import type { ScoreLayerToken } from '../policy/score-layer/types.ts'
import type { ResolvedScoreLayerChain } from '../policy/score-layer/types.ts'
import {
  COMPATIBILITY_SCORE_LAYER,
  GOOD_PROPOSAL_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
  goodScoreLayerDefinitions,
  goodScoreLayerTerminalFor,
  goodScoreLayersApplyToDecision,
  calculateDeterministicGoodBase,
} from './good.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
  evilScoreLayerDefinitions,
  evilScoreLayerTerminalFor,
} from './evil.ts'
import {
  MORGANA_ROLE_SCORE_LAYER,
  SEEDED_MORGANA_ROLE_SCORE_LAYER,
  morganaScoreLayerDefinitions,
  morganaScoreLayerTerminalFor,
} from './morgana.ts'
import {
  MORDRED_ROLE_SCORE_LAYER,
  SEEDED_MORDRED_ROLE_SCORE_LAYER,
  mordredScoreLayerDefinitions,
  mordredScoreLayerTerminalFor,
} from './mordred.ts'
import {
  ASSASSIN_MERLIN_TARGET_SCORE_LAYER,
  assassinScoreLayerDefinitions,
  assassinScoreLayerTerminalFor,
} from './assassin.ts'
import {
  FULL_ROLE_POLICY_SCORE_LAYER,
  fullRoleScoreLayerDefinitions,
  fullRoleScoreLayerTerminalFor,
} from './full-role.ts'

/**
 * The deliberately small composition seam for concrete score families.
 *
 * Everything a family contributes is declared once in SCORE_FAMILY_TREE below:
 * its semantic base, its lane tips, the scorer identities it owns, and how it
 * registers its layers. Family selection, equality adapters, and the derived
 * linear resolution order stay here; generic policy and composition code must
 * not learn concrete family identities.
 */

/**
 * Deterministic layers compose into one stack; seeded layers are ablations.
 *
 * Only the deterministic lane has a composition terminal, which is what makes
 * it resolve predecessors along the chain rather than off each family's base,
 * so the two lanes cannot be read off one shared ordering.
 */
const DETERMINISTIC_LANE = 'deterministic'
const SEEDED_LANE = 'seeded'

type ConfiguredScoreLane =
  | typeof DETERMINISTIC_LANE
  | typeof SEEDED_LANE

const SCORE_FAMILY_LANES:
readonly ScoreLayerLaneDeclaration<ConfiguredScoreLane>[] = Object.freeze([
  Object.freeze({
    id: DETERMINISTIC_LANE,
    rationale:
      'The live stack. Every deterministic score family joins it, and the '
      + 'full-role terminal at the end is what the composed policy resolves.',
  }),
  Object.freeze({
    id: SEEDED_LANE,
    rationale:
      'Seeded scorers, which are ablations selected one at a time rather than '
      + 'a stack anything resolves as a whole.',
  }),
])

/**
 * One concrete family: what the generic tree needs, plus the scorer identities
 * this seam owns on the family's behalf.
 */
interface ConfiguredScoreFamily
extends ScoreLayerFamilyDeclaration<ConfiguredScoreLane> {
  /** Every scorer version selectable as a terminal for this family. */
  readonly terminals: readonly ScoreLayerToken[]
  /** Exact built-in identity mapping owned by the family module. */
  terminalFor(scorer: CandidateScorer | undefined): ScoreLayerToken | undefined
}

/**
 * The score families as they actually relate to each other.
 *
 * Declaration order is the linearization the registry needs. Each family's
 * `base` is its truthful fallback, which in the composed lane is often not the
 * same thing as its predecessor; `resolveScoreLayerFamilyTree` derives the
 * predecessors and rejects a declaration whose base comes after it.
 */
const SCORE_FAMILY_TREE: readonly ConfiguredScoreFamily[] = Object.freeze([
  {
    id: 'good',
    kind: 'root',
    base: null,
    baseRationale:
      'Good policy owns the compatibility root and the shared proposal and '
      + 'vote base that every other family refines, so nothing sits beneath '
      + 'it.',
    lanes: {
      [DETERMINISTIC_LANE]: GOOD_ROLE_SCORE_LAYER,
      [SEEDED_LANE]: SEEDED_GOOD_ROLE_SCORE_LAYER,
    },
    terminals: [
      COMPATIBILITY_SCORE_LAYER,
      GOOD_PROPOSAL_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER,
      GOOD_ROLE_SCORE_LAYER,
      SEEDED_GOOD_ROLE_SCORE_LAYER,
    ],
    terminalFor: goodScoreLayerTerminalFor,
    register: () => goodScoreLayerDefinitions(),
  },
  {
    id: 'evil',
    kind: 'specialization',
    base: 'good',
    baseRationale:
      'The shared evil and Oberon objective ranks the same candidates from '
      + 'the opposite side and claims no evidence of its own beyond the role '
      + 'utility projection, so a seat that loses that projection degrades to '
      + 'the good base rather than to any evil specialization.',
    lanes: {
      [DETERMINISTIC_LANE]: EVIL_ROLE_SCORE_LAYER,
      [SEEDED_LANE]: SEEDED_EVIL_ROLE_SCORE_LAYER,
    },
    terminals: [EVIL_ROLE_SCORE_LAYER, SEEDED_EVIL_ROLE_SCORE_LAYER],
    terminalFor: evilScoreLayerTerminalFor,
    register: (predecessor) => evilScoreLayerDefinitions({
      deterministic: predecessor(DETERMINISTIC_LANE),
      seeded: predecessor(SEEDED_LANE),
    }),
  },
  {
    id: 'morgana',
    kind: 'specialization',
    base: 'evil',
    baseRationale:
      'Morgana counterfeits Merlin only inside the band the shared evil '
      + 'objective already judged viable, so evil competence is the behavior '
      + 'that survives when the counterfeit projection is missing.',
    lanes: {
      [DETERMINISTIC_LANE]: MORGANA_ROLE_SCORE_LAYER,
      [SEEDED_LANE]: SEEDED_MORGANA_ROLE_SCORE_LAYER,
    },
    terminals: [MORGANA_ROLE_SCORE_LAYER, SEEDED_MORGANA_ROLE_SCORE_LAYER],
    terminalFor: morganaScoreLayerTerminalFor,
    register: (predecessor) => morganaScoreLayerDefinitions({
      deterministic: predecessor(DETERMINISTIC_LANE),
      seeded: predecessor(SEEDED_LANE),
    }),
  },
  {
    id: 'mordred',
    kind: 'specialization',
    base: 'evil',
    baseRationale:
      'Mordred is a sibling of Morgana, not a refinement of it: it exploits '
      + "Merlin's blindness inside the same shared evil band and has no "
      + 'business falling back through a counterfeit-Merlin ranking. Its base '
      + 'is evil in both lanes. In the composed lane the derived predecessor '
      + 'is nonetheless Morgana, because the full-role terminal has to '
      + 'traverse both siblings and their applicability predicates are '
      + 'mutually exclusive, so a Mordred seat finds Morgana inapplicable and '
      + 'reaches this family on the untouched evil surface.',
    lanes: {
      [DETERMINISTIC_LANE]: MORDRED_ROLE_SCORE_LAYER,
      [SEEDED_LANE]: SEEDED_MORDRED_ROLE_SCORE_LAYER,
    },
    terminals: [MORDRED_ROLE_SCORE_LAYER, SEEDED_MORDRED_ROLE_SCORE_LAYER],
    terminalFor: mordredScoreLayerTerminalFor,
    register: (predecessor) => mordredScoreLayerDefinitions({
      deterministic: predecessor(DETERMINISTIC_LANE),
      seeded: predecessor(SEEDED_LANE),
    }),
  },
  {
    id: 'assassin',
    kind: 'specialization',
    base: 'evil',
    baseRationale:
      'The Merlin shot is a third evil sibling. It scores only the '
      + 'assassinate kind, which the Morgana and Mordred layers never claim, '
      + 'so its truthful fallback is the shared evil objective. It registers '
      + 'no seeded variant, so it never enters the isolated lane.',
    lanes: { [DETERMINISTIC_LANE]: ASSASSIN_MERLIN_TARGET_SCORE_LAYER },
    terminals: [ASSASSIN_MERLIN_TARGET_SCORE_LAYER],
    terminalFor: assassinScoreLayerTerminalFor,
    register: (predecessor) =>
      assassinScoreLayerDefinitions(predecessor(DETERMINISTIC_LANE)),
  },
  {
    id: 'full-role',
    kind: 'composition',
    base: null,
    baseRationale:
      'The full-role terminal speaks for the complete composed stack rather '
      + 'than specializing any one family, so its base is the composed lane '
      + 'itself. It keeps values, viability, survivors, and the mechanical '
      + 'choice of whichever specialization applied, and attributes '
      + 'diagnostics to that predecessor. Joining the deterministic lane is '
      + 'what puts it in composed mode, so this family owes the precondition '
      + 'that makes traversing siblings sound: the role specializations have '
      + 'mutually exclusive applicability predicates, so a seat that reaches '
      + 'an intervening sibling finds it inapplicable and the prior surface '
      + 'passes through untouched.',
    lanes: { [DETERMINISTIC_LANE]: FULL_ROLE_POLICY_SCORE_LAYER },
    terminals: [FULL_ROLE_POLICY_SCORE_LAYER],
    terminalFor: fullRoleScoreLayerTerminalFor,
    register: (predecessor) =>
      fullRoleScoreLayerDefinitions(predecessor(DETERMINISTIC_LANE)),
  },
])

export function configuredScoreLayerTerminalFor(
  scorer: CandidateScorer | undefined,
): ScoreLayerToken | undefined {
  for (const family of SCORE_FAMILY_TREE) {
    const terminal = family.terminalFor(scorer)
    if (terminal) return terminal
  }
  return undefined
}

/**
 * Custom sources always carry a canonical native failure path. The first
 * ancestor scorer in their base chain that maps to a configured terminal
 * wins; otherwise the total compatibility root is the fallback.
 */
export function configuredNativeFallbackTerminalFor(
  scorer: CandidateScorer | undefined,
): ScoreLayerToken {
  const seen = new Set<CandidateScorer>()
  let current = scorer?.baseScorer
  while (current && !seen.has(current)) {
    seen.add(current)
    const terminal = configuredScoreLayerTerminalFor(current)
    if (terminal) return terminal
    current = current.baseScorer
  }
  return COMPATIBILITY_SCORE_LAYER
}

const CONFIGURED_TERMINAL_BY_VERSION: ReadonlyMap<string, ScoreLayerToken> =
  (() => {
    const byVersion = new Map<string, ScoreLayerToken>()
    for (const family of SCORE_FAMILY_TREE) {
      for (const token of family.terminals) {
        if (byVersion.has(token.version)) {
          throw new Error(`duplicate configured scorer ${token.version}`)
        }
        byVersion.set(token.version, token)
      }
    }
    return byVersion
  })()

export function configuredScoreLayerTerminalForVersion(
  version: string,
): ScoreLayerToken {
  const terminal = CONFIGURED_TERMINAL_BY_VERSION.get(version)
  if (!terminal) throw new Error(`unsupported configured scorer ${version}`)
  return terminal
}

export function configuredScoreLayerChainForVersion(
  version: string,
): ResolvedScoreLayerChain {
  return createConfiguredScoreLayerRegistry().resolve({
    terminal: configuredScoreLayerTerminalForVersion(version),
  })
}

/**
 * Re-exported through the seam so callers depend on the configured facade
 * rather than importing the good family directly.
 */
export const calculateConfiguredDeterministicGoodBase =
  calculateDeterministicGoodBase

export function configuredScoreLayersApplyToDecision(
  kind: DecisionKind,
): boolean {
  return goodScoreLayersApplyToDecision(kind)
}

export function createConfiguredScoreLayerRegistry(): ScoreLayerRegistry {
  const registry = createScoreLayerRegistry(resolveScoreLayerFamilyTree({
    lanes: SCORE_FAMILY_LANES,
    families: SCORE_FAMILY_TREE,
  }).definitions)
  // A declared terminal that no family actually registers would resolve to a
  // token here and only fail later inside registry.resolve, during admission
  // replay or a live decision. Reject it while the registry is being built.
  for (const terminal of CONFIGURED_TERMINAL_BY_VERSION.values()) {
    if (!registry.definition(terminal)) {
      throw new Error(
        `configured scorer ${terminal.version} names an unregistered layer`,
      )
    }
  }
  return registry
}

/**
 * The derived predecessor for every family and lane. Exported so the seam's
 * declaration can be asserted directly instead of only through resolved
 * chains.
 */
export function configuredScoreFamilyWiring() {
  return resolveScoreLayerFamilyTree({
    lanes: SCORE_FAMILY_LANES,
    families: SCORE_FAMILY_TREE,
  }).wiring
}
