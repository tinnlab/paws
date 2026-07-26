# PLAN — streamdown-html-renderer

Fix a real product bug in the chat markdown render path: streamdown v2's
`plugins.renderers` are silently BYPASSED, so a fenced ` ```html ` block renders
as a plain code-block instead of the `html-block` sandboxed-iframe preview
component (and ` ```mermaid ` renders as a plain code-block instead of
`MermaidBlock`). Plus fix two stale e2e assertions that only "passed" because the
feature was broken.

## Root cause (verified)

The chat renderers pass `components={ pre: MarkdownCodeBlock }` to `<Streamdown>`.
Streamdown resolves `plugins.renderers` (the html/mermaid custom renderers)
INSIDE its OWN default code component. Overriding `pre` with `MarkdownCodeBlock`
— which re-implements streamdown's `CodeBlock` from the extracted code+language —
REPLACES that component and never consults `plugins.renderers`. So HtmlBlock and
MermaidBlock never render through the chat path. Reproduced in isolation
(vitest): passing any `components.pre`/`components.code` override drops the
custom-renderer resolution; without it the renderer applies. Confirmed against
streamdown 2.5.0's own matcher (`renderers.find(language array|string match)`),
which supports both the string (`'mermaid'`) and array (`['html','htm']`) forms.

The base (file-viewer) variant does NOT override `pre`, so its native renderer
resolution already works — the bug is confined to the chat `pre` override.

## Items

> NOTE (converged in Phase 5, see DRIFT-1): the fix is SIMPLER than the initial
> wrapper design. The chat renderers were overriding `components.pre` with
> `MarkdownCodeBlock`, which re-rendered a fresh `CodeBlock` from the raw fence
> text — that override is the ENTIRE bug: it (a) bypassed `plugins.renderers` and
> (b) never re-ran Shiki (streamdown highlights via a parse-time rehype plugin, so
> the pre-highlighted `<code>` children are the ONLY source of colored tokens; the
> re-render threw them away → chat code blocks rendered UNHIGHLIGHTED). The correct
> fix is to REMOVE the `pre` override and let streamdown own code rendering, which
> restores custom renderers AND Shiki natively. No new module / wrapper needed.

- **ITEM-1**: Restore custom-renderer resolution for the chat Streamdown path so a
  fenced ` ```html `/` ```htm ` block renders `HtmlBlock` and ` ```mermaid `
  renders `MermaidBlock` — by removing the `components.pre` override
  (`MarkdownCodeBlock`) that bypassed streamdown's own renderer path. The already-
  present `chatMarkdownPlugins.renderers` (html + mermaid) then resolve natively.
- **ITEM-2**: The still-streaming (`isIncomplete`) ` ```html ` fence stays in Code
  view with Preview disabled — streamdown's native code path feeds `HtmlBlock` the
  correct `isIncomplete` from its own `useIsCodeFenceIncomplete` (no longer routed
  through the re-rendering override that dropped it).
- **ITEM-3**: Restore Shiki syntax highlighting for chat code blocks (e.g.
  ` ```rust `) — the `pre` re-render produced UNHIGHLIGHTED code today; the native
  path emits per-token `--sdm-c` CSS-variable colors. Remove the now-dead
  `MarkdownCodeBlock.tsx` (no remaining importer) per dead-code hygiene.
- **ITEM-4**: Fix the stale `markdown-rendering.spec.ts` KaTeX assertion — the app
  DOES wire `createMathPlugin`, so `$$…$$` renders with KaTeX; the test must
  expect KaTeX present (it asserted absence and only "passed" because it never
  actually did — verified `.katex` count = 1 in the BEFORE run).
- **ITEM-5**: Fix the stale `markdown-rendering.spec.ts` mermaid assertion — with
  renderers restored, a ` ```mermaid ` fence now renders `MermaidBlock` (matching
  `mermaid-toggle.spec.ts`'s "real chat path" expectation), not a bare code-block.
- **ITEM-6**: Fix the stale `markdown-rendering.spec.ts` Shiki assertion selector —
  @streamdown/code 1.1.1 colors tokens with a `--sdm-c` CSS custom property, not a
  literal inline `color:`. The `span[style*="color"]` selector never matched even
  when highlighting works; update it to `span[style*="--sdm-c"]` (still proves
  genuine per-token highlighting).

## Files to touch

- `src-app/ui/src/modules/chat/core/utils/useStreamdownComponents.tsx` — remove
  the `pre: MarkdownCodeBlock` override + its import; document WHY streamdown must
  own `pre`.
- `src-app/ui/src/components/common/MarkdownCodeBlock.tsx` — DELETE (dead after the
  override is removed; no other importer).
- `src-app/ui/tests/e2e/chat/markdown-rendering.spec.ts` — fix the KaTeX + mermaid
  + Shiki-selector stale assertions (+ the stale header comment).

## Patterns to follow

- **`MarkdownCodeBlock.tsx`** — mirror its language/code extraction from the
  `<code>` child element (`/language-([\w-]+)/` + `nodeToText().replace(/\n$/,'')`)
  and its "no static streamdown value-import; keep it in the lazy chunk" rule.
- **`LazyStreamdown.tsx`** — the existing chat-variant loader (`Promise.all` of
  `import('streamdown')` + the plugin module) is exactly where the renderer-aware
  pre must be assembled so streamdown stays lazy.
- **`HtmlBlock.tsx` / `MermaidBlock.tsx`** — the `CustomRendererProps`
  (`{ code, isIncomplete, language, meta }`) contract they already consume is what
  the pre wrapper must supply.
- **e2e specs** — `mermaid-toggle.spec.ts` is the authority for the corrected
  mermaid-via-chat-path behavior; `html-iframe-render.spec.ts` for the html one.
