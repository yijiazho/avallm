# Phase 7R3A score-equivalence oracle

This temporary migration oracle freezes score-policy behavior from the clean
Phase 7R2C exit commit
`b9f710389d2dfad03ec03e85313f672872c2b825`.

The JSON records exact mechanical decisions, candidate scores and feature
payloads, viability, reasons, forced-policy results, degradation, causal-use
attribution, selected IDs, and bounded planner/voice inputs. It deliberately
does not freeze the resolved architecture descriptor's `scoreLayerOrder` or
the architecture identity digest derived from that ordered field. Those
values must change when the score layers become native registered layers.
The configured component plan, component versions, runtime component
coverage, and causal-use attribution remain frozen. No other behavior delta
is waived.

Every stored request/view pair comes from an actual legal proposal or vote
boundary. Existing frozen decision fixtures are read from an explicit path
under the pinned source root; missing role/kind cells are reconstructed by
running a deterministic architecture-bank game and replaying its completed
artifact. The capture rejects proposal views that already contain the current
proposal and vote views whose current team, proposal record, and visible
proposal event disagree.

`tools/capture-phase7r3a-score-oracle.mjs` is archival. It refuses a dirty
source or any source commit other than the hash above, so it cannot be run on a
new implementation to approve a policy change. The assertion test reads only
the static JSON and Node standard-library modules; it does not import or
recreate a legacy scorer. The future native-runner comparison should consume
the stored request, view, seed, and logical configuration from each scenario.

Delete the capture tool, JSON fixture, this note, and the fixture-integrity
test only after every Phase 7R3A score family has retired its legacy scorer
writer and exemption, the native runner compares equal over this full surface,
operation budgets pass, and the Phase 7R3A exit audit approves removal. Do not
change or regenerate this oracle to bless an intentional policy change; put
that change behind separately reviewed policy fixtures.
