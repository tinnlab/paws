# HUMAN_FEEDBACK — composer-picker-popover

Living ledger of human review of the RUNNING feature.

- **FB-1** [status: resolved] — *"for selection of assistant and knowledge base, we need to limit the width of popover container, if there are so many of them, we need to limit the height too with react overlay scroll bar and show a search box on top"* → Realized as `docs/design/composer-picker-popover.md` and the five invariants INV-1..5, each pinned to an `[acceptance]` test: bounded width (`w-auto min-w-60 max-w-80`, rows truncate) proven by TEST-13; bounded height (`max-h-64`) through the app's existing overlayscrollbars `ScrollArea` — the library the request names, reused via the kit wrapper rather than a second integration — proven by TEST-12; a search box at the top of BOTH pickers, always present (the KB picker's old `> 6` threshold is gone), with a real no-matches state, proven by TEST-14.

## No further human review yet

**No human feedback on the running feature has been received.** This ledger records the
originating request only. The feature has not yet been demonstrated to its owner, so
phase 9 is legitimately PENDING rather than complete — the sign-off should be taken
against the five invariants and their acceptance tests (demonstrated live), not against
a gate tally.

Two things the owner should be told explicitly at that review, because they are choices
rather than mechanics, and one is outside the feature's own scope:

1. **The `sdk` submodule carries an unpushed commit.** `sdk` @ `8d13778` regenerates
   `testIds.generated.ts`. It is committed on the pinned `chat` branch and the pointer is
   bumped here, but it is deliberately NOT pushed — pushing a shared SDK branch is the
   owner's call, and other worktrees regenerate the same file. `git -C sdk push origin chat`
   is required before this branch can merge.
2. **This branch absorbs a pre-existing `origin/main` breakage** (ITEM-12). `npm run check`
   exits 1 on a pristine `origin/main` worktree — `check:testid-registry` is missing 31 ids
   and `check:state-matrix` is stale by 3 surfaces. That is not this feature's doing, but
   the branch could not record a green gate without reconciling it. It is isolated in its
   own commit so it can be split off, and the six orphaned `stateCoverage` keys it adds are
   marked with an explicit "pre-existing, reconciled only to unstick the gate" reason rather
   than silently excused.

## Generalizable rules harvested from this run

Candidates for the orchestrator to fold into the lifecycle skill / a lint. Each traces to
something that actually cost time or nearly shipped a defect here.

- `[generalizable: yes — a task-completion NOTIFICATION reports the pipeline's exit status, not the command's. Read the command's own recorded exit code (PIPESTATUS/`set -o pipefail`) before believing a run passed. Here a "exit code 0" notification hid a baseline `npm run check` that had actually exited 1, and the wrong conclusion stood for an hour.]`
- `[generalizable: yes — measure the BASE before claiming a gate is green: run the gate on a pristine `origin/main` worktree first. Two of this repo's committed generated registries were already stale on main, which is invisible if you only ever run the gate on your own branch.]`
- `[generalizable: yes — a Playwright `toBeVisible()` is NOT a reachability assertion: it is true for a row clipped inside an `overflow` scroller. Prove "reachable only after scrolling" with bounding-box containment, before AND after the scroll.]`
- `[generalizable: yes — never assert on seeded ORDER; assert on DOM position. A store that returns rows newest-first turns "the last name I created" into the first row, and the test silently exercises the wrong element.]`
- `[generalizable: yes — a parity/isolation assertion between two renders of the SAME component is true by construction and survives deleting the thing it guards. Pair every equality assertion with an absolute one.]`
- `[generalizable: yes — a component spec must drive the REAL production trigger, not a stand-in `div`. The stand-in cannot exercise how the real element's own handlers compose with the primitive's, which is exactly where a blind audit predicted a defect.]`
- `[generalizable: yes — in this repo the generated static testid registry scans for literal `data-testid="…"`, so (a) moving an id into a prop silently drops it from the compile-time typo check, and (b) a template selector written `[data-testid="${id}"]` leaks the raw placeholder into the production id union. Keep production ids as literals at the call site; build test selectors so no quote directly follows the attribute name.]`
