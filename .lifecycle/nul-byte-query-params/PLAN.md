# PLAN — NUL byte in a free-text query parameter must be a typed 400, not a 500

Feature slug: `nul-byte-query-params` · branch `fix/nul-byte-search-500`

## Design source

Realizes `.lifecycle/nul-byte-query-params/DESIGN.md` §2 (root cause: the
`reject_nul` guard exists as three private copies wired only into the write
path, while the read path's five copy-pasted query-param normalizations omit
it), §4 (the behaviour to be consistent with: reject → 400 `VALIDATION_ERROR`,
NUL only), and §5 (the fix: one shared `common::text_guard`).

Secondary source: `agent-kit/docs/CODING_GUIDELINES.md` §6 *Error handling*
("**DB error ≠ 404**: distinguish 'row not found' from 'query failed'";
"Never silently swallow") and §1 ("No information leak via status") — a storage
error caused by a client-supplied value must surface as a client error.

## Invariants

- **INV-1**: A user-supplied string that reaches Postgres as a `text` bind is
  rejected with `AppError::bad_request("VALIDATION_ERROR", format!("{field}
  cannot contain NUL characters"))` — **HTTP 400** — never surfaced as a 500.
- **INV-2**: Reject, do not strip. `search=a\0b` must NOT be silently rewritten
  to `search=ab`; a filter term the caller cannot have meant must never be
  turned into a term that returns hits.
- **INV-3**: The guard is defined **once**. The three pre-existing private
  copies (`project::handlers::reject_nul`, `user::handlers::groups::reject_nul`,
  `chat::core::handlers::validation::reject_nul_in_content`) delegate to the
  shared definition, so a future fourth free-text field has exactly one place
  to call and exactly one message to inherit.
- **INV-4**: The guard is narrow — **NUL only**. `\n`, `\t` and other control
  characters remain accepted in a filter term (they are storable; they simply
  match nothing) and must still return **200**.
- **INV-5**: Rejection is applied at the query-parameter normalization boundary
  of **every** list endpoint that has a free-text filter, not only the three
  endpoints where the 500 was observed.

## Items

- **ITEM-1**: Add `src-app/server/src/common/text_guard.rs` exporting
  `reject_nul(value, field) -> Result<(), AppError>` — the single definition of
  the guard and its message — and register the module in `common/mod.rs`.
- **ITEM-2**: Add `normalize_text_filter(raw: Option<&str>, field: &str) ->
  Result<Option<&str>, AppError>` to the same module: reject NUL on the RAW
  value first, then `trim`, then blank/whitespace-only → `None`. This is the
  single definition of the query-parameter shape that is currently copy-pasted
  at five sites.
- **ITEM-3**: `GET /projects` — replace `project::handlers::normalize_search`'s
  body with a call to `normalize_text_filter(.., "search")` and propagate the
  error (the handler must now `?` it).
- **ITEM-4**: `GET /conversations` — route `params.search` through
  `normalize_text_filter(.., "search")` BEFORE `escape_like`, so a NUL is
  refused rather than escaped-then-bound.
- **ITEM-5**: `GET /mcp/servers` — route `params.search` through
  `normalize_text_filter(.., "search")`.
- **ITEM-6**: `GET /mcp/system-servers` — route `params.search` through
  `normalize_text_filter(.., "search")`.
- **ITEM-7**: `GET /memories` — route `search`, **and also `kind` and
  `source`** (both are free-text query params bound as `text` at
  `memory/repository.rs:72-73` / `:107-108`, and carry the identical defect)
  through `normalize_text_filter`.
- **ITEM-10**: `GET /conversations/{id}/messages/search` — `MessageSearchQuery.q`
  (`chat/core/types/message.rs:124`) is a SIXTH free-text ILIKE search that was
  not in the reported defect. `trimmed_term()` (`:134`) is the same
  trim+blank→None shape with no guard; the term is bound at
  `chat/core/repository/messages.rs:456,475,486`. Make `trimmed_term` fallible
  via `normalize_text_filter(.., "q")`.
