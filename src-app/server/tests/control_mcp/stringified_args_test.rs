//! TEST-24 — a STRINGIFIED `invoke_capability.body` reaches the REAL loopback
//! route and actually mutates state.
//!
//! The unit tests in `control_mcp/handlers.rs` (TEST-22/23/25, plus the shared
//! argument-conformance battery) prove the DECODE in isolation. They cannot
//! prove the decoded value survives everything downstream of it — typed
//! `InvokeArgs` deserialization, `validate_body` against the operation's request
//! schema, `substitute_path`, the loopback dispatch, and the target route's own
//! authorization and deserialization.
//!
//! That gap is exactly where the reported defect lived. On the unfixed code the
//! JSON *string* was handed to `request.json(body)`, so the loopback POST body
//! was a JSON string LITERAL (`"{\"name\":\"…\"}"`) rather than an object; the
//! real route could not deserialize it and answered **422**, which surfaced to
//! the model as a confusing failure attributed to the wrong layer. A unit test
//! over `decode_invoke_args` is green in both worlds.
//!
//! So the assertion here is deliberately the *side effect*: a row in the real
//! database, reached with NO mocked authz — the same standard
//! `invoke_create_assistant_real_roundtrip` holds the well-formed-object path
//! to, applied to the shape a language model actually emits.

use serde_json::{Value, json};
use uuid::Uuid;

use super::{call_tool, pool, structured};
use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

/// Count `assistants` rows with `name`. The end-to-end proof: it can only be
/// non-zero if the decoded body reached the real route AND that route accepted
/// it.
async fn assistant_count(pool: &sqlx::PgPool, name: &str) -> i64 {
    sqlx::query_scalar!("SELECT COUNT(*) FROM assistants WHERE name = $1", name)
        .fetch_one(pool)
        .await
        .unwrap()
        .unwrap_or(0)
}

#[tokio::test]
async fn stringified_body_reaches_the_real_route_and_creates_the_entity() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strbody", &["*"]).await;
    let pool = pool(&server).await;

    let name = format!("StrBody-{}", &Uuid::new_v4().to_string()[..8]);
    // The defect's exact shape: `body` arrives as a JSON *string*, one level too
    // encoded, not as the object the tool descriptor declares.
    let encoded = serde_json::to_string(&json!({ "name": name })).unwrap();
    let args = json!({ "operation_id": "Assistant.create", "body": Value::String(encoded) });
    assert!(
        args["body"].is_string(),
        "the fixture must actually be a STRING — an object fixture is the very \
         mistake that let this defect ship"
    );

    let res = call_tool(&server, &admin.token, "invoke_capability", args).await;

    assert!(
        res["error"].is_null(),
        "a JSON-encoded body is a model encoding mistake to correct, not a \
         protocol error to refuse: {res}"
    );
    let sc = structured(&res);
    // The pre-fix symptom, pinned by name: the target route rejected the JSON
    // string literal it was sent. Asserting the STATUS (not just `ok`) is what
    // makes this test tell the truth about *which* failure it prevents.
    assert_ne!(
        sc["status"], 422,
        "422 is the unfixed behaviour — the string literal reached the route \
         undecoded: {res}"
    );
    assert!(
        sc["ok"].as_bool().unwrap_or(false),
        "the decoded body must be accepted by the real route: {res}"
    );

    assert_eq!(
        assistant_count(&pool, &name).await,
        1,
        "assistant '{name}' must exist — the whole point is that the mutation \
         actually happened, not that the call returned without erroring"
    );
}

#[tokio::test]
async fn double_stringified_body_still_reaches_the_real_route() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strbody2", &["*"]).await;
    let pool = pool(&server).await;

    let name = format!("StrBody2-{}", &Uuid::new_v4().to_string()[..8]);
    // Two layers — the occasional double-stringify, and exactly the bound
    // `MAX_STRING_UNWRAPS = 2` admits. Proving the bound end-to-end matters:
    // the unit test proves the unwrap loop, this proves the value it produces is
    // still a usable request body after every downstream stage.
    let once = serde_json::to_string(&json!({ "name": name })).unwrap();
    let twice = serde_json::to_string(&once).unwrap();

    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": Value::String(twice) }),
    )
    .await;

    assert!(res["error"].is_null(), "double-encoded body must decode: {res}");
    assert!(
        structured(&res)["ok"].as_bool().unwrap_or(false),
        "double-encoded body must reach the route: {res}"
    );
    assert_eq!(assistant_count(&pool, &name).await, 1);
}

#[tokio::test]
async fn undecodable_body_is_refused_actionably_and_creates_nothing() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strbody_bad", &["*"]).await;
    let pool = pool(&server).await;

    let before = sqlx::query_scalar!("SELECT COUNT(*) FROM assistants")
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap_or(0);

    // A string that is not JSON at all. The tolerance must NOT extend to
    // inventing a body — INV-2. The negative control for the two tests above:
    // without it, "decode everything" would satisfy them just as well.
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": "not json at all" }),
    )
    .await;

    assert!(
        res["error"].is_object() || structured(&res)["ok"].as_bool() == Some(false),
        "an undecodable body must be refused, never defaulted: {res}"
    );

    // The refusal must be USEFUL to its consumer — a model that cannot see what
    // it got wrong cannot correct itself (INV-5). Assert the message, not merely
    // that an error occurred.
    let msg = res["error"]["message"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(!msg.is_empty(), "the refusal must carry a message: {res}");
    let lower = msg.to_lowercase();
    assert!(
        lower.contains("body"),
        "the refusal must name the offending argument: {msg}"
    );
    assert!(
        lower.contains("object"),
        "the refusal must state the expected shape: {msg}"
    );
    assert!(
        msg.contains('{') && msg.contains('}'),
        "the refusal must carry a literal-JSON example the model can copy: {msg}"
    );

    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM assistants")
            .fetch_one(&pool)
            .await
            .unwrap()
            .unwrap_or(0),
        before,
        "a refused body must not have dispatched anything"
    );
}
