//! A loopback git server that REFUSES credentials — the fixture INV-1 is proven
//! against.
//!
//! > **INV-1**: Installing the default model requires **no credential** — no API
//! > key, no token, no login — at any point.
//!
//! A test that merely downloads successfully proves nothing about that: it would
//! pass just as well if a credential were being sent. So this fixture answers
//! **401 to any request carrying an `Authorization` header**, and records every
//! request it saw. A clone that completes here is a clone that never
//! authenticated — and an implementation that started sending a token would turn
//! the test RED rather than leaving it quietly green.
//!
//! It speaks git's **smart HTTP** protocol, because the server clones with
//! `git2` (libgit2), which does not support the dumb protocol. Only the two
//! endpoints a clone needs are implemented, each by handing the work to the real
//! `git upload-pack`:
//!
//! | request | handled by |
//! |---|---|
//! | `GET  /<repo>.git/info/refs?service=git-upload-pack` | `git upload-pack --stateless-rpc --advertise-refs` |
//! | `POST /<repo>.git/git-upload-pack`                   | `git upload-pack --stateless-rpc` |
//!
//! **On the URL shape.** `GitService::build_repository_url` appends `.git` for
//! any base that is not `huggingface.co`, so a loopback fixture is necessarily
//! exercised through that branch rather than the no-suffix Hugging Face one.
//! The Hugging Face composition — including the org-scoped base this feature
//! seeds — is proven separately and exactly by the unit test on
//! `build_repository_url`. What this fixture proves is the part that cannot be
//! proven statically: that the `auth_type = 'none'` path completes a real clone
//! while sending nothing.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio::task::JoinHandle;

/// One observed request, for after-the-fact assertions.
#[derive(Clone, Debug)]
pub struct SeenRequest {
    pub path: String,
    /// Present only if the client actually sent one — which it must not.
    pub authorization: Option<String>,
}

#[derive(Clone)]
struct FixtureState {
    repo_root: PathBuf,
    seen: Arc<Mutex<Vec<SeenRequest>>>,
}

/// A running credential-refusing git server.
pub struct GitFixture {
    /// Base URL to use as an `llm_repositories.url`, e.g. `http://127.0.0.1:PORT`.
    pub base_url: String,
    /// The repository name served, WITHOUT the `.git` suffix.
    pub repo_name: String,
    seen: Arc<Mutex<Vec<SeenRequest>>>,
    _dir: TempDir,
    _handle: JoinHandle<()>,
}

impl Drop for GitFixture {
    fn drop(&mut self) {
        self._handle.abort();
    }
}

impl GitFixture {
    /// Every request the fixture has served or refused, in order.
    pub fn seen(&self) -> Vec<SeenRequest> {
        self.seen.lock().expect("fixture log poisoned").clone()
    }

    /// Requests that arrived carrying an `Authorization` header.
    ///
    /// The whole point of the fixture: this must be EMPTY after an
    /// `auth_type = 'none'` download.
    pub fn authenticated_requests(&self) -> Vec<SeenRequest> {
        self.seen()
            .into_iter()
            .filter(|r| r.authorization.is_some())
            .collect()
    }

    /// True once the clone actually reached the pack-negotiation endpoint —
    /// i.e. the fixture really served a clone rather than the test passing
    /// because nothing ever contacted it.
    pub fn served_a_clone(&self) -> bool {
        self.seen().iter().any(|r| r.path.contains("git-upload-pack"))
    }
}

/// Create a one-commit bare repository containing `files`, and serve it.
///
/// `files` are `(name, contents)` pairs written at the repository root — the
/// weight file is a few plain bytes, not an LFS pointer, so the download path's
/// LFS step correctly finds nothing to fetch.
pub async fn start(repo_name: &str, files: &[(&str, &[u8])]) -> GitFixture {
    let dir = TempDir::new().expect("git fixture TempDir");
    let work = dir.path().join("work");
    let bare = dir.path().join(format!("{repo_name}.git"));
    std::fs::create_dir_all(&work).expect("create fixture worktree");

    for (name, contents) in files {
        std::fs::write(work.join(name), contents).expect("write fixture file");
    }

    // Build the commit in a throwaway worktree, then clone it bare. Identity and
    // hooks are pinned locally so a developer's global git config cannot change
    // what the fixture produces.
    git(&work, &["init", "--quiet", "--initial-branch", "main"]).await;
    git(&work, &["config", "user.email", "fixture@ziee.invalid"]).await;
    git(&work, &["config", "user.name", "Ziee Fixture"]).await;
    git(&work, &["config", "commit.gpgsign", "false"]).await;
    git(&work, &["add", "--all"]).await;
    git(&work, &["commit", "--quiet", "-m", "fixture"]).await;
    git(
        dir.path(),
        &[
            "clone",
            "--quiet",
            "--bare",
            work.to_str().expect("utf-8 worktree path"),
            bare.to_str().expect("utf-8 bare path"),
        ],
    )
    .await;

    let seen = Arc::new(Mutex::new(Vec::new()));
    let state = FixtureState {
        repo_root: dir.path().to_path_buf(),
        seen: Arc::clone(&seen),
    };

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind git fixture");
    let port = listener.local_addr().expect("local_addr").port();

    let app = axum::Router::new()
        .route("/{repo}/info/refs", get(info_refs))
        .route("/{repo}/git-upload-pack", post(upload_pack))
        .with_state(state);
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app.into_make_service()).await;
    });

    GitFixture {
        base_url: format!("http://127.0.0.1:{port}"),
        repo_name: repo_name.to_string(),
        seen,
        _dir: dir,
        _handle: handle,
    }
}

