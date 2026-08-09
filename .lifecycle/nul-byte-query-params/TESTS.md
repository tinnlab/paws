# TESTS — enumerated up front

Every rejection test below carries its **happy-path counterpart in the same
test function**, so a test cannot pass because the endpoint is broken in some
other way. Every endpoint with an ownership or permission boundary also carries
that control in the same test.

This diff touches **no frontend path** (`src-app/ui/**`, `src-app/desktop/ui/**`
untouched), so no `tier: e2e` test is required or enumerated; the backend
integration tier is the top tier here.

## Unit — the shared helper (ITEM-1, ITEM-2)

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/common/text_guard.rs` — asserts: `reject_nul` ACCEPTS a wide list of legitimate values (empty, ascii, `"line\nbreak\ttab"`, astral emoji, a 100k-char string, `"' OR '1'='1; DROP TABLE users;--"`) and REJECTS a NUL-bearing value with exactly `status_code() == 400` and `error_code() == "VALIDATION_ERROR"`, with the field name interpolated into the message.
- **TEST-2** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/common/text_guard.rs` — asserts: `normalize_text_filter` reproduces the五 replaced sites byte-for-byte on the happy path — `None → None`, `"" → None`, `"   " → None`, `"\t\n" → None`, `"  foo " → Some("foo")`, `"roadmap" → Some("roadmap")` — i.e. the normalization is unchanged for every valid input.
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/server/src/common/text_guard.rs` — asserts: `normalize_text_filter(Some("\0"), "search")` returns `Err` whose `status_code()` is **400** (NOT 500) and whose `error_code()` is `VALIDATION_ERROR` — the invariant stated as "a NUL-bearing text bind is a client error", asserted on the status directly so it would fail if the guard returned any 5xx.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-2] file: `src-app/server/src/common/text_guard.rs` — asserts: for `"a\0b"`, `"\0lead"`, `"trail\0"`, the result is `Err` and **never** an `Ok(Some(..))` whose contents equal the NUL-stripped string (`"ab"`, `"lead"`, `"trail"`). This test fails if the implementation is ever changed to strip; a pure "returns Err" assertion would not.
- **TEST-5** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-2] file: `src-app/server/src/common/text_guard.rs` — asserts: every non-NUL control character (`\n`, `\t`, `\r`, `\x1b`, `\x07`, U+007F, U+200B, U+202E) is ACCEPTED and returned as a normalized `Some(..)`, i.e. the guard is narrow. Would fail if the guard were broadened to `char::is_control()`.
- **TEST-6** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-8] file: `src-app/server/src/common/text_guard.rs` — asserts: the three delegating wrappers (`project::handlers::reject_nul`, `user::handlers::groups::reject_nul`, `chat::core::handlers::validation::reject_nul_in_content`) each produce the SAME `status_code()` and `error_code()` as `common::text_guard::reject_nul` for the same input — the executable form of "defined once". Would fail if any copy drifted.

## Integration — per endpoint, red-then-green (ITEM-3..ITEM-7, INV-5)

Shared helper: `src-app/server/tests/common/nul_query_param.rs` — issues a raw
`?search=%00` request and asserts `400` + `VALIDATION_ERROR` from the JSON body.

- **TEST-7** (tier: integration) [covers: ITEM-3] file: `src-app/server/tests/project/nul_query_param_test.rs` — asserts: **(a)** `GET /projects?search=%00` → **400** `VALIDATION_ERROR`; **(b) happy-path counterpart in the same test**: `GET /projects?search=Roadmap` → **200** and returns exactly the seeded `Roadmap` project (so the 400 cannot be a symptom of a dead endpoint); **(c) ownership control in the same test**: a second user's `GET /projects?search=Roadmap` → **200** with `total == 0`.
- **TEST-8** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-3, ITEM-4, ITEM-5, ITEM-6, ITEM-7, ITEM-10, ITEM-11, ITEM-12, ITEM-13] file: `src-app/server/tests/common/nul_query_param.rs` — asserts: a table-driven sweep over **every** route whose query struct carries a free-text SQL-bound filter — all **12** of them: `/projects?search`, `/conversations?search`, `/conversations/{id}/messages/search?q`, `/mcp/servers?search`, `/mcp/system-servers?search`, `/memories?{search,kind,source}`, `/background/runs?{status,kind}`, `/mcp/tool-calls?tool_use_id`, `/local-runtime/versions?engine` — returns **400** for `%00`. The table is asserted to have exactly 12 rows so a silently-dropped row fails, and each row also drives its own **200 control** with a benign value so a 400 cannot come from a dead/unreachable route.
- **TEST-9** (tier: integration) [covers: ITEM-4] file: `src-app/server/tests/chat/nul_query_param_test.rs` — asserts: **(a)** `GET /conversations?search=%00` → **400** `VALIDATION_ERROR`; **(b)** the guard runs BEFORE `escape_like` — `GET /conversations?search=%5C%00` (backslash + NUL, which `escape_like` would turn into `\\\0`) is ALSO **400**, not a 500; **(c) happy-path counterpart**: `GET /conversations?search=<seeded title substring>` → **200** with the seeded conversation present; **(d) ownership control**: a second user searching the same term → **200**, `total == 0`.
- **TEST-10** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/mcp/nul_query_param_test.rs` — asserts: **(a)** `GET /mcp/servers?search=%00` → **400** `VALIDATION_ERROR`; **(b) happy-path counterpart**: `GET /mcp/servers?search=<seeded server name>` → **200** with that server present; **(c) permission control**: a user WITHOUT `mcp_servers::read` gets **403** on the same happy-path URL (so the 400 is a validation refusal, not an authz refusal).
- **TEST-11** (tier: integration) [covers: ITEM-6] file: `src-app/server/tests/mcp/nul_query_param_test.rs` — asserts: **(a)** admin `GET /mcp/system-servers?search=%00` → **400** `VALIDATION_ERROR`; **(b) happy-path counterpart**: admin `GET /mcp/system-servers?search=<built-in server name substring>` → **200** with ≥1 result; **(c) permission control**: a non-admin user gets **403** on both URLs — proving the 400 is reached only after the admin gate, i.e. validation does not leak the endpoint to unpermitted callers.
- **TEST-12** (tier: integration) [covers: ITEM-7] file: `src-app/server/tests/memory/nul_query_param_test.rs` — asserts: **(a)** `GET /memories?search=%00` → **400** `VALIDATION_ERROR`; **(b) happy-path counterpart**: `GET /memories?search=<seeded content substring>` → **200** with the seeded memory present; **(c) ownership control**: a second user searching the same term → **200**, empty.
- **TEST-13** (tier: integration) [covers: ITEM-7] file: `src-app/server/tests/memory/nul_query_param_test.rs` — asserts: the sibling free-text filters carry the same guard — `GET /memories?kind=%00` and `GET /memories?source=%00` each → **400** `VALIDATION_ERROR`; **happy-path counterpart in the same test**: `?kind=fact` and `?source=manual` each → **200** returning the seeded row. (This item was NOT in the reported defect; if either returns 200 before the fix, the finding is reported as DISPROVED for that parameter rather than forced into the same explanation.)

