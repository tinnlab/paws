# PLAN_AUDIT — audited against the codebase

## Breakage risk

- **ITEM-1 (eager plugin)** — the plugin is used ONLY by the e2e static build
  (`global-setup.ts`). It does NOT touch `vite.config.ts` (prod) nor the desktop
  build, so production bundling / chunking / the smart-loading module manifest
  are unaffected in prod. Risk within e2e: moving `streamdown` + plugins +
  `highlighted-body`/`mermaid` into the entry static graph enlarges the initial
  bundle for the e2e build. This is intentional and acceptable for e2e; the only
  spec that inspects chunk boundaries is `16-smart-loading` — it asserts
  per-MODULE chunk naming (`assets/module.<name>.[hash].js`), which the eager
  plugin does not alter (it adds a virtual module + static edges, not a rename).
  Verify `16-smart-loading` still passes (Phase 8).
- **ITEM-1 entry injection** — prepending `import '<virtual>'` to `src/main.tsx`
  runs the eager module's side effect (a `globalThis` sink assignment) at boot.
  No behavioral change to the app; `LazyStreamdown` still calls `import()` — it
  simply resolves from cache. The Suspense fallback path is preserved (if a chunk
  somehow still isn't loaded, React.lazy re-imports as before).
- **ITEM-3/4 (in-memory middleware)** — must fall through (`next()`) for `/api`
  (proxy), `/` and SPA routes (index.html fallback), and any path not in the
  asset map, or it would break login/API and deep-link routing. Mitigated: the
  middleware only answers GETs whose pathname exactly matches a built asset key
  (i.e. `/assets/*` and other emitted files), never `/api/*` and never SPA
  routes. HEAD/range requests: serve `Content-Length` + full body on GET only;
  fall through otherwise (assets are fetched by the module loader with plain
  GETs — no Range). Verify the full e2e chat flow (login → send → render) still
  works (Phase 8).
- **ITEM-5 (comment removal)** — pure comment deletion; zero assertion change,
  zero runtime effect.

## Pattern conformance

- ITEM-1 mirrors `plugins/vite-plugin-preload-graph.js` /
  `vite-plugin-module-manifest.js` (a `.js` factory returning a named plugin
  object). Import wire-in mirrors how `global-setup.ts` already imports those two
  by absolute path. PASS.
- ITEM-3 unit test mirrors `tests/fixtures/port-manager.concurrency.test.ts` (a
  pure-Node fixtures test). PASS.
- ITEM-4 mirrors the existing `e2e-disable-preview-compression`
  `configurePreviewServer` hook insertion point. PASS.

## Migration collisions

None — this feature adds no migration and no SQL. `ls migrations-merged | tail`
= `202607191300_agent_delegate_enabled.sql`; untouched. PASS.

## OpenAPI regen

Not required — no Rust type/handler/route/enum change; `openapi.json` and
`api-client/types.ts` are untouched in both `ui/` and `desktop/ui/`. PASS.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — e2e-build-only plugin mirroring the two existing
  build plugins; prod build untouched; only added risk (larger e2e initial
  bundle, smart-loading chunk-naming) is verifiable by the `16-smart-loading`
  spec in Phase 8.
- **ITEM-2** — verdict: PASS — additive plugin wire-in in the generated
  `vite-e2e-build.ts`; removes only the proven-ineffective (dev-only)
  `optimizeDeps` streamdown lines.
- **ITEM-3** — verdict: PASS — self-contained, unit-testable fixtures helper; no
  existing caller affected (new module).
- **ITEM-4** — verdict: PASS — additive middleware in the existing
  `configurePreviewServer` hook; fall-through preserves `/api` proxy + SPA
  routing + the existing compression-strip/timeout-disable behavior.
- **ITEM-5** — verdict: PASS — comment-only deletion; no assertion touched.
