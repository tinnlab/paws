# PLAN — workflow-builder-ux

## Design source

Realizes `.lifecycle/workflow-builder-ux/DESIGN.md` §1 (JTBD), §2.1 (human
language), §2.2 (finding→step attribution), §2.3 (entity references are pickers),
§2.4 (schema-generated arguments), §2.5 (explicit degradation), §2.6 (templating
survives), and §3 (out of scope).

Secondary governing docs (REQUIRED reading for any implementer of a UI item):
`agent-kit/docs/DESIGN_SYSTEM.md`, and the feature-lifecycle skill's
**UI-surface plan checklist** (Input economy / Precedent / Populated-render
review / Responsive).

Companion artifact (the owner's second, equally-weighted deliverable):
`.lifecycle/workflow-builder-ux/TEST_GAP_ANALYSIS.md` — why nothing caught this.

## Invariants

- **INV-1**: "No raw schema/YAML key language ever reaches the person building a
  workflow." (DESIGN §2.1)
- **INV-2**: "Every validation finding names its step and can take the user to
  that step, and the step list shows which steps are invalid without the user
  clicking each one." (DESIGN §2.2)
- **INV-3**: "An entity reference the system can enumerate is never a free-text
  field." (DESIGN §2.3)
- **INV-4**: "Once a tool is chosen, its arguments are collected through a form
  generated from that schema — one typed field per property, carrying
  required/optional, type, default and description — never invented key/value
  strings." (DESIGN §2.4)
- **INV-5**: "Templating keeps working in every generated field — a typed field
  must accept a reference where it would accept a literal." (DESIGN §2.6)
- **INV-6**: "The fallback (free text / key-value rows) is a documented, visible
  escape hatch with a stated reason, never the default and never silent."
  (DESIGN §2.5)

## Items

- **ITEM-1**: Humanise validation findings at the presentation boundary. A new
  pure module `validationCopy.ts` maps `ValidationError.code` (+ the referenced
  step's kind and label) to person-facing copy. `WORKFLOW_PROMPT_MISSING` on an
  `agent` step becomes "This step needs a task description — say what the
  assistant should do."; on `llm`/`llm_map` it becomes "This step needs a
  prompt." Unmapped code ⇒ fall back to the backend `message` verbatim (never
  blank). Backend messages/codes/severities are UNCHANGED.
- **ITEM-2**: Make an unmapped code a build-time defect. Add
  `#[cfg(test)] const VALIDATION_CODES: &[&str]` to `validate.rs` as the single
  registry (test-only visibility — it has no production consumer, so `pub` would
  merely suppress the dead_code lint; see FIX_ROUND-1 finding C5),
  plus a Rust test that (a) every `ValidationError::{err,at,warn}` code literal in
  `validate.rs` + `ref_check.rs` is registered, and (b) every registered code has
  human copy in the UI's `validationCopy.ts` (cross-file `include_str!` guard,
  same class as the `types_ts_parity` golden test). A new backend code therefore
  fails `cargo test` until the UI can say it in human language.
- **ITEM-3**: Attribute every finding to its step in `BuilderValidationPanel`.
  Each finding renders as a `button` reading "Step {n} · {step label}" + the
  humanised sentence, and clicking it calls `store.selectStep(stepId)`. A finding
  whose `location` is a field path (`agent_1.prompt`) resolves to its step;
  a finding with no location renders under a "Whole workflow" group.
- **ITEM-4**: Surface per-step invalid state in `StepList` — a step row with ≥1
  error finding shows a destructive indicator with the finding count and an
  accessible name ("2 problems"), and warnings show a warning indicator. Derived
  purely from `store.validation`; no new state.
- **ITEM-5**: Replace the free-text Tool `Input` in `ToolStepForm` with a
  searchable `Combobox` populated from the selected server's real tools
  (`GET /api/mcp/servers/{id}/tools` → `ApiClient.McpServerRuntime.listTools`).
  Each option shows the tool name + its description. Disabled with "Pick a server
  first" until a server is chosen.
- **ITEM-6**: A per-instance `ToolCatalog` local store that resolves a server NAME
  (what the step stores) to its id via `McpServer.servers`, fetches + caches the
  tool list per server id for the session, and exposes `{tools, loading, error}`.
  Cache is keyed by server id so switching back and forth costs one fetch.
