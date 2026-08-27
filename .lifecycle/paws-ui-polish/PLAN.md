# PLAN — paws-ui-polish

Five owner-reported issues found by using the shipped paws desktop build.
Item 4 is descoped by the owner (recorded, not silently cut); item 5 is the
priority and is reproduced before it is fixed.

## Design source

Realizes `docs/design/paws-ui-polish.md` (written for this work; §Item 1 …
§Item 5 and its `## Invariants`).

Item 3 additionally realizes the merged `docs/design/paws-feature-surface.md`
§Mechanism / §Invariants — specifically its INV-1 ("a hidden feature's UI is
absent"), INV-3 ("a disabled capability is genuinely off server-side") and the
document's own warning that "hiding is not a security control", which is the
distinction item 3 pushes one layer down into the skill surface.

## Invariants

Lifted verbatim from `docs/design/paws-ui-polish.md` § Invariants.

- **INV-1**: Every control in the Downloads panel — the progress bar and the percentage included — renders **inside the panel's own box**, at narrow and wide viewports alike, and the document never scrolls horizontally because of it.
- **INV-2**: The notification and download icons occupy **one row, side by side**, in **both** the web and the desktop layout; the row is still correct when only one of the two is present.
- **INV-3**: A skill whose **subject** is a feature paws hides does **not reach the model** — neither on a fresh install, nor on an install that already synced it. Removing the source directory alone does not satisfy this.
- **INV-4**: A skill that ships on paws never **directs the user to a feature paws hides**.
- **INV-5**: After a local model's download completes, the user can **send it a message and get a response without reloading the page**.

## Items

- **ITEM-1**: Bound the Downloads popover **panel** (width + max-height) via `className` on the kit `Popover`, mirroring `NotificationBellWidget`, and restructure the content so the height bound reaches the list (`min-h-0` + `flex-1` + `ScrollArea`). Deletes the inline `style={{ width: 320, maxHeight: 440, overflowY: 'auto' }}`.
- **ITEM-2**: Fix the second, independent overflow inside the row: `min-w-0` on the `DownloadItem` minimal-mode flex row and its children, and CSS truncation in place of the JS `substring(0, 30)`.
- **ITEM-3**: Add gallery coverage for the Downloads popover **open, with data** (active + failed downloads) — the state whose absence is why the overflow was invisible to the gate.
- **ITEM-4**: Render the `sidebarBottom` widgets as **one flex row**, and de-nest that row from the `toolsItems.length > 0` block it is currently inside.
- **ITEM-5**: Harmonise the two widget triggers so they sit correctly side by side in that row — the bell uses `px-4 py-3`, the download icon an inline `style={{ padding: '12px 16px' }}`; one mechanism, sized for a row rather than a full-width block.
- **ITEM-6**: Remove the three built-in skill directories whose subject is a paws-hidden feature: `create-workflow`, `troubleshoot-workflow-run` (design item 6 — workflow), `hub-installation` (design item 11 — hub).
- **ITEM-7**: New migration deleting the already-synced `scope='built_in'` skill rows for exactly those three names, so an upgraded install stops injecting them into every chat's system prompt.
- **ITEM-8**: Rewrite the stale Hub-referencing instructions in the three surviving skills that route the user through a page paws does not have — `configure-mcp-servers`, `create-skill`, `use-assistants`.
- **ITEM-9**: Remove the seeded hub skill `io.github.ziee/effective-prompting` (manifest + bundle) and its `index.json` entry.
- **ITEM-10**: Update `src-app/server/tests/skill/builtin.rs`'s hard-coded built-in-skill count, which is the only hard count in the tree.
- **ITEM-11**: [DESCOPED] Hide the seeded `Hugging Face (tinnlab, anonymous)` row from the LLM Repositories list.
- **ITEM-12**: Reproduce the item-5 symptom on **both** download paths (Onboarding default-model step; Add-Local-Model drawer) on my own instance, and encode each reproduced failure state as a fixture state the ITEM-14 tests drive.
- **ITEM-13**: Enqueue Tier-2 validation **exactly once** per repository download — it is currently enqueued twice (`uploads.rs:347` and `uploads.rs:1365`), so every download pays two ≤90s engine spawn/kill cycles.
- **ITEM-14**: Make the chat serving path tolerate a **validation-owned** engine: a send must not fail from a state a validation pass transits (the draining flag; a `running` instance row pointing at a dead port).
- **ITEM-15**: Publish the paired `SyncEntity::UserLlmProvider` alongside `LlmModel` on the validator's terminal transition, matching every other model mutation.
- **ITEM-16**: Make `loadLlmProviders(force = true)` actually force — today an in-flight load short-circuits it, so a `sync:*` frame landing during another load is dropped with no retry.
- **ITEM-17**: Close the teardown-ordering window the ITEM-12 reproduction actually surfaced: `LocalDeployment::stop` drops the model's entry from `INSTANCE_API_KEYS` BEFORE the `llm_runtime_instances` row leaves `status='running'`, while the chat proxy reads those two in the opposite order — so a send in between resolves a live `base_url` and a missing bearer and returns `502 engine_start_failed: "missing per-instance bearer token"`. Added after phase 5 began (see `DRIFT-1.md`): PLAN predicted the draining flag and a running-row-on-a-dead-port, and said a third transited state becomes its own item rather than being folded into ITEM-14 silently.

## Files to touch

- `docs/design/paws-ui-polish.md` (added)
- `src-app/ui/src/modules/llm-provider/components/widgets/DownloadIndicatorWidget.tsx`
- `src-app/ui/src/modules/llm-provider/components/downloads/DownloadItem.tsx`
- `src-app/ui/src/modules/llm-provider/gallery.tsx`, `src-app/ui/src/dev/gallery/stateCoverage.ts`
- `src-app/ui/src/modules/layouts/app-layout/components/LeftSidebar.tsx`
- `sdk/packages/notification-ui/src/NotificationBellWidget.tsx` (trigger only)
- `src-app/server/resources/builtin-skills/{create-workflow,troubleshoot-workflow-run,hub-installation}/` (removed)
- `src-app/server/resources/builtin-skills/{configure-mcp-servers,create-skill,use-assistants}/SKILL.md`
- `src-app/server/resources/hub-seed/skills/io.github.ziee/effective-prompting/` (removed), `src-app/server/resources/hub-seed/index.json`
- `src-app/server/src/modules/skill/migrations/<new>.sql` (added)
- `src-app/server/tests/skill/builtin.rs`
- `src-app/server/src/modules/llm_model/handlers/uploads.rs`
- `src-app/server/src/modules/llm_local_runtime/{validator.rs,proxy_handlers.rs}`
- `src-app/ui/src/modules/llm-provider/stores/llmProvider/actions/loadLlmProviders.ts`
- tests: `src-app/ui/tests/e2e/llm/`, `src-app/ui/tests/e2e/sync/`, `src-app/desktop/ui/tests/e2e/`, `src-app/server/tests/{skill,llm_local_runtime,llm_model}/`

## Patterns to follow

- **ITEM-1 / ITEM-2 → `sdk/packages/notification-ui/src/NotificationBellWidget.tsx:54-73,145-163`.** The identical defect, already fixed, with its reasoning written down: the PANEL owns the size, the size is viewport-bounded, and the list scrolls via `min-h-0` + `flex-1` rather than a hardcoded header/footer reserve. Its tests are the shape to mirror: the geometric e2e `src-app/ui/tests/e2e/15-notifications/bell-popover-responsive.spec.ts` and the jsdom contract harness `src-app/ui/src/modules/notification/components/NotificationBellPopover.test.tsx`. **Visibility assertions do not catch this class** — every control was "visible", just drawn outside the panel.
- **ITEM-4 / ITEM-5 → the existing slot containers in the same file.** `LeftSidebar.tsx` already renders five other slots; match their container idiom rather than inventing one.
- **ITEM-6..ITEM-10 → `src-app/ui/src/modules/pawsHiddenModules.ts`** for the paws precedent of ONE auditable source of truth bound by a test, and `src-app/server/src/modules/skill/builtin.rs` + `repository::upsert_builtin` for the sync semantics the migration has to compensate for.
- **ITEM-13..ITEM-16 → `src-app/server/src/modules/llm_model/handlers/models.rs:175-176`** for the canonical publish pair, `src-app/server/tests/llm_model/sync_emit_test.rs` + `sdk/crates/ziee-test-harness/src/fixtures/sync_probe.rs` for asserting emission, `src-app/server/tests/llm_local_runtime/{test_helpers.rs,mock_release.rs}` + `src-app/stub-engine/` for driving a real engine spawn without a real model, and `src-app/ui/tests/e2e/sync/llm-provider-sync.spec.ts` for the cross-device no-reload template (`--workers=1`; never `waitForLoadState('networkidle')` — it hangs once the sync SSE is connected; load the receiving page and wait on its landmark BEFORE the mutation; assert the empty state first so the later assertion is non-vacuous).

## Plan audit (phase 2 — verdicts against the codebase)

### Breakage risk

- `LeftSidebar.tsx`'s `sidebarBottom` container is consumed by exactly two registrations today (`notification/module.tsx:79`, `llm-provider/module.tsx:109`) — verified by grepping `sidebarBottom` across both UI workspaces. De-nesting the row from the Tools block **changes when it renders**: it currently disappears with an empty Tools section. That is a behaviour change in the safe direction, but it is a behaviour change and must be called out in the PR.
- The `sidebarBottom` widgets are already hidden in icon-only mode (`isIconOnly`); the row must keep that.
- Removing three built-in skills changes the listing the model sees in every tool-capable chat. `chat_extension/extension.rs`'s in-source tests use synthetic fixtures naming `configure-llm-providers` / `create-skill` — both survivors — so they are unaffected. `tests/skill/builtin.rs:69`'s `assert_eq!(builtin_count, 13)` is the one hard count and is ITEM-10.
- Removing the seeded hub skill changes `hub-seed/index.json`, which is sha-verified at build time only for the *fetched* seed; the committed `resources/hub-seed/` copy is the source. `seed_index_version_matches_const` compares `index.json`'s `hub_version` against `SEED_HUB_VERSION` — content removal must not alter that field, and must not desync the two copies (`resources/hub-seed/` vs the build-staged `binaries/hub-seed/`). **This is the highest-risk edit in item 3** and is why it carries its own verdict below.
- `uploads.rs`'s two `enqueue` sites are on different code paths (`create_model_with_files`, and the download task's tail). Removing the wrong one would leave the *upload* path unvalidated. The fix must keep exactly one pass for BOTH the upload and the repository-download flows.
- `loadLlmProviders`' guard is load-bearing against request storms; removing the `loading` short-circuit outright would let concurrent `sync:*` frames stack requests. The fix must preserve dedupe while not dropping a forced refresh.

