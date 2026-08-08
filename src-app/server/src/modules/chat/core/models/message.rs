// Chat model infrastructure

// Message DB entities

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Message role in conversation
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
}

impl MessageRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::System => "system",
        }
    }
}

impl std::fmt::Display for MessageRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for MessageRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "user" => Ok(Self::User),
            "assistant" => Ok(Self::Assistant),
            "system" => Ok(Self::System),
            _ => Err(format!("Invalid message role: {}", s)),
        }
    }
}

/// Why an assistant turn ended with NO user-visible answer (ITEM-2 / DEC-2).
///
/// A closed, server-written vocabulary persisted on `messages.completion_state`
/// and echoed on the terminal stream frame. `None` (SQL NULL) is the healthy
/// case — the overwhelming majority of turns — so the classification exists
/// ONLY for a turn that produced no text, no tool call and no attachment.
///
/// This is deliberately NOT the provider's finish reason: the provider
/// vocabulary lives in `ai_providers::FinishReason` and travels intact
/// alongside this field (INV-2). Classifying server-side keeps per-provider
/// spellings out of the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CompletionState {
    /// The provider ended on a length/budget exhaustion (OpenAI `length`,
    /// Anthropic `max_tokens`, Gemini `MAX_TOKENS`) AND the turn produced no
    /// user-visible answer — characteristically a reasoning model that spent
    /// its whole completion budget on hidden reasoning. An identical retry
    /// re-truncates deterministically.
    BudgetTruncated,
    /// The stream was CANCELLED / abandoned before the turn produced a
    /// user-visible answer (the consumer navigated away, or hit stop). Measured
    /// on the live rig this is ~47% of the notices: 315 of the 320 zero-block
    /// answerless messages are the LAST message in their branch. The frontend
    /// already suppresses the notice LIVE via a transient `lastTurnInterrupted`
    /// flag, but that flag resets on reload — which is exactly why the fact has
    /// to be persisted here.
    Aborted,
    /// The turn ended in an ERROR before producing a user-visible answer: the
    /// provider stream failed mid-generation, or persisting/processing a chunk
    /// failed. Distinct from `Empty` because an errored turn is not a model that
    /// "had nothing to say" — asserting that would be a confident wrong
    /// diagnosis on a path where the model may well have been about to answer.
    Failed,
    /// The provider terminated the turn on its CONTENT POLICY — a safety filter
    /// (`content_filter`, Gemini `SAFETY`/`RECITATION`/`PROHIBITED_CONTENT`/
    /// `BLOCKLIST`) or an explicit model `refusal` — before any user-visible
    /// answer. Answerless by construction, and an identical retry reproduces it
    /// deterministically, so (like `BudgetTruncated`) it must never carry bare
    /// retry advice (INV-3).
    ContentFiltered,
    /// The turn terminated normally AND produced no user-visible answer — the
    /// model genuinely had nothing to say.
    Empty,
}

impl CompletionState {
    /// The persisted / wire string.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BudgetTruncated => "budget_truncated",
            Self::Aborted => "aborted",
            Self::Failed => "failed",
            Self::ContentFiltered => "content_filtered",
            Self::Empty => "empty",
        }
    }

    /// Parse a value read back from the database.
    ///
    /// Returns `None` for an unrecognized string rather than erroring or
    /// panicking (CODING_GUIDELINES §4: never `unwrap()` on a DB enum string) —
    /// an older reader meeting a widened vocabulary degrades to "no recorded
    /// state", which renders the generic notice.
    pub fn from_db_str(s: &str) -> Option<Self> {
        match s {
            "budget_truncated" => Some(Self::BudgetTruncated),
            "aborted" => Some(Self::Aborted),
            "failed" => Some(Self::Failed),
            "content_filtered" => Some(Self::ContentFiltered),
            "empty" => Some(Self::Empty),
            other => {
                tracing::warn!(
                    value = %other,
                    "unrecognized messages.completion_state value; treating as unset"
                );
                None
            }
        }
    }
}

impl std::fmt::Display for CompletionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for CompletionState {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "budget_truncated" => Ok(Self::BudgetTruncated),
            "aborted" => Ok(Self::Aborted),
            "failed" => Ok(Self::Failed),
            "content_filtered" => Ok(Self::ContentFiltered),
            "empty" => Ok(Self::Empty),
            _ => Err(format!("Invalid completion state: {}", s)),
        }
    }
}

/// Message entity - Represents a single message in a conversation
/// Messages belong to branches via the branch_messages junction table
#[derive(Debug, Clone, FromRow, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Message {
    pub id: Uuid,
    pub role: String,
    pub originated_from_id: Uuid, // Original message ID in edit lineage
    pub edit_count: i32,          // Number of edits in this lineage
    pub model_id: Option<Uuid>,   // Model used when this message was sent
    /// Why this assistant turn ended with no user-visible answer, or `None` for
    /// a healthy turn (see [`CompletionState`]). Stored as the raw column text
    /// — mirroring how `role` is carried as a `String` with a parsing accessor
    /// ([`Message::completion_state_enum`]) — so an unrecognized value degrades
    /// instead of failing the whole row's decode.
    pub completion_state: Option<String>,
    // Per-message ASSISTANT and MCP-server attribution moved off
    // `messages` into module-owned join tables:
    //   * `message_assistant`     (migration 75) — assistant bridge.
    //     GET /api/messages/{id}/assistant
    //   * `message_mcp_servers`   (migration 74) — mcp bridge.
    //     GET /api/messages/{id}/mcp-servers
    pub created_at: DateTime<Utc>,
}

impl Message {
    /// Get the role as an enum
    pub fn role_enum(&self) -> Result<MessageRole, String> {
        self.role.parse()
    }

    /// The recorded answerless-completion cause, or `None` for a healthy turn.
    ///
    /// An unrecognized stored value degrades to `None` (never panics, never
    /// errors) — see [`CompletionState::from_db_str`].
    pub fn completion_state_enum(&self) -> Option<CompletionState> {
        self.completion_state
            .as_deref()
            .and_then(CompletionState::from_db_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The persisted vocabulary is a CLOSED set and must round-trip; an
    // UNRECOGNIZED stored value must degrade to `None` rather than panic
    // (CODING_GUIDELINES §4).
    #[test]
    fn completion_state_round_trips_and_degrades_on_unknown() {
        for state in [
            CompletionState::BudgetTruncated,
            CompletionState::Aborted,
            CompletionState::Failed,
            CompletionState::ContentFiltered,
            CompletionState::Empty,
        ] {
            assert_eq!(CompletionState::from_db_str(state.as_str()), Some(state));
            assert_eq!(state.as_str().parse::<CompletionState>(), Ok(state));
        }
        assert_eq!(CompletionState::from_db_str("who_knows"), None);
        assert_eq!(CompletionState::from_db_str(""), None);
        assert!("who_knows".parse::<CompletionState>().is_err());
    }
}
