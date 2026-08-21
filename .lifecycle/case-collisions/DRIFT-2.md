# DRIFT-2.md — case-collisions (phase 5, second round)

Two divergences surfaced by RUNNING the phase-5 artifacts (rule B7 — reading the
code would not have found either). Both are in the new test surface, not in the fix.

- **DRIFT-2.1** — verdict: impl-wins — ITEM-8's spec addressed the relocated store
  modules in the browser as `/src/modules/…/index.ts`. That path **404s**:
  `src-app/ui/vite.config.ts` sets `root: 'src'`, so `src/modules/x` is served at
  `/modules/x`. The first run failed with `Failed to fetch dynamically imported
  module` on all 24 — which is exactly what the test SHOULD do when a specifier is
  wrong, so the failure was the test working, aimed at the wrong URL.
  Diagnosed by curling the dev server directly:
  `curl -D- -H 'Sec-Fetch-Dest: script' …/src/modules/…/index.ts` → **404**;
  `…/modules/…/index.ts` → **200 text/javascript**. Prefix corrected in both the
  store list's use and the control. Re-run: **13/13 pass**.
  (Note the plain `curl` without `Sec-Fetch-Dest: script` returns Vite's SPA
  fallback HTML with status 200 — a header-less probe would have "confirmed" the
  wrong URL worked.)

- **DRIFT-2.2** — verdict: impl-wins — ITEM-8 planned to drive all 14 overlay-backed
  relocated stores. Two of them, `overlay-hub-model-details-drawer` and
  `overlay-hub-mcp-details-drawer`, cannot mount anything in the gallery **for
  reasons that predate this branch**: their gallery entries render the component with
  NO props (`component: lazyNamed(() => import('…/ModelDetailsDrawer'), …)`, no
  `props`), and both components open with `if (!model) return null` /
  `if (!server) return null`. The entry's `open()` writes to a store the component
  never reads. Contrast the sibling `overlay-hub-assistant-details-drawer`, which
  passes `{ open: true, onClose: noop, assistant: hubAssistantFixture }`.
  **Verified pre-existing, not caused by the move:** neither
  `ModelDetailsDrawer.tsx` nor `McpServerDetailsDrawer.tsx` appears in
  `git diff --name-only origin/main...HEAD`.
  Resolution: the two slugs are excluded from the overlay list with that reasoning
  recorded inline, and both stores remain covered by the spec's first clause (module
  identity for all 24). Per design §4 the underlying gallery-entry defect is
  **reported, not fixed** — it is unrelated debt. Carried into `HUMAN_FEEDBACK.md`
  and the PR body so it is not lost.

Neither drift changed the fix itself; both changed the test that measures it, and in
DRIFT-2.2's case the spec's claim was NARROWED to what it can honestly assert while
its all-24 clause kept coverage whole.

**Unresolved drifts:** 0
