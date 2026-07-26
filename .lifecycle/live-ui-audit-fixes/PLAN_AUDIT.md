# PLAN_AUDIT — live-ui-audit-fixes

Audited against the codebase at `feat/live-ui-audit-fixes` (base
`feat/agent-core` @ `60b0db310`).

## Breakage risk

- **ITEM-1 (new endpoint)** — additive only. `GET
  /api/projects/by-conversation/{conversation_id}` stays; its one remaining
  frontend caller (`projects/stores/projects/actions/attachConversation.ts`)
  is untouched. New path `/projects/by-conversations` cannot shadow the existing
  `/projects/{id}` routes: axum matches the literal segment before the `{id}`
  capture, and `by-conversation` (singular) already proves that pattern works.
- **ITEM-3 (batching loader)** — the extension's public surface
  (`conversationHref`, `conversationBackHref`, `onConversationLoad`,
  `renderConversationCardTrailing`, `slots.message_list_header`) is unchanged;
  only the private `loadProjectForConversation` gains batching. Its contract
  (returns `Promise<Project | null>`, populates `conversationProjectCache`,
  swallows errors as `null`) must be preserved EXACTLY — `conversationHref` reads
  the cache synchronously and a behavior change there silently breaks
  project-scoped chat URLs.
  Risk: a rejected batch request must resolve EVERY id in the batch as `null`
  (never leave a promise pending) or `ProjectMembershipTrailing` spins forever.
- **ITEM-4/5 (catalog)** — a shared TTL cache can serve a stale list to a picker.
  Bounded by a short TTL + a `force` escape hatch; provider-scoped model loads in
  `llm-provider` are deliberately NOT routed through it (they are the mutation-
  adjacent path and must stay uncached).
  Risk: the server applies `?capability=` as `capabilities.<cap> === true`
  (`llm_model/handlers/models.rs`, `serde_json … as_bool().unwrap_or(false)`);
  the client-side filter must reproduce that exactly, including "absent ⇒ false".
- **ITEM-6 (accent swatch)** — pure presentation; `setAccentPreset` and
  `applyAccent` are untouched, so what the click DOES is unchanged. Only the
  preview color changes (from always-light to resolved-theme).

## Pattern conformance

- **ITEM-1** mirrors `project_for_conversation` in the SAME file for the
  extractor (`RequirePermissions<(ProjectsRead,)>`), the always-200 shape, and
  the `_docs` transform (`.id("Project.…")`, `.tag("Projects")`, `.summary`,
  `.description`, 401/403). SQL lives in `project/repository.rs` beside
  `get_for_conversation` (CODING_GUIDELINES §9: no `sqlx::query` in handlers).
  Owner scoping is the same `AND p.user_id = $2` clause → a foreign conversation
  is simply absent from `links` (never an error, never a leak).
- **ITEM-1 cap** — 422 over-cap mirrors the documented project file-cap
  convention (CLAUDE.md §Chat Projects: "Combined upload returns **422** (not
  400) when the 100-file cap is hit").
- **ITEM-3** keeps the module-local cache maps the file already documents at
  length; no new store (the file's own comment explains the cache must be
  readable synchronously by `conversationHref`).
- **ITEM-4** lands in `src-app/ui/src/core/` next to `core/sync`,
  `core/permissions` — a plain module, not a store, so no cross-module store
  read is introduced (CODING_GUIDELINES §9 frontend).
- **ITEM-6** uses `useTheme().resolvedTheme` from `@ziee/shell` — the same source
  `ThemeProvider` itself uses to decide `isDarkMode`.

## Migration collisions

None. This feature adds **no migration** (see BASE.md) — a pure read over the
existing `project_conversations` join, reusing the existing `projects::read`
permission. No permission grant, so no A9/A10 new-permission obligation is
triggered.

## OpenAPI regen

