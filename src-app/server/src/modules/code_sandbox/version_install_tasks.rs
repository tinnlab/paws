//! In-memory task registry + SSE broadcast for rootfs version
//! installs (Plan 5 Phase 2c — SSE port).
//!
//! Mirrors the `llm_model::handlers::downloads` + `hardware`
//! monitoring patterns:
//!   - `POST /code-sandbox/rootfs/versions/install` spawns the
//!     install in a background tokio task, returns a task_id
//!     immediately (HTTP 202).
//!   - `GET  /code-sandbox/rootfs/versions/install/subscribe` opens an
//!     SSE stream emitting typed `SSEInstallTaskEvent`s for every
//!     active task. The aide-generated TypeScript client gets the
//!     enum + payload types for free.
//!
//! The admin UI subscribes once on mount; each `Install` button click
//! arrives via the POST endpoint and the UI watches its task_id
//! through the already-open SSE stream.

use axum::response::sse::Event;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use schemars::JsonSchema;
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::modules::code_sandbox::version_manager::{self, InstallProgress};

type ClientId = Uuid;
type ClientSender = UnboundedSender<Result<Event, axum::Error>>;

/// Connected SSE clients, keyed by client_id. Each entry receives
/// every install-task event. Cleanup happens on `send` failure
/// (client dropped).
pub static SSE_CLIENTS: Lazy<Mutex<HashMap<ClientId, ClientSender>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Active + recently-completed install tasks, keyed by task_id. The
/// spawned install task cleans up its own cell `TASK_RETENTION` after
/// the terminal event so reconnects can replay recent outcomes
/// without the map growing unbounded.
pub static INSTALL_TASKS: Lazy<DashMap<Uuid, Arc<Mutex<InstallTaskState>>>> =
    Lazy::new(DashMap::new);

const TASK_RETENTION: Duration = Duration::from_secs(5 * 60);

/// Audit Net1: cap concurrent SSE subscribers to bound memory + per-
/// broadcast send work. Each connected client costs one
/// `UnboundedSender` slot in `SSE_CLIENTS` plus a per-event clone of
/// every event. A malicious or buggy client that reconnects in a tight
/// loop without cleaning up could otherwise exhaust the map. 256 is
/// comfortably above the operator's UI tab + curl-debugging needs.
pub const MAX_SSE_CLIENTS: usize = 256;

