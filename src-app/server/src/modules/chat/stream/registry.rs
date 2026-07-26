//! In-process, per-user registry for the chat-token stream.
//!
//! Like the `sync` registry it is keyed by user (a generation's frames reach
//! only the owning user's connections) — but delivery is further SCOPED to the
//! one conversation each connection is currently subscribed to, and it owns a
//! per-conversation replay buffer for seamless mid-stream join. Single-process
//! today; a multi-instance deployment would fan out via LISTEN/NOTIFY.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use axum::http::StatusCode;
use axum::response::sse::Event;
use lazy_static::lazy_static;
use tokio::sync::mpsc::Sender;
use uuid::Uuid;

use crate::common::AppError;

use super::buffers::GenerationBuffer;
use super::event::ChatStreamFrame;

/// Chat-token SSE connection caps (DEC-34). Formerly two hardcoded consts
/// (`GLOBAL_MAX_CONNECTIONS`/`PER_USER_MAX_CONNECTIONS = 12`); now a Limits struct
/// so the caps are deployment-config-driven (`chat.*` in `Config`) and unit-test
/// injectable. The per-user default is raised (24) because split-chat opens one
/// dedicated SSE connection per open pane.
#[derive(Debug, Clone, Copy)]
pub struct ChatStreamLimits {
    /// Max concurrent connections for a single user (all tabs/devices/panes).
    pub per_user_max_connections: usize,
    /// Max concurrent connections across all users.
    pub global_max_connections: usize,
}

impl Default for ChatStreamLimits {
    fn default() -> Self {
        Self {
            per_user_max_connections: 24,
            global_max_connections: 512,
        }
    }
}

/// Per-connection queue depth. Sized to comfortably hold a full catch-up replay
/// (the byte-capped buffer is well under this many frames) plus live headroom.
/// A reader that falls this far behind is dropped (client reconnects + replays).
pub(crate) const CHAT_STREAM_CHANNEL_CAPACITY: usize = 2048;

type ConnId = Uuid;

/// Grace period added to a connection's own `exp` deadline before a sweep
/// treats it as stale. The stream's `select!` breaks AT the deadline and its
/// guard then unregisters, so any connection still present well past its own
/// deadline is definitionally broken; this slack only avoids racing a normal
/// teardown. Derived from the connection, not a tunable — no arbitrary TTL to
/// configure and no risk of reaping a healthy idle stream.
const DEADLINE_SLACK: std::time::Duration = std::time::Duration::from_secs(60);

/// One live chat-token connection. `active_conversation` is the conversation
/// whose frames this connection currently wants (set via the subscription PUT);
/// `None` means "subscribed to nothing" — receives no frames.
pub struct ChatConn {
    pub user_id: Uuid,
    pub active_conversation: Option<Uuid>,
    pub sender: Sender<Result<Event, axum::Error>>,
    /// When this connection's stream is guaranteed to have ended: the access
    /// token's `exp` deadline, which the subscribe handler already `select!`s
    /// on. `None` = no bound known (the handler's far-future fallback), which
    /// opts the connection out of deadline-based reclamation.
    ///
    /// The liveness backstop for a peer that vanished WITHOUT the socket
    /// erroring — hyper only learns the client is gone when a write fails, so
    /// an idle stream to a black-holed peer could otherwise hold its slot far
    /// longer than its own token was ever valid for.
    pub expires_at: Option<std::time::Instant>,
}

impl ChatConn {
    /// Is this connection past its own `exp` deadline (plus slack)?
    fn is_past_deadline(&self, now: std::time::Instant) -> bool {
        self.expires_at
            .is_some_and(|deadline| now.saturating_duration_since(deadline) > DEADLINE_SLACK)
    }

    /// Is this connection reclaimable — its stream gone (receiver dropped), or
    /// still present long past the deadline at which it should have ended?
    fn is_reclaimable(&self, now: std::time::Instant) -> bool {
        self.sender.is_closed() || self.is_past_deadline(now)
    }
}

struct RegistryInner {
    clients: HashMap<ConnId, ChatConn>,
    by_user: HashMap<Uuid, HashSet<ConnId>>,
    /// In-flight generations keyed by conversation id (one turn per
    /// conversation at a time). Created on `started`, dropped on terminal.
    generations: HashMap<Uuid, GenerationBuffer>,
    /// Connection caps (DEC-34). Defaults applied at construction; overridden at
    /// server boot from deployment config via `set_limits`.
    limits: ChatStreamLimits,
}

pub struct ChatStreamRegistry {
    inner: Mutex<RegistryInner>,
}

