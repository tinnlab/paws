# FIX_ROUND-3 — blind audit of the round-2 diff (ITEM-23, ITEM-24), and its fixes

Two angles, differing in kind, run BLIND over a captured snapshot of the round's
diff (not a live worktree — the FB-8 lesson applied): **correctness +
concurrency-resource** and **design-conformance + tests-quality**. The tree was
not edited while they ran.

They were productive, and the headline is uncomfortable in the right way: **the
round-2 fix introduced a HIGH gate hole, which both angles found independently.**

## Corroborated (≥2 angles) — fixed

- **The error-channel React arm was gate-blinding.** `classifyConsoleMessage`
  consulted the FULL historical `REACT_WARNING` list on the error channel. Three
  of its patterns are unanchored English — `/is deprecated/i`, `/^Warning:/`,
  `/findDOMNode/i` — which cost nothing on the warning channel (already
  non-gating) but on the error channel downgrade REAL failures:
  `[ApiClient] GET /api/models failed: 410 Gone — this endpoint is deprecated`,
  `TypeError: ReactDOM.findDOMNode is not a function`,
  `Warning: Failed to persist draft — data loss`.
  **Fix:** split the list. `REACT_WARNING_STRICT` (five patterns naming a
  specific React warning string) is the ONLY thing downgraded on the error
  channel; the loose list still applies on the warning channel, byte-identical to
  before. New test asserts each of those four texts still gates HIGH.
- **The channel filter had been dropped, not narrowed.** `log`/`info`/`debug`
  were newly recorded — including, in the GATING direction, an ErrorBoundary text
  on a non-error channel. **Fix:** `DIAGNOSTIC_CHANNELS` restores the historical
  `error|warning|warn` restriction; test covers all four other channels.
- **A core declared by NO copy was silently unchecked** while the CLI printed
  `all ${CORES.length} cores`. The deleted `TEST-6e` asserted exactly this
  direction and the move did not replace it. **Fix:** the engine now reports it
  as a violation, and the CLI prints the cores it ACTUALLY checked, by name.

## Single-angle but oracle-confirmed (a mutation reproduced each) — fixed

- **Hollow precedence test.** Its fixture matched no React pattern, so
  reversing the ERRORBOUNDARY / warning arm order left the suite green. Fixture
  replaced with texts that match BOTH arms, plus an in-test assertion that the
  fixture really does match the warning list (so it cannot silently go hollow
  again).
- **Deleting `harnessCopies` from the DESKTOP config alone** disabled the gate
  there with `npm run check` fully green. **Fix:** `TEST-6f` resolves BOTH
  workspaces' configs and asserts each points at the one root manifest.
- **Closed-world enumeration.** A new divergent copy on disk was invisible.
  **Fix:** `TEST-6g` walks `sdk/packages` + `src-app` for harness-shaped files
  and fails on any not declared, with an explicit reasoned `NOT_A_COPY`
  allowlist (each entry asserted to still exist) rather than a filename-suffix
  loophole. It immediately found a real undeclared file.
- **Vacuous negative control.** `every(v => v.includes('desktop'))` tested the
  now-ABSOLUTE path. **Fix:** attribute by copy ID, and assert an EXACT count of
  (copy, core) pairs rather than `>= 1`.
- **`role` unvalidated**, **empty `cores` accepted**, **declaration errors
  early-returned**. All three fixed and tested.

## Rejected / deferred (explicitly, not silently)

- *"The sdk submodule is uncommitted, so the change is undeliverable."* Correct,
  and out of scope by instruction: the owner sequences sdk → agent-kit → parent
  and this session is told not to push. Recorded in the ledger as `rejected`.
- *Residual consumer coupling elsewhere in the package* (`run-key.mjs` hardcodes
  `/src-app`; `gen-testid-registry.test.mjs` hardcodes `src-app/ui`) —
  pre-existing, not this diff. `deferred`.
- *The `pageerror` path still hand-rolls its category and is covered by no core*
  — pre-existing behaviour, unchanged here. `deferred` as a named follow-up.

## Mutation verification of the round's own tests

Each mutation was applied to the real module and reverted; the control is clean.

| mutation | result |
|---|---|
| control (unmutated) | 26 pass / 0 fail |
| error channel uses the LOOSE list (the gate hole) | 25 / **1 fail** |
| ErrorBoundary arm moved BELOW the warning arm | 25 / **1 fail** |
| `DIAGNOSTIC_CHANNELS` filter removed | 25 / **1 fail** |
| `errSeverity` always HIGH | 25 / **1 fail** |
| drop a core from every manifest entry | guard **exit 1** (was exit 0 + "OK") |
| add `runtime-health.v2.mjs` beside the desktop copy | TEST-6g **red** (was green) |
| delete `harnessCopies` from the desktop config | TEST-6f **red** (was green) |

**New confirmed findings:** 0
