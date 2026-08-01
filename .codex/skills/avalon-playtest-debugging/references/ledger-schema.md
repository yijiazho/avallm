# Playtest issue ledger schema

Keep one row per suspected root cause and one detail section per issue.

## Required summary columns

- ID: stable `PLT-NNN` identifier.
- Priority: `P0` through `P3`.
- Status: `open`, `investigating`, `fixed`, `validated`, or `parked`.
- Scope: `probabilistic-llm`, `instrumentation`, `engine`, or `raw-llm`.
- Signature: stable detector or manually assigned root-cause signature.
- Occurrences: detector hits, which can exceed the game count.
- Games: distinct affected game count.
- Last seen: ISO date.
- Summary: concise observable failure.

## Priority rubric

- P0: hidden-information leak, rules violation, corruption, uncontrolled spend, or game cannot finish.
- P1: wrong strategic action, action contradicts a committed plan, fallback silently changes behavior, or telemetry prevents trustworthy diagnosis.
- P2: important but non-deterministic weakness, role concealment/exposure, repeated low-quality speech, or a narrow observability gap.
- P3: polish, rare confusion, or speculative one-off.

Within a priority, order by confirmed evidence, distinct games, occurrence count, then expected breadth. Do not multiply opaque scores.

## Detail section

Record state, owner area, first/last seen, games and seats, exact event or trace evidence, expected behavior, suspected component, next discriminating experiment, regression test, and fix/validation notes.

## Deduplication

Merge a finding when the same component boundary and failure mechanism explain it. Split it when the visible symptom is shared but the responsible boundary differs. A transcript label that loses the agent definition and a policy that reverses a support plan are separate issues even when observed in the same vote.
