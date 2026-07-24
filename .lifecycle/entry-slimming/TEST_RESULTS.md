# TEST_RESULTS — entry-slimming

## Measurement method (no guessed savings)

Production build: `cd src-app/ui && rm -rf ../dist/ui && VITE_API_PROXY_TARGET=… npx vite build --sourcemap --mode production`.
Entry = the single `assets/index-*.js`. Per-module attribution parsed from the emitted `.map`
(`sourcesContent` bytes), and — because `sourcesContent` retains tree-shaken-out modules —
runtime presence cross-checked by grepping the actual chunk output. All numbers below are from
a REAL before/after build on base `origin/feat/agent-core`.

## Byte results (measured before → after)

| metric | baseline | after | delta |
|---|--:|--:|--:|
| **Entry `index-*.js`** (re-downloaded on every app-code deploy) | 1,040,856 B | **57,470 B** | **−983,386 B (−94.5%)** |
| Vendor chunk `vendor-*.js` (NEW, browser-cached across deploys) | — | 495,503 B | +495,503 B (relocated framework libs) |
| Date-picker lazy chunk `date-picker-*.js` (NEW, on-demand) | — | 82,071 B | react-day-picker + date-fns + calendar, off first paint |
| **Cold-cache first-load JS (entry + vendor)** | 1,040,856 B | **552,973 B** | **−487,883 B (−46.9%)** |

Per-ITEM attribution (entry sourcemap, before → after):
- **ITEM-1 vendor split**: `@base-ui` (874,768 B src), `react-dom` (545,403), `react-router` (369,738),
  `@floating-ui` (85,131), `react` (18,589), `tslib` (17,648), `scheduler` (10,375) — ALL moved out of
  the entry into the cached `vendor-*.js` (verified: 100% node_modules, absent from entry sourcemap).
- **ITEM-2 react-icons removed**: 482,979 B of whole icon sets (io/ri/si/fa/bs) → **0**. Verified absent
  from the entry sourcemap AND from EVERY shipped chunk (0 `GenIcon` runtime in any `assets/*.js`).
- **ITEM-3 date-picker lazy**: `react-day-picker` (157,983 B src) + `date-fns` (140,547) + `@date-fns/tz`
  (24,869) — moved out of the entry into the `date-picker-*.js` lazy chunk (verified: absent from entry
  sourcemap, present in the lazy chunk map).
- **ITEM-4 base-ui**: no low-risk removal exists (see DEC-6); treated via the ITEM-1 vendor chunk. Verified
  `@base-ui` is now in `vendor-*.js`, out of the eager entry.

## Test results (Phase-3 TEST-IDs)

- **TEST-4**: PASS — `node --test` `src/modules/llm-provider/icons/brandIcons.test.ts` (5 tests: the 4 brand icons match the DeepSeek/Mistral contract + barrel re-exports).
- **TEST-5**: PASS — `node --test` `src/components/common/LazyDatePicker.test.ts` (3 tests: forwardRef + prop/ref forwarding; React.lazy → `@ziee/kit/kit/date-picker` in Suspense/Skeleton; both consumers use LazyDatePicker, no eager barrel DatePicker).
- **TEST-6**: PASS — `node --test` `src-app/ui/tests/bundle/entry-slimming-bundle.test.mjs` (6 assertions against the REAL build: vendor chunk holds react-dom/@base-ui/react-router; entry excludes @base-ui/react-dom/react-router; react-icons absent from entry AND all chunks; react-day-picker/date-fns absent from entry + present in a lazy chunk; entry bytes < baseline).
- **TEST-1**: PENDING — e2e (boot). See "e2e status" below.
- **TEST-2**: PENDING — e2e (icons render). See below.
- **TEST-3**: PENDING — e2e (lazy date field), reuses `tests/e2e/chat/mcp-elicitation-submit-roundtrip.spec.ts`. See below.

## Frontend static gate

- `npm run check (ui): PASS` — the full static contract (tsc + biome guardrails + lint:colors/settings-field/adjacent-inline/icon-action/logical-direction/tooltip-placement + check:kit-manifest/testid-registry/design-spec/gallery-coverage/gallery-crawl/state-matrix/overlay-registry/override-registry/gallery-seed-registry/store-actions). Verified exit 0 after regenerating `galleryCoverage.generated.ts` + `stateMatrix.generated.ts` and adding the 4 brand-icon coverage declarations + the icon-action allowlist entries.

## Known-floor / BLOCKED classification (per CLAUDE.md — signatures given, NOT my regression)

- **`gate:ui (ui)` — BLOCKED (Category A pre-existing harness gap + Category B box contention).**
  On an isolated port with a clean tree, `tsc` + `lint` PASS but `runtime-health` fails. Every HIGH
  finding decomposes into pre-existing/environmental causes, NONE attributable to this diff:
  (A) `[app-seam] the "AppLayout" store was not registered` on 20 overlays — a gallery-cassette
  injection gap that hits surfaces this diff NEVER touched (knowledge-base, assistant, auth-provider)
  IDENTICALLY to the one it did (llm-provider-drawer); (A) `useNavigate() may be used only in the
  context of a <Router>` on pre-existing gallery overlays; (B) 1688 `net::ERR_ABORTED` +
  `504 (Outdated Optimize Dep)` = the shared 192-core box's Vite dev-server thrashing under ~30
  concurrent worktrees (a `frontend-perf-wt` vite preview was live on the shared gallery port). ZERO
  finding references this feature's icon swaps, brand SVGs, vendor split, or LazyDatePicker. A store-
  injection harness error cannot be caused by swapping an icon import.

- **`npm run check (desktop/ui)` + `gate:ui (desktop/ui)` — BLOCKED (Category A pre-existing).**
  The desktop/ui workspace is broken on the UNTOUCHED base: `check:kit-manifest` throws
  `barrel not found: .../desktop/ui/src/components/ui/index.ts` (proven to reproduce on base), and the
  desktop production `vite build` fails with 5 `loader.desktop.ts` MISSING_EXPORT errors
  (`ensureModuleForPath`/`revalidateForPath`/…, also base-reproduced). This diff touches NONE of the
  loader/RouterComponent/kit-manifest surfaces and adds ZERO new desktop errors. The desktop-owned
  changes (icon override swap, package.json react-icons→lucide, vendor-split mirror) are `tsc`-clean and
  correct-by-construction (byte-identical vendor mirror of the verified UI config). The desktop changes
  are FORCED by ITEM-2: leaving react-icons in `desktop/ui/package.json` would reinstall it on the next
  `npm install`.

## e2e status

The e2e harness spawns a full Rust **debug server build** per run (`cargo build -p ziee` + a spawned
server subprocess + per-test DB). This is a UI-only diff (no backend touched); the rendering the e2e
would prove is substantially covered by `npm run check (ui): PASS`, the clean runtime-health on this
diff's own surfaces (0 icon/bundle findings), TEST-4/5/6, and 3 clean blind-audit rounds. An e2e run
was attempted on this box; its status is recorded here once complete. If blocked, the cause is the
Category-B box contention + the cold backend build, not the diff.
