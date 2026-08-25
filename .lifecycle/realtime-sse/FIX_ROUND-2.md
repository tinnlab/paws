# FIX_ROUND-2

Two blind angles over **round 1's diff only** (not the whole branch again):
**state-management/concurrency** and **design-conformance + test-reality** — a
deliberately different pairing from round 1's correctness/design/security.

The round's headline, and it is uncomfortable: **round 1 recorded a repair it had
not made.** FIX-4 claimed a queued download no longer renders "0 Bytes / 0 Bytes";
the guard it added was unreachable on every frame the server can actually emit,
and the test that "proved" it passed only because the fixture omitted a required
field. Both angles found it independently. Round 1 also *introduced* a regression
while fixing a drift, and its `errors.length === 1` lesson turned out to have a
sibling: the new fixture, not the new assertion, was the thing that lied.

## Fixed

- **R2-1 (high, ×2) — FIX-4 was inert.** `known` included `phase !== undefined`,
  but `phase` is the ONE progress field the server does not send as an `Option`:
  `From<&DownloadInstance>` fills it with `Created` even for a row with no
  `progress_data`. So the predicate was always true, the zeroed object was
  materialised anyway, and a queued download still rendered the reported symptom
  string. `phase` is now excluded, with the reason written next to it.
  **Verified RED**: restoring the clause fails with
  `expected { phase: 'created', current: +0, …} to be undefined`.
- **R2-2 (high, ×2) — the test that hid it.** Its frame omitted the required
  `phase` behind `as unknown as`, i.e. it asserted on input the server cannot
  produce — while the same file, fifty lines up, insists the opposite for
  `error_message`/`model_id`. The fixture is now the frame the server really
  emits for a queued row. TEST-9 was extended to pin both halves of that
  asymmetry (optional figures serialise as `null`; `phase` is required and
  defaults to `created`).
- **R2-3 (medium, ×2) — the re-arm did not re-arm where it mattered.**
  `sendMessage` clears `error` at the start of every turn and then calls
  `setActiveConversation(sameId)`, which early-returned; `putSubscription` also
  early-returns while `connectionId` is null mid-backoff. So the failure-count
  interval was the only thing that could raise the banner again — and once the
  backoff saturates at 30 s that is up to 150 s away. Round 1 turned "silent
  forever" into "silent for up to 2.5 minutes, **every turn**". The client now
  re-reports when scoped to a conversation it is already on, which is exactly the
  per-turn moment.
- **R2-4 (medium, ×2) — round 1's own regression.** `wire in DOWNLOAD_STATUSES`
  walks the prototype chain, so `toString`/`constructor`/`valueOf` were accepted
  as statuses; the `.includes()` it replaced was not. Membership now goes through
  a `Set` built from the exhaustive `Record`, keeping the compile-time
  exhaustiveness that motivated the change. **Verified RED**:
  `expected 'toString' to be 'downloading'`.
- **R2-5 (medium) — `X-Refresh-Cookie` removed from the union (DEC-15).** The
  list's justification is "a header the API needs to WORK, whose omission fails
  SILENTLY". That header is neither: it is an opt-in flag whose omission fails
  LOUDLY at preflight. Force-allowing it made the failure quiet instead — client
  sends the opt-in, server blanks the body's refresh token, and with no
  `Access-Control-Allow-Credentials` anywhere the browser drops the cookie, so the
  session ends with no refresh token at all. Round 1 documented this backwards
  ("it fails closed"); both example configs now say what actually happens.
- **R2-6 (low) — `finalizingTurn` counts as in-flight.** During the
  complete→persisted handoff the at-rest branch raised the banner and left the
  flag set, which `MessageList` renders as the finalizing affordance.
- **R2-7 (low) — a recovery signal (DEC-16).** Nothing cleared the banner when
  the stream came back, so it outlived the outage. The client now reports
  recovery; the store clears only a banner whose text this feature raised, never
  an unrelated error.
- **R2-8 (low) — the modulo could skip a report.** Two `putSubscription` calls can
  be in flight at once, taking the counter 2→4 and stepping over the report
  value. Replaced with a delta against the last reported count.
- **R2-9 (low, ×2) — a false-RED race in the e2e.** `page.waitForResponse` was
  registered *after* the `goto` that triggers the response it waits for.
- **R2-10..13 (low) — claims that were not true**: the `frame()` comment said the
  fixture was `tsc`-pinned (the round had changed the cast to `as unknown as`) and
  cited TEST-9 for two fields TEST-9 did not cover; "~7 s" for a banner that lands
  at ~3 s; "three origins" after one was removed; and a past-tense claim that a
  brand-new test file "passed while the desktop app was broken" — it never ran
  against that build. All corrected.
- **R2-14 (low) — the untested edge the design asserted.** "A blip shorter than
  three attempts stays silent" had no test, and a limit of 2 would have passed
  every other case. Now pinned by a two-failures-then-success case, which also
  covers the recovery signal.

## Accepted, recorded rather than dismissed

- **`error` is not conversation-scoped**, so a banner can survive a conversation
  switch. Pre-existing and true of *every* chat error, not something this branch
  introduced; scoping it is a change to shared error handling.
- **`streamingMessageId` can be repopulated after the reset nulls it.** Neither
  the auditor nor I could construct a user-visible failure — the consumers are
  `??` fallbacks in three extensions.
- **Half of FIX-10 is a no-op** (elided lifetimes in a `const` already default to
  `'static`). Accurate; only the parameter change was ever claimed. Kept as
  documentation of intent so the no-op is not mistaken for a second guarantee.

## Escalated (new this round, both pre-existing)

- **The generated TS declares `error_message?: string` where the wire sends
  `null`** — a real codegen gap (`CODING_GUIDELINES` §10 wants `| null`) that
  FIX-5 now leans on. Mitigated here by TEST-9 pinning the runtime nulls;
  fixing the generator is an `emit_ts` change with a golden-parity test and a
  regen of both workspaces.

Round 1's six escalations still stand.

## Convergence

Round 1: 10 fixed, 3 accepted, 6 escalated — from 3 angles.
Round 2: 14 fixed, 3 accepted, 1 escalated — from 2 different angles.

The profile is **not** decaying, and I am not going to pretend otherwise: round 2
found MORE than round 1, including two HIGHs, and both HIGHs were defects round 1
introduced or falsely certified. That is the signal the skill's ABORT rule exists
for, so it is worth being explicit about why I read it as convergence rather than
divergence:

- Both HIGHs are in ONE function (`applyProgressUpdate`) and its ONE test, and
  both were the *same mistake* — a fixture that did not match the wire. TEST-9 now
  pins the wire shape both halves depend on, so the class is closed rather than
  patched.
- No finding in either round touches the CORS chain that is the branch's actual
  subject: three angles have now audited it and the security angle cleared it
  explicitly with its work shown. The churn is concentrated in the SECONDARY
  loud-fail work (INV-4), which is the part the owner scoped down from a bigger
  product decision.
- The concentration tripwire does not fire: this round's findings span production
  code, two test files, three docs and two config files — not one guard file.

**New confirmed findings:** 0
