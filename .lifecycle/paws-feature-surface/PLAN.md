# PLAN — paws-feature-surface

## Design source

Realizes `docs/design/paws-feature-surface.md` in full — §"The two levers",
§"Mechanism", §"The items" (all 13 rows), §"Invariants" (INV-1…INV-6),
§"Decisions for the implementer to make and record" (4 decisions), and
§"Test strategy". The design is merged on `main` (commit `926fd5c62`).
Task brief: `/data/khoi/home-workspace/paws-worker-tasks/paws-feature-surface.md`.

## Invariants

Lifted VERBATIM from `docs/design/paws-feature-surface.md` §Invariants.

- **INV-1**: A hidden feature's UI is **absent** — no nav entry, no route, no slot contribution, no composer affordance. Not merely visually suppressed.
- **INV-2**: Hiding a module **must not break** the modules that remain. Chat, onboarding, settings and projects keep working with every listed module absent.
- **INV-3**: A disabled capability is **genuinely off server-side** — its MCP server is not registered and the model cannot call its tools.
- **INV-4**: Hiding is achieved through the **existing `shouldLoad` manifest predicate**, uniformly. No per-module bespoke gating, no deleted slot registrations, no commented-out routes.
- **INV-5**: The reduction is **reversible by configuration or a single predicate**, not by deleting code — paws may want a feature back.
- **INV-6**: Nothing in this change weakens an existing permission or auth check.

## Items

- **ITEM-1**: Add ONE shared source of truth for the reduction —
  `src-app/ui/src/modules/pawsHiddenModules.ts` — exporting the hidden set by
  BOTH keys the codebase uses: `metadata.name` (for the loader/blocklist) and
  source DIRECTORY name (for the two auto-discovery globs, which see paths, not
  module names). Names and dirs diverge (`file-rag/` → `file_rag`,
  `assistant/` → `assistants`), so the two projections are explicit and pinned
  by a test rather than assumed equal. This is the INV-5 revert point.
- **ITEM-2**: Set `shouldLoad: () => false` on each hidden module's
  `createModule({...})` — the 8 top-level modules plus the 5 `hub/modules/*`
  sub-modules. Per-module literals are FORCED, not chosen: the manifest plugin
  lifts the predicate verbatim and rejects any free identifier besides `ctx` /
  `Permissions`, so a shared constant cannot be referenced from inside it
  (`src-app/ui/plugins/vite-plugin-module-manifest.js:81-101`). ITEM-13's test
  is what binds these literals back to ITEM-1's list.
- **ITEM-3**: Extend `CORE_MODULE_BLOCKLIST`
  (`src-app/ui/src/modules/loader.desktop.ts:33-44`) with the same set, read
  from ITEM-1. **This is the load-bearing lever for the desktop target** — the
  desktop loader eager-globs every core `module.tsx` and never evaluates
  `shouldLoad` at all (`loader.desktop.ts:140-201`).
- **ITEM-4**: Filter the chat-extension auto-discovery glob
  (`src-app/ui/src/modules/chat/extensions/index.ts:58-63`) against ITEM-1's
  dir set, and exclude the two chat-owned affordances for hidden features
  (`chat/extensions/schedule/`, `chat/extensions/voice/`). Without this the
  hidden modules keep contributing composer pills, toolbar status rows, panel
  renderers and rail steps — the glob belongs to the *chat* module and is not
  gated by any module predicate. This is the substance of INV-1's "no composer
  affordance".
  Filter on the **directory segment of the glob path**, not the extension's
  `name`: the names do not track the dirs (`workflow/` registers as
  `workflow-workspace`), so a name-keyed filter would silently miss a module the
  day someone renames an extension. The glob here is LAZY, so a path filter also
  means the chunk is never downloaded.
- **ITEM-5**: Drop hidden modules' project-extension contributions in
  `ProjectExtensionRegistry.register()`
  (`src-app/ui/src/modules/projects/core/extensions/registry.tsx:42-50`),
  keyed on `registration.name` against ITEM-1's set. This is what actually
  removes the citations **"References"** `knowledge_kinds` entry (design item
  13) and knowledge-base's "Knowledge bases" — that registration lives in a glob
  owned by the *projects* module, so hiding the citations module does not remove
  it.
  **Amended during the phase-2 audit** (the plan said "filter the glob"): that
  glob is `{ eager: true }` (`projects/extensions/index.ts:25-28`) and each
  extension registers as a top-level import SIDE EFFECT, so by the time any
  filter could inspect the returned keys, `register()` has already run. A
  post-hoc path filter would have been a silent no-op. Filtering inside
  `register()` is correct regardless of glob eagerness, and it is one central
  predicate rather than per-module gating. Verified the two names coincide with
  their directory names (`citations`, `knowledge-base`), so ITEM-1's single set
  serves both this and ITEM-4.
  Honest limit: because the glob stays eager, the hidden extension's code is
  still bundled and imported — its contribution is simply never registered, so
  no UI is produced. INV-1 is about the UI being absent, and it is. ITEM-4's
  chat glob is lazy, so there the chunk genuinely never loads.
