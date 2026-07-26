# DRIFT-1 — implementation vs plan (Phase 5)

Reconciled the implemented diff against PLAN.md / DECISIONS.md.

- **DRIFT-1.1** — verdict: resolved — Plan said "resolve the streamdown package
  dir" for the internal chunks. Implementation first used
  `createRequire(...).resolve('streamdown')`, which THROWS
  `ERR_PACKAGE_PATH_NOT_EXPORTED` because streamdown's `exports` map defines only
  an `import` condition (no `require`/`default`). Switched to ESM
  `import.meta.resolve`. Caught by unit TEST-1's `plugin.load()` case, not in
  production. No plan change — this is an implementation detail within
  "resolve the package dir." Resolved.

- **DRIFT-1.2** — verdict: none — Plan described #1 as folding the render graph
  into "the entry static (modulepreloaded-at-boot) graph." The probe build showed
  rolldown does one better: it MERGES `streamdown` + `chunk-BO2N2NFS` +
  `highlighted-body-*` directly INTO the entry chunk `index-*.js` (the separate
  `highlighted-body-*.js` file disappears entirely; the entry contains the
  `data-streamdown` components). The render-time `import('streamdown')` /
  `import('./highlighted-body')` therefore resolve from the already-loaded ENTRY,
  which is STRONGER than a preloaded sibling chunk (no separate request at all).
  This matches the plan's intent (no on-demand render fetch) — not a divergence.

- **DRIFT-1.3** — verdict: none — Plan/DEC-8 listed the Content-Type map; the
  implementation covers exactly those extensions plus a few obvious siblings
  (jpg/gif/ico/webp/txt) for completeness. Within the decision's scope.

- **DRIFT-1.4** — verdict: none — Plan ITEM-2 said "remove the ineffective
  optimizeDeps streamdown lines"; done, replaced with a one-line explanatory
  comment (optimizeDeps is dev-only; the eager plugin now owns the concern).

**Unresolved drifts:** 0
