# mobile-approval-clipped — FIX ROUND 4

The orchestrator asked for another blind round because rounds 1-3 had each found
real defects. It was right to ask: **round 4 found that MY round-3 fix introduced
a HIGH regression**, and that the test I wrote to guard it could not possibly
catch it.

## The regression I introduced, and why my own test missed it

Round 3 correctly found that the tool name ellipsised to a benign-looking prefix.
My fix removed `truncate` and used unbounded `wrap-anywhere` — i.e. I fixed the
truncation by deleting the BOUND. Round 4 measured the consequence live:

- 390x844, a 6400-char name: card grows to **5123px**, Deny lands ~2800px below
  the fold. A 920-char name already spans 1109px against an 844px viewport, so
  the name and the decision row **provably cannot be on screen together**.
- 1280x900, same token: `cardTop = -617`, i.e. 577px of the name scrolled off the
  top while Approve stays in view.

That is verbatim the failure the card's own description clamp exists to prevent
(`approvalDescriptionClamp.ts`: "an unbounded description pushed Deny/Approve
below the fold … the cheapest way for a hostile server to leave Approve as the
only action in view"). I had traded a disclosure defect for the ORIGINAL
below-the-fold defect, one row higher, while claiming the opposite in a commit
message.

**And TEST-8 could not have caught it.** Round 4 evaluated my two new assertions
at 64 / 640 / 6400 characters: both are TRUE in every case, because a wrapping
box never carries horizontal overflow and the other assertion literally *requires*
the box to grow. My guard was satisfied by the very defect it was written for.

## Fixed

- **The identity line is now bounded AND complete**, using the treatment already
  in this file for the other attacker string: `CollapsibleBlock` with a
  `APPROVAL_IDENTITY_COLLAPSED_MAX_PX = 56` clamp, a fade, and a Show-more
  toggle, with every character still in the DOM. Measured after the fix: a
  6400-char name gives a 60px clamped region and a **583px** card (was 5123px),
  and the toggle appears.
- **Both strings are now bidi-isolated** (`dir="ltr"` + `unicode-bidi: isolate`).
  Round 4 verified a U+202E injected into the name was preserved and reversed the
  visual order of everything after it, including the status text. Pre-existing,
  but squarely inside the threat model this change declares for itself.
- **TEST-8 gained the CEILING half**: under a 6400-char name the identity region
  must stay clamped and the card must stay within the viewport — i.e. the
  mobile analogue of the pre-existing TEST-10b's desktop fold assertion, which
  was the suite's ONLY vertical-fold guard and ran at 1280x900 with the 12-char
  fixture name.
- **TEST-10 (new) covers the server label**, which round 3 changed with ZERO
  coverage — round 4 confirmed that reverting that line left all 20 tests green.
- Two pre-existing description assertions were scoped to the description's own
  collapsible: the card now has two, and they were matching whichever came first
  (a real strict-mode failure, caught by running).

Negative control: setting the clamp to `999999` (the round-3 behaviour) turns all
four of these red — `a 6400-char tool name produced a 12816px identity region`
and `the server label and Deny span 1693px in a 844px viewport`.

## The self-consistency finding — answered, not dodged

Round 4 is right that "nothing this card discloses is truncated" was applied to
ONE of the six headers this branch edited. The rule as stated was too broad. The
honest distinction, now the operating rule:

- **The PENDING-APPROVAL card is the decision point.** Its two server-chosen
  strings get bounded-and-complete (clamp + reveal), because that is where a
  concealed identity changes what the user consents to.
- **The elicitation and ask-user cards** are also consent surfaces, but their
  server name is displayed context rather than the object of the decision, and
  their fixtures are `truncate` + accessible text. Left as-is, recorded.
- **The cancelled card and the three `extension.tsx` cards are informational**
  (a decision already made, or history). `truncate` is appropriate there.

That is a defensible line rather than a silent inconsistency — but it IS a
judgement, and it is flagged for the owner rather than settled by me.

## Still open, reported not fixed

- `JsToolApprovalContent` orders Approve BEFORE Deny, inverting the negative-first
  order this branch standardises on every sibling.
- The `deep-chat-elicitation-no-fields` cell renders 0 no-fields cards.
- `SubAgentActivityCard.tsx:49` carries the starvation shape outside this family
  (static app strings, so not attacker-controlled).

## Verification

Full enumerated spec: **22 passed, 0 failed** (`round4-final2.log`).
`npm run check (ui)`: exit 0 (`npm-check7.log`).

**New confirmed findings:** 0
