# PLAN — fix pre-existing UI-gate breakage on feat/agent-core

Bugfix of two PRE-EXISTING breakages on `origin/feat/agent-core` that make the
UI gates red on the base itself (reproduced on a clean checkout, before any of
my edits — see `## Reproduction (pre-existing)`). This is NOT a feature; the
"tests" are the gates going green plus a runtime-health regression assertion
that the previously-crashing surfaces now render clean.

## Reproduction (pre-existing)

Clean `origin/feat/agent-core` worktree, quiet gallery port 1477:

- **A — web `gate:ui` runtime-health:** `196 gating HIGH` findings, dominated by
  **55 `[app-seam] "AppLayout" store was not registered`** (console-error) + ~30
  ErrorBoundary crashes across ~25 overlays, and **41 `Cannot destructure
  property 'setGetMessage' of 'chatStore.TextStore' as it is undefined`** +
  ~25 crashes across the deep-chat / seeded surfaces.
- **B — desktop `npm run check`:** `check:kit-manifest` throws
  `barrel not found: .../desktop/ui/src/components/ui/index.ts`.
- **B — desktop prod build (`vite build`):** fails with **5 `MISSING_EXPORT`**
  errors — `revalidateForPath` / `ensureModuleForPath` / `isPathModulePending` /
  `isPathModuleForbidden` "is not exported by `../../ui/src/modules/loader.desktop.ts`".

## Root causes

- **A/AppLayout:** the base's store refactor added a typed injection seam
  (`createAppStoreSeam`) whose `get()` THROWS when the store was not injected at
  boot. But four shell consumers (`DivScrollY`, `SettingsPageContainer`,
  `HeaderBarContainer`, `useHeaderLeftInset`) were WRITTEN to degrade gracefully
  in a store-LESS render context (their own comments say so; `?? {}` fallbacks) —
  a contract the throwing `get()` broke. In the gallery, overlays render in
  isolation without the app-layout injection site ever importing, so `get()`
  throws and crashes every overlay that renders a `DivScrollY` scroll body.
- **A/TextStore:** the composer (`ChatInput`) already gates its `text_input`
  slot on `chatExtensionsReady` (renders a skeleton until then). But the
  extension registry's register-time seed of the PRIMARY chat store
  (`Chat.TextStore`) was DEFERRED to an async `import('../stores/chat').then()`,
  so it lands a microtask AFTER `chatExtensionsReady` resolves — the gate opens,
  `TextInput` reads `chatStore.TextStore`, and it is still `undefined`.
- **B/kit-manifest:** the kit moved into the `sdk` submodule; the server `ui`
  `check:kit-manifest` script was updated to `--barrel ../../sdk/packages/kit/src/index.ts`,
  but the desktop `ui` script was NOT — it still defaults to the deleted
  `src/components/ui/index.ts`.
- **B/loader exports:** the base refactored `ui/src/modules/loader.ts` into a
  manifest-driven smart loader that added four router deep-link functions;
  `RouterComponent.tsx` (shared) imports them from `@/modules/loader`, which the
  desktop `localOverridePlugin` resolves to the eager-glob fork
  `loader.desktop.ts` — which was never updated to export those four.

## Items

- **ITEM-1**: Add a non-throwing `peek(): T | null` to `createAppStoreSeam`
  (`sdk/packages/framework/src/app-seam.ts`) — the opt-in "the store may legitimately
  be absent in this render context" read, alongside the loud boot-critical `get()`.
- **ITEM-2**: Convert the four OPTIONAL AppLayout-seam readers to `peek()` +
  sensible defaults (`DivScrollY`, `SettingsPageContainer`, `HeaderBarContainer`,
  `useHeaderLeftInset`), so an isolated overlay / layout-less route renders
  instead of throwing. Leave the REQUIRED readers on `get()` (shell
  `AppLayout.tsx` renders only when injected; `routesSeam.get()` must be present).
- **ITEM-3**: Make the chat-extension register-time primary-store seed
  SYNCHRONOUS via an IoC accessor the chat store pushes to the registry
  (`setPrimaryChatStateAccessor`), so `Chat.TextStore` exists the instant
  `chatExtensionsReady` resolves and the composer's existing readiness gate is
  sound. Fixes the gallery crash AND the latent real-app race.
- **ITEM-4**: Point desktop `ui`'s `check:kit-manifest` at the SDK kit barrel
  (`--barrel ../../../sdk/packages/kit/src/index.ts --out ...KIT_MANIFEST.md --check`),
  matching the server `ui` script (one extra `../` for the deeper path).
- **ITEM-5**: Add desktop-appropriate `ensureModuleForPath` / `isPathModulePending`
  / `isPathModuleForbidden` / `revalidateForPath` to `loader.desktop.ts` (eager
  loader ⇒ no-ops / `false`), keeping its public surface in lockstep with
  `loader.ts` so the shared `RouterComponent` import resolves in the desktop build.

### Items discovered during implementation (drift — same root cause: the SDK/monorepo migration left desktop `npm run check` tooling + several committed generated files behind, MASKED because the FIRST check in the chain (`check:kit-manifest`) failed and short-circuited the rest; fixing ITEM-4 unmasked them). See DRIFT-1.md.

