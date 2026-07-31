// test-lane: fast
// Spoiler guard for the feed's reveals.
//
// The failure this prevents: the feed plays the game's turning points as
// animations, while every other surface reads the same payload the animation is
// built from and renders the answer instantly. Two ways that showed up. The board
// above the transcript flipped a quest to SUCCESS/SABOTAGE roughly three seconds
// before the card turned over, so the reveal had nothing left to reveal. And the
// endgame screen replaced the feed outright the moment the game ended, so the
// deciding quest was never revealed at all.
//
// The fix is a single gate (client/src/revealPacing.ts): App holds a quest at its
// pre-result shape until the reveal lands, hands that held view to everything
// that is not the feed, and keeps the endgame screen off the stage until the
// closing beat has played. The bug shape recurs for any NEW surface that reads
// quest outcomes (a score plaque, a mobile summary) and is wired to the raw view
// without a thought about timing, and for any new ENDING that nobody paces, so
// both rules are enforced structurally here rather than remembered per site.
//
// Sizes and fails-required are not outcomes (they are dealt at game start), so a
// component reading only those is none of this test's business.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIN_REASONS } from '../client/src/setup.ts'

const clientSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'src',
)
const read = (...parts: string[]) => fs.readFileSync(path.join(clientSrc, ...parts), 'utf8')

// The identifier App binds the held view to. Named here so a rename has to be
// deliberate rather than silently turning this test into a no-op.
const HELD_VIEW = 'gatedView'

// The feed IS the reveal: it renders the questResult event and owns the
// animation, so it necessarily reads the outcome the moment it arrives. It is
// the one component that must take the raw view.
const REVEAL_OWNER = 'Feed.tsx'

// A component reads a quest outcome if it reaches into the view's quests AND
// touches a field that only a resolved quest carries.
const readsQuests = /view\.quests/
const readsOutcome = /'complete'|\.result\b|\.failCount\b/

const outcomeReaders = fs.readdirSync(path.join(clientSrc, 'components'))
  .filter((f) => f.endsWith('.tsx'))
  .filter((f) => {
    const src = read('components', f)
    return readsQuests.test(src) && readsOutcome.test(src)
  })

test('some client component reads quest outcomes', () => {
  // Guards the detector itself: if the regexes stop matching anything, the
  // per-component assertions below all pass vacuously.
  assert.ok(
    outcomeReaders.length > 0,
    'no component matched the quest-outcome detector; the regexes have gone stale',
  )
})

test('every quest-outcome reader is rendered from the held view', () => {
  const app = read('App.tsx')
  for (const file of outcomeReaders) {
    if (file === REVEAL_OWNER) continue
    const component = file.replace(/\.tsx$/, '')
    // Every `<Component ... view={x}` site in App, whatever else it is passed.
    const sites = [...app.matchAll(
      new RegExp(`<${component}\\b[^>]*?\\bview=\\{([A-Za-z0-9_.?]+)\\}`, 'gs'),
    )]
    assert.ok(
      sites.length > 0,
      `${file} reads quest outcomes but App never renders it with a view; `
      + 'either it is dead code or this test can no longer see how it is fed',
    )
    for (const [, bound] of sites) {
      assert.equal(
        bound, HELD_VIEW,
        `<${component} view={${bound}}> renders quest outcomes from the raw view, `
        + `so it will spoil the result while the feed is still flipping the card. `
        + `Pass ${HELD_VIEW} (see client/src/revealPacing.ts).`,
      )
    }
  }
})

test('the feed owns the reveal and takes the raw view', () => {
  const app = read('App.tsx')
  const site = app.match(/<Feed\b[^>]*?\bview=\{([A-Za-z0-9_.?]+)\}/s)
  assert.ok(site, 'App no longer renders <Feed view={...}>')
  assert.notEqual(
    site[1], HELD_VIEW,
    'the feed renders the questResult reveal itself; feeding it the held view '
    + 'would hold the reveal back against its own release and stall it forever',
  )
})

