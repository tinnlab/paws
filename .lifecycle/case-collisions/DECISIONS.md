# DECISIONS.md — case-collisions

Every human/product input the implementation needs, resolved up front. Zero open
questions remain. Nothing here was escalated to the human: the design source
(`case-collisions.md` §2) explicitly grants the final call on the convention *and*
names the precedent to justify it against, so every decision below is resolvable by
convention or by an instruction already given — none is a genuine product choice
(phase-4 rule / B8).

### DEC-1: Where do the 24 colliding store directories go?

**Resolution:** Each moves to a `stores/` directory created beside its component —
`<parent>/<storeName>/` → `<parent>/stores/<storeName>/`. Example:
`modules/user/components/user/editUserDrawer/` →
`modules/user/components/user/stores/editUserDrawer/`.
**Basis:** convention — 91 stores in `src-app/ui/src` and 5 in
`src-app/desktop/ui/src` already live under a `**/stores/<storeName>/` parent; the 24
colliding ones are the only outliers, and **0 of 24** currently sit under a `stores/`
parent. `agent-kit/docs/CODING_GUIDELINES.md` §9 names `stores/` as the store home in
the canonical frontend module layout. This is the shape the design source itself
prescribes.

### DEC-2: A module-root `stores/` (like `modules/user/stores/users/`) or a `stores/` beside the component?

**Resolution:** Beside the component.
**Basis:** convention + blast radius. The existing `stores/` groupings already sit at
**varying depths** — module root (`modules/user/stores/users/`), sub-layer
(`modules/chat/core/stores/splitView/`), and extension dir
(`modules/host-mount/project-extension/stores/projectHostMounts/`) — so a
component-sibling `stores/` is *within* the convention, not a new one. Hoisting all 24
to their module root would additionally destroy co-location, flatten three distinct
subtrees into one namespace (`modules/user/components/{user,group}/` both contribute
drawers), and rewrite far more of each import path than the collision requires. The
design source's own worked example is the component-sibling form.

### DEC-3: Could a suffix rename (e.g. `editUserDrawer.store/`) be used instead of moving?

**Resolution:** No. Rejected.
**Basis:** the design source — *"Do NOT pick a bespoke suffix convention without that
justification [against the 91-store precedent]."* A suffix would eliminate the
collision but would create a 25th convention in a codebase that already has one used
96 times. INV-7 is the binding constraint and TEST-7 pins it.

### DEC-4: Where does the regression guard live?

**Resolution:** `src-app/ui/scripts/lint-case-collisions.mjs` — a single script in the
paws repo's own tree.
**Basis:** codebase + a hard constraint. `sdk/` is a **git submodule** pinned to
`origin/chat` on `ziee-ai/sdk`, which this environment cannot push to; a file added
under `sdk/packages/config/src/lint/` would not be committed by paws at all (it would
only dirty a gitlink) and would be lost on the next `git submodule update`. That rules
out extending the sibling `store-actions.mjs` in place. `src-app/ui/scripts/` is a
permanent committed path (26 tracked files) that already hosts four guards wired into
`npm run check` (`lint-icon-action`, `lint-hooks`, `gen-crawl-cassette`,
`gen-override-registry`). **The `sdk` submodule is not modified by this branch.**

### DEC-5: Does `src-app/desktop/ui` get its own copy of the guard?

**Resolution:** No. `src-app/desktop/ui/package.json`'s `check` invokes the SAME
script: `node ../../ui/scripts/lint-case-collisions.mjs`.
**Basis:** codebase precedent — desktop already does exactly this for
`"check:override-registry": "node ../../ui/scripts/gen-override-registry.mjs --check"`.
It also honours CLAUDE.md's *"One harness, not several"*: this repo has twice paid for
forked scripts drifting (the gallery harness, the six generators), and the fix each
time was one script with per-workspace registration, never a second copy. The guard's
roots are anchored to its own file location, so it is correct from either CWD (TEST-4).

### DEC-6: Is the guard gating (exit 1) or advisory (report, exit 0)?

**Resolution:** Gating — exit 1 on any finding. No allowlist file, no per-entry
opt-out attribute, no `--gate` flag needed to make it bite.
**Basis:** the design source — *"Add a check that **FAILS** when any `Foo.tsx` sits
beside a `foo/` directory."* The advisory shape (`lint-native-scroll.mjs`) exists only
because that lint inherited a pre-existing backlog to burn down. Here the backlog is
zero the moment ITEM-1 lands, so there is nothing to grandfather and an allowlist would
be a hole with no occupant — exactly the kind of unused seam §15 calls unfinished work.

### DEC-7: What exactly counts as a collision?

