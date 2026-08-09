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

    // Seed two versions of DIFFERENT engines so the happy-path leg asserts the
    // filter SELECTS. `is_array()` on an empty table would be satisfied by a
    // handler that never reads `engine`.
    insert_version(&server, "llamacpp", "b1").await;
    insert_version(&server, "mistralrs", "v1").await;

    let (status, body) = get(
        &server,
        &user.token,
        "/local-runtime/versions?engine=llamacpp",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert_eq!(
        body["versions"].as_array().map(|a| a.len()),
        Some(1),
        "?engine=llamacpp must select ONE of the two seeded versions; \
         returning both means the filter is ignored: {body}"
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

/// Register a runtime version row directly. Downloading a real engine binary
/// is not viable in a unit-cost test, and the filter under test is pure SQL.
async fn insert_version(server: &TestServer, engine: &str, version: &str) {
    let pool = sqlx::PgPool::connect(&server.database_url).await.unwrap();
    sqlx::query(
        "INSERT INTO llm_runtime_versions \
         (engine, version, platform, arch, backend, binary_path) \
         VALUES ($1, $2, 'linux', 'x86_64', 'cpu', '/nonexistent/bin')",
    )
    .bind(engine)
    .bind(version)
    .execute(&pool)
    .await
    .expect("insert runtime version");
}

/// REGRESSION (blind audit, round 1) — `?engine=` must stay a filter.
///
/// `list_runtime_versions` previously did `if let Some(engine) = params.engine`
/// on an OWNED String, so `?engine=` was `Some("")` and queried
/// `WHERE engine = ''` -> 0 rows. Routing it through a normalizer that maps
/// blank to `None` flipped it to the `else` arm -> EVERY version of EVERY
/// engine. `guard_raw` preserves the original meaning.
///
/// REAL rows are seeded: on an empty table the filtered and unfiltered lists
/// are both empty, so the test could not distinguish the two behaviours.
#[tokio::test]
async fn empty_engine_filter_still_filters_and_does_not_widen() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(
        &server,
        "rtver_empty",
        &["llm_local_runtime::versions_read"],
    )
    .await;
    insert_version(&server, "llamacpp", "b1").await;
    insert_version(&server, "mistralrs", "v1").await;

    let len = |body: &serde_json::Value| body["versions"].as_array().map(|a| a.len()).unwrap_or(0);

    // Unfiltered is NON-EMPTY — what the assertion below can fail against.
    let (status, all) = get(&server, &user.token, "/local-runtime/versions").await;
    assert_eq!(status, StatusCode::OK, "{all}");
    assert_eq!(len(&all), 2, "two seeded versions must be visible: {all}");

    // A real engine selects a strict subset — proves the parameter is read.
    let (_, one) = get(
        &server,
        &user.token,
        "/local-runtime/versions?engine=llamacpp",
    )
    .await;
    assert_eq!(len(&one), 1, "?engine=llamacpp selects one of two: {one}");

    // The regression: an EMPTY value must match nothing, not fall back to both.
    let (status, body) = get(&server, &user.token, "/local-runtime/versions?engine=").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        len(&body),
        0,
        "an empty engine filter must match nothing; returning all 2 versions is \
         the widening bug: {body}"
    );
}
