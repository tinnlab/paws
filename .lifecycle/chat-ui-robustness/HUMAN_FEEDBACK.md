# chat-ui-robustness — HUMAN_FEEDBACK

**No human feedback received.** The feature was implemented from a written brief
(the live-app audit findings + four named bugs) and has not yet been reviewed by
a human against the running app. This file records that absence deliberately, and
carries the items the owner should look at when they do review.

## What to review against (invariants, not a gate tally)

Per the lifecycle's sign-off rule, the demonstration is each `INV-N` and the
`[acceptance]` test that proves it — not "9/9 green":

| Invariant | Proof to demonstrate live |
|---|---|
| **INV-1** — always render `store.error`; always show loading; always show feedback after a mutation | TEST-7: kill the model provider, send — the spinner STOPS, the error Alert appears with real text, the composer re-enables. |
| **INV-2** — zero uncaught exceptions in any state × theme | TEST-5: open devtools, press Enter on an empty composer repeatedly — nothing is raised, nothing is logged, nothing is sent. (This threw on 6/6 audit cells before.) |
| **INV-3** — FULL, EXACT advertised description, never truncated | TEST-10 + TEST-16: open a tool approval with a ~2,000-char description — the card fits the screen, "Show more" reveals the rest, and the complete string is in the DOM the whole time (select-all + copy gets every character while collapsed). |
| **INV-4** — never silently swallow | TEST-2: a real blocker (an upload in flight) still surfaces; only an empty composer is quiet, and only from the Enter key. |

## Decisions the owner may want to overturn

These were resolved by convention/precedent during the lifecycle. Each is a
genuine product choice, so they are surfaced rather than buried:

- **DEC-1 + the F2 fix — an empty submit is quiet on ENTER but still toasts on
  the SEND BUTTON.** Rationale: a stray keypress is not an action the user aimed
  at anything, whereas clicking a visible control is; and making the button quiet
  turned it into a dead click (the blind audit caught this). An owner may prefer
  a third option not built here: **disable the Send button when there is nothing
  to send**, which would make both paths quiet AND visibly explain why. That was
  not done because "nothing to send" must also account for attachments, which
  the text extension cannot see — it needs a new composer-level emptiness seam.
  Consequence today: composer with an attachment but no text → Enter does
  nothing, the button toasts "Message cannot be empty" (which is misleading, since
  the user did attach something). Both behaviours also predate this change in the
  sense that neither ever sent the message; only the wording of the failure is
  at issue.
- **DEC-5 — no client-side stream watchdog.** A "nothing heard in N seconds ⇒
  declare failure" heuristic would misreport a legitimately slow first token (the
  audit's own runs show 3s first-token and 19s totals) as an error. The two
  mechanisms the audit actually evidenced are fixed deterministically instead. If
  the owner has seen a genuinely silent SSE death in the wild, this is the item to
  reopen — it would need an admin-configurable timeout (see DEC-6).

## Known deltas worth a human eye

- **Bug 4 was NOT changed** (DEC-9): the tool card is absent pre-approval BY
  DESIGN — the approval card renders in its place, in the same in-thread slot, and
  already discloses tool name, concrete args, destination host and description.
  Evidence is in DECISIONS.md and pinned by TEST-11. If the owner intended
  something different (e.g. both cards stacked), this is a design change, not a
  bug fix.
- **Three pre-existing issues were deferred, not fixed** (see FIX_ROUND-1
  "Dispositioned without a code change"), most notably: the extension registry
  **fails OPEN** when a `beforeSendMessage` hook throws — a crashed veto counts as
  approval. Real, adjacent, and deliberately left for its own reviewed commit
  because flipping the send path to fail-closed has its own blast radius.

## Ledger

_(no entries yet — this section fills in as the owner reviews)_
