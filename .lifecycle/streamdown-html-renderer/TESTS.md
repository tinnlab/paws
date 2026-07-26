# TESTS — streamdown-html-renderer

The e2e specs already exist (they are the regression the fix makes pass). This
feature's coverage is those specs going green, plus the two stale-assertion
corrections.

- **TEST-1** (tier: e2e) [covers: ITEM-1] file: `src-app/ui/tests/e2e/chat/html-iframe-render.spec.ts` — asserts: a fenced ` ```html ` assistant block renders the `html-block` component (Code/Preview toggle, source view, copy, language label) — the 7 tests in this spec all pass.
- **TEST-2** (tier: e2e) [covers: ITEM-1, ITEM-2] file: `src-app/ui/tests/e2e/chat/html-iframe-render.spec.ts` — asserts: toggling Preview mounts a `sandbox="allow-scripts"` iframe with the injected CSP + null-origin isolation, AND a still-streaming (incomplete) fence keeps Preview disabled with no iframe (the `isIncomplete` path).
- **TEST-3** (tier: e2e) [covers: ITEM-3, ITEM-5, ITEM-6] file: `src-app/ui/tests/e2e/chat/markdown-rendering.spec.ts` — asserts: ` ```rust ` renders a Shiki-highlighted code-block (per-token `--sdm-c` color custom-property spans — the @streamdown/code 1.1.1 theming, corrected selector) AND ` ```mermaid ` renders `MermaidBlock` (corrected assertion) — the code path renders correctly for both custom-renderer and default-fence languages.
- **TEST-4** (tier: e2e) [covers: ITEM-4] file: `src-app/ui/tests/e2e/chat/markdown-rendering.spec.ts` — asserts: `$$…$$` renders with KaTeX (`.katex` present) — corrected stale assertion.
- **TEST-5** (tier: e2e) [covers: ITEM-1] file: `src-app/ui/tests/e2e/visual/mermaid-toggle.spec.ts` — asserts: the real-chat-path mermaid showcase renders `MermaidBlock` (`[data-streamdown="mermaid-block"]` with SVG) and its render/source/copy/download affordances work — proves the renderer fix on the visual (gallery) surface too.
- **TEST-6** (tier: e2e) [covers: ITEM-1, ITEM-3] file: `src-app/ui/tests/e2e/chat/markdown-rendering.spec.ts` — asserts: non-custom fences and other markdown (GFM table, footnotes, raw-script-no-exec, streaming table) are UNCHANGED — the fallback path (`MarkdownCodeBlock`) and all non-code markdown still render correctly (no regression from the pre-wrapper).
- **TEST-7** (tier: unit) [covers: ITEM-2] file: `src-app/ui/tests/e2e/chat/html-iframe-render.spec.ts` — asserts: (covered within the e2e TEST-2 streaming case) the incomplete-fence Preview-disabled behavior; no separate pure-unit harness exists for streamdown render, so the exercised e2e is the reality test (B7).

## Notes

- No new permission introduced → no A9/A10 negative-perm spec required.
- No backend diff → no integration tier.
- Frontend diff present → the `tier: e2e` requirement is satisfied by TEST-1..6.
