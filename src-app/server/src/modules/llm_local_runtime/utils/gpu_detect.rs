// GPU backend detection for LLM runtime
// Detects available GPU acceleration: CUDA (NVIDIA), ROCm (AMD), Metal (Apple Silicon)

use std::process::Command;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use ziee_hardware::gpu_version::{self, MajorMinor};

/// Unix directories trusted to hold vendor/system binaries.
///
/// `/System/Library` is not a bin dir and cannot resolve any name we ask for,
/// but it is kept: removing it would be an untestable macOS behaviour change
/// for no measurable gain. `/usr/sbin` above it is where macOS actually keeps
/// `system_profiler` and `sysctl`.
const UNIX_TRUSTED_DIRS: &[&str] = &[
    // Linux distros
    "/usr/bin",
    "/usr/sbin",
    "/usr/local/bin",
    // CUDA / ROCm typical installs
    "/usr/local/cuda/bin",
    "/opt/cuda/bin",
    "/opt/rocm/bin",
    // macOS
    "/opt/homebrew/bin",
    "/System/Library",
];

/// True for a Windows-absolute path (`D:\…`, `\\server\share`).
///
/// Decided **lexically** rather than via `Path::is_absolute`, so it behaves
/// identically when unit-tested on Linux — where `Path::new(r"D:\Windows")`
/// is not absolute and the guard would otherwise be untestable here.
fn is_windows_absolute(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return matches!(bytes[2], b'\\' | b'/');
    }
    raw.starts_with(r"\\")
}

/// Accept an environment-supplied Unix directory only if it is absolute and
/// free of `..`. The Unix counterpart of [`sanitize_env_dir`], applied to
/// `$ROCM_PATH` so the "never build a path out of an unvalidated environment
/// value" rule holds on both platforms rather than only where it was most
/// obviously needed.
fn is_safe_unix_env_root(raw: &str) -> bool {
    let trimmed = raw.trim();
    !trimmed.is_empty()
        && trimmed.starts_with('/')
        && !trimmed.split('/').any(|c| c == "..")
}

/// Accept an environment-supplied directory only if it is a **local**,
/// Windows-absolute, `..`-free path. Split on BOTH separators because Windows
/// accepts either and `Path::components` on a Linux test host would not see `\`.
///
/// **UNC paths are refused.** `\\host\share` is absolute and `..`-free, so an
/// earlier version of this accepted it — and a test actually asserted that it
/// did, pinning the worst case. A vendor probe must never be resolved from a
/// network share: `SystemRoot=\\attacker\share` would make the server execute a
/// remote binary and authenticate to the attacker's SMB host on the way (NTLM
/// capture / relay), with no filesystem foothold needed on the victim at all.
///
/// Understand what this does and does not buy. It is path hygiene, not proof
/// of trust: `SystemRoot=C:\Users\bob\x` is local, absolute and `..`-free, and
/// still points somewhere an unprivileged user owns. On Windows these are
/// ordinary environment variables — a user can set `SystemRoot` in
/// `HKCU\Environment` — so the "OS-controlled" label below is a statement about
/// intent, not an OS-enforced guarantee. The real containment is that the
/// candidate list is short, each entry is joined with a fixed vendor suffix we
/// control, and (see [`windows_trusted_dirs`]) no user-settable variable
/// contributes an executable path at all.
fn sanitize_env_dir(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !is_windows_absolute(trimmed) {
        return None;
    }
    // Reject UNC (`\\host\share`) and the extended-length `\\?\` form, which
    // can itself carry a UNC target (`\\?\UNC\host\share`).
    if trimmed.starts_with(r"\\") || trimmed.starts_with("//") {
        return None;
    }
    if trimmed.split(['\\', '/']).any(|c| c == "..") {
        return None;
    }
    Some(trimmed.trim_end_matches(['\\', '/']).to_string())
}

/// Windows candidate directories for `name`, built from OS- and
/// installer-provided environment rather than hardcoded drive letters.
///
/// Hardcoding `C:\…` is wrong three ways: Windows need not be installed on
/// `C:`; `%ProgramFiles%` is WOW64-redirected depending on process bitness;
/// and `CUDA_PATH` points at a version-stamped directory (`…\CUDA\v13.3`) that
/// no constant can track across toolkit upgrades.
///
/// **No user-settable variable contributes an executable path.** An earlier
/// version let `CUDA_PATH`/`HIP_PATH`/`ROCM_PATH` supply candidates for the
/// "toolkit" binaries (`nvcc`, `rocm-smi`, `hipconfig`) on the theory that only
/// `nvidia-smi`, the authoritative probe, needed protecting. That was the wrong
/// distinction: F-14 is about **which binary gets executed**, not which answer
/// is believed. `rocm-smi` is spawned unconditionally from `detect_all()` on
/// Windows, so `%HIP_PATH%\bin\rocm-smi.exe` was arbitrary code execution in
/// the server process for anyone who could set one environment variable —
/// exactly the PATH-shadowing class F-14 closed, wearing a different hat.
///
/// The cost of removing them is small and worth naming: on Windows, `nvcc` in a
/// custom toolkit directory is no longer found. `nvidia-smi` lives in
/// `%SystemRoot%\System32` and is the primary source anyway, so CUDA detection
/// is unaffected; only the toolkit-derived fallback loses a lookup path.
///
/// `get_env` is injected so the policy is unit-testable on a non-Windows host.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_trusted_dirs(name: &str, get_env: impl Fn(&str) -> Option<String>) -> Vec<String> {
    // (environment variable, fixed vendor subdirectory beneath it)
    const OS_CONTROLLED: &[(&str, &str)] = &[
        ("SystemRoot", r"\System32"),
        ("ProgramW6432", r"\NVIDIA Corporation\NVSMI"),
        ("ProgramFiles", r"\NVIDIA Corporation\NVSMI"),
    ];
    let mut dirs = Vec::new();
    for (var, suffix) in OS_CONTROLLED {
        if let Some(raw) = get_env(var)
            && let Some(base) = sanitize_env_dir(&raw)
        {
            dirs.push(format!("{base}{suffix}"));
        }
    }
    // `name` is accepted so the policy can differ per binary if it ever needs
    // to; today every probe gets the same, deliberately minimal, list.
    let _ = name;
    dirs
}

