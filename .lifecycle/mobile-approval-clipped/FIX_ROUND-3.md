# mobile-approval-clipped — FIX ROUND 3

The third blind reviewer DID return (after the branch had been written up as if it
had not — that write-up was corrected). It did not find zero. It ran live
measurements against the gallery at 320/390/768/1280, in 260/200/150px containers,
in both themes and in RTL, and it reproduced the pre-fix numbers by injecting CSS.

## Independent confirmation of the core fix (recorded, because it is evidence)

The reviewer verified, by measurement rather than by reading: the row computes
`flex-wrap: wrap` / `justify-content: flex-end`; every decision control has
`visibleWidth == width` and passes a Playwright trial click at every width tested;
`[&>:is(button,a)]:h-auto` genuinely beats the button's `h-8` (32px unwrapped,
50/70px wrapped); `wrap-anywhere` resolves to `overflow-wrap: anywhere` in
Tailwind 4.3 and an unbroken 63-char token wraps inside the button; RTL mirrors
correctly with Deny at the inline-start. A CSS-injected reversion reproduced the
exact pre-fix numbers (Deny at x=-174, visibleWidth 0, trial click timing out),
confirming TEST-1/2/3/5/6/8/9 are real gates rather than tautologies.

## Fixed — two attacker-controlled strings were still being hidden

Both are on the consent card's header, i.e. a row this branch had already edited,
and both violate the card's own contract that nothing it discloses is truncated.

- **The tool name still ellipsised to a benign-looking PREFIX.** Measured at
  390px with a 64-character name: 238px rendered of the 534px needed. So
  `get_weather_forecast_readonly_public_safe_then_delete_everything` reads as a
  harmless prefix. Round 2's `title=` was NOT a fix — it is hover-only, and this
  defect is on touch. The name now WRAPS (`wrap-anywhere` + `min-w-0`) and the
  card grows instead.
- **The server label clipped with no ellipsis and no cue.** Measured at 390px
  with a long hostile label: a 393px box of which only 254px survived the card's
  `overflow-hidden` — so a server can conceal the tail of its own identity (the
  trust anchor) on the surface asking the user to trust it. It now wraps too.

**TEST-8 was fixture-bound and could not have caught either.** It only ever
rendered the gallery's 12-character `get_forecast`, which fits trivially once the
header wraps. It now drives the 64-character hostile name for real and asserts the
name neither overflows its box nor stays on one line. Negative-controlled:
reverting the two labels to `truncate`/`whitespace-nowrap` turns it red with
`the tool name overflows its box (534px of 238px)` — the reviewer's own number.

## Fixed — scope hygiene

- The three `extension.tsx` tool-call headers had also gained `gap-2` on their
  OUTER row. Unlike `flex-wrap`, that is NOT inert when the content fits: it adds
  8px at every width, on three cards unrelated to this defect, with no assertion
  covering it. Reverted; those headers keep only the `flex-wrap` fix.
- The `CardActionsProps` JSDoc still said `break-words` after round 2 changed the
  code to `wrap-anywhere`. Synced.

## Accepted, not fixed (reported)

- The `deep-chat-elicitation-no-fields` gallery cell renders 0 no-fields cards, so
  the migrated "Accept without values" footer has no rendered coverage. Confirmed
  independently by the reviewer; a pre-existing fixture gap, reported.
- `TEST-10d` (pre-existing) is named for an unbroken token it never renders. The
  reviewer verified the PRODUCT is fine there (a 4000-char run gives
  `scrollWidth == clientWidth`); the test is a style-proxy. Not this branch's test.
- `TEST-3`'s third assertion and TEST-4/TEST-7/TEST-10b/TEST-11 pass on both fixed
  and broken markup by construction. They are legitimate guards (desktop
  no-regression, fixture precondition) but must not be counted as coverage of the
  390px defect — recorded so nobody does.
- `TEST-9`'s 260px squeeze is load-bearing: at 200px the virtualizer's cached row
  height produces a vertical clip that is an artefact of the technique, not the
  component.
- `SubAgentActivityCard.tsx:49` carries the same starvation shape outside the
  approval family (static app strings, not server-supplied, so lower risk).
- `JsToolApprovalContent` orders Approve before Deny, inverting the negative-first
  order this branch standardises on its siblings.

## Round-4 verification — it did NOT return zero

A fourth blind reviewer audited the post-round-3 diff and found **7 confirmed
findings**, including a HIGH regression introduced BY this round's own fix (the
tool-name change removed the bound, not just the truncation) and a HIGH
tests-quality finding that this round's rewritten TEST-8 could not fail on it.
See `FIX_ROUND-4.md`. Recorded here rather than claimed as convergence.

## Verification after this round

Full enumerated spec: **20 passed, 0 failed** (`round3-final.log`).
`npm run check (ui)`: exit 0 (`npm-check5.log`).

**New confirmed findings:** 7
