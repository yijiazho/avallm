// test-lane: fast
// Agent library: built-in defs are valid, validation rejects junk, prompt
// layers reach the system prompt, and the engine-owned parts stay fixed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentDescriptor, builtinDefs, loadAgentLibrary, parseTableSeat, publicInfo, resolveModel, validateDef } from '../../server/agents/defs.ts'
import { createAgentFromDef } from '../../server/agents/registry.ts'
import { DEFAULT_MODEL, ROSTER, rosterById } from '../../server/llm/roster.ts'
import type { OpenRouterClient } from '../../server/llm/openrouter.ts'
import {
  ALIGNMENT_SHARED,
  buildMessages,
  EVIL_SHARED,
  PLAYER_REFERENCE_NORMS,
  roleGuidanceFor,
  ROLE_GUIDANCE,
  TABLE_TALK_NORMS,
} from '../../server/agents/raw-llm/prompts.ts'
import { createGame } from '../../server/engine/game.ts'
import { viewFor } from '../../server/engine/view.ts'
import { ROLE_ALIGNMENT } from '../../server/engine/rules.ts'
import { readDecisionFixtures } from '../../server/eval/replay/decision-fixtures.ts'

test('built-in library exposes roster, rule-based, and both probabilistic agents', () => {
  const defs = builtinDefs()
  assert.equal(defs.length, ROSTER.length + 3)
  for (const def of defs) validateDef(def)
  assert.equal(defs.find((d) => d.id === 'autopilot')?.name, 'Rule-based')
  assert.deepEqual(
    defs.find((d) => d.id === 'probabilistic')?.engine,
    { type: 'composed', brain: 'full-role', adapter: 'none' },
  )
  assert.deepEqual(
    defs.find((d) => d.id === 'probabilistic-llm')?.engine,
    {
      type: 'composed',
      brain: 'full-role',
      adapter: 'bounded-llm',
      model: DEFAULT_MODEL,
    },
  )
  const ids = defs.map((d) => d.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('curated exact-belief card uses its promoted public identity', () => {
  const library = loadAgentLibrary()
  const exactBelief = library.agents.find((def) => def.id === 'exact-belief')
  assert.equal(exactBelief?.name, 'Exact Belief')
  assert.deepEqual(exactBelief?.engine, {
    type: 'llm',
    brain: { beliefVisibility: 'compact-belief-v1' },
  })
  assert.equal(library.agents.some((def) => def.id === 'exact-belief-experimental'), false)
  assert.equal(library.problems.some((problem) => problem.file.includes('exact-belief')), false)
})

test('publicInfo fills badges and maps engine to a display model', () => {
  const auto = publicInfo(builtinDefs().find((d) => d.id === 'autopilot')!)
  assert.equal(auto.model, 'rule-based')
  assert.equal(auto.usesModel, false)
  const probabilistic = publicInfo(
    builtinDefs().find((d) => d.id === 'probabilistic')!,
  )
  assert.equal(probabilistic.model, 'probabilistic')
  assert.equal(probabilistic.usesModel, false)
  const hybrid = publicInfo(
    builtinDefs().find((d) => d.id === 'probabilistic-llm')!,
    'gemini-flash-lite',
  )
  assert.equal(hybrid.model, rosterById('gemini-flash-lite').slug)
  assert.equal(hybrid.usesModel, true)
  assert.equal(hybrid.suggestedModel, DEFAULT_MODEL)
  assert.ok(auto.color.length > 0)
  const custom = publicInfo(validateDef({
    id: 'chaos-goblin', name: 'Chaos Goblin',
    engine: { type: 'llm', model: 'deepseek-flash', personality: 'be chaotic' },
  }))
  assert.ok(custom.color.length > 0)
  assert.equal(custom.personality, 'be chaotic')
})

test('validateDef rejects bad defs', () => {
  assert.throws(() => validateDef({ id: 'X BAD', name: 'x', engine: { type: 'heuristic' } }), /kebab/)
  assert.throws(() => validateDef({ id: 'ok', name: '', engine: { type: 'heuristic' } }), /name/)
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'llm', model: 'not-a-model' } }), /unknown roster/)
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'wat' } }), /engine/)
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'llm', roleGuidance: { wizard: 'x' } } }), /unknown role/)
  assert.throws(() => validateDef({ id: 'ok', name: 'x', engine: { type: 'llm', roleGuidanceMode: 'merge' } }), /roleGuidanceMode/)
  assert.throws(() => validateDef({
    id: 'ok',
    name: 'x',
    engine: { type: 'composed', brain: 'unknown', adapter: 'none' },
  }), /composed brain/)
  assert.throws(() => validateDef({
    id: 'ok',
    name: 'x',
    engine: {
      type: 'composed',
      brain: 'full-role',
      adapter: 'none',
      model: DEFAULT_MODEL,
    },
  }), /model requires/)
})