/// Resolve a binary by name to its absolute path, searching only trusted
/// system directories (NOT `$PATH`). Closes 08-llm-local-runtime F-14 (Low):
/// `Command::new("nvidia-smi")` inherits the server's PATH, so a directory at
/// the front of PATH containing a malicious `nvidia-smi` shadows the real one.
/// Returns None when the binary isn't in any trusted dir; callers skip the
/// detection step in that case.
///
/// On Unix the per-binary policy is **additive**: any name without one falls
/// through to the generic [`UNIX_TRUSTED_DIRS`] scan. Making that an exhaustive
/// allowlist would silently stop resolving `sleep`/`true`, and the two probe
/// timeout regression tests would go green while no longer testing anything.
///
/// **The Unix scan is `cfg`-gated OFF on Windows, and that gate is
/// security-critical.** These are POSIX paths, but they are not inert on
/// Windows: `PathBuf::from("/usr/bin").join("nvidia-smi.exe")` resolves against
/// the current drive as `C:\usr\bin\nvidia-smi.exe`, and the default `C:\` ACL
/// lets an unprivileged user create `C:\usr\bin` and own what is inside it. The
/// server would then execute an attacker-supplied binary as its own user and
/// parse its stdout as the host's CUDA version. This was harmless before only
/// because the old resolver joined the bare name (`…\nvidia-smi`, which
/// `CreateProcess` will not launch) — adding `EXE_SUFFIX` is exactly what would
/// have armed it. Leaving it on would reopen F-14 on the very platform this
/// change exists to support, and would bypass the `USER_SETTABLE` split below
/// without the attacker needing any environment variable at all.
fn resolve_system_binary(name: &str) -> Option<std::path::PathBuf> {
    // "" on Unix, ".exe" on Windows. Compile-time is correct here for the same
    // reason `host_platform` gives: a Windows binary only runs on Windows.
    let file_name = format!("{name}{}", std::env::consts::EXE_SUFFIX);

    #[cfg(windows)]
    {
        for dir in windows_trusted_dirs(name, |var| std::env::var(var).ok()) {
            let candidate = std::path::PathBuf::from(dir).join(&file_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        // No POSIX fallback here — see the doc comment above.
        return None;
    }

    #[cfg(not(windows))]
    {
        for dir in UNIX_TRUSTED_DIRS {
            let candidate = std::path::PathBuf::from(dir).join(&file_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        None
    }
}

/// Hard cap on how long a single host/GPU probe subprocess may run. A cold
/// `nvidia-smi` can take tens of seconds (driver/GPU init) — and with no cap a
/// slow probe stalls the whole `/detect-gpu` handler, so the proxy in front of
/// it returns 502 and the settings-page GPU card never renders. We'd rather
/// treat a probe that won't answer in a few seconds as "unavailable" and fall
/// through to the cheap library-existence checks.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// Run a resolved binary and capture its output, abandoning the wait after
/// `timeout`. Returns None on spawn error or timeout. On timeout the worker
/// thread + its child are detached (not killed) — the child is a read-only
/// vendor probe that exits on its own shortly after; we just stop waiting.
fn probe_command_with_timeout(
    bin: std::path::PathBuf,
    args: &[&str],
    timeout: Duration,
) -> Option<std::process::Output> {
    let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(Command::new(bin).args(&owned).output());
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Some(output),
        // spawn error, sender dropped, or timed out → caller treats as "no signal"
        _ => None,
    }
}

/// Resolve a trusted system binary then run it under [`PROBE_TIMEOUT`].
fn probe_trusted(name: &str, args: &[&str]) -> Option<std::process::Output> {
    let bin = resolve_system_binary(name)?;
    probe_command_with_timeout(bin, args, PROBE_TIMEOUT)
}

/// Run a trusted system binary (absolute-path resolved, no `$PATH` lookup)
/// and capture stdout, bounded by [`PROBE_TIMEOUT`]. Used for runtime host
/// probing (`uname`/`sysctl`).
fn run_trusted(name: &str, args: &[&str]) -> Option<String> {
    let out = probe_trusted(name, args)?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The OS family the process is **actually running on**, probed at runtime
/// (`uname -s`) rather than read from the compile-time target. Maps to the
/// release-artifact platform token (`linux`/`macos`/`windows`).
///
/// Runtime detection matters because "what host am I on" must not be coupled
/// to "what target was I built for" (e.g. a binary run under emulation, or a
/// universal build). On Windows there is no `uname`; a Windows binary only
/// runs on Windows, so the compile-time constant is the correct fallback.
pub fn host_platform() -> String {
    // Memoized: the host OS is stable for the process lifetime, so the `uname`
    // spawn runs once (not on every detect-gpu / check-updates call).
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            if let Some(uname) = run_trusted("uname", &["-s"]) {
                let s = uname.trim().to_lowercase();
                if s.contains("darwin") {
                    return "macos".to_string();
                }
                if s.contains("linux") {
                    return "linux".to_string();
                }
            }
            match std::env::consts::OS {
                "macos" => "macos",
                "windows" => "windows",
                _ => "linux",
            }
            .to_string()
        })
        .clone()
}

/// The CPU architecture the process is **actually running on**, probed at
/// runtime. On macOS this detects the *native* arch even when the binary is
/// translated by Rosetta 2 (`sysctl hw.optional.arm64`), so we never pull an
/// x86_64 engine onto Apple Silicon. Maps to the artifact arch token
/// (`x86_64`/`aarch64`).
pub fn host_arch() -> String {
    // Memoized for the same reason as host_platform.
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            if host_platform() == "macos" {
                // Rosetta-translated x86_64 processes still report the *native*
                // arm64 via this sysctl, so we get the right engine slice.
                if let Some(out) = run_trusted("sysctl", &["-n", "hw.optional.arm64"]) {
                    if out.trim() == "1" {
                        return "aarch64".to_string();
                    }
                    return "x86_64".to_string();
                }
            }
            if let Some(m) = run_trusted("uname", &["-m"]) {
                return match m.trim() {
                    "x86_64" | "amd64" => "x86_64".to_string(),
                    "aarch64" | "arm64" => "aarch64".to_string(),
                    other => other.to_string(),
                };
            }
            match std::env::consts::ARCH {
                "aarch64" => "aarch64",
                _ => "x86_64",
            }
            .to_string()
        })
        .clone()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuBackend {
    Cpu,
    Cuda,
    /// Metal is only constructed on macOS (behind `#[cfg(target_os =
    /// "macos")]`). The `allow(dead_code)` prevents a false positive on
    /// Linux builds.
    #[allow(dead_code)]
    Metal,
    Rocm,
}

impl GpuBackend {
    pub fn as_str(&self) -> &'static str {
        match self {
            GpuBackend::Cpu => "cpu",
            GpuBackend::Cuda => "cuda",
            GpuBackend::Metal => "metal",
            GpuBackend::Rocm => "rocm",
        }
    }

    /// Parse a backend name to its enum variant.
    /// Only used from test code. The allow is because dead_code does not
    /// count `#[cfg(test)]` usage as live.
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "cpu" => Some(GpuBackend::Cpu),
            "cuda" => Some(GpuBackend::Cuda),
            "metal" => Some(GpuBackend::Metal),
            "rocm" => Some(GpuBackend::Rocm),
            _ => None,
        }
    }
}

/// Full detection result for the `/detect-gpu` endpoint (P3).
#[derive(Debug, Clone)]
pub struct GpuDetection {
    /// All backends usable on this host (always includes "cpu").
    pub available: Vec<String>,
    /// The recommended backend (the priority winner).
    pub recommended: String,
    pub platform: String,
    pub arch: String,
}

/// Detect ALL available backends + the recommended one. CPU is
/// always available. Used by the `/detect-gpu` endpoint to power
/// the settings-page GPU card.
pub fn detect_all() -> GpuDetection {
    let mut available = vec![GpuBackend::Cpu.as_str().to_string()];

    if is_cuda_available() {
        available.push(GpuBackend::Cuda.as_str().to_string());
    }
    #[cfg(target_os = "macos")]
    {
        if is_metal_available() {
            available.push(GpuBackend::Metal.as_str().to_string());
        }
    }
    if is_rocm_available() {
        available.push(GpuBackend::Rocm.as_str().to_string());
    }

    GpuDetection {
        recommended: detect_gpu_backend().as_str().to_string(),
        available,
        platform: host_platform(),
        arch: host_arch(),
    }
}

