//! Client-safe mapping for MCP **upstream / transport** failures.
//!
//! An MCP server is a dependency this process talks to over HTTP (streamable
//! HTTP transport) or over a spawned subprocess's stdio. When that dependency
//! is down, slow, or broken, the failure is NOT an internal fault of this API —
//! collapsing it to `500 SYSTEM_INTERNAL_ERROR` (what every call site used to
//! do via `AppError::internal_error`) tells the client nothing and is simply
//! wrong: a caller cannot distinguish "the thing I depend on is down" from
//! "this API is broken".
//!
//! Worse, the old call sites interpolated the raw failure text into the
//! response body — upstream response bodies and, for stdio servers, the
//! subprocess's captured **stderr** (Python tracebacks, host filesystem paths,
//! environment details, and potentially secrets for a server configured with
//! credentials). That is a straight information leak to any caller that can
//! reach `GET /api/mcp/servers/{id}/tools`.
//!
//! This module is the single place both concerns are handled:
//!
//! * [`classify_upstream_status`] / [`classify_transport_error`] turn a raw
//!   failure into an [`UpstreamFailure`] class (pure, unit-tested).
//! * [`upstream_error`] turns that class into an `AppError` that carries an
//!   appropriate status (502 / 503 / 504) plus a **stable, developer-authored
//!   message** — never interpolated upstream text. The real diagnostic detail
//!   is written to the log at `error` level with a `trace_id`, and the same
//!   `trace_id` is returned in `details` so an operator can grep for it.
//!
//! This mirrors the redaction contract already established by
//! `AppError::database_error` / `AppError::internal_with_id` in `ziee-core`
//! (log the cause, return a correlation id), and follows CODING_GUIDELINES §3
//! (never leak internals) and §6 (preserve error context — in the log — without
//! collapsing every failure onto one status).
//!
//! Genuine internal faults keep using `AppError::internal_error` and keep
//! returning 500: this module is only for failures whose cause is the MCP
//! server on the other side of the transport.

use axum::http::StatusCode;
use uuid::Uuid;

use crate::common::AppError;

// =====================================================
// Stable machine-readable error codes
// =====================================================

pub const CODE_UPSTREAM_UNREACHABLE: &str = "MCP_UPSTREAM_UNREACHABLE";
pub const CODE_UPSTREAM_TIMEOUT: &str = "MCP_UPSTREAM_TIMEOUT";
pub const CODE_UPSTREAM_UNAVAILABLE: &str = "MCP_UPSTREAM_UNAVAILABLE";
pub const CODE_UPSTREAM_UNAUTHORIZED: &str = "MCP_UPSTREAM_UNAUTHORIZED";
/// Upstream answered `404`. Kept as its own code because the streamable-HTTP
/// transport MUST treat a 404 as "session expired, re-initialize and retry"
/// (MCP spec § Transports) — `request()` branches on this code. It used to
/// branch on `err.to_string().contains("HTTP 404")`, which silently coupled
/// spec-required retry behaviour to the human-readable message text.
pub const CODE_UPSTREAM_NOT_FOUND: &str = "MCP_UPSTREAM_NOT_FOUND";
pub const CODE_UPSTREAM_PROTOCOL_ERROR: &str = "MCP_UPSTREAM_PROTOCOL_ERROR";

// =====================================================
// Failure classification
// =====================================================

/// How an interaction with an MCP server failed. Deliberately coarse: each
/// variant maps to exactly one HTTP status + one stable client-facing message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpstreamFailure {
    /// The transport could not be established at all — subprocess failed to
    /// spawn or died during the handshake, TCP connect refused, DNS failure.
    Unreachable,
    /// The server accepted the connection but did not answer in time.
    Timeout,
    /// The server explicitly reported it is not able to serve right now
    /// (HTTP 429 / 502 / 503) — e.g. a built-in server whose subsystem has
    /// not finished initializing.
    Unavailable,
    /// The server rejected our credentials (HTTP 401 / 403).
    Unauthorized,
    /// The server answered `404`. On the streamable-HTTP transport this means
    /// the session id is stale and must be re-initialized.
    NotFound,
    /// The server answered, but not usably: any other non-2xx status, or a
    /// body we could not read / parse as JSON-RPC.
    Protocol,
}

impl UpstreamFailure {
    /// The HTTP status this API answers with. Never 500 — every variant here
    /// is a *dependency* failure, and the gateway-class statuses are what let
    /// a caller tell that apart from a bug in this API.
    pub fn status(self) -> StatusCode {
        match self {
            UpstreamFailure::Timeout => StatusCode::GATEWAY_TIMEOUT,
            UpstreamFailure::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            UpstreamFailure::Unreachable
            | UpstreamFailure::Unauthorized
            | UpstreamFailure::NotFound
            | UpstreamFailure::Protocol => StatusCode::BAD_GATEWAY,
        }
    }

