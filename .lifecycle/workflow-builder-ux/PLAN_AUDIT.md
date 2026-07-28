# PLAN_AUDIT — workflow-builder-ux

Audited against the real tree at `origin/feat/agent-core` @ `d53db2d11`.

## Breakage risk

**Existing selectors.** `wf-builder-tool-name` is asserted by
`src-app/ui/tests/e2e/workflows/builder-step-kinds.spec.ts:72,82,84`. ITEM-5
changes that control from an `Input` to a `Combobox`. `.fill()` on a Combobox
field still works (Base UI Combobox's field IS an `<input>`), but the assertion
"a free-text tool name is typed from memory" is exactly the defect this branch
removes, so that spec is UPDATED, not accommodated. `wf-builder-tool-server`,
`wf-builder-tool-arg-*`, `wf-builder-errors`, `wf-builder-warnings`,
`wf-builder-valid` are preserved.

**Existing workflows must not lose data.** A saved workflow's `arguments` object
may contain keys the chosen tool's schema does not declare (a schema change
upstream, a hand-authored YAML). ITEM-9's "Additional arguments" section is the
mitigation: any key not in the schema is still rendered and still round-trips.
Without it, ITEM-7 would silently drop arguments on the first edit — the highest
breakage risk in this plan, and the reason ITEM-9 is not optional polish.

**Round-trip typing.** `ToolStepForm`'s current `toText`/`parseValue`/`baseText`
machinery exists to stop an untouched string argument (`"1234"`) being coerced to
a number. A schema-driven field knows its declared type, so it does not need that
heuristic — but the **fallback** key/value section still does. The existing
machinery must be preserved verbatim for the fallback rows, not deleted.

**`validate.rs` const.** `pub const VALIDATION_CODES` is additive; no existing
call site changes. The `#[cfg(test)]` guard test `include_str!`s a frontend file
at a path relative to `validate.rs`
(`../../../../ui/src/modules/workflow/components/builder/validationCopy.ts`).
Risk: the server crate can no longer compile its TESTS in a tree without the ui
workspace. Accepted — this repo always ships both, and it is the same coupling
`openapi::emit_ts::tests::types_ts_parity` already has (it reads
`ui/openapi/openapi.json` + `ui/src/api-client/types.ts`). Verified that test
exists and does exactly this before adopting the pattern.

**Scale bug INHERITED, not introduced.** `McpServer.servers` is a PAGINATED slice
(`state.ts:8-10`, `pageSize: 10`); `capabilities.tsx::useCapabilityOptions` maps
only the loaded page. So a workflow referencing the 11th server already fails to
resolve its name in the Server picker today. ITEM-6's name→id resolution inherits
this: an unresolvable name ⇒ the ITEM-9 fallback with a stated reason, which is
strictly better than today's silent empty select. Recorded as a finding, NOT
fixed here (fixing pagination on the capability picker is a separate change that
would touch the mcp module).

## Pattern conformance

| Item | Reference module | Conforms? |
|---|---|---|
| ITEM-1 pure copy map | `components/builder/stepForms.ts` (pure, exported, unit-tested) | yes |
| ITEM-2 cross-file guard | `openapi/emit_ts.rs::tests::types_ts_parity` | yes |
| ITEM-3 clickable finding | `StepList.tsx:63` (`onClick={() => store.selectStep(...)}`) | yes |
| ITEM-5 tool picker | `capabilities.tsx::CapabilitySelect` (sibling picker, same form) | yes — `Combobox` instead of `Select` because the list is unbounded + searchable; `Combobox` derives the same `${testid}-opt-${value}` option testids (`kit/combobox.tsx:48`) |
| ITEM-6 local store | `stores/WorkflowBuilder.store.ts` (`defineLocalStore`, prop-threaded) | yes |
| ITEM-7 schema→controls | `components/workflowElicitSchema.ts` + `WorkflowElicitForm.tsx` | yes — reuses `FieldSchema` + its select/multiselect predicates; no new JSON-Schema vocabulary, no new dep |
| ITEM-8 templating | `builderFields.tsx::PromptField` (RefInsertMenu on the label row) | yes |
| ITEM-10 field composition | `builderFields.tsx::LabeledControl` | yes |
| e2e | `builder-step-kinds.spec.ts` (no mocking, seed a real MCP server via REST) + `mcp/helpers/external-mcp-mock-server.ts` (serves a real `tools/list` with an `inputSchema`) | yes |

**Kit `Field` availability — corrected finding.** `agent-kit/docs/DESIGN_SYSTEM.md`
says to compose `Field`/`FieldLabel`/`FieldDescription`/`FieldError`. Those
primitives are **not exported from `@ziee/kit`** — they are internal to
`kit/form.tsx` (`sdk/packages/kit/src/kit/form.tsx:18`), reachable only via
`Form` + `FormField`, which require react-hook-form and a submit-once model. The
builder edits live store state on every keystroke, which is why it has its own
shared field primitive `LabeledControl` (`builderFields.tsx:12-17` documents
exactly this). `LabeledControl` already provides label association (via a
generated id cloned onto the child), required marker, description, error, and an
action slot — i.e. it IS the page's `Field`. **The page is therefore NOT
hand-rolling per-field flex-gap**, and the DESIGN_SYSTEM rule is satisfied in
substance. ITEM-10 records the unification question rather than forcing an
RHF migration this branch does not need. This is the same class of question the
sibling scheduler-layout branch is working; coordination is by NOT touching
`modules/scheduler/**` or the kit.

