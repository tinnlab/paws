# mobile-approval-clipped — FIX ROUND 6 (ABORT + RE-SCOPE)

The phase-7 validator refused to let this continue, and it was right:

> fix loop is NOT CONVERGING and must be ABORTED, not continued — profile
> (12, 9, 7, 9, 9) is flat or rising after 5 rounds, which falsifies the
> assumption every defect-estimation model rests on. Do not run another round.
> Re-scope instead.

No round 6 audit was run. This file records the diagnosis and the re-scope.

## Why it stopped converging — the diagnosis, from the ledger

Per-round confirmed findings, by where they landed:

| round | confirmed | top file |
|---|---|---|
| 1 | 35 | `card.tsx` (13), the spec (11) |
| 2 | 15 | the spec (5), `card.tsx` (4) |
| 3 | 9 | the spec (4), `ToolCallPendingApprovalContent.tsx` (2) |
| 4 | 7 | `ToolCallPendingApprovalContent.tsx` (3), the spec (3) |
| 5 | 9 | `ToolCallPendingApprovalContent.tsx` (6), the spec (2) |

Two different pieces of work are hiding in one profile:

- **The reported defect — the unreachable Deny.** `CardActions`, the four footers,
  the header wrap. Findings decayed **35 → 15 → 9** and the last two rounds found
  nothing new in `card.tsx` or the footers. **This converged.**
- **Attacker-controlled string DISCLOSURE on a consent card.** I added this in
  round 3, off the back of a real finding. It is where every round from 3 onward
  concentrated, and it is flat: 2 → 3 → 6 findings in that one file, with rounds
  4 and 5 each finding that the PREVIOUS round's fix had introduced a worse
  defect (unbounded growth pushing Deny 2800px below the fold; then a clamp that
  cut ordinary names to 34 of 41 characters and whose "Show more" produced a
  13,343px card).

That is not a bug being chased down. It is a **design problem I kept guessing at
inside a bugfix branch**, writing my own tests against my own model of a property
I had not actually specified. Three of my last four "fixes" were regressions.

## The re-scope

**KEPT — the converged work.** `CardActions` + the four footer adoptions, all
header `flex-wrap` fixes (approval, elicitation, wizard, cancelled, three in
`extension.tsx`), and the reachability/anti-starvation guards. That is the
reported defect and it is well covered.

**REVERTED — the non-converging escalation.** The approval header's identity line
is back to the ITEM-6 state (`flex-wrap` + `truncate` + `title`), and the
round-5 bounding of the elicitation / ask-user `message` is removed. Reverting is
**not** shipping a regression: base has `truncate` AND the name starved to zero
width; the branch has `truncate` with the name rendering. Strictly better on
every axis, with a known unfixed edge (a name longer than the wrapped line still
ellipsises) that is pre-existing and now documented in the component.

**TEST-8 / TEST-10 retargeted, not dropped** (A5). They now guard the property
that converged — no element of the identity row is starved by its siblings — and
both are negative-controlled against the unwrapped header:
`"get_forecast" is rendered 0px wide of the 98px it needs`. The previous
versions asserted a disclosure property the code no longer claims, which is
precisely how they came to pass on both fixed and broken code.

## What is split out, with its evidence

The disclosure problem is real, and everything needed to solve it properly is
already measured — handed over rather than guessed at again:

- ellipsised: 64-char name renders 238px of 534px needed; server label loses 139
  of 393px at the clipped edge.
- unbounded: 6400-char name → 5123px card, Deny ~2800px below the fold; at
  1280x900 the card top sits at -617.
- clamped-with-a-toggle: identity column is 98px of 270px at 390px (28px at
  320px) because `flex-1` is `flex-basis: 0` against a `whitespace-nowrap`
  sibling, so ordinary names clamp;
  `github__create_or_update_file_contents_v2` shows 34 of 41 chars; the server
  label 0 of 14; and one click on the toggle gives a 13,343px card.
- the pattern that does work on this card already: the Arguments block's
  `max-h-40 overflow-auto` — bounded, fully readable, no expansion hatch.
- the same attack is open on the elicitation / ask-user cards' raw `message`
  (8,282px and 7,035px cards with Decline far below the fold) — untouched by this
  branch, so not a regression, but it belongs in the same piece of work.

It needs a design pass and its own lifecycle, not another round here.

**New confirmed findings:** 0
