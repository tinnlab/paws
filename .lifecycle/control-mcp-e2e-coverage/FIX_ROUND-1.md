# FIX_ROUND-1 — fixes from the first blind multi-angle audit

Four blind sub-agents reviewed the diff across 17 angles (correctness, security,
error-handling, concurrency, perms/authz, api-contract, state-management,
patterns-conformance, tests-quality, perf, i18n/copy, modularity, extensibility,
maintainability, api-friendliness, design-conformance, wired-and-behaving). The
confirmed findings are in `LEDGER.jsonl`; what was DONE about each:

## Product defects introduced by the change (fixed)

- **`thinking: Some(ThinkingConfig::disabled())` was a live Gemini regression.**
  Verified against the adapters: `gemini.rs` emits `thinkingConfig{thinkingBudget:0}`
  for ANY `Some(thinking)` (no capability check), which models that cannot
  disable thinking reject with a 400 — soft-swallowed by this very extension,
  leaving every conversation untitled. The exact bug being fixed, reintroduced
  for another provider. `thinking` is now left UNSET, with the three adapters'
  actual behavior documented; TEST-5 asserts `req.thinking.is_none()`.

- **The query was not normalized the way the corpus is.** `"project,"` /
  `"mcp-settings"` matched nothing, and under the ALL-terms rule one dead term
  empties everything. `query_terms` now splits on ALL non-alphanumerics, exactly
  like `id_segments`/`summary_words`.

## Test defects — assertions that could not fail (fixed)

- **The approval invariant was asserted by a tautology.** A brand-new
  conversation defaults to `manual_approve`, so the card appears for EVERY tool:
  deleting the control force-approval rule entirely would have left TEST-14/15/16
  and the Rust `real_llm_write_requires_approval` all green. `setupControlChat`
  now PUTs `approval_mode: auto_approve` and READS IT BACK before the chat opens.

- **TEST-18 added no discriminating power** — it asserted an `invoke_capability`
  ROW exists, which the preceding project-count assertion already implies. It now
  asserts the tool RESULT landed on the conversation transcript (`tool_result` +
  `tool_use` content blocks), which is what "the chat reflects it" means.

- **`listJson` returned `[]` on a non-OK response**, so every negative assertion
  ("deny → nothing created", "restricted user → no project") was satisfied by a
  403/500 on the verification GET. It now throws.

- **TEST-17(a) could pass with the control surface entirely broken** for the
  restricted user (an error body yields `[]`, and the describe assertion accepted
  any error including the `control::use` rejection). It now asserts the user
  genuinely REACHES the surface, and that a PERMITTED op's schema still resolves
  — so the refusal is provably the permission filter, not a broken tool.

- **TEST-1/2/3 ranked through a retyped copy** of the production filter +
  comparator. Production now exposes `rank_matching_ops`, and the tests drive it.

- **The gating guard was evadable** by a line-wrap, a hoisted
  `const HAS_X = process.env…`, or a spec in a subdirectory. It is now
  whole-file (comment-stripped) and recursive, and additionally asserts the seam
  can resolve every vendor the harness supports.

## Seam correctness (fixed)

- The committed `sk-xxx` placeholder resolved as "an LLM is configured" and
  SHADOWED a real Anthropic key → `is_placeholder_key` (a placeholder WITH a
  bridge base-URL is still usable).
- Only OpenAI+Anthropic resolved while the repo's own `get_or_create_ai_provider`
  supports four → `VENDOR_SEAMS` now carries all four in both languages, so the
  "no LLM configured at all" message is true when it is printed.
- The vendor table + a PARALLEL defaults array (drift → `model_name: ""`) became
  one `VendorSeam` struct; `TestLlm` now carries `key_env` instead of two call
  sites re-deriving it.
- `should_retry_with_larger_budget`'s `title` argument was dead on the production
  path; the caller now passes the real value.
- `stub_chat` counted and pushed under separate lock acquisitions (two concurrent
  title calls would both see `prior == 0`); now one acquisition.
- `list_capabilities` recomputed the searchable text per (op × term) → `OpIndex`,
  built once per op and skipped entirely on the no-query path.

## Coverage gaps (closed)

- The settings operation class had an approve leg but no DENY leg → added, using
  a whole-settings-JSON baseline (a list-length baseline cannot express it).
- The NOT-OFFERED authorization proof sat behind the LLM skip gate although it
  drives only JSON-RPC + REST → split into its own describe block, always runs.
- A zero-result `list_capabilities` told the model nothing → it now states the
  ALL-terms rule, echoes the parsed terms, and suggests the `tag` argument.

## Explicitly NOT fixed (recorded, with reasons)

- **The SDK tool description** (`sdk/crates/ziee-control-mcp/src/tools.rs`) still
  describes the pre-fix `query` semantics. `sdk/` is a git SUBMODULE; changing it
  would add a submodule pointer bump to a branch that is otherwise a clean
  fast-forward. The equivalent guidance is delivered app-side in the zero-result
  text instead. Recorded `confirmed-out-of-scope`.
- **~30 other real-LLM Rust tests still gate on `ANTHROPIC_API_KEY`.** The design
  scoped this feature to the control surface (+ the title bug); converting 16
  other files is a separate, mechanical change. Recorded
  `confirmed-out-of-scope` so it is visible rather than implied-fixed.
- **The matcher's placement** (app-side `handlers.rs` vs the `ziee-control-mcp`
  SDK crate) — argued both ways by the auditor; kept app-side per DEC-1 (it
  composes with the app-side per-user permission filter, and moving it would
  bump the submodule). Recorded `rejected` with the rationale.

**New confirmed findings:** 12

(The 12 are what the SECOND blind round then found on the fixed diff — including one
defect introduced by round 1 itself. They are fixed in `FIX_ROUND-2.md`.)
