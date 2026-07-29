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

## Severity call, since the orchestrator asked

My judgement on whether any deferred item should BLOCK this merge:

- **Prominence inversion — does NOT block.** It is a real design question, but the
  state it replaces is strictly worse on the same axis (Deny was unreachable while
  the broadest approval was the only pressable control). Merging improves the
  safety posture even if the owner later wants the weighting changed; holding the
  branch would leave the worse state in place. Worth a follow-up, not a block.
- **32px tap targets — does NOT block.** Pre-existing on this surface and every
  other kit action row; this branch neither introduced nor worsened it, and fixing
  it properly is an app-wide density change that should not ride a layout fix.
- **Empty `deep-chat-elicitation-no-fields` cell — does NOT block, but it is the
  one I would fix soonest.** It is a gallery FIXTURE bug (the slug exists and
  renders the wrong card), so it silently removes coverage from any future change
  to that footer — exactly the "test that certifies nothing" shape this branch
  kept tripping over. It costs a seeded cell, not a redesign.

Nothing in the deferred set is severe enough to block. The thing I would actually
gate on is the finding profile: rounds 1-4 found 12, 9, 7 and 7 confirmed
findings respectively, including a HIGH regression that one round's own fix
introduced — see the round-5 note in `FIX_ROUND-4.md`.

Also carried to the owner, from the same audits: the decision buttons are 32px
tall, under the taxonomy `G5` 44px mobile tap-target floor (pre-existing, DEC-8),
and the remaining non-consent `Card` footers still hand-roll the non-wrapping row
this branch replaced (recommended follow-up, with corrected counts, in
`FIX_ROUND-1.md`).
