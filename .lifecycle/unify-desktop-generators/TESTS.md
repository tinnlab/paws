# TESTS — unify-desktop-generators

All tests live in the EXISTING re-fork test file
`src-app/ui/scripts/check-harness-parity.consumer.test.mjs`, which is already
referenced by BOTH workspaces' `test:gallery-scripts` (itself already inside both
`npm run check` chains). No new mechanism, no new wiring.

Every assertion is BEHAVIOURAL — it either spawns the real script and reads its
exit code + stdout, or asserts a fork file does not exist on disk. There is no
source-text predicate.

- **TEST-1** (tier: unit) [covers: ITEM-1, ITEM-2, ITEM-3] file: `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` — asserts: for each of the three generators × BOTH workspace cwds, spawning the real `sdk/packages/gallery/scripts/<x>.mjs --check` exits 0 and prints its up-to-date banner — i.e. the ONE shared implementation serves both consumers from their own `gallery.config.json`.
- **TEST-2** (tier: unit) [covers: ITEM-2] file: `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` — asserts: the desktop overlay registry is NOT vacuous — the real `gen-overlay-registry.mjs` run under `cwd=src-app/desktop/ui` reports the `@ziee/kit`-imported Popover host, and the same run with `overlayKitImports` stripped to the package default reports 0 hosts (the negative control that makes the positive mean something).
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2, ITEM-3, ITEM-4, ITEM-5] file: `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` — asserts: NO second enumeration/generator exists anywhere — discovered BY CONTENT (any file defining/exporting the enumeration API, or naming+writing a generated artifact, must live under `sdk/packages/gallery/scripts/` or be an explicitly reasoned, re-verified exemption) — AND, as a fast precise second leg, each of the six named fork paths is absent and every npm script driving one resolves under `sdk/packages/gallery/scripts/`. Extends the existing `TEST-6h`; the content half is what a hand path-list cannot do.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-4] file: `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` — asserts: the surface enumeration EVERY workspace script now resolves to reports the `interaction` class — driven through the real `enumerateSurfaces`/`captureCells`/`cellUrl`/`surfaceCount` against a stub page exposing one interaction recipe, so a stale copy (which silently emits fewer cells) goes RED. (Module RESOLUTION from each workspace is TEST-7's job, not this one's.)
- **TEST-5** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-2] file: `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` — asserts: the desktop divergence is carried by CONFIG, not code — `resolveGalleryConfig('src-app/desktop/ui')` yields an `overlayKitImports` that is a strict superset of the package default, and the package default is what `src-app/ui` still resolves (a config key, not a fork).
- **TEST-6** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-6] file: `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` — asserts: the re-fork proof is behavioural AND content-discovered — planting a DRIFTED enumeration copy in the real tree, under a name and in a directory no list names (`scripts/local/surface-enum-helper.mjs`), makes discovery report exactly that file; the fixture is removed and its absence re-asserted. Mutation control, not a positive-only guard. (That the generator proof spawns a real process is TEST-1's assertion.)
- **TEST-7** (tier: unit) [covers: ITEM-4] file: `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` — asserts: every local script that consumes the shared surface lib resolves the sdk module — `import(<script>)` is not attempted (they run browsers); instead each importer's resolved specifier is loaded through node's real resolver from that script's directory and must resolve to `sdk/packages/gallery/scripts/lib/gallery-surfaces.mjs`.
- **TEST-8** (tier: unit) [covers: ITEM-7] file: `src-app/ui/scripts/check-harness-parity.consumer.test.mjs` — asserts: the recorded follow-ups are real, not prose — the `kitImport` config key is still read by nothing (resolved config exposes it; no shipped script consumes it) and the package-default `overlayKitImports` still omits `@ziee/kit`, so the CLAUDE.md entry cannot silently rot into a false claim.

- **TEST-9** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-4, ITEM-5] file: `src-app/desktop/ui/tests/e2e/gallery-desktop-surfaces.spec.ts` — asserts: against the REAL running desktop gallery, the surface enumeration the desktop workspace now resolves reports the `interaction` class — `enumerateSurfaces` returns an `interactions` array (a stale copy returns no such key) and, with one recipe injected into the live page as a positive control, `captureCells` emits a matching `interaction` cell whose `cellUrl` carries `&interact=`; the same page's page/overlay/deep/seeded classes are unchanged (negative control against over-reach). Runs under the existing `playwright.gallery.config.ts` webServer.

## Tier note

The only `tier: e2e` test is TEST-9, and it is a genuine one: it boots the real
desktop gallery and drives the real shared module in a browser. There is no other
user-visible flow to cover — this branch touches `src-app/ui/**` and
`src-app/desktop/ui/**` ONLY under `scripts/`, `package.json` and
`gallery.config.json`; no `src/` product code, component, route or rendered
surface changes. The phase-8 `gate:ui` boot/runtime canary is additional evidence,
not the e2e itself.

## ITEM → TEST coverage

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-3 |
| ITEM-2 | TEST-1, TEST-2, TEST-3, TEST-5 |
| ITEM-3 | TEST-1, TEST-3 |
| ITEM-4 | TEST-3, TEST-4, TEST-7, TEST-9 |
| ITEM-5 | TEST-3, TEST-9 |
| ITEM-6 | TEST-6 |
| ITEM-7 | TEST-8 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-3 |
| INV-2 | TEST-5 |
| INV-3 | TEST-6 |
| INV-4 | TEST-4, TEST-9 |
