// Which soft factors actually run, and by what mechanism.
//
// `belief/` holds four factor modules that look like peers and are not. One
// runs in shipped games; three do not, and nothing in their own source said so.
// Seating used to be a line inside `composedBrainOptions` (registry.ts), one
// switch statement in a different directory, so "is this factor on?" was
// answerable only by grepping for a symbol and reasoning about the absence of a
// hit. Absence is exactly what a reader cannot see.
//
// Three further things make the question harder than it looks:
//
//   - "Off" has three different shapes. A mechanical factor is off by having no
//     preset entry; the language factor is off because no shipped agent injects
//     a `languageInterpreter`; and any of them can go off at runtime through its
//     own degradation path.
//   - A factor IS a belief model, not a term inside one. `beliefModel:`
//     replaces the whole posterior computation, so at most one mechanical
//     factor can be on. Four files side by side in one directory read as a
//     bundle when they are mutually exclusive alternatives.
//   - An unseated factor is fully built, exported, and tested. `vote-matrix`
//     and `proposal` both export a ready belief model and are wired into
//     host-reconstructible admission. Nothing distinguishes them from the
//     seated one at the file level.
//
// So this table states the answer. It does not merely describe the answer: the
// registry obtains its belief model from `beliefModelFor` below, so seating a
// factor in a SHIPPED agent means adding it here, and a table that disagrees
// with what a real game runs is not a state the code can reach. A pure
// description would have been the weaker half of the fix, since nothing about
// editing one switch line reminds anyone a separate document exists.
//
// Scope, stated precisely, because the guarantee is narrower than "nothing can
// run a factor without this table": it covers `createAgent`, which is the only
// path a web, sim or terminal game constructs an agent through. Evaluation
// harnesses (`server/eval/runs/*-bench.ts`) pass a `beliefModel` straight to
// `createComposedAgent` and deliberately bypass this. That is correct rather
// than a hole. An eval arm exists to run a model no preset seats, so requiring
// it to come from here would mean a hypothesis could not be measured until it
// was already promoted, which is backwards.
//
// The test then covers what the type system cannot: that the tree holds no
// factor module this table never named. Same shape as ARCHITECTURE_SCOPE_LISTS
// and SHARED_SHAPE_GUARD_NAMES, which derive truth from the tree for scope
// lists and shared helpers, and for the same reason: a hand-maintained list
// fails silently.
//
// This module holds no game logic and deliberately does NOT import registry.ts.
// belief/ is tier 2 and registry.ts sits outside the tier order, so the arrow
// points one way: the registry reads this table, never the reverse.

import type { BeliefModel } from './types.ts'
import {
  PROPOSAL_BUNDLE_VERSION,
  PROPOSAL_FACTOR_VERSION,
} from './proposal-factor.ts'
import {
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
} from './language-factor.ts'
import {
  QUEST_CARD_FACTOR_VERSION,
  QUEST_FACTOR_BUNDLE_VERSION,
  questWeightedBeliefModel,
} from './quest-card-factor.ts'
import {
  VOTE_MATRIX_BUNDLE_VERSION,
  VOTE_MATRIX_FACTOR_VERSION,
} from './vote-matrix-factor.ts'

/**
 * Module basename of every factor, without extension. The test derives the
 * same set from `belief/*-factor.ts` on disk, so a new factor file that does
 * not appear here reddens rather than defaulting to an unstated status.
 */
export type BeliefFactorModule =
  | 'quest-card-factor'
  | 'language-factor'
  | 'vote-matrix-factor'
  | 'proposal-factor'

/**
 * How a factor reaches a real game, as a union rather than a boolean, because
 * the three mechanisms fail and get switched off in different ways. A boolean
 * would flatten "no preset names it" together with "no agent injects its
 * dependency" and lose the only detail that tells you what to change.
 */
export type BeliefFactorSeating =
  /**
   * Live. `model` is the belief model these presets run, and `beliefModelFor`
   * below is how the registry obtains it, so this field is the seating rather
   * than a description of it: a factor cannot reach a game without appearing
   * here, and cannot appear here without stating which presets it is gated on.
   */
  | {
    readonly kind: 'preset'
    readonly presets: readonly string[]
    readonly model: BeliefModel
  }
  /** Built and wired, but reached only when a host injects `option`. */
  | { readonly kind: 'injected'; readonly option: string }
  /** Runs in evaluation and tests only. `why` is the standing reason. */
  | { readonly kind: 'unseated'; readonly why: string }

