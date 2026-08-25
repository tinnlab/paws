# FIX_ROUND-4

Two blind angles over round 3's diff: **regression / removal-safety** (pointed
deliberately at what the re-scope DELETED) and **whole-feature conformance** (the
first non-diff-scoped audit — the finished branch against its own design doc).

Pointing one angle at the removal was the right call: **the re-scope introduced
two regressions of its own**, and one of them is INV-4's forbidden state.

## Fixed

- **R4-1 (high) — the recovery-clear could produce a spinner with no banner.**
  Once the banner became the only signal, this sequence became reachable: a turn
  is in flight when the stream breaks → banner at ~3 s → the reply completes and
  persists server-side → the stream later recovers → the banner is cleared. But
  the dropped tokens do not come back: `isStreaming` is still true, no `complete`
  frame will ever arrive, and `reloadOpen` bails while it is set. Result — an
  unexplained spinner with no way back, which is exactly what INV-4 forbids, and
  reachable ONLY after round 3's removal. The clear is now suppressed while a turn
  is still open; the advice stays up for as long as it applies.
- **R4-2 (high, ×2) — the desktop `X-Refresh-Cookie` entry is removed again.**
  Round 3 added it to fix a login-refused-at-preflight scenario. Both angles
  showed that scenario is unsubstantiated (the header is only sent outside Tauri,
  the desktop dev server binds a key-derived port not 1420, `desktop/ui`'s Vite
  proxies no `/api`, and the tunnel path is same-origin so it never preflights) —
  and that allowing it reinstates, on that path, precisely the silent failure
  DEC-15 removed it from the union to prevent. Removed, with the unverifiable
  premise recorded in its place so it is not re-added a third time.
- **R4-3 (medium) — the re-report fired for an UNSUBSCRIBE.** Hoisting it above
  the branch in round 3 made `setActiveConversation(null)` report too; that
  banner is wiped microseconds later by the same action's own `error: null`,
  while still advancing the counter and pushing the next VISIBLE report out by
  another interval. It made the flow it was added for measurably worse. Now
  scoped to a real conversation.
- **R4-4 (medium) — the two counters desynchronised.** `subscriptionFailures`
  reset unconditionally while `lastReportedAtFailure` reset only inside the gated
  branch, so after an unsubscribe the NEXT outage's first banner needed
  `lastReported + 5` failures instead of 3. They now reset together; only the
  announcement is gated.
- **R4-5 (medium, ×2) — the message claimed something false, and slipped a
  guard.** "The reply is still being saved" is untrue when a conversation is
  opened with nothing generating — which the constant's own comment calls the most
  common trigger. Worse, it passed the guard asserting the message must not claim
  a turn is in flight, because that guard matched on the word *generated*: one
  word changed and the guard went green while the property regressed. The message
  is now state-neutral, and the guard matches `generated|saved` and runs against
  what the ACTION writes rather than against an imported constant.
- **R4-6 (medium, ×2) — TEST-11 asserted an abandoned contract.** The acceptance
  test for INV-4 was named "reaches a visible terminal state" and asserted the
  streaming indicator is absent — a contract round 3 deliberately dropped, and
  vacuous besides (the spec never starts a turn, so no indicator exists). Re-scoped
  to what the branch actually promises: surfaced, with a remedy, after real
  retries, and persistent rather than flashing.
- **R4-7 (medium) — two decision records contradicted the code.** DEC-13 still
  described the mid-turn/at-rest branching; DEC-16 still described a prefix match.
  Amended in place and marked superseded rather than renumbered.
- **R4-8 (medium) — the design doc's corroborating evidence was mechanically
  wrong.** "The title appeared because titles ride the sync stream" — `title.rs`
  calls no `sync_publish` at all and pushes `titleUpdated` over the CHAT stream,
  gated identically. What reaches the sidebar is the turn-end
  `SyncEntity::Conversation` publish. The conclusion survives; the mechanism did
  not, and it was offered as the decisive fingerprint. Corrected with the real
  emit named, because a reader who checks a false corroboration distrusts
  everything around it.
- **R4-9 (low, ×2) — a test that asserted an import.** "The message is never
  blank" inspected the constant and never invoked the action, so it passed with
  the action deleted.
- **R4-10..12 (low) — leftovers from the re-scope**: a call-site comment and an
  interface doc still describing flags the handler no longer clears (and both
  naming the wrong renderer); a download-test paragraph still claiming the guard
  removes the "0 Bytes / 0 Bytes" render, twenty lines under the note withdrawing
  exactly that; and an example-config pointer naming one constant for two headers.
- **R4-13 (low) — an unrelated generated artifact** (`RUNTIME_FINDINGS.md`,
  +150/−56) had been swept into the branch by a `gate:ui` run. Restored.

## Accepted, recorded

- **`finalizingTurn` is no longer cleared by this path.** Verified NOT a
  regression from this branch: on `origin/main` nothing reports at all, so a hung
  persisted-tail fetch leaves the flag set identically. Clearing it here would
  unmask the empty-completion notice mid-handoff — the reason round 2 argued to
  keep it. Escalated rather than papered over.
- **Nothing type-level ties the reported message to the constant the clear path
  matches.** Both ends now import ONE exported constant and the action is a
  pass-through, so breaking it takes deliberately composing a different string. A
  branded type buys little over that for a two-line action.

## Blocking, and honest about it

- **The sdk gitlink is not published.** Both angles flagged it independently. It
  is a publication step — the sdk branch is pushed when the PR is opened and the
  gitlink re-verified against the remote — but until then a fresh clone cannot
  build, so it is genuinely unmerged.

## Convergence

| round | angles | confirmed | HIGHs | of which introduced by the previous round |
|---|---|---|---|---|
| 1 | correctness · design-conformance · security | 19 | 2 | 2 |
| 2 | state-management · design-conformance/test-reality | 19 | 2 | 2 |
| 3 | correctness · api-contract | 16 | 3 | 2 |
| 4 | regression · whole-feature | 17 | 2 (code) | 2 |

Flat, and the last column is the finding that matters: **in every round, the
HIGHs were defects the PREVIOUS round introduced**, all of them in the INV-4
loud-fail — the secondary item, not the diagnosis. Nothing in four rounds and
nine distinct angles has landed on the CORS chain that is this branch's subject;
the security angle cleared it explicitly with its work shown, and the
whole-feature angle re-verified the entire causal chain for both symptoms and
found one wrong sentence in the doc, not in the code.

Round 3 already re-scoped once on this signal. Round 4 fixed the regressions that
re-scope caused. Rather than assume that settles it, round 5 is aimed narrowly at
the loud-fail's remaining logic — the ~40 lines where every defect has lived — and
its result is the decision point: converged, or the loud-fail comes out of this
branch and ships separately. That is stated ahead of the result so it cannot be
rationalised after it.

**New confirmed findings:** 5
