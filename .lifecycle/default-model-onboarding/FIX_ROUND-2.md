# FIX_ROUND-2

Round 2, over **round 1's diff only** (`6525e4cb1..aced9daed`), per the
scope-to-the-round rule. Two angles, both blind, both diff-only, both different
in KIND from round 1's `design-conformance` + `correctness`:

| angle | findings |
|---|---|
| `security` (authz emphasis) | 6 |
| `tests-quality` (test-reality) | 10 |

`n1 = 6`, `n2 = 10`, overlap `m = 1` (the permission gate — reached from
opposite directions: the security angle read the flow's calls, the tests angle
read the e2e grant list).

---

## The shape of this round is the point

Round 1's fixes were themselves the subject, and **the two `authz` findings were
in code I had just written to CLOSE an authz gap**. Fixing INV-2 meant
introducing an access-control WRITE, and I had not bounded it. That is worth
naming plainly: the risk did not come from the original feature, it came from
the fix.

**It failed open.** The read that decides whether a grant is needed swallowed
its error and set `assigned = []` — so a transient 5xx would conclude "no
groups" and *grant*. My own comment three lines below claimed to "leave an
operator's existing arrangement exactly as it is". Now it fails **closed**: an
unreadable arrangement is never overwritten.

**It reversed a deliberate decision.** Removing a provider from every group is a
first-class admin action — the supported way to hide a provider while leaving it
enabled — and I treated the resulting empty set as "never configured" and
repaired it. The rule is now: **grant only as part of provisioning this step
performed itself.** If the provider was already enabled, the arrangement is
someone else's; the step says what to do instead. A fresh install (provider
disabled) still satisfies INV-2, which is the case that matters.

Two more from the same angle: the fallback chain ended in `active[0]`
(alphabetically first — on a deployment with >100 groups or a renamed default,
plausibly "Auditors"), and the step enabled whichever local provider sorted first
rather than the seeded built-in. Both now refuse to guess.

## The gate was still wrong, from both directions

Both angles found the permission gate independently. `security` read the flow's
calls and found `groups::read` + `llm_providers::read` missing — and the group
lookup is not wrapped, so a user missing `groups::read` would throw AFTER the
provider was enabled, leaving a half-applied administrative change.
`tests-quality` found the same hole from the e2e grant list, which called itself
"everything the install flow touches" and did not include it.

Fixed, plus `user_llm_providers::read` for the new reachability read.

## The test findings were the more uncomfortable half

Six of ten said, in effect, *the code you added in round 1 has no test*. They
were right — `install.ts`, `ensureRuntime.ts` and `reset.ts` all shipped with
none. And two said something sharper: tests that **could not fail**.

- `usePermission` was mocked to ignore its argument, so the test claiming to
  cover the whole `allOf` proved nothing about which permissions gate the
  control. The mock now EVALUATES the expression against a held set, and a loop
  mounts the component once per required permission with that one withheld.
- `isDefaultModelInstalled` checked two `enabled` flags while the step derived
  from the **admin** provider list — so an enabled-but-unshared provider still
  rendered "you can start chatting", which is exactly the invisible-in-the-picker
  state this whole feature exists to prevent. The step now derives from
  `GET /user-llm-providers`, which the server has already filtered to
  enabled + group-reachable. "Installed" now means "the user can actually see it".

## Verified RED, not asserted

Three fixes were confirmed by breaking them and watching the test fail:

| mutation | result |
|---|---|
| delete `RuntimeVersionUpdate` from the component's gate | the drop-one loop fails, naming that permission |
| restore engine-only matching in `findInstalledVersionId` | "promotes the version it DOWNLOADED" fails |
| delete the group assignment from TEST-6 | the reachability assertion fails on the sentence describing the gap |

Writing the `ensureRuntime` test also caught a defect in my own first draft: I
seeded the post-download version list upfront, which short-circuited the leg
under test. The run caught it; reading it would not have.

## Residual, stated rather than hidden

**The `OnboardingPage` wiring of `reset` is untested.** `reset` itself is now
covered, but that `OnboardingPage` calls it on unmount and on guide-completion is
asserted by nothing — there is no `OnboardingPage` test, and standing one up
(router + slots + module system) is disproportionate to a two-line call at the
same two sites its siblings already use. Recorded rather than claimed as covered.

## Proportionality check

Of 16 findings, 9 landed on test code — but **not on one guard file**: they are
spread across five different test files and three previously-untested production
modules, and the work they produced is coverage of real behaviour, not another
predicate defending a predicate. GUARD-SUB fires on ≥60% concentrated on ONE
test/guard file; the highest concentration here is 3 findings on
`DefaultModelStep.test.tsx` (19%). No hand-written static-analysis guard exists
in this feature at all.

**New confirmed findings:** 0