- **ITEM-11**: `GET /background/runs` — `status` and `kind`
  (`background_mcp/runs.rs:65,68`) are passed through `as_deref()` with **zero**
  validation into `status = $2` / `job_kind = $3`
  (`workflow/repository.rs:1709-1710`, count `:1737-1738`). Guard both.
- **ITEM-12**: `GET /mcp/tool-calls` — `tool_use_id`
  (`mcp/tool_calls/handlers.rs:51`) is bound at
  `mcp/tool_calls/repository.rs:174` (`tool_use_id = $5`). Guard it.
- **ITEM-14**: The four call sites that bind the RAW value
  (`background/runs?{status,kind}`, `mcp/tool-calls?tool_use_id`,
  `local-runtime/versions?engine`) use `guard_raw` (reject-only), NOT
  `normalize_text_filter`. Added in FIX_ROUND-1 after the blind audit found the
  first cut had silently widened `?p=` at all four from "match the empty string"
  to "no filter at all".
- **ITEM-15**: Guard the BODY-path members of the same class that a live probe
  found still returning 500: `assistants.{description,instructions}`,
  `conversations.title`, `knowledge_bases.description`, `memories.content`.
- **ITEM-16**: Declare the new `400` on all nine list routes' `*_docs` and
  regenerate OpenAPI for BOTH UI workspaces.
- **ITEM-13**: `GET /local-runtime/versions` — `engine`
  (`llm_local_runtime/runtime_version/handlers.rs:44`) is bound at
  `runtime_version/repository.rs:157` (`WHERE engine = $1`) with no validation.
  Guard it.
- **ITEM-8**: Collapse the three pre-existing private copies onto the shared
  definition (INV-3): `project::handlers::reject_nul`,
  `user::handlers::groups::reject_nul`, and
  `chat::core::handlers::validation::reject_nul_in_content` delegate to
  `common::text_guard::reject_nul`. Existing call sites, messages, status codes
  and their unit tests stay behaviourally identical.
- **ITEM-9**: Document the rule so the next free-text value inherits the guard by
  convention rather than by a fourth copy-paste. **Landed in the repo-root
  `CLAUDE.md`**, not in the `agent-kit` submodule — see DEC-6 (amended): a
  submodule edit is invisible to the diff and to every consumer unless the
  submodule is committed AND pushed, which this branch may not do.

## Files to touch

- `src-app/server/src/common/text_guard.rs` (new)
- `src-app/server/src/common/mod.rs`
- `src-app/server/src/modules/project/handlers.rs`
- `src-app/server/src/modules/chat/core/handlers/conversations.rs`
- `src-app/server/src/modules/chat/core/handlers/validation.rs`
- `src-app/server/src/modules/mcp/handlers/user.rs`
- `src-app/server/src/modules/mcp/handlers/system.rs`
- `src-app/server/src/modules/memory/handlers.rs`
- `src-app/server/src/modules/user/handlers/groups.rs`
- `src-app/server/src/modules/chat/core/types/message.rs`
- `src-app/server/src/modules/chat/core/handlers/messages.rs`
- `src-app/server/src/modules/background_mcp/runs.rs`
- `src-app/server/src/modules/mcp/tool_calls/handlers.rs`
- `src-app/server/src/modules/llm_local_runtime/runtime_version/handlers.rs`
- `src-app/server/tests/common/nul_query_param.rs` (new shared test helper)
- `src-app/server/tests/{project,chat,mcp,memory}/…_test.rs` (new tests)
- `agent-kit/docs/CODING_GUIDELINES.md`

## Patterns to follow

- **The guard + its message**: `modules/project/handlers.rs:157-176`
  (`reject_nul`) is the closest existing reference — same signature, same
  `AppError::bad_request("VALIDATION_ERROR", …)`, same narrow-NUL rationale in
  the doc comment. The new shared helper is that function, moved.