**Resolution:** Two rules, both applied per-directory over sibling entries:
1. **file-vs-directory** — a source file whose basename *without extension* is
   case-insensitively EQUAL to, but case-sensitively DIFFERENT from, a sibling
   directory's name. (This is the reported bug: `EditUserDrawer.tsx` beside
   `editUserDrawer/`.)
2. **any-vs-any** — two sibling entries whose FULL names are case-insensitively equal
   but not identical (file/file, dir/dir, or file/dir). This is a **true filesystem**
   collision: a case-insensitive checkout cannot even represent both.

**Basis:** convention + the design source's exclusions. Rule 1 is the letter of the
requirement. Rule 2 is five extra lines that catch the strictly worse failure (a
checkout that silently loses a file), costs nothing, and is equally decidable — a
filesystem-shape test over a bounded set of sibling names, not a semantic
pattern-match, so it is not the unbounded-evasion-space guard class the lifecycle's
`GUARD-SUB` rule exists to stop. Both rules **naturally exclude all three §4
out-of-scope cases** without a special case: `use-mobile.ts`/`use-mobile.tsx` share an
identical basename (no case difference), and `types/` vs `types.ts` /
`constants/` vs `constants.tsx` are same-case (no case difference). Verified: the
guard reports **0** on those paths.

### DEC-8: Which file extensions does the guard treat as source files?

**Resolution:** `.ts .tsx .js .jsx .mjs .cjs .mts .cts .json .css`.
**Basis:** codebase — the desktop resolver's own probe list in
`src-app/desktop/ui/plugins/vite-plugin-local-override.ts` is
`['.ts', '.tsx', '.js', '.jsx', '.json', '.css']`; TypeScript additionally probes
`.mts`/`.cts`, and Node/Vite `.mjs`/`.cjs`. The guard covers exactly the union of what
the real resolvers probe — narrower would leave a reachable hole, wider would flag
assets no resolver ever extension-probes.

### DEC-9: Which roots does the guard scan?

**Resolution:** `src-app/ui/src` and `src-app/desktop/ui/src`, resolved from the
script's own location (`HERE/../src`, `HERE/../../desktop/ui/src`), plus an optional
`--root=<dir>` override used only by the guard's own fixture tests.
**Basis:** codebase — every cross-tree lint in this repo scans exactly those two roots
(`lint-native-scroll.mjs`, `hardcoded-colors.mjs`, `settings-field.mjs`,
`tooltip-placement.mjs`), and the `--root=` fixture-override escape hatch is the
established shape (`lint-native-scroll.mjs` uses it for `__detector_fixtures__`).
Anchoring to `HERE` rather than CWD is what makes DEC-5's single-script/two-workspace
registration correct, and is directly required by INV-6.

### DEC-10: Does this feature introduce any operational tunable — fixed constant or admin-configurable settings row?

**Resolution:** **Neither — it introduces none.** The mandatory
configurable-settings question is answered "no tunable exists". The guard is a
build-time lint that runs in `npm run check`; it has no resource limit, retention
period, rate/quota limit, concurrency cap, feature toggle, model selection, or
threshold. Nothing in this branch reaches runtime: the 24 moves change file paths, and
no server code, config schema, or settings table is touched. There is therefore no
singleton-settings table, REST GET/PUT, permission, sync entity, or admin card to add.
**Basis:** convention — the rule exists so a tunable is never shipped as a bare
hardcoded constant by omission; here there is no tunable to omit. The one value that
could be mistaken for one (the extension list, DEC-8) is a *correctness* constraint
derived from the resolvers' own probe lists, not an operator preference, so it is a
named module-level constant in the guard rather than an inline literal — promotable
later without a rewrite if that ever changes.

### DEC-11: Do we fix the other TypeScript errors visible in the failing macOS build log?

**Resolution:** No. Report them; do not chase them.
**Basis:** the design source §4 (*Scope discipline*) states this explicitly. The
diagnosis is that `Property 'open' does not exist`, `nativeScroll` missing, and
`useModelDetailsDrawerStore` not exported are all **fallout** of the casing bug; any
that survive the fix are reported in `HUMAN_FEEDBACK.md` / the PR body, not fixed here.

### DEC-12: How is the macOS result recorded, given a Darwin build is impossible on this box?

