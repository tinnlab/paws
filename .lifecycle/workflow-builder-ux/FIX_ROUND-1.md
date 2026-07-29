# FIX_ROUND-1 — workflow-builder-ux

Input: `LEDGER.jsonl` (148 rows from 5 blind agents over 27 angles; 96 confirmed
— 11 high / 41 medium / 44 low). Fixes landed in commit `c57d39ced`.

The blind agents were given diff-only scope and no access to the author's
reasoning. `ledger-design.jsonl` and `ledger-tests.jsonl` additionally read
`DESIGN.md` (required — a design-conformance pass that reads only the plan
certifies the plan's own reframing).

---

## Design-invariant violations found (the load-bearing result)

The plan's own `DESIGN_FIDELITY.md` recorded all six invariants as UPHELD. The
blind design-conformance pass disagreed on two, in reachable states:

- **INV-1 VIOLATED on the Save path.** The humanisation was applied only inside
  the validation panel. `validate_for_install` (`validate.rs:501-524`) returns
  `AppError("[semantic/WORKFLOW_PROMPT_MISSING] agent_1: step has neither
  prompt: nor prompt_file:")` and `WorkflowBuilderPage` toasted `e.message`
  verbatim — the *exact* string DESIGN §2.1 opens by naming as the defect.
  Reachable whenever `store.validation` is null or stale (never-validated, a
  transient `/validate-def` failure, the 400ms debounce race, or the documented
  `prompt_file` divergence between validate-def's temp dir and install's real
  bundle root).
  → FIXED: new pure `parseInstallError`/`humaniseInstallError` run the install
  error through the SAME `HUMAN_COPY` path as the panel.

- **INV-6 VIOLATED in three reachable states.** The design's promise is that the
  fallback is "never silent". Only ONE degradation path had an Alert:
  1. a server REACHED but serving zero tools → `failure: null`, no Alert, free
     text with no reason (`ToolStepForm.tsx:160`);
  2. a tool declaring NO schema — the case §2.5 names explicitly — silently
     dropped the generated form;
  3. the ordinary no-server-chosen first view: correct copy existed in
     `ToolCatalog.store.ts` and was never rendered.
  → FIXED: a `no-tools` failure kind, an explicit no-schema reason, the
  no-server guidance rendered as the Tool field's description, and a **Try
  again** affordance for the retryable failures.

- **INV-3 AT-RISK.** A stored `step.tool` absent from the fetched list rendered
  EMPTY (the kit Combobox maps an unknown value to `null`), so a renamed
  upstream tool silently vanished from view while the def still carried it —
  and `WORKFLOW_TOOL_NO_TOOL` cannot catch it (it fires only on *empty*).
  → FIXED: a synthetic "not offered by this server any more" option keeps the
  value visible.

## Data-loss defects

- Re-picking the ALREADY-SELECTED tool wiped every argument — Base UI fires
  `onChange` unconditionally on item press, and there was no `v === step.tool`
  guard. Opening the picker to re-read a description destroyed the author's work.
- A PARTIAL edit of a `{{ reference }}` corrupted the value and HID the field:
  template mode was derived per-keystroke, so backspacing `}}` left a corrupt
  string, flipped the control back to typed, whose value guard didn't match →
  the field rendered empty while the corrupt value persisted, and the undo
  disappeared with it.
- Non-string enums were stringified onto the wire (`{"type":"integer","enum":[1,2,3]}`
  saved `"2"`).
- `InputNumber`'s intermediate-`undefined` ("still typing") was committed as a
  key DELETE, so a negative number could not be typed.
- The JSON textarea reformatted under the caret on every keystroke.

## JSON-Schema coverage

`describeToolSchema` was a subset that missed the shapes real MCP tools emit:
nullable in BOTH standard spellings (`type: ["string","null"]` and
`anyOf:[…,{type:"null"}]` — what FastMCP/pydantic emit for `Optional[str]`),
`allOf`, `$ref` sibling keywords (title/description/default were discarded), and
a root-level `$ref`. Each fell through to a raw JSON textarea. All fixed;
`lookupRef` also moved off prototype-chain `in`.

## Backend drift guard

The guard this branch added was narrower than its own docstring:

- byte-index slicing (`&rest[..400]`) could PANIC on a multi-byte char boundary
  instead of reporting drift (161 non-ASCII bytes already in the file);
- the humanisation half was a raw SUBSTRING search, so a code left in a comment
  satisfied it while its `HUMAN_COPY` entry was gone — exactly the property the
  test claimed to guarantee;
- the scan was a hardcoded 2-file list with a closed layer allowlist that
  SILENTLY DROPPED any unrecognised emit site.

→ Rewritten as a char-safe structural lexer over the whole crate that parses the
`HUMAN_COPY` object literal's KEYS and treats an unreadable construction as a
loud failure. `VALIDATION_CODES` became `#[cfg(test)]` (it has no production
consumer; `pub` was merely suppressing the dead-code lint — §15). PLAN.md and
BASE.md were corrected to match.

Verified RED-then-GREEN by simulating each drift shape (unregistered code in a
new file; a `HUMAN_COPY` entry deleted but the code left in a comment; an unknown
layer; a struct-literal construction; a non-literal code arg) and confirming each
now fails loudly, then reverting.

## Gallery — the surface a design review actually inspects

- The validation fixture's WARNING message was prose the backend can never emit
  (`ref_check.rs:434 render_expr` renders the WHOLE ref expression, so the real
  string is `'agent_1.output.title' accesses field '.title'…`). **This is what
  made TEST-21 red.**
- The seeded def was INCOHERENT with its own findings: `WORKFLOW_PROMPT_MISSING`
  on a step that had a prompt, `WORKFLOW_TOOL_NO_TOOL` on a step that had a tool.
  A reviewer saw two steps marked broken whose config was visibly complete.
- `coverage.ts:487` claimed `ToolStepForm` was covered "via the populated
  builder" — but that surface seeds `selectedStepId: 'agent_1'`, so it renders
  `AgentStepForm`. The claim was false and no gate checks coverage PROSE.
- Consequently the tool step's **primary** state (working picker + generated
  form) had NO gallery cell at all — every design review saw only the escape
  hatch. It now has one, driven through the real `listTools` path.
