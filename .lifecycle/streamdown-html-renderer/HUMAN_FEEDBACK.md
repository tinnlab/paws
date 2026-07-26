# HUMAN_FEEDBACK — streamdown-html-renderer

no human feedback received

The feature has not yet been reviewed by a human. This file is the explicit
absence claim required by the phase-9 gate; it will be updated verbatim the
moment a human reviews the running fix.

## Proactive flag for the reviewer (not yet human feedback)

The fix removes `MarkdownCodeBlock` — the `pre` override that wrapped a code
block's copy/download controls in the app's styled kit `Tooltip`. That override
was the root cause of the bug: it re-rendered a fresh `CodeBlock` from the raw
fence text, which (a) bypassed `plugins.renderers` (so ` ```html `/` ```mermaid `
never reached their preview components) and (b) discarded streamdown's parse-time
Shiki-highlighted `<code>` children (so chat code blocks rendered UNHIGHLIGHTED).
Removing it restores syntax highlighting + the html/mermaid renderers; the
copy/download controls now use streamdown's native `title` tooltip instead of the
styled kit one. If the reviewer wants the styled tooltip back, the correct
follow-up is a streamdown-native customization (icons/translations/controls
config) that does NOT re-render the block — tracked as a possible future
enhancement, not a regression of this fix.
