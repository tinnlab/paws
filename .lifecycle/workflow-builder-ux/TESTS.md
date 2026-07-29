# TESTS — workflow-builder-ux

Tiers mirror the repo's existing pattern: Rust in-source `#[cfg(test)]`,
frontend vitest next to the module, Playwright under
`src-app/ui/tests/e2e/workflows/`.

Every `INV-N` is pinned by an `[acceptance]` test that asserts the DESIGN's
promise, not the implementation's behavior.

## Acceptance tests (design-invariant proofs)

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: EVERY code literal passed to `ValidationError::{err,at,warn}` anywhere in `validate.rs` + `ref_check.rs` is registered in `VALIDATION_CODES` **and** has an entry in the UI's `validationCopy.ts` (read via `include_str!`). This fails on a backend code the UI cannot say in human language — i.e. it would go RED if someone added a new raw-schema-language finding, which is exactly the invariant. It does NOT merely assert that the one message we fixed is fixed.
- **TEST-2** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-3, ITEM-4] file: `src-app/ui/tests/e2e/workflows/builder-validation-attribution.spec.ts` — asserts: with TWO steps invalid for DIFFERENT reasons and a THIRD (unrelated) step selected, the Validation section names each broken step, the step list marks exactly those two rows invalid (and not the third), and clicking a finding selects ITS step in the config panel. The two-invalid-steps + wrong-step-selected setup is the owner's exact situation; a single-error fixture would pass even if attribution were hardcoded.
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-5] file: `src-app/ui/src/modules/workflow/components/builder/noFreeTextEntityRef.test.ts` — asserts: no builder step form binds a FREE-TEXT control (`Input`/`Textarea`) to a field whose values the system can enumerate (`server`, `tool`, `model`, `assistant`, `model_id`, `assistant_id`). Source-scanning across ALL `*StepForm.tsx`, so a future step form that adds a free-text enumerable field fails — the general rule, not "the Tool field is a select".
- **TEST-4** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-5, ITEM-6] file: `src-app/ui/tests/e2e/workflows/builder-tool-picker.spec.ts` — asserts: against a REAL MCP server serving three DISTINCT tools, the Tool control offers exactly those three real tool names as options (and does NOT accept an arbitrary typed name as a valid selection). Asserting the options equal the SERVER's tools proves enumeration, where asserting "it is a combobox" would not.
- **TEST-5** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-7] file: `src-app/ui/tests/e2e/workflows/builder-tool-picker.spec.ts` — asserts: after choosing a tool whose schema declares a required string, an optional integer with a default, a boolean, and an enum, the Arguments section renders one labelled control PER declared property with the declared requiredness/description/default — and renders NO free "argument name" key input for those properties. Driven from the server's real declared schema, so it fails if the form is generated from anything other than the tool's schema.
- **TEST-6** (tier: e2e) [acceptance] [invariant: INV-5] [covers: ITEM-8] file: `src-app/ui/tests/e2e/workflows/builder-tool-picker.spec.ts` — asserts: a `{{ inputs.query }}` reference entered into a NON-string typed field (the integer property) is accepted, saved, reloaded, and still present — the hard case the design's sentence implies. A string-field-only test would pass trivially.
- **TEST-7** (tier: e2e) [acceptance] [invariant: INV-6] [covers: ITEM-9] file: `src-app/ui/tests/e2e/workflows/builder-tool-picker.spec.ts` — asserts: with a server that CANNOT be reached, the tool field falls back to free text AND a visible reason naming the server is shown (not an empty picker), and a pre-existing argument key absent from any schema survives an edit→save→reload round-trip. Proves the fallback is visible + lossless, which is what §2.5 promises.

## Unit tests

