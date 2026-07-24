# TESTS — enumeration

This is a bugfix of pre-existing UI-gate breakage; the primary verification is
the gates going GREEN plus a runtime-health regression assertion that the
previously-crashing surfaces now render clean. No new permission is introduced
(no `X::use`/`X::read`/`X::manage`, no migration grant) → no A9/A10
restricted-user spec required.

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `sdk/packages/framework/src/app-seam.test.ts` — asserts: `get()` throws before injection; `peek()` returns `null` (never throws) before injection; both return the SAME injected view (reference-identity preserved) after `set()`.

- **TEST-2** (tier: e2e) [covers: ITEM-1, ITEM-2, ITEM-3] file: `src-app/ui/src/dev/gallery/RUNTIME_FINDINGS.jsonl` — asserts: the previously-crashing surfaces render clean under the `gallery:runtime` / `gate:ui` runtime-health browser-verify harness (A6/A7) — ZERO `[app-seam] "AppLayout" store was not registered` findings across all overlays, and ZERO `chatStore.TextStore … undefined` findings across the deep-chat/seeded surfaces, at both themes. Real-render proof for the AppLayout peek (ITEM-1/2) and the TextStore synchronous seed (ITEM-3).

- **TEST-3** (tier: e2e) [covers: ITEM-1, ITEM-2, ITEM-3] file: `src-app/ui` (`npm run gate:ui`) — asserts: the web UI gate passes with 0 gating HIGH runtime-health findings attributable to code (the A7 boot/runtime canary — the app boots and every touched gallery surface renders without a console error / uncaught exception / ErrorBoundary crash), distinguishing real findings from Category-B shared-box transport noise (`net::ERR_NETWORK_CHANGED` / `504 Outdated Optimize Dep`).

- **TEST-4** (tier: e2e) [covers: ITEM-4, ITEM-5, ITEM-6, ITEM-7, ITEM-9, ITEM-10] file: `src-app/desktop/ui` (`npm run check` + `vite build`) — asserts: desktop `npm run check` passes end-to-end — `check:kit-manifest` (ITEM-4), `check:design-spec` (ITEM-6), `check:overlay-registry` (ITEM-7), `check:gallery-seed-registry` (ITEM-9) all green — AND the desktop production build (`vite build`) succeeds: the shared `RouterComponent` import of the four router functions resolves against `loader.desktop.ts` (ITEM-5, no MISSING_EXPORT) and `virtual:ziee-module-manifest` no longer leaks into the desktop bundle (ITEM-10).

- **TEST-5** (tier: e2e) [covers: ITEM-8] file: `src-app/ui` + `src-app/desktop/ui` (`npm run check` → `check:state-matrix`) — asserts: the regenerated `stateMatrix.generated.ts` matches source in BOTH workspaces (web `check:state-matrix` + desktop `check:state-matrix` are green), so the state-matrix drift gate passes.

## Frontend-gate lines (phase 8, TEST_RESULTS.md)

- `npm run check (ui): PASS`
- `npm run check (desktop/ui): PASS`
- `gate:ui (ui): PASS`

## Coverage mapping (every ITEM covered)

- ITEM-1 → TEST-1, TEST-2, TEST-3
- ITEM-2 → TEST-2, TEST-3
- ITEM-3 → TEST-2, TEST-3
- ITEM-4 → TEST-4
- ITEM-5 → TEST-4
- ITEM-6 → TEST-4
- ITEM-7 → TEST-4
- ITEM-8 → TEST-5
- ITEM-9 → TEST-4
- ITEM-10 → TEST-4
