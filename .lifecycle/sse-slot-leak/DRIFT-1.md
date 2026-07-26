# DRIFT-1 — implementation vs plan (+ design), authored DURING phase 5

Every entry below was recorded as the item landed, not reconstructed afterwards.

- **DRIFT-1.1** — verdict: impl-wins — **PLAN_AUDIT's "no existing test needs
  editing" was factually wrong for the four registry UNIT cap tests.** They bind
  `let (c, _rx) = conn(..)` **inside the loop body**, so each receiver drops at
  the end of ITS OWN ITERATION — the audit asserted (without checking the
  binding's scope) that they live to end of scope. Consequence: those tests were
  registering connections whose streams were ALREADY GONE and depending on them
  counting toward the cap, so under ITEM-5 they correctly stopped tripping it
  (`per_user_cap_rejects_excess_connections` and
  `global_cap_rejects_excess_connections_across_users` in the framework, plus
  their two chat twins, all failed on first run). This is not a fix defect — it
  revealed that the caps' "live connection" semantics had **never been under
  test**. Resolution: hold the receivers in a `Vec` so each test asserts what its
  name claims (a cap refuses the (cap+1)th LIVE connection); PLAN_AUDIT amended
  with the correction inline. No assertion was weakened — the `is_err()` / 429
  assertions are unchanged.

- **DRIFT-1.2** — verdict: impl-wins — **the real-HTTP integration tests
  (TEST-6/TEST-7) do NOT go red before the fix**, contradicting their planned
  claim "before the fix the 13th subscribe 429s" and the DoD's expectation.
  Measured on the UNFIXED server through a real hyper listener:

  | client behavior (unfixed server) | slots leaked |
  |---|---|
  | 20 sequential reqwest subscribe → drop response | 0 |
  | 100 sequential raw-TCP: write request, vanish unread | 0 |
  | 200 concurrent raw-TCP abandons | 0 |
  | 400 concurrent raw-TCP abandons (two bursts) | 0 |

  hyper always polls the response body while writing it, so the never-polled
  window is not reachable through its HTTP/1.1 server path. The window IS
  reachable — deterministically — at the handler/tower level (`tower::oneshot`
  on the REAL mounted router): 20 abandoned subscribes took `connection_count`
  **0 → 20**, and 0 → 0 after the fix. Resolution: TESTS.md amended to state the
  honest scope of TEST-6/TEST-7 (an end-to-end guarantee of the DoD symptom, not
  a red-before-fix proof) and to name TEST-4 as the red-before-fix proof. The
  tests were NOT deleted or weakened — they are the end-to-end guarantee the DoD
  asks for, and they would catch any future regression that breaks reclamation
  on the HTTP path.

- **DRIFT-1.3** — verdict: plan-wins → re-implemented — **the plan as written did
  not actually cover the mechanism the bug report names.** DRIFT-1.2 establishes
  that a client whose socket closes cleanly is already reclaimed by hyper +
  the guard. The report's own words are "an SSE client going away doesn't
  necessarily error a send until something is pushed, so an idle-but-dead
  connection holds its slot indefinitely" — i.e. the server-side stream is STILL
  ALIVE, the guard has NOT fired, and `sender.is_closed()` is FALSE. ITEM-3/4/5's
  closed-channel sweep is blind to that connection, so the original plan would
  have shipped a correct-but-insufficient fix and left the reported symptom
  intact. Resolution: added **ITEM-7** — carry each connection's own `exp`
  deadline (the instant its stream's `select!` is guaranteed to break) onto the
  registered connection and let the sweep reclaim anything still present more
  than a slack past it. PLAN/PLAN_AUDIT/TESTS amended; TEST-14/14b/15/15b added
  and passing. This is the entry that changed the fix's substance rather than its
  paperwork.

- **DRIFT-1.4** — verdict: resolved — the framework crate-level acceptance tests
  first measured a contaminated baseline (`0 → 1` instead of `0 → 20`): the
  `TestSurface` registry is a process-wide `OnceLock` shared by every test in the
  binary, and cargo runs them concurrently. Resolution: an `isolated_surface!`
  macro gives each reclamation test its own surface + private registry, so the
  counts are exact rather than approximate. Without this the tests would have
  been flaky-by-construction and their numbers uninterpretable.

- **DRIFT-1.5** — verdict: none — the pre-existing framework unit test
  `openapi::emit_ts::tests::generator_golden_fixture` FAILS. Verified NOT a
  regression from this branch: it fails identically on a pristine detached
  worktree of the pinned SDK commit `01a96b7` with zero local modifications.
  Recorded in TEST_RESULTS as a pre-existing baseline failure, untouched.

- **DRIFT-1.6** — verdict: none — DEC-7 said the sweep would log with
  `tracing::debug!` and return a count; implemented exactly so, with the message
  widened from "closed connection(s)" to "dead/expired connection(s)" once ITEM-7
  gave the sweep a second reclamation signal. No behavior change.

**Unresolved drifts:** 0
