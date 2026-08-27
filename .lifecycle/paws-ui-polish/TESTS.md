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
**WITHDRAWN — the desktop one-row geometry spec (the slot formerly numbered 6).**
**Not written, not skipped, not shipped.** An owner decision, and the honest one.
It is deliberately no longer enumerated as a test above: it does not exist, so
carrying an ID that the phase-8 gate must then be told to excuse would be a way
of keeping credit for coverage nobody has. The ID is retired, not reused —
TEST-6b is a separate test and still runs.

  The spec existed and was correct, but it could never run here: the desktop e2e config never brings its Vite dev server up on the port it then navigates to (`playwright.config.ts` and `desktop/ui/vite.config.ts` each call `pickBindablePort` independently and disagree), so `page.goto` gets `ERR_CONNECTION_REFUSED`. **Control: the untouched `desktop-real-backend-smoke.spec.ts` fails identically**, so the defect is pre-existing and not caused by this branch; pinning `VITE_DEV_PORT` to a port verified free immediately beforehand did not help. Per B3 the shared harness was not edited to route around it.

  Shipping it un-skipped would have left the desktop suite red for an unrelated reason, and shipping it skipped would have been a test that cannot fail dressed as coverage. Per DEC-10, an honest gap beats both.

  **What is therefore UNCOVERED, stated plainly:** nothing in this branch measures the RENDERED GEOMETRY of the one-row layout in the desktop shell. The row's behaviour is covered by TEST-5 (web, real browser, geometric) and TEST-7 (container contract), and the desktop MODULE GRAPH — the only thing that genuinely differs there — by TEST-6b. What is unproven is the pixel arrangement under the desktop module set specifically. Given `LeftSidebar.desktop.tsx` returns the core component verbatim off macOS, the risk is low, but it is a real gap and is not being described as covered. Reinstating it is a one-file change once the desktop harness's port derivation is fixed.

- **TEST-6b** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-4] file: `src-app/ui/src/modules/desktopSidebarWidgets.test.ts` — asserts: the DESKTOP-specific half that is provable without the blocked harness — **the module graph**. Neither `notification` nor `llm-provider` is dropped by `CORE_MODULE_BLOCKLIST` (so the row genuinely has two children on desktop, not one), `user-profile` IS dropped (so the footer below the row is empty there — the layout the web build never renders), and the blocklist is non-empty so none of it passes vacuously. Deliberately NOT presented as a substitute for the rendered geometry: it covers the module graph, TEST-5 and TEST-7 cover the row's behaviour.
- **TEST-7** (tier: unit) [covers: ITEM-4] file: `src-app/ui/src/modules/layouts/app-layout/components/LeftSidebar.test.tsx` — asserts: the `sidebarBottom` row still renders when the `sidebarTools` slot contributes NOTHING — the de-nesting. Today the row is nested inside the Tools block and would disappear with it; this test fails against the current code.

## Item 3 — skills for hidden features

