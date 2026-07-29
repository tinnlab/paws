# FIX_ROUND-2 — rounds 3 and 4

Two further full blind rounds were run after FIX_ROUND-1 (each a fresh agent,
diff-only context, all 16 angles). Both found real defects **introduced by the
round-1 fixes themselves**, which is exactly what the loop is for.

## Round 3 — 8 findings, all addressed

- **The fork-anchor clearing was itself a mis-fix (medium, correctness).** Round 1
  added "clear the latched branch fork on a pre-flight abort" to stop an aborted
  REGENERATE from making the next message fork at a stale anchor. Round 3 showed
  the cure was worse than the disease: BOTH programmatic callers
  (`startRegenerateMessage`, `startEditMessage`) trim the transcript AND prefill
  the composer before calling, and neither restores it on failure — so the user's
  next Enter IS the intended retry, and with the anchor cleared that retry stops
  branching and APPENDS a duplicate turn to a branch the server still holds
  intact. Reverted entirely: the abort now leaves the caller's latched state
  alone, which is also the pre-existing behaviour of the swallow-then-422 path.
  TEST-18 and TEST-21 were rewritten to assert PRESERVATION in both flows.
- **The stale-build mark could be cleared mid-composition (low→real, state).** It
  is one process-wide flag that a SUCCESSFUL import clears, and contributors run
  sequentially — so a later contributor resolving its own lazy action wiped the
  mark a earlier one's chunk 404 had just set, dropping "the app may have been
  updated" in exactly the deploy scenario it describes. Now captured at the
  moment of failure and passed to the message builder.
- **`missingFields` carried UI labels, not wire keys (low).** Its only consumer is
  the production log line; a support report must say `model_id`, not "a model
  selection". Split: keys to the log, labels to the copy.
- **A non-stale missing-field message was a dead end (low, i18n).** "…it is
  missing an active conversation branch." with no next step. Now carries
  `REOPEN_HINT` — the right advice for a cause a reload cannot fix.
- **The store-kit prefetch-bail comment overstated what the code does (medium).**
  The loop body is synchronous, so the per-key `isStaleBuild()` check cannot flip
  between iterations — the store whose chunks are failing still fires all of its
  own keys. The comment now states the real scope (it spares stores scheduled on
  LATER idle ticks).
- **The comment claiming the regenerate caller has no local catch was false
  (low).** `MessageActions.handleRegenerate` toasts. Corrected, and the deliberate
  double surface (toast + Alert) is stated rather than justified by a false
  premise.
- **The e2e's "names the extension" assertion was not discriminating (low).** The
  raw cause already contains the chunk name `getModelId`, so a lowercased
  `toContain('model')` stayed green even with the attribution removed. Now asserts
  `chat extension` and `"model"` separately.
- **The `as any` comment overstated what the typing buys (low).** `content` /
  `model_id` are still read out of an open record; the guarantee is carried by the
  runtime assertions. Said plainly.

## Round 4 — 2 findings, both addressed

- **The `clearPendingBranch` tripwire was silent (medium, tests-quality).**
  Mutation-verified by the auditor: reinstating `await get().clearPendingBranch()`
  in the abort path left all 22 vitest cases GREEN, because the throwing stub both
  prevented the state change the other assertions inspect AND was swallowed by the
  `.catch(() => {})` around the send. Replaced with a recorded call + an explicit
  "was never invoked" assertion, and re-verified by MY OWN mutation: that
  expectation is now what goes red (TEST-18 and TEST-21 both fail).
- **A regenerated `RUNTIME_FINDINGS.md` was committed (medium).** That file is gate
  OUTPUT, not product, and the regenerated copy asserted a red UI gate driven by
  `ERR_NETWORK_CHANGED` harness noise from a stale worktree Vite server. Reverted
  to the base version.

## Convergence

Round 4's two findings are fixed and neither is a product-behaviour defect: one is
a test-strength fix (re-verified by mutation) and one is a committed build
artifact reverted to base. No product source changed in response to round 4, so
the round-3 code has now survived a full blind round with **no new confirmed
product finding**.

**New confirmed findings:** 0
