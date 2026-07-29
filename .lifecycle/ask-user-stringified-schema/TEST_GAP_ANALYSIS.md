# TEST_GAP_ANALYSIS — why the suite did not catch this

`ask_user` is a shipped, tested built-in. A stringified `schema` reached a live
session, rendered a dead card, and blocked the turn for 300 seconds — and every
test passed. That is a defect in the SUITE, and it is the more valuable finding,
because the same blind spot is protecting other bugs right now.

Every claim below carries a file:line citation, taken from the tree at
`origin/feat/agent-core` (`d53db2d11`) BEFORE this branch's changes.

---

## 1. What tests existed over `ask_user`'s argument handling

This is **not** an untested-code case. `mcp/chat_extension/helpers.rs` carries a
substantial `#[cfg(test)]` block that exercises `schema` directly, plus
`mcp/elicitation/models.rs` covers the ingress cap. Inventory:

| Test | File:line | What it covered |
|---|---|---|
| `ask_user_empty_message_is_error` | `helpers.rs:912` | empty `message` refused |
| `ask_user_no_sse_returns_no_session_marker` | `helpers.rs:931` | the no-stream path |
| `ask_user_oversized_schema_is_rejected_before_stamping` | `helpers.rs:990` | oversized schema refused before the marker stamp |
| `ask_user_within_cap_schema_gains_marker` | `helpers.rs:1010` | the cap→stamp composition marks the schema |
| `stamp_ask_user_marker_stamps_objects_idempotently_and_skips_non_objects` | `helpers.rs:948` | stamp is idempotent; **non-objects pass through** |
| (elicit-notify path) | `helpers.rs:1090` | notification carries the schema |
| `ask_user_oversized_schema_is_rejected_before_persist` | `helpers.rs:1296` | prompt-injection / DoS guard |
| `ask_user_normal_schema_passes_the_size_guard` | `helpers.rs:1326` | negative control for the cap |
| (timeout / cancel mapping) | `helpers.rs:1362` | response → tool-result mapping |
| `ask_user_oversized_schema_is_error` | `helpers.rs:1397` | the cap again, end-to-end |
| `cap_requested_schema_*` ×4 | `models.rs:105,124,163,174` | pass-through, oversize drop, boundary, **forged-marker strip** |

Eleven tests touching the exact argument that broke.

## 2. Why they all passed — confirmed, with evidence

**The hypothesis handed down was correct, and I confirmed it rather than
accepting it.** Every `schema` fixture in `helpers.rs` is constructed with
`serde_json::json!({ … })` — a well-formed OBJECT:

```
helpers.rs:912   json!({ "message": "   ",           "schema": { "type": "object" } })
helpers.rs:931   json!({ "message": "Pick a color",  "schema": { "type": "object" } })
helpers.rs:990   json!({ "message": "Pick one",      "schema": oversized })      // json!({type,properties})
helpers.rs:1090  json!({ "message": "Pick a color",  "schema": { "type": "object" } })
helpers.rs:1296  json!({ "message": "Fill this in",  "schema": hostile_schema }) // json!({type,properties})
helpers.rs:1326  json!({ "message": "Pick a color",  "schema": schema })         // json!({type,properties})
helpers.rs:1362  json!({ "message": "Pick a color",  "schema": { "type": "object" } })
helpers.rs:1397  json!({ "message": "Pick",          "schema": schema })         // json!({type,properties})
```

Eight fixtures. **Zero** pass a string. The `cap_requested_schema` tests are the
same (`models.rs:106-118`, `:125-141`, `:164-166`, `:175-181` — all `json!({…})`).

### The principle

> **The tests encoded the AUTHOR's mental model of the input, not the real
> distribution of inputs.**

A programmer writing a fixture reaches for `json!({...})`, because that is what a
correct schema *is*. A language model emits a JSON string, because the arguments
are already a JSON string and one extra encoding is the single easiest mistake to
make. Nobody wrote the shape they never pictured, so no assertion could fail.