- **TEST-19** (tier: integration) [covers: ITEM-10] file: `src-app/server/tests/chat/nul_query_param_test.rs` — asserts: **(a)** `GET /conversations/{id}/messages/search?q=%00` → **400** `VALIDATION_ERROR`; **(b) happy-path counterpart**: `?q=<substring of a seeded message>` → **200** with `total >= 1` and the match present; **(c) ownership control**: a second user hitting the same conversation id → **404** (the endpoint resolves the conversation owner-scoped before reading `q`).
- **TEST-20** (tier: integration) [covers: ITEM-11] file: `src-app/server/tests/background_mcp/nul_query_param_test.rs` — asserts: **(a)** `GET /background/runs?status=%00` and `?kind=%00` each → **400** `VALIDATION_ERROR`; **(b) happy-path counterpart**: `?status=completed` and `?kind=subagent` each → **200** with a well-formed page body; **(c) permission control**: a user without `background::use` → **403** on the same happy-path URL.
- **TEST-21** (tier: integration) [covers: ITEM-12] file: `src-app/server/tests/mcp/nul_query_param_test.rs` — asserts: **(a)** `GET /mcp/tool-calls?tool_use_id=%00` → **400** `VALIDATION_ERROR`; **(b) happy-path counterpart**: `?tool_use_id=toolu_notarealid` → **200** with `total == 0` (a valid filter that matches nothing — proves the parameter is genuinely reaching the filter path rather than being ignored); **(c) permission control**: a user without `mcp_servers::read` → **403**.
- **TEST-22** (tier: integration) [covers: ITEM-13] file: `src-app/server/tests/llm_local_runtime/nul_query_param_test.rs` — asserts: **(a)** admin `GET /local-runtime/versions?engine=%00` → **400** `VALIDATION_ERROR`; **(b) happy-path counterpart**: `?engine=llamacpp` → **200** with a well-formed page body; **(c) permission control**: a user without the runtime-version read permission → **403**.

