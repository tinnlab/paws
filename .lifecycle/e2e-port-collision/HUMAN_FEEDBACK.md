# HUMAN_FEEDBACK — e2e-port-collision

**No human feedback received.** This is an agent-driven harness reliability fix
(reproduce the reference port-collision fix + two related hardenings). No human
has reviewed the running change yet; the coordinator reads this ledger at merge.

## Tracked residual / follow-up (from the blind audit, deferred with rationale — NOT blocking)

- The stale-lock REAP paths (`cleanupStaleLocks` + `acquirePortLock`'s stale
  branch in `port-manager.ts`) still call `killProcessOnPort` with no
  bind/ownership guard, so in principle a crashed prior run's stale lock in our
  OWN lock dir could trigger a kill of a LIVE sibling now holding that base port.
  This is the SAME class as the fixed bug but on a different path, and it is
  **out of scope** of the authoritative reference fix (which scopes fix #1 to
  `findAvailablePorts`). It is deferred because a leaked orphan (which SHOULD be
  reaped) is indistinguishable from a live sibling by a bind-probe alone, and
  `lsof` is absent on this box — so the correct fix needs its own design and
  review. The PRIMARY victim path (allocation + `test-context` self-kill) IS
  fixed. Recommended follow-up: make the reap paths rely on the allocator's
  bind-check (stop proactively killing on stale-lock reap) or add a holder-PID
  identity check. [generalizable: no — specific to this harness]
