//! DB access for `mcp_tool_calls` (free functions over `&PgPool`, mirroring
//! `workflow/repository.rs`).

use sqlx::PgPool;
use uuid::Uuid;

use crate::common::AppError;

use super::models::{CreateMcpToolCall, McpToolCall};

/// Insert one recorded tool call, returning the full row.
pub async fn insert_call(pool: &PgPool, req: CreateMcpToolCall) -> Result<McpToolCall, AppError> {
    let row = sqlx::query_as!(
        McpToolCall,
        r#"
        INSERT INTO mcp_tool_calls (
            server_id, server_name, is_built_in, user_id, conversation_id,
            branch_id, message_id, tool_use_id, tool_name, arguments_json,
            source, status, is_error, result_json, content_kinds, result_bytes,
            error_message, started_at, finished_at, duration_ms, workflow_run_id,
            review_classification
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        RETURNING
            id,
            server_id,
            server_name,
            is_built_in,
            user_id,
            conversation_id,
            branch_id,
            message_id,
            tool_use_id,
            tool_name,
            arguments_json as "arguments_json: _",
            source,
            status,
            is_error,
            result_json as "result_json: _",
            content_kinds as "content_kinds: _",
            result_bytes,
            error_message,
            started_at as "started_at: _",
            finished_at as "finished_at: _",
            duration_ms,
            created_at as "created_at: _",
            updated_at as "updated_at: _"
        "#,
        req.server_id,
        req.server_name,
        req.is_built_in,
        req.user_id,
        req.conversation_id,
        req.branch_id,
        req.message_id,
        req.tool_use_id,
        req.tool_name,
        req.arguments_json,
        req.source.as_str(),
        req.status.as_str(),
        req.is_error,
        req.result_json,
        &req.content_kinds,
        req.result_bytes,
        req.error_message,
        req.started_at,
        req.finished_at,
        req.duration_ms,
        req.workflow_run_id,
        req.review_classification,
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::database_error)?;
    Ok(row)
}

/// The optional filters `GET /api/mcp/tool-calls` accepts, grouped so adding one
/// does not grow every signature between the handler and the SQL (clippy's
/// `too_many_arguments` was already at the limit).
///
/// EVERY field is an OPTIONAL narrowing applied ON TOP of the mandatory
/// `user_id = $1` predicate — see [`list_calls_for_user`]. None of them can widen
/// the result set past the caller's own rows.
#[derive(Debug, Clone, Copy, Default)]
pub struct ToolCallFilters<'a> {
    pub server_id: Option<Uuid>,
    pub conversation_id: Option<Uuid>,
    pub is_built_in: Option<bool>,
    /// ITEM-13: join the chat transcript to its recorded call. `tool_use_id` is
    /// the id the LLM stamped on the `tool_use` content block, so this is how a
    /// rail step resolves duration / source / size for the call it renders.
    pub tool_use_id: Option<&'a str>,
    /// ITEM-13: every call recorded under one assistant message (the whole rail).
    pub message_id: Option<Uuid>,
}