## Regression control — the fix must not change matching semantics

- **TEST-14** (tier: integration) [covers: ITEM-3] file: `src-app/server/tests/project/search_test.rs` — asserts: the pre-existing project-search suite (case-insensitive substring, description match, blank-and-absent-return-all, ownership scoping, paged filtered total, wildcard metacharacters) is UNCHANGED and still passes — the control that `normalize_text_filter` reproduces the replaced normalization exactly.
- **TEST-15** (tier: unit) [covers: ITEM-8] file: `src-app/server/src/modules/user/handlers/groups.rs` — asserts: the pre-existing `reject_nul` / `validate_group_name` unit tests (groups.rs:601-625) still pass unmodified after the delegation — the behaviour-preservation control for ITEM-8.
- **TEST-16** (tier: unit) [covers: ITEM-8] file: `src-app/server/src/modules/chat/core/handlers/validation.rs` — asserts: the pre-existing `reject_nul_in_content` unit tests (validation.rs:64-73) still pass unmodified after the delegation.
- **TEST-17** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/project/handlers.rs` — asserts: `normalize_search` still trims and maps blank/whitespace to `None` (the pre-existing `normalize_search_trims_and_blanks_to_none` test, updated for the now-fallible signature — updated, NOT deleted), and additionally returns `Err(400)` for a NUL.

## Documentation

- **TEST-18** (tier: unit) [covers: ITEM-9] file: `src-app/server/src/common/text_guard.rs` — asserts: the module doc-comment names the rule and the shared entry point, and the guard's rejection message format (`"{field} cannot contain NUL characters"`) is asserted verbatim in TEST-1 so the documented contract and the code cannot drift.

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1 |
| ITEM-2 | TEST-2, TEST-3, TEST-4, TEST-5 |
| ITEM-3 | TEST-7, TEST-8, TEST-14, TEST-17 |
| ITEM-4 | TEST-8, TEST-9 |
| ITEM-5 | TEST-8, TEST-10 |
| ITEM-6 | TEST-8, TEST-11 |
| ITEM-7 | TEST-8, TEST-12, TEST-13 |
| ITEM-8 | TEST-6, TEST-15, TEST-16 |
| ITEM-9 | TEST-18 |
| ITEM-10 | TEST-8, TEST-19 |
| ITEM-11 | TEST-8, TEST-20 |
| ITEM-12 | TEST-8, TEST-21 |
| ITEM-13 | TEST-8, TEST-22 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-3 |
| INV-2 | TEST-4 |
| INV-3 | TEST-6 |
| INV-4 | TEST-5 |
| INV-5 | TEST-8 |
