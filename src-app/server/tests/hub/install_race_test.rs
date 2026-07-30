//! R2 — `install_system_skill_tx` / `install_system_workflow_tx` bypass the
//! conflict-mapped repository inserts, so a concurrent duplicate system
//! install escaped as `500 SYSTEM_DATABASE_ERROR`.
//!
//! Both transactions open with `SELECT prior ids` → `DELETE` → `INSERT`
//! against `skills` / `workflows` directly, rather than calling
//! `skill::repository::insert` / `workflow::repository::insert`. They
//! therefore did NOT inherit those functions' 23505 → 409 mapping.
//!
//! Being a transaction does not save them: a transaction is ATOMIC, not
//! SERIALIZED. Under READ COMMITTED each transaction's `SELECT prior ids`
//! snapshots the table before the other's uncommitted `INSERT`, so both find
//! nothing to overwrite and both insert; the loser trips
//! `uniq_skills_system_name_version` / `uniq_workflows_system_name_version`.
//!
//! LAYER: TRANSACTION. These tests call the REAL `install_system_*_tx`
//! functions (re-exported through `ziee::test_internals`) from N tasks
//! released by a barrier, against the spawned server's database.
//!
//! Why not the HTTP endpoints (`POST /api/hub/skills/create-system`)? Because
//! the handler ALSO extracts the hub bundle into one shared on-disk directory
//! before reaching the transaction, and that extraction has its own,
//! independent `exists → remove_dir_all → rename` race which can fail a racer
//! before it ever reaches the DB — masking the defect under test. Driving the
//! transaction directly is what makes this deterministic, and the transaction
//! is exactly where the defect lives.

use std::sync::Arc;

use sqlx::postgres::PgPoolOptions;
use tokio::sync::Barrier;
use uuid::Uuid;

use crate::common::TestServer;
use ziee::test_internals::{CreateSkill, CreateWorkflow};

/// Contenders per race. Every loser is a unique violation, so pre-fix this
/// produces RACERS-1 failures on every execution.
const RACERS: usize = 6;

fn system_skill(name: &str) -> CreateSkill {
    CreateSkill {
        name: name.to_string(),
        version: Some("1.0.0".to_string()),
        display_name: Some("race".to_string()),
        description: None,
        when_to_use: None,
        extracted_path: format!("/tmp/ziee-race/{name}"),
        bundle_sha256: "0".repeat(64),
        bundle_size_bytes: 1,
        file_count: 1,
        entry_point: "SKILL.md".to_string(),
        frontmatter_json: serde_json::json!({}),
        tags: serde_json::Value::Array(vec![]),
        scope: "system".to_string(),
        owner_user_id: None,
        created_by: None,
        enabled: true,
        is_dev: false,
    }
}

fn system_workflow(name: &str) -> CreateWorkflow {
    CreateWorkflow {
        name: name.to_string(),
        version: Some("1.0.0".to_string()),
        display_name: Some("race".to_string()),
        description: None,
        extracted_path: format!("/tmp/ziee-race/{name}"),
        bundle_sha256: "0".repeat(64),
        bundle_size_bytes: 1,
        file_count: 1,
        entry_point: "workflow.yaml".to_string(),
        tags: serde_json::Value::Array(vec![]),
        scope: "system".to_string(),
        owner_user_id: None,
        created_by: None,
        enabled: true,
        is_dev: false,
        ephemeral: false,
        conversation_id: None,
        compiled_ir_json: None,
    }
}

