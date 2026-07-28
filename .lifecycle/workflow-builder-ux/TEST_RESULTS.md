# TEST_RESULTS — workflow-builder-ux

**Status: PARTIAL.** The unit + static tiers are written and OBSERVED green. The
e2e tier is **NOT RUN** — a session limit interrupted this branch, and the
remaining budget went to making the shipped behaviour correct and visually
verified rather than to writing specs that would not be executed. Everything
below is transcribed from a real run; nothing is inferred.

## Observed runs

### Backend unit (`cargo test -p ziee --lib workflow::validate::`)
```
test result: ok. 34 passed; 0 failed; 0 ignored; 0 measured; 1362 filtered out
```
Includes the two new tests:
```
test modules::workflow::validate::humanisation_contract::validation_codes_registry_is_well_formed ... ok
test modules::workflow::validate::humanisation_contract::validation_codes_are_registered_and_humanised ... ok
```

- **TEST-1**: PASS (acceptance, INV-1) — 41 emitted codes, all registered and all
  humanised; scanner self-check asserts it found codes at all.
- **TEST-15**: PASS

### Frontend unit (node:test)
```
validationCopy.test.ts    tests 6   pass 6   fail 0
toolSchemaForm.test.ts    tests 11  pass 11  fail 0
noFreeTextEntityRef.test.ts  tests 3  pass 3  fail 0
```
- **TEST-3**: PASS (acceptance, INV-3) — the class scan + its negative control.
- **TEST-8**: PASS · **TEST-9**: PASS · **TEST-10**: PASS
- **TEST-11**: PASS · **TEST-12**: PASS · **TEST-13**: PASS · **TEST-14**: PASS

### Frontend unit (vitest)
```
ToolCatalog.store.test.ts   Test Files 1 passed (1)   Tests 6 passed (6)
```
- **TEST-16**: PASS — but see its SCOPE NOTE: it proves the pure name→id
  resolution and the "every failure states a reason" rule. It does **not** prove
  the fetch-once cache or the in-flight guard (no `renderHook` in this
  workspace); those need the e2e below.

### Static gates
```
npm run check (ui): PASS
npm run check (desktop/ui): PASS
```
Both full chains (tsc + guardrails + colors + settings-field + adjacent-inline +
icon-action + hooks + logical-direction + tooltip-placement + kit-manifest +
testid-registry + design-spec + gallery-coverage + gallery-crawl +
gallery-fixtures + state-matrix + overlay-registry + override-registry +
gallery-seed-registry + store-actions).

### Runtime health (`gate:ui --skip-visual`)
`tsc: PASS`, `lint: PASS`, `visual: skipped`. `runtime-health` reports **FAIL
overall**, and this branch does **not** claim `gate:ui (ui): PASS`.

Evidence that the failure is environmental, not this diff:
- 4917 of ~5000 HIGH findings are `ERR_NETWORK_CHANGED` (a Vite dep-serving
  condition on this shared box — the documented signature).
- The failing surface SET differs on every run (run 1: file viewers + settings;
  run 2: mcp/hub drawers; run 3: chat + conversations). A real regression fails
  the same surfaces every time.
- Run 1 (warm server): **187/195 surfaces PASS**.
- **All 7 workflow-builder surfaces are clean in ALL THREE runs**: zero HIGH,
  zero MEDIUM. Their only findings are 2× LOW `spacing-grid` (informational,
  never gating; the kit uses 2px half-steps).

## Rendered review — 390 / 768 / 1280, dark theme

Captured with Playwright against the real gallery; per cell: `overflowX` and
console/page errors.

| Surface | 390 | 768 | 1280 |
|---|---|---|---|
| `seeded-wf-builder-tool-schema-form` | no overflow, 0 errors | ✓ | ✓ |
| `seeded-wf-builder-tool-fallback` | ✓ | ✓ | ✓ |
| `seeded-wf-builder-validation-error` | ✓ | ✓ | ✓ |
| `seeded-wf-builder-populated` | ✓ | ✓ | ✓ |
| `seeded-wf-builder-problems` | ✓ | ✓ | ✓ |

Images: `/data/pbya/ziee/tmp/wfb-shots/<slug>-<width>.png`.

Three defects were found by LOOKING (all gates green at the time) and fixed —
see DRIFT-1.7.

## NOT RUN — the e2e tier

These were enumerated in TESTS.md and are **not written and not run**. They are
the proof for the fetch path, the picker's options, the generated form against a
REAL server schema, and the save→reload round-trip:

- **TEST-2** (acceptance, INV-2) — attribution + step-list markers, two broken
  steps, a third selected. *Partially evidenced* by the `seeded-wf-builder-problems`
  render (exactly that scenario) — but a screenshot is not the click-through.
- **TEST-4** (acceptance, INV-3) — picker options == the server's real tools.
- **TEST-5** (acceptance, INV-4) — one control per declared property, from a real
  schema.
- **TEST-6** (acceptance, INV-5) — a `{{ }}` reference in a NUMBER field survives
  save→reload. *Unit-proven* (`coerceToDeclared`) and *render-proven*, but the
  persistence round-trip is unproven.
- **TEST-7** (acceptance, INV-6) — fallback + lossless extra keys. *Render-proven*
  for the visible reason; the round-trip is unit-proven (`splitArguments`) but not
  proven end-to-end.
- **TEST-17** (integration) — `GET /api/mcp/servers/{id}/tools` payload contract.
- **TEST-18 / TEST-20 / TEST-21** — humanised copy e2e, responsive e2e, fixture-
  reality guard.
- **TEST-19** — `builder-step-kinds.spec.ts` was **UPDATED** (it previously
  asserted the free-text tool field as correct, and would now fail). The updated
  spec is written but **not executed**.

**Consequence to be explicit about:** four of the six `[acceptance]` tests are
not executed, so phase 8 does **not** pass and this branch is **not** merge-ready
by the lifecycle's own standard. INV-1 and INV-3 have executed acceptance proofs;
INV-2, INV-4, INV-5, INV-6 have unit + rendered evidence only.

## Pre-existing baseline failures (not caused by this diff)

- `npm run test:unit` (node:test): `tests 666 · pass 651 · fail 15`. All 15 are
  `*.store.test.ts` files authored for **vitest** that the node:test glob
  (`src/**/*.test.ts`) also picks up. 14 of the 15 are untouched by this diff
  (auth, chat, voice, scheduler, background, workflow-run); the 15th is this
  branch's `ToolCatalog.store.test.ts`, which passes under its correct runner.
- `npx vitest run`: `7 failed | 5 passed (12 files)`, `35 tests passed`. All 7
  file-level failures are `TypeError: registerLazyStore is not a function` — a
  module-resolution condition in untouched files, not a test-level failure.