- **TEST-8** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/workflow/components/builder/validationCopy.test.ts` — asserts: `humaniseFinding` renders `WORKFLOW_PROMPT_MISSING` differently for an `agent` step vs an `llm` step; contains no `prompt:` / `prompt_file:` / `:`-suffixed YAML key in any mapped copy; and falls back to the raw backend `message` for an unknown code rather than returning empty.
- **TEST-9** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/modules/workflow/components/builder/validationCopy.test.ts` — asserts: `resolveFindingStep` maps a bare step-id location (`agent_1`), a field-path location (`agent_1.prompt`), an `outputs[x].from` location, and a null location to the right step (or to the whole-workflow group), against a real multi-step def.
- **TEST-10** (tier: unit) [covers: ITEM-4] file: `src-app/ui/src/modules/workflow/components/builder/validationCopy.test.ts` — asserts: `indexFindingsByStep` counts errors and warnings per step id and leaves un-attributable findings in the workflow-level bucket, with no step double-counted.
- **TEST-11** (tier: unit) [covers: ITEM-7] file: `src-app/ui/src/modules/workflow/components/builder/toolSchemaForm.test.ts` — asserts: `describeToolSchema` turns a JSON Schema into an ordered field list carrying name/label/type/required/description/default, mapping string→text, integer|number→number, boolean→switch, enum→select, array|object→json; required properties sort first.
- **TEST-12** (tier: unit) [covers: ITEM-7, ITEM-9] file: `src-app/ui/src/modules/workflow/components/builder/toolSchemaForm.test.ts` — asserts: a missing / non-object / malformed `input_schema`, and a schema with zero properties, each return `null` (⇒ the caller renders the fallback) instead of throwing — the defensive narrow the `unknown` wire type requires.
- **TEST-13** (tier: unit) [covers: ITEM-7, ITEM-9] file: `src-app/ui/src/modules/workflow/components/builder/toolSchemaForm.test.ts` — asserts: `splitArguments` partitions a saved `arguments` object into schema-declared values and EXTRA keys, preserving both; and a schema declaring more than `MAX_GENERATED_FIELDS` properties spills the remainder into the extras bucket rather than rendering unbounded fields.
- **TEST-14** (tier: unit) [covers: ITEM-8] file: `src-app/ui/src/modules/workflow/components/builder/toolSchemaForm.test.ts` — asserts: `isTemplateValue` recognises `{{ … }}` in a value of any declared type, so a typed field defers to the template input; and a non-template value of a typed field is coerced to its declared type on commit.
- **TEST-15** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: `VALIDATION_CODES` contains no duplicate entry and every entry is `SCREAMING_SNAKE` — the registry itself is well-formed, so TEST-1's set comparison is meaningful.
- **TEST-16** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/workflow/stores/ToolCatalog.store.test.ts` — asserts: the catalog resolves a server NAME to its id from the accessible-server list, fetches once per server id (a second request for the same id is served from cache), records an error (not an empty list) when the fetch rejects, and returns an explicit "unknown server" state for a name absent from the list.

## Integration tests

- **TEST-17** (tier: integration) [covers: ITEM-5, ITEM-6] file: `src-app/server/tests/mcp/list_tools_for_builder_test.rs` — asserts: `GET /api/mcp/servers/{id}/tools` returns each tool's `name`, `description` and a non-null `input_schema` for a user-owned server (the exact payload the picker + generated form depend on), 403s for a user without `mcp_servers::read`, and 403s for a user with the permission but NO access to that server. Locks the contract the frontend now relies on.

## E2E tests

- **TEST-18** (tier: e2e) [covers: ITEM-1, ITEM-3] file: `src-app/ui/tests/e2e/workflows/builder-validation-attribution.spec.ts` — asserts: an `agent` step with an empty prompt shows a human sentence in the Validation section and the page contains NO occurrence of `prompt_file` or `prompt:` anywhere in its rendered text. This is the owner's literal screenshot, red-then-green.
- **TEST-19** (tier: e2e) [covers: ITEM-5, ITEM-7, ITEM-9] file: `src-app/ui/tests/e2e/workflows/builder-step-kinds.spec.ts` — asserts: (UPDATED spec) the tool step's typed form now offers a server picker AND a tool PICKER (no free-text tool name), the inline required-field errors still appear on a fresh step and clear once both are chosen, and a valid config still saves. Replaces the spec's current assertion that a free-text tool `Input` is the correct design.
- **TEST-20** (tier: e2e) [covers: ITEM-10] file: `src-app/ui/tests/e2e/workflows/builder-responsive.spec.ts` — asserts: at 390px, 768px and 1280px the builder page has no horizontal overflow (`scrollWidth <= clientWidth`), the Validation findings remain readable (not clipped), and the tool step's generated fields stack in one column at 390px. The owner reported this visually; this is the machine-checkable part.
- **TEST-21** (tier: e2e) [covers: ITEM-11] file: `src-app/ui/tests/e2e/workflows/builder-validation-attribution.spec.ts` — asserts: the humanised copy the REAL backend path produces for a live invalid workflow matches what the gallery fixture claims — i.e. the gallery's validation fixture uses real codes. Guards against the fixture drifting back into fabricated prose that a design review would then bless.

## Gallery / gate coverage

- **TEST-22** (tier: unit) [covers: ITEM-11] file: `src-app/ui/src/dev/gallery/coverage.ts` — asserts: (verified via `npm run check:gallery-coverage` + `check:state-matrix` in Phase 8) `ToolStepForm`'s coverage entry resolves to a gallery surface that actually RENDERS it, with both the schema-driven and the fallback state present. The current entry claims `via` the populated builder, which contains no tool step — the claim is false and the gate does not check it, so this test is the correction plus its guard.

## Item → test map (completeness check)

| ITEM | Covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-8, TEST-18 |
| ITEM-2 | TEST-1, TEST-15 |
| ITEM-3 | TEST-2, TEST-9, TEST-18 |
| ITEM-4 | TEST-2, TEST-10 |
| ITEM-5 | TEST-3, TEST-4, TEST-17, TEST-19 |
| ITEM-6 | TEST-4, TEST-16, TEST-17 |
| ITEM-7 | TEST-5, TEST-11, TEST-12, TEST-13, TEST-19 |
| ITEM-8 | TEST-6, TEST-14 |
| ITEM-9 | TEST-7, TEST-12, TEST-13, TEST-19 |
| ITEM-10 | TEST-20 |
| ITEM-11 | TEST-21, TEST-22 |
| ITEM-12 | [DESCOPED] — DECISIONS DEC-9 |

## Permissions

This feature introduces **no new permission**. It consumes the existing
`mcp_servers::read` (already held by the Users group) via an endpoint that
already exists, and the existing `workflows::{read,install,manage}` gates on the
builder page are unchanged. No `[negative-perm]` e2e is therefore required by
A10 — but `builder-restricted.spec.ts` (the existing restricted-user builder
spec) is re-run in Phase 8 to prove the change did not open a surface.
