//! R4 — `POST /api/auth/link-account` raced on
//! `user_auth_links_provider_id_external_id_key` and escaped as
//! `500 SYSTEM_DATABASE_ERROR`.
//!
//! Two defects stacked, both fixed here:
//!
//! 1. `AuthRepository::link_verified_external_identity` INSERTed into
//!    `user_auth_links` with a bare `.map_err(AppError::database_error)`, so a
//!    duplicate `(provider_id, external_id)` surfaced as a generic 500.
//! 2. The handler wrapped the call in a hardcoded
//!    `.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))`. `ApiResult` is
//!    `Result<(StatusCode, T), (StatusCode, AppError)>` and axum lets the
//!    TUPLE's status win over the body's, so fixing only the repository would
//!    have shipped the typed 409 body under a 500 status — the exact trap the
//!    admin auth-provider handlers set in the preceding sweep.
//!
//! WHAT MAKES IT REACHABLE. `link_account` PEEKS the pending-link token
//! (`peek_pending_link`) rather than consuming it, so a wrong password does
//! not burn the whole OAuth dance, and only deletes the token AFTER the link
//! write succeeds. That leaves a window in which N concurrent confirmations of
//! the SAME token all pass the peek, all pass the password check, and all
//! reach the INSERT. Exactly one wins; every other one used to 500.
//!
//! Note the brief's framing ("two concurrent pending link tokens from a real
//! OAuth double-flow") understates it: because the peek does not consume,
//! ONE token driven concurrently is sufficient, which is what this test does.
//!
//! LAYER: HTTP, end to end. A real OAuth dance against the navikt mock creates
//! the pending link; the race is N concurrent `POST /api/auth/link-account`
//! with that token, released together by a barrier.
//!
//! POST-FIX CONTRACT. The INSERT became
//! `ON CONFLICT (provider_id, external_id) DO UPDATE … WHERE
//! user_auth_links.user_id = EXCLUDED.user_id`, so a re-confirmation of the
//! SAME identity for the SAME user is idempotent (200) and only a genuine
//! cross-user re-point is a 409. A racer that arrives after the winner has
//! already deleted the pending token still legitimately gets 401
//! INVALID_LINK_TOKEN — that is the token's single-use contract, not this
//! defect. What must NEVER happen is a 5xx, or more than one link row.

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::sync::Barrier;
use ziee::hash_password;

use super::oauth_test::{drive_oauth_flow, seed_oidc_provider};
use crate::common::TestServer;
use crate::common::oauth_mock::OAuthMockServer;

/// Concurrent confirmations of one token. Capped by the handler's per-token
/// brute-force ceiling (`LINK_TOKEN_MAX_ATTEMPTS = 5`): a 6th attempt would be
/// a legitimate 429, which would muddy the signal.
const RACERS: usize = 5;
/// Independent rounds, each with its own user + external identity + token.
/// One round is usually enough (every loser of the INSERT is a violation), but
/// the racers must all clear the peek before the winner deletes the token, so
/// repeating removes the scheduling luck.
const ROUNDS: usize = 3;

const PASSWORD: &str = "correct-horse-battery-staple";