/// Detect the best available GPU backend for the current system
/// Priority: CUDA > Metal > ROCm > CPU
pub fn detect_gpu_backend() -> GpuBackend {
    // Check for NVIDIA CUDA
    if is_cuda_available() {
        // Name the version and its source here too, not only on the
        // `recommend_backend` path. This function is what `/detect-gpu` (the
        // settings-page GPU card) reaches; `recommend_backend` is only reached
        // by the release-listing endpoints. Without this, a user who opened the
        // GPU card and then read the log found "Detected NVIDIA GPU" and no
        // evidence at all — which is the situation this whole change exists to
        // fix. `cuda_evidence()` is memoised, so the detail is computed once.
        match cuda_evidence() {
            Some(e) => tracing::info!(
                cuda_version = %e.version,
                source = e.source.as_str(),
                "Detected NVIDIA GPU (CUDA available)"
            ),
            None => tracing::warn!(
                sources_tried = CUDA_SOURCES_TRIED,
                "Detected NVIDIA GPU (CUDA available) but could NOT determine a CUDA \
                 version — engine downloads will fall back to the CPU build"
            ),
        }
        return GpuBackend::Cuda;
    }

    // Check for Apple Metal (macOS only)
    #[cfg(target_os = "macos")]
    {
        if is_metal_available() {
            tracing::info!("Detected Apple GPU (Metal available)");
            return GpuBackend::Metal;
        }
    }

    // Check for AMD ROCm
    if is_rocm_available() {
        tracing::info!("Detected AMD GPU (ROCm available)");
        return GpuBackend::Rocm;
    }

    // Fallback to CPU
    tracing::info!("No GPU acceleration detected, using CPU backend");
    GpuBackend::Cpu
}

/// Where a CUDA version came from, so the decision log names its evidence.
///
/// The split matters. Driver-reported sources answer "what CUDA runtime can
/// this driver execute" — exactly the artifact-selection question.
/// Toolkit-derived sources answer "what happens to be installed here", which
/// is only a proxy: a toolkit newer than the driver over-reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CudaVersionSource {
    SmiVersionFlag,
    SmiBanner,
    SmiQuery,
    NvccRelease,
    CudartSoname,
}

impl CudaVersionSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::SmiVersionFlag => "nvidia-smi --version",
            Self::SmiBanner => "nvidia-smi (banner)",
            Self::SmiQuery => "nvidia-smi -q",
            Self::NvccRelease => "nvcc --version (toolkit)",
            Self::CudartSoname => "libcudart soname (toolkit)",
        }
    }

    fn is_driver_reported(self) -> bool {
        matches!(self, Self::SmiVersionFlag | Self::SmiBanner | Self::SmiQuery)
    }
}

/// Every source tried, for the "could not determine a version" warning. Users
/// reporting the failure should be told what was already attempted.
const CUDA_SOURCES_TRIED: &str =
    "nvidia-smi --version, nvidia-smi, nvidia-smi -q, nvcc --version, libcudart soname";

#[derive(Debug, Clone, Copy)]
struct CudaEvidence {
    version: MajorMinor,
    source: CudaVersionSource,
}

/// `libcudart` locations, shared by the availability check and the version
/// probe so a host that counts as "CUDA available" is the same host we try to
/// read a version from.
const CUDART_PATHS: &[&str] = &[
    "/usr/local/cuda/lib64/libcudart.so",
    "/usr/lib/x86_64-linux-gnu/libcudart.so",
    "/usr/lib/aarch64-linux-gnu/libcudart.so",
    "/usr/lib64/libcudart.so",
];

/// Recover a CUDA version from the resolved `libcudart` soname, no subprocess.
///
/// `canonicalize` follows the WHOLE symlink chain
/// (`libcudart.so → .so.13 → .so.13.3.29`), so this usually yields major AND
/// minor. Note the sibling trick does NOT work for the toolkit directory:
/// `/usr/local/cuda` resolves to `/etc/alternatives/cuda`, not `cuda-13.3`.
fn detect_cuda_version_from_cudart() -> Option<MajorMinor> {
    for path in CUDART_PATHS {
        if let Ok(real) = std::fs::canonicalize(path)
            && let Some(name) = real.file_name().and_then(|n| n.to_str())
            && let Some(version) = gpu_version::parse_cudart_soname(name)
        {
            return Some(version);
        }
    }
    None
}

/// Count devices in `nvidia-smi --query-gpu=name --format=csv,noheader`.
fn parse_query_gpu_count(stdout: &str) -> usize {
    stdout.lines().filter(|l| !l.trim().is_empty()).count()
}

/// Whether `nvidia-smi` enumerates at least one real device.
///
/// Uses the machine-readable `--query-gpu` interface, which is stable across
/// driver releases in a way the human-readable banner is not. It carries NO
/// CUDA-version field (verified via `--help-query-gpu`), so it is a
/// presence/identity source only — never a version source.
fn nvidia_gpu_present() -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(|| {
        let Some(out) = probe_trusted("nvidia-smi", &["--query-gpu=name", "--format=csv,noheader"])
        else {
            return false;
        };
        out.status.success() && parse_query_gpu_count(&String::from_utf8_lossy(&out.stdout)) > 0
    })
}

/// Probe the host's CUDA version, strongest evidence first.
///
/// 1. `nvidia-smi --version` — cheapest: driver/NVML strings only, no per-GPU
///    enumeration (the bare banner walks every GPU's temperature and memory).
/// 2. `nvidia-smi` banner — the path that existed before; kept so nothing that
///    works today regresses.
/// 3. `nvidia-smi -q` — structured, present across driver generations.
/// 4. `nvcc --version` — TOOLKIT, and only with a confirmed device.
/// 5. `libcudart` soname — TOOLKIT, no subprocess, last resort.
///
/// Sources 4-5 are gated behind [`nvidia_gpu_present`] on purpose:
/// `is_cuda_available()` returns true from a `libcudart.so` file check with no
/// driver check at all, so without the gate a box with the toolkit installed
/// and no working driver would newly select a CUDA build — trading a silent
/// downgrade for a loud-but-wrong upgrade.
fn detect_cuda_evidence_uncached() -> Option<CudaEvidence> {
    const DRIVER_PROBES: &[(&[&str], CudaVersionSource)] = &[
        (&["--version"], CudaVersionSource::SmiVersionFlag),
        (&[], CudaVersionSource::SmiBanner),
        (&["-q"], CudaVersionSource::SmiQuery),
    ];

    for (args, source) in DRIVER_PROBES {
        // A `None` here means the probe could not be spawned OR blew the
        // PROBE_TIMEOUT. Both mean `nvidia-smi` is unusable right now, and
        // retrying the same binary with different flags will hit the same wall
        // — so STOP rather than paying the timeout again per variant.
        //
        // This matters because these calls are made synchronously from an
        // `async fn` with no `spawn_blocking` (`handlers.rs` detect_gpu,
        // `binary_manager.rs` check_for_updates). Without the early exit, a
        // wedged driver costs 3 × PROBE_TIMEOUT here plus more below, on a
        // tokio worker — which is the very 502 that PROBE_TIMEOUT was
        // introduced to prevent.
        let Some(out) = probe_trusted("nvidia-smi", args) else {
            tracing::debug!(
                "gpu_detect: nvidia-smi did not answer within the probe timeout; \
                 skipping the remaining driver probes"
            );
            return None;
        };
        if out.status.success()
            && let Some(version) =
                gpu_version::parse_cuda_smi_version(&String::from_utf8_lossy(&out.stdout))
        {
            return Some(CudaEvidence { version, source: *source });
        }
    }

    if !nvidia_gpu_present() {
        return None;
    }

    if let Some(out) = probe_trusted("nvcc", &["--version"])
        && out.status.success()
        && let Some(version) =
            gpu_version::parse_nvcc_version(&String::from_utf8_lossy(&out.stdout))
    {
        return Some(CudaEvidence { version, source: CudaVersionSource::NvccRelease });
    }

    detect_cuda_version_from_cudart()
        .map(|version| CudaEvidence { version, source: CudaVersionSource::CudartSoname })
}

