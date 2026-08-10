# TESTS — blank-page-chatmessage-hooks

Tiers mirror the repo's existing pattern: `unit` = vitest+jsdom mounted-component
harness (`npm run test:component`, collector globs `.test.tsx` ONLY — a plain
`*.test.ts` collects NOTHING) and node:test scripts; `e2e` = Playwright.

## The transition under test (why these assertions are not synthetic)

`ChatMessage` renders 7 hooks when it does NOT take the `contents.length === 0 &&
!showEmptyCompletionNotice` early return, and 6 when it does. The production
transition that flips it, verified in `emptyCompletion.ts::shouldShowEmptyCompletionNotice`:

an **assistant** message with `contents: []` shows the empty-completion notice
while `isStreaming/interrupted/finalizing` are all false (→ 7 hooks); the moment
the store's per-turn `interrupted` (or `finalizing`) signal flips TRUE, the notice
is suppressed, the early return fires, and the SAME mounted instance renders 6
hooks → React "Rendered fewer hooks than expected". Every conversation in the
reported repro visibly contains such a turn (the "This turn ended without an
answer…" banner). The tests drive exactly that prop transition — no timing, no
race.

## Tests

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1] file: `src-app/ui/src/modules/chat/components/ChatMessage.hooks.test.tsx` — asserts: mounting `<ChatMessage>` with an assistant message whose `contents` is `[]` and `interrupted={false}`, then RE-RENDERING the same instance with `interrupted={true}`, completes without React throwing "Rendered fewer hooks than expected" and without the render being torn down. This is the literal reported defect; it must be observed RED before the fix.
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/chat/components/ChatMessage.hooks.test.tsx` — asserts: the registry subscription the fix moves is still LIVE after the hoist — registering a chat extension on `chatExtensionRegistry` after mount re-renders `ChatMessage` (the behaviour commit `e6f33d71d` added the hook for), so the fix does not regress it. Also asserts the hook is now called on the early-return path, i.e. a message that DOES early-return still subscribes.
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-2] file: `src-app/ui/src/modules/shell/AppShellErrorContainment.test.tsx` — asserts: when ONE registered module component throws during render, `AppShell` renders a VISIBLE, non-empty error surface for that module (accessible `role="alert"`, non-zero text, a reload/retry affordance) AND every sibling module still renders its own content — i.e. isolation is preserved and the document is never empty. Would FAIL against today's `fallback={() => null}`.
- **TEST-4** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/modules/shell/AppShellErrorContainment.test.tsx` — asserts: after a module crash is caught, changing the router location RESETS the boundary so the module re-renders its content (given it no longer throws), and that a module which throws on EVERY render does not enter an infinite reset↔crash loop (bounded render count).
- **TEST-5** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-2, ITEM-3] file: `src-app/ui/tests/e2e/00-shell/error-containment.spec.ts` — asserts: in a REAL browser against the REAL bundle and a real server, driving GENUINE client-side navigation (in-app link clicks at the ~250 ms cadence of the live reproduction — a `page.goto` reboots the tree and structurally cannot reproduce a re-render-driven crash): (a) NO render throw reaches the shell — the spec fails on any `[AppErrorBoundary …]` console error or React #300/#310; (b) the document is never PERSISTENTLY blank (settle discipline mirrors the detector that found the bug, so a mid-navigation blank frame is correctly not treated as the defect); (c) a positive control that the app rendered at all first, so the other assertions cannot pass vacuously. **MEASURED LIMIT, stated rather than assumed:** with the `ChatMessage` fix reverted this spec still PASSES (verified by a full run) — a fresh test DB has no answerless assistant turn, so the crashing state never renders. It is therefore a general guard against any render crash reaching the shell, NOT the regression test for this defect; that is TEST-1, verified RED 4/4 with the exact production error.
- **TEST-6** (tier: unit) [covers: ITEM-4, ITEM-6] file: `src-app/ui/scripts/lint-hooks-top-level.test.mjs` — asserts: for BOTH guard holes — (HOLE 1) `correctness/useHookAtTopLevel` is set to error in the shared base AND in the desktop workspace's standalone config, is CHAINED into `npm run check` in both (config != executed — `check`'s biome step is `--only=style/noRestrictedImports`, so enabling a rule in config alone runs it nowhere; this assertion is what would have caught the original hole), both workspaces are clean, and the rule still FIRES on a synthesized hook-after-early-return (known-positive control); (HOLE 2) `lint-hooks.mjs` now resolves an ALIAS-exported store proxy — a synthesized `export const X = Inner` store with a conditional read is FLAGGED, and the same read hoisted is NOT (negative control) — plus the two workspace copies stay byte-identical.
- **TEST-7** (tier: unit) [covers: ITEM-5] file: `src-app/ui/src/modules/knowledge-base/chat-extension/components/SearchKnowledgeToolResultCard.hooks.test.tsx` — asserts: the hook SPLIT applied to this chat content renderer preserved rendering in BOTH directions on a mounted instance (card → nothing as a streamed payload stops parsing, and nothing → card as it lands). **Deliberately not claimed as a crash regression test**: measured against the pre-fix file, this spec PASSES, because the component's other hook is a `useContext` (no hook-list slot), making the real transition 1 slot → 0 slots — which React's leftover check cannot detect. NOTE — corrected by measurement in phase 8: none of these siblings is crash-capable. React selects the MOUNT dispatcher whenever the previous render used ZERO hook slots, so a 0 ↔ N flip is compared against nothing; detection needs BOTH renders to have used ≥1 slot. Their real defect is a SILENT orphaned-subscription leak. `ChatMessage` (7 → 6) is the only detectable site and the only white screen. Static detection for this whole class is TEST-6's job. The two file-viewer sites (`pdf/body.tsx`, `web/body.tsx`) guard on props SHAPE, which cannot vary for a mounted instance, so they are covered by TEST-6's static proof.

