import type {
  ScoreLayerDefinition,
  ScoreLayerToken,
} from './types.ts'

/**
 * Score families form a tree: one root, then specializations that refine it,
 * and optionally one composition that speaks for the whole stack. The registry
 * underneath stores a single predecessor per layer, so the tree has to be
 * linearized before it can be registered.
 *
 * Linearizing by hand is what this module exists to stop. Hand-threaded
 * predecessor tokens read as a total order, hide which family is a real
 * fallback base, and silently re-point when a family is inserted in the middle.
 * Callers declare the tree once, with each family's base and the reason for it,
 * and the predecessor for every lane is derived from that declaration.
 */

export type ScoreLayerLaneMode =
  /**
   * One composition terminal has to traverse the whole lane, so a family's
   * predecessor is the previous family that joined the lane rather than its
   * base. That is only sound when sibling applicability predicates are
   * mutually exclusive: an intervening sibling is inapplicable for the seat
   * that reaches it and passes the prior surface through untouched.
   */
  | 'composed'
  /**
   * No composition terminal exists, so nothing forces siblings onto one chain
   * and each family hangs directly off its declared base.
   */
  | 'isolated'

export interface ScoreLayerLaneDeclaration<Lane extends string> {
  readonly id: Lane
  readonly mode: ScoreLayerLaneMode
  /** Why the lane resolves predecessors this way. Recorded, never branched on. */
  readonly rationale: string
}

export type ScoreLayerFamilyKind =
  /** Owns the registry root and the base every other family refines. */
  | 'root'
  /** Refines an earlier family and degrades to it. */
  | 'specialization'
  /** Terminates a composed lane on behalf of every family before it. */
  | 'composition'

/**
 * The terminal token a family contributes to each lane it joins. A later
 * family in the same lane hangs off this token, so it is the family's tip and
 * not necessarily every layer the family registers.
 */
export type ScoreLayerLaneTips<Lane extends string> =
  Readonly<Partial<Record<Lane, ScoreLayerToken>>>

/** Reads back a derived predecessor; throws for a lane the family never joined. */
export type ScoreLayerPredecessorLookup<Lane extends string> =
  (lane: Lane) => ScoreLayerToken

export interface ScoreLayerFamilyDeclaration<Lane extends string> {
  readonly id: string
  readonly kind: ScoreLayerFamilyKind
  /**
   * The family this one specializes: the truthful fallback its layers degrade
   * to. Null for the root, which has nothing beneath it, and for a
   * composition, whose base is the composed lane itself rather than a sibling.
   */
  readonly base: string | null
  /** Why that is the semantic base. Recorded, never branched on. */
  readonly baseRationale: string
  readonly lanes: ScoreLayerLaneTips<Lane>
  register(
    predecessor: ScoreLayerPredecessorLookup<Lane>,
  ): readonly ScoreLayerDefinition[]
}

export interface ScoreLayerFamilyTree<Lane extends string> {
  readonly lanes: readonly ScoreLayerLaneDeclaration<Lane>[]
  /** Declaration order is the linearization; a base must precede its users. */
  readonly families: readonly ScoreLayerFamilyDeclaration<Lane>[]
}

/** The derived predecessor for one family in one lane, for tests and review. */
export interface ScoreLayerFamilyWiring {
  readonly family: string
  readonly lane: string
  readonly mode: ScoreLayerLaneMode
  readonly base: string | null
  readonly predecessor: ScoreLayerToken
  /**
   * True when the derived predecessor is not the base's tip, which happens
   * only in a composed lane that routes through an inapplicable sibling.
   */
  readonly viaSibling: boolean
}

export interface ResolvedScoreLayerFamilyTree {
  readonly definitions: readonly ScoreLayerDefinition[]
  readonly wiring: readonly ScoreLayerFamilyWiring[]
}

export type ScoreLayerFamilyErrorCode =
  | 'invalid-lane'
  | 'invalid-family'
  | 'duplicate-family'
  | 'misplaced-root'
  | 'misplaced-composition'
  | 'unknown-base'
  | 'missing-lane-predecessor'

export class ScoreLayerFamilyError extends Error {
  readonly code: ScoreLayerFamilyErrorCode

  constructor(code: ScoreLayerFamilyErrorCode, message: string) {
    super(message)
    this.name = 'ScoreLayerFamilyError'
    this.code = code
  }
}

function isToken(value: unknown): value is ScoreLayerToken {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as ScoreLayerToken).id === 'string'
    && typeof (value as ScoreLayerToken).version === 'string',
  )
}

function declaredLaneModes<Lane extends string>(
  lanes: readonly ScoreLayerLaneDeclaration<Lane>[],
): Map<string, ScoreLayerLaneMode> {
  const modes = new Map<string, ScoreLayerLaneMode>()
  if (!Array.isArray(lanes) || !lanes.length) {
    throw new ScoreLayerFamilyError(
      'invalid-lane',
      'a family tree needs at least one declared lane',
    )
  }
  for (const lane of lanes) {
    if (!lane || typeof lane.id !== 'string' || !lane.id) {
      throw new ScoreLayerFamilyError(
        'invalid-lane',
        'every lane needs a non-empty id',
      )
    }
    if (modes.has(lane.id)) {
      throw new ScoreLayerFamilyError(
        'invalid-lane',
        `lane ${lane.id} is declared twice`,
      )
    }
    if (lane.mode !== 'composed' && lane.mode !== 'isolated') {
      throw new ScoreLayerFamilyError(
        'invalid-lane',
        `lane ${lane.id} has no predecessor mode`,
      )
    }
    if (typeof lane.rationale !== 'string' || !lane.rationale) {
      throw new ScoreLayerFamilyError(
        'invalid-lane',
        `lane ${lane.id} must state why it resolves predecessors as it does`,
      )
    }
    modes.set(lane.id, lane.mode)
  }
  return modes
}