- **TEST-8** (tier: integration) [acceptance] [invariant: INV-3] [covers: ITEM-6, ITEM-7] file: `src-app/server/tests/skill/paws_hidden_skills_test.rs` — asserts: the **UPGRADE** case. Seed the DB as an already-migrated install by inserting the three removed skills as `scope='built_in'`, `enabled=true` rows, then run the migration + the built-in sync, then call the real gating query `list_available_for_conversation` for a user — none of the three appears, i.e. none can reach the model's listing. A fresh-install-only assertion would pass with the migration deleted, which is precisely the failure mode this test exists to catch.
- **TEST-9** (tier: integration) [covers: ITEM-6, ITEM-10] file: `src-app/server/tests/skill/builtin.rs` — asserts: the synced built-in set is exactly the expected surviving names, and contains none of `io.github.ziee/{create-workflow,troubleshoot-workflow-run,hub-installation}`. Replaces the bare `assert_eq!(count, 13)` with a set assertion, so a future removal fails with a name rather than an arithmetic mismatch.
- **TEST-10** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-8] file: `src-app/server/tests/skill/paws_hidden_skills_test.rs` — asserts: for every shipping built-in skill, the body extracted to disk (what `read_skill_md_cached` would hand the model) contains no instruction routing the user to a paws-hidden surface — no "Hub →" navigation path and no hub install step. Reads the CONTENT the model is given, not the file list, because INV-4 is a claim about content.
- **TEST-11** (tier: integration) [covers: ITEM-9] file: `src-app/server/tests/hub/catalog_v1.rs` — asserts: the seeded hub catalog contains no `io.github.ziee/effective-prompting` entry, and the seed still passes its own consistency check (the index's `hub_version` still matches `SEED_HUB_VERSION`, and every manifest the index names resolves) — so removing the entry cannot silently desync the index from the bundles.
  **File corrected during phase 8:** planned against `catalog_hermetic.rs`, but the
  assertions that actually carry this invariant (`SEED_VERSION`, `SEED_ITEM_COUNT`,
  `counts["skills"]`) live in `catalog_v1.rs`, which is what this branch edited.
  Recording a PASS against the planned-but-untouched file would have been an
  inherited pass nobody earned — the phase-8 gate flagged exactly that (A11).

## Item 5 — a downloaded model must be chattable without a reload

The gate is deterministic (DEC-10). **TEST-14 is the consumer-observed leg the
brief asks for; TEST-12 and TEST-13 are what make the gate deterministic rather
than a race.** What each does and does not prove is stated in-file.

- **TEST-12** (tier: unit) [covers: ITEM-12, ITEM-14] file: `src-app/server/src/modules/llm_local_runtime/proxy_handlers.rs` (`endpoint_resolve_tests`) — asserts: **the fix did not weaken any deliberate refusal.** A genuinely absent `running` row is still reported (not restarted); a bearer still missing after a restart gives up rather than looping; a restart timeout keeps its own identity so the caller can still answer 504 instead of collapsing everything into 502; and a healthy instance is used directly with ZERO restarts, so "always restart once" cannot pass the recovery test by spawning an engine on every request.

  **AMENDED after the reproduction — read this before treating the original wording as the promise.** As planned, TEST-12 was to drive G2 as an *integration* test over the two states PLAN predicted (the draining flag; a `running` row on a dead port). Neither turned out to be the defect, and neither is reachable from an integration test anyway: `INSTANCE_API_KEYS` is a process-global inside the SERVER process and the harness spawns the server as a subprocess, and `probe_liveness` health-checks the row's `base_url`, so a forced `running` row with a dead process is simply restarted before the window is reached. The real state is TEST-17's, and the coverage moved there. Recorded in `DRIFT-1.md`.
- **TEST-13** (tier: integration) [covers: ITEM-13] file: `src-app/server/tests/llm_model/sync_emit_test.rs` — asserts: **G1, for the path a test can reach.** The upload-commit path (which funnels through the same `create_model_with_files` as the download) enqueues Tier-2 exactly ONCE — proving the de-duplication removed the *download-side* call and not the shared one that also covers uploads. Observed in the server log the test drives (`validator: enqueued model … tier Tier2`, exactly one occurrence), not a mocked call count.

  **Honest limit, stated rather than implied:** the download path cannot be driven from an integration test at all — `GitService::clone_repository` validates against `PUBLIC_HTTP_OR_HTTPS` unconditionally as SSRF defence-in-depth, so a loopback git fixture is unreachable BY DESIGN (`tests/llm_model/default_model_download_test.rs:8-28`). That the download path enqueued TWICE is evidenced by the live reproduction (two `enqueued` lines 4 ms apart, in `INFRA_INTEGRATION.md`), and that it now enqueues once follows from the removed call site being the download task's own. No test in this branch proves the download path's count directly, and none is claimed to.
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
| ITEM-4 | TEST-5, TEST-6b, TEST-7 (TEST-6 removed — see above) |
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
| INV-2 | TEST-5, TEST-6b |
| INV-3 | TEST-8 |
| INV-4 | TEST-10 |
| INV-5 | TEST-12, TEST-14, TEST-17 |
