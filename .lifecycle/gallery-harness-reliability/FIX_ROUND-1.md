# FIX_ROUND-1 — findings from the implementation's own tests

This round's "audit" was run by the tests as they were written (red-first), plus
two live probes. Every finding below was found by an assertion or a measurement,
not by reading code, and each is recorded with what caught it.

## Confirmed findings, fixed in this round

- **F1 (oracle-confirmed, severity: correctness)** — `TRANSPORT_DEAD` did not
  match bare `net::ERR_ABORTED`; only `ERR_CONNECTION_ABORTED`. Caught by
  `TEST-9b`, which enumerates every transport error observed in the field. This
  was the single most consequential miss in the diff: `ERR_ABORTED` is the error
  a Vite HMR reload produces, i.e. the trigger most likely to fire while someone
  is working, and the one that produced 538 findings in flake run02. A validity
  gate blind to it would have shipped looking correct.
  Fixed: `ERR_ABORTED|FAILED` added as top-level alternatives, with the rationale
  in the regex's doc-comment.

- **F2 (oracle-confirmed, severity: correctness)** — the truncated-crawl refusal
  in `verifyRunManifest` phrased its reason differently from `assessRun`'s, so
  two code paths described the same condition two ways. Caught by `TEST-19`'s
  per-case reason assertions. Fixed by unifying the wording.

- **F3 (oracle-confirmed, severity: test-validity)** — `TEST-18b`'s child process
  held the lock with `await new Promise(() => {})`, which registers no libuv
  handle: node's event loop drained, the process exited, and the exit handler
  released the lock — so the test would have PASSED without ever exercising
  SIGTERM. Caught because the assertion "child holds the lock" failed first.
  Fixed with a real `setInterval` keepalive, and the trap documented inline.
  This is the same class as the vacuous-guard failure the lifecycle skill warns
  about: a test that passes for a reason unrelated to what it claims.

- **F4 (oracle-confirmed, severity: correctness)** — a first AST draft written to
  the design's literal wording ("string-literal values") DROPPED six real ids
  living in `??`/ternary value positions. A second draft that walked all
  descendant literals over-collected 15 fragments. Caught by diffing both against
  the real configured trees. Fixed with the value-position recursion; each
  over-collection is now a negative test (`TEST-22c/d`).

- **F5 (measurement, severity: process)** — the flake study's run02 was
  invalidated by my own edit to `testIds.generated.ts` mid-crawl. Caught by
  comparing run02's 538 `net::ERR_ABORTED` against run01's 0 on the same server.
  Fixed at two levels: the validity gate now VOIDs such a run, and the operating
  rule ("do not edit the gallery's module graph during a crawl") is documented in
  CLAUDE.md.

## Rejected / not fixed

- **The stated D1 cause** (`page.close()` cancels in-flight imports) is
  **disproved**, not fixed — four probe variants emit zero events. Implementing
  the quiesce anyway would be manufacturing a fix. Recorded in DRIFT-1.1/1.4 and
  reported to the owner rather than silently substituted.

- **`--repeat`/flaky-gating (ITEM-7/8/9)** is descoped pending FLAKE_STUDY data,
  per INV-2's "investigate before fixing". Not a rejection — a sequencing
  decision with the measurement still outstanding.

**New confirmed findings:** 0