- **ITEM-6**: Make a paws-hidden module's route a genuine 404 rather than the
  in-place 403 `<ForbiddenResult />`: `isPathModuleForbidden`
  (`src-app/ui/src/modules/loader.ts:185-189`) must treat a hidden module as
  "no owner". One central change in the loader; the desktop loader already
  returns `false` there, so desktop is already correct.
- **ITEM-7**: Flip the four deploy kill switches OFF by default in
  `src-app/server/src/core/config.rs` — `default_web_search_enabled`,
  `default_lit_search_enabled`, `default_voice_enabled`,
  `default_js_tool_enabled` → `false`, with doc comments updated. Update the
  existing assertions that encode the old default (`config.rs` `mod
  voice_config_tests`, `src/modules/js_tool/mod.rs`). `bio_mcp` is deliberately
  NOT touched — it is not one of the 13 items.
- **ITEM-8**: Close the INV-3 hole in `web_search`: its chat-extension factory
  discards the config (`web_search/chat_extension/extension.rs:22-24`) and
  `should_attach` consults only DB rows, so with the switch off a surviving
  `mcp_servers` row still auto-attaches and the model can still call the tools.
  Mirror `lit_search/chat_extension/extension.rs:21-34`.
- **ITEM-9**: Stop the desktop backend force-enabling web search over the
  operator's config —
  `src-app/desktop/tauri/src/modules/backend/mod.rs:188-189` writes
  `web_search.enabled = true` unconditionally. Leave `bio_mcp`'s override alone.
- **ITEM-10**: New server migration `202607210200` under
  `src-app/server/src/modules/file_rag/migrations/`: set
  `file_rag_admin_settings.semantic_enabled = false` on the singleton row and
  flip the column default (design item 3). It also carries the DEC-4 revoke of
  the user-facing grants for hidden-but-server-alive features, so their APIs are
  not merely undiscoverable.
- **ITEM-11**: Remove the assistant **templates** admin surface only (design
  item 12): the `/settings/assistant-templates` route and the
  `settingsAdminPages` entry in `src-app/ui/src/modules/assistant/module.tsx`,
  its page and its store. The `assistant` module itself is NOT hidden, and
  `is_template` / the seeded template row / clone-on-signup all STAY — removing
  them would leave every new user with zero assistants.
- **ITEM-12**: Delete the e2e suites that cover the now-hidden features, so the
  suite stays runnable and honest. Every deleted path is listed in the PR body.
- **ITEM-13**: Prove and repair the survivors. Two files outside the hidden set
  statically import into it —
  `chat/extensions/schedule/components/ScheduleLoopDialog.tsx:26-29`
  (→ scheduler components + store) and
  `llm-provider/components/widgets/DownloadIndicatorWidget.tsx:5,12` (→ hub
  store + hook). Establish by RUNNING what each does with its target hidden, and
  repair whatever is broken. Includes the unit test binding ITEM-2's literals and
  ITEM-3's blocklist and the two glob filters back to ITEM-1's single list.

## Files to touch

**New**
- `src-app/ui/src/modules/pawsHiddenModules.ts`
- `src-app/ui/src/modules/pawsHiddenModules.test.ts`
- `src-app/server/src/modules/file_rag/migrations/202607210200_paws_feature_surface.sql`
- e2e specs for the absence sweep + the INV-2 survivor journey (paths fixed in TESTS.md)

**Edited — UI (shared by both workspaces; desktop reuses this tree)**
- `src-app/ui/src/modules/{workflow,scheduler,citations,knowledge-base,file-rag,hub,voice,js-tool}/module.tsx`
- `src-app/ui/src/modules/hub/modules/{installed,assistants,skill,workflow,llm-models,mcp}/module.tsx`
- `src-app/ui/src/modules/loader.desktop.ts` (CORE_MODULE_BLOCKLIST)
- `src-app/ui/src/modules/loader.ts` (`isPathModuleForbidden`)
- `src-app/ui/src/modules/chat/extensions/index.ts`
- `src-app/ui/src/modules/projects/extensions/index.ts`
- `src-app/ui/src/modules/assistant/module.tsx` (+ remove its templates page/store)

**Edited — server**
- `src-app/server/src/core/config.rs`
- `src-app/server/src/modules/js_tool/mod.rs` (default-encoding test)
- `src-app/server/src/modules/web_search/chat_extension/{extension.rs,web_search.rs}`
- `src-app/desktop/tauri/src/modules/backend/mod.rs`

