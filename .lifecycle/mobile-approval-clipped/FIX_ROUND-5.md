# mobile-approval-clipped — FIX ROUND 5

Round 5 returned **9 confirmed findings, 6 of them HIGH**, and the headline is
that round 4's clamp — my fix for round 3's regression — was itself wrong. Three
consecutive rounds have now found a defect introduced by the previous round's
fix. That is the single most important fact about this branch.

## What round 5 found

- **The clamp re-broke round 3's fix for ORDINARY names.** The identity block was
  `min-w-0 flex-1` in a `flex-wrap` row against a `whitespace-nowrap` status
  sibling. `flex-1` means `flex-basis: 0`, and a basis-0 item never overflows its
  line, so the row NEVER wrapped and the identity column got **98px of the card's
  270px** at 390px (28px at 320px). Measured on fresh loads:
  `github__create_or_update_file_contents_v2` rendered **34 of 41 characters**;
  at 320px `mcp__filesystem__read_text_file` rendered **9 of 31**. These are
  ordinary MCP tool-name shapes. The benign-prefix attack was back — behind a
  fade instead of an ellipsis.
- **The server label was 0% visible by default** for any name taking three lines
  in that 98px column (measured 0 of 14 characters, twice). The card's trust
  anchor, gone, with every assertion green.
- **"Show more" re-opened the unbounded hole.** One click on the identity toggle:
  card **13,343px**, Deny at y=13,539 — 2.6x worse than the 5123px round 4 rated
  HIGH. And because ordinary names now clamped, that toggle was the ONLY way to
  read what you were consenting to: **the disclosure affordance was the exploit.**
- **TEST-10 was failing ~50% of runs on the branch as I shipped it** (reproduced
  3x, always `span 1693px in a 844px viewport`). It wrote `textContent` outside
  React and read geometry with no wait, before the ResizeObserver-driven clamp
  committed. My reported "22/22" was luck; the same un-awaited pattern was in
  TEST-8.
- **TEST-8's disclosure assertions passed on both fixed and broken code** — they
  measured the INNER span, which a bound deliberately leaves at full intrinsic
  size, so they were structurally blind to what the bound hides.
- **The sibling elicitation / ask-user consent cards render a raw server-chosen
  `message` with no bound at all**: measured **8,282px** and **7,035px** cards
  with Decline far below the fold, in files this branch edits.

## Fixed

- **The identity is now a bounded, SCROLLABLE region on its own row** — the
  `max-h-14 overflow-y-auto` pattern the card's own Arguments block already uses:
  bounded, fully readable, and with **no toggle to trick anyone into**. It no
  longer competes with the status text for width (that was the `flex-basis: 0`
  bug), so an ordinary name and its server label render in full.
- **The elicitation and ask-user `message` are bounded the same way**
  (`max-h-40 overflow-y-auto`), closing the same attack on the sibling consent
  cards.
- **The tests now measure what the USER sees**: `identityMetrics` computes the
  visible FRACTION of the name and label inside the bounded box, instead of the
  intrinsic size of the span inside it. TEST-8 drives REAL long tool names and
  requires them fully visible; TEST-10 asserts bounded + complete + scrollable +
  **no expand toggle**.
- **The race is gone**: every stress case polls for the write to land before
  asserting, and the assertions themselves carry the diagnosis rather than
  hiding behind a poll timeout.

## Negative controls (each reverts one specific property)

- Squeeze the identity column back to the 98px round 5 measured →
  `"github__create_or_update_file_contents_v2" (41 chars) is only 70% visible —
  an ordinary tool name is cut on a consent surface`. **Red.**
- Remove the bound → `a 6400-char name grew the card to 6351px in a 844px
  viewport`. **Red.**

A first attempt at the column control did NOT reproduce and I said so rather than
accept it: it restored the wrong geometry. The control above squeezes the actual
width, and fails.

## Verification

Full enumerated spec: **22 passed, three consecutive runs** (`r5-stab-1/2/3.log`)
— run repeatedly precisely because round 5 proved a ~50% flake was hiding here.
`npm run check (ui)`: exit 0 (`npm-check8.log`).

## Still open, reported not fixed

- Two "Show more" buttons on the card shared the accessible name "Show more"
  (MEDIUM, a11y). The identity toggle is now gone entirely, so only the
  description's remains — resolved as a side effect, not by design.
- The bidi comment overstated its fix: `unicode-bidi: isolate` protects the
  card's own status text from a U+202E in a server string, but not the ordering
  WITHIN that string. Comment corrected; no capability change (the string is
  attacker-chosen either way).
- `approval-dest-host` has no bound (LOW — it is a parsed URL host, so a
  realistic worst case adds ~180px, but nothing in code enforces the 253-char
  DNS limit).

**New confirmed findings:** 9
