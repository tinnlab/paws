# DECISIONS — control-describe-schema

Every human/product input the implementation needs, resolved up front.

### DEC-1: How are cycles handled — depth cap, or `$defs`?
**Resolution:** A real resolution STACK cuts a re-entrant `$ref` to
`{"$ref": "#/$defs/<Name>"}` and emits `<Name>` into a root `$defs`, rewritten to
a fixpoint. A depth cap exists too, but only as a secondary bound — it is not the
cycle mechanism.
**Basis:** convention — `$defs` + `#/$defs/…` is how JSON Schema 2020-12 expresses
recursion, so the output stays self-contained (DESIGN §2.1) AND terminates
(§2.3). The repo's nearest prior art, `catalog.rs::schema_has_secret_field_rec`,
uses a blind `depth > 6` cap, which is correct for a boolean probe and wrong
here: it would silently emit a schema missing the fields below the cut, which is
exactly the "model cannot see the contract" defect we are fixing.

### DEC-2: What bounds the size, and how does it degrade?
**Resolution:** `MAX_DEPTH = 12`, `MAX_EXPANSIONS = 200`,
`MAX_SCHEMA_BYTES = 64 KiB` (soft → switch to the compact `$defs` form),
`MAX_SCHEMA_BYTES_HARD = 256 KiB` (→ elide the largest `$defs` entries to named
`$comment` placeholders, deterministic order, `schema_truncated: true`). Never a
mid-structure cut.
**Basis:** codebase — measured over the committed `src-app/ui/openapi/openapi.json`:
140 operations carry a JSON body, the largest fully-inlined schema is
`LlmModel.create` at 10,522 bytes / 11 ref expansions, the median is 349 bytes,
the deepest expansion count is 14 (`Workflow.create`), and ZERO schemas are
cyclic. 64 KiB is ~6× the worst real case, so the degradation path never fires in
production while still bounding a pathological future schema. Sits alongside the
module's existing caps (`MAX_RESULT_BYTES = 1 MiB`, `MAX_LIST_RESULTS = 200`).

### DEC-3: Fixed constants or an admin-configurable settings row? (mandatory configurable-settings DEC)
**Resolution:** Fixed constants, grouped in one named `Budget` struct in
`schema_inline.rs` with the rationale on each field — NOT a settings table.
**Basis:** convention + rationale — these are not operational tunables an operator
has any basis to set: they bound one in-process, request-scoped transformation of
a document the operator does not author, and the only observable effect of
changing them is how much of a schema the MODEL sees. There is no deployment for
which a different value is right, and exposing them would let an admin footgun
the control surface into either an unusable stub or a context-window flood.
Structuring them as a `Budget` struct (per the rule) keeps promotion to
configurable a non-rewrite if that ever changes. The genuinely operational switch
for this module already exists and stays: `control_mcp.enabled`.

### DEC-4: Structured content, stringified text, or both?
**Resolution:** BOTH, but the text stops being a JSON dump. `structuredContent`
keeps the typed object (with the now-inlined `request_schema` plus `schema_form`
and `schema_truncated`); the text becomes a readable digest AND always carries the
exact inlined JSON Schema block.
**Basis:** convention — the repo's built-in-tool convention, established by the
`web_search` retrofit and documented in CLAUDE.md, is "a readable text digest +
typed `structuredContent`, never stringified JSON in the text channel". Dropping
the schema from the text was rejected: `structuredContent` is persisted and
size-capped but the model reads it back only via `get_tool_result`, so the text is
the channel the model actually sees in-turn — and a digest alone would lose exact
nested shape (DESIGN §4 / INV-6).

### DEC-5: `required_permission: null` on `Project.create` — bug or correct?
**Resolution:** A REAL BUG, fixed in scope (ITEM-5). `Project.create` is gated on
`projects::create`; the value is lost because `with_permission` writes the
permission into the operation's prose description and the handler's subsequent
`.description("…")` replaces that string. Measured on the committed spec: 408
operations declare a permission, 207 still carry it in the description — **201 are
lost**. The fix reads the permission from the 403 response example that
`with_permission` also attaches, which no `.description()` can overwrite.
**Basis:** codebase — `sdk/crates/ziee-framework/src/permissions/openapi.rs:52-56`
(`op.description(&permission_desc)`) vs
`src-app/server/src/modules/project/handlers.rs:273-288`
(`with_permission::<(ProjectsCreate,)>(op) … .description("Create a personal chat
project…")`), and the 403 example at
`responses.403.content."application/json".example.details.required_permissions[0].value
== "projects::create"` in `src-app/ui/openapi/openapi.json`.