test('llm model is optional — a personality-only agent validates and rides the default', () => {
  const def = validateDef({
    id: 'grumpy-percival', name: 'Grumpy Percival',
    engine: { type: 'llm', personality: 'suspicious of everyone' },
  })
  assert.equal(def.engine.type === 'llm' && def.engine.model, undefined)
  // publicInfo shows the resolved slug, never "unset".
  assert.equal(publicInfo(def).model, rosterById(DEFAULT_MODEL).slug)
})

test('resolveModel precedence: seat override > def suggestion > DEFAULT_MODEL', () => {
  const withModel = validateDef({ id: 'aa', name: 'A', engine: { type: 'llm', model: 'kimi' } })
  const noModel = validateDef({ id: 'bb', name: 'B', engine: { type: 'llm', personality: 'x' } })
  assert.equal(resolveModel(noModel), DEFAULT_MODEL)         // fallback
  assert.equal(resolveModel(withModel), 'kimi')              // def suggestion
  assert.equal(resolveModel(withModel, 'gemini-flash-lite'), 'gemini-flash-lite')  // seat override wins
  assert.equal(resolveModel(noModel, 'kimi'), 'kimi')
  // The override also drives the transparency badge.
  assert.equal(publicInfo(withModel, 'gemini-flash-lite').model, rosterById('gemini-flash-lite').slug)
})

test('artifact descriptors distinguish raw and probabilistic LLM seats on the same model', () => {
  const defs = builtinDefs()
  const raw = defs.find((def) => def.id === 'kimi')!
  const hybrid = defs.find((def) => def.id === 'probabilistic-llm')!
  const deterministic = defs.find((def) => def.id === 'probabilistic')!

  assert.equal(agentDescriptor(raw), 'llm:kimi')
  assert.equal(
    agentDescriptor(hybrid, 'kimi'),
    'def:probabilistic-llm:llm:kimi',
  )
  assert.equal(agentDescriptor(deterministic), 'def:probabilistic')
})

test('parseTableSeat accepts both wire shapes and rejects bad overrides', () => {
  const lib = builtinDefs()
  const byId = (id: string) => {
    const d = lib.find((x) => x.id === id)
    if (!d) throw new Error(`unknown agent: ${id}`)
    return d
  }
  assert.deepEqual(parseTableSeat('kimi', byId), { agent: 'kimi' })           // legacy bare id
  assert.deepEqual(parseTableSeat({ agent: 'kimi', model: 'gemini-flash-lite' }, byId), { agent: 'kimi', model: 'gemini-flash-lite' })
  assert.deepEqual(
    parseTableSeat({
      agent: 'probabilistic-llm',
      model: 'gemini-flash-lite',
    }, byId),
    { agent: 'probabilistic-llm', model: 'gemini-flash-lite' },
  )
  assert.throws(() => parseTableSeat('nope', byId), /unknown agent/)
  assert.throws(() => parseTableSeat({ agent: 'kimi', model: 'nope' }, byId), /unknown roster/)
  // A model override on a non-llm engine is a create-time error, not a start-time surprise.
  assert.throws(() => parseTableSeat({ agent: 'autopilot', model: 'gemini-flash-lite' }, byId), /does not take a model/)
  assert.throws(() => parseTableSeat({
    agent: 'probabilistic',
    model: 'gemini-flash-lite',
  }, byId), /does not take a model/)
})

