# BASE — conflict-surface scoping

- **Branch base:** `fix/streamdown-html-renderer` off `feat/e2e-render-serving`
  @ `ab94657d2` (which is off `feat/agent-core`). Intended merge target:
  `feat/agent-core`.
- **Highest migration:** N/A — this is a **UI-only** change (no
  `src-app/server` or `src-app/desktop/tauri` diff), so no migration, no
  build.rs impact, no migration-number collision surface.
- **OpenAPI regen implied?** No — no backend type/handler change, so no
  `openapi.json` / `api-client/types.ts` regen. Not treated as UI-vs-backend
  cross work by the gates (frontend-only).
- **Files main is actively changing that this branch also touches:** the chat
  markdown render utilities (`LazyStreamdown.tsx`, `chatMarkdownPlugins.ts`) and
  `markdown-rendering.spec.ts`. These are stable on the base; the change is
  additive (a new `chatCodeRenderers.tsx` + a small wrapper edit) to minimise
  conflict surface. The product fix is real app code and the test fix is e2e —
  both land onto `feat/agent-core`.
- **SDK submodule:** not touched (`sdk/` unchanged).
