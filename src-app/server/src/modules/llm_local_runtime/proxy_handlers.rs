//! Same-port reverse proxy handlers.
//!
//! These are the entry points for `/api/local-llm/v1/{chat/completions,embeddings,models}`.
//! They mediate every chat-completion call against a local engine
//! and are the SINGLE place "local-vs-remote" concerns surface.
//! Chat code never branches on `"local"`.

use aide::transform::TransformOperation;
use axum::body::Body;
use axum::extract::Extension;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::types::Uuid;

use super::auto_start;
use super::proxy::{
    self, lookup_token, touch_last_used, InFlightGuard, InstanceFlag,
};
use crate::common::AppError;

// =====================================================================
// Error body shape (OpenAI-compat)
// =====================================================================

#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ProxyErrorBody {
    pub error: ProxyErrorInner,
}

#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ProxyErrorInner {
    /// OpenAI-style error type: "authentication_error",
    /// "invalid_request_error", "not_found_error",
    /// "engine_start_timeout", "engine_start_failed",
    /// "engine_unavailable", "engine_failed", ...
    #[serde(rename = "type")]
    pub kind: String,
    pub message: String,
    /// Optional per-error fields rendered as plain key/values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_failure_reason: Option<String>,
}

fn err_response(status: StatusCode, body: ProxyErrorBody) -> Response {
    (status, Json(body)).into_response()
}

fn err_auth() -> Response {
    err_response(
        StatusCode::UNAUTHORIZED,
        ProxyErrorBody {
            error: ProxyErrorInner {
                kind: "authentication_error".into(),
                message: "Missing or invalid Authorization bearer token".into(),
                ..default_error_inner()
            },
        },
    )
}

fn err_invalid_request(msg: impl Into<String>) -> Response {
    err_response(
        StatusCode::BAD_REQUEST,
        ProxyErrorBody {
            error: ProxyErrorInner {
                kind: "invalid_request_error".into(),
                message: msg.into(),
                ..default_error_inner()
            },
        },
    )
}

fn err_not_found(msg: impl Into<String>) -> Response {
    err_response(
        StatusCode::NOT_FOUND,
        ProxyErrorBody {
            error: ProxyErrorInner {
                kind: "not_found_error".into(),
                message: msg.into(),
                ..default_error_inner()
            },
        },
    )
}

fn err_engine_start_timeout(model: &str, elapsed_ms: u64) -> Response {
    err_response(
        StatusCode::GATEWAY_TIMEOUT,
        ProxyErrorBody {
            error: ProxyErrorInner {
                kind: "engine_start_timeout".into(),
                message: format!("Engine for model '{}' did not become healthy in time", model),
                model: Some(model.into()),
                elapsed_ms: Some(elapsed_ms),
                ..default_error_inner()
            },
        },
    )
}

fn err_engine_start_failed(reason: String) -> Response {
    err_response(
        StatusCode::BAD_GATEWAY,
        ProxyErrorBody {
            error: ProxyErrorInner {
                kind: "engine_start_failed".into(),
                message: reason,
                ..default_error_inner()
            },
        },
    )
}

fn err_engine_unavailable_draining() -> Response {
    err_response(
        StatusCode::SERVICE_UNAVAILABLE,
        ProxyErrorBody {
            error: ProxyErrorInner {
                kind: "engine_unavailable".into(),
                message: "Engine is being unloaded; retry shortly".into(),
                retry_after_ms: Some(2000),
                ..default_error_inner()
            },
        },
    )
}

fn err_engine_failed(reason: String) -> Response {
    err_response(
        StatusCode::SERVICE_UNAVAILABLE,
        ProxyErrorBody {
            error: ProxyErrorInner {
                kind: "engine_failed".into(),
                message: "Engine is in failed state; admin must clear".into(),
                last_failure_reason: Some(reason),
                ..default_error_inner()
            },
        },
    )
}

fn err_upstream(status: StatusCode, body: axum::body::Bytes) -> Response {
    // Pass through engine's error body as-is so debuggability is
    // preserved.
    Response::builder()
        .status(status)
        .body(Body::from(body))
        .unwrap()
}

fn default_error_inner() -> ProxyErrorInner {
    ProxyErrorInner {
        kind: String::new(),
        message: String::new(),
        model: None,
        elapsed_ms: None,
        retry_after_ms: None,
        last_failure_reason: None,
    }
}

// =====================================================================
// Auth helper
// =====================================================================

