# DECISIONS — scheduler-settings-layout

### DEC-1: Which settings page is the canonical sibling this form must be a twin of?
**Resolution:** TWO, split by concern. The FORM is a twin of
`src-app/ui/src/modules/file-rag/components/sections/RetrievalLimitsSection.tsx`
— the same job (an admin card of deployment-wide numeric caps), same
composition: `Card title + footer={<SettingsFormActions/>}`, an intro
`Paragraph type="secondary"`, `<Form layout="horizontal">`, one
`<FormField name label description>` per limit, `<InputNumber className="w-40">`.
The PAGE SHELL is a twin of `src-app/ui/src/modules/auth/SessionSettingsPage.tsx`
— the closest whole-page twin (a singleton admin settings page): loading `Spin`,
retryable `ErrorState` on primary-load failure, read-only Alert, `useForm`
re-seeded only when `!isDirty`, dirty-gated Save.
**Basis:** codebase — both were read in full; they are the two nearest existing
implementations by job, not by name.

### DEC-2: How wide should a numeric limit input be?
**Resolution:** `className="w-40"` (160px).
**Basis:** convention — every numeric `InputNumber` in the `file-rag` admin
sections (12 of them across `ChunkingSection`, `FullTextSection`,
`RetrievalLimitsSection`, `EnableSection`, `EmbeddingSection`) and
`mcp/components/system/McpUserPolicyCard.tsx` uses exactly `w-40`. The competing
precedent (`SessionSettingsPage`, `LitSearchGlobalSection` → `w-full`) leaves a
two-digit value in a ~625px box, which is the very complaint being fixed, so the
narrower, more common convention wins.

### DEC-3: Do the units stay in the label text or move to the control?
**Resolution:** move to the control `suffix` — label "Minimum interval" +
`suffix="seconds"`; "Self-paced loop horizon" + `suffix="days"`; "Notification
retention" + `suffix="days"`. The `0 = forever` semantics moves into the field
`description`, where the explanation belongs.
**Basis:** convention — `SessionSettingsPage` (`suffix="hours"` / `"days"`),
`McpUserPolicyCard` (`suffix="days"`), `LitSearchGlobalSection` (`suffix="s"`).
It also shortens the labels, which is the second-order cause of the wrap.

### DEC-4: Does the card get a Cancel as well as a Save?
**Resolution:** yes — `SettingsFormActions` with both, in the Card `footer`, Save
disabled until `form.formState.isDirty`.
**Basis:** convention — the component's own doc-comment: "The ONE convention for
a card's Save/Cancel actions. Rendered in the Card `footer` slot (never as a
Separator + inline buttons in the body)". Every sibling settings card obeys it;
this page did not.

### DEC-5: What is the exact, mechanical definition of a "starved" label?
**Resolution:** a label element (`[data-slot=field-label]`, `<label>`, or
`legend`) is STARVED when ALL of:
1. it wraps — rendered height ≥ 2 × its computed line-height;
2. it is squeezed — its border-box width < **0.5 ×** its natural single-line text
   advance width (sum of the client rects of a Range over its contents);
3. the row had room — its nearest `[data-slot=field]` (or its offsetParent row)
   is ≥ **2 ×** the label's natural width;
4. it has real text — ≥ 2 words and ≥ 8 characters (so an icon-only or
   one-word label can never trip it).
**Basis:** measurement, not taste. Applied to the 220 field labels rendered
across all 46 gallery page surfaces + 47 overlays at 1280, it flags exactly the
5 Scheduler labels and nothing else (0 false positives). The `< 0.5 ×` bound is
what separates "wrapped because the text is long" (a legitimate 2-line label sits
at squeeze ≈ 0.5–1.0) from "wrapped because the column collapsed" (Scheduler:
0.26–0.37).

