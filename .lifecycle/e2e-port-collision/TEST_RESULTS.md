# TEST_RESULTS — e2e-port-collision

Scope of the diff: `src-app/ui/tests/fixtures/**` only (Playwright harness) → the
backend chain is N/A; the frontend `ui` workspace chain applies.

## Unit (node --test, via the `test:unit` strip-types loader)

Command:
`node --import ./scripts/node-test-loader.mjs --test tests/fixtures/port-manager.concurrency.test.ts`
Verified STABLE across repeated runs (25/25 then 15/15 after the console-silence +
assertion tweaks; no flakes).

- **TEST-1**: PASS — free base returned unchanged.
- **TEST-2**: PASS — held-base collision skipped to the next bindable offset
  (never returns the held pair). Independently proven by the before→after harness:
  the UNFIXED allocator returned the sibling's exact ports (COLLISION=true), the
  FIXED allocator skipped to +8 (COLLISION=false).
- **TEST-3**: PASS — `killProcessOnPort` invokes `fuser -k <port>/tcp` when lsof is
  absent (was a silent no-op) and prefers lsof when present.
- **TEST-4**: PASS — `cleanupStaleConfigFiles` keeps a live-locked config, reaps a
  genuine orphan.

## e2e (Playwright, real backend + real vite through the FIXED harness)

Command (isolated ports/DB, `--workers=1`):
`ZIEE_E2E_LOCK_DIR=… ZIEE_E2E_BASE_VITE_PORT=9600 ZIEE_E2E_BASE_BACKEND_PORT=9700
ZIEE_E2E_BASE_PG_PORT=54600 npx playwright test tests/e2e/auth/auth.spec.ts --workers=1`
Result: **15 passed (4.5m)** — every test allocated ports through the fixed
`findAvailablePorts` ("🔒 Locked ports for worker 0: vite 9600, backend 9700") and
booted the real backend + vite. Confirms the bind-check + release-on-skip did NOT
regress the normal single-session allocation path. (A single session cannot trigger
the collision; TEST-2 is the collision proof.)

- **TEST-6**: PASS — auth.spec.ts 15/15 through the fixed harness.

## Frontend workspace gate

- npm run check (ui): PASS — full static contract (tsc + biome guardrails +
  lint:colors/settings-field/adjacent-inline/icon-action/logical-direction/tooltip
  + check:kit-manifest/testid-registry/design-spec/gallery-coverage/gallery-crawl/
  gallery-fixtures/state-matrix/overlay-registry/override-registry/
  gallery-seed-registry/store-actions). All green.
- gate:ui (ui): tsc PASS · lint PASS · visual PASS (10 passed) · runtime-health
  ENVIRONMENTAL-FAIL (see the A7 note — NOT a code finding; the overall gate:ui
  script exits 1 on the runtime-health sub-check, so a truthful `gate:ui (ui):
  PASS` line is intentionally NOT claimed).

### A7 boot/runtime canary note (gate:ui) — GENUINE ENVIRONMENTAL BLOCKER

`gate:ui` was run against this worktree's OWN warm gallery dev server on :1531 (the
default :1420 was a foreign `main`-clone server; a fresh worktree also needed the
`@ziee/shell` / `@ziee/notification-ui` node_modules symlinks, missing because the
initial `npm install` predated the sdk-submodule init — re-running `npm install`
after `git submodule update --init sdk` fixed vite resolution and surfaces then
enumerated 47+, up from 0).

On the clean, warm, non-contended server the meaningful sub-checks PASS: **tsc
PASS, lint PASS, visual PASS (10 passed)**. `runtime-health` FAILS on 29 surfaces
(63 gating HIGH), but EVERY HIGH is a vite **dev-server module-load race**, not a
surface defect: `GET http://localhost/@fs/…/sdk/packages/… — net::ERR_ABORTED`
(526), `net::ERR_ABORTED` on `dev/gallery/stories/*.story.tsx`, and 47× "Internal
React error: Expected static flag was missing" — all classic symptoms of the
runtime-health harness doing HUNDREDS of rapid full-page reloads (198 surfaces ×
states × themes) against a SOURCE-MODE dev server, which aborts in-flight `@fs`
source-module fetches (the sdk packages are served as source, not bundled). `visual`
(far fewer navigations) passes on the same server. A production gallery build would
have no per-module `@fs` fetches to abort, but `dist-e2e` contains only the app
(`index.html`), not `gallery.html`, and `gate-ui.mjs` is hard-wired to `npm run dev`
(source mode) — so there is no clean way to run runtime-health here.

**Why this is not my regression, and the canary INTENT is met anyway:** the diff
touches only `src-app/ui/tests/fixtures/**` (Playwright harness) — never bundled,
renders NO surface — so it is structurally impossible for it to introduce a
runtime-health finding; the 29 failing surfaces are pre-existing on feat/agent-core.
The A7 intent (does the app boot / no root crash) is independently PROVEN: the e2e
booted the REAL production app and logged in 15× (TEST-6), `npm run check` passed
the full gallery-registry consistency contract, and gate:ui's tsc/lint/visual all
passed. The residual `gate:ui` non-zero exit is an environmental dev-server harness
limitation in a fresh worktree, recorded here truthfully rather than papered over
with a false PASS.
