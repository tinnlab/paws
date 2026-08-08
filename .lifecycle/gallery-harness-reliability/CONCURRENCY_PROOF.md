# CONCURRENCY_PROOF — TEST-3 [acceptance · INV-3]

**Claim under test (INV-3):** "Take a host-level lock, or detect a live instance
and refuse to run." — and: "Per-worktree `node_modules` isolation does NOT protect
against this."

**Setup.** Two genuinely separate git worktrees of this branch, each with its OWN
hardlinked `node_modules` (NOT a symlink) and its own Vite gallery server:

| worktree | gallery port | node_modules |
|---|---|---|
| `/data/pbya/ziee/wt-harness-fix` | 20076 | own (`cp -al`) |
| `/data/pbya/ziee/wt-harness-fix-b` | 20176 | own (`cp -al`) |

Both ran the identical real crawl (`runtime-health --report-only
--only-kinds=overlay --themes=light`, 54 cells), B started **1 s** after A. Note
this is the exact configuration INV-3 says is NOT sufficient on its own: separate
worktrees, separate `node_modules`, separate ports. Serialization must come from
the lock, and only from the lock.

Driver: `/data/pbya/ziee/tmp/harness-fix/concurrency-proof.sh`.

## Leg 1 — lock ENABLED (default). VERDICT: serialized.

`conc-lockB.log`, verbatim, first two lines:

```
• waiting for the gallery host lock — held by pid 222452 (/data/pbya/ziee/wt-harness-fix). Concurrent crawls corrupt each other, so this run will start when that one finishes.
• host lock acquired after 39s
```

This is the whole of what INV-3 asks for, and it fixes the specific reported
failure — *"with no warning in either output"*. The waiter now names the holding
**worktree root** and **pid**, and states why it is waiting.

Both crawls then completed cleanly and independently:

```
conc-lockA:  === runtime-health: 25 findings (HIGH 0 gating / MEDIUM 0 / LOW 25) ===
             validity: 54/54 cells · origin alive (6 checks) · transport artifacts 0 (0% of findings)
conc-lockB:  === runtime-health: 21 findings (HIGH 0 gating / MEDIUM 0 / LOW 21) ===
             validity: 54/54 cells · origin alive (7 checks) · transport artifacts 0 (0% of findings)
```

Log mtimes confirm the ordering: `conc-lockA.log` 17:58, `conc-lockB.log` 17:59.

**Validity gate (the owner's rule):** both runs report `transport artifacts 0
(0% of findings)` — a healthy run — so no conclusion here rests on a contaminated
measurement.

## Leg 2 — NEGATIVE CONTROL, `GATE_UI_LOCK=0`. VERDICT: they overlap.

Without this leg, "they ran one after the other" could just be incidental timing.
With the lock disabled, both crawls were observed **running simultaneously**:

```
$ pgrep -af runtime-health
229171 node ../../sdk/packages/gallery/scripts/runtime-health.mjs --report-only --only-kinds=overlay --themes=light
229280 node ../../sdk/packages/gallery/scripts/runtime-health.mjs --report-only --only-kinds=overlay --themes=light
```

and both logs open with:

```
• host lock DISABLED via GATE_UI_LOCK=0 — concurrent runs may interfere
```

Both `conc-nolockA.log` and `conc-nolockB.log` are stamped 18:00 — the same
minute — against 17:58/17:59 for the serialized leg. So the serialization in
Leg 1 was caused by the lock, not by the machine happening to run them in turn.

## Scope and honest limits

- The lock is **per host, per user** (`$TMPDIR/ziee-gate-ui-<uid>.lock`). Two
  different UNIX users sharing one box will not serialize against each other.
  That is deliberate (DEC-5): a lock file owned by another user could not be
  unlinked, which would wedge the machine for everyone — a worse failure than the
  one being fixed. Documented in CLAUDE.md.
- The lock covers `gate:ui` and `gallery:runtime`. It does **not** stop an
  unrelated process from killing a Vite server (e.g. the `pkill -f "vite --config"`
  that CLAUDE.md itself recommends as a troubleshooting step). That residual case
  is why the run-validity gate exists as a second, independent layer: such a run
  is declared VOID rather than reporting the resulting noise as product defects.
- 39 s of waiting is real wall-clock cost. It is the correct trade: the
  alternative measured cost was a 95.5%-contaminated run that several
  investigations then chased as a UI regression.
