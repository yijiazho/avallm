// Read-side and projection helpers over a resolved DecisionComponentRun: the
// monotonic causal-use advance guard, the payload accessors and index, the
// policy-use attribution (single and batch), the speech-safe public projection,
// and the payload-envelope constructor.
//
// These are pure functions over an already-produced run. They live beside the
// admission engine in kernel.ts, which re-exports them so callers keep reading
// them from `./kernel.ts`, and which reuses admittedPayload for its own
// dependency reads.

import { canonicalCode } from '../canonical/canonical-code.ts'
import { componentIdentityKey } from './registry.ts'
import type {
  ComponentPayloadEnvelope,
  ComponentRef,
  ComponentToken,
} from './types.ts'
import type {
  DecisionComponentEntry,
  DecisionComponentPolicyUse,
  DecisionComponentRun,
  PublicDecisionComponentEntry,
  PublicDecisionComponentRun,
} from './run-types.ts'

function frozenRef(ref: ComponentRef): ComponentRef {
  return Object.freeze({ id: ref.id, version: ref.version })
}

/**
 * The one admitted-payload lookup: an entry yields its payload only when it is
 * the same component as the token by identity, kind, and privacy, and it was
 * admitted. Every reader (the kernel's dependency reads, the payload index, and
 * the single-token accessor) resolves the entry however it likes and then
 * routes the match through here so the tag and status rule lives once.
 */
export function admittedPayload<Payload>(
  entry: DecisionComponentEntry | undefined,
  token: ComponentToken<Payload>,
): Payload | undefined {
  return entry
    && componentIdentityKey(entry.component) === componentIdentityKey(token)
    && entry.kind === token.kind
    && entry.privacy === token.privacy
    && entry.status === 'admitted'
    ? entry.envelope.payload as Payload
    : undefined
}

/** Admit only monotonic causal-use changes to one exact component run. */
export function advanceDecisionComponentRun(
  prior: DecisionComponentRun,
  next: DecisionComponentRun,
): DecisionComponentRun {
  if (
    prior.version !== next.version
    || prior.configured !== next.configured
    || prior.entries !== next.entries
    || prior.policyUse.length !== next.policyUse.length
  ) {
    throw new Error('component run advancement changed resolved graph state')
  }
  for (let index = 0; index < prior.policyUse.length; index++) {
    const before = prior.policyUse[index]
    const after = next.policyUse[index]
    const prefix = before.stages.every(
      (stage, stageIndex) => after.stages[stageIndex] === stage,
    )
    if (
      componentIdentityKey(before.component) !==
        componentIdentityKey(after.component)
      || (before.used && !after.used)
      || after.used !== (after.stages.length > 0)
      || after.stages.length < before.stages.length
      || !prefix
      || new Set(after.stages).size !== after.stages.length
      || after.stages.some((stage) => !canonicalCode(stage))
    ) {
      throw new Error('component run policy use did not advance monotonically')
    }
  }
  return next
}

export interface DecisionComponentPayloadIndex {
  readonly entriesVisited: number
  payload<Payload>(token: ComponentToken<Payload>): Payload | undefined
}

/** Build one invocation-local exact-tag index for repeated policy reads. */
export function indexDecisionComponentPayloads(
  run: DecisionComponentRun,
): DecisionComponentPayloadIndex {
  const entries = new Map<string, DecisionComponentEntry>()
  let entriesVisited = 0
  for (const entry of run.entries) {
    entriesVisited++
    const key = componentIdentityKey(entry.component)
    if (entries.has(key)) {
      throw new Error(`component run repeats entry ${key}`)
    }
    entries.set(key, entry)
  }
  return Object.freeze({
    entriesVisited,
    payload<Payload>(
      token: ComponentToken<Payload>,
    ): Payload | undefined {
      return admittedPayload(entries.get(componentIdentityKey(token)), token)
    },
  })
}

export function componentPayload<Payload>(
  run: DecisionComponentRun,
  token: ComponentToken<Payload>,
): Payload | undefined {
  return admittedPayload(
    run.entries.find(
      (candidate) =>
        componentIdentityKey(candidate.component)
          === componentIdentityKey(token),
    ),
    token,
  )
}

export interface DecisionComponentPolicyAttributionWork {
  readonly tokensVisited: number
  readonly entriesVisited: number
  readonly policyUseEntriesVisited: number
}

export interface DecisionComponentPolicyAttributionBatch {
  readonly run: DecisionComponentRun
  readonly work: DecisionComponentPolicyAttributionWork
}

/**
 * Project one policy-use row into its used form with the stage appended. The
 * stage dedup and append-order rule lives here so the single-token and batch
 * attributions cannot drift apart.
 */
