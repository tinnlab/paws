# PLAN — entry-slimming (slim the ziee UI production entry chunk)

Goal: shrink the eager production entry chunk (`src-app/dist/ui/assets/index-*.js`,
measured baseline **1,040,856 bytes** on base `origin/feat/agent-core`) by (1) a
stable cached vendor chunk, (2) removing `react-icons`, (3) lazy-loading the date
picker, and (4) investigating the `@base-ui/react` weight. **Every byte claim is
backed by a before/after production build** (method in TEST_RESULTS.md).

This is a BUILD/BUNDLE task, not a user-facing feature: no new routes, no new
permissions, no backend/API change, no new DB migration. The user-visible surface
is limited to icon glyphs (must keep visual parity) and the date-picker (must keep
working). No new conditional render state is introduced.

## Baseline evidence (measured, sourcemap-parsed on this base)

Entry `index-Bvqcj6U0.js` = 1,040,856 B (gzip 333 KB). Top eager node_modules
(original source bytes): `@base-ui` 874,768; `react-dom` 545,403; **`react-icons`
482,979**; `react-router` 369,738; **`react-day-picker` 157,983 + `date-fns`
140,547 + `@date-fns/tz` 24,869 = 323,399**; `react-hook-form` 125,546;
`lucide-react` 100,543; `@floating-ui` 85,131; `scheduler` 10,375.

## Items