Notably the fixtures were NOT lazy — they include an oversized 1 MB schema, a
prompt-injection payload (`"IGNORE ALL PREVIOUS INSTRUCTIONS …"`, `helpers.rs:979`)
and a forged trust marker. The author thought carefully about **hostile** inputs.
They just never thought about **malformed** ones. Adversarial imagination and
distributional imagination are different skills, and this suite had only the first.

## 3. The sharper mechanism the hypothesis did NOT name

There is a second, worse mechanism, and it is the finding of this analysis.

The suite did not merely OMIT the string case. It **tested it and ratified the
bug** — `helpers.rs:948-971`:

```rust
/// … and leaves a non-object schema untouched (never panics).
fn stamp_ask_user_marker_stamps_objects_idempotently_and_skips_non_objects() {
    …
    // Non-object schemas pass through unchanged (no panic).
    for v in [
        serde_json::json!("just a string"),     // ← THE BUG, as a fixture
        serde_json::json!([1, 2, 3]),
        serde_json::Value::Null,
    ] {
        assert_eq!(stamp_ask_user_marker(v.clone()), v);
    }
}
```

`json!("just a string")` **is** the defect's input shape. It was fed in, and the
test asserted the broken outcome was correct. The production comment agreed
(`helpers.rs:213-215`, verbatim before this branch):

> *"a non-object schema (which the FE renders as an empty form anyway) is
> returned unchanged so this can never panic"*

The parenthesis names the exact user-visible symptom — an empty form — and files
it as acceptable.

### Why a careful test still ratified it

The test asserted a LEAF FUNCTION's LOCAL contract ("don't panic") in place of
the END-TO-END OUTCOME ("the user gets a usable form"). Both are legitimate
questions; only one of them is the product. A unit test of a leaf can be
perfectly correct and still certify a broken system, because it never asks what
the leaf's tolerance *means* one layer up.

This is the same failure as asserting `isError == true` without asserting the
message is useful to the model: **asserting the mechanism instead of the
outcome.**

## 4. The CLASS of test that was missing, and what was added

A test pinned to the owner's exact payload would close this bug and let the next
variant through — a double-encoded schema, a stringified `items`, a stringified
`body`. So the fix is a **class**, not a case.

**`common::tool_args::conformance`** (`src-app/server/src/common/tool_args.rs`) is
one canonical distribution of model-emitted argument shapes — well-formed,
stringified, double-encoded, over-the-unwrap-bound, decodes-to-wrong-type,
not-JSON, wrong-type-outright, absent, explicit-null — driven through a call
site's OWN extraction by `assert_arg_conformance`. Every coerced site adds one
call and inherits the whole distribution instead of one author's imagination of
it. It also asserts every refusal is ACTIONABLE (names the argument, states what
is expected, carries a copyable example), which is the outcome-not-mechanism
half.

Crucially the battery is guarded against being a tautology
(`conformance_battery_is_red_on_the_shipped_behaviour_and_green_on_the_fix`): it
is driven against a closure reproducing `helpers.rs:302-305` verbatim — the code
as it shipped — and **must panic**. A battery that passes on the defect would
prove nothing, and the defect is precisely what the old suite passed on.

### Ranked by "would this have caught THIS bug before it shipped?"

| Test | Would have caught it | Why |
|---|---|---|
| conformance battery, applied at `ask_user` | **YES** | shape #2 of the distribution IS the reported input |
| conformance battery, applied at the other 8 sites | **YES** | would have caught the `invoke_capability` twin at the same moment |
| anti-tautology check (battery red on shipped behaviour) | **YES** (by construction) | it is defined as failing on the pre-fix code path |
| `ask_user_string_schema_never_reaches_the_marker_stamp` | **YES** | the end-to-end assertion the isolated leaf test traded away |
| the reported-payload regression test | YES, for this exact payload only | necessary, not sufficient — it is the case, not the class |
| the e2e through a scripted LLM stub | **YES** | proves the user-visible outcome, not just the decode |
| oversized/forged-marker tests (pre-existing) | no | orthogonal properties; kept as regression guards |

