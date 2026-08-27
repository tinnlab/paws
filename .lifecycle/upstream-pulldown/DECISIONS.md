# DECISIONS — upstream-pulldown

### DEC-1: Which of the 42 upstream commits are pulled down at all?
**Resolution:** Nine: `d38b789d5`, `073e0048d`, `3a78a0e86`, `009a71f0a`, `2154200f0`,
`5e85378d6`, `f8b480e0f`, `ee48f1a77`(+`abc8d2429` squashed), `dc834d68a`, `beae7c7fb`.
Every one fixes a defect in a subsystem paws ships AND runs. Everything else is an
upstream feature, an artifact strip, a merge, an agent-kit bump, or already in paws.
**Basis:** user — the owner picked "All 9 (full defect set)" from an explicit option
picker after being shown the alternatives (MCP+security only; everything-except-the-agent-chain).

### DEC-2: Is `subagent-transcripts` pulled down?
**Resolution:** No. `179cada1f`, `1eca341be`, `32bb80a6e`, `61b6121fe`, `90eefee34`,
`55290f6e5`, `6b2d523e9`, `61e72bdcf`, `890792054`, `94b6a4be7` are upstream ADDING a
feature — a new migration (`202608250100_subagent_child_runs.sql`), new REST routes, a
new UI surface. paws deliberately reduced its feature surface in PR #14; adding this
re-expands it. Recommended against, and the recommendation is surfaced to the owner in
the PR body rather than silently acted on.
**Basis:** convention — the worker brief states the rule ("upstream *adding a module*
merges perfectly cleanly and silently re-expands exactly the feature surface paws PR
#14 spent days reducing"), and the owner confirmed the full-defect-set scope which
excludes it.

### DEC-3: `ee48f1a77` + `abc8d2429` — two commits or one?
**Resolution:** **One squashed commit.** `abc8d2429` edits the migration file
`ee48f1a77` adds. Landing them as two commits would put an edit-after-add into paws'
history; squashing gives the migration a single first appearance.
**Basis:** codebase — paws' `src-app/server/tests/migration_immutability.rs` baselines
against pushed `origin/main` and its `GRANDFATHERED` list is documented at line 83 as
one that "may only ever SHRINK". Upstream needed a grandfather entry for exactly this
pair; squashing means paws needs none. The worker brief independently forbids editing a
shipped migration.

### DEC-4: Do we copy upstream's new `GRANDFATHERED` entry?
**Resolution:** No. Upstream added `202608210100_agent_task_list_reconcile.sql` to its
own guard's exemption list because of the edit-after-add above. With DEC-3's squash
there is nothing to exempt, and adding an entry would GROW a list the test documents as
shrink-only.
**Basis:** codebase — `migration_immutability.rs:83` and its `:194` failure message
("remove it from GRANDFATHERED (the list may only shrink)").

### DEC-5: What is dropped out of each cherry-pick?
**Resolution:** Two classes, both dropped from every pick:
1. **All `.lifecycle/**` paths.** `d38b789d5`, `2154200f0`, `5e85378d6`, `ee48f1a77`,
   `abc8d2429` each carry a feature's lifecycle artifacts. paws' `main` has no
   `.lifecycle` tree (it was cleaned in `f4daf1bfc`), and importing a stranger
   feature's artifacts would also break this branch's own lifecycle auto-discovery.
2. **`src-app/server/ui/**`** — `abc8d2429` commits ~58k lines of OpenAPI output at a
   WRONG PATH (`server/ui/` rather than `ui/`). Upstream deleted it two commits later
   in `88081b800`. Never staged here, so `88081b800` is not needed either.
**Basis:** codebase — verified by `git show --stat` on each pick and by the existence
of upstream's own corrective commit.

### DEC-6: `f09558f48` / `f6c586408` (honest sandbox diagnostics) — port or escalate?
**Resolution:** **Escalate, do not port.** Both move the `sdk` gitlink, and the
superproject half does not compile without sdk `7026443` (it calls
`config::init_status()` / `config::not_initialized_error()`, which exist only there).
Two of the three defects live entirely inside the sdk, so a superproject-only pick
would not even deliver them. Reported under `SDK_ESCALATION`.
**Basis:** user — the worker brief is explicit: "Do NOT move the sdk submodule pointer
in any PR; if a port needs an sdk change, STOP and escalate — the sdk is shared with
another product line and the branch choice is the owner's." Additionally verified that
letting a pick move `sdk` from `fa9a5772` to `4ab75300` would silently DROP paws' own
CORS, GPU-version-parse and testId work, since `4ab75300` is not a descendant of
`fa9a5772`.

### DEC-7: `beae7c7fb` — mechanical cherry-pick, hand-port, or skip?
**Resolution:** Near-mechanical cherry-pick, with one trivial conflict resolved by
keeping both sides. The brief flagged this as "likely wrong to cherry-pick
mechanically" because paws diverged heavily in `llm_repository`; measurement says
otherwise — paws' default-model work was **purely additive** (a new
`connection_health.rs`, two new migrations, new `models.rs` content, new tests), and
`handlers.rs` + `utils.rs` — the only two files the fix changes — are byte-identical to
the merge base. The one conflict is `tests/llm_repository/mod.rs`: paws added
`mod default_model_seed_test;`, upstream added `mod ssrf_probe_test;` and rustfmt'd the
file. Keep both `mod` lines.
**Basis:** codebase — `git diff 7ca09a750 origin/main -- src-app/server/src/modules/llm_repository/`
shows only additions, none in the two touched files.