    /// The stable machine-readable code clients/tests should branch on.
    pub fn code(self) -> &'static str {
        match self {
            UpstreamFailure::Unreachable => CODE_UPSTREAM_UNREACHABLE,
            UpstreamFailure::Timeout => CODE_UPSTREAM_TIMEOUT,
            UpstreamFailure::Unavailable => CODE_UPSTREAM_UNAVAILABLE,
            UpstreamFailure::Unauthorized => CODE_UPSTREAM_UNAUTHORIZED,
            UpstreamFailure::NotFound => CODE_UPSTREAM_NOT_FOUND,
            UpstreamFailure::Protocol => CODE_UPSTREAM_PROTOCOL_ERROR,
        }
    }

    /// The client-facing sentence. **Static template + the server's own
    /// display name only.** The name is already known to any caller that can
    /// reach these endpoints (it comes from the server list they just read),
    /// so it leaks nothing; everything else about the failure stays in the log.
    pub fn message(self, server_name: &str) -> String {
        match self {
            UpstreamFailure::Unreachable => format!(
                "Could not connect to MCP server '{server_name}'. \
                 The server failed to start or is not reachable; \
                 check the server logs for details."
            ),
            UpstreamFailure::Timeout => {
                format!("MCP server '{server_name}' did not respond in time.")
            }
            UpstreamFailure::Unavailable => format!(
                "MCP server '{server_name}' is currently unavailable. \
                 It may still be starting up or is temporarily unable to serve requests."
            ),
            UpstreamFailure::Unauthorized => {
                format!("MCP server '{server_name}' rejected the request's credentials.")
            }
            UpstreamFailure::NotFound => format!(
                "MCP server '{server_name}' reported the session or endpoint no longer exists."
            ),
            UpstreamFailure::Protocol => {
                format!("MCP server '{server_name}' returned an invalid or unsuccessful response.")
            }
        }
    }
}

/// Classify an upstream **HTTP status** returned by a streamable-HTTP MCP
/// server. `2xx` never reaches here (callers only classify non-success), but
/// it is mapped to `Protocol` defensively rather than panicking.
pub fn classify_upstream_status(status: u16) -> UpstreamFailure {
    match status {
        401 | 403 => UpstreamFailure::Unauthorized,
        404 => UpstreamFailure::NotFound,
        408 | 504 => UpstreamFailure::Timeout,
        429 | 502 | 503 => UpstreamFailure::Unavailable,
        _ => UpstreamFailure::Protocol,
    }
}

/// Classify a `reqwest` transport-level failure (no HTTP status exists —
/// the request never completed).
pub fn classify_transport_error(err: &reqwest::Error) -> UpstreamFailure {
    if err.is_timeout() {
        UpstreamFailure::Timeout
    } else if err.is_connect() || err.is_redirect() || err.is_request() {
        UpstreamFailure::Unreachable
    } else {
        // Body/decode errors: the connection worked, the payload didn't.
        UpstreamFailure::Protocol
    }
}

// =====================================================
// AppError construction (log the cause, return a trace id)
// =====================================================

/// Build the client-safe `AppError` for an upstream failure.
///
/// `detail` is the FULL diagnostic — upstream response body, `reqwest` error
/// chain, captured subprocess stderr. It is logged, never returned. Callers
/// must pass everything they know; there is no reason to pre-truncate or
/// pre-sanitize for the wire, because none of it goes to the wire.
pub fn upstream_error(
    server_name: &str,
    failure: UpstreamFailure,
    detail: impl std::fmt::Display,
) -> AppError {
    let trace_id = Uuid::new_v4();
    tracing::error!(
        %trace_id,
        server_name = %server_name,
        failure = ?failure,
        error_code = %failure.code(),
        detail = %detail,
        "MCP upstream failure",
    );
    AppError::new(
        failure.status(),
        failure.code(),
        failure.message(server_name),
    )
    .with_details(serde_json::json!({
        "trace_id": trace_id.to_string(),
        "mcp_server": server_name,
    }))
}

