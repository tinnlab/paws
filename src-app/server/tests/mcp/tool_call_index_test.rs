//! FIX_ROUND-6 — the AUTHORITATIVE owner-leading index guard.
//!
//! ## Why this replaced a unit test
//!
//! FIX_ROUND-2 shipped this guard as an in-source unit test that re-implemented
//! enough of a SQL parser to replay every migration's index DDL and assert the
//! rule over the result. Rounds 3, 4 and 5 each hardened that parser and each
//! subsequent blind audit found more VALID SQL that evaded it: `CREATE UNIQUE
//! INDEX`, lowercase DDL, `CONCURRENTLY` on the DROP side, `ALTER TABLE … ADD
//! CONSTRAINT`, an UPPERCASE table reference, a column-level `UNIQUE`, an inline
//! constraint inside `CREATE TABLE`, a dollar-quoted body, a multi-action
//! `ALTER`, and a comment/string-literal interaction that silently discarded a
//! whole file. Round 6 constructed a working bypass — a migration that adds a
//! non-owner-leading index on a filtered column and passes.
//!
//! A text replay of SQL is unsound by construction, and a SECURITY guard that is
//! unsound by construction is worse than no guard, because it reads as coverage.
//! So the guard moved to where the truth is: the DATABASE, after the migrations
//! have actually run. `pg_indexes` needs no parser, cannot be evaded by a
//! spelling, and covers index creation by ANY route — explicit DDL, a table or
//! column constraint, a primary key, or anything a future migration invents.
//!
//! ## The rule
//!
//! `list_calls_for_user` applies `user_id = $1` UNCONDITIONALLY — it is the
//! cross-user guard — and every other predicate is an optional narrowing. An
//! index on a narrowing column ALONE is still chosen under a custom plan, but it
//! leaves `user_id` as a post-`Filter`: a row belonging to ANOTHER user is read
//! off the heap and only then discarded. So every index covering a filtered
//! column must LEAD with `user_id`.

use sqlx::Row;

/// Every column `list_calls_for_user` narrows on under `user_id = $1`. Kept in
/// lockstep with the query by the in-source `filtered_lookup_columns_match_the_query`.
const FILTERED: [&str; 5] = [
    "server_id",
    "conversation_id",
    "is_built_in",
    "tool_use_id",
    "message_id",
];

/// Single-column indexes on a filtered column that PRE-DATE this rule
/// (`202607140180_mcp_schema.sql`). Pinned to the exact column vector, not just
/// the name, so a migration re-creating the same NAME over a different column
/// set is not silently exempt. Nothing NEW may join this list.
const LEGACY_SINGLE_COLUMN: [(&str, &[&str]); 2] = [
    ("idx_mcp_tool_calls_server", &["server_id"]),
    ("idx_mcp_tool_calls_conv", &["conversation_id"]),
];

#[tokio::test]
async fn every_index_over_a_filtered_column_leads_with_user_id() {
    let server = crate::common::TestServer::start().await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .expect("connect to the migrated test database");

    // `pg_index.indkey` is the ordered column list, so `ordinality = 1` is the
    // LEADING column. Expression indexes yield attname NULL, which we surface
    // rather than skip. This sees every index on the table however it was
    // created — CREATE INDEX, a UNIQUE/PRIMARY KEY/EXCLUDE constraint, or a
    // column-level constraint.
    let rows = sqlx::query(
        r#"
        SELECT
            i.relname                              AS index_name,
            array_agg(a.attname ORDER BY k.ordinality) AS columns
        FROM pg_class t
        JOIN pg_index ix        ON ix.indrelid = t.oid
        JOIN pg_class i         ON i.oid = ix.indexrelid
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE t.relname = 'mcp_tool_calls'
        GROUP BY i.relname
        ORDER BY i.relname
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("read pg_indexes for mcp_tool_calls");

    assert!(
        rows.len() >= 4,
        "expected the table's indexes to be present — found {}; the query is \
         looking at the wrong table and this guard would be vacuous",
        rows.len()
    );

    let mut checked = 0usize;
    let mut seen_legacy = 0usize;
    for row in &rows {
        let name: String = row.get("index_name");
        let cols: Vec<Option<String>> = row.get("columns");
        let cols: Vec<String> = cols.into_iter().map(|c| c.unwrap_or_default()).collect();

        if !cols.iter().any(|c| FILTERED.contains(&c.as_str())) {
            continue;
        }
        if let Some((_, legacy_cols)) = LEGACY_SINGLE_COLUMN
            .iter()
            .find(|(n, c)| *n == name && cols.as_slice() == *c)
        {
            let _ = legacy_cols;
            seen_legacy += 1;
            continue;
        }
        assert_eq!(
            cols.first().map(String::as_str),
            Some("user_id"),
            "index `{name}` covers a filtered column {cols:?} but does not lead with \
             user_id — the owner predicate would become a post-Filter, reading other \
             users' rows off the heap before discarding them (see 202607200200). \
             If this index is genuinely needed, lead it with user_id."
        );
        checked += 1;
    }

    // Guard the guard, both directions: the loop must not be vacuous, and every
    // legacy exemption must still correspond to a REAL index so the allowlist
    // cannot rot into a standing hole.
    assert_eq!(
        seen_legacy,
        LEGACY_SINGLE_COLUMN.len(),
        "a legacy exemption no longer matches a real single-column index — remove \
         the exemption rather than leaving it as a standing hole. Indexes seen: {:?}",
        rows.iter().map(|r| r.get::<String, _>("index_name")).collect::<Vec<_>>()
    );
    assert!(
        checked >= 2,
        "expected at least the (user_id, tool_use_id) and (user_id, message_id) \
         lookup indexes to be checked, checked {checked} — the filter above is \
         matching nothing and the assertion would be vacuous"
    );
}
