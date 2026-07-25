# BASE — conflict-surface scoping

- **Branch base:** `origin/feat/agent-core` @ `49ec62d77` (includes the landed
  integration).
- **Highest migration:** N/A for this branch — this feature adds NO migration.
  (Server migrations are unaffected; the only migrations dir touched by nothing
  here.)
- **Files this branch touches that main is also changing:** none expected. The
  change is confined to `src-app/ui/tests/fixtures/{port-manager,test-context}.ts`
  plus one new test file. These test-harness fixtures are not part of any active
  main feature workstream.
- **OpenAPI regen implied:** NO. No Rust type or handler changes; no
  `openapi.json` / `api-client/types.ts` regen.
- **SDK submodule:** NOT touched. All changes are under `src-app/ui/tests/`.
- **Collision risk:** low. A merge conflict could only arise if another branch
  edits the same two fixture files; the reference fix already proved cleanly
  against this base.