test('web-library probabilistic engines share mechanics while hybrid LLM only plans and speaks', async () => {
  const defs = builtinDefs()
  const fixture = readDecisionFixtures().find(
    ({ req }) => req.kind === 'propose',
  )!
  const seed = 'web-library-probabilistic-agent'
  const pure = createAgentFromDef(
    defs.find(({ id }) => id === 'probabilistic')!,
    { seed, seat: fixture.req.seat },
  )
  const pureOutput = await pure.decide(fixture.req, fixture.view)
  assert.equal(pureOutput.decision.kind, 'propose')
  assert.ok(pureOutput.trace)
  assert.equal(pureOutput.trace.coherenceIntent, undefined)

  const calls: { model: string; tag: string | undefined }[] = []
  const systemPrompts: string[] = []
  const client: OpenRouterClient = {
    async call(model, messages, options) {
      calls.push({ model, tag: options?.tag })
      systemPrompts.push(messages[0]?.content ?? '')
      if (options?.tag?.endsWith('/planner')) {
        const request = JSON.parse(messages.at(-1)!.content) as {
          structuredCandidateId: string
        }
        return JSON.stringify({
          candidateId: request.structuredCandidateId,
        })
      }
      return JSON.stringify({ text: 'I favor this team.' })
    },
    getSpend: () => ({}),
    getTotalCost: () => 0,
  }
  const hybrid = createAgentFromDef(
    defs.find(({ id }) => id === 'probabilistic-llm')!,
    { seed, seat: fixture.req.seat },
    'gemini-flash-lite',
    { client },
  )
  const hybridOutput = await hybrid.decide(fixture.req, fixture.view)
  assert.equal(hybridOutput.trace?.coherenceIntent, 'maintain')
  assert.deepEqual(
    hybridOutput.decision.kind === 'propose'
      ? hybridOutput.decision.team
      : undefined,
    pureOutput.decision.kind === 'propose'
      ? pureOutput.decision.team
      : undefined,
  )
  assert.equal(
    hybridOutput.decision.kind === 'propose'
      ? hybridOutput.decision.pitch
      : undefined,
    'I favor this team.',
  )
  assert.deepEqual(calls, [
    {
      model: rosterById('gemini-flash-lite').slug,
      tag: 'agent/probabilistic-llm/planner',
    },
    {
      model: rosterById('gemini-flash-lite').slug,
      tag: 'agent/probabilistic-llm/voice',
    },
  ])
  assert.ok(
    systemPrompts.every((prompt) => prompt.includes(PLAYER_REFERENCE_NORMS)),
    'every production hybrid call carries the player-reference norm',
  )
  assert.ok(
    systemPrompts[1]!.includes(TABLE_TALK_NORMS),
    'the production hybrid voice carries the shared table-talk norms',
  )
})

