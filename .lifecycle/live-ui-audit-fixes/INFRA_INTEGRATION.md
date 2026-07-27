# INFRA_INTEGRATION — live-ui-audit-fixes

The per-item UX / infrastructure / entity-lifecycle walks, recorded while
implementing.

## ITEM-1 + ITEM-3 — batched project membership lookup

**UX walk.** A user opens the app; the sidebar (or `/chats`) lists their recent
conversations. Each row wants a "which project is this in?" badge. What the user
SEES must not change at all: a filed row still shows its project tag (with the ×
detach affordance), an unfiled row still shows "Add to project", and both still
appear within the same beat. The only difference is what the network does. On a
touch device (where `ConversationCard` seeds `hoveredOnce = true` because there
is no hover) every row asks at once — that is the burst, and it is the case the
user most feels: 40 requests on a phone connection.

**Infrastructure walk.**
- **Permissions** — the loader's `projects::read` self-gate is BEFORE the batch
  enqueue, so a user without it still issues zero requests (unchanged). The
  endpoint gates on the same permission, so the two agree.
- **Rate limiting** — the per-IP `tower-governor` bucket was being drained by
  this very burst (measured: the audit's baseline run against a rate-limited
  server 429'd `/api/app/setup/status` and rendered the SETUP page instead of the
  app). Collapsing 19→1 request removes a real self-DoS vector, which is why the
  fix is worth a backend endpoint rather than a client-side throttle.
- **OpenAPI / desktop** — the route lives in the shared `ziee` crate's project
  chat-extension, so `ziee-desktop` inherits it; both `openapi.json` +
  `api-client/types.ts` pairs are regenerated (ITEM-2).
- **Sync** — none. This is a read; no `sync_publish`, no new `SyncEntity`. The
  existing `project.conversation_attached/detached` events still drive the
  force-refresh path.
- **Chat extension registry** — `conversationHref` / `conversationBackHref` read
  the membership cache SYNCHRONOUSLY. Batching sits UNDER the cache, so those
  hooks are untouched; the cache is still populated by the same `setCached` call.

**Entity-lifecycle walk (conversation ↔ project membership).**
- *add* — `afterCreateConversation` attaches and seeds the cache with a stub;
  unchanged (no lookup issued).
- *mutate (attach/detach via the modal or the × tag)* — the extension
  force-refreshes that ONE id. With batching that is a window containing one id →
  one request, arriving ~20 ms later than before. Verified by running the
  attach/detach flow (the existing `trailing-badge` e2e drives exactly this) —
  the badge still flips without a reload.
- *remove/delete a conversation* — the card unmounts; a resolver already queued
  for it still settles (the loader always settles every id), so no promise leaks
  and no `setState` on an unmounted component beyond the pre-existing
  `cancelled` guard in `ProjectMembershipTrailing`.
- *access loss / request failure* — the loader resolves `null` rather than
  rejecting, so a failed batch degrades every affected row to "Add to project"
  exactly as the old per-id `.catch(() => null)` did. This was the specific
  hazard flagged in PLAN_AUDIT (a pending promise = a badge spinning forever) and
  is pinned by TEST-5.
- *cross-device (sync) path* — a project attach on another device fires the
  existing `project.conversation_*` event → force refresh → same batching path.

## ITEM-4 + ITEM-5 — shared LLM model catalog

**UX walk.** The user opens any admin settings page with a model picker (memory,
summarization, file-RAG, agent, project defaults) or just opens the app (those
stores init on load). They expect the picker populated with the same models as
before, and no "loading" regression. Nothing visible changes; three round-trips
become one.

**Infrastructure walk.**
- **Permission self-gating** — summarization's `hasPermissionNow(LlmModelsRead)`
  gate stays at the CALL SITE (the catalog does not gate, because different
  callers hold different permissions). A user who can view summarization settings
  but lacks `llm_models::read` still issues no request — the no-403-on-reconnect
  rule is preserved.
- **Freshness** — the only staleness window is 2 s. `invalidateLlmModelCatalog()`
  is exported for any future mutation path that needs the very next read fresh.
- **Provider-scoped loads** — `llm-provider`'s `?provider_id=` calls are NOT
  routed through the catalog: they are a different query and sit next to the
  model mutations, where caching would be wrong.
- **Filter parity** — replacing the server's `?capability=` with a client filter
  is only safe because the server rule is `capabilities.<cap> === true` with
  absent/false/non-bool all excluded; reproduced exactly and pinned by TEST-7's
  sibling filter tests.

## ITEM-6 — accent swatch

**UX walk.** The user opens Settings → Appearance in dark mode and picks an
accent. Before: every swatch showed its LIGHT value, so the swatch they clicked
was NOT the colour the app then used — a picker lying about its own outcome.
After: the swatch shows the exact fill `applyAccent` installs, and the selected
check uses that variant's AA-tuned foreground instead of a fixed white (the dark
variants are LIGHT fills, on which white barely reads).

**Infrastructure walk.**
- **ThemeProvider** — `useTheme()` throws outside a provider. The component
  gallery mounts every surface under the app's real `ThemeProvider`
  (`@ziee/gallery` `mount.tsx`), and `settings-general`'s gallery entry is
  `crawlOnly` (driven through the booted route), so both the app and the gallery
  satisfy it.
- **`system` preference** — `resolvedTheme` is already the collapsed light/dark
  value, so a user on "system" gets the correct swatch for whatever the OS says,
  and it re-renders when the provider's resolution changes.
- **Colour lint** — the inline `style` keeps its `data-allow-custom-color`
  marker (a swatch IS the documented genuinely-dynamic-colour case); the new
  inline colour on the check icon carries the same marker for the same reason.