/// Extract `Authorization: Bearer <token>` and validate against the
/// cache. Returns the matching provider_id.
async fn auth_and_resolve_provider(headers: &HeaderMap) -> Result<Uuid, Response> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = auth.strip_prefix("Bearer ").unwrap_or("").trim();
    if token.is_empty() {
        return Err(err_auth());
    }
    lookup_token(token).await.ok_or_else(err_auth)
}

// =====================================================================
// Model resolution
// =====================================================================

/// Resolve a model NAME (the `model` field on the OpenAI body) to
/// `(model_id, file_path, status)` scoped to the given provider.
/// Returns 404 for cross-provider attempts so existence isn't leaked.
async fn resolve_model(
    pool: &PgPool,
    provider_id: Uuid,
    model_name: &str,
) -> Result<(Uuid, String), Response> {
    let row = sqlx::query!(
        "SELECT id, validation_status FROM llm_models
         WHERE provider_id = $1 AND name = $2 AND enabled = TRUE",
        provider_id,
        model_name,
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!("proxy: model lookup db error: {}", e);
        err_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ProxyErrorBody {
                error: ProxyErrorInner {
                    kind: "internal_error".into(),
                    message: "model lookup failed".into(),
                    ..default_error_inner()
                },
            },
        )
    })?;

    match row {
        Some(r) => Ok((r.id, r.validation_status.unwrap_or_default())),
        None => Err(err_not_found(format!("Unknown model: {}", model_name))),
    }
}

/// Why `resolve_engine_endpoint` could not produce a usable endpoint.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum EndpointError {
    /// No `llm_runtime_instances` row in `running` state.
    NoRunningRow,
    /// The row lookup itself failed (DB error).
    LookupFailed(String),
    /// A restart was attempted and the engine never became healthy.
    StartTimeout,
    /// A restart was attempted and failed for some other reason.
    StartFailed(String),
    /// Even after a restart there is no per-instance bearer.
    BearerMissingAfterRestart,
}

/// Resolve the live engine's base URL together with its per-instance bearer.
///
/// ## The race this closes (reproduced on a live instance, not theorised)
///
/// These two facts live in DIFFERENT places and are torn down in the OPPOSITE
/// order to the one they are read in. `LocalDeployment::stop` removes the model
/// from the process-global `INSTANCE_API_KEYS` map FIRST, then kills the
/// process, and only then does the `llm_runtime_instances` row leave
/// `status='running'`. So a naive base-url-then-bearer read has a window where
/// the row still says `running` while the token is already gone.
///
/// Measured: a model whose download had just finished, with Tier-2 validation
/// spawning the engine and then stopping it, answered a chat send with
/// `502 engine_start_failed: missing per-instance bearer token` — while
/// `POST /messages` returned 200 and the assistant message stayed empty. That is
/// the user-visible "the model is selected but sending does nothing"; it cleared
/// by itself once validation finished, which is why it looked as though
/// reloading the page fixed it.
///
/// ## Why a restart rather than reordering `stop`
///
/// Reordering `stop` to drop the bearer LAST would only MOVE the window: a
/// request would then resolve a valid token for a process that is already dying
/// and fail at the socket instead. The absence of the bearer is positive
/// evidence that the instance is GONE, so the honest response is to treat it as
/// such and bring one back — exactly what would have happened had the request
/// arrived a moment later.
///
/// Bounded to ONE restart. `ensure_running` is single-flighted and carries its
/// own timeout and flap cap, so this cannot spin.
///
/// ## Why it takes closures
///
/// The two lookups and the restart are injected so the POLICY is testable
/// without a live engine: `INSTANCE_API_KEYS` is a process-global inside the
/// SERVER process, and the integration harness spawns the server as a
/// subprocess, so no out-of-process test can put the system into
/// "row says running, bearer already dropped". The end-to-end behaviour is
/// evidenced by the live reproduction recorded in the feature's
/// `INFRA_INTEGRATION.md`; this seam is what makes the decision itself provable.
pub(crate) async fn resolve_engine_endpoint<BaseFut, StartFut>(
    model_id: Uuid,
    mut lookup_base: impl FnMut() -> BaseFut,
    mut lookup_bearer: impl FnMut() -> Option<String>,
    mut restart: impl FnMut() -> StartFut,
) -> Result<(String, String), EndpointError>
where
    BaseFut: std::future::Future<Output = Result<Option<String>, AppError>>,
    StartFut: std::future::Future<Output = Result<(), AppError>>,
{
    let mut restarted = false;
    loop {
        let base = match lookup_base().await {
            Ok(Some(u)) => u,
            Ok(None) => return Err(EndpointError::NoRunningRow),
            Err(e) => return Err(EndpointError::LookupFailed(format!("{e}"))),
        };

        match lookup_bearer() {
            Some(token) => return Ok((base, token)),
            None if !restarted => {
                restarted = true;
                tracing::info!(
                    %model_id,
                    "proxy: instance bearer missing while the instance row still read \
                     running (engine torn down mid-request); restarting once"
                );
                if let Err(e) = restart().await {
                    let msg = format!("{e}");
                    return Err(if msg.contains("did not become Healthy") {
                        EndpointError::StartTimeout
                    } else {
                        EndpointError::StartFailed(msg)
                    });
                }
            }
            None => return Err(EndpointError::BearerMissingAfterRestart),
        }
    }
}