lazy_static! {
    static ref REGISTRY: ChatStreamRegistry = ChatStreamRegistry {
        inner: Mutex::new(RegistryInner {
            clients: HashMap::new(),
            by_user: HashMap::new(),
            generations: HashMap::new(),
            limits: ChatStreamLimits::default(),
        }),
    };
}

/// Process-wide singleton registry.
pub fn registry() -> &'static ChatStreamRegistry {
    &REGISTRY
}

impl ChatStreamRegistry {
    /// Register a new connection. 429 on a global or per-user cap.
    ///
    /// A cap is only ever charged for connections that are still ALIVE: before
    /// each cap check the corresponding set is swept of connections whose
    /// stream is gone (`prune_closed_locked`). Without that sweep a user whose
    /// slots leaked would be refused forever — the registry's other reapers
    /// (`publish_frame` / `publish_raw_event` / `set_subscription`) only run
    /// when there is something to deliver, so a quiescent deployment never
    /// reclaims anything. Mirrors `SyncRegistry::register`.
    pub fn register(&self, conn_id: ConnId, conn: ChatConn) -> Result<(), AppError> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());

        // Per-user first: bounded by the configured per-user cap, so the common
        // path stays O(cap) rather than O(global).
        let mut user_count = inner.by_user.get(&conn.user_id).map_or(0, |s| s.len());
        if user_count >= inner.limits.per_user_max_connections {
            prune_closed_for_user_locked(&mut inner, conn.user_id);
            user_count = inner.by_user.get(&conn.user_id).map_or(0, |s| s.len());
        }
        if user_count >= inner.limits.per_user_max_connections {
            return Err(AppError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "CHAT_STREAM_USER_LIMIT",
                "Too many open chat-stream connections for this account",
            ));
        }

        // Global sweep only when the global cap would otherwise trip.
        if inner.clients.len() >= inner.limits.global_max_connections {
            prune_closed_locked(&mut inner);
        }
        if inner.clients.len() >= inner.limits.global_max_connections {
            return Err(AppError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "CHAT_STREAM_GLOBAL_LIMIT",
                "Chat streaming is at capacity; retry shortly",
            ));
        }

        inner.by_user.entry(conn.user_id).or_default().insert(conn_id);
        inner.clients.insert(conn_id, conn);
        Ok(())
    }

    /// Remove a connection (called on stream termination).
    pub fn unregister(&self, conn_id: ConnId) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        remove_conn(&mut inner, conn_id);
    }

    /// Sweep every reclaimable connection, returning how many were freed. Two
    /// independent signals, neither of which can false-positive a healthy
    /// stream: the receiver being dropped (`sender.is_closed()` — the stream is
    /// gone), and the connection outliving its own `exp` deadline (the stream
    /// `select!`s on it and breaks there, so a survivor is definitionally
    /// broken; this is the only signal available for a peer that vanished
    /// without the socket erroring). The per-conversation `generations` replay
    /// buffers are keyed by conversation, not connection, and are deliberately
    /// untouched by a sweep.
    ///
    /// This is the BACKSTOP; the primary, deterministic release is the
    /// subscribe handler's `ConnGuard`, constructed at registration and moved
    /// into the stream so it drops even if the stream is never polled.
    ///
    /// `#[cfg(test)]`: on the production path the sweep runs inside `register`,
    /// which already holds the lock and therefore calls `prune_closed_locked`
    /// directly. This lock-taking wrapper exists only so the unit tests can
    /// drive a sweep in isolation — shipping it as unused public API would be
    /// dead code. (The framework twin IS `pub`: its crate-level integration
    /// test lives in a separate crate and genuinely needs the public entry.)
    #[cfg(test)]
    pub fn prune_closed(&self) -> usize {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        prune_closed_locked(&mut inner)
    }

    /// Sweep only `user_id`'s reclaimable connections (same two signals as
    /// [`Self::prune_closed`]), returning how many were freed. Other users'
    /// connections are never inspected or touched. `#[cfg(test)]` for the same
    /// reason as [`Self::prune_closed`].
    #[cfg(test)]
    pub fn prune_closed_for_user(&self, user_id: Uuid) -> usize {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        prune_closed_for_user_locked(&mut inner, user_id)
    }

    /// Override the connection caps (called once at server boot from deployment
    /// config — DEC-34). Affects only subsequent `register` calls.
    pub fn set_limits(&self, limits: ChatStreamLimits) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.limits = limits;
    }

    /// Claim the single in-flight generation slot for a conversation. Returns
    /// `false` if one is already running — the caller must reject the send
    /// (409) so two concurrent turns can't interleave into one replay buffer
    /// (which carries no message id to demux them). Creates the (empty) buffer.
    ///
    /// The slot is released when the generation emits a terminal frame (or via
    /// `end_generation` on setup failure / `TerminalGuard` on panic). The only
    /// path that leaves it stuck is the runtime dropping the spawned generation
    /// task *before its first poll* (i.e. process shutdown) — in-process
    /// unrecoverable, but the process is exiting, so accepted.
    pub fn begin_generation(&self, conversation_id: Uuid) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.generations.contains_key(&conversation_id) {
            return false;
        }
        inner
            .generations
            .insert(conversation_id, GenerationBuffer::default());
        true
    }

    /// Read-only: is a generation currently in flight for this conversation?
    /// The slot is dropped when the terminal (`complete`/`error`) frame is
    /// published, so this flips false exactly when the turn finishes — the
    /// signal background code (e.g. the scheduler's prompt dispatch) polls to
    /// know a detached turn has completed. Does NOT claim the slot.
    pub fn is_generating(&self, conversation_id: Uuid) -> bool {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.generations.contains_key(&conversation_id)
    }

    /// Release the in-flight slot WITHOUT delivering a terminal frame — used
    /// only when generation setup fails before the streaming loop starts.
    /// (The normal path drops the buffer via the terminal frame in
    /// `publish_frame`.)
    pub fn end_generation(&self, conversation_id: Uuid) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.generations.remove(&conversation_id);
    }

    /// Point a connection at a conversation (or `None` to receive nothing).
    /// Atomically replays that conversation's in-flight reply-so-far to this
    /// connection — the catch-up. Holding the single registry lock means no
    /// live `publish_frame` can interleave between the snapshot and the
    /// connection becoming eligible, so there is no gap and no duplicate.
    pub fn set_subscription(&self, conn_id: ConnId, conversation_id: Option<Uuid>) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());

        let Some(conn) = inner.clients.get_mut(&conn_id) else {
            return;
        };
        conn.active_conversation = conversation_id;

        // Catch-up: replay the in-flight frames for the newly-subscribed
        // conversation, if any generation is active.
        let replay = match conversation_id {
            Some(cid) => inner
                .generations
                .get(&cid)
                .map(|b| b.replay())
                .unwrap_or_default(),
            None => Vec::new(),
        };
        if replay.is_empty() {
            return;
        }
        let mut dead = false;
        if let Some(conn) = inner.clients.get(&conn_id) {
            for frame in &replay {
                if conn.sender.try_send(Ok(frame.to_sse())).is_err() {
                    dead = true;
                    break;
                }
            }
        }
        if dead {
            remove_conn(&mut inner, conn_id);
        }
    }

    /// Append a generation frame to its conversation's replay buffer and deliver
    /// it to the owner's connections currently subscribed to that conversation.
    /// On a terminal frame (`complete`/`error`) the buffer is dropped after
    /// delivery. A connection whose bounded queue is full/closed is pruned.
    pub fn publish_frame(&self, owner_id: Uuid, frame: ChatStreamFrame) {
        let conversation_id = frame.conversation_id;
        let terminal = frame.is_terminal();
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());

        // Buffer (non-terminal frames only; terminal drops the buffer below).
        if !terminal {
            inner
                .generations
                .entry(conversation_id)
                .or_default()
                .push(frame.clone());
        }

        // Deliver to the owner's connections subscribed to this conversation.
        let sse = frame.to_sse();
        let mut dead: Vec<ConnId> = Vec::new();
        if let Some(set) = inner.by_user.get(&owner_id) {
            for cid in set {
                if let Some(conn) = inner.clients.get(cid) {
                    if conn.active_conversation == Some(conversation_id)
                        && conn.sender.try_send(Ok(sse.clone())).is_err()
                    {
                        dead.push(*cid);
                    }
                }
            }
        }

        if terminal {
            inner.generations.remove(&conversation_id);
        }
        for cid in dead {
            remove_conn(&mut inner, cid);
        }
    }

    /// Deliver a pre-built extension SSE `Event` (titleUpdated / MCP tool
    /// lifecycle, approval, elicitation, artifact) to the owner's connections
    /// subscribed to `conversation_id`. Unlike `publish_frame` these are NOT
    /// enveloped or buffered for replay — they're raw events; the client routes
    /// them to whatever conversation the connection is currently subscribed to.
    pub fn publish_raw_event(&self, owner_id: Uuid, conversation_id: Uuid, event: Event) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut dead: Vec<ConnId> = Vec::new();
        if let Some(set) = inner.by_user.get(&owner_id) {
            for cid in set {
                if let Some(conn) = inner.clients.get(cid) {
                    if conn.active_conversation == Some(conversation_id)
                        && conn.sender.try_send(Ok(event.clone())).is_err()
                    {
                        dead.push(*cid);
                    }
                }
            }
        }
        for cid in dead {
            remove_conn(&mut inner, cid);
        }
    }

}