**Required.** ITEM-1 adds one path + three schemas
(`ProjectsByConversationsRequest`, `ConversationProjectLink`,
`ProjectsByConversationsResponse`) and one `operationId`
(`Project.forConversations`). `just openapi-regen` must run for BOTH
`src-app/ui/` and `src-app/desktop/ui/`; the `emit_ts` golden parity test
(`openapi::emit_ts::tests::types_ts_parity`) fails otherwise. `ApiClient` gains
`Project.forConversations` mechanically — no generator change needed (it is a
plain POST with a JSON body, the same shape as existing POST endpoints).

## Per-item verdicts

- **ITEM-1** — verdict: PASS — mirrors `project_for_conversation` +
  `get_for_conversation` one file over; single `= ANY($1)` query, no new
  migration, no new permission.
- **ITEM-2** — verdict: PASS — mechanical; `just openapi-regen` covers both
  workspaces (memory: `project_openapi_regen_both_binaries`).
- **ITEM-3** — verdict: CONCERN — must preserve the documented cache/in-flight
  contract exactly and guarantee every batched id settles (including on HTTP
  failure) or a card spins forever. Covered by TEST-6/TEST-7.
- **ITEM-4** — verdict: CONCERN — the client-side capability filter must
  reproduce the server's `as_bool().unwrap_or(false)` semantics; and the TTL
  must be short enough that an admin editing models is not shown a stale
  picker. Resolved in DEC-3 / DEC-4, covered by TEST-8.
- **ITEM-5** — verdict: PASS — mechanical call-site migration; each caller keeps
  its own permission self-gate and its own row-mapping.
- **ITEM-6** — verdict: PASS — presentation-only; `data-allow-custom-color`
  opt-out is retained because a swatch IS genuinely-dynamic color.
- **ITEM-7** — verdict: CONCERN — the measured evidence (below) says the
  `:1520` geometry findings do NOT reproduce on a correct build of this branch,
  so there may be nothing to fix. The item is still real work: prove it, name
  the mechanism, and leave a regression guard.
- **ITEM-8** — verdict: PASS — the audit battery is URL+creds driven; running it
  twice against one backend with identical flags is the intended usage.

## Evidence gathered during this audit (pre-implementation)

Measured on a FRESH build of this branch (`src-app/dist/ui`, served at `:1531`
against the live backend `:29185`) with the identical battery
(`--jtbd=home,compose-send,adversarial-compose,browse-settings
--viewports=390,768,1280 --themes=light,dark`), out at
`/data/pbya/ziee/tmp/luif/audit-before`:

| `:1520` finding | this branch, correct build |
|---|---|
| `overflow-x` ×2 (HIGH, `body scrollWidth 419 > 390`) | **0 occurrences** |
| `clipped-control` ×7 (MEDIUM) | **0 occurrences** |
| `page-error` "Message cannot be empty" | **0 occurrences** |
| `network/n+1` `GET /api/projects/by-conversation/{id}` | **23 occurrences** (reproduces) |
| `network/duplicate` `GET /api/llm-models` 3× | reproduces in `home`, `compose-send`, `browse-settings` |
| `palette-drift` accent swatches | **8 occurrences** (reproduces, incl. the named `settingsgen-accent-blue` rgb(58,92,161) in all three dark cells) |

Root cause of the vanished geometry findings, measured directly at `:1520`:
its `index.html` links `assets/index-CszcZvgH.css` — a **27 KB** chunk whose
first bytes are the OverlayScrollbars license header and which contains **no**
`.sr-only`, `.fixed`, `.min-w-0`, `.flex-1`, `.overflow-x-clip` rule (verified
by walking `document.styleSheets` in the live page: zero matching rules). With
those utilities missing, the `sr-only` skip link became a 61 px flex item, the
sidebar toggle lost `position: fixed`, and `main` lost `flex-1 min-w-0` → its
min-content width (330 px) plus the 89 px of in-flow chrome = the reported
419 px. A fresh build of the same source emits `assets/index-VB5WfW6c.css`
(214 KB) containing all of them, and measures `body.scrollWidth === 390` with
zero overflowing elements. → stale/partial dist, not a source defect.
