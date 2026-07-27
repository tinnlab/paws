//! JSON-RPC handler for the built-in control MCP server.
//!
//! Gated on `control::use` (`RequirePermissions`). Three tools:
//! `list_capabilities` / `describe_capability` / `invoke_capability`. The first
//! two are metadata reads over the in-process [`catalog`]; the third dispatches
//! to the REAL REST route over loopback, forwarding the caller's JWT so the
//! target route's own `RequirePermissions` re-authorizes from the DB — no authz
//! is reimplemented here.
//!
//! Precision comes from the catalog (operation_id → method/path/schema);
//! security from three layers: the deployment [`policy`] denylist, the per-user
//! permission filter applied to ALL THREE tools (the model never sees an op it
//! can't run), and the forwarded-JWT loopback call (the real gate).

use std::sync::{LazyLock, OnceLock};
use std::time::Duration;

use axum::{
    Json, debug_handler,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::common::AppError;
use crate::modules::code_sandbox::types::{JsonRpcError, JsonRpcRequest, JsonRpcResponse};
use crate::modules::permissions::RequirePermissions;
use crate::modules::permissions::checker::check_permission_union;
use crate::modules::user::models::{Group, User};

use super::catalog::{self, ControlCatalog, Operation};
use super::permissions::ControlUse;
use super::policy;
use super::tools;

/// Cap on the response body we relay back to the model (mirrors the chat-path
/// tool-result caps). Larger responses are truncated with a marker.
const MAX_RESULT_BYTES: usize = 1024 * 1024;
/// Cap on how many operations `list_capabilities` returns in one call.
const MAX_LIST_RESULTS: usize = 200;

/// The loopback base URL (`http://<host>:<port>`) the invoke path dispatches to.
/// Set once at module init from the server config. Never model-supplied, so the
/// invoke target host is fixed — the model only controls the path/params of a
/// route that already exists in OUR catalog.
static CONTROL_BASE_URL: OnceLock<String> = OnceLock::new();

pub fn set_base_url(base: String) {
    let _ = CONTROL_BASE_URL.set(base);
}

/// One shared client for the loopback dispatch (per guidelines §2). Loopback
/// only, but we still bound it and refuse redirects (a REST route should not
/// 3xx us off-host).
///
/// Built lazily on the FIRST request, so a build failure maps to an AppError at
/// the dispatch site rather than panicking the worker. reqwest's build is
/// near-infallible (only TLS-backend init can fail) and deterministic, so
/// caching the `None` is fine.
static HTTP_CLIENT: LazyLock<Option<reqwest::Client>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| {
            tracing::error!(error = %e, "control_mcp: failed to build loopback HTTP client");
        })
        .ok()
});

#[debug_handler]
pub async fn jsonrpc_handler(
    auth: RequirePermissions<(ControlUse,)>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let req: JsonRpcRequest = match serde_json::from_slice::<Value>(&body)
        .map_err(|e| JsonRpcError::parse_error(e.to_string()))
        .and_then(|raw| {
            serde_json::from_value(raw).map_err(|e| JsonRpcError::invalid_request(e.to_string()))
        }) {
        Ok(r) => r,
        Err(err) => return error_response(None, StatusCode::BAD_REQUEST, err),
    };

    // Notifications (no id) get an ACK, no body.
    if req.id.is_none() {
        return StatusCode::ACCEPTED.into_response();
    }
    let id = req.id.clone();

    match req.method.as_str() {
        "initialize" => ok_response(
            id,
            json!({
                "protocolVersion": "2025-11-25",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "control", "version": env!("CARGO_PKG_VERSION") },
            }),
        ),
        "tools/list" => ok_response(id, tools::tool_list()),
        "ping" => ok_response(id, json!({})),
        "tools/call" => {
            let call: ToolCallParams = match serde_json::from_value(req.params.clone()) {
                Ok(c) => c,
                Err(e) => {
                    return error_response(
                        id,
                        StatusCode::OK,
                        JsonRpcError::invalid_params(format!("tools/call params: {e}")),
                    );
                }
            };
            let Some(catalog) = catalog::catalog() else {
                return error_response(
                    id,
                    StatusCode::OK,
                    JsonRpcError::internal(
                        "control catalog unavailable (server did not initialize it)".to_string(),
                    ),
                );
            };
            let result = match call.name.as_str() {
                tools::LIST_CAPABILITIES => {
                    list_capabilities(&auth.user, &auth.groups, catalog, &call.arguments)
                }
                tools::DESCRIBE_CAPABILITY => {
                    describe_capability(&auth.user, &auth.groups, catalog, &call.arguments)
                }
                tools::INVOKE_CAPABILITY => {
                    invoke_capability(&auth.user, &auth.groups, catalog, &headers, &call.arguments)
                        .await
                }
                other => Err(AppError::bad_request(
                    "UNKNOWN_TOOL",
                    format!("control tool: {other}"),
                )),
            };
            match result {
                Ok(value) => ok_response(id, value),
                Err(e) => error_response(id, StatusCode::OK, JsonRpcError::from_app_error(&e)),
            }
        }
        _ => error_response(id, StatusCode::OK, JsonRpcError::method_not_found(&req.method)),
    }
}

