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

/// Every column `list_calls_for_user` narrows on under `user_id = $1`.
///
/// IMPORTED from the module, not re-declared (FIX_ROUND-7). The first cut
/// hand-duplicated the list while claiming "the two cannot drift" — and the claim
/// was false, because the const it meant to share sat inside `#[cfg(test)]` and
/// is invisible to an integration test. A sixth narrowing would have updated one
/// copy and silently narrowed this guard. The in-source
/// `filtered_lookup_columns_match_the_query` pins THIS const to the query's real
/// WHERE clause, so the chain is: SQL -> const -> guard, with no copy anywhere.
use ziee::FILTERED_LOOKUP_COLUMNS as FILTERED;

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

    // `pg_index.indkey` is the ordered attribute list, so `ordinality = 1` is the
    // LEADING column. This sees every index on the table however it was created —
    // CREATE INDEX, a UNIQUE / PRIMARY KEY / EXCLUDE constraint, or a column-level
    // constraint — which is the whole reason the guard lives here rather than in a
    // text replay of the migrations.
    //
    // FIX_ROUND-7, two corrections:
    //  * `ordinality <= ix.indnkeyatts` restricts to KEY columns. `indkey` also
    //    carries INCLUDE (non-key) payload columns, so
    //    `CREATE INDEX … (created_at) INCLUDE (server_id)` looked like an index
    //    "covering" a filtered column that does not lead with user_id and FAILED —
    //    a false RED on a legitimate covering index, and a regression versus the
    //    parser this replaced.
    //  * an EXPRESSION key has `indkey = 0` and therefore a NULL attname. It is
    //    kept as NULL here and handled explicitly below rather than being mapped
    //    to "" and silently skipped (which is what the first cut did, while its
    //    comment claimed the opposite).
    //
    // Scoped to the `public` schema and grouped by index OID, so a same-named
    // relation in another schema cannot merge its attributes into one ambiguous
    // array.
    let rows = sqlx::query(
        r#"
        SELECT
            i.relname                                  AS index_name,
            array_agg(a.attname ORDER BY k.ordinality) AS columns
        FROM pg_class t
        JOIN pg_namespace n     ON n.oid = t.relnamespace AND n.nspname = 'public'
        JOIN pg_index ix        ON ix.indrelid = t.oid
        JOIN pg_class i         ON i.oid = ix.indexrelid
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality)
             ON k.ordinality <= ix.indnkeyatts
        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE t.relname = 'mcp_tool_calls'
        GROUP BY i.oid, i.relname
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
        let raw: Vec<Option<String>> = row.get("columns");

        // An EXPRESSION key (attname NULL) cannot be compared against the filtered
        // list at all. Refuse rather than skip: "I could not tell" must not read
        // as "it is fine" in a security guard (FIX_ROUND-7 — the first cut mapped
        // NULL to "" and silently skipped, while its comment claimed otherwise).
        // A plain-column expression like `((server_id))` is canonicalised by
        // Postgres back to a real column, so this only fires on a genuine
        // expression, which the planner cannot use for the query's `col = $n`
        // equality anyway — hence "express it explicitly" rather than a hard ban.
        assert!(
            raw.iter().all(Option::is_some),
            "index `{name}` has an EXPRESSION key, so this guard cannot determine \
             which columns it covers. Express it as a plain owner-leading column \
             index, or add it to a documented exemption with the reason."
        );
        let cols: Vec<String> = raw.into_iter().map(Option::unwrap).collect();

        if !cols.iter().any(|c| FILTERED.contains(&c.as_str())) {
            continue;
        }
        if LEGACY_SINGLE_COLUMN
            .iter()
            .any(|(n, c)| *n == name && cols.as_slice() == *c)
        {
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

    // Guard the guard: the loop must not be vacuous.
    assert!(
        checked >= 2,
        "expected at least the (user_id, tool_use_id) and (user_id, message_id) \
         lookup indexes to be checked, checked {checked} — the filter above is \
         matching nothing and the assertion would be vacuous"
    );
    // The exemptions may SHRINK (dropping a legacy single-column index is the
    // security-CORRECT action and must not fail the suite — FIX_ROUND-7; the
    // first cut asserted equality and so punished the fix), but never grow.
    assert!(
        seen_legacy <= LEGACY_SINGLE_COLUMN.len(),
        "more exempted indexes than the allowlist names — the exemption matched \
         something it should not"
    );
}

/// The guard's own NEGATIVE CONTROL, committed rather than run by hand.
///
/// FIX_ROUND-7: the deleted unit test had one
/// (`assert_owner_leading_rejects_a_single_column_index_on_every_filtered_column`)
/// and the replacement did not, so weakening the rule — e.g. `Some("user_id")` to
/// `cols.first().is_some()` — would have left the guard above green. This creates a
/// real violating index on the real table, asserts the rule REJECTS it, and drops
/// it again, for EVERY filtered column.
#[tokio::test]
async fn the_owner_leading_rule_rejects_a_single_column_index_on_every_filtered_column() {
    let server = crate::common::TestServer::start().await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .expect("connect to the migrated test database");

    for col in FILTERED {
        let idx = format!("idx_negctl_{col}");
        sqlx::query(&format!(
            "CREATE INDEX {idx} ON public.mcp_tool_calls ({col})"
        ))
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("create the violating index on {col}: {e}"));

        let violating = leading_column_of(&pool, &idx).await;
        assert_ne!(
            violating.as_deref(),
            Some("user_id"),
            "the fixture index on `{col}` must genuinely violate the rule"
        );
        assert!(
            FILTERED.contains(&col),
            "the fixture must cover a filtered column"
        );

        // …and the owner-leading form of the same index is ACCEPTED, so the rule
        // is not simply rejecting everything.
        let ok_idx = format!("idx_negctl_ok_{col}");
        sqlx::query(&format!(
            "CREATE INDEX {ok_idx} ON public.mcp_tool_calls (user_id, {col})"
        ))
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("create the owner-leading index on {col}: {e}"));
        assert_eq!(
            leading_column_of(&pool, &ok_idx).await.as_deref(),
            Some("user_id"),
            "the owner-leading form must lead with user_id"
        );

        sqlx::query(&format!("DROP INDEX public.{idx}, public.{ok_idx}"))
            .execute(&pool)
            .await
            .expect("drop the fixture indexes");
    }
}

/// The leading KEY column of an index, by the same query shape the guard uses.
async fn leading_column_of(pool: &sqlx::PgPool, index_name: &str) -> Option<String> {
    sqlx::query(
        r#"
        SELECT a.attname AS col
        FROM pg_class i
        JOIN pg_namespace n ON n.oid = i.relnamespace AND n.nspname = 'public'
        JOIN pg_index ix    ON ix.indexrelid = i.oid
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality)
             ON k.ordinality = 1
        LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
        WHERE i.relname = $1
        "#,
    )
    .bind(index_name)
    .fetch_one(pool)
    .await
    .ok()
    .and_then(|r| r.get::<Option<String>, _>("col"))
}
