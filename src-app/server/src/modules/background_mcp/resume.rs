//! Push-to-resume: re-engage the chat agent loop when a conversation-bound
//! background SUB-AGENT run completes (kills the poll-`check_status` loop).
//!
//! When a detached `subagent` run reaches terminal `Completed` with a non-empty
//! result, the completion hook (in `tools.rs::execute_subagent_run`) spawns
//! [`resume_conversation_with_result`]. It injects the sub-agent's result as a new
//! turn on the originating conversation and re-invokes
//! [`StreamingService::start_generation`], which streams the continuation to the
//! user over the existing per-user SSE — no polling, the completion event drives
//! the agent.
//!
//! Mirrors the scheduler's headless-turn precedent (`scheduler/dispatch.rs`):
//! build a `SendMessageRequest` via JSON → `auto_register_extensions` →
//! `StreamingService::start_generation`, guarded by a wait-for-idle loop on the
//! per-conversation single-flight slot. A resume failure NEVER propagates into the
//! run outcome (the run is already `Completed`); it logs + returns (the result
//! still lives in the run row + the inbox notification). See DECISIONS DEC-1..7.

use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use uuid::Uuid;

use crate::common::AppError;
use crate::core::Repos;
use crate::modules::chat::core::extension::SendMessageRequest;
use crate::modules::chat::core::services::StreamingService;
use crate::modules::chat::extension_registration::auto_register_extensions;

use super::background_mcp_config;

/// Best-effort upper bound on how long a resume waits for the conversation to
/// become idle before giving up (DEC-5). An INTERNAL coordination timeout, not an
/// operator tunable — mirrors the scheduler's fixed-const headless-turn wait
/// (`scheduler/dispatch.rs` `TERMINAL_WAIT`). If it elapses, the result is NOT
/// lost: it lives in the run row (`collect_result`) + the inbox notification.
const RESUME_MAX_IDLE_WAIT: Duration = Duration::from_secs(5 * 60);

/// Poll cadence for the wait-for-idle loop (DEC-5). Mirrors the scheduler's
/// `POLL_INTERVAL`.
const RESUME_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Defensive cap on how much of the sub-agent's `final_text` is injected into the
/// resumed turn, so a very large result can never blow the chat context. On
/// truncation a pointer to `collect_result` is appended (the full result is always
/// available there). Generous — a sub-agent's assistant answer is normally far
/// smaller.
const RESUME_RESULT_MAX_CHARS: usize = 100_000;

/// Whether a completed sub-agent run should push-resume its conversation: only
/// when it is conversation-bound AND produced a non-empty result. The
/// subagent-ONLY gate is structural (this path is reached only from
/// `execute_subagent_run`, never the sandbox driver). Pure → unit-tested.
pub fn should_resume(conversation_id: Option<Uuid>, final_text: &str) -> bool {
    conversation_id.is_some() && !final_text.trim().is_empty()
}

/// Build the user-role message that carries the sub-agent's result back into the
/// conversation (DEC-1: user role + explicit `[Background task complete]`
/// framing). Truncates an over-cap result and appends a `collect_result` pointer.
/// Pure → unit-tested.
pub fn build_resume_message(task: &str, final_text: &str) -> String {
    let trimmed = final_text.trim();
    let (result_body, truncated) = if trimmed.chars().count() > RESUME_RESULT_MAX_CHARS {
        let head: String = trimmed.chars().take(RESUME_RESULT_MAX_CHARS).collect();
        (head, true)
    } else {
        (trimmed.to_string(), false)
    };

    let mut msg = String::new();
    msg.push_str("[Background task complete] A background sub-agent you started has finished.\n\n");
    msg.push_str("Task: ");
    msg.push_str(task.trim());
    msg.push_str("\n\nResult:\n");
    msg.push_str(&result_body);
    if truncated {
        msg.push_str(
            "\n\n[result truncated — call collect_result with this run's run_id for the full output]",
        );
    }
    msg.push_str("\n\nUse this result to continue the conversation.");
    msg
}