/// Publish one generation frame to the owner's subscribed connections (and the
/// conversation's replay buffer). Called by the detached generation task for
/// every chunk + the terminal frame. There is no origin-suppression: the sender
/// no longer gets tokens from its send response, so it consumes its own
/// generation over this stream like every other subscribed device.
pub fn publish_frame(owner_id: Uuid, frame: ChatStreamFrame) {
    registry().publish_frame(owner_id, frame);
}

/// Claim the single in-flight generation slot for a conversation (see
/// [`ChatStreamRegistry::begin_generation`]).
pub fn begin_generation(conversation_id: Uuid) -> bool {
    registry().begin_generation(conversation_id)
}

/// Read-only: is a generation in flight for this conversation? (see
/// [`ChatStreamRegistry::is_generating`]). Flips false when the turn finishes.
pub fn is_generating(conversation_id: Uuid) -> bool {
    registry().is_generating(conversation_id)
}

/// Deliver a raw extension SSE event to subscribers of a conversation (see
/// [`ChatStreamRegistry::publish_raw_event`]).
pub fn publish_raw_event(owner_id: Uuid, conversation_id: Uuid, event: Event) {
    registry().publish_raw_event(owner_id, conversation_id, event);
}

/// Release a generation slot reserved by [`begin_generation`] without a
/// terminal frame (setup-failure path only).
pub fn end_generation(conversation_id: Uuid) {
    registry().end_generation(conversation_id);
}

