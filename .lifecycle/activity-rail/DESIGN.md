# DESIGN — Chat activity rail (Direction C)

**Status: APPROVED by the owner (2026-07-27).** Chosen over Direction A (quiet machinery) and
Direction B (one run card) after a three-direction comparison.

Rendered design of record (mockups, states, anatomy, 390px behaviour):
- Direction comparison — https://claude.ai/code/artifact/c95e0e8a-822b-4bce-bd2c-a1562d728a60
- **Direction C specification** — https://claude.ai/code/artifact/2204f1f0-58b3-4ebb-b93a-2776ce4990f2

This file is the in-repo design source the plan is derived from. Its `## Non-negotiables` are lifted
verbatim into `PLAN.md`'s `## Invariants` and must not be paraphrased.

## Problem (measured, not asserted)

- A realistic agentic turn renders **~18 bordered boxes, ~9 of them expanded**, across **36 distinct
  card-like surfaces** in the message stream.
- One reviewed conversation renders **14 boxes, 7 of them "Thinking"**, wrapped around a single line
  of answer; its worst message is **23 blocks → 23 rendered items, 0 collapsed**.
- The largest multiplier is not the tool card but `InlineFilePreview` — one bordered box **per
  resource link, per tool result, expanded by default**.
- Six surfaces answer "open by default?" six different ways. There is no policy, only sediment.
- The obvious cheap fix is a **measured no-op**: treating `thinking` as run-continuing changes the
  card count by **exactly zero** across every population in the database.

## Shape

Work becomes a thin timeline beside the answer instead of a stack of boxes in front of it. Core owns
a rail registry and a row primitive. **Each extension contributes its own step descriptor and detail
body.** Steps carry status, label, detail and timing. Detail is reachable at three depths: the row,
an inline expansion rendered by the owning extension, and a right-panel tab with the full record.

## Non-negotiables

These are the design's promises. Each is lifted verbatim into `PLAN.md` `## Invariants`, given a
fidelity verdict in phase 2, and pinned to an executable acceptance test in phase 3.

- **The rail never imports, names, or special-cases any extension; each extension contributes its own
  step descriptor and detail body.**
- **Every detail reachable today must remain reachable, ideally better.**
- **Anything that needs the user breaks out of the rail: a request for input is never collapsed into
  a rail row.**
- **The rail is open while the turn is working and collapsed once the answer exists.**
- **A failed or timed-out step forces the rail open; a failure is never hidden inside a collapsed
  summary.**
- **The rail removes machinery boxes only. Content boxes — code, tables, alerts — stay, because they
  are the answer.**
- **The rail's expanded state survives scrolling: it is keyed by message, not held in component
  state.**
- **At 390px the step label truncates and never wraps.**
- **There is exactly one status vocabulary; the rail reuses the existing one rather than defining a
  second.**

## Explicitly out of the rail

`text`, `observation` (a background sub-agent result that
arrives asynchronously and is a message, not a step), user attachments and images lifted above the
bubble, the summary boundary marker, and all composer chrome.

> **AMENDED by DEC-13 (2026-07-29).** `thinking` was originally on this list and has been REMOVED.
> Reasoning is now a rail step contributed by the `text` extension. The exclusion was never argued
> (unlike `observation`, which has DEC-11), and it left the rail solving at most half of the very
> problem stated above — "14 boxes, 7 of them Thinking". See DECISIONS.md § DEC-13.

## Rejected alternatives

- **Direction A (quiet machinery)** — demotes reasoning to a muted line but leaves grouping untouched;
  a six-call turn still stacks six boxes.
- **Direction B (one run card)** — same grouping win as C, delivered as a bordered container. Rejected
  because it keeps the machinery as a box in front of the answer rather than a timeline beside it.
- **A rail that collects other extensions' content** — rejected by the owner as an anti-pattern, and
  the codebase already demonstrates why: `workflow/components/run/activityDescriptors.ts` hardcodes
  nine other modules' tool names in one central map.
