# mobile-approval-clipped — HUMAN FEEDBACK

**No human feedback received.** The owner has not yet reviewed this feature; the
branch is handed to the orchestrator for that review. This is a deliberate claim,
not an omission: nothing was said and nothing was dropped.

## Awaiting an OWNER decision (not human feedback, so not an FB item)

One item must reach the owner before this is considered settled. It is recorded
here so the orchestrator cannot merge without seeing it, but it is deliberately
NOT written as an `FB-N` with a status: it is not feedback anyone gave, it is a
product decision I am declining to make on the owner's behalf.

**Relative prominence of the broadest approval at mobile width.** Two independent
blind reviewers raised it: "the chosen fix makes the BROADEST approval the
visually dominant control on mobile … reachability is restored but relative
prominence is inverted toward the dangerous action." Measured after the fix at
390px: Deny 81x32 (outline), Approve once 140x32 (filled), "Approve for this
conversation" wrapped onto its own line at 238x50 (filled) — the largest,
heaviest, thumb-closest control on a consent card.

- This does NOT block the fix. The defect it replaces (Deny rendered but
  unpressable, with the broadest approval the ONLY reachable control) is strictly
  worse on exactly the axis in question, so shipping is an unambiguous
  improvement either way.
- But whether the broadest approval should be the visually dominant action on a
  phone is a product/safety judgement, and the audit-vs-user-decision rule says an
  audit finding that conflicts with a design choice is surfaced, never silently
  reversed. Options if the owner wants it changed: a quieter variant for the third
  action once it wraps, dropping it at narrow widths (it is already hidden for
  control-server writes), or giving Deny equal visual weight.

Also carried to the owner, from the same audits: the decision buttons are 32px
tall, under the taxonomy `G5` 44px mobile tap-target floor (pre-existing, DEC-8),
and the remaining non-consent `Card` footers still hand-roll the non-wrapping row
this branch replaced (recommended follow-up, with corrected counts, in
`FIX_ROUND-1.md`).
