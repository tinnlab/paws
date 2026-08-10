# PLAN — blank-page-chatmessage-hooks

Fix a reproducible white-screen (full-document blank) defect triggered by
navigating between chat conversations, plus the error-containment gap that turns
it into an unrecoverable white screen instead of a visible error.

## Design source

There is no prior feature design doc for this bugfix — the governing contracts are
the two source-of-truth documents this change is derived from, named here per the
phase-1 rule:

- **React Rules of Hooks** (`https://react.dev/reference/rules/rules-of-hooks`) —
  "Only call Hooks at the top level… Don't call Hooks after a conditional `return`
  statement." This is the contract `ChatMessage` violates.
- `sdk/packages/shell/src/error/AppErrorBoundary.tsx` doc-block (lines 17-27) —
  the SHIPPED, committed statement of intent for the boundary layering:
  > "Top-level (app entry) prevents a render throw anywhere in the tree from
  > showing a blank page (React 18+ unmounts the whole tree on uncaught render
  > errors). Per-module (AppShell, around each module component) **isolates a
  > single module's crash so the shell + other modules continue to work**."
  The `router` module boundary in `AppShell.tsx:129` uses `fallback={() => null}`,
  which for the router — the component that renders the ENTIRE routed app —
  realizes the opposite of that stated intent: a blank page, permanently.

Realizes: React Rules-of-Hooks conformance for `ChatMessage`, and the
`AppErrorBoundary` doc-block's stated no-blank-page / isolate-and-keep-working
contract for the `AppShell` per-module boundary.

## Invariants

- **INV-1**: "Only call Hooks at the top level of your React function. Don't call
  Hooks inside loops, conditions, or nested functions… Don't call Hooks after a
  conditional `return` statement." (React Rules of Hooks, verbatim)
- **INV-2**: "Top-level (app entry) prevents a render throw anywhere in the tree
  from showing a blank page." (`AppErrorBoundary.tsx` doc-block, verbatim) — i.e.
  NO render throw anywhere in the tree may result in a blank page.
- **INV-3**: "Per-module (AppShell, around each module component) isolates a single
  module's crash so the shell + other modules continue to work."
  (`AppErrorBoundary.tsx` doc-block, verbatim) — a caught crash must leave the user
  with a working surface, not an empty document.

## Items

