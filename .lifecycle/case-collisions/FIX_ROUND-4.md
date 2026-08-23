# FIX_ROUND-4.md — case-collisions

Round 4: a blind re-audit of round 3's diff (`correctness` + `design-conformance`), the
latter briefed to judge **proportionality** bluntly, because I had flagged that as my own
open concern rather than waiting to be told.

## The verdict that matters

**All seven design non-negotiables PASS, each verified by execution, not inspection.**
The design-conformance auditor re-derived the collision check with its own detector,
re-ran the codegen from a wiped copy, ran `tsc` in both workspaces, ran the guard from a
synthetic repo at the real relative path, and confirmed the `sdk` gitlink is untouched.
150 renames, 0 deletes. That is the fourth independent confirmation the fix is correct.

## And the verdict I asked for: it was over-built

Measured by the auditor:

| | lines |
|---|---|
| the fix (renames + import sites) | **+135 / −115** |
| the apparatus checking it | **1,915** |

**14 lines of apparatus per line of fix**, and **+49 s on every `npm run check`** — 47 s
of it one duplicate two-workspace `tsc` pass, making this branch the single most
expensive item in the gate at ~2.4× the cost of the type-check it protects.

The round-3 commit message diagnosed guard-substitution and then added a fifth script
while keeping the other four. The message and the diff pointed in opposite directions.
That is worth naming plainly rather than filing under "thorough".

## So round 4 SUBTRACTS

- **Un-chained the tsc oracle** (−47 s). The decisive reason is not cost: it compiles
  BOTH workspaces, so from `src-app/ui`'s gate a type error in `src-app/desktop/ui`
  failed `ui`'s check with *"at least one import site still points at a pre-move path"*.
  Coupling one workspace's gate to the other's type-cleanliness, and mislabelling the
  failure, is worse than the hole it closed. It keeps its runner and runs at phase 8.
- **Chained the resolution oracle in its place** (+0.3 s). More general, and its header's
  "~10-20 s" — the sole stated reason it had been excluded — was measured at **0.26 s**,
  off by 50×.
- **Deleted the numeric floors** in TEST-1 (redundant beside an exact recount) and the
  last count in TEST-12. Every count this branch has carried was either satisfiable while
  the property was violated, or a threshold that would go red for an unrelated change.

Net: the gate goes from **+49 s to ~+2 s** and gets *more* general.

## Real defects found in round 3's own work

- **The counter I moved still did not do what its comment claimed.** I switched it from
  directories-traversed to entries-analysed, but placed it *before* the rule blocks — so
  an early return between counter and rules leaves the number byte-identical. The auditor
  rebuilt the exact mutation over a full copy of the real trees: identical counts,
  planted collision undetected, **TEST-1 still green**. The protection came from TEST-15,
  not from where the comment attributed it. Counted after the rules now.
- **The backstop claim was false.** The guard's header says the resolution oracle covers
  the cross-tree Tier-1 shape. It resolved `@/` only against `ui/src` — tier 3 only — so
  it was exactly as blind as the sibling rules. Now models all three desktop tiers in
  probe order, with a control asserting the tier-1 divergence is detected. (0 such pairs
  today, confirmed by the auditor over all 623 `@/` specifiers.)
- **"Every real import specifier" omitted ~12% of them**, in the categories that matter:
  ~570 `@ziee/*` subpath aliases (including `@ziee/desktop/modules/updater/stores/updater`
  — the exact shape this branch is about, and the route into the sdk trees the shape guard
  can only treat as advisory), ~90 side-effect imports, TS's `.js`→`.ts` substitution, and
  desktop's exact `@/api-client/*` mappings. All now covered.
- **The guard and its recount disagreed about symlinks** — my round-3 `countEntries` used
  `Dirent` predicates, which are false for a symlink, while the guard `statSync`s them.
  Latent (zero symlinks today), but it would have turned `npm run check` red for an
  unrelated change. Both now classify by target; verified equal on a symlink fixture.
- **`.css` in the probe list** manufactured false positives for relative specifiers;
  **an unreadable directory failed open**; **one global floor** was satisfied by the web
  workspace alone (desktop is 3.2% of specifiers) — floors are now per-workspace.
- **The provenance suite could never pass again after merge.** Round 3 replaced a
  disguised skip with a hard fail, which was right about the skip and wrong about the
  consequence: it shipped a named runner that is red forever on main. It now reads
  `git log --follow`, because a rename is recorded in history permanently — true on the
  branch, still true on main, and false exactly when files were copied rather than moved.
  Verified by deleting `refs/remotes/origin/main` entirely: **2/2 pass**.
- Three headers documenting behaviour their own diff had removed; `mustCompile`'s
  absolute needles (fragile through a symlinked worktree, since `tsc` realpaths) and an
  early-out checked per frame rather than per iteration; the DOM cross-check probing
  without retry on the diagonal.

## Termination

**Not converged yet, and I am not going to write a convenient number to say otherwise.**
Round 4's re-audit produced **19 distinct confirmed findings**, listed above; the count
below is that, not zero. They were, without exception, in the apparatus rather than the
fix, and the response was to make the apparatus *smaller*. Round 5 audits this round's
diff — whose net effect is deletion — and that is where convergence gets tested.

The two things I would flag to a human reviewer rather than pretend are settled:

1. **Proportionality is still arguable.** 1,915 lines is a lot for this fix even after
   the cuts. The auditor's suggested further cuts (drop the provenance file, merge the
   two red-fixture harnesses) are defensible; I kept both because the provenance file now
   pins INV-4 durably and TEST-2 covers the design's explicit non-collision exclusions
   that TEST-15 does not. Someone could reasonably cut more.
2. **The macOS build remains NOT VERIFIED.** Every local signal is green and four
   independent checks say the bug class is gone, but the only true oracle is the CI
   dev-build, which has not run. That is recorded as `NOT VERIFIED` in `TEST_RESULTS.md`,
   never as a pass.

## Verification of this round

- durable suite **7/7** · provenance **2/2** (and **2/2** with `origin/main` deleted)
- resolution oracle **2/2**, and **RED** on a reintroduced real collision
- tsc oracle **2/2** with derived relative needles · gallery spec **14/14**
- guard on the real trees: 0 findings, 15 roots · symlink recount now agrees (2 = 2)

**New confirmed findings:** 19
