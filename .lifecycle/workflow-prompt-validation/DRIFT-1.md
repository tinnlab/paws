# DRIFT-1 — implementation vs plan / design

Written DURING phase 5, item by item, as each landed.

- **DRIFT-1.1** — verdict: impl-wins — ITEM-1 planned a single
  `prompt_source(prompt, prompt_file)`. While implementing ITEM-4 it became clear
  that `check_prompt_files` needs the `prompt_file:` PATH even in a both-state
  (it reports on the file alongside `WORKFLOW_PROMPT_BOTH`, which the existing
  `rejects_prompt_and_prompt_file` test relies on), and `prompt_source` returns
  `Both` without a payload. The first implementation therefore repeated
  `.filter(|p| !p.is_empty())` locally in `check_prompt_files` — i.e. it wrote the
  emptiness rule a SECOND time, which is exactly the duplication ITEM-1 exists to
  remove and would have re-opened the same drift channel one level down. Resolved
  by factoring the `prompt_file:` half into `prompt_file_ref`, which both
  `prompt_source` and `check_prompt_files` call. PLAN ITEM-1 amended; phases 1-3
  re-gated.

- **DRIFT-1.2** — verdict: impl-wins — TESTS.md's TEST-5 line originally claimed
  `promptSuppliedByFile` should be FALSE for a whitespace-only `prompt_file`.
  That was wrong: the backend rule is `is_empty()`, not `trim()` (DEC-3), so
  `prompt_file: "   "` IS a file to the backend — reported
  `WORKFLOW_PROMPT_FILE_MISSING`, not `WORKFLOW_PROMPT_MISSING`. A client that
  trimmed would show "A prompt is required" where the backend shows "prompt_file
  not found": a NEW disagreement, in the same family as the one being fixed.
  Implementation mirrors `is_empty()` exactly; TESTS.md's TEST-5 assertion text
  amended to match and phase 3 re-gated. (The TEST-ID is unchanged — A5 holds.)

- **DRIFT-1.3** — verdict: none — ITEM-2, ITEM-3, ITEM-5, ITEM-6, ITEM-7 and
  ITEM-8 landed as planned, in the planned files, with the planned patterns. The
  two design invariants are reconciled explicitly: INV-1 is upheld by
  construction (both sides derive from one rule) and executably (TEST-1's matrix
  went RED on the unmodified tree — `kind=llm prompt=None prompt_file=Some(""):
  validator said OK but the run said REJECTED` — and GREEN after); INV-2 is
  upheld at the CAUSE (the negative margins are gone, replaced by grid-aligned
  logical padding) and its stated exit condition is performed (ITEM-8), with the
  measured before/after in `REPRO.md` and `TEST_RESULTS.md`.

- **DRIFT-1.4** — verdict: resolved — a stricter reading of the design was
  considered and rejected during ITEM-3: making `load_raw_prompt` fall back to
  the file on a `Both` state would have made the run "just work" for a
  genuinely-both workflow, which validate rejects. That would have satisfied
  "green must run" while breaking "red must not quietly run" — the second half of
  INV-1. `Both` maps to an error, so both halves hold. No plan change; recorded
  because it is the kind of divergence that would otherwise pass unnoticed.

**Unresolved drifts:** 0
