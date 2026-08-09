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

    // All seven endpoints from the reported table (plus /groups, which shares
    // the shape). /users and /groups were missing from the first cut, which
    // left two of the reported ten unexplained.
    for path in [
        "/users",
        "/groups",
        "/workflows",
        "/skills",
        "/assistants",
        "/llm-providers",
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

/// INV-4 at the HTTP tier — the guard is NARROW.
///
/// The other negative control probes `?sort` and `?status`, which this change
/// never touched, so no edit here could make it fail. THIS one probes the
/// parameters the guard actually runs on: a non-NUL control character
/// (newline / tab / ESC / DEL) in a GUARDED filter must still be 200. It goes
/// red the moment someone "hardens" the guard to `char::is_control()`.
#[tokio::test]
async fn non_nul_control_characters_in_a_guarded_param_are_still_accepted() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "nul_narrow", SWEEP_PERMISSIONS).await;

    for enc in ["%0A", "%09", "%1B", "%7F"] {
        for base in [
            "/projects?search=a",
            "/memories?search=a",
            "/mcp/servers?search=a",
        ] {
            let path = format!("{base}{enc}b");
            let (status, body) = get(&server, &user.token, &path).await;
            assert_eq!(
                status,
                StatusCode::OK,
                "GET {path}: a non-NUL control character is storable and must \
                 stay a 200 (it simply matches nothing); body = {body}"
            );
        }
    }
}

/// TEST-30 — the BODY-path members of the SAME class.
///
/// Found only after the blind audit pointed out that the shared guard's own
/// module doc claimed request-body coverage it did not have. A live probe then
/// showed these four still returning the exact 500 this branch exists to
/// eliminate: same Postgres `22021`, same root cause, one function call away.
/// Each carries its happy-path counterpart in the same loop iteration, so a
/// 400 can never be a symptom of a broken create endpoint.
#[tokio::test]
async fn nul_in_a_request_body_text_field_is_also_a_400() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(
        &server,
        "nul_body",
        &[
            "assistants::create",
            "conversations::create",
            "knowledge_base::manage",
            "memory::write",
            "memory::read",
        ],
    )
    .await;

    // (path, valid body, NUL-bearing body, expected success status)
    let cases: [(&str, serde_json::Value, serde_json::Value, StatusCode); 6] = [
        (
            "/assistants",
            json!({ "name": "ok-desc", "description": "clean" }),
            json!({ "name": "bad-desc", "description": "a\u{0}b" }),
            StatusCode::CREATED,
        ),
        (
            "/assistants",
            json!({ "name": "ok-instr", "instructions": "clean" }),
            json!({ "name": "bad-instr", "instructions": "a\u{0}b" }),
            StatusCode::CREATED,
        ),
        (
            "/conversations",
            json!({ "title": "clean title" }),
            json!({ "title": "a\u{0}b" }),
            StatusCode::CREATED,
        ),
        (
            "/knowledge-bases",
            json!({ "name": "kb-ok", "description": "clean" }),
            json!({ "name": "kb-bad", "description": "a\u{0}b" }),
            StatusCode::CREATED,
        ),
        (
            "/memories",
            json!({ "content": "clean content", "kind": "fact", "importance": 50 }),
            json!({ "content": "a\u{0}b", "kind": "fact", "importance": 50 }),
            StatusCode::CREATED,
        ),
        // `metadata` is a jsonb bind, so the NUL is nested inside a JSON
        // string value — a different SQLSTATE (22P05) and invisible to a
        // scalar check on the serialized text, which is why it needs the
        // walking guard.
        (
            "/memories",
            json!({ "content": "meta ok", "kind": "fact", "importance": 50,
                    "metadata": { "x": "clean" } }),
            json!({ "content": "meta bad", "kind": "fact", "importance": 50,
                    "metadata": { "x": "a\u{0}b" } }),
            StatusCode::CREATED,
        ),
    ];

    let client = reqwest::Client::new();
    for (path, ok_body, nul_body, ok_status) in cases {
        // HAPPY-PATH COUNTERPART first — the endpoint genuinely accepts writes.
        let resp = client
            .post(server.api_url(path))
            .header("Authorization", format!("Bearer {}", user.token))
            .json(&ok_body)
            .send()
            .await
            .expect("post");
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        assert_eq!(status, ok_status, "POST {path} happy path: {body}");

        // The defect.
        let resp = client
            .post(server.api_url(path))
            .header("Authorization", format!("Bearer {}", user.token))
            .json(&nul_body)
            .send()
            .await
            .expect("post");
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        assert_ne!(
            status,
            StatusCode::INTERNAL_SERVER_ERROR,
            "POST {path}: a NUL in a body text field must never be a 500; body = {body}"
        );
        assert_eq!(status, StatusCode::BAD_REQUEST, "POST {path}: {body}");
        assert_eq!(
            body["error_code"], "VALIDATION_ERROR",
            "POST {path}: {body}"
        );
    }
}