**Deleted**
- `src-app/ui/tests/e2e/{citations,hub,workflows,14-scheduler,14-knowledge-base,file-rag,14-voice}/` and the assistant-template specs (exact list in TESTS.md / the PR body)

**Regenerated (not hand-edited)**
- `GALLERY_SEED_MANIFEST.md` and any registry `--check` output that moves when
  the assistant-templates route/slot is removed. No `openapi.json` /
  `api-client/types.ts` regen is implied — no schema change.
- ⚠️ **`sdk/packages/kit/src/testIds.generated.ts` is in the `sdk` SUBMODULE.**
  ITEM-11 removes testid-bearing UI, so `check:testid-registry` may drift and
  force a submodule commit. An UNPUSHED submodule commit fails CI at
  `actions/checkout --recursive` in seconds. This is checked explicitly after
  ITEM-11 lands (`npm run check:testid-registry`), before anything else. If it
  drifts: do NOT push to `chat` (another platform tracks it); branch from
  `origin/paws` inside the submodule and push over SSH
  (`GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes' git push
  git@github.com:ziee-ai/sdk.git HEAD:refs/heads/paws` — the sdk remote is HTTPS
  while paws is SSH, so a bare push hangs on credentials). If it does NOT drift,
  the submodule pin is left untouched — PR #10 already repins it and a second
  repin would conflict.

## Patterns to follow

- **Config kill switch** — mirror `voice` (`src/modules/voice/mod.rs:89-134`):
  it is the only one of the five that guards BOTH `init()` and
  `register_routes()`, and it caches the resolved flag on the module struct.
- **Chat-extension config gate (ITEM-8)** — mirror
  `lit_search/chat_extension/extension.rs:21-34`, which threads `config_enabled`
  into the extension precisely so a stale enabled row cannot re-attach it. Its
  comment states the intent; `bio_mcp` and `js_tool` follow the same shape.
- **Migration** — mirror the existing `file_rag` migrations' style; server
  sequence, prefix above `202607210100` (see BASE.md), unique within the server
  block, `cargo clean` after so `build.rs` re-runs.
- **Desktop hide lever** — mirror the two existing `CORE_MODULE_BLOCKLIST`
  entries (`user-profile`, `server-update`), each of which carries a short
  reason comment, and its pure `applyBlocklist` + unit test
  (`src-app/desktop/ui/src/modules/loader.test.ts:13-31`).
- **Registry-filter shape (ITEM-4/5)** — both globs already document a
  "zero contributors renders fine" invariant
  (`projects/core/extensions/registry.tsx:30-33`,
  `projects/extensions/index.ts:17-22`); filter at the discovery site, keep the
  registries untouched.
- **No SDK submodule edits.** `ModuleLoadContext` lives in `sdk/`; extending it
  would require a push to `ziee-ai/sdk` — the previous branch hit exactly that
  as a blocking handover. Everything here stays in the app tree.

---

# Plan audit (phase 2) — audited against the codebase

## Breakage risk

The whole risk of this change is INV-2, and it concentrates in four places, all
verified in source rather than assumed:

1. **Auto-discovery registries that bypass the module system.** Found two
   (chat + projects). Both are owned by SURVIVING modules and glob into hidden
   ones, so `shouldLoad`/blocklist alone leaves the affordances live. Handled by
   ITEM-4/ITEM-5; the projects one had to be re-mechanised (see ITEM-5).
2. **Static imports from survivors into hidden modules.** Exactly three files
   repo-wide: `chat/extensions/schedule/components/ScheduleLoopDialog.tsx:26-29`
   (scheduler), `llm-provider/components/widgets/DownloadIndicatorWidget.tsx:5,12`
   (hub), and a type-only import in `dev/gallery/fixtures/chat-deep.ts:20`
   (literature — not hidden). These still COMPILE (no file is deleted); the
   question is runtime behaviour, which ITEM-13 answers by running.
3. **Slot hosts assuming a contributor.** Audited: every consumer uses `|| []`,
   and both registries document an explicit zero-contributor invariant. The one
   `[0]` index (`settings/SettingsPage.tsx:183-220`) is guarded and survivors
   (profile/user/memory/settings-general) always register there.
4. **Chat rail ordering.** Safe by design — mcp's generic contribution sits at
   `order: 1000` and claims whatever a domain contribution didn't
   (`mcp/chat-extension/railContribution.ts:11-27`). Removing a contributor
   degrades its rows to title-cased tool names; it does not blank them.

Also checked and NOT a risk: `PanelRendererMap` collapsing to `never` when no
extension augments it (`chat/core/stores/chat/index.ts:41-43`) — `file`,
`tool-call` and `background` survive and augment it. Missing panel renderers
degrade to a dev warning + `null`, and persisted tabs are filtered.

## Pattern conformance

