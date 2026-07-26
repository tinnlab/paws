# BASE — conflict-surface scoping

- **Branch base**: `feat/agent-core` @ `30f12a43e` (== `origin/feat/agent-core`
  at plan time). Merge target: `feat/agent-core` (FF).
- **Highest migration**: `src-app/server/migrations-merged/202607191300_agent_delegate_enabled.sql`.
  This feature adds **NO migration** — no collision possible.
- **OpenAPI regen implied?** NO. No Rust type / handler / route change; no
  `openapi.json` / `api-client/types.ts` regen. Backend is untouched entirely.
- **Files this branch touches that main may also touch**:
  - `src-app/ui/tests/fixtures/test-context.ts` — the e2e harness fixture. Shared
    infra; other e2e-infra branches (`e2e-port-fix`, `e2e-speedup`) have touched
    it. Our edit is additive (a new middleware in the existing
    `configurePreviewServer` hook) — low collision risk, but re-check at merge.
  - `src-app/ui/tests/global-setup.ts` — additive plugin wire-in.
  - `src-app/ui/plugins/*` — new file only (no edit to existing plugins).
  - `src-app/ui/tests/e2e/chat/markdown-rendering.spec.ts` — comment-only removal.
- **Desktop parity**: none. `src-app/desktop/ui/` is NOT touched — this is
  server-UI e2e infra only. No `just openapi-regen`, no desktop override diff.
- **New gate added to `npm run check`?** NO. The change is confined to
  `tests/**` + a build-only plugin used solely by `global-setup.ts`'s e2e build;
  it adds no check to the committed `npm run check` chain (B6 not triggered).
