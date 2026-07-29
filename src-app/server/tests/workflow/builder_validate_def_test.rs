//! TEST-5 — POST /api/workflows/validate-def (the builder's live-validation feed).
//!
//! The JSON-body twin of `/validate`: it takes a posted `WorkflowDef` and returns
//! structured `{errors, warnings, cost_estimate}` with a **200** — validation
//! findings are data, never a hard 4xx. A valid def → empty `errors`; a def with a
//! dead `tools:` field on an `llm` step (WORKFLOW_DEAD_TOOLS_FIELD) → a non-empty
//! `errors` array, still 200.

use serde_json::{json, Value as Json};

use super::{plain_server, workflow_user};

#[tokio::test]
async fn validate_def_valid_and_invalid_both_200() {
    let server = plain_server().await;
    let user = workflow_user(&server, "wf_validate_def").await;
    let client = reqwest::Client::new();

    // A valid 1-step llm def → 200, empty errors, cost estimate present.
    let valid = json!({
        "inputs": [{ "name": "topic", "required": true }],
        "steps": [{
            "id": "gen",
            "kind": "llm",
            "prompt": "say something about {{ inputs.topic }}"
        }],
        "outputs": [{ "name": "result", "from": "{{ gen.output }}" }]
    });
    let resp = client
        .post(server.api_url("/workflows/validate-def"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&valid)
        .send()
        .await
        .expect("validate-def valid");
    assert_eq!(resp.status(), 200, "validate-def returns 200 for a valid def");
    let body: Json = resp.json().await.expect("parse valid body");
    assert!(
        body["errors"].as_array().map(|a| a.is_empty()).unwrap_or(false),
        "a valid def has empty errors: {body}"
    );
    assert!(body["warnings"].is_array(), "warnings array present: {body}");
    // cost_estimate is a DryRunResult; a single llm step → 1 estimated call.
    assert!(
        body["cost_estimate"].is_object(),
        "cost_estimate object present: {body}"
    );
    assert_eq!(
        body["cost_estimate"]["total_est_calls"], 1,
        "one llm step → total_est_calls = 1: {body}"
    );

    // An INVALID def: dead `tools:` on an llm step. Findings are returned as data
    // with a 200 (NOT a hard 4xx).
    let invalid = json!({
        "inputs": [{ "name": "topic", "required": true }],
        "steps": [{
            "id": "gen",
            "kind": "llm",
            "prompt": "hi {{ inputs.topic }}",
            "tools": ["web_search"]
        }],
        "outputs": [{ "name": "result", "from": "{{ gen.output }}" }]
    });
    let resp = client
        .post(server.api_url("/workflows/validate-def"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&invalid)
        .send()
        .await
        .expect("validate-def invalid");
    assert_eq!(
        resp.status(),
        200,
        "validation findings are a 200 payload, not a 4xx"
    );
    let body: Json = resp.json().await.expect("parse invalid body");
    let errors = body["errors"].as_array().expect("errors array");
    assert!(
        !errors.is_empty(),
        "an invalid def yields a non-empty errors array: {body}"
    );
    assert!(
        errors
            .iter()
            .any(|e| e["code"].as_str() == Some("WORKFLOW_DEAD_TOOLS_FIELD")),
        "the dead-tools finding is surfaced by code: {body}"
    );
}

/// TEST-4 (ITEM-2 / ITEM-4) — the builder's live feed must report the two
/// prompt states that used to validate GREEN and then fail the RUN.
///
/// This is the endpoint the validation panel actually reads, so it is where the
/// author sees (or fails to see) the verdict. INV-1: a def this endpoint reports
/// clean must run, and one it rejects must not quietly run.
///
///   * `prompt: ""` beside a `prompt_file:` — the exact state the builder's own
///     `WORKFLOW_PROMPT_BOTH` remedy ("clear the prompt box here to use the
///     file") produces. It is COMPLETE: no prompt finding at all.
///   * `prompt_file: ""` — an empty path resolves to the bundle DIRECTORY, which
///     can never be read. It used to pass unnoticed; it is a missing prompt.
///
/// (`/validate-def` has no materialized bundle, so it deliberately reports no
/// file-EXISTENCE verdict — see `check_prompt_files`' doc comment. The XOR
/// verdict is decidable without one, which is exactly what is asserted here.)
#[tokio::test]
async fn validate_def_prompt_source_verdicts() {
    let server = plain_server().await;
    let user = workflow_user(&server, "wf_validate_def_prompt").await;
    let client = reqwest::Client::new();

    async fn codes(
        client: &reqwest::Client,
        url: String,
        token: &str,
        def: Json,
    ) -> Vec<String> {
        let resp = client
            .post(url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&def)
            .send()
            .await
            .expect("validate-def");
        assert_eq!(resp.status(), 200, "findings are a 200 payload");
        let body: Json = resp.json().await.expect("parse body");
        body["errors"]
            .as_array()
            .expect("errors array")
            .iter()
            .filter_map(|e| e["code"].as_str().map(str::to_string))
            .collect()
    }
    let url = server.api_url("/workflows/validate-def");

    // A cleared prompt box beside a prompt_file: is a COMPLETE step.
    let got = codes(
        &client,
        url.clone(),
        &user.token,
        json!({
            "steps": [{
                "id": "gen",
                "kind": "llm",
                "prompt": "",
                "prompt_file": "prompts/task.md"
            }],
            "outputs": [{ "name": "result", "from": "{{ gen.output }}" }]
        }),
    )
    .await;
    assert!(
        !got.iter().any(|c| c == "WORKFLOW_PROMPT_BOTH")
            && !got.iter().any(|c| c == "WORKFLOW_PROMPT_MISSING"),
        "an empty prompt beside a prompt_file: is neither 'both' nor 'missing' — \
         the builder's own remedy must produce a workflow that validates clean \
         AND runs: {got:?}"
    );

    // An EMPTY prompt_file: is no prompt source at all.
    let got = codes(
        &client,
        url.clone(),
        &user.token,
        json!({
            "steps": [{ "id": "gen", "kind": "llm", "prompt_file": "" }],
            "outputs": [{ "name": "result", "from": "{{ gen.output }}" }]
        }),
    )
    .await;
    assert!(
        got.iter().any(|c| c == "WORKFLOW_PROMPT_MISSING"),
        "an empty prompt_file: resolves to the bundle directory and can never be \
         read — it must be reported as a missing prompt, not accepted: {got:?}"
    );

    // Control: a genuinely-both step is still rejected, so the first assertion
    // above is not passing because the check stopped firing.
    let got = codes(
        &client,
        url,
        &user.token,
        json!({
            "steps": [{
                "id": "gen",
                "kind": "llm",
                "prompt": "inline",
                "prompt_file": "prompts/task.md"
            }],
            "outputs": [{ "name": "result", "from": "{{ gen.output }}" }]
        }),
    )
    .await;
    assert!(
        got.iter().any(|c| c == "WORKFLOW_PROMPT_BOTH"),
        "prompt: and prompt_file: remain mutually exclusive: {got:?}"
    );
}