/// List a user's tool calls, newest-first, with the optional
/// server/conversation/built-in/tool-use/message filters. Returns `(rows, total)`;
/// the handler derives `total_pages`.
///
/// SECURITY: `user_id = $1` is unconditional and is the cross-user guard. Every
/// filter below it is a `($n IS NULL OR col = $n)` NARROWING — a filter can only
/// ever remove rows from the owner's set, never add another user's. The COUNT
/// query repeats the identical predicate list so `total` can't disagree with the
/// page. Pinned by `filters_never_drop_the_owner_predicate` (TEST-17).
pub async fn list_calls_for_user(
    pool: &PgPool,
    user_id: Uuid,
    filters: ToolCallFilters<'_>,
    page: i64,
    per_page: i64,
) -> Result<(Vec<McpToolCall>, i64), AppError> {
    let ToolCallFilters {
        server_id,
        conversation_id,
        is_built_in,
        tool_use_id,
        message_id,
    } = filters;
    let per_page = per_page.clamp(1, 200);
    let offset = (page - 1).max(0) * per_page;

    let rows = sqlx::query_as!(
        McpToolCall,
        r#"
        SELECT
            id,
            server_id,
            server_name,
            is_built_in,
            user_id,
            conversation_id,
            branch_id,
            message_id,
            tool_use_id,
            tool_name,
            arguments_json as "arguments_json: _",
            source,
            status,
            is_error,
            result_json as "result_json: _",
            content_kinds as "content_kinds: _",
            result_bytes,
            error_message,
            started_at as "started_at: _",
            finished_at as "finished_at: _",
            duration_ms,
            created_at as "created_at: _",
            updated_at as "updated_at: _"
        FROM mcp_tool_calls
        WHERE user_id = $1
          AND ($2::uuid IS NULL OR server_id = $2)
          AND ($3::uuid IS NULL OR conversation_id = $3)
          AND ($4::bool IS NULL OR is_built_in = $4)
          AND ($5::text IS NULL OR tool_use_id = $5)
          AND ($6::uuid IS NULL OR message_id = $6)
        ORDER BY created_at DESC
        LIMIT $7 OFFSET $8
        "#,
        user_id,
        server_id,
        conversation_id,
        is_built_in,
        tool_use_id,
        message_id,
        per_page,
        offset,
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::database_error)?;

    let total = sqlx::query!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM mcp_tool_calls
        WHERE user_id = $1
          AND ($2::uuid IS NULL OR server_id = $2)
          AND ($3::uuid IS NULL OR conversation_id = $3)
          AND ($4::bool IS NULL OR is_built_in = $4)
          AND ($5::text IS NULL OR tool_use_id = $5)
          AND ($6::uuid IS NULL OR message_id = $6)
        "#,
        user_id,
        server_id,
        conversation_id,
        is_built_in,
        tool_use_id,
        message_id,
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::database_error)?
    .count;

    Ok((rows, total))
}

