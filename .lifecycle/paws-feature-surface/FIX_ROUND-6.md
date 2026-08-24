# FIX_ROUND-6

Angles: **correctness** + **design-conformance** (required), both blind, over
**round 5's diff only** (`2072c29c7..HEAD`).

## What the round found

3 rows, all LOW. **Both angles explicitly reported no real defect** — the
correctness angle compiled and ran everything and said "no real defects found";
the design angle declared the surviving-surface sweep clean for the second
consecutive round. What remained was three pieces of my own polish that did not
fully deliver what their comments claimed:

1. **Corroborated (both angles): my round-5 quiesce heuristic narrowed the
   false-pass window rather than closing it.** Settling required only two reads
   100 ms apart agreeing on `names.len()`, so an offender whose upsert landed in
   a quiet gap still slipped through, and a same-size set swap was invisible to a
   length comparison — while my comment implied the window was shut. Closed
   properly: the ENABLED server now runs first, the surviving built-in set is
   DERIVED from that real boot, and the disabled server waits for every one of
   those names. No window, and no hardcoded list that could go stale in the
   direction that weakens the test.
2. The round-5 renderer gate was the only consumer of the hidden list with no
   injectable set and no test — reversible but unproven. Extracted
   `citationChipNumber(href, hidden?)` as a pure function and tested both
   directions.
3. The header's consumer enumeration went stale **again**. It is now written as
   classes, not files, with the reason recorded: this list went stale in three
   consecutive rounds, twice in the very commit instructing the reader to keep it
   current. A hand-maintained enumeration that fails three times is the wrong
   mechanism, not a discipline problem.

## Termination

**Loop terminates at the round cap. Reason: CAP reached with an EMPTY open set.**

- Profile: **26 → 25 → 16 → 11 → 7 → 3**, monotonic across all six rounds, each
  over a smaller diff than the last.
- **Rounds 5 and 6 produced no product defect between them.** Every finding in
  both was either polish on the previous round's own fixes or documentation
  accuracy. The audit stopped being about the feature two rounds ago.
- **Open set: 0 of 82.** 63 fixed, 18 wontfix (each with a recorded reason), 1
  obsolete.
- GUARD-SUB never fired in any round; no round put ≥60% of its findings on one
  test or guard file.

The skill's cap rule escalates at six rounds **with findings still open**. Nothing
is open, so there is nothing to escalate on that count — but I am stopping at six
regardless rather than chasing a zero-finding round. The skill is explicit that
"repeat until 0" is unsound: a reviewer with any false-positive rate can emit a
finding on any round, and rounds 5-6 demonstrated exactly that dynamic, each
producing only LOW polish on the round before it. Continuing would be paying for
reviewer noise, not defect detection.

**Two items go to the owner rather than into another round** (both recorded in
`HUMAN_FEEDBACK.md` and the PR body): the citations built-in auto-attaching to
every tool-capable chat, and `control_mcp` letting the model enumerate hidden
features. Both need a server-side kill switch for a UI-only item, which the
design explicitly defers.

**New confirmed findings:** 3
