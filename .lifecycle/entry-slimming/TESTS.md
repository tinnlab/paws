# TESTS — entry-slimming

Every ITEM is covered by ≥1 TEST. This is a UI-touching diff, so ≥1 `tier: e2e`
is enumerated (TEST-1/2/3). No new permission is introduced → no `[negative-perm]`
spec is required (A10 N/A). No `page.route()` mocking — the e2e drives the real
built/served UI.

The byte-reduction claims (the core of this task) are proven mechanically by
TEST-6, which parses the REAL production build's entry sourcemap — no guessed
savings.

## Tests

- **TEST-1** (tier: e2e) [covers: ITEM-1] file: `src-app/ui/tests/e2e/perf/entry-slimming.spec.ts` — asserts: after login the app boots and the main app shell renders with NO console error / uncaught exception / ErrorBoundary crash — proving the vendor-chunk split preserves a single React instance and a working boot (a split that duplicated React would crash on boot).
- **TEST-2** (tier: e2e) [covers: ITEM-2] file: `src-app/ui/tests/e2e/perf/entry-slimming.spec.ts` — asserts: surfaces rendering swapped icons render them correctly — the LLM-provider settings page shows provider icons (an `<svg>` per provider incl. the custom OpenAI/Anthropic/Gemini/HuggingFace brand glyphs), the settings page renders its Settings/chevron icons, and the sidebar toggle renders — with no missing-icon / crash. Proves `react-icons` removal did not break icon rendering.
- **TEST-3** (tier: e2e) [covers: ITEM-3] file: `src-app/ui/tests/e2e/chat/mcp-elicitation-submit-roundtrip.spec.ts` — asserts: the existing elicitation "date field" test (which injects a `format: 'date'` elicitation, opens the now-lazy DatePicker calendar via `pickDateViaCalendar`, and submits) STILL PASSES after ITEM-3 — proving the lazy chunk loads, the calendar opens, and a picked date binds into the form (FormField `cloneElement` ref/prop passthrough survives the `React.lazy` wrapper). Reused as the ITEM-3 regression guard (drives the real UI DatePicker; no NEW route-mocking authored). NOTE: this is the LIVE-DOM proof that TEST-5's source-contract wiring actually renders + binds.
- **TEST-4** (tier: unit) [covers: ITEM-2] file: `src-app/ui/src/modules/llm-provider/icons/brandIcons.test.ts` — asserts: (source-contract test — `.tsx` JSX can't be imported under `node --test`, the repo idiom per `ScheduleBuilder.timezone.test.ts`) each custom brand-icon `.tsx` (OpenAI, Anthropic, Gemini, HuggingFace) matches the DeepSeek/Mistral contract: a `memo<IconProps>` with `size='1em'` default, forwards `...rest`, renders an `<svg fill="currentColor" viewBox=…>` with a non-empty `<path d>` + `<title>` + `displayName`; and `icons/index.ts` re-exports all four. The LIVE render is proven by the e2e TEST-2 (OpenAI brand SVG on the providers page).
- **TEST-5** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/components/common/LazyDatePicker.test.ts` — asserts: (source-contract test) `LazyDatePicker.tsx` is a `React.forwardRef` that spreads `{...props}` and forwards `ref={ref}` onto the inner picker, uses `React.lazy` to dynamic-import `@ziee/kit/kit/date-picker` (→ `m.DatePicker`) inside a `React.Suspense` with a `Skeleton` fallback; and BOTH consumers (`WorkflowElicitForm.tsx`, `elicitationFields.tsx`) render `LazyDatePicker` and no longer statically import/render the eager barrel `<DatePicker>` (else the split is INEFFECTIVE). The LIVE prop/ref binding is proven by the e2e TEST-3.
- **TEST-6** (tier: unit) [covers: ITEM-1, ITEM-2, ITEM-3, ITEM-4] file: `src-app/ui/tests/bundle/entry-slimming-bundle.test.mjs` — asserts: against the REAL freshly-built `src-app/dist/ui` — (1) a `vendor-*.js` chunk exists and its sourcemap contains `react-dom` + `@base-ui` + `react-router` (ITEM-1 vendor split + ITEM-4 base-ui moved out of the entry); (2) the entry `index-*.js` sourcemap contains NO `react-icons` source (ITEM-2); (3) the entry sourcemap contains NO `react-day-picker` and NO `date-fns` source (ITEM-3); (4) the entry `index-*.js` byte size is strictly less than the recorded baseline (1,040,856 B). This is the mechanical proof of every byte claim.

## Coverage map (ITEM → TEST)

- ITEM-1 → TEST-1 (boot), TEST-6 (vendor chunk exists, base-ui/react-dom/router in it)
- ITEM-2 → TEST-2 (e2e icons render), TEST-4 (brand-icon unit), TEST-6 (react-icons absent from entry)
- ITEM-3 → TEST-3 (e2e date field works), TEST-5 (LazyDatePicker unit), TEST-6 (react-day-picker + date-fns absent from entry)
- ITEM-4 → TEST-6 (base-ui moved into the vendor chunk, out of the entry) + the written DEC-6 finding
