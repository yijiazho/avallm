// Avalon-NLU -> the structured game record this repository actually consumes.
//
// Upstream is 1.2 MB, and almost all of it is dialogue plus persuasion and
// deception annotations that no factor reads. Vendoring that wholesale would
// add a megabyte of chat we never open, so this distills the mechanical record
// (roles, proposals, ballots, quest outcomes) to roughly 30 KB and the
// distiller is committed beside its output. That keeps the transform auditable:
// re-clone upstream, re-run this, and diff the fixture.
//
// The dialogue is deliberately dropped rather than lost. If the language factor
// is ever measured (see BELIEF_FACTORS['language-factor'].revisit), upstream
// carries utterance-level persuasion and deception labels, which is exactly the
// input that work would need. Re-run this with a wider projection then.
//
// Usage:
//   git clone --depth 1 https://github.com/sstepput/Avalon-NLU.git
//   node tools/distill-human-games.mjs <path-to-clone>
//
// Provenance and licence live in the emitted fixture, not only here, because
// the fixture is the file that travels.

import fs from 'node:fs'
import path from 'node:path'

const SOURCE = {
  name: 'Avalon-NLU',
  url: 'https://github.com/sstepput/Avalon-NLU',
  paper: 'https://arxiv.org/abs/2311.05720',
  licence: 'MIT, Copyright (c) 2023 Simon',
  retrieved: '2026-08-01',
}

const EVIL_ROLES = new Set(['assassin', 'morgana'])

function distillGame(id, raw) {
  const roleBySeat = []
  const seatOfName = new Map()
  for (const user of Object.values(raw.users)) {
    // Upstream numbers players from 1 and suffixes duplicate roles
    // ("servant-1"); seats here are 0-based and roles are the bare engine name.
    const seat = user.index - 1
    roleBySeat[seat] = user.role.replace(/-\d+$/, '')
    seatOfName.set(user.name, seat)
  }
  const proposals = []
  let pending = null
  for (const message of Object.values(raw.messages)) {
    if (message.player !== 'system') continue
    const proposed = /^(player-\d+) proposed a party: (.+)$/.exec(message.msg)
    if (proposed) {
      const team = proposed[2]
        .split(',')
        .map((name) => seatOfName.get(name.trim()))
        .filter((seat) => seat !== undefined)
      if (!team.length) continue
      // A proposal with no recorded ballot is still a proposal: the leader
      // committed to a team. Flushed unvoted if the next system line is
      // another proposal.
      if (pending) proposals.push(pending)
      pending = {
        quest: message.quest,
        leader: seatOfName.get(proposed[1]),
        team,
        votes: null,
      }
      continue
    }
    const outcome = /^party vote outcome: (.+)$/.exec(message.msg)
    if (outcome && pending) {
      const votes = []
      for (const part of outcome[1].split(',')) {
        const hit = /(player-\d+):\s*(yes|no)/.exec(part)
        if (!hit) continue
        votes.push({ seat: seatOfName.get(hit[1]), approve: hit[2] === 'yes' })
      }
      pending.votes = votes
      proposals.push(pending)
      pending = null
    }
  }
  if (pending) proposals.push(pending)
  return {
    id,
    playerCount: roleBySeat.length,
    roleBySeat,
    evilSeats: roleBySeat
      .map((role, seat) => (EVIL_ROLES.has(role) ? seat : -1))
      .filter((seat) => seat >= 0),
    proposals,
  }
}

const clone = process.argv[2]
if (!clone) {
  console.error('usage: node tools/distill-human-games.mjs <path-to-Avalon-NLU>')
  process.exit(2)
}
const dir = path.join(clone, 'dataset')
const games = fs.readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => distillGame(
    name.replace(/\.json$/, ''),
    JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
  ))

const out = {
  source: SOURCE,
  note:
    'Distilled by tools/distill-human-games.mjs. Mechanical record only; '
    + 'upstream also carries dialogue with persuasion and deception labels.',
  games,
}
const target = 'server/eval/fixtures/human-games.json'
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`)
const proposals = games.reduce((sum, game) => sum + game.proposals.length, 0)
const ballots = games.reduce(
  (sum, game) => sum + game.proposals.reduce(
    (n, p) => n + (p.votes?.length ?? 0), 0), 0)
console.log(
  `${target}: ${games.length} games, ${proposals} proposals, ${ballots} ballots`)
