# FIX_ROUND-3 — and a RE-SCOPE

Two blind angles over round 2's diff: **correctness** and **api-contract /
cross-boundary agreement** (a third distinct pairing).

Two things this round makes me say plainly:

1. **Round 2 shipped a RED test.** It removed `X-Refresh-Cookie` from the
   required list and left the assertion that it is present. `cargo test -p ziee
   --lib` was failing on the branch. Confirmed by running it, not by reading.
2. **The queued-download repair was inert a SECOND time**, for a different reason
   than round 2 found. Round 2 corrected the predicate; the real situation is that
   the row's INSERT seeds a fully-zeroed `progress_data`, so no row ever has
   `NULL` and every frame carries `current: 0` rather than null. The guard cannot
   fire, and the "0 Bytes / 0 Bytes" a queued download renders comes from those
   seeded zeros — in the REST snapshot as much as the SSE frame. **The claim is
   withdrawn rather than restated for a third time**, the guard is kept as
   documented defence for the schema-permitted NULL case, and the real cause is
   escalated.

## The re-scope

Three rounds, and every round's worst findings were in the same place: the
**INV-4 loud-fail**, specifically its coupling to the turn's state. Each time the
same mistake in a new costume — inferring "the turn is over" from a stream that
had merely stopped delivering:

| round | what it badged / broke |
|---|---|
| 1 | a reply that completed days ago, badged `interrupted` at conversation-open |
| 2 | a reply that had just completed and was on screen, badged mid-`finalizingTurn` |
| 3 | a turn reset inside `sendMessage`'s own setup, before its POST — composer re-enabled and the previous reply badged at the instant the user pressed send |

That is not a series of unlucky bugs, it is one wrong idea being patched. So it
is removed rather than patched again: **`reportStreamSubscriptionError` now
raises the banner and touches nothing else.**

This is closer to what the owner actually asked for. The picker they answered
said "loud-fail the subscription only", and explicitly rejected the alternative
("add an end-to-end streaming deadline") as a product decision. Terminating a
stalled turn's UI state IS that deadline; re-deriving a private version of it from
stream health was scope I added and then spent three rounds defending. INV-4 asks
that the failure not present as "still working" — a banner naming the failure and
the remedy is exactly that, is true in every state, and needs to know nothing
about the turn.

The design doc now states this as what INV-4 delivers, including what it does not
(the spinner may still run behind the banner), rather than implying more.

## Also fixed

- **The RED test** — renamed and INVERTED: it now asserts `X-Refresh-Cookie` is
  deliberately absent from the union, with the reason, so the removal is pinned
  rather than merely done.
- **The per-turn re-arm covered only one branch.** On New-chat or a conversation
  switch the other branch ran, `putSubscription` returned early (no connection id
  mid-backoff), and nothing reported — so the first turn after a switch was silent
  for up to 2.5 minutes, the exact condition round 2's own doc text forbids. The
  re-report is hoisted above the branch; a different-conversation test added.
- **The banner text was three re-spelled literals** matched by `startsWith`. A
  reword would touch the client constant and the test beside it, strand the clear
  path, and leave every test green — the identical drift defect this branch
  condemns for the CORS header. `SUBSCRIPTION_ERROR_MESSAGE` is now exported and
  imported by both the clear path and the tests, compared by equality.
- **A regression round 2 introduced**: with `X-Refresh-Cookie` out of the union
  and not in the desktop allowlist, a plain browser at `http://localhost:1420` —
  an origin that allowlist explicitly supports — had its login refused at
  preflight. Added to the desktop list, which is what owns those origins.
- **Recovery was reported for an unsubscribe.** A 204 for `conversation_id: null`
  cleared the banner without proving the stream can be scoped. Now gated, with a
  test for the bare-unsubscribe case.
- **Both example configs contradicted themselves** — a new note saying
  `X-Refresh-Cookie` is not unioned, beside older prose saying "the three X-
  headers … the server UNIONS them". Corrected to name the two that are.
- **Stale comments**: "~7 s" for a banner that lands at ~3 s; a handler doc that
  omitted the per-turn re-report; "two kinds of origin" against a four-entry list;
  and a test fixture comment claiming to be "EXACTLY what the server emits for a
  queued row" when the server emits zeros.

## Escalated (new this round)

- **The pinned sdk gitlink is reachable only from a LOCAL branch.** A
  `clone --recurse-submodules` would fail with "not our ref". Correct and
  important — but it is a publication step, not a code defect: the sdk branch is
  pushed as part of opening the PR. Tracked here so it cannot be forgotten.
- **A permanent 404 on the subscription (conversation deleted or not owned) is
  treated as a transient outage** — endless reconnect plus a banner. Real, and
  distinguishing terminal from transient statuses is a new behaviour with its own
  design; not taken on a branch already re-scoped once for this kind of creep.
- **The queued-download zeros** come from the INSERT seeding a zeroed
  `progress_data`. Whether a not-yet-started download should render "0 Bytes /
  0 Bytes" or nothing is a display question for the owner.
- The codegen gap (`emit_ts` filters `null` out of nullable-optional unions,
  against CODING_GUIDELINES §10) is confirmed with its generator line.

Rounds 1-2's escalations still stand.

## Convergence

| round | angles | confirmed | HIGHs | where |
|---|---|---|---|---|
| 1 | correctness · design-conformance · security | 19 | 2 | INV-4 loud-fail |
| 2 | state-management · design-conformance/test-reality | 19 | 2 | INV-4 + download merge |
| 3 | correctness · api-contract | 16 | 3 | INV-4 + download merge |

The profile is flat, and I am not going to dress that up. Under the skill's rule
a flat profile at round ≥5 is an ABORT-and-re-scope; I am reading it as an early
signal rather than waiting two more rounds to be told, because the cause is
legible: **every HIGH across all three rounds is in the two places I ADDED beyond
the diagnosis** — the turn-coupled loud-fail and the progress_data guard. The
CORS chain that is this branch's actual subject has now been audited by seven
angles and has produced zero findings; the security angle cleared it explicitly
with its work shown.

So this round removes the generator rather than patching its output: the turn
coupling is gone, and the progress guard's claim is withdrawn. What remains in
INV-4 is one `set({ error })` with no inputs beyond the message.

The guard-substitution tripwire does not fire: this round's findings span
production code (4 files), two test files, three docs and two config files.

**New confirmed findings:** 17

(The count round 3's own re-audit returned — two angles, regression/removal-safety
and whole-feature conformance. Two of them are regressions this round's REMOVAL
introduced, which is the specific risk of a re-scope and the reason the re-audit
was pointed at removals. Worked in `FIX_ROUND-4.md`.)
