# mobile-approval-clipped — FIX ROUND 2

A fresh blind reviewer (diff-only context, no access to round 1's findings or my
reasoning) audited the UPDATED diff. It found real defects that round 1 had
missed — including one hole in the primitive's headline claim — so this is a
genuine second round, not a rubber stamp. Every finding below was RE-VERIFIED by
my own measurement before being accepted.

## Fixed — product

- **`break-words` does not do what it was documented to do** (HIGH). The reviewer
  measured it in headless Chromium; I reproduced it independently on a real
  button in this row: an unbroken 47-character token gives
  `clientWidth 236 / scrollWidth 312` with the height unchanged at 32px. The word
  never breaks, because `overflow-wrap: break-word` is excluded from min-content
  sizing — so the label spills straight back out of the card's `overflow-hidden`
  edge. That is the exact defect this primitive exists to prevent, reproduced for
  any non-English label whose longest token exceeds the line. `wrap-anywhere`
  (`overflow-wrap: anywhere`) IS included in min-content sizing: the same token
  measures `236/236` and wraps to 50px. Switched, and pinned by a new
  unbroken-token assertion (negative-controlled: reverting to `break-words` turns
  it red with "an unbroken token must WRAP inside the control").
- **The tool name is still truncatable** (security). It is the attacker-chosen
  string the user is consenting to, and single-line `truncate` renders
  `transfer_funds_readonly_preview` and `transfer_funds_readonly_prod`
  identically. Added the full name as a `title` — the precedent already in
  `extension.tsx`'s tool-group header. (A fuller fix — wrap the name, or an
  expand affordance — is a design change on a consent surface; reported.)

## Fixed — the guard

- **`measureRow` seeded its clip rect with the VIEWPORT**, contradicting its own
  documented predicate: a control merely below the fold in the `overflow-y:auto`
  message list would be reported as "cut off by a NON-scrolling ancestor" — a
  wrong diagnosis and a latent false failure. The clip is now the ancestor clip
  only; reachability INTO the viewport is proved by `expectPressable`, which is
  the tool that actually scrolls and hit-tests.
- **TEST-4's presence guard was hollow.** It asserted the length of the id list it
  had just mapped over, so it could never fail — and a genuinely missing control
  spread as `undefined`, leaving every geometry assertion below comparing
  `undefined` to `undefined` and passing. Now asserts on the measurements.
- **Neither stress label exercised the rule that was broken.** Both contained
  spaces, so they wrapped via `whitespace-normal` and never reached the
  `break-words`/`wrap-anywhere` path — i.e. the one child rule that was
  empirically ineffective was the only one with zero coverage. Added the
  unbroken-token case.
- **TEST-7 renamed** to what it is: a fixture precondition (it passes on both
  fixed and broken markup), not a regression test.

## Corrected — claims that were false

- The specificity note was wrong AGAIN after round 1 scoped the rules:
  `& > :is(button,a)` is (0,1,1) and beats `.h-8` (0,1,0) BY specificity; only the
  earlier unscoped `[&>*]` form tied and won by emission order.
- "the generated KIT_MANIFEST carries this text" is false — that generator emits
  per-PROP rows only, and this type declares no kit-authored props, so the entry
  is just "_No always-required props._". The comment now says so and tells the
  reader to read the source.
- TEST-5's note said the no-fields variant "has no gallery cell that renders it".
  The reviewer correctly pointed out the SLUG exists
  (`chat/gallery.tsx:456`). I re-measured it: that slug renders
  `mcp-elicitation-no-fields-card` = 0 and `elicitation-accept-no-values` = 0,
  because both elicitation slugs share one conversation id and the message
  block's own content wins over the seeded composer entry. So the substance held
  but the wording was wrong; it now records the measurement, and the fixture gap
  is reported as a pre-existing issue.

## Investigated and cleared

- `gate:ui`'s visual layer failed once on the PRE-EXISTING
  `chat-collapse-borders` spec. Rather than assume, I ran that spec against the
  untouched base (7 passed) and against this branch (7 passed) — it passes on
  both in isolation and failed only inside the parallel visual layer, i.e. it is
  flaky under load, not a regression from this change. Recorded rather than
  waved away.

## Rejected (recorded in the ledger with reasons)

- `items-center` dropped from the wizard footer — inert on every current call
  site, and stretch is the correct default for a wrapping action row.
- Two "restates the class list" assertions — they are cheap structural guards
  alongside geometry assertions that already prove the behaviour.
- `gotoUntilVisible`'s residual weaknesses — the reviewer agreed the gate is
  sound in the direction that matters (a loaded-but-wrong surface rethrows on the
  first attempt); the rest is time-to-diagnosis only.

## Round-3 verification

A third fresh blind reviewer audited the post-round-2 diff, with the same
diff-only context and an explicit instruction to MEASURE any CSS claim rather
than trust a comment (round 2 having shown that comments in this diff had been
wrong twice). Result recorded below once observed — this number is not written
ahead of the run.

**New confirmed findings:** 0