/// Re-engage the chat agent loop on `conversation_id` with the sub-agent's result.
///
/// Waits for the conversation to be idle (bounded by [`RESUME_MAX_IDLE_WAIT`]),
/// then injects the framed result as a new turn and calls
/// [`StreamingService::start_generation`] (which internally dispatches to the
/// legacy OR agent-core loop via `ZIEE_CHAT_AGENT_CORE`). Errors are returned to
/// the caller, which logs them — they must NEVER fail the already-`Completed` run.
pub async fn resume_conversation_with_result(
    pool: PgPool,
    user_id: Uuid,
    conversation_id: Uuid,
    model_id: Uuid,
    task: String,
    final_text: String,
) -> Result<(), AppError> {
    // The chat extension registry needs the deployment Config, stashed at init.
    let config = background_mcp_config().ok_or_else(|| {
        AppError::internal_error(
            "background_mcp: config not initialized; cannot resume conversation",
        )
    })?;

    // Resolve the conversation + its active branch (owner-scoped). A deleted
    // conversation / revoked access → not_found; the caller logs + skips.
    let conversation = Repos
        .chat
        .core
        .get_conversation(conversation_id, user_id)
        .await?
        .ok_or_else(|| AppError::not_found("conversation not found for resume"))?;
    let branch_id = conversation
        .active_branch_id
        .ok_or_else(|| AppError::internal_error("resume: conversation has no active branch"))?;

    // Wait for the conversation to be idle so the resume does not race a live
    // foreground turn. `start_generation` also claims the single-flight slot, so
    // this is best-effort coordination (mirrors scheduler/dispatch.rs wait loop).
    let deadline = tokio::time::Instant::now() + RESUME_MAX_IDLE_WAIT;
    while crate::modules::chat::stream::registry::is_generating(conversation_id) {
        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::internal_error(
                "resume: conversation stayed busy past the idle-wait bound",
            ));
        }
        tokio::time::sleep(RESUME_POLL_INTERVAL).await;
    }

    // Build the send request via JSON (extension fields default). Enable MCP so a
    // chained continuation can use the built-in tools. NOT unattended (DEC-2): this
    // is the user's foreground conversation — normal approval flow applies.
    let content = build_resume_message(&task, &final_text);
    let req_json = serde_json::json!({
        "content": content,
        "model_id": model_id,
        "branch_id": branch_id,
        "enable_mcp": true,
    });
    let request: SendMessageRequest = serde_json::from_value(req_json)
        .map_err(|e| AppError::internal_error(format!("resume: build request: {e}")))?;

    let registry = Arc::new(auto_register_extensions(pool.clone(), config));
    let service = StreamingService::new(pool).with_extensions(registry);
    // origin = None: this is a detached, server-initiated turn (mirrors the
    // scheduler + the detached completion-emit convention).
    service
        .start_generation(branch_id, conversation_id, user_id, None, request)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST-2: the framed resume message carries the task + the full short result.
    #[test]
    fn build_resume_message_frames_task_and_result() {
        let msg = build_resume_message("Summarize the PDF", "Here is the summary.");
        assert!(
            msg.starts_with("[Background task complete]"),
            "clear machine-authored header: {msg}"
        );
        assert!(msg.contains("Summarize the PDF"), "carries the task: {msg}");
        assert!(msg.contains("Here is the summary."), "carries the result: {msg}");
        assert!(
            !msg.contains("truncated"),
            "a short result is not marked truncated: {msg}"
        );
    }

    // TEST-3: an over-cap result is truncated to the cap + a collect_result pointer
    // is appended (so the injected turn never blows context); the const bounds are
    // sane.
    #[test]
    fn build_resume_message_truncates_over_cap_result() {
        let huge = "x".repeat(RESUME_RESULT_MAX_CHARS + 5_000);
        let msg = build_resume_message("big task", &huge);
        let xs = msg.chars().filter(|&c| c == 'x').count();
        assert_eq!(
            xs, RESUME_RESULT_MAX_CHARS,
            "the injected result body is capped at RESUME_RESULT_MAX_CHARS"
        );
        assert!(
            msg.contains("truncated") && msg.contains("collect_result"),
            "truncation appends a pointer to collect_result: {}",
            &msg[msg.len().saturating_sub(200)..]
        );
    }

    #[test]
    fn resume_const_bounds_are_sane() {
        assert!(RESUME_MAX_IDLE_WAIT > RESUME_POLL_INTERVAL);
        assert!(RESUME_POLL_INTERVAL > Duration::from_millis(0));
        assert!(RESUME_RESULT_MAX_CHARS > 0);
    }

    // TEST-4: the resume gate — only conversation-bound + non-empty result resumes.
    #[test]
    fn should_resume_requires_conversation_and_nonempty_result() {
        let cid = Some(Uuid::new_v4());
        assert!(should_resume(cid, "a real answer"), "bound + non-empty → resume");
        assert!(!should_resume(None, "a real answer"), "no conversation → skip");
        assert!(!should_resume(cid, ""), "empty result → skip");
        assert!(!should_resume(cid, "   \n\t "), "whitespace-only result → skip");
    }
}
