# DRIFT-1 — implementation vs plan (+ the design's invariants)

Authored during phase 5, item by item, as each landed.

- **DRIFT-1.1** — verdict: resolved — ITEM-5's mechanism. The plan said "filter
  the project-extension glob". That glob is `{ eager: true }` and each extension
  registers as a top-level import SIDE EFFECT, so a key filter would have been a
  silent no-op. Caught at phase 2, re-mechanised to filter inside
  `ProjectExtensionRegistry.register()`, and PLAN.md ITEM-5 was amended in place
  with the reasoning. No behavioural divergence remains.

- **DRIFT-1.2** — verdict: impl-wins — ITEM-7 needed a layer the plan did not
  anticipate. The plan said "flip `default_*_enabled()` to false". That alone
  disables NOTHING in the common case: every read site spelled the fallback out
  as `.unwrap_or(true)`, so an absent config key stayed ENABLED and only a
  present-but-empty block would have changed. Shipped instead: four accessors on
  `Config` (`web_search_enabled()` etc.) that resolve the absent-key default from
  the same `Default` impl as the empty-block case, with every read site moved onto
  them. PLAN.md amended. This is the difference between the branch claiming four
  features off and actually turning them off.

- **DRIFT-1.3** — verdict: impl-wins — `tests/common/harness_inner.rs` was not in
  *Files to touch*. Flipping the defaults silently disabled the features for the
  web_search / lit_search / voice / js_tool suites (~148 start-server call sites
  across 35 files), which cover behaviour that still exists — those features are
  opt-in now, not deleted. The harness now writes all four sections explicitly,
  defaulting ON in tests, with `Some(false)` to opt out. Weighed against B3 ("do
  not edit the shared harness to route around your feature's problem"): this is
  not a workaround for a defect in the feature, it is the harness stating which
  deployment it wants, and the alternative was editing 148 unrelated call sites.
  The paws DEFAULT is asserted where it belongs — `paws_kill_switch_tests`,
  against the real packaged config. PLAN.md amended.

- **DRIFT-1.4** — verdict: impl-wins — ITEM-12 deleted more than the planned
  suite list. Four further specs import into the deleted suites and would fail
  collection: `14-split-chat/voice-per-pane`, `14-split-chat/kb-highlight-per-pane`,
  `llm/repository-to-hub-admin-workflow`, `sync/workflow-run-sync`. Each covers a
  hidden feature. The last was found by `tsc`, not by my grep — its import was
  relative (`../workflows/helpers/...`) and my pattern only matched `e2e/workflows`.
  PLAN.md amended.

- **DRIFT-1.5** — verdict: impl-wins — ITEM-11 was scoped as "route + slot + page
  + store". Deleting the store breaks `AssistantFormDrawer`, which imports it, so
  the drawer's `isTemplate` branches had to go too (permissions selection, both
  save paths, the title, a field description), along with the drawer state flag,
  the `openAssistantDrawer` parameter, the two `assistant_template.*` store
  subscriptions and the `TemplateAssistants` type registration. All are
  unreachable once the only page that set `isTemplate` is gone. The surviving
  user-assistants path through the same drawer is unchanged and still covered by
  its own e2e. PLAN.md amended.

- **DRIFT-1.6** — verdict: impl-wins — TEST-8's file is
  `registry.test.tsx` (vitest), not `registry.test.ts` (node:test). The registry
  is a `.tsx` module and the node runner cannot load it
  (`ERR_UNKNOWN_FILE_EXTENSION`). TESTS.md amended.

- **DRIFT-1.7** — verdict: resolved — ITEM-10 shipped SIX migrations, not one.
  The plan folded the DEC-4 revokes into the file_rag migration; migrations are
  per-module in this repo, and a revoke belongs beside the grant it undoes. Same
  work, correct placement. Prefixes `202607210200` (the five revoke migrations were withdrawn in round 1 — see DEC-4 REVERSED), above the
  in-flight PR #10 prefix.

- **DRIFT-1.8** — verdict: resolved — TEST-2's composer leg was re-mechanised
  twice, both times because a mutation probe showed the assertion was hollow (see
  the commit body). It now asserts chat-extension REGISTRATION, which is what the
  filter controls, and fails under that probe. No divergence from the plan's
  intent — the plan said "no composer affordance"; this is that claim, made
  falsifiable.

## Reconciliation against the design's invariants

- INV-1 — upheld and now falsifiable: chunk-download absence, no nav/settings
  entry, no 403-rendering route, no chat-extension registration.
- INV-2 — upheld: the survivor spec is entirely positive assertions, and the
  `notifications::read` trap (DEC-4) was caught before it shipped.
- INV-3 — upheld, and strengthened by ITEM-8, which fixed a case where the
  shipped kill switch did not actually make the capability unreachable.
- INV-4 — upheld: `shouldLoad` on all 13 manifests; no slot registration, route
  or component deleted to achieve hiding. The three registry filters are one
  central predicate each, reading the same list — not per-module gating.
- INV-5 — upheld for the reduction (TEST-5 drives all four consumers from an
  injected list); the e2e deletion remains the owner-approved exception recorded
  in DESIGN_FIDELITY.
- INV-6 — upheld: every change is restrictive; nothing is loosened.

**Unresolved drifts:** 0
