# DESIGN — a model-supplied object argument that arrives JSON-encoded as a string

Status: design of record for the `ask-user-stringified-schema` fix round.
Scope: every **built-in MCP tool argument** that declares an object or array
shape, the elicitation ingress that carries `requestedSchema`, and the chat
frontend that renders the resulting form.

There was no prior design doc for this defect, so this doc IS the design (per the
feature-lifecycle rule "if there is genuinely no prior design doc, WRITE one
first and name it"). PLAN.md realizes it.

---

## §1 The observed defect

Reported from a live session. The model called the built-in `ask_user` tool with
`schema` as a **JSON-encoded string** rather than a JSON object:

```json
{
  "message": "What would you like to name this new project?",
  "schema": "{\"properties\": {\"name\": {\"title\": \"Project name\", \"type\": \"string\"}, \"description\": {\"title\": \"Brief description (optional)\", \"type\": \"string\"}, \"instructions\": {\"title\": \"System instructions for conversations in this project (optional)\", \"type\": \"string\"}}, \"required\": [\"name\"], \"type\": \"object\"}"
}
```

The owner's framing, verbatim: *"Sometimes llm request input with schema is a
string of json, but not json itself."*

This is a well-known and widely-documented LLM behaviour — nested-object tool
arguments get stringified, because the arguments themselves already travel as a
JSON string and a model routinely encodes one level too many. It is **not**
caller error to be punished; it is an input shape the tool must be robust to.

### §1.1 The mechanism

`src-app/server/src/modules/mcp/chat_extension/helpers.rs:302-305`:

```rust
let raw_schema = input
    .get("schema")
    .cloned()
    .unwrap_or_else(|| serde_json::json!({ "type": "object" }));
```

The value is taken as-is. When it is `Value::String("{…}")` it stays a string,
and every downstream stage degrades silently rather than failing:

1. the size guard (`helpers.rs:306-317`) passes — a stringified schema is small;
2. `cap_requested_schema` (`mcp/elicitation/models.rs:41-47`) hits its
   `other => other` arm — a non-object passes through **unchanged**;
3. `stamp_ask_user_marker` (`helpers.rs:216-224`) hits its `other => other` arm —
   the `x-ziee-askuser` marker is **not stamped**, so the frontend never even
   enters the rich decision UX;
4. the string is forwarded verbatim as `requested_schema` on both the
   `ElicitationStartedNotification` and the `mcpElicitationRequired` SSE frame;
5. the frontend does `schema?.properties || {}` on a **string primitive** →
   `{}` → it renders a card with a message, **zero fields**, and a working
   Submit button;
6. the user submits (or waits); `content: {}` goes back, or the turn blocks for
   the full 300s `ASK_USER_ELICITATION_TIMEOUT` and returns *"The user did not
   respond (cancelled or timed out)."*

At no point does anything — model, user, or operator — learn what went wrong.

### §1.2 It is a CLASS, not one call site

The same failure applies at every model-supplied object/array argument. An audit
of every built-in tool found these live instances, with materially different
(and mostly worse) symptoms:

| Site | Argument | Symptom today when stringified |
|---|---|---|
| `mcp/chat_extension/helpers.rs:302` | `ask_user.schema` | **the reported bug** — empty form, 300s block |
| `control_mcp/handlers.rs:1182` | `invoke_capability.query` | **silently dropped** — the loopback call runs with NO query params and returns a plausible 200 for the wrong query |
| `control_mcp/handlers.rs:1208` | `invoke_capability.body` | a JSON string literal is POSTed as the body; the real route 422s, so the model is blamed by the wrong layer |
| `control_mcp/handlers.rs:1147` | `invoke_capability.path_params` | typed `HashMap` → serde hard-fails naming the whole args blob |
| `citations/handlers.rs:294` | `format_citations.items` | **silent wrong answer** — the inline records are dropped and the user's ENTIRE library is formatted instead |
| `citations/handlers.rs:205` | `remove_citations.ids` | **silent no-op reported as success** — *"0 citation(s) deleted."* |
| `citations/handlers.rs:359` | `*_citations.items` | *"missing `items` array"* — a lie; `items` was present |
| `citations/models.rs:98` | `items[].csl` | **silent corruption** — the entry is stored with an empty CSL record |
| `background_mcp/tools.rs:171` | `spawn_background.spec` | *"spec.task must be a non-empty string"* — a lie; `task` was supplied |
| `workflow_mcp/tools.rs:381` | `run_from_workspace.inputs` | `WORKFLOW_INPUTS_NOT_OBJECT` from a helper literally named `coerce_inputs` that does not coerce |
| `knowledge_base/handlers.rs:144` | `search_knowledge.knowledge_base_ids` | serde hard error, losing an otherwise graceful fallback |
| `lit_search/handlers.rs` ×5 | `queries`/`ids`/`record_sets`/`decisions` | serde hard errors; nested elements silently `dropped`/`skipped` |
| `mcp/client/http.rs:710,1861,2257` | `elicitation/create.requestedSchema` | same empty form — but the producer is an EXTERNAL server, not the model |

**There is no shared helper anywhere in the repo** for this. Every one of these
sites re-derives its own (mostly wrong) handling.

### §1.3 The second half of the defect: nobody is told anything

Distinct from "the value was not decoded" is "the failure is invisible". Today:

- **The model** gets either silence, a misleading error naming the wrong field,
  or a serde message about the whole args blob. It has no way to learn that the
  problem is one level of encoding, so it repeats the same malformed call.
- **The user** gets a card that *looks answerable* — message, Submit, Decline —
  with nothing to fill in. Submitting passes an empty zod object and POSTs
  `content: {}` as if they had answered.
- **The operator** gets nothing in the logs.

The server even mints a diagnostic for one case —
`cap_requested_schema` replaces an oversized schema with
`{"type":"object","properties":{},"x-ziee-error":"requested schema exceeded the
1 MiB limit and was dropped"}` — and **the frontend never reads `x-ziee-error`**
(zero hits across `src-app/ui/src`). The reason exists and is thrown away.

### §1.4 A latent render crash on the same input path

`ElicitationFormContent.tsx:149` is `new Set(schema?.required || [])`. `required`
is guarded against *falsy*, not against *non-iterable*. A model emitting
`"required": 3` throws `TypeError: number is not iterable` **during render**. The
extension registry's try/catch (`chat/core/extensions/registry.tsx:957-963`)
wraps element *creation*, not render, and there is no error boundary over message
content — so the chat tree blanks. Same untrusted-input surface, so it is fixed
here.

---

## §2 The promises

### §2.1 Decode what the model meant

A model-supplied argument that declares an object or array shape and arrives as a
JSON-encoded string is decoded to the value the model meant, at **every** such
argument of every built-in tool — not only at `ask_user`.

### §2.2 Never invent a value

Coercion decodes; it never substitutes. A string that does not decode to the
DECLARED shape (it is not JSON at all, or it decodes to a number, array, bool or
null where an object is required) is **refused**, never silently accepted as the
argument and never replaced by a default that hides the mistake.

### §2.3 Bounded unwrapping

Models occasionally encode twice. Unwrapping is therefore repeated, but bounded
by a compile-time constant. Model- and server-controlled input can never drive an
unbounded loop or unbounded allocation.

### §2.4 The size guard stays authoritative in BOTH forms

The existing `MAX_STRUCTURED_CONTENT_BYTES` guard exists because the schema is
rendered into a form by the browser, so an unbounded schema is a DoS vector, and
because `cap_requested_schema` replaces an oversized schema with a tiny
error-marker object — so the guard must run on the ORIGINAL value, BEFORE the
cap, or it would never see the real size. That reasoning is preserved exactly.
It is extended so a payload over the limit is refused whether it is over the
limit **encoded** (a 2 MB string) or **decoded** (an object that inflates past
the limit).

### §2.5 Every rejection is actionable

Every rejection path — new and pre-existing — returns feedback that states three
things:

1. **what was received** — the actual type/shape, naming the argument;
2. **what is expected**;
3. **a concrete corrective example the model can copy**, shown as literal JSON,
   not described in prose.

The quality bar is the existing size-cap message — *"ask_user 'schema' is too
large (N bytes; limit M). Send a smaller schema."* — which names the value, the
limit, and the corrective action. Every other error path reads like that one.

Because the actionable text is produced by the shared helper, every call site
inherits it; a site does not get to ship a worse message.

### §2.6 The trust property of the rich-UX marker is unchanged

`x-ziee-askuser` flips the frontend into the rich `ask_user` decision UX and is a
**trust signal**. It is stripped from every untrusted ingress by
`cap_requested_schema` and re-stamped ONLY by the ziee-internal `ask_user` path,
AFTER that strip. No external MCP server can forge it. Decoding a string into an
object must therefore happen **before** the strip, never after.

### §2.7 The user is never shown a card that lies

A user is never shown an elicitation card that looks answerable but is not. When
no field can be rendered, the card says so and offers a real choice, and when the
server supplied a reason (`x-ziee-error`) that reason is shown.

### §2.8 No regression on the shapes that already work

A well-formed object argument passes through byte-identically. An absent
argument behaves exactly as before (`ask_user` still defaults to
`{"type":"object"}`). Nothing about the existing happy path changes.

---

## §3 What is coerced, and what deliberately is not

Coercion is applied **per named argument, at arguments that declare an object or
array shape**. It is emphatically NOT a recursive walk that reparses every string
in the payload: a `run_js` script, a citation title, or a search query may
legitimately be a string whose text happens to look like JSON, and rewriting it
would be a far worse bug than the one being fixed.

### §3.1 The external-MCP-server ingress (`requestedSchema`)

`mcp/client/http.rs` receives `elicitation/create.requestedSchema` from an
external server over JSON-RPC. That is a **protocol** boundary, not a model
boundary — a server that stringifies it is violating SEP-1330.

The decision is to **coerce there too, AND log the violation**, rather than
either silently repairing it or leaving the user with the broken form:

- coercing is *safe* — the decode happens before `cap_requested_schema`'s
  marker-strip, so §2.6 is untouched;
- it is *one edit inside `cap_requested_schema`* rather than three copies, so all
  three ingress points and the internal `ask_user` path share one behaviour;
- the user's experience of a non-conformant server is otherwise identical to the
  reported bug, and the user cannot fix somebody else's server;
- and a `tracing::warn!` naming the violation means we are **not masking** it —
  the operator and the server's author get a loud, specific diagnostic.

"Repair silently" and "leave it broken" are both worse than "repair and shout".

### §3.2 The elicitation RESPONSE path

Checked, as required. `POST /api/mcp/elicitation/{id}/respond` takes
`content: Option<Value>` (`mcp/elicitation/models.rs:63-69`). Our own frontend
always sends an object (`resolveElicitation` is typed
`content?: Record<string, unknown>`), so the reported LLM behaviour cannot
produce this — but the REST route accepts **any** `Value` from any API consumer,
and a string would reach the model double-encoded through
`ask_user_tool_result`'s `serde_json::to_string(&content)`, and would be POSTed
back to an external MCP server as a non-conformant JSON-RPC result.

So the same rule is applied at that ingress: an `accept` whose `content` is a
JSON-encoded object is decoded; a `content` that is present and cannot be an
object is refused with an actionable 400. Absent content, and `decline`/`cancel`,
are untouched.

### §3.3 A schema with no renderable fields — degraded-but-valid, with ONE exception

Decided explicitly, because "the form would render zero fields" is its own dead
card:

- **Absent `schema`** (defaults to `{"type":"object"}`) — **valid**. This is the
  pre-existing contract and §2.8 forbids changing it. It means "no fields, just
  accept or decline", which is a real answer.
- **An external server's zero-property schema** — **valid**. MCP elicitation
  legitimately expresses a pure confirmation this way, and we do not get to
  reject another implementation's conformant request.
- **`ask_user` with an EXPLICITLY supplied object schema that has no non-empty
  `properties`** — **an error**. `ask_user`'s own contract is *"each entry in
  `properties` is ONE question"* and `schema` is a required argument; a model
  that built a schema and produced no questions has made exactly the mistake
  this design exists to correct, and it can retry immediately with a real field.

In the two valid cases the frontend must not render a dead card — see §2.7 — so
it renders an explicit no-fields confirmation state instead of an empty form with
a Submit button that fabricates an answer.

---

## §4 Where the shared helper lives

`src-app/server/src/common/tool_args.rs`, exported from `common/mod.rs`.

`common/` is the right home over `utils/`: `common/tokens.rs` is the exact
precedent — a small, pure, domain-neutral, unit-testable helper shared across
modules — whereas `utils/` has drifted toward I/O and network infrastructure
(`url_validator.rs`, `http_body.rs`, `cancellation.rs`, `git/`). Everything under
`src-app/server/src` is one crate, so `crate::common::tool_args` is reachable
from every module that needs it.

The helper owns the coercion rules AND the actionable message text (§2.5), so
correctness and message quality are single-sourced.

---

## §5 Non-goals

- No recursive/blanket reparsing of string values (§3).
- No change to any REST type, so no OpenAPI regen.
- No new permission, table, or migration.
- Fixing `src-app/agent-core/tests/real_llm_loop.rs`, which does not compile on
  the untouched base (see BASE.md) — out of scope, and another workstream's file.
