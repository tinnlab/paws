# DECISIONS — workflow-builder-ux

Every human/product input the implementation needs, resolved up front.

---

### DEC-1: Where does the humanisation of validator findings live — backend or UI?
**Resolution:** UI. The backend keeps its exact codes, messages, layers and
severities. A new pure `validationCopy.ts` maps `code` (+ the referenced step's
KIND) to person-facing copy; an unmapped code falls back to the backend message.
**Basis:** codebase — three independent reasons, each verified. (1) The backend
message is consumed by non-human callers too: `validate_for_install`
(`validate.rs:443`) flattens it into an `AppError` for the install/import/run
paths, and `workflow_mcp/tools.rs:672` serializes it for the MODEL. Humanising it
at the source would degrade both. (2) `WORKFLOW_PROMPT_MISSING` fires for `llm`,
`llm_map` AND `agent` (`validate.rs:595-603`) but the right sentence differs per
kind ("task description" vs "prompt") — the kind is only known where the def is,
i.e. the UI. (3) `ValidationError` ALREADY carries a stable machine-readable
`code` (`validate.rs:355`), so no backend change is needed to key the map.

### DEC-2: Codes are free-form `&'static str` with no registry. Add an enum?
**Resolution:** No enum; add `pub const VALIDATION_CODES: &[&str]` plus a
self-scanning test. **Basis:** codebase — converting ~40 call sites to an enum
touches every emit site and the `AppError::bad_request(first.code, …)` path that
wants a `&str`, for no behavioral gain. The actual risk is "a code exists that
the UI cannot say in human language", and a const + a source-scanning test closes
exactly that, additively. The test scans for the code literal argument of
`ValidationError::{err,at,warn}` in `validate.rs` and `ref_check.rs`, so it cannot
be defeated by adding a finding in either file.

### DEC-3: Which control for the Tool picker — `Select` or `Combobox`?
**Resolution:** `Combobox`. **Basis:** convention — the kit's `Combobox` is the
searchable single-select and "windows large lists itself"
(`kit/combobox.tsx:22-24`); a server's tool list is unbounded (biomcp exposes 1,
a large external server 50+). It derives the same `${testid}-opt-${value}` option
testids as `Select`, so the e2e selector idiom is unchanged, and it exposes
`loading` + `emptyText` which the fetch state needs. `CapabilitySelect` (the
server picker) stays a `Select` — the accessible-server list is small and already
paginated.

