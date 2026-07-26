# TEST_RESULTS — net-hygiene

Diff base for every gate: `a72553e6e` (the current `origin/feat/agent-core` tip,
merged into this branch — see DRIFT-2.10). Full logs under
`/data/pbya/ziee/tmp/lifecycle-logs/`.

## Unit (`npm run test:unit`, `src-app/ui`)

Command: `cd src-app/ui && node --import ./scripts/node-test-loader.mjs --test <files>`
→ **32 tests, 32 pass, 0 fail.**

- **TEST-1**: PASS — 4 cases (one shared run + one value; shared rejection; distinct key/identity never joined; a later call refetches — it is not a cache) + the aliasing case (a joiner gets an isolated copy; mutating it does not corrupt the issuer's).
- **TEST-2**: PASS — 3 cases (a post-mutation GET does not join a pre-mutation in-flight one; settling a superseded entry does not evict the newer one; a request older than `MAX_JOIN_AGE_MS` is no longer joinable).
- **TEST-3**: PASS — a sync-frame epoch bump makes the notify-and-refetch round-trip real.
- **TEST-4**: PASS — 6 cases (chunk fetched once; steady-state dispatch unchanged; EVERY cold-window call reaches the body so two different callbacks both fire; two identical cold-window mutation dispatches both run; a failed chunk load is not memoized; `preload` does not invoke).
- **TEST-7**: PASS — 6 cases including the two `[acceptance]` legs (a mutation and an inbound sync frame each un-suppress immediately) and the interleaving leg (a `/me` IN FLIGHT across a mutation is not marked fresh).
- **TEST-8**: PASS — 5 cases (capacity floor; the floor is RAISED never lowered, at 30 s and 20 s; jitter spreads refused clients; a non-429 keeps the 1 s transient recovery; neither path exceeds `MAX_BACKOFF_MS`).
- **TEST-9**: PASS — 6 cases. `BASE=a72553e6e SDK_BASE=01a96b7 node --test .lifecycle/net-hygiene/tests/excluded-endpoints.test.mjs`: no changed file references the excluded endpoints; no generated api-contract file regenerated; no server-side file touched; the diff is non-empty; the generated indexes moved line numbers ONLY; and the sdk submodule was actually scanned (no silent degraded mode).
- **TEST-10**: PASS — a differing-intent notification reload is never dropped (and each load carries its own `page`); `registerModule` reuses an already-registered proxy while a first-time registration still creates one.
- **TEST-13**: PASS — `cd src-app/desktop/ui && npx vitest run src/core/local-override-resolver.test.ts` → 6 pass. Against the REAL trees, `@/modules/auth/bootSessionVerify` binds the desktop NO-OP twin, with a same-module control that a file without a twin still binds core.
- **TEST-14**: PASS — 2 cases: `buildLoadContext` derives `isAuthenticated` from the verified session alone and consults no persisted-token predicate; permissions are still read from the non-persisted snapshot and every perm goes through `evaluatePermission`.

**Pre-existing red, unchanged by this branch:** the full `npm run test:unit` run
is 535 tests / 523 pass / 12 fail. The SAME 12 spec files fail for the SAME
reason (`ERR_MODULE_NOT_FOUND` on a relative app import) on the UNMODIFIED base
worktree — verified by running the identical command there. This branch adds 32
passing tests and turns none red. The test-resolver change is deliberately
scoped to the `sdk/packages/*` tree so no app spec's resolution — including its
failure signature — changes.

## e2e (`src-app/ui`, real backend + Vite per test, `--workers=1`)

Command: `npx playwright test tests/e2e/perf/boot-parallelism.spec.ts --workers=1`
→ **3 passed (1.4m)**, exit 0.

- **TEST-5**: PASS — `[acceptance/INV-2]` on a cold authenticated load of `/`, `GET /api/auth/me` OVERLAPS `GET /api/app/setup/status` in wall-clock time and starts inside the first boot burst.
- **TEST-11**: PASS — `/settings/profile` issues exactly ONE `/api/auth/me`, and the profile form still renders a populated username.
- **TEST-12**: PASS — a real display-name rename through the UI shows the NEW value both in-page and after a reload; the shared fixture user is restored in a `finally`.

## Frontend gates

- `npm run check (ui): PASS` — tsc + biome guardrails + lint:colors + settings-field + adjacent-inline + icon-action + logical-direction + tooltip-placement + kit-manifest + testid-registry + design-spec + gallery-coverage + gallery-crawl + gallery-fixtures + state-matrix + overlay-registry + override-registry + gallery-seed-registry + store-actions.
- `npm run check (desktop/ui): PASS` — same chain for the desktop workspace, exit 0.
- `gate:ui (ui): PASS` — `npm run gate:ui -- --skip-visual` (tsc + lint + gallery runtime-health + Layer A/axe). This is the A7 boot/runtime canary. Layer-B pixel regression was not run: the diff adds no rendered element (no component, no style, no new conditional render state — `check:state-matrix` confirms the only state-matrix delta is a line-number shift), so there is no baseline for it to move.

## Backend

Not applicable — the diff touches no `src-app/server/**` or
`src-app/desktop/tauri/**` file (asserted by TEST-9), adds no migration, and
implies no OpenAPI regen. `openapi.json` and `api-client/types.ts` are
byte-identical in BOTH workspaces.

## Measured outcome

See `RESULTS_NUMBERS.md` for the paired A/B (both orders) and the deterministic
boot-ordering medians.