### Pattern conformance

- ITEM-1/ITEM-2 copy an in-repo fix verbatim, including its documented rationale. No new pattern.
- ITEM-7's migration mirrors the existing per-module migration layout (`modules/skill/migrations/`). It is a data-only `DELETE`, name-scoped.
- ITEM-15 makes the validator match the publish pair every other model mutation already uses — it removes an inconsistency rather than adding a pattern.
- ITEM-14 must not weaken the existing terminal-state refusal (`failed|invalid|error` still 503) — only the *transient* validation-owned states change.

### Migration collisions

Highest server migration prefix in the tree is `202607210300`
(`file_rag/migrations/202607210300_paws_disable_semantic_search.sql`); highest
inside `modules/skill/migrations/` is far below it. The new migration takes a
prefix above `202607210300` in the **server** sequence — NOT above the desktop
`1e13` block, which is a separate sequence. `migration_immutability.rs` forbids
editing any committed migration, so this is a new file and nothing existing is
touched. Recorded concretely in `BASE.md`.

### OpenAPI regen

**Not required.** No handler signature, request/response type, permission or
`SyncEntity` variant changes. ITEM-15 adds a `sync_publish` call for an entity
that already exists in the union; ITEM-13/14/16 change control flow only. If
implementation proves otherwise, `just openapi-regen` runs for BOTH workspaces
and the regen is recorded as a drift entry.

