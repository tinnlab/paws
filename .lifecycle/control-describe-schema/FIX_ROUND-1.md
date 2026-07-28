# FIX_ROUND-1 — merging the four blind audit rounds

Four blind reviewers, diff-only context (both the ziee diff and the `sdk`
submodule diff, since the gitlink bump hides the SDK hunks from
`git diff base...HEAD`), across 17 angles: correctness · security ·
error-handling · perf · perms/authz · api-contract · tests-quality ·
patterns-conformance · design-conformance · wired-and-behaving · modularity ·
extensibility · maintainability · api-friendliness · state-management ·
concurrency · a11y · i18n/copy · dead-code.

55 findings in `LEDGER.jsonl`. Four HIGH, all real, all fixed.

## The finding that matters

**The first fix was incomplete, and its tests could not have told me.** Reading
the permission from the 403 example closed the `.description("…")` clobber (201
operations) but not the second one: a handler that attaches its own
`.response_with::<403, …>` replaces the whole response object and takes the
example with it. 34 operations still resolved to `null`, **18 of them genuinely
permission-gated** — `Skill.delete`, `Workflow.update`, `Workflow.import`,
`Project.attachConversation`, `File.getRaw`, `LlmModel.listRepositoryFiles`, and
the ADMIN-ONLY `McpServerToolApprovals.set`. `user_may_run` reads `None` as "no
permission declared → anyone may run it", so those stayed offered to every
`control::use` holder.

Two independent reviewers found it. My own tests never could: TEST-23/24 checked
`Project.create` and `Project.update`, both of which happen to sit in the subset
the 403 fallback DID fix. The suite was green across the entire residual class.

Fixed at the producer, not the reader: `with_permission` now stamps an
`x-required-permissions` OpenAPI extension, which nothing else writes and no
`_docs` builder can overwrite. **429 of 446 operations declare a permission; the
residual 17 are verified genuinely public** (auth, health, first-run setup, the
token-bearing download, the local-LLM proxy). This reverses DEC-6, which deferred
the producer-side change on blast-radius grounds — the audit showed the
reader-side fix is structurally unable to close the class. DEC-14 records the
reversal.

And the gap that let it through is closed too: **TEST-26 is a catalog-wide
invariant** — no operation may report `null` outside an explicit public
allow-list — swept over 250+ live operations.

## The other three HIGH

- **A breaking existing spec the diff did not touch.**
  `control-negative-perm.spec.ts` asserts, deliberately, that `Project.create`
  is STILL offered to an unpermitted user, documenting the null-permission gap
  as a KNOWN GAP. Closing the gap makes it fail deterministically. Its (b) leg
  is re-anchored on the loopback refusal — the real gate, which does not depend
  on the visibility filter — and now asserts the operation is correctly hidden.
  Three stale prose claims corrected.
- **A regression risk on six existing approve/deny specs.** An unqualified
  "collect missing values with `ask_user`" lets the model raise a form for
  OPTIONAL fields on an already-actionable request, blocking the turn so the
  approval card never appears. The nudge is now scoped to REQUIRED,
  non-inferable values and tells the model to proceed past optional ones.
- **Multi-permission under-gating.** `first()` gated the 5 ALL-of operations on
  one permission. The full list is carried and `user_may_run` requires every one
  (TEST-27 proves holding one of a pair does not unlock the operation). DEC-7,
  which chose parity-with-the-old-behaviour, is reversed — the extension carries
  the whole set, so the reason for the compromise is gone.

## Confirmed by running, not by reading

The real-LLM e2e failed on both attempts — and the failure was exactly the
finding the a11y reviewer wrote: the card DID render (first assertion passed),
but `input, textarea, [role=radio], [role=checkbox]` matches none of the
wizard's `Switch` / `Select` / `DatePicker` renderers. The backend log shows
`Parsed as MCP content: "ToolUse(ask_user)"` — the fix works; the test's
selector did not. Now selects the per-field testid, asserts the form asks for the
project name, drops the ordering constraint on discovery (asking before
discovering is legitimate and `ask_user` blocks the turn), and declines the
elicitation instead of leaving a generation task blocked.

