//! `POST /api/workflows` — U+0000 in the definition's author text.
//!
//! Reproduced against the harness before the fix. `workflows.compiled_ir_json`
//! is a `jsonb` column carrying the author's input names + `default` VALUES,
//! output names + `from` expressions and step ids/descriptions. Postgres
//! cannot convert the ` ` escape inside `jsonb` (`22P05`), so each of
//! these answered `500 {"error_code":"SYSTEM_DATABASE_ERROR"}`:
//!
//! ```text
//! inputs[0].name        = "a\0b"   -> 500
//! outputs[0].name       = "a\0b"   -> 500
//! outputs[0].from       = "a\0b"   -> 500
//! steps[0].description  = "a\0b"   -> 500
//! inputs[0].default     = "a\0b"   -> 500
//! ```
//!
//! NOTE on the reported repro: script-shaped text (`<script>alert('xss')</script>`,
//! `<img src=x onerror=alert(1)>`, `javascript:` URLs) in `steps[].prompt`,
//! `description` or `message` all return 201 — it is ordinary text to the
//! serializer, the template scanner and the DB. The 500 on this endpoint is
//! the NUL class above, and `steps[].prompt` is NOT one of its carriers (the
//! prompt body stays on disk in the bundle and never reaches a column).
//!
//! The guard lives in `validate::check_no_nul`, inside `validate_collecting`,
//! so every install path (builder create, definition update, tarball import,
//! hub install) and the builder's live `POST /validate-def` all see it.

use serde_json::{Value as Json, json};

use super::{plain_server, workflow_user};

/// A def whose one `llm` step is valid, with `patch` applied on top.
fn def_named(name: &str) -> Json {
    json!({
        "name": name,
        "inputs": [{ "name": "topic", "required": true }],
        "steps": [{ "id": "gen", "kind": "llm", "prompt": "say {{ inputs.topic }}" }],
        "outputs": [{ "name": "result", "from": "{{ gen.output }}" }]
    })
}

async fn create(server: &crate::common::TestServer, token: &str, def: &Json) -> (u16, Json) {
    let resp = reqwest::Client::new()
        .post(server.api_url("/workflows"))
        .header("Authorization", format!("Bearer {token}"))
        .json(def)
        .send()
        .await
        .expect("create workflow");
    let status = resp.status().as_u16();
    let body: Json = resp.json().await.unwrap_or(Json::Null);
    (status, body)
}

#[tokio::test]
async fn create_rejects_nul_in_every_ir_bound_field() {
    let server = plain_server().await;
    let user = workflow_user(&server, "wf_nul_text").await;

    // Each case is the SAME valid def with one author string carrying a NUL.
    let mut cases: Vec<(&str, Json)> = Vec::new();

    // Renaming the input also breaks `{{ inputs.topic }}`, and the unknown-ref
    // finding would mask the NUL one — drop the reference so this case tests
    // only the NUL.
    let mut d = def_named("nul-input-name");
    d["inputs"][0]["name"] = json!("a\u{0}b");
    d["steps"][0]["prompt"] = json!("no reference");
    cases.push(("inputs[].name", d));

    let mut d = def_named("nul-output-name");
    d["outputs"][0]["name"] = json!("a\u{0}b");
    cases.push(("outputs[].name", d));

    let mut d = def_named("nul-output-from");
    d["outputs"][0]["from"] = json!("a\u{0}b");
    cases.push(("outputs[].from", d));

    let mut d = def_named("nul-step-description");
    d["steps"][0]["description"] = json!("a\u{0}b");
    cases.push(("steps[].description", d));

    let mut d = def_named("nul-input-default");
    d["inputs"][0]["default"] = json!("a\u{0}b");
    cases.push(("inputs[].default", d));

    // The prompt body never reaches a column, but it is author text on the
    // same form — it must be rejected by the same gate, not left to chance.
    let mut d = def_named("nul-step-prompt");
    d["steps"][0]["prompt"] = json!("say a\u{0}b");
    cases.push(("steps[].prompt", d));

    // A NUL inside an input default's object KEY: the IR's inferred object
    // type carries the key, so a per-field value scan would miss it.
    let mut d = def_named("nul-default-key");
    d["inputs"][0]["default"] = json!({ "a\u{0}b": 1 });
    cases.push(("inputs[].default object key", d));

    for (label, def) in cases {
        let (status, body) = create(&server, &user.token, &def).await;
        assert_eq!(
            status, 400,
            "{label}: a NUL must be a validation error, not a 500: {body}"
        );
        assert_eq!(
            body["error_code"], "WORKFLOW_NUL_CHARACTER",
            "{label}: the typed NUL error must reach the client: {body}"
        );
    }
}

/// Positive control: the very payloads the audit attributed the 500 to still
/// create successfully, and so does a clean def — the NUL gate above cannot
/// be satisfied by a handler that rejects everything.
#[tokio::test]
async fn create_still_accepts_script_shaped_prompts_and_clean_defs() {
    let server = plain_server().await;
    let user = workflow_user(&server, "wf_nul_control").await;

    let (status, body) = create(&server, &user.token, &def_named("nul-control-clean")).await;
    assert_eq!(status, 201, "a clean def still creates: {body}");

    for (i, payload) in [
        "<script>alert('xss')</script>",
        "<img src=x onerror=alert(1)>",
        "javascript:alert(document.cookie)",
    ]
    .into_iter()
    .enumerate()
    {
        let mut def = def_named(&format!("nul-control-xss-{i}"));
        def["steps"][0]["prompt"] = json!(payload);
        let (status, body) = create(&server, &user.token, &def).await;
        assert_eq!(
            status, 201,
            "script-shaped prompt text is ordinary text and must still save: {body}"
        );
    }
}
