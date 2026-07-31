import { useEffect, useRef, useState } from 'react'
import type { PlayerView } from './types.ts'

// The feed plays the game's turning points as animations, and everything else on
// screen reads the same payload the animation is built from. Left alone, the rest
// of the UI answers the question the feed is still asking: the board flipped a
// quest to SUCCESS/SABOTAGE the instant the result landed, three seconds ahead of
// the card turning over, and the endgame screen replaced the feed outright, so
// the deciding quest never got to be revealed at all.
//
// This module is the one place that knows what the feed is still playing. Every
// surface that would otherwise resolve early waits on it.

// The quest as a view carries it (deeply readonly), which is the shape the hold
// has to produce as well.
type ViewQuest = PlayerView['quests'][number]

// The questResult reveal is a ~3s mount animation (.feed-row.questreveal in
// styles.css): the sealed cards gather, shuffle, and only then does the face turn
// over. A small cushion past the 3s, so the card has fully landed before anything
// else speaks. The assassin beat in the feed waits on this same constant.
export const QUEST_REVEAL_MS = 3200

// A beat of stillness after a closing animation lands, so the result reads as a
// finished thing (flipped card, spread, caption) before the endgame screen
// replaces it. Not an animation duration: the pause is the point, and it is
// spent on top of the animation rather than including it.
const SETTLE_MS = 900

// The Knife lands as a single narrated line, whose entrance animation is only
// 450ms (.feed-row.moment). So this is not an animation sync like the quest
// reveal: it is reading time for "X names Y as Merlin. Correct." before the
// screen changes underneath it. The endgame screen repeats the mark, so what is
// at stake here is pacing, not information.
const ASSASSIN_BEAT_MS = 2600