function appendPolicyStage(
  attribution: DecisionComponentPolicyUse,
  stage: string,
): DecisionComponentPolicyUse {
  return Object.freeze({
    component: frozenRef(attribution.component),
    used: true,
    stages: attribution.stages.includes(stage)
      ? attribution.stages
      : Object.freeze([...attribution.stages, stage]),
  })
}

/**
 * Attribute one accepted policy layer in one entry-validation pass and one
 * policy-use projection pass, independent of the number of component tokens.
 */
export function attributeComponentPolicyUseBatch(
  run: DecisionComponentRun,
  tokens: readonly ComponentToken[],
  stage: string,
): DecisionComponentPolicyAttributionBatch {
  if (!canonicalCode(stage)) {
    throw new Error('component policy-use stage must be canonical')
  }
  if (tokens.length === 0) {
    return Object.freeze({
      run,
      work: Object.freeze({
        tokensVisited: 0,
        entriesVisited: 0,
        policyUseEntriesVisited: 0,
      }),
    })
  }
  const requested = new Map<string, ComponentToken>()
  let tokensVisited = 0
  for (const token of tokens) {
    tokensVisited++
    const key = componentIdentityKey(token)
    const prior = requested.get(key)
    if (
      prior
      && (prior.kind !== token.kind || prior.privacy !== token.privacy)
    ) {
      throw new Error(`component policy attribution substitutes tag ${key}`)
    }
    if (!prior) requested.set(key, token)
  }

  const admitted = new Set<string>()
  let entriesVisited = 0
  for (const entry of run.entries) {
    entriesVisited++
    const key = componentIdentityKey(entry.component)
    const token = requested.get(key)
    if (!token) continue
    if (
      entry.kind !== token.kind
      || entry.privacy !== token.privacy
      || entry.status !== 'admitted'
    ) {
      throw new Error(
        `cannot attribute policy use to unadmitted component ${key}`,
      )
    }
    admitted.add(key)
  }
  if (admitted.size !== requested.size) {
    const missing = [...requested.keys()].find((key) => !admitted.has(key))!
    throw new Error(
      `cannot attribute policy use to unadmitted component ${missing}`,
    )
  }

  const projected = new Set<string>()
  let policyUseEntriesVisited = 0
  const policyUse = run.policyUse.map((attribution) => {
    policyUseEntriesVisited++
    const key = componentIdentityKey(attribution.component)
    if (!requested.has(key)) return attribution
    projected.add(key)
    return appendPolicyStage(attribution, stage)
  })
  if (projected.size !== requested.size) {
    throw new Error('component run policy-use projection is incomplete')
  }
  return Object.freeze({
    run: Object.freeze({
      ...run,
      policyUse: Object.freeze(policyUse),
    }),
    work: Object.freeze({
      tokensVisited,
      entriesVisited,
      policyUseEntriesVisited,
    }),
  })
}

export function attributeComponentPolicyUse(
  run: DecisionComponentRun,
  token: ComponentToken,
  stage: string,
): DecisionComponentRun {
  if (!canonicalCode(stage)) {
    throw new Error('component policy-use stage must be canonical')
  }
  const key = componentIdentityKey(token)
  const entry = run.entries.find(
    (candidate) =>
      componentIdentityKey(candidate.component) === key
      && candidate.kind === token.kind
      && candidate.privacy === token.privacy,
  )
  if (!entry || entry.status !== 'admitted') {
    throw new Error(
      `cannot attribute policy use to unadmitted component ${key}`,
    )
  }
  return Object.freeze({
    ...run,
    policyUse: Object.freeze(run.policyUse.map((attribution) =>
      componentIdentityKey(attribution.component) === key
        ? appendPolicyStage(attribution, stage)
        : attribution)),
  })
}

/**
 * Projection safe for speech and public logs. Private components are omitted
 * wholesale so role metadata cannot leak through identity, status, or use.
 */
export function publicDecisionComponentRun(
  run: DecisionComponentRun,
): PublicDecisionComponentRun {
  const entries = run.entries.filter(
    (entry): entry is PublicDecisionComponentEntry =>
      entry.privacy === 'public',
  )
  const publicIdentities = new Set(
    entries.map((entry) => componentIdentityKey(entry.component)),
  )
  return Object.freeze({
    version: run.version,
    configured: Object.freeze(run.configured.filter(
      (component) => publicIdentities.has(componentIdentityKey(component)),
    )),
    entries: Object.freeze(entries),
    policyUse: Object.freeze([]),
  })
}

export function componentEnvelope<Payload>(
  token: ComponentToken<Payload>,
  payload: Payload,
): ComponentPayloadEnvelope<Payload> {
  return {
    component: { id: token.id, version: token.version },
    kind: token.kind,
    privacy: token.privacy,
    payload,
  }
}
