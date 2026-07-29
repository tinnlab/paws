-- Reproducible EXPLAIN harness for FIX_ROUND-2 finding #1
-- ("do the 202607200100 partial indexes actually get used?").
--
-- Usage — against a SCRATCH clone of an already-migrated ziee database. It
-- inserts 300 000 rows and rewrites every row's owner in section F, so NEVER
-- point it at a real deployment or at a build DB you still want:
--
--   createdb -h 127.0.0.1 -p 54321 -U postgres -T ziee_build_<key> ziee_railfix_explain
--   psql -h 127.0.0.1 -p 54321 -U postgres -d ziee_railfix_explain \
--        -f explain-mcp-tool-calls.sql
--
-- Fixture: 300 000 rows / 200 users / 4 000 conversations. 70 % chat-sourced
-- (tool_use_id + message_id set), 30 % rest/workflow (both NULL) — the exact
-- population split the migration's partial predicate is built around.
--
-- Every plan is taken through PREPARE/EXECUTE, never with literals inlined,
-- because sqlx speaks the EXTENDED protocol: it PREPAREs the `query_as!`
-- statement once per connection and re-EXECUTEs it. That is the only way to
-- observe the custom-plan / generic-plan split the finding turns on.
--
-- Observed output is transcribed in FIX_ROUND-2.md (PostgreSQL 18.4).

\pset pager off
SET session_replication_role = replica;  -- bypass FK triggers for the synthetic fixture

TRUNCATE mcp_tool_calls;
INSERT INTO mcp_tool_calls (
  id, server_id, server_name, is_built_in, user_id, conversation_id, branch_id,
  message_id, tool_use_id, tool_name, arguments_json, source, status, is_error,
  result_json, content_kinds, result_bytes, error_message, started_at, finished_at,
  duration_ms, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  ('00000000-0000-4000-8000-' || lpad(((g % 12)+1)::text, 12, '0'))::uuid,
  'server-' || (g % 12),
  (g % 3 = 0),
  ('00000000-0000-4000-9000-' || lpad(((g % 200)+1)::text, 12, '0'))::uuid,
  ('00000000-0000-4000-a000-' || lpad(((g % 4000)+1)::text, 12, '0'))::uuid,
  NULL,
  CASE WHEN g % 10 < 7 THEN ('00000000-0000-4000-b000-' || lpad(((g/3)+1)::text, 12, '0'))::uuid ELSE NULL END,
  CASE WHEN g % 10 < 7 THEN 'toolu_' || lpad(g::text, 20, '0') ELSE NULL END,
  'tool_' || (g % 45),
  '{"a":1}'::jsonb,
  CASE WHEN g % 10 < 7 THEN 'chat' WHEN g % 10 = 7 THEN 'rest' ELSE 'workflow' END,
  'completed', false, '{"r":1}'::jsonb, ARRAY['text']::text[], 128, NULL,
  now() - (g % 90) * interval '1 day',
  now() - (g % 90) * interval '1 day' + interval '2 second',
  2000,
  now() - (g % 90) * interval '1 day',
  now() - (g % 90) * interval '1 day'
FROM generate_series(1, 300000) g;

-- The two statements sqlx prepares (repository.rs::list_calls_for_user),
-- reduced to the projected columns that matter for planning.
PREPARE page (uuid, uuid, uuid, bool, text, uuid, bigint, bigint) AS
SELECT id, server_id, user_id, message_id, tool_use_id, tool_name, created_at
FROM mcp_tool_calls
WHERE user_id = $1
  AND ($2::uuid IS NULL OR server_id = $2)
  AND ($3::uuid IS NULL OR conversation_id = $3)
  AND ($4::bool IS NULL OR is_built_in = $4)
  AND ($5::text IS NULL OR tool_use_id = $5)
  AND ($6::uuid IS NULL OR message_id = $6)
ORDER BY created_at DESC
LIMIT $7 OFFSET $8;

PREPARE cnt (uuid, uuid, uuid, bool, text, uuid) AS
SELECT COUNT(*) FROM mcp_tool_calls
WHERE user_id = $1
  AND ($2::uuid IS NULL OR server_id = $2)
  AND ($3::uuid IS NULL OR conversation_id = $3)
  AND ($4::bool IS NULL OR is_built_in = $4)
  AND ($5::text IS NULL OR tool_use_id = $5)
  AND ($6::uuid IS NULL OR message_id = $6);

-- ═════════════ A. pre-migration baseline (no tool_use/message index) ═════════
DROP INDEX IF EXISTS idx_mcp_tool_calls_tool_use;
DROP INDEX IF EXISTS idx_mcp_tool_calls_message;
DROP INDEX IF EXISTS idx_mcp_tool_calls_user_tool_use;
DROP INDEX IF EXISTS idx_mcp_tool_calls_user_message;
ANALYZE mcp_tool_calls;
\echo '######## A — NO tool_use/message index (what the migration exists to fix) ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);

-- ═════════════ B. the indexes as first shipped (single column) ═══════════════
CREATE INDEX idx_mcp_tool_calls_tool_use ON public.mcp_tool_calls USING btree (tool_use_id) WHERE (tool_use_id IS NOT NULL);
CREATE INDEX idx_mcp_tool_calls_message  ON public.mcp_tool_calls USING btree (message_id)  WHERE (message_id  IS NOT NULL);
ANALYZE mcp_tool_calls;
\echo '######## B1 — single-column partial, CUSTOM plan (?tool_use_id=, per_page=1) ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
\echo '######## B2 — single-column partial, GENERIC plan ########'
SET plan_cache_mode = force_generic_plan;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
RESET plan_cache_mode;
\echo '######## B3 — single-column partial, COUNT, CUSTOM plan ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE cnt('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL);
\echo '######## B4 — single-column partial, ?message_id=, CUSTOM plan ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,NULL,'00000000-0000-4000-b000-000000000001'::uuid,50,0);

