# INFRA_INTEGRATION — per-item walks (Phase 5)

This feature has NO product entities and NO user-facing UX surface, so the
entity-lifecycle and UX walks are N/A in the product sense. The meaningful walk
is the INFRASTRUCTURE-INTEGRATION walk: every e2e subsystem the build/serving
change touches, and how each is preserved.

## UX walk (the "user" = test author / CI)
The observable experience is: the deterministic chat render specs mount their
target (assistant bubble / html-block / code-block) and pass DETERMINISTICALLY
even when the box is CPU-saturated — no `ERR_INCOMPLETE_CHUNKED_ENCODING`,
no `toBeVisible` timeout. Nothing about the running APP changes for a real user;
`LazyStreamdown` still `import()`s, just from cache.

## Infra-integration walk (subsystems touched)

- **`/api` reverse proxy (`vite preview` proxy → this test's backend)** — the
  in-memory middleware answers ONLY GETs whose pathname is a built asset; `/api/*`
  is never in the asset map → `next()` → the existing proxy handles it unchanged.
  VERIFIED by unit TEST-2 (`/api/sync/subscribe` falls through) + Phase-8
  `chat-basic` (real login/send over `/api`).
- **Long-lived SSE (`/api/sync/subscribe`, `/api/chat/stream`)** — proxied under
  `/api`, so it falls through the middleware. The existing `timeout:0` /
  `proxyTimeout:0` + `keepAliveTimeout/headersTimeout/requestTimeout = 0` on the
  preview httpServer are UNCHANGED (my middleware install sits before them but
  only intercepts asset GETs). No SSE behavior change.
- **SPA routing / deep links** — the bare `/` and app routes (`/chat/...`) are NOT
  in the asset map (index.html is keyed `/index.html`, not `/`), so they
  `next()` → vite preview's SPA fallback serves index.html as before. VERIFIED by
  unit TEST-2 (`/chat/...` falls through) + the fact every Phase-8 spec navigates
  SPA routes.
- **Smart-loading module loader (`virtual:ziee-module-manifest`)** — the eager
  plugin adds a SEPARATE virtual module + static edges; it does not touch
  `moduleManifestPlugin` nor the `chunkFileNames` module-boundary naming in the
  real build config. Risk: streamdown moving into the entry chunk. VERIFIED by
  Phase-8 `16-smart-loading` (module.* chunk naming + per-module load still work).
- **Compression-strip + Content-Length hardening (existing
  `e2e-disable-preview-compression`)** — preserved verbatim; the new middleware is
  ADDED before it and only handles asset GETs. Fall-through requests still get the
  accept-encoding strip.
- **Production build (`vite.config.ts`) + desktop build (`src-app/desktop/ui/`)** —
  NOT loaded by this plugin/middleware. Untouched. VERIFIED: no edit to those
  files; `tsc` (ui) clean; prod build unaffected (Phase 8 records the prod build).
- **Module resolution of `streamdown`** — streamdown's `exports` map defines only
  an `import` condition (no `require`), so CJS `require.resolve` throws
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. The plugin uses ESM `import.meta.resolve`.
  CAUGHT by unit TEST-1 during implementation (see DRIFT-1).