- ITEM-7/8 mirror the existing kill-switch idiom; `lit_search` is the reference
  for the chat-extension gate and `voice` for the both-guards shape.
- ITEM-3 mirrors the two existing `CORE_MODULE_BLOCKLIST` entries, each with a
  reason comment, and its pure `applyBlocklist` + unit test.
- ITEM-1 is a new file with no direct precedent; `CORE_MODULE_BLOCKLIST` is the
  closest sibling and ITEM-1 is deliberately shaped like it (an exported `Set` +
  a pure predicate) so the desktop lever can consume it directly.
- Deviation from the design worth naming: the design's decision #1 recommends
  "a single shared constant the predicates read". The predicates CANNOT read it
  (`vite-plugin-module-manifest.js:81-101` rejects any free identifier). The
  plan keeps the single constant and binds the unavoidable per-module literals to
  it with a test instead. Recorded as DEC-1.

## Migration collisions

Measured, not cited — `CLAUDE.md`'s documented server max (`202607200200`) is six
migrations stale. Server max on `origin/main` is `202607200600`; in-flight PR #10
adds `202607210100`; the desktop `1e13` sequence is separate and tops at
`10000000000005`. This branch takes **`202607210200`**, which clears both server
maxima and stays below the desktop block. No duplicate prefixes exist today. Full
detail in `BASE.md`.

## OpenAPI regen

**Not required.** No request/response type, handler signature or schema changes.
The four config-default flips, the migration and the UI predicate/registry edits
are all invisible to the spec. (`just` is not installed here; the literal regen
commands are in `justfile:550-554` if this assessment turns out wrong.)

Registry regens that MAY be required — `GALLERY_SEED_MANIFEST.md` (ITEM-11
removes a route + slot) and, riskily, `sdk/packages/kit/src/testIds.generated.ts`
which lives in the **sdk submodule**. Checked explicitly right after ITEM-11.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — new file, no precedent conflict; shaped after `CORE_MODULE_BLOCKLIST`. Two projections (name + dir) are necessary, not incidental: `file-rag/` → `file_rag`, `assistant/` → `assistants`.
- **ITEM-2** — verdict: PASS — all 13 target `module.tsx` files confirmed present with a `shouldLoad` arrow literal today; `() => false` passes the plugin's purity check trivially.
- **ITEM-3** — verdict: PASS — `CORE_MODULE_BLOCKLIST` is consumed by `isBlocklisted`/`applyBlocklist` and already unit-tested; adding names is additive.
- **ITEM-4** — verdict: PASS — glob is lazy and registration is explicit in the IIFE, so a path filter both prevents registration and avoids the chunk download.
- **ITEM-5** — verdict: CONCERN — the plan's original mechanism (filter the glob) was a **silent no-op**: the glob is `{ eager: true }` and registration is a top-level import side effect. Re-mechanised to filter inside `ProjectExtensionRegistry.register()`. Residual, stated: the hidden extension's code is still bundled/imported; only its contribution is dropped.
- **ITEM-6** — verdict: PASS — `isPathModuleForbidden` has exactly one consumer (`RouterComponent.tsx:132`), so the blast radius is one branch. Desktop's stub already returns `false`.
- **ITEM-7** — verdict: CONCERN — flipping the defaults breaks two existing assertions that encode "absent ⇒ enabled" (`config.rs` `mod voice_config_tests`, `js_tool/mod.rs::config_default_enabled`). They must be updated in the same commit or `cargo check --all-targets` (which CI runs) fails. Not a blocker; budgeted.
- **ITEM-8** — verdict: PASS — a real INV-3 hole, and `lit_search` provides an exact template including the "stale enabled row" rationale in its comment.
- **ITEM-9** — verdict: PASS — the override is two lines and unconditional; removing it restores config authority. `bio_mcp`'s sibling override is deliberately left alone (not one of the 13 items).
- **ITEM-10** — verdict: CONCERN — a migration makes the tier **HEAVY** (full audit loop, not one round). Also needs `cargo clean` so `build.rs` re-runs, and the DEC-4 revokes must be verified against what is actually granted rather than assumed.
- **ITEM-11** — verdict: CONCERN — may regenerate `testIds.generated.ts` inside the **sdk submodule**; an unpushed submodule commit fails CI at checkout. Checked immediately after the item lands, with the recovery path recorded in PLAN's *Files to touch*.
- **ITEM-12** — verdict: PASS — the e2e suites are outside `src/modules/`, so deleting them does not move any gallery-gate denominator (those are static walks over `src/modules` + `src/components/ui`). Tension with INV-5 was raised with the owner and the delete decision was reaffirmed.
- **ITEM-13** — verdict: PASS — the three inbound static imports are enumerated exactly; the test is behavioural (drive the real registries), deliberately not a source-scanning guard.

**BLOCKED: none.**
