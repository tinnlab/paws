# DECISIONS — the `ask_user` stringified-schema fix

Every human/product input the implementation needs, resolved up front so phase 5
runs without stopping. Basis is `convention` (an unambiguous codebase precedent),
`codebase` (a fact read out of the tree), or `user` (the owner's stated brief).

---

### DEC-1: Where does the shared coercion helper live?
**Resolution:** `src-app/server/src/common/tool_args.rs`, declared in
`common/mod.rs`. NOT `utils/`, and NOT a per-module copy.
**Basis:** convention — `common/tokens.rs` is the exact precedent (a small, pure,
domain-neutral, unit-tested helper hanging off `common/mod.rs`), whereas `utils/`
holds I/O and network infra (`url_validator.rs`, `http_body.rs`,
`cancellation.rs`, `git/`). `modules/mcp/utils/` was rejected: `mcp/mod.rs:24`
declares it as a PRIVATE `mod utils;`, so it is unreachable from `citations`,
`lit_search`, `control_mcp`. The brief's instruction was explicitly "prefer ONE
shared, tested helper over N copies … look for an existing `common/`/`utils` home
rather than inventing a location."

### DEC-2: What happens to a string that parses to a NON-object?
**Resolution:** REFUSED with a clean tool-result error carrying
received/expected/example. Never silently accepted, and never replaced by the
call site's default.
**Basis:** user — the brief: "Only accept the coercion when the parsed result is
a JSON **object**. A string that parses to a number/array/bool must NOT silently
become the schema — decide and document what happens (clean tool-result error is
fine; the model can retry)." Recorded as INV-2 so it is test-pinned.

### DEC-3: How many nested string-encodings are unwrapped?
**Resolution:** `MAX_STRING_UNWRAPS = 2` — a single and a double encoding are
unwrapped; a third layer is REFUSED with an error naming the bound. Implemented
as a bounded repetition, never a `while let`.
**Basis:** user + convention — the brief requires handling double-encoding while
bounding the unwrap on attacker/model-controlled input. Two covers every
observed real case (one layer is the reported bug, two is the occasional
double-stringify); anything deeper is far more likely to be adversarial or
nonsense than a model's honest mistake, and refusing it is cheap and observable.

### DEC-4: Is the size guard measured on the encoded form, the decoded form, or both?
**Resolution:** BOTH, in that order — the RAW value is measured first and
rejected before it is ever parsed (so a 2 MB string never reaches
`serde_json::from_str`), then the DECODED value is measured. Both against
`MAX_STRUCTURED_CONTENT_BYTES`, both BEFORE `cap_requested_schema`, preserving
the existing comment's reasoning verbatim.
**Basis:** user — the brief: "a 2 MB *string* must still be refused, and so must
a small string that inflates into a huge object. Measure so that BOTH are caught,
and keep the existing `MAX_STRUCTURED_CONTENT_BYTES` semantics + the comment's
reasoning about measuring BEFORE `cap_requested_schema`."

### DEC-5: Is the size guard's ORDER (raw first) load-bearing, or incidental?
**Resolution:** Load-bearing, for two independent reasons, and both are recorded
in the code comment: (a) it preserves the existing invariant that the guard must
see the ORIGINAL size, because `cap_requested_schema` swaps an oversized schema
for a tiny error-marker object; (b) it means an oversized string is refused
without allocating its parse, which is the memory half of INV-3.
**Basis:** codebase — `helpers.rs:298-301` states reason (a) explicitly; reason
(b) is new with this change.

### DEC-6: The "oversized *inflated* object" leg is provably unreachable for JSON — ship it anyway, or drop it?
**Resolution:** SHIP the guard, but do NOT write a test that fabricates an
inflating input (no such input exists). Test the leg as the ORDERING INVARIANT
`len(serialize(encoded)) >= len(serialize(decoded))` plus a real
oversized-ENCODED rejection (TEST-12).
**Basis:** codebase — a JSON-encoded string of a value is always longer than the
value's own serialization (added quotes + escaped inner quotes) and JSON has no
expansion primitive (no YAML-style anchors/aliases), so the raw-first check
already subsumes the decoded one. Keeping the second measurement costs one
serialization and makes correctness independent of that argument holding;
fabricating a test for an unreachable branch would be a cosmetic always-true
assertion and would fail the A4 gate on its merits. Surfaced rather than
silently dropped, per the audit-vs-decision rule.

### DEC-7: Do we coerce `requestedSchema` from EXTERNAL MCP servers, or refuse to mask a protocol violation?
**Resolution:** COERCE **and** log a `tracing::warn!` naming the SEP-1330
violation — repair AND shout. One edit inside `cap_requested_schema` covers all
three `mcp/client/http.rs` ingress points plus the internal `ask_user` path.
**Basis:** user + codebase — the brief asked for a deliberate decision here. The
three candidate positions were: (i) leave it broken (the user experiences the
reported bug and cannot fix somebody else's server); (ii) repair silently (hides
a real server bug from its author); (iii) repair and warn. (iii) dominates: the
user's form works, the operator and the server author get a loud specific
diagnostic, and the security property is untouched because the decode is ordered
BEFORE the marker strip (INV-6, pinned by TEST-19). Recorded in DESIGN §3.1.

### DEC-8: Does the elicitation RESPONSE path need the same treatment?
**Resolution:** YES, at the API ingress. `POST /api/mcp/elicitation/{id}/respond`
decodes a string-encoded object `content` on `accept`, and refuses a `content`
that cannot be an object with an actionable 400. Absent `content`, `decline` and
`cancel` are untouched.
**Basis:** user + codebase — the brief asked us to check. Our own frontend can
never produce it (`resolveElicitation` is typed
`content?: Record<string, unknown>`), so this is NOT the reported LLM behaviour —
but the REST route accepts any `Value` from any API consumer, and a string would
reach the model double-encoded via `ask_user_tool_result`'s
`serde_json::to_string(&content)` and be POSTed to an external MCP server as a
non-conformant JSON-RPC result. Hardening a public ingress with the same one rule
is cheaper than documenting an exception.

### DEC-9: Is a schema with no renderable fields an ERROR or a degraded-but-valid case?
**Resolution:** BOTH, split by origin, and stated explicitly:
- an ABSENT `schema` (defaulting to `{"type":"object"}`) → **valid**;
- an EXTERNAL server's zero-property schema → **valid**;
- `ask_user` with an EXPLICITLY supplied object schema that has no non-empty
  `properties` → **an error**, with an example showing one property.
In the two valid cases the FRONTEND renders an explicit no-fields confirmation
state rather than an empty form with a Submit that fabricates `content: {}`.
**Basis:** user + codebase — the brief required a decision and a statement. The
split is forced by two constraints that would otherwise conflict: the brief's
"preserve current behaviour … for a missing schema (defaults to
`{"type":"object"}`)" (so absent cannot be an error), and MCP elicitation
legitimately expressing a pure confirmation with zero properties (so an external
server's version cannot be refused). What remains — a model that was REQUIRED to
send a schema, sent one, and produced no questions — is exactly the malformed
case this feature exists to correct, and `ask_user`'s own descriptor says "each
entry in `properties` is ONE question".

### DEC-10: Is coercion recursive over the whole payload?
**Resolution:** NO. Coercion is applied per NAMED argument, only at arguments
whose tool descriptor declares `type: object` or `type: array`, plus the one
named nested field `items[].csl`. No blanket walk.
**Basis:** convention — a `run_js.script`, a citation title, or a search query
may legitimately be a string whose text looks like JSON; rewriting it would be a
worse bug than the one being fixed. PLAN_AUDIT lists the descriptor line proving
the declared shape for each coerced argument, and lists the scalar arguments
deliberately left alone.

### DEC-11: Which sibling call sites are in scope?
**Resolution:** ALL of them — `ask_user`, `cap_requested_schema` (covering the
three external ingress points), `invoke_capability` (`body`/`query`/`path_params`),
citations (`items`/`ids`/`csl`), `background_mcp.spec`,
`workflow_mcp::coerce_inputs`, `knowledge_base.knowledge_base_ids`, and the five
`lit_search` array arguments. None deferred.
**Basis:** user — the brief: "Generalize — this is the important half." Because
DEC-1 centralizes both the rules and the message text, each additional site is a
one-line application plus a unit test, so breadth is cheap; and two of the
sibling sites (`format_citations.items`, `remove_citations.ids`) are SILENT
WRONG ANSWERS, which are more dangerous than the reported bug itself.

### DEC-12: `run_js` — in scope?
**Resolution:** NO, deliberately. `run_js`'s only argument is `script: string`
(`js_tool/tools.rs:31-40`), a genuine string that will routinely contain
JSON-looking text.
**Basis:** codebase — checked, not assumed (the brief said "check, don't
assume"). Note `js_tool/host_bridge.rs:163-166` lets a script re-enter every
other built-in tool, so a script calling `ziee.tools.ask_user({schema: "…"})`
reaches the fixed sites anyway — the fix belongs in the callee, and is there.

### DEC-13: Is the actionable-error requirement satisfied per call site or centrally?
**Resolution:** CENTRALLY. The helper owns the received/expected/example message
construction; the call site supplies only its literal-JSON example. A call site
cannot ship a weaker message.
**Basis:** user — the owner's requirement that "every rejection path must return
a tool result whose text states three things". Across 13 sites, per-site message
authoring would drift immediately; TEST-8 pins the triple at the helper.

### DEC-14: How is the end-to-end fix proved — real LLM or a scripted stub?
**Resolution:** A DETERMINISTIC e2e is the acceptance proof (TEST-37): an
in-worker OpenAI-compatible fixture registered as a `custom` provider emits an
`ask_user` tool call with the reported stringified schema, and the spec asserts
real form fields render. A real-LLM leg (TEST-38) is kept as a conditionally
gated no-regression check.
**Basis:** convention + codebase — a real model cannot be made to stringify on
demand, so a real-LLM test of the stringified case would be a coin flip and
would rot into a flaky skip. The in-worker-HTTP-fixture pattern is established:
`tests/e2e/llm/helpers/repository-health-mock.ts` exists for exactly this reason
("the probe runs server-side (Rust → reqwest), so `page.route()` can't intercept
it"), and `custom` providers accept a loopback `base_url` under the `DEV_LOCAL`
SSRF policy (`llm_provider/utils.rs:47`). Response shapes port from
`server/tests/common/stub_chat.rs:777-855`.

### DEC-15: Is the real-LLM e2e allowed to be skipped?
**Resolution:** It carries a CONDITIONAL env gate only —
`test.skip(!TEST_LLM, NO_LLM_SKIP)`, matching its sibling
the sibling real-LLM control spec (`src-app/ui/tests/e2e/control/`, the `…for-input` spec, line 33). Never an unconditional `.skip`, and
never a skip added to make a red test green.
**Basis:** user + convention — the brief states a conditional env gate is allowed
by the A3 check and an unconditional one is not; the sibling spec uses exactly
this form.

### DEC-16: Are any operational tunables introduced (the mandatory configurable-settings DEC)?
**Resolution:** ONE — `MAX_STRING_UNWRAPS`. It ships as a **fixed compile-time
constant**, NOT an admin-configurable settings row. `MAX_STRUCTURED_CONTENT_BYTES`
is reused unchanged and is likewise already a constant.
**Basis:** convention — the lifecycle rule defaults tunables to admin-configurable
and permits a fixed constant "ONLY with an explicit rationale (e.g. a security
boundary that must not be operator-weakened)". This is precisely that case: the
bound exists to stop model/server-controlled input driving unbounded unwrapping
and allocation (INV-3). Making it operator-tunable would let an admin weaken a
DoS boundary for no product benefit — there is no plausible deployment that wants
a different value, because 2 already covers every honest encoding mistake. It is
declared as a named `pub const` (not an inline magic number) so it can be promoted
later without a rewrite, per the same rule.

### DEC-17: Does anything here need an OpenAPI regen?
**Resolution:** NO. No `#[derive(JsonSchema)]` shape changes; every touched tool
surface is JSON-RPC served from an untyped `axum::response::Response`;
`requested_schema` and `content` are already `serde_json::Value` and keep those
types.
**Basis:** codebase — verified per type in PLAN_AUDIT's "OpenAPI regen" section.
If implementation proves otherwise, the drift log records it and the regen runs
for BOTH binaries (`just openapi-regen`).

### DEC-18: Phase 0 / A1 fails with 18 `.lifecycle` feature dirs — remove the other 17?
**Resolution:** NO. Leave them. Record the A1 failure as a pre-existing,
INHERITED condition of the `origin/feat/agent-core` base and verify before every
commit that this branch DELETES none of them
(`git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD -- .lifecycle`
must be empty).
**Basis:** codebase — A1 assumes a branch cut from `main`, where the merge-hygiene
rule strips `.lifecycle/` at merge. This base never merges to main, so the dirs
accumulate. Sibling branches on the same base hit this identically and resolved
it the same way (`.lifecycle/control-describe-schema/DECISIONS.md:150-158`
records it at 17). Deleting other features' artifacts to satisfy a structural
counter would destroy their audit trail.

### DEC-19: Is `src-app/agent-core/tests/real_llm_loop.rs` (which does not compile on the base) fixed here?
**Resolution:** NO. Recorded in BASE.md as a pre-existing baseline breakage,
reproduced on the untouched base before any edit. Backend verification is scoped
to `-p ziee`, which compiles clean.
**Basis:** convention — rule B3 forbids editing shared/other-workstream code to
route around a problem, and this branch does not touch `src-app/agent-core`.
Reported to the orchestrator rather than silently absorbed.

### DEC-20: What is the frontend's no-fields state allowed to DO?
**Resolution:** It shows (a) the assistant's message, (b) an explanatory notice —
the server's `x-ziee-error` reason when present, otherwise a plain statement that
this request has no fields to fill in — and (c) the two real choices: Decline
(the safe default) and an accept action explicitly labelled as sending no values.
It never renders an empty `<form>` with an unqualified Submit.
**Basis:** user + convention — the owner's requirement that "the chat surface
needs to show something meaningful rather than an empty shell"; the notice mirrors
`WorkflowElicitForm.tsx:462` (`wf-elicit-alert`) and the copy voice mirrors the
existing `cancelled` card at `ElicitationFormContent.tsx:271`. Accept is kept
(rather than disabled) so a legitimate zero-field CONFIRMATION elicitation from an
external MCP server remains answerable — but it is labelled honestly, which is the
difference between a real choice and a card that lies.

### DEC-21: How is TEST-38's "needs a real LLM" requirement expressed — a skip, or a failure?

**Resolution:** An UNCONDITIONAL precondition —
`expect(TEST_LLM, NO_LLM_SKIP).toBeTruthy()` inside the test — NOT the
`test.skip(!TEST_LLM, NO_LLM_SKIP)` guard TESTS.md enumerated at phase 3. The
spec always registers and always runs; on a box with no LLM configured at all it
FAILS, naming the exact env vars to set.

**Basis:** convention + gate. The lifecycle rule is explicit and mechanical
(`lifecycle-check.mjs::checkA3`, SKILL.md: "no diff-added `#[ignore]`/`.skip`/
`.only`; only genuine platform-incompatibility is a legit skip"). "No LLM is
configured" is a MISSING DEPENDENCY, not a platform incompatibility — the
dependency can be supplied on any box, and on this one it was: the leg was run
against the local Qwen bridge (`ZIEE_TEST_LLM_BASE_URL` + `ZIEE_TEST_LLM_MODEL`)
and PASSED in 24.8s.

This is the same failure mode `control-spec-gating.spec.ts` was written to end,
one level up. That guard stops a spec skipping because ONE VENDOR's key is
absent; it still permits a skip when nothing is configured, and a real-LLM leg
that self-skips is counted as covered while proving nothing — exactly the
"covered by tests that never execute" defect this whole feature exists to close
(see TEST_GAP_ANALYSIS.md). Failing loud makes the gap visible instead of
invisible, which is strictly the safer direction for a NO-REGRESSION check: a
silent skip means a real regression ships unnoticed.

**Tradeoff, stated plainly:** a box with no LLM configured now sees this spec RED
rather than SKIPPED. That is intended — it is a true statement about coverage.
The deterministic acceptance proof for the same surface (TEST-37) needs no LLM
and is unaffected, so the feature never depends on a bridge being present to be
verified at all.

**TESTS.md was amended in place** (the TEST-38 line records the amendment and
points here) rather than left to disagree with the code. The test-ID, tier and
assertion are unchanged; only the mechanism by which the dependency is enforced
changed, and it changed to be STRICTER.
---

## Descoped items

None. Every PLAN ITEM (1-18) is implemented and covered by an enumerated TEST;
see TESTS.md's coverage map. No `[DESCOPED]` dispositions are required.
