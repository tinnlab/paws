# DECISIONS — paws-feature-surface

Every human/product input the implementation needs, resolved up front. The four
genuine product choices were batched into ONE `AskUserQuestion` before phase 1
and answered by the owner; the rest are resolved by codebase precedent with a
file:line basis. Zero unresolved markers.

### DEC-1: Where does the hide list live — one shared constant the predicates read, or per-module literals?

**Resolution:** ONE exported constant (`src-app/ui/src/modules/pawsHiddenModules.ts`),
consumed directly by the desktop blocklist, the chat-extension discovery filter
and the project-extension registry filter — plus per-module `shouldLoad: () => false`
literals, which are bound back to the constant by TEST-1.
**Basis:** codebase — the design recommends the predicates read a shared constant,
and they provably cannot. `vite-plugin-module-manifest.js:81-101` lifts each
`shouldLoad` source verbatim into the entry chunk and throws a BUILD ERROR on any
free identifier other than `ctx` and `Permissions`. The alternative — a new
`ModuleLoadContext` field — lives in the `sdk` submodule
(`sdk/packages/framework/src/module-system/types.ts:62`) and would require a
cross-repo push. So the constant is kept as the single revert point (INV-5) and
the unavoidable literals are pinned to it by a test rather than left to drift.

### DEC-2: Item 12 — is "no assistant template" the picker, the seeded rows, or both?

**Resolution:** The **admin template SURFACE only** — the
`/settings/assistant-templates` route and `settingsAdminPages` entry in
`assistant/module.tsx:43-66`, its page (`pages/AssistantsSettings.tsx`) and its
store (`stores/templateAssistants/`). The `is_template` column, the seeded
"Default Assistant" row, clone-on-signup and hub install-as-template all STAY.
**Basis:** codebase — there is no "template picker"; the only template UI is that
admin CRUD page (the chat composer's "assistant picker" lists the user's OWN
assistants via `ApiClient.Assistant.list`, unrelated). Removing the seeded rows
would break `event_handlers.rs::CloneTemplateAssistantsHandler`, so every new
user would sign up with ZERO assistants. Removing the `is_template` concept would
take out 6 REST routes, 4 permissions, a sync entity and the hub's
install-as-template path — far beyond "remove assistant templates". TEST-13 pins
the surviving behaviour.

### DEC-3: Item 13 — the project References entry only, or the whole citations project-extension?

**Resolution:** The whole citations project-extension contribution is dropped —
which is exactly the "References" entry, since that contribution registers
nothing else. Implemented centrally in `ProjectExtensionRegistry.register()`, not
by deleting `citations/project-extension/extension.tsx`.
**Basis:** codebase — the contribution is a single `knowledge_kinds` entry
(`citations/project-extension/extension.tsx:27-45`), so "the entry" and "the
extension" are the same thing here. Doing it in the registry keeps it reversible
by the DEC-1 list (INV-5) instead of by restoring a deleted file.

### DEC-4: Do hidden-but-not-disabled modules (items 6–11) also get their permissions revoked?

**Resolution:** Yes, for the Users-group grants of the six UI-only items, in the
ITEM-10 migration. Revoked: `workflows::read`, `workflows::execute`,
`scheduler::use`, `citations::use`, `citations::manage`, `knowledge_base::use`,
`knowledge_base::manage`, and the six `hub::assistants::*` / `hub::mcp_servers::*`
grants.
**⚠ NOT revoked — `notifications::read`.** The scheduler grant migration bundles
it into the same statement
(`scheduler/migrations/202607146080_scheduler_grant_permissions.sql`:
`ARRAY['scheduler::use','notifications::read']`), but `notifications` is a
SURVIVING module. Revoking the whole array would have silently broken
notifications for every user — an INV-2 break disguised as a permission cleanup.
**Also NOT revoked — `voice::transcribe`, `js_tool::use`.** Those two
capabilities are genuinely OFF server-side (items 4 and 5 are disable+hide), so
revocation is redundant scope, and `voice` un-mounts its routes entirely.
`file_rag` grants nothing to Users.
**Basis:** codebase — grant arrays read directly from each module's
`*_grant_permissions.sql`. This strengthens authorization and so is consistent
with INV-6, which forbids WEAKENING a check.

### DEC-5: How are the four server capabilities switched off?

**Resolution:** Flip the Rust `default_*_enabled()` functions in
`core/config.rs` to return `false`.
**Basis:** user — asked as an explicit option picker before phase 1; the owner
chose the code default over YAML-only. Supporting evidence given at the time: no
committed config file (`dev.example.yaml`, `prod.example.yaml`,
`packaging/config.default.yaml`) mentions any of the four, `config/dev.yaml` is
gitignored, and the desktop builds its config in memory with none of these keys
(`desktop/tauri/src/modules/backend/mod.rs:503-611`) — so a YAML-only change
would have left all three of those paths enabled.

