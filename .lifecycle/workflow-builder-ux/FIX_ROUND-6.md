# FIX_ROUND-6 — workflow-builder-ux

Input: `ledger-round6.jsonl` (18 rows / 2 confirmed, 0 HIGH). Fixes landed in
`998f8304e`.

Round 6's audit verified both of round 5's targets as fully closed (the
load-boundary read voice, and the `nonEmpty` class fix across all 45 cells) and
found **no regression**. Its two findings shared ONE root cause.

---

## The root cause: the client schema did not mirror `prompt` XOR `prompt_file`

Backend (`validate.rs`): `prompt: Option<String>` with `skip_serializing_if =
"Option::is_none"` on `StepConfig::{Llm,LlmMap,Agent}`, so an imported
`prompt_file:` step reaches the client with **no `prompt` key at all**.
`has_prompt = prompt.filter(|s| !s.is_empty()).is_some()`,
`has_file = prompt_file.is_some()`, and `WORKFLOW_PROMPT_MISSING` fires only on
`!has_prompt && !has_file`. Round 4 additionally made `check_prompt_files` skip
its existence half on a draft — so such a workflow is now VALID to the backend.

Client: `nonEmpty('A task description')` / `nonEmpty('A prompt')` were attached
**unconditionally** on agent/llm/llm_map. One screen therefore showed, at the
same time:

- a red **"A task description is required"** under the textarea,
- a green **"No blocking errors."** in the validation panel,
- **no** invalid marker in the step list,
- and an **enabled Save**.

The requirement was false, and the builder renders no `prompt_file` control
(grep: zero render sites), so the author could neither see why the box was empty
nor act on the message. Round 5 had fixed that message's *vocabulary*; this fixed
its *truth*.

→ A new `promptField(label, suppliedByFile)` replaces `nonEmpty` on the three XOR
kinds; `configErrors` computes the flag with `promptSuppliedByFile(step)` =
`typeof step.prompt_file === 'string'`, mirroring `has_file = prompt_file.is_some()`
exactly. The file branch is `.nullish()`, **not dropped**, so a wrong-TYPE prompt
still answers with authored copy — INV-1 holds. `prompt_file` is deliberately NOT
added to the object shape, so no error can be keyed at a field the builder does
not render.

**Parent-verified independently** (not trusting the agent's self-report) by
executing `configErrors` directly:

```
agent   | prompt_file only -> null | neither -> "A task description is required"
llm     | prompt_file only -> null | neither -> "A prompt is required"
llm_map | prompt_file only -> null | neither -> "A prompt is required"
```

The false requirement is gone and the author-facing strings are byte-identical,
so the e2e specs and the INV-1 class guard are unaffected.

## The downstream half

Acting on the false hint triggers the real `WORKFLOW_PROMPT_BOTH`, whose copy was
"…keep one of them." — while only ONE of the two is visible or removable here. The
copy now leads with the act the author can actually perform on this surface:

> This step has both a typed-in prompt and a prompt file — clear the prompt box
> here to use the file, or drop the file from the workflow and import it again.

TRUE per INV-6: clearing the box gives `prompt: ''`, which `validate.rs` reads as
no typed prompt, so `BOTH` clears and `MISSING` does not fire because `has_file`
is true.

---

## Re-audit outcome

A seventh blind audit (`ledger-round7.jsonl`, 18 rows) confirmed **1 finding, 0
HIGH**, executed the full prompt/`prompt_file` matrix (file-only, both,
empty/whitespace file, wrong types, all other kinds) and found round 6's target
fully closed with no regression.

Its single finding is the *other half of the same statement*: round 6 removed the
false error but the three forms still passed a hardcoded `required`, so the
asterisk — now the only remaining statement about that field — stayed, and was
false. It goes to FIX_ROUND-7.

**New confirmed findings:** 1
