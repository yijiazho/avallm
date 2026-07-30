import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  factsDossier,
  factsDossierFromPublicRecord,
} from '../server/agents/facts.ts'
import {
  projectLanguageInterpreterInput,
} from '../server/agents/communication/language-contract.ts'
import {
  projectPublicRecord,
} from '../server/agents/communication/public-record.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type {
  GameEvent,
  PlayerView,
} from '../server/engine/types.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

test('prompt facts and language context import the same public-record owner', () => {
  const factsSource = readFileSync(
    'server/agents/facts.ts',
    'utf8',
  )
  const languageSource = readFileSync(
    'server/agents/communication/language-contract.ts',
    'utf8',
  )

  assert.match(factsSource, /projectPublicRecord\(view\)/)
  assert.match(languageSource, /publicContext: projectPublicRecord\(view\)/)
  assert.doesNotMatch(languageSource, /function projectPublicContext/)
  assert.doesNotMatch(
    factsSource,
    /function computeRecords\(view: PlayerView\)/,
  )
})

test('public record is identical across seats for every supported player count', () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    const game = createGame({
      seed: `public-record-${playerCount}`,
      playerCount,
    })
    const records = game.players.map((player) =>
      projectPublicRecord(viewFor(game, player.seat)))
    for (const record of records.slice(1)) {
      assert.deepEqual(record, records[0], `${playerCount}-player seat drift`)
    }
  }
})

test('public record and language context reject private canaries', () => {
  const game = createGame({
    seed: 'public-record-private-canaries',
    playerCount: 7,
  })
  const baselineView = viewFor(game, 0)
  const baselineRecord = projectPublicRecord(baselineView)
  const baselineContext =
    projectLanguageInterpreterInput(baselineView).publicContext
  const canaryView = structuredClone(baselineView)

  canaryView.name = 'PRIVATE_VIEWER_NAME'
  canaryView.role = 'mordred'
  canaryView.alignment = 'evil'
  // Planted private seats that the public projection must scrub, whatever the
  // knowledge kind. One valid variant carrying every marker seat is enough:
  // scrubbing drops the whole privateInfo key, not one field at a time.
  canaryView.privateInfo = { kind: 'evil', evilPartners: [1, 2, 3, 4, 5, 6] }
  canaryView.transcript.push({
    seat: 0,
    name: 'PRIVATE_TRANSCRIPT_NAME',
    text: 'PRIVATE_TRANSCRIPT_TEXT',
  })
  Object.assign(canaryView.players[0], {
    role: 'PRIVATE_NESTED_ROLE',
    alignment: 'PRIVATE_NESTED_ALIGNMENT',
    privateInfo: 'PRIVATE_NESTED_INFO',
  })
  Object.assign(canaryView.quests[0], {
    questCards: 'PRIVATE_QUEST_CARDS',
  })
  Object.assign(canaryView.proposals, {
    secretBallots: 'PRIVATE_BALLOTS',
  })
  const privateEvent: GameEvent = {
    seq: Math.max(...canaryView.events.map((event) => event.seq)) + 1,
    type: 'scratchpad',
    payload: {
      text: 'PRIVATE_EVENT_TEXT',
      role: 'PRIVATE_EVENT_ROLE',
      posterior: 'PRIVATE_POSTERIOR',
      plan: 'PRIVATE_PLAN',
      languageReads: 'PRIVATE_LANGUAGE_READS',
    },
    visibility: { only: [0] },
  }
  canaryView.events.push(privateEvent)

  assert.deepEqual(projectPublicRecord(canaryView), baselineRecord)
  assert.deepEqual(
    projectLanguageInterpreterInput(canaryView).publicContext,
    baselineContext,
  )
  const serialized = JSON.stringify(projectPublicRecord(canaryView))
  for (const canary of [
    'PRIVATE_VIEWER_NAME',
    'PRIVATE_TRANSCRIPT',
    'PRIVATE_NESTED',
    'PRIVATE_QUEST',
    'PRIVATE_BALLOTS',
    'PRIVATE_EVENT',
    'PRIVATE_POSTERIOR',
    'PRIVATE_PLAN',
    'PRIVATE_LANGUAGE_READS',
  ]) {
    assert.ok(!serialized.includes(canary), `${canary} escaped allow-list`)
  }
})

