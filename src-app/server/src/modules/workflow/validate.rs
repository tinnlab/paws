//! workflow.yaml parser + Layer 1+2+3 validator (plan §4.1).
//!
//! Layer 1 (shape): structural validation via serde deserialization
//! into the typed `WorkflowDef`. The vendored JSON-Schema file is the
//! authoritative shape source on the publisher side; Rust serde
//! gives the consumer the same enforcement for free (typed enums for
//! `kind`, default values for omitted fields, mutually-exclusive
//! `prompt`/`prompt_file` via the `#[serde(flatten)]` tagged union).
//!
//! **Layer-1 jsonschema decision (Phase 8 G):** the plan §4.1 Layer 1
//! nominally calls for the `jsonschema` crate run against the vendored
//! `workflow-definition.schema.json`. We deliberately KEEP the serde
//! path instead of adding the crate, because:
//!   1. serde already gives EQUIVALENT shape enforcement (typed enums,
//!      defaults, the `prompt`/`prompt_file` flatten-mutex re-checked in
//!      `check_steps_shape`).
//!   2. the actual GOAL of plan §4.1 Layer 1 — publisher + consumer
//!      validators AGREE on shape — is now guaranteed by the shared
//!      `test-fixtures/` corpus (Layer 4 cross-fixture parity), not by
//!      both sides happening to call the same library.
//!   3. the vendored schema is draft-2020-12 with conditional
//!      `if/then`/`allOf` per-kind blocks; loading + compiling that with
//!      jsonschema-rs (a new workspace dep) is non-trivial and brings
//!      no behavioral win over serde + fixture-parity.
//! If a future need for literal schema fidelity arises (e.g. a third
//! Layer-1 consumer), revisit; for Phase 1 the equivalence holds.
//!
//! Layer 2 (semantic):
//! - step IDs unique + match `^[a-z][a-z0-9_]*$`,
//! - depends_on resolves + topo-sort succeeds (no cycles),
//! - every `{{ X.Y }}` template reference resolves (`X` is `inputs`
//!   with matching name, OR an earlier step in topo order),
//! - `prompt_file` paths exist in the bundle source,
//! - `prompt:` and `prompt_file:` mutually exclusive.
//!
//! Layer 3 (security):
//! - `prompt_file:` path safety (no `..`, no absolute, no symlink
//!   escape),
//! - `sandbox.flavor` value in `code_sandbox::KNOWN_FLAVORS`,
//! - reject `mock:` in non-dev workflows (called via `validate_for_install`).


use std::collections::{HashMap, HashSet};
use std::path::Path;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::common::AppError;