test('the hold outlasts the reveal animation', () => {
  const gate = read('revealPacing.ts')
  const declared = gate.match(/QUEST_REVEAL_MS = (\d+)/)
  assert.ok(declared, 'revealPacing.ts no longer declares QUEST_REVEAL_MS')
  const holdMs = Number(declared[1])

  // The animation the hold is waiting on. A retune of the CSS that nobody
  // mirrors here would silently shorten the gate back into a spoiler.
  const css = read('styles.css')
  const block = css.match(/\.feed-row\.questreveal[\s\S]*?\n\}/)
  assert.ok(block, 'the .feed-row.questreveal rule is gone; re-point this check')
  const durations = [...css.matchAll(/\bq(?:gather|reveal|frame-ok|frame-bad)\b[^;}]*?([\d.]+)s/g)]
    .map((m) => Number(m[1]) * 1000)
  assert.ok(durations.length > 0, 'no quest-reveal animation durations found in styles.css')
  const longest = Math.max(...durations)
  assert.ok(
    holdMs >= longest,
    `QUEST_REVEAL_MS is ${holdMs}ms but the reveal animation runs ${longest}ms; `
    + 'the board would flip while the card is still turning',
  )
})

test('every ending the client can name is paced', () => {
  // WIN_REASONS is the client's own list of engine endings (it spells each one
  // out for the winner banner), so a new ending reaches this test the moment
  // someone teaches the client to render it. An unpaced ending is not a crash:
  // the endgame screen simply cuts the feed off mid-animation again, which is
  // exactly the regression that is easy to ship and hard to notice.
  const gate = read('revealPacing.ts')
  const table = gate.match(/CLOSING_BEAT_MS[^=]*= \{([\s\S]*?)\n\}/)
  assert.ok(table, 'revealPacing.ts no longer declares a CLOSING_BEAT_MS table')
  const paced = new Set([...table[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]))
  for (const reason of Object.keys(WIN_REASONS)) {
    assert.ok(
      paced.has(reason),
      `the '${reason}' ending has no entry in CLOSING_BEAT_MS, so the endgame `
      + 'screen will replace the feed the instant it lands, cutting off whatever '
      + 'the feed was still playing. Give it the duration of its closing beat.',
    )
  }
})

test('no closing beat re-budgets the quest reveal it already waited out', () => {
  // The beat starts only once `questTurning` clears, so the time the card spent
  // turning is already spent. An entry that adds QUEST_REVEAL_MS on top counts
  // it twice: the ending that shipped this way held the endgame screen for 7.3s
  // instead of 4.1s, and the extra four seconds read as the app having hung.
  const gate = read('revealPacing.ts')
  const table = gate.match(/CLOSING_BEAT_MS[^=]*= \{([\s\S]*?)\n\}/)
  assert.ok(table, 'revealPacing.ts no longer declares a CLOSING_BEAT_MS table')
  for (const [line, reason] of [...table[1].matchAll(/^\s*(\w+):(.*)$/gm)].map((m) => [m[2], m[1]])) {
    assert.doesNotMatch(
      line, /QUEST_REVEAL_MS/,
      `the '${reason}' beat budgets QUEST_REVEAL_MS, but the beat does not start `
      + 'until the card has finished turning. Budget only what is owed AFTER that.',
    )
  }
})

test('the endgame screen is gated on the paced flag, not the raw phase', () => {
  const app = read('App.tsx')
  assert.match(
    app, /\{showOutcome \? \(/,
    'App no longer branches the endgame screen on the paced flag',
  )
  assert.doesNotMatch(
    app, /\{gameOver \? \(/,
    'App renders the endgame screen straight off the gameOver phase again, which '
    + 'unmounts the feed while it is still playing the moment that ended the game. '
    + 'Branch on showOutcome (see client/src/revealPacing.ts); `gameOver` is for '
    + 'the prefetch, which SHOULD fire immediately.',
  )
})