- **ITEM-7**: Generate the Arguments editor from the chosen tool's
  `input_schema`: one typed control per property (string→Input, number/integer→
  InputNumber, boolean→Switch, enum→Select, array/object→Textarea carrying JSON),
  each labelled with the property title/name, marked required, showing its
  `description` as help text and its `default` as the placeholder. Reuses the
  existing `workflowElicitSchema.ts` `FieldSchema` typing (the app's established
  JSON-Schema→control vocabulary) rather than inventing a second one.
- **ITEM-8**: Templating in generated fields (INV-5): every generated field gets a
  `RefInsertMenu` action and accepts a `{{ … }}` string; a non-string typed field
  (number/boolean/enum) that holds a template switches to a template-text input
  and shows why, so a reference is never rejected by a typed control.
- **ITEM-9**: The documented escape hatch (INV-6): when the server is unreachable,
  unknown, or the tool declares no properties, the form falls back to the previous
  free-text/key-value editor **with a visible reason** ("Couldn't reach {server} —
  enter the tool name and arguments by hand."). Extra arguments not in the schema
  are preserved and shown in an "Additional arguments" key/value section, so no
  existing workflow loses data on load.
- **ITEM-10**: Design-system conformance pass on the builder surface: audit for
  hardcoded colors, physical direction properties, off-grid spacing, and
  title-with-actions rows that should be `SectionHeader`; fix what this page owns.
  Record (do not fix) the shared `LabeledControl`-vs-kit-`Field` question, which
  is the same class the sibling scheduler-layout branch is addressing.
- **ITEM-11**: Fix the gallery's lying fixtures — the workflow gallery's
  `errorValidation` fixture uses INVENTED codes (`unresolved_reference`) and
  ALREADY-HUMANISED prose the backend never produces, so a design-critic pass over
  it reviewed a message that does not exist. Replace it with REAL backend codes +
  REAL backend messages, and add a `tool` step to `builderFourStepDef` plus a
  dedicated tool-step gallery surface (schema-driven state AND fallback state) so
  `ToolStepForm` is actually rendered by the surface that claims to cover it.
- **ITEM-12**: [DESCOPED] Add `/settings/workflows/builder` +
  `/settings/workflows/:id/edit` to the 24/7 live-UI-audit rig's route list.

## Files to touch

Frontend (`src-app/ui/src/`):
- `modules/workflow/components/builder/validationCopy.ts` (NEW)
- `modules/workflow/components/builder/validationCopy.test.ts` (NEW)
- `modules/workflow/components/builder/BuilderValidationPanel.tsx`
- `modules/workflow/components/builder/StepList.tsx`
- `modules/workflow/components/builder/ToolStepForm.tsx`
- `modules/workflow/components/builder/toolSchemaForm.ts` (NEW — pure)
- `modules/workflow/components/builder/toolSchemaForm.test.ts` (NEW)
- `modules/workflow/components/builder/ToolArgumentsForm.tsx` (NEW)
- `modules/workflow/components/builder/noFreeTextEntityRef.test.ts` (NEW — the
  INV-3 class test)
- `modules/workflow/stores/ToolCatalog.store.ts` (NEW)
- `modules/workflow/gallery.tsx`
- `dev/gallery/coverage.ts` (only if a new surface needs an entry)

Backend (`src-app/server/src/`):
- `modules/workflow/validate.rs` (registry const + guard test ONLY — no message,
  code, or severity change)

E2E (`src-app/ui/tests/e2e/workflows/`):
- `builder-tool-picker.spec.ts` (NEW)
- `builder-validation-attribution.spec.ts` (NEW)
- `builder-step-kinds.spec.ts` (UPDATE — it currently asserts the defect)

Desktop: `src-app/desktop/ui/` mirrors the workflow module; the same edits are
applied there per R2-3 if the files exist as hand-written copies (verified in
Phase 2).

## Patterns to follow

- **Tool picker (ITEM-5)** — mirror `capabilities.tsx::CapabilitySelect`
  (the sibling picker on the SAME form): options derived with `useMemo`, a
  `data-testid` whose options derive `${testid}-opt-${value}`, an explicit
  no-options placeholder. Use `Combobox` (not `Select`) because a server's tool
  list is unbounded and searchable — `Combobox` is the kit's searchable
  single-select and windows large lists itself.
- **Per-instance store (ITEM-6)** — mirror `WorkflowBuilder.store.ts`:
  `defineLocalStore` (an authoring session is not a shared singleton), threaded to
  children as a prop, `hasPermissionNow(...)` self-gating before any fetch.
- **Schema→control vocabulary (ITEM-7)** — mirror
  `components/workflowElicitSchema.ts` + `WorkflowElicitForm.tsx`, the app's
  existing JSON-Schema-driven form. Reuse its `FieldSchema` type and its
  select/multi-select/table field predicates; do NOT introduce a second
  JSON-Schema vocabulary or a new npm dep.
- **Field composition (ITEM-7/8)** — `LabeledControl` from `builderFields.tsx`
  (the builder's shared field primitive; it already does label association,
  description, error and a right-aligned action slot). Do not hand-roll
  `flex flex-col gap-*` label+control.
- **Findings list (ITEM-3)** — the panel keeps its `ul`/`li` structure and its
  `wf-builder-errors` / `wf-builder-warnings` testids so existing selectors stay
  valid; the `li` gains a `button` child, mirroring `StepList`'s clickable-row
  idiom (`store.selectStep`).
- **Cross-file parity test (ITEM-2)** — mirror
  `openapi::emit_ts::tests::types_ts_parity`: a Rust `#[cfg(test)]` test that
  reads a committed frontend file and asserts a contract, so a backend change that
  is not reflected in the frontend fails the backend suite.
- **e2e (ITEM-5/7)** — mirror `builder-step-kinds.spec.ts`: no API mocking, seed a
  real MCP server via the REST API, drive the real builder. The tool-picker spec
  additionally needs a server that actually SERVES tools — use the same
  `MockMcpServer`-style loopback fixture the mcp e2e specs use (confirmed in
  Phase 2).

## UI-surface plan checklist

- **Precedent** — the tool picker's twin is `CapabilitySelect` on the same form;
  the generated arguments form's twin is `WorkflowElicitForm` (the app's other
  JSON-Schema-driven form). The findings list's twin is `StepList`'s clickable
  rows. No new visual idiom is introduced.