#[tokio::test]
async fn concurrent_link_account_confirmations_never_500() {
    let test_server = TestServer::start().await;
    let oauth_server = OAuthMockServer::start()
        .await
        .expect("Failed to start OAuth mock server");
    let pool = sqlx::PgPool::connect(&test_server.database_url)
        .await
        .expect("Failed to connect to test database");
    let provider_id = seed_oidc_provider(&pool, "test-oauth", &oauth_server, json!({})).await;

    let mut all_outcomes: Vec<(usize, u16, Value)> = Vec::new();

    for round in 0..ROUNDS {
        // A fresh local account whose email the social login will collide with
        // — the First-Broker-Login precondition. Must carry a password_hash:
        // FBL confirmation is proof-of-ownership by password.
        let user_id = uuid::Uuid::new_v4();
        let username = format!("racer{round}");
        let email = format!("{username}@example.com");
        let external_id = format!("social-sub-{username}");
        let pw_hash = hash_password(PASSWORD).unwrap();
        sqlx::query!(
            r#"INSERT INTO users (id, username, email, password_hash, is_active, is_admin, created_at, updated_at)
               VALUES ($1, $2, $3, $4, true, false, NOW(), NOW())"#,
            user_id,
            username,
            email,
            pw_hash,
        )
        .execute(&pool)
        .await
        .expect("seed local user");

        // Drive the real OAuth dance → 307 to /auth/link-account?link_token=…
        let (_, location) = drive_oauth_flow(
            &test_server,
            "test-oauth",
            &external_id,
            json!({
                "email": email,
                "email_verified": true,
                "preferred_username": format!("{username}-social"),
                "name": "Racer"
            }),
            None,
        )
        .await;
        let loc = location.expect("FBL must redirect with a link_token");
        let link_token = loc
            .split_once("link_token=")
            .map(|(_, t)| t.split('&').next().unwrap_or(t).to_string())
            .expect("link_token in the redirect URL");

        // THE RACE: N confirmations of the SAME token, released together.
        let barrier = Arc::new(Barrier::new(RACERS));
        let endpoint = format!("{}/api/auth/link-account", test_server.base_url);
        let mut tasks = Vec::with_capacity(RACERS);
        for _ in 0..RACERS {
            let barrier = Arc::clone(&barrier);
            let endpoint = endpoint.clone();
            let link_token = link_token.clone();
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                let res = reqwest::Client::new()
                    .post(&endpoint)
                    .json(&json!({ "link_token": link_token, "password": PASSWORD }))
                    .send()
                    .await
                    .expect("link-account request failed");
                let status = res.status().as_u16();
                let body: Value = res.json().await.unwrap_or(Value::Null);
                (status, body)
            }));
        }

        let mut round_outcomes = Vec::with_capacity(RACERS);
        for t in tasks {
            round_outcomes.push(t.await.expect("link-account task panicked"));
        }

        // No racer may 5xx. Pre-fix this is where the run dies: every loser of
        // the INSERT carried 500 SYSTEM_DATABASE_ERROR.
        let server_errors: Vec<&(u16, Value)> =
            round_outcomes.iter().filter(|(s, _)| *s >= 500).collect();
        assert!(
            server_errors.is_empty(),
            "round {round}: a concurrent link confirmation must never 5xx; got \
             {server_errors:?} (all outcomes: {round_outcomes:?}). A 500 \
             SYSTEM_DATABASE_ERROR here is the raw \
             user_auth_links_provider_id_external_id_key violation escaping."
        );
        assert!(
            round_outcomes.iter().any(|(s, _)| *s == 200),
            "round {round}: at least one confirmation must succeed: {round_outcomes:?}"
        );
        // Anything that did not succeed may only be the token's single-use
        // contract (401), never a conflict against this user's own identity.
        for (status, body) in &round_outcomes {
            assert!(
                *status == 200 || *status == 401,
                "round {round}: unexpected status {status} ({body}) — the only \
                 legitimate non-200 is 401 INVALID_LINK_TOKEN once the winner \
                 consumed the token"
            );
        }

        // END STATE: exactly one link row for this identity, bound to this user.
        let links: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!" FROM user_auth_links
               WHERE provider_id = $1 AND external_id = $2"#,
            provider_id,
            external_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            links, 1,
            "round {round}: the race must leave exactly one user_auth_links row"
        );
        let owner: uuid::Uuid = sqlx::query_scalar!(
            r#"SELECT user_id FROM user_auth_links
               WHERE provider_id = $1 AND external_id = $2"#,
            provider_id,
            external_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            owner, user_id,
            "round {round}: link bound to the right user"
        );

        // The winner consumes the pending token.
        let pending: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!" FROM pending_account_links
               WHERE target_user_id = $1"#,
            user_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            pending, 0,
            "round {round}: pending token consumed on success"
        );

        all_outcomes.extend(round_outcomes.into_iter().map(|(s, b)| (round, s, b)));
    }

    let ok = all_outcomes.iter().filter(|(_, s, _)| *s == 200).count();
    assert!(
        ok >= ROUNDS,
        "at least one success per round expected; got {ok} across {} outcomes",
        all_outcomes.len()
    );
}

