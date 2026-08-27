# DRIFT-1 — upstream-pulldown

Implementation vs plan, written as each pick landed. For a port, "drift" means:
did the change that actually landed in paws differ from the change the upstream
commit made, and if so, was that deliberate?

- **DRIFT-1.1** — verdict: none — ITEM-1 (`d38b789d5` → `073e0048d`). Both applied
  with no conflict. `mcp/client/http.rs` and `tests/mcp/response_framing_test.rs`
  landed byte-identical to upstream. Only `.lifecycle/mcp-response-content-sniffing/*`
  was dropped, exactly as ITEM-7 required.

- **DRIFT-1.2** — verdict: none — ITEM-2 (`3a78a0e86`) and ITEM-3 (`009a71f0a`).
  Clean `cherry-pick -x`, no conflict, single file each. The `-x` provenance line
  records the source sha in the commit body.

- **DRIFT-1.3** — verdict: none — ITEM-4 (`2154200f0` → `5e85378d6` → `f8b480e0f`).
  The chain applied in order with no conflict. `f8b480e0f` carried no lifecycle
  artifacts so it went through `-x` untouched; the first two needed a manual commit
  only to drop `.lifecycle/tool-argument-contracts/*`.

- **DRIFT-1.4** — verdict: resolved — ITEM-5. The squash of `ee48f1a77`+`abc8d2429`
  is a deliberate deviation from "one pick, one commit", pre-approved as DEC-3. It
  changes the COMMIT SHAPE only: both patches were staged in order into one index
  and committed together, so the resulting tree is what applying them sequentially
  produces. Verified afterwards that the migration
  `202608210100_agent_task_list_reconcile.sql` appears exactly once, as an addition,
  and that `migration_immutability.rs` is untouched (`git diff origin/main...HEAD --
  src-app/server/tests/migration_immutability.rs` is empty).

- **DRIFT-1.5** — verdict: resolved — ITEM-7, second class. `abc8d2429` also stages
  five paths under `src-app/server/ui/` totalling ~58k lines of OpenAPI output at a
  wrong path. Dropped from the index and removed from the worktree before committing.
  This makes upstream's own corrective commit `88081b800` unnecessary here, which is
  why it is not in the pick list.

- **DRIFT-1.6** — verdict: resolved — ITEM-6 (`beae7c7fb`). The ONE conflict BASE.md
  predicted, in `src-app/server/tests/llm_repository/mod.rs`, occurred exactly as
  described and was resolved as a UNION: paws' `mod default_model_seed_test;` kept,
  upstream's `mod ssrf_probe_test;` added, and the whole list left alphabetized with
  a single `mod update_validation_test;` (the three-way merge had produced a
  duplicate of that line, which would not have compiled). Every other file in the
  pick applied clean.

- **DRIFT-1.7** — verdict: impl-wins — **commit authorship is not uniform across the
  branch, deliberately.** Picks that needed no path-dropping used `cherry-pick -x`,
  which PRESERVES the upstream author (`pbya <pbya@tinnguyen-lab.com>`) and records
  `(cherry picked from commit …)`; `khoi` is the committer on all of them. Picks that
  needed paths dropped had to be staged and committed by hand, so their author is
  `khoi`, and each names its source explicitly in the first line of the body
  ("Ported from ziee-ai/ziee <sha>"). Attributing someone else's patch to myself
  would be worse than the inconsistency, and the worker brief's "commit as khoi" is
  satisfied either way by the committer field. The plan did not anticipate this, so
  the plan is what was wrong; recorded here rather than papered over.

- **DRIFT-1.8** — verdict: none — ITEM-8. Post-pick assertions all hold:
  `git diff origin/main...HEAD --stat -- sdk agent-kit src-app/server/vendor/pgvector
  src-app/ui src-app/desktop/ui src-app/server/ui` is EMPTY, so no gitlink moved, no
  UI workspace was touched (confirming the diff is backend-only and the phase-3
  frontend e2e rule does not apply), and no stray OpenAPI tree landed.
  `src-app/Cargo.lock` is also unchanged — the one line `ee48f1a77` adds was already
  present in paws.

- **DRIFT-1.9** — verdict: none — the whole branch compiles. `cargo check --workspace
  --all-targets` exits 0 with only pre-existing dead-code warnings; in particular
  `agent-core`'s new `TaskStatus::Abandoned` variant and every construction site
  build, and no sqlx macro failed against the migrated per-worktree build DB.

- **DRIFT-1.10** — verdict: impl-wins — **the plan mis-modelled two of its own items.**
  ITEM-7 (strip out-of-scope paths) and ITEM-8 (assert no gitlink moved) are not units
  of implementable work with observable behaviour; they are assertions ABOUT the
  resulting diff. The phase-3 gate rightly demands a covering TEST for every ITEM, and
  the only ways to satisfy it were to invent a hollow test — the exact failure this
  process exists to prevent — or to mark them [DESCOPED], which would be false since
  they were DONE, not cut. Amended: PLAN gains a `## Port hygiene` section carrying
  them as rules H1/H2, verified by command in TEST_RESULTS.md. Recorded as DEC-13.

- **DRIFT-1.11** — verdict: impl-wins — the A11 gate caught four TEST-IDs recorded PASS
  that this branch had not earned. TEST-28 was my own error (its `file:` was a brace
  expression naming two paths, which is not a path the gate can match); TEST-29/30/31
  are genuinely not this feature's tests but pre-existing paws guards and a shell
  assertion, which I ran and which pass. Reclassified as **Controls** with their
  commands and results, rather than claiming coverage for someone else's test.
  Recorded as DEC-14.

**Unresolved drifts:** 0
