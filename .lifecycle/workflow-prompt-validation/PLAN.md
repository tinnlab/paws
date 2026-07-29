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
  Amended again after the phase-6 audit: the FILE half gets the same treatment —
  `read_prompt_file(bundle_root, rel) -> Result<String, PromptFileError>` (shape
  check, confinement, read, emptiness, in one place) is called by both
  `check_prompt_files` and `load_raw_prompt`, and `PromptFileError` carries the
  finding code/layer/message so the two sides cannot even disagree about how a
  rejection is REPORTED.
- **ITEM-2**: `validate.rs`'s prompt XOR check derives its verdict from
  `prompt_source` instead of its own `has_prompt`/`has_file` pair. The two
  emitted codes and their exact messages are unchanged (the branch's
  author-facing copy is keyed off them).
- **ITEM-3**: `dispatch.rs::load_raw_prompt` derives its arm from
  `prompt_source` instead of `match (prompt, prompt_file)`, so `Some("")` beside
  a `prompt_file:` reads the FILE and `Some("")` alone is an error rather than an
  empty LLM call. Its signature drops the whole `RunContext` for the one field it
  uses (`extracted_path`), making it directly unit-testable. Amended after the
  phase-6 audit: it also resolves the FILE through the shared
  `read_prompt_file` (below) rather than a bare `bundle_root.join(rel)` — the
  runner previously applied NO path-shape or confinement check of its own, so a
  `prompt_file:` the validator refused as `WORKFLOW_PROMPT_FILE_UNSAFE`/`ESCAPE`
  was read anyway. That is reachable without validation at all
  (`POST /workflows/{id}/test` dispatches without `validate_for_install`). Its two
  error arms are also distinguished, since the enum knows which it is.
- **ITEM-4**: `check_prompt_files` stops answering a question it gets wrong: an
  empty `prompt_file` is "absent" (so `WORKFLOW_PROMPT_MISSING` fires rather than
  a green verdict), and a `prompt_file` that cannot be USED is
  `WORKFLOW_PROMPT_FILE_MISSING`. Amended after the phase-6 audit: "cannot be
  used" is decided by actually READING the file through the shared
  `read_prompt_file`, not by an `is_file()` proxy — an existence/is-file check
  still said yes to a non-UTF-8 file (run: "stream did not contain valid UTF-8")
  and to a zero-byte file (run: a degenerate empty prompt to the model). Reading
  it is the same operation the runner performs, so no weaker proxy can drift from
  it. The code is reused, but its author-facing copy IS reworded (ITEM-13) — the
  old wording named a remedy that cannot fix three of the four cases.
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
- **ITEM-9**: Convert the group ROOT's input-clearance compensation to logical
  properties too (`pl-1.5`/`pr-1.5` -> `ps-1.5`/`pe-1.5`). Added after the phase-6
  audit measured a real RTL REGRESSION introduced by ITEM-6: the root keys that
  compensation off the LOGICAL `data-align` but applied it physically, and the
  addon's own physical padding had been accidentally masking it. Also add an
  exhaustive `StepConfig::prompt_fields()` accessor so the `(prompt, prompt_file)`
  pair is not re-extracted by hand at each site with a silent `_ => None`
  fallthrough — a new step kind carrying a prompt would otherwise be skipped by
  the validator and the runner alike.
- **ITEM-10**: Add a Rust->TypeScript drift guard for the prompt-source rule
  (`validate.rs` reads `stepForms.ts` at test time and fails the BACKEND suite if
  `promptSuppliedByFile` stops rejecting the empty string, or starts trimming).
  The same rule is now implemented in two languages and nothing else connects
  them; this module already ships exactly this mechanism for `validationCopy.ts`.
- **ITEM-11**: Wire TEST-7 into the gates that actually run. Add it to
  `gallery.config.json`'s `visualSpecs` (so `npm run gate:ui`, the repo's stated UI
  exit condition, executes it) and add `sdk` to `visual-tests.yml`'s path filter
  (a kit regression arrives as a submodule-pointer bump, which the `src-app/ui/**`
  filter does not match — the exact change class this branch is).
- **ITEM-12**: [DESCOPED] Fix the addon's VERTICAL containment (36px addon in a
  32px group). Pre-existing, orthogonal to the recorded residual, reported onward.
- **ITEM-14**: [DESCOPED] Validate template references inside a `prompt_file:`
  BODY (an inline `prompt:` is scanned; a prompt file's contents are not, so an
  unresolvable `{{ ref }}` in a file validates green and fails at render).
- **ITEM-15**: [DESCOPED] The kit's remaining RTL debts — `combobox.tsx`'s
  physical slide directions keyed off a logical `data-[side=inline-*]`, its item
  gutter, and the fact that `lint:logical-direction` diffs the parent repo and so
  cannot see submodule files at all.
- **ITEM-16**: Round-2 hardening of the shared file rule: stat-before-open
  (regular files only), a `MAX_PROMPT_FILE_BYTES` cap, a bounded read, `O_NOFOLLOW`
  on the final open, and a platform-independent shape check (`..`, leading `/`,
  any backslash, a `X:` drive prefix). Round 1 made the validator READ the file,
  which was right, but an unbounded blocking read of a path the sandbox can write
  is a denial-of-service: `open(2)` on a FIFO never returns, and the validator runs
  on every launch.
- **ITEM-17**: Round-2 guard repairs: emit findings through a `match` with LITERAL
  layer/code arguments (computed ones are invisible to the crate's code-drift
  guard, which round 1 broke); rebase the prompt-code coverage guard onto
  `VALIDATION_CODES` instead of a self-referential source scan; give TEST-7's RTL
  legs a subject only an RTL render can falsify (the control's clearance side);
  add `submodules: recursive` to the visual CI job, without which its new `sdk`
  trigger fires a job that cannot install; and make `command.tsx`'s addon override
  logical.
- **ITEM-18**: Restrict `resolve_conversation_workspace_dir`'s `dir` to a SINGLE
  path component, and convert the last blocking workspace validator. Added after
  round 6 demonstrated (with a C repro against the real syscalls) that a
  multi-component `dir` puts an INTERMEDIATE directory of the returned bundle
  root under the model's control — and the anchor guard in `read_prompt_file` can
  only refuse a swapped FINAL component. The two rules are one mechanism.
- **ITEM-13**: Reword `WORKFLOW_PROMPT_FILE_MISSING`'s author-facing copy in
  `validationCopy.ts` to cover every way a prompt file cannot be read (missing,
  a folder, empty, not text). The old copy — "isn't in the workflow — add the
  file" — is a remedy the author cannot act on for three of those four cases.

## Files to touch

- `src-app/server/src/modules/workflow/validate.rs` (ITEM-1, ITEM-2, ITEM-4 + in-source tests)
- `src-app/server/src/modules/workflow/dispatch.rs` (ITEM-3 + in-source tests)
- `src-app/server/tests/workflow/validate_and_dry_run.rs` (integration coverage)
- `src-app/ui/src/modules/workflow/components/builder/stepForms.ts` (ITEM-5)
- `src-app/ui/src/modules/workflow/components/builder/stepForms.test.ts` (ITEM-5 test)
- `sdk/packages/kit/src/shadcn/input-group.tsx` (ITEM-6 + ITEM-9, submodule)
- `src-app/ui/src/modules/workflow/components/builder/validationCopy.ts` (ITEM-13)
- `src-app/ui/gallery.config.json`, `.github/workflows/visual-tests.yml` (ITEM-11)
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