- **Shared server-side helper module placement**: `src-app/server/src/common/`
  (`tokens.rs`, `tool_args.rs`, `secret.rs`) — a small focused module with
  in-source `#[cfg(test)]` tests. NOT `sdk/crates/ziee-core` (submodule, must
  not be touched).
- **Query-param normalization call site**: `modules/mcp/handlers/user.rs:111`
  is the canonical shape being replaced; the replacement keeps the same
  position in the handler (immediately after extraction, before any repo call).
- **Integration tests**: `src-app/server/tests/project/search_test.rs` — same
  `TestServer::start()` + `create_user_with_permissions` harness, same
  `list(server, user, Some(term))` helper shape, same explicit status asserts.
- **Unit tests for a validator**: `modules/chat/core/handlers/validation.rs`
  `#[cfg(test)]` — asserts both `status_code() == 400` and
  `error_code() == "VALIDATION_ERROR"`, plus a wide accept-list.

## Non-goals

Not adding a `search` param to any endpoint lacking one; not changing match
semantics (ILIKE escaping / jsonb content search / sort whitelist); not
broadening the guard beyond NUL; not touching `sdk/`.

**Explicitly out of scope, and reported rather than fixed** — the sweep
surfaced a *second, different* inconsistency in the same six ILIKE sites:
`project.search`, `mcp user.search`, `mcp system.search` and `memory.search`
do **not** escape LIKE metacharacters, so a `%`/`_` in the term acts as a SQL
wildcard, while `conversations.search` (`escape_like`) and `messages.q`
(repo-side escape + an actual `ESCAPE '\'` clause) do. That is a
wrong-results defect, not a 500, it has its own asserted current behaviour
(`project/search_test.rs::multi_match_and_wildcard_metacharacters`), and
folding it in here would make this diff two changes wearing one coat. Recorded
in the report; not touched.

---

## Plan audit (phase 2 — verdicts against the codebase)

## Breakage risk

`normalize_text_filter` changes three handler-local normalizations from
infallible to fallible, so each call site gains a `?`. All five handlers
already return `ApiResult<...>`, and `AppError` already has
`From<AppError> for (StatusCode, AppError)` used throughout these modules, so
propagation compiles without a signature change. No repository signature
changes (`Option<&str>` in, unchanged). No wire-format change on the success
path: a valid term normalizes byte-identically to today (reject happens on the
raw value; trim/blank rules are copied verbatim), so every existing
`search_test.rs` assertion must remain green — that is the regression control.

`project::handlers::normalize_search` is currently infallible and unit-tested
by name (`normalize_search_trims_and_blanks_to_none`, handlers.rs:656); making
it fallible edits that test's expectations. That test is updated, not deleted
(A5: no TEST-ID may vanish).

## Pattern conformance

`common/text_guard.rs` mirrors `common/tokens.rs` (small pub-fn module +
in-source tests, registered in `common/mod.rs`). The guard body is
`project::handlers::reject_nul` verbatim. The 400/`VALIDATION_ERROR` pair is
what all three existing copies already emit, so no new error code and no new
status convention is introduced.

## Migration collisions

None — no migration. `find src-app/server -path '*/migrations/*.sql'` max
prefix is unchanged by this branch; nothing in this feature writes schema.

## OpenAPI regen

None required. No handler signature, request type, response type, or query
struct **shape** changes — `search`/`kind`/`source` stay `Option<String>` with
the same `JsonSchema` derives. Only the handler *body* changes. Verified: no
`#[derive(JsonSchema)]` struct field is added, removed or retyped, so
`openapi.json` and `api-client/types.ts` are unaffected in both workspaces.
(Confirmed empirically at phase 8 by re-running the regen and diffing.)

- **ITEM-1** — verdict: PASS — `common/` already hosts exactly this kind of
  helper (`tokens.rs`, `tool_args.rs`); `AppError` is re-exported as
  `crate::common::AppError`, which all three existing copies already import.