- **Scale / cardinality** — a server's tool list is unbounded (biomcp = 1,
  a large external server can be 50+). `Combobox` windows the list and filters in
  place, so there is no fetch-all/render-all risk. The tool catalog fetches ONE
  server at a time (the selected one), never all servers. A tool's schema
  properties are bounded by the tool author; the generated form caps at
  `MAX_GENERATED_FIELDS` (24) and spills the remainder into the key/value section
  with a "Showing N of M" note, so a pathological schema cannot render 500 inputs.
- **Device size / responsive** — the step editor already lives in the detail
  column that stacks under the step list below `md`. Generated fields are a single
  column at every width (they inherit `LabeledControl`'s stacked layout), so
  nothing new reflows. The findings buttons wrap (`text-start`, no fixed width) so
  a long step label does not force horizontal scroll at 390px. Verified at
  390/768/1280.
- **Populated-render review** — ITEM-11 exists precisely for this: the gallery's
  populated builder currently has NO tool step, so the tool form has never been
  reviewed with data. The new gallery surfaces render the tool form with a real
  multi-property schema AND in its fallback state.
- **User-visible progress** — the tool picker shows `loading` while the server's
  tools are being fetched (an MCP `tools/list` can take seconds on a cold stdio
  server) and an explicit error with the reason if it fails, never a silent empty
  list.
- **Input economy** — this is the whole point: server → picker (already), tool →
  picker (ITEM-5), arguments → schema-generated typed fields (ITEM-7). Nothing the
  system can enumerate is typed by hand.
- **JTBD design** — DESIGN.md §1 states it; §2.1–§2.6 are the promises it implies.
- **Multi-instance / workspace** — not applicable: the builder is a single routed
  page. The tool catalog is a LOCAL store, so two builder mounts never share it.
- **URL-as-view-into-focus** — not applicable; the selected step is not in the URL
  today and this change does not add it.
- **Platform-provided affordances** — none added.

## Non-goals restated

No backend validation message/code/severity changes (INV-1 is satisfied at the
presentation boundary by design). No new npm dependency. No new migration. No
`openapi.json` change (`VALIDATION_CODES` is a Rust const, not a schema type).