### DEC-6: Fix the LOSS, or fix the SOURCE (make `with_permission` emit a machine-readable extension)?
**Resolution:** Fix the loss — read the 403 example. Do NOT change
`with_permission` to stamp an `x-required-permissions` OpenAPI extension in this
round.
**Basis:** convention + blast radius — `with_permission` decorates all 446
operations across every module and its output is the golden-tested
`openapi.json` + `types.ts`; adding an extension key changes that generated
artifact for every route and forces a both-binaries regen, for zero additional
information (the 403 example already carries name + value + description,
machine-readably, and is already emitted). The reader-side fix is confined to one
function in one crate and is provably equivalent. Recorded here so the cleaner
producer-side change is a known, deliberate follow-up rather than an oversight.

### DEC-7: Multi-permission operations — first permission, or all of them?
**Resolution:** Keep `Operation.required_permission: Option<String>` and take the
FIRST entry of `required_permissions`. Do not widen to a list in this round.
**Basis:** convention — exact parity with the existing behaviour. The single-perm
description form is `**Required Permission:** \`x\`` and `parse_required_permission`
already returns just that one; the multi form
(`**Required Permissions (ALL):**`) does not even match the parser's marker, so
those operations return `None` today. Taking the first from the 403 list is
therefore strictly MORE correct than the status quo for all 5 multi-permission
operations, and widening `Option<String>` → `Vec<String>` would ripple through
`user_may_run`, `list_capabilities` and the describe payload. Noted as a
follow-up, not silently taken.

### DEC-8: Where does the inliner live — app-side or the `ziee-control-mcp` SDK crate?
**Resolution:** App-side, `src-app/server/src/modules/control_mcp/schema_inline.rs`.
The SDK delta is limited to the two things that can only live there: the catalog
builder (`catalog.rs`, ITEM-5) and the static tool descriptors (`tools.rs`, ITEM-6).
**Basis:** codebase — `control_mcp/mod.rs:35-42` records that `handlers`, `routes`,
`repository` and `chat_extension` were deliberately RETAINED app-side in v1 while
the DB-free dispatch core moved to the SDK; `describe_capability` (the inliner's
only consumer) is app-side, so the inliner belongs with it. It also keeps the
largest, most security-relevant hunk inside the ziee diff, where the phase-6
coverage law can see it — an SDK-side hunk is invisible to
`git diff base...HEAD` in this repo.

### DEC-9: Where does the D2 guidance go — tool descriptions, the chat nudge, or both?
**Resolution:** Both, and short. One clause added to the `describe_capability` and
`invoke_capability` descriptions (the model reads them at the moment it is about
to need the input), plus one sentence in `CONTROL_NUDGE` (which frames the whole
turn). The `ask_user` descriptor itself is NOT edited.
**Basis:** convention — the control surface owns its own guidance; the `ask_user`
descriptor is a shared built-in whose text is guarded by its own regression test
(`elicitation_mcp/tools.rs:58-77`) and is used by every tool-capable turn, not just
control ones. Total added prose is budgeted at ≤ 3 sentences because the nudge is
injected into EVERY tool-capable chat.

### DEC-10: Can the guidance safely name `ask_user`?
**Resolution:** Yes, unconditionally — no capability check is needed before
emitting the instruction.
**Basis:** codebase — `mcp/chat_extension/mcp.rs:286-303` pushes the elicitation
server id into `auto_attach_builtin_ids` for EVERY tool-capable turn ("always-on"),
and `mcp.rs:731-747` approval-bypasses it. The control nudge itself only runs when
the model is tool-capable (`control.rs:56-60`), which is the same condition. So the
instruction can never point at a tool the model does not have.