test('validateDef: new layer fields — key checks, caps, temperature, CRLF', () => {
  const ok = (engine: object) => validateDef({ id: 'ok', name: 'x', engine: { type: 'llm', model: 'deepseek-flash', ...engine } })
  // unknown guidance keys fail loudly at save time
  assert.throws(() => ok({ kindGuidance: { sing: 'la' } }), /unknown kind "sing"/)
  assert.throws(() => ok({ roleGuidance: { wizard: 'zap' } }), /unknown role "wizard"/)
  // temperature stays in the JSON-reliable band
  assert.throws(() => ok({ temperature: 1.2 }), /temperature/)
  assert.throws(() => ok({ temperature: -0.1 }), /temperature/)
  ok({ temperature: 0 })
  ok({ temperature: 1 })
  // per-field and aggregate caps
  assert.throws(() => ok({ strategy: 'x'.repeat(2001) }), /strategy/)
  assert.throws(() => ok({
    strategy: 'x'.repeat(2000), personality: 'x'.repeat(2000),
    roleGuidance: { merlin: 'x'.repeat(2000), servant: 'x'.repeat(2000), assassin: 'x'.repeat(2000) },
    kindGuidance: { vote: 'x'.repeat(2000) },
  }), /exceeds/)
  // Windows textareas paste CRLF — normalized at the boundary
  const d = ok({ strategy: 'line one\r\nline two', kindGuidance: { reflect: 'a\r\nb' } })
  const e = d.engine as { strategy?: string; kindGuidance?: Record<string, string> }
  assert.equal(e.strategy, 'line one\nline two')
  assert.equal(e.kindGuidance?.reflect, 'a\nb')
})

test('validateDef: agent-card names are sanitized without inheriting player role reservations', () => {
  // Historical control-like identity words remain rejected in library labels.
  assert.throws(() => validateDef({ id: 'you-bot', name: 'You', engine: { type: 'heuristic' } }), /reserved/)
  assert.throws(() => validateDef({ id: 'sys', name: ' system ', engine: { type: 'heuristic' } }), /reserved/)
  // Prompt-structure markup is stripped, not stored.
  const d = validateDef({ id: 'angle', name: '<Angle> {Bot}', engine: { type: 'heuristic' } })
  assert.equal(d.name, 'Angle Bot')
  // Role words are forbidden as player identities but valid in agent-card
  // metadata, which no longer enters prompts as the bot's table name.
  assert.equal(validateDef({ id: 'merlin', name: 'Merlin', engine: { type: 'heuristic' } }).name, 'Merlin')
  assert.equal(validateDef({ id: 'mh', name: 'Merlin Hunter', engine: { type: 'heuristic' } }).name, 'Merlin Hunter')
})

test('validateDef: guidance keys reject prototype-chain names', () => {
  const ok = (engine: object) => validateDef({ id: 'ok', name: 'x', engine: { type: 'llm', model: 'deepseek-flash', ...engine } })
  // `in` would accept these via Object.prototype; Object.hasOwn must not.
  assert.throws(() => ok({ kindGuidance: { toString: 'x' } }), /unknown kind "toString"/)
  assert.throws(() => ok({ roleGuidance: { constructor: 'x' } }), /unknown role "constructor"/)
  assert.throws(() => ok({ kindGuidance: JSON.parse('{"__proto__": "x"}') }), /unknown kind "__proto__"/)
})

test('validateDef: legacy string versions read as integers; lenient mode keeps dead models', () => {
  const legacy = validateDef({
    id: 'old', name: 'Old', version: '1.0',
    engine: { type: 'llm', model: 'deepseek-flash' },
  })
  assert.equal(legacy.version, 1)
  // load mode accepts a vanished roster model so it can be surfaced, not skipped
  const dead = validateDef(
    { id: 'dead', name: 'Dead', engine: { type: 'llm', model: 'gone-model' } },
    { allowUnknownModel: true },
  )
  assert.equal((dead.engine as { model: string }).model, 'gone-model')
  // publicInfo must not throw on it either
  const info = publicInfo(dead)
  assert.match(info.model, /unavailable/)
})

