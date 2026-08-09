# PLAN — unify-desktop-generators

## Design source

Realizes `CLAUDE.md` § "Known follow-ups (scoped, NOT done — pick these up next)"
**item 1** (`src-app/desktop/ui/scripts/` still forks six more generators),
against the pattern established in the immediately preceding section
§ "One harness, not several" (the already-merged unification of
`runtime-health.mjs` + `gate-ui.mjs`).

The design's stated shape: delete the fork, point the npm script at
`sdk/packages/gallery/scripts/<x>.mjs`, and let each workspace's
`gallery.config.json` supply the anchors.

## Invariants

Lifted verbatim from the design (`CLAUDE.md` § "One harness, not several" and
follow-up item 1):

- **INV-1**: "**both** ui workspaces run the SAME
  `sdk/packages/gallery/scripts/{runtime-health,gate-ui}.mjs`, each driven by its
  own `gallery.config.json`. Parity is therefore true **by construction** — there
  is no second implementation for a fix to miss."
- **INV-2**: "If you find yourself wanting to fork one of these scripts, add a
  config key instead; forking is what this removed."
- **INV-3**: "the check that now carries the invariant is a test asserting **no
  workspace re-forks the harness**" — and (standing repo rule, from the same
  section) a guard that "checked call sites by regex … could only ever prove
  **WIRING, never LOGIC**"; assert behaviour, never source text.
- **INV-4**: (follow-up item 1) desktop's stale `lib/gallery-surfaces.mjs` means
  "the workspace is internally inconsistent about what a surface is" — after this
  change every desktop script must enumerate the SAME surface universe.

## Measured baseline (before any change)

`diff` desktop fork vs `sdk/packages/gallery/scripts/`:

| file | diff lines | desktop LOC | sdk LOC |
|---|---|---|---|
| `gen-gallery-coverage.mjs` | 54 | 186 | 196 |
| `gen-overlay-registry.mjs` | 103 | 290 | 320 |
| `gen-state-matrix.mjs` | 62 | 563 | 579 |
| `lib/gallery-surfaces.mjs` | 33 | 85 | 94 |
| `capture-gallery-states.mjs` | 28 | 80 | 96 |
| `capture-gallery-screenshots.mjs` | **0** | 79 | 79 |

Desktop generators, before: all three `--check` **exit 0**
(coverage 12 surfaces; overlay 1 host / 0 wired / 1 allow-listed;
state-matrix 9 surfaces, 57 signals, 8 required-state keys).

Probe — sdk script run with `cwd=src-app/desktop/ui`, no changes:
`gen-gallery-coverage --check` **exit 0, identical line**;
`gen-state-matrix --check` **exit 0, identical line**;
`gen-overlay-registry --check` **exit 1** (1 host → 0). That single divergence is
the only one config must close.

## Per-file classification (what KIND each divergence is)

- **`gen-gallery-coverage.mjs`** — comment/doc-path text + `__dirname` anchor →
  `resolveGalleryConfig()`, plus ONE behavioural delta: sdk additionally skips
  `.desktop.tsx` co-located overrides. **Latent on desktop** (0 `*.desktop.tsx`
  under `src-app/desktop/ui/src`), so output is unchanged. → **unify, no config
  key needed** (desktop already sets `srcDir`/`surfaceRoots`/`galleryDir`).
- **`gen-overlay-registry.mjs`** — comment text + config anchor + THREE
  behavioural deltas: (a) the kit-import set is hardcoded in the fork (and
  includes `@ziee/kit`) vs config `overlayKitImports` in the sdk (which does NOT
  include `@ziee/kit`); (b) sdk's `wiredSurfaces()` also scans per-module
  `src/modules/*/gallery.tsx` and accepts double-quoted `surface:` (the fork reads
  only `overlays.tsx`); (c) sdk exports a pure `extractWiredSurfaces` and uses a
  portable main-module check. (a) is the **only ACTIVE** one and it is
  **expressible as config** → **unify + one config key** (`overlayKitImports`).
  (b) is latent on desktop (no `overlays.tsx`, no module `gallery.tsx` carrying a
  `surface:`) and is a strict improvement.
- **`gen-state-matrix.mjs`** — config anchor + ONE behavioural delta: sdk skips
  `.test|.stories|.desktop.tsx`; the fork skips only `gallery.tsx`. Desktop **does**
  have `src/modules/desktop-base/seam-parity.test.tsx` under a walked root — it is
  benign today only because that file declares no state signals. → **unify; this is
  a desktop BUG FIX**, output unchanged today.
- **`lib/gallery-surfaces.mjs`** — desktop copy is missing the `interactions`
  surface class. → **delete the fork, import the sdk module.**
