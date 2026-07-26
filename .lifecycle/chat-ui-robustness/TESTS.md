# chat-ui-robustness — TESTS

Every PLAN ITEM is covered; every INV is pinned by an `[acceptance]` test.
Tiers mirror the repo's existing pattern: colocated `*.test.ts` (vitest) for pure
logic and for the send-action driven through a fake store, `tests/e2e/**`
(Playwright, real backend) for the user-visible flows.

**No new permission is introduced** (this change adds no
`modules/*/permissions.rs` constant and no migration grant), so no
`[negative-perm]` restricted-user e2e is required by A10. Verified against the
diff surface in `PLAN.md` `## Files to touch` — all nine files are UI-only.

**No `page.route()` mocking of the app's own read paths.** Where a spec must make
something fail, it intercepts ONLY the single boundary under test (the send POST),
which is the same line `tests/e2e/chat/error-recovery.spec.ts` already draws.

## Tests

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/chat/core/extensions/beforeSendCancel.test.ts` — asserts: the cancel-merge helper's severity algebra — a cancel with no `silent` flag stays throwing; silent+silent merges to silent; **silent + non-silent merges to NON-silent (fail-loud wins)**; a non-cancel result never becomes a cancel; and the surviving `errorMessage` is the non-silent one when both are present.
- **TEST-2** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-1, ITEM-3] file: `src-app/ui/src/modules/chat/core/stores/chat/sendMessage.store.test.ts` — asserts: nothing is silently swallowed. Drives the REAL `sendMessage` action with a fake `set`/`get` and a stubbed extension registry: (a) a NON-silent cancel still `throw`s (so the caller can surface it) and never resolves quietly; (b) a `provideUserContent` failure sets `error` to a non-empty message rather than leaving it null; (c) a `chatExtensionRegistry.onStreamError` hook that itself throws is `console.error`-logged AND the state reset still runs. Would FAIL if the silent path were widened to cover a real failure, or if the `onStreamError` guard discarded its error without logging.
- **TEST-3** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/modules/chat/core/stores/chat/sendMessage.store.test.ts` — asserts: `sending` and `isStreaming` are BOTH false after a failure raised in the region that is currently unprotected (between the flag-set and the old `try`) — i.e. a `provideUserContent` throw and a `loadMessages` throw each leave the store recoverable, not wedged.
- **TEST-4** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/modules/chat/core/stores/chat/sendFailureState.test.ts` — asserts: the pure failure-state builder returns the exact recovery shape (`sending:false`, `isStreaming:false`, `streamingMessage:null`, `streamingAbortController:null`, `streamingMessageId:null`, `finalizingTurn:false`, `lastTurnInterrupted:true`) and that an AbortError yields `error:null` while a real failure yields the message — one vocabulary for every reset site.
- **TEST-5** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-1, ITEM-2] file: `src-app/ui/tests/e2e/chat/empty-submit-no-throw.spec.ts` — asserts: pressing **Enter on an empty composer** raises ZERO `pageerror` (uncaught exception) and ZERO `console.error`, and is a true no-op (no message appended, composer still focused and usable, no error alert). Collected via `page.on('pageerror')` + `page.on('console')` listeners registered before the keypress. Would FAIL against today's code, which throws `Message cannot be empty` out of an un-caught async keydown handler (the audit's 6/6-cell `🔴 HIGH · page-error`).
- **TEST-6** (tier: e2e) [covers: ITEM-2] file: `src-app/ui/tests/e2e/chat/empty-submit-no-throw.spec.ts` — asserts: the Enter path is defended for the NON-empty failure case too — with the send POST failing, submitting real text via Enter surfaces a user-visible error and still raises no `pageerror`; and Enter pressed while a turn is already streaming does not start a second send (the `rapid-double-submit` cell).
- **TEST-7** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-3, ITEM-4, ITEM-5] file: `src-app/ui/tests/e2e/chat/failed-stream-error-state.spec.ts` — asserts: after a send whose generation fails, ALL THREE of the invariant's clauses hold together — the `chat-streaming-indicator` is GONE (no permanent spinner), `chat-conversation-error-alert` is VISIBLE with non-empty text, and the composer/Send button are re-enabled so the user can retry. Would FAIL if `store.error` were left unset (clause 1) or the spinner left running (clause 2).
- **TEST-8** (tier: e2e) [covers: ITEM-4] file: `src-app/ui/tests/e2e/chat/failed-stream-error-state.spec.ts` — asserts: the streaming indicator is a real, named affordance — it is PRESENT (with an accessible name, `role="status"`) while a turn is genuinely streaming, and ABSENT once the turn terminates. This is the positive control that stops TEST-7 passing merely because the element never rendered.
- **TEST-9** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/mcp/chat-extension/components/approvalDescriptionClamp.test.ts` — asserts: the two values specific to this surface hold — the collapsed cap stays UNDER the sibling arguments clamp (160px) so the description can never be the tallest region of the card, stays on the 4px grid, is tighter than the whole-message collapse, and the view-state key is namespaced so two pending approvals never share one collapsed flag. (The clamp MECHANISM is `CollapsibleBlock`'s, covered by its own tests; the behavioural proof is TEST-10b.)
- **TEST-10** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-6] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: with a ~2,000-character tool description served by the external mock MCP server, **(a)** `approval-tool-description`'s full text is STILL present in the DOM while collapsed (textContent equals the complete advertised string, character-for-character — nothing truncated or summarized), and **(b)** the Deny / Approve-once buttons' bounding boxes lie inside a 1280×900 viewport without scrolling. Would FAIL if the description were string-truncated (breaking (a)) or left unbounded (breaking (b)).
- **TEST-11** (tier: e2e) [covers: ITEM-7] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: the pre-approval disclosure contract is pinned — BEFORE any approval click, the pending request is visible in the message thread showing the tool name, the concrete arguments the model chose, and the description; and the running tool card (`mcp-toolcall-card-*`) appears only AFTER approval, in the same slot. This locks the intended design the audit measured as `toolCard=0 approval=1`.
- **TEST-12** (tier: e2e) [covers: ITEM-8] file: `src-app/ui/tests/e2e/chat/markdown-rendering.spec.ts` — asserts: (EXISTING spec, re-run as the re-verification) a ` ```mermaid ` fence renders the `[data-streamdown="mermaid-block"]` MermaidBlock with a real diagram `svg` via `plugins.renderers` — NOT a plain code block. This is the empirical check on current code of the audit's `llm-render-missing` finding, which was measured against `fp-ac-merge` @ `51164e4cd` (a build carrying the `pre: MarkdownCodeBlock` override that bypassed `plugins.renderers`, and NOT an ancestor of this branch).
- **TEST-13** (tier: e2e) [covers: ITEM-8] file: `src-app/ui/tests/e2e/chat/html-iframe-render.spec.ts` — asserts: (EXISTING spec, re-run as the re-verification) a ` ```html ` fence renders the `html-block` component with its source view and Preview toggle — NOT a plain code block. Second half of the ITEM-8 verdict.
- **TEST-14** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: the long-description gallery cell exists and RENDERS — every test in this spec drives `?surface=deep-chat-tool-approval-long-desc`, so the cell cannot be deleted or broken without the whole file failing. (Replaces an earlier source-text-scraping unit test that could not fail if the clamp regressed and broke on a formatter change.)
- **TEST-15** (tier: e2e) [covers: ITEM-1] file: `src-app/ui/tests/e2e/chat/empty-submit-no-throw.spec.ts` — asserts: the SEND BUTTON still gives visible feedback on an empty composer. The quiet path is ENTER-ONLY; the button is not disabled on empty text, so widening the silent cancel to it would turn a deliberate click into a dead click with no request, no toast and no disabled affordance. This test exists to stop that regression being re-introduced.
- **TEST-16** (tier: e2e) [acceptance] [invariant: INV-3] file: `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` — asserts: an unbroken-token description cannot hide text HORIZONTALLY — the description wraps (`break-words`) and `scrollWidth <= clientWidth`. A purely vertical clamp is not enough: a payload in one long token renders as a single line that never overflows vertically, so no toggle is offered and the remainder is clipped sideways with no cue — hiding attacker-controlled text from the reviewer, which is exactly what INV-3 forbids. [covers: ITEM-6]

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2, TEST-5, TEST-15 |
| ITEM-2 | TEST-5, TEST-6 |
| ITEM-3 | TEST-2, TEST-3, TEST-4, TEST-7 |
| ITEM-4 | TEST-7, TEST-8 |
| ITEM-5 | TEST-7 |
| ITEM-6 | TEST-9, TEST-10, TEST-16 |
| ITEM-7 | TEST-11 |
| ITEM-8 | TEST-12, TEST-13 |
| ITEM-9 | TEST-14 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-7 `[acceptance]` |
| INV-2 | TEST-5 `[acceptance]` |
| INV-3 | TEST-10 `[acceptance]`, TEST-16 `[acceptance]` |
| INV-4 | TEST-2 `[acceptance]` |

Frontend gate obligations for phase 8 (diff touches `src-app/ui/**` only):
`npm run check (ui)` and `gate:ui (ui)` must both be recorded PASS; the
`src-app/desktop/ui` workspace is NOT touched (no hand-written override exists for
any changed file — see `PLAN_AUDIT.md` § Pattern conformance), so it carries no
gate line.
