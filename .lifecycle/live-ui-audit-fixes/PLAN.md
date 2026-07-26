# PLAN — live-ui-audit-fixes

Fix the real defects surfaced by the `live-ui-audit` proof run against a live
ziee instance, and PROVE each fix with the audit itself (before → after signals).

## Design source

- Realizes `.lifecycle/live-ui-audit-fixes/AUDIT_BASELINE_1520.md` — the verbatim
  `live-ui-audit` finding report (308 deduped findings) produced against the live
  app at `http://127.0.0.1:1520`; specifically the `overflow-x`, `network/n+1`,
  `network/duplicate` and `palette-drift` rows.
- Realizes `agent-kit/skills/live-ui-audit/SKILL.md` §"The check battery"
  dimensions 2/3 (UI + responsive), 4 (color/theme) and 6 (network hygiene) — the
  definitions of the signals the fixes must silence.
- Realizes `DESIGN_SYSTEM.md` (repo root) §"Semantic color tokens" — the
  never-hardcode-a-color contract that the accent-swatch drift violates.
- Realizes `.claude/skills/feature-lifecycle/SKILL.md` §"UI surfaces additionally
  require these angles" → `responsive-fidelity` and `scale-performance`.

## Invariants

- **INV-1**: "**responsive-fidelity** — verify the surface at ~390px / tablet /
  desktop: no horizontal page scroll, no clipped/overlapping content, adequate
  tap targets, and breakpoint behavior matching its sibling. Desktop-only =
  defect." (verbatim, `.claude/skills/feature-lifecycle/SKILL.md`)
- **INV-2**: "`n+1` (many ids on one endpoint template in a burst)" is a network
  hygiene DEFECT the battery reports. (verbatim, `live-ui-audit/SKILL.md` §6)
- **INV-3**: "`duplicate` (same url+method ≥2× in a step)" is a network hygiene
  DEFECT the battery reports. (verbatim, `live-ui-audit/SKILL.md` §6)
- **INV-4**: "**Always use a semantic color token class — never a raw Tailwind
  hue** (`bg-blue-500`), an arbitrary value (`bg-[#1e90ff]`), or an inline `style`
  color: those bypass the accent + dark-mode system and are the root cause of
  visual drift." (verbatim, `DESIGN_SYSTEM.md`)
