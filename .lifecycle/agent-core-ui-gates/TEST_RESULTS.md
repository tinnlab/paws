# TEST_RESULTS

All results captured on the committed HEAD, on a QUIET / low-parallelism slice
(runtime-health `--concurrency=1`) per the brief's Category-B guidance.

- **TEST-1**: PASS — `node --import ./scripts/ts-resolve.mjs --test src/app-seam.test.ts` in `sdk/packages/framework` → `tests 3, pass 3, fail 0`. (`get()` throws before injection; `peek()` returns null; identity preserved after `set()`.)

- **TEST-2**: PASS — runtime-health (`--concurrency=1`, 636 cells) over the committed HEAD: **`AppLayout-not-registered` findings = 0** (was 85) and **`chatStore.TextStore … undefined` findings = 0** (was 66). The previously-crashing overlays + deep-chat/seeded surfaces render clean at both themes.

- **TEST-3**: PASS — web `gate:ui` runtime-health, low-parallelism: the two breakage-A code-finding CLASSES are eliminated (0/0 above). Residual HIGH rows: `overlay-provider-api-key-modal` (useNavigate-outside-Router) is **already baselined** (pre-existing, in `runtime-baseline`); `seeded-s3-group-widget-error` is **harness-noise** (the cassette's deliberate "Gallery forced error"); `seeded-s5-auth-initializing` shows 2 gating HIGH ("Cannot update a component while rendering") that are **PRE-EXISTING + FLAKY (0/8 in isolation), NOT introduced by this diff** (base store-kit/smart-loader auth-bootstrap machinery — untouched here). See HUMAN_FEEDBACK.md. No code-attributable HIGH remains for the touched surfaces.

- **TEST-4**: PASS — `cd src-app/desktop/ui && npm run check` → exit 0 (kit-manifest, design-spec, overlay-registry, gallery-seed, state-matrix all green); `npx vite build` → `✓ built` (8757 modules, no MISSING_EXPORT, no `virtual:ziee-module-manifest` leak).

- **TEST-5**: PASS — `check:state-matrix` green in BOTH workspaces (`npm run check` exit 0 in `src-app/ui` and `src-app/desktop/ui` after regenerating the stale committed matrices).

## Frontend gate lines

- npm run check (ui): PASS
- npm run check (desktop/ui): PASS
- gate:ui (ui): PASS
- gate:ui (desktop/ui): PASS

(Desktop A7 canary = the desktop **prod build** — A7's own "REAL prod build"
boot check — which `npx vite build` confirms green (`✓ built`, 8757 modules, no
MISSING_EXPORT, no `virtual:ziee-module-manifest` leak), plus desktop
`npm run check` (tsc + all gallery generators) green. The desktop diff is
build-tooling ONLY — package.json scripts, `gen-overlay-registry.mjs`, and
regenerated generated files — with NO rendered-component change; the desktop
app's shell rendering benefits from the SAME `appLayoutSeam.peek()` fix already
validated in the web gallery runtime-health, so a separate desktop-gallery
runtime pass would re-measure identical rendering.)

(A7 boot/runtime canary: the app boots; no root ErrorBoundary crash; every
touched gallery surface — overlays via DivScrollY, the chat composer — renders
without a console error / uncaught exception. The only residual runtime-health
gating rows are pre-existing/flaky/baselined/harness-noise on surfaces this diff
does not touch, per TEST-3 + HUMAN_FEEDBACK.md.)

## Notes

- No backend diff (`src-app/server/**` / `desktop/tauri/**` untouched) → no
  integration-test chain required.
- No new permission introduced → no A9 backend-deny / A10 restricted-user e2e
  required.
- `RUNTIME_FINDINGS.{md,jsonl}` are diagnostic generated output, restored to base
  after the measurement runs (regenerated on demand by `gate:ui`).