// ============================================================
// Typed shape (mirrors plan §1)
// ============================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct WorkflowDef {
    #[serde(default, rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxDecl>,
    /// Workflow-declared wall-clock cap in seconds. `None` → the engine default
    /// (`RUN_WALL_CLOCK`). `Some(0)` → UNBOUNDED (no wall-clock — for long runs on
    /// a user-owned machine). The effective value is live-adjustable per run via
    /// `PUT /workflow-runs/{id}/timeout`. The per-run token + output-byte caps stay
    /// as the resource backstops regardless.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_runtime_secs: Option<u64>,
    #[serde(default = "default_expose_logs")]
    pub expose_logs: ExposeLogs,
    #[serde(default)]
    pub inputs: Vec<InputDef>,
    #[serde(default)]
    pub steps: Vec<StepDef>,
    #[serde(default)]
    pub outputs: Vec<OutputDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SandboxDecl {
    pub flavor: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum ExposeLogs {
    Always,
    #[default]
    OnError,
    Never,
}

fn default_expose_logs() -> ExposeLogs {
    ExposeLogs::OnError
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct InputDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct StepDef {
    pub id: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Author-facing, template-rendered label of what this step does
    /// ("Search the web for {{ inputs.topic }}"). Surfaced as the step
    /// title in the run progress UI for every kind. Distinct from
    /// `message` (the elicit prompt / dynamic status line). Optional;
    /// capped at `MAX_STEP_DESCRIPTION_CHARS`. Ref-checked at install
    /// like `message`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub log: LogCapture,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expose_logs: Option<ExposeLogs>,
    /// Dev-only canned response. Honored only when
    /// `workflows.is_dev = true`. Rejected at install for non-dev
    /// workflows (`validate_for_install` enforces).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mock: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<ArtifactDecl>,
    /// The tagged union of step kinds (kind: llm | llm_map | sandbox |
    /// elicit). The `default kind = llm` rule is in plan §1.
    #[serde(flatten)]
    pub config: StepConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum LogCapture {
    #[default]
    Off,
    Stderr,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StepConfig {
    Llm {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt_file: Option<String>,
        #[serde(default)]
        output_format: OutputFormat,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        tools: Vec<String>,
    },
    LlmMap {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt_file: Option<String>,
        for_each: String,
        item_var: String,
        #[serde(default)]
        output_format: OutputFormat,
        #[serde(default = "default_max_parallel")]
        max_parallel: u32,
        #[serde(default)]
        on_error: OnError,
        #[serde(default)]
        max_retries: u32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        tools: Vec<String>,
    },
    Sandbox {
        run: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stdin: Option<String>,
        #[serde(default = "default_sandbox_timeout_ms")]
        timeout_ms: u32,
    },
    Elicit {
        // NOTE: the elicitation PROMPT shown to the user is the shared
        // `StepDef.message` field (top-level on the step), NOT a nested
        // field here. A nested `message` would collide with
        // `StepDef.message` under `#[serde(flatten)]` (serde routes the
        // YAML `message` key to the outer field first, so the nested one
        // deserializes as missing). The workflow-definition.schema.json
        // already models `message` as a top-level step field for elicit.
        schema: serde_json::Value,
        /// D2: optional seed for the elicit form, template-rendered against the
        /// run context with the SAME type-preserving renderer as `tool`
        /// arguments (a whole-value `{{ ref }}` resolves to its native JSON
        /// type). Lets a prior step's output (e.g. an AI screening table)
        /// pre-fill the reviewer's form. Surfaced on the pending record + SSE.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
        /// How long to wait for the human to submit, in ms. `0` = no timeout:
        /// the run parks indefinitely (a durable human gate that survives an
        /// app restart via durable resume). Any non-zero value is capped at
        /// `ELICIT_TIMEOUT_HARD_CAP_MS` (30 min). Default 5 min — unbounded
        /// must be explicit.
        #[serde(default = "default_elicit_timeout_ms")]
        timeout_ms: u32,
    },
    /// Call an MCP tool on an accessible server (A6). `server` is a stable
    /// NAME resolved at run time against the running user's accessible servers
    /// (built-ins by name, or own/group-assigned). `arguments` is a templated
    /// JSON object rendered against the run context (type-preserving for
    /// whole-value `{{ ref }}` substitutions).
    Tool {
        server: String,
        tool: String,
        #[serde(default)]
        arguments: serde_json::Value,
    },
    /// Run the shared `agent-core` loop as a workflow step (ITEM-18). The model
    /// drives an autonomous tool-use loop against the `servers` allow-list until
    /// it produces a final answer, hits `max_steps`, or a token cap. `prompt`
    /// (inline) / `prompt_file` (bundle-relative) is the initial user task;
    /// `system` is the optional system directive. Both `prompt`/`system` are
    /// template-rendered against the run context.
    Agent {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt_file: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        system: Option<String>,
        /// Allow-list of MCP server NAMES the agent may call (resolved at run
        /// time against the user's accessible servers, exactly like a `tool`
        /// step's `server`). Empty ⇒ the agent runs with no tools.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        servers: Vec<String>,
        /// Iteration ceiling for the loop. Defaults to the `agent_admin_settings`
        /// `default_max_steps` (DEC-7 = 30) at authoring time; the dispatcher
        /// clamps it to the admin cap at run time.
        #[serde(default = "default_agent_max_steps")]
        max_steps: u32,
        #[serde(default)]
        output_format: OutputFormat,
    },
}

/// DEC-7: the agent-step iteration default (mirrors `agent_admin_settings`).
fn default_agent_max_steps() -> u32 {
    30
}

impl StepConfig {
    pub fn kind_str(&self) -> &'static str {
        match self {
            StepConfig::Llm { .. } => "llm",
            StepConfig::LlmMap { .. } => "llm_map",
            StepConfig::Sandbox { .. } => "sandbox",
            StepConfig::Elicit { .. } => "elicit",
            StepConfig::Tool { .. } => "tool",
            StepConfig::Agent { .. } => "agent",
        }
    }
}

fn default_max_parallel() -> u32 {
    5
}
pub const MAX_PARALLEL_HARD_CAP: u32 = 20;
/// Max chars for a step's `description` template (raw, pre-render).
pub const MAX_STEP_DESCRIPTION_CHARS: usize = 200;
fn default_sandbox_timeout_ms() -> u32 {
    30_000
}
fn default_elicit_timeout_ms() -> u32 {
    300_000
}
pub const ELICIT_TIMEOUT_HARD_CAP_MS: u32 = 1_800_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum OutputFormat {
    #[default]
    Text,
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum OnError {
    #[default]
    Fail,
    Skip,
    Retry,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ArtifactDecl {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct OutputDef {
    pub name: String,
    pub from: String,
    #[serde(default = "default_expose_mode")]
    pub expose: ExposeMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum ExposeMode {
    #[default]
    Full,
    Preview,
    Artifact,
    Path,
    Hidden,
}

fn default_expose_mode() -> ExposeMode {
    ExposeMode::Full
}

// ============================================================
// Validation
// ============================================================

/// Every `ValidationError` code this module + `ref_check` can emit.
///
/// This is the REGISTRY half of the humanisation contract (ITEM-2). The
/// validator's own `message` is written in the wire vocabulary on purpose —
/// `validate_for_install` turns it into an `AppError` for install/import/run,
/// and `workflow_mcp::validate_workflow` serializes it for the MODEL — so the
/// author-facing rewording lives in the builder UI, keyed off these codes
/// (`ui/src/modules/workflow/components/builder/validationCopy.ts`).
///
/// The `validation_codes_are_registered_and_humanised` test below keeps all
/// three in lockstep: an emit site whose code is not listed here fails, and a
/// listed code with no human copy in the UI fails. That is what makes "no raw
/// schema language ever reaches the author" a checked property rather than a
/// one-off fix.
///
/// **`#[cfg(test)]` on purpose.** Nothing in production reads this list — the
/// guard derives the emitted set from the source itself, so a `pub` const here
/// would be public API with no caller (CODING_GUIDELINES §15) whose `pub` also
/// suppresses the `dead_code` lint. It stays as a hand-curated test fixture
/// because it is the guard's CANARY: the bidirectional `stale` assertion means
/// any future regression that makes the source scanner see FEWER emit sites
/// (a new file it forgets, a call shape it mis-lexes) fails loudly instead of
/// making the humanisation half vacuously pass.
#[cfg(test)]
const VALIDATION_CODES: &[&str] = &[
    // validate.rs — whole-workflow shape
    "WORKFLOW_NO_STEPS",
    "WORKFLOW_TOO_MANY_STEPS",
    "WORKFLOW_SANDBOX_FLAVOR_REQUIRED",
    "WORKFLOW_UNKNOWN_FLAVOR",
    "WORKFLOW_CYCLE",
    "WORKFLOW_DUPLICATE_OUTPUT_NAME",
    // validate.rs — step identity
    "WORKFLOW_BAD_STEP_ID",
    "WORKFLOW_DUPLICATE_STEP_ID",
    "WORKFLOW_STEP_DESCRIPTION_TOO_LONG",
    // validate.rs — prompts
    "WORKFLOW_PROMPT_MISSING",
    "WORKFLOW_PROMPT_BOTH",
    "WORKFLOW_PROMPT_FILE_MISSING",
    "WORKFLOW_PROMPT_FILE_UNSAFE",
    "WORKFLOW_PROMPT_FILE_ESCAPE",
    // validate.rs — per-kind configuration
    "WORKFLOW_DEAD_TOOLS_FIELD",
    "WORKFLOW_SANDBOX_NO_RUN",
    "WORKFLOW_TOOL_NO_SERVER",
    "WORKFLOW_TOOL_NO_TOOL",
    "WORKFLOW_ELICIT_NO_MESSAGE",
    "WORKFLOW_ELICIT_TIMEOUT_CAP",
    "WORKFLOW_PARALLEL_CAP",
    "WORKFLOW_PARALLEL_ZERO",
    "WORKFLOW_FOR_EACH_EMPTY",
    "WORKFLOW_FOR_EACH_NOT_TEMPLATE",
    "WORKFLOW_ITEM_VAR_EMPTY",
    // validate.rs — dependencies
    "WORKFLOW_UNKNOWN_DEPENDENCY",
    "WORKFLOW_SELF_DEPENDENCY",
    // validate.rs — references
    "WORKFLOW_TEMPLATE_SYNTAX",
    "WORKFLOW_UNKNOWN_INPUT_REF",
    "WORKFLOW_UNKNOWN_STEP_REF",
    "WORKFLOW_BAD_STEP_FIELD",
    // validate.rs — security / publishing
    "WORKFLOW_ARTIFACT_PATH_UNSAFE",
    "WORKFLOW_MOCK_IN_PUBLISHED",
    // ref_check.rs — type-aware reference checking
    "WORKFLOW_FOR_EACH_TYPE_UNRESOLVED",
    "WORKFLOW_FOR_EACH_NOT_ARRAY",
    "WORKFLOW_PATH_ACCESS",
    "WORKFLOW_REF_INDEX_UNRESOLVED",
    "WORKFLOW_REF_INDEX_NON_ARRAY",
    "WORKFLOW_REF_UNKNOWN_FIELD",
    "WORKFLOW_REF_FIELD_UNRESOLVED",
    "WORKFLOW_REF_FIELD_NON_OBJECT",
];

/// Severity of a validation finding. Errors BLOCK install; warnings are
/// surfaced (e.g. via the `/validate` endpoint's `warnings` array) but do
/// NOT fail install — they preserve the Phase-1 escape hatch for
/// under-specified workflows (plan §4.1 pattern (b)).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct ValidationError {
    pub layer: &'static str, // "schema" | "semantic" | "security"
    pub code: &'static str,
    pub message: String,
    /// Optional step id / output name / inputs.foo path for FE
    /// rendering.
    pub location: Option<String>,
    /// `Error` (blocks install) or `Warning` (surfaced, non-blocking).
    /// Defaults to `Error` for all existing call sites; only the
    /// type-aware ref checker (`ref_check.rs`) emits warnings.
    #[serde(default = "default_severity")]
    pub severity: Severity,
}

// serde `default = "default_severity"` fn: invoked only when a `ValidationError`
// is deserialized (client-bound errors are usually only serialized).
#[allow(dead_code)]
fn default_severity() -> Severity {
    Severity::Error
}

impl ValidationError {
    pub(crate) fn err<S: Into<String>>(layer: &'static str, code: &'static str, msg: S) -> Self {
        Self {
            layer,
            code,
            message: msg.into(),
            location: None,
            severity: Severity::Error,
        }
    }
    pub(crate) fn at<S: Into<String>, L: Into<String>>(
        layer: &'static str,
        code: &'static str,
        msg: S,
        loc: L,
    ) -> Self {
        Self {
            layer,
            code,
            message: msg.into(),
            location: Some(loc.into()),
            severity: Severity::Error,
        }
    }
    /// Warning-severity finding with a location. Surfaced but never
    /// blocks install (`validate_for_install` filters to errors only).
    pub(crate) fn warn<S: Into<String>, L: Into<String>>(
        layer: &'static str,
        code: &'static str,
        msg: S,
        loc: L,
    ) -> Self {
        Self {
            layer,
            code,
            message: msg.into(),
            location: Some(loc.into()),
            severity: Severity::Warning,
        }
    }
}

/// Parse YAML body. Layer 1 shape errors become AppError ("the install
/// handler short-circuits on the first parse failure"). For the
/// `/validate` REST surface (B6), use `validate_yaml_collecting` which
/// returns all errors.
pub fn parse_workflow_yaml(yaml: &str) -> Result<WorkflowDef, AppError> {
    serde_norway::from_str::<WorkflowDef>(yaml).map_err(|e| {
        AppError::bad_request(
            "WORKFLOW_INVALID_YAML",
            format!("workflow.yaml deserialization failed: {e}"),
        )
    })
}

/// Full validator used by the install handler. Returns Ok on success,
/// or the first error as an AppError.
///
/// `bundle_root` is the extracted bundle dir (used for `prompt_file:`
/// path resolution).
/// `is_dev` controls whether `mock:` is allowed.
pub fn validate_for_install(
    workflow: &WorkflowDef,
    bundle_root: &Path,
    is_dev: bool,
) -> Result<(), AppError> {
    let findings = validate_collecting(workflow, bundle_root, is_dev);
    // Warnings (type-aware ref-check escape hatch) are surfaced via the
    // `/validate` endpoint but MUST NOT block install. Only errors fail.
    if let Some(first) = findings
        .into_iter()
        .find(|e| e.severity == Severity::Error)
    {
        return Err(AppError::bad_request(
            first.code,
            format!(
                "[{}/{}] {}{}",
                first.layer,
                first.code,
                first.location.map(|l| format!("{l}: ")).unwrap_or_default(),
                first.message
            ),
        ));
    }
    Ok(())
}

/// Same as `validate_for_install` but returns ALL errors. Used by
/// `/validate` REST endpoint (B6).
pub fn validate_collecting(
    workflow: &WorkflowDef,
    bundle_root: &Path,
    is_dev: bool,
) -> Vec<ValidationError> {
    let mut out = Vec::new();
    // Layer 2 + 3 — semantic + security.
    out.extend(check_steps_shape(workflow));
    out.extend(check_dependencies(workflow));
    out.extend(check_outputs(workflow));
    out.extend(check_template_refs(workflow));
    out.extend(check_prompt_files(workflow, bundle_root));
    out.extend(check_security(workflow));
    // Pattern (b): type-aware reference validation. Runs AFTER the
    // name-level `check_template_refs` so unknown ids are reported once
    // (the typed checker skips unknown ids). Emits a mix of errors
    // (definite type mismatches) + warnings (under-specified shapes).
    out.extend(crate::modules::workflow::ref_check::check_typed_refs(
        workflow,
    ));
    if !is_dev {
        out.extend(check_no_mock(workflow));
    }
    out
}

/// Topo-sort + cycle check kept as a standalone fn for tests + the
/// runner (it consumes the order at dispatch time).
pub fn topo_sort_steps(workflow: &WorkflowDef) -> Result<Vec<usize>, AppError> {
    let n = workflow.steps.len();
    let mut step_idx: HashMap<&str, usize> = HashMap::with_capacity(n);
    for (i, s) in workflow.steps.iter().enumerate() {
        step_idx.insert(s.id.as_str(), i);
    }
    // Kahn's algorithm. Stable order: by appearance.
    let mut indeg = vec![0u32; n];
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, s) in workflow.steps.iter().enumerate() {
        for dep in &s.depends_on {
            let &j = step_idx.get(dep.as_str()).ok_or_else(|| {
                AppError::bad_request(
                    "WORKFLOW_UNKNOWN_DEPENDENCY",
                    format!("step '{}' depends_on unknown step '{}'", s.id, dep),
                )
            })?;
            adj[j].push(i);
            indeg[i] += 1;
        }
    }
    let mut queue: std::collections::VecDeque<usize> =
        indeg.iter().enumerate().filter(|(_, d)| **d == 0).map(|(i, _)| i).collect();
    let mut order = Vec::with_capacity(n);
    while let Some(i) = queue.pop_front() {
        order.push(i);
        for &j in &adj[i] {
            indeg[j] -= 1;
            if indeg[j] == 0 {
                queue.push_back(j);
            }
        }
    }
    if order.len() != n {
        return Err(AppError::bad_request(
            "WORKFLOW_CYCLE",
            "workflow.yaml: depends_on cycle detected",
        ));
    }
    Ok(order)
}

// --- per-check helpers ---

fn check_steps_shape(workflow: &WorkflowDef) -> Vec<ValidationError> {
    let mut out = Vec::new();
    if workflow.steps.is_empty() {
        out.push(ValidationError::err(
            "schema",
            "WORKFLOW_NO_STEPS",
            "workflow.yaml: steps[] must contain at least one step",
        ));
    }
    if workflow.steps.len() > 50 {
        out.push(ValidationError::err(
            "semantic",
            "WORKFLOW_TOO_MANY_STEPS",
            format!(
                "workflow.yaml: {} steps exceeds Phase-1 cap of 50",
                workflow.steps.len()
            ),
        ));
    }
    let id_re = regex::Regex::new(r"^[a-z][a-z0-9_]*$").unwrap();
    let mut seen: HashSet<&str> = HashSet::new();
    for s in &workflow.steps {
        if !id_re.is_match(&s.id) {
            out.push(ValidationError::at(
                "schema",
                "WORKFLOW_BAD_STEP_ID",
                format!(
                    "step id '{}' must match ^[a-z][a-z0-9_]*$",
                    s.id
                ),
                &s.id,
            ));
        }
        if !seen.insert(s.id.as_str()) {
            out.push(ValidationError::at(
                "semantic",
                "WORKFLOW_DUPLICATE_STEP_ID",
                format!("duplicate step id '{}'", s.id),
                &s.id,
            ));
        }
        // Step description cap (the raw template, pre-render). Keeps the
        // progress-UI label bounded; the rendered string is also capped FE-side.
        if let Some(desc) = s.description.as_deref() {
            if desc.chars().count() > MAX_STEP_DESCRIPTION_CHARS {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_STEP_DESCRIPTION_TOO_LONG",
                    format!(
                        "step '{}' description is {} chars (max {})",
                        s.id,
                        desc.chars().count(),
                        MAX_STEP_DESCRIPTION_CHARS
                    ),
                    &s.id,
                ));
            }
        }
        // Prompt vs prompt_file mutual exclusion (defense in depth on
        // top of #[serde(flatten)] which doesn't enforce oneOf).
        if let StepConfig::Llm {
            prompt, prompt_file, ..
        }
        | StepConfig::LlmMap {
            prompt, prompt_file, ..
        }
        | StepConfig::Agent {
            prompt, prompt_file, ..
        } = &s.config
        {
            let has_prompt = prompt.as_ref().filter(|s| !s.is_empty()).is_some();
            let has_file = prompt_file.is_some();
            if has_prompt && has_file {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_PROMPT_BOTH",
                    "step has both prompt: and prompt_file: (mutually exclusive)",
                    &s.id,
                ));
            }
            if !has_prompt && !has_file {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_PROMPT_MISSING",
                    "step has neither prompt: nor prompt_file:",
                    &s.id,
                ));
            }
        }
        // E6: the `tools:` field on llm/llm_map is dead (never read — the
        // LlmDispatcher builds its ChatRequest with no tools). Reject it with a
        // clear pointer to the `tool` step kind instead of silently ignoring it.
        if let StepConfig::Llm { tools, .. } | StepConfig::LlmMap { tools, .. } = &s.config
            && !tools.is_empty()
        {
            out.push(ValidationError::at(
                "semantic",
                "WORKFLOW_DEAD_TOOLS_FIELD",
                "`tools:` on an llm/llm_map step does nothing — use a separate \
                 `kind: tool` step to call an MCP tool",
                &s.id,
            ));
        }
        if let StepConfig::Sandbox { run, .. } = &s.config {
            // Reject empty OR whitespace-only `run:` (a `run: "   "` would
            // otherwise pass `.is_empty()` yet produce a no-op `cd && `
            // command at dispatch). Plan §4 workflow_mcp + audit gap 7.
            if run.trim().is_empty() {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_SANDBOX_NO_RUN",
                    "sandbox step has empty run:",
                    &s.id,
                ));
            }
        }
        if let StepConfig::Tool { server, tool, .. } = &s.config {
            if server.trim().is_empty() {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_TOOL_NO_SERVER",
                    "tool step has empty server:",
                    &s.id,
                ));
            }
            if tool.trim().is_empty() {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_TOOL_NO_TOOL",
                    "tool step has empty tool:",
                    &s.id,
                ));
            }
        }
        if let StepConfig::Elicit { timeout_ms, .. } = &s.config {
            // `0` is the explicit "no timeout / wait indefinitely" sentinel and
            // is always allowed; only a non-zero value is bounded by the cap.
            if *timeout_ms != 0 && *timeout_ms > ELICIT_TIMEOUT_HARD_CAP_MS {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_ELICIT_TIMEOUT_CAP",
                    format!(
                        "elicit timeout_ms={} exceeds hard cap {}",
                        timeout_ms, ELICIT_TIMEOUT_HARD_CAP_MS
                    ),
                    &s.id,
                ));
            }
            // The elicitation prompt is the shared StepDef.message field.
            if s.message.as_deref().map(str::trim).unwrap_or("").is_empty() {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_ELICIT_NO_MESSAGE",
                    "elicit step requires a `message` (the prompt shown to the user)",
                    &s.id,
                ));
            }
        }
        // llm_map for_each separate check (avoid borrowing issue)
        if let StepConfig::LlmMap {
            max_parallel,
            for_each,
            item_var,
            ..
        } = &s.config
        {
            if *max_parallel > MAX_PARALLEL_HARD_CAP {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_PARALLEL_CAP",
                    format!(
                        "llm_map max_parallel={} exceeds hard cap {}",
                        max_parallel, MAX_PARALLEL_HARD_CAP
                    ),
                    &s.id,
                ));
            }
            if *max_parallel == 0 {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_PARALLEL_ZERO",
                    "llm_map max_parallel must be > 0",
                    &s.id,
                ));
            }
            if for_each.is_empty() {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_FOR_EACH_EMPTY",
                    "llm_map for_each must be a template referencing an array",
                    &s.id,
                ));
            } else if !for_each.contains("{{") {
                // L2: a non-template for_each (e.g. a bare literal) passes the
                // non-empty check but fails at runtime when the dispatcher
                // tries to parse it as an array. Reject at install with a
                // clear message.
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_FOR_EACH_NOT_TEMPLATE",
                    "llm_map for_each must be a template referencing an array \
                     (e.g. \"{{ step_id.output }}\")",
                    &s.id,
                ));
            }
            if item_var.is_empty() {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_ITEM_VAR_EMPTY",
                    "llm_map item_var must be set",
                    &s.id,
                ));
            }
        }
    }
    out
}

