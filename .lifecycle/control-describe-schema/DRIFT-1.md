# DRIFT-1 — implementation vs plan / design

Authored DURING phase 5, as each item landed.

- **DRIFT-1.1** — verdict: impl-wins — **The plan scoped inlining to the request
  BODY; the operation's `parameters` carry `$ref`s too.** The catalog-wide sweep
  (TEST-21) failed on `Hub.getManifest`, whose query parameter is
  `{"schema": {"$ref": "#/components/schemas/HubCategory"}}` — a component
  pointer reaching the model on an operation with no body at all. DESIGN §2.1
  says "no `#/components/schemas/…` pointer the model cannot dereference", full
  stop, and a query parameter is as much part of the input contract as a body
  field, so the design always required this; the PLAN under-scoped it.
  Implementation now inlines each parameter's `schema`
  (`handlers.rs::inline_parameter_schema`) and the digest renders query
  parameters from the inlined copy, including their enum options. PLAN ITEM-3
  amended; phases 1–3 re-run. Worth noting the mechanism: this was found by the
  SWEEP, not by the hand-picked `Project.create` — a single-operation test would
  have shipped the hole.
- **DRIFT-1.2** — verdict: impl-wins — **The digest read "optional" for a field
  that is mandatory in practice.** `CreateProjectRequest` declares no
  JSON-Schema `required` array (serde supplies the default) but constrains
  `name` with `minLength: 1` and `default: ""`. The planned digest therefore
  rendered `- name (string) default=""`, from which a model reasonably concludes
  it may omit the name — the exact failure mode this feature exists to end, just
  moved one step later. Implementation adds a compact constraint hint
  (`constraint_label`: `len 1..255`, `>=0`, `format=uuid`). PLAN ITEM-4 amended;
  the integration assertion asserts the constraint rather than a `REQUIRED`
  marker the schema does not actually carry.
- **DRIFT-1.3** — verdict: resolved — **TEST-21's claim was narrowed to what it
  can actually prove.** As written it claimed to sweep "EVERY operation that has
  a JSON request body". There is no endpoint that enumerates the catalog
  (`list_capabilities` caps at `MAX_LIST_RESULTS = 200` of 442), so the spec now
  states what the test does: the union of an unfiltered page and 14 topic
  queries, asserted to cover ≥250 distinct operations of which ≥40 carry a body.
  TESTS.md updated to match the assertion; no TEST-ID removed.
- **DRIFT-1.4** — verdict: none — ITEM-1/2/5/6/7/8 landed as planned. Notably the
  budget machinery is inert on the real spec (TEST-22 asserts every real
  operation reports `schema_form: "inline"`, `schema_truncated: false`), which is
  what the plan predicted from the measurement and why the unit fixtures carry
  the degradation proof.
- **DRIFT-1.5** — verdict: resolved — the catalog reports **442** operations at
  runtime, not the 446 counted from the committed `src-app/ui/openapi/openapi.json`.
  The artifact is the UI-facing spec and the runtime document is built from the
  live router, so a small delta is expected; every ratio the plan quotes
  (201 lost of 408 declaring) is a measurement of the artifact and is labelled as
  such. No behaviour depends on the count.

**Unresolved drifts:** 0
