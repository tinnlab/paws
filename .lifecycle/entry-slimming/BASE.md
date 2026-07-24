# BASE — conflict-surface scoping (entry-slimming)

Branch cut from `origin/feat/agent-core` (HEAD `ec00a14de`), per the task brief
(NOT `origin/main`). The lifecycle-check + merge-gate are therefore run with
`--base origin/feat/agent-core` so the diff/coverage is scoped to THIS branch's
changes, not the whole agent-core delta vs main.

- **Highest DB migration:** N/A for this branch — UI-only change, adds **no**
  migration. (No collision possible; `server/migrations` untouched. The
  desktop-tauri migrations top out at `10000000000005_create_host_mounts.sql`,
  also untouched.)
- **openapi.json regen implied?** NO — no backend type/handler change, no new
  route, no new permission. `api-client/types.ts` / `openapi.json` are NOT
  touched.
- **Files main is actively changing that this branch also touches:** the risk set
  is `src-app/ui/vite.config.ts`, `src-app/desktop/ui/vite.config.ts`, and a
  handful of `src-app/ui/src/modules/**` icon-import lines + two elicitation-form
  files. The elicitation forms (`WorkflowElicitForm.tsx`,
  `mcp/chat-extension/components/elicitationFields.tsx`) are the only files with
  non-trivial edits that a concurrent chat/workflow branch might also touch —
  the edit is a localized import + JSX-tag swap, low collision surface.
- **package.json:** removing `react-icons` from both UI workspaces + adding
  `lucide-react` to desktop. `package-lock.json` at the repo root regenerates;
  a concurrent dep bump on another branch could conflict in the lockfile (routine
  lockfile merge).
- **Shared SDK (`sdk/packages/kit`) is NOT modified** — ITEM-3 uses the kit's
  existing deep export `@ziee/kit/kit/date-picker`; the barrel is left intact.