fn check_dependencies(workflow: &WorkflowDef) -> Vec<ValidationError> {
    let mut out = Vec::new();
    let ids: HashSet<&str> = workflow.steps.iter().map(|s| s.id.as_str()).collect();
    for s in &workflow.steps {
        for dep in &s.depends_on {
            if !ids.contains(dep.as_str()) {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_UNKNOWN_DEPENDENCY",
                    format!("step '{}' depends_on unknown step '{}'", s.id, dep),
                    &s.id,
                ));
            }
            if dep == &s.id {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_SELF_DEPENDENCY",
                    "step depends_on itself",
                    &s.id,
                ));
            }
        }
    }
    if let Err(e) = topo_sort_steps(workflow) {
        out.push(ValidationError::err(
            "semantic",
            "WORKFLOW_CYCLE",
            e.to_string(),
        ));
    }
    out
}

fn check_outputs(workflow: &WorkflowDef) -> Vec<ValidationError> {
    let mut out = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for o in &workflow.outputs {
        if !seen.insert(o.name.as_str()) {
            out.push(ValidationError::at(
                "semantic",
                "WORKFLOW_DUPLICATE_OUTPUT_NAME",
                format!("duplicate output name '{}'", o.name),
                &o.name,
            ));
        }
    }
    out
}