#[derive(Debug, Deserialize)]
struct ToolCallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

/// Decide whether a control tool call must go through the explicit approval
/// prompt. Called from `mcp/chat_extension/mcp.rs`'s classification loop — the
/// control server is deliberately NOT on the blanket approval-bypass list, so
/// this per-tool rule governs it:
/// - `list_capabilities` / `describe_capability` → read-only metadata, auto-run.
/// - `invoke_capability` of a GET operation → read-only, auto-run.
/// - `invoke_capability` of a mutating operation → ALWAYS approve (even under
///   `ApprovalMode::AutoApprove` — that's the security posture).
/// - anything unrecognized (unknown tool / unknown op / catalog unavailable) →
///   approve (fail-safe).
pub fn control_call_needs_approval(tool_name: &str, input: &Value) -> bool {
    needs_approval_decision(tool_name, input, catalog::catalog())
}

/// Pure core of [`control_call_needs_approval`] (catalog injected) so the
/// security-critical decision is unit-testable without the global `OnceLock`.
fn needs_approval_decision(
    tool_name: &str,
    input: &Value,
    catalog: Option<&ControlCatalog>,
) -> bool {
    match tool_name {
        tools::LIST_CAPABILITIES | tools::DESCRIBE_CAPABILITY => false,
        tools::INVOKE_CAPABILITY => {
            let Some(op_id) = input.get("operation_id").and_then(|v| v.as_str()) else {
                return true; // malformed → approve
            };
            match catalog.and_then(|c| c.get(op_id)) {
                Some(op) => policy::is_mutating(&op.method),
                None => true, // unknown op / no catalog → approve
            }
        }
        _ => true,
    }
}

// ── Permission filter (applied to ALL three tools) ───────────────────────────

/// True when `user` may run `op`. Admins short-circuit (mirrors
/// `RequirePermissions`); otherwise the op's required permission must be held.
/// An op with no declared permission (and not denied by policy) is allowed —
/// the real route enforces nothing there either.
pub fn user_may_run(user: &User, groups: &[Group], op: &Operation) -> bool {
    if user.is_admin {
        return true;
    }
    match op.required_permission.as_deref() {
        Some(perm) => check_permission_union(user, groups, perm),
        None => true,
    }
}

/// An op is offered to the model only when it is not policy-denied AND the user
/// is permitted to run it.
fn op_available(user: &User, groups: &[Group], op: &Operation) -> bool {
    !policy::is_denied(op) && user_may_run(user, groups, op)
}

// ── list_capabilities ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
struct ListArgs {
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    tag: Option<String>,
}

// ── search (tokenized, all-terms, relevance-ranked) ──────────────────────────
//
// The shipped matcher lowercased the WHOLE query and did one `.contains(q)` per
// field, so a natural two-word request — the one a model actually sends —
// matched NOTHING: no `operation_id` or `tag` ever contains a space, and no
// summary contains the literal phrase `"create project"`. Live evidence: a real
// session's `list_capabilities{query:"create project"}` returned 0 while
// `"project"` returned 24 and `"create"` returned 21, and the model then flailed.
//
// So: split the query on whitespace and require EVERY term to match at least one
// field (each term may match a different field), then order by relevance so the
// operation the phrase actually describes comes first. Single-term queries are
// unaffected in membership (one term ⇒ the same predicate) and, when every
// candidate scores alike, the `operation_id` tie-break reproduces the old
// alphabetical order exactly.