/// Emit the detection verdict exactly once per process.
///
/// This is the answer to "neither spammy nor invisible": it is called from
/// inside the memoising closure, so it fires once no matter how many of the
/// (up to 500) release rows ask for a recommendation.
fn log_cuda_evidence(evidence: Option<CudaEvidence>) {
    match evidence {
        Some(e) if e.source.is_driver_reported() => tracing::info!(
            cuda_version = %e.version,
            source = e.source.as_str(),
            "gpu_detect: CUDA runtime version detected (driver-reported)"
        ),
        Some(e) => tracing::warn!(
            cuda_version = %e.version,
            source = e.source.as_str(),
            "gpu_detect: CUDA version came from the local TOOLKIT, not the driver — the \
             driver could not be queried, so the selected GPU build may fail to load"
        ),
        None if is_cuda_available() || nvidia_gpu_present() => tracing::warn!(
            sources_tried = CUDA_SOURCES_TRIED,
            "gpu_detect: an NVIDIA GPU / CUDA runtime is present but NO CUDA version could be \
             determined — engine downloads will fall back to the CPU build. Please report the \
             output of `nvidia-smi --version`."
        ),
        None => tracing::debug!("gpu_detect: no NVIDIA CUDA runtime detected"),
    }
}

/// Memoised CUDA evidence.
///
/// `recommend_backend` runs once per release row inside `.map()` at three hot
/// sites (`llm_local_runtime/binary_manager.rs:287` and `:407`,
/// `voice/binary_manager.rs:140`) with `per_page` up to 500. Unmemoised, that
/// re-spawned `nvidia-smi` once per row per request. Driver state is fixed for
/// the process lifetime, so `OnceLock` is the right granularity — the same
/// shape `is_cuda_available()` already uses.
fn cuda_evidence() -> Option<CudaEvidence> {
    static CACHE: OnceLock<Option<CudaEvidence>> = OnceLock::new();
    *CACHE.get_or_init(|| {
        let evidence = detect_cuda_evidence_uncached();
        log_cuda_evidence(evidence);
        evidence
    })
}

/// Parse a ROCm release string like `6.1.2-...` (the contents of
/// `/opt/rocm/.info/version`) into `(major, minor)`.
fn parse_rocm_version_str(s: &str) -> Option<(u32, u32)> {
    let tok = s.trim().split(['-', ' ']).next()?; // "6.1.2"
    let mut parts = tok.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((major, minor))
}

/// Host CUDA version the driver supports, if NVIDIA.
///
/// Returns the `(major, minor)` pair the selector takes. An unknown minor is
/// lowered to `0` here — the single boundary where that is safe, because
/// `recommend_backend_for` destructures `Some((host_major, _))` and provably
/// never reads it.
fn detect_cuda_version() -> Option<(u32, u32)> {
    cuda_evidence().map(|e| e.version.as_pair())
}

/// Ordered ROCm version probes.
///
/// Source 1 is UNCHANGED and stays first, so every host that resolves today
/// keeps resolving identically. Sources 2-6 exist because "ROCm available but
/// versionless" currently falls silently to CPU — the same defect class as the
/// CUDA bug, since `recommend_backend_for` requires an exact ROCm major match.
///
/// ⚠ UNVERIFIED: no AMD hardware was available. Sources 2-6 are written
/// against documented layouts, not observed ones. Each is parse-or-skip, so a
/// wrong guess degrades to today's behaviour rather than producing a wrong
/// answer. Deliberately absent: any attempt to GUESS a major when every source
/// is silent — ROCm has no cross-major compatibility guarantee, so a wrong
/// guess loads a build that cannot run, which is strictly worse than CPU.
fn detect_rocm_evidence_uncached() -> Option<(MajorMinor, &'static str)> {
    // 1 — the pre-existing source, byte-identical.
    for (path, label) in [
        ("/opt/rocm/.info/version", "/opt/rocm/.info/version"),
        ("/opt/rocm/.info/version-dev", "/opt/rocm/.info/version-dev"),
    ] {
        if let Ok(raw) = std::fs::read_to_string(path)
            && let Some((major, minor)) = parse_rocm_version_str(&raw)
        {
            return Some((MajorMinor::new(major, Some(minor)), label));
        }
    }

    // 2 — $ROCM_PATH/.info/version, for a non-default install prefix.
    //
    // `$ROCM_PATH` is environment-supplied, so it gets the same treatment the
    // Windows env-derived directories get: absolute, no `..`, and only ever
    // joined with a fixed suffix we control. Without that this is an
    // env-controlled arbitrary-file read. The impact is bounded — the content
    // is parsed for a version and never echoed — but applying the rule in one
    // place and not the other is the inconsistency that becomes a real hole
    // the next time someone extends this.
    if let Ok(root) = std::env::var("ROCM_PATH")
        && is_safe_unix_env_root(&root)
        && let Ok(raw) = std::fs::read_to_string(format!("{root}/.info/version"))
        && let Some((major, minor)) = parse_rocm_version_str(&raw)
    {
        return Some((MajorMinor::new(major, Some(minor)), "$ROCM_PATH/.info/version"));
    }

    // 3 — canonicalize /opt/rocm → /opt/rocm-6.1.2. The AMD mirror of the
    // libcudart soname trick, and the highest-value addition: AMD packages do
    // install to a version-stamped directory with /opt/rocm as the symlink.
    if let Ok(real) = std::fs::canonicalize("/opt/rocm")
        && let Some(name) = real.to_str()
        && let Some(version) = gpu_version::parse_rocm_dir_name(name)
    {
        return Some((version, "/opt/rocm symlink target"));
    }

    // 4 — rocm-smi --version.
    if let Some(out) = probe_trusted("rocm-smi", &["--version"])
        && out.status.success()
    {
        // ONLY the `ROCM version` label. `ROCM-SMI-LIB version` is
        // `rocm_smi_lib`'s own semver and is DECOUPLED from the ROCm release —
        // ROCm 6.x ships librocm_smi64.so.7 — so reading it here would report
        // major 7 for a ROCm 6 host. Today that merely degrades to CPU (no
        // rocm7.* artifact exists), but the moment one is published it would
        // install a build that cannot load. That is precisely the outcome this
        // module refuses to risk elsewhere (DEC-11: never guess a ROCm major),
        // so the lib label is not consulted at all rather than used as a
        // fallback.
        let text = String::from_utf8_lossy(&out.stdout);
        if let Some(version) = gpu_version::find_labeled_version(&text, "rocm version") {
            return Some((version, "rocm-smi --version"));
        }
    }

    // 5 — hipconfig --version.
    if let Some(out) = probe_trusted("hipconfig", &["--version"])
        && out.status.success()
        && let Some((major, minor)) =
            parse_rocm_version_str(&String::from_utf8_lossy(&out.stdout))
    {
        return Some((MajorMinor::new(major, Some(minor)), "hipconfig --version"));
    }

    None
}