test('strategy and kindGuidance layer into the prompt in design-doc order', () => {
  const g = createGame({ seed: 'defs-layers', playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  const view = viewFor(g, 0)
  const [sys] = buildMessages('vote', view, '', {
    strategy: 'STRATEGY-MARKER trust the vote record',
    personality: 'PERSONA-MARKER theatrical',
    kindGuidance: { vote: 'VOTE-MARKER weigh history', discuss: 'DISCUSS-MARKER never' },
  })
  const at = (needle: string) => {
    const i = sys!.content.indexOf(needle)
    assert.ok(i >= 0, `missing: ${needle}`)
    return i
  }
  // order: rules < strategy < role guidance < persona < kind guidance < guard < contract
  assert.ok(at('succeeding 3 of 5') < at('STRATEGY-MARKER'))
  assert.ok(at('STRATEGY-MARKER') < at('PERSONA-MARKER'))
  assert.ok(at('PERSONA-MARKER') < at('VOTE-MARKER'))
  assert.ok(at('VOTE-MARKER') < at('TABLE TALK block'))       // injection guard after all custom text
  assert.ok(at('TABLE TALK block') < at('"vote"'))            // contract is the last word
  // guidance for other kinds stays out of this call
  assert.ok(!sys!.content.includes('DISCUSS-MARKER'))
})

test('personality and roleGuidance layer into the prompt; contracts stay fixed', () => {
  const g = createGame({ seed: 'defs-p', playerCount: 5, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
  const view = viewFor(g, 0)
  const [plain] = buildMessages('vote', view, '')
  const [layered] = buildMessages('vote', view, '', {
    personality: 'You are theatrical and paranoid.',
    roleGuidance: { [view.role]: 'CUSTOM GUIDANCE LINE' },
  })
  assert.ok(!plain!.content.includes('theatrical'))
  assert.ok(layered!.content.includes('theatrical and paranoid'))
  assert.ok(layered!.content.includes('CUSTOM GUIDANCE LINE'))
  // 'replace' (default) drops the baseline guidance for that role; 'append'
  // keeps it, so the agent still rides baseline strategy improvements.
  const baseGuidance = ROLE_GUIDANCE[view.role]!
  const [replaced] = buildMessages('vote', view, '', { roleGuidance: { [view.role]: 'ONLY MINE' } })
  const [appended] = buildMessages('vote', view, '', { roleGuidance: { [view.role]: 'ALSO MINE' }, roleGuidanceMode: 'append' })
  assert.ok(!replaced!.content.includes(baseGuidance) && replaced!.content.includes('ONLY MINE'))
  assert.ok(appended!.content.includes(baseGuidance) && appended!.content.includes('ALSO MINE'))
  // Engine-owned parts survive the overrides.
  for (const msg of [plain, layered]) {
    assert.match(msg!.content, /"vote"/)               // output contract
    assert.match(msg!.content, /TABLE TALK block/)     // injection guard
    assert.match(msg!.content, /succeeding 3 of 5/)    // rules digest
  }
})

test('every role carries its alignment-shared doctrine, undroppable by overrides', () => {
  // The structural guarantee: shared advice can never be missing from a role,
  // which is the bug that once let a Morgana double-fail with no warning.
  for (const [role, alignment] of Object.entries(ROLE_ALIGNMENT)) {
    const composed = roleGuidanceFor(role, {})
    assert.ok(
      composed.startsWith(ALIGNMENT_SHARED[alignment]),
      `${role} guidance must lead with the ${alignment}-shared fragment`,
    )
    assert.ok(composed.includes(ROLE_GUIDANCE[role]!), `${role} keeps its role-specific text`)
  }
  // The specific regression: Morgana and Mordred (which used to omit it) now get
  // the double-fail coordination warning via the shared fragment.
  for (const role of ['morgana', 'mordred', 'assassin', 'minion', 'oberon']) {
    assert.ok(roleGuidanceFor(role, {}).includes('double Fail'), `${role} warns on double fails`)
  }
  // A 'replace' override swaps only the role-specific layer; the shared fragment
  // stays in front, so a custom evil agent can't accidentally drop the warning.
  const replaced = roleGuidanceFor('morgana', { roleGuidance: { morgana: 'ONLY MINE' } })
  assert.ok(replaced.includes(EVIL_SHARED) && replaced.includes('ONLY MINE'))
  assert.ok(!replaced.includes(ROLE_GUIDANCE.morgana!))
})
