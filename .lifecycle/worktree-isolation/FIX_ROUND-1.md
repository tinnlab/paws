# FIX_ROUND-1

## Findings merged from LEDGER + fixed

- **Harness port-detection fragility** (LEDGER entry, `prove-worktree-isolation.sh`):
  the DEV-leg learned each vite server's port by grepping the vite log for
  `localhost:PORT`. If vite's log format changes or it binds IPv6-only, detection
  could miss → a false "dev server never reported a port". **Fixed:** added a
  sentinel-scan fallback — when the log grep yields nothing, compute the
  worktree's key-derived `portBase` (via the run-key module) and scan the
  200-wide range for a `/__worktree` sentinel reporting THIS worktree's own root.
  Port detection is now independent of any log string. (bash `-n` syntax-clean.)

## Re-audit (full second pass over all angles)

Re-ran every angle against the current diff. All other ledger findings are
`confirmed` design verifications (the change is correct) or `rejected`
false-positives (N/A a11y / perms-authz / api-contract for an infra-only diff) —
none required a code change. The single actionable finding above is `resolved`.

No new defect surfaced: the atomic-extract concurrency proof passes (4/4, incl.
the 8-thread test), the run-key parity fixture matches across Rust+Node, the
gate-ui no-foreign-reuse is sentinel-gated, and the teardown is runId-scoped.

**New confirmed findings:** 0
