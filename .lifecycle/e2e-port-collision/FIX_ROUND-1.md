# FIX_ROUND-1 — fix + re-audit to convergence

## Round-1 fixes applied (from the first blind multi-angle audit)

Confirmed findings from the blind auditor and their resolutions:

- **[MED] test-context copy of `killProcessOnPort` still silently no-opped** when
  no lsof/fuser/ss existed → **FIXED**: added the final `else` warn (mirrors the
  port-manager copy), so neither copy is a silent no-op.
- **[MED] TEST-3 not Windows-portable** (writes `#!/bin/sh` fakes, exec bit,
  `command -v`) → **FIXED**: `test('…', { skip: process.platform === 'win32' },
  …)` — a legitimate platform gate (the win32 arm of `killProcessOnPort` is
  unchanged), not a go-green skip.
- **[LOW→real] TEST-2 hard `=== V+8` flaked** + `node --test` IPC corruption
  ("Unable to deserialize cloned data") from verbose emoji stdout → **FIXED**:
  relaxed TEST-2 to a robust skip-invariant (never returns the held base, moves
  forward by a whole offset step, both ports move forward) and silenced the spec's
  console. Verified 25/25 stable, then 15/15 after the follow-up tweak.
- **[LOW] shell-string numeric safety** → **FIXED**: `Number.isInteger(port) &&
  port>0` guard at the top of both `killProcessOnPort` copies before any
  interpolation (defense-in-depth; `port` can reach there from JSON lock files).
- **[LOW] doc-honesty** → **FIXED**: added the TOCTOU caveat to the
  `findAvailablePorts` comment (matches `allocatePostgresPort`).
- **[LOW] env leak in tests** → **FIXED**: `restoreEnv()` in a `finally` for
  TEST-1/TEST-2.

Rejected / deferred (with rationale, recorded in LEDGER.jsonl):
- **[LOW] fake-lsof prints to stdout** → REJECTED (false positive): the fake uses
  `echo … > file`, so stdout is empty and no `kill -9 called` runs.
- **[LOW] Windows netstat substring over-match** → REJECTED (pre-existing, not
  introduced/widened; win32 arm carried forward byte-for-byte).
- **[MED] stale-lock REAP paths still blind-kill** → DEFERRED (out of scope): the
  authoritative reference fix scopes fix #1 to `findAvailablePorts`; the reap-path
  hardening is a DISTINCT change (a leaked orphan that SHOULD be reaped is
  indistinguishable from a live sibling by a bind-probe, and lsof is absent on the
  box). Tracked as a follow-up in HUMAN_FEEDBACK; the PRIMARY victim path
  (allocation + test-context self-kill) is fixed.

## Round-2 blind re-audit (fresh diff-only agent, full updated diff)

Verdict: **the diff is CLEAN — no new genuine defect introduced.** The agent
independently verified the numeric guard, the `else` warn, the console-silencing
(only log/info/warn/debug nulled; `console.error` + thrown AssertionErrors still
surface; subprocess-isolated per file), the platform-skip signature, the relaxed
TEST-2 assertions (genuinely prove the held base is never returned), and the
env-restore helper.

Its ONE note was a LOW cosmetic tautology: TEST-2's
`got.backend - got.vite === B - V` is always true by construction. **Addressed**:
replaced it with meaningful backend checks (`got.backend >= B + 8` and
`(got.backend - B) % 8 === 0`), so the backend side proves a real forward-skip.
Re-verified 15/15 stable + tsc clean after the change. This was a non-defect
cosmetic (not a wrong result), so no behavior regression existed to fix.

**New confirmed findings:** 0
