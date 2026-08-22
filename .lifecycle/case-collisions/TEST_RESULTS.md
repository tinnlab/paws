# TEST_RESULTS.md — case-collisions (phase 8)

The single full run of the enumerated set from `TESTS.md`. Every line below was
observed on this box (Linux, this worktree) unless it says `NOT VERIFIED`.
Full logs were captured with `set -o pipefail` and the command's OWN exit code
read from `${PIPESTATUS[0]}` — never `cmd | tail`.

## Workspace gates

- `npm run check (ui): PASS` — exit 0.
- `npm run check (desktop/ui): PASS` — exit 0.

Both chains include `check:case-collisions`; `ui`'s additionally runs
`test:case-collisions` and `test:case-collisions:resolution`.

## A7 — boot/runtime canary

- `gate:ui (ui): PASS` — exit 0. `tsc` clean, lint clean, runtime-health
  **220/220 surfaces PASS with 0 gating HIGH findings**, visual layer 44 passed.
  Run validity: **688/688 cells, origin alive (81 checks), transport artifacts
  0 (0% of findings)** — i.e. the crawl really did observe the product.
- `gate:ui (desktop/ui): PASS` — exit 0. `tsc` clean, lint clean, runtime-health
  **51/51 surfaces PASS with 0 gating HIGH findings**, coverage ok, visual layer
  *not configured for this app* (desktop sets `visualConfig: null` by design).
  Run validity: 318/318 cells, origin alive (43 checks). Recorded honestly: this
  run reported **transport artifacts 151 (20.6% of findings)** — all
  `request-failed`, classified as harness-noise and non-gating. It is above the
  0% a fully clean crawl reads, so it is named here rather than glossed; it did
  not produce a gating HIGH finding on any surface and the gate did not declare
  the run VOID. The two workspaces' gates serialized on the machine-wide gallery
  lock exactly as designed (`host lock acquired after 269s`), so neither crawl
  observed the other's origin.

The absolute form is recorded for both workspaces because each gate returned
zero **gating** findings and exited 0; no baseline comparison was needed.

## Enumerated tests

- **TEST-1**: PASS — `test:case-collisions`. Guard spawned against the real trees reports **0** collisions.
- **TEST-2**: PASS — `test:case-collisions`. RED on every real collision shape (file-vs-dir, file-vs-file, `.desktop` infix, full-name case duplicate), GREEN on the shapes that legitimately coexist, FATAL (exit 1) on a root it cannot walk.
- **TEST-3**: PASS — `test:case-collisions`. `check:case-collisions` is registered AND chained in both workspaces, both pointing at the one ui-tree script; the provenance suite is runnable by name and absent from both `check` chains.
- **TEST-4**: PASS — `test:case-collisions`. Guard is CWD-independent and its source names no `.lifecycle` path. See the physical half below.
- **TEST-5**: PASS — `test:case-collisions`. `store-actions --check` exits 0 at the new locations, and a WRITE-mode run leaves every `actions.gen.ts` byte-identical.
- **TEST-6**: PASS — `test:case-collisions:provenance`. Every file of the relocated store directories is recorded as a git **rename** across `origin/main...HEAD`; history follows the files (INV-4).
- **TEST-7**: PASS — `test:case-collisions:provenance`. Every relocated store sits under a parent directory named exactly `stores`, in the same component subtree (INV-7).
- **TEST-8**: PASS — `test:case-collisions:tsc`. `tsc --noEmit` exits 0 in BOTH `src-app/ui` and `src-app/desktop/ui`, the compiled program is non-empty and really contains the relocated modules, and the control proves `tsc` does fail on a deliberately broken specifier (INV-3).
- **TEST-9**: PASS — gallery e2e, 14/14. Every relocated store, imported through its bare directory specifier, resolves to the STORE module and not its sibling component; each overlay-backed store opens the RIGHT drawer through the store's own action.
- **TEST-10**: PASS — `test:case-collisions`, TEST-2 fixture (b), now cited by ID at the fixture. The synthetic `AgentStepForm.tsx` + `agentStepForm.ts` pair (the exact shape of the 25th collision) exits 1 and is reported as `file-vs-file`, naming both files.
- **TEST-11**: PASS — `test:case-collisions`, TEST-2 fixtures (c) and (f), now cited by ID at each. `ProviderGroupAssignmentCard.desktop.tsx` beside `providerGroupAssignmentCard/` exits 1; a missing root and an unreadable directory each exit 1 with `FATAL` rather than a green line.
- **TEST-12**: PASS — `test:case-collisions`. Every store directory under a `stores/` ancestor is a real store, and `stores/` is the dominant convention expressed as a ratio, not a magic count.
- **TEST-13**: PASS — gallery e2e (`TEST-13: each identity marker appears in ITS drawer and in no other`). The 12 overlay identity markers are checked for exclusivity in the DOM, not between strings.
- **TEST-14**: PASS — `test:case-collisions:resolution`, 3/3 (the oracle plus both controls). Every real import specifier in both workspaces resolves identically against the real case-sensitive filesystem and through a case-INSENSITIVE sibling lookup in TypeScript's probe order; the coverage floor and the both-bug-shapes control hold.
- **TEST-15**: PASS — `test:case-collisions`. Invoked exactly as `npm run check` invokes it (no args, default roots): clean tree passes; a collision buried five levels inside `components/` BLOCKS; an sdk-only collision is reported but does not block and does not print the unqualified green line; both present blocks.
- **TEST-16**: PASS — `test:case-collisions`. (Present in the guard suite; not enumerated in `TESTS.md` — see the follow-up note below.) `ui`'s tsconfig program is non-empty and includes the relocated stores.