/// Apply the deployment-config chat-stream connection caps to the process-wide
/// registry. Call once at server boot (before serving) — DEC-34.
pub fn apply_config_limits(chat: &crate::core::config::ChatConfig) {
    registry().set_limits(ChatStreamLimits {
        per_user_max_connections: chat.per_user_max_connections,
        global_max_connections: chat.global_max_connections,
    });
}

/// Remove a connection from both indexes (shared by unregister + pruning).
/// Sweep every reclaimable connection. Caller holds the lock.
/// Collect-then-remove (mirroring `publish_frame`'s dead-connection handling)
/// so the two-index invariant is maintained by the single `remove_conn` helper.
fn prune_closed_locked(inner: &mut RegistryInner) -> usize {
    let now = std::time::Instant::now();
    let dead: Vec<ConnId> = inner
        .clients
        .iter()
        .filter(|(_, c)| c.is_reclaimable(now))
        .map(|(id, _)| *id)
        .collect();
    let n = dead.len();
    for cid in dead {
        remove_conn(inner, cid);
    }
    if n > 0 {
        tracing::debug!("chat-stream registry: reclaimed {n} dead/expired connection(s)");
    }
    n
}

/// Sweep only `user_id`'s reclaimable connections. Caller holds the lock.
fn prune_closed_for_user_locked(inner: &mut RegistryInner, user_id: Uuid) -> usize {
    let Some(set) = inner.by_user.get(&user_id) else {
        return 0;
    };
    let now = std::time::Instant::now();
    let dead: Vec<ConnId> = set
        .iter()
        .filter(|cid| inner.clients.get(*cid).is_some_and(|c| c.is_reclaimable(now)))
        .copied()
        .collect();
    let n = dead.len();
    for cid in dead {
        remove_conn(inner, cid);
    }
    if n > 0 {
        tracing::debug!("chat-stream registry: reclaimed {n} dead/expired connection(s) for one user");
    }
    n
}

