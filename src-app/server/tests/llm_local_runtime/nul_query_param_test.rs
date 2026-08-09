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

/// REGRESSION (blind audit, round 1) — `?engine=` must stay a filter.
///
/// `list_runtime_versions` previously did `if let Some(engine) = params.engine`
/// on an OWNED String, so `?engine=` was `Some("")` and queried
/// `WHERE engine = ''` -> 0 rows. Routing it through a normalizer that maps
/// blank to `None` flipped it to the `else` arm -> EVERY version of EVERY
/// engine. `guard_raw` preserves the original meaning.
#[tokio::test]
async fn empty_engine_filter_still_filters_and_does_not_widen() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(
        &server,
        "rtver_empty",
        &["llm_local_runtime::versions_read"],
    )
    .await;

    let (status, body) = get(&server, &user.token, "/local-runtime/versions?engine=").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["versions"].as_array().map(|a| a.len()),
        Some(0),
        "an empty engine filter must match nothing, not fall back to unfiltered: {body}"
    );
}
