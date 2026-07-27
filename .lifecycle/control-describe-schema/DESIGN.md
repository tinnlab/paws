# DESIGN — control MCP: a self-contained capability contract, and a form-not-prose input flow

Status: design of record for the `control-describe-schema` fix round.
Scope: the built-in **control MCP** server (`control.ziee.internal`) only.

There was no prior design doc for these two defects — this doc IS the design
(written per the feature-lifecycle rule "if there is genuinely no prior design
doc, WRITE one first and name it"). It states the promises; PLAN.md realizes it.

---

## §1 The observed defects

### D1 — `describe_capability` hands the model an unresolvable pointer

Live output, verbatim:

```json
{ "operation_id": "Project.create", "method": "POST", "path_template": "/api/projects",
  "request_schema": { "$ref": "#/components/schemas/CreateProjectRequest" },
  "required_permission": null, "requires_approval": true, ... }
```

`describe_capability` exists for exactly one purpose: to tell the model the
**input contract** of an operation so it can build a valid `invoke_capability`
body. A bare `$ref` tells it nothing — the model has no access to
`#/components/schemas/*`; the OpenAPI document is a server-side, in-process
artifact. The model cannot see one field name, so it must guess the body, and a
guessed body fails `validate_body` or the real route's 400.

The `$ref` is not an accident of one route: `Operation.request_schema` is copied
verbatim out of the OpenAPI document, where schemars ALWAYS emits a `$ref` for a
named request type. So this is the behaviour for every operation with a JSON
body (140 of the 446 catalog operations).

### D1b — `required_permission` is silently lost on 201 of 446 operations

Same output: `"required_permission": null` for `Project.create`, which is
plainly gated (`projects::create`).

Mechanism: `catalog::build_catalog` parses the permission out of the operation's
**prose description**, which `with_permission` writes as
`**Required Permission:** \`projects::create\``. But `with_permission` is called
FIRST in every `_docs` builder, and any subsequent `.description("…")` in the
same builder **replaces** the whole string. Every route that documents its error
codes therefore loses its permission. Measured against the committed
`src-app/ui/openapi/openapi.json`: 408 operations declare a permission, only 207
still carry it in the description — **201 are lost**.

The permission survives, machine-readably, in the 403 response example that
`with_permission` also attaches
(`responses.403.content."application/json".example.details.required_permissions[].value`),
which no `.description()` can clobber.

Consequence: `user_may_run` treats `None` as "no permission declared → allow",
so the per-user visibility filter is a no-op on those 201 operations. This is
NOT a privilege escalation (the forwarded-JWT loopback call re-authorizes at the
real route), but it is a precision failure: the model is shown, and describes,
operations the user will be refused, and `describe_capability` reports a false
`null` contract.

### D2 — the model asks for input in chat prose instead of using `ask_user`

When a mutating operation needs fields the user didn't supply, the model writes
a questionnaire into the chat ("To get started: 1. What's the project name? …").
ziee already ships the right affordance: the always-attached built-in
`ask_user` tool, which renders a real form / Next-Back wizard from a JSON Schema
and returns the answers as the tool result. Nothing in the control surface tells
the model to use it, so it falls back to prose.

---

## §2 The promises (non-negotiable)

1. **A described capability is self-describable.** What
   `describe_capability` returns must be sufficient, on its own, for the model to
   construct a valid request body — no `#/components/schemas/…` pointer the model
   cannot dereference.
2. **Self-contained never means unbounded.** The described schema goes into the
   LLM's context window. It must be bounded, and it must degrade to a smaller
   but still-valid, still-self-contained JSON Schema rather than to invalid or
   silently-cut JSON.
3. **A recursive schema must terminate.** A self-referential or mutually
   recursive component may never hang, blow the stack, or expand forever.
4. **`describe_capability` reports the operation's REAL required permission.**
   The reported permission must be the one the route actually enforces, for
   every operation that declares one — never `null` because a doc string was
   overwritten.
5. **Ask with a form, not with prose.** When a mutating capability needs input
   the user has not supplied, the model collects it with `ask_user` — one field
   per schema property, pre-filled with a default where the schema or the
   context implies one — instead of asking for values in chat text.

---

## §3 The contract of the inlined schema

`request_schema` is a **self-contained JSON Schema**:

- Every `$ref` into `#/components/schemas/…` is resolved, recursively, through
  `properties`, `items`, `additionalProperties`, `patternProperties`,
  `prefixItems`, `not`, and the composition keywords `allOf` / `oneOf` / `anyOf`.
- **Cycle / depth / budget cut → `$defs`.** A reference that would re-enter a
  schema already on the expansion stack, or that exceeds the depth or expansion
  budget, is rewritten to `{"$ref": "#/$defs/<Name>"}` and the named schema is
  emitted into a sibling `$defs` object (itself ref-rewritten into `$defs`, to a
  fixpoint). `$defs` + `#/$defs/…` is standard JSON Schema 2020-12 and is
  resolvable by the recipient with no external document — so the result stays
  self-contained (promise 1) while terminating (promise 3).
- **Size cut → the compact `$defs` form.** If the fully-inlined form exceeds the
  byte budget, the whole schema is re-emitted in the compact form: the root with
  every ref rewritten to `#/$defs/…`, plus one `$defs` entry per reachable
  component. Each schema then appears exactly once. This is a graceful
  degradation, not a truncation (promise 2).
- **Dangling ref → a marker, never a lie.** A `$ref` naming a component that does
  not exist becomes `{"$comment": "unresolved $ref: <ref>"}` — a valid schema
  that constrains nothing and does not pretend the missing type was resolved.
- The transformation is **reported, not hidden**: `structuredContent` carries
  `schema_form` (`inline` | `defs`) and `schema_truncated`.

## §4 The text channel

`describe_capability` currently puts `serde_json::to_string_pretty(&structured)`
in the text channel — a stringified dump of the structured content. The repo
convention for a built-in tool (established by the `web_search` retrofit, see
CLAUDE.md "Live Literature Search") is: **a readable digest in the text channel,
typed `structuredContent` alongside — never stringified JSON as the text.**

So the text becomes a digest: the operation line, its permission and approval
requirement, its path/query parameters, and a per-field list of the request body
(name, type, required, default, enum options, description) — which is exactly
the material an `ask_user` form is built from — followed by the exact JSON
Schema.

**Nested structure is part of the contract, not noise.** Request bodies here are
routinely nested (an object property that is itself an object, an array of
objects, a `anyOf: [$ref, null]` nullable sub-object). The digest therefore
walks the body RECURSIVELY and lists the inner fields under their parent
(`parent.child`, `items[].child`), so the model sees the shape it must build —
not just the top-level key names. And the **exact inlined JSON Schema is always
emitted alongside the digest**, never in its place: the digest is a reading aid,
the schema is the contract, and any nesting the digest abbreviates must still be
recoverable in full from the schema block.

## §5 The guidance for D2

Short, because it is injected into every tool-capable chat. It must say the
rule, name the tool, and name the schema keys that make the form good
(`title`, `description`, `enum` + `enumNames`, and `default` — which the wizard
honours but the `ask_user` descriptor never mentions). It must NOT restate the
full `ask_user` schema vocabulary; that already lives in the `ask_user`
descriptor, which is always attached alongside on any tool-capable turn.
