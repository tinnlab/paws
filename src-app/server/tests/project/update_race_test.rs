//! `PUT /api/projects/{id}` — the two 500s that only appear under concurrency.
//!
//! No single request payload reproduces a 500 here: every adversarial
//! description / instructions / name value (script tags, SQL-injection text,
//! NUL, over-length, control chars, emoji, dangling assistant/model ids) was
//! probed against the harness and answered 200 / 400 / 422 correctly. The
//! endpoint's 500s are BOTH races, and both are reproducible on demand:
//!
//! 1. **Rename TOCTOU** — the handler pre-checks the new name with a separate
//!    `SELECT COUNT(*)`, then the repository runs an unguarded
//!    `UPDATE projects SET name`. Two renames to the same name both pass the
//!    pre-check and one hits `projects_user_name_unique` (`23505`) →
//!    `500 SYSTEM_DATABASE_ERROR`. 12 of 12 probe rounds produced it.
//!    `create_project` never had this hole — it writes with
//!    `ON CONFLICT DO NOTHING` → 409.
//!
//! 2. **PUT racing DELETE** — ownership was checked with a `COUNT(*)` that
//!    took no lock, so a concurrent delete could commit inside the window and
//!    the repository's trailing `fetch_one` raised `RowNotFound`, which
//!    `AppError::database_error` flattened into a 500 instead of a 404.
//!    7 of 12 probe rounds produced it.
//!
//! Two occurrences of this endpoint in the exploration audit is consistent
//! with either shape (a double-submitted save, or a second tab).

use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};
use crate::project::helpers::{create_project, full_project_permissions};

async fn put(server: &TestServer, user: &TestUser, id: &str, body: Value) -> (u16, Value) {
    let res = reqwest::Client::new()
        .put(server.api_url(&format!("/projects/{id}")))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&body)
        .send()
        .await
        .expect("put project");
    let status = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    (status, body)
}

/// Rounds are cheap (one round trip each) and the race is wide, so a dozen
/// rounds makes a miss statistically implausible rather than relying on one
/// lucky interleaving.
const ROUNDS: usize = 12;

#[tokio::test]
async fn concurrent_rename_to_the_same_name_is_422_never_500() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "proj_race_rename", full_project_permissions()).await;

    for round in 0..ROUNDS {
        let p1 = create_project(&server, &user, &format!("Race {round} one")).await;
        let p2 = create_project(&server, &user, &format!("Race {round} two")).await;
        let target = format!("Race {round} target");

        let (r1, r2) = tokio::join!(
            put(
                &server,
                &user,
                p1["id"].as_str().unwrap(),
                json!({ "name": target })
            ),
            put(
                &server,
                &user,
                p2["id"].as_str().unwrap(),
                json!({ "name": target })
            ),
        );

        for (status, body) in [&r1, &r2] {
            assert!(
                *status < 500,
                "round {round}: a lost rename race must not be a 500: {status} {body}"
            );
        }
        // Exactly one wins; the loser gets the SAME typed error the
        // non-racing duplicate path returns.
        let winners = [&r1, &r2].iter().filter(|(s, _)| *s == 200).count();
        assert_eq!(
            winners, 1,
            "round {round}: exactly one rename must win: {r1:?} {r2:?}"
        );
        let (loser_status, loser_body) = if r1.0 == 200 { &r2 } else { &r1 };
        assert_eq!(
            *loser_status, 422,
            "round {round}: the loser must be the duplicate-name error: {loser_body}"
        );
        assert_eq!(
            loser_body["error_code"], "PROJECT_NAME_DUPLICATE",
            "round {round}: {loser_body}"
        );
    }
}

#[tokio::test]
async fn update_racing_a_delete_is_404_never_500() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "proj_race_delete", full_project_permissions()).await;

    for round in 0..ROUNDS {
        let p = create_project(&server, &user, &format!("Doomed {round}")).await;
        let id = p["id"].as_str().unwrap().to_string();
        let del_url = server.api_url(&format!("/projects/{id}"));
        let token = user.token.clone();

        let (put_res, del_status) = tokio::join!(
            put(&server, &user, &id, json!({ "description": "raced" })),
            async move {
                reqwest::Client::new()
                    .delete(del_url)
                    .header("Authorization", format!("Bearer {token}"))
                    .send()
                    .await
                    .expect("delete project")
                    .status()
                    .as_u16()
            },
        );

        let (status, body) = put_res;
        assert!(
            status == 200 || status == 404,
            "round {round}: a PUT racing a delete must be 200 or 404, never {status}: {body} \
             (delete answered {del_status})"
        );
    }
}

/// Positive control for BOTH races: the ordinary, uncontended paths still
/// behave — a rename succeeds, and a rename onto a name already held answers
/// the same 422 the race loser gets. Neither fix may be satisfied by
/// rejecting everything.
#[tokio::test]
async fn uncontended_rename_still_succeeds_and_still_detects_duplicates() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "proj_race_control", full_project_permissions())
            .await;

    let a = create_project(&server, &user, "Control A").await;
    let b = create_project(&server, &user, "Control B").await;

    // A plain rename to a free name succeeds.
    let (status, body) = put(
        &server,
        &user,
        a["id"].as_str().unwrap(),
        json!({ "name": "Control A renamed" }),
    )
    .await;
    assert_eq!(status, 200, "an uncontended rename still succeeds: {body}");
    assert_eq!(body["name"], "Control A renamed", "{body}");

    // Renaming onto a taken name is the typed duplicate error.
    let (status, body) = put(
        &server,
        &user,
        b["id"].as_str().unwrap(),
        json!({ "name": "Control A renamed" }),
    )
    .await;
    assert_eq!(status, 422, "a duplicate rename is a typed 422: {body}");
    assert_eq!(body["error_code"], "PROJECT_NAME_DUPLICATE", "{body}");

    // And an ordinary description edit — the action the audit recorded — is
    // still a plain 200.
    let (status, body) = put(
        &server,
        &user,
        b["id"].as_str().unwrap(),
        json!({ "description": "<script>alert('xss')</script>" }),
    )
    .await;
    assert_eq!(
        status, 200,
        "saving an edited description still succeeds: {body}"
    );
}
