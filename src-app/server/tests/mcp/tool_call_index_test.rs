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

/// One index as the catalog reports it: its name and its ORDERED KEY columns,
/// with `None` for an expression key whose covered columns cannot be determined.
type IndexRow = (String, Vec<Option<String>>);

/// THE RULE, as one function.
///
/// FIX_ROUND-8: extracted so the negative control can exercise the REAL
/// assertion. The previous "negative control" created a violating index and then
/// judged it with its own local helper — two Postgres tautologies — so the exact
/// mutation its docstring named (`Some("user_id")` -> `cols.first().is_some()`)
/// left BOTH tests green. A control that cannot fail when the rule is weakened is
/// not a control.
///
/// Returns the number of NON-exempt indexes actually checked. Panics on the first
/// violation, which is what makes it usable as the subject of `catch_unwind`.
fn assert_owner_leading(rows: &[IndexRow]) -> usize {
    let mut checked = 0usize;
    for (name, raw) in rows {
        let leads_with_owner = matches!(raw.first(), Some(Some(c)) if c == "user_id");

        // An EXPRESSION key (NULL attname) hides which columns it covers.
        //
        // FIX_ROUND-8: this is now asked ONLY when the index does not already
        // lead with `user_id`. Asking it first hard-failed on a fully COMPLIANT
        // index — `CREATE INDEX … (user_id, lower(tool_name))` leads with the
        // owner and covers no filtered column, yet carries a NULL key — which is
        // the same false-RED class the INCLUDE fix removed one round earlier.
        if !leads_with_owner && raw.iter().any(Option::is_none) {
            panic!(
                "index `{name}` does not lead with user_id AND has an EXPRESSION key, so \
                 this guard cannot rule out that it covers a filtered column. Lead it with \
                 user_id, or express the key as a plain column."
            );
        }

        let cols: Vec<String> = raw.iter().flatten().cloned().collect();
        if !cols.iter().any(|c| FILTERED.contains(&c.as_str())) {
            continue;
        }
        if LEGACY_SINGLE_COLUMN
            .iter()
            .any(|(n, c)| n == name && cols.as_slice() == *c)
        {
            continue;
        }
        assert!(
            leads_with_owner,
            "index `{name}` covers a filtered column {cols:?} but does not lead with \
             user_id — the owner predicate would become a post-Filter, reading other \
             users' rows off the heap before discarding them (see 202607200200). \
             If this index is genuinely needed, lead it with user_id."
        );
        checked += 1;
    }
    checked
}