// =====================================================================
// Typed SSE event payloads
// =====================================================================

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct SSEInstallConnectedData {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct SSEInstallProgressData {
    pub task_id: Uuid,
    pub phase: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct SSEInstallCompleteData {
    pub task_id: Uuid,
    pub artifact_id: Uuid,
    pub bytes_downloaded: u64,
    pub duration_ms: u64,
    pub cosign_verified: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct SSEInstallFailedData {
    pub task_id: Uuid,
    pub error: String,
}

// `TaskState` variant is replayed on subscribe for every
// currently-known task so a fresh client sees in-flight +
// recently-finished state without waiting for the next tick.
crate::sse_event_enum! {
    #[derive(Debug, Clone, Serialize, JsonSchema)]
    pub enum SSEInstallTaskEvent {
        Connected(SSEInstallConnectedData),
        TaskStarted(InstallTaskState),
        Progress(SSEInstallProgressData),
        Complete(SSEInstallCompleteData),
        Failed(SSEInstallFailedData),
        TaskState(InstallTaskState),
    }
}

// =====================================================================
// Task state
// =====================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct InstallTaskState {
    pub task_id: Uuid,
    pub version: String,
    pub arch: String,
    pub flavor: String,
    pub package: String,
    pub status: TaskStatus,
    pub phase: Option<String>,
    pub message: Option<String>,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub artifact_id: Option<Uuid>,
    pub bytes_downloaded: Option<u64>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
}

impl InstallTaskState {
    fn new(version: &str, arch: &str, flavor: &str, package: &str) -> Self {
        Self {
            task_id: Uuid::new_v4(),
            version: version.to_string(),
            arch: arch.to_string(),
            flavor: flavor.to_string(),
            package: package.to_string(),
            status: TaskStatus::Running,
            phase: None,
            message: None,
            started_at: Utc::now(),
            completed_at: None,
            artifact_id: None,
            bytes_downloaded: None,
            duration_ms: None,
            error: None,
        }
    }
}

// =====================================================================
// Registry queries
// =====================================================================

pub fn list_tasks() -> Vec<InstallTaskState> {
    INSTALL_TASKS
        .iter()
        .filter_map(|e| e.value().lock().ok().map(|g| g.clone()))
        .collect()
}

// get_task removed — dead code; use list_tasks + filter instead.

// =====================================================================
// SSE client lifecycle
// =====================================================================

/// Drop every client whose stream is gone, returning how many were freed.
///
/// The liveness signal is `is_closed()`: a client's `Receiver` is owned solely
/// by its own SSE stream, so a closed sender means exactly "that stream no
/// longer exists". An idle-but-live stream is never touched.
///
/// Caller already holds the lock.
fn prune_closed_locked(g: &mut HashMap<ClientId, ClientSender>) -> usize {
    let before = g.len();
    g.retain(|_, tx| !tx.is_closed());
    before - g.len()
}

/// Cap-check + insert against an already-locked map. Split out from
/// `register_client` so the cap/sweep interaction is unit-testable without the
/// process-wide singleton, which sibling tests share concurrently.
fn register_into(
    g: &mut HashMap<ClientId, ClientSender>,
    tx: ClientSender,
    cap: usize,
) -> Option<ClientId> {
    // Audit Net1: refuse new subscribers once cap is hit so a
    // reconnect storm can't blow up server memory.
    //
    // A cap is only ever charged for clients that are still ALIVE. `broadcast`
    // reclaims dead senders, but it only runs when a task has something to
    // emit — on a deployment where no install ever runs (code_sandbox
    // disabled, the common case) it never fires, so without this sweep a
    // single leaked slot could never be reclaimed and the endpoint would 503
    // for the life of the process. The primary release is the subscribe
    // handler's `ConnGuard`; this is the backstop.
    if g.len() >= cap {
        prune_closed_locked(g);
    }
    if g.len() >= cap {
        tracing::warn!(
            current = g.len(),
            cap = cap,
            "code_sandbox: SSE subscribe rejected — connection cap reached"
        );
        return None;
    }
    let id = Uuid::new_v4();
    g.insert(id, tx);
    Some(id)
}

pub fn register_client(tx: ClientSender) -> Option<ClientId> {
    let mut g = SSE_CLIENTS.lock().ok()?;
    register_into(&mut g, tx, MAX_SSE_CLIENTS)
}

pub fn remove_client(id: ClientId) {
    if let Ok(mut g) = SSE_CLIENTS.lock() {
        g.remove(&id);
    }
}

/// Send an event to every connected client. Drops senders whose
/// receivers are gone (client disconnected).
fn broadcast(event: SSEInstallTaskEvent) {
    let snapshot: Vec<(ClientId, ClientSender)> = match SSE_CLIENTS.lock() {
        Ok(g) => g.iter().map(|(k, v)| (*k, v.clone())).collect(),
        Err(_) => return,
    };
    let mut dead: Vec<ClientId> = Vec::new();
    let axum_event: Event = event.into();
    for (id, tx) in &snapshot {
        if tx.send(Ok(axum_event.clone())).is_err() {
            dead.push(*id);
        }
    }
    if !dead.is_empty()
        && let Ok(mut g) = SSE_CLIENTS.lock()
    {
        for id in dead {
            g.remove(&id);
        }
    }
}

/// Send a single typed event to ONE client (used by the
/// subscribe handler to replay current registry state on connect).
pub fn send_to(tx: &ClientSender, event: SSEInstallTaskEvent) {
    let axum_event: Event = event.into();
    let _ = tx.send(Ok(axum_event));
}

// =====================================================================
// Install task lifecycle
// =====================================================================

/// Spawn an install task and return its initial state. The actual
/// download runs in `tokio::spawn`; the HTTP handler returns the
/// state immediately so the UI can show "running" while progress
/// flows via the SSE channel.
pub fn start_install_task(
    pool: PgPool,
    cache_dir: PathBuf,
    version: String,
    arch: String,
    flavor: String,
    package: String,
) -> InstallTaskState {
    let state = InstallTaskState::new(&version, &arch, &flavor, &package);
    let task_id = state.task_id;
    let cell = Arc::new(Mutex::new(state.clone()));
    INSTALL_TASKS.insert(task_id, cell.clone());

    broadcast(SSEInstallTaskEvent::TaskStarted(state.clone()));

    tokio::spawn(async move {
        let cell_for_progress = cell.clone();
        let progress_cb = move |ev: InstallProgress| {
            let (phase, message) = match &ev {
                InstallProgress::Resolving { version, asset } => (
                    "resolving".to_string(),
                    format!("resolving v{version} {asset}"),
                ),
                InstallProgress::Downloading { url } => {
                    ("downloading".to_string(), format!("downloading {url}"))
                }
                InstallProgress::VerifyingSha256 => (
                    "verifying_sha256".to_string(),
                    "verifying sha256".to_string(),
                ),
                InstallProgress::VerifyingCosign => (
                    "verifying_cosign".to_string(),
                    "verifying cosign signature".to_string(),
                ),
                InstallProgress::Installing { path } => {
                    ("installing".to_string(), format!("installing {path}"))
                }
            };
            if let Ok(mut g) = cell_for_progress.lock() {
                g.phase = Some(phase.clone());
                g.message = Some(message.clone());
            }
            broadcast(SSEInstallTaskEvent::Progress(SSEInstallProgressData {
                task_id,
                phase,
                message,
            }));
        };

        let result = version_manager::install_version(
            &pool,
            &cache_dir,
            &version,
            &arch,
            &flavor,
            &package,
            progress_cb,
        )
        .await;

        match result {
            Ok((artifact, stats)) => {
                let stats = stats.unwrap_or(version_manager::DownloadStats {
                    bytes_downloaded: 0,
                    duration_ms: 0,
                    cosign_verified: artifact.cosign_bundle.is_some(),
                });
                if let Ok(mut g) = cell.lock() {
                    g.status = TaskStatus::Completed;
                    g.phase = Some("complete".to_string());
                    g.message = Some("installed".to_string());
                    g.completed_at = Some(Utc::now());
                    g.artifact_id = Some(artifact.id);
                    g.bytes_downloaded = Some(stats.bytes_downloaded);
                    g.duration_ms = Some(stats.duration_ms);
                }
                broadcast(SSEInstallTaskEvent::Complete(SSEInstallCompleteData {
                    task_id,
                    artifact_id: artifact.id,
                    bytes_downloaded: stats.bytes_downloaded,
                    duration_ms: stats.duration_ms,
                    cosign_verified: stats.cosign_verified,
                }));
                // Cross-device sync: a newly-installed rootfs version changed
                // the version list → other admin devices refetch. This is a
                // detached background task (no originating request), so
                // origin = None. Audience matches the read perm that gates the
                // version-list refetch endpoint, mirroring delete_version_handler.
                crate::modules::sync::publish(
                    crate::modules::sync::SyncEntity::CodeSandboxRootfsVersion,
                    crate::modules::sync::SyncAction::Create,
                    artifact.id,
                    crate::modules::sync::Audience::perm::<
                        crate::modules::code_sandbox::permissions::CodeSandboxEnvironmentsRead,
                    >(),
                    None,
                );
            }
            Err(e) => {
                let err_str = e.to_string();
                if let Ok(mut g) = cell.lock() {
                    g.status = TaskStatus::Failed;
                    g.phase = Some("failed".to_string());
                    g.completed_at = Some(Utc::now());
                    g.error = Some(err_str.clone());
                }
                broadcast(SSEInstallTaskEvent::Failed(SSEInstallFailedData {
                    task_id,
                    error: err_str,
                }));
            }
        }

        // Reap the cell after the retention window. Live clients
        // see the terminal event immediately; this just keeps
        // INSTALL_TASKS from growing unbounded.
        tokio::time::sleep(TASK_RETENTION).await;
        INSTALL_TASKS.remove(&task_id);
    });

    state
}

// =====================================================================
// Unit tests — SSE slot accounting
// =====================================================================

#[cfg(test)]
mod sse_slot_tests {
    use super::*;
    use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

    type ClientReceiver = UnboundedReceiver<Result<Event, axum::Error>>;

    /// A sender whose stream is gone: the receiver is dropped, exactly as when
    /// axum drops an SSE response body.
    fn dead_sender() -> ClientSender {
        let (tx, rx) = unbounded_channel();
        drop(rx);
        tx
    }

    /// A sender whose stream is still open. The receiver must be kept alive by
    /// the caller, or the sender reads as closed.
    fn live_sender() -> (ClientSender, ClientReceiver) {
        unbounded_channel()
    }

    #[test]
    fn prune_reclaims_only_dead_clients() {
        let mut g: HashMap<ClientId, ClientSender> = HashMap::new();
        let (live, _rx) = live_sender();
        g.insert(Uuid::new_v4(), live);
        g.insert(Uuid::new_v4(), dead_sender());
        g.insert(Uuid::new_v4(), dead_sender());

        assert_eq!(prune_closed_locked(&mut g), 2, "both dead slots freed");
        assert_eq!(g.len(), 1, "the live client is untouched");
    }

    /// The regression: slots leaked by disconnected clients must not charge the
    /// cap forever. Before the fix the endpoint answered 503 for the life of
    /// the process once `cap` connections had ever been made.
    #[test]
    fn register_reclaims_leaked_slots_at_cap() {
        let cap = 4;
        let mut g: HashMap<ClientId, ClientSender> = HashMap::new();
        for _ in 0..cap {
            g.insert(Uuid::new_v4(), dead_sender());
        }
        assert_eq!(g.len(), cap, "registry starts saturated with dead slots");

        let (tx, _rx) = live_sender();
        assert!(
            register_into(&mut g, tx, cap).is_some(),
            "a new subscriber must be admitted once dead slots are swept"
        );
        assert_eq!(g.len(), 1, "the four dead slots were reclaimed");
    }

    /// Negative control: the sweep must not amount to removing the cap. With
    /// every client genuinely alive there is nothing to reclaim, and the cap
    /// must still refuse — otherwise the test above would pass on a build that
    /// simply deleted the limit.
    #[test]
    fn register_still_refuses_when_all_clients_are_live() {
        let cap = 4;
        let mut g: HashMap<ClientId, ClientSender> = HashMap::new();
        let mut keep_alive: Vec<ClientReceiver> = Vec::new();
        for _ in 0..cap {
            let (tx, rx) = live_sender();
            keep_alive.push(rx);
            g.insert(Uuid::new_v4(), tx);
        }

        let (tx, _rx) = live_sender();
        assert!(
            register_into(&mut g, tx, cap).is_none(),
            "a saturated registry of LIVE clients must still refuse"
        );
        assert_eq!(g.len(), cap, "no live client was evicted to make room");
    }

    /// The guard's release path: a reclaimed slot frees capacity for the next
    /// subscriber, which is what makes reconnecting work.
    #[test]
    fn removing_a_client_frees_its_slot() {
        let cap = 2;
        let mut g: HashMap<ClientId, ClientSender> = HashMap::new();
        let (a, _rx_a) = live_sender();
        let (b, _rx_b) = live_sender();
        let id_a = register_into(&mut g, a, cap).expect("first admitted");
        register_into(&mut g, b, cap).expect("second admitted");

        let (c, _rx_c) = live_sender();
        assert!(register_into(&mut g, c, cap).is_none(), "at cap");

        g.remove(&id_a); // what ConnGuard::drop does via remove_client
        let (d, _rx_d) = live_sender();
        assert!(
            register_into(&mut g, d, cap).is_some(),
            "the freed slot admits the next subscriber"
        );
    }
}