- **`capture-gallery-states.mjs`** — same missing `interactions` handling. →
  **delete the fork, point the npm script at the sdk copy.**
- **`capture-gallery-screenshots.mjs`** — byte-identical. → **delete, point at sdk.**
- **`src-app/ui/scripts/lib/gallery-surfaces.mjs`** (NOT in the brief; found by
  measurement) — **byte-identical** to the sdk copy. Same duplication class. →
  **delete, import the sdk module.**

### What the `gallery-surfaces` inconsistency actually causes

Measured: desktop registers **0** interaction recipes today
(`grep -rn 'interactions:' src-app/desktop/ui/src` → 0), and
`src-app/desktop/ui/src/dev/gallery/module-seed.ts` is deliberately PAGE-FOCUSED —
it inherits the shared web cassette's pages but explicitly does NOT pull in the web
overlay/deep/seeded/interaction ENTRIES. So `window.__GALLERY_INTERACTIONS__` is
`[]` on desktop and the two copies agree **by accident of emptiness**, not by
design.

The inconsistency is therefore **latent but load-bearing, and it fails SILENTLY**.
`gate:ui` + `gallery:runtime` already run the sdk lib (they see `interactions`);
`gallery:screenshots`, `gallery:states`, `affordance-audit.mjs` and
`gen-crop-review-manifests.mjs` import the stale local lib (they cannot). The
moment one desktop-only module registers a `gallery.interactions` recipe, the two
halves disagree about the surface universe — and nothing errors: the stale
`captureCells()` simply emits fewer cells and the stale `surfaceCount()` returns a
smaller total. The interaction-gated state would be counted by the gate and never
screenshotted or reviewed, with no diagnostic. That is precisely the
"one harness, two implementations" defect class INV-1 exists to remove.

## Items

- **ITEM-1**: Delete `src-app/desktop/ui/scripts/gen-gallery-coverage.mjs`; point
  `gen:gallery-coverage` + `check:gallery-coverage` at the sdk script.
- **ITEM-2**: Delete `src-app/desktop/ui/scripts/gen-overlay-registry.mjs`; point
  `gen:overlay-registry` + `check:overlay-registry` at the sdk script; add
  `overlayKitImports` to `src-app/desktop/ui/gallery.config.json` so the
  `@ziee/kit` overlay host is still found (byte-identical registry output).
- **ITEM-3**: Delete `src-app/desktop/ui/scripts/gen-state-matrix.mjs`; point
  `gen:state-matrix` + `check:state-matrix` at the sdk script.
- **ITEM-4**: Delete `src-app/desktop/ui/scripts/lib/gallery-surfaces.mjs` and
  `src-app/ui/scripts/lib/gallery-surfaces.mjs`; repoint the four remaining local
  importers (`affordance-audit.mjs`, `gen-crop-review-manifests.mjs` in each
  workspace) at `@ziee/gallery/scripts/lib/gallery-surfaces.mjs`.
- **ITEM-5**: Delete `src-app/desktop/ui/scripts/capture-gallery-states.mjs` and
  `capture-gallery-screenshots.mjs`; point `gallery:states` + `gallery:screenshots`
  at the sdk scripts.
- **ITEM-6**: Extend the EXISTING re-fork test
  (`src-app/ui/scripts/check-harness-parity.consumer.test.mjs`, `TEST-6h`) to cover
  the generators + the shared lib, and add a BEHAVIOURAL proof that SPAWNS the real
  sdk generators under each workspace's cwd and reads their output (never a source
  scan). Wire it into both workspaces' `test:gallery-scripts` (already wired — the
  file is referenced by both).
- **ITEM-7**: Record the two defects this measurement surfaced but does NOT fix
  here (out of scope, each is a separate change with its own blast radius): the
  shared `overlayKitImports` DEFAULT omits `@ziee/kit`, leaving **58 web surfaces**
  invisible to `src-app/ui`'s overlay gate; and the `kitImport` config key is DEAD
  (declared in `gallery-config.mjs` DEFAULTS, set by desktop's config, read by
  nothing). Write them into `CLAUDE.md`'s follow-ups so they survive the merge
  strip.

## Files to touch

- `src-app/desktop/ui/package.json` (npm script targets)
- `src-app/desktop/ui/gallery.config.json` (`overlayKitImports`)
- delete: `src-app/desktop/ui/scripts/{gen-gallery-coverage,gen-overlay-registry,gen-state-matrix,capture-gallery-states,capture-gallery-screenshots}.mjs`
- delete: `src-app/desktop/ui/scripts/lib/gallery-surfaces.mjs`, `src-app/ui/scripts/lib/gallery-surfaces.mjs`
- `src-app/{ui,desktop/ui}/scripts/affordance-audit.mjs` (import repoint)
- `src-app/{ui,desktop/ui}/scripts/gen-crop-review-manifests.mjs` (import repoint)
- `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` (extend)
- `CLAUDE.md` (follow-up list: item 1 done; record the two new findings)
- sdk submodule: none expected (see DRIFT if that changes)

