//! ITEM-5 — "a freshly downloaded model can't be chatted with until reload".
//!
//! These are the DETERMINISTIC gates for that item. None of them races: each
//! one puts the system into a state the failure needs and then asserts, rather
//! than trying to land a request inside a moving window. A racing end-to-end
//! spec would sample one instant of that window and be green here and red at
//! 3am; the live end-to-end reproduction is recorded as corroboration in
//! `.lifecycle/paws-ui-polish/INFRA_INTEGRATION.md`, NOT as the gate.
//!
//! The four defects the live reproduction found, and which of these pins each:
//!
//! | defect | test |
//! |---|---|
//! | single-flight was not cancellation-safe | `g2a_cancelled_waiter_does_not_break_the_start` |
//! | `status()` reported a ZOMBIE as running | `g2b_engine_killed_out_of_band_recovers_without_waiting_out_the_timeout` |
//! | `do_start` polled to the deadline after the child died | `g2c_dead_engine_fails_fast_not_at_the_deadline` |
//! | a WEDGED engine must still self-heal (regression guard) | `g2d_wedged_engine_is_reclaimed_not_waited_on_forever` |
//!
//! TWO of the changes are deliberately NOT pinned here — the duplicate
//! `validator::enqueue` and the validation hand-off. Both are covered in the
//! honest-gap note at the bottom, with what DOES cover them instead.

use crate::common::test_helpers::create_user_with_permissions;
use super::mock_release;
use super::test_helpers::{self as lrt, LOCAL_RUNTIME_ADMIN_PERMS};
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

/// A model path carrying the stub's "exit immediately" sentinel — the
/// corrupt/unsupported-model-file case. The sentinel travels in the PATH, not
/// the environment, because the deployment `env_clear()`s the child.
fn dies_on_load_path() -> String {
    format!("/tmp/ziee-stub-dies-on-load-{}.gguf", Uuid::new_v4())
}

// ─────────────────────────────────────────────────────────────────────────
// G2a — the single-flight must survive a cancelled waiter
// ─────────────────────────────────────────────────────────────────────────

/// **The defect this pins is the one that actually broke the user's chat.**
///
/// `ensure_running` used a `tokio::sync::OnceCell` whose init future ran INLINE
/// in whichever caller arrived first. Tier-2 validation wraps its call in an
/// outer `tokio::time::timeout`; when that fired it DROPPED the future,
/// cancelling the init mid-spawn while the engine child kept running. `OnceCell`
/// then handed initialization to the next waiter — the user's chat — which
/// re-entered `do_start` and called `start()` on a model that already had a live
/// child, failing with `Model instance already running already exists`.
///
/// Measured live: that collision landed 90s after the spawn, to the second,
/// which was exactly the validator's outer deadline at the time.
///
/// ## Driven over HTTP, deliberately
///
/// The obvious version of this test calls `ensure_running` twice directly, but
/// that needs `ziee::modules` to be public, and widening a crate's API so a test
/// can reach inside it is a worse trade than testing through the front door.
/// The front door also gives a TRUER shape: an abandoned HTTP request is a real
/// thing users do (closing a tab, a dropped SSE stream), and it cancels the
/// server-side future exactly as the validator's deadline did.
///
/// ## Why it does not race
///
/// The cancellation is CAUSED, not awaited — request A is given a client
/// timeout short enough that it is certain to be abandoned while the start is
/// still in flight. The assertion is on request B, which races nothing: it must
/// simply succeed. If the single-flight is cancellation-safe, B's outcome does
/// not depend on A's fate at all.
#[tokio::test]
async fn g2a_cancelled_waiter_does_not_break_the_start() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let version_id = lrt::download_engine_from_mock(&mock, &admin.token, "llamacpp").await;
    let pool = lrt::test_pool(&mock.server).await;
    let (pid, proxy_token, _p) =
        lrt::create_local_provider_with_token(&mock.server, &admin.token).await;

    let gguf = std::env::temp_dir().join(format!("ziee-g2a-{}.gguf", Uuid::new_v4()));
    std::fs::write(&gguf, lrt::tiny_gguf_bytes()).unwrap();
    let _model_id = lrt::make_startable_model(
        &mock.server,
        &admin.token,
        &pool,
        pid,
        "g2a",
        version_id,
        &gguf.to_string_lossy(),
    )
    .await;

    // Request A — abandoned mid-start by a 150ms client timeout. This is the
    // validator's outer deadline, wearing a different hat.
    let url = mock.server.api_url("/local-llm/v1/chat/completions");
    let body = json!({ "model": "g2a", "messages": [{ "role": "user", "content": "hi" }] });
    let a = reqwest::Client::builder()
        .timeout(Duration::from_millis(150))
        .build()
        .unwrap()
        .post(&url)
        .header("Authorization", format!("Bearer {proxy_token}"))
        .json(&body)
        .send()
        .await;
    assert!(
        a.is_err(),
        "request A was supposed to be ABANDONED by its client timeout — if it \
         completed, this test never entered the state it exists to cover and proves \
         nothing"
    );

    // Request B — the user's chat, arriving while A's start is still in flight.
    let b = lrt::proxy_chat(&mock.server, &proxy_token, body.clone()).await;
    let status = b.status();
    let text = b.text().await.unwrap_or_default();
    assert!(
        status.is_success(),
        "an abandoned request must not break the start that later requests depend on, \
         but the next chat got {status}: {text}. Pre-fix this was `Model instance \
         already running already exists` — the cancelled init left a live child and \
         the next caller collided with it.",
    );

    let _ = std::fs::remove_file(&gguf);
}