/// Per-term score for the best field it hits. Higher = more precise signal.
/// `operation_id` is "the stable key the model addresses", so it outranks the
/// noisier prose of `summary`.
const SCORE_ID_SEGMENT: u32 = 8;
const SCORE_ID_SUBSTRING: u32 = 6;
const SCORE_TAG_EXACT: u32 = 4;
const SCORE_SUMMARY_WORD: u32 = 3;
const SCORE_SUMMARY_SUBSTRING: u32 = 1;

/// Lowercase whitespace-split search terms. Empty when the query is blank, which
/// the caller treats as "no filter" (unchanged passthrough behavior).
fn query_terms(query: &str) -> Vec<String> {
    query.split_whitespace().map(str::to_lowercase).collect()
}

/// Lowercase segments of an operation id: `Project.updateMcpSettings` →
/// `["project", "update", "mcp", "settings"]`. Splits on `.`/`_`/`-` and on
/// camelCase boundaries, so a term like `create` matches the `create` segment of
/// `Project.create` exactly rather than merely as a substring.
fn id_segments(operation_id: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for ch in operation_id.chars() {
        if ch == '.' || ch == '_' || ch == '-' {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
            continue;
        }
        if ch.is_uppercase() && prev_lower && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        prev_lower = ch.is_lowercase() || ch.is_numeric();
        cur.extend(ch.to_lowercase());
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Words of a summary, lowercased, split on anything non-alphanumeric.
fn summary_words(summary: &str) -> Vec<String> {
    summary
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Score ONE term against an operation. `0` means the term does not match at all.
fn term_score(op: &Operation, term: &str) -> u32 {
    if id_segments(&op.operation_id).iter().any(|s| s == term) {
        return SCORE_ID_SEGMENT;
    }
    if op.operation_id.to_lowercase().contains(term) {
        return SCORE_ID_SUBSTRING;
    }
    if op.tags.iter().any(|t| t.eq_ignore_ascii_case(term)) {
        return SCORE_TAG_EXACT;
    }
    let summary_lower = op.summary.to_lowercase();
    if summary_words(&op.summary).iter().any(|w| w == term) {
        return SCORE_SUMMARY_WORD;
    }
    if summary_lower.contains(term) {
        return SCORE_SUMMARY_SUBSTRING;
    }
    // A tag substring is the weakest signal but was matched by the old
    // whole-phrase predicate, so keep it — "single-term behavior at least as
    // good as today".
    if op.tags.iter().any(|t| t.to_lowercase().contains(term)) {
        return SCORE_SUMMARY_SUBSTRING;
    }
    0
}

/// Relevance of an operation for ALL `terms`, or `None` when any term fails to
/// match — i.e. the ALL-terms rule. An empty `terms` slice matches everything at
/// score 0 (the no-query passthrough).
fn op_match_score(op: &Operation, terms: &[String]) -> Option<u32> {
    let mut total = 0u32;
    for term in terms {
        match term_score(op, term) {
            0 => return None,
            s => total = total.saturating_add(s),
        }
    }
    Some(total)
}

fn list_capabilities(
    user: &User,
    groups: &[Group],
    catalog: &ControlCatalog,
    args: &Value,
) -> Result<Value, AppError> {
    let args: ListArgs = serde_json::from_value(args.clone()).unwrap_or_default();
    let terms = args.query.as_deref().map(query_terms).unwrap_or_default();
    let tag = args.tag.as_deref();

    let mut scored: Vec<(u32, &Operation)> = catalog
        .iter()
        .filter(|op| op_available(user, groups, op))
        .filter(|op| match &tag {
            Some(t) => op.tags.iter().any(|opt| opt.eq_ignore_ascii_case(t)),
            None => true,
        })
        .filter_map(|op| op_match_score(op, &terms).map(|score| (score, op)))
        .collect();

    // Most relevant first; `operation_id` ASC breaks ties, so an unscored list
    // (no query, or one relevance class) keeps the previous alphabetical order.
    scored.sort_by(|(sa, a), (sb, b)| sb.cmp(sa).then_with(|| a.operation_id.cmp(&b.operation_id)));
    let mut matched: Vec<&Operation> = scored.into_iter().map(|(_, op)| op).collect();
    let total = matched.len();
    let truncated = total > MAX_LIST_RESULTS;
    matched.truncate(MAX_LIST_RESULTS);

    let items: Vec<Value> = matched
        .iter()
        .map(|op| {
            json!({
                "operation_id": op.operation_id,
                "method": op.method,
                "summary": op.summary,
                "required_permission": op.required_permission,
                "mutating": policy::is_mutating(&op.method),
            })
        })
        .collect();

    let structured = json!({
        "operations": items,
        "returned": items.len(),
        "total": total,
        "truncated": truncated,
    });
    let mut text = format!(
        "{} operation(s) you can run{}:\n",
        total,
        if truncated {
            format!(" (showing first {MAX_LIST_RESULTS})")
        } else {
            String::new()
        }
    );
    for op in &matched {
        text.push_str(&format!("- {} [{}] — {}\n", op.operation_id, op.method, op.summary));
    }
    Ok(text_result(text, Some(structured)))
}

// ── describe_capability ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct DescribeArgs {
    operation_id: String,
}

fn describe_capability(
    user: &User,
    groups: &[Group],
    catalog: &ControlCatalog,
    args: &Value,
) -> Result<Value, AppError> {
    let args: DescribeArgs = serde_json::from_value(args.clone())
        .map_err(|e| AppError::bad_request("INVALID_PARAMS", format!("describe args: {e}")))?;
    let op = resolve_op(user, groups, catalog, &args.operation_id)?;

    let structured = json!({
        "operation_id": op.operation_id,
        "method": op.method,
        "path_template": op.path_template,
        "required_permission": op.required_permission,
        "mutating": policy::is_mutating(&op.method),
        "requires_approval": policy::is_mutating(&op.method),
        "path_params": op.path_params,
        "parameters": op.parameters,
        "request_schema": op.request_schema,
        "summary": op.summary,
    });
    let text = serde_json::to_string_pretty(&structured).unwrap_or_default();
    Ok(text_result(text, Some(structured)))
}

// ── invoke_capability ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
struct InvokeArgs {
    operation_id: String,
    #[serde(default)]
    path_params: std::collections::HashMap<String, String>,
    #[serde(default)]
    query: Option<Value>,
    #[serde(default)]
    body: Option<Value>,
}

async fn invoke_capability(
    user: &User,
    groups: &[Group],
    catalog: &ControlCatalog,
    headers: &HeaderMap,
    args: &Value,
) -> Result<Value, AppError> {
    let args: InvokeArgs = serde_json::from_value(args.clone())
        .map_err(|e| AppError::bad_request("INVALID_PARAMS", format!("invoke args: {e}")))?;
    let op = resolve_op(user, groups, catalog, &args.operation_id)?;

    // Validate the body shape up front (deterministic; nested validation is the
    // real route's job — it returns 400s we relay back).
    if let (Some(schema), Some(body)) = (&op.request_schema, &args.body)
        && let Err(msg) = validate_body(schema, body, catalog.components())
    {
        return Err(AppError::bad_request("INVALID_BODY", msg));
    }

    // Substitute + strictly validate path params.
    let path = substitute_path(&op.path_template, &op.path_params, &args.path_params)?;

    let base = CONTROL_BASE_URL
        .get()
        .ok_or_else(|| AppError::internal_error("control base url not initialized"))?;
    let mut url = reqwest::Url::parse(&format!("{base}{path}"))
        .map_err(|e| AppError::internal_with_id(format!("parse loopback url: {e}")))?;

    if let Some(Value::Object(q)) = &args.query {
        let mut pairs = url.query_pairs_mut();
        for (k, v) in q {
            let vs = match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            pairs.append_pair(k, &vs);
        }
    }

    let method = reqwest::Method::from_bytes(op.method.as_bytes())
        .map_err(|e| AppError::internal_with_id(format!("parse method: {e}")))?;
    let client = HTTP_CLIENT
        .as_ref()
        .ok_or_else(|| AppError::internal_error("control_mcp loopback client unavailable"))?;
    let mut request = client.request(method, url);

    // Forward the caller's bearer so the real route re-authorizes as this user.
    if let Some(auth_header) = headers.get("authorization").or_else(|| headers.get("Authorization")) {
        request = request.header(reqwest::header::AUTHORIZATION, auth_header);
    }
    // NOTE: we intentionally do NOT forward `x-sync-connection-id`. A control
    // mutation is model-initiated, so the originating device SHOULD receive the
    // resulting sync event (to update its UI) — forwarding the self-suppression
    // header would hide the change from that device (L7).
    if let Some(body) = &args.body {
        request = request.json(body);
    }

    let resp = request
        .send()
        .await
        .map_err(|e| AppError::internal_with_id(format!("loopback dispatch: {e}")))?;

    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::internal_with_id(format!("read loopback response: {e}")))?;

    let (text_body, truncated) = if bytes.len() > MAX_RESULT_BYTES {
        (
            String::from_utf8_lossy(&bytes[..MAX_RESULT_BYTES]).to_string(),
            true,
        )
    } else {
        (String::from_utf8_lossy(&bytes).to_string(), false)
    };
    let parsed: Option<Value> = serde_json::from_str(&text_body).ok();

    let is_error = !status.is_success();
    let structured = json!({
        "operation_id": op.operation_id,
        "status": status.as_u16(),
        "ok": status.is_success(),
        "truncated": truncated,
        "response": parsed.clone().unwrap_or(Value::Null),
    });
    let summary = if is_error {
        format!(
            "{} {} → HTTP {} (error). Response:\n{}",
            op.method, op.path_template, status, text_body
        )
    } else {
        format!(
            "{} {} → HTTP {} (ok). Response:\n{}",
            op.method, op.path_template, status, text_body
        )
    };

    let mut result = text_result(summary, Some(structured));
    if is_error {
        result["isError"] = Value::Bool(true);
    }
    Ok(result)
}

// ── shared helpers ───────────────────────────────────────────────────────────

/// Resolve an operation_id to an [`Operation`] the user may run. A denied op OR
/// one the user lacks permission for returns the SAME "not permitted" error, so
/// the model can't distinguish "forbidden" from "doesn't exist" — no probing.
fn resolve_op<'a>(
    user: &User,
    groups: &[Group],
    catalog: &'a ControlCatalog,
    operation_id: &str,
) -> Result<&'a Operation, AppError> {
    match catalog.get(operation_id) {
        Some(op) if op_available(user, groups, op) => Ok(op),
        _ => Err(AppError::forbidden(
            "NOT_PERMITTED",
            format!("operation '{operation_id}' is not available to you"),
        )),
    }
}