## 5. Where else the blind spot applies — where the next instance is hiding

Every site below reads a model-supplied object/array argument. The column that
matters is whether its EXISTING tests share the object-only-fixture weakness.

| Site | Existing tests use object-only fixtures? | Symptom that was hiding there |
|---|---|---|
| **`invoke_capability.body`** — `control_mcp/handlers.rs:1208` | **YES** — `handlers.rs:1406-1433` `validate_body_*` fixtures are all `json!({"username":"a"})`; no string body anywhere | the prime suspect, as predicted: a stringified body was POSTed as a JSON string literal and the real route answered 422, blaming the wrong layer |
| **`invoke_capability.query`** — `handlers.rs:1182` | **YES** — no test at all for a non-object `query` | worse than the reported bug: **silently dropped**. The loopback call ran with NO query params and returned a plausible 200 for the wrong query |
| **`invoke_capability.path_params`** — `handlers.rs:1147` | **YES** | serde hard-fail naming the whole args blob |
| **`format_citations.items`** — `citations/handlers.rs:292` | **YES** — no degenerate-shape fixture | **silent wrong answer**: the inline records vanished and the user's ENTIRE library was formatted |
| **`remove_citations.ids`** — `citations/handlers.rs:205` | **YES** | **silent no-op reported as success** — *"0 citation(s) deleted."* |
| **`items[].csl`** — `citations/models.rs:98` | **YES** | **silent corruption** — the entry was stored with an empty CSL record |
| **`spawn_background.spec`** — `background_mcp/tools.rs:171` | **YES** | a misleading error: *"spec.task must be a non-empty string"* when `task` WAS supplied |
| **`coerce_inputs`** — `workflow_mcp/tools.rs:381` | **PARTIALLY — and instructively.** `tools.rs:1412-1416` DOES pass a non-object (`json!("nope")`) — and, exactly like the `stamp_ask_user_marker` test, asserts the reject is correct, pinning a function named `coerce_inputs` as one that does not coerce | `WORKFLOW_INPUTS_NOT_OBJECT` |
| **`search_knowledge.knowledge_base_ids`** — `knowledge_base/handlers.rs:144` | **YES** | serde hard error that ALSO destroyed the graceful fallback to conversation-attached KBs |
| **`lit_search`** ×5 — `lit_search/handlers.rs:178,435,503,591,755` | **YES** | serde hard errors; nested elements silently counted `dropped`/`skipped` |
| **`requestedSchema`** — `mcp/client/http.rs:710,1861,2257` | **YES** — `models.rs` fixtures are all `json!({…})` | the identical empty form, from a non-conformant external server |

Two sites (`workflow_mcp::coerce_inputs`, `stamp_ask_user_marker`) show the
*ratification* pattern rather than the *omission* pattern — a degenerate input
was supplied and the broken behaviour was asserted as the contract. Those are
harder to find than a missing test, because the coverage looks complete.

## 6. The rule worth generalising beyond this feature

1. **A fixture set is a hypothesis about the input distribution.** When the
   producer is a language model, the author's hypothesis is wrong by default:
   models emit shapes programmers do not picture. Test the producer's
   distribution, not the consumer's expectation.
2. **A leaf's tolerance is not a system's correctness.** When a unit test asserts
   "handles a weird input without panicking", something must also assert what
   that weird input MEANS at the surface the user sees — otherwise the tolerance
   silently becomes the bug.
3. **Asserting `isError` is asserting the mechanism.** The outcome is whether the
   caller can act on it. For a model-facing error that means naming what was
   received, what is expected, and showing a copyable example — and asserting
   the TEXT.