/// Convenience wrapper for the "upstream answered with a non-2xx status" case:
/// classifies the status and records it (as a bare number — no body) in the
/// log detail. The response body carries only the class, never the status or
/// the upstream payload.
pub fn upstream_http_error(server_name: &str, status: u16, body: &str) -> AppError {
    upstream_error(
        server_name,
        classify_upstream_status(status),
        format!("upstream HTTP {status}; body: {body}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- status classification ----------

    #[test]
    fn upstream_503_is_service_unavailable_not_500() {
        let f = classify_upstream_status(503);
        assert_eq!(f, UpstreamFailure::Unavailable);
        assert_eq!(f.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_ne!(f.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn upstream_502_and_429_are_unavailable() {
        assert_eq!(classify_upstream_status(502), UpstreamFailure::Unavailable);
        assert_eq!(classify_upstream_status(429), UpstreamFailure::Unavailable);
    }

    #[test]
    fn upstream_timeouts_map_to_gateway_timeout() {
        for s in [408u16, 504] {
            let f = classify_upstream_status(s);
            assert_eq!(f, UpstreamFailure::Timeout, "status {s}");
            assert_eq!(f.status(), StatusCode::GATEWAY_TIMEOUT, "status {s}");
        }
    }

    #[test]
    fn upstream_auth_failures_are_distinguishable() {
        for s in [401u16, 403] {
            assert_eq!(classify_upstream_status(s), UpstreamFailure::Unauthorized);
        }
        assert_eq!(
            UpstreamFailure::Unauthorized.status(),
            StatusCode::BAD_GATEWAY
        );
    }

    #[test]
    fn upstream_404_keeps_its_own_code_for_the_session_retry() {
        let f = classify_upstream_status(404);
        assert_eq!(f, UpstreamFailure::NotFound);
        assert_eq!(f.code(), CODE_UPSTREAM_NOT_FOUND);
    }

    #[test]
    fn other_upstream_statuses_are_protocol_errors_at_502() {
        for s in [400u16, 418, 500, 505] {
            let f = classify_upstream_status(s);
            assert_eq!(f, UpstreamFailure::Protocol, "status {s}");
            assert_eq!(f.status(), StatusCode::BAD_GATEWAY, "status {s}");
        }
    }

    #[test]
    fn no_upstream_failure_class_maps_to_500() {
        for f in [
            UpstreamFailure::Unreachable,
            UpstreamFailure::Timeout,
            UpstreamFailure::Unavailable,
            UpstreamFailure::Unauthorized,
            UpstreamFailure::NotFound,
            UpstreamFailure::Protocol,
        ] {
            assert_ne!(
                f.status(),
                StatusCode::INTERNAL_SERVER_ERROR,
                "{f:?} must not be reported as an internal server error"
            );
            assert!(
                f.status().is_server_error(),
                "{f:?} should still be a 5xx (a dependency really did fail)"
            );
        }
    }

    // ---------- redaction ----------

    /// The regression this module exists for: a stdio server whose subprocess
    /// dies printing a Python traceback must not put that traceback (or the
    /// host paths / env values inside it) into the HTTP response body.
    #[test]
    fn upstream_error_does_not_leak_detail_into_the_response_body() {
        let stderr = "Traceback (most recent call last):\n  \
             File \"/home/operator/.cache/uv/archive-v0/AbCdEf/bin/mcp-server-fetch\", line 6\n\
             ImportError: cannot import name 'McpError'\n\
             OPENAI_API_KEY=sk-super-secret-value";
        let err = upstream_error("fetch", UpstreamFailure::Unreachable, stderr);
        let body = serde_json::to_string(&err).expect("serialize AppError");

        assert!(!body.contains("Traceback"), "leaked traceback: {body}");
        assert!(!body.contains("/home/operator"), "leaked host path: {body}");
        assert!(!body.contains("ImportError"), "leaked stderr: {body}");
        assert!(
            !body.contains("sk-super-secret-value"),
            "leaked a secret from subprocess stderr: {body}"
        );
        // …but the operator can still correlate.
        assert!(body.contains("trace_id"), "missing trace_id: {body}");
    }

    #[test]
    fn upstream_http_error_does_not_leak_the_upstream_body() {
        let err = upstream_http_error(
            "code_sandbox",
            503,
            r#"{"error":{"message":"code_sandbox not initialized (enabled = false)"}}"#,
        );
        let body = serde_json::to_string(&err).expect("serialize AppError");
        assert!(
            !body.contains("code_sandbox not initialized"),
            "leaked upstream body: {body}"
        );
        assert_eq!(err.status_code(), 503, "upstream 503 must surface as 503");
        assert_eq!(err.error_code(), CODE_UPSTREAM_UNAVAILABLE);
    }

    #[test]
    fn message_is_stable_and_mentions_only_the_server_name() {
        let a = UpstreamFailure::Unreachable.message("fetch");
        let b = UpstreamFailure::Unreachable.message("fetch");
        assert_eq!(a, b, "message must be deterministic");
        assert!(a.contains("fetch"));
    }
}