test('only legitimate public names and speech affect their public consumers', () => {
  const game = createGame({
    seed: 'public-record-public-data',
    playerCount: 5,
  })
  const baselineView = viewFor(game, 0)
  const baselineRecord = projectPublicRecord(baselineView)

  const renamed = structuredClone(baselineView)
  renamed.players[0].name = 'PUBLIC_RENAMED_PLAYER'
  const renamedRecord = projectPublicRecord(renamed)
  assert.equal(renamedRecord.players[0].name, 'PUBLIC_RENAMED_PLAYER')
  assert.deepEqual(
    renamedRecord.players.slice(1),
    baselineRecord.players.slice(1),
  )
  assert.deepEqual(
    projectLanguageInterpreterInput(renamed).publicContext,
    renamedRecord,
  )

  const speaking = structuredClone(baselineView)
  const publicSpeech: GameEvent = {
    seq: Math.max(...speaking.events.map((event) => event.seq)) + 1,
    type: 'utterance',
    payload: {
      seat: 1,
      text: 'PUBLIC_UTTERANCE_TEXT',
      round: 1,
      postRevision: false,
    },
    visibility: 'public',
  }
  speaking.events.push(publicSpeech)
  const language = projectLanguageInterpreterInput(speaking)
  assert.deepEqual(language.publicContext, baselineRecord)
  assert.equal(language.newUtterances.at(-1)?.text, 'PUBLIC_UTTERANCE_TEXT')
})

test('language publicContext and dossier render from the shared record on every frozen fixture', () => {
  const fixtures = readDecisionFixtures()
  for (const fixture of fixtures) {
    const record = projectPublicRecord(fixture.view)
    assert.deepEqual(
      projectLanguageInterpreterInput(fixture.view).publicContext,
      record,
      `${fixture.id}: language context drift`,
    )
    assert.equal(
      factsDossier(fixture.view),
      factsDossierFromPublicRecord(record, fixture.view.seat),
      `${fixture.id}: dossier renderer drift`,
    )
  }

  const digest = crypto.createHash('sha256').update(JSON.stringify(
    fixtures.map((fixture) => factsDossier(fixture.view)),
  )).digest('hex')
  assert.equal(
    digest,
    'a831f86ac4ceadffd897b88bf1955ca5b5d96b08b5779ff83b6f6b3ca22cd2a7',
    'compatibility dossier bytes changed across the frozen architecture bank',
  )
  const languageDigest = crypto.createHash('sha256').update(JSON.stringify(
    fixtures.map((fixture) =>
      projectLanguageInterpreterInput(fixture.view)),
  )).digest('hex')
  assert.equal(
    languageDigest,
    '2d842571020dbcf56b65b46d9adbcc3b579c0f6e5ac863d79938ffaeb619c929',
    'public language input bytes changed across the frozen architecture bank',
  )
})

test('public record projection returns detached nested data', () => {
  const fixture = readDecisionFixtures()[0]
  const view = structuredClone(fixture.view) as PlayerView
  const record = projectPublicRecord(view)
  const before = structuredClone(view)

  ;(record.players as { seat: number; name: string }[])[0].name = 'MUTATED'
  ;(record.rolesInPlay as string[])[0] = 'MUTATED'
  ;(record.quests as { team?: number[] }[])[0].team?.reverse()
  ;(record.proposals as { team: number[] }[])[0]?.team.reverse()
  ;(record.currentTeam as number[] | undefined)?.reverse()

  assert.deepEqual(view, before)
})