/// Read the live engine port + base_url for a started model.
async fn get_running_instance_base_url(
    pool: &PgPool,
    model_id: Uuid,
) -> Result<Option<String>, AppError> {
    let url: Option<String> = sqlx::query_scalar!(
        "SELECT base_url FROM llm_runtime_instances
         WHERE model_id = $1 AND status = 'running'",
        model_id,
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::internal_error(format!("proxy: instance lookup: {e}")))?;
    Ok(url)
}

// =====================================================================
// Forward helper — shared by chat/completions + embeddings
// =====================================================================

async fn forward_post_with_body(
    pool: &PgPool,
    headers: &HeaderMap,
    body: axum::body::Bytes,
    suffix: &str,
) -> Response {
    // Auth.
    let provider_id = match auth_and_resolve_provider(headers).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };

    // Parse body as JSON; extract `model`.
    let parsed: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return err_invalid_request(format!("body is not valid JSON: {e}")),
    };
    let model_name = match parsed.get("model").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return err_invalid_request("body field 'model' is required"),
    };

    // Resolve model.
    let (model_id, validation_status) =
        match resolve_model(pool, provider_id, &model_name).await {
            Ok(t) => t,
            Err(resp) => return resp,
        };
    // Block the known-bad TERMINAL validation states. `error` is a general
    // failure state in the same family as `failed`/`invalid` (see migration
    // 0004's CHECK) and must be refused too. NULL/empty (legacy, never
    // validated) and the transient/ready states fall through to the
    // running-instance check below.
    if matches!(validation_status.as_str(), "failed" | "invalid" | "error") {
        return err_engine_failed(format!(
            "model {} validation_status = {}",
            model_name, validation_status
        ));
    }

    // Acquire the in-flight guard FIRST, then re-check the drain
    // flag. This closes the TOCTOU window (C2): the reaper sets
    // Draining then waits for inflight==0 before stopping. If it set
    // Draining before our guard, we observe it below and bail; if it
    // sets Draining after our guard, it sees inflight>0 and waits for
    // us. Either way the engine can't be stopped out from under an
    // in-flight request. The guard is held across auto-start too, so
    // a model mid-start is never reaped.
    let _guard = InFlightGuard::acquire(model_id).await;
    if proxy::get_instance_flag(model_id).await == InstanceFlag::Draining {
        return err_engine_unavailable_draining();
    }

    // Auto-start if not running.
    let started_at = std::time::Instant::now();
    if let Err(e) = auto_start::ensure_running(pool, model_id).await {
        let msg = format!("{}", e);
        if msg.contains("did not become Healthy") {
            return err_engine_start_timeout(
                &model_name,
                started_at.elapsed().as_millis() as u64,
            );
        }
        return err_engine_start_failed(msg);
    }

    // Resolve the live engine base_url + its per-instance bearer.
    //
    // ## The race this loop closes (reproduced, not theorised)
    //
    // These two facts live in DIFFERENT places and are torn down in the
    // OPPOSITE order to the one they are read in. `LocalDeployment::stop`
    // removes the model from the process-global `INSTANCE_API_KEYS` map FIRST,
    // then kills the process, and only then does the `llm_runtime_instances`
    // row leave `status='running'`. Reading base_url-then-bearer therefore has
    // a window in which the row still says `running` while the token is already
    // gone.
    //
    // Measured on a live instance: a model whose download had just finished,
    // with Tier-2 validation spawning the engine and then stopping it, answered
    // a chat send with `502 engine_start_failed: missing per-instance bearer
    // token` — while `POST /messages` returned 200 and the assistant message
    // stayed empty. That is the user-visible "the model is selected but sending
    // does nothing", and it cleared by itself once validation finished, which is
    // why it looked like a page reload fixed it.
    //
    // ## Why a retry rather than a reordering
    //
    // Reordering `stop` to drop the bearer LAST would just move the window: a
    // request would then resolve a valid token for a process that is already
    // dying and fail at the socket instead. The absence of the bearer is
    // positive evidence that the instance is GONE, so the honest response is to
    // treat it as such and let `ensure_running` bring one back — the same thing
    // that would have happened had the request arrived a moment later.
    //
    // Bounded to ONE re-resolve. `ensure_running` is single-flighted and carries
    // its own timeout + flap cap, so this cannot spin: either the second attempt
    // has both facts, or the engine genuinely will not start and the existing
    // start-failure paths report that.
    let (engine_base, engine_bearer) = match resolve_engine_endpoint(
        model_id,
        || get_running_instance_base_url(pool, model_id),
        || crate::modules::llm_local_runtime::deployment::local::get_instance_api_key(model_id),
        || auto_start::ensure_running(pool, model_id),
    )
    .await
    {
        Ok(pair) => pair,
        Err(EndpointError::NoRunningRow) => {
            return err_engine_start_failed(
                "engine reported started but no running instance row".into(),
            );
        }
        Err(EndpointError::LookupFailed(e)) => return err_engine_start_failed(e),
        Err(EndpointError::StartTimeout) => {
            return err_engine_start_timeout(
                &model_name,
                started_at.elapsed().as_millis() as u64,
            );
        }
        Err(EndpointError::StartFailed(e)) => return err_engine_start_failed(e),
        Err(EndpointError::BearerMissingAfterRestart) => {
            return err_engine_start_failed(
                "missing per-instance bearer token after restart".into(),
            );
        }
    };

    // Build the upstream URL: engine_base already includes scheme +
    // host + port; we append the OpenAI-compat path suffix.
    let upstream_url = format!("{}{}", engine_base.trim_end_matches('/'), suffix);

    // Forward via a shared reqwest client.
    let upstream = match shared_client()
        .post(&upstream_url)
        .bearer_auth(&engine_bearer)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return err_engine_start_failed(format!("upstream POST failed: {e}"));
        }
    };

    touch_last_used(model_id).await;
    stream_back(upstream).await
}

