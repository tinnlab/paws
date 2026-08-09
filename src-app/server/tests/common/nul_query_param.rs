//! Shared driver for the NUL-in-a-free-text-query-parameter class.
//!
//! A NUL byte (`U+0000`) cannot exist in a Postgres `text` value — the wire
//! protocol rejects it with `22021 invalid byte sequence for encoding "UTF8"`,
//! which `AppError::database_error` correctly refuses to leak and therefore
//! flattens into a generic **500** `SYSTEM_DATABASE_ERROR`. Every list endpoint
//! that binds a free-text query parameter into SQL therefore answered 500 to a
//! parameter the client got wrong, instead of telling the client it was wrong.
//!
//! The endpoints that LOOKED healthy were not validating anything: they simply
//! have no such parameter, so axum's `Query` extractor discarded
//! `?search=%00` unread (`the_unfiltered_endpoints_ignore_the_parameter`
//! proves this by hashing their bodies).

#![allow(dead_code)]

use reqwest::StatusCode;
use serde_json::Value;

use crate::common::TestServer;

/// GET `path` with the caller's bearer token; returns (status, body).
pub async fn get(server: &TestServer, token: &str, path: &str) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .get(server.api_url(path))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap_or_else(|e| panic!("GET {path} failed: {e}"));
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    (status, body)
}

/// Assert that a NUL in `path`'s query parameter is refused as a typed
/// client error — 400 `VALIDATION_ERROR` — and NOT as a 500.
pub async fn assert_nul_is_rejected(server: &TestServer, token: &str, path: &str) {
    let (status, body) = get(server, token, path).await;
    assert_ne!(
        status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "GET {path}: a NUL in a client-supplied parameter must never surface as a 500 \
         (that is the defect); body = {body}"
    );
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "GET {path}: expected 400; body = {body}"
    );
    assert_eq!(
        body["error_code"], "VALIDATION_ERROR",
        "GET {path}: expected the repo-wide validation error code; body = {body}"
    );
}

/// Assert the happy-path counterpart: the SAME endpoint, with a benign value
/// for the SAME parameter, still answers 200. Without this a rejection test
/// would pass just as well against a permanently-broken endpoint.
pub async fn assert_benign_value_is_accepted(server: &TestServer, token: &str, path: &str) {
    let (status, body) = get(server, token, path).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "GET {path}: the happy-path counterpart must still work, else the 400 above \
         proves nothing; body = {body}"
    );
}

/// Every route in the codebase whose query struct carries a free-text value
/// that reaches Postgres as a `text` bind — `(label, nul_path, benign_path)`.
///
/// `{CID}` is substituted with a real conversation id by the caller.
///
/// Derived from an exhaustive sweep of every `Query<..>` extractor in
/// `server/src/modules`. Parameters that are whitelisted to a fixed vocabulary
/// before binding (`conversations?sort`), mapped to a bool
/// (`mcp/servers?status`), parsed into an enum (`llm-models/downloads?status`),
/// or that never touch SQL at all are deliberately NOT here — they are covered
/// as negative controls by `whitelisted_params_are_unaffected`.
pub const FREE_TEXT_SQL_BOUND_PARAMS: &[(&str, &str, &str)] = &[
    (
        "projects?search",
        "/projects?search=%00",
        "/projects?search=x",
    ),
    (
        "conversations?search",
        "/conversations?search=%00",
        "/conversations?search=x",
    ),
    (
        "conversations/{id}/messages/search?q",
        "/conversations/{CID}/messages/search?q=%00",
        "/conversations/{CID}/messages/search?q=x",
    ),
    (
        "mcp/servers?search",
        "/mcp/servers?search=%00",
        "/mcp/servers?search=x",
    ),
    (
        "mcp/system-servers?search",
        "/mcp/system-servers?search=%00",
        "/mcp/system-servers?search=x",
    ),
    (
        "memories?search",
        "/memories?search=%00",
        "/memories?search=x",
    ),
    ("memories?kind", "/memories?kind=%00", "/memories?kind=fact"),
    (
        "memories?source",
        "/memories?source=%00",
        "/memories?source=manual",
    ),
    (
        "background/runs?status",
        "/background/runs?status=%00",
        "/background/runs?status=completed",
    ),
    (
        "background/runs?kind",
        "/background/runs?kind=%00",
        "/background/runs?kind=subagent",
    ),
    (
        "mcp/tool-calls?tool_use_id",
        "/mcp/tool-calls?tool_use_id=%00",
        "/mcp/tool-calls?tool_use_id=toolu_notarealid",
    ),
    (
        "local-runtime/versions?engine",
        "/local-runtime/versions?engine=%00",
        "/local-runtime/versions?engine=llamacpp",
    ),
];

/// The permission set an account needs to reach every row of
/// [`FREE_TEXT_SQL_BOUND_PARAMS`] (so a 403 can never be mistaken for a pass).
pub const SWEEP_PERMISSIONS: &[&str] = &[
    "projects::read",
    "conversations::read",
    "conversations::create",
    "messages::read",
    "mcp_servers::read",
    "mcp_servers_admin::read",
    "memory::read",
    "memory::write",
    "background::use",
    "llm_local_runtime::versions_read",
];
