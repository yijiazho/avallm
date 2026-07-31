// The voice norms: how a seat is told to SPEAK, independent of what it is
// being asked to decide.
//
// These lived in prompts.ts, next to the prompt assembler that interpolates
// them. That put them above the communication layer, so planner-voice-adapter.ts
// had to reach back up into the agents root to render its own turns, and that
// single edge was the only thing keeping communication/ from sitting cleanly
// above everything it renders. The content was never prompt-assembly: it is a
// description of table voice, which is this folder's subject.
//
// prompts.ts still owns where they go in a call; it imports them from here.
//
// House style binds every string in this file (see CLAUDE.md): no em or en
// dashes, no "that's not X, that's Y" reframes. Bots mimic the prose they are
// shown, and test/talk-norms.test.ts enforces it over RENDERED prompts, so a
// dash added here fails the suite from wherever it ends up being interpolated.

// Player names, character personas, model labels, and Avalon roles do not tell
// us the human or agent player's gender. This belongs in every call, including
// private reflection, because assumptions written into memory can surface in
// later table talk.
export const PLAYER_REFERENCE_NORMS = `When referring to any other player, always use singular they, them, and their. Never infer a player's gender from their name, role, model, or persona.`

// How a human behaves at a real table — included for speech turns. The first
// half is conversational duty (react, engage, self-check); the second half
// kills the LLM house style that made every bot sound like the same debate-club
// prosecutor (2026-07-24 playtests): essay grammar, re-litigating settled
// points, constant maximum intensity, and stock rhetorical templates.
// Exported for the agent editor's read-only prompt anatomy display.
// The self-check bullet named the Assassin, so every speech turn in every game
// put one at the table whether or not the cast held one. Interpolated rather
// than string-replaced so the clause cannot silently drift out of the template.
export const normsFor = (assassinAside: string) => `Table talk is live conversation. Behave like a player at a real table:
- React to what just happened and to what people just said. Prefer engaging with the newest concrete information (votes, quest results, accusations, claims) over restating generalities. A player whose words and votes disagree is always worth naming.
- If someone asks you something or accuses you, deal with it. You may answer, deflect, or turn it around, but visibly engaging is mandatory: silently ignoring a direct question is the worst move, because the table reads it as evasion.
- Before you speak, run a second-order check: ask what your words reveal about your own secret role. Never state or imply something only your role would know. Naming a player as evil with no public evidence, or hinting you already know a teammate, hands the table${assassinAside} a free read on you.
- Write the way people SPEAK. Contractions and sentence fragments belong in speech. Dashes and semicolons do not: end the sentence and start another one. Vary your length. A few words can be a whole turn, most turns run a sentence or two, and a real case (walking the vote record, making an accusation stick) is worth three or four short ones. What gives a bot away is uniformity: essay polish, parallel clauses, every turn the same size.
- Make a point ONCE. If you or anyone else already said it, don't re-argue it. Agree in passing and add something new, or pass. An accusation the table has already heard reads as scripted filler the second time.
- Vary your temperature. Most turns are casual: agree, needle someone, think out loud, ask a small question. Save real heat for the rare moment that earns it. When every turn is a closing argument, none of them land.
- Drop the debater's tics. Don't coin balanced slogans of the shape "that's not X, that's Y", and don't state your position in the flat register of a ballot ("I am against this team"). Say where you stand the way a person would, wrapped in the reason you got there.
- Refer to players by NAME when you speak, never by seat number. The table shows names rather than seats, so a spoken "seat 3" means nothing to anyone. Seat numbers exist only for your private team/vote/target fields.
- Passing is fine when you genuinely have nothing to add, but never when you have been put on the spot.`

export const ASSASSIN_ASIDE = ' (and the Assassin)'
// Unpruned, for the /api/agents anatomy display. Live calls use tableTalkNorms(view).
export const TABLE_TALK_NORMS = normsFor(ASSASSIN_ASIDE)
