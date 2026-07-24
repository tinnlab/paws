# PLAN_AUDIT — entry-slimming

Audit of PLAN.md against the actual codebase on base `origin/feat/agent-core`.

## Breakage risk

- **ITEM-1 (vendor chunk)** — LOW. `advancedChunks` is additive; the existing
  `chunkFileNames` function is preserved (merged into the same `output` object).
  Verified the installed rolldown (`node_modules/rolldown/dist/shared/define-config-*.d.mts`)
  exposes `output.advancedChunks.groups: CodeSplittingGroup[]` with `{name, test:
  StringOrRegExp, priority}` — the docs ship a react-vendor example verbatim. Risk:
  a too-greedy `test` could pull app code into vendor, or splitting react across
  chunks could break React's single-instance invariant. Mitigation: the group
  matches only `node_modules[\\/]` paths for the named framework packages, and
  react + react-dom + scheduler go in the SAME group (never split apart). Prove
  via the before/after build + a booting app (gate:ui A7 canary + e2e login).
- **ITEM-2 (react-icons → lucide + custom SVG)** — LOW/MEDIUM. Mechanical import
  swaps. Verified all 17 react-icons import sites and that every non-brand glyph
  has a lucide equivalent (`ChevronDown/ChevronLeft/UserRound/Settings/Info/
  HeartPulse/Server/Wrench/Route/Zap/PanelLeftClose/PanelLeftOpen` all resolve in
  `lucide-react`). The 4 brand logos (OpenAI/Anthropic/Gemini/HuggingFace) have no
  lucide equivalent → custom inline SVG mirroring the EXISTING `DeepSeek`/`Mistral`
  siblings in the same dir (zero new dependency; visual parity via verbatim path
  data). Risk: a wrong-looking glyph. Mitigation: DECISIONS records each mapping;
  gate:ui + e2e render the provider-icon + settings + sidebar surfaces.
- **ITEM-3 (lazy DatePicker)** — MEDIUM (highest-risk item). `FormField` injects
  `value/onChange/name/id/ref` onto its child via `React.cloneElement(children,
  injected)` (`sdk/packages/kit/src/kit/form.tsx:288`), and the kit `DatePicker`
  is `React.forwardRef<HTMLButtonElement, DatePickerProps>` (`date-picker.tsx:61`).
  So the lazy wrapper MUST be `forwardRef` and spread `{...props}` + forward `ref`,
  or the form binding breaks. Both current importers use it ONLY as a `FormField`
  child (`WorkflowElicitForm.tsx`, `elicitationFields.tsx`) — verified as the ONLY
  two static importers of `DatePicker` (grep). Removing both static imports lets
  the barrel re-export tree-shake, moving react-day-picker/date-fns to a lazy
  chunk. Risk: (a) ref/prop passthrough breakage → covered by the e2e that fills
  the elicitation date field; (b) an INEFFECTIVE_DYNAMIC_IMPORT if any OTHER eager
  module still statically imports DatePicker → guarded by verifying the sourcemap
  no longer contains react-day-picker (a static leak would keep it in the entry).
- **ITEM-4 (base-ui investigation)** — NONE (investigation + the ITEM-1 vendor
  chunk; no risky code change). Evidence gathered: 0 gallery sources in the entry
  map; `@base-ui/react` is `sideEffects:false`; the kit deep-imports 28/53
  primitives → tree-shakeable, weight is legitimate. Recorded as `DEC-6`.

## Pattern conformance

- ITEM-1 mirrors the rolldown docs' `advancedChunks.groups` example and keeps the
  repo's existing `chunkFileNames` convention.
- ITEM-2 brand icons mirror `modules/llm-provider/icons/DeepSeek.tsx` EXACTLY
  (a `memo<IconProps>` with `size`/`style`/`...rest`, `fill="currentColor"`,
  `<title>`), re-exported from `icons/index.ts` alongside DeepSeek/Mistral. lucide
  swaps match the `<Icon className="size-N"/>` idiom already in each file.
- ITEM-3 `LazyDatePicker` lives in `src/components/common/` (existing shared-
  component location) so both consumers reuse ONE wrapper (affordance-parity — no
  duplicated lazy logic). Uses `React.lazy`/`Suspense`/`Skeleton` — all standard.

## Migration collisions

None — UI-only change, no migration added (BASE.md).

## OpenAPI regen

Not required — no backend type/handler/route/permission change. `openapi.json` /
`api-client/types.ts` untouched in BOTH workspaces. (Confirmed: the diff is
purely `src-app/ui/**` + `src-app/desktop/ui/**` + the two `package.json`s.)

## Per-item verdicts

- **ITEM-1** — verdict: PASS — additive rolldown `advancedChunks` config, API verified against installed rolldown types; existing `chunkFileNames` preserved; no migration; mirrored to desktop twin.
- **ITEM-2** — verdict: PASS — mechanical import swaps; all non-brand glyphs confirmed in lucide; 4 brand logos mirror the existing DeepSeek/Mistral custom-SVG pattern; `react-icons` removed from both package.json.
- **ITEM-3** — verdict: CONCERN — the forwardRef + `cloneElement` prop/ref passthrough is the real risk; de-risked by the confirmed `forwardRef` DatePicker + a mandatory e2e that exercises the elicitation date field end-to-end, and by asserting react-day-picker leaves the entry sourcemap (catches an INEFFECTIVE_DYNAMIC_IMPORT leak). Not BLOCKED — approach is sound and proven-out by tests.
- **ITEM-4** — verdict: PASS — investigation only; evidence collected (no gallery leak, tree-shakeable base-ui, legitimate broad usage); recommendation (vendor-chunk via ITEM-1, defer deeper split) recorded as DEC-6 for the human. No risky code change.
