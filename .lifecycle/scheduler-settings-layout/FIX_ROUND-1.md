# FIX_ROUND-1 — scheduler-settings-layout

Fixes for every `status: confirmed` finding in `LEDGER.jsonl`. Findings recorded
`rejected-false-positive` (AUD-5, AUD-6, AUD-7, AUD-8, AUD-10, AUD-18, AUD-19,
AUD-20) were examined against the code and the named siblings and are explicitly
NOT fixed, with the reason on each ledger row — a dismissed finding is not a fix,
so each says what was checked and why the current behaviour is right.

## Fixed

- **AUD-1** (`SchedulerAdminPage.tsx`) — the no-row guard is now `settings == null`
  (`const isLoading = settings == null`), checked AFTER the error branch, with
  `loading` dropped from the destructure since nothing reads it. **The claim was
  downgraded before it was fixed**: the stronger "the shipped guard flashes
  fabricated defaults" did NOT reproduce (weak guard restored, gallery `delayed`
  mode with the page chunk pre-warmed and 25 ms sampling still showed the Spin at
  500 ms and no form — React flushes the mount effect before paint). What remains,
  and what is fixed, is a reachable *state* rather than an observed flash:
  `loading` is not a proxy for "no row" (`loadSettings` early-returns without it
  when `hasPermissionNow` is false), and the stakes are unusually high here
  because `defaultValues` are the server's own defaults, so a row-less render
  shows five authoritative-looking numbers. The guard now matches the canonical
  sibling (`RetrievalLimitsSection`: `if (!settings) return <status/>`).
  Regenerating the state matrix after the first attempt exposed a second-order
  problem — a bare `!settings` condition classifies as `branch`, which silently
  DROPPED this surface's `delayed` required-state and broke `stateCoverage.ts`
  — so the condition is bound to a named `isLoading`, which the generator
  classifies as `loading` and which keeps the `delayed` gallery-coverage
  requirement. Pinned by **TEST-9**.
- **AUD-2** (`admin-settings-layout.spec.ts`) — TEST-5a now looks up the five
  known Limits label texts by name (`LIMIT_LABELS`) and asserts presence + `<= 2`
  lines on each, instead of asserting over every multi-word label in the document.
- **AUD-3** (`label-starvation.ts`) — removed the dead `collectStarvedLabelsIn`
  export and the now-unused `Locator` import.
- **AUD-4** (`SchedulerAdminPage.tsx`) — the unit is back in the accessible
  description for the three unit-bearing fields ("The fastest cadence, **in
  seconds**, …", "How far ahead, **in days**, …", "How long, **in days**, …"),
  which `aria-describedby` exposes (measured present on all five inputs). The
  `suffix` convention is kept, so the page does not diverge from its siblings.
- **AUD-11** (`SchedulerAdminPage.tsx`) — branch order: `error && !settings`
  precedes the no-row branch, so a failed load still reaches the retryable
  `ErrorState` instead of an endless spinner. This became load-bearing only
  because of the AUD-1 fix; the code comment says so.
- **AUD-12** (`admin-settings-layout.spec.ts`) — TEST-9's interception is a
  THROTTLE, not a mock: it sleeps and then `route.continue()`s, so the real
  backend serves the real body (DEC-12 / TESTING_GUIDE hold).

## Recorded, not fixed (surfaced to the owner)

- **AUD-9 / GAP-1** — the `!canManage` read-only branch, whose behaviour DEC-10
  changes, has no automated coverage before or after this branch. Closing it is a
  harness change (a permission axis on page-surface gallery states, or a
  `read`-without-`manage` user fixture), out of scope for a layout fix. Written up
  in `INFRA_INTEGRATION.md` and in the hand-off summary rather than papered over.
- **AUD-14** — the sweep's fixed `waitForTimeout(1200)` per surface fails OPEN (a
  slow surface can be measured before it paints, missing a detection) and never
  closed. Stated in the ledger so nobody reads a green sweep as exhaustive.
- **AUD-15** — the 390px leg cannot catch this defect class (clause 3 correctly
  refuses to blame a narrow row); the desktop/tablet legs are the proof.
- **AUD-16** — the four clauses are duplicated across the app helper and the
  agent-kit rig by necessity (cross-repo). Equivalence is proven by execution
  each time, not assumed.
- **AUD-17** — ITEM-10's artifact deliberately does not ride the superproject
  pointer (DEC-7/DEC-8), so it is NOT shipped by this branch; the summary says so.

## Re-audit

Re-ran every angle over the post-fix diff (the process caveat on the first
ledger row applies equally to this round: same agent, not a blind reviewer).
The three code changes were re-checked specifically:

- the `isLoading` guard — re-probed in `delayed` mode: Spin at 350 ms, no card,
  no inputs; the row lands at 725 ms. The `error`-first ordering was re-read
  against the retry path (`loadSettings` clears `error`, so Retry re-enters the
  loading branch rather than sticking on the ErrorState).
- the state-matrix regeneration — `stateMatrix.generated.ts` now records
  `{error: "error && !settings"}`, `{loading: "isLoading"}`, `{branch:
  "!canManage"}` and `requiredStates: ["delayed","error"]`, i.e. coverage is
  restored, not lost.
- the description copy + the scoped TEST-5a assertion — re-ran `npm run check`
  (ui) end to end: **EXIT=0**.

No new confirmed finding was produced by the re-audit.

**New confirmed findings:** 0