### DEC-4: How are the tool's arguments collected once a tool is chosen?
**Resolution:** A form generated from the tool's declared `input_schema` — one
typed control per property — reusing `workflowElicitSchema.ts`'s `FieldSchema`
vocabulary. **Basis:** user — the feature-lifecycle UI checklist's *Input
economy* rule states it verbatim ("Collect a structured value via a form
generated from the target's declared schema (one typed field per input)"), and
the owner's brief restates it. The app already has exactly one JSON-Schema→control
vocabulary (`WorkflowElicitForm`); adding a second would be the drift this
codebase keeps paying for.

### DEC-5: A typed control cannot hold `{{ inputs.n }}`. What is the affordance?
**Resolution:** Each generated field's `LabeledControl` action slot carries the
existing `RefInsertMenu`. Inserting a reference into a NON-string field switches
that ONE field to a template-text input, showing a small "using a reference"
marker with a "use a value instead" button that restores the typed control and
clears the template. A field whose LOADED value is already a template renders in
template mode on mount. **Basis:** convention — `PromptField`
(`builderFields.tsx:91-127`) already puts `RefInsertMenu` in the label-row action
slot, so the affordance is the page's established one; the reversibility button is
required by the phase-2 AT-RISK verdict on INV-5 (a one-way switch would trap the
user).

### DEC-6: What happens to arguments a tool's schema does not declare?
**Resolution:** They are preserved and rendered in an "Additional arguments"
key/value section below the generated fields, using the EXISTING
`toText`/`parseValue`/`baseText` round-trip machinery. **Basis:** convention —
silently dropping saved data on first edit would be a data-loss regression; the
existing machinery exists precisely to preserve an untouched value's exact type
and is kept verbatim for these rows.

### DEC-7: What is the bound on generated fields, and is it configurable?
**Resolution:** A fixed named constant `MAX_GENERATED_FIELDS = 24`, NOT an
admin-configurable setting. Properties beyond it spill into the "Additional
arguments" section with a "Showing 24 of N" note. **Basis:** convention — the
configurable-settings rule applies to OPERATIONAL tunables (resource limits,
retention, quotas). This is a pure client-side rendering bound on a
third-party-authored schema with no server cost, no security boundary, and no
operator reason to change it; promoting it to a settings row + migration + REST +
sync + admin card would be ceremony with no consumer. It is a named constant with
a rationale comment (not an inline literal) so it can be promoted later without a
rewrite.

### DEC-8: Should the tool catalog be a shared singleton store or per-builder?
**Resolution:** Per-builder (`defineLocalStore`), threaded as a prop like the
builder store. **Basis:** convention — `WorkflowBuilder.store.ts:13-20` documents
the same reasoning for the builder itself ("a builder is an editing session, not a
shared singleton"), and a local store auto-unsubscribes on unmount. The cost is
one refetch per builder mount, which is correct: a server's tool list can change
between sessions.

### DEC-9: Add the builder routes to the 24/7 live-UI-audit rig?
**Resolution:** NO — descoped this round; reported to the orchestrator instead.
**Basis:** codebase — the rig lives in `agent-kit/skills/live-ui-audit/`, which is
a SUBMODULE pointing at the separate `ziee-ai/agent-kit` repo. Editing it requires
a commit in that repo plus a submodule-pointer bump on this branch, and all 16
sibling `.lifecycle` branches carry the same pointer, so a bump here would collide
with every one of them at merge. The correct owner is the orchestrator, who can
land one agent-kit commit and bump every branch together.
- DESCOPED: ITEM-12 — the live-UI-audit route list lives in the `agent-kit` submodule (a separate repo); a pointer bump from this branch would collide with 16 sibling branches, so the orchestrator lands it; the finding itself (the builder is absent from the rig's route list) is reported in `TEST_GAP_ANALYSIS.md` [approved: orchestrator brief 2026-07-27 — "coordinate rather than collide"; the brief asks to ESTABLISH whether the builder is in the route list, which is done]

### DEC-10: Does the builder page's `LabeledControl` need migrating to kit `Field`?
**Resolution:** No — record, do not migrate. **Basis:** codebase — `Field`/
`FieldLabel`/`FieldDescription`/`FieldError` are NOT exported from `@ziee/kit`
(they are internal to `kit/form.tsx:18`, reachable only through `Form`/`FormField`,
which require react-hook-form + a submit-once model). The builder edits live store
state on every keystroke. `LabeledControl` (`builderFields.tsx:30-73`) already
provides label association, required marker, description, error and an action
slot — it IS this page's field primitive, and the page composes it consistently.
Migrating would mean either exporting the shadcn field primitives from the kit or
restructuring the builder as an RHF form; both are shared-surface changes that
belong with the sibling scheduler-layout branch, not here. Reported for
coordination.

### DEC-11: Is A1 (18 `.lifecycle` dirs) a blocker?
**Resolution:** No. Record as a pre-existing, base-inherited failure and proceed;
never delete another feature's dir. **Basis:** codebase — A1 assumes a branch cut
from `main`, where the merge-hygiene rule strips `.lifecycle`. This branch is cut
from `feat/agent-core`, which carries 16 sibling dirs by design. The identical
decision is already recorded on a sibling branch
(`.lifecycle/control-describe-schema/DECISIONS.md` DEC-13), so this is the
established precedent, and the orchestrator's brief forbids deleting them.

### DEC-12: Does the fix change any backend validation message?
**Resolution:** No. Zero message/code/severity edits. **Basis:** user — the
owner's brief: "the backend keeps its precise machine-readable codes… Do not just
string-replace." The only backend edit is an additive const + a test.

### DEC-13: How does the tool picker behave before a server is chosen?
**Resolution:** Rendered but DISABLED, with the placeholder "Pick a server
first". Not hidden. **Basis:** convention — `CapabilitySelect` already renders a
disabled-looking empty state rather than hiding
(`capabilities.tsx:75` shows "No servers available"); hiding a required field
makes the inline "A tool name is required" error refer to an invisible control.

### DEC-14: Which tool metadata is shown in the picker rows?
**Resolution:** The tool NAME as the option label, its `description` as secondary
row text via `Combobox`'s option rendering, truncated to one line. **Basis:**
convention — the same treatment `AddStepMenu` gives `STEP_KIND_DESCRIPTIONS`, so
the two pickers on this page read the same way.