export interface BeliefFactorEntry {
  /** The factor's own version constant, as exported by its module. */
  readonly factorVersion: string
  /** The bundle version a `BeliefModel` reports as `factorsVersion`. */
  readonly bundleVersion: string
  readonly seating: BeliefFactorSeating
}

/**
 * `satisfies Record<BeliefFactorModule, ...>` is total on purpose: adding a
 * member to the union without an entry here fails to compile. The test covers
 * the other direction, where a file exists that the union never named.
 */
export const BELIEF_FACTORS = {
  'quest-card-factor': {
    factorVersion: QUEST_CARD_FACTOR_VERSION,
    bundleVersion: QUEST_FACTOR_BUNDLE_VERSION,
    // BELIEF-002. The only live factor in the repository. Hard feasibility
    // still decides which worlds exist; this reweights inside that set under a
    // capped log-likelihood, so a SUCCESSFUL quest finally means something. The
    // constraints-only belief learns nothing from one, because evil may always
    // choose to play success, and that blindness was measurable: on the wide
    // bank's servant cell it cost 10.5 points of clean proposals against
    // heuristic opponents and 4.4 against random, with dirty-team approval 10
    // points worse in both.
    //
    // `good-base` deliberately does NOT get it. A preset matches a measured arm
    // exactly, and only full-role was gated.
    seating: {
      kind: 'preset',
      presets: ['full-role'],
      model: questWeightedBeliefModel,
    },
  },
  'language-factor': {
    factorVersion: LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
    bundleVersion: LANGUAGE_FACTOR_BUNDLE_VERSION,
    // Layers over a mechanical base rather than replacing it, so it is the one
    // factor that could run beside another. It still does not: no shipped
    // agent injects an interpreter, so it is dark outside eval and tests.
    seating: { kind: 'injected', option: 'languageInterpreter' },
  },
  'vote-matrix-factor': {
    factorVersion: VOTE_MATRIX_FACTOR_VERSION,
    bundleVersion: VOTE_MATRIX_BUNDLE_VERSION,
    seating: {
      kind: 'unseated',
      why:
        'BELIEF-001. v1 and v2 have opposite sensitivities and the verdict is a '
        + 'property of the opponent, not the game. A bot-versus-bot corpus '
        + 'cannot settle it in either direction.',
    },
  },
  'proposal-factor': {
    factorVersion: PROPOSAL_FACTOR_VERSION,
    bundleVersion: PROPOSAL_BUNDLE_VERSION,
    seating: {
      kind: 'unseated',
      why:
        'BELIEF-001. Measured null on the random corpus, and the heuristic gain '
        + 'is circular: decidePropose implements the same camouflage rule the '
        + 'model prices, from the same brief sections.',
    },
  },
} as const satisfies Record<BeliefFactorModule, BeliefFactorEntry>

/**
 * The mechanical belief model a preset seats, or `undefined` for the exact
 * constraints-only posterior. `composedBrainOptions` calls this instead of
 * naming a model itself, which is what keeps the table honest: seating a
 * factor means adding it here, so the table cannot describe a world the
 * registry disagrees with.
 *
 * At most one model comes back, and that is the domain talking rather than a
 * limitation of this lookup. A factor IS a belief model, so two mechanical
 * factors cannot both be seated until a model exists that applies both sets of
 * log-weights before normalizing. That model would be a new entry here, not a
 * second return value.
 */
export function beliefModelFor(preset: string): BeliefModel | undefined {
  for (const entry of Object.values(BELIEF_FACTORS)) {
    if (entry.seating.kind !== 'preset') continue
    // Widened from the `as const` literal tuple: an unknown preset must return
    // undefined here, not fail to compile at the comparison.
    const presets: readonly string[] = entry.seating.presets
    if (presets.includes(preset)) return entry.seating.model
  }
  return undefined
}
