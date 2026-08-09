# PLAN — FileRagAdminPage.test.tsx intermittent failure

## Design source

Realizes the owner's brief ("close the still-open intermittent failure of
`src-app/ui/src/modules/file-rag/pages/FileRagAdminPage.test.tsx`") and the
scoped follow-up recorded in `CLAUDE.md § Known follow-ups` / FB-11 of
`.lifecycle/gallery-harness-reliability/HUMAN_FEEDBACK.md`, which nominates the
un-awaited `cfg.loadModules()` in `sdk/packages/gallery/src/runtime/mount.tsx:58`
as the leading candidate for the residual nondeterminism.

The brief is explicit that the candidate must be VERIFIED, not assumed, and that
a different confirmed cause is itself a valid result.

## Invariants

- **INV-1**: "Reproduce first, and quantify … Establish the baseline rate before
  you change anything." No fix is designed before a measured baseline exists.
- **INV-2**: "Prove it with a rate, not a run." The post-fix claim is a failure
  RATE over >= 20 runs of the same test, under the same conditions as the
  baseline — never a single green run.
- **INV-3**: "verify it actually is the mechanism before assuming." The shipped
  fix must target a mechanism demonstrated red-then-green, not a plausible one.

## Items

- **ITEM-1**: Measure the baseline failure rate of the spec on `origin/main`
  (`dca29493f`, sdk `0ba62538`) over >= 20 runs, sequential AND under
  contention, and CLASSIFY every failure by signature.
- **ITEM-2**: Test the FB-11 hypothesis directly rather than assuming it.
- **ITEM-3**: Test the sibling hypothesis that a store-proxy hook-PATH flip
  (`stores.ts` path 2/3/4 chosen by runtime value type) varies with load.
- **ITEM-4**: Identify the confirmed mechanism and prove it red-then-green
  deterministically.
- **ITEM-5**: Fix that mechanism without weakening what the spec guards.
- **ITEM-6**: Re-measure the failure rate post-fix over >= 20 runs under the
  identical baseline conditions.

## Files to touch

- `src-app/ui/src/modules/file-rag/pages/FileRagAdminPage.test.tsx`

Investigated but deliberately NOT changed (see DECISIONS DEC-2/DEC-3):
`sdk/packages/gallery/src/runtime/mount.tsx`, `sdk/packages/framework/src/stores.ts`,
`sdk/packages/shell/src/app-store-seams.ts`, `src-app/ui/vitest.config.ts`.

## Patterns to follow

- The spec's own header comment is the reference for the harness's authoring
  model (Vitest + jsdom, `.tsx` extension mandatory, real store/proxy/components,
  network stubbed only at the module boundary).
- `JsToolApprovalContent.test.tsx` is the closest sibling component harness.

## Item verdicts (phase-2 audit, against the codebase)

- **ITEM-1** — verdict: PASS — the spec is runnable standalone via
  `npx vitest run <file>`; `vitest.config.ts` includes `src/**/*.test.tsx`.
- **ITEM-2** — verdict: CONCERN — the harness mounts `<FileRagAdminPage />`
  directly and never calls `mountGallery`, so `cfg.loadModules()` is not on its
  code path at all. FB-11 is un-exercisable BY THIS SPEC by construction; it was
  additionally probed through the gallery crawl (see TESTS TEST-2).
- **ITEM-3** — verdict: PASS — `createStoreProxy` (`sdk/packages/framework/src/
  stores.ts:275-299`) selects hook-free vs 2-hook path from the runtime VALUE
  type, so a value that changes type across renders changes hook count. Probe-able.
- **ITEM-4** — verdict: PASS — the per-test budget is observable
  (`--reporter=verbose`) and forceable (`--testTimeout=N`).
- **ITEM-5** — verdict: PASS — no product code changes; the spec keeps its
  per-test budget (see DEC-1).
- **ITEM-6** — verdict: PASS — repeat-run harness is a shell loop; no new tooling.

## Breakage risk

Confined to one spec file. No product code, no public API, no migration, no
permission, no generated file. `npm run check`'s static gates are unaffected by a
test-body change other than `tsc`, which is run.

## Pattern conformance

`beforeAll` with an explicit per-hook timeout is standard Vitest; the spec already
uses `beforeEach`/`afterEach` from the same import.

## Migration collisions

None — no migration touched. Highest server migration prefix unchanged.

## OpenAPI regen

Not implied — no Rust type, handler or schema touched.
