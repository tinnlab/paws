# FIX_ROUND-1 — e2e-speedup

## Round-1 blind-audit findings (4 agents, ≥14 angles) → dispositions

All findings recorded in `LEDGER.jsonl`. Summary of the CONFIRMED ones that were
FIXED (the rest were rejected with evidence or accepted-with-rationale):

- **F6/F14** (concurrency) — jittered backoff on the template-clone retry; broadened
  to {55006, 55P03}; 5→8 attempts. `test-context.ts`.
- **F7** (concurrency) — global-setup template teardown now uses the shared
  `terminateChild` (clears the timer; no dangling setTimeout). 
- **F10** (error-handling) — template stderr now kept as a rolling 2000-char tail
  so a Rust panic (non-JSON) is surfaced.
- **F11** (error-handling/perf) — `waitForHttpReady` takes the child and fails fast
  on early exit instead of burning the 120s budget.
- **F13** (perf) — `terminateChild` defaults lowered to 3000/1500ms.
- **M1/M3/M4** (modularity/maintainability) — extracted a shared pure-utility
  module `tests/fixtures/harness-process.ts` (`serverBinaryPath`/
  `serverBinaryExists`/`terminateChild`/`findFreePort`/`waitForHttpReady`); both
  callers import it — no duplication, no leftover copies.
- **T1** (tests-quality) — added a merged-DIR mtime assertion to the compose
  unit test (the actual invariant cargo keys on).

Rejected-with-evidence: **F2** (verified migrations run before the listener binds —
health can't answer pre-migration), **F8** (teardown race — audited clean), **F12**
(configData preserves `port`), the **build-correctness** deep-dive (compose sound on
all 6 points), **security** (DB names sanitized/parameterized). Accepted-with-
rationale: **F1** (warmup rebuilds at run start), **F4** (seed-once divergence —
seed-if-empty + identical defaults + debug-seam config-read; documented + opt-out),
**F5** (brief-directed 6→3 with best-effort fallback), **F9** (single serial boot),
**M2** (template config deliberately minimal), **T2/T3** (cosmetic), pgvector caveat
(out of diff; empirically Fresh).

## Real-run finding (Phase-8 executed EARLY as the B7 proof)

- **RUN-1** (Rust config `missing field access_token_expiry_hours`) — the template
  server failed to boot because the template config YAML omitted the two JWT
  expiry fields (which have NO serde default; the per-test config sets them
  explicitly). ITEM-4a silently fell back to migrate-on-boot (proving the graceful
  fallback, but NOT the template speedup). This is exactly Agent-3's M2 (config
  duplication → drift) manifesting. **FIX:** added `access_token_expiry_hours: 24`
  + `refresh_token_expiry_days: 30` to the template config, matching the known-good
  per-test config's jwt block. Re-run (run-2) confirms the template builds + clones.

## Re-audit (round-2, 2 fresh blind agents on the updated diff)

- **modularity/maintainability/patterns/tests-quality/security/api-contract** —
  "no confirmed findings": the shared module is used by both callers with no
  leftover duplication; the dir-mtime unit assertion genuinely validates the
  invariant; all 7 migration tests real (no hollow/tautological asserts); DB-name
  interpolation sanitized/parameterized; producer/consumer optional-field contract
  sound.
- **correctness/concurrency/error-handling/perf/state-management** — "no confirmed
  findings": independently verified `terminateChild` (no race/leak/double-resolve),
  `waitForHttpReady` early-exit, the jittered retry, the template ordering, and —
  crucially — that the server runs BOTH `initialize_database`→migrate AND
  `core::seed::run` to completion BEFORE `TcpListener::bind` (main.rs:208/238/421),
  so a healthy `/api/health` = fully-migrated-AND-seeded template; and that the seed
  is idempotent via `seed_ledger` ON CONFLICT + deterministic UUIDs (no re-seed boot
  failure on a cloned template). Rust compose byte-identical; dir-mtime assertion valid.

The E2E-caught template-config fix (RUN-1) was re-proven by run-2: the template
builds and every per-test DB is cloned `from template` (see TEST_RESULTS.md).

**New confirmed findings:** 0
