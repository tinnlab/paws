# FIX_ROUND-8 — workflow-builder-ux

Input: `ledger-round8.jsonl` (12 rows / 1 confirmed — **HIGH**). Fix landed in
`21f86a534`.

Round 8's audit verified round 7 itself as correct by execution (both states for
all three kinds, the exact original messages preserved, `for_each` not relaxed,
no Rules-of-Hooks change, no `data-testid` change) and found one HIGH: the third
consequence of the same decision, and one the branch itself created.

---

## HIGH — the builder's own remedy produced a workflow that fails at run

`WORKFLOW_PROMPT_BOTH`'s copy, added in round 6, tells the author:

> clear the prompt box here to use the file

Clearing fired `patch({ prompt: v })` with `v = ''`. `Object.assign` wrote it
through and `toWorkflowDef` serialised it verbatim. The backend then reads
`Some("")` as **no typed prompt** (`validate.rs:681` —
`prompt.as_ref().filter(|s| !s.is_empty())`), so:

- `WORKFLOW_PROMPT_BOTH` clears,
- `WORKFLOW_PROMPT_MISSING` does not fire (because `has_file` is true),
- the panel goes **green** and Save is **enabled**,
- `skip_serializing_if = "Option::is_none"` means `Some("")` **is** written to
  `workflow.yaml`,
- and `dispatch.rs::load_raw_prompt`, which matches only `(Some,None)` and
  `(None,Some)`, hits its `_` arm and fails the **RUN** with
  `step 'llm_1' has invalid prompt config` — for `llm`, `llm_map` and `agent`.

So the builder instructed the author into a workflow that validates clean and
then breaks. The raw hazard predates this branch; what is new is that **this
branch's copy instructs it**, and round 6 stopped the client flagging the
resulting empty box. Nothing covered either half (`grep "invalid prompt config"`
→ only `dispatch.rs:114`; the existing `rejects_prompt_and_prompt_file` test uses
a NON-empty prompt).

→ Fixed at the write: a cleared box normalises to `null`, matching the house
pattern one field away (`AgentStepForm`'s
`patch({ system: e.target.value || null })`). Applied to all three XOR kinds,
with the reasoning recorded inline at each site.

**Test shape, deliberately.** Source-scanned: the value never reaches
`configErrors` — an empty prompt beside a `prompt_file` is legitimately
error-free — so only the WRITE can be asserted, and only at the call site.
**Proven falsifiable**: reverting only `LlmStepForm` gives `LlmStepForm.tsx: a
cleared prompt box must not be written through as "" — that passes validation and
then fails the run`; restored, 14/14.

---

## Convergence

A ninth blind audit (`ledger-round9.jsonl`, 21 rows) confirmed **0 findings** —
21 explicit rejections, including **five high-severity candidates ruled out**. It
traced the `null` write path end to end (serde accepts `null` for `Option<T>`,
so it arrives as `None`), confirmed the required marker and exact messages still
appear when there is no `prompt_file`, confirmed `load_raw_prompt` now takes the
`(None, Some(rel))` arm, and found no regression to any other field, kind, or the
Save gate.

The fix loop is converged. Per-round confirmed findings:
**96 → 20 → 7 → 7 → 2 → 2 → 1 → 1 → 0.**

**New confirmed findings:** 0