### DEC-6: Does a hidden module's route render 403 or 404?

**Resolution:** 404. `isPathModuleForbidden` (`loader.ts:185-189`) treats a
paws-hidden module as having no owner.
**Basis:** user — explicit option picker. A hidden module's `routePaths` stay in
the build manifest, so today `/workflows` would render `<ForbiddenResult />`
(`RouterComponent.tsx:146`) and tell the user they lack permission for a feature
this instance does not have. Desktop already behaves this way
(`loader.desktop.ts:132`), so this only aligns web with desktop.

### DEC-7: What happens to the existing e2e suites for the hidden features?

**Resolution:** Delete them, listing every path in the PR body.
**Basis:** user — explicit option picker, and reaffirmed after I flagged the
tension with INV-5 ("reversible by configuration, not by deleting code") and
offered relocation to a non-collected directory as a same-cost alternative that
preserves reversibility. The owner's decision stands; the tension is recorded
against INV-5 in `DESIGN_FIDELITY.md` rather than being written up as UPHELD.

### DEC-8: Does the reduction apply to the desktop app?

**Resolution:** Yes — desktop is the target. Both workspaces are done; since they
share one module tree, only `CORE_MODULE_BLOCKLIST` is desktop-specific.
**Basis:** user. This matters more than it looks: the desktop loader
(`loader.desktop.ts:140-201`) eager-globs every core `module.tsx` and **never
evaluates `shouldLoad`**, so on the actual target the blocklist — not the
predicate — is the load-bearing lever.

### DEC-9: Are the `web-search` and `literature` UI modules hidden too?

**Resolution:** No. They are **disable-only** per the design's item table (rows 1
and 2 say "disable", not "hide + disable" as rows 4 and 5 do). Their admin
settings pages remain reachable for an admin.
**Basis:** convention — the design table is explicit, and rows 4/5 prove the
author distinguishes the two levers deliberately. Consequence recorded: with the
capability off, those pages configure something inert. Not silently "fixed" —
changing it would be reframing the design.

### DEC-10: Is `bio_mcp` disabled?

**Resolution:** No — untouched, including the desktop force-on override at
`desktop/tauri/src/modules/backend/mod.rs:175-176`.
**Basis:** convention — `bio_mcp` appears in the design only as an example of an
existing kill switch, never as one of the 13 items. Only ITEM-9's `web_search`
override is removed.

### DEC-11: `file_rag_admin_settings.semantic_enabled` — fixed constant or admin-configurable settings row?

**Resolution:** Admin-configurable settings row — unchanged. This feature only
changes its DEFAULT to `false` (column default + the seeded singleton).
**Basis:** codebase — it is already a singleton settings row with REST
GET/PUT gated by `file_rag::admin::{read,manage}`
(`file_rag/routes.rs:10-22`), which is precisely the pattern the
configurable-settings rule asks for. No new tunable is introduced, so nothing
here needs promoting from a constant.
**Noted consequence:** the file-rag admin UI module is hidden (item 10), so
re-enabling semantic search on a paws instance is an API/DB action, not a UI one.
That is a deliberate consequence of hiding the module, not an oversight.

### DEC-12: The four kill switches — fixed constant or admin-configurable?

**Resolution:** Deploy-level config keys — unchanged shape, only the default
flips. `web_search: { enabled: true }` in the config file re-enables, per
capability.
**Basis:** codebase — `Option<XxxConfig>` with `#[serde(default)]` is the
established deploy kill-switch pattern (`core/config.rs:189-216`), and CLAUDE.md
§16 names it as the required shape for a side-effecting module. TEST-9 pins both
directions (absent ⇒ off, explicit true ⇒ on), which is what keeps INV-5 true for
the server half.

### DEC-13: The `sdk` submodule pointer.

**Resolution:** Moved to `paws` @ `c38e9fc` as directed (commit `f6ba175e5`,
pointer only; `.gitmodules` deliberately untouched because PR #10 owns that
line). **This currently breaks `npm run check` in this worktree and is escalated
to the owner, unresolved.**
**Basis:** user directive, superseding the earlier conditional. Measured both
ways back-to-back: at `584756d3`, `check:testid-registry` exits 0 (1787 ids); at
`c38e9fc` it exits 1 (stale — the branch carries PR #10's 12
`onboarding-default-model-*` ids, which cannot exist in a tree cut from `main`).
Regenerating would DELETE those 12 ids and revert PR #10's sdk work, so I did not
do it. Phase 8 requires an earned `npm run check (ui): PASS`; this must be
resolved (most likely by merging `main` into this branch after PR #10 lands)
before hand-off. Recorded rather than worked around.
