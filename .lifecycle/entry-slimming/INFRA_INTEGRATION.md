# INFRA_INTEGRATION — entry-slimming (Phase 5 mandatory walks)

Per-item UX walk + infrastructure-integration walk + entity-lifecycle walk. This
is a build/bundle change with a narrow user-facing surface (icon glyphs + the
lazy date-picker), so the walks are focused.

## ITEM-1 (vendor chunk)

- **UX walk:** invisible to the user except faster warm loads — after the first
  visit the `vendor-<hash>.js` (framework libs) stays cached across app deploys,
  so a code change re-downloads only the ~57 KB entry, not the ~495 KB vendor.
  No new affordance, no new state.
- **Infra walk:** touches the VITE BUILD pipeline only. Verified: (a) no
  `codeSplitting` option is set anywhere (so rolldown honors `advancedChunks`,
  per its type docs); (b) the existing `chunkFileNames` module-naming function is
  PRESERVED (the 16-smart-loading e2e keys off `facadeModuleId`, not the vendor
  chunk name); (c) react + react-dom + scheduler land in the SAME chunk (a split
  React instance would crash boot — the global-setup.ts dedupe list documents
  exactly this failure mode). Confirmed by build: `vendor-CXiUzYDw.js` = 495 KB,
  100% node_modules (@base-ui/react-dom/react-router/@floating-ui/react/tslib/
  scheduler), and the app still boots (e2e TEST-1).
- **Entity-lifecycle:** N/A — no entity.

## ITEM-2 (react-icons → lucide + custom SVG)

- **UX walk:** every swapped glyph must look right. Nav chevrons, the settings
  gear, the person/info icons, the sidebar toggle, the hardware-monitor button,
  and the 10 provider icons (incl. the 4 custom brand SVGs) all render into
  EXISTING surfaces. The custom brand SVGs use verbatim react-icons path data →
  pixel-identical. lucide glyphs are wrapped to 1em at the provider list (the
  call sites expect font-size-driven icons, as react-icons was) and given
  `size="1em"` at the other call sites — preserving the prior sizing. The desktop
  sidebar toggle mirrors the ALREADY-migrated web sibling (`PanelLeft`/
  `PanelRight` + `size-5`) rather than inventing a variant.
- **Infra walk — the critical discovery:** the react-icons importers are NOT only
  in `src-app/ui/src`. A repo-wide grep found the app-wide Drawer primitive lives
  in the `@ziee/shell` SDK package (`sdk/packages/shell/src/components/Drawer.tsx`),
  consumed by the app via the `layouts/app-layout/components/Drawer.tsx` shim, and
  it statically imported `react-icons/io`. Until that was swapped, react-icons
  stayed a live dependency and lingered in the entry sourcemap (though already
  tree-shaken to 0 bytes in the shipped output). Two `resolve.dedupe` lists
  (`desktop/ui/vite.config.ts`, `tests/global-setup.ts`) also named react-icons —
  dropped so the lists stay honest post-uninstall. This is the infra-walk payoff:
  the module boundary was wider than the plan assumed.
- **Entity-lifecycle:** N/A — icons are stateless.
- **Cross-workspace:** desktop reuses the shared `src-app/ui/src` source (fallback
  alias), so the icon swaps propagate to desktop automatically; the desktop-owned
  override (`hardware-monitor.tsx`) + package.json were swapped separately.

## ITEM-3 (lazy DatePicker)

- **UX walk:** the date field appears on exactly two low-traffic surfaces — the
  MCP tool ELICITATION form and the WORKFLOW elicit form. On those, the field now
  shows a `Skeleton` for the few ms its lazy chunk loads, then the identical
  DatePicker. Everywhere else, first paint no longer pays the ~82 KB
  react-day-picker+date-fns+calendar cost.
- **Infra walk — the FormField binding constraint:** the kit `FormField` injects
  `value`/`onChange`/`name`/`id`/`ref` onto its child via
  `React.cloneElement(children, injected)` (`sdk/packages/kit/src/kit/form.tsx`),
  and the kit `DatePicker` is `React.forwardRef<HTMLButtonElement>`. So the lazy
  wrapper MUST be a `forwardRef` that spreads `{...props}` AND forwards `ref`, or
  the two elicitation forms silently stop binding the picked date into form state.
  `LazyDatePicker` satisfies this. Verified by TEST-5 (unit: ref + prop
  passthrough) and TEST-3 (e2e: a real elicitation round-trip binds a date).
  Also verified there is NO remaining STATIC importer of the kit `DatePicker` in
  the app (only the dev gallery story, which is not in the prod graph) — so the
  barrel re-export tree-shakes and react-day-picker/date-fns land in the lazy
  `date-picker-<hash>.js` chunk (confirmed: absent from the entry sourcemap,
  present in `date-picker-DKllDLBv.js`).
- **Entity-lifecycle:** the date VALUE is form state owned by the elicitation
  form; add/mutate/clear all flow through the unchanged FormField binding (the
  lazy wrapper is transparent to it). No sync/SSE path (elicitation state is
  local to the in-flight tool call). No delete/access-loss dimension.

## ITEM-4 (base-ui investigation)

- **Infra walk:** evidence gathered (see DEC-6): 0 `dev/gallery` sources in the
  entry sourcemap (no gallery leak); `@base-ui/react` is `sideEffects:false` and
  the kit deep-imports 28/53 primitives (tree-shakeable); the weight is legitimate
  broad usage. Treatment = the ITEM-1 vendor chunk (base-ui now caches in
  `vendor-*.js`, out of the eager entry). No risky code change; the deeper-split
  recommendation is DEC-6 for the human.

## Pre-existing desktop build state (documented, NOT a regression — Category A)

The desktop production `vite build` fails on the UNTOUCHED base
(`origin/feat/agent-core`) with 5 `MISSING_EXPORT` errors from
`src-app/ui/src/modules/loader.desktop.ts` (`ensureModuleForPath`,
`revalidateForPath`, `isPathModulePending`, `isPathModuleForbidden` — a
desktop/core loader override drift). Reproduced by stashing this branch's diff
and rebuilding desktop from base: identical 5 errors. This feature touches NONE
of `loader.ts`/`loader.desktop.ts`/`RouterComponent.tsx`, and adds ZERO new
desktop build errors. Consequence: a full desktop production build can't be
completed here regardless of this diff, so the desktop vendor chunk is validated
by construction (the desktop `vite.config.ts` change is a byte-identical mirror
of the working UI config) rather than by a full green build. Classified
**Category A** (pre-existing/blocked, not a merge regression) per CLAUDE.md.