- **ITEM-1**: Add a stable vendor chunk via rolldown `build.rollupOptions.output.advancedChunks.groups` (Vite 8 / rolldown API — NOT Rollup `manualChunks`) grouping `react`, `react-dom`, `react-router`, `@base-ui`, `@floating-ui`, `scheduler`, `tslib` into one `vendor` chunk so it is cached across app-code deploys instead of re-downloaded on every entry change. Preserve the existing `chunkFileNames` module-naming function (merge, don't replace). Prove: a `vendor-*.js` chunk appears and the entry `index-*.js` shrinks by the moved framework bytes.
- **ITEM-2**: Eliminate the `react-icons` dependency (~483 KB of whole icon sets in the entry). Replace every `react-icons` import (16 in `src-app/ui/src`, 1 in `src-app/desktop/ui/src`) with a `lucide-react` glyph where a close equivalent exists, and with a custom inline-SVG brand-icon component (mirroring the existing `modules/llm-provider/icons/DeepSeek.tsx` / `Mistral.tsx` pattern) for the 4 provider brand logos that have no lucide equivalent (OpenAI, Anthropic, Gemini, HuggingFace). Remove `react-icons` from BOTH `package.json`s. Prove: `react-icons` no longer appears in the entry sourcemap.
- **ITEM-3**: Lazy-load the kit `DatePicker` (pulls `react-day-picker` + `date-fns` + `@date-fns/tz` + shadcn `calendar`, ~323 KB) out of the eager graph. The two static importers — `modules/workflow/components/WorkflowElicitForm.tsx` and `modules/mcp/chat-extension/components/elicitationFields.tsx` — switch from the eager barrel import to a shared `React.lazy` forwardRef wrapper (`LazyDatePicker`) that dynamic-imports `@ziee/kit/kit/date-picker`, forwarding all props + ref and rendering a Skeleton fallback in Suspense. With no remaining static importer, the barrel re-export tree-shakes away and `react-day-picker`/`date-fns` move to a lazy chunk. Prove: `react-day-picker` + `date-fns` no longer appear in the entry sourcemap; the elicitation date field still renders + works (e2e).
- **ITEM-4**: INVESTIGATE why `@base-ui/react` (874 KB) is fully eager. Findings (evidence-backed, in PLAN_AUDIT + DECISIONS): (a) NO dev-gallery leakage — 0 `dev/gallery` sources in the entry map; (b) `@base-ui/react` is `sideEffects:false` and the kit imports it via DEEP paths (28 distinct primitives of 53 shipped), so it IS tree-shakeable and unused primitives are dropped; (c) the weight is legitimate broad usage across 394 barrel imports of `@ziee/kit`. Conclusion: there is NO low-risk removal — the correct treatment is ITEM-1's vendor chunk (caching win). Any deeper reduction (route-level lazy-loading of heavy primitives, or splitting the `@ziee/kit` barrel) is a large, higher-risk architectural change to the shared SDK. RECORD as `DEC-6` for the human; do NOT gut the barrel. (Implementation for ITEM-4 = the ITEM-1 vendor chunk + the written finding; no separate risky code change.)

## Files to touch

- `src-app/ui/vite.config.ts` — add `advancedChunks.groups` to `build.rollupOptions.output` (ITEM-1).
- `src-app/desktop/ui/vite.config.ts` — mirror the same `advancedChunks.groups` (ITEM-1, desktop twin).
- `src-app/ui/src/modules/user-llm-providers/UserLlmProvidersPage.tsx`, `settings-general/module.tsx`, `layouts/app-layout/components/SidebarToggleButton.desktop.tsx`, `layouts/app-layout/components/Drawer.desktop.tsx`, `settings/SettingsPage.tsx`, `settings/SettingsPage.desktop.tsx`, `server-update/module.tsx`, `hub/HubPage.tsx`, `hardware/module.tsx`, `hardware/HardwareMonitorButton.tsx`, `llm-provider/components/LlmProviderSettings.tsx`, `chat/components/TitleEditor.tsx` — swap react-icons → lucide (ITEM-2).
- `src-app/ui/src/modules/llm-provider/constants.tsx` — swap Fa/Bs icons → lucide, brand icons → custom SVG components (ITEM-2).
- `src-app/ui/src/modules/llm-provider/icons/OpenAI.tsx`, `Anthropic.tsx`, `Gemini.tsx`, `HuggingFace.tsx` (+ `icons/index.ts` re-exports) — NEW custom brand-icon SVG components (ITEM-2).
- `src-app/desktop/ui/src/modules/desktop-base/overrides/hardware-monitor.tsx` — swap react-icons → lucide (ITEM-2, desktop override).
- `src-app/ui/package.json`, `src-app/desktop/ui/package.json` — remove `react-icons`; add `lucide-react` to desktop (ITEM-2).
- `src-app/ui/src/components/common/LazyDatePicker.tsx` — NEW shared lazy forwardRef wrapper (ITEM-3).
- `src-app/ui/src/modules/workflow/components/WorkflowElicitForm.tsx`, `src-app/ui/src/modules/mcp/chat-extension/components/elicitationFields.tsx` — use `LazyDatePicker` instead of the eager barrel `DatePicker` (ITEM-3).
- `src-app/ui/tests/e2e/perf/entry-slimming.spec.ts` — NEW regression-guard e2e (ITEM-2/3).
- Gallery cell for `LazyDatePicker` only if `check:state-matrix` demands one (see PLAN_AUDIT); otherwise reuse existing DatePicker gallery coverage.

## Patterns to follow

- **ITEM-1 vendor split** — the rolldown docs' own `advancedChunks.groups` example (`{name:'react', test:/node_modules[\\/]react/, priority}`). Keep the existing `chunkFileNames` function intact (it names module-boundary chunks for the smart-loader e2e).
- **ITEM-2 brand icons** — mirror `src-app/ui/src/modules/llm-provider/icons/DeepSeek.tsx` EXACTLY (a `memo<IconProps>` forwarding `size`/`style`/`...rest`, `fill="currentColor"`, `<title>`), extracting the SVG `viewBox` + `path` data verbatim from the react-icons glyph so the rendered logo is byte-identical (visual parity). Re-export from `icons/index.ts` next to DeepSeek/Mistral.
- **ITEM-2 lucide swaps** — lucide-react is already the app's primary icon lib (100 KB already eager, 159 files); swapping to it adds zero new dependency weight. Match the existing `<Icon className="size-N" />` usage idiom already in these files.
- **ITEM-3 LazyDatePicker** — `React.forwardRef` + `React.lazy(() => import('@ziee/kit/kit/date-picker').then(m => ({ default: m.DatePicker })))` + `<Suspense fallback={<Skeleton/>}>`, spreading `{...props}` and forwarding `ref` (the kit `DatePicker` is `React.forwardRef<HTMLButtonElement, DatePickerProps>`, and `FormField` injects `value/onChange/name/id/ref` via `React.cloneElement`, so the wrapper MUST be forwardRef and pass everything through). Skeleton import from `@ziee/kit`.

## UI-surface plan checklist

Not a new surface — no new page/drawer/card/list. Icon swaps and the lazy
date-picker render into EXISTING surfaces. The only rendering nuance:

- **Precedent** — brand icons mirror the existing `DeepSeek`/`Mistral` custom-SVG
  siblings in the same `icons/` dir; lucide swaps mirror existing lucide usage in
  the same files.
- **Populated-render / visual parity** — the icon swaps and the date-picker are
  reviewed rendered (gate:ui gallery surfaces for provider icons + settings +
  sidebar; e2e for the elicitation date field). A swapped glyph that looks wrong
  is a bug (DECISIONS records each glyph mapping).
- **User-visible progress** — the LazyDatePicker shows a Skeleton while its chunk
  loads (a few ms on localhost), then the identical DatePicker; no behavior change.
- **Responsive / scale / input economy / multi-instance / URL-as-view /
  platform-affordances** — N/A (no new surface, no new list, no new input).
