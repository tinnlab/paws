# FIX_ROUND-7 — workflow-builder-ux

Input: `ledger-round7.jsonl` (18 rows / 1 confirmed, 0 HIGH). Fix landed in
`f3515f656`.

Round 7's audit executed the full prompt/`prompt_file` matrix — file-only, both,
empty/whitespace file, wrong types, every other kind — and found round 6's target
fully closed with no regression. Its single finding is the **other half of the
same statement**.

---

## The residual: round 6 removed the false error, not the false marker

`PromptField` was called with a hardcoded `required` at all three XOR call sites.
So on an imported `prompt_file:` workflow the author saw
`What should the assistant do? *` over an empty textarea, **no** error, a green
panel and an enabled Save.

Two problems, both real:

1. The asterisk was now the **only remaining statement** about that field, and it
   was false. Obeying it produces `prompt` + `prompt_file` →
   `WORKFLOW_PROMPT_BOTH` → Save blocked. The marker walked the author into
   precisely the trap round 6's reworded copy exists to walk them out of.
2. With the error gone and the marker meaningless, the state had **no stated
   reason at all** — a silent degradation, which DESIGN §2.5 forbids.

The audit noted `promptSuppliedByFile` was the ONLY consumer of `prompt_file`
anywhere in the UI (verified by grep over `components/builder/` + `stores/`): no
form read it, and no control, description or badge mentioned the file.

→ The two halves of "is a prompt required?" now read the wire shape through **one
exported predicate**: `promptSuppliedByFile` moved from module-private to
exported, and the three forms derive `required={!fromFile}` from it rather than
re-deriving or hardcoding — which is exactly what let them drift apart. The
file-backed state also STATES its reason (`PROMPT_FROM_FILE_NOTE`) instead of
silently dropping the asterisk.

`LlmMapStepForm`'s **other** `PromptField` is `for_each` — a non-`Option` backend
field that IS always required — and was deliberately left bare-`required`.

**Test shape, deliberately.** Source-scanned, because `required` is a render-time
prop: a value test on the predicate alone would still pass with the forms
hardcoding it. Scoped to the prompt field's own block so it cannot wrongly flag
`for_each`. **Proven falsifiable** — reverting only `AgentStepForm`'s hunk gives
`AgentStepForm.tsx: a bare 'required' on the prompt field re-asserts the false
requirement`; restored, 13/13.

---

## Re-audit outcome

An eighth blind audit (`ledger-round8.jsonl`, 12 rows) verified round 7 itself as
correct by execution — both states for all three kinds, the exact original
messages preserved, `for_each` not relaxed, no Rules-of-Hooks change, no
`data-testid` change — and confirmed **1 finding, severity HIGH**: the third
consequence of the same decision. The builder's own `WORKFLOW_PROMPT_BOTH` remedy
tells the author to clear the prompt box, and clearing wrote `prompt: ""`, which
validates GREEN and then fails the RUN. It goes to FIX_ROUND-8.

**New confirmed findings:** 1