-- ═══════ C. both shapes present — which does the planner actually choose? ════
CREATE INDEX idx_mcp_tool_calls_user_tool_use ON public.mcp_tool_calls USING btree (user_id, tool_use_id) WHERE (tool_use_id IS NOT NULL);
CREATE INDEX idx_mcp_tool_calls_user_message  ON public.mcp_tool_calls USING btree (user_id, message_id)  WHERE (message_id  IS NOT NULL);
ANALYZE mcp_tool_calls;
\echo '######## C — BOTH shapes present, CUSTOM plan (does the composite win?) ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);

-- ═══════════════ D. composite alone (what 202607200200 ships) ════════════════
DROP INDEX idx_mcp_tool_calls_tool_use;
DROP INDEX idx_mcp_tool_calls_message;
ANALYZE mcp_tool_calls;
\echo '######## D1 — composite partial, CUSTOM plan (?tool_use_id=, per_page=1) ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
\echo '######## D2 — composite partial, GENERIC plan (unchanged: no index shape rescues it) ########'
SET plan_cache_mode = force_generic_plan;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
RESET plan_cache_mode;
\echo '######## D3 — composite partial, COUNT, CUSTOM plan ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE cnt('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL);
\echo '######## D4 — composite partial, ?message_id=, CUSTOM plan ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,NULL,'00000000-0000-4000-b000-000000000001'::uuid,50,0);
\echo '######## D5 — composite partial, UNFILTERED History page (regression check) ########'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,NULL,NULL,50,0);

-- ═══ E. what plan_cache_mode='auto' compares, and what it actually picks ═════
\echo '######## E1 — COSTS: the three custom shapes vs the generic plan ########'
EXPLAIN EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
EXPLAIN EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,NULL,NULL,50,0);
EXPLAIN EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,NULL,NULL,200,0);
SET plan_cache_mode = force_generic_plan;
EXPLAIN EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
RESET plan_cache_mode;
\echo '######## E2 — under DEFAULT auto: 7 executions, then explain the 8th ########'
SHOW plan_cache_mode;
EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);

\echo '######## E3 — index sizes (composite vs the superseded single-column pair) ########'
CREATE INDEX idx_mcp_tool_calls_tool_use ON public.mcp_tool_calls USING btree (tool_use_id) WHERE (tool_use_id IS NOT NULL);
CREATE INDEX idx_mcp_tool_calls_message  ON public.mcp_tool_calls USING btree (message_id)  WHERE (message_id  IS NOT NULL);
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes WHERE relname='mcp_tool_calls' ORDER BY 1;
DROP INDEX idx_mcp_tool_calls_tool_use;
DROP INDEX idx_mcp_tool_calls_message;

-- ══════ F. the DESKTOP shape: one user owns every row (destroys the fixture) ══
\echo '######## F — DESKTOP shape: a single user owns all 300 000 rows ########'
UPDATE mcp_tool_calls SET user_id = '00000000-0000-4000-9000-000000000002'::uuid;
VACUUM ANALYZE mcp_tool_calls;
\echo '-- F1: composite present --'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
\echo '-- F2: no tool_use/message index at all --'
DROP INDEX idx_mcp_tool_calls_user_tool_use;
DROP INDEX idx_mcp_tool_calls_user_message;
ANALYZE mcp_tool_calls;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE page('00000000-0000-4000-9000-000000000002'::uuid,NULL,NULL,NULL,'toolu_00000000000000000001',NULL,1,0);
