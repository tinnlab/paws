-- mcp module: index `mcp_tool_calls` for the transcript→history lookup (ITEM-13).
--
-- The activity rail joins a chat message's `tool_use` blocks to their recorded
-- invocations so a step can show duration / source / result size — data that is
-- otherwise unreachable from a message. That join needs two new filters on
-- `GET /api/mcp/tool-calls`: `?tool_use_id=` (one step) and `?message_id=` (the
-- whole rail for one assistant turn).
--
-- Neither column was indexed. The table already carries five indexes
-- (`conversation_id`, `created_at`, `server_id`, `(user_id, created_at DESC)`,
-- `workflow_run_id`) — none of which serves either lookup, so both filters would
-- otherwise degrade to a sequential scan over an accumulating, retention-bounded
-- history table.
--
-- Both are PARTIAL (`WHERE ... IS NOT NULL`), matching the existing
-- `idx_mcp_tool_calls_conv` / `idx_mcp_tool_calls_workflow_run` style: a
-- REST- or workflow-sourced row has neither column set, so those nulls are dead
-- weight in a full index. The queries always compare against a non-null value, so
-- the partial predicate is trivially implied and the planner can use the index.
--
-- ── Why NOT `CREATE INDEX CONCURRENTLY` (coding-guidelines §4) ────────────────
-- CONCURRENTLY is unusable in this repo's migration runner, verified rather than
-- assumed. sqlx honours a leading `-- no-transaction` directive (sqlx-core
-- `migrate/source.rs` keys `Migration::no_tx` off exactly that prefix), and with
-- it set `sqlx-postgres` skips the wrapping transaction. But it then executes the
-- ENTIRE migration file as ONE simple-query string (`migrate.rs::execute_migration`
-- → `conn.execute(&*migration.sql)`), and PostgreSQL runs a multi-statement simple
-- query inside an IMPLICIT transaction block — so the attempt fails with exactly
-- `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`. (Observed on
-- this migration during development.)
--
-- Splitting into one statement per file WOULD work, but is not worth it here:
-- there is zero in-tree precedent for CONCURRENTLY across ~150 migrations;
-- migrations run at boot BEFORE the server accepts traffic, so the SHARE lock a
-- plain CREATE INDEX takes blocks no request this process would serve; and a
-- failed CONCURRENTLY leaves an INVALID index that `IF NOT EXISTS` would then skip
-- forever, silently keeping the sequential scan. Plain, transactional, idempotent
-- DDL is the correct trade here. Revisit if this table ever needs an index added
-- against a live multi-writer deployment.

CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_tool_use
    ON public.mcp_tool_calls USING btree (tool_use_id)
    WHERE (tool_use_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_message
    ON public.mcp_tool_calls USING btree (message_id)
    WHERE (message_id IS NOT NULL);
