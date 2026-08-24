# TESTS — paws-feature-surface

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise, not the implementation's behaviour.

Deliberately kept small. The brief's GUARD-SUB tripwire is explicit that this
repo has twice paid for hand-written static-analysis guards with unbounded
evasion spaces, so nothing here scans source text for a semantic property: the
unit tests drive the REAL extractor / REAL registries, and the invariant proofs
are e2e journeys against a running app.

## Acceptance tests (one per invariant)

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-1, ITEM-2] file: `src-app/ui/src/modules/pawsHiddenModules.test.ts` — asserts: for EVERY hidden module, running the build's own `extractModule()` (exported by `src-app/ui/plugins/vite-plugin-module-manifest.js`) over its real `module.tsx` yields a `shouldLoad` predicate that evaluates FALSE against a fully-permissioned admin context — i.e. hiding is the manifest predicate, uniformly, and not bespoke gating. Also asserts a survivor (`chat`) still evaluates TRUE, so the test cannot pass by the extractor returning nothing.
- **TEST-2** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-2, ITEM-4, ITEM-6, ITEM-11, ITEM-12] file: `src-app/ui/tests/e2e/17-paws-surface/hidden-features-absent.spec.ts` — asserts: as an ordinary logged-in user, for EACH hidden feature there is no sidebar/nav entry, no settings entry, and no composer affordance (toolbar pill, plus-menu item, status row, mic button); and a direct navigation to each hidden route renders the NOT-FOUND surface, not `ForbiddenResult`. Includes `/settings/assistant-templates` (ITEM-11).
- **TEST-3** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-13, ITEM-12] file: `src-app/ui/tests/e2e/17-paws-surface/survivors-still-work.spec.ts` — asserts: POSITIVELY, with every listed module absent, that the user sends a chat message and receives a streamed reply; the settings page loads and navigates between sections; a project opens and its knowledge section renders "Knowledge files"; the onboarding surface loads. This test must FAIL if hiding a module breaks a surviving surface — an absence-only test passes vacuously on a dead app, which is exactly what this one is built not to do.
- **TEST-4** (tier: integration) [acceptance] [invariant: INV-3] [covers: ITEM-7, ITEM-8] file: `src-app/server/tests/paws_surface/mod.rs` — asserts: with the shipped defaults, the built-in MCP servers for web_search / lit_search / js_tool / voice are NOT registered and their tools are NOT offered to the model. Includes the stale-row case: pre-insert an `mcp_servers` row marked enabled for web_search and assert it is still not auto-attached (this is the hole ITEM-8 closes; without the fix this leg fails).
- **TEST-5** (tier: unit) [acceptance] [invariant: INV-5] [covers: ITEM-1, ITEM-3, ITEM-4] file: `src-app/ui/src/modules/pawsHiddenModules.test.ts` — asserts: the reduction is controlled by ONE list. With the hidden set injected EMPTY, the desktop blocklist predicate, the chat-extension discovery filter and the project-extension registry filter all admit a previously-hidden module again; with it populated, all three reject it. Reversal is a data change, not a code change.
- **TEST-6** (tier: integration) [acceptance] [invariant: INV-6] [covers: ITEM-10] file: `src-app/server/tests/paws_surface/mod.rs` — asserts: after the migration, every permission gate still behaves as before for what it still grants (positive control: a Users-group member succeeds on an endpoint they legitimately hold), while the revoked grants now deny (403). Nothing is loosened: no endpoint that required a permission before answers without one now.

## Unit

- **TEST-7** (tier: unit) [covers: ITEM-3] file: `src-app/desktop/ui/src/modules/loader.test.ts` — asserts: `applyBlocklist` drops every hidden module from the desktop bundle and keeps the survivors (`chat`, `projects`, `assistants`), extending the existing `user-profile`/`server-update` test rather than replacing it.
- **TEST-8** (tier: unit) [covers: ITEM-5] file: `src-app/ui/src/modules/projects/core/extensions/registry.test.tsx` — asserts: driving the REAL `ProjectExtensionRegistry`, registering the `file`, `citations` and `knowledge-base` contributions leaves `knowledgeKinds()` returning only `file` — so the project "References" entry is gone at its source (design item 13).
- **TEST-9** (tier: unit) [covers: ITEM-7] file: `src-app/server/src/core/config.rs` — asserts: with the key ABSENT, `web_search` / `lit_search` / `voice` / `js_tool` all resolve to DISABLED; with `enabled: true` explicitly set, each resolves to ENABLED (the reversibility half). Replaces the existing assertions that encode the old "absent ⇒ enabled" default.
- **TEST-10** (tier: unit) [covers: ITEM-8] file: `src-app/server/src/modules/web_search/chat_extension/web_search.rs` — asserts: `should_attach` returns false when the config kill switch is off, even with settings enabled and a provider configured.
- **TEST-11** (tier: unit) [covers: ITEM-9] file: `src-app/desktop/tauri/src/modules/backend/mod.rs` — asserts: the desktop feature-default helper leaves an operator-supplied `web_search.enabled = false` intact (today it is force-overwritten to true), while still defaulting the features it legitimately owns.

## Integration

- **TEST-12** (tier: integration) [covers: ITEM-10] file: `src-app/server/tests/paws_surface/mod.rs` — asserts: on a freshly-migrated database, `file_rag_admin_settings.semantic_enabled` is FALSE for the singleton row, and retrieval consequently plans the FTS-only arm rather than the vector arm.
- **TEST-13** (tier: integration) [covers: ITEM-11] file: `src-app/server/tests/paws_surface/mod.rs` — asserts: clone-on-signup STILL works — a newly created user receives a cloned "Default Assistant". This is the guard that ITEM-11 removed only the admin template SURFACE and not the template mechanism; without it, "remove assistant templates" could silently ship users with zero assistants.

## E2E

- **TEST-14** (tier: e2e) [negative-perm] [positive-control] [covers: ITEM-5, ITEM-10] file: `src-app/ui/tests/e2e/17-paws-surface/project-references-absent.spec.ts` — asserts: a user LACKING the revoked `citations::use` / `knowledge_base::use` grants still LOADS the project detail page and sees its "Knowledge files" knowledge kind (the positive control — this is what makes "absent" mean "gated" rather than "never rendered"), and sees NO "References" and NO "Knowledge bases" entry, in the inline preview and in the manage drawer.

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-5 |
| ITEM-2 | TEST-1, TEST-2 |
| ITEM-3 | TEST-5, TEST-7 |
| ITEM-4 | TEST-2, TEST-5 |
| ITEM-5 | TEST-8, TEST-14 |
| ITEM-6 | TEST-2 |
| ITEM-7 | TEST-4, TEST-9 |
| ITEM-8 | TEST-4, TEST-10 |
| ITEM-9 | TEST-11 |
| ITEM-10 | TEST-6, TEST-12, TEST-14 |
| ITEM-11 | TEST-2, TEST-13 |
| ITEM-12 | TEST-2, TEST-3 |
| ITEM-13 | TEST-3 |

**ITEM-12 note (honest coverage).** ITEM-12 deletes e2e suites; a deletion has no
natural positive test. It is covered transitively: TEST-2 and TEST-3 live in the
same Playwright project, so a dangling helper import or a stale reference left by
the deletion fails collection and takes both down. That is real coverage of "the
suite still runs", which is the only claim the deletion makes. It is NOT a claim
that the deleted features remain tested — they deliberately are not, which is the
tension recorded against INV-5 in `DESIGN_FIDELITY.md`.