// ─────────────────────────────────────────────────────────────────────────
// G2b — a dead engine must not report as running
// ─────────────────────────────────────────────────────────────────────────

/// `LocalDeployment::status()` derived `running` from `Child::id().is_some()`.
/// `Child::id()` keeps returning `Some` for a process that has EXITED but not
/// been waited on — a zombie — so a dead engine reported as running.
///
/// This is not cosmetic. Two pieces of the fix consult `status()` to tell "still
/// loading" from "gone": `Liveness::Starting` and the `do_start` fail-fast. With
/// a lying `status()` both read a dead engine as *still loading* and wait it
/// out, which is strictly WORSE than the behaviour they replaced. Observed
/// directly: an engine handed a corrupt model exited in 27ms, sat as
/// `Z (defunct)`, and the server polled `/health` for the full timeout.
///
/// ## Why the engine is killed OUT-OF-BAND
///
/// Going through `stop()` would remove the model from the deployment's process
/// map, so `status()` would answer from the empty-map branch and the zombie path
/// — the one that was broken — would never be reached. The map entry has to
/// SURVIVE while the child dies, which is precisely the documented stale-row
/// hazard (an engine killed by the OOM killer, a crash, an operator's `kill`).
///
/// The pid is found by scanning `/proc` for the child whose argv carries this
/// model's unique path, so no external tool is involved.
///
/// ## Why it does not race
///
/// The kill is caused and then confirmed (the process is polled until it is no
/// longer alive) before anything is asserted. The recovery assertion is bounded
/// well under the auto-start timeout, so a pass cannot be produced by waiting
/// the timeout out.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn g2b_engine_killed_out_of_band_recovers_without_waiting_out_the_timeout() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let version_id = lrt::download_engine_from_mock(&mock, &admin.token, "llamacpp").await;
    let pool = lrt::test_pool(&mock.server).await;
    let (pid_provider, proxy_token, _p) =
        lrt::create_local_provider_with_token(&mock.server, &admin.token).await;

    // A LARGE auto-start timeout, so "recovered" and "waited out the deadline"
    // cannot be confused.
    let resp = lrt::update_runtime_settings(
        &mock.server,
        &admin.token,
        json!({ "auto_start_timeout_secs": 120 }),
    )
    .await;
    assert!(resp.status().is_success(), "could not raise auto_start_timeout_secs");

    // Unique path → a unique argv needle for the /proc scan.
    let marker = Uuid::new_v4();
    let gguf = std::env::temp_dir().join(format!("ziee-g2b-{marker}.gguf"));
    std::fs::write(&gguf, lrt::tiny_gguf_bytes()).unwrap();
    let _model_id = lrt::make_startable_model(
        &mock.server,
        &admin.token,
        &pool,
        pid_provider,
        "g2b",
        version_id,
        &gguf.to_string_lossy(),
    )
    .await;

    // Bring a HEALTHY engine up, so the instance row says running and the
    // deployment's process map holds a live child.
    let first = lrt::proxy_chat(
        &mock.server,
        &proxy_token,
        json!({ "model": "g2b", "messages": [{ "role": "user", "content": "hi" }] }),
    )
    .await;
    assert!(
        first.status().is_success(),
        "the engine must be healthy before this test can kill it; got {}",
        first.status()
    );

    // Kill it out-of-band.
    let engine_pid = find_pid_with_argv_needle(&marker.to_string())
        .expect("could not locate the spawned engine process by its argv");
    unsafe { libc::kill(engine_pid, libc::SIGKILL) };

    // Confirm it is actually gone (and unreaped — the server owns the reap)
    // before asserting anything.
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if !pid_is_alive(engine_pid) {
            break;
        }
    }
    assert!(
        !pid_is_alive(engine_pid),
        "engine pid {engine_pid} still alive after SIGKILL — the test never reached \
         the state it exists to cover"
    );

    // Now the two properties that matter, in order of importance.
    //
    // (1) NO HANG. Every attempt must return promptly. Pre-fix, `status()`
    //     reported the zombie as running, so `probe_liveness` answered
    //     `Starting` and the caller sat waiting for a load that was never
    //     going to happen — up to the full 120s auto-start timeout.
    //
    // (2) RECOVERY. It must come back on its own. Not necessarily on the very
    //     next request: an out-of-band death is a real crash, so the health
    //     state machine applies restart backoff and answers `502 … in restart
    //     backoff after a crash; retry shortly` first. That is correct — it is
    //     the flap protection doing its job — so the test retries through it
    //     rather than asserting a behaviour the design deliberately does not
    //     have.
    let overall = std::time::Instant::now();
    let mut recovered = false;
    let mut last = String::new();
    while overall.elapsed() < Duration::from_secs(60) {
        let attempt = std::time::Instant::now();
        let resp = lrt::proxy_chat(
            &mock.server,
            &proxy_token,
            json!({ "model": "g2b", "messages": [{ "role": "user", "content": "hi again" }] }),
        )
        .await;
        let took = attempt.elapsed();
        let status = resp.status();
        last = format!("{status}: {}", resp.text().await.unwrap_or_default());

        assert!(
            took < Duration::from_secs(30),
            "a single attempt took {took:?} against a 120s auto-start timeout — that is \
             the shape of waiting out the deadline on a process the server believed was \
             still loading, which is exactly what a zombie-blind `status()` produces. \
             Response was {last}"
        );

        if status.is_success() {
            recovered = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    assert!(
        recovered,
        "the engine never came back after an out-of-band death; last response was {last}"
    );

    let _ = std::fs::remove_file(&gguf);
}

/// Find a process whose `/proc/<pid>/cmdline` contains `needle`, excluding this
/// test process. Linux-only, and used only by the test above.
#[cfg(target_os = "linux")]
fn find_pid_with_argv_needle(needle: &str) -> Option<i32> {
    let me = std::process::id();
    for entry in std::fs::read_dir("/proc").ok()? {
        let entry = entry.ok()?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let pid: u32 = match name.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if pid == me {
            continue;
        }
        let cmdline = match std::fs::read(format!("/proc/{pid}/cmdline")) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if String::from_utf8_lossy(&cmdline).contains(needle) {
            return Some(pid as i32);
        }
    }
    None
}

/// True while the pid names a process that is not a reaped corpse. A ZOMBIE
/// counts as NOT alive here — that is the whole distinction under test.
#[cfg(target_os = "linux")]
fn pid_is_alive(pid: i32) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        // `stat` field 3 is the state character; `Z` is a zombie.
        Ok(s) => match s.rsplit(") ").next().and_then(|r| r.split(' ').next()) {
            Some(state) => state != "Z",
            None => false,
        },
        Err(_) => false,
    }
}

