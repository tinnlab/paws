# BASE.md — conflict surface for `activity-rail`

Branch: `feat/activity-rail`
Base: `origin/feat/agent-core` @ `b29adbad5` (NOT `origin/main` — the standing constraint is that we
do not merge to main; agent-core is the integration line and main is only ever pulled *in*).

Gate invocation for every phase — the default base is wrong for this repo:

```bash
node .claude/lifecycle/lifecycle-check.mjs --phase N \
  --repo /data/pbya/ziee/tmp/activity-rail-wt \
  --base origin/feat/agent-core
```

Without `--base`, the checker defaults to `origin/main` and attributes the whole accumulated
agent-core diff to this branch.

## Migrations — the documented location is stale

`CLAUDE.md` and the feature-lifecycle skill both say to check `ls src-app/server/migrations | tail -1`.
**That directory does not exist on this base.** Migrations are now **per-module and timestamp-named**:

- location: `src-app/server/src/modules/<module>/migrations/YYYYMMDDHHMM_<name>.sql`
- count: **99** files across 38 module directories
- highest timestamp anywhere: **`202607191300`**
- nearest neighbours in the modules we may touch:
  - `mcp/migrations/202607191100_mcp_tool_approval_defaults.sql` (most recent in `mcp`)
  - `chat/migrations/202607146010_chat_grant_permissions.sql` (most recent in `chat`)

**Collision expectation: none.** The rail is a frontend rendering concern. A migration would only be
needed if we add persisted per-step timing/telemetry — and per the detail-visibility work, duration data
may already exist on `mcp_tool_calls`. If a migration does become necessary it must be timestamped
later than `202607191300` and placed in the owning module's own `migrations/` dir, not a central one.

## Files this branch will touch that the base is actively changing — REAL collision risk

These three are the hottest files on the branch and are exactly the ones a rail must modify:

| File | Last changed on base | Risk |
|---|---|---|
| `src-app/ui/src/modules/chat/core/extensions/registry.tsx` | **2026-07-26** (`a02c09a04`) | HIGH — the rail adds a contribution registry alongside `contentTypeRegistry` |
| `src-app/ui/src/modules/mcp/chat-extension/extension.tsx` | **2026-07-26** (`0a7c2c20f`) | HIGH — the group card is absorbed/retired here |
| `src-app/ui/src/modules/chat/components/ChatMessage.tsx` | 2026-07-24 (`95b0f3708`) | MED — the run-loop is where spans get segmented |

Recent base commits in this area, showing the churn is ongoing rather than historical:
`24ce5dcca` (awaitable repo load, composer text loss), `a02c09a04` (stranded streaming + Qwen),
`4d84ebdfb` (bounded approval card), `7bb34e223` (eliminate hooks-in-a-loop in extension aggregators),
`408108ed4` (lazy-load on-demand chat-extension surfaces).

**Mitigation:** rebase onto `origin/feat/agent-core` before each phase gate and again before landing;
keep the registry change *additive* (a new registry beside the existing one, not a rewrite of
`renderContent`) so a concurrent edit to renderer resolution merges cleanly.

## OpenAPI regen — **REQUIRED** (revised after the detail-visibility sweep)

Initially assessed as "not expected". The sweep flipped it. Per-step **duration** is the rail's core
metadata, and it exists in exactly one place:

| Source | Has timing? |
|---|---|
| `mcp_tool_calls` (`started_at`, `finished_at`, **`duration_ms`**) | ✅ persisted, surfaced only as a Duration column in an admin drawer |
| chat SSE `mcpToolStart` / `mcpToolComplete` frames | ❌ no timestamps, no duration |
| persisted `tool_use` / `tool_result` blocks | ❌ |

So a live step cannot show its own duration, and a reloaded one cannot either without a join. Both
halves are needed — the DB join alone loses the in-flight case, the frame alone loses everything after
reload. Adding `started_at`/`duration_ms` to `mcpToolComplete` is a **backend response-type change**:

- `just openapi-regen` must run for **both** binaries (→ `ui/` and `desktop/ui/`),
- the `openapi::emit_ts::tests::types_ts_parity` golden test must stay green,
- `openapi.json` last changed 2026-07-26 (`a49d48271`) — treat it as a live conflict surface too.

Two further backend changes are likely, both additive:
- a `tool_use_id` / `message_id` **filter** on `GET /api/mcp/tool-calls` (both columns are already
  persisted and on the DTO, but there is no filter and **no index** on either — an index migration
  would be the one migration this feature needs, timestamped later than `202607191300`),
- relaxing the `is_system` gate that today prevents a **non-admin from seeing any built-in server's
  call history** (memory, web_search, knowledge_base, code_sandbox, citations, …).

Path note confirmed by the sweep: `src-app/server/migrations/` does not exist; the authoritative
location is `modules/<mod>/migrations/`, with a generated `src-app/server/migrations-merged/`.

## Submodules

`sdk` @ `b47effa1`, `agent-kit` @ `925cef24`, `pgvector` @ `cab9da72`. **No submodule change is
expected.** If a fix turns out to belong in `sdk` (store-kit / shell), it must be pushed to sdk's
pinned branch *before* the superproject pointer moves, or the gitlink dangles.

## Environment

`bash .claude/lifecycle/preflight.sh` → **OK** after two fresh-worktree fixes that are not automatic:
hub-seed copied from a warm worktree (`hub_version 2.0.0`; the build *panics* without it) and
`npm install` at the repo root. Submodules also had to be initialised before `.claude/lifecycle/`
resolved at all — it is a symlink into `agent-kit`.