/// Substitute `{name}` path params. Each value must be present and contain only
/// URL-path-safe characters (alphanumerics + `-._~`), which blocks path
/// traversal (`..`, `/`) and host injection — the model cannot redirect the
/// loopback call off its intended route.
fn substitute_path(
    template: &str,
    expected: &[String],
    provided: &std::collections::HashMap<String, String>,
) -> Result<String, AppError> {
    let mut path = template.to_string();
    for name in expected {
        let value = provided.get(name).ok_or_else(|| {
            AppError::bad_request(
                "MISSING_PATH_PARAM",
                format!("path parameter '{name}' is required"),
            )
        })?;
        // Reject empty, disallowed chars, AND the dot-segments `.`/`..` — the
        // latter contain no `/` (so they pass the char check) but WHATWG URL
        // normalization collapses them, which would dispatch to a DIFFERENT
        // route than the one authorized/denylist-checked/approved (H1).
        if value.is_empty() || value == "." || value == ".." || !value.chars().all(is_path_safe) {
            return Err(AppError::bad_request(
                "INVALID_PATH_PARAM",
                format!("path parameter '{name}' is empty or contains disallowed characters"),
            ));
        }
        path = path.replace(&format!("{{{name}}}"), value);
    }
    Ok(path)
}

fn is_path_safe(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~')
}

