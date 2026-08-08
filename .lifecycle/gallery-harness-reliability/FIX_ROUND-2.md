# FIX_ROUND-2 — the blind multi-angle audit (phase 6/7)

Two blind angles, both fresh subagents given only `git diff main...HEAD` (parent
+ sdk submodule) and no reasoning of mine:

- **correctness + concurrency/resource** — 15 findings
- **tests-quality + wired-and-behaving** — 14 findings

Both were highly productive and several findings were severe. Full rows in
`LEDGER.jsonl`. `corroborated_by: 2` on the two findings both angles reported
independently (the contamination-ratio miscalibration, and the un-cleared
`RUNTIME_FINDINGS.md`).

## The two that mattered most — and they invert the defect

The round's dominant theme was not "the fix is incomplete" but **"the fix
introduces FALSE FAILURES"**, which for a gate is worse than the noise it removes:

- **`watchOrigin` latched on ONE failed 4 s probe.** The thing being probed is a
  Vite server driving six concurrent Chromium pages; a cold transform or GC pause
  routinely exceeds that. One slow sample out of ~144 would VOID a healthy
  12-minute crawl. Fixed: a death must be CONFIRMED (3 consecutive failures,
  ~15 s), the timeout is 10 s, and the first probe fires immediately so a short
  run can never report `checks: 0` and "alive" on no evidence. Pinned by TEST-7b
  (one blip must not void) and TEST-7c (a real death must be caught).
- **The contamination bar was a ratio of ALL findings, at 10%.** It counted
  routine reload-aborts that the gating formula already mutes, and divided by a
  denominator padded with LOW `spacing-grid` items. `origin/main`'s own baseline
  is 36/608 = **5.9%** — a hair from voiding main itself; and a short crawl voided
  on two artifacts. In the other direction a big crawl could hide 900 real
  transport errors under the same bar. Fixed: VOID requires BOTH an absolute floor
  (50 artifacts, well above the ~36 routine baseline) AND a generous ratio (25%).
  TEST-1c2 pins every population this branch has real data for, by name.

## The rest, all fixed

- **Lock liveness followed the wrong process.** `gate-ui` holds the lock but the
  crawl is a `spawnSync` CHILD; SIGKILL the parent and the child keeps crawling
  while the next acquirer "reclaims" and starts a second crawl beside it — the
  exact corruption the lock exists to prevent. Fixed with `registerWorker`: the
  child registers its pid and the lock stays held while EITHER is alive (TEST-18c).
- **The SIGTERM handlers made `gate:ui` unkillable.** Registering a listener
  suppresses node's default terminate, and the process blocks in `spawnSync` for
  the whole crawl, so the handler cannot run until it finishes anyway — twelve
  minutes of ignored SIGTERM, verified by the auditor on a minimal repro. The
  handlers are REMOVED; a signalled run leaves its lock and the next acquirer
  reclaims it as stale, which is the mechanism, not a fallback (TEST-18b, rewritten
  to the new contract).
- **Two lock TOCTOUs.** `openSync('wx')` created a zero-byte file before writing
  it, so a peer could read it empty, judge it corrupt, and unlink the winner's
  lock; and stale-reclaim was read-then-unlink with no verification. Fixed with
  write-temp-then-`link()` (atomic in content, not just existence), an
  unreadable-on-two-reads rule, and verify-then-unlink.
- **The lock wrapped the whole gate** including `tsc`/lint/visual, so with a
  15-minute budget the third concurrent run hard-failed — a throughput problem
  presenting as a gate failure. Narrowed to the shared-resource phase; budget
  raised to 45 min.
- **`RUNTIME_FINDINGS.md` was the stale-inheritance hole left open.** It is the
  file CLAUDE.md points humans at, it was written BEFORE the void check, carried
  no banner, and `clearRunArtifacts` did not remove it. Fixed on all three counts;
  the e2e now asserts the `.md` is cleared too.
- **The crash-mute could hide a real defect.** Corroboration was "this cell saw
  ANY dev-asset abort" — and those are routine. A genuinely broken lazy import
  next to one routine abort would have been muted and the surface reported PASS.
  Tightened to SAME-MODULE corroboration (TEST-10c pins it).
- **`isViteDevAsset` matched the query string**, so `/api/x?next=/src/foo.tsx`
  classified as a dev asset — muting a product failure AND corroborating a
  crash-mute. Now matches the pathname only.
- **`&&` was not a value position**, so `data-testid={cond && 'id'}` was silently
  dropped from the shared registry — and a DROP is invisible (the shape guard
  only catches malformed ids). Fixed.
- **The inherited-lock token was never validated**, so a leaked `GATE_UI_LOCK_TOKEN`
  in a shell silently disabled the lock for every later run. Now validated against
  the live holder, and announced either way.
- `originAlive` leaked undici response bodies; `lockPath()` used a literal `'win'`
  for every Windows user on a shared TEMP. Both fixed.

## The test findings — the ones that would have shipped a false green

- **TEST-4, the only acceptance proof for INV-4, never ran `gate-ui.mjs`.** It
  re-implemented the sequence locally, so disabling the real refusal branch
  (`if (false && !verdictOk.ok)`) left every test green. **Rewritten to SPAWN the
  real gate** against a stub crawl. Verified by mutation: with the branch
  disabled the rewritten test now FAILS (2 assertions, exit 1); before, exit 0.
- **It was also a dead test** — no npm script ran it. Now `test:gate-ui-stale`,
  wired into `npm run check`.
- **The two new classifier arms had no behavioural test at all**, while TESTS.md
  claimed assertions that did not exist. The classifier is now extracted to
  `lib/finding-classify.mjs` (testable, and single-sourced across both harness
  copies) with 17 tests asserting BOTH what is muted and what must still gate.
- **`watchOrigin`/`originAlive` had no tests**; now 5, against a real HTTP fixture.
- **Desktop's `test:gallery-scripts` was not in desktop's `check`.** Wired.
- **The parity guard's alternations were loose** — `assessRun|clearRunArtifacts`
  let a copy delete the void logic and stay green. Split into producer/consumer
  call sites so each names the call it actually requires.

## Rejected / deferred

- **Parity guard hardcodes consumer-app paths inside the shared sdk package**, so
  it is red-by-construction in a standalone sdk checkout. REAL and accepted as a
  known limitation, not fixed here: making it config-driven is an sdk-packaging
  change with its own blast radius, and the guard's value is in THIS repo today.
  Recorded in HUMAN_FEEDBACK for the owner rather than silently left.
- **TEST-21's golden is partly self-consistent**, TEST-25 restates the diff, and
  TEST-21 self-skips without a diagnostic. All fair, all LOW; the independent
  teeth (3 named phantoms + 6 named ids, and the fixture tests) are what the
  invariant rests on. Not reworked this round.
- **`--repeat`/flaky gating** stays deferred — now on measured evidence rather
  than assumption (see FLAKE_STUDY.md).

**New confirmed findings:** 0
