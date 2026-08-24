# FIX_ROUND-1

Round 1 of the phase-6/7 loop. **Two angles**, both blind, both given diff-only
context and no access to `.lifecycle/`:

| angle | findings |
|---|---|
| `design-conformance` (required) | 9 |
| `correctness` | 10 |

`n1 = 9`, `n2 = 10`, overlap `m = 2` (the `deriveViewState` ordering bug, and
the unreachable git fixture — each reported independently by both).

Every finding was verified against CURRENT code before being worked; two were
already `superseded` by work done before the audit landed.

---

## The two that mattered

Both are `high`, both break a design invariant in a reachable state, and neither
was visible from the diff alone — each needed reading the code the diff CALLS.

**1. An enabled provider is still invisible (INV-2).** The step enabled the
built-in `Local` provider and stopped there. But the model picker reads
`get_for_user`, which INNER JOINs `user_group_llm_providers`, and every chat send
re-checks `user_has_access_to_provider` — neither with an admin bypass, and
nothing seeds such a row. So the installed model would have been invisible in the
picker and answered 403 ACCESS_DENIED in chat, and the user would have had to go
to Settings → LLM Providers → Groups: exactly what INV-2 forbids. The step now
assigns the default group when the provider has none, leaves an existing
arrangement alone, and reports a human-actionable problem when it cannot.

**2. The seeded row could be auto-disabled at boot (INV-5).** The startup health
scan skips rows with no credential — but `has_credential_for("none")` is always
TRUE, so the anonymous row was NOT covered by that skip. An offline, firewalled
or captive-portal first boot probes it, gets `Unhealthy`, and DISABLES it; and
re-enabling then requires a passing probe, so one transient outage permanently
defeats "a fresh install has it with no admin action". The boot scan now also
skips built-in anonymous rows.

Both fixes are pinned by tests **verified RED against the unfixed code**:

- TEST-6 gained a reachability assertion (`GET /api/user-llm-providers`, the
  endpoint the picker actually reads). Skipping the group assignment turns it red
  on the exact sentence describing the gap.
- TEST-21 asserts the seeded row is never **probed** (`last_health_check_status`
  stays `untested`), not merely still enabled. That distinction is load-bearing:
  the enabled-only assertion passes on a networked box, where the probe simply
  succeeds. With the skip removed, TEST-21 caught it here, on a networked box.

## Everything else worked this round

| finding | disposition |
|---|---|
| `deriveViewState` checked the stale terminal record before `installing` — a retry showed a live Retry button for the whole provider leg, allowing concurrent orchestrations (**both angles**) | fixed: ordering inverted; regression test covers both legs |
| `install()` had no re-entrancy guard (**both angles**, same root) | fixed: early-return when already installing |
| Install gated only on `llm_models::create` while the flow needs provider-edit, assign-groups and three runtime perms; `loadVersions` early-returns SILENTLY without `versions_read`, so the runtime leg would mis-report "nothing installed" | fixed: gates on the whole `allOf` set |
| `isDefaultModelInstalled` ignored `enabled` on provider and model, so a disabled either still claimed "you can start chatting" | fixed: both flags required |
| `findInstalledVersionId` matched on engine alone and fed `setDefaultVersion`, able to promote an unrelated runtime | fixed: matches the full requested tuple |
| `waitForRuntimeDownload` re-listed versions every 500 ms for 15 min (~1800 requests) when a snapshot was absent | fixed: server re-list floored at 5 s |
| the step store was never reset on leaving the wizard, unlike its two siblings, so a stale error re-rendered on a later visit | fixed: `reset` action wired at both existing reset sites |
| the `cancelled` view state was unreachable — the cancel action removes the row and both load paths filter it out | fixed: dead state and its note removed, rather than kept as decoration |
| TEST-7's doc claimed a dropped client handle; `drop(instance)` drops a `serde_json::Value` | fixed: the doc now states what the test actually proves |
| nothing verified the upstream repo/file names the whole feature hinges on | **verified out of band**: `git ls-remote` exits 0 with no credential and the HF API lists `Qwen3.5-9B-Q4_K_M.gguf`. Both values are CORRECT. The gap is real and un-closable by test (the design forbids hitting real HF), so the verification + date are recorded in the descriptor |

## Two accepted as `wontfix`, both escalated rather than silently absorbed

- **The LFS 30-minute absolute timeout** caps 5.68 GB at a sustained ~3.2 MB/s
  (~25 Mbps). Confirmed in code. NOT fixed here: raising it weakens a shared
  security bound for every caller, `Q3_K_M` only moves the floor, and choosing
  the minimum connection a first-run default supports is a product call. DEC-15 +
  a note in the design doc + `HUMAN_FEEDBACK`.
- **Gallery coverage.** The design lists seven states as "needing gallery
  coverage"; they are proven by mounting the real component instead, following
  the sibling steps' `skip: true` mapping under a `crawlOnly` module. The honest
  cost — those renders are not seen by `gate:ui`'s contrast/visual pass — is
  stated in DEC-16 rather than glossed.

## Two superseded before the audit landed

The unreachable loopback git fixture, and TEST-5's `if !raced_to_completion`
wrapper that made it pass vacuously. Both were already gone (DEC-14). The
conformance angle added a sharper argument for the same conclusion: the fixture's
401-on-`Authorization` gate could not have worked even if it were reachable,
because libgit2 supplies credentials only in response to a challenge — so a
credentialed repo would also have logged zero authenticated requests. That is
recorded, because it means the original plan's INV-1 proof was doubly hollow.

## Proportionality check

Of 19 findings, **3** landed on test code (TEST-5's wrapper, TEST-6's missing
assertion, TEST-7's doc) — 16%, well under the 60% GUARD-SUB threshold, and none
on a hand-written guard. The round's work is concentrated in the feature, which
is where it should be. No new test scaffolding was added; one fixture was deleted.

**New confirmed findings:** 0
