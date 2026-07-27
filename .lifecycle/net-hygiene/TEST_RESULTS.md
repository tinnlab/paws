# TEST_RESULTS — net-hygiene

Diff base for every gate: `a02c09a04` (the current `origin/feat/agent-core` tip,
merged into this branch — see DRIFT-4.1). Full logs under
`/data/pbya/ziee/tmp/lifecycle-logs/`.

## Unit (`npm run test:unit`, `src-app/ui`)

Command: `cd src-app/ui && node --import ./scripts/node-test-loader.mjs --test <files>`
→ **37 tests, 37 pass, 0 fail** (final, at base `a02c09a04`).

- **TEST-1**: PASS — 4 cases (one shared run + one value; shared rejection; distinct key/identity never joined; a later call refetches — it is not a cache) + the aliasing case (a joiner gets an isolated copy; mutating it does not corrupt the issuer's).
- **TEST-2**: PASS — 3 cases (a post-mutation GET does not join a pre-mutation in-flight one; settling a superseded entry does not evict the newer one; a request older than `MAX_JOIN_AGE_MS` is no longer joinable).
- **TEST-3**: PASS — a sync-frame epoch bump makes the notify-and-refetch round-trip real.
- **TEST-4**: PASS — 7 cases (chunk fetched once AND the action's own guard becomes reachable; steady-state dispatch unchanged; EVERY cold-window call reaches the body so two different callbacks both fire; two identical cold-window mutation dispatches both run; a TRANSIENT chunk failure is retried; a DETERMINISTIC resolve failure is memoized after one retry so it cannot become an unbounded loop; `preload` does not invoke).
- **TEST-7**: PASS — 10 cases: the two original `[acceptance]` legs (a mutation and an inbound sync frame each un-suppress immediately); the interleaving leg (a `/me` IN FLIGHT across a mutation is not marked fresh); and three added in fix round 2 — a caller may NOT join a `/me` issued in an older epoch, `force` beats BOTH the join and the skip, and an out-of-band identity change (a local `endSession()`, or a session seeded over Tauri IPC) disarms the window.
- **TEST-8**: PASS — 5 cases (capacity floor; the floor is RAISED never lowered, at 30 s and 20 s; jitter spreads refused clients; a non-429 keeps the 1 s transient recovery; neither path exceeds `MAX_BACKOFF_MS`).
- **TEST-9**: PASS — 6 cases. `node --test .lifecycle/net-hygiene/tests/excluded-endpoints.test.mjs`: no changed file references the excluded endpoints; no generated api-contract file regenerated; no server-side file touched; the diff is non-empty; the generated indexes carry no semantic change (a line may be RENUMBERED but never added or removed); and the sdk submodule was actually scanned (no silent degraded mode). Both bases are resolved by `git merge-base` against the upstream branch rather than hardcoded — a hardcoded sha silently widened the scan across a re-baseline and reported the OTHER branch's changes as this one's violations.
- **TEST-10**: PASS — a differing-intent notification reload is never dropped (and each load carries its own `page`); `registerModule` reuses an already-registered proxy while a first-time registration still creates one.
- **TEST-13**: PASS — `cd src-app/desktop/ui && npx vitest run src/core/local-override-resolver.test.ts` → 6 pass. Against the REAL trees, `@/modules/auth/bootSessionVerify` binds the desktop NO-OP twin, with a same-module control that a file without a twin still binds core.
- **TEST-6**: PASS — `buildLoadContext` reads no persisted-session field (`token` / `expiresAt` / `expiresIn`) at all. (Repurposed with the ITEM-6 descope — see TESTS.md; the pre-descope version of this ID was tautological and is gone.)
- **TEST-14**: PASS — 3 cases: the `isAuthenticated:` VALUE EXPRESSION equals `!!auth.isAuthenticated` (so a reintroduction under ANY identifier fails, and a reformat does not); no persisted field (`token`/`expiresAt`/`expiresIn`) is read at all; permissions still come from the non-persisted snapshot and every perm goes through `evaluatePermission`.

**Pre-existing red, unchanged by this branch:** the full `npm run test:unit` run
is 540 tests / 528 pass / 12 fail. The SAME 12 spec files fail for the SAME
reason (`ERR_MODULE_NOT_FOUND` on a relative app import) on the UNMODIFIED base
worktree — verified by running the identical command there. This branch adds 34
passing tests (plus 6 in the desktop workspace) and turns none red. The test-resolver change is deliberately
scoped to the `sdk/packages/*` tree so no app spec's resolution — including its
failure signature — changes.

## e2e (`src-app/ui`, real backend + Vite per test, `--workers=1`)

Command: `npx playwright test tests/e2e/perf/boot-parallelism.spec.ts --workers=1`
→ **3 passed**, exit 0. Run three times: before fix round 2 (1.4m), after the
fix-round-2 spec changes (1.4m), and again after re-baselining onto `a02c09a04`
(4.3m). Each spawns its own backend + Vite + Postgres.

- **TEST-5**: PASS — `[acceptance/INV-2]` on a cold authenticated load of `/`, `GET /api/auth/me` OVERLAPS `GET /api/app/setup/status` in wall-clock time and starts inside the first boot burst.
- **TEST-11**: PASS — `/settings/profile` issues exactly ONE `/api/auth/me`, and the profile form still renders a populated username. The assertion is conditioned on the observed inter-call gap rather than on the 3 s wall clock, so a slow box cannot fail it for behaviour that is correct.
- **TEST-12**: PASS — a real display-name rename through the UI, then the spec WAITS for the post-save `GET /api/auth/me` to land before asserting (fix round 2: asserting straight after `fill()` would have passed on the value the test itself typed and could never have observed a coalesced pre-mutation response). The new value survives both the in-page refetch and a reload; the shared fixture user is restored in a non-throwing `finally`.

## Frontend gates

- `npm run check (ui): PASS` — tsc + biome guardrails + lint:colors + settings-field + adjacent-inline + icon-action + **lint:hooks** + logical-direction + tooltip-placement + kit-manifest + testid-registry + design-spec + gallery-coverage + gallery-crawl + gallery-fixtures + state-matrix + overlay-registry + override-registry + gallery-seed-registry + store-actions. `lint:hooks` (added to the chain by `d22d22941`, landed in the new base) reports `0 violations across 2454 file(s)`.
- `npm run check (desktop/ui): PASS` — same chain for the desktop workspace, exit 0.
- `gate:ui (desktop/ui): PASS` — 53/53 surfaces runtime-clean; tsc + lint + runtime-health + coverage all PASS.
- `gate:ui (ui)`: **FAIL (runtime-health) — Category A, environment.** Classified below with a baseline control; NOT claimed as a pass.
- Layer-B pixel regression was not run: the diff adds no rendered element (no component, no style, no new conditional render state — `check:state-matrix` confirms the only state-matrix delta is a line-number shift), so there is no baseline for it to move.

### `gate:ui (ui)` runtime-health — classified, not claimed

An earlier revision of this file recorded `gate:ui (ui): PASS` from a background
task's exit code. That exit code belonged to the `tail` at the end of the
pipeline, not to `npm run gate:ui`; the real output said
`❌ GATE FAILED — runtime-health`. Corrected, and the gate was then re-run in the
FOREGROUND on **both** this branch and the `a02c09a04` baseline so the finding
could be classified rather than asserted:

| tree | tsc | lint | runtime-health | failing surfaces |
|---|---|---|---|---|
| baseline `a02c09a04` | PASS | PASS | **FAIL** | `overlay-reset-password-drawer`, `overlay-edit-user-drawer`, `overlay-create-user-drawer`, `background-tasks`, `notifications-background` |
| this branch | PASS | PASS | **FAIL** | `auth`, `overlay-knowledge-base-form-drawer`, `overlay-runtime-download-drawer`, `overlay-llm-provider-drawer` |

**Category A — environmental, verified from the log signature, three times.**

| run | conditions | HIGH signature | failing surfaces |
|---|---|---|---|
| baseline `a02c09a04` | concurrent | — | `overlay-reset-password-drawer`, `overlay-edit-user-drawer`, `overlay-create-user-drawer`, `background-tasks`, `notifications-background` |
| this branch | concurrent | 2830 / 2834 = `net::ERR_NETWORK_CHANGED` | `auth`, `overlay-knowledge-base-form-drawer`, `overlay-runtime-download-drawer`, `overlay-llm-provider-drawer` |
| this branch | **quiet box, serial** | **984 / 988 = `net::ERR_NETWORK_CHANGED`** | `seeded-hardware-monitor-error`, `seeded-literature-loading` |

`net::ERR_NETWORK_CHANGED` on the Vite dev server's OWN module requests
(kit/shadcn sources, store action chunks) is a host network event, not an app
defect. The 4 non-network HIGHs are a gallery fixture's DELIBERATE forced error
(`s3-grp-err` → `Gallery forced error`), present on the baseline too.

Three independent reasons this is not diff-attributable:
1. the BASELINE fails the same gate;
2. the failing surface set is DIFFERENT in every run — it tracks whichever
   surface was mid-load when the storm hit, not the code;
3. the desktop workspace's identical gate passed **53/53 surfaces clean** in the
   same window, on the same sdk.

Recorded as a Category-A environment block per the repo's classify-before-claiming
rule: not a pass, not a regression, with the numbers, the signature, the baseline
control and the quiet-box re-run all stated so the claim is checkable. The A7
canary that DID complete clean is `gate:ui (desktop/ui)`. `tsc`, `lint` (incl. the
new `lint:hooks`) and the Layer-A/axe `visual` leg PASS in every one of the three
`ui` runs.

## Backend

Not applicable — the diff touches no `src-app/server/**` or
`src-app/desktop/tauri/**` file (asserted by TEST-9), adds no migration, and
implies no OpenAPI regen. `openapi.json` and `api-client/types.ts` are
byte-identical in BOTH workspaces.

## Measured outcome

See `RESULTS_NUMBERS.md` for the paired A/B (both orders) and the deterministic
boot-ordering medians.
