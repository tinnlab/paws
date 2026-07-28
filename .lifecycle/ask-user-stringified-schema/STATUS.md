# STATUS — what is verified, what is written-but-unproven, what is not done

This file was originally written INSTEAD of a `TEST_RESULTS.md`, because at the
time phase 8 had not been run and a `TEST_RESULTS.md` would have implied it had.
Phase 8 has since been run; `TEST_RESULTS.md` now exists and is the authority for
per-test results. This file is kept as the narrative companion. Every line below
is either an OBSERVED result with its log, or an explicit "not run".

Lifecycle position: **phases 1-7 and 9 GREEN; phase 0 and phase 8 each carry one
documented exception.** TEST-24 and TEST-38 — the two tests this file previously
recorded as NOT WRITTEN — are now written, RUN, and transcribed in
`TEST_RESULTS.md`. Three further blind-audit rounds ran on them (FIX_ROUND-2/3/4);
see those files for the findings and their dispositions.

The two remaining gate gaps are **not** things this branch can honestly close:

- **phase 0 / A1** — 17 of the 18 `.lifecycle` dirs come from the BASE branch
  (`git ls-tree origin/feat/agent-core .lifecycle/`). This branch adds one and
  deletes none. Closing it would mean deleting other features' records.
- **phase 8 / A7** — `gate:ui` runtime-health fails, and fails on the UNTOUCHED
  base too (measured in this worktree). Seven runs produce five mutually disjoint
  failing sets, all network-class dev-server errors. Recorded as FAIL, not padded.

An earlier revision of this file's sibling `TEST_RESULTS.md` accidentally
satisfied the A7 check by quoting the canary line inside prose, which is why the
branch previously reported 8/9. That false pass has been removed.

## Gates actually run

| Gate | Result | Note |
|---|---|---|
| `preflight.sh` | **PASS** | seeded `config/dev.yaml`, per-worktree build DB, pgvector submodule |
| `--phase 1 PLAN` | **PASS** | re-run green after the two mid-flight amendments |
| `--phase 2 PLAN_AUDIT` | **PASS** | incl. `DESIGN_FIDELITY.md`, no `DROPPED` invariant |
| `--phase 3 TESTS` | **PASS** | all 21 ITEMs mapped; all 8 INVs pinned by `[acceptance]` tests |
| `--phase 4 DECISIONS` | **PASS** | 21 DECs, zero unresolved markers |
| `--phase 0 A1` | **FAIL (inherited)** | 18 `.lifecycle` dirs; 17 come from the base. See DEC-18 — siblings on this base recorded the identical failure. Verified this branch DELETES none. |

## Test runs actually executed

| Scope | Command | Observed |
|---|---|---|
| Frontend unit | `node --import ./scripts/node-test-loader.mjs --test src/modules/mcp/chat-extension/components/elicitationOptions.test.ts` | **21 pass / 0 fail** (16 pre-existing + 5 new) |
| Backend `cargo check -p ziee --lib --tests` | — | **clean** (warnings only) |
| Frontend `tsc --noEmit -p ui/tsconfig.json` | — | **clean** |
| Backend unit (first run) | `cargo test -p ziee --lib -- <9 module filters>` | **4 FAILED** — see below |
| Backend unit (FINAL) | same | **135 passed / 0 failed / 0 ignored** (`askuser-unit3.log`) — of which **36 are new** in this branch |
| `check:state-matrix` (ui) | `npm run check:state-matrix` | **FAIL, as predicted** — "state matrix is stale … a new conditional render was added". This is ITEM-18, which is NOT done. It confirms the PLAN_AUDIT ITEM-18 CONCERN rather than contradicting it. |

### The 4 first-run failures, and what they were

Recorded because "I fixed them" is only meaningful with the cause:

1-3. `ask_user_without_sse_returns_non_error_no_session_marker`,
`ask_user_stream_close_during_wait_returns_non_error_no_response`,
`ask_user_send_time_stream_close_returns_distinct_marker` — **a real consequence
of DEC-9**, not a flake. All three assert STREAM-lifecycle behaviour with a
bare `{"type":"object"}` fixture, which the new zero-properties rule now refuses.
Fixture given a real property; rule stands. Recorded as DRIFT-1.3, which argues
this is the TEST_GAP_ANALYSIS finding seen from the other side — a fixture chosen
for convenience became load-bearing.

4. `citations_items_passes_the_shared_argument_conformance_battery` — **my own
test-harness defect**: the extractor compared the example against
`format!("{:?}", JsonRpcError)`, whose escaped quotes can never match the raw
literal. Read `.message` instead. Recorded as DRIFT-1.4; the tempting weaker fix
(relax the battery's example assertion) would have removed the only mechanism
enforcing INV-5 across all thirteen sites.

## Everything enumerated has now been executed

The previous revision listed the backend integration tests, the e2e specs, the
ITEM-18 gallery/state-matrix work and `npm run check` as written-but-unrun or not
done. All are now run; see `TEST_RESULTS.md` for the transcribed numbers and the
named logs. `npm run check (ui)` exits 0.

## Known baseline breakage (NOT ours)

`cargo check --workspace --tests` fails on the untouched base:
`agent-core/tests/real_llm_loop.rs:143/221` — `missing fields isolate_children
and schedule in initializer of AgentCore`. Reproduced at `d53db2d11` before any
edit. `src-app/agent-core` is not a file this branch touches; backend
verification is scoped to `-p ziee`, which is clean. See BASE.md / DEC-19.

## Not pushed

6 commits on `fix/ask-user-stringified-schema`, local only, as instructed.
