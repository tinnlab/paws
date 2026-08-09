# TEST_RESULTS — unify-desktop-generators

Measured at `6ef7fe70c` unless noted. Full logs under
`/data/pbya/ziee/tmp/lifecycle-logs/unify-gen-*.log`.

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

TEST-1..8 run under `node --test scripts/check-harness-parity.consumer.test.mjs`,
which BOTH workspaces invoke from `test:gallery-scripts` inside `npm run check`:
**22 tests, 22 pass, 0 fail** (the file's 11 pre-existing tests plus this
feature's 11 test bodies across TEST-IDs 1–8).

TEST-9 is the Playwright e2e:
`✓ 1 [chromium] › gallery-desktop-surfaces.spec.ts › desktop enumerates surfaces
through the shared module, interactions included (6.0s) — 1 passed`, exit 0.

## Frontend gate

- `npm run check (ui): PASS` — exit 0, 161 tests / 161 pass
- `npm run check (desktop/ui): PASS` — exit 0, 114 tests / 114 pass

Both captured with `set -o pipefail`, so the recorded status is the command's own
exit code, not `tee`'s.

## Boot/runtime canary (A7)

- `gate:ui (desktop/ui): PASS` — exit code **0**, captured directly (`$?`, not
  through a pipe). tsc / lint / runtime-health / visual / coverage all PASS;
  runtime-health `51 surfaces clean`, **0 surfaces with gating HIGH findings**,
  validity `318/318 cells · origin alive (60 checks) · transport artifacts 0 (0%)`.
- `gate:ui (ui): branch 7 vs base 7` — baseline-controlled, see below.

### Why the web canary is recorded comparatively

The web workspace's gate reports **runtime-health PASS** (`145/145` per-surface
verdict, 0 gating HIGH) but its **visual** step reports 7 spec failures:
`overlays.spec.ts` (light + dark) and `chat-collapse-borders.spec.ts` TEST-2 /
TEST-3 (light + dark) / TEST-8 (light + dark).

These are **pre-existing and not attributable to this branch**, proven rather
than asserted:

- This diff touches **no** file under `src-app/ui/src/**` — no component, no
  style, no route. Nothing it changes is in the gallery's module graph.
- The identical spec set was run on the **base commit** `dca29493f` in a separate
  worktree (`/data/pbya/ziee/wt-baseline-main`), on the **same box**,
  back-to-back with the branch run, on a bind-verified free port:

  | run | result |
  |---|---|
  | branch `6ef7fe70c` | 7 failed, 2 passed (2.6m) |
  | base `dca29493f` | 7 failed, 2 passed (2.6m) — **the same 7** |

  Log: `unify-gen-visual-BASE.log` vs `unify-gen-visual-rerun.log`.

So `branch 7 vs base 7` — no regression. The failure modes themselves
(`Test timeout of 60000ms exceeded`; `expect(cards).toBeGreaterThanOrEqual(3)`
received `0`) are the didn't-finish-mounting shape, consistent with CLAUDE.md
follow-up 2 (`mountGallery` does not await `cfg.loadModules()`), which that entry
already names as the leading candidate for residual gallery nondeterminism.

## Deterministic phase-8 checks

- **A2** clean working tree — `git status --short` and `git -C sdk status --short`
  both empty at the recorded commit.
- **A3** no diff-added `#[ignore]` / `.skip` / `.only`.
- **A4** no cosmetic assertion; every new test was proven non-vacuous by mutation
  (below).
- **A5** no TEST-ID removed — TESTS.md grew from 8 to 9 IDs.
- **Acceptance** — every `[acceptance]` test recorded PASS: TEST-3 (INV-1),
  TEST-5 (INV-2), TEST-6 (INV-3), TEST-4 + TEST-9 (INV-4).
- **A8** n/a — no built-in MCP server added.
- **A9 / A10** n/a — no permission introduced (no `modules/*/permissions.rs`
  change, no grant migration). Confirmed against the diff.
- **R2-5** n/a — the diff adds no `/api/` e2e route mock.

## Mutation evidence (why these results mean something)

Every new test was shown to go RED under a mutation that should break it:

| mutation | expected RED | observed |
|---|---|---|
| restore the stale desktop `lib/gallery-surfaces.mjs` fork | TEST-3, TEST-6 | 2 failed |
| drop `overlayKitImports` from desktop's config | TEST-1, TEST-2, TEST-5 (+ desktop's own `check:overlay-registry`, exit 1) | 3 failed |
| swap the shared lib for the stale copy | TEST-4 | 1 failed |
| same, against the real gallery | TEST-9 | 1 failed (`enumeration must carry an interactions array`) |
| repoint one consumer at a relative local path | TEST-7 | 1 failed |
| plant a drifted copy at `scripts/local/gallery-surfaces.mjs` (the round-1 audit's own fixture) | TEST-3, TEST-6 | 2 failed |

Plus the round-2 evasion battery — 10 forms that defeated the round-1 guard
(`var`, `export { x as f }`, class method, default-export object, `.ts` with a
type annotation, `.tsx`, `.jsx`, inside `.lifecycle/`, inside `dist/`, a legacy
sibling inside the shared package) — each planted, run, and observed **CAUGHT**
(3 red), then removed with the tree verified clean.

Data-loss regression check: a pre-existing `src-app/ui/scripts/local/my-real-helper.mjs`
**survives** a full run (22/22 pass), and no `.fork-probe-*` directory is left behind.

## Byte-identical output (the branch's core claim)

All **12** generated artifacts across both workspaces are byte-identical to the
pre-change snapshot, re-verified after every round:
`galleryCoverage.generated.ts`, `overlay-registry.generated.json`,
`stateMatrix.generated.ts`, `STATE_MATRIX.md`, `stateCoverage.ts`, `coverage.ts`
× {`src-app/ui`, `src-app/desktop/ui`}.
