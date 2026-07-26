# TESTS — enumerated up front

This feature is e2e-test-INFRASTRUCTURE. Its correctness proof is: (a) unit tests
of the two new pure building blocks (the eager plugin's emitted code + the
in-memory static middleware), and (b) the EXISTING deterministic render specs
passing under INDUCED CPU saturation (the DoD), plus no regression to the
chunk-boundary and general chat render specs. No new product UI surface, route,
or permission is introduced, so there is no `[negative-perm]` spec (no permission
added) and no new gallery state.

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/ui/plugins/vite-plugin-eager-render-graph.test.mjs` — asserts: the plugin's `load()` for the virtual id returns code that statically imports `streamdown`, `@/components/common/streamdownPlugins`, `@/modules/chat/core/utils/chatMarkdownPlugins`, and at least one globbed streamdown-internal `highlighted-body-*.js` path, and references the imports (tree-shake-proof `globalThis` sink); and its `transform()` prepends `import '<virtual>'` ONLY for the `src/main.tsx` entry (and no-ops for other ids).
- **TEST-2** (tier: unit) [covers: ITEM-3] file: `src-app/ui/tests/fixtures/e2e-static-middleware.test.mjs` — asserts: `buildAssetMap(dir)` maps every file under a temp dist tree to `{buf, type}` with correct Content-Type by extension (`.js`→`text/javascript`, `.css`→`text/css`, `.html`→`text/html`, `.woff2`→`font/woff2`); the middleware answers a GET whose pathname is in the map with the exact bytes + a numeric `Content-Length` + immutable `Cache-Control` via a single `res.end(buffer)` (no chunked/streamed write); and calls `next()` (serves nothing) for an `/api/*` path, an unknown path, and a non-GET method.
- **TEST-3** (tier: e2e) [covers: ITEM-1, ITEM-2, ITEM-4, ITEM-5] file: `src-app/ui/tests/e2e/chat/html-iframe-render.spec.ts` — asserts: (existing spec, unchanged assertions) the html-block mounts, toggles Code/Preview, sandbox posture holds — MUST PASS under induced CPU saturation (the block-mount no longer depends on a render-time chunk fetch).
- **TEST-4** (tier: e2e) [covers: ITEM-1, ITEM-2, ITEM-4, ITEM-5] file: `src-app/ui/tests/e2e/chat/markdown-rendering.spec.ts` — asserts: (existing spec, unchanged assertions) GFM table, Shiki-highlighted rust code (colored tokens), footnotes, mermaid-as-code-block — MUST PASS under induced CPU saturation (block mount via eager graph; shiki grammar delivered by the robust in-memory static middleware).
- **TEST-5** (tier: e2e) [covers: ITEM-1, ITEM-2, ITEM-4] file: `src-app/ui/tests/e2e/16-smart-loading` — asserts: NO REGRESSION — the per-module chunk-naming smart-loading specs still pass (the eager plugin adds edges/a virtual module but does not rename module-boundary chunks).
- **TEST-6** (tier: e2e) [covers: ITEM-3, ITEM-4] file: `src-app/ui/tests/e2e/chat/chat-basic.spec.ts` — asserts: NO REGRESSION — a general chat flow (login → send → assistant bubble) still works end-to-end, proving the in-memory static middleware falls through correctly for `/api` (proxy) + SPA routing and does not break the non-render path.

## DoD proof procedure (the load-robustness evidence — recorded in TEST_RESULTS.md)

1. **Reproduce OLD** (baseline, pre-fix serving): with `stress-ng --cpu $(nproc)`
   (or an equivalent busy-loop matching the box's real load) running, execute
   TEST-3 + TEST-4 and confirm they FAIL with `net::ERR_INCOMPLETE_CHUNKED_ENCODING`
   on the streamdown/`highlighted-body` chunk (block never visible).
2. **Prove NEW**: with the SAME induced CPU load, run TEST-3 + TEST-4 **10×
   consecutively at 8 workers** — all 10 green. Real before→after numbers
   captured in `TEST_RESULTS.md` + the tee'd logs under
   `/data/pbya/ziee/tmp/lifecycle-logs/`.
3. **Static gate**: `npm run check` (ui) PASS; the e2e build change does not break
   the production build (`npm run build` / `vite.config.ts` untouched).
