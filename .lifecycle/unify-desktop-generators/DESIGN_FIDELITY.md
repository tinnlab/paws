# DESIGN_FIDELITY — unify-desktop-generators

- **INV-1** — fidelity: UPHELD — ITEM-1/2/3/5 delete every desktop fork and point
  each npm script at `sdk/packages/gallery/scripts/<x>.mjs`; ITEM-4 deletes BOTH
  local copies of the shared lib (desktop's stale one AND `src-app/ui`'s
  byte-identical one) so the sdk module is the single implementation. After the
  change there is no second implementation of any of the six for a fix to miss.
- **INV-2** — fidelity: UPHELD — the one active behavioural divergence
  (`gen-overlay-registry`'s `@ziee/kit` import source) is closed with the EXISTING
  `overlayKitImports` config key, not a fork and not a new mechanism. Every other
  divergence is a comment, an anchor, or a latent sdk improvement, so nothing else
  needs expressing at all.
- **INV-3** — fidelity: UPHELD — ITEM-6 extends the existing re-fork test rather
  than adding a mechanism, and its new proof SPAWNS the real sdk generators under
  each workspace's cwd and asserts on their exit code + printed output. No new
  source-text predicate is introduced. The pre-existing file-absence assertions
  (`realRead(fork) === null`) are extended in kind — those assert a file does not
  EXIST, which has no evasion space, unlike a content regex.
- **INV-4** — fidelity: UPHELD — with both local `gallery-surfaces.mjs` copies gone,
  every desktop script (`gate:ui`, `gallery:runtime`, `gallery:states`,
  `gallery:screenshots`, `affordance-audit`, `gen-crop-review-manifests`)
  enumerates surfaces through the same module, so the workspace can no longer
  disagree with itself about what a surface is. TEST-4 proves this by driving the
  real enumeration against a fixture carrying an interaction recipe.