/// Memoised ROCm evidence; logs its verdict once per process.
fn rocm_evidence() -> Option<(MajorMinor, &'static str)> {
    static CACHE: OnceLock<Option<(MajorMinor, &'static str)>> = OnceLock::new();
    *CACHE.get_or_init(|| {
        let evidence = detect_rocm_evidence_uncached();
        match evidence {
            Some((version, source)) => tracing::info!(
                rocm_version = %version,
                source,
                "gpu_detect: ROCm version detected"
            ),
            None if is_rocm_available() => tracing::warn!(
                "gpu_detect: an AMD ROCm runtime is present but NO ROCm version could be \
                 determined — engine downloads will fall back to the CPU build. A ROCm major \
                 is deliberately NOT guessed: artifact selection requires an exact major match, \
                 so a wrong guess would install a build that cannot load."
            ),
            None => tracing::debug!("gpu_detect: no AMD ROCm runtime detected"),
        }
        evidence
    })
}

/// Host ROCm release version, if AMD.
fn detect_rocm_version() -> Option<(u32, u32)> {
    rocm_evidence().map(|(version, _)| version.as_pair())
}

/// Extract `(major, minor)` from a backend artifact tag with the given
/// family prefix, e.g. `cuda12.6` + `"cuda"` → `(12, 6)`.
fn parse_backend_version(tag: &str, family: &str) -> Option<(u32, u32)> {
    let rest = tag.strip_prefix(family)?;
    let mut parts = rest.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((major, minor))
}

/// Choose the most suitable backend artifact for a host from the list a
/// release actually published (`available`), given the host's detected GPU
/// versions. Pure (host facts passed in) so it is unit-testable without a
/// real GPU.
///
/// Policy (matches "suitable **major** version"):
/// - macOS → `metal` if published (Apple GPUs are forward/back compatible
///   within the Metal family), else `cpu`.
/// - NVIDIA → among `cuda{maj}.{min}` artifacts with `maj <= host major`,
///   pick the highest (newer drivers run older CUDA toolkits — CUDA is
///   backward compatible; a 12.x build won't run on a driver capped below
///   its major, so we never pick a major above the host).
/// - AMD → among `rocm{maj}.{min}` with `maj == host major` (ROCm has no
///   broad cross-major guarantee), pick the highest minor.
/// - Otherwise → `cpu` if published, else `None`.
pub fn recommend_backend_for(
    os: &str,
    cuda: Option<(u32, u32)>,
    rocm: Option<(u32, u32)>,
    metal: bool,
    available: &[String],
) -> Option<String> {
    let has = |b: &str| available.iter().any(|a| a == b);
    let cpu = || has("cpu").then(|| "cpu".to_string());

    if os == "macos" {
        if metal && has("metal") {
            return Some("metal".to_string());
        }
        return cpu();
    }

    if let Some((host_major, _)) = cuda {
        let best = available
            .iter()
            .filter_map(|tag| parse_backend_version(tag, "cuda").map(|v| (v, tag)))
            .filter(|((maj, _), _)| *maj <= host_major)
            .max_by_key(|((maj, min), _)| (*maj, *min));
        if let Some((_, tag)) = best {
            return Some(tag.clone());
        }
    }

    if let Some((host_major, _)) = rocm {
        let best = available
            .iter()
            .filter_map(|tag| parse_backend_version(tag, "rocm").map(|v| (v, tag)))
            .filter(|((maj, _), _)| *maj == host_major)
            .max_by_key(|((_, min), _)| *min);
        if let Some((_, tag)) = best {
            return Some(tag.clone());
        }
    }

    cpu()
}

/// Pure predicate behind the "we have a GPU but shipped the CPU build"
/// warning.
///
/// Extracted rather than inlined into the `warn!` so the guarantee is
/// unit-testable: an invariant that exists only inside a log line nobody
/// asserts is not a guarantee. Deliberately keyed on GPU *presence*, not on a
/// known version, so it fires for BOTH failure modes — a version that could
/// not be read (the reported bug) and a version read fine with no compatible
/// artifact published.
/// `published` is required, not incidental: a release with NO assets for this
/// platform yields an empty list, `recommend_backend_for` returns `None`, and
/// that is **not a verdict** — nothing was selected, so the CPU build was not
/// selected either. `recommend_backend` runs once per catalogue release, so
/// without this guard the first build-pending row on a perfectly healthy host
/// both emits a factually wrong warning AND spends the one-shot latch, silently
/// swallowing the genuine occurrence later in the same process. That would
/// defeat the entire point of the warning.
fn gpu_present_but_cpu_chosen(gpu_present: bool, published: &[String], chosen: Option<&str>) -> bool {
    if published.is_empty() {
        return false;
    }
    gpu_present && matches!(chosen, None | Some("cpu"))
}

/// Latch so the warning is emitted once per process rather than once per
/// release row (up to 500 per request, times three call sites).
///
/// Accepted cost: it can mask a second, differently-caused occurrence later in
/// the same process. The per-row `debug!` below carries that detail when
/// someone needs it.
static WARNED_GPU_BUT_CPU: AtomicBool = AtomicBool::new(false);

/// Host-aware wrapper over [`recommend_backend_for`]: detects this machine's
/// GPU versions and picks the best artifact from `available`.
pub fn recommend_backend(available: &[String]) -> Option<String> {
    let os = host_platform();
    let cuda = if is_cuda_available() { detect_cuda_version() } else { None };
    let rocm = if is_rocm_available() { detect_rocm_version() } else { None };
    let metal = os == "macos" && is_metal_available();
    let chosen = recommend_backend_for(&os, cuda, rocm, metal, available);

    // Per-call detail, off by default. `RUST_LOG=…gpu_detect=debug` turns the
    // full decision on without the once-per-process latch hiding anything.
    tracing::debug!(
        os = %os,
        ?cuda,
        ?rocm,
        metal,
        published = ?available,
        ?chosen,
        "gpu_detect: local runtime backend selection"
    );

    let gpu_present =
        is_cuda_available() || nvidia_gpu_present() || is_rocm_available() || metal;
    if gpu_present_but_cpu_chosen(gpu_present, available, chosen.as_deref())
        && !WARNED_GPU_BUT_CPU.swap(true, Ordering::Relaxed)
    {
        tracing::warn!(
            ?cuda,
            ?rocm,
            metal,
            published = ?available,
            ?chosen,
            "gpu_detect: a GPU is present but the CPU engine build was selected — either no \
             compatible GPU artifact was published for this release, or the host GPU version \
             could not be read (see the earlier gpu_detect warning for which)"
        );
    }

    chosen
}

fn is_cuda_available() -> bool {
    // Memoized: GPU presence is stable per-process; avoids re-spawning
    // nvidia-smi on every detect-gpu / recommend-backend call (the repeated
    // spawns slowed /detect-gpu enough to 502 on a cold backend).
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(is_cuda_available_uncached)
}

fn is_cuda_available_uncached() -> bool {
    // Fast path: check for CUDA library files first (instant, no subprocess).
    // The subprocess probe (nvidia-smi) is slower and blocks the async runtime
    // on the init path, so it only runs as a fallback when no instant file check
    // matches.
    #[cfg(target_os = "linux")]
    {
        // NOTE this proves the RUNTIME LIBRARY exists, not that a working
        // driver does. That asymmetry is why toolkit-derived version sources
        // are gated behind `nvidia_gpu_present()` — see
        // `detect_cuda_evidence_uncached`.
        if CUDART_PATHS.iter().any(|p| std::path::Path::new(p).exists()) {
            tracing::debug!("Found CUDA libraries in system");
            return true;
        }
    }

    // Fallback: try nvidia-smi command (absolute-path resolved, no PATH lookup).
    // Closes 08-llm-local-runtime F-14 (Low). If the binary is not in
    // any trusted dir we skip this probe.
    if let Some(output) = probe_trusted("nvidia-smi", &[])
        && output.status.success() {
            tracing::debug!("nvidia-smi command succeeded");
            return true;
        }

    false
}

fn is_metal_available() -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(is_metal_available_uncached)
}