- **ITEM-1**: Move `ChatMessage`'s `useSyncExternalStore(chatExtensionRegistry…)`
  subscription (currently at `ChatMessage.tsx:178`, BELOW the `return null` early
  exit at line 111) up to the unconditional hook prologue, above that early return.
  This is the throw: on a re-render where `contents.length === 0 &&
  !showEmptyCompletionNotice` becomes true, the component renders 6 hooks where the
  previous render rendered 7 → "Rendered fewer hooks than expected" (minified React
  error #300).
- **ITEM-2**: Give the `AppShell` per-module `AppErrorBoundary` a real fallback
  instead of `fallback={() => null}`, so a caught module crash renders a visible,
  actionable error surface (message + Reload) rather than an empty document. Keep
  the isolation property: a NON-router module that crashes must still render only
  its own small failure, leaving the rest of the shell intact.
- **ITEM-3**: Make the caught state RECOVERABLE across navigation. Today the
  boundary latches `state.error` and nothing ever calls `reset()`, so after one
  crash every subsequent client-side route change still renders the fallback —
  the observed "stays blank forever, only a reload escapes" behavior. Reset the
  boundary when the location changes.
- **ITEM-4**: Add a lint/guard so a hook placed after an early return in a
  component cannot silently reach main again — enable biome's
  `correctness/useHookAtTopLevel` for BOTH UI workspaces so this exact defect
  class fails `npm run check`. (Biome 2.4.16 is already the linter; the rule
  exists and is off by default.)
- **ITEM-5**: Fix the three SIBLING Rules-of-Hooks violations the ITEM-4 rule
  surfaces, since the gate cannot be turned on while they exist. All are the same
  defect class (hook after an early return):
  - `modules/knowledge-base/chat-extension/components/SearchKnowledgeToolResultCard.tsx:47`
    — `useState` after two data-dependent `return null`s (lines 39, 42). **Same
    blast radius as ITEM-1**: it is a chat content renderer, so a crash here is
    also a chat white screen. Genuinely crash-capable — the guards depend on
    message CONTENT, which changes between renders.
  - `modules/file/viewers/pdf/body.tsx:49,50` — `useRef`/`useEffect` after the
    `if (!('file' in props)) return null` type guard (line 17).
  - `modules/file/viewers/web/body.tsx:13,14` — `useFileTextContent` /
    `useFileViewMode` after the same type guard (line 11).
    These last two guard on the PROPS SHAPE, which is stable for a given mount, so
    they are structurally wrong but not currently reachable as a crash — fixed for
    correctness and to unblock the gate, and recorded as lower severity.

- **ITEM-6**: Close the SECOND guard hole found while validating ITEM-4.
  `scripts/lint-hooks.mjs` builds its store-proxy registry from
  `export const X = <factory>(…)` and `export const X = Y.store`, but the `File`
  store is exported as `const FileInner = registerLazyStore(FileDef); export const
  File = FileInner` — a bare-identifier ALIAS. That shape never entered the
  registry, so every conditional read of the `File`/`FileStore` proxy was
  unchecked, and the guard reported **"OK — 0 violations across 2597 files"**
  while 15 genuine violations existed. Resolve alias exports in the registry
  builder, and fix the 15 sites it then surfaces (all in `modules/file`; three of
  them — `ImageContent`, `MessageFilesView`, and the KB card — render inside a
  chat message). NOTE, measured during phase 8 and corrected here: none of the 15
  is a second white-screen source. They flip 0 ↔ N or 1 → 0 hook slots, and React
  only detects a slot-count change when BOTH renders used ≥1 slot. Their real
  defect is a SILENT one — orphaned store subscriptions that ratchet a ref count
  and can never be destroyed. ITEM-1 remains the sole crash.
  Keep both workspace copies of the script byte-identical (an existing check
  enforces this).

## Files to touch

- `src-app/ui/src/modules/chat/components/ChatMessage.tsx` (ITEM-1)
- `sdk/packages/shell/src/bootstrap/AppShell.tsx` (ITEM-2, ITEM-3)
- `sdk/packages/shell/src/error/` — a new `ModuleErrorFallback.tsx` (ITEM-2)
- `sdk/packages/config/biome.base.json` (ITEM-4 — shared by both workspaces)
- `src-app/ui/src/modules/knowledge-base/chat-extension/components/SearchKnowledgeToolResultCard.tsx` (ITEM-5)
- `src-app/ui/src/modules/file/viewers/pdf/body.tsx` (ITEM-5)
- `src-app/ui/src/modules/file/viewers/web/body.tsx` (ITEM-5)
- `sdk/packages/shell/src/hooks/useHistoryEpoch.ts` (ITEM-3, new)
- `sdk/packages/shell/src/error/AppErrorBoundary.tsx` (ITEM-3 — `resetKeys`)
- `src-app/{ui,desktop/ui}/package.json` + `biome.json` (ITEM-4 — the rule must be
  CHAINED, not just configured; desktop's biome.json is standalone, not extended)
- `src-app/{ui,desktop/ui}/scripts/lint-hooks.mjs` (ITEM-6, byte-identical copies)
- 11 further files under `src-app/ui/src/modules/file/**` (ITEM-6's 15 sites)
- Tests: `src-app/ui/src/modules/chat/components/ChatMessage.hooks.test.tsx`,
  `src-app/ui/src/modules/shell/AppShellErrorContainment.test.tsx`,
  `src-app/ui/scripts/lint-hooks-top-level.test.mjs`,
  `src-app/ui/src/modules/knowledge-base/chat-extension/components/SearchKnowledgeToolResultCard.hooks.test.tsx`,
  `src-app/ui/tests/e2e/…` blank-page containment spec.

## Patterns to follow

- **ITEM-1** — mirror `ContentRenderer.tsx:28`, the sibling component one level
  down that subscribes to the SAME registry seam correctly (hook in the
  unconditional prologue, all conditional returns after it). Same defect class,
  already solved correctly next door.
- **ITEM-2/3** — mirror the app-entry boundary's fallback in
  `src-app/ui/src/main.tsx:22-96`, which already renders a real error surface with
  a "Reload page" affordance; reuse its structure/tokens rather than inventing a
  second error visual.
- **Tests** — mirror `src-app/ui/src/modules/js-tool/chat-extension/components/
  JsToolApprovalContent.test.tsx`, the repo's established mounted-component
  harness (vitest + jsdom, `npm run test:component`). Note the collector only
  picks up `*.test.tsx` / `*.store.test.ts` — a plain `*.test.ts` runs NOTHING.
- **E2E** — mirror the existing `tests/e2e/` specs' login helper + semantic
  selectors.

## Plan audit (phase 2) — verified against the codebase

### Breakage risk

- **ITEM-1** moves a hook that takes no arguments derived from anything computed
  between line 111 and line 178 (`chatExtensionRegistry.subscribeToExtensions` and
  `.getExtensionsVersion` are stable module-level references, verified in
  `chat/core/extensions/registry.tsx`). Its return value is discarded. So hoisting
  it is behaviour-preserving for every render that already reached line 178, and it
  ADDS a subscription for the `contents.length === 0` renders — which is the point.
  No caller of `ChatMessage` changes.
- **ITEM-2/3** change SDK behaviour for every consumer of `@ziee/shell`'s
  `AppShell` (web UI + desktop UI). Risk: a module that today crashes silently to
  `null` will start rendering a visible error card. That is the intent (INV-2/3),
  but it means a pre-existing latent crash becomes VISIBLE. Mitigated by ITEM-2
  keeping the fallback compact and per-module rather than full-screen.
- **ITEM-3** must not reset on EVERY render (an infinite reset↔crash loop). Reset
  is keyed on the location value changing, not on render.
- **ITEM-5** `PdfBody`/`WebBody` require a small structural split (outer type-guard
  component + inner hook-using component) because the hooks consume the narrowed
  `props.file`. Behaviour-preserving; `SearchKnowledgeToolResultCard` needs only a
  `useState` hoist.
- **ITEM-4** turning the rule on affects both workspaces; verified the desktop
  workspace has ZERO violations outside the deliberate detector fixture, so the
  only work needed to make it green is ITEM-5.

### Pattern conformance

- **ITEM-1** conforms to `ContentRenderer.tsx:28` — the sibling that subscribes to
  the SAME registry seam with the hook in the unconditional prologue. ITEM-1 makes
  `ChatMessage` match its already-correct neighbour.
- **ITEM-2** reuses the app-entry fallback shape in `src-app/ui/src/main.tsx:22+`
  (role="alert", heading, explanatory copy, reload affordance, self-contained
  inline colors so the fallback does not depend on the token CSS pipeline).
- **ITEM-4** the repo lints with Biome and `npm run check` ALREADY chains a
  `lint:hooks` step, so this is an extension of an existing gate, not a new one
  (B6-safe: config lives in the committed product tree, not `.lifecycle/`).

### Guard gap (the reason this reached main)

`src-app/ui/scripts/lint-hooks.mjs` — the repo's own Rules-of-Hooks guard, already
wired into `npm run check` — **deliberately carves out this exact case**. Its rule
H1 (line 41-43) reads, verbatim:

> `H1  any use[A-Z]…() call in a conditional context, EXCLUDING after-early-return`
> `(that is the classic type-guard idiom — 5 such hook calls across 3 pre-existing`
> `components — and is the standard rules-of-hooks rule's territory; see DEC-6).`

and its own header (line 23-25) states:

> `Why nothing off-the-shelf catches these: react-hooks/rules-of-hooks is not run`
> `here (the repo lints with Biome, and useHookAtTopLevel is not enabled)`

So the hole was reasoned about and left open on the premise that a standard rule
owned it — while that standard rule was never switched on. The "5 such hook calls
across 3 pre-existing components" it waved through are precisely the ITEM-5 sites.
`ChatMessage`'s hook then landed in `e6f33d71d` INSIDE that blind spot and shipped.
ITEM-4 closes it; ITEM-5 pays off the debt that kept it open.

### Migration collisions

None — this branch adds no migration (see BASE.md; highest server prefix
`202607200400`, untouched).

### OpenAPI regen

Not required — no Rust handler or type changes, so neither workspace's
`openapi.json` / `api-client/types.ts` moves. R2-3 desktop-override review:
`ChatMessage.tsx` has no `src-app/desktop/ui` counterpart (verified — the desktop
app consumes `@ziee/shell` for `AppShell` and has no chat-message override), so
ITEM-2/3 reach desktop through the SDK package with no duplicated logic to drift.

### Per-item verdicts

- **ITEM-1** — verdict: PASS — reproduced end-to-end; the hook at
  `ChatMessage.tsx:178` sits below the `return null` at line 111, and the unminified
  runtime error names `<ChatMessage>` with "Rendered fewer hooks than expected".
  Fix is a hoist into the prologue, mirroring `ContentRenderer.tsx:28`.
- **ITEM-2** — verdict: PASS — `AppShell.tsx:129` is confirmed
  `fallback={() => null}`, and the boundary's own doc-block (lines 17-27) states the
  opposite intent. The `[router]` label in the captured console output proves this
  is the boundary that caught the throw.
- **ITEM-3** — verdict: CONCERN — the sticky behaviour is confirmed from the
  explorer log (steps 13-16 after the crash all report "no interactive element
  visible" while the URL keeps changing), but resetting an error boundary on
  location change can mask a crash that reproduces on every route. Resolved in
  DEC-3: reset on location change only, and keep the console.error unconditional so
  the runtime-health gate still sees every occurrence.
- **ITEM-4** — verdict: PASS — biome 2.4.16 ships `correctness/useHookAtTopLevel`;
  trial run over both workspaces yields exactly 7 diagnostics, 1 of which is the
  deliberate `__detector_fixtures__/ConditionalHooks.tsx` (already excluded from
  other guards by the same path pattern in `biome.json`) and 6 of which are ITEM-1 +
  ITEM-5. So the rule is enable-able with no unrelated fallout.
- **ITEM-5** — verdict: PASS — all three sites read + confirmed as genuine hooks
  after early returns. Severity split recorded in the item (the KB card is
  crash-capable, the two viewers are shape-guards).

- **ITEM-6** — verdict: PASS — hole verified by patching the registry builder and
  re-running: violations went 0 → 15, registry 301 → 303 proxies. Every surfaced
  site was read and confirmed a genuine conditional proxy read. Severity is mixed
  and is recorded honestly per site rather than levelled up: the full React
  detection matrix was MEASURED (see TESTS.md TEST-8/9), and every one of these
  sites sits in the undetectable class (0 ↔ N or 1 → 0). They are silent
  subscription leaks, not crashes. Only ITEM-1's 7 → 6 is detectable, and it is
  the white screen.

## Reproduction (recorded at plan time, before any fix)

Against the live rig (production build) at `http://127.0.0.1:1520`, logged in as
`admin`, driving Playwright: load `/chat/30bb982a-…`, then click sidebar recent-chat
buttons in succession with a 250 ms gap:

```
round 0 delay=250 click "Run Workflow and Retriev" -> /chat/8d28a590-… len=2969
round 1 delay=250 click "Create New Workflow Run" -> /chat/30bb982a-… len=0  *** BLANK ***
   after +2s settle: len=0
   [console.error] Error: Minified React error #300
   [console.error] [AppErrorBoundary [router]] Error: Minified React error #300
```

Re-run against a DEV build (same rig backend via `VITE_API_PROXY_TARGET`) to
unminify:

```
Error: Rendered fewer hooks than expected. This may be caused by an accidental
early return statement.
  … at updateSimpleMemoComponent …
  The above error occurred in the <ChatMessage> component.
  at ChatMessage (modules/chat/components/ChatMessage.tsx:20:67)
  at MessageList (modules/chat/components/MessageList.tsx:31:73)
  at ConversationPane (modules/chat/pages/ConversationPage.tsx:141:50)
```

The hook that is skipped by the early return was added by commit `e6f33d71d`
("fix(gate): restore the visual leg…"), which inserted the `useSyncExternalStore`
at line 178 without noticing the pre-existing `return null` at line 111.
