# FIX_ROUND-1

Blind multi-angle audit (3 fresh agents, diff-only context, 16 distinct angles —
correctness/error-handling/concurrency/state-management/reactive-read-in-loop,
security/perms-authz/api-contract/patterns-conformance/tests-quality,
perf/modularity/extensibility/maintainability/api-friendliness/a11y). The
correctness + security clusters found the diff CLEAN (seam peek, sync seed
idempotency+ordering, loader.desktop no-op semantics, index.ts re-export,
overlay-regex, package.json paths all verified safe). Two CONFIRMED findings,
both fixed this round:

- **maintainability (medium)** — `registry.tsx` async `import().then()` fallback
  was SILENT: an accessor-ordering regression would defer the seed a microtask,
  miss the `chatExtensionsReady` gate, and re-expose the TextStore-undefined
  crash with no signal. **Fixed:** the fallback now emits a `console.warn`
  naming the extension + the module-load-order regression before deferring.

- **patterns-conformance (low)** — the original diff also edited the DEAD
  `KIT_IMPORT_RE` constant (defined but never referenced; the live detection is
  the inline `isKit` block), perpetuating a divergent second source of the
  kit-import list. **Fixed:** reverted the `KIT_IMPORT_RE` edit; only the LIVE
  `isKit` block carries the `@ziee/kit` recognition. Re-verified
  `check:overlay-registry` still detects the 1 host (allow-listed) — green.

The remaining ledger rows are `rejected` (audited, no defensible defect — each
with a recorded rationale): the store-less fallback per-render allocation is
gallery-only/negligible; the `app-seam.test.ts` wiring matches its sibling
framework specs (run by the SDK repo's own `ts-resolve` runner, verified 3/3);
the four-reader `peek() ?? default` repetition matches the existing sibling
style. None are defects.

## Re-audit

Both fixes are additive/subtractive and self-contained: a `console.warn` on a
never-taken-in-practice branch (does not change control flow or the seed result),
and reverting an edit to dead code (restores the base constant). Re-ran `tsc`
(web + desktop: clean) and `check:overlay-registry` (green). No new behavior, no
new confirmed findings.

**New confirmed findings:** 0