/// Forward a GET (no body). Used by `/v1/models`.
async fn forward_get(
    pool: &PgPool,
    headers: &HeaderMap,
    _suffix: &str,
) -> Response {
    // Auth.
    let provider_id = match auth_and_resolve_provider(headers).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    // We don't actually need to touch the engine — return the
    // provider's configured models from our own DB in OpenAI shape.
    list_provider_models(pool, provider_id).await
}

async fn list_provider_models(pool: &PgPool, provider_id: Uuid) -> Response {
    // Bound the otherwise-unbounded models list. This is an OpenAI-compatible
    // `/v1/models` proxy endpoint (consumed by OpenAI SDK clients that don't
    // send limit/offset), so the cap is applied server-side via the shared
    // DEFAULT_PAGE_SIZE rather than exposed as query params. A provider's
    // configured model count is far below this in practice.
    let rows = match sqlx::query!(
        "SELECT name, created_at FROM llm_models
         WHERE provider_id = $1 AND enabled = TRUE
         ORDER BY created_at DESC
         LIMIT $2",
        provider_id,
        crate::common::DEFAULT_PAGE_SIZE as i64,
    )
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return err_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                ProxyErrorBody {
                    error: ProxyErrorInner {
                        kind: "internal_error".into(),
                        message: format!("models query failed: {e}"),
                        ..default_error_inner()
                    },
                },
            );
        }
    };

    let data: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| {
            // created_at is time::OffsetDateTime (sqlx default here);
            // unix_timestamp() is the time-crate equivalent of chrono's
            // timestamp().
            serde_json::json!({
                "id": r.name,
                "object": "model",
                "created": r.created_at.unix_timestamp(),
                "owned_by": "local",
            })
        })
        .collect();

    Json(serde_json::json!({
        "object": "list",
        "data": data,
    }))
    .into_response()
}

