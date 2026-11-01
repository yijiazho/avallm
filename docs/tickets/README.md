# Implementation tickets: game archive, post-game review, cross-game memory

**Status:** proposed, unstarted. Written 2026-11-01.
Source designs: [design-game-archive.md](../design-game-archive.md),
[design-postgame-review.md](../design-postgame-review.md),
[design-cross-game-memory.md](../design-cross-game-memory.md).

A rematch was considered and dropped: replaying a cast with reshuffled roles makes historical role
memories misleading. Cross-game memory is therefore scoped to **games the same agent descriptor
played before**, with other seats' historical roles hidden by default.

## How to use a ticket

1. Read the linked design section before changing code.
2. A ticket is done only when every acceptance criterion is checked, the listed tests exist and
   pass, and the relevant docs are updated.
3. Every new test file starts with a `// test-lane: <lane>` marker. The valid lanes are
   `fast`, `contract`, `eval`, `exhaustive`, and `perf`; `npm run test:lanes` fails on a missing or
   duplicate marker.
4. Run at least `npm run typecheck`, the ticket's own tests, and `npm run test:lanes`. Run
   `npm run verify:contract` when the ticket touches agent layering, engine imports, or prompt text.
5. Do not implement a feature beyond its ticket. Adjacent ideas belong in a new ticket or the
   design doc's open questions.

## Dependency graph

```
SHARED-001  data root + atomic JSON I/O
    |
    +--> ARCH-001  archive record + writer + boot index
    |       |
    |       +--> ARCH-002  fidelity + retention + delete
    |       |       |
    |       |       +--> ARCH-003  read API + previous-games UI
    |       |       |
    |       |       +--> MEM-001   history selection + digest
    |       |                       |
    |       |                       +--> MEM-002  history transport + prompt slot
    |       |                                       |
    |       |                                       +--> MEM-003  config + UI + measurement
    |       |
    |       +--> ARCH-004  corpus import/export + dual-write
    |

SHARED-002  shared speech sanitizer
    |
    +--> REVIEW-001  post-game projection + prompt + parser
            |
            +--> REVIEW-002  runner + persistence
                    |
                    +--> REVIEW-003  API + reveal UI + human note
```

REVIEW-001 can start before ARCH-001 because it only needs a finished fixture game and
SHARED-002. REVIEW-002 needs the archive writer from ARCH-001. MEM-001 needs ARCH-001,
ARCH-002, and SHARED-002.

## Ticket index

| ID | Title | Depends on | Size | Design |
|---|---|---|---|---|
| SHARED-001 | Data root and atomic JSON I/O | none | S | archive §Where it lives, §Write path |
| SHARED-002 | Shared speech sanitizer | none | XS | review §What the prompt sees; memory §What the block says |
| ARCH-001 | Archive record, writer, boot index | SHARED-001 | M | archive §Design, §Write path, §Read path |
| ARCH-002 | Archive fidelity, retention, delete | ARCH-001 | M | archive §Fidelity, §Retention |
| ARCH-003 | Archive read API and previous-games UI | ARCH-001, ARCH-002 | M | archive §HTTP surface |
| ARCH-004 | Artifact corpus import/export and dual-write | ARCH-001 | S | archive §Relationship to the artifact corpus |
| REVIEW-001 | Post-game projection, prompt, parser | SHARED-002 | M | review §Record shape, §Projection, §Not a LlmCallKind |
| REVIEW-002 | Post-game runner and persistence | REVIEW-001, ARCH-001 | M | review §Scheduling and failure |
| REVIEW-003 | Review API and reveal UI | REVIEW-002 | M | review §Presentation, §Human seats |
| MEM-001 | History selection and digest | ARCH-001, ARCH-002, SHARED-002 | M | memory §Scope, §Digest |
| MEM-002 | History transport and prompt slot | MEM-001 | M | memory §Prompt placement, §Transport |
| MEM-003 | History configuration, UI, measurement | MEM-002 | M | memory §Configuration, §Cost |

Sizes are relative: S is a focused day, M is a few days, and every M includes its tests.

## Common definition of done

- [ ] `npm run typecheck` passes.
- [ ] New tests carry a lane marker and the ticket's test plan passes.
- [ ] `npm run test:lanes` reports no unclassified or double-classified test.
- [ ] No new runtime dependency in the root package (the server stays zero-dependency).
- [ ] The relevant design doc is updated if implementation departs from it.
- [ ] User-visible strings follow the prompt house style only if they reach a model; UI copy is
      ordinary product copy.
- [ ] Failure paths are logged and never take a running game down.