## Patterns to follow

- The closest existing module IS the precedent named in the design: the merged
  unification of `runtime-health.mjs`/`gate-ui.mjs` — deleted fork, npm script
  repointed at `../../../sdk/packages/gallery/scripts/<x>.mjs`, anchors supplied by
  `gallery.config.json`, and `gallery-harness-copies.json` + the consumer test
  carrying the "no second implementation" invariant.
- Config keys follow `sdk/packages/gallery/scripts/lib/gallery-config.mjs`
  `DEFAULTS` (which REFUSES an unknown key rather than defaulting it).
- The test follows `check-harness-parity.consumer.test.mjs`'s existing shape:
  positive control + mutation cases, behaviour over source text, `spawnSync` the
  real script and read stdout (see its `TEST-40`).

## Items — plan-audit verdicts (phase 2)

- **ITEM-1** — verdict: PASS — probed: sdk script at `cwd=desktop/ui` already
  prints the identical `12 surfaces; {...}` line and exits 0. Desktop's config
  already carries `srcDir`/`surfaceRoots`/`galleryDir`.
- **ITEM-2** — verdict: CONCERN — the ONLY active divergence. `resolveGalleryConfig`
  REFUSES unknown keys, and `overlayKitImports` IS a known key, so the fix is a
  legal config addition; verified the fork's hardcoded `isKit` set is exactly
  `{@ziee/kit, @ziee/kit/*, @/components/ui, @/components/ui/*,
  @/modules/layouts/app-layout/components/Drawer}` = the sdk DEFAULT ∪ `@ziee/kit`.
  Must re-run `--check` and confirm the registry is byte-identical.
- **ITEM-3** — verdict: PASS — probed: identical output line, exit 0. The extra
  `.test.tsx` skip is a strict improvement; `seam-parity.test.tsx` contributes no
  rows today (`grep -c seam-parity stateMatrix.generated.ts` → 0).
- **ITEM-4** — verdict: CONCERN — `@ziee/gallery/scripts/*` is an exported subpath
  and resolves from `src-app/desktop/ui` (verified via `require.resolve`), and
  `affordance-audit.mjs` in desktop ALREADY imports
  `@ziee/gallery/scripts/lib/run-key.mjs`, so the specifier form is proven in-tree.
  Risk: the two `affordance-audit`/`gen-crop-review` pairs are themselves forks of
  each other (they differ only in the dev-server PORT source — ui hardcodes `1420`,
  desktop derives it). Unifying THOSE is out of scope; this change only repoints
  their import.
- **ITEM-5** — verdict: PASS — `capture-gallery-screenshots.mjs` is byte-identical;
  `capture-gallery-states.mjs` differs only by the missing `interaction` branch.
  Neither runs in `npm run check` (they are manual capture passes), so the risk is
  bounded to the capture workflow.
- **ITEM-6** — verdict: PASS — `check-harness-parity.consumer.test.mjs` is already
  referenced by BOTH workspaces' `test:gallery-scripts`, which is already inside
  both `npm run check` chains. Extending it needs no new wiring. Measured spawn
  cost: coverage 42/80 ms, overlay 44/94 ms, state-matrix 575/2352 ms
  (desktop/ui) — ~3.2 s total, acceptable inside `check`.
- **ITEM-7** — verdict: PASS — documentation only; `CLAUDE.md` is the design's own
  stated home for follow-ups ("lifecycle artifacts are stripped at merge").

## Breakage risk

Both workspaces' `npm run check` chains include `check:gallery-coverage`,
`check:state-matrix`, `check:overlay-registry` and `test:gallery-scripts`; a wrong
repoint fails `check` loudly rather than silently. `gallery:states` /
`gallery:screenshots` are manual and not in `check` — they are covered by the
behavioural test's enumeration assertions instead. No product (`src/`) code is
touched, so no runtime app behaviour changes.

## Pattern conformance

Mirrors the merged `runtime-health`/`gate-ui` unification exactly (delete fork →
repoint npm script → config anchors → invariant carried by a behavioural test).

## Migration collisions

None — no `.sql` file is touched.

## OpenAPI regen

Not implied — no Rust handler or `JsonSchema` type is touched, so neither
`openapi.json` nor `api-client/types.ts` changes in either workspace.
