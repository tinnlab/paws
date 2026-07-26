# PLAN_AUDIT — streamdown-html-renderer

Audited against the codebase (streamdown 2.5.0 in `node_modules`, the chat render
path, and the base file-viewer path).

## Breakage risk

- The change is ADDITIVE for the chat path (a new `chatCodeRenderers.tsx` + a
  wrapper edit in `LazyStreamdown`'s chat loader). The base (`variant="base"`)
  loader is untouched, so the file-viewer / skill / workflow markdown paths keep
  their current (already-correct) native renderer resolution.
- `MarkdownCodeBlock.tsx` is UNCHANGED — it remains the fallback for non-custom
  languages (shiki code-blocks). No caller of it breaks.
- `useStreamdownComponents.tsx` is UNCHANGED — it still returns
  `pre: MarkdownCodeBlock`; the lazy chat wrapper replaces `pre` with a
  renderer-aware wrapper whose fallback IS the caller's `pre`, so plain fences
  render identically to today.
- Entry-bundle risk: the ONLY new static `streamdown` value-import
  (`useIsCodeFenceIncomplete`) lives in `chatCodeRenderers.tsx`, imported ONLY
  from the lazy chat loader (`import(...)`), so it stays in the lazy chunk — no
  entry-slimming regression. Verified `HtmlBlock`/`MermaidBlock` import nothing
  heavy (only a `type` import from streamdown; kit + lucide are already present).

## Pattern conformance

- Language/code extraction mirrors `MarkdownCodeBlock.tsx` exactly
  (`/language-([\w-]+)/`, `nodeToText().replace(/\n$/,'')`).
- Custom-renderer matching mirrors streamdown 2.5.0's own matcher (string OR
  array `language`).
- `CustomRendererProps` (`{code,isIncomplete,language,meta}`) is the contract
  `HtmlBlock`/`MermaidBlock` already consume.

## Migration collisions

None — UI-only, no migration.

## OpenAPI regen

None — no backend type/handler change. `openapi.json` / `api-client/types.ts`
untouched.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — restores streamdown's own renderer resolution via a
  lazy-chunk pre wrapper; mirrors `MarkdownCodeBlock` extraction + the streamdown
  matcher; base path untouched.
- **ITEM-2** — verdict: PASS — `useIsCodeFenceIncomplete()` is exported by
  streamdown 2.5.0 (`() => boolean`) and, verified via a vitest repro, returns the
  correct per-block value from inside a `pre` override (the override renders inside
  streamdown's `et.Provider`).
- **ITEM-3** — verdict: PASS — a single `CHAT_CODE_RENDERERS` array consumed by
  both `chatMarkdownPlugins.renderers` and the pre wrapper; no drift.
- **ITEM-4** — verdict: PASS — math renders with KaTeX today (independent of this
  fix; `createMathPlugin` is wired); the assertion is stale and flips to expect
  presence. Verified in the BEFORE run: `.katex` count = 1 (test expected 0).
- **ITEM-5** — verdict: CONCERN — the mermaid assertion (`markdown-rendering.spec`
  line 139) currently PASSES asserting a bare code-block; after the fix mermaid
  renders `MermaidBlock`, so this assertion MUST be updated. This is a deliberate
  stale-test correction (mermaid-toggle.spec is the authority that mermaid renders
  via the chat path). Resolved by updating the assertion; not a blocker.
