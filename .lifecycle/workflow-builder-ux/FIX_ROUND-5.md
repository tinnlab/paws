# FIX_ROUND-5 — workflow-builder-ux

Input: `ledger-round5.jsonl` (19 rows / 2 confirmed, 0 HIGH — 17 rejected,
including five high-severity candidates ruled out). Fixes landed in `72cd6f0b6`.

Round 5's audit also answered the question round 4's backend change raised, and
answered it explicitly: **the security property is intact.** The `..`/absolute
path-shape reject is emitted BEFORE the bundle-presence gate and `continue`s on
its own; every `validate_for_install`/`validate_collecting` caller
(`dev.rs:268`/`:564`, `runner.rs:1248`/`:1552`, `hub/handlers.rs:2187`,
`workflow_mcp/tools.rs:528`/`:672`) passes a root it has just `read_to_string`'d
`workflow.yaml` out of, so only the two draft surfaces take the skip; a symlinked
root is fine because confinement canonicalizes both sides; and the TOCTOU
direction that matters is fail-closed. It also confirmed the drift guard cannot
pass vacuously — it could not construct a `ValidationError` invisible to all three
assertions at once.

---

## MEDIUM — a round-4 regression at the LOAD boundary

Round 4 routed `load`'s catch through the shared `humaniseRequestError`, which
reuses `statusSentence` — copy written for a **mutation** boundary. Executed
against the real module:

```
400 => "The server rejected this change."
403 => "You do not have permission to make this change."
```

Loading a workflow is not a change, so both sentences assert an act the author
never performed. Worse, `GET /workflows/{id}/definition` calls
`parse_workflow_yaml`, whose failure is a **400** carrying
`workflow.yaml deserialization failed: <which step/field>`. For a workflow whose
stored YAML no longer deserializes, the author read "The server rejected this
change." while the parse diagnostic — the only thing naming the broken step — was
discarded.

→ A `FailureBoundary = 'read' | 'mutation'` option (a bare string third argument
still means "fallback", so every existing call site and test is untouched;
default `'mutation'`). `statusSentence` now answers only for **definite** statuses
(401/403/404/408/409/413/429/5xx) with read-voiced copy where it differs; the
`>= 400` catch-all that was preempting the server's own message was removed. A new
`rejectionCopy` handles the remaining 4xx by keeping the server-authored message,
**attributed** — read: `This workflow could not be opened — the server reported:
<detail>`.

The competing constraint from an earlier round is preserved: a **server-written**
message (the api-client copies the JSON body's `error` field) becomes `detail` and
is still `tidyMachineText`'d (markup stripped, clipped at 160), while the
api-client's **transport wrapper** (`HTTP error! status: N - <body>`) is still
suppressed. So the unbounded-HTML-blob leak stays closed.

## MEDIUM — an INV-1 leak in the state round 4 unblocked

`prompt` is `skip_serializing_if = "Option::is_none"`, so a `prompt_file:` step
arrives with **no `prompt` key**. `nonEmpty()` attached its author-facing message
to zod's `min` check only, so an **absent** value produced the raw type
diagnostic:

```
prompt: Invalid input: expected string, received undefined
```

rendered verbatim into the field — raw schema-validator vocabulary reaching the
author, in exactly the state round 4 had just unblocked.

→ Fixed as the **CLASS**, not the instance. Every schema node in
`buildStepZodSchema` now carries authored TYPE copy, not just check copy:

- `nonEmpty(label)` → `z.string({ error: '<label> is required' }).trim().min(1, same)`
  — 8 call sites (`agent.prompt`, `llm.prompt`, `llm_map.{prompt,for_each,item_var}`,
  `sandbox.run`, `elicit.message`, `tool.{server,tool}`).
- Siblings with the same shape, also leaking, also fixed: a new `wholeNumber()`
  replaced 5 numeric sites (3 were bare `z.number().int()` and leaked on BOTH
  absent and decimal input; the other 2 leaked `expected int, received number` on
  a decimal), and a new `choice()` replaced 2 bare `z.enum` sites that leaked
  `Invalid option: expected one of "text"|"json"`.

The guard is class-shaped: it walks `STEP_KINDS` × every key of each kind's
default step × `{deleted, undefined, null, '', '   ', 0, -1, 1.5, 999999, 'abc',
true, {}, []}` plus the all-absent `{ kind }` shape, asserting no message matches
zod vocabulary — so a new kind, field, or un-authored node fails there.

**The fuzz surfaced a genuine contract break** in `configErrors` ("Never throws"):
an unrecognised `kind` (an unchecked `as StepKind` cast) made
`buildStepZodSchema` return `undefined` and the next line threw. Guarded.

## Explicit rejections

17 rows, notably: five high-severity candidates ruled out; the stale-save-error
retirement verified to retire neither too eagerly nor too late; round 4's only
code removal (`loading={busy}`) verified provably unreachable
(`usePicker ⇒ !busy`); and `UNDECIDABLE_BY_DEF_CHECK` messages confirmed still
clearable via Save (`saveDisabled` reads `validation.errors`, not `store.error`).

---

## Re-audit outcome

A sixth blind audit (`ledger-round6.jsonl`, 18 rows) confirmed **2 findings — 0
HIGH — and no regression from round 5**. It verified both of round 5's targets:
the load-boundary read voice is FULLY closed (no branch can emit "change", the
diagnostic survives, the transport wrapper stays suppressed, the mutation
boundary kept its own voice), and the `nonEmpty` class fix is complete across all
45 cells (9 sites × 5 value shapes) plus every numeric and enum node.

The two remaining findings are the **same root cause**: the client step schema
does not mirror the backend's `prompt` XOR `prompt_file` rule, so an imported
`prompt_file:` step shows a FALSE "A prompt is required" under the textarea while
the panel simultaneously says "No blocking errors.", the step list shows no
invalid marker, and Save is enabled. Round 5 fixed that message's *vocabulary*;
its *truth* is fixed in FIX_ROUND-6.

**New confirmed findings:** 2
