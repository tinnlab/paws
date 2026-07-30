//! R3 — `voice_runtime_versions_one_default` clear-then-set ran on a bare
//! pool, so two concurrent promotions could collide.
//!
//! ```text
//! CREATE UNIQUE INDEX voice_runtime_versions_one_default
//!   ON voice_runtime_versions (is_system_default) WHERE is_system_default = true;
//! ```
//!
//! `binary_manager::set_system_default` used to run
//!
//! ```text
//! get_by_id(id)?                 // 404 pre-check
//! clear_system_default(pool)     // UPDATE ... SET false WHERE true   (autocommit)
//! set_system_default(pool, id)   // UPDATE ... SET true  WHERE id = $1 (autocommit)
//! ```
//!
//! Two concurrent calls interleaving as `clear(A) · clear(B) · set(A) · set(B)`
//! make the last statement trip 23505 → `AppError::database_error` →
//! `500 SYSTEM_DATABASE_ERROR`, and the caller is told nothing about which
//! version actually ended up default.
//!
//! THE FIX IS A TRANSACTION, NOT AN ERROR MAP — but a plain transaction is not
//! enough on its own, and this test is why that distinction matters. Under
//! READ COMMITTED the second transaction's `clear` runs against a snapshot
//! taken before the first committed, so it never sees (and never clears) the
//! row the winner just set; its `set` then collides exactly as before. The
//! promotion therefore has to be SERIALIZED, not merely atomic:
//! `repository::promote_to_system_default` takes a transaction-scoped advisory
//! lock, then clears + sets inside one transaction.
//!
//! LAYER: HTTP. Drives the real `POST /api/voice/versions/{id}/set-default`
//! endpoint from N tasks released together by a barrier.

use std::sync::Arc;

use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tokio::sync::Barrier;
use uuid::Uuid;

use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

/// Concurrent promotions per round.
const RACERS: usize = 6;
/// Rounds, each with a fresh set of versions. The collision needs the two
/// `clear`s to land before the two `set`s, which is likely but not certain in
/// a single round — repeating makes a pre-fix pass vanishingly unlikely while
/// keeping the test fast.
const ROUNDS: usize = 5;

/// N concurrent "make THIS version the system default" calls must all succeed
/// and leave EXACTLY ONE default — never a 500, never two defaults, never zero.
#[tokio::test]
async fn concurrent_set_default_leaves_exactly_one_default() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "voice_default_race", &["*"]).await;

    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&server.database_url)
        .await
        .expect("connect test db");

    let mut all_outcomes: Vec<(usize, u16, Value)> = Vec::new();

    for round in 0..ROUNDS {
        // A fresh, mutually-exclusive set of versions per round. None starts as
        // the default, so the winner of the race is whoever the DB serializes
        // last — the invariant under test is the COUNT, not the identity.
        let mut ids = Vec::with_capacity(RACERS);
        for i in 0..RACERS {
            ids.push(
                super::insert_version_row(
                    &server,
                    &format!("r{round}-v{i}-{}", &Uuid::new_v4().to_string()[..8]),
                    "cpu",
                    "/nonexistent/whisper-server",
                    false,
                )
                .await,
            );
        }

        let barrier = Arc::new(Barrier::new(RACERS));
        let mut tasks = Vec::with_capacity(RACERS);
        for id in &ids {
            let barrier = Arc::clone(&barrier);
            let url = server.api_url(&format!("/voice/versions/{id}/set-default"));
            let token = admin.token.clone();
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                let res = reqwest::Client::new()
                    .post(url)
                    .header("Authorization", format!("Bearer {token}"))
                    .send()
                    .await
                    .expect("set-default request failed");
                let status = res.status().as_u16();
                let body: Value = res.json().await.unwrap_or(Value::Null);
                (status, body)
            }));
        }

        for t in tasks {
            let (status, body) = t.await.expect("set-default task panicked");
            all_outcomes.push((round, status, body));
        }

        // END STATE, checked every round: exactly one row carries the flag.
        let defaults: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!" FROM voice_runtime_versions
               WHERE is_system_default = true"#
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            defaults, 1,
            "round {round}: after {RACERS} concurrent promotions exactly one \
             version must be the system default, got {defaults} \
             (outcomes so far: {all_outcomes:?})"
        );

        // Clear for the next round so each round starts from the same shape.
        sqlx::query!("DELETE FROM voice_runtime_versions")
            .execute(&pool)
            .await
            .unwrap();
    }

    let failures: Vec<&(usize, u16, Value)> =
        all_outcomes.iter().filter(|(_, s, _)| *s != 200).collect();
    assert!(
        failures.is_empty(),
        "every concurrent promotion must succeed; got {failures:?}. A 500 \
         SYSTEM_DATABASE_ERROR here is `voice_runtime_versions_one_default` \
         (23505) escaping the unserialized clear-then-set."
    );

    pool.close().await;
}

/// A promotion for an id that does not exist must 404 AND must not clear the
/// standing default. The old code was safe here only because its pre-check ran
/// before the clear; the transactional version keeps the guarantee by rolling
/// the clear back, so this pins the behaviour against the rewrite.
#[tokio::test]
async fn set_default_for_unknown_id_404s_without_clearing_the_current_default() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "voice_default_404", &["*"]).await;

    let existing = super::insert_version_row(
        &server,
        &format!("keeper-{}", &Uuid::new_v4().to_string()[..8]),
        "cpu",
        "/nonexistent/whisper-server",
        true,
    )
    .await;

    let missing = Uuid::new_v4();
    let res = reqwest::Client::new()
        .post(server.api_url(&format!("/voice/versions/{missing}/set-default")))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("set-default request failed");
    assert_eq!(res.status(), 404, "unknown version id must 404");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&server.database_url)
        .await
        .expect("connect test db");
    let still_default: bool = sqlx::query_scalar!(
        r#"SELECT is_system_default AS "d!" FROM voice_runtime_versions WHERE id = $1"#,
        existing
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    pool.close().await;
    assert!(
        still_default,
        "a 404 promotion must not leave the deployment with no default"
    );
}
