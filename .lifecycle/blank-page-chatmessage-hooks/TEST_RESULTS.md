# TEST_RESULTS — blank-page-chatmessage-hooks

All results below were OBSERVED, with the command's own exit code captured
(`set -o pipefail`, never a piped `tail` status). Full logs under
`/data/pbya/ziee/tmp/blankrepro/`.

## Enumerated tests

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-7**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS

### TEST-1 / TEST-2 — `ChatMessage.hooks.test.tsx` (4 assertions)

```
$ npx vitest run src/modules/chat/components/ChatMessage.hooks.test.tsx
 Test Files  1 passed (1)
      Tests  4 passed (4)
EXIT=0
```

**Observed RED first** (the whole point). Before the fix, all four failed with the
production error verbatim:

```
AssertionError: expected [Function] to not throw an error but
  'Error: Rendered fewer hooks than expe…' was thrown
"Error: Rendered fewer hooks than expected. This may be caused by an accidental
 early return statement."
…
AssertionError: expected "subscribeToExtensions" to be called at least once
 Test Files  1 failed (1)
      Tests  4 failed (4)
```

### TEST-3 / TEST-4 — `AppShellErrorContainment.test.tsx` (4 assertions)

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
EXIT=0
```

**Negative control run twice.** Restoring `fallback={() => null}`: **4/4 FAIL**.
Removing ONLY `resetKeys={[historyEpoch]}` (keeping the fallback): TEST-4b and
TEST-4c FAIL (`2 failed | 2 passed`) — this second control was added after the
blind audit proved the original TEST-4c passed in that state.

### TEST-5 — e2e `tests/e2e/00-shell/error-containment.spec.ts`

Real server (freshly built `target/debug/ziee`), real Postgres container, real
browser, real production bundle:

```
$ npx playwright test tests/e2e/00-shell/error-containment.spec.ts --workers=1
  ✓ 1 [chromium] › … client-side navigation never crashes a render nor blanks the document (24.3s)
  1 passed (54.6s)
E2E_EXIT=0
```

**MEASURED LIMIT — recorded, not glossed.** With the `ChatMessage` fix reverted
this spec STILL PASSES (full run, `E2E_NEGCTL_EXIT=0`): a fresh test DB has no
answerless assistant turn, so the crashing state never renders. It is therefore a
general guard against any render crash reaching the shell, NOT the regression test
for this defect — TEST-1 is, and it was verified RED 4/4.

### TEST-6 — `scripts/lint-hooks-top-level.test.mjs` (6 assertions)

```
✔ the rule is set to error in BOTH workspaces (desktop has its own standalone config)
✔ the rule is CHAINED into `npm run check` in both workspaces (configured != executed)
✔ both workspaces are CLEAN under the rule
✔ KNOWN-POSITIVE: the rule still FIRES on a hook after an early return
✔ KNOWN-POSITIVE: lint-hooks resolves an ALIAS-exported store proxy
✔ the two lint-hooks copies stay byte-identical
ℹ tests 6   ℹ pass 6   ℹ fail 0
EXIT=0
```

Both known-positive controls independently verified:
- Rule-rename harness — old loose assertions `pass=true` (vacuous), tightened
  assertions `pass=false`. The tightened form is what ships.
- Reverting `lint-hooks.mjs` in both workspaces turns the alias control RED
  (`5 pass / 1 fail`), confirmed by the blind auditor.

### TEST-7 — `SearchKnowledgeToolResultCard.hooks.test.tsx` (2 assertions)

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Scoped honestly to behaviour-preservation. Measured: it PASSES against the pre-fix
file, because the component's other hook is a `useContext` (no hook-list slot),
making the transition 1 slot → 0 — a direction React cannot detect. Stated in the
spec header and TESTS.md rather than claimed as a regression test.

### TEST-8 / TEST-9 — the two SILENT-LEAK sweep sites

```
$ npx vitest run src/modules/file/chat-extension/
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

