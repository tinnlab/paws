# DECISIONS — entry-slimming

Every input the implementation needs, resolved up front. Most resolve by
convention/codebase precedent. DEC-6 is the one item surfaced to the human (the
ITEM-4 base-ui recommendation); it is resolved as "defer with a recommendation"
and does not block implementation.

### DEC-1: Which packages go into the stable `vendor` chunk?
**Resolution:** ONE group `name: 'vendor'`, `test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@base-ui|@floating-ui|tslib)[\\/]/`, `priority: 1`. react + react-dom + scheduler are in the SAME group (never split — a split React instance breaks hooks). @base-ui + @floating-ui are the largest stable framework libs; router is stable. Excluded from vendor: `react-icons` (being deleted), `react-day-picker`/`date-fns` (being made lazy — must NOT be pinned into an eager vendor chunk), `react-hook-form`/`immer`/`zod`/`sonner`/`lucide-react` (app-coupled or already-small; left to automatic chunking).
**Basis:** convention — the rolldown docs' `advancedChunks.groups` react-vendor example; the "single React instance" invariant; and the measured top-of-entry framework packages.

### DEC-2: lucide-react glyph mapping for each non-brand react-icons glyph (visual parity)
**Resolution:**
- `IoIosArrowDown` → `ChevronDown`
- `IoIosArrowBack` → `ChevronLeft`
- `IoMdPerson` → `UserRound`
- `IoMdSettings` → `Settings`
- `MdInfoOutline` → `Info`
- `MdOutlineMonitorHeart` → `HeartPulse` (see DEC-8)
- `GoSidebarCollapse` → `PanelLeftClose`; `GoSidebarExpand` → `PanelLeftOpen`
- `FaServer` → `Server`; `FaWrench` → `Wrench`; `FaRoute` → `Route`
- `BsFillLightningChargeFill` (groq) → `Zap`
**Basis:** convention — closest-shape lucide glyph; each confirmed present in `lucide-react` (already the app's primary icon lib, so zero new dependency weight). Verified rendered via gate:ui + the e2e icon-render assertions.

### DEC-3: Provider brand logos with no lucide equivalent → custom inline-SVG components
**Resolution:** Add `OpenAI.tsx`, `Anthropic.tsx`, `Gemini.tsx`, `HuggingFace.tsx` to `modules/llm-provider/icons/` (re-exported from `icons/index.ts`), each a `memo<IconProps>` mirroring the existing `DeepSeek.tsx`/`Mistral.tsx` exactly, with the SVG `viewBox` + `<path>` data copied VERBATIM from the corresponding react-icons glyph (`RiOpenaiFill`, `RiAnthropicFill`, `RiGeminiFill`, `SiHuggingface`) so the rendered logo is pixel-identical. `constants.tsx` maps `openai/anthropic/gemini/huggingface` to these instead of react-icons.
**Basis:** convention — the repo already ships DeepSeek/Mistral as custom SVG brand icons in this exact dir for exactly this reason (no lucide brand logos). Extends the established pattern; guarantees visual parity.

### DEC-4: LazyDatePicker location + mechanism
**Resolution:** ONE shared `src/components/common/LazyDatePicker.tsx`: a `React.forwardRef<HTMLButtonElement, DatePickerProps>` that renders `<Suspense fallback={<Skeleton className="h-9 w-full"/>}><LazyInner ref={ref} {...props}/></Suspense>` where `LazyInner = React.lazy(() => import('@ziee/kit/kit/date-picker').then(m => ({ default: m.DatePicker })))`. It re-exports `DatePickerProps` (type-only, no runtime cost). Both consumers import `LazyDatePicker` from it. The deep entry `@ziee/kit/kit/date-picker` (a valid package export) is the dynamic-import target so only react-day-picker/date-fns/calendar move to the lazy chunk.
**Basis:** convention — shared reusable components live in `src/components/common/`; `React.lazy`+`Suspense`+`Skeleton` is the standard lazy pattern; the kit `DatePicker` is `forwardRef` and `FormField` injects `ref`/`value`/`onChange` via `cloneElement`, so a forwardRef pass-through wrapper is required.

### DEC-5: Does this feature introduce any operational tunable (limits / retention / toggles) requiring a settings row?
**Resolution:** NO. This is a build/bundle configuration change. There is no runtime resource limit, retention period, rate/quota, concurrency cap, feature toggle, or model/provider selection. The vendor-group definition is a build-time constant in `vite.config.ts` (the correct home for build config), not an operator-facing runtime tunable. No settings table / REST / sync / admin card is warranted.
**Basis:** convention — the Phase-4 configurable-settings rule applies to RUNTIME operational tunables; a bundler chunk-grouping rule is build-time config with no runtime effect and no operator use-case.

### DEC-6: (HUMAN) How far to reduce the eager `@base-ui/react` weight (ITEM-4)?
**Resolution:** (recommended, non-blocking) Treat base-ui's eager weight with the ITEM-1 **vendor chunk** (moves ~874 KB of base-ui into a browser-cached chunk shared across deploys) and **defer** any deeper reduction. Evidence: (a) NO dev-gallery leakage — 0 `dev/gallery` sources in the entry sourcemap; (b) `@base-ui/react` is `sideEffects:false` and the `@ziee/kit` design system imports it via DEEP paths (28 of 53 shipped primitives) → it IS tree-shakeable and unused primitives are already dropped; (c) the remaining weight is legitimate broad usage across 394 `@ziee/kit` barrel imports. The only further reduction would be route-level lazy-loading of heavy primitives or splitting the `@ziee/kit` barrel — a large, higher-risk refactor of the SHARED SDK kit that 394 sites depend on, out of scope for a low-risk slimming pass. **Recommendation for the human:** accept the vendor-chunk treatment now; open a separate, dedicated effort if a further eager-base-ui reduction is wanted (candidate: audit which of the 28 primitives are only used on lazy routes and deep-import-lazy those). Do NOT gut the barrel in this pass.
**Basis:** codebase — sourcemap evidence + base-ui package metadata + kit import-style analysis; matches the ITEM-4 brief ("implement only if low-risk & clearly correct; otherwise report + recommend as a DECISION"). Surfaced to the human in the final report for confirmation; implementation proceeds with the vendor-chunk treatment regardless.

### DEC-7: package.json changes
**Resolution:** Remove `"react-icons"` from BOTH `src-app/ui/package.json` and `src-app/desktop/ui/package.json`. Add `"lucide-react"` to `src-app/desktop/ui/package.json` (it currently lacks it but the desktop override + shared UI source now use it; it resolves from the hoisted root today but should be declared per §17 dependency hygiene). Keep the same `^1.21.0` range as `src-app/ui` (syncpack drift guard).
**Basis:** convention — §17 "no dep without an import / no import without a dep" + the syncpack shared-version rule.

### DEC-8: `MdOutlineMonitorHeart` (hardware monitor) → which lucide glyph?
**Resolution:** `HeartPulse` (a heart with an ECG pulse line) — the closest visual match to Material's monitor-heart glyph, preserving the "heart + pulse" reading used for the hardware-usage monitor button.
**Basis:** convention — visual-parity priority (brief mandate); `HeartPulse` keeps the heart motif of the original, vs `Activity` (bare ECG line) which drops it. Reviewed rendered via gate:ui (the hardware monitor button surface) + e2e.
