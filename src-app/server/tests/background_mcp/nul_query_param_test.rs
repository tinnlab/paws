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
        // HAPPY-PATH COUNTERPART — a legal filter value returns a well-formed
        // page (empty here: no runs are seeded), proving the filter path is
        // reached and the 400 below is a validation refusal.
        let (status, body) = get(&server, &user.token, benign_path).await;
        assert_eq!(status, StatusCode::OK, "happy path {benign_path}: {body}");
        assert!(
            body["runs"].is_array() && body["total"].is_number(),
            "{benign_path} must return a well-formed page: {body}"
        );

        assert_nul_is_rejected(&server, &user.token, nul_path).await;
    }

    // PERMISSION CONTROL — without `background::use` the same URL is a 403,
    // so the 400 above is specifically a validation refusal.
    let nobody = create_user_with_no_permissions(&server, "bg_nul_noperm").await;
    let (status, _) = get(&server, &nobody.token, "/background/runs?status=completed").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "unpermitted caller");
}
