# PLAN_AUDIT — plan vs codebase

## Breakage risk

- **ITEM-1 (`peek()`):** additive to the seam's return object; existing `get()`
  and `set()` are untouched, so no existing caller breaks. Type widens the
  factory return with one more method.
- **ITEM-2 (peek call-sites):** the four readers already had `?? {}` / default
  fallbacks OR are being given one; behavior is byte-identical when the store IS
  injected (peek returns the same proxy get() would have). The ONLY behavioral
  change is: when the store is genuinely absent, they now render with defaults
  (`nativeScroll: false`, not-collapsed inset, no-op `setHeaderHidden`) instead of
  throwing — which is the intended graceful-degradation. Risk: a header rendered
  store-less shows the non-native-scroll variant — acceptable (that context has no
  mobile native-scroll state to honor anyway).
- **ITEM-3 (sync seed):** the async `import().then()` fallback is retained for the
  (unexpected) accessor-not-yet-set path, and `injectExtensionStores` is
  idempotent (only adds a missing store), so the sync seed cannot double-create or
  clobber the store's own init-time seed. The primary store's state object is
  mutated directly (same as the prior async path + the init-time path) — no
  subscriber-notification semantics change. Risk: the accessor must be registered
  before any extension registers; the extension modules statically import the chat
  store, so the store module (which pushes the accessor) is evaluated first — and
  `setPrimaryChatStateAccessor` also back-seeds any already-registered extensions,
  covering out-of-order load.
- **ITEM-4 (desktop script):** a script-string change; matches the proven server
  `ui` script. No code path.
- **ITEM-5 (desktop loader exports):** purely ADDITIVE exports; the desktop eager
  loader's existing `loadModules`/blocklist behavior is untouched. The four new
  functions are no-ops/`false` — correct for an eager loader where nothing is lazy.

## Pattern conformance

- ITEM-1 conforms to the same-file `createAppStoreSeam`/`routesSeam` idiom.
- ITEM-2 conforms to `DivScrollY`'s documented store-less fallback shape.
- ITEM-3 conforms to the existing `injectExtensionStores` + init-time seed; the
  IoC accessor is the standard "SDK/registry reads an app store it cannot import"
  inversion used elsewhere (app-seam, pane runtime resolver).
- ITEM-4 conforms to `src-app/ui/package.json`'s `check:kit-manifest`.
- ITEM-5 conforms to `loader.ts`'s public surface.

## Migration collisions

None — no migration touched (`ls src-app/server/migrations` unchanged; no new file).

## OpenAPI regen

Not required — no Rust handler/type change; no `openapi.json` / `api-client/types.ts`
diff.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — additive seam method; mirrors the same-file idiom; no caller breaks.
- **ITEM-2** — verdict: PASS — graceful-degradation restores each reader's own documented store-less contract; identical when the store is present.
- **ITEM-3** — verdict: PASS — sync seed + retained async fallback + idempotent inject; the composer's existing `chatExtensionsReady` gate becomes sound.
- **ITEM-4** — verdict: PASS — mirrors the working server `ui` script; script-only.
- **ITEM-5** — verdict: PASS — additive no-op exports correct for the eager desktop loader; keeps parity with `loader.ts`'s import surface.
- **ITEM-6** — verdict: PASS — mirrors the server `ui` `check:design-spec` script (shared root spec + css); verified `--check` green against the desktop css AND the shared css.
- **ITEM-7** — verdict: PASS — additive `@ziee/kit` recognition in the desktop local gen; regen reproduces the base's 1-host `overlay-registry.generated.json` exactly (no net change to the committed generated file), so no hidden host is masked.
- **ITEM-8** — verdict: PASS — pure regeneration of a committed generated file to match current source (base drift + ITEM-3's own signals); `check:state-matrix` is the drift guard that re-verifies it.
- **ITEM-9** — verdict: PASS — pure regeneration of a stale committed manifest to match current source.
- **ITEM-10** — verdict: PASS — `@/`-alias re-export resolves to the SAME `loader.ts` in the web build (no web change) and to `loader.desktop.ts` in the desktop build (fixes the bundle leak); web + desktop `tsc` both green afterward.

## Migration collisions (addendum)

The regenerated `stateMatrix.generated.ts` (both workspaces), `STATE_MATRIX.md`,
`GALLERY_SEED_MANIFEST.md` are generated artifacts — the merge-gate's C3
regen-parity re-derives them against real main, so a positional-only diff is
expected and safe. The desktop `overlay-registry.generated.json` nets to no
change vs base after ITEM-7.
