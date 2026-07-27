# HUMAN_FEEDBACK — `lint:hooks`

The feature was specified by the human up front and has not yet been reviewed
running. **No human feedback received** on the built feature at the time of
writing — this file exists to state that deliberately, not by omission.

The original brief is recorded here verbatim so the sign-off can be held against
it rather than against a gate tally (D1/D3):

- **FB-0** [status: resolved] — *"Add lint rules that make two REAL, already-shipped React hook bugs impossible to reintroduce. Both slipped past the standard `react-hooks/rules-of-hooks` rule and shipped as user-facing crashes. (1) `usePermission(A) || usePermission(B)` short-circuit … Generalize the rule: ANY hook call on the right-hand side of `||` / `&&` / a ternary branch (i.e. conditionally evaluated) — not just `usePermission`. (2) Conditional store-kit proxy read … The rule must flag a store-proxy field read that is conditionally evaluated (inside a ternary branch, `&&`/`||` RHS, an `if` body, or after an early return) in a component/hook. … The lint FIRES on both bug shapes … and reports ZERO false positives across the current `src-app/ui/src` … `npm run check` passes with the new lint wired in. tsc clean."* → Delivered as `scripts/lint-hooks.mjs` (rules **O1**/**O2**), gated in `npm run check` in both UI workspaces. Each clause is pinned to an executable proof: INV-1→TEST-1, INV-2→TEST-2, INV-3→TEST-3, INV-4→TEST-4, with TEST-1/TEST-2 linting the VERBATIM pre-fix blobs of the two crashes out of git rather than a snippet I wrote. Two deliberate scope boundaries are recorded rather than silently taken: `after-early-return` for plain `use*()` calls (DEC-6) and the `.map()` per-iteration case (DEC-7).

## Points to raise at review (the owner should decide, not me)

These are honest judgement calls the human may want to overturn. None is an open
defect; each has a recorded decision.

1. **`sdk/packages` is now a gated root** (DEC-14, ITEM-15). A violation inside the
   `sdk` **submodule** can fail ziee's `npm run check`. It measures 0 findings
   today and those components render in both apps, but it is a real coupling.
   Reverting is a one-line edit to `ROOT_CANDIDATES`.
2. **The lint is ziee-local, not in `sdk/packages/config/src/lint/`** (DEC-2),
   purely because the submodule cannot be pushed this round. Rule O2 encodes a
   property of the SDK's store-kit and arguably belongs there; the move is
   mechanical (its only dependency is `typescript`).
3. **The two copies are byte-identical duplicates** (DEC-3), following
   `lint-icon-action.mjs` and the desktop parity contract, rather than one file
   called by relative path. The drift risk is now closed by a guard that runs
   inside the gate itself (DEC-16), but it is still ~430 duplicated lines.
4. **Six pre-existing violations were fixed as part of this change** (ITEM-9..14),
   including two component splits (`OpenInNewWindowAction`, `PdfJsBody`) and one
   drawer split (`McpServerDetailsDrawer`). They are behaviour-preserving and
   covered by existing e2e, but they widen the diff beyond "add a lint".
5. **`ConversationMountsControl` (desktop) has no render-level test** (DEC-9) —
   the control has no gallery entry and no e2e reaches it. Its fix is a 3-line
   hoist verified by `tsc` + the lint.
6. **Three desktop guardrail vitest cases stay red** — verified pre-existing on an
   untouched base worktree (DRIFT-1.5), deliberately not repaired here (B3).