- **ITEM-2** — verdict: PASS — the five sites are literally identical
  (`.as_deref().map(str::trim).filter(|s| !s.is_empty())`), so one helper
  covers all of them with no per-site special-casing. Lifetime: returning
  `Option<&'a str>` borrowed from the caller's `Option<&'a str>` is what the
  current code already produces, so no allocation change.
- **ITEM-3** — verdict: PASS — `normalize_search` is private to
  `project/handlers.rs` with one caller (line 320); making it fallible is a
  one-line `?`.
- **ITEM-4** — verdict: PASS — an earlier CONCERN here claimed the guard MUST
  run before `escape_like`. **Withdrawn in FIX_ROUND-1 as vacuous**: `escape_like`
  only rewrites `\ % _`, so it neither removes nor introduces a NUL and BOTH
  orderings reject the identical input set. No query string can distinguish them,
  so the "ordering proof" test could not have failed for its stated reason. The
  guard is still placed first (it is the right shape), but the claim is gone.
- **ITEM-5** — verdict: PASS — `mcp/handlers/user.rs:111`, single call site.
- **ITEM-6** — verdict: PASS — `mcp/handlers/system.rs:64`, single call site.
- **ITEM-7** — verdict: CONCERN — `kind`/`source` were NOT in the reported
  defect and were not measured; they are included because
  `memory/repository.rs:72-73` binds them as `$5::text`/`$6::text` exactly like
  `search`. This is a claim to be PROVEN by a red test, not assumed
  (TEST-12/TEST-13), and reported as disproved if either returns 200.
- **ITEM-8** — verdict: PASS — all three copies have identical bodies and emit
  identical status/code; only the `field` string differs, which the shared
  signature already takes as a parameter. Their existing unit tests
  (`groups.rs:621-625`, `validation.rs:64-73`) are the behaviour-preservation
  control and must stay green unmodified.
- **ITEM-10** — verdict: CONCERN — `trimmed_term()` is a `pub` method on a
  `pub` type (`MessageSearchQuery`), so making it fallible is a wider blast
  radius than the private helpers. Checked: the only caller in the tree is
  `chat/core/handlers/messages.rs:113`, and the type is not re-exported outside
  the chat module. Resolved by keeping the signature change local and confirmed
  by `cargo check -p ziee --tests` (a missed caller is a compile error, not a
  silent pass).
- **ITEM-11** — verdict: PASS — `background_mcp/runs.rs:91-92` is a single call
  site; `status`/`kind` are documented as fixed vocabularies but are NOT
  enforced as such, so the NUL guard is the minimum correct fix. Deliberately
  NOT tightened into an enum here — that would change which values 400 and is a
  behaviour change beyond this defect (recorded as DEC-7).
- **ITEM-12** — verdict: PASS — `mcp/tool_calls/handlers.rs:71`, single call
  site into `ToolCallFilters`.
- **ITEM-13** — verdict: PASS — `llm_local_runtime/runtime_version/handlers.rs:88`,
  single call site. Note the module already has `is_valid_backend` /
  `is_valid_release_tag` validators for OTHER fields, which is further evidence
  that the guard is applied ad-hoc per field rather than at the boundary.
- **ITEM-9** — verdict: PASS — `agent-kit` is a submodule but is NOT `sdk`;
  the rules explicitly forbid only `sdk`. Documentation-only edit. If the
  submodule proves unwritable the rule lands in the repo-root `CLAUDE.md`
  instead (recorded as DEC-6).

- **ITEM-14** — verdict: PASS — `guard_raw` is a strict subset of
  `normalize_text_filter` (rejection only), so it cannot change which rows a
  valid filter selects; proven by `guard_raw_returns_valid_input_byte_for_byte_unchanged`
  and by three integration tests asserting `?p=` still returns 0 rows.
- **ITEM-15** — verdict: PASS — each is an existing validator gaining one
  `reject_nul` call next to its existing length cap; the 500s were measured live
  before the change (`REPRO_PRE_FIX.txt`).
- **ITEM-16** — verdict: CONCERN → resolved — this DOES require an OpenAPI regen
  (superseding DEC-9's "no regen"), which was run for both workspaces: +27 lines
  each in `openapi.json`, `types.ts` byte-identical.