/// Read the table's indexes from the catalog, as `assert_owner_leading` wants them.
async fn index_rows(pool: &sqlx::PgPool) -> Vec<IndexRow> {
    // `pg_index.indkey` is the ordered attribute list, so `ordinality = 1` is the
    // LEADING column. This sees every index however it was created — CREATE INDEX,
    // a UNIQUE / PRIMARY KEY / EXCLUDE constraint, or a column-level constraint —
    // which is the whole reason the guard lives here rather than in a text replay
    // of the migrations.
    //
    //  * `ordinality <= ix.indnkeyatts` restricts to KEY columns: `indkey` also
    //    carries INCLUDE payload, so a legitimate covering index looked like one
    //    "covering" a filtered column without leading with user_id (FIX_ROUND-7).
    //  * an EXPRESSION key has `indkey = 0` and a NULL attname; it is KEPT as NULL
    //    and judged by the rule rather than mapped to "" and silently skipped.
    //  * scoped to `public` and grouped by index OID, so a same-named relation in
    //    another schema cannot merge its attributes into one ambiguous array.
    sqlx::query(
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
    .fetch_all(pool)
    .await
    .expect("read the index catalog for mcp_tool_calls")
    .into_iter()
    .map(|r| (r.get("index_name"), r.get("columns")))
    .collect()
}

#[tokio::test]
async fn every_index_over_a_filtered_column_leads_with_user_id() {
    let server = crate::common::TestServer::start().await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .expect("connect to the migrated test database");

    let rows = index_rows(&pool).await;
    assert!(
        rows.len() >= 4,
        "expected the table's indexes to be present — found {}; the query is looking \
         at the wrong table and this guard would be vacuous",
        rows.len()
    );

    let checked = assert_owner_leading(&rows);
    assert!(
        checked >= 2,
        "expected at least the (user_id, tool_use_id) and (user_id, message_id) lookup \
         indexes to be checked, checked {checked} — the filter is matching nothing and \
         the assertion would be vacuous"
    );

    // ANTI-ROT: every exemption must still name a REAL index, with EXACTLY the
    // columns it claims.
    //
    // FIX_ROUND-8: `seen_legacy <= LEGACY.len()` was UNFALSIFIABLE (relnames are
    // unique per schema and rows are grouped by OID, so it could never exceed the
    // length), and it had replaced the only check that an exemption still
    // corresponds to something. A stale entry is a STANDING HOLE: it silently
    // re-exempts any future index re-created under that name.
    //
    // Tolerating absence does not work either — a stale entry and a legitimately
    // dropped index look identical. So existence is REQUIRED, and dropping a
    // legacy index simply means deleting its exemption in the same change. That
    // is two lines of correct hygiene, not a punishment for fixing the schema:
    // an exemption for an index that no longer exists protects nothing and can
    // only ever launder a future one.
    for (name, cols) in LEGACY_SINGLE_COLUMN {
        let row = rows.iter().find(|(n, _)| n == name).unwrap_or_else(|| {
            panic!(
                "legacy exemption `{name}` names an index that does not exist. If you \
                 dropped it — good, that is the shape this rule condemns — delete the \
                 exemption too; leaving it lets a future index re-created under that \
                 name be silently exempt."
            )
        });
        let actual: Vec<String> = row.1.iter().flatten().cloned().collect();
        assert_eq!(
            actual.as_slice(),
            cols,
            "legacy exemption `{name}` no longer names a single-column ({cols:?}) index \
             — it now covers {actual:?}. Remove the exemption or update it; leaving it \
             is a standing hole."
        );
    }
}

/// The guard's own NEGATIVE CONTROL — it drives the REAL rule.
///
/// FIX_ROUND-8: this now calls `assert_owner_leading` under `catch_unwind` on the
/// live catalog, so weakening that function (the mutation the previous version's
/// docstring named, and which left it green) turns THIS red. It creates a real
/// violating index on the real table for every filtered column, asserts the rule
/// REJECTS it, asserts the owner-leading form of the same index is ACCEPTED — so
/// the rule is not simply rejecting everything — and drops both.
#[tokio::test]
async fn the_owner_leading_rule_rejects_a_single_column_index_on_every_filtered_column() {
    let server = crate::common::TestServer::start().await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .expect("connect to the migrated test database");

    // Sanity: the rule accepts the schema as shipped, so a rejection below is
    // caused by the fixture and not by pre-existing state.
    assert!(
        std::panic::catch_unwind(|| assert_owner_leading(&[])).is_ok(),
        "the rule must accept an empty set"
    );

    for col in FILTERED {
        let bad = format!("idx_negctl_{col}");
        sqlx::query(&format!("CREATE INDEX {bad} ON public.mcp_tool_calls ({col})"))
            .execute(&pool)
            .await
            .unwrap_or_else(|e| panic!("create the violating index on {col}: {e}"));

        let rows = index_rows(&pool).await;
        assert!(
            rows.iter().any(|(n, _)| n == &bad),
            "the fixture index on `{col}` is not in the catalog"
        );
        let rejected = std::panic::catch_unwind(|| assert_owner_leading(&rows)).is_err();
        assert!(
            rejected,
            "THE RULE DID NOT REJECT a single-column index on the filtered column \
             `{col}`. Either the rule has been weakened, or `{col}` is no longer \
             treated as a filtered column."
        );

        sqlx::query(&format!("DROP INDEX public.{bad}"))
            .execute(&pool)
            .await
            .expect("drop the violating fixture index");

        // …and the OWNER-LEADING form of the same index is accepted.
        let good = format!("idx_negctl_ok_{col}");
        sqlx::query(&format!(
            "CREATE INDEX {good} ON public.mcp_tool_calls (user_id, {col})"
        ))
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("create the owner-leading index on {col}: {e}"));

        let rows = index_rows(&pool).await;
        assert!(
            std::panic::catch_unwind(|| assert_owner_leading(&rows)).is_ok(),
            "the rule REJECTED the owner-leading form on `{col}` — it is rejecting \
             everything, so the rejection above proves nothing"
        );

        sqlx::query(&format!("DROP INDEX public.{good}"))
            .execute(&pool)
            .await
            .expect("drop the owner-leading fixture index");
    }
}