function assertFamilyShape<Lane extends string>(
  family: ScoreLayerFamilyDeclaration<Lane>,
  position: number,
  total: number,
  known: ReadonlyMap<string, ScoreLayerLaneTips<Lane>>,
): void {
  if (!family || typeof family.id !== 'string' || !family.id) {
    throw new ScoreLayerFamilyError(
      'invalid-family',
      `family at position ${position} needs a non-empty id`,
    )
  }
  if (known.has(family.id)) {
    throw new ScoreLayerFamilyError(
      'duplicate-family',
      `family ${family.id} is declared twice`,
    )
  }
  if (typeof family.register !== 'function') {
    throw new ScoreLayerFamilyError(
      'invalid-family',
      `family ${family.id} must register its own layers`,
    )
  }
  if (typeof family.baseRationale !== 'string' || !family.baseRationale) {
    throw new ScoreLayerFamilyError(
      'invalid-family',
      `family ${family.id} must state why it sits where it does`,
    )
  }
  if ((family.kind === 'root') !== (position === 0)) {
    throw new ScoreLayerFamilyError(
      'misplaced-root',
      `family ${family.id}: a tree needs exactly one root, declared first`,
    )
  }
  if (family.kind === 'composition' && position !== total - 1) {
    throw new ScoreLayerFamilyError(
      'misplaced-composition',
      `family ${family.id} speaks for the whole stack so it must be declared last`,
    )
  }
  if (family.kind === 'specialization') {
    if (family.base === null || !known.has(family.base)) {
      throw new ScoreLayerFamilyError(
        'unknown-base',
        `family ${family.id} specializes ${
          family.base ?? 'nothing'
        }, which is not declared before it`,
      )
    }
  } else if (family.base !== null) {
    throw new ScoreLayerFamilyError(
      'invalid-family',
      `family ${family.id} is a ${family.kind} so it cannot name a base`,
    )
  }
  const tips = Object.values(family.lanes ?? {})
  if (!tips.length) {
    throw new ScoreLayerFamilyError(
      'invalid-family',
      `family ${family.id} must join at least one lane`,
    )
  }
  if (!tips.every(isToken)) {
    throw new ScoreLayerFamilyError(
      'invalid-family',
      `family ${family.id} must name a terminal token for every lane it joins`,
    )
  }
}

/**
 * Validate the declared tree and register every family against the
 * predecessor its lane implies.
 *
 * The checks are the point: a specialization whose base is declared after it
 * is rejected, so a composed lane can never quietly place a family ahead of
 * the fallback it degrades to, and a family that joins an isolated lane its
 * base skipped is rejected rather than being re-pointed at a stranger.
 */
export function resolveScoreLayerFamilyTree<Lane extends string>(
  tree: ScoreLayerFamilyTree<Lane>,
): ResolvedScoreLayerFamilyTree {
  const laneModes = declaredLaneModes(tree.lanes)
  const tipsByFamily = new Map<string, ScoreLayerLaneTips<Lane>>()
  const laneTip = new Map<string, ScoreLayerToken>()
  const definitions: ScoreLayerDefinition[] = []
  const wiring: ScoreLayerFamilyWiring[] = []

  const families = tree.families
  if (!Array.isArray(families) || !families.length) {
    throw new ScoreLayerFamilyError(
      'invalid-family',
      'a family tree needs at least one family',
    )
  }
  for (const [position, family] of families.entries()) {
    assertFamilyShape(family, position, families.length, tipsByFamily)
    const laneIds = Object.keys(family.lanes) as Lane[]
    const predecessors = new Map<string, ScoreLayerToken>()
    for (const laneId of laneIds) {
      const mode = laneModes.get(laneId)
      if (!mode) {
        throw new ScoreLayerFamilyError(
          'invalid-lane',
          `family ${family.id} joins undeclared lane ${laneId}`,
        )
      }
      if (family.kind === 'root') continue
      if (family.kind === 'composition' && mode !== 'composed') {
        throw new ScoreLayerFamilyError(
          'misplaced-composition',
          `family ${family.id} can only terminate a composed lane, not ${laneId}`,
        )
      }
      const baseTip = family.base === null
        ? undefined
        : tipsByFamily.get(family.base)?.[laneId]
      if (family.base !== null && !baseTip) {
        throw new ScoreLayerFamilyError(
          'missing-lane-predecessor',
          `family ${family.id} joins lane ${laneId} but its base ${
            family.base
          } does not`,
        )
      }
      const previous = laneTip.get(laneId)
      if (!previous) {
        throw new ScoreLayerFamilyError(
          'missing-lane-predecessor',
          `lane ${laneId} reaches ${family.id} with nothing registered before it`,
        )
      }
      const predecessor = mode === 'composed' ? previous : baseTip!
      predecessors.set(laneId, predecessor)
      wiring.push(Object.freeze({
        family: family.id,
        lane: laneId,
        mode,
        base: family.base,
        predecessor,
        viaSibling: baseTip !== undefined && predecessor !== baseTip,
      }))
    }

    definitions.push(...family.register((lane: Lane) => {
      const predecessor = predecessors.get(lane)
      if (!predecessor) {
        throw new ScoreLayerFamilyError(
          'missing-lane-predecessor',
          `family ${family.id} asked for lane ${lane}, which it never joined`,
        )
      }
      return predecessor
    }))

    // Record the tips only after registration so no family can hang off itself.
    for (const laneId of laneIds) laneTip.set(laneId, family.lanes[laneId]!)
    tipsByFamily.set(family.id, family.lanes)
  }

  return Object.freeze({
    definitions: Object.freeze(definitions),
    wiring: Object.freeze(wiring),
  })
}
