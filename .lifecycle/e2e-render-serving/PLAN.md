# PLAN — e2e-render-serving (robust render-chunk serving under CPU load)

## Problem (confirmed mechanism)

The ~16 deterministic `chat` render specs (`html-iframe-render`,
`markdown-rendering`, and the render-assertion cluster) time out on
`toBeVisible` under CPU saturation — NOT a backend/harness/isolation bug and NOT
a product bug. The e2e frontend is served by a single-threaded `vite preview`
static server (spawned in `tests/fixtures/test-context.ts`). Under CPU
starvation its Node event loop cannot flush socket writes promptly and a
response is cut mid-stream → `net::ERR_INCOMPLETE_CHUNKED_ENCODING`. The render
depends on ON-DEMAND dynamically-imported chunks:

- App-level (via `LazyStreamdown.tsx`): `import('streamdown')` +
  `import('@/modules/chat/core/utils/chatMarkdownPlugins')` /
  `import('@/components/common/streamdownPlugins')`.
- Streamdown-internal (inside the `streamdown` dist): `chunk-BO2N2NFS.js` does
  `lazy(()=>import('./highlighted-body-*.js'))` and
  `lazy(()=>import('./mermaid-*.js'))`. `highlighted-body-*.js` is the chunk the
  definitive investigation named as dropped. (In this build it is a ~527 B shim
  whose heavy dep `chunk-BO2N2NFS` rides `import('streamdown')`.)
- Shiki-grammar tail (via `@streamdown/code` → `shiki` `bundledLanguages`): each
  code language is its OWN dynamic import — the e2e build emits ~200 hashed
  grammar chunks (`rust-*.js`, `python-*.js`, …), each fetched at highlight time.

When any of these drops mid-response, the React.lazy boundary never resolves →
the assistant bubble / html-block / code-block never mounts within the
`toBeVisible` timeout. `markdown-rendering.spec.ts` even carries a stale FIXME
(lines ~142-153) documenting the `highlighted-body-*.js` dynamic-import
fragility.

There is a real reproduction on a quiet box too for `html-iframe-render`
(fails even at `--workers=1` under box load).

## Approach (a combination — justified, not gold-plating)

Two e2e-ONLY changes; the production build (`vite.config.ts`) is untouched, so
no prod regression is possible.

- **#1 Eager-include the streamdown render graph in the e2e build** so the
  markdown / html BLOCK MOUNTS with NO render-time fetch. A committed
  e2e-build-only vite plugin injects a virtual eager module into the entry that
  statically imports `streamdown`, both plugin modules, and the streamdown
  internal `highlighted-body-*.js` / `mermaid-*.js` dist chunks — folding them
  into the entry's static (modulepreloaded-at-boot) graph. At render,
  `import('streamdown')` / `import('./highlighted-body')` resolve from the module
  cache instantly. This FULLY self-contains `html-iframe-render` (html → the
  `HtmlBlock` renderer, no shiki) and collapses the block-mount round-trips out
  of the render-timeout window for `markdown-rendering`.

- **#2 Graph-agnostic robust static delivery** for the ~200 un-enumerable shiki
  grammar chunks + every other asset: an in-memory single-write static
  middleware installed in the generated `vite preview` config
  (`test-context.ts`). It preloads every `dist-e2e` file into RAM once and serves
  a matching GET with a single `res.end(buffer)` + `Content-Length` (never a
  streamed/chunked body), handing the whole response to the OS socket buffer in
  ONE event-loop tick — so CPU starvation after that tick cannot cut it. Runs
  BEFORE the proxy/sirv; `/api`, SPA-fallback and unknown paths fall through
  unchanged.

#1 removes the render-time server-delivery dependency for the block mount; #2
makes the residual grammar (and any other) fetch un-cuttable. Together they make
the deterministic specs pass under saturation.

## Items

