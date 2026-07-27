# HUMAN_FEEDBACK — control-mcp-e2e-coverage

No human feedback received.

This feature was executed autonomously from a written brief (recorded verbatim as
`DESIGN.md`); the owner has not yet reviewed the running feature. When they do,
each item goes here VERBATIM as an `FB-N` and is resolved before merge.

What to demonstrate at that review — the invariants, not the gate tally:

- **INV-1 / INV-2** — `TEST-12` (`control-spec-gating.spec.ts`, 5 assertions, no
  server needed) plus the run logs showing `control_mcp::real_llm_*` and
  `chat::title_real_llm` printing `provider=OpenAI model=qwen3.6-35b-a3b` instead
  of the SKIP they emitted on the base branch.
- **INV-3** — the discovery journey: the prompt names no operation id, and the
  assertion is on the recorded `list_capabilities` call.
- **INV-4** — `setupControlChat` sets `auto_approve` and reads it back FIRST, so
  the approval card appearing is caused by the control rule, not by the default.
- **INV-5** — approve → `GET /api/projects` / `/api/assistants` /
  `/api/memory/settings`; deny → unchanged, with the denied `operation_id` checked.
- **INV-6** — `User.delete` hidden from a user lacking `users::delete` (admin
  positive control), and `Project.create` refused by the real route with nothing
  created.
- **INV-7** — `"create project"` → `Project.create` first; the same test asserts
  the SHIPPED matcher scored 0, so it is a regression proof.
- **INV-8** — the real-LLM title test, demonstrated by re-running it against the
  pre-fix `title.rs` (it fails with the production error verbatim).
