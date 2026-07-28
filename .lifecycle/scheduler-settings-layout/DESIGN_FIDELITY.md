# DESIGN_FIDELITY — scheduler-settings-layout

One verdict per PLAN invariant: does the PLAN, as written, uphold it?

- **INV-1** — fidelity: UPHELD — ITEM-1 replaces the hand-composed
  `Field/FieldContent/FieldTitle` rows with `<Form layout="horizontal">` +
  `<FormField>`, the kit's own field-primitive composition. ITEM-8 mechanizes
  the invariant so a future regression fails `npm run check` instead of
  shipping.
- **INV-2** — fidelity: UPHELD — `FormField` in horizontal layout renders the
  label as a DIRECT child of `Field` with `width: 13rem; flex: none`
  (`sdk/packages/kit/src/kit/form.tsx:280`), so the label column is fixed and
  cannot be squeezed by a `w-full` control. ITEM-9 + ITEM-10 turn the invariant
  into a measured, gating assertion (spec) and a live-rig detector.
- **INV-3** — fidelity: UPHELD — ITEM-3 moves Save into the Card `footer` via
  `SettingsFormActions` and adds the Cancel the convention requires.
- **INV-4** — fidelity: UPHELD — the rebuilt page carries no colour value at all
  (every surface/foreground comes from `Card`/`Form`/`FormField`/`Alert`), no
  ad-hoc `gap-*` (spacing is owned by `FieldGroup` + `Card`), and no physical
  direction property. Enforced by the existing `lint:colors` and
  `lint:logical-direction` inside `npm run check` (ITEM-6).
- **INV-5** — fidelity: UPHELD — ITEM-5 verifies POPULATED renders at 390/768/
  1280 (the gallery cassette seeds `SchedulerAdminSettings.get`, so `loaded` is
  populated), and ITEM-9's gating spec asserts the 390px cell, not just desktop.
- **INV-6** — fidelity: UPHELD — the PLAN's "Patterns to follow" table names one
  concrete sibling per area and the plan is a transcription of
  `RetrievalLimitsSection` + `SessionSettingsPage`; nothing about the layout is
  newly invented. ITEM-2's `w-40` and ITEM-4's `Paragraph`/`ErrorState` are the
  siblings' values, not new choices.

**AT-RISK / DROPPED:** none.
