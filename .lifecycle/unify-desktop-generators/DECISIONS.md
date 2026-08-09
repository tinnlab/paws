# DECISIONS — unify-desktop-generators

### DEC-1: How is desktop's `@ziee/kit` overlay-import source expressed — config key, or keep the fork?
**Resolution:** a config key. `src-app/desktop/ui/gallery.config.json` sets
`overlayKitImports: ["@/components/ui", "@/modules/layouts/app-layout/components/Drawer", "@ziee/kit"]`
— the package default plus `@ziee/kit`.
**Basis:** convention — this is the design's own stated rule (INV-2: "add a config
key instead"), and `overlayKitImports` already exists in `gallery-config.mjs`
DEFAULTS for exactly this purpose. Measured: this is the ONLY divergence that
changes desktop's output, and the fork's hardcoded set is precisely
`default ∪ {@ziee/kit}`.

### DEC-2: Should `@ziee/kit` be added to the package DEFAULT instead (fixing both workspaces)?
**Resolution:** NO — not in this change. Desktop gets the explicit key; the web
blind spot is RECORDED as a follow-up (ITEM-7) with its measured size.
**Basis:** codebase — measured that 58 `src-app/ui` surfaces import an overlay
primitive (`Dialog|Drawer|Sheet|Modal|Popover|AlertDialog|Confirm|Popconfirm`) from
`@ziee/kit` and are invisible to the ui overlay gate today (which reports 38 total
surfaces). Changing the default would surface ~58 new hosts, every one of which
must then be either wired open in a gallery entry or allow-listed with a reason, or
`src-app/ui`'s `npm run check` fails. That is a separate change with a large blast
radius and its own review; folding it in here would make this branch's "output is
byte-identical" claim untrue and unverifiable. Recording it (rather than silently
leaving it) is the same discipline the design used for these six files.

### DEC-3: Is `src-app/ui/scripts/lib/gallery-surfaces.mjs` in scope? It is not in the brief.
**Resolution:** YES — delete it too.
**Basis:** convention — it is byte-identical to the sdk copy, i.e. exactly the
`capture-gallery-screenshots.mjs` case the brief already calls "pure duplication —
delete, point at the sdk copy". Leaving it would make the re-fork test's
"no workspace forks the shared lib" assertion false on day one, so the invariant
and the code would disagree.

### DEC-4: Are the local `affordance-audit.mjs` / `gen-crop-review-manifests.mjs` forks in scope?
**Resolution:** NO. Only their `./lib/gallery-surfaces.mjs` import is repointed;
the scripts themselves stay forked.
**Basis:** user — the brief scopes this to six named files, and rule 2 says partial
unification with a clear reason beats a forced one. Measured: those two differ
between workspaces ONLY in where the dev-server port comes from (`src-app/ui`
hardcodes `'1420'`; desktop derives it via `resolveGalleryPort({which:'desktopGallery'})`).
That is a genuine config-shaped difference and a known live hazard (the hardcoded
`1420` is the documented `gate:ui` port-collision trap), but unifying them means
moving two more scripts into the sdk and adding a port anchor — a separate change.
Recorded, not forced.

### DEC-5: Where do the discovered-but-unfixed findings go?
**Resolution:** `CLAUDE.md`'s "Known follow-ups" list, replacing the now-done item 1.
**Basis:** codebase — the design says so verbatim: "Recorded HERE rather than in
`.lifecycle/` on purpose: lifecycle artifacts are stripped at merge, so a follow-up
written only there disappears the moment it lands."

### DEC-6: Does the new test belong in the sdk package or in the app tree?
**Resolution:** the app tree — extend `src-app/ui/scripts/check-harness-parity.consumer.test.mjs`.
**Basis:** codebase — that file's own header states the rule: paths like
`src-app/desktop/ui/...` are ZIEE's layout, and holding them inside `@ziee/gallery`
made the package's test red-by-construction in a standalone checkout. Same reason
applies to these six.

### DEC-7: Any operational tunable introduced (settings row vs constant)?
**Resolution:** none. This change introduces no limit, retention, quota, threshold,
toggle or model selection. The one new knob is a build-time config key
(`overlayKitImports`) already defined by the shared package.
**Basis:** convention — the configurable-settings rule applies to runtime
operational tunables; a generator's static input set is not one.

### DEC-8: Must the desktop generators' output be byte-identical, or is a fix allowed?
**Resolution:** byte-identical is the bar; any deviation must be an explicitly
named desktop bug fix. Measured outcome: all outputs ARE byte-identical, so nothing
is claimed as a fix. Two latent desktop bugs are CLOSED without changing today's
output (the `.test.tsx` leak into the state matrix; the `.desktop.tsx` leak into
coverage) and are named as such.
**Basis:** user — the brief's verification rule.
