# HUMAN_FEEDBACK — entry-slimming

**No human feedback received** on the running feature yet. This is a build/bundle
optimization (icon glyphs + a lazy date-picker are the only user-visible surface),
authored autonomously; it has not been through a live human review pass.

## Questions proactively surfaced to the human for review (non-blocking)

These are NOT received feedback — they are decisions/observations this
implementation flagged for the human's confirmation (see the final report + the
referenced artifacts):

- **DEC-6 (base-ui, ITEM-4):** the ~874 KB `@base-ui/react` weight is legitimate
  broad usage (tree-shakeable, no gallery leak); treated via the ITEM-1 vendor
  chunk. Any deeper reduction (route-lazy heavy primitives / splitting the shared
  `@ziee/kit` barrel) is a larger, higher-risk refactor deferred as a separate
  effort. **Recommendation:** accept the vendor-chunk treatment; open a dedicated
  effort if further eager-base-ui reduction is wanted. Confirm.
- **Drawer "Close" glyph:** the desktop + web drawer close control uses a
  directional back-chevron (`ChevronLeft`, preserving the prior react-icons
  `IoIosArrowBack` for visual parity), not the conventional `X`. This predates the
  migration; the `lint:icon-action` gate flagged it and it is allow-listed with a
  reason. The human may want to standardize both drawers to `X` separately.
- **Brand-icon `<title>` a11y:** the 6 provider brand SVGs (DeepSeek/Mistral +
  the 4 new OpenAI/Anthropic/Gemini/HuggingFace) carry an accessible `<title>`
  next to the visible provider-name label (minor redundant announcement), unlike
  the lucide generic providers (auto `aria-hidden`). The 4 new ones mirror the
  pre-existing DeepSeek/Mistral contract exactly; a consistency cleanup (make all
  brand icons decorative) is a candidate follow-up.

## Merge-reconciliation note for the orchestrator

The `@ziee/shell` react-icons removal lives in the `sdk` submodule
(committed locally as `2c11d49`, main pointer bumped). At merge this must be
reconciled onto the sdk's pinned `agent-core-and-perf` branch — the submodule
change is not pushed (per task constraints).