/// Record the request and refuse it if it carries a credential.
///
/// Returning 401 rather than ignoring the header is deliberate: it makes an
/// authenticating client FAIL, so the test cannot pass while quietly sending a
/// token.
fn record_and_gate(
    state: &FixtureState,
    path: &str,
    headers: &HeaderMap,
) -> Option<Response> {
    let authorization = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    state
        .seen
        .lock()
        .expect("fixture log poisoned")
        .push(SeenRequest {
            path: path.to_string(),
            authorization: authorization.clone(),
        });

    authorization.map(|_| {
        (
            StatusCode::UNAUTHORIZED,
            [("WWW-Authenticate", "Basic realm=\"ziee-fixture\"")],
            "this fixture serves anonymous clones only",
        )
            .into_response()
    })
}

/// Resolve `<repo>` to a bare repository path inside the fixture dir.
///
/// Rejects anything with a path separator so a malformed request cannot walk
/// out of the temp dir — the fixture is loopback-only, but a traversal here
/// would still be a bug worth not writing.
fn repo_path(state: &FixtureState, repo: &str) -> Option<PathBuf> {
    if repo.contains('/') || repo.contains('\\') || repo.contains("..") {
        return None;
    }
    let path = state.repo_root.join(repo);
    path.is_dir().then_some(path)
}

async fn info_refs(
    State(state): State<FixtureState>,
    AxumPath(repo): AxumPath<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let path = format!("/{repo}/info/refs");
    if let Some(denied) = record_and_gate(&state, &path, &headers) {
        return denied;
    }
    if params.get("service").map(String::as_str) != Some("git-upload-pack") {
        return (StatusCode::FORBIDDEN, "only git-upload-pack is served").into_response();
    }
    let Some(dir) = repo_path(&state, &repo) else {
        return (StatusCode::NOT_FOUND, "no such repository").into_response();
    };

    let advertised = upload_pack_output(&dir, true, Bytes::new()).await;

    // pkt-line service header + flush, then upload-pack's own advertisement.
    let mut body = Vec::new();
    let header = "# service=git-upload-pack\n";
    body.extend_from_slice(format!("{:04x}", header.len() + 4).as_bytes());
    body.extend_from_slice(header.as_bytes());
    body.extend_from_slice(b"0000");
    body.extend_from_slice(&advertised);

    (
        StatusCode::OK,
        [
            (
                "Content-Type",
                "application/x-git-upload-pack-advertisement",
            ),
            ("Cache-Control", "no-cache"),
        ],
        body,
    )
        .into_response()
}

async fn upload_pack(
    State(state): State<FixtureState>,
    AxumPath(repo): AxumPath<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let path = format!("/{repo}/git-upload-pack");
    if let Some(denied) = record_and_gate(&state, &path, &headers) {
        return denied;
    }
    let Some(dir) = repo_path(&state, &repo) else {
        return (StatusCode::NOT_FOUND, "no such repository").into_response();
    };

    let out = upload_pack_output(&dir, false, body).await;
    (
        StatusCode::OK,
        [
            ("Content-Type", "application/x-git-upload-pack-result"),
            ("Cache-Control", "no-cache"),
        ],
        out,
    )
        .into_response()
}

/// Run `git upload-pack --stateless-rpc [--advertise-refs]` over the bare repo.
async fn upload_pack_output(dir: &Path, advertise: bool, stdin: Bytes) -> Vec<u8> {
    let mut cmd = Command::new("git");
    cmd.arg("upload-pack").arg("--stateless-rpc");
    if advertise {
        cmd.arg("--advertise-refs");
    }
    cmd.arg(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().expect("spawn git upload-pack");
    {
        use tokio::io::AsyncWriteExt;
        let mut sink = child.stdin.take().expect("upload-pack stdin");
        let _ = sink.write_all(&stdin).await;
        let _ = sink.shutdown().await;
    }
    let out = child
        .wait_with_output()
        .await
        .expect("git upload-pack completed");
    assert!(
        out.status.success(),
        "git upload-pack failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}

/// Run a git command in `cwd`, asserting it succeeded.
async fn git(cwd: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        // Keep the developer's environment out of the fixture: a global
        // `commit.gpgsign`, a templatedir with hooks, or an ambient GIT_DIR
        // would otherwise change what gets built here.
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()
        .await
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}
