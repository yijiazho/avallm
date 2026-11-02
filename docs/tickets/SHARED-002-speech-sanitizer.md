# SHARED-002 — Shared speech sanitizer

- **Status:** implemented 2026-11-02 (PR #3)
- **Depends on:** none
- **Blocks:** REVIEW-001, MEM-001
- **Design:** none; refactor required by both designs
- **Size:** XS

## Description

`sanitizeSpeech` currently lives in `server/agents/raw-llm/prompts.ts`. Both the post-game review
prompt and the cross-game history renderer must sanitize player-authored text, and neither should
have to import the live decision-prompt module to do it.

Move the function to a pure shared module and re-export it from its old home so every existing
caller keeps working. Behavior must be byte-for-byte identical.

## Implementation plan

1. Add `server/shared/speech.ts` with the existing implementation and its comment about stripping
   markup that could pose as system or format directives.
2. Delete the local definition in `server/agents/raw-llm/prompts.ts` and re-export:
   `export { sanitizeSpeech } from '../../shared/speech.ts'`.
3. Keep the 400-character cap and the regex order exactly as they are. This is a move, not a
   cleanup.
4. Add a fixture corpus (markup, `[INST]`, `<<SYS>>`, `<|...|>`, excess whitespace, a 500-char
   string) and assert the moved function returns the same output as a frozen expected snapshot.

### Files

- `server/shared/speech.ts` (new)
- `server/agents/raw-llm/prompts.ts` (re-export only)
- `test/shared/speech.test.ts` (new)

## Acceptance criteria

- [x] `sanitizeSpeech` is importable from `server/shared/speech.ts` and from
      `server/agents/raw-llm/prompts.ts` with identical behavior.
- [x] No existing import site changes.
- [x] `server/shared/speech.ts` imports nothing (ARCH019 purity stays green).
- [x] Output is unchanged on the full fixture corpus, including the 400-character truncation.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Behavior preserved | `test/shared/speech.test.ts`: fixture inputs → frozen expected outputs |
| Old import path works | same file: import from both paths and compare |
| Purity | `npm run verify:contract` (ARCH019) |
| No production regression | `node --test test/agents/prompts/*.test.ts` (existing prompt suites) |

Run:

```
node --test test/shared/speech.test.ts
npm run typecheck
npm run verify:contract
```

## Implementation notes

- `server/shared/speech.ts` owns the moved function verbatim, with no imports.
- `server/agents/raw-llm/prompts.ts` imports the shared binding and re-exports it. The local import
  is deliberate: `export { sanitizeSpeech } from ...` alone would not bind the name for the four
  existing call sites inside that module.
- `test/shared/speech.test.ts` freezes seven fixture outputs and asserts both import paths are the
  same function. Verified with the ticket tests, `npm run typecheck`, the existing prompt suites,
  and `npm run verify:contract`.

## Risks and notes

- Do not "improve" the regex while moving it. A behavior change here reaches every prompt and every
  review renderer at once.
- The function is pure, so `server/shared/` is the right home despite the name sounding
  domain-specific.