// ─────────────────────────────────────────────────────────────────────────
// G2c — fail fast when the child is gone
// ─────────────────────────────────────────────────────────────────────────

/// `do_start` polled `/health` until the deadline regardless of whether the
/// child was still alive. With the auto-start default raised to a realistic
/// 180s (migration `202607220200`), a corrupt model file would have cost the
/// user a THREE MINUTE wait for an answer the engine gave in milliseconds.
///
/// So the raised default and this fail-fast ship together, and this gate is
/// what makes the raise defensible: it bounds the cost of the larger timeout.
///
/// ## Driven through the PROXY, not `POST /start`
///
/// An earlier version of this test used `POST /local-runtime/models/{id}/start`
/// and passed with the fix REVERTED, because that handler calls
/// `deployment.start()` directly and never enters `do_start`'s health-poll loop
/// at all — it was measuring a path the fix does not live on. `ensure_running`
/// (and therefore the fail-fast) is reached from the PROXY front door, which is
/// also where a user's chat actually arrives.
///
/// ## Why it does not race
///
/// The auto-start timeout is set an order of magnitude above the assertion
/// bound, so "failed fast" and "waited out the deadline" cannot be confused: a
/// pass inside the bound cannot have come from a deadline that has not remotely
/// elapsed.
#[tokio::test]
async fn g2c_dead_engine_fails_fast_not_at_the_deadline() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let version_id = lrt::download_engine_from_mock(&mock, &admin.token, "llamacpp").await;
    let pool = lrt::test_pool(&mock.server).await;
    let (pid, proxy_token, _p) =
        lrt::create_local_provider_with_token(&mock.server, &admin.token).await;

    // A deliberately LARGE auto-start timeout. Pre-fix, a start whose engine
    // died after binding would sit in the health loop for the whole 120s.
    let resp = lrt::update_runtime_settings(
        &mock.server,
        &admin.token,
        json!({ "auto_start_timeout_secs": 120 }),
    )
    .await;
    assert!(
        resp.status().is_success(),
        "could not raise auto_start_timeout_secs, so the fast/slow gap this test \
         depends on does not exist: {}",
        resp.status()
    );

    let _model_id = lrt::make_startable_model(
        &mock.server,
        &admin.token,
        &pool,
        pid,
        "g2c",
        version_id,
        &dies_on_load_path(),
    )
    .await;

    let began = std::time::Instant::now();
    let resp = lrt::proxy_chat(
        &mock.server,
        &proxy_token,
        json!({ "model": "g2c", "messages": [{ "role": "user", "content": "hi" }] }),
    )
    .await;
    let elapsed = began.elapsed();
    let status = resp.status();

    assert!(
        !status.is_success(),
        "an engine that dies on load cannot serve a chat, but the proxy returned \
         {status} — the fixture is not producing the state under test"
    );
    assert!(
        elapsed < Duration::from_secs(30),
        "a chat whose engine exited must fail fast, but it took {:?} against a 120s \
         auto-start timeout — i.e. it polled to (or toward) the deadline instead of \
         noticing the child was gone. The 30s bound is deliberately loose: the point \
         is the ORDER-OF-MAGNITUDE gap from 120s, not a tight deadline of its own.",
        elapsed
    );
}

