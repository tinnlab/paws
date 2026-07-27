# PLAN_AUDIT — control-describe-schema (plan audited against the codebase)

Audited against the real tree at `fix/control-describe-schema` (base
`origin/feat/agent-core` @ `b29adbad5`).

## Breakage risk

- **ITEM-5 tightens a live permission filter.** `handlers.rs::user_may_run`
  treats `required_permission: None` as "allowed". Populating the permission on
  201 previously-`None` operations therefore REMOVES those operations from
  non-admin users' `list_capabilities`, and turns `describe_capability` /
  `invoke_capability` on them into the in-band "not permitted" error for a user
  who lacks the perm. That is the intended correction (the real route already
  refused them at invoke time), but it is a real behaviour change and the biggest
  breakage risk in this plan.
  - Existing tests that could have broken, checked one by one:
    `list_capabilities_filters_by_permission` asserts admin SEES `User.delete` and
    a `control::use`-only user does NOT — both still hold (admins short-circuit;
    the limited user's negative assertion can only get MORE true).
    `describe_refuses_unpermitted_without_leaking_schema` expects a refusal —
    still refused. Every other control integration test acts as `["*"]` admin,
    which short-circuits `user_may_run` before the permission is read.
  - Residual risk: a real-LLM e2e whose model happens to pick an operation the
    (admin) test user holds — admins are unaffected, so nil.
- **ITEM-3/ITEM-4 change the `describe_capability` payload.**
  `describe_permitted_returns_schema_and_approval_flag` asserts
  `sc["request_schema"].is_object()` — an inlined schema is still an object, so it
  holds. The text channel is currently a JSON dump; no test asserts on it.
- **ITEM-8 deletes `handlers.rs::resolve_schema_ref`.** Its only caller is
  `validate_body`; its 4 unit tests (`validate_body_resolves_ref` et al.) must keep
  passing against the replacement resolver, which is a strict superset
  (multi-hop + recursive). One behavioural nuance: the old one FAILED OPEN on a
  dangling ref (returned the `{"$ref": …}` wrapper, so `validate_body` skipped
  validation). The new one substitutes a `$comment` placeholder, which is also
  not `type: object`, so `validate_body` still skips — behaviour preserved.
- **The `$defs` fallback changes nothing today.** Measured over the committed
  `openapi.json`: 140 operations carry a JSON body; the largest fully-inlined
  schema is `LlmModel.create` at 10,522 bytes / 11 expansions, the median is 349
  bytes, and **zero** schemas contain a cycle. So on the real spec every operation
  takes the plain inline path — the `$defs`/byte-budget machinery is a guard, and
  can only be proven by synthetic unit fixtures (TESTS.md budgets for exactly
  that). This is an honest limit of the integration tier, not a gap to hide.

## Pattern conformance

- **PASS** — `schema_has_secret_field_rec` (`sdk/crates/ziee-control-mcp/src/catalog.rs:235`)
  is the named reference for the recursive walk; the plan mirrors its
  resolve-then-descend shape and deliberately diverges on ONE point (a resolution
  stack instead of a blind depth-6 cap), with the reason stated: a truncating cap
  is right for a boolean probe and wrong for an emitted schema.
- **PASS** — `text_result(text, Some(structured))` is the established shape in the
  same file (`list_capabilities`, `invoke_capability`), and "readable digest in
  text + typed `structuredContent`" is the documented `web_search` retrofit
  convention.
- **PASS** — the tool-description regression guard mirrors
  `elicitation_mcp/tools.rs::description_documents_rich_conventions`; the nudge
  test mirrors the existing `apply_attach_sets_shared_flag_and_prepends_nudge`.
- **CONCERN → resolved in the plan** — where does the inliner LIVE? `catalog`,
  `policy` and `tools` were extracted into the `ziee-control-mcp` SDK crate, so
  "next to `resolve_schema_ref`" argues for the SDK. But the sole consumer is
  `describe_capability`, which `mod.rs:35-42` records as deliberately retained
  app-side in v1, and app-side code stays inside the ziee diff where the phase-6
  coverage law can see it. The plan puts the inliner app-side and keeps the SDK
  delta to the two things that can ONLY live there (the catalog builder and the
  static tool descriptors).

## Migration collisions

None. This branch adds no migration (see BASE.md). Migrations are per-module
here; the control module's only migration
(`202607146025_control_mcp_grant_permissions.sql`) is untouched.

## OpenAPI regen

**Not required.** No `#[derive(JsonSchema)]` type is added or changed and no REST
handler signature moves. `/api/control/mcp` is JSON-RPC returning an untyped
`axum::response::Response`, so neither the describe payload nor the tool
descriptors appear in `openapi.json` or `api-client/types.ts`. The
`types_ts_parity` golden test is therefore unaffected — it will be re-run at
phase 8 to prove it, not assumed.

Note the plan READS `src-app/ui/openapi/openapi.json` (to measure the 201/446
permission loss and the schema-size distribution); it never writes it.

## Cross-repo / submodule

**CONCERN (accepted, recorded).** ITEM-5 and ITEM-6 land in the `sdk` submodule,
so the branch carries a pointer bump to a locally-committed, unpushed SDK commit.
Precedent exists on this base (`chore(sdk): bump submodule → …`). Two
consequences the plan accounts for: (a) the orchestrator must push the SDK commit
too, and (b) the SDK's own hunks are invisible to `git diff base...HEAD` in the
ziee repo, so the phase-6 blind audit must be handed the SDK diff EXPLICITLY or
those lines go unreviewed.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — new file, no existing caller to break; mirrors
  `schema_has_secret_field_rec`'s traversal with a documented, justified
  divergence (stack vs depth cap).
- **ITEM-2** — verdict: PASS — pure degradation path over ITEM-1's output; dead on
  the real spec (no schema approaches the budget), so it is provable only by unit
  fixtures, which TESTS.md enumerates.
- **ITEM-3** — verdict: PASS — additive keys on `structuredContent`;
  `request_schema` stays an object, so the one existing assertion on it holds.
- **ITEM-4** — verdict: CONCERN — the digest must not become the model's only view
  of a NESTED body (INV-6). Mitigation is in the plan: walk nested properties
  recursively AND always emit the exact inlined JSON Schema alongside, never
  instead. Pinned by TEST-16 + TEST-24.
- **ITEM-5** — verdict: CONCERN — behaviour change on 201 operations (analysed
  under *Breakage risk*); correct, intended, and covered by TEST-13/14/22/23.
  Deliberately keeps `Operation.required_permission: Option<String>` and takes the
  FIRST permission of a multi-permission op, which is exact parity with what
  `parse_required_permission` does for the single-permission form; widening to a
  permission LIST is a separate change and is recorded as a decision, not silently
  taken.
- **ITEM-6** — verdict: PASS — text-only change to two static descriptors; guarded
  by a content regression test in the same file's existing style.
- **ITEM-7** — verdict: PASS — one sentence appended to `CONTROL_NUDGE`; the
  `ask_user` tool it names is ALWAYS attached on a tool-capable turn
  (`mcp/chat_extension/mcp.rs:303` puts the elicitation server in
  `auto_attach_builtin_ids` unconditionally), so the instruction can never point
  at a tool the model does not have.
- **ITEM-8** — verdict: PASS — removes a byte-identical duplicate; the 4 existing
  `validate_body` unit tests are the regression net, and the dangling-ref
  fail-open behaviour is preserved (analysed above).
