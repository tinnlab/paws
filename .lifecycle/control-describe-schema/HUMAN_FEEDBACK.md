# HUMAN_FEEDBACK — control-describe-schema

One piece of human feedback was received, mid-task, while the design was being
written. Recorded verbatim.

- **FB-1** [status: resolved] — "they might have nested schema, and it needs to show that to the model, so keep that in mind" → Folded into the design before any code was written, as DESIGN §4's "Nested structure is part of the contract, not noise" paragraph and lifted into **INV-6**, then pinned by three executable tests. Concretely: (a) the inliner resolves refs reached only through nested `properties` / `items` / composition keywords, so a nested type's leaf fields survive into the emitted schema (TEST-2, TEST-5); (b) the digest walks the body RECURSIVELY and names inner fields under their parent — `settings.loop_limit`, `members[].user_id`, and the non-null branch of a nullable `anyOf` wrapper (TEST-16, acceptance); (c) the exact inlined JSON Schema is ALWAYS emitted alongside the digest, never in its place, so anything the digest abbreviates past its depth cap is still recoverable in full (TEST-19, acceptance). The digest also emits an explicit "deeper fields omitted from this summary — see the JSON Schema below" marker rather than trailing off silently, which the blind audit flagged as the remaining way a nested body could read as complete when it wasn't. [generalizable: yes — when a tool's output is a CONTRACT the model must satisfy, a flattened or depth-capped summary of it is a defect unless the exact, complete form travels with it AND the summary says where it was cut; the summary is a reading aid, never the contract]

## Not yet reviewed by the owner

The feature has NOT been demonstrated to the owner against its acceptance tests.
Per the phase-9 rule, the sign-off that matters is each `INV-N` shown with the
`[acceptance]` test that proves it — not a gate tally:

- **INV-1** (self-contained) → TEST-5 (unit, zero `#/components/` + every leaf
  present) and TEST-21 (integration, swept across 250+ live operations)
- **INV-2** (bounded, degrades to valid) → TEST-10
- **INV-3** (recursion terminates) → TEST-7 (self-referential), TEST-8 (mutual)
- **INV-4** (the REAL permission, never null) → TEST-23, backed by TEST-26's
  catalog-wide invariant and TEST-27's ALL-of gate
- **INV-5** (ask with a form, not prose) → TEST-17 (descriptor guard) and
  TEST-25, the real-LLM e2e that is the actual proof
- **INV-6** (nesting visible + exact schema alongside) → TEST-16, TEST-19 —
  the invariant this feedback created