/// N concurrent `install_system_skill_tx` calls for the same hub id.
///
/// Pre-fix: 1 × Ok + (N-1) × `500 SYSTEM_DATABASE_ERROR`.
/// Post-fix: 1 × Ok + (N-1) × `409 RESOURCE_CONFLICT`, exactly one row.
#[tokio::test]
async fn concurrent_system_skill_installs_are_409_not_500() {
    let server = TestServer::start().await;
    let pool = PgPoolOptions::new()
        .max_connections(RACERS as u32)
        .connect(&server.database_url)
        .await
        .expect("connect test db");

    let hub_id = format!("io.github.test/race-{}", &Uuid::new_v4().to_string()[..8]);
    let barrier = Arc::new(Barrier::new(RACERS));

    let mut tasks = Vec::with_capacity(RACERS);
    for _ in 0..RACERS {
        let pool = pool.clone();
        let barrier = Arc::clone(&barrier);
        let create = system_skill(&hub_id);
        let hub_id = hub_id.clone();
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            ziee::test_internals::install_system_skill_tx(
                &pool,
                &create,
                &[],
                &hub_id,
                Some("1.0.0"),
            )
            .await
        }));
    }

    let mut ok = 0usize;
    let mut bad: Vec<(u16, String)> = Vec::new();
    for t in tasks {
        match t.await.expect("install task panicked") {
            Ok(_) => ok += 1,
            Err(e) if e.status_code() == 409 && e.error_code() == "RESOURCE_CONFLICT" => {}
            Err(e) => bad.push((e.status_code(), e.error_code().to_string())),
        }
    }
    assert!(
        bad.is_empty(),
        "every loser of the system-skill install race must be a typed 409 \
         RESOURCE_CONFLICT; got {bad:?} (a 500/SYSTEM_DATABASE_ERROR is the \
         unique violation escaping the transaction unmapped)"
    );
    // NOT `ok == 1`. More than one racer may legitimately succeed: a
    // transaction that starts AFTER a winner committed sees the winner's row
    // in its `SELECT prior ids`, deletes it, and installs over the top — which
    // is precisely the "H1: a same (name, version) system re-install
    // overwrites the prior row" behaviour the transaction is written for. The
    // invariant is therefore "at least one winner, no unmapped failures, and
    // exactly ONE surviving row", not a fixed winner count.
    assert!(
        ok >= 1,
        "at least one of {RACERS} concurrent installs must succeed"
    );

    let rows: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM skills WHERE name = $1"#,
        hub_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 1, "the race must leave exactly one skills row");

    // The hub_entities tracking row is written inside the same transaction:
    // a rolled-back loser must leave none of its own behind either.
    let tracked: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM hub_entities WHERE hub_id = $1"#,
        hub_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tracked, 1, "exactly one hub_entities row for the winner");
    pool.close().await;
}

/// The workflow twin of the same defect (`install_system_workflow_tx`).
#[tokio::test]
async fn concurrent_system_workflow_installs_are_409_not_500() {
    let server = TestServer::start().await;
    let pool = PgPoolOptions::new()
        .max_connections(RACERS as u32)
        .connect(&server.database_url)
        .await
        .expect("connect test db");

    let hub_id = format!("io.github.test/wfrace-{}", &Uuid::new_v4().to_string()[..8]);
    let barrier = Arc::new(Barrier::new(RACERS));

    let mut tasks = Vec::with_capacity(RACERS);
    for _ in 0..RACERS {
        let pool = pool.clone();
        let barrier = Arc::clone(&barrier);
        let create = system_workflow(&hub_id);
        let hub_id = hub_id.clone();
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            ziee::test_internals::install_system_workflow_tx(
                &pool,
                &create,
                &[],
                &hub_id,
                Some("1.0.0"),
            )
            .await
        }));
    }

    let mut ok = 0usize;
    let mut bad: Vec<(u16, String)> = Vec::new();
    for t in tasks {
        match t.await.expect("install task panicked") {
            Ok(_) => ok += 1,
            Err(e) if e.status_code() == 409 && e.error_code() == "RESOURCE_CONFLICT" => {}
            Err(e) => bad.push((e.status_code(), e.error_code().to_string())),
        }
    }
    assert!(
        bad.is_empty(),
        "every loser of the system-workflow install race must be a typed 409 \
         RESOURCE_CONFLICT; got {bad:?}"
    );
    // NOT `ok == 1`. More than one racer may legitimately succeed: a
    // transaction that starts AFTER a winner committed sees the winner's row
    // in its `SELECT prior ids`, deletes it, and installs over the top — which
    // is precisely the "H1: a same (name, version) system re-install
    // overwrites the prior row" behaviour the transaction is written for. The
    // invariant is therefore "at least one winner, no unmapped failures, and
    // exactly ONE surviving row", not a fixed winner count.
    assert!(
        ok >= 1,
        "at least one of {RACERS} concurrent installs must succeed"
    );

    let rows: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM workflows WHERE name = $1"#,
        hub_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 1, "the race must leave exactly one workflows row");
    pool.close().await;
}