/// Forward the upstream response body to the client, preserving
/// SSE streaming. The body bytes are passed through verbatim.
async fn stream_back(upstream: reqwest::Response) -> Response {
    let status = upstream.status();
    let mut headers_out = HeaderMap::new();
    for (k, v) in upstream.headers().iter() {
        if k == reqwest::header::CONTENT_LENGTH || k == reqwest::header::TRANSFER_ENCODING {
            continue;
        }
        if let Ok(hv) = HeaderValue::from_bytes(v.as_bytes()) {
            if let Ok(name) = axum::http::HeaderName::from_bytes(k.as_str().as_bytes()) {
                headers_out.insert(name, hv);
            }
        }
    }

    if !status.is_success() {
        // For non-2xx, materialize the body so we can attach our
        // structured envelope.
        let body = upstream.bytes().await.unwrap_or_default();
        return err_upstream(
            axum::http::StatusCode::from_u16(status.as_u16())
                .unwrap_or(StatusCode::BAD_GATEWAY),
            body,
        );
    }

    let stream = upstream.bytes_stream();
    let body = Body::from_stream(stream);

    let mut resp = Response::new(body);
    *resp.status_mut() = axum::http::StatusCode::from_u16(status.as_u16())
        .unwrap_or(StatusCode::OK);
    *resp.headers_mut() = headers_out;
    resp
}

// =====================================================================
// Shared reqwest client (keep-alive pool)
// =====================================================================

static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn shared_client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_max_idle_per_host(8)
            // No request timeout — the engine may stream a multi-minute
            // completion. We must NOT call `.timeout(Duration::ZERO)`:
            // reqwest treats a zero duration as a 0ms deadline (every
            // request fails instantly), not "unlimited". Omitting the
            // call entirely is reqwest's "no timeout" default. SSE
            // clients (the chat module's outbound `Provider::new` wrap)
            // handle their own cancellation.
            .no_proxy()
            .build()
            .expect("shared reqwest client init")
    })
}

// =====================================================================
// Handlers
// =====================================================================

pub async fn proxy_chat_completions(
    Extension(pool): Extension<sqlx::PgPool>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    forward_post_with_body(&pool, &headers, body, "/v1/chat/completions").await
}

pub fn proxy_chat_completions_docs(op: TransformOperation) -> TransformOperation {
    op.id("LocalLlmProxy.chatCompletions")
        .tag("Local LLM Proxy")
        .summary("OpenAI-compatible /v1/chat/completions proxy.")
        .description(concat!(
            "Auth via Authorization: Bearer <PROXY_TOKEN> (the api_key ",
            "of a local llm_provider). Model name from the body's `model` ",
            "field. Auto-starts the engine if needed."
        ))
}

pub async fn proxy_embeddings(
    Extension(pool): Extension<sqlx::PgPool>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    forward_post_with_body(&pool, &headers, body, "/v1/embeddings").await
}

pub fn proxy_embeddings_docs(op: TransformOperation) -> TransformOperation {
    op.id("LocalLlmProxy.embeddings")
        .tag("Local LLM Proxy")
        .summary("OpenAI-compatible /v1/embeddings proxy.")
}

/// Reranker proxy — forwards to the local llama.cpp `--reranking` server's
/// `/v1/rerank`. Same forward path + bearer rewrite + auto-start as embeddings.
pub async fn proxy_rerank(
    Extension(pool): Extension<sqlx::PgPool>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    forward_post_with_body(&pool, &headers, body, "/v1/rerank").await
}

pub fn proxy_rerank_docs(op: TransformOperation) -> TransformOperation {
    op.id("LocalLlmProxy.rerank")
        .tag("Local LLM Proxy")
        .summary("OpenAI-compatible /v1/rerank proxy (cross-encoder reranker).")
}

pub async fn proxy_models(
    Extension(pool): Extension<sqlx::PgPool>,
    headers: HeaderMap,
) -> Response {
    forward_get(&pool, &headers, "/v1/models").await
}

pub fn proxy_models_docs(op: TransformOperation) -> TransformOperation {
    op.id("LocalLlmProxy.listModels")
        .tag("Local LLM Proxy")
        .summary("OpenAI-compatible /v1/models — list models in this provider.")
}

// =====================================================================
// TEST-17 [acceptance] [invariant: INV-5]
// =====================================================================

#[cfg(test)]
mod endpoint_resolve_tests {
    use super::*;
    use std::cell::Cell;