/// The other side of the same INSERT: an external identity that is ALREADY
/// bound to a DIFFERENT user must be refused with a typed 409, not a 500 —
/// and not silently re-pointed at the second account.
///
/// This is the case the `ON CONFLICT … DO UPDATE … WHERE
/// user_auth_links.user_id = EXCLUDED.user_id` conflict-action WHERE exists
/// for, and it is also the assertion that proves the handler's hardcoded 500
/// is gone: a repository-only fix would answer `409` in the body under a `500`
/// status, so this test asserts the STATUS as well as the code.
#[tokio::test]
async fn linking_an_identity_owned_by_another_user_is_409_not_500() {
    let test_server = TestServer::start().await;
    let oauth_server = OAuthMockServer::start()
        .await
        .expect("Failed to start OAuth mock server");
    let pool = sqlx::PgPool::connect(&test_server.database_url)
        .await
        .expect("Failed to connect to test database");
    let provider_id = seed_oidc_provider(&pool, "test-oauth", &oauth_server, json!({})).await;

    // The FBL target: a local account whose email the social identity matches.
    let victim_id = uuid::Uuid::new_v4();
    let pw_hash = hash_password(PASSWORD).unwrap();
    sqlx::query!(
        r#"INSERT INTO users (id, username, email, password_hash, is_active, is_admin, created_at, updated_at)
           VALUES ($1, 'takenlink', 'takenlink@example.com', $2, true, false, NOW(), NOW())"#,
        victim_id,
        pw_hash,
    )
    .execute(&pool)
    .await
    .expect("seed FBL target user");

    // A DIFFERENT user already owns the external identity we are about to
    // confirm — e.g. it was linked before the target account was created.
    let squatter_id = uuid::Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO users (id, username, email, password_hash, is_active, is_admin, created_at, updated_at)
           VALUES ($1, 'squatter', 'squatter@example.com', NULL, true, false, NOW(), NOW())"#,
        squatter_id,
    )
    .execute(&pool)
    .await
    .expect("seed squatter user");

    let external_id = "social-sub-takenlink";
    let (_, location) = drive_oauth_flow(
        &test_server,
        "test-oauth",
        external_id,
        json!({
            "email": "takenlink@example.com",
            "email_verified": true,
            "preferred_username": "takenlink-social",
            "name": "Taken Link"
        }),
        None,
    )
    .await;
    let loc = location.expect("FBL must redirect with a link_token");
    let link_token = loc
        .split_once("link_token=")
        .map(|(_, t)| t.split('&').next().unwrap_or(t).to_string())
        .expect("link_token in the redirect URL");

    // Bind the identity to the squatter AFTER the pending token was minted —
    // the same end state a concurrent flow would produce, made deterministic.
    sqlx::query!(
        r#"INSERT INTO user_auth_links (user_id, provider_id, external_id, created_at, last_login_at)
           VALUES ($1, $2, $3, NOW(), NOW())"#,
        squatter_id,
        provider_id,
        external_id,
    )
    .execute(&pool)
    .await
    .expect("pre-bind identity to the squatter");

    let res = reqwest::Client::new()
        .post(format!("{}/api/auth/link-account", test_server.base_url))
        .json(&json!({ "link_token": link_token, "password": PASSWORD }))
        .send()
        .await
        .expect("link-account request failed");
    let status = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    assert_eq!(
        status, 409,
        "an already-claimed external identity must be a 409, not a 500 \
         (and the STATUS must match the body — a hardcoded \
         INTERNAL_SERVER_ERROR tuple in the handler would win over it): {body}"
    );
    assert_eq!(
        body.get("error_code").and_then(Value::as_str),
        Some("RESOURCE_CONFLICT"),
        "409 carries the sweep's RESOURCE_CONFLICT code: {body}"
    );

    // The squatter's row must be untouched — never re-pointed at the target.
    let owner: uuid::Uuid = sqlx::query_scalar!(
        r#"SELECT user_id FROM user_auth_links
           WHERE provider_id = $1 AND external_id = $2"#,
        provider_id,
        external_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        owner, squatter_id,
        "the refused link must not re-point the identity at the FBL target"
    );
    let rows: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM user_auth_links
           WHERE provider_id = $1 AND external_id = $2"#,
        provider_id,
        external_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 1, "still exactly one link row");
}
