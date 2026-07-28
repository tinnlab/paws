# DRIFT-1 — implementation vs plan + design

Authored during phase 5, item by item.

- **DRIFT-1.1** — verdict: impl-wins — PLAN ITEM-1 said `validationCopy.ts`
  would import `STEP_KIND_LABELS` from `stepForms`. The node:test loader does
  not resolve extensionless relative specifiers in the app tree, so a RUNTIME
  import of `stepForms` broke the spec before any assertion ran. The exported
  helper that needed it (`stepKindLabel`) had no caller, so it was removed and
  the import narrowed to `import type`. Dead code removed rather than a loader
  worked around (§15); no plan amendment needed beyond this note.

- **DRIFT-1.2** — verdict: plan-wins — the first `BuilderValidationPanel`
  implementation used a raw `<button>` for the clickable finding.
  `lint:guardrails` rejects raw interactive elements (the kit enforces
  accessible names + testids). Re-implemented with the kit `Button` — the plan's
  "Patterns to follow" already said to mirror the page's kit usage, so the
  implementation was wrong, not the plan.

- **DRIFT-1.3** — verdict: impl-wins — PLAN ITEM-5 specified the Tool picker
  populated from the server's tools. It did not say what happens to the step's
  `tool` + `arguments` when the SERVER changes. Keeping them would send server
  A's arguments to server B's tool — a silent correctness bug. The
  implementation clears both on server change, and clears `arguments` on tool
  change. Recorded here rather than left implicit.

- **DRIFT-1.4** — verdict: impl-wins — PLAN ITEM-9 described the fallback as
  driven by "server unreachable". Implementation found FOUR distinct causes that
  each need different copy (no server chosen yet / name matches no accessible
  server / no `mcp_servers::read` / fetch failed). Modelled as a
  `CatalogFailure` union so each states its own reason, and `no-server` is
  deliberately NOT treated as a failure (it is the ordinary initial state). This
  strengthens INV-6 rather than diverging from it.

- **DRIFT-1.5** — verdict: resolved — DESIGN §2.3's rule is general, but the
  INV-6 fallback necessarily binds a free-text control to `step.tool`. The first
  class test (TEST-3) therefore failed on this branch's OWN code. Rather than
  exempting the file (which would gut the rule), the rule was refined: a
  free-text binding is a violation **unless the same form also binds that field
  to a picker**. A form that only ever offers a text box has not degraded from
  anything. The carve-out is itself tested (a picker for a DIFFERENT field does
  not clear the violation).

- **DRIFT-1.6** — verdict: impl-wins — ITEM-11 planned to add a tool step to the
  gallery. The render review found the validation fixture ALSO seeded no `def`,
  so every finding rendered "Whole workflow" and the surface could not exercise
  attribution at all. Fixed as part of the same item, plus a new
  `seeded-wf-builder-problems` surface, because ITEM-4's invalid markers had no
  gallery state anywhere.

- **DRIFT-1.7** — verdict: impl-wins — three visual defects were found only by
  LOOKING at the 390px render (all gates were green): the per-field reference
  trigger overflowed the label row; the `{}` marker floated to the vertical
  middle of a wrapped description; the step list's "1 problem" wrapped inside
  the `w-80` column. Fixed. Recorded because it is direct evidence for the
  phase-8 rule that a green gate is not a rendered review.

- **DRIFT-1.8** — verdict: impl-wins — `npm run gen:testid-registry` writes into
  the **`sdk` submodule** (`sdk/packages/kit/src/testIds.generated.ts`), so any
  branch adding a `data-testid` has a cross-repo dependency that
  `check:testid-registry` enforces. Committed on a local sdk branch
  (`wf-builder-ux-testids`, `cbe5f37`); the parent pointer is deliberately NOT
  bumped (same reasoning as DEC-9). **The orchestrator must land this** or
  `npm run check` fails on a fresh checkout of this branch.

**Unresolved drifts:** 0
