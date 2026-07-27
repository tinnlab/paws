# FIX_ROUND-3 — fixes from the third (convergence) blind round

A blind convergence round re-audited the twice-fixed diff across all 17 angles,
porting the shipped matcher to a script and running it over the REAL 446-operation
catalog. It confirmed the previous rounds' fixes are real, and found more — one of
them a test that could never pass.

## HIGH — a "strengthening" from round 2 made two tests unsatisfiable

Round 2 made the deny rows assert that the recorded `invoke_capability`
arguments named the intended `operation_id`. But a DENIED tool is never executed:
`mcp_tool_calls` rows are written only from `McpSession::call_tool`, and the
denial path only synthesizes an error `tool_result` block
(`McpToolCallStatus::Cancelled` is declared but never constructed anywhere in the
tree). So the row the assertion polls for cannot exist, and the two deny rows
would have failed at the 60s poll on every LLM-configured box.

**Independently confirmed by running it**: the e2e run
(`control-e2e-main.log`) failed those tests 3/3 with `retries: 2`, at
`control-tool-in-chat.spec.ts:318`.

The operation identity is now read off the **approval card**
(`[data-testid="approval-tool-args"]`), which is where it demonstrably exists at
deny time — so the assertion is both satisfiable and still discriminating (a turn
proposing a different operation, or none, fails it). The same assertion was added
to the settings deny row.

## MEDIUM — a wrong, DESTRUCTIVE operation ranked first

With a pure `operation_id` ASC tie-break, `"delete user"` ranked
`LitSearch.deleteUserKey` FIRST — above `User.delete` — because both score 16 and
`L` sorts before `U`. A model asked to delete a user was handed a destructive,
unrelated key-deletion as its top candidate. (`"create workflow"` likewise put
`Hub.createSystemWorkflowFromHub` above `Workflow.create`.)

Ranking now breaks ties on **specificity — fewest UNMATCHED id segments** before
falling back to alphabetical: `User.delete` leaves 0 of 2 segments unmatched,
`LitSearch.deleteUserKey` leaves 3 of 5. Covered by a unit test on a fixture
built from exactly those three real operations, and by a REAL-catalog integration
assertion.

## MEDIUM — natural phrasings still returned zero

Measured on the real catalog: `"create a new project called Foo"`,
`"create a project named Bar"`, `"turn off memory retrieval"`, `"set up a
project"` all returned **0** — and the first two are literally the phrasings this
feature's own e2e prompts use. Cause: `called` / `named` / `Foo` are content
words, not stopwords, so the ALL-terms rule let a filler noun veto a query that
named its operation exactly.

Fixed by **dropping terms absent from the catalog's entire vocabulary**
(`retain_known_terms`). This is not the removed any-term fallback: a term that
matches nothing anywhere carries no information (nothing could ever have matched
it), and every term that IS in the vocabulary must still match. If NO term is
known the result stays empty — the model gets the retry guidance, never the
catalog. Three unit tests plus a real-catalog integration assertion pin all three
properties (helps, still narrows, still returns nothing when nothing is known).

## MEDIUM — short single-term queries regressed against the design

`MIN_SUBSTRING_TERM_LEN` was applied unconditionally, so single-term lookups lost
hits the shipped matcher found (`"git"` 4→0, `"key"` 5→2, `"cpu"` 2→0) — a direct
violation of "keep single-term behavior at least as good as today", and the
parity test could not see it because every sampled term was ≥4 characters. The
minimum now applies only to MULTI-term queries (where a short term dilutes a
conjunction); the parity test samples short terms too.

## MEDIUM — the real-LLM title test's window was too small for its own subject

It polled 20s after the turn, while the failure it exists to catch is a model
that spends ~1000 reasoning tokens per attempt and may take an escalated retry
(each bounded at 60s). A slow-but-correct run would have failed with the "this is
the production bug" panic — a misleading red. The window now covers the worst
case the fix permits.

## LOW (fixed)

- `should_retry_with_larger_budget` treated a MISSING `finish_reason` as
  "do not retry"; bridges that omit it on the terminal chunk would have silently
  kept the pre-fix behavior. An empty answer with no stated reason is
  indistinguishable from starvation, and being wrong costs ONE call.
- The zero-result guidance did not fire when a `tag` filter (not the query)
  emptied the result, so it blamed the query; it now names the tag.
- A duplicated doc-comment line; a test name that overclaimed
  ("…even after the user approves") relative to its assertions.

## Recorded, NOT fixed (unchanged from round 1's list)

- The SDK `query` tool descriptor still says "free-text filter" — `sdk/` is a
  submodule; the app-side zero-result guidance carries the equivalent message.
- ~206 of 446 catalog operations lose their `required_permission` because a
  handler's `.description(...)` overwrites the marker. Pre-existing, in the SDK's
  OpenAPI plumbing, and now named as a KNOWN GAP in the spec that would otherwise
  read as endorsing it.
- ~30 other real-LLM Rust tests still gate on `ANTHROPIC_API_KEY`.
- The matcher's app-side placement (DEC-1).

**New confirmed findings:** 0
