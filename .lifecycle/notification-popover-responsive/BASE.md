# BASE — conflict surface vs current main

Branch cut from `origin/main` @ `35d18519f` ("agent-kit: fix the same ledger race
in merge-findings"), sdk submodule pointer `70576db`.

- **Highest existing server migration prefix**: `202607200200`. This branch adds
  **no** migration, so no collision is possible.
- **Desktop migration block**: `10000000000005`. Untouched.
- **OpenAPI regen implied?** No. The diff contains no Rust handler, route, or
  `JsonSchema` type change, so `openapi.json` / `api-client/types.ts` stay put in
  both `src-app/ui` and `src-app/desktop/ui`.
- **Files this branch edits that main may also be editing**:
  - `sdk/packages/notification-ui/src/NotificationBellWidget.tsx`
  - `sdk/packages/notification-ui/src/NotificationItem.tsx`
  Both live in the `sdk` submodule, so the parent-repo conflict surface is a
  ONE-LINE submodule pointer bump. That pointer is the real contention point:
  any other branch that also bumps `sdk` will conflict on it and must be
  re-pointed at a merge of both sdk commits.
- **Known concurrent workstream**: another agent is reworking the ASSISTANT and
  KNOWLEDGE-BASE picker popovers (bounded width/height + search). Those are
  expected to touch `sdk/packages/kit/src/{kit,shadcn}/popover.tsx`. This branch
  deliberately does **not** touch either file (see PLAN "Files to touch"), so the
  only overlap is the `sdk` pointer, which the orchestrator resolves by merging
  both sdk branches and pointing at the merge.