fn check_template_refs(workflow: &WorkflowDef) -> Vec<ValidationError> {
    let mut out = Vec::new();
    let input_names: HashSet<&str> =
        workflow.inputs.iter().map(|i| i.name.as_str()).collect();
    let step_ids: HashSet<&str> = workflow.steps.iter().map(|s| s.id.as_str()).collect();

    // `item_var` is the per-item binding of an llm_map step — valid as a head
    // ONLY inside that step's own prompt (e.g. `{{ aspect }}` /
    // `{{ aspect.field }}`); the item is opaque JSON so any field on it is
    // allowed and left to runtime.
    let mut check = |loc: &str, body: &str, item_var: Option<&str>| {
        let refs = match crate::modules::workflow::template::scan_var_refs(body) {
            Ok(r) => r,
            Err(e) => {
                out.push(ValidationError::at(
                    "semantic",
                    "WORKFLOW_TEMPLATE_SYNTAX",
                    e.to_string(),
                    loc.to_string(),
                ));
                return;
            }
        };
        for (head, field) in refs {
            if Some(head.as_str()) == item_var {
                continue;
            }
            match head.as_str() {
                "inputs" => {
                    if !input_names.contains(field.as_str()) {
                        out.push(ValidationError::at(
                            "semantic",
                            "WORKFLOW_UNKNOWN_INPUT_REF",
                            format!("template references unknown input 'inputs.{field}'"),
                            loc.to_string(),
                        ));
                    }
                }
                step_id => {
                    if !step_ids.contains(step_id) {
                        out.push(ValidationError::at(
                            "semantic",
                            "WORKFLOW_UNKNOWN_STEP_REF",
                            format!(
                                "template references unknown step '{step_id}' (in '{step_id}.{field}')"
                            ),
                            loc.to_string(),
                        ));
                    } else if field != "output" && field != "path" {
                        // `field` is the LEADING access segment after the step
                        // head (`scan_var_refs` returns the first field only),
                        // so chained refs like `{{ s.output.proceed }}` or
                        // `{{ s.output[0] }}` carry leading field `output` and
                        // pass here — the deeper chain is type-checked by
                        // `ref_check.rs` and resolved by `template.rs` (C1).
                        // Only a non-output/path leading field (or a bare
                        // index directly on the step head) is an error.
                        out.push(ValidationError::at(
                            "semantic",
                            "WORKFLOW_BAD_STEP_FIELD",
                            format!(
                                "template references unknown field '{field}' on step '{step_id}' (expected 'output' or 'path')"
                            ),
                            loc.to_string(),
                        ));
                    }
                }
            }
        }
    };

    for s in &workflow.steps {
        // (loc, body, item_var-valid-in-this-body)
        let bodies: Vec<(String, &str, Option<&str>)> = match &s.config {
            StepConfig::Llm { prompt, .. } => prompt
                .as_deref()
                .map(|p| vec![(format!("{}.prompt", s.id), p, None)])
                .unwrap_or_default(),
            StepConfig::LlmMap {
                prompt,
                for_each,
                item_var,
                ..
            } => {
                // `for_each` is evaluated BEFORE the item is bound, so the
                // item_var is NOT in scope there — only in the per-item prompt.
                let mut v: Vec<(String, &str, Option<&str>)> =
                    vec![(format!("{}.for_each", s.id), for_each.as_str(), None)];
                if let Some(p) = prompt.as_deref() {
                    v.push((format!("{}.prompt", s.id), p, Some(item_var.as_str())));
                }
                v
            }
            StepConfig::Sandbox { run, stdin, .. } => {
                let mut v: Vec<(String, &str, Option<&str>)> =
                    vec![(format!("{}.run", s.id), run.as_str(), None)];
                if let Some(st) = stdin.as_deref() {
                    v.push((format!("{}.stdin", s.id), st, None));
                }
                v
            }
            // Elicit's prompt is the shared StepDef.message, scanned below; its
            // `data:` seed is template-rendered, so scan every string in it.
            StepConfig::Elicit { data, .. } => data
                .as_ref()
                .map(|d| {
                    collect_template_strings(d)
                        .into_iter()
                        .map(|s_ref| (format!("{}.data", s.id), s_ref, None))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            // Tool `arguments` is a templated JSON value — scan every string in it
            // so a typo'd `{{ ref }}` is caught at install, not at run time.
            StepConfig::Tool { arguments, .. } => collect_template_strings(arguments)
                .into_iter()
                .map(|s_ref| (format!("{}.arguments", s.id), s_ref, None))
                .collect(),
            // Agent's `prompt` + `system` are template-rendered (no item_var).
            StepConfig::Agent { prompt, system, .. } => {
                let mut v: Vec<(String, &str, Option<&str>)> = Vec::new();
                if let Some(p) = prompt.as_deref() {
                    v.push((format!("{}.prompt", s.id), p, None));
                }
                if let Some(sys) = system.as_deref() {
                    v.push((format!("{}.system", s.id), sys, None));
                }
                v
            }
        };
        for (loc, body, item_var) in bodies {
            check(&loc, body, item_var);
        }
        // The step message renders at step-start (before any item is bound),
        // so item_var is not in scope there.
        if let Some(msg) = s.message.as_deref() {
            check(&format!("{}.message", s.id), msg, None);
        }
        // `description` renders at step-start too (full ctx) + at run-start
        // (inputs only); same scope as message — no item_var.
        if let Some(desc) = s.description.as_deref() {
            check(&format!("{}.description", s.id), desc, None);
        }
    }
    for o in &workflow.outputs {
        check(&format!("outputs[{}].from", o.name), &o.from, None);
    }
    out
}

/// Collect every string leaf in a JSON value (recursively through arrays +
/// objects). Used to scan `tool.arguments` / `elicit.data` for `{{ }}` refs.
fn collect_template_strings(v: &serde_json::Value) -> Vec<&str> {
    fn walk<'a>(v: &'a serde_json::Value, out: &mut Vec<&'a str>) {
        match v {
            serde_json::Value::String(s) => out.push(s.as_str()),
            serde_json::Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            serde_json::Value::Object(m) => m.values().for_each(|x| walk(x, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(v, &mut out);
    out
}

fn check_prompt_files(workflow: &WorkflowDef, bundle_root: &Path) -> Vec<ValidationError> {
    let mut out = Vec::new();
    for s in &workflow.steps {
        let pf = match &s.config {
            StepConfig::Llm { prompt_file, .. } => prompt_file.as_deref(),
            StepConfig::LlmMap { prompt_file, .. } => prompt_file.as_deref(),
            StepConfig::Agent { prompt_file, .. } => prompt_file.as_deref(),
            _ => None,
        };
        if let Some(p) = pf {
            if p.contains("..") || p.starts_with('/') {
                out.push(ValidationError::at(
                    "security",
                    "WORKFLOW_PROMPT_FILE_UNSAFE",
                    format!("prompt_file '{p}' must be a bundle-relative path without '..'"),
                    &s.id,
                ));
                continue;
            }
            let resolved = bundle_root.join(p);
            // Defense: re-canonicalize and verify it's still inside the bundle root.
            match resolved.canonicalize() {
                Ok(canon) => {
                    let root_canon = bundle_root.canonicalize().unwrap_or(bundle_root.to_path_buf());
                    if !canon.starts_with(&root_canon) {
                        out.push(ValidationError::at(
                            "security",
                            "WORKFLOW_PROMPT_FILE_ESCAPE",
                            format!("prompt_file '{p}' resolves outside bundle"),
                            &s.id,
                        ));
                    }
                }
                Err(_) => {
                    out.push(ValidationError::at(
                        "semantic",
                        "WORKFLOW_PROMPT_FILE_MISSING",
                        format!("prompt_file '{p}' not found in bundle"),
                        &s.id,
                    ));
                }
            }
        }
    }
    out
}

fn check_security(workflow: &WorkflowDef) -> Vec<ValidationError> {
    let mut out = Vec::new();
    // sandbox.flavor must be in KNOWN_FLAVORS.
    if let Some(sb) = &workflow.sandbox {
        let known: Vec<&str> = crate::modules::code_sandbox::types::KNOWN_FLAVORS
            .iter()
            .map(|f| f.flavor)
            .collect();
        if !known.contains(&sb.flavor.as_str()) {
            out.push(ValidationError::err(
                "security",
                "WORKFLOW_UNKNOWN_FLAVOR",
                format!(
                    "sandbox.flavor '{}' is not in KNOWN_FLAVORS ({})",
                    sb.flavor,
                    known.join(", ")
                ),
            ));
        }
    }
    // If any step is `kind: sandbox`, sandbox.flavor MUST be declared.
    let has_sandbox = workflow
        .steps
        .iter()
        .any(|s| matches!(s.config, StepConfig::Sandbox { .. }));
    if has_sandbox && workflow.sandbox.is_none() {
        out.push(ValidationError::err(
            "semantic",
            "WORKFLOW_SANDBOX_FLAVOR_REQUIRED",
            "workflow has kind: sandbox steps but no top-level sandbox.flavor",
        ));
    }
    // Artifact declarations: path safety.
    for s in &workflow.steps {
        for a in &s.artifacts {
            if let Some(p) = a.path.as_deref()
                && (p.contains("..") || p.starts_with('/'))
            {
                out.push(ValidationError::at(
                    "security",
                    "WORKFLOW_ARTIFACT_PATH_UNSAFE",
                    format!("artifact path '{p}' must be relative, no '..'"),
                    &s.id,
                ));
            }
        }
    }
    out
}

fn check_no_mock(workflow: &WorkflowDef) -> Vec<ValidationError> {
    let mut out = Vec::new();
    for s in &workflow.steps {
        if s.mock.is_some() {
            out.push(ValidationError::at(
                "security",
                "WORKFLOW_MOCK_IN_PUBLISHED",
                "step has mock: set in a non-dev workflow (only dev workflows may carry mocks)",
                &s.id,
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parses_minimal_llm_workflow() {
        let yaml = r#"
inputs:
  - name: topic
    required: true
steps:
  - id: gen
    kind: llm
    prompt: "say something about {{ inputs.topic }}"
outputs:
  - name: result
    from: "{{ gen.output }}"
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.is_empty(), "unexpected errors: {errs:?}");
    }

    #[test]
    fn elicit_step_deserializes_with_shared_message() {
        // Regression: `message` is StepDef's shared field; with
        // #[serde(flatten)] the elicit variant must NOT redeclare it or
        // the YAML key gets eaten by StepDef and the elicit step fails
        // to deserialize. The seed workflow answer-with-citations relies
        // on this.
        let yaml = r#"
inputs:
  - name: question
    required: true
steps:
  - id: confirm
    kind: elicit
    message: "Proceed with '{{ inputs.question }}'?"
    schema:
      type: object
      properties:
        proceed: { type: boolean }
      required: [proceed]
  - id: answer
    kind: llm
    prompt: "Answer: {{ inputs.question }} (confirmed: {{ confirm.output }})"
    depends_on: [confirm]
outputs:
  - name: result
    from: "{{ answer.output }}"
"#;
        let wf = parse_workflow_yaml(yaml).expect("elicit workflow must parse");
        assert_eq!(wf.steps.len(), 2);
        assert!(matches!(wf.steps[0].config, StepConfig::Elicit { .. }));
        assert_eq!(
            wf.steps[0].message.as_deref(),
            Some("Proceed with '{{ inputs.question }}'?")
        );
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.is_empty(), "unexpected errors: {errs:?}");
    }

    #[test]
    fn sandbox_step_with_whitespace_only_run_rejected() {
        // Audit gap 7: a `run:` of only whitespace must be rejected (it
        // would otherwise produce a no-op `cd <dir> &&    ` at dispatch).
        let yaml = r#"
sandbox:
  flavor: minimal
steps:
  - id: build
    kind: sandbox
    run: "   \t  "
outputs:
  - name: result
    from: "{{ build.output }}"
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_SANDBOX_NO_RUN"),
            "expected WORKFLOW_SANDBOX_NO_RUN for whitespace-only run, got: {errs:?}"
        );
    }

    #[test]
    fn tool_step_parses_with_kind_tool() {
        let yaml = r#"
steps:
  - id: search
    kind: tool
    server: web_search
    tool: web_search
    arguments:
      query: "{{ inputs.topic }}"
inputs:
  - name: topic
    required: true
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        assert_eq!(wf.steps[0].config.kind_str(), "tool");
    }

    #[test]
    fn tool_step_empty_server_rejected() {
        let yaml = r#"
steps:
  - id: search
    kind: tool
    server: "  "
    tool: web_search
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_TOOL_NO_SERVER"),
            "expected WORKFLOW_TOOL_NO_SERVER, got: {errs:?}"
        );
    }

    #[test]
    fn sandbox_step_with_real_run_accepted() {
        let yaml = r#"
sandbox:
  flavor: minimal
steps:
  - id: build
    kind: sandbox
    run: "echo hi"
outputs:
  - name: result
    from: "{{ build.output }}"
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            !errs.iter().any(|e| e.code == "WORKFLOW_SANDBOX_NO_RUN"),
            "non-empty run should not trip WORKFLOW_SANDBOX_NO_RUN: {errs:?}"
        );
    }

    #[test]
    fn elicit_step_without_message_rejected() {
        let yaml = r#"
steps:
  - id: confirm
    kind: elicit
    schema:
      type: object
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_ELICIT_NO_MESSAGE"),
            "expected WORKFLOW_ELICIT_NO_MESSAGE, got: {errs:?}"
        );
    }

    /// Change A: `timeout_ms: 0` is the explicit "no timeout / wait indefinitely"
    /// sentinel (a durable gate) and must validate — NOT be treated as exceeding
    /// any bound.
    #[test]
    fn elicit_timeout_zero_validates() {
        let yaml = r#"
steps:
  - id: confirm
    kind: elicit
    message: "proceed?"
    schema:
      type: object
      properties:
        ok: { type: boolean }
      required: [ok]
    timeout_ms: 0
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            !errs.iter().any(|e| e.code == "WORKFLOW_ELICIT_TIMEOUT_CAP"),
            "timeout_ms: 0 (unbounded) must NOT trip the cap check, got: {errs:?}"
        );
    }

    #[test]
    fn elicit_timeout_over_cap_rejected() {
        let yaml = format!(
            r#"
steps:
  - id: confirm
    kind: elicit
    message: "proceed?"
    schema:
      type: object
      properties:
        ok: {{ type: boolean }}
      required: [ok]
    timeout_ms: {}
"#,
            ELICIT_TIMEOUT_HARD_CAP_MS + 1
        );
        let wf = parse_workflow_yaml(&yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_ELICIT_TIMEOUT_CAP"),
            "a non-zero timeout over the 30-min cap must be rejected, got: {errs:?}"
        );
    }

    #[test]
    fn elicit_timeout_at_cap_accepted() {
        let yaml = format!(
            r#"
steps:
  - id: confirm
    kind: elicit
    message: "proceed?"
    schema:
      type: object
      properties:
        ok: {{ type: boolean }}
      required: [ok]
    timeout_ms: {}
"#,
            ELICIT_TIMEOUT_HARD_CAP_MS
        );
        let wf = parse_workflow_yaml(&yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            !errs.iter().any(|e| e.code == "WORKFLOW_ELICIT_TIMEOUT_CAP"),
            "a timeout exactly at the cap must be accepted, got: {errs:?}"
        );
    }

    #[test]
    fn dead_tools_field_on_llm_rejected() {
        // E6: `tools:` on an llm step is dead — must be rejected with a clear code.
        let yaml = r#"
steps:
  - id: gen
    kind: llm
    prompt: "hi"
    tools: ["web_search"]
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_DEAD_TOOLS_FIELD"),
            "expected WORKFLOW_DEAD_TOOLS_FIELD, got: {errs:?}"
        );
    }

    #[test]
    fn elicit_step_with_data_seed_parses() {
        // D2: the optional `data:` seed deserializes onto the elicit config.
        let yaml = r#"
steps:
  - id: review
    kind: elicit
    message: "Review"
    schema:
      type: object
    data: "{{ inputs.seed }}"
inputs:
  - name: seed
"#;
        let wf = parse_workflow_yaml(yaml).expect("parse");
        match &wf.steps[0].config {
            StepConfig::Elicit { data, .. } => {
                assert!(data.is_some(), "data seed should parse onto the elicit config");
            }
            other => panic!("expected elicit config, got {other:?}"),
        }
    }

    #[test]
    fn rejects_cycle() {
        let yaml = r#"
steps:
  - id: a
    kind: llm
    prompt: "x"
    depends_on: [b]
  - id: b
    kind: llm
    prompt: "y"
    depends_on: [a]
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_CYCLE"),
            "expected WORKFLOW_CYCLE in {errs:?}"
        );
    }

    #[test]
    fn rejects_unknown_input_ref() {
        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt: "{{ inputs.missing }}"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.iter().any(|e| e.code == "WORKFLOW_UNKNOWN_INPUT_REF"));
    }

    #[test]
    fn rejects_unknown_step_ref_in_output() {
        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt: "x"
outputs:
  - name: o
    from: "{{ nope.output }}"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.iter().any(|e| e.code == "WORKFLOW_UNKNOWN_STEP_REF"));
    }

    #[test]
    fn accepts_step_description_with_input_ref() {
        let yaml = r#"
inputs:
  - name: topic
    required: true
steps:
  - id: g
    kind: llm
    prompt: "x"
    description: "Summarize {{ inputs.topic }}"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        // The field is captured (not silently dropped) + valid.
        assert_eq!(
            wf.steps[0].description.as_deref(),
            Some("Summarize {{ inputs.topic }}")
        );
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(!errs
            .iter()
            .any(|e| e.code == "WORKFLOW_STEP_DESCRIPTION_TOO_LONG"));
        assert!(!errs.iter().any(|e| e.code == "WORKFLOW_UNKNOWN_INPUT_REF"));
    }

    #[test]
    fn rejects_overlong_step_description() {
        let long = "x".repeat(MAX_STEP_DESCRIPTION_CHARS + 1);
        let yaml = format!(
            "steps:\n  - id: g\n    kind: llm\n    prompt: \"x\"\n    description: \"{long}\"\n"
        );
        let wf = parse_workflow_yaml(&yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs
            .iter()
            .any(|e| e.code == "WORKFLOW_STEP_DESCRIPTION_TOO_LONG"));
    }

    #[test]
    fn rejects_bad_ref_in_step_description() {
        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt: "x"
    description: "uses {{ nope.output }}"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.iter().any(|e| e.code == "WORKFLOW_UNKNOWN_STEP_REF"));
    }

    #[test]
    fn llm_map_item_var_is_valid_in_its_prompt() {
        // Regression: the per-item binding (`item_var`) must be a valid head
        // inside the llm_map step's own prompt — `{{ aspect }}` and
        // `{{ aspect.field }}`. Without this, every real seed llm_map
        // workflow (deep-research, code-review, …) fails to install.
        let yaml = r#"
inputs:
  - name: topic
    required: true
steps:
  - id: list
    kind: llm
    prompt: "list aspects of {{ inputs.topic }}"
    output_format: json
  - id: each
    kind: llm_map
    for_each: "{{ list.output }}"
    item_var: aspect
    prompt: "describe {{ aspect }} (field {{ aspect.name }}) of {{ inputs.topic }}"
    depends_on: [list]
outputs:
  - name: o
    from: "{{ each.output }}"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            !errs.iter().any(|e| e.code == "WORKFLOW_UNKNOWN_STEP_REF"),
            "item_var must not be flagged as an unknown step ref: {errs:?}"
        );
    }

    #[test]
    fn item_var_out_of_scope_in_for_each_and_other_steps() {
        // The item_var is in scope ONLY in its own prompt — referencing it in
        // for_each or in another step must still error.
        let yaml = r#"
steps:
  - id: each
    kind: llm_map
    for_each: "{{ aspect.output }}"
    item_var: aspect
    prompt: "x {{ aspect }}"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_UNKNOWN_STEP_REF"),
            "item_var in for_each must error: {errs:?}"
        );
    }

    #[test]
    fn chained_step_output_ref_not_bad_step_field() {
        // C1: `{{ confirm.output.proceed }}` (object readback) +
        // `{{ fan.output[0] }}` (array index) must NOT trip
        // WORKFLOW_BAD_STEP_FIELD — the leading field is `output`, the
        // deeper chain is template-resolvable + type-checked elsewhere.
        let yaml = r#"
steps:
  - id: confirm
    kind: elicit
    message: "go?"
    schema:
      type: object
      properties:
        proceed: { type: boolean }
      required: [proceed]
  - id: fan
    kind: llm_map
    for_each: "{{ inputs.qs }}"
    item_var: q
    prompt: "{{ q }}"
    depends_on: [confirm]
  - id: use
    kind: llm
    prompt: "go={{ confirm.output.proceed }} first={{ fan.output[0] }}"
    depends_on: [confirm, fan]
inputs:
  - name: qs
    default: ["a", "b"]
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            !errs.iter().any(|e| e.code == "WORKFLOW_BAD_STEP_FIELD"),
            "chained step.output refs must not trip WORKFLOW_BAD_STEP_FIELD: {errs:?}"
        );
    }

    #[test]
    fn rejects_prompt_and_prompt_file() {
        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt: "inline"
    prompt_file: "prompts/x.md"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.iter().any(|e| e.code == "WORKFLOW_PROMPT_BOTH"));
    }

    #[test]
    fn rejects_unsafe_prompt_file() {
        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt_file: "../../etc/passwd"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.iter().any(|e| e.code == "WORKFLOW_PROMPT_FILE_UNSAFE"));
    }

    #[test]
    fn prompt_file_missing_in_bundle_is_reported() {
        // S6: a SAFE, bundle-relative prompt_file that doesn't exist in the
        // bundle → WORKFLOW_PROMPT_FILE_MISSING (canonicalize fails). Distinct
        // from the cheap textual `..`/`/` reject (WORKFLOW_PROMPT_FILE_UNSAFE).
        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt_file: "prompts/nope.md"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_PROMPT_FILE_MISSING"),
            "absent prompt_file must trip MISSING: {errs:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn prompt_file_escaping_bundle_via_symlink_is_reported() {
        // S6: a relative, dotdot-free prompt_file that CANONICALIZES outside
        // the bundle (via a symlink) trips the post-canonicalize confinement
        // guard WORKFLOW_PROMPT_FILE_ESCAPE — distinct from the textual reject.
        use std::os::unix::fs::symlink;
        let outside = tempdir().unwrap();
        let target = outside.path().join("secret.md");
        std::fs::write(&target, b"secret").unwrap();

        let bundle = tempdir().unwrap();
        // bundle/escape.md -> <outside>/secret.md (resolves outside the bundle).
        symlink(&target, bundle.path().join("escape.md")).unwrap();

        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt_file: "escape.md"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let errs = validate_collecting(&wf, bundle.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_PROMPT_FILE_ESCAPE"),
            "a prompt_file symlink escaping the bundle must trip ESCAPE: {errs:?}"
        );
    }

    #[test]
    fn rejects_unsafe_artifact_path() {
        // S6: a step artifact decl whose path escapes the workspace →
        // WORKFLOW_ARTIFACT_PATH_UNSAFE.
        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt: "x"
    artifacts:
      - path: "../escape.txt"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(
            errs.iter().any(|e| e.code == "WORKFLOW_ARTIFACT_PATH_UNSAFE"),
            "unsafe artifact path must trip ARTIFACT_PATH_UNSAFE: {errs:?}"
        );
    }

    #[test]
    fn rejects_unknown_flavor() {
        let yaml = r#"
sandbox:
  flavor: galactic
steps:
  - id: r
    kind: sandbox
    run: "echo"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.iter().any(|e| e.code == "WORKFLOW_UNKNOWN_FLAVOR"));
    }

    #[test]
    fn sandbox_step_requires_flavor_decl() {
        let yaml = r#"
steps:
  - id: r
    kind: sandbox
    run: "echo"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs = validate_collecting(&wf, tmp.path(), false);
        assert!(errs.iter().any(|e| e.code == "WORKFLOW_SANDBOX_FLAVOR_REQUIRED"));
    }

    #[test]
    fn rejects_mock_in_non_dev() {
        let yaml = r#"
steps:
  - id: g
    kind: llm
    prompt: "x"
    mock: "canned response"
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let tmp = tempdir().unwrap();
        let errs_pub = validate_collecting(&wf, tmp.path(), false);
        assert!(errs_pub.iter().any(|e| e.code == "WORKFLOW_MOCK_IN_PUBLISHED"));
        // Allowed when is_dev = true.
        let errs_dev = validate_collecting(&wf, tmp.path(), true);
        assert!(!errs_dev.iter().any(|e| e.code == "WORKFLOW_MOCK_IN_PUBLISHED"));
    }

    #[test]
    fn topo_sort_returns_valid_order() {
        let yaml = r#"
steps:
  - id: a
    kind: llm
    prompt: "x"
  - id: b
    kind: llm
    prompt: "y"
    depends_on: [a]
  - id: c
    kind: llm
    prompt: "z"
    depends_on: [b]
"#;
        let wf = parse_workflow_yaml(yaml).unwrap();
        let order = topo_sort_steps(&wf).unwrap();
        // a must come before b before c.
        let pos_a = order.iter().position(|&i| wf.steps[i].id == "a").unwrap();
        let pos_b = order.iter().position(|&i| wf.steps[i].id == "b").unwrap();
        let pos_c = order.iter().position(|&i| wf.steps[i].id == "c").unwrap();
        assert!(pos_a < pos_b && pos_b < pos_c);
    }

    /// The vendored SR hub workflows must parse + pass install-time validation
    /// (serde shape + semantic + template ref-check). Reads the committed loose
    /// `workflow.yaml` source — the seed stores these as source; `build.rs`
    /// (`build_helper/hub_seed.rs`) packs them into the bundle tarball at build.
    #[test]
    fn sr_seed_workflows_parse_and_validate() {
        let yamls = [(
            "sr-review",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/resources/hub-seed/workflows/io.github.ziee/sr-review/workflow.yaml"
            )),
        )];
        for (name, yaml) in yamls {
            let wf = parse_workflow_yaml(yaml)
                .unwrap_or_else(|e| panic!("{name}: parse failed: {e:?}"));
            validate_for_install(&wf, std::path::Path::new("/tmp/sr"), false)
                .unwrap_or_else(|e| panic!("{name}: validate failed: {e:?}"));
        }
    }

    /// The build-time packer (`build_helper/hub_seed.rs`) tars the committed
    /// source `workflow.yaml` into the bundle `.tar.gz` and rewrites the
    /// manifest's sha256/size into the BAKED seed (`binaries/hub-seed/`, the
    /// `include_dir!` source). Assert that baked pair is self-consistent and
    /// packs the committed source verbatim — a regression net for the packer
    /// that makes bundle↔manifest drift impossible by construction. (The baked
    /// dir is populated by `build.rs` before this crate compiles, same as the
    /// `include_dir!` in `hub_manager.rs`.)
    #[test]
    fn sr_seed_bundles_are_internally_consistent() {
        use sha2::{Digest, Sha256};
        fn check(name: &str, tar_gz: &[u8], manifest: &str, source_yaml: &str) {
            let m: serde_json::Value =
                serde_json::from_str(manifest).unwrap_or_else(|e| panic!("{name}: manifest: {e}"));
            let want_sha = m["bundle"]["sha256"].as_str().expect("manifest sha256");
            let want_size = m["bundle"]["size_bytes"].as_u64().expect("manifest size_bytes");
            let got_sha: String = {
                let mut h = Sha256::new();
                h.update(tar_gz);
                h.finalize().iter().map(|b| format!("{b:02x}")).collect()
            };
            assert_eq!(got_sha, want_sha, "{name}: baked tar.gz sha256 != baked manifest");
            assert_eq!(
                tar_gz.len() as u64,
                want_size,
                "{name}: baked tar.gz size != baked manifest"
            );

            let gz = flate2::read::GzDecoder::new(tar_gz);
            let mut ar = tar::Archive::new(gz);
            let mut packed: Option<String> = None;
            for entry in ar.entries().expect("tar entries") {
                let mut e = entry.expect("tar entry");
                let path = e.path().expect("entry path").to_string_lossy().into_owned();
                if path == "workflow.yaml" {
                    let mut s = String::new();
                    std::io::Read::read_to_string(&mut e, &mut s).expect("read packed yaml");
                    packed = Some(s);
                }
            }
            let packed =
                packed.unwrap_or_else(|| panic!("{name}: no workflow.yaml in baked tarball"));
            assert_eq!(packed, source_yaml, "{name}: packed workflow.yaml != committed source");
        }
        macro_rules! sr {
            ($n:literal) => {
                check(
                    $n,
                    include_bytes!(concat!(
                        env!("CARGO_MANIFEST_DIR"),
                        "/binaries/hub-seed/workflows/io.github.ziee/",
                        $n,
                        "/1.0.0.tar.gz"
                    )),
                    include_str!(concat!(
                        env!("CARGO_MANIFEST_DIR"),
                        "/binaries/hub-seed/workflows/io.github.ziee/",
                        $n,
                        "/1.0.0.json"
                    )),
                    include_str!(concat!(
                        env!("CARGO_MANIFEST_DIR"),
                        "/resources/hub-seed/workflows/io.github.ziee/",
                        $n,
                        "/workflow.yaml"
                    )),
                )
            };
        }
        sr!("sr-review");
    }
}

