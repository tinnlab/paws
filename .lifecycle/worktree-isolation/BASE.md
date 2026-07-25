# BASE — conflict-surface scoping

Branch cut off `origin/feat/agent-core` @ `2cd627bea`.

- **Highest migration:** migrations are per-module (decision N7). This feature
  adds **NO migration** — the only DB-adjacent change (audit #7 integration
  template advisory lock) is DESCOPED (ITEM-15), and even if implemented it is a
  runtime `pg_advisory_lock` call, not a schema migration. → no migration-number
  collision surface.
- **OpenAPI regen:** **none** — no handler/route/response-type change. `emit_ts`
  golden parity is unaffected. (The `embedded.rs` changes are internal extract
  logic; the `config.rs` dev-data change is DESCOPED.)
- **Files main is actively changing that this branch also touches:**
  - `src-app/ui/tests/fixtures/port-manager.ts` — just modified by the merged
    `e2e-port-collision` feature (36d9e2f1a). My ITEM-12 EXTENDS it (key-derived
    defaults) building ON that fix; low collision risk (additive).
  - `sdk/` submodule (`ziee-build-support`, `gallery/scripts`) — ITEM-1/2/3/4/5/6
    commit inside the pinned submodule; the parent-repo pointer bump is the only
    parent change. NOTE in report + DECISIONS.
- **Submodule coordination:** SDK changes are committed on the SDK submodule and
  the parent `sdk` pointer is bumped. This is the documented per-app SDK model.
- **No `.lifecycle` collision:** the 5 sibling feature dirs were stripped in a
  dedicated droppable commit (A1) — must be dropped before FF-land onto
  agent-core (they belong there).