- **ITEM-1**: Add a committed e2e-build-only vite plugin
  (`plugins/vite-plugin-eager-render-graph.js`) that (a) exposes a virtual
  module which statically imports `streamdown`, `@/components/common/streamdownPlugins`,
  `@/modules/chat/core/utils/chatMarkdownPlugins`, and the globbed streamdown
  internal `dist/highlighted-body-*.js` + `dist/mermaid-*.js` chunks (referencing
  the namespace imports so tree-shaking cannot drop them), and (b) injects
  `import '<virtual>'` into the app entry (`src/main.tsx`) so those chunks land in
  the entry static graph (modulepreloaded at boot, resolved from cache at render).
- **ITEM-2**: Wire ITEM-1's plugin into the e2e static build in
  `tests/global-setup.ts` (the generated `vite-e2e-build.ts`), alongside
  `moduleManifestPlugin` / `preloadGraphPlugin`. Replace the ineffective
  build-time `optimizeDeps` streamdown lines (optimizeDeps is dev-only, a no-op
  for the static build).
- **ITEM-3**: Add a committed in-memory single-write static middleware helper
  (`tests/fixtures/e2e-static-middleware.mjs`): builds a `Map<urlPath,{buf,type}>`
  from a dist dir once, returns a connect middleware that answers matching GETs
  with `Content-Length` + `res.end(buffer)` + immutable cache header, and calls
  `next()` for everything else. Pure/unit-testable (no server needed to test the
  map-build + content-type + fall-through decision).
- **ITEM-4**: Install ITEM-3's middleware in the generated `vite preview` config
  in `tests/fixtures/test-context.ts` `configurePreviewServer`, BEFORE the
  existing compression-strip + timeout-disable, serving from `dist-e2e`. Keep the
  existing `/api` proxy, xfwd, SSE-timeout-0, and compression-strip behavior
  intact for fall-through requests.
- **ITEM-5**: Remove the now-obsolete stale FIXME block in
  `markdown-rendering.spec.ts` (the `highlighted-body-*.js` dynamic-import
  flakiness note) — the mechanism it describes is fixed by ITEM-1/#2. Do NOT
  change any assertion.

## Files to touch

- `src-app/ui/plugins/vite-plugin-eager-render-graph.js` (new — ITEM-1)
- `src-app/ui/tests/global-setup.ts` (edit — ITEM-2)
- `src-app/ui/tests/fixtures/e2e-static-middleware.mjs` (new — ITEM-3)
- `src-app/ui/tests/fixtures/test-context.ts` (edit — ITEM-4)
- `src-app/ui/tests/e2e/chat/markdown-rendering.spec.ts` (edit — ITEM-5, comment only)
- `src-app/ui/tests/fixtures/e2e-static-middleware.test.ts` (new — TEST unit for ITEM-3)
- `.lifecycle/e2e-render-serving/**` (process artifacts)

## Patterns to follow

- **ITEM-1 plugin** — mirror `src-app/ui/plugins/vite-plugin-preload-graph.js`
  and `vite-plugin-module-manifest.js`: a plain `.js` factory returning a vite
  plugin object with named hooks (`resolveId`/`load`/`transform`). Same import
  style used by `global-setup.ts` for the other two plugins.
- **ITEM-2** — the generated `vite-e2e-build.ts` template string in
  `global-setup.ts` (imports the two existing plugins by absolute path); add the
  third the same way.
- **ITEM-3/4** — mirror the EXISTING `configurePreviewServer` hook in
  `test-context.ts` (the `e2e-disable-preview-compression` plugin) — same
  `server.middlewares.use(...)` insertion point, which the file's own comment
  notes runs BEFORE vite installs its static/compression middlewares.
- **ITEM-3 unit test** — mirror `tests/fixtures/port-manager.concurrency.test.ts`
  (a pure Node `node --test`-style spec over a fixtures module, no React/vite).

## UI-surface checklist

N/A — this feature adds NO user-facing UI surface, route, page, drawer, card, or
permission. It changes ONLY the e2e test build + static-serving infrastructure
(`tests/**` + a build-only `plugins/*.js`). No component renders differently in
production; the app's runtime behavior is byte-identical. Therefore the
per-surface precedent/scale/responsive/JTBD/permission items do not apply, and no
new gallery state, `<Can>` gate, or e2e user-journey surface is introduced.