/// Metal availability.
///
/// **Deliberately left unchanged by the cross-platform detection work**, and
/// the reasoning is recorded so it is not re-litigated:
///
/// - This function returns `true` on BOTH macOS arms. The Intel arm's
///   `system_profiler` probe falls through to an unconditional `return true`,
///   making it decorative. So replacing the compile-time
///   `#[cfg(target_arch = "aarch64")]` with a runtime `host_arch()` check —
///   which would otherwise look more consistent with `host_arch()`'s
///   deliberate runtime Rosetta detection — has **zero** behavioural delta.
/// - No Darwin toolchain exists on the machine this was written on, so any
///   edit inside the `cfg(target_os = "macos")` block cannot even be
///   type-checked here, let alone run.
/// - The Rosetta hazard that actually matters is selecting an x86_64 *artifact
///   slice* on Apple Silicon, and `host_arch()` already handles that with its
///   runtime `sysctl hw.optional.arm64` probe. Metal availability was never
///   the exposed surface.
///
/// Trading a guaranteed-unverifiable change for a provably nil gain is the
/// wrong trade. If this ever does need touching, the safe form is a pure
/// deletion of both inner `#[cfg(target_arch)]` gates.
fn is_metal_available_uncached() -> bool {
    // Metal is available on all modern macOS with Apple Silicon or modern Intel GPUs
    #[cfg(target_os = "macos")]
    {
        // Check architecture - Apple Silicon always has Metal
        #[cfg(target_arch = "aarch64")]
        {
            tracing::debug!("Running on Apple Silicon (Metal supported)");
            return true;
        }

        // For Intel Macs, try to check via system_profiler
        #[cfg(target_arch = "x86_64")]
        {
            if let Some(output) = probe_trusted("system_profiler", &["SPDisplaysDataType"]) {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    // Metal is supported on macOS 10.11+ with compatible GPUs
                    if stdout.contains("Metal") {
                        tracing::debug!("Metal support detected via system_profiler");
                        return true;
                    }
                }
            }

            // Assume Metal available on modern Intel Macs (macOS 10.15+)
            tracing::debug!("Assuming Metal support on Intel Mac");
            return true;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn is_rocm_available() -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(is_rocm_available_uncached)
}

fn is_rocm_available_uncached() -> bool {
    // Fast path: check for ROCm library files first (instant, no subprocess).
    // The subprocess probe (rocm-smi) is slower and blocks the async runtime
    // on the init path, so it only runs as a fallback when no instant file check
    // matches.
    #[cfg(target_os = "linux")]
    {
        if std::path::Path::new("/opt/rocm/lib/libamdhip64.so").exists()
            || std::path::Path::new("/opt/rocm/hip/lib/libamdhip64.so").exists()
        {
            tracing::debug!("Found ROCm libraries in system");
            return true;
        }
    }

    // Fallback: try rocm-smi command (absolute-path resolved, no PATH lookup)
    if let Some(output) = probe_trusted("rocm-smi", &[])
        && output.status.success() {
            tracing::debug!("rocm-smi command succeeded");
            return true;
        }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gpu_backend_as_str() {
        assert_eq!(GpuBackend::Cpu.as_str(), "cpu");
        assert_eq!(GpuBackend::Cuda.as_str(), "cuda");
        assert_eq!(GpuBackend::Metal.as_str(), "metal");
        assert_eq!(GpuBackend::Rocm.as_str(), "rocm");
    }

    #[test]
    fn test_gpu_backend_from_str() {
        assert_eq!(GpuBackend::from_str("cpu"), Some(GpuBackend::Cpu));
        assert_eq!(GpuBackend::from_str("CPU"), Some(GpuBackend::Cpu));
        assert_eq!(GpuBackend::from_str("cuda"), Some(GpuBackend::Cuda));
        assert_eq!(GpuBackend::from_str("CUDA"), Some(GpuBackend::Cuda));
        assert_eq!(GpuBackend::from_str("metal"), Some(GpuBackend::Metal));
        assert_eq!(GpuBackend::from_str("rocm"), Some(GpuBackend::Rocm));
        assert_eq!(GpuBackend::from_str("invalid"), None);
    }

    #[test]
    fn test_detect_gpu_backend_returns_some_backend() {
        // Should always return a valid backend (at minimum CPU)
        let backend = detect_gpu_backend();
        assert!(matches!(
            backend,
            GpuBackend::Cpu | GpuBackend::Cuda | GpuBackend::Metal | GpuBackend::Rocm
        ));
    }

    /// The exact banner from the bug report, on driver 610.43.02.
    const BANNER_610: &str =
        "| NVIDIA-SMI 610.43.02              KMD Version: 610.43.02     CUDA UMD Version: 13.3     |";

    /// The tag set actually published for linux-x86_64 today
    /// (`engine/download.rs`), NOT the invented `cuda12.6`/`cuda13.0` the
    /// older fixture below uses.
    fn published_today() -> Vec<String> {
        ["cpu", "cuda12.9", "cuda13.2"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    /// TEST-1 [acceptance] INV-1 — the reported bug, end to end through the
    /// pure path. RED before the fix: `left: Some("cpu")`.
    #[test]
    fn banner_610_selects_cuda13_2_not_cpu() {
        let cuda = gpu_version::parse_cuda_smi_version(BANNER_610).map(MajorMinor::as_pair);
        assert_eq!(cuda, Some((13, 3)), "driver-610 banner must yield 13.3");

        let chosen = recommend_backend_for("linux", cuda, None, false, &published_today());
        assert_eq!(
            chosen.as_deref(),
            Some("cuda13.2"),
            "an H200 host on CUDA 13.3 must not be handed the CPU build"
        );
    }

    /// TEST-23 — a major-only version (minor genuinely unknown, e.g. from
    /// `libcudart.so.13`) must still select a CUDA artifact. This is what
    /// proves lowering `minor: None` to `0` cannot break the untouched
    /// selector.
    #[test]
    fn unknown_minor_still_selects_a_cuda_artifact() {
        let cuda = Some(MajorMinor::new(13, None).as_pair());
        let chosen = recommend_backend_for("linux", cuda, None, false, &published_today());
        assert_eq!(chosen.as_deref(), Some("cuda13.2"));
    }

    /// TEST-24 [acceptance] INV-2 — the loud-failure predicate. Both failure
    /// modes must warn; neither healthy case may.
    #[test]
    fn warns_when_gpu_present_but_cpu_chosen() {
        let published = published_today();
        // GPU present, version known, but only a CPU build published.
        assert!(gpu_present_but_cpu_chosen(true, &published, Some("cpu")));
        // GPU present, version could NOT be read — the reported bug.
        assert!(gpu_present_but_cpu_chosen(true, &published, None));
        // Healthy: a GPU artifact was actually selected.
        assert!(!gpu_present_but_cpu_chosen(true, &published, Some("cuda13.2")));
        assert!(!gpu_present_but_cpu_chosen(true, &published, Some("metal")));
        // Healthy: no GPU at all — CPU is the correct answer, stay quiet.
        assert!(!gpu_present_but_cpu_chosen(false, &published, Some("cpu")));
        assert!(!gpu_present_but_cpu_chosen(false, &published, None));
    }

    /// A release with no assets for this platform is NOT a verdict.
    ///
    /// `recommend_backend` runs once per catalogue release, so without this
    /// guard the first build-pending row on a healthy host emits a factually
    /// wrong warning ("the CPU build was selected" — nothing was selected) AND
    /// spends the one-shot latch, silently swallowing the genuine occurrence
    /// later in the same process.
    #[test]
    fn build_pending_release_is_not_a_cpu_fallback() {
        let nothing_published: Vec<String> = Vec::new();
        assert!(!gpu_present_but_cpu_chosen(true, &nothing_published, None));
        // And the selector really does return None for that input, so this is
        // the state actually reached rather than a hypothetical one.
        assert_eq!(
            recommend_backend_for("linux", Some((13, 3)), None, false, &nothing_published),
            None
        );
    }

    /// TEST-25 — the machine-readable presence probe.
    #[test]
    fn query_gpu_output_counts_devices() {
        let four = "NVIDIA H200 NVL\nNVIDIA H200 NVL\nNVIDIA H200 NVL\nNVIDIA H200 NVL\n";
        assert_eq!(parse_query_gpu_count(four), 4);
        assert_eq!(parse_query_gpu_count(""), 0);
        assert_eq!(parse_query_gpu_count("\n  \n"), 0);
    }

    /// TEST-26 — a driver-reported source outranks a toolkit-derived one, and
    /// the distinction is carried, not lost.
    #[test]
    fn driver_sources_outrank_toolkit_sources() {
        for source in [
            CudaVersionSource::SmiVersionFlag,
            CudaVersionSource::SmiBanner,
            CudaVersionSource::SmiQuery,
        ] {
            assert!(source.is_driver_reported(), "{source:?}");
        }
        for source in [CudaVersionSource::NvccRelease, CudaVersionSource::CudartSoname] {
            assert!(!source.is_driver_reported(), "{source:?}");
            assert!(
                source.as_str().contains("toolkit"),
                "a toolkit source must say so in the log: {source:?}"
            );
        }
    }

    /// TEST-27 [acceptance] INV-5 — the authoritative probe must never be
    /// redirectable by a user-settable variable.
    #[test]
    fn nvidia_smi_never_resolves_from_user_settable_env() {
        let hostile = |var: &str| match var {
            "CUDA_PATH" => Some(r"D:\hostile\cuda".to_string()),
            "HIP_PATH" => Some(r"D:\hostile\hip".to_string()),
            "ROCM_PATH" => Some(r"D:\hostile\rocm".to_string()),
            "SystemRoot" => Some(r"D:\Windows".to_string()),
            _ => None,
        };

        // NO binary resolves from a user-settable variable — not the
        // authoritative probe, and not the toolkit binaries either. `rocm-smi`
        // is spawned unconditionally from `detect_all()` on Windows, so
        // letting %HIP_PATH% supply its directory was arbitrary code execution
        // in the server process for anyone who could set one env var.
        for name in ["nvidia-smi", "nvcc", "rocm-smi", "hipconfig"] {
            let dirs = windows_trusted_dirs(name, hostile);
            assert!(
                !dirs.iter().any(|d| d.contains("hostile")),
                "{name} must not resolve from CUDA_PATH/HIP_PATH/ROCM_PATH: {dirs:?}"
            );
            assert!(dirs.iter().any(|d| d == r"D:\Windows\System32"));
        }
    }

    /// A vendor probe must never resolve from a network share. `\\host\share`
    /// is absolute and `..`-free, so path hygiene alone accepts it — and an
    /// earlier version of this test asserted it SHOULD be accepted, which
    /// pinned the worst case rather than guarding against it.
    #[test]
    fn unc_paths_are_refused() {
        assert_eq!(sanitize_env_dir(r"\\attacker\share"), None);
        assert_eq!(sanitize_env_dir(r"\\?\UNC\attacker\share"), None);
        assert_eq!(sanitize_env_dir("//attacker/share"), None);

        let unc = |var: &str| match var {
            "SystemRoot" => Some(r"\\attacker\share".to_string()),
            _ => None,
        };
        assert!(
            windows_trusted_dirs("nvidia-smi", unc).is_empty(),
            "a UNC SystemRoot must contribute no candidate at all"
        );
    }

    /// TEST-28 — Windows dirs come from the environment, never a drive letter.
    #[test]
    fn windows_trusted_dirs_come_from_env_not_drive_letters() {
        let env = |var: &str| match var {
            "SystemRoot" => Some(r"D:\Windows".to_string()),
            "ProgramFiles" => Some(r"D:\Program Files".to_string()),
            "CUDA_PATH" => Some(r"D:\CT\CUDA\v13.3".to_string()),
            _ => None,
        };
        let dirs = windows_trusted_dirs("nvcc", env);

        assert!(dirs.iter().any(|d| d == r"D:\Windows\System32"));
        assert!(dirs.iter().any(|d| d == r"D:\Program Files\NVIDIA Corporation\NVSMI"));
        assert!(
            !dirs.iter().any(|d| d.starts_with("C:\\")),
            "no hardcoded C: drive: {dirs:?}"
        );

        // Missing environment must yield nothing, not panic.
        assert!(windows_trusted_dirs("nvcc", |_| None).is_empty());
    }

    /// TEST-29 — relative and `..` values are refused outright.
    #[test]
    fn windows_trusted_dirs_reject_relative_and_dotdot() {
        assert_eq!(sanitize_env_dir(r"..\evil"), None);
        assert_eq!(sanitize_env_dir("relative"), None);
        assert_eq!(sanitize_env_dir(r"D:\ok\..\evil"), None);
        assert_eq!(sanitize_env_dir(""), None);
        assert_eq!(sanitize_env_dir("   "), None);
        // Local absolute forms ARE accepted; UNC is not (see unc_paths_are_refused).
        assert_eq!(sanitize_env_dir(r"D:\Windows"), Some(r"D:\Windows".to_string()));
        assert_eq!(sanitize_env_dir(r"D:\"), Some("D:".to_string()));

        let env = |var: &str| match var {
            "CUDA_PATH" => Some(r"..\evil".to_string()),
            "SystemRoot" => Some("relative".to_string()),
            _ => None,
        };
        assert!(windows_trusted_dirs("nvcc", env).is_empty());
    }

    /// TEST-29b — the Unix counterpart of the env-path guard, applied to
    /// `$ROCM_PATH`. Without it, an environment-supplied value is joined into
    /// a filesystem read unvalidated.
    #[test]
    fn unix_env_root_rejects_relative_and_dotdot() {
        assert!(is_safe_unix_env_root("/opt/rocm"));
        assert!(is_safe_unix_env_root("  /opt/rocm-6.1.2  "));
        assert!(!is_safe_unix_env_root("opt/rocm"));
        assert!(!is_safe_unix_env_root("/opt/../etc"));
        assert!(!is_safe_unix_env_root("/opt/rocm/.."));
        assert!(!is_safe_unix_env_root(""));
        assert!(!is_safe_unix_env_root("   "));
    }

    /// TEST-30 — DEC-4. A name with no per-binary policy must still resolve
    /// via the generic scan. Without this the two probe-timeout regression
    /// tests below would silently stop running: they are written
    /// `let Some(x) = … else { return }`, so they would go green while
    /// testing nothing at all.
    #[test]
    fn unknown_binary_name_falls_back_to_generic_trusted_dirs() {
        assert!(
            resolve_system_binary("uname").is_some(),
            "uname must still resolve after the resolver became name-aware"
        );
        assert!(
            resolve_system_binary("sleep").is_some() || resolve_system_binary("true").is_some(),
            "the timeout tests' binaries must still resolve"
        );
        assert!(resolve_system_binary("definitely-not-a-real-binary").is_none());
    }

    /// TEST-33 — ROCm available but versionless must NOT invent a major.
    #[test]
    fn rocm_without_a_version_never_guesses_a_major() {
        let published: Vec<String> =
            ["cpu", "rocm6.1"].iter().map(|s| s.to_string()).collect();
        // No ROCm version determined → no rocm artifact, and the warning fires.
        let chosen = recommend_backend_for("linux", None, None, false, &published);
        assert_eq!(chosen.as_deref(), Some("cpu"));
        assert!(gpu_present_but_cpu_chosen(true, &published, chosen.as_deref()));
    }

    /// TEST-34 — the only Metal property observable from a non-macOS host.
    /// Documents that the `cfg(target_os = "macos")` gate is what makes the
    /// two untestable macOS arms unreachable here. No macOS claim is made.
    #[test]
    #[cfg(not(target_os = "macos"))]
    fn metal_is_unavailable_off_macos() {
        assert!(!is_metal_available());
    }

    /// TEST-37 — host truth. On a machine with a working `nvidia-smi`, a CUDA
    /// version MUST be recoverable and the selection MUST NOT be `cpu`. This
    /// is the on-box end-to-end proof; it allocates no GPU memory and
    /// downloads nothing. Self-skips loudly elsewhere rather than passing
    /// vacuously.
    #[test]
    fn host_truth_nvidia_host_never_falls_back_to_cpu() {
        let Some(out) = probe_trusted("nvidia-smi", &["--query-gpu=name", "--format=csv,noheader"])
        else {
            eprintln!("SKIP host_truth: nvidia-smi not resolvable on this host");
            return;
        };
        if !out.status.success() || parse_query_gpu_count(&String::from_utf8_lossy(&out.stdout)) == 0
        {
            eprintln!("SKIP host_truth: nvidia-smi resolved but enumerated no GPU");
            return;
        }

        let evidence = cuda_evidence();
        eprintln!(
            "host_truth: gpus={} evidence={:?}",
            parse_query_gpu_count(&String::from_utf8_lossy(&out.stdout)),
            evidence.map(|e| (e.version.to_string(), e.source.as_str()))
        );
        let evidence = evidence.expect(
            "a working nvidia-smi that yields NO CUDA version is exactly the reported bug",
        );

        let published = published_today();
        let chosen = recommend_backend(&published);
        eprintln!("host_truth: chosen={chosen:?}");

        // Only assert "not cpu" when a compatible artifact actually exists for
        // this host's CUDA major. On a host whose driver caps at CUDA 11, no
        // published tag satisfies `maj <= 11`, so `cpu` is the CORRECT answer —
        // asserting otherwise would turn an old-driver runner red and blame it
        // on the bug this test guards.
        let has_compatible = published
            .iter()
            .filter_map(|tag| parse_backend_version(tag, "cuda"))
            .any(|(maj, _)| maj <= evidence.version.major);

        if has_compatible {
            assert_ne!(
                chosen.as_deref(),
                Some("cpu"),
                "an NVIDIA host with CUDA {} must not be handed the CPU build",
                evidence.version
            );
        } else {
            eprintln!(
                "host_truth: no published cuda artifact is compatible with CUDA {} — \
                 cpu is the correct answer here",
                evidence.version
            );
        }
    }

    #[test]
    fn test_parse_rocm_version_str() {
        assert_eq!(parse_rocm_version_str("6.1.2-12345"), Some((6, 1)));
        assert_eq!(parse_rocm_version_str("5.7\n"), Some((5, 7)));
        assert_eq!(parse_rocm_version_str(""), None);
    }

    #[test]
    fn test_parse_backend_version() {
        assert_eq!(parse_backend_version("cuda12.6", "cuda"), Some((12, 6)));
        assert_eq!(parse_backend_version("rocm6.1", "rocm"), Some((6, 1)));
        assert_eq!(parse_backend_version("cpu", "cuda"), None);
    }

    // The published Linux x86_64 backend set from the release matrix.
    const LINUX: &[&str] = &["cpu", "cuda12.6", "cuda13.0", "rocm5.7", "rocm6.1"];
    fn linux() -> Vec<String> {
        LINUX.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn cuda_picks_highest_minor_within_host_major() {
        // Host driver caps at CUDA 12.x → never 13.0, pick the highest 12.
        let r = recommend_backend_for("linux", Some((12, 4)), None, false, &linux());
        assert_eq!(r.as_deref(), Some("cuda12.6"));
    }

    #[test]
    fn cuda_newer_host_runs_older_toolkit() {
        // Host CUDA 13 with both 12.6 and 13.0 → newest installable major.
        let r = recommend_backend_for("linux", Some((13, 1)), None, false, &linux());
        assert_eq!(r.as_deref(), Some("cuda13.0"));
        // Host CUDA 13 but only 12.x published → 12.x still runs (back-compat).
        let only12 = vec!["cpu".into(), "cuda12.6".into()];
        let r = recommend_backend_for("linux", Some((13, 1)), None, false, &only12);
        assert_eq!(r.as_deref(), Some("cuda12.6"));
    }

    #[test]
    fn rocm_matches_host_major_exactly() {
        let r = recommend_backend_for("linux", None, Some((6, 0)), false, &linux());
        assert_eq!(r.as_deref(), Some("rocm6.1"));
        let r = recommend_backend_for("linux", None, Some((5, 5)), false, &linux());
        assert_eq!(r.as_deref(), Some("rocm5.7"));
        // No artifact for host's ROCm major → fall back to cpu.
        let r = recommend_backend_for("linux", None, Some((4, 0)), false, &linux());
        assert_eq!(r.as_deref(), Some("cpu"));
    }

    #[test]
    fn macos_prefers_metal() {
        let mac = vec!["cpu".into(), "metal".into()];
        let r = recommend_backend_for("macos", None, None, true, &mac);
        assert_eq!(r.as_deref(), Some("metal"));
    }

    #[test]
    fn no_gpu_falls_back_to_cpu() {
        let r = recommend_backend_for("linux", None, None, false, &linux());
        assert_eq!(r.as_deref(), Some("cpu"));
    }

    #[test]
    fn none_when_nothing_published() {
        assert_eq!(recommend_backend_for("linux", Some((12, 4)), None, false, &[]), None);
    }

    #[test]
    fn probe_times_out_instead_of_hanging() {
        // A binary that sleeps far longer than the timeout must return None
        // promptly, not block — this is the guard that keeps a slow cold
        // `nvidia-smi` from stalling `/detect-gpu`.
        let Some(sleep) = resolve_system_binary("sleep") else {
            return; // no /usr/bin/sleep on this host; skip
        };
        let start = std::time::Instant::now();
        let out = probe_command_with_timeout(sleep, &["10"], Duration::from_millis(150));
        assert!(out.is_none(), "a probe exceeding the timeout must yield None");
        assert!(
            start.elapsed() < Duration::from_secs(3),
            "must abandon the wait, not block for the child's full runtime"
        );
    }

    #[test]
    fn probe_returns_output_for_fast_binary() {
        let Some(bin) = resolve_system_binary("uname").or_else(|| resolve_system_binary("true"))
        else {
            return;
        };
        let out = probe_command_with_timeout(bin, &[], Duration::from_secs(3));
        assert!(out.is_some(), "a fast probe should return its output");
    }
}
