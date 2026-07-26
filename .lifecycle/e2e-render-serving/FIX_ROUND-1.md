# FIX_ROUND-1 — remediation of confirmed blind-audit findings

Three blind auditors (correctness/security/perf; patterns/tests/maintainability/
modularity/extensibility; api-contract/generated-string/scope/i18n) ran over
`git diff main...HEAD` with diff-only context. Confirmed findings and their
fixes:

- **Data-driven internal-chunk glob** (correctness/maintainability/extensibility,
  medium ×3) — `resolveStreamdownInternalChunks` now globs EVERY `dist/*.js`
  except `index.js` and `chunk-*`, so mermaid + any FUTURE streamdown internal
  async chunk is folded automatically. The highlighted-body sanity guard is
  retained (throws on layout change). Fixes the "mermaid silently omitted".
- **serveDirFromMemory silent catch** (error-handling, medium) — now WARNS on a
  missing/unreadable dist dir (with the reason) and on an EMPTY dir (zero assets),
  instead of silently reverting to the flaky sirv path. Still degrades to
  pass-through so the preview boots.
- **isEntryId over-match** (correctness/maintainability, low/medium) — the plugin
  accepts an explicit `entry` absolute path; `global-setup.ts` passes
  `resolve(srcRoot,'main.tsx')`, so the eager import is injected into ONLY that
  exact module (suffix fallback retained for safety).
- **index.html Cache-Control** (maintainability, low) — unhashed `index.html` is
  served `no-cache`; only hashed assets stay `immutable`.
- **Stale plugin name** (api-friendliness, low) — the preview plugin renamed
  `e2e-preview-static-serving-and-compression` (it now also mounts the in-memory
  server).
- **Test strengthening** (tests-quality, medium ×2 + low): plugin tests now (a)
  cover the data-driven glob incl. a NEW future-prefix async chunk, (b) cover the
  mixed-case highlighted-body-absent throw (mermaid present), (c) assert the two
  hardcoded `@/...` app-plugin module files EXIST on disk (guards a rename that
  string-match tests would miss), (d) cover the explicit-entry match. Middleware
  tests add the empty-dir fall-through + the index.html-no-cache/asset-immutable
  split.

Rejected as false positives (recorded in LEDGER): traversal safety (Map is
pre-walked, not path-resolved), concurrency hazard (per-process map, read-only),
generated-string validity (all via JSON.stringify), prod-isolation leak
(vite.config.ts untouched), api-contract mismatch (signatures consistent).
Accepted by design: ~21MB in-RAM per preview (e2e-only), #1/#2 overlap (DEC-1
rationale — #1 removes render-time round-trips, #2 makes delivery un-cuttable).

## Re-review of the fix delta

The remediation delta (data-driven glob, warn-on-missing, entry anchor,
cache-control split, test additions) was re-reviewed against the same angles.
All changes are contained, additive hardening; `tsc` clean, `npm run check` (ui)
PASS, and both unit suites green (8 + 9). Verified the e2e build still folds
highlighted-body into the entry after the glob change.

**New confirmed findings:** 0
