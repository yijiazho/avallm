// Speech-norm compliance: does the TABLE TALK the bots actually produce follow
// the house style we ask them for?
//
// TABLE_TALK_NORMS bans two constructions by name, and talk-norms.test.ts
// enforces them over OUR rendered prompts. Nothing measured the other side of
// the loop. That asymmetry hid a real number: across 16 recorded games, bot
// speech carried roughly 200 dash-bearing lines per 8-game batch, plus the
// slogan the norms call out explicitly. The prompt side was clean the whole
// time, so the guard we had could never have told us.
//
// The patterns live HERE, once, and the prompt test imports them, so the rule
// and its two detectors cannot drift apart (same reasoning as board.ts owning
// the forced-play triggers for prompts, heuristic and eval alike).
//
// This MEASURES and never enforces. Rewriting a bot's sentence would destroy the
// signal, and worse, would hide which models need the guidance and which do not
// (compliance is known to be model-dependent).

import type { GameArtifact } from './artifact.ts'
import type { Seat } from '../engine/types.ts'

export const SPEECH_NORMS = {
  // "Dashes and semicolons do not: end the sentence and start another one."
  // Semicolons are deliberately NOT detected: the norms mention them, but the
  // prompt-side guard has only ever covered dashes, and matching the existing
  // rule keeps the two detectors honest. Widening it is a separate decision.
  'em-or-en-dash': {
    pattern: /[—–]/,
    norm: 'dashes do not belong in speech, end the sentence and start another one',
  },
  // "Don't coin balanced slogans of the shape \"that's not X, that's Y\"."
  'not-x-that-y': {
    pattern: /\b(is|are|was|were|it'?s|that'?s|this is)\s+not\s+[^.!?;:]{2,60}?,\s*(it'?s|that'?s|it is|that is|they'?re)\b/i,
    norm: 'no balanced "that is not X, that is Y" slogans',
  },
} as const

export type SpeechNorm = keyof typeof SPEECH_NORMS
export const SPEECH_NORM_IDS = Object.keys(SPEECH_NORMS) as SpeechNorm[]

export interface SpeechNormReport {
  turns: number                                   // spoken turns examined
  violations: number                              // turns breaking at least one norm
  byRule: Record<SpeechNorm, number>
  // rule -> agent descriptor -> count. Per AGENT rather than per seat, because
  // the actionable question is which models need the guidance tightened.
  byAgent: Record<SpeechNorm, Record<string, number>>
}

const emptyReport = (): SpeechNormReport => ({
  turns: 0,
  violations: 0,
  byRule: Object.fromEntries(SPEECH_NORM_IDS.map((r) => [r, 0])) as Record<SpeechNorm, number>,
  byAgent: Object.fromEntries(SPEECH_NORM_IDS.map((r) => [r, {}])) as Record<SpeechNorm, Record<string, number>>,
})

// Every string a seat says ALOUD. Pitches and revision reasons count: they are
// read by the whole table and rendered into everyone's next prompt exactly like
// an utterance, so a dash in a pitch does the same work as a dash in a reply.
function spokenTurns(a: GameArtifact): { seat: Seat; text: string }[] {
  const out: { seat: Seat; text: string }[] = []
  for (const ev of a.log) {
    const p = ev.payload as Record<string, unknown>
    const push = (seat: unknown, text: unknown) => {
      if (typeof seat === 'number' && typeof text === 'string' && text.trim()) {
        out.push({ seat: seat as Seat, text })
      }
    }
    if (ev.type === 'utterance') push(p.seat, p.text)
    else if (ev.type === 'proposal') push(p.leader, p.pitch)
    else if (ev.type === 'proposalRevised') push(p.leader, p.reason)
  }
  return out
}

export function speechNorms(a: GameArtifact): SpeechNormReport {
  const report = emptyReport()
  for (const { seat, text } of spokenTurns(a)) {
    report.turns++
    const agent = a.players[seat]?.agent ?? `seat ${seat}`
    let broke = false
    for (const rule of SPEECH_NORM_IDS) {
      if (!SPEECH_NORMS[rule].pattern.test(text)) continue
      broke = true
      report.byRule[rule]++
      report.byAgent[rule][agent] = (report.byAgent[rule][agent] ?? 0) + 1
    }
    if (broke) report.violations++
  }
  return report
}

// Fold one game's report into a running total, so a batch reports once.
export function mergeSpeechNorms(into: SpeechNormReport, add: SpeechNormReport): SpeechNormReport {
  into.turns += add.turns
  into.violations += add.violations
  for (const rule of SPEECH_NORM_IDS) {
    into.byRule[rule] += add.byRule[rule]
    for (const [agent, n] of Object.entries(add.byAgent[rule])) {
      into.byAgent[rule][agent] = (into.byAgent[rule][agent] ?? 0) + n
    }
  }
  return into
}

export const newSpeechNormReport = emptyReport