### DEC-6: Which controls does the new static lint treat as "stretching"?
**Resolution:** exactly `Input`, `InputNumber`, `InputPassword`, `Textarea` — the
kit controls whose ROOT element is the native control carrying `w-full`
(`sdk/packages/kit/src/shadcn/{input,textarea}.tsx`). `Select` is NOT included:
its root is `<div className="relative">`, a content-sized flex item, so it does
not steal the row (verified by measurement — `ThemeSettings` and
`McpToolApprovalsTab` both use `Select` inside a `responsive` `Field` and render
0 starved labels). `Switch`/`Checkbox`/`Segmented`/`RadioGroup` are intrinsically
sized and likewise excluded.
**Basis:** codebase + measurement. A broader control set would make
`lint:settings-field` (which is inside `npm run check`) fire on two correct,
shipped pages — a noisy check is worse than none.

### DEC-7: Where does the live-ui-audit rig detector land, given the file is dirty upstream?
**Resolution:** author it as ONE self-contained additive hunk on a local branch
in the `agent-kit` submodule (`fix/label-starvation-detector`), committed but
**NOT pushed**, and flag it explicitly in the report. Do NOT edit the
orchestrator's working copy of that file.
**Basis:** user/orchestrator — the orchestrator states they are actively editing
`skills/live-ui-audit/live-ui-audit.mjs` (their checkout has 2392 lines
uncommitted vs 1473 on `agent-kit/origin/main`) and that "sdk/agent-kit changes
land on their own remote before the superproject pointer moves". A hunk that
touches one detector block + one `DIMENSION` entry applies to either revision.

### DEC-8: Is the `agent-kit` submodule pointer bumped on this branch?
**Resolution:** yes — `925cef2` → `agent-kit/origin/main` (`8435b4b`).
**Basis:** convention + necessity. The pinned `925cef2` lifecycle validator's A1
counts `.lifecycle` feature dirs ON DISK, so EVERY branch cut from this base
fails phase 1 against the 17 inherited dirs; upstream `2ec3232` fixes A1 to count
what the BRANCH adds. Sibling branches on this base already carry
"chore: bump agent-kit submodule" commits for the same reason. The bump also
brings the `live-ui-audit` skill in-tree, which ITEM-10 needs.

### DEC-9: Does the new visual spec gate, or only report?
**Resolution:** it GATES — added to `gallery.config.json → visualSpecs` so
`npm run gate:ui` runs it and a starved label fails the build.
**Basis:** convention + the stated problem. The existing non-gating detectors
(`gallery:geometry`, runtime-health's LOW `spacing-grid`) are exactly why this
class of defect shipped; a report-only addition would repeat the mistake. The
repo's escape hatch for a genuine pre-existing exception is a documented
baseline file (`layout-baseline.ts` / `axe-baseline.ts` /
`geometry-allowlist.json`), not a non-gating severity.

### DEC-10: Does the read-only (non-manager) path change?
**Resolution:** no behavioural change — the read-only Alert stays, the whole
`Form` gets `disabled={!canManage}`, and `SettingsFormActions` renders with
`saveDisabled` / `cancelDisabled`. The footer is rendered in BOTH cases (unlike
today, where the Save block is omitted entirely for a reader), so a reader sees
a disabled, explained control rather than a missing one.
**Basis:** convention — `SessionSettingsPage` renders the footer unconditionally
with `saveDisabled={!canManage || !isDirty}`.

### DEC-11: Is the gallery's `settings-scheduler` cassette changed?
**Resolution:** no. It already seeds `SchedulerAdminSettings.get` with all five
values, so the `loaded` state is POPULATED (which is what the populated-render
review requires) and `coverage.ts` already declares
`states: ['loaded','empty','error']`.
**Basis:** codebase — `src-app/ui/src/modules/scheduler/gallery.tsx` +
`src/dev/gallery/coverage.ts:392`.

### DEC-12: Does the e2e drive the real backend or `page.route()` mocks?
**Resolution:** the REAL backend. `admin-settings-layout.spec.ts` logs in as
admin and reads/writes `/api/scheduler/admin-settings` for real; the pre-existing
`admin-settings.spec.ts` keeps its mock (unchanged, still green).
**Basis:** convention — TESTING_GUIDE / CODING_GUIDELINES §14: "No `page.route()`
API mocking — drive the real backend through the UI."
