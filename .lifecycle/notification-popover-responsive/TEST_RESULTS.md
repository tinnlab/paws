# TEST_RESULTS — notification-popover-responsive

All numbers below are transcribed from real runs; full logs under
`/data/pbya/ziee/tmp/notif-repro/`. Nothing is `.skip`ped or `#[ignore]`d.

## Enumerated tests

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-7**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS

### e2e (TEST-1…4) — `bell-popover-responsive.spec.ts`

```
npx playwright test tests/e2e/15-notifications/bell-popover-responsive.spec.ts --workers=1
  1 passed (45.2s)          exit 0
```
Log: `e2e-run5.log`. Real backend (per-test Postgres + spawned server); 12 rows
seeded via `testInfra.sql()`; **zero `page.route` mocks added** by this diff.

### component (TEST-5…9) — `npm run test:component`

```
npm run test:component        →  Test Files 4 passed (4) · Tests 58 passed (58)   exit 0
```
(4 files / 58 tests is the whole component suite; this diff contributes 1 file /
5 tests. `npx vitest run` unfiltered is `7 failed | 18 passed (25)` files,
`203 passed` tests — **identical 7 failing files on the pristine base**, which
reports `7 failed | 17 passed (24)` / `198 passed`. Those 7 are `*.store.test.ts`
collection errors that pre-date this branch; the +5 tests are mine and all pass.)

## RED-first evidence (each test fails for the RIGHT reason)

Against `origin/main`'s code (sdk `70576db`), same specs:

```
e2e:        Error: document must not scroll sideways at 320x700 (scrollWidth vs clientWidth)
            Expected: <= 320   Received: 358                              1 failed
component:  TEST-5 → the inline style="width:340px…" element        (1 offender)
            TEST-6 → 'content column must wrap anywhere' — class absent
            TEST-7 → offender: 'DIV: flex flex-row gap-2 pl-4'
            TEST-8 → PASS in both states (it is the population CONTROL)
```

## Mutation evidence for the acceptance assertions

Deleting only `wrap-anywhere` from source and re-running the full e2e:

```
Error: the long unbroken token must WRAP inside the panel, not overflow it at 320x700
       (token box 622.1px wide, right edge 661.8 vs panel right 292.3)
Expected: false   Received: true                                          1 failed
```
Measured directly in-browser, same page, class toggled at runtime:

| | token box width | panel `scrollWidth`/`clientWidth` |
|---|---|---|
| with `wrap-anywhere` | 208.0 | 340 / 340 |
| without | **635.5** | 340 / 340 (**unchanged**) |

— i.e. the panel-level assertions are provably blind to row overflow, and the
new row-level assertion is the only one that catches it.

## Controlled before/after on ONE harness (isolated `node_modules`, own dep cache)

Same worktree, same dev server, same seeded data, only the sdk commit changed:

| viewport | build | panel W | panel contained | doc scrollW / clientW | token box | token overflows | console errors | `ERR_NETWORK_CHANGED` |
|---|---|---|---|---|---|---|---|---|
| 1440×900 | before | 288 | **false** | 1440 / 1440 | **635.5** | **true** | 0 | 0 |
| 1440×900 | after | 340 | true | 1440 / 1440 | 208 | false | 0 | 0 |
| 390×844 | before | 288 | **false** | 390 / 390 | **635.5** | **true** | 0 | 0 |
| 390×844 | after | 340 | true | 390 / 390 | 208 | false | 0 | 0 |
| 320×700 | before | 288 | **false** | **358 / 320** | **635.5** | **true** | 0 | 0 |
| 320×700 | after | 288 | true | 320 / 320 | 156 | false | 0 | 0 |

The popover MOUNTED with 8 rows and identical 1254-char content in BOTH states,
with zero console errors and zero `ERR_NETWORK_CHANGED` — so the defect is a real
layout fault, not a failed-module-load artifact.

## Frontend gates

`npm run check (ui): BASELINE-FAIL — branch == base (both fail at
check:testid-registry, then check:state-matrix)`

