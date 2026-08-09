//! TEST-20 — `/background/runs?status` and `?kind` refuse a NUL with a typed
//! 400, not a 500.
//!
//! Both were passed through `as_deref()` with NO validation at all into
//! `status = $2` / `job_kind = $3`, so they were the most exposed members of
//! the class. Neither was in the reported defect.

use reqwest::StatusCode;

use crate::common::TestServer;
use crate::common::nul_query_param::{assert_nul_is_rejected, get};
use crate::common::test_helpers::{create_user_with_no_permissions, create_user_with_permissions};

#[tokio::test]
async fn background_runs_status_and_kind_reject_nul() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "bg_nul", &["background::use"]).await;

    // Seed two runs that differ in BOTH status and kind, so each happy-path
    // leg can assert the filter SELECTS a strict subset. A well-formedness
    // assertion on an empty table would be satisfied by a handler that ignores
    // the parameter, which would make the paired rejection prove nothing.
    insert_bg_run(&server, &user.user_id, "subagent", "completed").await;
    insert_bg_run(&server, &user.user_id, "sandbox_exec", "failed").await;

    for (nul_path, benign_path) in [
        (
            "/background/runs?status=%00",
            "/background/runs?status=completed",
        ),
        (
            "/background/runs?kind=%00",
            "/background/runs?kind=subagent",
        ),
    ] {
        // HAPPY-PATH COUNTERPART — selects exactly one of the two seeded runs.
        let (status, body) = get(&server, &user.token, benign_path).await;
        assert_eq!(status, StatusCode::OK, "happy path {benign_path}: {body}");
        assert_eq!(
            body["total"], 1,
            "{benign_path} must select ONE of the two seeded runs; returning \
             both means the filter is ignored: {body}"
        );

        assert_nul_is_rejected(&server, &user.token, nul_path).await;
    }

    // PERMISSION CONTROL — without `background::use` the same URL is a 403,
    // so the 400 above is specifically a validation refusal.
    let nobody = create_user_with_no_permissions(&server, "bg_nul_noperm").await;
    let (status, _) = get(&server, &nobody.token, "/background/runs?status=completed").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "unpermitted caller");
}

/// Insert a background `workflow_runs` row owned by `user_id`. Mirrors
/// `runs.rs::insert_bg_run` — direct SQL, because spawning a real background
/// run needs an LLM.
async fn insert_bg_run(server: &TestServer, user_id: &str, kind: &str, status: &str) {
    let pool = sqlx::PgPool::connect(&server.database_url).await.unwrap();
    sqlx::query(
        "INSERT INTO workflow_runs (job_kind, user_id, status, inputs_json) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(kind)
    .bind(uuid::Uuid::parse_str(user_id).unwrap())
    .bind(status)
    .bind(serde_json::json!({ "task": "t" }))
    .execute(&pool)
    .await
    .expect("insert background run");
}

/// REGRESSION (blind audit, round 1) — the guard must NOT turn `?status=` into
/// "no filter".
///
/// The first cut routed these through `normalize_text_filter`, which maps a
/// blank value to `None`. Because the repository binds
/// `AND ($2::text IS NULL OR status = $2)`, that silently widened `?status=`
/// from "match the empty string" (0 rows) to no filter at all (every run the
/// caller owns) — a filter the client explicitly sent being discarded. The fix
/// is `guard_raw`, which adds the NUL rejection and nothing else.
///
/// REAL rows are seeded on purpose: on an EMPTY table "filtered returns 0" and
/// "unfiltered returns 0" are the same observation, so the test would have been
/// a tautology and could not have caught the very regression it exists for.
#[tokio::test]
async fn empty_filter_values_still_filter_and_do_not_widen() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "bg_empty", &["background::use"]).await;
    insert_bg_run(&server, &user.user_id, "subagent", "completed").await;
    insert_bg_run(&server, &user.user_id, "sandbox_exec", "failed").await;

    // Baseline: the unfiltered list is NON-EMPTY, which is what makes the
    // assertions below able to fail.
    let (status, unfiltered) = get(&server, &user.token, "/background/runs").await;
    assert_eq!(status, StatusCode::OK, "{unfiltered}");
    let all = unfiltered["total"].as_i64().expect("total");
    assert_eq!(all, 2, "two seeded runs must be visible: {unfiltered}");

    // A real filter value selects a strict subset — proves the parameter is read.
    let (_, one) = get(&server, &user.token, "/background/runs?status=completed").await;
    assert_eq!(
        one["total"], 1,
        "?status=completed selects one of two: {one}"
    );
    let (_, one) = get(&server, &user.token, "/background/runs?kind=subagent").await;
    assert_eq!(one["total"], 1, "?kind=subagent selects one of two: {one}");

    // The regression: an EMPTY value must match nothing, NOT fall back to all 2.
    for path in ["/background/runs?status=", "/background/runs?kind="] {
        let (status, body) = get(&server, &user.token, path).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
        assert_eq!(
            body["total"], 0,
            "{path}: an empty filter value binds the empty string and must match \
             NOTHING; returning the unfiltered {all} rows is the widening bug: {body}"
        );
    }
}