- **INV-5**: "**Evidence-based, objective signals only.**" — every claimed fix is
  proven by re-running the same battery against a build of this branch and showing
  the finding's measured signal is gone; a finding that does not REPRODUCE on this
  branch is reported as a stale-build artifact with its own measurement, never
  silently claimed as "fixed". (verbatim first clause, `AUDIT_BASELINE_1520.md`
  header; second clause is this plan's binding reading of it)

## Items

- **ITEM-1**: Backend — batch reverse-lookup endpoint
  `POST /api/projects/by-conversations` (`{ conversation_ids: [uuid] }` →
  `{ links: [{ conversation_id, project }] }`), owner-scoped, gated
  `projects::read`, hard-capped at 200 ids per call (422 over cap). Repository
  `get_for_conversations` does ONE `WHERE pc.conversation_id = ANY($1) AND
  p.user_id = $2` query (no loop, no N+1 on the server side either).
- **ITEM-2**: Regenerate OpenAPI + `api-client/types.ts` for BOTH `src-app/ui`
  and `src-app/desktop/ui` (`just openapi-regen`).
- **ITEM-3**: Frontend — turn the projects chat-extension's per-conversation
  lookup into a request-batching loader: ids requested inside one 20 ms window
  coalesce into ONE `by-conversations` call (chunked at the 200 cap), preserving
  the existing cache / in-flight-dedup / `projects::read` self-gate semantics and
  the `forceRefresh` path.
- **ITEM-4**: Frontend — shared LLM-model catalog
  (`src-app/ui/src/core/llmModelCatalog.ts`): one in-flight-coalesced +
  short-TTL `GET /api/llm-models?page=1&perPage=200` fetch, plus a client-side
  `capability` filter that reproduces the server's `capabilities.<cap> === true`
  semantics exactly.
- **ITEM-5**: Migrate every full-catalog `ApiClient.LlmModel.list` caller
  (memory-admin ×2, summarization-admin, file-rag embedding + reranker,
  onboarding memory-setup, agent-admin-settings, ProjectDefaultsForm) onto the
  shared catalog. Provider-scoped calls in `llm-provider` are OUT of scope (they
  filter by `provider_id`, are not the duplicate, and must stay uncached).
- **ITEM-6**: Frontend — the Settings→Appearance accent swatch must preview the
  accent in the RESOLVED theme: background = `def[resolvedTheme].primary` and the
  selected check = `def[resolvedTheme].fg`, instead of always the `light`
  variant + `text-white`.
- **ITEM-7**: Reproduce the `overflow-x` / `clipped-control` HIGH+MEDIUM
  geometry findings against a CORRECT build of this branch; fix the offending
  element if real, otherwise name the mechanism that produced them at `:1520`
  with measurements. Ship a **regression guard** either way: a 390 px
  no-horizontal-overflow e2e assertion on the conversation view, so the class of
  defect cannot land silently later.
- **ITEM-8**: Prove the fixes with the audit: run the identical battery against a
  build of this branch BEFORE and AFTER, same backend + same data, and record the
  per-finding before→after signal in `TEST_RESULTS.md`.

## Files to touch

- `src-app/server/src/modules/project/repository.rs` — `get_for_conversations`
- `src-app/server/src/modules/project/chat_extension/handlers.rs` — batch handler + docs
- `src-app/server/src/modules/project/chat_extension/routes.rs` — route
- `src-app/server/src/modules/project/types.rs` — request/response types
- `src-app/ui/openapi/openapi.json`, `src-app/ui/src/api-client/types.ts` (generated)
- `src-app/desktop/ui/openapi/openapi.json`, `src-app/desktop/ui/src/api-client/types.ts` (generated)
- `src-app/ui/src/modules/projects/chat-extension/extension.tsx`
- `src-app/ui/src/core/llmModelCatalog.ts` (new — ApiClient wiring)
- `src-app/ui/src/core/coalescedLoader.ts` (new — the generic coalescer; split out so it is unit-testable without the generated ApiClient; see DRIFT-1.1)
- `src-app/ui/src/core/llmModelCapabilities.ts` (new — the pure server-parity capability filter; same reason)
- `src-app/ui/src/modules/projects/chat-extension/projectLookupBatch.ts` (new — the batching loader; see DRIFT-1.2)
- `src-app/ui/src/modules/settings-general/components/accentSwatch.ts` (new — the pure per-theme swatch colour helper)
- `src-app/ui/src/modules/memory/stores/memoryAdmin/actions/loadCandidateModels.ts`
- `src-app/ui/src/modules/summarization/stores/summarizationAdmin/actions/_doLoadModels.ts`
- `src-app/ui/src/modules/file-rag/stores/fileRagAdmin/actions/loadEmbeddingModels.ts`
- `src-app/ui/src/modules/file-rag/stores/fileRagAdmin/actions/loadRerankerModels.ts`
- `src-app/ui/src/modules/onboarding/guides/getting-started/components/memorySetupStep/actions/loadEmbeddingCapableModels.ts`
- `src-app/ui/src/modules/agent/stores/AgentAdminSettings.store.ts`
- `src-app/ui/src/modules/projects/components/ProjectDefaultsForm.tsx`
- `src-app/ui/src/modules/settings-general/components/ThemeSettings.tsx`
- tests: `src-app/server/tests/project/*`, in-source `#[cfg(test)]`,
  `src-app/ui/tests/e2e/**`

## Patterns to follow

- **Batch endpoint** — mirror the sibling in the SAME file:
  `project/chat_extension/handlers.rs::project_for_conversation` (its
  `RequirePermissions<(ProjectsRead,)>` extractor, its always-200 "unfiled is
  data, not an error" contract, its `_docs` shape with `.id("Project.…")`,
  `.tag("Projects")`, `.description(...)`, 401/403 responses). Route registered in
  the same `project_conversation_routes()` builder. All SQL in
  `project/repository.rs` next to `get_for_conversation`.
- **Over-cap status** — 422, mirroring the project file-attach cap
  (`Combined upload returns 422 (not 400) when the 100-file cap is hit`,
  CLAUDE.md §Chat Projects/API).
- **Frontend loader** — keep the existing module-local cache/in-flight maps in
  `projects/chat-extension/extension.tsx` (documented dedup rationale stays);
  add batching around them, do not introduce a store (the extension deliberately
  owns this cache so the synchronous URL hooks can read it).
- **Shared fetch utility** — `src-app/ui/src/core/` (sibling of `core/sync`,
  `core/permissions`): a plain module-level helper, NOT a store — avoids the
  "no cross-module store access" anti-pattern while still de-duplicating.
- **Accent swatch** — `useTheme()` from `@ziee/shell` already exposes
  `resolvedTheme`; `ACCENT_PRESETS[id].{light,dark}` already carry per-theme
  `primary` + `fg`. Keep the existing `data-allow-custom-color` opt-out (a swatch
  IS genuinely-dynamic color — the bug is picking the wrong variant, not using
  an inline style).
