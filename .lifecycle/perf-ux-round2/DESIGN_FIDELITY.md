# DESIGN_FIDELITY — perf-ux-round2

One verdict per invariant in `PLAN.md` `## Invariants`, checking that the PLAN
realizes `MEASUREMENT.md` rather than reframing it.

- **INV-1** — fidelity: UPHELD — every implemented item cites a number in
  MEASUREMENT: ITEM-1/ITEM-2 ← §1 B-1 (82,022 B raw / 24,586 B gzip preloaded;
  −76,659 B raw proven by experiment); ITEM-4/ITEM-5 ← §5 Attempt 2 (the
  12-then-429 vs 20/20 probe matrix); ITEM-6 ← the 105 stale log lines observed in
  a real run; ITEM-7 ← the 917-vs-0 gating-HIGH discrepancy. The two items with no
  number to justify a FIX (B-2, B-3) are `[DESCOPED]`, not silently implemented on
  a hunch. Re-running the producing probe is mandated per item in TESTS.md.
- **INV-2** — fidelity: UPHELD — this is ITEM-1's whole subject, and ITEM-2 turns
  it from a one-time fix into a standing, merge-durable gate. Pinned by TEST-1,
  which runs a REAL production build and asserts the lazy chunk is absent from
  `index.html`'s `modulepreload` set — a test that fails the moment the invariant
  is violated, unlike the pre-existing source-contract test (see PLAN_AUDIT
  "Existing-test interaction").
- **INV-3** — fidelity: UPHELD — MEASUREMENT §2 establishes the noise floors
  (FCP σ ≈ 75 ms; composer-interactive σ ≈ 700 ms, 14 %). ITEM-1's effect is
  −23 KB gzip ≈ 65 ms of transfer at 10 Mbps, i.e. INSIDE the composer-interactive
  noise, so the plan proves it with the deterministic byte/preload-set metric
  (zero variance) and explicitly forbids claiming a timing win. TEST-1 and TEST-2
  are both deterministic.
- **INV-4** — fidelity: UPHELD — enforced twice in this very round before it was
  written down: the rate-limiter contamination (attempt 1) and the proxy
  SSE-teardown contamination (attempt 2) were each traced to the rig and
  discarded rather than reported as app defects — the second one only because the
  four-probe matrix was run. ITEM-4 fixes the rig and ITEM-5 writes the matrix
  into the skill so the next auditor does not have to rediscover it. The cost of
  upholding it is ITEM-9's descope, which is recorded rather than hidden.
- **INV-5** — fidelity: UPHELD — no UI surface changes; the single behavioural
  change (ITEM-1) alters WHEN a component's code loads, not what it renders.
  TEST-4 re-runs `gate:ui` on a quiet box and requires 205/205, and TEST-3 drives
  a real date field end-to-end so a broken lazy boundary cannot pass silently.
- **INV-6** — fidelity: UPHELD — MEASUREMENT §2/§3 verify-then-skip the previous
  round's landed work against fresh measurements (no duplicate `/api` requests →
  the in-flight GET coalescer holds; `/api` chain 3 hops → the `/auth/me`
  parallelism holds; a flat CPU profile with no hot spot above 0.7 % of wall →
  the O(n²) reducer + rAF coalescing hold; entry chunk 56 KB → the vendor split
  holds). None is re-fixed. B-1 is explicitly NOT one of these: it is the part of
  the lazy-date-picker work that never actually took effect, proven against the
  current build.