/// Fetch a single tool-call row by id, scoped to its owner. Ownership is
/// enforced in SQL (not just the handler) so a future caller can't leak a
/// cross-user row.
pub async fn find_call_for_user(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<McpToolCall>, AppError> {
    let row = sqlx::query_as!(
        McpToolCall,
        r#"
        SELECT
            id,
            server_id,
            server_name,
            is_built_in,
            user_id,
            conversation_id,
            branch_id,
            message_id,
            tool_use_id,
            tool_name,
            arguments_json as "arguments_json: _",
            source,
            status,
            is_error,
            result_json as "result_json: _",
            content_kinds as "content_kinds: _",
            result_bytes,
            error_message,
            started_at as "started_at: _",
            finished_at as "finished_at: _",
            duration_ms,
            created_at as "created_at: _",
            updated_at as "updated_at: _"
        FROM mcp_tool_calls
        WHERE id = $1 AND user_id = $2
        "#,
        id,
        user_id,
    )
    .fetch_optional(pool)
    .await
    .map_err(AppError::database_error)?;
    Ok(row)
}

/// ITEM-17 / DEC-1 reveal: the RAW, UNREDACTED arguments for a recorded call.
///
/// Deliberately NOT read from `mcp_tool_calls.arguments_json`:
/// `record::cap_arguments` redacts BEFORE the insert, so that column has never
/// held the raw value — a reveal reading it would just echo `[redacted]`. The raw
/// arguments live on the paired `message_contents` `tool_use` block's `input`
/// (persisted by the chat path exactly as the model emitted it).
///
/// Owner-scoped INDEPENDENTLY of the caller's tool-call row: the block is reached
/// only through `branch_messages → branches → conversations` with
/// `conversations.user_id = $3`, so this cannot pull another user's transcript
/// even if it were handed a foreign `message_id`.
///
/// `Ok(None)` means the block is gone (message deleted / branch pruned) — the
/// handler falls back to the recorded (redacted) arguments rather than erroring.
pub async fn find_raw_tool_use_input(
    pool: &PgPool,
    message_id: Uuid,
    tool_use_id: &str,
    user_id: Uuid,
) -> Result<Option<serde_json::Value>, AppError> {
    let row = sqlx::query!(
        r#"
        SELECT mc.content -> 'input' AS "input?: serde_json::Value"
        FROM message_contents mc
        JOIN branch_messages bm ON bm.message_id = mc.message_id
        JOIN branches b ON b.id = bm.branch_id
        JOIN conversations c ON c.id = b.conversation_id
        WHERE mc.message_id = $1
          AND mc.content_type = 'tool_use'
          AND mc.content ->> 'id' = $2
          AND c.user_id = $3
        LIMIT 1
        "#,
        message_id,
        tool_use_id,
        user_id,
    )
    .fetch_optional(pool)
    .await
    .map_err(AppError::database_error)?;
    // A block with no `input` key yields SQL NULL; one with `"input": null` yields
    // JSON null. Neither is a revealable value, so both degrade to the recorded
    // arguments rather than reporting `raw: true` with nothing in it.
    Ok(row
        .and_then(|r| r.input)
        .filter(|v| !v.is_null()))
}

/// Delete every row older than `cutoff` (the retention prune). Returns the
/// number of rows removed.
pub async fn prune_calls_older_than(
    pool: &PgPool,
    cutoff: time::OffsetDateTime,
) -> Result<u64, AppError> {
    let res = sqlx::query!(
        r#"DELETE FROM mcp_tool_calls WHERE created_at < $1"#,
        cutoff,
    )
    .execute(pool)
    .await
    .map_err(AppError::database_error)?;
    Ok(res.rows_affected())
}

#[cfg(test)]
mod tests {
    /// This module's own source, so the tests below can assert on the SQL the
    /// `query_as!` macros embed (the macros consume the literal at compile time,
    /// so there is no runtime handle to it). Same "read the real artifact"
    /// technique `chat/core/repository/contents.rs` uses against `migrations/`.
    const SOURCE: &str = include_str!("repository.rs");

    /// Every `SELECT`/`UPDATE`/`DELETE` body in this file that touches
    /// `mcp_tool_calls`, as raw SQL text.
    fn tool_call_statements() -> Vec<&'static str> {
        SOURCE
            .split("r#\"")
            .skip(1)
            .filter_map(|chunk| chunk.split("\"#").next())
            .filter(|sql| sql.contains("mcp_tool_calls"))
            .collect()
    }

    /// TEST-17 (ITEM-13): the new `tool_use_id` / `message_id` filters compose
    /// into the owner-scoped query WITHOUT dropping the `user_id` predicate —
    /// the cross-user guard. Asserted on the real SQL, not a paraphrase.
    #[test]
    fn filters_never_drop_the_owner_predicate() {
        let statements = tool_call_statements();
        assert!(
            statements.len() >= 4,
            "expected the insert + page + count + single-row statements, saw {}",
            statements.len()
        );

        for sql in &statements {
            // The retention prune is deployment-wide by design (it deletes by
            // `created_at` across all users); everything else is owner-scoped.
            if sql.contains("DELETE FROM mcp_tool_calls") {
                continue;
            }
            if sql.contains("INSERT INTO mcp_tool_calls") {
                assert!(sql.contains("user_id"), "insert must carry an owner: {sql}");
                continue;
            }
            assert!(
                sql.contains("WHERE user_id = $1") || sql.contains("WHERE id = $1 AND user_id = $2"),
                "every read of mcp_tool_calls must be owner-scoped in SQL: {sql}"
            );
        }

        // The two LIST statements (page + count) carry the identical predicate
        // list, including the two ITEM-13 filters, so `total` can never disagree
        // with the page.
        let listing: Vec<&&str> = statements
            .iter()
            .filter(|s| s.contains("WHERE user_id = $1"))
            .collect();
        assert_eq!(listing.len(), 2, "expected exactly the page + count statements");
        for sql in listing {
            assert!(sql.contains("WHERE user_id = $1"), "owner predicate present: {sql}");
            assert!(
                sql.contains("($2::uuid IS NULL OR server_id = $2)"),
                "server filter preserved: {sql}"
            );
            assert!(
                sql.contains("($3::uuid IS NULL OR conversation_id = $3)"),
                "conversation filter preserved: {sql}"
            );
            assert!(
                sql.contains("($4::bool IS NULL OR is_built_in = $4)"),
                "built-in filter preserved: {sql}"
            );
            assert!(
                sql.contains("($5::text IS NULL OR tool_use_id = $5)"),
                "ITEM-13 tool_use_id filter present: {sql}"
            );
            assert!(
                sql.contains("($6::uuid IS NULL OR message_id = $6)"),
                "ITEM-13 message_id filter present: {sql}"
            );
            // Every filter is an AND-narrowing under the owner predicate — never
            // an OR that could widen past it.
            let after_owner = sql.split("WHERE user_id = $1").nth(1).unwrap();
            let filter_section = after_owner
                .split("ORDER BY")
                .next()
                .unwrap()
                .trim_end()
                .trim_end_matches(|c: char| c.is_whitespace());
            for line in filter_section.lines().map(str::trim).filter(|l| !l.is_empty()) {
                assert!(
                    line.starts_with("AND "),
                    "filter `{line}` must AND-narrow under the owner predicate"
                );
            }
        }
    }

    /// The reveal lookup is owner-scoped through the CONVERSATION, not merely
    /// through the tool-call row it was resolved from (defense in depth: a
    /// mis-scoped call row still cannot pull another user's transcript).
    #[test]
    fn raw_tool_use_lookup_is_conversation_owner_scoped() {
        let sql = SOURCE
            .split("r#\"")
            .skip(1)
            .filter_map(|chunk| chunk.split("\"#").next())
            .find(|s| s.contains("content_type = 'tool_use'"))
            .expect("the raw tool_use lookup must exist");
        assert!(sql.contains("JOIN branch_messages"), "joins the branch: {sql}");
        assert!(sql.contains("JOIN conversations"), "joins the conversation: {sql}");
        assert!(sql.contains("c.user_id = $3"), "owner-scoped on the conversation: {sql}");
        assert!(
            !sql.contains("arguments_json"),
            "the reveal must NOT read the pre-redacted mcp_tool_calls column: {sql}"
        );
    }

    /// Replay the index DDL of a set of migration SOURCES, in the order given,
    /// into `index name -> indexed columns`.
    ///
    /// Extracted (FIX_ROUND-5) so every branch is reachable from a test. The
    /// real corpus exercises almost none of them — there is no lowercase
    /// `create index`, no `DROP INDEX CONCURRENTLY` and no `ALTER TABLE` on
    /// `mcp_tool_calls` anywhere in it — so hardening the parser against the
    /// real files alone was unverifiable by construction: reverting any of it
    /// turned nothing red. The synthetic cases below each corpus test are what
    /// actually pin this.
    ///
    /// `refuse` is called for DDL that creates a REAL backing index this replay
    /// cannot model (a table-level UNIQUE / PRIMARY KEY / EXCLUDE constraint, or
    /// index DDL hidden inside a `$$ … $$` body). Refusing is the safe answer:
    /// silently ignoring it would make the owner-leading guarantee vacuous for
    /// exactly the spellings that evade the parser.
    fn replay_index_ddl(
        sources: &[(String, String)],
        table: &str,
        mut refuse: impl FnMut(&str, &str),
    ) -> std::collections::BTreeMap<String, Vec<String>> {
        let mut indexes: std::collections::BTreeMap<String, Vec<String>> = Default::default();
        for (name, raw) in sources {
            // Strip `--` LINE comments FIRST, then `/* … */` blocks.
            //
            // FIX_ROUND-5: the order is load-bearing and was wrong. Stripping
            // blocks first is not comment-aware, so a `/*` occurring INSIDE a
            // line comment — e.g. the glob `…/migrations/*_schema.sql` in a
            // header — opened a block that never closed and discarded the entire
            // rest of the file. That is live in the real corpus today, and it
            // would silently void this guard for any future migration whose
            // prose mentions a glob path.
            let no_line_comments: String = raw
                .lines()
                .map(|l| l.split("--").next().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n");
            let mut sql = String::with_capacity(no_line_comments.len());
            let mut rest = no_line_comments.as_str();
            while let Some(open) = rest.find("/*") {
                sql.push_str(&rest[..open]);
                rest = match rest[open + 2..].find("*/") {
                    Some(close) => &rest[open + 2 + close + 2..],
                    None => "",
                };
            }
            sql.push_str(rest);

            // `$$ … $$` bodies are not statement-split safely, so index DDL
            // inside one would evade the replay entirely. Refuse rather than
            // pretend (FIX_ROUND-5).
            let mut scan = sql.as_str();
            while let Some(open) = scan.find("$$") {
                let after = &scan[open + 2..];
                let Some(close) = after.find("$$") else { break };
                let body = &after[..close];
                if body.contains(table) {
                    refuse(name, "index DDL inside a `$$ … $$` body cannot be replayed");
                }
                scan = &after[close + 2..];
            }

            for stmt in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
                let flat = stmt.split_whitespace().collect::<Vec<_>>().join(" ");
                let upper = flat.to_uppercase();

                // A table-level constraint creates a REAL backing index, so
                // MODEL it as one rather than refusing: the corpus already has
                // `ALTER TABLE ONLY mcp_tool_calls ADD CONSTRAINT …_pkey PRIMARY
                // KEY (id)`, which is perfectly fine — `id` is not a filtered
                // column — and refusing it outright (FIX_ROUND-5's first cut)
                // would have failed the suite on a legitimate migration. Modelled
                // as an index, the ordinary owner-leading rule decides: a PK on
                // `id` is skipped, a UNIQUE on `message_id` is flagged.
                //
                // Scoped to the ALTERED table (FIX_ROUND-5: FIX_ROUND-4 matched
                // the name ANYWHERE, so another table's `… REFERENCES
                // mcp_tool_calls(id)` false-fired) and to ADD only (a DROP
                // creates nothing). PRIMARY KEY / EXCLUDE evade a `UNIQUE`
                // substring test, so all three spellings are handled.
                if let Some(after_alter) = upper.strip_prefix("ALTER TABLE ") {
                    let mut target = after_alter;
                    for kw in ["ONLY ", "IF EXISTS "] {
                        target = target.strip_prefix(kw).unwrap_or(target);
                    }
                    let target = target
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .rsplit('.')
                        .next()
                        .unwrap_or("");
                    let adds_constraint =
                        upper.contains(" ADD CONSTRAINT ") || upper.contains(" ADD UNIQUE") || upper.contains(" ADD PRIMARY KEY");
                    let kind = ["UNIQUE", "PRIMARY KEY", "EXCLUDE"]
                        .iter()
                        .find(|k| upper.contains(**k));
                    if target.eq_ignore_ascii_case(table) && adds_constraint && kind.is_some() {
                        let cols = flat
                            .split_once('(')
                            .and_then(|(_, rest)| rest.rsplit_once(')'))
                            .map(|(inner, _)| inner)
                            .unwrap_or_default()
                            .split(')')
                            .next()
                            .unwrap_or_default()
                            .split(',')
                            .filter_map(|c| c.split_whitespace().next())
                            .map(|c| c.trim_matches('"').to_string())
                            .filter(|c| !c.is_empty())
                            .collect::<Vec<_>>();
                        if cols.is_empty() {
                            refuse(
                                name,
                                "a constraint on this table creates a backing index whose \
                                 columns this guard cannot parse — express it as an explicit \
                                 owner-leading CREATE [UNIQUE] INDEX instead",
                            );
                        } else {
                            // `EXCLUDE USING gist (col WITH =)` also lands here;
                            // the first token per element is the column.
                            let cname = flat
                                .to_uppercase()
                                .find(" ADD CONSTRAINT ")
                                .map(|i| {
                                    flat[i + " ADD CONSTRAINT ".len()..]
                                        .split_whitespace()
                                        .next()
                                        .unwrap_or("constraint")
                                        .to_string()
                                })
                                .unwrap_or_else(|| format!("{target}_constraint"));
                            indexes.insert(cname, cols);
                        }
                    }
                    continue;
                }

                if upper.starts_with("CREATE INDEX") || upper.starts_with("CREATE UNIQUE INDEX") {
                    if !flat.contains(table) {
                        continue;
                    }
                    // Trim on the UPPERCASED copy so a lowercase `create index`
                    // is not recorded under the name "create", then map the
                    // offset back. FIX_ROUND-5: the offset is taken from
                    // `upper`, not `flat` — `to_uppercase()` is NOT
                    // length-preserving for non-ASCII, so deriving it from
                    // `flat.len()` could slice at a non-char boundary or
                    // underflow.
                    let head = upper
                        .trim_start_matches("CREATE ")
                        .trim_start_matches("UNIQUE ")
                        .trim_start_matches("INDEX ")
                        .trim_start_matches("CONCURRENTLY ")
                        .trim_start_matches("IF NOT EXISTS ");
                    let offset = upper.len() - head.len();
                    if !flat.is_char_boundary(offset) {
                        refuse(name, "non-ASCII in index DDL defeats the name parser");
                        continue;
                    }
                    let idx_name = flat[offset..]
                        .split_whitespace()
                        .next()
                        .unwrap_or_default()
                        .to_string();
                    let cols = flat
                        .split_once('(')
                        .and_then(|(_, rest)| rest.rsplit_once(')'))
                        .map(|(inner, _)| inner)
                        .unwrap_or_default();
                    // `(a, b DESC) WHERE (x IS NOT NULL)` -> ["a", "b"]
                    let cols = cols
                        .split(')')
                        .next()
                        .unwrap_or_default()
                        .split(',')
                        .filter_map(|c| c.split_whitespace().next())
                        .map(|c| c.trim_matches('"').to_string())
                        .collect::<Vec<_>>();
                    indexes.insert(idx_name, cols);
                } else if upper.starts_with("DROP INDEX") {
                    let head = upper
                        .trim_start_matches("DROP INDEX ")
                        .trim_start_matches("CONCURRENTLY ")
                        .trim_start_matches("IF EXISTS ");
                    let offset = upper.len() - head.len();
                    if !flat.is_char_boundary(offset) {
                        continue;
                    }
                    // `DROP INDEX a, b` drops BOTH (FIX_ROUND-5: only the first
                    // name was removed, leaving a phantom in the map).
                    for target in flat[offset..].split(',') {
                        let idx_name = target
                            .trim()
                            .trim_end_matches(';')
                            .split_whitespace()
                            .next()
                            .unwrap_or_default()
                            .rsplit('.')
                            .next()
                            .unwrap_or_default()
                            .to_string();
                        if !idx_name.is_empty() {
                            indexes.remove(&idx_name);
                        }
                    }
                }
            }
        }
        indexes
    }

    /// EVERY column [`list_calls_for_user`] narrows on under `user_id = $1` —
    /// read off the query, NOT off the table's column list.
    const FILTERED: [&str; 5] = [
        "server_id",
        "conversation_id",
        "is_built_in",
        "tool_use_id",
        "message_id",
    ];

    /// Single-column indexes on a filtered column that PRE-DATE this rule
    /// (`202607140180_mcp_schema.sql`). Pinned to the EXACT column vector, not
    /// just the name, so a future migration re-creating the same NAME over a
    /// different column set is not silently exempt.
    const LEGACY_SINGLE_COLUMN: [(&str, &str); 2] = [
        ("idx_mcp_tool_calls_server", "server_id"),
        ("idx_mcp_tool_calls_conv", "conversation_id"),
    ];

    /// Assert the owner-leading rule over a replayed index map, returning the
    /// number of NON-exempt indexes it checked.
    fn assert_owner_leading(
        indexes: &std::collections::BTreeMap<String, Vec<String>>,
    ) -> usize {
        let mut owner_leading = 0usize;
        for (name, cols) in indexes {
            if !cols.iter().any(|c| FILTERED.contains(&c.as_str())) {
                continue;
            }
            if LEGACY_SINGLE_COLUMN
                .iter()
                .any(|(n, col)| n == name && cols.as_slice() == [col.to_string()])
            {
                continue;
            }
            assert_eq!(
                cols.first().map(String::as_str),
                Some("user_id"),
                "index `{name}` covers a filtered column {cols:?} but does not lead with \
                 user_id — the owner predicate would become a post-Filter, reading other \
                 users' rows off the heap before discarding them (see 202607200200)"
            );
            owner_leading += 1;
        }
        owner_leading
    }

    /// FIX_ROUND-2 #1: every index left on `mcp_tool_calls` that covers a column
    /// [`list_calls_for_user`] filters must be OWNER-LEADING.
    ///
    /// `user_id = $1` is the unconditional cross-user guard; each other predicate
    /// is an optional narrowing. An index on the narrowing column ALONE is still
    /// chosen under a custom plan, but it leaves `user_id` as a post-`Filter` —
    /// i.e. a row belonging to ANOTHER user is read off the heap and only then
    /// discarded. `202607200200` replaced the single-column pair with
    /// `(user_id, col)`.
    ///
    /// This replays the REAL migration corpus, in application order, so it fails
    /// on a re-added single-column index OR on a reverted drop — not just on the
    /// two filenames that happen to exist today.
    #[test]
    fn tool_call_lookup_indexes_are_owner_leading() {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        // `build.rs::compose_merged_migrations` composes the module dirs plus the
        // five named SDK crates. `desktop/tauri/migrations` is NOT part of the
        // server's merged set (desktop composes its own) — it is scanned here as
        // deliberate over-inclusion, since an index it creates would still exist
        // on a desktop deployment.
        let module_root = manifest.join("src/modules");
        let sdk_crates = manifest.join("../../sdk/crates");
        let mut roots: Vec<(&str, Vec<std::path::PathBuf>)> = Vec::new();
        let mut module_dirs = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&module_root) {
            module_dirs.extend(entries.filter_map(|e| e.ok().map(|e| e.path().join("migrations"))));
        }
        roots.push(("modules", module_dirs));
        roots.push((
            "sdk-crates",
            [
                "ziee-auth",
                "ziee-file",
                "ziee-notification",
                "ziee-onboarding",
                "ziee-seed",
            ]
            .iter()
            .map(|c| sdk_crates.join(c).join("migrations"))
            .collect(),
        ));
        roots.push(("desktop", vec![manifest.join("../desktop/tauri/migrations")]));

        let mut files: Vec<std::path::PathBuf> = Vec::new();
        for (label, dirs) in &roots {
            let before = files.len();
            for dir in dirs {
                let Ok(entries) = std::fs::read_dir(dir) else {
                    continue;
                };
                files.extend(
                    entries
                        .filter_map(|e| e.ok().map(|e| e.path()))
                        .filter(|p| p.extension().is_some_and(|x| x == "sql")),
                );
            }
            // PER-ROOT, not one global count. FIX_ROUND-5: a single
            // `files.len() > 100` sat BELOW the 101 files the module dirs alone
            // already yield, so losing the SDK or desktop roots entirely — the
            // exact regression widening the walk was meant to prevent — still
            // passed.
            assert!(
                files.len() > before,
                "migration root `{label}` contributed no files — the walk is looking in \
                 the wrong place and the guard would be silently narrowed"
            );
        }

        // Filename order IS application order (every name is timestamp-prefixed,
        // globally unique across modules).
        files.sort_by_key(|p| p.file_name().map(|n| n.to_os_string()));
        let sources: Vec<(String, String)> = files
            .iter()
            .map(|p| {
                (
                    p.display().to_string(),
                    std::fs::read_to_string(p).expect("read a migration"),
                )
            })
            .collect();

        let indexes = replay_index_ddl(&sources, "mcp_tool_calls", |file, why| {
            panic!("{file}: {why}");
        });

        // Every exemption must still correspond to a REAL index, so the
        // allowlist cannot rot into a silent widening (FIX_ROUND-5).
        for (name, col) in LEGACY_SINGLE_COLUMN {
            assert_eq!(
                indexes.get(name).map(Vec::as_slice),
                Some([col.to_string()].as_slice()),
                "legacy exemption `{name}` no longer matches a single-column ({col}) index — \
                 remove the exemption rather than leaving it as a standing hole"
            );
        }

        let owner_leading = assert_owner_leading(&indexes);
        // Guard the guard: a rename must not make the loop above vacuous.
        assert_eq!(
            owner_leading, 2,
            "expected exactly the (user_id, tool_use_id) and (user_id, message_id) \
             lookup indexes to survive, found {owner_leading}: {indexes:?}"
        );
    }

    /// The parser branches the real corpus never exercises. Without these, every
    /// hardening in `replay_index_ddl` is unfalsifiable (FIX_ROUND-5).
    #[test]
    fn replay_index_ddl_sees_the_spellings_the_real_corpus_lacks() {
        let src = |sql: &str| vec![("synthetic.sql".to_string(), sql.to_string())];
        let noop = |_: &str, _: &str| {};

        // lowercase DDL — was recorded under the name "create".
        let m = replay_index_ddl(&src("create index idx_low on mcp_tool_calls (tool_use_id);"), "mcp_tool_calls", noop);
        assert_eq!(m.get("idx_low").map(Vec::as_slice), Some(["tool_use_id".to_string()].as_slice()));

        // CREATE UNIQUE INDEX — the canonical one-line violation.
        let m = replay_index_ddl(&src("CREATE UNIQUE INDEX idx_u ON mcp_tool_calls (message_id);"), "mcp_tool_calls", noop);
        assert_eq!(m.get("idx_u").map(Vec::as_slice), Some(["message_id".to_string()].as_slice()));

        // CONCURRENTLY on both CREATE and DROP.
        let m = replay_index_ddl(
            &src("CREATE INDEX CONCURRENTLY idx_c ON mcp_tool_calls (tool_use_id); DROP INDEX CONCURRENTLY idx_c;"),
            "mcp_tool_calls",
            noop,
        );
        assert!(!m.contains_key("idx_c"), "DROP INDEX CONCURRENTLY must remove it, got {m:?}");

        // Multi-target DROP.
        let m = replay_index_ddl(
            &src("CREATE INDEX a ON mcp_tool_calls (tool_use_id); CREATE INDEX b ON mcp_tool_calls (message_id); DROP INDEX a, b;"),
            "mcp_tool_calls",
            noop,
        );
        assert!(m.is_empty(), "both dropped names must go, got {m:?}");

        // A commented-out CREATE is not real.
        let m = replay_index_ddl(&src("/* CREATE INDEX idx_x ON mcp_tool_calls (tool_use_id); */"), "mcp_tool_calls", noop);
        assert!(m.is_empty(), "block-commented DDL must be ignored, got {m:?}");
        let m = replay_index_ddl(&src("-- CREATE INDEX idx_y ON mcp_tool_calls (tool_use_id);"), "mcp_tool_calls", noop);
        assert!(m.is_empty(), "line-commented DDL must be ignored, got {m:?}");

        // A `/*` INSIDE a line comment must not swallow the rest of the file.
        let m = replay_index_ddl(
            &src("-- see migrations/*_schema.sql\nCREATE INDEX idx_after ON mcp_tool_calls (user_id, tool_use_id);"),
            "mcp_tool_calls",
            noop,
        );
        assert!(
            m.contains_key("idx_after"),
            "a glob in a line comment must not open a block strip, got {m:?}"
        );
    }

    #[test]
    fn replay_index_ddl_refuses_ddl_it_cannot_model() {
        use std::cell::RefCell;
        let refusals: RefCell<Vec<String>> = RefCell::new(Vec::new());
        let record = |_: &str, why: &str| refusals.borrow_mut().push(why.to_string());
        let src = |sql: &str| vec![("synthetic.sql".to_string(), sql.to_string())];

        // A constraint-backed index on the guarded table is MODELLED, then judged
        // by the ordinary owner-leading rule — all three spellings.
        for sql in [
            "ALTER TABLE ONLY public.mcp_tool_calls ADD CONSTRAINT c UNIQUE (message_id);",
            "ALTER TABLE mcp_tool_calls ADD CONSTRAINT c PRIMARY KEY (tool_use_id);",
            "ALTER TABLE mcp_tool_calls ADD CONSTRAINT c EXCLUDE USING gist (server_id WITH =);",
        ] {
            let m = replay_index_ddl(&src(sql), "mcp_tool_calls", record);
            assert_eq!(m.len(), 1, "the constraint index must be modelled: {sql}");
            let caught = std::panic::catch_unwind(|| assert_owner_leading(&m)).is_err();
            assert!(caught, "a single-column constraint index must be rejected: {sql}");
        }

        // A PRIMARY KEY on a NON-filtered column is legitimate and must pass —
        // the real corpus has exactly this (`…_pkey PRIMARY KEY (id)`), and
        // refusing it outright failed the suite on a valid migration.
        let m = replay_index_ddl(
            &src("ALTER TABLE ONLY public.mcp_tool_calls ADD CONSTRAINT mcp_tool_calls_pkey PRIMARY KEY (id);"),
            "mcp_tool_calls",
            record,
        );
        assert_eq!(assert_owner_leading(&m), 0, "a PK on `id` touches no filtered column");

        // …but NOT another table's constraint that merely REFERENCES it, and NOT
        // a DROP (which creates nothing). Both false-RED under FIX_ROUND-4.
        for sql in [
            "ALTER TABLE other_tbl ADD CONSTRAINT c UNIQUE (tool_call_id) REFERENCES mcp_tool_calls(id);",
            "ALTER TABLE mcp_tool_calls DROP CONSTRAINT foo_unique;",
            "ALTER TABLE mcp_tool_calls ADD COLUMN unique_key TEXT;",
        ] {
            refusals.borrow_mut().clear();
            replay_index_ddl(&src(sql), "mcp_tool_calls", record);
            assert!(
                refusals.borrow().is_empty(),
                "must NOT refuse: {sql} (got {:?})",
                refusals.borrow()
            );
        }

        // Index DDL hidden in a `$$ … $$` body cannot be replayed -> refuse.
        refusals.borrow_mut().clear();
        replay_index_ddl(
            &src("DO $$ BEGIN CREATE INDEX z ON mcp_tool_calls (tool_use_id); END $$;"),
            "mcp_tool_calls",
            record,
        );
        assert_eq!(
            refusals.borrow().len(),
            1,
            "a $$ body touching the table must be refused"
        );
    }

    #[test]
    fn assert_owner_leading_rejects_a_single_column_index_on_every_filtered_column() {
        for col in FILTERED {
            let mut m: std::collections::BTreeMap<String, Vec<String>> = Default::default();
            m.insert("idx_new".to_string(), vec![col.to_string()]);
            let caught = std::panic::catch_unwind(|| assert_owner_leading(&m)).is_err();
            assert!(caught, "a NEW single-column index on `{col}` must be rejected");

            // The owner-leading form is accepted.
            let mut ok: std::collections::BTreeMap<String, Vec<String>> = Default::default();
            ok.insert("idx_ok".to_string(), vec!["user_id".to_string(), col.to_string()]);
            assert_eq!(assert_owner_leading(&ok), 1);
        }
    }

}