## ITEM-10 — the PHYSICAL half of INV-6 (lifecycle-strip)

`.lifecycle/` was physically moved out of the worktree and
`npm run check:case-collisions` re-run in BOTH workspaces. Observed output,
identical from either CWD:

```
[case-collisions] OK - no sibling names differ only by case (analysed 4283 entries across 15 root(s):
  src-app/ui/src=2830 src-app/ui/tests=849 src-app/ui/plugins=8 src-app/ui/scripts=31
  src-app/desktop/ui/src=205 src-app/desktop/ui/tests=30 src-app/desktop/ui/plugins=5 src-app/desktop/ui/scripts=12
  sdk/packages/config/src(advisory)=12 sdk/packages/framework/src(advisory)=70 sdk/packages/gallery/src(advisory)=24
  sdk/packages/kit/src(advisory)=145 sdk/packages/notification-ui/src(advisory)=23 sdk/packages/shell/src(advisory)=32
  sdk/packages/test-e2e/src(advisory)=7).
```

Exit 0 in `src-app/ui` and exit 0 in `src-app/desktop/ui` with `.lifecycle/`
absent. INV-6 holds against a lifecycle-stripped tree, which is what main will
be. `.lifecycle/` was restored afterwards.

## macOS — what run `32573440506` actually proved, and what it did not

DEC-12 said a Darwin build is impossible on this Linux box and must never be
written as PASS. It still is not written as PASS. What changed is that the lead
dispatched the build against these exact commits, so there is now real Darwin
evidence to record precisely rather than a blank.

**Run:** `tinnlab/paws` Actions run **32573440506**, workflow *Desktop Release*,
branch `verify/case-collisions-macos`, job *dev build aarch64-apple-darwin*
(id `97032204065`), 20m06s. The branch head there is byte-identical to the 11
commits on `fix/ui-store-case-collisions` at the time of dispatch.

**PROVED on macOS (aarch64-apple-darwin, a genuinely case-insensitive host):**

- The job's `beforeBuildCommand` ran
  `npm run build --workspace=@ziee/ui-core && npm run build --workspace=@ziee/desktop-ui`,
  and each of those is `tsc && vite build`. Because the two are joined by `&&`,
  the desktop leg only started because the `ui` leg's `tsc` and bundle both
  succeeded.
- **BOTH Vite bundles were emitted**: `✓ built in 4.48s` into
  `src-app/dist/ui`, and `✓ built in 3.51s` into `src-app/desktop/ui/dist`.
- The **`ziee` server crate compiled** — the log's only verdict for it is
  `warning: ziee (lib) generated 5 warnings`, no error.

This is the authoritative retirement of the residual risk the plan audit named:
the module-resolution bug this branch fixes is exactly a `tsc`/Vite failure on a
case-insensitive filesystem, and both compiled clean there.

**NOT PROVED / NOT VERIFIED:**

- **No `.dmg` was produced** and the run is red overall. `Upload bundle` never
  executed.
- The run failed later, in the Rust link phase, on the **`ziee-desktop`** crate:
  `unused imports: body::Body, http::Request, response::Response` at
  `desktop/tauri/src/modules/backend/mod.rs:20` (fatal under `-D unused-imports`)
  and `error[E0063]: missing field enable_popout_windows in initializer of
  ziee_desktop_harness::WindowConfig` at the same file `:278` →
  `could not compile ziee-desktop (lib) due to 2 previous errors`.
- Those two errors are **pre-existing and unrelated to this branch** — neither
  path is touched by this diff (this branch changes no Rust file at all), and the
  lead is fixing them on a separate branch. They are NOT this branch's to fix and
  were deliberately not fixed here.
- Consequently: **a full macOS desktop app build is `NOT VERIFIED`** and stays so
  until the `ziee-desktop` fix lands. The *case-collision* fix itself is verified
  on macOS by the evidence above.

## Notes / follow-ups found while running phase 8 (recorded, deliberately NOT fixed)

Out of scope for this branch per its instructions; carried into the PR body so
they are not lost when `.lifecycle/` is stripped at merge.

1. **`lifecycle-check --phase 7` FAILs, pre-existing.** `FIX_ROUND-4.md` records
   19 new confirmed findings and round 5 (15 findings, all closed in
   `LEDGER.jsonl`: 75 fixed / 5 wontfix across 80) was never written as a
   `FIX_ROUND-5.md`, so the validator's decay profile never sees it. Converging
   the gate would require running another audit round, which this handoff was
   explicitly instructed not to do — and round 3 already established that ~80% of
   findings were landing on the guard apparatus (the GUARD-SUB pattern), so more
   rounds are the wrong medicine anyway.
2. **`DECISIONS.md`'s "DEC-13 CORRECTION" is stale.** It states the tsc oracle
   IS chained into `ui`'s `check`; round 4 deliberately un-chained it (see
   `FIX_ROUND-4.md` — it coupled `ui`'s gate to `desktop/ui`'s type-cleanliness
   and mislabelled the failure) and chained the resolution oracle in its place.
   The decision record was never annotated as superseded. Documentation drift
   only; the runner still exists and TEST-8 was run here at phase 8.
3. **TEST-16 is asserted in the guard suite but is not enumerated in
   `TESTS.md`.** It passes; it is recorded above for completeness. `TESTS.md` was
   not edited at phase 8 to add it, since amending the phase-3 artifact after the
   fact is worse than the gap.
