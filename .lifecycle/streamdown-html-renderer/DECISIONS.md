# DECISIONS — streamdown-html-renderer

### DEC-1: How to restore custom-renderer resolution given the `pre` override bypasses `plugins.renderers`?
**Resolution:** REMOVE the `pre: MarkdownCodeBlock` override and let streamdown
own code rendering. (Superseded the initial "wrap the override" plan — see
DRIFT-1.) The override re-rendered a fresh `CodeBlock` from the raw fence text,
which is the root cause: it bypassed `plugins.renderers` AND discarded the
parse-time Shiki-highlighted `<code>` children (so chat code was UNHIGHLIGHTED).
Letting streamdown own `pre` restores both the custom renderers (html/mermaid)
and Shiki natively.
**Basis:** codebase — the base (file-viewer) variant already renders correctly
precisely because it does NOT override `pre`; verified empirically that the
override produced zero token colors and no `html-block`.

### DEC-1a: Is dropping `MarkdownCodeBlock`'s styled kit-Tooltip an acceptable tradeoff?
**Resolution:** Yes. `MarkdownCodeBlock`'s premise (re-render `CodeBlock` for a
kit `Tooltip` on copy/download) is fundamentally broken — it silently disabled
Shiki highlighting for ALL chat code blocks. Restoring highlighting + the html/
mermaid preview renderers is a strict product improvement; the copy/download
controls fall back to streamdown's native `title` tooltip (functionally
equivalent, untested previously). Recorded for human review in HUMAN_FEEDBACK.
**Basis:** convention — correct rendering > an untested cosmetic tooltip that was
costing syntax highlighting.

### DEC-2: Where does the incomplete/streaming signal come from now?
**Resolution:** From streamdown's own native code path (its internal
`useIsCodeFenceIncomplete`), which feeds `HtmlBlock`/`MermaidBlock` the correct
`isIncomplete` via `plugins.renderers`. No app-side wiring needed once the
override is gone.
**Basis:** codebase — the `CustomRendererProps.isIncomplete` contract is supplied
by streamdown when it resolves a custom renderer natively.

### DEC-3: Should mermaid render as `MermaidBlock` (custom renderer) or stay a bare code-block in chat?
**Resolution:** `MermaidBlock` (custom renderer), matching the file-viewer base
path and `mermaid-toggle.spec.ts`'s explicit "real chat path → MermaidBlock"
expectation. The `markdown-rendering.spec.ts` line-139 assertion (bare code-block)
is stale — it only passed because renderers were bypassed — and is corrected.
**Basis:** codebase — `MermaidBlock` is registered in `plugins.renderers` and
`mermaid-toggle.spec` is the authority; the merge commit "Merge html-iframe +
mermaid: union markdown plugins" shows both were meant to render.

### DEC-4: Is any operational tunable introduced (settings-row question)?
**Resolution:** No. This is a pure render-path correctness fix — no limits,
retention, quotas, toggles, or model selection. Nothing to make
admin-configurable.
**Basis:** convention — the fix adds no configurable behavior.

### DEC-5: Fix the KaTeX stale assertion — expect presence or absence?
**Resolution:** Expect KaTeX to RENDER (`.katex` present). The app wires
`createMathPlugin` (`singleDollarTextMath`) for `variant="chat"`, and the BEFORE
run confirmed `.katex` count = 1 (the test's expected-0 assertion is stale).
**Basis:** codebase — `chatMarkdownPlugins`/`streamdownPlugins` wire the math
plugin; verified empirically.
