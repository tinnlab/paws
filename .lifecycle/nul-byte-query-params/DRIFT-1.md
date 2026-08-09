# DRIFT-1 — implementation vs plan + design invariants

Authored DURING phase 5, item by item, as each landed.

- **DRIFT-1.1** — verdict: impl-wins — PLAN's `## Items` originally listed
  ITEM-1..ITEM-9 covering the three reported endpoints plus memory. The
  exhaustive `Query<..>` sweep run at plan time found **four more members of the
  same class** that the reported table never touched
  (`/conversations/{id}/messages/search?q`, `/background/runs?{status,kind}`,
  `/mcp/tool-calls?tool_use_id`, `/local-runtime/versions?engine`). PLAN.md was
  AMENDED before implementation (ITEM-10..ITEM-13 added, with per-item audit
  verdicts, and TESTS.md extended with TEST-19..TEST-22); phases 1-3 were
  re-gated green afterwards. Recording it here because "the sweep grew the
  scope" is exactly the kind of change that otherwise happens silently.

- **DRIFT-1.2** — verdict: none — `common::text_guard::normalize_text_filter`
  returns `Option<&'a str>` borrowed from the caller's input, but
  `project::handlers::normalize_search` had to keep returning
  `Option<String>` (its caller holds the value across an `await`). Resolved by
  `.map(str::to_string)` inside the project wrapper rather than by changing the
  shared helper's signature — one allocation, exactly where the old code
  already allocated (`.map(str::to_string)` was already there). No divergence
  from plan.

- **DRIFT-1.3** — verdict: plan-wins — first cut of `MessageSearchQuery`
  guarding put the check in `search_conversation_messages` (the handler) and
  left `trimmed_term()` infallible, because that was the smaller edit. That
  violates the design's §5 intent (the guard belongs AT the normalization
  boundary, so a second caller cannot bypass it) and would have re-created the
  very split being removed. Re-implemented per DEC-10: `trimmed_term()` itself
  is now fallible and IS the boundary.

- **DRIFT-1.4** — verdict: none — INV-4 (narrow, NUL-only) was checked against
  each landed call site rather than assumed: none of the five replaced sites
  gained a control-character or bidi check, and TEST-5 asserts eight distinct
  non-NUL control characters still normalize to a live term. The temptation to
  "harden while we're in here" was declined per DEC-3.

- **DRIFT-1.5** — verdict: none — INV-3 (defined once) is satisfied
  structurally: after ITEM-8, `grep -c "contains('\\0')"` over
  `server/src/modules/` is **0** — every remaining occurrence of the guard body
  is the single definition in `common/text_guard.rs`. TEST-6 asserts the three
  wrappers agree with it at runtime, so a future divergence fails rather than
  drifting quietly.

- **DRIFT-1.6** — verdict: resolved — two pre-existing unit tests
  (`project::handlers::normalize_search_trims_and_blanks_to_none`,
  `message::search_query_blank_term_is_none`) had to be edited for the now-
  fallible signatures. Their EXPECTATIONS are unchanged — only `.unwrap()` was
  added — which is the point: the fix must not move any valid input. Neither
  test was deleted (A5), and each gained a sibling asserting the new 400.

**Unresolved drifts:** 0
