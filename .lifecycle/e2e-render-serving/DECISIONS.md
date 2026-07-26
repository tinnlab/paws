# DECISIONS — resolved up front

### DEC-1: Which fix — eager-include (#1), resilient server (#2), or both?
**Resolution:** BOTH. #1 (eager-include streamdown + plugins + `highlighted-body`
into the e2e entry static graph) makes the markdown/html BLOCK MOUNT with no
render-time fetch — fully self-containing `html-iframe-render` (html → renderer,
no shiki) and lifting the block-mount round-trips out of the `toBeVisible`
window. #2 (in-memory single-write static middleware) is graph-agnostic and
covers the ~200 un-enumerable shiki grammar chunks + every other asset, so a
starved event loop cannot cut any response mid-flight.
**Basis:** codebase — the e2e chunk-graph probe showed `highlighted-body-*.js`
(a 527 B shim over `chunk-BO2N2NFS`, which rides `import('streamdown')`) plus
~200 hashed shiki grammar chunks, all lazy/on-demand. #1 alone leaves the grammar
tail render-time; #2 alone leaves 3-4 sequential render-time round-trips that can
still blow the timeout under saturation. The task explicitly anticipates "likely
a combination."

### DEC-2: Where does the eager plugin live — inline in global-setup or a committed file?
**Resolution:** a committed file `src-app/ui/plugins/vite-plugin-eager-render-graph.js`,
imported by `global-setup.ts` the same way it imports `moduleManifestPlugin` /
`preloadGraphPlugin`.
**Basis:** convention — mirrors the two existing build plugins; a permanent
product-tree path (never `.lifecycle/`, so B6-safe) and unit-testable.

### DEC-3: Where does the static middleware live — inline in test-context or a committed helper?
**Resolution:** a committed helper `src-app/ui/tests/fixtures/e2e-static-middleware.mjs`
(pure `buildAssetMap` + `makeStaticMiddleware`), installed from the generated
`vite preview` config in `test-context.ts`.
**Basis:** convention — keeps the generated config small and makes the logic
unit-testable like `tests/fixtures/port-manager.*` (a pure Node fixtures module).

### DEC-4: Does any change affect the PRODUCTION build?
**Resolution:** NO. The eager plugin is wired ONLY into `global-setup.ts`'s
e2e static build; the middleware lives ONLY in the e2e preview config.
`vite.config.ts` (prod) and `src-app/desktop/ui/` are untouched.
**Basis:** codebase — prod chunking/smart-loading manifest is unchanged.

### DEC-5: In-memory middleware — hold all assets in RAM?
**Resolution:** YES, load every `dist-e2e` file into a `Map` once at preview
start. `dist-e2e` is ~21 MB (probe build); trivially held per preview process,
and the whole point is a single `res.end(buffer)` with no disk-stream stall.
**Basis:** measured — 21 MB probe build; acceptable per-worker RAM.

### DEC-6: Is any operational tunable / admin-configurable setting introduced?
**Resolution:** NO. This is e2e TEST INFRASTRUCTURE, not a product feature —
no resource limit, retention, quota, toggle, or model selection reaches an
operator. All choices (eager set, in-memory serving) are fixed test-infra
decisions with codebase precedent; no settings table / migration / REST / sync /
admin card applies.
**Basis:** convention — the configurable-settings rule targets product
operational tunables; test-harness behavior is not one.

### DEC-7: Should the eager set ALSO statically include all ~200 shiki grammars?
**Resolution:** NO. Enumerating/globbing ~200 hashed, version-churning shiki
grammar chunks into the entry is fragile and heavy. The graph-agnostic in-memory
middleware (#2) delivers the grammar chunk robustly instead — the render-time
grammar fetch only affects token COLORS (a later assertion with its own generous
timeout), not the block mount.
**Basis:** codebase — grammar chunks are hashed and numerous; #2 covers them
without enumeration.

### DEC-8: Which Content-Types must the middleware map?
**Resolution:** cover the asset extensions present in `dist-e2e`: `.js/.mjs`→
`text/javascript`, `.css`→`text/css`, `.html`→`text/html`, `.json`→
`application/json`, `.svg`→`image/svg+xml`, `.woff2`→`font/woff2`, `.woff`→
`font/woff`, `.ttf`→`font/ttf`, `.png`→`image/png`, `.wasm`→`application/wasm`,
`.map`→`application/json`; default `application/octet-stream`.
**Basis:** codebase — the probe `dist-e2e` asset listing (js/css/svg/katex fonts).

### DEC-9: Keep the existing compression-strip + timeout-disable + /api proxy?
**Resolution:** YES — unchanged. The in-memory middleware runs FIRST and answers
only known-asset GETs; `/`, SPA routes, and `/api` fall through to the existing
compression-strip / SSE-timeout-0 / proxy behavior exactly as before.
**Basis:** codebase — the fall-through must preserve login/API/SPA routing.