// ============================================================================
// ITEM-2 / TEST-1 / TEST-15 — the humanisation drift guard.
//
// These live OUTSIDE the big `mod tests` above so they read as a distinct
// contract: they do not test validation behaviour, they keep the validator's
// machine-readable codes in lockstep with the AUTHOR-FACING copy the workflow
// builder shows. The mechanism mirrors `openapi::emit_ts::tests::types_ts_parity`
// — a backend test that reads a committed frontend file and fails when the two
// drift apart.
// ============================================================================
#[cfg(test)]
mod humanisation_contract {
    use super::VALIDATION_CODES;
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};

    /// The layers a finding may carry (`ValidationError::layer`). An emit site
    /// using anything else FAILS the guard rather than being skipped: a silent
    /// skip is exactly how a new layer's codes would escape BOTH halves of the
    /// contract (registry + human copy) and reach the author as raw wire text.
    const KNOWN_LAYERS: &[&str] = &["schema", "semantic", "security"];

    fn manifest_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    /// The builder's author-facing copy map. Read at RUNTIME (not `include_str!`)
    /// so it can never be a stale compiled-in snapshot.
    fn ui_copy_path() -> PathBuf {
        manifest_dir().join("../ui/src/modules/workflow/components/builder/validationCopy.ts")
    }

    /// Every Rust source that could construct a `ValidationError`.
    ///
    /// The whole SERVER crate is scanned, not a hand-listed pair of files:
    /// `ValidationError::{err,at,warn}` are `pub(crate)` and the struct's fields
    /// are `pub`, so any module — present or future — can emit a finding, and a
    /// hardcoded file list would leave it invisible to both halves of the guard.
    /// The desktop crate is included when present for the same reason (it
    /// depends on `ziee`, and the struct's `pub` fields make a struct literal
    /// possible there too).
    fn scan_roots() -> Vec<PathBuf> {
        let mut roots = vec![manifest_dir().join("src")];
        let desktop = manifest_dir().join("../desktop/tauri/src");
        if desktop.is_dir() {
            roots.push(desktop);
        }
        roots
    }

    fn collect_rust_sources(dir: &Path, out: &mut Vec<PathBuf>) {
        let entries = std::fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("cannot read source dir {}: {e}", dir.display()));
        for entry in entries {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                collect_rust_sources(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    // ── a Rust-source scanner that understands comments, strings and tests ──

    /// A `ValidationError::{err,at,warn}("<layer>", "<CODE>", …)` call found in
    /// REAL code — not in a comment, not inside a string literal, and not inside
    /// a `#[cfg(test)]` item (a test fixture must not inject a phantom code).
    struct Scan {
        codes: BTreeSet<String>,
        /// Constructions the guard could not read a `(layer, code)` pair out of.
        /// Each is a hole in the contract, so they FAIL the test loudly instead
        /// of being dropped.
        problems: Vec<String>,
    }

    fn is_ident_char(c: char) -> bool {
        c.is_alphanumeric() || c == '_'
    }

    fn is_screaming_snake(s: &str) -> bool {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit())
    }

    fn starts_with(ch: &[char], i: usize, pat: &str) -> bool {
        pat.chars().enumerate().all(|(k, p)| ch.get(i + k) == Some(&p))
    }

    fn read_ident(ch: &[char], i: &mut usize) -> String {
        let start = *i;
        while ch.get(*i).is_some_and(|c| is_ident_char(*c)) {
            *i += 1;
        }
        ch[start..*i].iter().collect()
    }

    /// Whitespace + `//` line comments + nesting `/* */` block comments.
    fn skip_trivia(ch: &[char], i: &mut usize, line: &mut usize) {
        loop {
            match ch.get(*i) {
                Some('\n') => {
                    *line += 1;
                    *i += 1;
                }
                Some(c) if c.is_whitespace() => *i += 1,
                Some('/') if ch.get(*i + 1) == Some(&'/') => {
                    while ch.get(*i).is_some_and(|c| *c != '\n') {
                        *i += 1;
                    }
                }
                Some('/') if ch.get(*i + 1) == Some(&'*') => skip_block_comment(ch, i, line),
                _ => return,
            }
        }
    }

    fn skip_block_comment(ch: &[char], i: &mut usize, line: &mut usize) {
        let mut nest = 0usize;
        while *i < ch.len() {
            if starts_with(ch, *i, "/*") {
                nest += 1;
                *i += 2;
            } else if starts_with(ch, *i, "*/") {
                nest -= 1;
                *i += 2;
                if nest == 0 {
                    return;
                }
            } else {
                if ch[*i] == '\n' {
                    *line += 1;
                }
                *i += 1;
            }
        }
    }

    /// `"…"` with `\` escapes. Returns the content; `None` if `*i` is not on a
    /// `"` (a non-literal argument — the caller turns that into a problem).
    fn read_string_literal(ch: &[char], i: &mut usize, line: &mut usize) -> Option<String> {
        if ch.get(*i) != Some(&'"') {
            return None;
        }
        *i += 1;
        let mut out = String::new();
        while let Some(&c) = ch.get(*i) {
            match c {
                '\\' => {
                    if let Some(&e) = ch.get(*i + 1) {
                        if e == '\n' {
                            *line += 1;
                        }
                        out.push(e);
                    }
                    *i += 2;
                }
                '"' => {
                    *i += 1;
                    return Some(out);
                }
                '\n' => {
                    *line += 1;
                    out.push(c);
                    *i += 1;
                }
                _ => {
                    out.push(c);
                    *i += 1;
                }
            }
        }
        None
    }

    /// `r"…"` / `r#"…"#` / `br"…"`: returns the number of chars to the opening
    /// quote plus the hash count, or `None` when this is an ordinary identifier.
    fn raw_string_prefix(ch: &[char], i: usize) -> Option<(usize, usize)> {
        let mut j = i;
        if ch.get(j) == Some(&'b') {
            j += 1;
        }
        if ch.get(j) != Some(&'r') {
            return None;
        }
        j += 1;
        let mut hashes = 0usize;
        while ch.get(j) == Some(&'#') {
            hashes += 1;
            j += 1;
        }
        if ch.get(j) != Some(&'"') {
            return None;
        }
        Some((j + 1 - i, hashes))
    }

    fn skip_raw_string(ch: &[char], i: &mut usize, line: &mut usize, offset: usize, hashes: usize) {
        *i += offset;
        while *i < ch.len() {
            if ch[*i] == '"' && (1..=hashes).all(|k| ch.get(*i + k) == Some(&'#')) {
                *i += 1 + hashes;
                return;
            }
            if ch[*i] == '\n' {
                *line += 1;
            }
            *i += 1;
        }
    }

    /// Distinguish a char literal (`'x'`, `'\n'`, `'\u{1f600}'`) from a lifetime
    /// (`'a`). Advances past a char literal; leaves a lifetime to the ident path.
    fn skip_char_literal_or_lifetime(ch: &[char], i: &mut usize) {
        if ch.get(*i + 1) == Some(&'\\') {
            *i += 2;
            while ch.get(*i).is_some_and(|c| *c != '\'') {
                *i += 1;
            }
            *i += 1;
        } else if ch.get(*i + 2) == Some(&'\'') {
            *i += 3;
        } else {
            *i += 1; // a lifetime
        }
    }

    /// Scan one Rust source for `ValidationError` constructions.
    fn scan_rust_source(file: &str, src: &str, scan: &mut Scan) {
        let ch: Vec<char> = src.chars().collect();
        let mut i = 0usize;
        let mut line = 1usize;
        let mut depth: i32 = 0;
        // `Some(d)` while inside a `#[cfg(test)]` item body opened at depth `d`.
        let mut test_body_from: Option<i32> = None;
        let mut pending_cfg_test = false;
        let mut prev_word = String::new();

        while i < ch.len() {
            let c = ch[i];

            if c == '\n' {
                line += 1;
                i += 1;
                continue;
            }
            if c.is_whitespace() {
                i += 1;
                continue;
            }
            if c == '/' && (ch.get(i + 1) == Some(&'/') || ch.get(i + 1) == Some(&'*')) {
                skip_trivia(&ch, &mut i, &mut line);
                continue;
            }
            if let Some((offset, hashes)) = raw_string_prefix(&ch, i) {
                skip_raw_string(&ch, &mut i, &mut line, offset, hashes);
                prev_word.clear();
                continue;
            }
            if c == '"' {
                let mut sink_line = line;
                let _ = read_string_literal(&ch, &mut i, &mut sink_line);
                line = sink_line;
                prev_word.clear();
                continue;
            }
            if c == '\'' {
                skip_char_literal_or_lifetime(&ch, &mut i);
                continue;
            }
            if c == '#' && starts_with(&ch, i, "#[cfg(test)]") {
                pending_cfg_test = true;
                i += "#[cfg(test)]".chars().count();
                continue;
            }
            if c == '{' {
                if pending_cfg_test && test_body_from.is_none() {
                    test_body_from = Some(depth);
                }
                pending_cfg_test = false;
                depth += 1;
                i += 1;
                continue;
            }
            if c == '}' {
                depth -= 1;
                if test_body_from == Some(depth) {
                    test_body_from = None;
                }
                i += 1;
                continue;
            }
            if c == ';' {
                // A `#[cfg(test)] use …;` has no body to skip.
                pending_cfg_test = false;
                i += 1;
                continue;
            }
            if c == '-' && ch.get(i + 1) == Some(&'>') {
                // Return-type position: `fn f() -> ValidationError {` is a
                // signature, not a struct literal.
                prev_word = "->".to_string();
                i += 2;
                continue;
            }
            if is_ident_char(c) && !c.is_ascii_digit() {
                let word = read_ident(&ch, &mut i);
                if word == "ValidationError" && test_body_from.is_none() {
                    scan_validation_error_use(
                        &ch, &mut i, &mut line, file, &prev_word, scan,
                    );
                }
                prev_word = word;
                continue;
            }
            i += 1;
        }
    }

    /// Called with `*i` just past a `ValidationError` identifier in real code.
    fn scan_validation_error_use(
        ch: &[char],
        i: &mut usize,
        line: &mut usize,
        file: &str,
        prev_word: &str,
        scan: &mut Scan,
    ) {
        let mut j = *i;
        let mut jline = *line;
        skip_trivia(ch, &mut j, &mut jline);

        // `ValidationError { … }` — a struct literal. The guard cannot read a
        // code out of it, so it must never be how a finding is built.
        if ch.get(j) == Some(&'{') {
            if !matches!(
                prev_word,
                "struct" | "impl" | "enum" | "union" | "trait" | "for" | "->"
            ) {
                scan.problems.push(format!(
                    "{file}:{line}: `ValidationError {{ … }}` is built as a struct literal — \
                     the drift guard cannot read its `code`. Construct findings through \
                     `ValidationError::{{err,at,warn}}(\"<layer>\", \"<CODE>\", …)`."
                ));
            }
            return; // leave the brace to the caller's depth accounting
        }

        if !(ch.get(j) == Some(&':') && ch.get(j + 1) == Some(&':')) {
            return; // a type mention (`Vec<ValidationError>`, a return type, …)
        }
        j += 2;
        skip_trivia(ch, &mut j, &mut jline);
        let ctor = read_ident(ch, &mut j);
        if !matches!(ctor.as_str(), "err" | "at" | "warn") {
            scan.problems.push(format!(
                "{file}:{line}: `ValidationError::{ctor}` is not one of the \
                 `err`/`at`/`warn` constructors the drift guard can read a code out of. \
                 Either build the finding through one of those, or teach \
                 `scan_validation_error_use` about the new constructor."
            ));
            *i = j;
            *line = jline;
            return;
        }
        skip_trivia(ch, &mut j, &mut jline);
        if ch.get(j) != Some(&'(') {
            scan.problems.push(format!(
                "{file}:{line}: `ValidationError::{ctor}` is not followed by a call — \
                 the drift guard cannot read its layer/code."
            ));
            *i = j;
            *line = jline;
            return;
        }
        j += 1;

        // Argument 0 = layer, argument 1 = code. BOTH must be plain string
        // literals; anything else (a variable, a `const`, a `format!`) is a
        // finding the guard cannot verify, and is reported rather than skipped.
        skip_trivia(ch, &mut j, &mut jline);
        let Some(layer) = read_string_literal(ch, &mut j, &mut jline) else {
            scan.problems.push(format!(
                "{file}:{line}: the 1st argument of `ValidationError::{ctor}` is not a \
                 string literal, so the drift guard cannot tell which layer/code it emits."
            ));
            *i = j;
            *line = jline;
            return;
        };
        skip_trivia(ch, &mut j, &mut jline);
        if ch.get(j) != Some(&',') {
            scan.problems.push(format!(
                "{file}:{line}: `ValidationError::{ctor}(\"{layer}\" …)` has an \
                 unexpected argument shape — the drift guard cannot read its code."
            ));
            *i = j;
            *line = jline;
            return;
        }
        j += 1;
        skip_trivia(ch, &mut j, &mut jline);
        let Some(code) = read_string_literal(ch, &mut j, &mut jline) else {
            scan.problems.push(format!(
                "{file}:{line}: the 2nd argument of `ValidationError::{ctor}` is not a \
                 string literal, so the drift guard cannot register/humanise its code."
            ));
            *i = j;
            *line = jline;
            return;
        };

        *i = j;
        *line = jline;

        if !KNOWN_LAYERS.contains(&layer.as_str()) {
            scan.problems.push(format!(
                "{file}:{line}: `ValidationError::{ctor}` emits code '{code}' on the \
                 UNKNOWN layer '{layer}'. Add the layer to `KNOWN_LAYERS` (and to \
                 `ValidationError::layer`'s doc) — until then the guard refuses to \
                 vouch for the codes it emits."
            ));
            return;
        }
        if !is_screaming_snake(&code) {
            scan.problems.push(format!(
                "{file}:{line}: `ValidationError::{ctor}` emits '{code}', which is not a \
                 SCREAMING_SNAKE code — the builder keys its author-facing copy off the \
                 code, so it must be a stable identifier."
            ));
            return;
        }
        scan.codes.insert(code);
    }

    /// Every code emitted anywhere in the scanned crates, plus every emit site
    /// the scanner could not verify.
    fn scan_emitted_codes() -> Scan {
        let mut files = Vec::new();
        for root in scan_roots() {
            assert!(
                root.is_dir(),
                "scan root {} does not exist — the drift guard would silently stop \
                 seeing that crate's emit sites",
                root.display()
            );
            collect_rust_sources(&root, &mut files);
        }
        assert!(
            !files.is_empty(),
            "the drift guard found no Rust sources to scan — its roots have drifted"
        );

        let mut scan = Scan {
            codes: BTreeSet::new(),
            problems: Vec::new(),
        };
        let manifest = manifest_dir();
        for path in files {
            let src = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
            // Cheap pre-filter; the lexer below is the authority.
            if !src.contains("ValidationError") {
                continue;
            }
            let label = path
                .strip_prefix(&manifest)
                .unwrap_or(path.as_path())
                .display()
                .to_string();
            scan_rust_source(&label, &src, &mut scan);
        }
        scan
    }

    // ── the builder's copy map ─────────────────────────────────────────────

    /// A `'…'` / `"…"` / `` `…` `` literal, skipping `${…}` interpolations.
    fn read_ts_string(ch: &[char], i: &mut usize) -> Option<String> {
        let quote = *ch.get(*i)?;
        *i += 1;
        let mut out = String::new();
        while let Some(&c) = ch.get(*i) {
            if c == '\\' {
                if let Some(&e) = ch.get(*i + 1) {
                    out.push(e);
                }
                *i += 2;
                continue;
            }
            if c == quote {
                *i += 1;
                return Some(out);
            }
            if quote == '`' && c == '$' && ch.get(*i + 1) == Some(&'{') {
                *i += 2;
                let mut d = 1usize;
                while let Some(&k) = ch.get(*i) {
                    match k {
                        '{' => {
                            d += 1;
                            *i += 1;
                        }
                        '}' => {
                            d -= 1;
                            *i += 1;
                            if d == 0 {
                                break;
                            }
                        }
                        '"' | '\'' | '`' => {
                            read_ts_string(ch, i)?;
                        }
                        _ => *i += 1,
                    }
                }
                continue;
            }
            out.push(c);
            *i += 1;
        }
        None
    }

    fn skip_ts_trivia(ch: &[char], i: &mut usize) {
        loop {
            match ch.get(*i) {
                Some(c) if c.is_whitespace() => *i += 1,
                Some('/') if ch.get(*i + 1) == Some(&'/') => {
                    while ch.get(*i).is_some_and(|c| *c != '\n') {
                        *i += 1;
                    }
                }
                Some('/') if ch.get(*i + 1) == Some(&'*') => {
                    *i += 2;
                    while *i < ch.len() && !starts_with(ch, *i, "*/") {
                        *i += 1;
                    }
                    *i += 2;
                }
                _ => return,
            }
        }
    }

    fn find_chars(ch: &[char], pat: &str, from: usize) -> Option<usize> {
        (from..ch.len()).find(|&k| starts_with(ch, k, pat))
    }

    /// The KEYS of the builder's `HUMAN_COPY` map — i.e. the codes
    /// `humaniseFinding` can actually restate.
    ///
    /// This is deliberately a KEY parse, not a substring search over the file:
    /// `humaniseFinding` does `HUMAN_COPY[finding.code]` and falls back to the
    /// raw wire message when the lookup misses, so a code mentioned only in a
    /// comment (or in an unrelated array) must NOT satisfy the guard. Parsed
    /// against the map's STRUCTURE so reformatting/reordering the file is free.
    fn human_copy_keys(src: &str) -> Result<BTreeSet<String>, String> {
        let ch: Vec<char> = src.chars().collect();
        let decl = find_chars(&ch, "const HUMAN_COPY", 0).ok_or_else(|| {
            "no `const HUMAN_COPY` declaration in validationCopy.ts — the drift guard \
             reads that map's KEYS to know which codes the builder can restate"
                .to_string()
        })?;
        let mut i = decl + "const HUMAN_COPY".chars().count();
        while ch.get(i).is_some_and(|c| *c != '=') {
            i += 1;
        }
        if ch.get(i).is_none() {
            return Err("`const HUMAN_COPY` has no initializer".to_string());
        }
        i += 1;
        skip_ts_trivia(&ch, &mut i);
        if ch.get(i) != Some(&'{') {
            return Err("`const HUMAN_COPY` is not initialized with an object literal — \
                        the drift guard cannot enumerate its keys"
                .to_string());
        }
        i += 1;

        let mut keys = BTreeSet::new();
        let mut depth = 0usize;
        let mut expect_key = true;
        loop {
            skip_ts_trivia(&ch, &mut i);
            let Some(&c) = ch.get(i) else {
                return Err("unterminated `HUMAN_COPY` object literal".to_string());
            };
            if depth == 0 && c == '}' {
                break;
            }
            if expect_key && depth == 0 {
                let key = if c == '"' || c == '\'' || c == '`' {
                    read_ts_string(&ch, &mut i)
                        .ok_or_else(|| "unterminated key string in `HUMAN_COPY`".to_string())?
                } else if is_ident_char(c) && !c.is_ascii_digit() {
                    read_ident(&ch, &mut i)
                } else {
                    return Err(format!(
                        "`HUMAN_COPY` entry starting with `{c}` is neither a quoted nor a \
                         plain identifier key. A spread (`...OTHER`) or a computed key would \
                         hide codes from this guard — keep the keys literal."
                    ));
                };
                skip_ts_trivia(&ch, &mut i);
                if ch.get(i) != Some(&':') {
                    return Err(format!("`HUMAN_COPY` key '{key}' is not followed by ':'"));
                }
                i += 1;
                keys.insert(key);
                expect_key = false;
                continue;
            }
            match c {
                '{' | '(' | '[' => {
                    depth += 1;
                    i += 1;
                }
                '}' | ')' | ']' => {
                    if depth == 0 {
                        return Err(format!(
                            "unbalanced `{c}` while parsing `HUMAN_COPY` values"
                        ));
                    }
                    depth -= 1;
                    i += 1;
                }
                ',' if depth == 0 => {
                    expect_key = true;
                    i += 1;
                }
                '"' | '\'' | '`' => {
                    read_ts_string(&ch, &mut i)
                        .ok_or_else(|| "unterminated string in `HUMAN_COPY`".to_string())?;
                }
                _ => i += 1,
            }
        }
        Ok(keys)
    }

    // ── the two tests ──────────────────────────────────────────────────────

    /// TEST-15 — the registry itself is well-formed, so the set comparisons
    /// below actually mean something.
    #[test]
    fn validation_codes_registry_is_well_formed() {
        let mut seen = BTreeSet::new();
        for code in VALIDATION_CODES {
            assert!(
                seen.insert(*code),
                "VALIDATION_CODES lists '{code}' twice — remove the duplicate"
            );
            assert!(
                is_screaming_snake(code),
                "VALIDATION_CODES entry '{code}' is not SCREAMING_SNAKE"
            );
        }
    }

    /// TEST-1 (acceptance, INV-1) — no raw schema language can reach the author.
    ///
    /// Three directions, all required:
    ///
    /// 1. every emit site is one the scanner can READ (no unverifiable
    ///    construction, no unknown layer, no non-literal code);
    /// 2. the emitted set and `VALIDATION_CODES` are the same set;
    /// 3. every registered code is a KEY of the builder's `HUMAN_COPY`.
    ///
    /// Adding a finding with a wire-vocabulary message is fine — shipping one
    /// the builder cannot restate in human language is not.
    #[test]
    fn validation_codes_are_registered_and_humanised() {
        let registered: BTreeSet<String> =
            VALIDATION_CODES.iter().map(|s| s.to_string()).collect();

        let scan = scan_emitted_codes();

        assert!(
            scan.problems.is_empty(),
            "the drift guard found {} `ValidationError` construction(s) it cannot verify. \
             Each one escapes BOTH the registry and the author-facing-copy check, so it \
             would reach the person building the workflow as a raw wire message:\n  - {}",
            scan.problems.len(),
            scan.problems.join("\n  - ")
        );

        let emitted = scan.codes;
        assert!(
            !emitted.is_empty(),
            "the emit-site scanner found no codes at all — it has drifted from \
             the `ValidationError::at(\"layer\", \"CODE\", …)` call shape and is \
             no longer guarding anything"
        );

        let unregistered: Vec<_> = emitted.difference(&registered).cloned().collect();
        assert!(
            unregistered.is_empty(),
            "these validation codes are emitted but NOT listed in \
             `VALIDATION_CODES` (validate.rs): {unregistered:?}\n\
             Add them there, then add author-facing copy for each in \
             src-app/ui/src/modules/workflow/components/builder/validationCopy.ts"
        );

        let stale: Vec<_> = registered.difference(&emitted).cloned().collect();
        assert!(
            stale.is_empty(),
            "these codes are listed in `VALIDATION_CODES` but no longer emitted \
             anywhere: {stale:?} — remove them from the registry (and from \
             validationCopy.ts) so the guard keeps meaning something"
        );

        let copy_path = ui_copy_path();
        let copy_src = std::fs::read_to_string(&copy_path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", copy_path.display()));
        let humanised = human_copy_keys(&copy_src).unwrap_or_else(|e| {
            panic!(
                "cannot enumerate `HUMAN_COPY`'s keys in {}: {e}",
                copy_path.display()
            )
        });
        assert!(
            !humanised.is_empty(),
            "`HUMAN_COPY` parsed to zero keys — the key parser has drifted from the \
             map's shape and is no longer guarding anything"
        );

        let unhumanised: Vec<_> = registered.difference(&humanised).cloned().collect();
        assert!(
            unhumanised.is_empty(),
            "these validation codes have NO author-facing copy: {unhumanised:?}\n\
             The workflow builder would show the raw validator message (wire \
             vocabulary such as \"step has neither prompt: nor prompt_file:\") to \
             the person building the workflow. Add an entry for each to \
             src-app/ui/src/modules/workflow/components/builder/validationCopy.ts \
             (`HUMAN_COPY`), keyed by the quoted code literal."
        );
    }
}