**Negative control re-run independently** (not taken from the sub-agent's report):
reverting BOTH source files to `origin/main` turns 4 of the 8 RED, with the
leaked-subscription counts visible —

```
AssertionError: expected 12 to be 2      (ImageContent, renderAsUser flip)
AssertionError: expected 22 to be 10     (ImageContent, source-type guards)
AssertionError: expected 5 to be +0      (MessageFilesView, links stream in)
AssertionError: expected 11 to be 5      (MessageFilesView, null/uri-less)
 Test Files  2 failed (2)
      Tests  4 failed | 4 passed (8)
```

The other 4 assertions (rendering parity + `not.toThrow`) pass in both states and
are documented as such in the specs rather than counted as regression coverage.

**These two sites are NOT a second crash source** — corrected by measurement, not
assumed. The React detection matrix was measured in this exact environment
(React 19, `createRoot` + `act`, jsdom): `0→1, 1→0, 0→2, 2→0` are all silent,
while `1→2, 2→1, 1→3, 3→1` throw. `renderWithHooks` picks the MOUNT dispatcher
whenever the previous render left `memoizedState === null`, so a zero-slot render
is compared against nothing. Their real defect is silent: the fall-through
render's effects are never torn down, so `FileStore.__refCount` ratchets
(`ImageContent` pre-fix `0, 2, 4, 4, 6` vs post-fix `0, 2, 2, 2, 2`) and React
logs `Internal React error: Expected static flag was missing` on each flip.
`ChatMessage` (7 → 6) remains the only detectable site and the only white screen.

## Frontend gate lines

```
npm run check (ui): PASS
npm run check (desktop/ui): PASS
```

Both captured with `set -o pipefail`: `CHECK_UI_EXIT=0`, `CHECK_DESKTOP_EXIT=0`.
The ui chain now includes the two new steps, `lint:hooks-top-level` and
`test:hook-gates`.

## A7 — boot/runtime canary

```
gate:ui (ui): PASS
gate:ui (desktop/ui): PASS
```

```
$ GALLERY_PORT=5311 npm run gate:ui -- --skip-visual
=== runtime-health: 511 findings (HIGH 0 gating + 2 harness-noise + 2 baselined / MEDIUM 160 / LOW 347) ===
  validity: 682/682 cells · origin alive (99 checks) · transport artifacts 0 (0% of findings)
  0 surface(s) with gating HIGH findings
--- per-surface runtime verdict: 199/199 PASS ---
✅ GATE PASSED — every UI DONE criterion met
GATE_UI_EXIT=0
```

Desktop workspace (its `biome.json`, `package.json` and `lint-hooks.mjs` copy are
in the diff, so it needs its own canary):

```
$ GALLERY_PORT=5333 npm run gate:ui -- --skip-visual      # in src-app/desktop/ui
   validity: 318/318 cells · origin alive · transport artifacts 0 (0% of findings)
--- per-surface runtime verdict: 51/51 PASS ---
✅ GATE PASSED — every UI DONE criterion met
GATE_UI_DESKTOP_EXIT=0
```

Zero gating HIGH findings in BOTH workspaces, so this is the absolute form of A7
and cannot be worse than any base. Both exit codes captured directly with
`set -o pipefail`, never inferred from piped output — a recorded PASS next to a
failing gate is exactly the pipeline artifact A7 refuses.

## Full component suite (regression check on the whole workspace)

```
$ npx vitest run .test.tsx
 Test Files  12 passed (12)
      Tests  128 passed (128)
EXIT=0
```

## Live reproduction — before and after

The literal reported symptom, against a running instance (production build,
sidebar recent-chat clicks at a 250 ms cadence):

```
BEFORE  round 1 … "Create New Workflow Run" -> /chat/30bb982a… len=0  *** BLANK ***
          [console.error] Error: Minified React error #300
          [console.error] [AppErrorBoundary [router]] Error: Minified React error #300
AFTER   rounds 0-19 … len=5955 / 3147 / 5936 / …   (20/20, zero blanks)
```

## Not run

- **Backend integration tests** — the diff touches no Rust (verified: no
  `src-app/server/**` or `src-app/desktop/tauri/**` changes), so no backend tier
  applies.
- **Visual regression (Layer B)** — `gate:ui` was run with `--skip-visual`. No
  component's rendered output changed by design (the blind audit verified all 11
  splits/hoists render byte-identically), and the one NEW surface,
  `ModuleErrorFallback`, renders only when a module crashes and has no gallery
  entry. Stated rather than claimed as passing.