### DEC-11: What does the e2e assert, given `ask_user` is never recorded in `mcp_tool_calls`?
**Resolution:** Assert on the rendered elicitation card in the chat
(`[data-testid^="elicitation-pending-"]`), not on the tool-call history.
**Basis:** codebase — `ask_user` is intercepted before `session.call_tool`
(`mcp/chat_extension/mcp.rs:3308-3327` and `helpers.rs:433-447`), and the
`mcp_tool_calls` recorder sits inside `call_tool`, so an `ask_user` invocation is
deliberately never recorded. The card is the user-visible proof and the thing the
defect is actually about (a form instead of prose).

### DEC-12: The `sdk` submodule pointer bump
**Resolution:** Commit the SDK change on the submodule's tracked branch
(`sdk/agent-core-and-perf`) locally and bump the pointer in the ziee branch. Do not
push either. Report the SDK SHA explicitly so the orchestrator pushes both.
**Basis:** convention — the base branch does exactly this
(`chore(sdk): bump submodule → …`, `ee665ee34 chore: rebase sdk commits onto …`).
The instruction for this task is "do NOT push; the orchestrator lands it", so the
cross-repo ordering is the orchestrator's to execute, and its only requirement is
that it be stated.

### DEC-13: Phase-0 / A1 fails with 17 `.lifecycle` feature dirs — remove the other 16?
**Resolution:** NO. Leave them. Record the A1 failure as a pre-existing,
INHERITED condition of the base branch and report it explicitly rather than
"fixing" it.
**Basis:** codebase — A1 assumes a branch cut from `main`, where the merge-hygiene
rule strips `.lifecycle/`. `origin/feat/agent-core` is a long-lived integration
branch that accumulates them: it carries 16 tracked feature dirs before this
branch adds its own, and the sibling in-flight branch
(`feat/control-mcp-e2e-coverage`) fails A1 identically at 16. Deleting other
features' committed artifacts here would push those deletions into agent-core at
merge — destroying another workstream's audit record to make a counter go green.
Every PER-PHASE gate (1..9) is verified green independently.

### DEC-14: DEC-6 reversed — fix the permission at the PRODUCER after all
**Resolution:** `with_permission` now stamps an `x-required-permissions` OpenAPI
extension, and the catalog resolves extension → 403 example → description marker.
DEC-6's reader-only fix stands as the fallback, not the mechanism.
**Basis:** codebase — the blind audit proved the reader-side fix is structurally
unable to close the class: the 403 example is destroyed by a handler's own
`.response_with::<403, …>` exactly as the description is destroyed by its own
`.description(…)`, leaving 34 operations at `null` of which 18 are genuinely
gated (including the admin-only `McpServerToolApprovals.set`). DEC-6 weighed
blast radius against "zero additional information" — that premise was wrong.
The measured cost of the reversal: `openapi.json` regenerates for both binaries,
`types.ts` is UNCHANGED (the extension is not a TS-visible key) and
`types_ts_parity` is green.

### DEC-15: DEC-7 reversed — carry ALL permissions, not the first
**Resolution:** `Operation` gains `required_permissions: Vec<String>`;
`user_may_run` requires every one. `required_permission` remains as the
first-of-set single label for display.
**Basis:** convention — DEC-7 chose the first purely for parity with what the
description parser could express. The extension carries the whole set, so the
constraint that forced the compromise is gone, and gating on a strict subset
under-gates: a user holding one permission of an ALL-of pair was offered an
operation the real route then refuses.

### DEC-16: How much of the audit backlog lands in THIS round?
**Resolution:** Every HIGH, and every medium/low whose fix is contained within
this feature's own surface. Explicitly deferred, each recorded in `LEDGER.jsonl`
with `status: accepted` and a stated reason in `FIX_ROUND-1.md`: widening the
secret-probe's traversal to match the walker's reach; extracting the digest
renderer out of `handlers.rs`; unifying the SDK's duplicate `resolve_schema_ref`;
per-operation memoization; a stub-engine deterministic tier for the guidance.
**Basis:** convention — the deferred items are (a) changes to a SECURITY gate's
blast radius across all 446 operations, which must not ride along on an unrelated
fix, or (b) refactors that would churn the exact surface four blind reviewers
just covered, invalidating the audit that justifies the merge. Every one has 0
live instances or a bounded, measured cost. Deferring them is a recorded
decision, not an omission.
