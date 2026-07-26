# chat-ui-robustness — FIX ROUND 1

Four blind reviewers (diff-only context, 17 angles) returned 37 ledger entries.
Every `confirmed` entry is dispositioned below. Two were independently found by
the orchestrator as well and are marked — the agreement is what raised confidence
that they were real rather than reviewer speculation.

## The five that changed the design, not just the code

**F1 — the silent cancel leaked to PROGRAMMATIC callers (3 HIGH entries).**
`silent` was a property of the extension's verdict alone, so `if
(beforeResult.silent) return` fired for every caller. Verified in code, not
inferred: `startRegenerateMessage.ts:64-70` latches `pendingBranchForkLevel` /
`pendingBranchFromMessageId` and awaits `trimMessagesToForkPoint(...)` BEFORE
calling `sendMessage()`, and its own comment notes the text pre-fill is skipped
when the preceding user message is attachment-only — so with an empty composer
the send returned quietly, leaving the transcript trimmed, nothing regenerating,
no error, and the pending-branch fields latched so the user's NEXT send would
fork from a stale message. The approval card's three `chat.sendMessage()` sites
transmit Approve/Deny with an empty composer and depend on the mcp extension's
`discardCancel: ['text']` (`mcp/chat-extension/extension.tsx:985`); the registry
swallows a throwing extension hook (`registry.tsx:772-780`), so any failure of
that discard downgraded a dropped CONSENT DECISION into a silent success.

**Fix:** the quiet path is now gated on BOTH signals — the REASON must be
`silent`, AND the CALLER must opt in via `sendMessage({ allowSilentCancel: true })`.
Only `TextInput.handleKeyDown` passes it. Every programmatic caller, and the Send
BUTTON, are byte-identical to the pre-change behaviour. Covered by two new legs
in `sendMessage.store.test.ts` (silent-with-opt-in vs silent-without, plus
loud-wins-even-with-opt-in).

**F2 — the Send BUTTON became a dead click (HIGH, INV-1).** The button is not
disabled on an empty composer (`ChatInput.tsx:165` gates only on
sending/streaming/disabled/blocked), so making the veto unconditionally silent
removed the explanatory toast it has always shown. **Fix:** the opt-in is
Enter-only, so the button keeps its toast; `ChatInput.tsx` is no longer touched at
all. A new e2e (TEST-15) asserts the button still gives feedback, specifically so
a future change cannot widen the quiet path back onto it.

**F3 — a test file inside `actions/` became a registered store action (HIGH).**
Found independently by the orchestrator (a stray `Vitest failed to find the
runner` in a Playwright run) and by a reviewer, who traced the exact mechanism:
`stores/chat/index.ts:502` registers actions via
`import.meta.glob('./actions/*.ts')`, store-kit's `autoWarmLazyActions` preloads
every lazy action, and the module has no default export — yielding an UNHANDLED
rejection in the browser, i.e. precisely the `pageerror` class this feature
exists to remove, plus vitest in a production chunk. `check:store-actions` does
NOT catch it (the generator filters `.test.ts` out of `actions.gen.ts`, so the
gate is green while the runtime is broken). **Fix:** moved to
`stores/chat/sendMessage.store.test.ts`. No test file remains under `actions/`.

**F4 — the description clamp re-implemented `CollapsibleBlock` (HIGH + ~8
dependent findings).** The hand-rolled version dropped everything the sibling
encodes for exactly this situation: the bottom FADE MASK that cues clipped text
(on a consent surface "looks like the description just ended" is the failure mode
that matters), `aria-controls`, focus auto-expand (WCAG 2.4.7/2.4.11),
`useInPlaceAnchor` scroll anchoring inside the virtualized list, and
remount-surviving expand state (the card remounts when `loadMessages` replaces
the messages Map and when the virtualizer recycles the row — so a reviewer
mid-read of a long attacker-supplied description silently lost the expansion).
**Fix:** `ApprovalToolDescription` now composes `CollapsibleBlock` with a
surface-specific `maxHeightPx` and a namespaced view key
(`approval-desc:<tool_use_id>`). The helper module shrank to the two values that
are genuinely specific to this surface. This single change closed the a11y,
perf, patterns-conformance, modularity and extensibility clusters together.

**F5 — a purely VERTICAL clamp could hide text HORIZONTALLY (HIGH, security).**
The description had no `break-words`, so a hostile server putting its payload in
one unbroken token renders a single line: `scrollHeight === clientHeight`, no
overflow detected, no toggle offered, and the remainder clipped off the right
edge with no cue — the exact "poisoning hides in truncation" hole the card's
contract exists to close. **Fix:** `break-words` on the description, plus TEST-16
asserting both that the element wraps and that `scrollWidth <= clientWidth`.

## Also fixed

- **Live region mounted with its content** (a11y) — now always mounted with only
  its content toggling, mirroring the sibling 12 lines above whose comment says
  exactly why. The accessible name moved off the `<svg>` (no `role="img"` ⇒
  inconsistent name computation ⇒ the region could announce nothing) onto the
  region itself.
- **"Generating response" announced for a plain message fetch** (correctness) —
  the indicator renders for `(loading || isStreaming)`; the label is now
  state-dependent and a `data-busy` attribute distinguishes the two. TEST-8
  asserts `data-busy="streaming"`, so "visible after clicking Send" can no longer
  be satisfied by an unrelated history load.
- **Double-send window not closed** (concurrency) — the reactive flags are read
  from the render closure and `sending` only flips after several awaits
  (including a create-conversation round-trip on a new chat), so two rapid Enters
  both passed. Added a synchronous `inFlightRef` latch; the overclaiming "Mirror
  ChatInput.handleSend exactly" comment now states precisely what it does and
  does not replicate, and why.
- **Dead-code churn** (extensibility) — `mergeBeforeSendResults` has no
  production caller anywhere; routing it through a new export added public API
  and tests purely to keep dead code in sync, and silently narrowed its return
  shape. `utils.tsx` is reverted to base and `mergeCancelDecision` is gone.
- **Unguarded post-abort reload** (error-handling) — a refetch failure could
  reject `sendMessage` after the store was already fully recovered, surfacing a
  spurious toast for a user-initiated cancel. Now guarded and logged.
- **Test-quality repairs** — the registry stub's `afterEach` now really restores
  (it deleted nothing before, so the prototype shadow was permanent); console-error
  collection is armed AFTER login instead of spanning the whole session (which
  would have failed on unrelated boot noise and invited an ever-widening ignore
  regex); the source-scraping gallery test is gone, replaced by the visual spec
  that actually RENDERS the cell; and the overclaiming spec titles/comments now
  state honestly which layer proves what.
- **`SEND_FAILED_FALLBACK_MESSAGE`** is now used in `TextInput` instead of a third
  copy of the same literal.

## The hollow acceptance test (caught twice)

TEST-10b asserted only that Deny/Approve sat above the fold. A reviewer flagged it
and the orchestrator had independently found the same thing by reverting the fix
and watching the test stay green. **Measured on the real surface:** unclamped the
card is **837px** tall with its top at **y=-235**; clamped it is **457px** at
**y=145**. Because the message list auto-scrolls to its tail, an oversized card
always ends with its FOOTER in view — it pushes its own HEADER off the top
instead. So the user could always reach Approve; what they could not do is see
WHAT they were approving at the same time. The assertion now requires the WHOLE
card to fit (`y >= 0` and `y + height <= 900`), which is the property the user
actually needs. Re-verified RED (3 failed) with the clamp stubbed out, GREEN
(5 passed) with it restored.

## Dispositioned without a code change

- **registry `beforeSendMessage` fails OPEN** when an extension hook throws (it
  logs and records no result, so a crashed veto counts as approval). Real and
  adjacent, but PRE-EXISTING and untouched by this diff; flipping the send path
  from fail-open to fail-closed is a behaviour change with its own blast radius
  and belongs in its own reviewed commit. Recorded `deferred-pre-existing`.
- **State written after an await without re-validating the conversation** in the
  catch — pre-existing shape (the catch already awaited before writing); this
  change adds one more awaited hop. Recorded `deferred-pre-existing`.
- **Pane asymmetry** (the guard reads this pane's flags; the text extension reads
  the focused pane's TextStore) — pre-existing on the content side. Recorded
  `deferred-pre-existing`.
- **Hardcoded English strings** — no `useTranslation` exists anywhere in `src/`
  today, so this matches the codebase rather than regressing it. Recorded
  `rejected-not-a-regression`.
- **Two `regression-risk` entries** were reviewers explicitly clearing a concern
  (the existing `toHaveText` disclosure spec still passes because the clamp is
  CSS-only; no existing `getByRole('status')` assertion is affected). Recorded
  `rejected-false-positive`; both were then confirmed empirically by running the
  affected specs.
- **stateMatrix line-number churn for untouched surfaces** — verified real: the
  committed artifact was already stale on the base branch, so this change absorbs
  pre-existing drift. Noted, not attributable.

## Re-audit

The diff was re-reviewed against every confirmed finding after the fixes, and the
full gate chain was re-run on the fixed tree: `npm run check` exit 0,
`gate:ui` **PASSED (190/190 surfaces, 0 gating HIGH)**, 20 node:test + 7 vitest
unit tests green, 5/5 approval e2e, 2/2 failed-stream e2e, 4/4 empty-submit e2e,
16/16 render-verification e2e.

No new confirmed findings arose from the fixes themselves: the changes were
either deletions (dead code, the hand-rolled clamp), narrowings (caller-gated
opt-in), or adoptions of an existing reviewed component.

**New confirmed findings:** 0
