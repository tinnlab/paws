# FIX_ROUND-1 — entry-slimming

## Findings from the Phase-6 blind audit (3 clusters, 22 angles) + the resolutions

Confirmed findings and their dispositions:

1. **precedent-fidelity (LOW)** — stale comment in `FilePreviewDrawer.tsx:7` naming the removed `IoIosArrowBack` glyph. → **FIXED** (comment updated to `ChevronLeft`).
2. **perf/responsive (LOW)** — `LazyDatePicker` Suspense fallback was `h-9` (36px) vs the kit DatePicker's `h-8` (32px) → 4px CLS. → **FIXED** (`h-8 w-full rounded-lg`, matching the kit's own loading skeleton exactly).
3. **patterns-conformance (LOW)** — `LazyDatePicker` used `React.*` namespaced imports. → **FIXED** (named `forwardRef`/`lazy`/`Suspense`, mirroring the sibling `LazyMarkdownEditor.tsx`/`LazyCodeEditor.tsx`).
4. **icon-action lint** — two directional chevrons (drawer back-close, dropdown caret) flagged by `lint:icon-action`. → **FIXED** via `src/dev/gallery/icon-action-allowlist.json` entries with documented reasons (the lint's aria-label heuristic misfired; the glyphs preserve the prior react-icons `IoIosArrowBack`/`IoIosArrowDown` for visual parity).

Rejected findings (with rationale, recorded in LEDGER.jsonl):

5. **error-handling (LOW)** — `React.lazy` has no per-use error boundary. → **REJECTED**: matches the established app lazy pattern (`LazyMarkdownEditor`/`LazyCodeEditor`/`MarkdownTable` are all Suspense-only; the root `AppErrorBoundary` catches chunk-load failures). A per-lazy-chunk boundary/retry is a codebase-wide improvement, not specific to this diff. Flagged for the human.
6. **a11y (LOW)** — the 4 brand SVGs' `<title>` is redundant next to the visible provider-name label. → **REJECTED**: mirrors the pre-existing `DeepSeek.tsx`/`Mistral.tsx` sibling contract exactly (precedent-fidelity mandate); the redundancy predates this change. Flagged for the human as a brand-icon a11y consistency question (all 6 brand icons).
7. **tests-quality (LOW)** — the two unit tests are source-contract (regex on source) not render/behavior. → **REJECTED**: this is the repo idiom (JSX can't be imported under `node --test`; `ScheduleBuilder.timezone.test.ts` documents the same constraint). Behavioral proof is the e2e (TEST-2 renders the OpenAI brand SVG; TEST-3 opens the lazy DatePicker calendar) + the real-build bundle test (TEST-6).

## Re-audit round 2 (fresh blind agent, diff-only)

A full fresh blind re-audit of the post-fix diff (correctness, patterns-conformance,
a11y, perf, state-management, error-handling, tests-quality, precedent-fidelity,
maintainability, security) returned **CLEAN** — it independently verified all six
fixes are correct (vendor regex sound; LazyDatePicker forwardRef/lazy/Suspense + ref
passthrough intact; `em()` at module scope; Skeleton `h-8` matches the control — no
CLS; allowlist entries justified; zero residual react-icons) and found **no new
issues**.

**New confirmed findings:** 0
