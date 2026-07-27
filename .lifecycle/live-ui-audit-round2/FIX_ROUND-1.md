# FIX_ROUND-1 — live-ui-audit round 2

Four blind auditors (12 angles between them, diff-only context, no access to
`.lifecycle/`) reviewed the 24 hunks. Their findings are in `LEDGER.jsonl`.
Eleven were confirmed and fixed; seven were accepted with a recorded rationale;
one was made not-applicable by the mid-flight rebase.

## What the round changed

| ledger | fix |
|---|---|
| L-1 | `afterStreamComplete` now resolves the OWNING pane via `paneRegistry.get(ownerPaneId)`, with the focused-pane bridge only as a fallback — matching both sibling implementations and the hook's own contract |
| L-2 / L-3 | the session-created mark now **expires at the end of every turn** (`applyStreamFrame`, after the extension hooks) instead of lasting the session. This is the fix for two independent HIGHs: a permanently-skipped background probe against a store that DELETES its cached slice on unmount, and a permanently-skipped summary read against a single-entry cache that rotates on every switch |
| L-4 | `loadForConversation(id, { force: true })` for the turn-end read, so the in-flight guard can no longer make it adopt a pre-write answer |
| L-5 | `SummaryBoundaryMarker` now requires `current.conversationId === Chat.conversation?.id` — a single-entry store can hold another conversation's summary, and the marker had no guard at all |
| L-6 | `ensureSessionCreatedTracking` + the background module's `initialize()` **deleted** — provably inert (the direct call in `createConversation` always precedes both `conversation.created` emitters) and it made one module's correctness depend on another being in the load wave |
| L-7 | TEST-2 asserts `toBe(1)`, not `<= 1`, so a regression that removes the read entirely is red |
| L-8 | TEST-9 gained a Send-BUTTON click leg — the Enter path was already guarded by `TextInput`'s own latch on the base branch, so Enter-only proved nothing |
| L-9 | `isSummaryHeld(snapshot, id)` extracted as a named pure function, the unit test now drives the REAL derivation instead of a model of it, and the failed-read case is covered |
| L-10 | the pill's stale "subscribes to `messages.size` / DO NOT move the trigger" header and the marker's contradictory new comment both rewritten |
| L-11 | the skip-link spec's false WCAG 2.5.8 citation removed, hidden-at-rest no longer REQUIRED, and an activate-and-focus-moves assertion added |
| L-12 | the extension's pointless dynamic imports made static |

## The finding that changed the verdict — and it was RUN, not read

Phase 6 also overturned this round's own classification of the
`zero-size-control` finding.

The plan (ITEM-7) argued it was a false positive: a `sr-only
focus:not-sr-only …` skip link is the canonical WCAG 2.4.1 bypass pattern and
measures 1×1 px at rest BY DESIGN. Writing the disposition test forced the
question "would this be red if the link were broken?", and running it answered
it: **it was red.** `getComputedStyle` on the FOCUSED link still returned
`width: 1px; clip-path: inset(50%)`; the bundle contained **none** of
`focus:not-sr-only`, `focus:absolute`, `focus:z-50`, `focus:top-2`,
`focus:px-3` — the whole set.

Root cause: `sdk/packages/shell/src` is outside Tailwind v4's auto-scanned tree
(it auto-scans only the CSS file's own package), so utilities used ONLY in the
shell were never emitted. `@ziee/kit` already carried an `@source` line for
exactly this reason; `@ziee/shell` and `@ziee/notification-ui` did not.

Fix: two `@source` lines per workspace (`src-app/ui/src/index.css` and the
desktop twin). Measured after: the focused link is **146×32 px**. A real, shipped
WCAG 2.4.1 failure — a bypass link present in the accessibility tree but
invisible to the sighted keyboard user who needs it — which the audit had been
reporting all along and which this round had been about to dismiss.

## A regression this round caused, caught by re-measuring

The first version of the L-2/L-3 expiry un-marked the conversation BEFORE
`afterStreamComplete`. Re-running the full audit showed
`GET …/summary` back at **2× per step** in 8 cells: the `set({isStreaming:false})`
that precedes the hooks schedules a React re-render, and an already-unmarked,
idle, not-yet-loaded conversation is exactly the state the pill's open read fires
on. Moving the un-mark BELOW the hook await removed it. The ordering is now
commented as load-bearing at the call site.

This is the reason the fix round ends with a full re-measurement rather than a
re-read of the diff.

**New confirmed findings:** 0
