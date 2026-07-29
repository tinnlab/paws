# DESIGN — Workflow builder: authoring UX + validation attribution

Source of intent: the owner's live-app review of `/settings/workflows/:id/edit`
(dark theme, a 5-step workflow with `tool_1` selected), 2026-07-27, plus the two
standing house rules it invokes:

- the feature-lifecycle **UI-surface plan checklist → Input economy**:
  *"never make the user type what the system can supply or pick… Collect a
  structured value via a form generated from the target's declared schema (one
  typed field per input), NEVER a raw-JSON textarea… Entity references →
  pickers."*
- `agent-kit/docs/DESIGN_SYSTEM.md` (semantic tokens, 4px rhythm, logical
  direction, `SectionHeader` for title-with-actions).

---

## §1 The job to be done

A person building a workflow wants to:

1. pick a server,
2. pick a tool **from that server**,
3. fill in **that tool's** arguments with typed fields,
4. know immediately **which steps are still incomplete and why**.

Today they must know the exact tool name from memory, invent argument keys, and
read a schema-key error that does not say which step it belongs to.

## §2 Non-negotiables

### §2.1 Human language, always
The person building a workflow is not reading YAML. A finding that says
`step has neither prompt: nor prompt_file:` is describing the wire format, not
their problem. **No raw schema/YAML key language ever reaches the person building
a workflow.**

The backend validator is right to be precise: it is a machine-readable contract
consumed by the install path, the MCP `validate_workflow` tool, and the run
launcher. Its `code` is already stable and machine-readable
(`ValidationError.code`, `validate.rs:355`). So the humanisation belongs at the
**presentation** boundary — the builder maps `code` (+ the step it points at) to
copy a person can act on — and the backend keeps its codes and its precise
messages untouched.

The guard that makes this real: a code with no human copy is a defect, and it
must fail a test, not ship.

### §2.2 A finding belongs to a step
The finding the owner is looking at concerns a *prompt*, which belongs to an
`agent_*` step — but it is rendered in a page-level list while `tool_1` is
selected. **Every validation finding names its step and can take the user to that
step**, and the step list shows which steps are invalid without the user clicking
each one.

### §2.3 Entity references are pickers
**An entity reference the system can enumerate is never a free-text field.**
Once a Server is chosen, its tools are enumerable over MCP `tools/list` — which
ziee already exposes as `GET /api/mcp/servers/{id}/tools`. The Tool field is
therefore a picker over that server's real tools, not an exact-name-from-memory
text box.

This is a general rule, not a tool-step rule: it applies to any field whose valid
values the system can list.

### §2.4 Arguments come from the tool's declared schema
An MCP tool declares its inputs (`Tool.input_schema`, a JSON Schema, returned by
the same endpoint). **Once a tool is chosen, its arguments are collected through a
form generated from that schema — one typed field per property, carrying
required/optional, type, default and description — never invented key/value
strings.**

### §2.5 Degradation is explicit, never silent
A server may be unreachable; a tool may declare no schema. In both cases the
author must still be able to finish the workflow. The fallback (free text /
key-value rows) is a **documented, visible escape hatch with a stated reason**,
never the default and never silent.

### §2.6 Templating survives
`{{ inputs.query }}` / `{{ step_id.output }}` is how a workflow threads values
between steps. **Templating keeps working in every generated field** — a typed
field must accept a reference where it would accept a literal.

## §3 Explicitly out of scope

- Changing any backend validation message, code, or severity.
- Any change to the run-time behavior of a workflow.
- Editing `src-app/ui/src/modules/scheduler/**` or
  `src-app/ui/src/modules/chat/components/rail/**` (sibling branches own them).
- Adding the builder routes to the 24/7 live-UI-audit rig (that file lives in the
  `agent-kit` submodule — a separate repo; see DECISIONS DEC-9).
