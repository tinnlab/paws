# TESTS — paws-ui-polish

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise rather than the code's behaviour.

No new permission is introduced (no `X::use`/`X::read`/`X::manage` added to a
`modules/*/permissions.rs`, none granted in the new migration — it is a
name-scoped `DELETE` on `skills`), so no `[negative-perm]` restricted-user e2e
is required. The new migration deletes data and grants nothing.

## Item 1 + 2 — the Downloads panel

- **TEST-1** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2] file: `src-app/ui/tests/e2e/llm/download-popover-responsive.spec.ts` — asserts: with one active and one failed download seeded through the real backend and a deliberately long model name, the opened Downloads panel satisfies, at 320 / 390 / 1440 px: panel `scrollWidth === clientWidth`; every interactive control's bounding rect lies horizontally INSIDE the panel's rect; and `documentElement.scrollWidth === clientWidth` (no sideways body scroll). Geometric, not visibility — visibility is exactly what failed to catch this class on the notification bell.
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/llm-provider/components/widgets/DownloadIndicatorWidget.test.tsx` — asserts: the rendered popover carries NO fixed inline `width`/`maxHeight` on a content child, and both the width and height bounds sit on the PANEL element. Mirrors `NotificationBellPopover.test.tsx`; this is the contract that stops the inline size being reintroduced.
- **TEST-3** (tier: unit) [covers: ITEM-2] file: `src-app/ui/src/modules/llm-provider/components/downloads/DownloadItem.test.tsx` — asserts: in `minimal` mode a 120-character display name leaves the row's `scrollWidth === clientWidth` (it truncates by CSS), the FULL name is still present as the accessible/`title` text, and the percentage element is not displaced — i.e. the row no longer truncates by a 30-character JS slice.

## Item 1's observability gap

- **TEST-4** (tier: e2e) [covers: ITEM-3] file: `src-app/ui/tests/e2e/visual/gallery-download-popover.spec.ts` — asserts: the new gallery surface renders the Downloads popover OPEN with an active AND a failed download present (the loaded state whose absence is why the overflow was invisible to `gate:ui`). Fails if the story is missing, renders empty, or renders closed.

## Item 2 — one row, both layouts

- **TEST-5** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-4, ITEM-5] file: `src-app/ui/tests/e2e/llm/sidebar-icon-row.spec.ts` — asserts: with a download in flight, the notification bell and the download indicator share a horizontal band (their rects overlap vertically) and do NOT stack (neither rect's top is below the other's bottom) — one row, side by side; and with no download in flight the bell alone still renders inside that row at the same vertical position, which is the COMMON case since the download widget self-hides.
- **TEST-6** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-4] file: `src-app/desktop/ui/tests/e2e/desktop-sidebar-icon-row.spec.ts` — asserts: the same one-row geometry in the DESKTOP app shell, which runs a different module graph (`loader.desktop.ts` blocklists `user-profile`, so the footer below the row is empty). This is the half a web-only spec cannot speak to.
- **TEST-7** (tier: unit) [covers: ITEM-4] file: `src-app/ui/src/modules/layouts/app-layout/components/LeftSidebar.test.tsx` — asserts: the `sidebarBottom` row still renders when the `sidebarTools` slot contributes NOTHING — the de-nesting. Today the row is nested inside the Tools block and would disappear with it; this test fails against the current code.

## Item 3 — skills for hidden features

- **TEST-8** (tier: integration) [acceptance] [invariant: INV-3] [covers: ITEM-6, ITEM-7] file: `src-app/server/tests/skill/paws_hidden_skills_test.rs` — asserts: the **UPGRADE** case. Seed the DB as an already-migrated install by inserting the three removed skills as `scope='built_in'`, `enabled=true` rows, then run the migration + the built-in sync, then call the real gating query `list_available_for_conversation` for a user — none of the three appears, i.e. none can reach the model's listing. A fresh-install-only assertion would pass with the migration deleted, which is precisely the failure mode this test exists to catch.
- **TEST-9** (tier: integration) [covers: ITEM-6, ITEM-10] file: `src-app/server/tests/skill/builtin.rs` — asserts: the synced built-in set is exactly the expected surviving names, and contains none of `io.github.ziee/{create-workflow,troubleshoot-workflow-run,hub-installation}`. Replaces the bare `assert_eq!(count, 13)` with a set assertion, so a future removal fails with a name rather than an arithmetic mismatch.
- **TEST-10** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-8] file: `src-app/server/tests/skill/paws_hidden_skills_test.rs` — asserts: for every shipping built-in skill, the body extracted to disk (what `read_skill_md_cached` would hand the model) contains no instruction routing the user to a paws-hidden surface — no "Hub →" navigation path and no hub install step. Reads the CONTENT the model is given, not the file list, because INV-4 is a claim about content.
- **TEST-11** (tier: integration) [covers: ITEM-9] file: `src-app/server/tests/hub/catalog_hermetic.rs` — asserts: the seeded hub catalog contains no `io.github.ziee/effective-prompting` entry, and the seed still passes its own consistency check (the index's `hub_version` still matches `SEED_HUB_VERSION`, and every manifest the index names resolves) — so removing the entry cannot silently desync the index from the bundles.

## Item 5 — a downloaded model must be chattable without a reload

The gate is deterministic (DEC-10). **TEST-14 is the consumer-observed leg the
brief asks for; TEST-12 and TEST-13 are what make the gate deterministic rather
than a race.** What each does and does not prove is stated in-file.

- **TEST-12** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-12, ITEM-14] file: `src-app/server/tests/llm_local_runtime/validation_race_test.rs` — asserts: **G2.** For EACH state a validation pass transits — the draining instance flag, and a `llm_runtime_instances` row with `status='running'` whose port is dead — a chat send through the real path SUCCEEDS instead of returning 502/503/504. The states are SET by the test, not raced for, so the assertion is deterministic and covers the whole class rather than one sampled instant. Terminal refusal states (`failed|invalid|error`) must still be refused — asserted in the same test so the fix cannot be "stop refusing anything".
- **TEST-13** (tier: integration) [covers: ITEM-13] file: `src-app/server/tests/llm_local_runtime/validation_race_test.rs` — asserts: **G1.** A completed repository download produces exactly ONE `validation_status → 'processing'` transition for the model, and the upload-commit path also produces exactly one — proving the de-duplication did not simply delete the pass that covers uploads. Asserted on the observable DB transition, not a mocked call count.
- **TEST-14** (tier: e2e) [acceptance] [invariant: INV-5] [covers: ITEM-12] file: `src-app/ui/tests/e2e/llm/downloaded-model-chat-no-reload.spec.ts` — asserts: the CONSUMER-observed promise. A model created in the shape a completed download produces (driven via a raw admin `fetch` with no `X-Sync-Connection-Id`, so `origin = None` reproduces the download path's delivery semantics), served by the stub-engine, appears in the composer AND a message sent to it returns a response — **with no page reload at any point**. The page is loaded and its landmark awaited BEFORE the mutation so the change lands inside its live delivery window. This is not a race: the mutation happens first and the assertion waits for its effect. It does NOT prove the validation window is closed — TEST-12 is what proves that.

## Items found on the way (same subsystem)

- **TEST-15** (tier: integration) [covers: ITEM-15] file: `src-app/server/tests/llm_model/sync_emit_test.rs` — asserts: the validator's TERMINAL transition publishes BOTH `llm_model` and `user_llm_provider`, observed through `SyncProbe`. Fails today: only `llm_model` is published, so the user-facing view never learns the model's final `validation_status`/`capabilities`.
- **TEST-17** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-17] file: `src-app/server/tests/llm_local_runtime/validation_race_test.rs` — asserts: the state the reproduction ACTUALLY surfaced. With the model's `llm_runtime_instances` row reading `status='running'` while the per-instance bearer has been dropped — the exact ordering `LocalDeployment::stop` produces — a chat send must SUCCEED rather than returning `502 engine_start_failed: "missing per-instance bearer token"`. Set by the test, not raced for. This is the leg that fails against pre-fix code with the byte-identical error the live instance logged.
- **TEST-16** (tier: unit) [covers: ITEM-16] file: `src-app/ui/src/modules/llm-provider/stores/llmProvider/loadLlmProviders.store.test.ts` — asserts: BOTH halves. (a) a `force = true` call issued while a load is in flight resolves against freshly-fetched data rather than returning silently — it fails today, where the `|| state.loading` clause short-circuits even a forced call; and (b) two concurrent NON-forced calls still issue exactly one request, so the fix does not trade a dropped refresh for a request storm.

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2 |
| ITEM-2 | TEST-1, TEST-3 |
| ITEM-3 | TEST-4 |
| ITEM-4 | TEST-5, TEST-6, TEST-7 |
| ITEM-5 | TEST-5 |
| ITEM-6 | TEST-8, TEST-9 |
| ITEM-7 | TEST-8 |
| ITEM-8 | TEST-10 |
| ITEM-9 | TEST-11 |
| ITEM-10 | TEST-9 |
| ITEM-11 | [DESCOPED] — approved disposition in DECISIONS.md (DEC-3) |
| ITEM-12 | TEST-12, TEST-14 |
| ITEM-13 | TEST-13 |
| ITEM-14 | TEST-12 |
| ITEM-15 | TEST-15 |
| ITEM-16 | TEST-16 |
| ITEM-17 | TEST-17 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-1 |
| INV-2 | TEST-5, TEST-6 |
| INV-3 | TEST-8 |
| INV-4 | TEST-10 |
| INV-5 | TEST-12, TEST-14, TEST-17 |