## Migration collisions

None. This feature adds **no** migration. Workflow migrations are module-local
(`src-app/server/src/modules/workflow/migrations/`, highest
`202607191200_background_run_notes.sql`).

## OpenAPI regen

**Not required.** The single backend edit is a `const` + a `#[cfg(test)]` test.
No `JsonSchema` type, no handler, no route changes ⇒ `openapi.json` and
`api-client/types.ts` are byte-identical in BOTH workspaces. Re-verified at
Phase 8 by running `just openapi-regen` and confirming a clean `git diff`.

The endpoints ITEM-5/6 consume already exist and are already generated:
`GET /api/mcp/servers/{id}/tools` → `ApiClient.McpServerRuntime.listTools`
(`apiEndpoints.ts:248`), response `ListToolsResponse { tools: Tool[] }`
(`types.ts:3082`), `Tool { name; description?; input_schema: unknown }`
(`types.ts:6542`). Handler `list_server_tools`
(`server/src/modules/mcp/handlers/runtime.rs:70`) gates on `McpServersRead` +
`can_user_access_server`. **No new endpoint is needed** — the brief's
"check what endpoint already exposes a server's tools before adding one" resolves
to: it already exists and is already in the client.

`Tool.input_schema` is typed `unknown` in TS (the Rust side is
`serde_json::Value`). ITEM-7 must therefore narrow it defensively at runtime
(a malformed schema ⇒ the ITEM-9 fallback, never a crash). Called out because a
`JSON.parse`-shaped assumption here is the likeliest source of a
`page-error` HIGH in `gate:ui`.

## Desktop parity (R2-3)

`src-app/desktop/ui/src/modules/` has **no** `workflow` directory; the desktop
vite config resolves `@/` through `localOverridePlugin` with a fallback to
`../../ui/src` (`desktop/ui/vite.config.ts:35-39`). So desktop consumes these
exact files and needs **no mirrored edit** — but it does compile them, so
`npm run check` is run in `desktop/ui` as well and recorded.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — pure module in the established `stepForms.ts`
  idiom; the backend is untouched, so no wire/type risk. The per-kind branch
  (`WORKFLOW_PROMPT_MISSING` reads differently on `agent` vs `llm`) is only
  expressible in the UI, which independently confirms the humanisation boundary.
- **ITEM-2** — verdict: CONCERN — the `include_str!` cross-workspace guard is the
  right mechanism (it is what makes INV-1 non-regressable) but it couples the
  server crate's TEST build to the ui workspace's source tree. Mitigation:
  `#[cfg(test)]`-only, precedent-matched to `types_ts_parity`, and the failure
  message must name the exact file + the exact code to add. Accepted with that
  requirement.
- **ITEM-3** — verdict: PASS — additive render change inside
  `BuilderValidationPanel`; existing `wf-builder-errors`/`-warnings` testids and
  the `ul`/`li` structure are preserved so no existing selector breaks.
- **ITEM-4** — verdict: PASS — derived from `store.validation`, no new state, no
  new fetch. Must use the `.$` snapshot discipline if read inside `steps.map()`
  (Rules-of-Hooks): the mapping is over `store.def.steps` inside a `.map()`, so
  the findings index must be computed ONCE above the map, never read per row.
  Called out as a phase-6 `reactive-read-in-loop` checkpoint.
- **ITEM-5** — verdict: PASS — endpoint, client method, permission and testid
  idiom all pre-exist and were verified.
- **ITEM-6** — verdict: CONCERN — name→id resolution rides the PAGINATED
  `McpServer.servers` slice (see Breakage risk). Accepted because the failure mode
  is the ITEM-9 visible fallback, strictly better than today. Must not silently
  render an empty tool list when the name is unresolvable.
- **ITEM-7** — verdict: CONCERN — `Tool.input_schema` is `unknown`; a defensive
  narrow is mandatory, and `MAX_GENERATED_FIELDS` must be a named constant with a
  rationale (§ maintainability), not an inline literal.
- **ITEM-8** — verdict: CONCERN — "a typed control must accept a `{{ ref }}`" is
  the subtlest requirement here: an `InputNumber` cannot hold `{{ inputs.n }}`.
  The plan's answer (switch that field to a template-text input and say why) must
  be reversible — the user must be able to get back to the typed control. Resolve
  the exact affordance in DECISIONS before implementing.
- **ITEM-9** — verdict: PASS — preserves the existing `toText`/`parseValue`
  round-trip machinery for the fallback rows rather than deleting it.
- **ITEM-10** — verdict: PASS — audit-and-record scope, explicitly bounded away
  from `modules/scheduler/**` and the kit.
- **ITEM-11** — verdict: PASS — the fabricated gallery fixture is confirmed:
  `gallery.tsx:299-317` uses codes `unresolved_reference` / `long_prompt` and
  layer `graph`, none of which exist in the backend (whose codes are all
  `WORKFLOW_*` with layers `schema|semantic|security`). Replacing it is a
  correctness fix to the review surface itself.
- **ITEM-12** — verdict: PASS (descoped) — confirmed absent from the rig's route
  list (`agent-kit/skills/live-ui-audit/live-ui-audit.mjs` has
  `/settings/workflows` at :476 and `/settings/workflows-admin` at :722, and zero
  matches for `builder`). Descoped per DEC-9 with an approved disposition.
