# DRIFT-1 — streamdown-html-renderer

Implementation vs plan reconciliation after the first implementation pass.

- **DRIFT-1.1** — verdict: impl-wins — The initial plan added a
  `chatCodeRenderers.tsx` module + a memoized renderer-aware `pre` wrapper in
  `LazyStreamdown` that KEPT the `MarkdownCodeBlock` override (to preserve its
  kit tooltip). Running the specs proved that path could not restore Shiki: the
  `MarkdownCodeBlock` re-render (raw code → fresh `CodeBlock`) produces ZERO
  token colors, because streamdown highlights via a PARSE-TIME rehype plugin and
  the pre-highlighted `<code>` children are the only color source — the override
  discards them. The simpler, correct fix is to REMOVE the `pre` override
  entirely and let streamdown own code rendering (custom renderers + Shiki both
  native). PLAN.md ITEM-1..3, Files-to-touch, and DECISIONS DEC-1/DEC-2 were
  amended to the removal design (and re-gated phases 1–4). The wrapper module was
  reverted/deleted.

- **DRIFT-1.2** — verdict: impl-wins — A THIRD stale assertion surfaced at run
  time (not just KaTeX + mermaid): the Shiki test's `span[style*="color"]`
  selector never matched, because @streamdown/code 1.1.1 themes tokens with a
  `--sdm-c` CSS custom property, not an inline `color:`. Added ITEM-6 + updated
  the selector to `span[style*="--sdm-c"]` (still proves genuine per-token
  highlighting). TESTS.md TEST-3 remapped to cover ITEM-3/5/6.

- **DRIFT-1.3** — verdict: resolved — Removing the override orphaned
  `MarkdownCodeBlock.tsx` (its only importer was the chat `pre` override; the
  "syntax" extension only shares the substring `parseMarkdownCodeBlocks`). Deleted
  the file per dead-code hygiene (§15); confirmed no remaining importer in
  `src-app/ui` or `src-app/desktop/ui`, and desktop shares the chat render path
  (no parallel override to update — R2-3 clear).

- **DRIFT-1.4** — verdict: none — Base (`variant="base"`) file-viewer path,
  `chatMarkdownPlugins`, `HtmlBlock`, `MermaidBlock` are all UNCHANGED and already
  correct; the diff is confined to removing the chat `pre` override + the stale
  test assertions.

**Unresolved drifts:** 0
