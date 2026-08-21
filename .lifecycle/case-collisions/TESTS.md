# TESTS.md — case-collisions

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that would go
RED if the invariant were violated; the frontend diff carries a `tier: e2e` spec.

No new permission is introduced (this branch adds no `permissions.rs` entry and no
grant migration), so no `[negative-perm]` restricted-user e2e is required (A10 N/A).

## Tests

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-5, ITEM-7] file: `src-app/ui/scripts/lint-case-collisions.test.mjs` — asserts: the guard, spawned against the REAL `src-app/ui/src` **and** `src-app/desktop/ui/src`, reports **zero** case collisions and exits 0. This is the design's own acceptance criterion ("re-run the detector to prove 0 remain") run as code; it goes RED if any `Foo.tsx` still sits beside a `foo/`.
- **TEST-2** (tier: unit) [covers: ITEM-5, ITEM-7] file: `src-app/ui/scripts/lint-case-collisions.test.mjs` — asserts: on a synthetic temp tree containing a deliberate `Widget.tsx` beside `widget/`, the guard exits **1** and its stdout names BOTH the file and the directory; and on a sibling clean tree (a `Widget.tsx` beside an unrelated `helpers/`, and a `Widget.tsx` beside `Widget/` differing in NO character) it exits 0. Proves the guard is not a no-op and does not false-positive.
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-5] [covers: ITEM-6, ITEM-7] file: `src-app/ui/scripts/lint-case-collisions.test.mjs` — asserts: `src-app/ui/package.json` declares `check:case-collisions` **and** its `check` script chain contains `npm run check:case-collisions`; and `src-app/desktop/ui/package.json` does the same, pointing at the SAME ui-tree script (`../../ui/scripts/lint-case-collisions.mjs`) rather than a fork. A registration that exists but is never chained would pass a source grep and fail this test.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-6] [covers: ITEM-5, ITEM-10] file: `src-app/ui/scripts/lint-case-collisions.test.mjs` — asserts: the guard exits 0 when spawned with `cwd` set to an unrelated directory (proving its roots are anchored to its own file, not the CWD), and its source text contains no `.lifecycle` path segment. Together these are the machine half of "survives the merge strip"; the physical half (move `.lifecycle/` aside, re-run `npm run check:case-collisions` in both workspaces) is executed at phase 8 and recorded in `TEST_RESULTS.md`.
- **TEST-5** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-4, ITEM-7] file: `src-app/ui/scripts/lint-case-collisions.test.mjs` — asserts: after the move, `sdk/packages/config/src/lint/store-actions.mjs --root=src --root=../desktop/ui/src --check` exits **0** (nothing stale, no structural problem); and a WRITE-mode run of the same generator leaves every `actions.gen.ts` byte-identical (captured before/after). "A fix that codegen reverts is not a fix" — this is that claim, executed.
- **TEST-6** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-1, ITEM-7] file: `src-app/ui/scripts/lint-case-collisions.test.mjs` — asserts: `git diff --find-renames --name-status origin/main...HEAD` records **every** file of all 24 relocated store directories as a rename (`R…`) whose old path is the pre-move location and whose new path is under `stores/` — i.e. history follows the files. An add/delete pair (what a copy-then-remove would produce) fails this test.
- **TEST-7** (tier: unit) [acceptance] [invariant: INV-7] [covers: ITEM-1, ITEM-7] file: `src-app/ui/scripts/lint-case-collisions.test.mjs` — asserts: every store directory relocated by this branch has a parent directory named exactly `stores`, and still sits in the same component subtree as its component file — i.e. the fix joined the existing 91-store `**/stores/<name>/` convention instead of inventing a suffix. A bespoke convention (e.g. `editUserDrawer.store/`) fails this test.
- **TEST-8** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-2, ITEM-3, ITEM-9] file: `src-app/ui/scripts/lint-case-collisions.tsc.test.mjs` — asserts: `tsc --noEmit` exits **0** in BOTH `src-app/ui` and `src-app/desktop/ui`. `tsc` is the authoritative oracle for "every import site updated": a single missed specifier in either workspace is an unresolvable module and turns this RED. Deliberately not chained into `npm run check` (whose first step is already `tsc` per workspace); run once at phase 8.
- **TEST-9** (tier: e2e) [covers: ITEM-8, ITEM-2] file: `src-app/ui/tests/e2e/visual/store-case-collision.spec.ts` — asserts: in a real browser against the backend-free gallery, each relocated store's overlay surface is opened by invoking its gallery `open()` — which calls the **store's** action (e.g. `EditUserDrawer.openEditUserDrawer(user)`) — and the drawer's content then renders. This is the runtime complement to `tsc`: it proves each `@/…/stores/<name>` specifier resolves to the STORE module at runtime (a component module exposes no such action, so the case would throw), and it exercises `appLayout`'s import-order-sensitive `appLayoutSeam.set(...)` side effect that a type check cannot see.

## Item → test coverage

| ITEM | covered by |
|---|---|
| ITEM-1 (move 24 dirs) | TEST-1, TEST-6, TEST-7 |
| ITEM-2 (99 import sites) | TEST-8, TEST-9 |
| ITEM-3 (3 non-TS refs) | TEST-8 |
| ITEM-4 (codegen stable) | TEST-5 |
| ITEM-5 (the guard) | TEST-1, TEST-2, TEST-4 |
| ITEM-6 (registration) | TEST-3 |
| ITEM-7 (guard test suite) | TEST-1, TEST-2, TEST-3, TEST-5, TEST-6, TEST-7 |
| ITEM-8 (gallery e2e spec) | TEST-9 |
| ITEM-9 (tsc oracle test) | TEST-8 |
| ITEM-10 (physical B6 check) | TEST-4 (machine half) + the recorded phase-8 run (physical half) |

## Invariant → acceptance-test binding

| INV | acceptance test | would go RED if… |
|---|---|---|
| INV-1 eliminate every collision | TEST-1 | any `Foo.tsx` still sits beside `foo/` in either tree |
| INV-2 survive `gen:store-actions` | TEST-5 | the generator rewrote or staled any `actions.gen.ts` after the move |
| INV-3 every import site updated, both workspaces | TEST-8 | any specifier in either workspace no longer resolves |
| INV-4 `git mv` so history follows | TEST-6 | the moves landed as add/delete instead of renames |
| INV-5 a wired check that FAILS on a collision | TEST-3 (+ TEST-2 proves it fails) | the guard is absent from either workspace's `check` chain |
| INV-6 guard reads a PERMANENT path, never `.lifecycle/` | TEST-4 | the guard depended on CWD or on a `.lifecycle/` artifact |
| INV-7 conform to the majority convention | TEST-7 | a store landed anywhere but under a `stores/` parent |

## Out of scope (design §4) — not tested here, by instruction

`use-mobile.ts`/`use-mobile.tsx`, `types/` vs `types.ts`, `constants/` vs
`constants.tsx` (not collisions — same-name or differing beyond case), and any
non-casing TypeScript error surviving in the macOS build log. Reported, not chased.
