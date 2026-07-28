# PLAN — scheduler-settings-layout

Fix a reported live-app UI defect on **`/settings/scheduler`** ("the form layout
is horrendous and does not look like any other settings pages") AND close the
test-gap that let a page this visibly broken pass every gate.

## The defect (reproduced, measured)

`SchedulerAdminPage.tsx` hand-composes each row as

```tsx
<Field orientation="horizontal">
  <FieldContent>
    <FieldTitle>Max active tasks per user</FieldTitle>
  </FieldContent>
  <InputNumber … />          {/* base Input is `w-full min-w-0` */}
</Field>
```

which **inverts** the kit's horizontal-field contract. In
`sdk/packages/kit/src/shadcn/field.tsx`, `orientation="horizontal"` is
`flex-row … *:data-[slot=field-label]:flex-auto`: the flex-auto (content-sized)
slot is reserved for a **direct-child label**, and `FieldContent` is
`flex flex-1` (flex-basis **0**) for the *control* column. Putting the label
inside `FieldContent` gives it basis-0 while the sibling `InputNumber` carries
`w-full` (basis ≈ 100%), so the label column collapses to min-content and every
label wraps to one word per line.

Measured on the gallery (`settings-scheduler`, dark, loaded, 1280×900) — matches
the owner's screenshot exactly:

| label | lines | label box | natural width | row width |
|---|---|---|---|---|
| Max active tasks per user | 5 | 43×100 | 162 | 840 |
| Minimum interval (seconds) | 3 | 68×60 | 186 | 840 |
| Self-paced loop horizon (days) | 5 | 52×100 | 199 | 840 |
| Auto-pause after N consecutive failures | 4 | 84×80 | 264 | 840 |
| Notification retention (days, 0 = forever) | 4 | 80×80 | 272 | 840 |

Across all 46 gallery page surfaces + 47 overlays (220 measured field labels),
**`settings-scheduler` is the ONLY offender** — every other settings page routes
its form through `Form`/`FormField`, which composes the field correctly.

## Design source

This plan realizes existing, already-written design rules — it introduces no new
design. Sources, in precedence order:

1. **`agent-kit/docs/DESIGN_SYSTEM.md` → "Form & settings layout — use `Field`,
   not raw flex-gap"** — the binding rule for every settings form: compose the
   kit's field primitives; wrap the page in `SettingsPageContainer` and each
   section in `Card`; "match the existing settings cards rather than
   free-styling sizes/spacing."
2. **`agent-kit/docs/DESIGN_SYSTEM.md` → "Spacing rhythm"** (4px scale, logical
   direction properties only) and **"Semantic color tokens"** (never a raw hue /
   arbitrary value / inline style colour).
3. **`agent-kit/docs/DESIGN_SYSTEM.md` → "Component variant selection"** — match
   the visual WEIGHT of a component to its container; a settings card's actions
   are a `SettingsFormActions` footer row, not inline buttons in the body.
4. **The in-repo reference implementations** those rules describe:
   `file-rag/components/sections/RetrievalLimitsSection.tsx` (limits form) and
   `auth/SessionSettingsPage.tsx` (settings page shell).
5. **The owner's live-app defect report (verbatim)**: *"the form layout is
   horrendous and does not look like any other settings pages."*

## Invariants

Non-negotiables lifted from the sources above; each gets a phase-2 fidelity
verdict and a phase-3 executable acceptance test.

- **INV-1**: A settings form composes the kit's field primitives — settings form
  controls reach the user through `Form`/`FormField` (or a correctly-composed
  `Field`), never a hand-rolled label+control layout. *(DESIGN_SYSTEM "Form &
  settings layout")*
- **INV-2**: No form label is starved — a field label must not be squeezed below
  half its natural single-line width while its row has ample room. This is the
  measurable form of "does not look like any other settings page". *(the defect
  report; the mechanical statement of DESIGN_SYSTEM's layout rule)*
- **INV-3**: A settings card's Save/Cancel live in the Card `footer` via
  `SettingsFormActions`, never as inline buttons in the card body.
  *(SettingsFormActions doc-comment: "The ONE convention"; DESIGN_SYSTEM
  variant-weight rule)*
- **INV-4**: The page uses semantic colour tokens only, stays on the 4px spacing
  scale, and uses logical direction properties only (`ps/pe`, `ms/me`,
  `text-start/end`) — never physical `pl/pr`, `ml/mr`, `text-left/right`.
  *(DESIGN_SYSTEM "Semantic color tokens" + "Spacing rhythm")*
- **INV-5**: The surface works POPULATED at ~390px, tablet and desktop — a
  surface that only works at desktop width is a defect, and its gallery coverage
  must include a narrow-viewport state. *(feature-lifecycle UI-surface checklist,
  "Device size / responsive" + "Populated-render review")*
- **INV-6**: Divergence from the canonical sibling is a bug, not a variant — the
  new surface mirrors its sibling's structure / typography / tokens / container
  layout FIRST. *(feature-lifecycle UI-surface checklist, "Precedent")*

## Items

- **ITEM-1**: Rebuild the `/settings/scheduler` "Limits" form on the canonical
  settings-form composition — `useForm` + `<Form layout="horizontal">` +
  `<FormField name label description>` — replacing the hand-composed
  `<Field orientation="horizontal"><FieldContent><FieldTitle>` rows. `FormField`
  emits the label as a DIRECT child of the `Field` with the kit's fixed `13rem`
  label column, so the label column can no longer be starved.
- **ITEM-2**: Constrain each numeric control to the house numeric width
  (`className="w-40"`) with a unit `suffix` where the unit is currently smuggled
  into the label text ("(seconds)", "(days)"), per
  `file-rag/components/sections/RetrievalLimitsSection.tsx`. A two-digit value
  must not sit in a ~780px box.
- **ITEM-3**: Move the Save out of the card BODY into the Card `footer` via
  `SettingsFormActions` (Save + Cancel), dirty-gated and permission-gated —
  the one house convention for a settings card's actions.
- **ITEM-4**: Page-shell parity with `SessionSettingsPage`: keep the loading
  `Spin`; add a retryable `ErrorState` when the PRIMARY load fails (today a load
  failure renders an inline Alert and an empty card); keep the read-only Alert;
  add the intro `Paragraph type="secondary"` the sibling limit-cards carry, and
  a per-field `description` so each limit explains itself.
- **ITEM-5**: Responsive: verify POPULATED renders at 390 / 768 / 1280. The kit
  `Form` stacks `horizontal → vertical` under 480px of its OWN width via a
  ResizeObserver, so mobile gets label-above-control for free; assert no starved
  label and no horizontal page overflow at each width.
- **ITEM-6**: DESIGN_SYSTEM conformance sweep of the changed page: semantic
  colour tokens only (no raw hue / arbitrary value / inline style colour), 4px
  rhythm owned by `FieldGroup`/`Card` rather than ad-hoc `gap-*`, logical
  direction properties only. (`SectionHeader` is not applicable — the card title
  carries no actions; actions live in the Card `footer` per ITEM-3.)
- **ITEM-7**: Sweep every other settings surface for the same defect,
  EMPIRICALLY (measure all gallery page + overlay surfaces × 390/768/1280) and
  by AST, and report every offender with evidence.
- **ITEM-8**: mechanical check #1 — the CAUSE, static — extend
  `sdk/packages/config/src/lint/settings-field.mjs` with a second rule — in a
  settings-scoped file, a **stretching** control inside a hand-composed
  `<Field orientation="horizontal"|"responsive">` (i.e. NOT inside a
  `<FormField>`) is a violation, because that composition starves the label
  column. "Stretching" is defined by the kit source, not by guesswork: exactly
  the controls whose ROOT element is the native control carrying `w-full` —
  `Input`, `InputNumber`, `InputPassword`, `Textarea`
  (`sdk/packages/kit/src/shadcn/{input,textarea}.tsx`). Controls whose root is a
  content-sized wrapper (`Select` → `<div className="relative">`) or which are
  intrinsically sized (`Switch`/`Checkbox`/`Segmented`/`RadioGroup`) do NOT
  starve the row and stay legal — that is the shadcn row pattern
  `ThemeSettings` and `McpToolApprovalsTab` use correctly (both measured: 0
  starved labels).
- **ITEM-9**: mechanical check #2 — the SYMPTOM, rendered — a new **gating**
  visual spec `tests/e2e/visual/form-label-starvation.spec.ts` that measures
  every field label on every gallery PAGE surface at 1280 and 390 and fails on a
  starved label. Registered in `gallery.config.json → visualSpecs` so
  `npm run gate:ui` runs it. This also closes a structural gap: today Layer A
  (`layout.spec.ts`) iterates only `gallery-section-*` — the 72 KIT-component
  story sections — so the deterministic layout invariants have **never** run
  against any of the 46 real page surfaces.
- **ITEM-10**: mechanical check #3 — the 24/7 rig — add a `label-starvation`
  detector + category to the `agent-kit` `live-ui-audit` skill so the always-on
  rig can perceive this defect class (it visits `/settings/scheduler` every
  cycle and reports nothing, because none of its 33 categories can see a label
  that wraps *inside its allotted column*).
- **ITEM-11**: An e2e spec for `/settings/scheduler` against the REAL backend:
  populated render, no starved label at 1280, stacked (not starved) at 390, the
  numeric control bounded, and the save round-trip persisting.

## Files to touch

- `src-app/ui/src/modules/scheduler/pages/SchedulerAdminPage.tsx` (rebuild)
- `src-app/ui/tests/e2e/visual/form-label-starvation.spec.ts` (new)
- `src-app/ui/tests/e2e/helpers/layout.ts` (add the reusable
  `collectStarvedLabels` probe next to the other layout invariants)
- `src-app/ui/gallery.config.json` (register the new gating visual spec)
- `src-app/ui/tests/e2e/14-scheduler/admin-settings-layout.spec.ts` (new)
- `sdk/packages/config/src/lint/settings-field.mjs` (submodule — lands separately)
- `agent-kit/skills/live-ui-audit/live-ui-audit.mjs` (submodule — lands separately)

## Patterns to follow

| area | mirror | why |
|---|---|---|
| the limits form itself | `src-app/ui/src/modules/file-rag/components/sections/RetrievalLimitsSection.tsx` | the SAME JOB — an admin card of deployment-wide numeric caps: `Card title + footer={<SettingsFormActions/>}`, an intro `Paragraph type="secondary"`, `<Form layout="horizontal">`, `<FormField name label description>`, `<InputNumber className="w-40">` |
| the page shell | `src-app/ui/src/modules/auth/SessionSettingsPage.tsx` | the closest PAGE twin — a singleton admin settings page: `SettingsPageContainer`, loading `Spin`, `ErrorState` on primary-load failure, read-only Alert, `useForm` re-seeded only when not dirty, dirty-gated Save |
| numeric width + unit suffix | `file-rag/**/sections/*.tsx` (`w-40`), `mcp/components/system/McpUserPolicyCard.tsx` (`w-40` + `suffix="days"`) | the house numeric-input width convention |
| the new static lint | `sdk/packages/config/src/lint/settings-field.mjs` (rule 1) | same file, same TS-compiler-API walk, same opt-out flag idiom |
| the new visual spec | `src-app/ui/tests/e2e/visual/layout.spec.ts` + `_gallery.ts` | Layer-A idiom: deterministic, backend-free, drives the gallery Vite server |
| the e2e | `src-app/ui/tests/e2e/14-scheduler/admin-settings.spec.ts` | same dir, same `loginAsAdmin` + `testInfra.baseURL` idiom |
| the rig detector | `agent-kit/skills/live-ui-audit/live-ui-audit.mjs` §6–§9 in-page detectors | same `findings.push({category,severity,selector,detail})` shape |

## UI-surface plan checklist

- **Precedent** — `RetrievalLimitsSection` (form) + `SessionSettingsPage` (shell).
  Divergence from those is the bug being fixed; nothing new is invented.
- **Scale / cardinality** — fixed 5 fields on a singleton settings row. No list,
  no pagination, no unbounded fetch. `GET /api/scheduler/admin-settings` returns
  one row.
- **Device size / responsive** — 390 / 768 / 1280 all verified POPULATED. The kit
  `Form` self-stacks horizontal→vertical below 480px of its own width (same
  mechanism every other horizontal settings form uses), so mobile renders
  label-above-control. No horizontal page scroll at any width.
- **Populated-render review** — the gallery cassette already seeds
  `SchedulerAdminSettings.get`, so the `loaded` state is populated; before/after
  screenshots are captured at all three widths in the populated state.
- **User-visible progress** — the page ingests/produces nothing; Save shows the
  kit Button `loading` state and a success/error toast (unchanged).
- **Input economy** — no value here is client-derivable; all five are genuine
  operator limits. Units move OUT of the label text into the control `suffix`
  so the operator reads "Minimum interval | 300 seconds" rather than parsing a
  parenthetical.
- **JTBD** — the job is *"as a deployment admin I want to see, understand, and
  safely change the five scheduler guard-rails"*. Surfaces: (list) none;
  (detail/form) the Limits card — each limit must state what it bounds and what
  happens at the bound, hence the per-field `description`; (empty) n/a — a
  singleton row always exists; (loading) `Spin`; (error) retryable `ErrorState`
  for a failed load, toast for a failed save; (read-only) the non-manager sees
  the values and an explicit "read-only" Alert with the Save disabled;
  (mobile) stacked fields, full-reach controls.
- **Multi-instance / URL-as-view-into-focus / platform affordances** — n/a, a
  single static settings route.