/// Deterministic, shallow body validation: the top-level object's `required`
/// fields must be present, and — when `additionalProperties: false` — no unknown
/// keys are allowed. Deep/nested validation is delegated to the real route
/// (which returns a 400 we relay back), so we never falsely reject on an
/// OpenAPI/JSON-Schema dialect quirk.
fn validate_body(schema: &Value, body: &Value, components: &Value) -> Result<(), String> {
    let resolved = resolve_schema_ref(schema, components);
    let Some(obj) = resolved.as_object() else {
        return Ok(());
    };
    // Only validate object bodies.
    if obj.get("type").and_then(|t| t.as_str()) != Some("object") {
        return Ok(());
    }
    let body_obj = match body {
        Value::Object(m) => m,
        Value::Null => return Ok(()),
        _ => return Err("request body must be a JSON object".to_string()),
    };

    if let Some(required) = obj.get("required").and_then(|r| r.as_array()) {
        for field in required.iter().filter_map(|f| f.as_str()) {
            if !body_obj.contains_key(field) {
                return Err(format!("missing required field '{field}'"));
            }
        }
    }
    if obj.get("additionalProperties") != Some(&Value::Bool(false)) {
        return Ok(());
    }
    if let Some(props) = obj.get("properties").and_then(|p| p.as_object())
        && let Some(key) = body_obj.keys().find(|k| !props.contains_key(*k))
    {
        return Err(format!("unknown field '{key}'"));
    }
    Ok(())
}

