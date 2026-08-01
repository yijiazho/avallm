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
  /**
   * What decided the CURRENT seating, and on which population. Required for
   * every factor including the seated one, because "why is this on" decays
   * exactly as fast as "why is this off" and is the harder of the two to
   * reconstruct later.
   */
  readonly evidence: readonly string[]
  /**
   * The specific observation that would justify revisiting, written so a
   * future reader can tell whether it has arrived. Not a wish list: "more
   * data" is not a revisit condition, "a good-vote likelihood measured on a
   * non-bot corpus" is.
   */
  readonly revisit: string
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
    evidence: [
      'BELIEF-002, wide bank servant cell, 360 paired deals per population '
      + 'against heuristic and random opponents: clean proposal +10.5% and '
      + '+4.4%, vote truth +4.6% and +7.4%, dirty-team approve -10.2% and '
      + '-10.0%, every interval clear of zero, win rate unmoved in both.',
      'Calibration improves on player-evil and is neutral on team-clean. '
      + 'Merlin exposure does not rise.',
      'Cost measured and is not a cost: on 60 ten-player round-three-plus '
      + 'proposals the weighted arm ran 87.2 ms per decision against the '
      + 'uniform arm\'s 96.8, because it reweights worlds the belief already '
      + 'enumerated rather than enumerating more.',
      'NOT validated on human games. The 2023 six-player human corpus has no '
      + 'two-Fail quest and no Oberon, which are the two dimensions this '
      + 'factor\'s parameters most depend on.',
    ],
    revisit:
      'Merlin and Percival cells on the same wide bank, before this factor is '
      + 'considered for good-base. Separately, any human or LLM corpus that '
      + 'reaches two-Fail quests would be the first real test of the '
      + 'twoFailsRequired parameters, which no measurement has yet touched.',
  },
  'language-factor': {
    factorVersion: LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
    bundleVersion: LANGUAGE_FACTOR_BUNDLE_VERSION,
    // Layers over a mechanical base rather than replacing it, so it is the one
    // factor that could run beside another. It still does not: no shipped
    // agent injects an interpreter, so it is dark outside eval and tests.
    seating: { kind: 'injected', option: 'languageInterpreter' },
    evidence: [
      'None from a shipped configuration, which is the honest entry. No agent '
      + 'in registry.ts injects an interpreter, so this has never run in a '
      + 'real game and its caps have never been exercised against play.',
      'What exists is structural: the active-language eval bank and 24 tests '
      + 'pin the 1.25 relative-odds cap, deduplication by source sequence, '
      + 'viewer-authored sources as exact no-ops, and the guarantee that no '
      + 'language evidence can revive an impossible world.',
    ],
    revisit:
      'A measured arm that injects an interpreter and reports decision quality '
      + 'against the same frozen banks the mechanical factors use. Until then '
      + 'the open question is whether it helps, not how much. Note this is the '
      + 'one factor that layers over a mechanical base rather than replacing '
      + 'it, so it does not need the combined model the other two do.',
  },
  'vote-matrix-factor': {
    factorVersion: VOTE_MATRIX_FACTOR_VERSION,
    bundleVersion: VOTE_MATRIX_BUNDLE_VERSION,
    seating: {
      kind: 'unseated',
      why:
        'BELIEF-001. Its evil half is confirmed on human games, but its good '
        + 'half is measurably wrong and is the larger signal, so what ships '
        + 'today would be the weaker of two available models. See BELIEF-003.',
    },
    evidence: [
      'Bot banks, v1 versus v2: v1 (evil-only) beat v2 (both sides) on the '
      + 'heuristic corpus, 52.0% against 59.8% dirty, with the standing note '
      + 'that v2 may have been penalized for modelling play correctly against '
      + 'an opponent that does not follow the convention.',
      'Human games (Avalon-NLU, 20 six-player annotated games with '
      + 'ground-truth roles, 464 ballots) settle that note in v2\'s favour. '
      + 'The evil asymmetry is confirmed at odds ratio 4.19 against this '
      + 'model\'s implied 5.6, so the authored parameters are close. But good '
      + 'voters approve clean teams 92.7% against dirty 59.2%, odds ratio '
      + '0.11 where the model assumes 1.00.',
      'A good vote is therefore world-dependent and does not cancel in the '
      + 'normalization. It is being discarded rather than cancelled, and it is '
      + 'the larger of the two signals. Not a Merlin artifact: servants alone '
      + 'give 0.18 and Percival 0.18.',
      'Untested dimensions: no Oberon or Mordred visibility asymmetry and no '
      + 'two-Fail quest in that corpus, which is exactly what visibleFailPower '
      + 'exists to handle.',
    ],
    revisit:
      'BELIEF-003, a good-vote likelihood measured on a non-bot corpus, is the '
      + 'change worth making before this is seated at all. Seating it also '
      + 'requires the combined mechanical belief model, because a factor is a '
      + 'whole BeliefModel and the quest factor already holds that slot.',
  },
  'proposal-factor': {
    factorVersion: PROPOSAL_FACTOR_VERSION,
    bundleVersion: PROPOSAL_BUNDLE_VERSION,
    seating: {
      kind: 'unseated',
      why:
        'BELIEF-004. Human games show the behaviour it prices is real and '
        + 'non-diagnostic: good and evil leaders avoid seating evil at the '
        + 'same rate, for different reasons. No retune fixes that.',
    },
    evidence: [
      'Bot banks: -3.38% dirty on the heuristic corpus (95% -5.17% to -1.59%, '
      + '2039 decisions) and -1.44% on random (95% -3.48% to +0.61%, 2297 '
      + 'decisions), which is null. It does not move the POLICY-002 quantity '
      + 'it was aimed at: 1.111 evil per team against the base\'s 1.126, '
      + 'interval containing zero.',
      'The heuristic gain is circular. decidePropose implements the same '
      + 'camouflage rule this model prices, citing the same brief sections, so '
      + 'that population is close to built to satisfy it.',
      'Human games (Avalon-NLU, 148 proposals) explain why, and the answer is '
      + 'not the sign. Evil leaders do camouflage, seating a partner at odds '
      + 'lift 0.55 against chance, close to the authored 0.5 and 0.6. But good '
      + 'leaders seat evil at 0.49, and that result is the unambiguous one '
      + '(exact p < 0.0001 over 111 proposals, against the evil result\'s '
      + 'p = 0.089 over 37). The diagnostic ratio is 1.12 where this model '
      + 'assumes about 0.55.',
      'The firstRound entry, this model\'s strongest claim, has n = 4 in that '
      + 'corpus and points the other way. It has no human support at all.',
      'Reusable finding independent of the factor: the AvalonBench naive-minion '
      + 'direction measures significantly WORSE than no factor at all (+4.07%, '
      + 'p = 2.3e-6).',
    ],
    revisit:
      'BELIEF-004. Only a reframing that prices the good leader\'s deduction '
      + 'instead of assuming chance can help, because the defect is a '
      + 'diagnostic ratio near 1 rather than a wrong magnitude. If that '
      + 'reframing is not attempted, the right end state is deletion, keeping '
      + 'the sign finding and the confound in the migration history.',
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