// How long the endgame screen waits AFTER the feed has finished the moment that
// ended the game, keyed by the engine's win reason (server/engine/game.ts
// endGame). Time already spent turning a card is not counted here: the beat
// starts only once `questTurning` clears, so a quest ending owes nothing but the
// settle. An ending this table does not know holds nothing, so a new reason
// degrades to today's behavior (show the outcome at once) rather than stalling
// the screen on a guess. test/reveal-pacing.test.ts makes adding one a
// deliberate act rather than an omission.
const CLOSING_BEAT_MS: Record<string, number> = {
  threeQuests: SETTLE_MS,
  threeFails: SETTLE_MS,
  merlinAssassinated: ASSASSIN_BEAT_MS,
  assassinMissed: ASSASSIN_BEAT_MS,
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

// A resolved quest, read back as the pending card it was a moment ago. The Quest
// union makes this exact: dropping the outcome fields is not "blanking a result",
// it is selecting the other member.
const unresolved = (q: ViewQuest): ViewQuest =>
  ({ num: q.num, teamSize: q.teamSize, failsRequired: q.failsRequired, status: 'pending' })

export interface RevealPacing {
  // The view as every surface outside the feed should read it: a quest whose
  // reveal is still turning is held at its pre-result shape, and the round is
  // held with it so the card keeps its "current" glow right through the flip.
  //
  // One gate rather than a timer per component, so a new surface that renders
  // quest results (a score plaque, a mobile summary) cannot forget to wait: it
  // reads the held view like the rest and is correct by construction.
  view: PlayerView | null
  // Whether a quest card is still turning over in the feed. The feed itself has
  // to know: the game's closing lines arrive in the same payload as the result
  // that caused them, and naming a winner (or naming Merlin, which means good
  // took three quests) over a card mid-flip answers it.
  questTurning: boolean
  // Whether the endgame screen may take the stage. False while the feed is still
  // playing the moment that ended the game. This is NOT "the game is over": a
  // caller that wants the fact rather than the presentation (prefetching the
  // reveal payload) should read the phase directly.
  showOutcome: boolean
}

// Takes a nullable view because App calls this above its own no-payload return,
// where the game has not been dealt yet; a null view also rebaselines the hook
// for the next game.
export function useRevealPacing(view: PlayerView | null): RevealPacing {
  const [held, setHeld] = useState<readonly number[]>([])
  const [closingDone, setClosingDone] = useState(false)
  // Quests already resolved the first time this client saw the game. A reload
  // mid-game, or a spectator pulling up a chair at quest 4, must not blank out
  // reveals they were never present for.
  const seen = useRef<Set<number> | null>(null)
  // Whether this client ever saw the game live. Landing straight on a finished
  // game has no closing animation to wait for, for the same reason.
  const everLive = useRef(false)
  // Rounds that already have a release timer running.
  const timed = useRef(new Set<number>())
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  // Drop the started-timers bookkeeping along with the timers themselves.
  // Keeping it would let the guard in the release effect suppress the restart
  // after a remount (main.tsx runs under StrictMode), leaving a card face-down
  // with no timer left to turn it over and no way for showOutcome to arrive.
  useEffect(() => () => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
    timed.current.clear()
  }, [])

  // Keyed on the resolved set rather than the view object: the payload is
  // replaced wholesale on every SSE message, and almost none of them resolve a
  // quest.
  const resolvedKey = view
    ? view.quests.filter((q) => q.status === 'complete').map((q) => q.num).join(',')
    : null
  const [lastKey, setLastKey] = useState<string | null>(null)

  // Taken DURING RENDER, not in an effect. An effect runs after React has
  // committed the payload, so the board gets to paint the answer for a frame
  // before the hold catches it: the same spoiler, one frame long. Adjusting
  // state here makes React redo the render before painting, so the hold lands in
  // the same commit as the result it is holding. (The `seen` writes below are
  // idempotent — adding to a set twice is adding to a set — so a render React
  // discards or double-invokes leaves the same state behind.)
  if (resolvedKey !== lastKey) {
    setLastKey(resolvedKey)
    if (resolvedKey === null) {
      seen.current = null
      setHeld([])
    } else {
      const rounds = resolvedKey ? resolvedKey.split(',').map(Number) : []
      // A shrinking resolved set is a different game (App outlives any one
      // game), so rebaseline instead of counting the old game's rounds as seen.
      if (seen.current && rounds.length < seen.current.size) seen.current = null
      const first = seen.current === null
      if (first) seen.current = new Set()
      const fresh = rounds.filter((n) => !seen.current!.has(n))
      for (const n of rounds) seen.current!.add(n)
      // Reduced motion skips the reveal animation and lands on the revealed
      // state, so there is nothing to wait for.
      if (!first && fresh.length > 0 && !prefersReducedMotion()) setHeld([...held, ...fresh])
    }
  }

  // Releases are a side effect, so they stay in an effect; the hold itself is
  // already in place from the render above. One timer per round, tracked so a
  // re-run cannot start a second: a later quest resolving must not restart or
  // cancel an earlier card's release and strand it face-down.
  useEffect(() => {
    for (const round of held) {
      if (timed.current.has(round)) continue
      timed.current.add(round)
      timers.current.push(setTimeout(() => {
        timed.current.delete(round)
        setHeld((h) => h.filter((n) => n !== round))
      }, QUEST_REVEAL_MS))
    }
  }, [held])

  const questTurning = held.length > 0
  const over = view?.phase === 'gameOver'
  const reason = (over && view?.outcome?.reason) || ''
  useEffect(() => {
    if (!over) {
      everLive.current = resolvedKey !== null
      setClosingDone(false)
      return
    }
    // The beats run in sequence, not together. A rule-based Assassin answers
    // within milliseconds of the quest that hands them the Knife, so both
    // moments land in one payload; running their clocks in parallel would spend
    // the Knife's reading time while the card was still turning, and then swap
    // the screen in the moment it finally landed. Wait for the card, then start
    // the beat.
    if (questTurning) return
    const beat = everLive.current && !prefersReducedMotion() ? CLOSING_BEAT_MS[reason] ?? 0 : 0
    if (beat === 0) { setClosingDone(true); return }
    timers.current.push(setTimeout(() => setClosingDone(true), beat))
  }, [over, reason, resolvedKey, questTurning])

  const showOutcome = over && closingDone && !questTurning

  if (!view || !questTurning) return { view, questTurning, showOutcome }
  const holding = new Set(held)
  return {
    questTurning,
    showOutcome,
    view: {
      ...view,
      round: Math.min(...held),
      quests: view.quests.map((q) => (holding.has(q.num) ? unresolved(q) : q)),
    },
  }
}