## Also fixed

`compact_form`'s hard-cap loop could GROW the document (the estimate ignored key
overhead, and past a placeholder-sized entry every iteration increased the
total while the break was never taken) · sibling keys beside a `$ref` were
merged unwalked, so a subschema-bearing sibling smuggled a component pointer
through · a deferred ref dropped the annotations the expand path preserves ·
`form` was derived from "root has a `$defs` key" rather than from what was
deferred, misreporting both ways · a ref-free schema over budget was relabelled
`defs` with no `$defs` · `serialized_len` failed toward `usize::MAX`, which both
forced the compact path and broke the elision arithmetic · a dead `elided` map ·
the digest was unbounded while the schema beside it was budgeted (and the budget
measured COMPACT bytes for a pretty-printed channel) · the digest printed
`default=""` beside `len 1..255`, re-supplying the "I may omit this" conclusion
the constraint existed to remove · float bounds dropped by `as_i64` ·
`pattern`/`minItems` never surfaced · query parameters got no constraints ·
"(none declared)" asserted something false · three overclaims in model-facing
prose ("fully resolved", "filtered to what the user may do", the rule stated
three times against DESIGN §5's "short").

## Recorded, NOT fixed — with the reason

Each is in `LEDGER.jsonl` with `status: accepted`. None is a silent drop.

- **Secret-gate reach asymmetry** (medium, security). The new walker traverses
  ~20 keywords to depth 12; `schema_has_secret_field_rec` stops at depth 6 over
  5 keywords, so a secret field reachable only through the wider set would be
  spelled out to the model without policy denial. **0 live instances verified**
  on the shipped spec by two reviewers independently. Widening the probe changes
  a security gate's blast radius across every operation and belongs in its own
  reviewed change, not appended to this one.
- **`MAX_EXPANSIONS` counts refs, not bytes**, so a fan-out DAG is unbounded in
  peak memory until the post-hoc size check. The input is the app's OWN
  in-process OpenAPI document — a robustness bound, not a security boundary.
- **`handlers.rs` is ~1,940 lines** against §9's 800. The digest renderer is
  genuinely generic and belongs beside `schema_inline`; extracting it now would
  churn the entire surface the four audits just reviewed. Follow-up.
- **The SDK still carries a duplicate `resolve_schema_ref`**, and
  `schema_inline` arguably belongs in the SDK crate (DEC-8 chose app-side for
  diff-visibility). Both are one change with the reach-symmetry work above.
- **Latent traversal gaps with 0 live instances**: draft-07 `dependencies`,
  `contentSchema`, `discriminator.mapping` (plain strings, not `$ref`); a
  source-declared `$defs` shadowing a deferred component; `rewrite_refs_to_defs`
  rewriting a `$ref`-shaped DATA value; `schema_type_label` labelling a scalar
  `$ref` as "object"; `inline_parameter_schema` no-opping on the `$ref`/`content`
  parameter forms. Each verified absent from the shipped spec.
- **Per-call memoization** of the inlined schema (the catalog is immutable for
  process lifetime). Max real schema ~10 KB; TEST-21's 250 sequential describes
  finish in seconds.
- **A deterministic middle tier for the guidance half.** The description-content
  tests are tautological with the literals this commit added, so everything
  behavioural rests on the non-deterministic real-LLM e2e. A stub-engine test
  asserting the model-visible prompt + tool set for a no-args mutating request
  is the right shape and is a follow-up.
- **A true negative assertion** ("no prose questionnaire in the transcript") on
  the e2e. The run shows the model opens the form INSTEAD of prose, but
  asserting the ABSENCE of prose reliably needs a transcript-shape helper this
  spec should not invent.

## Round outcome

Every HIGH and every medium whose fix is contained in this feature's own surface
is fixed and re-tested. The accepted items are recorded above and in the ledger
with their reasons, none of them load-bearing for INV-1..INV-6.

A full re-audit round has NOT been run against the fixed tree — this file
records round 1 only.

**New confirmed findings:** 0
