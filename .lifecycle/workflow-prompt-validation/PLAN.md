# PLAN — workflow-prompt-validation

Fixes the two residuals the `workflow-builder-ux` blind audit recorded rather
than silently fixing.

## Design source

- Realizes `.lifecycle/workflow-prompt-validation/DESIGN.md` §1 (the
  validate/dispatch disagreement), §2 (the kit combobox addon overflow) and §3
  (out of scope).
- That design is itself derived from, and quotes verbatim,
  `.lifecycle/workflow-builder-ux/FIX_ROUND-8.md` ("HIGH — the builder's own
  remedy produced a workflow that fails at run"),
  `.lifecycle/workflow-builder-ux/FIX_ROUND-2.md` ("The test that could not
  fail") and the `MAX_TOLERATED_OVERFLOW_PX` doc comment in
  `src-app/ui/tests/e2e/workflows/builder-responsive.spec.ts`.

## Invariants

- **INV-1**: "Validation must be at least as strict as dispatch. A definition the
  validator reports GREEN must not fail at run for a prompt-configuration reason;
  and a definition the validator reports RED must not quietly succeed at run with
  a degenerate prompt. The two sides must derive the prompt source from ONE
  shared rule, so they cannot drift again." (DESIGN §1)
- **INV-2**: "Lower this to 1 once the kit addon is fixed." — i.e. the addon must
  sit inside its group, fixed on-system (grid-aligned logical-direction padding,
  not a magic offset), and `MAX_TOLERATED_OVERFLOW_PX` returns to 1. (DESIGN §2,
  quoting `builder-responsive.spec.ts`)

## Items

- **ITEM-1**: Add ONE shared prompt-source rule to the workflow module — a pure
  `prompt_source(prompt, prompt_file) -> PromptSource` in `validate.rs` (which
  already owns the `WorkflowDef` vocabulary) returning
  `Inline(&str) | File(&str) | Missing | Both`. It normalises an EMPTY `prompt`
  and an EMPTY `prompt_file` to "absent"; whitespace is untouched (DEC-3).
  Amended during phase 5 (DRIFT-1.1): the `prompt_file:` half is factored out as
  `prompt_file_ref(&Option<String>) -> Option<&str>`, which `prompt_source` and
  `check_prompt_files` (ITEM-4) both call — `check_prompt_files` needs the PATH
  even in a both-state, so without the split the emptiness rule would have been
  written twice, which is precisely the duplication this item exists to remove.
- **ITEM-2**: `validate.rs`'s prompt XOR check derives its verdict from
  `prompt_source` instead of its own `has_prompt`/`has_file` pair. The two
  emitted codes and their exact messages are unchanged (the branch's
  author-facing copy is keyed off them).
- **ITEM-3**: `dispatch.rs::load_raw_prompt` derives its arm from
  `prompt_source` instead of `match (prompt, prompt_file)`, so `Some("")` beside
  a `prompt_file:` reads the FILE and `Some("")` alone is an error rather than an
  empty LLM call. Its signature drops the whole `RunContext` for the one field it
  uses (`extracted_path`), making it directly unit-testable.
- **ITEM-4**: `check_prompt_files` stops answering a question it gets wrong:
  an empty `prompt_file` is "absent" (so `WORKFLOW_PROMPT_MISSING` fires rather
  than a green verdict), and a `prompt_file` that resolves to something that is
  not a regular FILE is `WORKFLOW_PROMPT_FILE_MISSING` (today a directory path
  passes existence and then fails the run with "Is a directory"). Reuses the
  existing code, so no new author-facing copy is required.
- **ITEM-5**: Mirror the normalisation on the client so the builder cannot
  disagree with the backend either: `promptSuppliedByFile` requires a NON-EMPTY
  `prompt_file` string (today `typeof … === 'string'` accepts `""`, which would
  lift the prompt requirement on a step the backend calls incomplete).
- **ITEM-6**: Fix the kit addon: `inputGroupAddonVariants`' `inline-start` /
  `inline-end` variants lose their negative margins
  (`ml-[-0.3rem]`/`mr-[-0.3rem]`/`ml-[-0.15rem]`/`mr-[-0.15rem]`) in favour of
  grid-aligned logical-direction padding (`ps-*`/`pe-*`), so the addon's border
  box ends at the group's, and the RTL behaviour is correct as a side effect.
  Committed IN the `sdk` submodule (branch `sdk/agent-core-and-perf`).
- **ITEM-7**: Pin the kit fix with a permanent gallery Layer-A probe — a
  backend-free visual spec asserting NO `[data-slot="input-group"]` has
  horizontal scrollable overflow at 390px (and that the inline-end addon does not
  extend past its group's border box). This is what makes the defect
  non-recurring; the builder spec only tolerated it.
- **ITEM-8**: Return `MAX_TOLERATED_OVERFLOW_PX` to 1 in
  `src-app/ui/tests/e2e/workflows/builder-responsive.spec.ts` and rewrite its
  doc comment (it currently documents the defect as permanent), discharging
  INV-2's stated exit condition.

## Files to touch

- `src-app/server/src/modules/workflow/validate.rs` (ITEM-1, ITEM-2, ITEM-4 + in-source tests)
- `src-app/server/src/modules/workflow/dispatch.rs` (ITEM-3 + in-source tests)
- `src-app/server/tests/workflow/validate_and_dry_run.rs` (integration coverage)
- `src-app/ui/src/modules/workflow/components/builder/stepForms.ts` (ITEM-5)
- `src-app/ui/src/modules/workflow/components/builder/stepForms.test.ts` (ITEM-5 test)
- `sdk/packages/kit/src/shadcn/input-group.tsx` (ITEM-6, submodule)
- `src-app/ui/tests/e2e/visual/input-group-overflow.spec.ts` (ITEM-7, new)
- `src-app/ui/tests/e2e/workflows/builder-responsive.spec.ts` (ITEM-8)

## Patterns to follow

- **Shared pure rule + in-source unit tests** — mirror `validate.rs`'s own
  existing helpers (`check_prompt_files`, `check_security`): a free function in
  the module, `#[cfg(test)] mod tests` at the bottom of the same file. The
  workflow module already keeps its pure decidable logic in `validate.rs` and its
  runtime behaviour in `dispatch.rs`; the shared rule belongs on the `validate.rs`
  side because it is the definition-level vocabulary.
- **Integration test** — mirror `src-app/server/tests/workflow/validate_and_dry_run.rs`
  (its existing `rejects_prompt_and_prompt_file` case is the closest sibling; the
  new case is its empty-prompt twin).
- **Client validator** — mirror the existing `promptSuppliedByFile` /
  `promptField` pair in `stepForms.ts` and its node-test file `stepForms.test.ts`
  (the same file already carries the backend-mirroring comment block).
- **Kit component** — mirror the surrounding `cva` variant strings in
  `sdk/packages/kit/src/shadcn/input-group.tsx`; the design system's spacing
  rhythm (4px base, kit 2px half-steps) and its logical-direction rule
  (`ps`/`pe`, never `pl`/`pr`) are the constraints.
- **Gallery visual spec** — mirror `src-app/ui/tests/e2e/visual/layout.spec.ts` /
  `form-label-starvation.spec.ts`: `playwright.visual.config.ts`, `openGallery`
  from `_gallery.ts`, a page-evaluated geometry probe, no backend.

## UI-surface checklist

This branch adds **no new UI surface** — ITEM-5 changes one predicate in an
existing validator, ITEM-6 changes spacing inside an existing kit primitive, and
ITEM-7/8 are tests. The checklist items that still bind:

- **Precedent** — the kit addon's sibling is its own `inline-start` twin; both
  are changed identically so they cannot diverge.
- **Device size / responsive** — the defect IS the responsive one. ITEM-7 asserts
  it at 390px (the narrow viewport the residual names), and the measurement in
  `REPRO.md` records that the cause is width-independent, so the fix is verified
  at 390px and re-verified at 1280px.
- **Populated-render review** — the gallery combobox cases render populated
  (a selected value + the trigger button), which is the state that carries the
  addon; the probe runs against that render, not an empty one.
- **Input economy / progress / multi-instance / URL-as-view** — not applicable
  (no new surface, no new input, no new instance-scoped view).