**Resolution:** `TEST_RESULTS.md` records the macOS build as **`NOT VERIFIED`**, with
the reason (no Darwin std / no Xcode on a Linux host) and the exact command for the
lead to dispatch:
`gh workflow run desktop-release.yml --repo tinnlab/paws --ref fix/ui-store-case-collisions -f target=aarch64-apple-darwin`.
It is never written as PASS.
**Basis:** the design source §3 (*"A PASS here that was never observed on macOS is an
A11 violation — write `NOT VERIFIED` rather than claiming it"*), plus lifecycle rules
A11 and P5 (a platform arm is not covered by a Linux-only green).

### DEC-13: Does the `tsc` acceptance test (TEST-8) get chained into `npm run check`?

**Resolution:** No. It lives in its own file
(`src-app/ui/scripts/lint-case-collisions.tsc.test.mjs`), is enumerated in TESTS.md,
and is run once at phase 8.
**Basis:** convention + cost. `tsc` is already the FIRST step of `npm run check` in
each workspace, so chaining this in would run `tsc` three times per developer check
for zero added signal. It exists as a separate file solely because A11 requires the
`TEST-8` id to appear on an added line of this branch's diff, and a `package.json`
chain entry cannot carry one.

## DEC-13 CORRECTION — the tsc oracle IS chained into `npm run check` after all

**Resolution:** reversed. `test:case-collisions:tsc` is now part of `src-app/ui`'s
`check` chain.
**Basis:** a blind auditor reproduced the hole DEC-13's reasoning missed. DEC-13
argued the file only duplicates `check`'s own first step — true of its *exit-code*
assertion, false of everything else it does. Its unique value is the anti-vacuity
half: `--listFilesOnly` showing a >1000-file program, and that program containing the
specific relocated modules. Those exist precisely because a `tsconfig` whose `include`
was narrowed type-checks NOTHING and exits 0 — demonstrated by replacing
`src-app/ui/tsconfig.json` with `{"compilerOptions":{"noEmit":true},"files":[]}`,
which left an exit-code-only version of the test green. Outside `check`, nothing ever
ran those assertions, so the guard against a silently-empty compile did not exist on
main. The duplicated `tsc` cost (~40 s on a multi-minute gate) is the right price.

### DEC-15: The guard scans `sdk/packages/*/src`, which this repo cannot fix. Block on findings there, or report them?

**Resolution:** **Report, do not block.** sdk roots are marked `advisory`: their
findings print in full, name the upstream repo, and do not set a non-zero exit. The
eight trees this repo owns stay fail-closed. If the submodule is not checked out, the
guard says so explicitly instead of silently scanning 8 roots instead of 15 and still
printing OK.
**Basis:** the design's own read-only constraint, applied consistently. Both
workspaces compile sdk through their `@ziee/*` path mappings, so a collision there
genuinely would break the macOS build and is worth surfacing. But `ziee-ai/sdk` is not
pushable from here and the guard deliberately has no allowlist — so a blocking sdk
finding would make `npm run check` unpassable in this repo until an upstream release,
with no action anyone here could take to clear it. A gate nobody can clear is a gate
people learn to bypass, which costs more than the finding it was protecting. Advisory
keeps the signal and drops the hostage-taking. Raised by a blind auditor as MEDIUM.

### DEC-16: Where do the branch-provenance assertions (TEST-6 / TEST-7) live?

**Resolution:** in their own file, `lint-case-collisions.provenance.test.mjs`, with its
own runner (`test:case-collisions:provenance`), **deliberately NOT chained into
`check`** — and the chained suite is now entirely git-independent (grepping it for
`origin/main` returns only comments).
**Basis:** a permanent gate cannot carry a one-time claim. These two tests assert facts
about *this* diff — that 24 store directories moved as renames, each landing under a
`stores/` parent. My first fix guarded only the post-merge case (empty diff); an
auditor then reproduced two more with a `git` shim: **any future branch that relocates
a store** takes the branch path and fails `assert.equal(dirs.size, 24)`, and **any
branch cut from a stale base** re-sees these 24 renames plus its own additions and
fails the "only renames" assertion. Both would have broken `npm run check` for changes
that knew nothing about this work. TEST-3 now asserts the provenance suite is runnable
by name AND absent from both `check` chains, so the separation cannot quietly erode.

### DEC-14: At each rewritten import site, may the specifier form change (alias ⇄ relative)?

**Resolution:** No. Each site keeps its existing form — the 95 `@/…` sites stay
`@/…`, the 4 relative sites stay relative. The edit is a path substitution and nothing
else; no site is added, removed, merged, reordered, or converted.
**Basis:** codebase — `src-app/desktop/ui/docs/UI_OVERRIDES.md`'s **barrel caveat**:
tier-2 `.desktop.tsx` resolution fires ONLY for `@/` specifiers, so converting an alias
import to a relative one silently disables a desktop override with no compile error.
`ProviderGroupAssignmentCard.desktop.tsx` is a live tier-2 override on one of the 24
affected components, so this is a real hazard on this exact diff, not a hypothetical.
Preserving form also keeps `appLayout`'s module-scope `appLayoutSeam.set(...)` side
effect firing in the same order.