- `RUNTIME_FINDINGS.md` had been overwritten with a stale-Vite run (2393 gating
  HIGH vs the base's 0), and the entire baselined section was DELETED. Two clean
  re-runs on a quiet server disagreed about WHICH surfaces failed (disjoint
  sets), so neither is trustworthy; the base file is restored byte-for-byte with
  a marked annotation recording both runs. No numbers were hand-edited.

## Dead code (§15)

`markUnknown` + `unknownNames` deleted (zero callers); `invalidate` wired to the
new retry affordance; `coerceToDeclared`'s unreachable `integer`/`number`/
`switch`/`multiselect` arms removed — **testing those dead arms is what MASKED
the enum-stringification bug**.

## Explicit rejections (not fixed, with reason)

Recorded as `status: rejected` rows in the ledgers. The notable ones: the
`McpServer` cross-module import (house pattern — `capabilities.tsx`,
`AgentStepForm.tsx` both do it, not a new coupling); Rules-of-Hooks violations
(traced — all store reads are unconditional and hoisted above every `.map()`);
falsy schema defaults (`false`/`0`/`""` verified intact end to end); `$ref`
infinite recursion (the explicit stack genuinely cuts self- and mutual
recursion); warning mis-bucketing via `severityOf` (backend always serializes
`severity`); and "failures cached forever" (the opposite is true — the guard
requires `failure == null`, so failures always retry).

---

## Re-audit outcome

A fresh blind round-2 audit was run over the post-fix diff
(`ledger-round2.jsonl`, 28 rows / 20 confirmed) plus a dedicated blind test-quality
audit (`ledger-tests.jsonl`, 23 rows / 16 confirmed). It found that **round 1's own
fixes introduced new defects** — most seriously a latched template mode that
survives a tool change, and a `runValidate` success branch that clears a
concurrent save failure — and that TEST-20's headline overflow probe is
structurally unfalsifiable. The loop therefore has NOT converged; those go to
FIX_ROUND-2.

**New confirmed findings:** 36