// ─────────────────────────────────────────────────────────────────────────
// G2d — a WEDGED engine must still be recoverable
// ─────────────────────────────────────────────────────────────────────────

/// This gate exists because the `Liveness::Starting` fix could have introduced a
/// regression, and nearly did.
///
/// Before `Starting` existed, an engine that was ALIVE but not answering
/// `/health` was reported `Crashed`. That marked the instance row stopped and
/// let the caller restart it — and that WAS the recovery path for a wedged
/// engine. Nothing else provides one: the reaper's health monitor
/// (`reaper.rs::monitor_health` → `report_health`) only records the state
/// transition, it never stops or respawns.
///
/// Introducing `Starting` so a slow LOAD is not counted as a crash therefore
/// risked converting "wedged engine self-heals" into "wedged engine is waited on
/// as though it were still loading, forever". The distinguishing signal is TIME:
/// loading is a claim with a deadline. Past the deadline the engine is treated
/// as crashed — stopped, recorded, restarted — so both properties hold at once.
///
/// ## What is asserted, and why not "it failed quickly"
///
/// An earlier version asserted only that the request came back within a bound.
/// That passed with the recovery REVERTED, because both versions return a
/// bounded error — the bound is the auto-start budget either way. It measured
/// nothing.
///
/// The property that actually differs is whether the wedged engine is
/// RECLAIMED. With recovery, the deadline path stops the process and marks the
/// row, so the model reports `stopped`. Without it, the process is left alive
/// and registered forever and the model still reports `running` — a wedged
/// engine nothing will ever clear.
///
/// ## Why it does not race
///
/// The engine is unhealthy unconditionally and permanently (`stub-unhealthy`),
/// so there is no window to hit, and the assertion is polled to a bound well
/// past the shortened auto-start budget.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn g2d_wedged_engine_is_reclaimed_not_waited_on_forever() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let version_id = lrt::download_engine_from_mock(&mock, &admin.token, "llamacpp").await;
    let pool = lrt::test_pool(&mock.server).await;
    let (pid, proxy_token, _p) =
        lrt::create_local_provider_with_token(&mock.server, &admin.token).await;

    // Shorten the auto-start budget so the "loading" deadline arrives quickly.
    let resp = lrt::update_runtime_settings(
        &mock.server,
        &admin.token,
        json!({ "auto_start_timeout_secs": 5 }),
    )
    .await;
    assert!(
        resp.status().is_success(),
        "could not shorten auto_start_timeout_secs: {}",
        resp.status()
    );

    // Unique path → a unique argv needle for the /proc scan below.
    let marker = Uuid::new_v4();
    let gguf = std::env::temp_dir().join(format!("ziee-g2d-{marker}.gguf"));
    std::fs::write(&gguf, lrt::tiny_gguf_bytes()).unwrap();
    let model_id = lrt::make_startable_model(
        &mock.server,
        &admin.token,
        &pool,
        pid,
        "g2d",
        version_id,
        &gguf.to_string_lossy(),
    )
    .await;

    // Bring the engine up HEALTHY, so an instance row is persisted. That row is
    // what makes the `Starting` arm reachable at all: without it `probe_liveness`
    // answers `NotRunning` and `do_start`'s own timeout reclaims the process, so
    // the state under test is never entered. (An earlier version of this test used
    // the `stub-unhealthy` path sentinel, which is unhealthy from the FIRST probe
    // — it therefore never persisted a row, never reached `Starting`, and passed
    // with the recovery reverted.)
    let first = lrt::proxy_chat(
        &mock.server,
        &proxy_token,
        json!({ "model": "g2d", "messages": [{ "role": "user", "content": "hi" }] }),
    )
    .await;
    assert!(
        first.status().is_success(),
        "the engine must come up healthy before it can be wedged; got {}",
        first.status()
    );

    // Now wedge it: alive, registered, and never healthy again.
    //
    // SIGSTOP rather than a stub knob. A stopped process is the wedged state in
    // its purest form — the kernel still reports it as a live, unreaped process
    // (so `status()` says running and `Liveness` says `Starting`), but it will
    // never answer `/health` again. It also needs no fixture cooperation, which
    // matters: a stub endpoint would have to be present in the engine binary the
    // server actually spawned, and it models a real deadlocked or thrashing
    // engine more honestly than a self-reported "I am unhealthy now" flag.
    let engine_pid = find_pid_with_argv_needle(&marker.to_string())
        .expect("could not locate the spawned engine process by its argv");
    unsafe { libc::kill(engine_pid, libc::SIGSTOP) };

    // A chat now finds a live-but-unresponsive engine — the `Starting` state.
    let resp = lrt::proxy_chat(
        &mock.server,
        &proxy_token,
        json!({ "model": "g2d", "messages": [{ "role": "user", "content": "hi again" }] }),
    )
    .await;
    assert!(
        !resp.status().is_success(),
        "a wedged engine cannot serve a chat, but the proxy returned {} — the \
         fixture is not producing the state under test",
        resp.status()
    );

    // The wedged engine must have been reclaimed.
    //
    // The outcome is CAPTURED rather than asserted inline, so the SIGSTOPped
    // process is cleaned up on the failing path too. A panic here would
    // otherwise leave a stopped process on the box forever — it cannot exit on
    // its own, and nothing else will reap it. This box is shared with other
    // worktrees, so a leaked process is somebody else's problem, not just this
    // test's.
    let mut last = String::new();
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let st = lrt::get_status(&mock.server, &admin.token, model_id).await;
        last = st["status"].as_str().unwrap_or("").to_string();
        if last != "running" {
            break;
        }
    }

    // Clean up BEFORE asserting. SIGCONT first so SIGKILL is delivered promptly
    // rather than queued behind the stop.
    unsafe {
        libc::kill(engine_pid, libc::SIGCONT);
        libc::kill(engine_pid, libc::SIGKILL);
    }
    let _ = std::fs::remove_file(&gguf);

    assert_ne!(
        last, "running",
        "a wedged engine (alive, never healthy) is still registered as running, so \
         nothing will ever clear it: the reaper's health monitor only records state \
         and never respawns, so the auto-start deadline is the ONLY recovery path. \
         Waiting on it as though it were still loading is the regression the \
         `Liveness::Starting` arm could have introduced."
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Honest coverage gap — stated, not engineered around
// ─────────────────────────────────────────────────────────────────────────
//
// TWO of the item-5 changes are NOT pinned by a test here. Both were attempted
// and both attempts are recorded rather than quietly dropped.
//
// ## 1. The duplicate `validator::enqueue` — NOT TESTABLE via validation_status
//
// `create_model_with_files` enqueued Tier-2 twice, so every model creation ran
// two full spawn → health-wait → SIGTERM cycles. A gate for it was written and
// then REMOVED, because it could not be made non-vacuous:
//
//   - `POST /llm-models/{id}/validate` does not run the create-path code at
//     all, so the first version passed with the duplicate reinstated;
//   - driving `POST /llm-models/upload` reaches the right code, but the only
//     observable — `validation_status` — cannot COUNT passes. The worker pops
//     the next queue entry immediately, so the terminal write between two
//     back-to-back passes is a single DB write. Sampled at 400ms both passes
//     fell inside one sleep; sampled at 50ms and counting transitions INTO
//     `processing`, two back-to-back passes read as ONE continuous run. Every
//     version passed with the duplicate present.
//
// Shipping a gate that is green with AND without the defect is worse than
// shipping none — it converts "tested" into a false claim. What covers it
// instead: the change is a one-line deletion visible in the diff, and the live
// reproduction observed `validator: enqueued` exactly once where it previously
// appeared twice (INFRA_INTEGRATION.md).
//
// ## 2. The validation hand-off
//
// When validation finishes and the model has in-flight requests, it leaves the
// healthy engine RUNNING for them (`inflight > 0` → skip `drain_and_stop`)
// instead of draining and killing it. That is the change that finally produced
// an answer in the live run.
//
// Pinning it deterministically needs a request held open ACROSS the moment
// validation completes. The stub can hold a request (`stub_hang_ms`), but the
// hold must overlap a window whose start this test does not control — exactly
// the racing shape these gates exist to avoid. A timed overlap would be green
// on a fast box and red on a slow one, and presenting that as a gate would be
// worse than admitting the gap.
//
// What covers it instead: the live reproduction observed the hand-off log line
// (`validated and has 1 in-flight request(s) — leaving the engine running for
// them`) followed by an answered message, with timestamps. That is one instant
// of one run, and it is reported as corroboration, not as proof of a property.
//
// ## What the three gates above still buy
//
// They bound the blast radius independently of the two gaps: the cancellation
// collision, the zombie-blind restart bricking, and the poll-to-deadline
// slowness would each come back on their own, and each is caught here with a
// verified negative control (each was run against its own fix reverted and
// observed to FAIL, with the pre-fix error reproduced — G2a reproduces
// `Model instance already running already exists` verbatim).
