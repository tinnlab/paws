# FIX_ROUND-1 — streamdown-html-renderer

Three independent BLIND audit agents (diff-only, no author reasoning) reviewed
`git diff feat/e2e-render-serving...HEAD -- src-app` across 13 angles
(correctness, patterns-conformance, state-management, error-handling, perf,
modularity, maintainability, api-friendliness, extensibility, tests-quality/
test-reality, security, i18n/copy, scope-drift).

All findings were **clean / rejected** — no high or medium defects:

- correctness/patterns: removing the `pre` override compiles, matches the base
  variant, `MarkdownCodeBlock` has no remaining importer, deletion is safe.
- perf/modularity/extensibility: no eager streamdown import introduced (katex/
  shiki stay lazy); the change restores the `plugins.renderers` extension seam.
- test-reality: all three edited assertions exercise real DOM signals
  (`mermaid-block` + diagram SVG; `--sdm-c` per-token color spans; `.katex`
  present); no `.skip`/`.only`/always-true assertion.
- security: `HtmlBlock` / sandboxed iframe / `plugins.renderers` untouched;
  ```html is routed back to the intended sandbox path (unchanged) — not weakened.

The ONLY non-defect note (all three agents, out-of-band): dropping
`MarkdownCodeBlock`'s styled kit-`Tooltip` on copy/download is a deliberate,
documented UX tradeoff (native `title` fallback) — recorded in DECISIONS DEC-1a
and surfaced to the human in HUMAN_FEEDBACK. Not a code defect; nothing to fix.

**New confirmed findings:** 0
