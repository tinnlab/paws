# TESTS

Measurement-driven defect. The "tests" are the reproduction runs plus the
deterministic red/green that pins the mechanism; the shipped regression guard is
the spec itself, now with headroom.

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1] file: `src-app/ui/src/modules/file-rag/pages/FileRagAdminPage.test.tsx` — asserts: a BASELINE failure rate exists before any edit — the spec is run 110x on unmodified `origin/main` (30 sequential + 80 under 8-way contention), every failure classified by signature, and the rate reported. Fails INV-1 if a fix is designed without this number.
- **TEST-2** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-2] file: `sdk/packages/gallery/scripts/runtime-health.mjs` — asserts: the FB-11 hypothesis is TESTED, not assumed — the gallery boot path that actually calls the un-awaited `cfg.loadModules()` is crawled 20x in a real browser against a live gallery origin (`--report-only --only-match=file-rag`) and its gating-HIGH / hook-error count recorded; a green 20/20 refutes FB-11 as the cause of the observed file-rag failure.
- **TEST-3** (tier: unit) [covers: ITEM-3] file: `sdk/packages/framework/src/stores.ts` — asserts: no `(store, prop)` pair changes which `createStoreProxy` path it takes across a run (the only mechanism by which a load race could alter a component's hook COUNT), via a temporary instrumented probe carrying a POSITIVE CONTROL that the probe observed >0 proxy reads, so "no flips" cannot pass vacuously; probe reverted before commit.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-4, ITEM-5] file: `src-app/ui/src/modules/file-rag/pages/FileRagAdminPage.test.tsx` — asserts: the confirmed mechanism is proven red-then-green — at `--testTimeout=2000` (a threshold between the pre-fix and post-fix cost of the first test) the PRE-fix spec FAILS with `Test timed out in 2000ms` and the POST-fix spec PASSES; would fail if the fix did not address the real cause.
- **TEST-5** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-6] file: `src-app/ui/src/modules/file-rag/pages/FileRagAdminPage.test.tsx` — asserts: the post-fix claim is a RATE — the spec is re-run 110x under the IDENTICAL baseline conditions (30 sequential + 80 under 8-way contention) and the failure count reported; a single green run does not satisfy this.
- **TEST-6** (tier: unit) [covers: ITEM-5] file: `src-app/ui/src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx` — asserts: the change breaks no sibling component harness — `npm run test:component` passes for all 9 files / 118 tests, and `tsc --noEmit` is clean.

## Frontend e2e note

`tier: e2e` is satisfied by TEST-2, which drives the real gallery in a real
browser via `runtime-health.mjs`. The diff itself touches only a test file and no
rendered surface, so no new user-visible flow exists to spec.
