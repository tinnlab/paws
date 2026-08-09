//! TEST-22 — `/local-runtime/versions?engine` refuses a NUL with a typed 400,
//! not a 500.
//!
//! `engine` is bound as `WHERE engine = $1` with no validation. It was not in
//! the reported defect; the pre-fix reproduction confirmed it returned 500.

use reqwest::StatusCode;

use crate::common::TestServer;
use crate::common::nul_query_param::{assert_nul_is_rejected, get};
use crate::common::test_helpers::{create_user_with_no_permissions, create_user_with_permissions};

#[tokio::test]
async fn runtime_versions_engine_filter_rejects_nul() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "rtver_nul", &["llm_local_runtime::versions_read"])
            .await;

    // HAPPY-PATH COUNTERPART — a real engine name returns a well-formed page
    // (empty: no engine version is installed in the test env), proving the
    // filter path is reached.
    let (status, body) = get(
        &server,
        &user.token,
        "/local-runtime/versions?engine=llamacpp",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert!(
        body["versions"].is_array(),
        "must return a well-formed page: {body}"
    );

    // The defect.
    assert_nul_is_rejected(&server, &user.token, "/local-runtime/versions?engine=%00").await;

    // PERMISSION CONTROL.
    let nobody = create_user_with_no_permissions(&server, "rtver_nul_noperm").await;
    let (status, _) = get(
        &server,
        &nobody.token,
        "/local-runtime/versions?engine=llamacpp",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "unpermitted caller");
}
