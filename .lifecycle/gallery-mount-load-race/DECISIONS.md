# DECISIONS

### DEC-1: Fix by raising `testTimeout`, or by moving the cost out of the test body?
**Resolution:** Move the one-time module-graph import into `beforeAll` with its
own explicit 120s budget. Do NOT raise `testTimeout` (globally or per-test).
**Basis:** convention — the per-test 5000ms is the only thing that would catch a
genuine hang in this harness, and this spec exists precisely to catch a render
pathology. Raising it would blind all three tests to real slowness in order to
excuse a cost that is not under test. Measured: the whole component suite's next
slowest test is 2007ms, so the default budget is correct for every other spec and
a global raise would be a repo-wide regression in signal.

### DEC-2: Ship a fix for FB-11 (`cfg.loadModules()` un-awaited) as well?
**Resolution:** No. Record the finding; change nothing in `mount.tsx`.
**Basis:** codebase — the harness mounts `<FileRagAdminPage />` directly and
never calls `mountGallery`, so FB-11 is not on the failing code path at all
(ITEM-2 verdict). It was additionally probed through the path where it IS live
(20 scoped gallery crawls, TEST-2): 0 gating HIGH, 0 hook errors. Shipping an
unreproduced change to the gallery boot sequence would trade a measured defect
for an unmeasured one. Recorded for the next owner instead: `loadModules` is in
fact `async … : Promise<void>` (`src-app/ui/src/modules/loader.ts:130`) while
`GalleryConfig.loadModules` is typed `() => void`
(`sdk/packages/gallery/src/runtime/config.ts:62`) — the TYPE is what hides the
race, so awaiting is mechanically possible and the type is the thing to fix
first, together with a decision about the blank first frame it would introduce.

### DEC-3: Move the `sdk` submodule pointer?
**Resolution:** No. `sdk` stays at `0ba62538`; there is no sdk commit.
**Basis:** codebase — the confirmed mechanism is entirely inside the app-side
spec file. The sdk was instrumented during investigation (TEST-3) and that probe
was reverted; `git status` in `sdk/` is clean.

### DEC-4: Is the warm-up import safe before the per-test `setAuthView`?
**Resolution:** Yes — warm only the two module imports; leave `setupHarness`'s
sequence (fresh Auth store -> `setAuthView` -> imports) byte-for-byte intact.
**Basis:** codebase — tests 2 and 3 ALREADY resolve these modules from cache,
i.e. already run with the graph evaluated before their own `setAuthView` call.
Warming puts test 1 in the state its siblings are always in. `authStoreProxy()`
throws only when called, and it is called at render, never at module scope
(`sdk/packages/framework/src/permissions/authView.ts:31-36`). Confirmed by
running: 110/110 green post-fix.

### DEC-5: Any operational tunable introduced?
**Resolution:** One — the warm-up hook's 120s budget. Fixed constant, inline.
**Basis:** convention — it is a test-harness build-cache allowance, not a server
tunable; there is no settings surface for test timeouts and inventing one would
be inconsistent with every other spec in the workspace.
