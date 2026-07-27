# FIX_ROUND-2 — fixes from the second (full, blind) audit round

Two blind sub-agents re-audited the FIXED diff across the same 17 angles. The
round found real defects — including one introduced by round 1's own fix — so it
was not a formality.

## The round-1 fix that was itself wrong (fixed)

- **The best-effort "match ANY term" fallback degenerated into "return the
  catalog."** Measured by the auditor against the real 446-operation catalog:
  `"please set up a project"` kept **362 of 394** permitted operations and did not
  put `Project.create` in the top five; the single term `"a"` substring-matched
  **407** operation ids. The model would have been handed ~200 operations
  (~10k tokens) for an ordinary sentence. Worse, the two tests that claimed to
  guard relevance (`take(3)`/`take(5)` + `starts_with("Project.")`) passed against
  exactly that misbehavior — 6 of 8 fixture ops and 17 real ops share the prefix.

  **The fallback is removed.** Natural phrasing is handled query-side instead,
  which is both smaller and testable:
  - `QUERY_STOPWORDS` — a tiny closed-class list (`a`, `the`, `please`, `for me`,
    …). Domain words (`new`, `list`, `default`) are deliberately NOT included:
    they are signal.
  - `MIN_SUBSTRING_TERM_LEN = 4` — short terms may still match EXACTLY (segment /
    tag / summary word), never as a substring.
  `rank_matching_ops` is now strict ALL-terms only, and its doc comment records
  why the fallback was tried and removed so it is not re-added.

- **The same short-substring rule produced a confidently WRONG destructive
  answer.** `"delete a project"` strictly matched exactly ONE operation —
  `Citations.delete` ("Delete an entry from the library") — because `"a"` occurs
  in `citations.delete` but nowhere in `project.delete`. A model asked to delete a
  project would have been shown a single, confident candidate that deletes a
  bibliography entry. Now covered by a REAL-catalog integration assertion
  (`delete a project` → `Project.delete` first, plus `delete the project` and
  `update a project`), which fails on the round-1 code.

## Also fixed this round

- **The title retry ran unbounded on the user-visible path.** Title generation is
  awaited inline in `after_llm_call`, so with the escalated retry a pathological
  model could hold the turn open for two full generations (the provider client's
  timeout is per-READ, so a slow-but-alive stream is effectively unbounded). Each
  attempt now has a 60s wall-clock bound; a timeout is a soft failure like any
  other and a later turn retries.
- **A KEYLESS local bridge resolved to "no LLM configured at all"** — a
  self-hosted OpenAI-compatible server needs no credential, so requiring a vendor
  key was precisely the false skip this seam exists to eliminate. `ZIEE_TEST_LLM_BASE_URL`
  + `ZIEE_TEST_LLM_MODEL` now resolve on their own (both languages), with a unit
  test.
- **The deny rows never checked WHICH operation was denied** — a turn where the
  model invoked something else, or nothing, passed identically. They now assert
  the recorded `invoke_capability` arguments carry the intended `operation_id`
  (`recordedInvokedOperations`).
- **The real-LLM title test would have accepted the ORIGINAL regression** (the raw
  user message persisted as the title, 27 chars, non-empty). It now asserts the
  title is not the user's own message.
- **The TEST-17(a) liveness probe depended on the catalog's permission gap** — it
  asserted "some operations came back" for a query whose hits happen to be
  unfiltered ops. It now probes an operation the user demonstrably HOLDS
  (`Project.list` via `projects::read`), so it stays valid however the catalog's
  permission coverage changes.
- **The spec codified a pre-existing catalog gap as intended design.** The catalog
  reads `required_permission` from a `**Required Permission:**` marker that a
  handler's own `.description(...)` overwrites, so ~206 of 446 genuinely-gated
  operations report `null` and the "not offered" layer cannot hide them. The
  comments now name it as a KNOWN GAP (not introduced here) and explain that this
  is exactly why BOTH authorization halves are tested rather than treating "not
  offered" as sufficient. Recorded in `LEDGER.jsonl` as
  `confirmed-out-of-scope` — fixing it means changing the SDK submodule's
  permission/OpenAPI plumbing.
- **The Rust Tier-4 approval test named the operation id in its prompt**, so it
  would have passed straight through the search bug it sits next to. The prompt no
  longer names it (discovery is required), and the test tolerates the model
  declining ONCE — the assertion itself is unweakened, and the flake was observed
  only under `--test-threads=4` against a loaded shared bridge (it passed 2/2 in
  isolation).
- **The negative-permission UI journey asserted an invoke it cannot compel.**
  Whether a 35B local model attempts the write is its decision, not the product's;
  that assertion failed 3/3. The REFUSAL is now proven deterministically by a
  sibling test that drives `invoke_capability` straight at the JSON-RPC surface
  (and therefore runs with no LLM at all); the UI journey asserts the control
  surface was genuinely exercised (`list_capabilities` recorded) and that nothing
  was created. Neither test is vacuous, and the comment says which proves what.

## Verified clean by this round (no action)

- The permission filter still runs FIRST and unconditionally; ranking can never
  surface an operation the caller may not run.
- The retry runs exactly once when (no text ∧ budget exhausted) and zero times
  otherwise; a provider error propagates before any retry.
- `stub_chat`'s non-overridden paths are byte-identical after the `finish_reason`
  refactor.
- No OpenAPI regen implied: no `JsonSchema` type, route, handler signature,
  permission or `SyncEntity` changed, and `list_capabilities` is MCP JSON-RPC.
- Test isolation is sound: `testInfra` is per-test (own database + locked ports),
  so the user-level `PUT /api/mcp/defaults` write cannot leak across specs;
  `resolve_test_llm` mutates no process env.
- `setAutoApproveDefault` is genuinely load-bearing (`ApprovalMode::default()` is
  `ManualApprove` on this branch) and its read-back matches the real response
  shape.

**New confirmed findings:** 9

(Count from the THIRD blind round, run on the diff after these fixes — including a
round-2 "strengthening" that made two tests unsatisfiable. Fixed in
`FIX_ROUND-3.md`.)