### Per-item verdicts

- **ITEM-1** — verdict: PASS — the kit `Popover` forwards `className` onto the popup (`sdk/packages/kit/src/kit/popover.tsx:47-50`) and tailwind-merge resolves `w-[…]` over the primitive's `w-72`; the sibling fix at `NotificationBellWidget.tsx:162` proves the mechanism in-tree. No kit edit needed.
- **ITEM-2** — verdict: PASS — `Text ellipsis` already renders `max-w-full truncate` (`sdk/packages/kit/src/kit/typography.tsx:91`); it only needs a `min-w-0` parent to take effect, so this is additive.
- **ITEM-3** — verdict: CONCERN — the state matrix currently marks both `:empty` and `:open` `skip: true` with reason "via surface" (`stateCoverage.ts:285`). Adding a real `:open` story means editing that allow-list entry, and `npm run check`'s `check:state-matrix` + the geometry audit will both react. Budgeted, not blocking.
- **ITEM-4** — verdict: PASS — the container is local to `LeftSidebar.tsx:266-276`; both registrations are order-sorted and unchanged.
- **ITEM-5** — verdict: CONCERN — the bell trigger lives in the **sdk** (`sdk/packages/notification-ui/`), so harmonising the two triggers touches a submodule. Per the repo's sdk policy the sdk half needs its own branch + PR into the sdk's `paws` line and a submodule-pointer bump; if that proves heavier than the row needs, the alternative is to let the ROW own the padding and leave both triggers alone. Resolved in DECISIONS.
- **ITEM-6** — verdict: PASS — `builtin.rs` walks `BUILTIN_SKILLS.dirs()` with no allow-list, so removing a directory removes it from the sync with no code change.
- **ITEM-7** — verdict: PASS — `upsert_builtin` has no prune (`skill/repository.rs:374-444`), and `repository::delete` exists but is unreachable for a built-in through the handler, so a migration is the only mechanism. Verified against the actual `ON CONFLICT` clause.
- **ITEM-8** — verdict: PASS — content-only edits to `SKILL.md` bodies; frontmatter `name`/`description` unchanged, so `sync_one`'s sha256 changes and the rows update in place.
- **ITEM-9** — verdict: CONCERN — see *Breakage risk*: `index.json` is also consumed by the build-staged `binaries/hub-seed/` copy and by `seed_index_version_matches_const`. Must verify the two copies and the version constant stay consistent, with a real test run, not by reading.
- **ITEM-10** — verdict: PASS — a single `assert_eq!` at `tests/skill/builtin.rs:69`; the file's other pin (`configure-llm-providers`) is a survivor.
- **ITEM-11** — verdict: PASS — descoped with a recorded, human-approved disposition; nothing to break.
- **ITEM-12** — verdict: PASS — reproduction is unblocked: the box has a VNC display, the desktop build is buildable here, and both download paths are reachable from a self-owned data dir.
- **ITEM-13** — verdict: CONCERN — two call sites on different flows (see *Breakage risk*); the fix must not leave the upload path unvalidated. The test has to prove one pass for BOTH flows, not just the download one.
- **ITEM-14** — verdict: CONCERN — this is the invariant-level fix and its shape is decided by ITEM-12's reproduction. The enumerated states are the two the code names today; if the repro surfaces a third it becomes a new item rather than being folded in silently.
- **ITEM-15** — verdict: PASS — one added `sync_publish` matching `models.rs:175-176`; `UserLlmProvider` is already a `SyncEntity` variant, so no regen.
- **ITEM-16** — verdict: CONCERN — must preserve in-flight dedupe while honouring `force`; the naive fix (delete the `loading` clause) trades a dropped refresh for a request storm. Needs a coalescing shape, and a test that proves BOTH halves.
- **ITEM-17** — verdict: PASS — the ordering is confirmed in the source (`deployment/local.rs:1103-1112` removes the bearer first; `proxy_handlers.rs:316-335` reads base_url then bearer) AND observed live, so this is not a hypothesis. Reordering `stop` would only MOVE the window (a request would resolve a valid token for a dying process and fail at the socket instead), so the fix treats a missing bearer as positive evidence the instance is gone and re-establishes one — bounded to a single retry, riding `ensure_running`'s existing single-flight + timeout + flap cap.

No `BLOCKED` verdicts.
