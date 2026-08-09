//! TEST-8 [acceptance][INV-5] — the WHOLE class, not the three endpoints where
//! the 500 happened to be observed.
//!
//! Plus the two controls that make the result mean something:
//!   * every row's benign counterpart still answers 200, so a 400 can never be
//!     a dead route;
//!   * the endpoints that appeared "safe" are shown to IGNORE the parameter
//!     rather than validate it — the actual three-vs-seven explanation.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::nul_query_param::{
    FREE_TEXT_SQL_BOUND_PARAMS, SWEEP_PERMISSIONS, assert_benign_value_is_accepted,
    assert_nul_is_rejected, get,
};
use crate::common::test_helpers::create_user_with_permissions;

/// Create a conversation so the `messages/search` row has a real id to hit.
async fn seed_conversation(server: &TestServer, token: &str) -> String {
    let resp = reqwest::Client::new()
        .post(server.api_url("/conversations"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "title": "nul sweep conversation" }))
        .send()
        .await
        .expect("create conversation");
    assert_eq!(resp.status(), StatusCode::CREATED, "seed conversation");
    let body: Value = resp.json().await.expect("conversation json");
    body["id"].as_str().expect("conversation id").to_string()
}

/// TEST-8 — a NUL is a typed 400 on EVERY free-text SQL-bound query parameter,
/// and each one's benign counterpart still answers 200.
#[tokio::test]
async fn nul_is_rejected_on_every_free_text_sql_bound_param() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "nul_sweep", SWEEP_PERMISSIONS).await;
    let cid = seed_conversation(&server, &user.token).await;

    // The table is the inventory. If a row is ever silently dropped — the way
    // this class grew unnoticed in the first place — this fails.
    assert_eq!(
        FREE_TEXT_SQL_BOUND_PARAMS.len(),
        12,
        "the free-text SQL-bound parameter inventory changed; if you ADDED a \
         parameter, guard it with common::text_guard and add its row here"
    );

    for (label, nul_path, benign_path) in FREE_TEXT_SQL_BOUND_PARAMS {
        let nul_path = nul_path.replace("{CID}", &cid);
        let benign_path = benign_path.replace("{CID}", &cid);

        // The happy-path counterpart FIRST: if this endpoint is broken for an
        // unrelated reason, the rejection assertion below is worthless.
        assert_benign_value_is_accepted(&server, &user.token, &benign_path).await;
        assert_nul_is_rejected(&server, &user.token, &nul_path).await;
        eprintln!("  {label}: NUL→400, benign→200");
    }
}

/// The three-vs-seven explanation, asserted rather than assumed: the endpoints
/// that answered 200 to `?search=%00` do not validate it — they have no such
/// parameter, so the extractor discards it. Their body for `?search=%00` is
/// byte-identical to their body with no parameter at all AND to their body with
/// a parameter name that certainly does not exist.
#[tokio::test]
async fn the_unfiltered_endpoints_ignore_the_parameter_rather_than_validate_it() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(
        &server,
        "nul_ignored",
        &[
            "users::read",
            "groups::read",
            "workflows::read",
            "skills::read",
            "assistants::read",
            "llm_providers::read",
            "knowledge_base::use",
            "citations::use",
        ],
    )
    .await;

    for path in [
        "/workflows",
        "/skills",
        "/assistants",
        "/knowledge-bases",
        "/citations",
    ] {
        let (s_none, b_none) = get(&server, &user.token, path).await;
        let (s_nul, b_nul) = get(&server, &user.token, &format!("{path}?search=%00")).await;
        let (s_bogus, b_bogus) = get(
            &server,
            &user.token,
            &format!("{path}?zzz_no_such_param=%00"),
        )
        .await;

        assert_eq!(s_none, StatusCode::OK, "{path} baseline");
        assert_eq!(s_nul, s_none, "{path}: ?search=%00 status");
        assert_eq!(s_bogus, s_none, "{path}: bogus-param status");
        assert_eq!(
            b_nul, b_none,
            "{path}: ?search=%00 returned a DIFFERENT body from no-param — it is \
             not being ignored, so it must be guarded and added to \
             FREE_TEXT_SQL_BOUND_PARAMS"
        );
        assert_eq!(
            b_bogus, b_none,
            "{path}: an unknown parameter must be discarded (control)"
        );
    }
}

/// Negative control for the class boundary: a free-text parameter that is
/// whitelisted or mapped to a non-text type before binding never reaches
/// Postgres as text, so a NUL in it is NOT an error — it falls back to the
/// default. This is what keeps the guard narrow: it must not creep onto
/// parameters that were already safe.
#[tokio::test]
async fn whitelisted_and_bool_mapped_params_are_unaffected() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(
        &server,
        "nul_negctl",
        &["conversations::read", "mcp_servers::read"],
    )
    .await;

    for path in [
        // `sort` is collapsed to one of four &'static str keys before binding.
        "/conversations?sort=%00",
        // `status` is mapped to Option<bool> before binding.
        "/mcp/servers?status=%00",
    ] {
        let (status, body) = get(&server, &user.token, path).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "GET {path}: a non-text-bound parameter must stay unaffected by the \
             NUL guard; body = {body}"
        );
    }
}
