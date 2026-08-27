# FIX_ROUND-1 — mcp-boot-probe-sandboxed-stdio

Two blind auditors, two differing angles (`design-conformance`, `correctness`),
each given only `git diff origin/main...HEAD -- src-app` and none of my reasoning.
16 ledger rows: **11 fixed, 1 obsolete, 4 accepted-and-escalated**.

## What the audit changed about the fix itself

Three findings changed the shipped code in ways I would not have reached alone:

1. **The readiness wait was inert, and cost 30 s a call** (F-1, corroborated by
   both angles). ITEM-3 waited on `code_sandbox`'s published status so a
   sandboxed row could not be mis-routed onto the host path by a boot race — but
   ITEM-1's skip already makes that unreachable: the sweep never probes a
   `run_in_sandbox` row, and `should_sandbox()` requires `run_in_sandbox`, so no
   row the sweep still probes ever consults sandbox state. The correctness angle
   measured a 30.11 s lib-test run caused entirely by `SANDBOX_READY_TIMEOUT`.
   **I had run that same test myself and read `30.13s` without questioning it.**
   Removed the wait, both constants, the injected-status helper and its three
   unit tests; the module doc now argues the ordering guarantee structurally
   instead. Measured effect: the boot-probe integration suite went from
   **32.62 s to 2.52 s**.

2. **My own DRIFT-1 fix stopped one layer short** (F-6). I had fixed the two
   badge tooltips so an admin was no longer told to perform two no-op remedies —
   and left the two Test Connection *toasts*, which map `success === false` to
   `message.error`. The result was a red error toast whose own body reads "This
   is a limit of the test, NOT a problem with the server." Same defect, one
   layer up, found by an auditor and not by me.

3. **INV-2 held only on the resolved-row path** (F-7). The sandbox guard keys
   off the ownership-scoped lookup, but the health write used `request.id`
   unscoped — so POSTing a *system* sandboxed row's id at the *user* route
   probed it on the host and stamped it `unhealthy` with the verbatim
   host-allowlist message, re-creating the reported bug on the system row.

## Test quality

F-2 (corroborated) found that TEST-1's and TEST-6's `untested` assertion was
satisfied by the column DEFAULT: deleting the skip's `record_health_check_on`
outright would still have passed. **That is the third vacuous-assertion finding
on this workstream**, which is itself the signal — reading a test and believing
it is not verification. Both now seed a stale `unhealthy` verdict first and
assert it was replaced.

## Accepted, not fixed — and why

Four findings are real and are NOT fixed here. They are in the PR body rather
than only in this file, because lifecycle artifacts are stripped at merge:

- **F-11 (HIGH)** — every user stdio server is force-sandboxed by
  `user_policy::enforce`, so `unhealthy` is now unreachable for that entire
  class. Accepted: before this change that class got a verdict, but it was the
  WRONG verdict produced by host-probing a guest-only command. No probe path can
  validate a sandboxed server today; building one is DEC-4's follow-up.
- **F-12** — dropping auto-disable means a permanently dead non-sandboxed server
  is re-dialled every chat turn. Accepted because the owner's brief explicitly
  required it ("a probe failure must not silently DISABLE an admin's server on
  boot"); the cost is now stated so the decision is made in view of it.
- **F-13** — `llm_repository` solved this same problem with a NEW status value
  (`unverified`) plus migration, enum and distinct UI treatment. Better shape;
  out of LIGHT tier. Named so the follow-up need not rediscover it.
- **F-14** — the sibling boot sweep still auto-disables, so the two now behave
  oppositely on one restart. Out of scope; surfaced rather than left to be
  discovered.

## Termination

LIGHT tier calls for one round at two differing angles including a core angle;
both ran and both delivered. I am not running a second round: every corroborated
finding is fixed, and the four that remain open are decisions for the owner, not
defects a further round would resolve.

**New confirmed findings:** 0