- **ITEM-6**: Point desktop `check:design-spec` at the shared root `DESIGN_SYSTEM.md`
  + desktop `src/index.css` (`--css src/index.css --out ../../../DESIGN_SYSTEM.md`),
  matching the server `ui` script — it was defaulting to a nonexistent
  `desktop/ui/DESIGN_SYSTEM.md`.
- **ITEM-7**: Teach the desktop LOCAL `gen-overlay-registry.mjs` to recognize
  `@ziee/kit` imports (the kit moved into the SDK submodule; the local gen still
  only matched `@/components/ui`, so a controlled Popover imported from `@ziee/kit`
  — `ConversationMountsControl` — was no longer detected as an overlay host,
  leaving its allow-list entry "stale"). Regenerate `overlay-registry.generated.json`
  (returns to the base's 1-host state).
- **ITEM-8**: Regenerate the stale `stateMatrix.generated.ts` + `STATE_MATRIX.md`
  in BOTH the web (`ui`) and desktop workspaces — the base store-migration refactor
  (`Stores.Auth` → `Auth`, line shifts) changed source without regenerating; the
  web regen also folds in the new branch signals from ITEM-3's registry edit.
- **ITEM-9**: Regenerate the stale desktop `GALLERY_SEED_MANIFEST.md` (a new
  `tunnelAuth` module on the base was never folded in).
- **ITEM-10**: Change the `ui/src/index.ts` barrel's `loadModules` re-export from a
  relative `./modules/loader` to the `@/`-aliased `@/modules/loader`, so the desktop
  `localOverridePlugin` swaps in `loader.desktop.ts` — the relative path dragged the
  web `loader.ts` (which imports `virtual:ziee-module-manifest`, a plugin the desktop
  build does not run) into the desktop bundle and failed the desktop prod build
  (the next masked error after ITEM-5's MISSING_EXPORTs).

## Files to touch

- `sdk/packages/framework/src/app-seam.ts` (ITEM-1)
- `sdk/packages/shell/src/components/DivScrollY.tsx` (ITEM-2)
- `sdk/packages/shell/src/settings/SettingsPageContainer.tsx` (ITEM-2)
- `sdk/packages/shell/src/components/HeaderBarContainer.tsx` (ITEM-2)
- `sdk/packages/shell/src/hooks/useHeaderLeftInset.ts` (ITEM-2)
- `src-app/ui/src/modules/chat/core/extensions/registry.tsx` (ITEM-3)
- `src-app/ui/src/modules/chat/core/stores/chat/index.ts` (ITEM-3)
- `src-app/desktop/ui/package.json` (ITEM-4, ITEM-6)
- `src-app/ui/src/modules/loader.desktop.ts` (ITEM-5)
- `src-app/desktop/ui/scripts/gen-overlay-registry.mjs` (ITEM-7)
- `src-app/desktop/ui/src/dev/gallery/overlay-registry.generated.json` (ITEM-7, regen → matches base)
- `src-app/ui/src/dev/gallery/stateMatrix.generated.ts` + `STATE_MATRIX.md` (ITEM-8, regen)
- `src-app/desktop/ui/src/dev/gallery/stateMatrix.generated.ts` + `STATE_MATRIX.md` (ITEM-8, regen)
- `src-app/desktop/ui/src/dev/gallery/GALLERY_SEED_MANIFEST.md` (ITEM-9, regen)
- `src-app/ui/src/index.ts` (ITEM-10)

## Patterns to follow

- **ITEM-1** mirrors the existing `createAppStoreSeam` / `routesSeam` design in the
  same file (`sdk/packages/framework/src/app-seam.ts`) — a small typed seam, no
  global registry.
- **ITEM-2** mirrors `DivScrollY`'s already-documented store-less fallback
  (`nativeScroll` opt-in ⇒ default off) — apply the SAME graceful-degradation shape
  to the three siblings.
- **ITEM-3** mirrors the existing `injectExtensionStores` seam + the store's own
  init-time seed (`chat/core/stores/chat/index.ts:551`); the accessor IoC mirrors
  how the pane runtime already resolves a per-instance store.
- **ITEM-4** mirrors the server `ui` `check:kit-manifest` script
  (`src-app/ui/package.json`) verbatim, adjusted for path depth.
- **ITEM-5** mirrors `loader.ts`'s public surface (the four router functions),
  with eager-loader semantics documented inline.

## UI-surface plan checklist

No NEW UI surface is added — this is a defect fix to existing shell chrome
(scroll bodies, header, settings container) + the chat composer seed timing +
the desktop loader/manifest wiring. Precedent for every touched reader is its own
prior behavior; the DoD is that the previously-crashing gallery surfaces
(overlays + deep-chat) now render clean at both themes (runtime-health), and the
desktop `check` + prod build pass. No responsive/scale/JTBD deltas (behavior is
byte-identical when the store IS present — the peek default only engages when the
store is genuinely absent, which never happens on a real in-app route that
renders the layout).