    /// The exact state the live reproduction produced: the
    /// `llm_runtime_instances` row still reads `running` while
    /// `LocalDeployment::stop` has already removed the model from
    /// `INSTANCE_API_KEYS`.
    ///
    /// Pre-fix this returned `502 engine_start_failed: "missing per-instance
    /// bearer token"` and the user's message silently produced nothing. The
    /// promise INV-5 makes is that a send after a completed download WORKS, so
    /// the resolve must recover rather than fail.
    ///
    /// The state is SET here, not raced for — which is the whole point. A spec
    /// that had to land a send inside the real validation window would be green
    /// on one machine and red in CI, and would only ever sample one instant of
    /// that window instead of proving the property.
    #[tokio::test]
    async fn bearer_missing_while_row_says_running_restarts_instead_of_failing() {
        let restarts = Cell::new(0);
        // The bearer is absent on the first read and present after the restart —
        // exactly what `ensure_running` re-establishes.
        let bearer_reads = Cell::new(0);

        let got = resolve_engine_endpoint(
            Uuid::nil(),
            || async { Ok(Some("http://127.0.0.1:9999".to_string())) },
            || {
                let n = bearer_reads.get();
                bearer_reads.set(n + 1);
                if n == 0 { None } else { Some("tok-after-restart".to_string()) }
            },
            || {
                restarts.set(restarts.get() + 1);
                async { Ok(()) }
            },
        )
        .await;

        assert_eq!(
            got,
            Ok(("http://127.0.0.1:9999".to_string(), "tok-after-restart".to_string())),
            "a torn-down instance must be re-established, not reported as a failure"
        );
        assert_eq!(restarts.get(), 1, "exactly one restart");
        assert_eq!(bearer_reads.get(), 2, "the bearer is re-read after the restart");
    }

    /// The happy path must not pay for the fix: when both facts are present the
    /// resolve does NOT restart anything. Without this, "always restart once"
    /// would satisfy the test above while spawning an engine on every request.
    #[tokio::test]
    async fn a_healthy_instance_is_used_directly_with_no_restart() {
        let restarts = Cell::new(0);

        let got = resolve_engine_endpoint(
            Uuid::nil(),
            || async { Ok(Some("http://127.0.0.1:8080".to_string())) },
            || Some("tok".to_string()),
            || {
                restarts.set(restarts.get() + 1);
                async { Ok(()) }
            },
        )
        .await;

        assert_eq!(got, Ok(("http://127.0.0.1:8080".to_string(), "tok".to_string())));
        assert_eq!(restarts.get(), 0, "a healthy instance must not be restarted");
    }

    /// The retry is BOUNDED. If the bearer is still missing after a restart the
    /// resolve gives up rather than looping — `ensure_running` has its own
    /// single-flight, timeout and flap cap, and spinning here would defeat them.
    #[tokio::test]
    async fn a_bearer_still_missing_after_restart_gives_up_once() {
        let restarts = Cell::new(0);

        let got = resolve_engine_endpoint(
            Uuid::nil(),
            || async { Ok(Some("http://127.0.0.1:8080".to_string())) },
            || None,
            || {
                restarts.set(restarts.get() + 1);
                async { Ok(()) }
            },
        )
        .await;

        assert_eq!(got, Err(EndpointError::BearerMissingAfterRestart));
        assert_eq!(restarts.get(), 1, "bounded to a single restart — no spin");
    }

    /// A genuinely absent instance row is still an honest failure: the fix must
    /// not turn "there is no engine" into a restart loop.
    #[tokio::test]
    async fn no_running_row_is_reported_not_restarted() {
        let restarts = Cell::new(0);

        let got = resolve_engine_endpoint(
            Uuid::nil(),
            || async { Ok(None) },
            || None,
            || {
                restarts.set(restarts.get() + 1);
                async { Ok(()) }
            },
        )
        .await;

        assert_eq!(got, Err(EndpointError::NoRunningRow));
        assert_eq!(restarts.get(), 0);
    }

    /// A restart that times out keeps its own error identity, so the caller can
    /// still answer 504 rather than collapsing every failure into 502.
    #[tokio::test]
    async fn a_restart_timeout_is_distinguished_from_a_start_failure() {
        let timed_out = resolve_engine_endpoint(
            Uuid::nil(),
            || async { Ok(Some("http://127.0.0.1:8080".to_string())) },
            || None,
            || async { Err(AppError::internal_error("engine did not become Healthy in 90s")) },
        )
        .await;
        assert_eq!(timed_out, Err(EndpointError::StartTimeout));

        let failed = resolve_engine_endpoint(
            Uuid::nil(),
            || async { Ok(Some("http://127.0.0.1:8080".to_string())) },
            || None,
            || async { Err(AppError::internal_error("binary not found")) },
        )
        .await;
        assert!(
            matches!(failed, Err(EndpointError::StartFailed(ref m)) if m.contains("binary not found")),
            "a non-timeout start failure keeps its message: {failed:?}"
        );
    }
}
