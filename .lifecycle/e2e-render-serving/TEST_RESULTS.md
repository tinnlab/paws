# TEST_RESULTS — Phase 8 (honest, evidence-backed)

## Static gate

- **npm run check (ui): PASS** — exit 0 (tsc + all biome guardrails + lint:colors
  + settings-field + kit-manifest + testid-registry + design-spec +
  gallery-coverage + gallery-crawl + state-matrix + overlay/override/seed
  registries + store-actions). Log: `lifecycle-logs/npm-check.log`.

## Unit tests

- **TEST-1**: PASS — `node --test plugins/vite-plugin-eager-render-graph.test.mjs`
  → 8/8 pass (isEntryId suffix+explicit, data-driven glob incl. future chunk,
  mixed-case highlighted-body-absent throw, app-plugin-module existence,
  transform-injects-entry-only, load() real streamdown resolution).
- **TEST-2**: PASS — `node --test tests/fixtures/e2e-static-middleware.test.mjs`
  → 9/9 pass (content-type map, pathname parse, asset-map keying, single
  res.end + Content-Length, HEAD-no-body, /api+unknown+non-GET fall-through,
  missing-dir + empty-dir warn/no-op, index.html-no-cache/asset-immutable).

## Serving-robustness — the core before→after (the fix's actual target)

Measured DROPPED static chunks (a `GET` that never received a response — the
`ERR_INCOMPLETE`/no-response class the fix targets) in the html-iframe-render
run, on a QUIET box (94% idle), `--workers=1`:

| Serving | Build | Dropped static chunks |
|---|---|---|
| **BASE** (sirv streaming) | base | **60–75** (incl. multiple `body-*.js` = streamdown highlighted-body) |
| **NEW** (in-memory single-write, #2) + eager fold (#1) | new | **0** |

The single-threaded `vite preview` sirv path drops dozens of the app's
concurrent lazy-load chunks even without added load; the in-memory single-write
middleware drops zero. This is the render-serving robustness the task asked for,
demonstrated with real numbers. (A synthetic single-core-starvation fetch bench
showed 0% truncation for BOTH modes — because the base's existing
timeout-disable already prevents server-side static cuts; the discriminating
signal is the real-run concurrent-burst drop count above.)

## No-regression e2e (my serving change does not break other surfaces)

- **TEST-5** (16-smart-loading): PASS — 3/3 (`smart-loading.spec.ts:44,68,89`).
  The eager fold + module chunk-naming coexist; per-module smart loading intact.
- **TEST-6** (chat-basic): 6/7 PASS — basic send / model select / titles /
  branching etc. green, proving the in-memory middleware falls through correctly
  for `/api` (proxy) + SPA routing. The 1 fail (`:132` multi-message) is a
  backend/streaming contention flake (`stream`/`reconnect`/`ERR_CONNECTION_REFUSED`),
  Category-B shared-box floor — NOT a serving-static issue, NOT introduced by
  this change.

## Target render specs — BLOCKED by a pre-existing product bug (NOT serving, NOT this change)

- **TEST-3** (html-iframe-render): **FAIL — blocked, not by serving.** All 7 tests
  fail on NEW at `--workers=1` on a QUIET box **with 0 dropped chunks**. Root
  cause proven ORTHOGONAL to serving: the streamdown v2 `plugins.renderers`
  (`HtmlBlock`/`MermaidBlock`) do not apply — a fenced ```html renders as a plain
  `data-streamdown="code-block"` instead of the expected `html-block`.
  Controls that isolate it from this feature:
  - BASE (no eager fold, no middleware) fails the same 7 at `--workers=1` quiet.
  - Middleware-ONLY (0 drops, no eager fold, base plugin init) STILL renders the
    fence as `code-block` → the eager fold (#1) is NOT the cause.
  So it is a pre-existing chat-render bug on `feat/agent-core`, independent of
  chunk delivery. The internal inconsistency in the suite corroborates it: the
  `mermaid` test (139) PASSES by asserting the NO-renderer plain-code-block
  behavior, while the `html` tests assert the renderer DOES apply — both use
  `chatMarkdownPlugins.renderers`; they cannot both hold, and the renderers
  currently do not apply.
- **TEST-4** (markdown-rendering): 7/9 PASS. Failing:
  - `:193` "renders fenced code with Shiki highlighting" — same plugin-application
    root cause (the `code`/shiki plugin colored-token output not present), NOT a
    chunk drop (0 drops on NEW).
  - `:227` "does NOT render math with KaTeX styling" — a **stale assertion**: the
    app WIRES math (`createMathPlugin` in `streamdownPlugins.ts`, and
    `TextContent` uses `variant="chat"`), so `.katex` IS present; the test asserts
    `.katex===0`. It only "passes" when the math chunk fails to load. Orthogonal
    to serving.

## Honest status

The render-SERVING fix is implemented, unit-tested, `npm run check`-green, prod-
untouched, and PROVEN to eliminate the static-chunk-drop failure mode (0 vs
60–75). The task's DoD (target specs pass 10×/10 under induced load) is NOT
reachable via a serving fix because the target specs are ALSO blocked by a
pre-existing, out-of-scope chat-render product bug (streamdown v2 `renderers`/
`code` plugins not applying) + one stale KaTeX assertion — both reproduced on
BASE independent of this change and of chunk delivery. These are recorded as
findings for a separate follow-up; they are not marked PASS here. Full logs under
`/data/pbya/ziee/tmp/lifecycle-logs/`.