fn remove_conn(inner: &mut RegistryInner, conn_id: ConnId) {
    if let Some(conn) = inner.clients.remove(&conn_id) {
        if let Some(set) = inner.by_user.get_mut(&conn.user_id) {
            set.remove(&conn_id);
            if set.is_empty() {
                inner.by_user.remove(&conn.user_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::chat::core::types::streaming::{
        ChatStreamChunk, ContentBlockDelta, SSEChatStreamCompleteData, SSEChatStreamEvent,
        SSEChatStreamStartedData,
    };
    use tokio::sync::mpsc::Receiver;

    type Rx = Receiver<Result<Event, axum::Error>>;

    fn empty_registry() -> ChatStreamRegistry {
        ChatStreamRegistry {
            inner: Mutex::new(RegistryInner {
                clients: HashMap::new(),
                by_user: HashMap::new(),
                generations: HashMap::new(),
                limits: ChatStreamLimits::default(),
            }),
        }
    }

    /// A connection for `user_id` subscribed to `active` (None = nothing).
    /// No `exp` deadline, so only the receiver-dropped signal can reclaim it.
    fn conn(user_id: Uuid, active: Option<Uuid>) -> (ChatConn, Rx) {
        conn_expiring(user_id, active, None)
    }

    /// A connection whose stream was bound to end at `expires_at` — used to
    /// exercise the deadline staleness backstop.
    fn conn_expiring(
        user_id: Uuid,
        active: Option<Uuid>,
        expires_at: Option<std::time::Instant>,
    ) -> (ChatConn, Rx) {
        let (tx, rx) = tokio::sync::mpsc::channel(CHAT_STREAM_CHANNEL_CAPACITY);
        (
            ChatConn {
                user_id,
                active_conversation: active,
                sender: tx,
                expires_at,
            },
            rx,
        )
    }

    fn started(conv: Uuid) -> ChatStreamFrame {
        ChatStreamFrame::new(
            conv,
            SSEChatStreamEvent::Started(SSEChatStreamStartedData {
                user_message_id: None,
                conversation_id: conv,
                branch_id: Uuid::new_v4(),
            }),
        )
    }

    fn content(conv: Uuid, text: &str) -> ChatStreamFrame {
        ChatStreamFrame::new(
            conv,
            SSEChatStreamEvent::Content(ChatStreamChunk {
                content: vec![ContentBlockDelta::TextDelta {
                    index: 0,
                    delta: text.to_string(),
                }],
                ..Default::default()
            }),
        )
    }

    fn complete(conv: Uuid) -> ChatStreamFrame {
        ChatStreamFrame::new(
            conv,
            SSEChatStreamEvent::Complete(SSEChatStreamCompleteData {
                finish_reason: "stop".into(),
                usage: None,
            }),
        )
    }

    /// Drain a receiver, counting delivered frames.
    fn drain(rx: &mut Rx) -> usize {
        let mut n = 0;
        while rx.try_recv().is_ok() {
            n += 1;
        }
        n
    }

    #[test]
    fn delivery_is_scoped_to_the_subscribed_conversation_and_user() {
        let reg = empty_registry();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let conv_x = Uuid::new_v4();
        let conv_y = Uuid::new_v4();

        // A subscribed to X; A subscribed to Y; A subscribed to nothing; B subscribed to X.
        let (ax, mut rx_ax) = conn(a, Some(conv_x));
        let (ay, mut rx_ay) = conn(a, Some(conv_y));
        let (anone, mut rx_anone) = conn(a, None);
        let (bx, mut rx_bx) = conn(b, Some(conv_x));
        reg.register(Uuid::new_v4(), ax).unwrap();
        reg.register(Uuid::new_v4(), ay).unwrap();
        reg.register(Uuid::new_v4(), anone).unwrap();
        reg.register(Uuid::new_v4(), bx).unwrap();

        // A turn in X, owned by A.
        reg.publish_frame(a, started(conv_x));
        reg.publish_frame(a, content(conv_x, "hi"));

        assert_eq!(drain(&mut rx_ax), 2, "A's conn subscribed to X receives X's frames");
        assert_eq!(drain(&mut rx_ay), 0, "A's conn on a different conversation gets nothing");
        assert_eq!(drain(&mut rx_anone), 0, "A's unsubscribed conn gets nothing");
        assert_eq!(drain(&mut rx_bx), 0, "user B never receives user A's frames");
    }

    #[test]
    fn subscribing_mid_generation_replays_the_reply_so_far() {
        let reg = empty_registry();
        let a = Uuid::new_v4();
        let conv = Uuid::new_v4();

        // A generation is already in flight (no subscriber yet).
        reg.publish_frame(a, started(conv));
        reg.publish_frame(a, content(conv, "Hel"));
        reg.publish_frame(a, content(conv, "lo"));

        // A device opens the conversation mid-stream.
        let (c, mut rx) = conn(a, None);
        let cid = Uuid::new_v4();
        reg.register(cid, c).unwrap();
        reg.set_subscription(cid, Some(conv));

        // Catch-up replays started + both content frames.
        assert_eq!(drain(&mut rx), 3, "catch-up replays the buffered reply-so-far");

        // A subsequent live frame continues with no gap/dup.
        reg.publish_frame(a, content(conv, "!"));
        assert_eq!(drain(&mut rx), 1, "live frames continue after the catch-up");
    }

    #[test]
    fn terminal_frame_drops_the_buffer_so_a_later_joiner_gets_no_replay() {
        let reg = empty_registry();
        let a = Uuid::new_v4();
        let conv = Uuid::new_v4();

        reg.publish_frame(a, started(conv));
        reg.publish_frame(a, content(conv, "done"));
        reg.publish_frame(a, complete(conv));

        let (c, mut rx) = conn(a, None);
        let cid = Uuid::new_v4();
        reg.register(cid, c).unwrap();
        reg.set_subscription(cid, Some(conv));

        assert_eq!(
            drain(&mut rx),
            0,
            "after complete the buffer is gone; the finished message comes from the DB"
        );
    }

    #[test]
    fn unsubscribe_with_null_stops_delivery() {
        let reg = empty_registry();
        let a = Uuid::new_v4();
        let conv = Uuid::new_v4();
        let (c, mut rx) = conn(a, Some(conv));
        let cid = Uuid::new_v4();
        reg.register(cid, c).unwrap();

        reg.set_subscription(cid, None);
        reg.publish_frame(a, started(conv));
        assert_eq!(drain(&mut rx), 0, "a conn unsubscribed (null) receives nothing");
    }

    #[test]
    fn per_user_cap_rejects_excess_connections() {
        let reg = empty_registry();
        let cap = ChatStreamLimits::default().per_user_max_connections;
        let uid = Uuid::new_v4();
        // The receivers must be HELD: a cap is charged for live connections
        // only, so a per-iteration `_rx` binding (dropped at the end of each
        // iteration) would register connections whose streams are already gone
        // and `register`'s sweep would rightly reclaim them.
        let mut alive = Vec::new();
        for _ in 0..cap {
            let (c, rx) = conn(uid, None);
            reg.register(Uuid::new_v4(), c).unwrap();
            alive.push(rx);
        }
        let (overflow, _rx) = conn(uid, None);
        assert!(
            reg.register(Uuid::new_v4(), overflow).is_err(),
            "the (cap+1)th connection for one user must be refused (429)"
        );
        drop(alive);
    }

    /// TEST-36: the per-user cap reads the CONFIGURED value (via `set_limits`),
    /// not the legacy hardcoded 12, and the (cap+1)th connection 429s at the
    /// configured bound (DEC-34 / ITEM-20).
    #[test]
    fn per_user_cap_honors_the_configured_limit() {
        let reg = empty_registry();
        // A configured cap distinct from both the legacy 12 and the new default 24.
        reg.set_limits(ChatStreamLimits {
            per_user_max_connections: 3,
            global_max_connections: 512,
        });
        let uid = Uuid::new_v4();
        // Receivers HELD — see `per_user_cap_rejects_excess_connections`.
        let mut alive = Vec::new();
        for _ in 0..3 {
            let (c, rx) = conn(uid, None);
            reg.register(Uuid::new_v4(), c).unwrap();
            alive.push(rx);
        }
        let (overflow, _rx) = conn(uid, None);
        assert!(
            reg.register(Uuid::new_v4(), overflow).is_err(),
            "the 4th connection must 429 at the CONFIGURED cap of 3"
        );
        drop(alive);
    }

    // ---- slot reclamation (sse-slot-leak) --------------------------------
    //
    // The chat-token registry's only pre-existing reapers (`publish_frame` /
    // `publish_raw_event` / `set_subscription`) require something to deliver, so
    // on a quiescent deployment a connection whose stream was gone held its slot
    // forever and every reconnect burned another until the account was
    // permanently 429'd on `GET /api/chat/stream`.

    /// TEST-5 — a connection whose receiver has been dropped is reclaimed from
    /// BOTH indexes, a live one survives, and the per-conversation replay
    /// buffers (keyed by conversation, not connection) are left alone.
    #[test]
    fn prune_closed_reclaims_dead_connections_and_leaves_live_ones_and_buffers() {
        let reg = empty_registry();
        let uid = Uuid::new_v4();
        let conv = Uuid::new_v4();

        let (dead_conn, dead_rx) = conn(uid, Some(conv));
        let (live_conn, mut live_rx) = conn(uid, Some(conv));
        reg.register(Uuid::new_v4(), dead_conn).unwrap();
        reg.register(Uuid::new_v4(), live_conn).unwrap();

        // An in-flight generation with a buffered frame.
        assert!(reg.begin_generation(conv));
        reg.publish_frame(uid, started(conv));
        let _ = drain(&mut live_rx);

        drop(dead_rx); // that stream went away

        assert_eq!(reg.prune_closed(), 1, "only the dead connection is reclaimed");
        assert_eq!(
            reg.inner.lock().unwrap().clients.len(),
            1,
            "the live connection survives the sweep"
        );
        assert!(
            reg.is_generating(conv),
            "a sweep must NOT disturb the per-conversation replay buffers"
        );

        // The survivor is still functional, not merely still counted.
        reg.publish_frame(uid, started(conv));
        assert!(drain(&mut live_rx) > 0, "the survivor still receives frames");
    }

    /// TEST-12 [acceptance INV-3] — the chat cap is charged for LIVE
    /// connections only, at the CONFIGURED limit (not a hardcoded number).
    /// Both halves in ONE test: raising/removing the cap fails the first, and
    /// removing the sweep fails the second.
    #[test]
    fn per_user_cap_counts_live_connections_only_at_the_configured_limit() {
        let reg = empty_registry();
        // A configured cap distinct from both the legacy 12 and the default 24,
        // so the test proves the CONFIGURED value is what is enforced.
        let cap = 3usize;
        reg.set_limits(ChatStreamLimits {
            per_user_max_connections: cap,
            global_max_connections: 512,
        });
        let uid = Uuid::new_v4();

        // (a) cap value unchanged: with every receiver ALIVE the (cap+1)th
        //     registration is still refused with 429.
        let mut alive = Vec::new();
        for _ in 0..cap {
            let (c, rx) = conn(uid, None);
            reg.register(Uuid::new_v4(), c).unwrap();
            alive.push(rx);
        }
        let (overflow, _rx) = conn(uid, None);
        let err = reg
            .register(Uuid::new_v4(), overflow)
            .expect_err("the configured cap must still refuse a (cap+1)th LIVE connection");
        assert_eq!(err.status_code(), 429, "the per-user cap still surfaces 429");

        // (b) the user's streams all go away → the next registration succeeds
        //     and the registry holds exactly the one new connection.
        drop(alive);
        let (fresh, _rx) = conn(uid, None);
        reg.register(Uuid::new_v4(), fresh)
            .expect("a user whose chat streams are gone must be able to reconnect");
        assert_eq!(
            reg.inner.lock().unwrap().clients.len(),
            1,
            "all {cap} dead slots must be reclaimed, leaving only the new connection",
        );
    }

    /// A user-scoped sweep touches ONLY that user.
    #[test]
    fn prune_closed_for_user_is_scoped_to_that_user() {
        let reg = empty_registry();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let (a_dead, a_rx) = conn(a, None);
        let (b_dead, b_rx) = conn(b, None);
        reg.register(Uuid::new_v4(), a_dead).unwrap();
        reg.register(Uuid::new_v4(), b_dead).unwrap();
        drop(a_rx);
        drop(b_rx);

        assert_eq!(reg.prune_closed_for_user(a), 1, "only A's is reclaimed");
        assert_eq!(
            reg.inner.lock().unwrap().clients.len(),
            1,
            "B's dead connection survives an A-scoped sweep"
        );
        assert_eq!(reg.prune_closed(), 1, "a global sweep then reclaims B's");
    }

    /// TEST-14 — the deadline backstop: a connection whose stream is STILL
    /// ALIVE (its receiver held open — the peer vanished without the socket
    /// ever erroring, so hyper never noticed) is nevertheless reclaimed once it
    /// is past the `exp` deadline its own stream was bound to. A live
    /// connection whose deadline is in the FUTURE, and one with no deadline at
    /// all, are both left alone.
    #[test]
    fn prune_reclaims_a_connection_past_its_own_exp_deadline_even_if_alive() {
        let reg = empty_registry();
        let uid = Uuid::new_v4();
        let now = std::time::Instant::now();

        // Past its deadline by more than the slack — the stream should have
        // torn itself down long ago, so it is definitionally broken.
        let (expired, _expired_rx) = conn_expiring(
            uid,
            None,
            Some(now - DEADLINE_SLACK - std::time::Duration::from_secs(30)),
        );
        // Deadline still in the future — a perfectly healthy long-lived stream.
        let (future, _future_rx) = conn_expiring(
            uid,
            None,
            Some(now + std::time::Duration::from_secs(3600)),
        );
        // No deadline known — opted out of deadline reclamation entirely.
        let (unbounded, _unbounded_rx) = conn(uid, None);
        reg.register(Uuid::new_v4(), expired).unwrap();
        reg.register(Uuid::new_v4(), future).unwrap();
        reg.register(Uuid::new_v4(), unbounded).unwrap();
        assert_eq!(reg.inner.lock().unwrap().clients.len(), 3);

        // Every receiver is still held, so `sender.is_closed()` is false for
        // all three: ONLY the deadline signal can distinguish them.
        assert_eq!(
            reg.prune_closed(),
            1,
            "only the past-deadline connection is reclaimed"
        );
        assert_eq!(
            reg.inner.lock().unwrap().clients.len(),
            2,
            "the future-deadline and no-deadline connections both survive"
        );
    }

    /// A connection barely past its deadline (inside the slack window) is NOT
    /// reclaimed — the slack exists so a normal teardown is never raced.
    #[test]
    fn prune_respects_the_deadline_slack_window() {
        let reg = empty_registry();
        let uid = Uuid::new_v4();
        let just_lapsed = std::time::Instant::now() - std::time::Duration::from_secs(1);
        let (c, _rx) = conn_expiring(uid, None, Some(just_lapsed));
        reg.register(Uuid::new_v4(), c).unwrap();

        assert_eq!(
            reg.prune_closed(),
            0,
            "a connection whose deadline just lapsed is still inside the slack window"
        );
        assert_eq!(reg.inner.lock().unwrap().clients.len(), 1);
    }

    /// A sweep NEVER reclaims a live connection.
    #[test]
    fn prune_closed_never_removes_a_live_connection() {
        let reg = empty_registry();
        let uid = Uuid::new_v4();
        let conv = Uuid::new_v4();
        let (c, mut rx) = conn(uid, Some(conv));
        reg.register(Uuid::new_v4(), c).unwrap();

        assert_eq!(reg.prune_closed(), 0, "a live connection is never reclaimed");
        assert_eq!(reg.prune_closed_for_user(uid), 0);
        assert_eq!(reg.inner.lock().unwrap().clients.len(), 1);

        reg.publish_frame(uid, started(conv));
        assert!(drain(&mut rx) > 0, "the survivor still receives frames");
    }

    /// The default per-user cap was raised above the legacy 12 (DEC-34) so
    /// one-SSE-connection-per-pane doesn't 429 a legitimate pane under churn.
    #[test]
    fn default_per_user_cap_is_raised_above_legacy_twelve() {
        assert!(
            ChatStreamLimits::default().per_user_max_connections > 12,
            "the default per-user cap must exceed the legacy 12"
        );
    }

    #[test]
    fn begin_generation_is_exclusive_per_conversation() {
        let reg = empty_registry();
        let conv = Uuid::new_v4();
        assert!(reg.begin_generation(conv), "first claim succeeds");
        assert!(
            !reg.begin_generation(conv),
            "a second concurrent generation for the same conversation is refused"
        );
        // A terminal frame drops the buffer (releases the slot)…
        reg.publish_frame(Uuid::new_v4(), complete(conv));
        assert!(
            reg.begin_generation(conv),
            "after the turn terminates, a new generation can begin"
        );
        // …and end_generation releases it without a terminal frame.
        reg.end_generation(conv);
        assert!(reg.begin_generation(conv));
    }

    #[test]
    fn raw_extension_events_are_scoped_and_not_buffered() {
        let reg = empty_registry();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let conv = Uuid::new_v4();

        let (ax, mut rx_ax) = conn(a, Some(conv));
        let (anone, mut rx_anone) = conn(a, None);
        let (bx, mut rx_bx) = conn(b, Some(conv));
        reg.register(Uuid::new_v4(), ax).unwrap();
        reg.register(Uuid::new_v4(), anone).unwrap();
        reg.register(Uuid::new_v4(), bx).unwrap();

        let raw = Event::default().event("titleUpdated").data("{}");
        reg.publish_raw_event(a, conv, raw);

        assert_eq!(drain(&mut rx_ax), 1, "A's conn subscribed to the conversation receives it");
        assert_eq!(drain(&mut rx_anone), 0, "A's unsubscribed conn does not");
        assert_eq!(drain(&mut rx_bx), 0, "a different user never receives it");

        // Raw events are NOT buffered: a connection that subscribes AFTER the
        // event gets no replay (only the chunk-derived frames are buffered).
        let (late, mut rx_late) = conn(a, None);
        let late_id = Uuid::new_v4();
        reg.register(late_id, late).unwrap();
        reg.set_subscription(late_id, Some(conv));
        assert_eq!(drain(&mut rx_late), 0, "a late joiner gets no raw-event replay");
    }
}