/// Follow a single top-level `$ref: #/components/schemas/Name` into the shared
/// components. Returns the input unchanged when it is not a `$ref`.
fn resolve_schema_ref(schema: &Value, components: &Value) -> Value {
    let Some(reference) = schema.get("$ref").and_then(|r| r.as_str()) else {
        return schema.clone();
    };
    let Some(name) = reference.strip_prefix("#/components/schemas/") else {
        return schema.clone();
    };
    components
        .get("schemas")
        .and_then(|s| s.get(name))
        .cloned()
        .unwrap_or_else(|| schema.clone())
}

fn text_result(text: impl Into<String>, structured: Option<Value>) -> Value {
    let mut obj = json!({ "content": [{ "type": "text", "text": text.into() }] });
    if let Some(s) = structured {
        obj["structuredContent"] = s;
    }
    obj
}

fn ok_response(id: Option<Value>, result: Value) -> Response {
    (
        StatusCode::OK,
        Json(JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }),
    )
        .into_response()
}

fn error_response(id: Option<Value>, http: StatusCode, err: JsonRpcError) -> Response {
    (
        http,
        Json(JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(err),
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn schema_obj() -> Value {
        json!({
            "type": "object",
            "required": ["username"],
            "additionalProperties": false,
            "properties": {
                "username": { "type": "string" },
                "email": { "type": "string" }
            }
        })
    }

    #[test]
    fn validate_body_accepts_valid() {
        let c = json!({});
        assert!(validate_body(&schema_obj(), &json!({"username": "a"}), &c).is_ok());
        assert!(validate_body(&schema_obj(), &json!({"username": "a", "email": "x"}), &c).is_ok());
    }

    #[test]
    fn validate_body_rejects_missing_required() {
        let c = json!({});
        let err = validate_body(&schema_obj(), &json!({"email": "x"}), &c).unwrap_err();
        assert!(err.contains("username"));
    }

    #[test]
    fn validate_body_rejects_unknown_field() {
        let c = json!({});
        let err = validate_body(&schema_obj(), &json!({"username": "a", "role": "admin"}), &c)
            .unwrap_err();
        assert!(err.contains("role"));
    }

    #[test]
    fn validate_body_resolves_ref() {
        let components = json!({ "schemas": { "UserCreate": schema_obj() } });
        let schema = json!({ "$ref": "#/components/schemas/UserCreate" });
        assert!(validate_body(&schema, &json!({"username": "a"}), &components).is_ok());
        assert!(
            validate_body(&schema, &json!({"email": "x"}), &components)
                .unwrap_err()
                .contains("username")
        );
    }

    #[test]
    fn substitute_path_replaces_and_validates() {
        let expected = vec!["user_id".to_string()];
        let mut provided = std::collections::HashMap::new();
        provided.insert("user_id".to_string(), "abc-123".to_string());
        assert_eq!(
            substitute_path("/api/users/{user_id}", &expected, &provided).unwrap(),
            "/api/users/abc-123"
        );
    }

    #[test]
    fn substitute_path_rejects_traversal_and_missing() {
        let expected = vec!["id".to_string()];
        let mut bad = std::collections::HashMap::new();
        bad.insert("id".to_string(), "../secret".to_string());
        assert!(substitute_path("/api/x/{id}", &expected, &bad).is_err());

        let empty = std::collections::HashMap::new();
        assert!(substitute_path("/api/x/{id}", &expected, &empty).is_err());

        let mut slash = std::collections::HashMap::new();
        slash.insert("id".to_string(), "a/b".to_string());
        assert!(substitute_path("/api/x/{id}", &expected, &slash).is_err());

        // Bare dot-segments contain no `/` but WHATWG URL parsing collapses them
        // to a DIFFERENT route — must be rejected (H1).
        for bad in [".", ".."] {
            let mut m = std::collections::HashMap::new();
            m.insert("id".to_string(), bad.to_string());
            assert!(
                substitute_path("/api/projects/{id}/files", &expected, &m).is_err(),
                "path param '{bad}' must be rejected"
            );
        }
    }

    #[test]
    fn is_path_safe_blocks_dangerous_chars() {
        assert!("abc-123_x.y~z".chars().all(is_path_safe));
        assert!(!is_path_safe('/'));
        assert!(!is_path_safe('?'));
        assert!(!is_path_safe('@'));
        assert!(!is_path_safe(' '));
    }

    fn approval_fixture() -> catalog::ControlCatalog {
        catalog::build_catalog(&json!({
            "paths": {
                "/api/users": {
                    "post": { "operationId": "User.create", "summary": "" },
                    "get": { "operationId": "User.list", "summary": "" }
                }
            }
        }))
    }

    #[test]
    fn reads_never_need_approval() {
        let cat = approval_fixture();
        assert!(!needs_approval_decision(tools::LIST_CAPABILITIES, &json!({}), Some(&cat)));
        assert!(!needs_approval_decision(tools::DESCRIBE_CAPABILITY, &json!({}), Some(&cat)));
        // invoke of a GET op → read-only, no approval.
        assert!(!needs_approval_decision(
            tools::INVOKE_CAPABILITY,
            &json!({ "operation_id": "User.list" }),
            Some(&cat)
        ));
    }

    #[test]
    fn mutating_invoke_always_needs_approval() {
        let cat = approval_fixture();
        assert!(needs_approval_decision(
            tools::INVOKE_CAPABILITY,
            &json!({ "operation_id": "User.create" }),
            Some(&cat)
        ));
    }

    #[test]
    fn unknown_or_malformed_fails_safe_to_approval() {
        let cat = approval_fixture();
        // Unknown op.
        assert!(needs_approval_decision(
            tools::INVOKE_CAPABILITY,
            &json!({ "operation_id": "Nope.gone" }),
            Some(&cat)
        ));
        // Missing operation_id.
        assert!(needs_approval_decision(tools::INVOKE_CAPABILITY, &json!({}), Some(&cat)));
        // No catalog at all.
        assert!(needs_approval_decision(
            tools::INVOKE_CAPABILITY,
            &json!({ "operation_id": "User.list" }),
            None
        ));
        // Unknown tool.
        assert!(needs_approval_decision("mystery", &json!({}), Some(&cat)));
    }

    // ── search matcher (TEST-1 / TEST-2 / TEST-3) ────────────────────────────

    /// A slice of the REAL catalog shape — operation ids, summaries and tags
    /// copied from the committed `openapi.json` — so the ranking assertions are
    /// about real data, not about a fixture tuned to pass.
    fn search_fixture() -> catalog::ControlCatalog {
        catalog::build_catalog(&json!({
            "paths": {
                "/api/projects": {
                    "post": {
                        "operationId": "Project.create",
                        "summary": "Create a new chat project",
                        "tags": ["Projects"]
                    },
                    "get": {
                        "operationId": "Project.list",
                        "summary": "List the caller's projects",
                        "tags": ["Projects"]
                    }
                },
                "/api/projects/{id}": {
                    "put": {
                        "operationId": "Project.update",
                        "summary": "Update project",
                        "tags": ["Projects"]
                    },
                    "delete": {
                        "operationId": "Project.delete",
                        "summary": "Delete project",
                        "tags": ["Projects"]
                    }
                },
                "/api/projects/{id}/duplicate": {
                    "post": {
                        "operationId": "Project.duplicate",
                        "summary": "Duplicate a project",
                        "tags": ["Projects"]
                    }
                },
                "/api/projects/{id}/mcp-settings": {
                    "put": {
                        "operationId": "Project.updateMcpSettings",
                        "summary": "Update project MCP defaults",
                        "tags": ["Projects"]
                    }
                },
                "/api/assistants": {
                    "post": {
                        "operationId": "Assistant.create",
                        "summary": "Create a new user assistant",
                        "tags": ["Assistants"]
                    }
                },
                "/api/workflows": {
                    "post": {
                        "operationId": "Workflow.create",
                        "summary": "Create a user-scope workflow from a WorkflowDef",
                        "tags": ["Workflows"]
                    }
                }
            }
        }))
    }

    /// Rank the fixture by `query`, returning the operation ids in result order.
    fn ranked(cat: &catalog::ControlCatalog, query: &str) -> Vec<String> {
        let terms = query_terms(query);
        let mut scored: Vec<(u32, &Operation)> = cat
            .iter()
            .filter_map(|op| op_match_score(op, &terms).map(|s| (s, op)))
            .collect();
        scored
            .sort_by(|(sa, a), (sb, b)| sb.cmp(sa).then_with(|| a.operation_id.cmp(&b.operation_id)));
        scored.into_iter().map(|(_, op)| op.operation_id.clone()).collect()
    }

    /// The SHIPPED matcher, reproduced verbatim, so the regression it caused is
    /// encoded in the suite rather than described in a comment.
    fn legacy_whole_phrase_match(op: &Operation, query: &str) -> bool {
        let q = query.to_lowercase();
        op.operation_id.to_lowercase().contains(&q)
            || op.summary.to_lowercase().contains(&q)
            || op.tags.iter().any(|t| t.to_lowercase().contains(&q))
    }

    /// TEST-1 — the EXACT live-session query.
    ///
    /// A real user asked "create a new project please"; the model sent
    /// `list_capabilities{query:"create project"}` and got **0 results**. The
    /// multi-word query must now match, and `Project.create` must rank FIRST.
    #[test]
    fn create_project_query_matches_and_ranks_project_create_first() {
        let cat = search_fixture();

        // The bug, encoded: the shipped whole-phrase matcher finds NOTHING.
        assert_eq!(
            cat.iter().filter(|op| legacy_whole_phrase_match(op, "create project")).count(),
            0,
            "precondition: the shipped whole-phrase matcher is what returned 0 results"
        );

        let hits = ranked(&cat, "create project");
        assert!(!hits.is_empty(), "'create project' must match at least one operation");
        assert_eq!(
            hits.first().map(String::as_str),
            Some("Project.create"),
            "'create project' must rank Project.create first, got {hits:?}"
        );
    }

    /// TEST-2 — ALL terms must match, and terms may match DIFFERENT fields.
    #[test]
    fn all_terms_must_match_possibly_via_different_fields() {
        let cat = search_fixture();

        let hits = ranked(&cat, "create project");
        assert!(
            !hits.iter().any(|id| id == "Project.list"),
            "Project.list matches only 'project', so it must be excluded: {hits:?}"
        );
        assert!(
            !hits.iter().any(|id| id == "Assistant.create"),
            "Assistant.create matches only 'create', so it must be excluded: {hits:?}"
        );

        // 'assistants' hits only the TAG, 'create' hits only the id segment —
        // one term per field, and the op still matches.
        let hits = ranked(&cat, "assistants create");
        assert_eq!(hits, vec!["Assistant.create".to_string()], "got {hits:?}");

        // A term that matches nothing kills the whole query.
        assert!(ranked(&cat, "create zzzznotathing").is_empty());
    }

    /// TEST-3 — single-term behavior is at least as good as today, plus the
    /// empty-query passthrough.
    #[test]
    fn single_term_parity_case_insensitivity_and_empty_query() {
        let cat = search_fixture();

        for term in ["project", "create", "PROJECT", "Create", "workflow"] {
            let legacy: std::collections::BTreeSet<String> = cat
                .iter()
                .filter(|op| legacy_whole_phrase_match(op, term))
                .map(|op| op.operation_id.clone())
                .collect();
            let now: std::collections::BTreeSet<String> = ranked(&cat, term).into_iter().collect();
            assert!(
                legacy.is_subset(&now),
                "single-term '{term}' regressed: legacy matched {legacy:?}, now {now:?}"
            );
        }

        // Case-insensitive on the multi-word path too.
        assert_eq!(
            ranked(&cat, "CREATE Project").first().map(String::as_str),
            Some("Project.create")
        );

        // Blank query ⇒ no filter (every op), in the previous alphabetical order.
        let all: Vec<String> = ranked(&cat, "");
        assert_eq!(all.len(), cat.len(), "an empty query must not filter anything");
        let mut sorted = all.clone();
        sorted.sort();
        assert_eq!(all, sorted, "with no query the order must stay operation_id ASC");
        assert_eq!(ranked(&cat, "   ").len(), cat.len(), "whitespace-only is also no filter");
    }

    /// Segmentation is what makes an exact word beat a mere substring.
    #[test]
    fn id_segments_splits_on_punctuation_and_camel_case() {
        assert_eq!(id_segments("Project.create"), vec!["project", "create"]);
        assert_eq!(
            id_segments("Project.updateMcpSettings"),
            vec!["project", "update", "mcp", "settings"]
        );
        assert_eq!(id_segments("Hub.createWorkflowFromHub"), vec![
            "hub",
            "create",
            "workflow",
            "from",
            "hub"
        ]);
    }
}
