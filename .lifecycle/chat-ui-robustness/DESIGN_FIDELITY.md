# chat-ui-robustness — DESIGN_FIDELITY

One verdict per invariant from `PLAN.md` `## Invariants`. Each states how the
plan UPHOLDS the design's own words — not how the plan reframes them.

- **INV-1** — fidelity: UPHELD — "Always render `store.error` … never `return
  null` on error. Always show loading … Always show success/error feedback after
  a mutation." The plan upholds all three clauses on the send path, which today
  honors only the middle one. Clause 1: ITEM-3 guarantees `store.error` is
  actually SET on every failure path (today a throw between `sendMessage.ts:64`
  and the `try` at `:106` leaves `error` null forever), and ITEM-5 verifies
  `ConversationPage`'s existing `chat-conversation-error-alert` (`:1003-1005`)
  renders it. Clause 2: ITEM-4 keeps the spinner but makes it identifiable, so it
  can be asserted PRESENT during a real stream and ABSENT after a terminal
  failure — the plan never removes the loading affordance, it bounds it. Clause
  3: ITEM-2 restores the `message.error(...)` toast on the Enter path, which today
  is the ONLY submit path with no user-visible feedback on failure (the Send
  button already has it at `ChatInput.tsx:83-85`). Note the deliberate
  *exception*: ITEM-1 makes an EMPTY submit produce no feedback at all — that is
  not a swallowed error, it is the design position that an empty submit is not a
  mutation and therefore has no outcome to report (see INV-4 below, and DEC-1).

- **INV-2** — fidelity: UPHELD — "Zero runtime HIGH findings — no console error,
  no uncaught exception / ErrorBoundary crash …, in ANY state × theme." ITEM-1 +
  ITEM-2 together remove the ONLY uncaught-exception source the audit found on
  this surface, and remove it at BOTH levels the invariant implies: ITEM-1
  eliminates the throw at its source for the empty case (so nothing is raised at
  all), and ITEM-2 catches every OTHER cancel/failure reason at the call site (so
  no future cancel-producing extension can re-introduce a `pageerror` through
  this path). "In ANY state × theme" is honored by ITEM-9's gallery cell, which
  puts the newly-bounded approval state into the theme × viewport matrix the
  runtime-health pass sweeps. The audit observed the finding in 6/6 cells; the
  fix is cell-independent (a code-path fix, not a styling fix), so all 6 clear
  together.

- **INV-3** — fidelity: UPHELD — "FULL, EXACT advertised description (never
  truncated/summarized — poisoning hides in truncation)." This invariant is the
  binding CONSTRAINT on ITEM-6, and the plan-audit converted it into a hard
  implementation rule: the clamp is **CSS-only** (`max-height` + `overflow`),
  never a string operation, so the complete description string is present in the
  DOM at every moment, in both collapsed and expanded states, and remains
  copyable, findable by in-page search, and readable by assistive tech and by
  `toHaveText`. A user who wants the whole thing clicks "Show more" — the text was
  never shortened, only its viewport was. Note the invariant's RATIONALE is what
  makes the clamp not merely tolerable but *aligned*: the threat is a hostile
  server hiding a poisoned instruction where the user won't look, and an
  unbounded description that pushes Deny off-screen is that same threat by a
  different mechanism. Bounding the description makes BOTH the full text and the
  Deny button reachable, which serves the invariant's purpose more completely
  than today's behavior does.

- **INV-4** — fidelity: UPHELD — "Never silently swallow … Propagate … or
  surface a user-visible error." Two places in the plan look like swallows and
  were audited individually:
  (a) **ITEM-1's silent cancel is not a swallow** — nothing failed. An empty
  composer submit is a no-op input event, not a mutation with a suppressed error;
  the guideline's targets ("`let _ =`", "`.ok()`", "`unwrap_or_default()` on a
  real failure") all describe discarding a genuine failure result. The plan pins
  this narrowly: `silent` is opt-in per cancel reason, only the empty-content
  branch sets it, every other cancel keeps throwing, and a merge of a silent with
  a non-silent cancel resolves to NON-silent ("fail loud wins") — so the silent
  path can never widen to cover a real error.
  (b) **ITEM-3b's guard around `onStreamError` is a propagating swallow** — the
  primary failure is still surfaced (the store `error` is set by the very reset
  the guard exists to protect), and the secondary extension-hook error is
  `console.error`-logged rather than discarded. Without the guard, a throwing hook
  eats the ENTIRE reset and the user gets the silent stuck spinner — i.e. the
  unguarded version is the bigger violation of this exact invariant.

No `DROPPED` and no `AT-RISK` verdicts. The two constraints this fidelity pass
imposes on implementation — **INV-3 ⇒ CSS-only clamp** and **INV-4 ⇒ fail-loud-wins
merge + logged guard** — are carried verbatim into `PLAN_AUDIT.md`'s closing
constraints and are each pinned by an `[acceptance]` test in `TESTS.md`.