### DEC-8: The HF per-row probe changes what paws' seeded mirror row grades as. Accept?
**Resolution:** Accept, verified rather than assumed. After the fix the probe for
paws' seeded `https://huggingface.co/tinnlab` row becomes
`https://huggingface.co/api/models?limit=1&author=tinnlab`. Queried live this session,
it returns a non-empty listing (`tinnlab/Qwen3.5-9B-GGUF`), so the row still grades
`healthy`. Had it been empty the row would grade `unverified`, which paws'
`connection_health.rs` treats as record-only — only `unhealthy` may auto-disable — so
the downside was bounded either way.
**Basis:** codebase + a live measurement recorded in PLAN.md's *Breakage risk*.

### DEC-9: How is the port's test coverage satisfied — re-author, or re-run?
**Resolution:** Re-run the tests that shipped with each fix, in the paws tree. They
were written red-first against the unfixed upstream code, so they already ARE the
executable statement of each invariant; re-authoring them would only risk weakening
them. TESTS.md states this deviation explicitly rather than presenting the ported tests
as newly written.
**Basis:** convention — the skill's D2 rule is that a test must assert the DESIGN's
promise, not the code's behaviour. These tests were authored against the promise while
the code was still broken, which is the strongest form of that.

### DEC-10: Is an OpenAPI regen needed?
**Resolution:** No, and its absence is checked rather than presumed. None of the nine
picks changes a `JsonSchema` type or a route signature. A non-empty diff in
`src-app/ui/openapi/openapi.json` or either `api-client/types.ts` is treated as
evidence that an out-of-scope hunk was dragged in (hygiene rule H2), not as a regen to run.
**Basis:** codebase — the picks change handler-internal validation, client transport
framing, and repository SQL only. Note `just` is not installed on this box, so a regen
would have to use the raw two-command form at `justfile:550-554`.

### DEC-11: Where do the lifecycle artifacts go at merge time?
**Resolution:** Stripped in a final `chore:` commit on the branch, immediately before
the PR is opened, leaving them in branch history for audit.
**Basis:** codebase — this is the established paws precedent (`f4daf1bfc`,
`26127d501`, `6df369ccb`) and matches upstream's own (`a23726215`, `db2347928`). The
skill's merge-hygiene section requires the strip; since the owner performs the merge
and this worker must not, the strip has to happen on the branch.

### DEC-12: Branch name and PR target.
**Resolution:** Branch `fix/upstream-defect-pulldown` off `origin/main`, worktree
`/data/khoi/home-workspace/paws-project/paws-wt-pulldown`, PR into `tinnlab/paws` `main`.
**Opened, never merged; nothing pushed to `main`.**
**Basis:** user — the worker brief's §"How (B) lands" and its standing rules on
worktree placement and merge authority.

### DEC-13: ITEM-7 and ITEM-8 were mis-modelled as plan items. Keep, descope, or reclassify?
**Resolution:** **Reclassify** as hygiene rules H1/H2 under a dedicated PLAN section,
and verify them by command in TEST_RESULTS.md's *Controls* section. They are not
implementable work with observable behaviour — they are assertions ABOUT the resulting
diff (nothing out-of-scope was staged; no submodule gitlink moved). The phase-3 gate
requires every ITEM to be covered by a TEST, and the only ways to satisfy it were to
invent a hollow test (the exact failure this process exists to prevent) or to mark them
`[DESCOPED]`, which would be false — they were done, not cut.
**Basis:** convention — the skill's phase-5 rule that a plan wrong about its own shape
is amended (`impl-wins`) rather than worked around, and its standing refusal of tests
that exist only to satisfy a mapping.

### DEC-14: Four TEST-IDs were recorded PASS that this branch did not earn. Fix how?
**Resolution:** The A11 gate caught TEST-28/29/30/31. Two different causes, two
different fixes:
- **TEST-28** was a real miss of my own making: I wrote its `file:` as a brace
  expression naming two paths, which is not a path, so the gate could not match it
  against the files the branch touched. Both files ARE touched by the `beae7c7fb` pick.
  Fixed by naming one real path.
- **TEST-29/30/31** are genuinely NOT this feature's tests. They are the pre-existing
  paws `migration_immutability` guard, the paws-only `default_model_seed_test`, and a
  shell hygiene assertion. I ran all three and all three pass — but claiming an earned
  PASS for a test this branch did not author is exactly what A11 exists to refuse, and
  it is right. They are now recorded as **Controls** in TEST_RESULTS.md, with their
  commands and observed results, and removed from the enumerated set.
**Basis:** convention — A11's stated remedy is "earn it or admit it", and the honest
third reading for a PORT is that a pre-existing guard is a control, not coverage.