- **TEST-8** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/file/chat-extension/components/ImageContent.hooks.test.tsx` — asserts: the component does not ORPHAN its `FileStore` subscriptions when `renderAsUser` flips or a source-type guard takes over, drives the guards in both directions with no hook-order error, and each source branch still renders its documented output. Verified RED against the pre-fix file: subscription refs grow instead of holding steady (`expected 12 to be 2`, `expected 22 to be 10`).
- **TEST-9** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/file/chat-extension/components/MessageFilesView.hooks.test.tsx` — asserts: the component does not orphan its `FileStore` subscription as `resource_link`s stream in or for null/uri-less payloads, and still renders one preview per distinct uri. Verified RED against the pre-fix file (`expected 5 to be +0`, `expected 11 to be 5`).

**Why these two assert on ORPHANED SUBSCRIPTIONS rather than on a throw.** They flip 0 ↔ 4 and 0 ↔ 2 hook slots, and a naive `expect(...).not.toThrow()` PASSES against the pre-fix file — the same trap TEST-7 fell into. The reason was measured rather than guessed: `renderWithHooks` selects the MOUNT dispatcher when `current.memoizedState === null`, so a render that used ZERO hooks makes the next render a fresh mount compared against nothing. Detection needs both renders to have used ≥1 slot. The full matrix was measured in this exact environment (React 19 + jsdom): `0→1, 1→0, 0→2, 2→0` all silent; `1→2, 2→1, 1→3, 3→1` all throw.

So these two sites were never a second white-screen source — they were a SILENT DEFECT: the fall-through render's `useEffect`/`useSyncExternalStore` are never torn down (the guard render flags no passive effect), so `FileStore.__refCount` ratchets up on every guard flip and the ref-counted destroy can never reach zero. Pre-fix `ImageContent` measures `0, 2, 4, 4, 6` across four renders where post-fix measures `0, 2, 2, 2, 2`. React also logs its own `Internal React error: Expected static flag was missing` on each flip. Those are the two observables the specs assert. Both were independently re-verified RED by re-running the negative control, not taken on the sub-agent's report.

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2 |
| ITEM-2 | TEST-3, TEST-5 |
| ITEM-3 | TEST-4, TEST-5 |
| ITEM-4 | TEST-6 |
| ITEM-5 | TEST-7, TEST-6 |
| ITEM-6 | TEST-6, TEST-8, TEST-9 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-1 `[acceptance]` |
| INV-2 | TEST-5 `[acceptance]` |
| INV-3 | TEST-3 `[acceptance]` |

## Not applicable

- **No `[negative-perm]` restricted-user e2e (A10)** — this branch introduces no
  permission. Verified: no `modules/*/permissions.rs` change and no migration.
- **No backend tier** — the diff touches no Rust.