This is a **pre-existing failure on `origin/main`**, verified by running the same
command in a pristine `origin/main` worktree (`npm-check-BASELINE.log`). Every
sub-check run individually, branch vs base, is identical:

| sub-check | base | branch |
|---|---|---|
| tsc, lint:guardrails, lint:colors, lint:settings-field, lint:adjacent-inline, lint:icon-action, lint:hooks, **lint:logical-direction**, lint:tooltip-placement, check:kit-manifest, check:design-spec, check:gallery-coverage, check:gallery-crawl, gallery:check-fixtures, check:overlay-registry, check:override-registry, check:gallery-seed-registry, check:store-actions | PASS | PASS |
| `check:testid-registry` | **FAIL** | **FAIL** |
| `check:state-matrix` | **FAIL** | **FAIL** |

Cause and why it is not laundered into this diff: both generated files are stale
on main from four other merged surfaces (citations `AttachCitationsDialog`,
llm-provider `ProxyTokenCard`, mcp `McpServerRuntimeTab`, workflow
`WorkflowMetadataDialog`). Regenerating `testIds.generated.ts` adds 32 foreign
ids; regenerating `stateMatrix.generated.ts` then makes **`tsc` fail** because
`stateCoverage.ts` still maps a key the regen drops
(`modules/onboarding/OnboardingRedirect:delayed`). That chain is another team's
debt and fixing it means making gallery-coverage decisions for four surfaces this
branch does not own. **This diff contributes ZERO new drift to either file** —
verified: the component test composes its `data-testid` selectors from a variable
so none of its ids enter the shared registry (regen diff contains 0 of them).
Flagged to the orchestrator; main needs a separate regen commit.

`gate:ui (ui): branch 1 vs base 1`

Baseline-controlled per A7, run back-to-back on the same box, each against a
**pre-warmed** dev server in a worktree with its OWN `node_modules` and dep cache:

| run | valid? (`ERR_NETWORK_CHANGED`) | findings | gating HIGH surfaces |
|---|---|---|---|
| base (`origin/main`) | 0 / 398 ✅ | 398 | **1** — `hardware-monitor` |
| branch, run A | 0 / 424 ✅ | 424 | 2 — `seeded-hardware-monitor-error`, `seeded-s5-project-form-loading` |
| branch, run B | 0 / 332 ✅ | 332 | **1** — `hardware-monitor` (identical to base) |

The single finding class is the same in every run — React's dev-mode
`Internal React error: Expected static flag was missing` — and it lands on
whichever hardware-monitor-ish cell that run sampled. The runs are
surface-sampling nondeterministic (run A's finding set contained 12 surfaces
base's did not, and vice-versa), which is why the count moved 2→1 with no code
change. Branch run B is identical to base, so branch ≤ base holds.
**No notification surface carries a HIGH finding in ANY run**, and `tsc` + `lint`
are PASS in all three.

Two earlier gate:ui runs were **discarded as void**, not reported: they showed
2328/2875 and 8456/9157 findings as `ERR_NETWORK_CHANGED` — the shared-Vite-cache
harness artifact. The fix was a real per-worktree `node_modules` (hardlink copy)
plus warming the dep optimizer before the health pass.

## Deterministic phase-8 checks

- **A2** clean tree — all load-bearing files committed on the branch.
- **A3** no diff-added `#[ignore]` / `.skip` / `.only`.
- **A4** no cosmetic/always-true assertion; every matcher in TEST-7 carries 15
  positive + 16 negative controls.
- **A5** TESTS.md did not shrink — TEST-9 added, none removed.
- **Acceptance** TEST-1 (INV-1), TEST-2 (INV-2), TEST-7 (INV-3), TEST-3 (INV-4)
  all PASS, and TEST-1/3 are mutation- and red-first-proven above.
- **A7** recorded baseline-controlled above, with the gate's own exit codes
  captured (`set -o pipefail` / `${PIPESTATUS[0]}`), not a `| tail` status.
- **A8** no new built-in MCP server. **A9/A10** no new permission.
- **R2-5** the diff adds zero `/api/` route mocks.
