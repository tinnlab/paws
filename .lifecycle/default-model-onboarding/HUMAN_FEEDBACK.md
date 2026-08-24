# HUMAN_FEEDBACK — default-model-onboarding

**Owner feedback received** on real macOS installs of this branch. Fix round 1
covered FB-1 and FB-2 (build `5be6fbe`, run 32677521319); fix round 2 covers FB-3,
found once FB-1's fix let the install reach the actual download (run 32682504841).
FB-1 is **confirmed fixed by the owner**. The rest of this file predates that round: no feedback
arrived during the original build. One question was escalated
and answered before implementation (recorded as DEC-6): whether "talk to it"
required provisioning the llama.cpp ENGINE as well as the weights. The answer was
**model + engine**, and that is what shipped. Nothing else was asked, and no
review comments arrived.

Everything below is therefore *offered* rather than *responded to* — the things a
reviewer should look at first, because they are judgement calls I made alone.

## FB entries — owner findings on a running build

### FB-1 — install fails with "No local provider exists"

- **FB-1** [status: resolved] — the step read the provider list through a store
  whose loader silently no-ops; it now reads the admin list directly, and the
  three outcomes are reported distinctly. Regression-tested, verified RED.

> The model couldn't be installed — No local provider exists to install into. An
> administrator can add one in Settings → LLM Providers.

**Verified, not assumed.** The message was wrong about the cause, exactly as this
branch's own round-3 ledger predicted. `ensureLocalProvider` read the provider
list through `LlmProviderStore`, whose `loadLlmProviders` early-returns SILENTLY
in three cases — not two: missing permission; `isInitialized && !force`; and
`loading`, an in-flight load that short-circuits **even when `force` is set**, so
the existing `loadLlmProviders(true)` verification was unreliable too. Any of the
three left the step reading an empty snapshot and reporting that the provider did
not exist — telling the user to create something the server had all along.

**Fix:** the step now reads `GET /llm-providers` (the admin list, which returns
providers regardless of `enabled`) **directly**, for both the initial lookup and
the post-enable verification. A direct read cannot no-op. Three outcomes are now
reported distinctly, as required:

| situation | message |
|---|---|
| read succeeded, no local provider | "No local provider exists to install into…" (now accurate) |
| read refused (401/403) | "Your account is not allowed to read the list of LLM providers…" |
| read failed (transport) | "The list of LLM providers could not be loaded… Check your connection and try again." |

The fourth case — "the list is stale" — is **eliminated by construction** rather
than given a message, the same way the unreachable `cancelled` state was deleted
rather than rendered. Reading fresh means there is no stale case to report.

**Regression tests:** `ensureLocalProvider.store.test.ts` now holds the store
snapshot permanently EMPTY while the API serves the real list, so any
re-introduction of a store read turns the whole file red — not just the one case
named for the defect. Four cases are named for FB-1 (store-initialised-and-empty;
read-failure distinct from none-exist; permission named distinctly; a provider
beyond page 1, since the server caps `per_page` at 100). **Verified RED**:
restoring the store read fails 14 of 18, including the named case.

### FB-2 — Onboarding does not open after installing the app

- **FB-2** [status: wontfix] — reproduced and diagnosed, but NOT changed here:
  the cause is a deliberate, documented, pre-existing admin exemption in shared
  onboarding code that this branch does not touch. `wontfix` is the closest
  status this file's vocabulary offers and means "not fixed in THIS branch,
  handed back as a follow-up" — it is emphatically not "dismissed". The impact on
  this feature is real and is spelled out below, with three options for the owner.

> the onboarding does not open after installing

**Reproduced as reading (a)** — after installing the APP, Onboarding does not
appear on launch. Not reading (b): FB-1 means the model install never succeeded,
so there was no post-model-install state to fail to advance from.

**Mechanism, confirmed in code and by a passing test:**
`shouldRedirectToOnboarding` returns `null` when `isAdmin`, and the desktop's
auto-login mints a session for the user literally named `admin`
(`mint_admin_login` → `get_by_username("admin")`). So on the desktop shell,
Onboarding **never auto-opens for anyone, ever** — the only ways in are the two
"Onboarding" buttons on the Settings page. The owner reaching the model step at
all is consistent with this: they got there via Settings.

**This is deliberate, documented, pre-existing behaviour, and not caused by this
feature.** `OnboardingRedirect`'s own docstring states the rationale — forcing an
admin through the wizard traps the phone-over-tunnel session in a loop it cannot
escape — and it is pinned by the pre-existing test `never force-onboards an
admin`, which passes on `main`. The file is not in this branch's diff.

**Why I did not absorb it:** changing who gets force-onboarded is a product
decision with real blast radius (it exists to prevent a known trap), and it is
shared onboarding behaviour rather than this feature's. Rule B3 and the fix
brief's own instruction both point at recording it.

**But it matters for this feature, so it should not be filed and forgotten:** the
default-model step lives inside a wizard that the desktop's only user never sees
automatically. On the platform where a no-API-key local model matters most, the
feature is undiscoverable without visiting Settings. Options for the owner, in
increasing blast radius: (a) surface the default-model install outside the wizard
too (e.g. on the model picker's empty state); (b) exempt the *desktop* shell from
the admin skip, since the phone-over-tunnel trap that motivated it does not apply
there; (c) drop the admin exemption and fix the trap separately.

### FB-3 — LFS download dies instantly with EROFS

- **FB-3** [status: resolved] — LFS objects were staged in the process CWD,
  which for a Finder-launched `.app` is `/`, the read-only macOS system volume.
  Staged in the object's cache directory now. Regression-tested, verified RED.

> The model couldn't be installed
> Failed to download LFS files: Git error: TempFile error: Read-only file system
> (os error 30) at path "/./03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8.lfstmp"
> You can retry, or continue — you can install it later from Settings.

**The lead's diagnosis was correct, and I verified it end-to-end rather than
taking it.** The chain, each link checked:

1. `service.rs` had exactly ONE staging site (grepped `tempfile_in`/`lfstmp`
   across `utils/git/`) — `const TEMP_FOLDER: &str = "./"`.
2. `tempfile` 3.27's `util.rs:33` makes a relative base **absolute against the
   CWD**, and `absolute()` does not normalize `.`.
3. So `CWD = /` yields literally `/./<oid>.lfstmp` — the exact string the owner
   saw. That leading `/.` is the FINGERPRINT of the diagnosis, not a
   contradiction of it; it is what told me the CWD really was `/` rather than
   some other unwritable directory.
4. `at path "…"` is `tempfile`'s own `PathError` Display (`"{err} at path
   {path:?}"`), confirming the failure came from the staging call and not from a
   later rename.
5. macOS ≥ 10.15 mounts `/` read-only ⇒ `os error 30`.

**Fix:** `download_file` takes a `staging_dir` parameter; the caller passes
`cache_dir`, which it already `create_dir_all`s immediately above. The final
`rename` therefore becomes same-directory — atomic and same-filesystem by
construction — and the multi-GB object never crosses volumes.

**Pre-existing, not introduced by this branch.** `TEMP_FOLDER = "./"` is shared
`ziee` git-utils code that predates PR #10. It was invisible upstream because a
server's CWD is a writable app dir. Unlike FB-2 this is not a product decision —
a process may not assume anything about its CWD — so it is fixed here.

**Tests** (`utils::git::lfs::service::tests`, both **verified RED** — restoring
`"./"` fails both, with the failure printing `left: …/src-app/server` (the CWD)
against `right: /tmp/.tmpXXXX` (the staging dir)):
- `staging_file_is_created_in_the_directory_it_was_given` pins the temp file's
  **parent directory**. "The download succeeded" would have passed on the broken
  code whenever the CWD happened to be writable — which is precisely why this
  shipped.
- `staging_leaves_no_temp_file_in_the_process_cwd` pins the same invariant from
  the other side.

**Stated limit, not substituted away.** Neither test literally runs with a
read-only CWD. Doing so means mutating the **process-global** current directory
inside a binary that runs ~1500 tests in parallel threads, which risks breaking
unrelated tests that resolve relative paths; isolating it in a child process
would be far more apparatus than a ten-line fix warrants, and this repo has
already paid twice for oversized test rigs. The CWD-cleanliness assertion covers
the same property without touching global state. What remains unproven by test is
the OS-level EROFS behaviour itself, which only a macOS run can show — hence the
owner's retest.

**Also corrected while here:** two comments that were actively false — the EXDEV
fallback's claim that "tempfile picks the OS default /tmp" (it picked `./`), and
"the OS reaps /tmp anyway" (the temp file is in the LFS cache dir, which nothing
reaps). The fallback itself is kept deliberately — see DEC-17.

### FB-4 — the 30-minute LFS cap is a hard 25.2 Mbps floor

- **FB-4** [status: resolved] — owner-approved in this round (superseding the
  "not in scope" line in FIX-2). The absolute cap is replaced by a stall timeout
  plus a size cap; recorded as a security revision in **DEC-19**, which
  supersedes DEC-15.

The cap was never a flaky-failure problem: 5.68 GB in 30 minutes is a sustained
**3.16 MB/s (~25.2 Mbps)** requirement, so below that the download cannot succeed
no matter how many times it is retried — and with no resume it throws away ~28
minutes of healthy progress first, behind a dialog that says "You can retry".

**Now:** `.read_timeout(60s)` (reqwest resets it on every successful read, so
slow-but-alive survives and silent dies) + a 6h absolute backstop (~2.1 Mbps
floor on the same file) + a hard byte cap at the object's declared size.

**I did not treat the security angle as a formality.** The old cap closes
07-llm-model F-07, so I checked each attack dimension separately rather than
asserting the new bound was fine. Three dimensions get **better** (a silent peer
is now cut off in 60s instead of 30 minutes; unbounded disk consumption is now
bounded by the object's declared size instead of only by the clock). **One gets
weaker**: a server that dribbles just fast enough can hold one task for 6h
instead of 30min. I judged that acceptable — the endpoint is admin-configured,
the cost is one socket and one task, and it stays bounded — and DEC-19 states the
reasoning in full so a reviewer can overrule it with `LFS_ABSOLUTE_BACKSTOP`.

**I found a hole while doing it that nobody flagged.** The streaming loop had
**no byte cap at all**, so "how much disk can a malicious LFS server consume" was
bounded only by the timeout. Simply lengthening that timeout to hours would have
widened the exposure 12×. The size cap closes it properly, which is why the net
result is stronger than what it replaces rather than a trade.

**Blast radius is wider than the desktop bug that prompted it:** `utils/git` is
shared, so this changes LFS behaviour for **web/server deployments too**, not
just the desktop default-model flow.

**Tests** (all in `utils::git::lfs::service::tests`, on a real loopback socket
with millisecond budgets — nothing sleeps for real; the whole file runs in 0.61s):
- `a_slow_but_progressing_transfer_survives_an_absolute_cap_that_would_kill_it`
  carries a **positive control in the same test**: the old absolute-cap-only
  shape kills the identical healthy stream. That is the 30-minute cap in
  miniature, and it is permanent rather than a one-off manual mutation.
- `a_transfer_that_goes_silent_is_cut_off_promptly` — **verified RED**: dropping
  `.read_timeout` makes it fail *and take 30.01s*, falling through to the
  backstop. The stall bound is load-bearing, not decorative.
- `the_metadata_call_keeps_its_own_tight_budget` — the regression a naive fix
  causes, pinned on its own line as asked.
- `an_object_may_not_exceed_its_declared_size` — the new size cap, including the
  `u64::MAX` saturation case.

**Stated limit:** no test drives a full LFS batch+blob flow, so the size cap is
proven at its predicate rather than end-to-end; doing the latter needs a mock LFS
server, which is more apparatus than this change warrants.

**Not chosen:** a per-request `RequestBuilder::timeout` override on the batch POST
would have kept one client, but it makes the tight metadata bound a property of a
single call site that a later edit can silently drop. Two named clients make
neither call able to inherit the other's budget by accident.

### FB-5 — the progress bar sat at 0% for the entire multi-GB download

- **FB-5** [status: resolved] — nothing consumed the LFS progress channel, so the
  download record stayed frozen at "Checking for LFS files...". Now forwarded,
  throttled, in bytes, with speed and ETA. See DEC-20.

> "it stopped at step 2, showing downloading with 0%, and keep being like that,
> I'm not sure if it is running or not" … "it only has 0%, but the model is still
> downloaded."

The transfer was healthy; the UI could not see it. That is its own defect: with
no resume, a user who concludes the app has hung and kills it loses everything.

**Diagnosis verified — and the reported MECHANISM is wrong in a way that hid a
second defect.** The brief (and the ledger note it came from) said the receiver
was "dropped immediately" and every send went into a channel with no receiver,
failing silently. Not so: `_lfs_progress_rx` is an underscore-PREFIXED BINDING,
not the bare `_` pattern, so it stays ALIVE to the end of scope. The sends
therefore SUCCEEDED — and every one of them queued in an unbounded channel that
nothing drained, for the whole 5.68 GB transfer. So alongside the frozen bar
there was steady memory growth proportional to chunk count (order 10^5–10^6
messages, each carrying a heap-allocated `String`), and the converter task inside
`pull_lfs_files_with_cancellation` never took its `is_err()` break either.
Consuming the receiver fixes both; had I only "un-dropped" the receiver as
described, the leak would have survived.

**Also corrected:** the record's `current`/`total` are rendered by
`DownloadItem.tsx` through `formatBytes`, so the pre-existing `current: 20,
total: 100` was being shown to users as the literal string **"20 B / 100 B"**.
They now carry real byte counts.

**Tests** (`llm_model::handlers::lfs_progress::tests`, 7, pure and clock-injected
— no DB, no sleeping): progress ADVANCES across a transfer; the first
observation is never withheld (the complaint was a bar pinned at zero); 10,000
chunk reports coalesce to ≤8 writes; speed/ETA appear once a rate is known and
are withheld rather than fabricated when it is not; a backwards counter produces
neither a wrapped nor a negative ETA.

**One of those tests caught a real bug in my own first implementation**: the rate
window anchored at zero bytes rather than at the first observation, so a transfer
whose first report was non-zero reported a wildly inflated opening rate, and a
backwards counter reported a positive one. Fixed by anchoring on first write.

**Stated limit:** no test drives the real handler end-to-end, so what is proven is
the forwarder's behaviour, not the call site's wiring. The call site is instead
made correct BY CONSTRUCTION — `spawn_forwarder` hands back only the sender, so
the original bug is not expressible there.

### FB-6 — "check if user has installed libseccomp … ask user sudo permission"

- **FB-6** [status: wontfix] — investigation only, as scoped. The premise is
  partly mistaken; the underlying worry is legitimate and there IS a real gap,
  but it is not the one the question assumes. No code changed.

**1. `libseccomp` is not part of the macOS product at all.** It is Linux-only and
target-conditional in `server/Cargo.toml`; the macOS bundle never links it. A
libseccomp check in onboarding would be checking for something that is not used.

**2. I did not add a sudo-install flow, and recommend against one.** A signed,
notarized `.app` should ship self-contained; prompting for admin rights to
install system libraries is both a security smell and a distribution smell, and
it would be the app asking users to work around its own packaging.

**3. The real gap.** `src-app/server/tests/macos_brewless_boot.rs` exists exactly
to prove the bundle boots with no Homebrew dylibs on the runtime path — it
poisons `DYLD_LIBRARY_PATH`/`DYLD_FALLBACK_LIBRARY_PATH` so an accidental dlopen
of a brew dylib fails loudly. It is `#[ignore]`d and referenced by **no**
workflow. So the one test that would catch "works on the dev's Mac, missing a
library on the user's Mac" never runs — which is precisely the failure class the
owner is worried about.

**What I could NOT determine:** the bundle's actual dynamic dependencies. `otool
-L` needs a Darwin toolchain and this is a Linux box. **Proposed way to get the
answer:** add a step to the existing macOS `devbuild` GitHub Actions job that
runs `otool -L` on the built binary plus its bundled dylibs and fails on any
non-OS, non-bundled path (`/opt/homebrew`, `/usr/local`). That is where the
question is cheaply answerable, and it is a few lines.

**Recommendation:** wire `macos_brewless_boot` into the macOS CI job (it is
`--ignored`, boots a libkrun microVM, ~3 s — negligible next to a build) and add
the `otool -L` assertion beside it. **Owner's call**; I did not implement either.

### FB-7 — the model downloads but never runs: ggml backends are `.so` on macOS

- **FB-7** [status: resolved] — a narrow macOS-only shim ships now so users are
  unblocked; the REAL fix belongs in the engine release build and is escalated
  below as the owner's decision. See DEC-21.

**Verified from the published artifact, not taken on report.** I downloaded
`ziee-ai/llama.cpp` `v0.0.3-alpha` `llama-server-macos-aarch64-metal.tar.gz`
(HTTP 200, 12,904,087 bytes) on this box and listed it:

- ships `libggml-cpu.so`, `libggml-blas.so`, `libggml-metal.so`
- ships correct `libggml.dylib`, `libggml-base.dylib`, `libllama.dylib`, …
- has **no** `.dylib` equivalent for any of the three

`strings libggml.dylib`: the `libggml-` backend-prefix literal and
`ggml_backend_load_all` / `ggml_backend_load_best` are present; `.so` occurs
**zero** times.

**A finding the report did not have, and it is the one that makes the shim
correct:** `file` reports all three `.so` modules as **`Mach-O 64-bit arm64
bundle`**. They are correct macOS binaries carrying a Linux extension — only the
NAME is wrong. That is why aliasing them is sound engineering rather than
papering over a mis-built artifact; had they been ELF, no rename would have
helped and the whole release would need rebuilding.

**One honest caveat on the mechanism.** The 5 `.dylib` strings in `libggml.dylib`
are all install-names/dependencies, not a bare `".dylib"` extension literal — a
6-character string is inlined rather than stored, so `strings` cannot settle how
the loader builds the filename. The inference (ggml's
`backend_filename_extension()` returns `.dylib` on Apple) is consistent with
every piece of evidence and with `.so` appearing zero times, but **it is an
inference**. The decisive proof is the owner's symlink retest on their Mac. I am
not claiming the shim works until that returns.

**Escalation — the real fix, and its real cost.** The engine release must name
macOS backend modules `.dylib`. Two constraints shape how to do that:

- **The engine repos are SHARED with other instances.** Per the owner's standing
  rule, paws builds any engine fix on its **own repo/branch** first, and whether
  it ever goes to that repo's `main` is a separate, later decision — same shape
  as the sdk `paws` branch. So this is explicitly **not** "open a PR upstream".
- **A shipped app cannot be redirected by configuration.** Verified:
  `engine_repo()` (`llm_local_runtime/engine/download.rs:241`) returns a
  hardcoded `&'static str`, and the `LLM_RUNTIME_RELEASE_MIRROR` /
  `LLM_RUNTIME_API_MIRROR` overrides are `cfg(debug_assertions)` — compiled out
  of release builds. Pointing paws at a paws-owned engine line therefore needs a
  **paws code change**, plus its **own GitHub Actions release pipeline on macOS
  runners**, because the engine is consumed as a release artifact rather than a
  checkout.

So: the shim is cheap and unblocks users today; owning the engine line is a
genuine project (own repo + release pipeline + a code change), not a one-line
redirect. **I did not start that work** — FB-7 is a recommendation.

### FB-8 — the model is stored twice (models 5.3 GB + cache 5.3 GB)

- **FB-8** [status: wontfix] — real and confirmed, but NOT improvised away: it is
  already bounded by an existing retention policy, and shortening that is a
  disk-vs-bandwidth product decision. Escalated with a concrete proposal.

**Confirmed at the mechanism:** `uploads.rs` does
`tokio::fs::copy(&source_path, &dest_path)` from the clone cache into model
storage and nothing reclaims the cache at the end of the download. So a freshly
installed 5.68 GB model does occupy ~11.4 GB.

**But it is NOT permanent, which changes the recommendation.** `llm_model::prune`
already sweeps the git and LFS caches — `evict_dir_by_mtime(git_cache_dir)` and
`(lfs_cache_dir)` with `CACHE_UNUSED_DAYS = 30`. The duplication therefore
self-heals after 30 days of non-use; it is a 30-day 2× cost, not a permanent one.
Reporting it as "every model costs users double" would have overstated it.

**Why I did not just delete the cache after the copy** (the obvious one-liner):
it changes an existing, deliberate retention policy; the cache legitimately
serves a second install from the same repo without re-downloading; and a
concurrent download from the same repo could be reading it. That is exactly the
"needs a real retention policy, escalate rather than improvise" case.

**Proposal, for the owner to choose:**
1. *Cheapest and probably right for a desktop app*: after a SUCCESSFUL copy,
   evict just the LFS object(s) that download materialised, leaving the rest of
   the cache and the 30-day policy alone. Bounded, targeted, no policy change.
2. *Policy tuning*: lower `CACHE_UNUSED_DAYS` for the LFS cache specifically —
   multi-GB blobs are a different economic case from small git objects.
3. *Make it visible*: surface cache size with a "reclaim" action in settings, so
   the user decides. Most transparent, most work.

I recommend (1), and did not implement it because it is still a behaviour change
to shared download code in a round that already carries three fixes.

### FB-9 — no local model has ever been usable in the desktop app

- **FB-9** [status: resolved] — the desktop never captured its own listen
  address, so every local provider resolved to port 3000 while the app bound
  8080-8180. Chat sent requests to a port nothing listened on. See DEC-23.

**This is the root cause of the hang, and it supersedes FIX-5's THEORY of why
chat hung.** The ggml shim (FB-7) fixes a real, separate defect and stays — but
it was not the cause of this symptom. The owner's decisive evidence: with
`llama-server` manually started and the model loaded, chat STILL hung and `ps`
showed the engine at **0.0% CPU**. It was idle. No request ever reached it.

**Verified independently, every link:**

1. `grep -rn set_server_addr --include=*.rs src-app/ sdk/` → exactly ONE
   production caller: `src-app/server/src/main.rs:195`, the standalone server
   binary. **Nothing under `src-app/desktop/`.**
2. The fallback is `("127.0.0.1", 3000, "/api")`
   (`sdk/crates/ziee-core/src/app_state.rs:76-78`).
3. Local providers store `base_url` NULL and have it injected at READ time —
   `llm_provider/repositories/admin.rs::inject_runtime_fields` calls
   `get_server_addr()` → `derive_proxy_url()`, on *every* read site.
4. The desktop binds a port from `find_available_port(8080, 8180)`.

⇒ On desktop every local provider resolved to
`http://127.0.0.1:3000/api/local-llm/v1`.

**State plainly, as asked: no local model has ever been usable in the desktop
app.** This is NOT a regression from this feature. The feature is simply the
first thing that got a local model far enough along to expose it — before this,
nothing in the desktop shipped a local model to try. It is desktop-only; the
server binary sets the address correctly, which is why ziee web never saw it.

**Fix:** the desktop boot captures the address from the RESOLVED config, before
the server starts or any provider is read. Two details that matter and are easy
to get wrong: the port is read from `config.server.port`, not from the
`find_available_port` result — the config may equally have been LOADED from a
file in the other branch, and only the config object is guaranteed to be what
the server binds; and `api_prefix` comes from the config rather than a hardcoded
`/api`, because routes nest under whatever it says.

**Tests** (`ziee-desktop`, `desktop_boot_captures_the_bound_server_addr_not_the_default`):
asserts the captured tuple matches the config AND that the DERIVED provider URL
carries the bound port and is not `:3000`. Asserting the derived URL rather than
just the tuple is deliberate — the tuple being right is not the property that
matters; the URL a provider read hands to chat is. **Verified RED**: removing the
capture fails it with `left: 3000, right: 8137`.

**Stated limit:** no test here proves end-to-end chat works on macOS. The owner's
retest is the proof.

### FB-10 — a chat that goes nowhere produced no error, no timeout, no log

- **FB-10** [status: resolved] — the contained half is fixed (the failure is now
  logged); the remaining half is reported below rather than changed, because it
  is shared streaming behaviour.

**What I found, tracing the path the report named:**

- `chat/core/ai_provider/mod.rs` propagates correctly with `?` — nothing is lost
  there.
- The real branch is `chat/core/services/streaming.rs`, where
  `provider_for_task.chat_stream(...)` returns `Err`. The error **was** forwarded
  to the stream channel (`tx.send(Err(...))`) — so it was not dropped — but there
  was **no `tracing::error!` anywhere on that branch**. That is exactly why the
  owner's log stopped dead after `"Adding N tools to ChatRequest"`: the failure
  was recorded nowhere server-side, and diagnosing it required reading source.

**Fixed here (contained):** that branch now logs at `error!` with the
conversation id before forwarding. One line, no behaviour change to the stream.

**NOT fixed, and why — this is the part I am escalating.** I could not establish
from source alone *why the UI spun forever* rather than showing the error that
was forwarded. Two candidates, and they need different owners:

1. The error reaches the SSE stream and the **frontend** does not surface it —
   a UI change.
2. `chat_stream` never returned at all. A loopback connect to a dead port gives
   ECONNREFUSED essentially instantly, so this should not happen — **unless
   something else on the user's Mac was listening on port 3000**, which is a very
   common dev port. In that case the request went to a foreign server that never
   answered, and the absence of any client-side timeout on that path is the real
   defect.

Candidate (2) is worth the owner's attention precisely because it is plausible on
a developer's machine, and it changes the fix: a wrong-port request that is
REFUSED fails fast, but one that is ACCEPTED by an unrelated process hangs until
something times it out. I did not add a timeout to the shared provider streaming
path on my own judgement — that is a shared change affecting every provider, and
picking a bound is a product decision of the same kind as DEC-19.

**Recommendation:** an end-to-end request deadline on the chat streaming path, so
no provider — local or remote, reachable or not — can leave the UI spinning
indefinitely. Owner's call on the bound.

### FB-11 — editing a shipped migration bricks every upgraded install

- **FB-11** [status: resolved] — my defect, and the worst one in this series: the
  mirror swap EDITED an already-applied migration instead of adding a new one, so
  any machine that had run an earlier build failed to boot. Restored and re-done
  additively; a guard now makes the mistake unshippable. See DEC-25.

> "Load failed" + the first-run admin login page

**That is not an auth bug — the backend never starts.** Verified: the migrator
(`core/database/mod.rs`) is `sqlx::migrate!` with `set_ignore_missing(true)` and
nothing else. That flag ignores migrations present in the DB but absent from
source; it does **not** disable checksum validation. So on boot sqlx checksums
`202607210100`, finds it differs from `_sqlx_migrations`, and aborts. No
migrations ⇒ no embedded server ⇒ every API call fails ⇒ with no session the UI
falls back to first-run setup. Auto-login was never the problem.

**A FRESH install of the same build works.** That is exactly why it shipped:
every test in this repo runs against a fresh database, so the only broken path
was the upgrade — the one real users take.

**Fix:** `202607210100` is restored to its previously-shipped bytes (verified
byte-identical to `281b4c009^`), and the mirror swap moved to a NEW migration
`202607210200_llm_repository_default_model_mirror.sql` in the same module
sequence. The UPDATE is guarded on the OLD url, which makes it idempotent, a
no-op once applied, and — deliberately — **silent on a row somebody has since
pointed elsewhere**: `built_in` rows are edit-denied in the UI, so a divergent
value means a deliberate manual change, and a migration that overwrote it would
be reversing a human decision.

**Do NOT tell the owner to wipe `postgres-data`.** It would fix the boot, but the
mirror swap changes the LFS cache key and they would re-download 5.68 GB. The
rebuild migrates their existing database in place.

**Guard — and what it does NOT cover.** New test
`server/tests/migration_immutability.rs` asserts every tracked migration is
byte-identical to **its first commit**. I chose first-commit rather than a branch
baseline after the branch version proved wrong in both directions: it would miss
an edit that had itself been pushed, and it flagged this very repair (restoring
the bad edit) as a violation.

Stated plainly, because the brief asked and because it matters:
- **It does not execute a migration.** It compares bytes. **Nothing in this repo
  proves an upgraded database actually migrates** — I did not build the two-stage
  harness, because it needs the shared test-harness DB bootstrap that rule B3
  says not to reshape for one feature. That remains a genuine gap.
- Its baseline is what was **committed**, not what was **built**; a build cut
  from an unpushed commit is invisible to it. (The one that broke the owner came
  from a pushed commit, so this would have caught it.)
- It skips loudly, not silently, without git.

**It also surfaced four PRE-EXISTING violations on `main`** — migrations in
`chat`, `file`, `memory` and `notification` edited after their first commit,
none touched by this branch. They are grandfathered in an explicit list that
*may only shrink*, with a companion test that fails if an entry goes stale.
Rewriting their bytes now would itself be an edit to a shipped migration.

**Verified RED**: restoring the edited-in-place version fails the guard naming
that exact file.

**Proposal for the owner (not built):** this generalises well beyond one feature
— any edit to a shipped migration silently bricks every existing install with a
message that looks like a network fault. Worth running this guard in CI for the
whole repo, and worth a real upgrade test that applies a previously-shipped
migration set to a live database and then the current one on top. Both are
owner-level decisions.

### FB-4 CONFIRMED IN PRODUCTION — first end-to-end proof of the stall timeout

A live 5.68 GB transfer was inspected mid-flight on the running Linux instance:
**5,147,144,752 / 5,680,522,464 bytes (90.6%), still advancing at ~504 KB/s
(~4 Mbps)** at sample time. It later reached 5,637,699,037 bytes (99.2%).

**That rate is far below the ~25.2 Mbps floor the old 30-minute absolute cap
imposed.** Under the pre-FB-4 code this transfer would have been killed at
roughly 900 MB, with nothing kept and a "retry" that could never succeed. DEC-19
is therefore not a theoretical improvement — it is the reason this download
completed at all. Recorded as the first end-to-end confirmation.

FB-3 is confirmed in the same observation: the blob staged at
`…/cache/git/<repo>/.git/lfs/objects/03/b7/<oid>.lfstmp` — in the cache dir, not
the process CWD.

### FB-12 — the bar still read 0%, because the UI never received the numbers

- **FB-12** [status: wontfix] — **REASSIGNED. Diagnosed here, fixed elsewhere.**
  A dedicated worker now owns FB-12 and FB-13 together, cutting from
  `origin/main`. The fix I had written (commit `cdddbba7b`) has been **reverted
  off this branch** so the two lines of work cannot collide in
  `subscribeToDownloadProgress.ts`. Everything below is retained as HANDOVER: the
  root cause is established and evidence-backed, and the incoming owner should
  not have to re-derive it. The reverted fix remains recoverable from
  `cdddbba7b` if they want it as a starting point.

**Established from the running instance, not inferred.** I queried the live
embedded Postgres (port 38759) mid-download:

```
current: 5637699037, total: 5680522464, speed_bps: 1606723, eta_seconds: 26
message: "Downloading model weights — 5.64 GB of 5.68 GB"
```

So **FB-5's write is correct and working**. I also confirmed the running binary
contained that fix rather than trusting the build timeline —
`strings … | grep "Downloading model weights"` matches in the shipped binary.

**The defect is one line, in the consumer.**
`subscribeToDownloadProgress.ts` did `{ ...download, ...update }`.
`DownloadProgressUpdate` is FLAT — `current` / `total` / `speed_bps` /
`eta_seconds` / `message` / `phase` at the top level — while every view renders
`progress_data.*`. The spread grafted stray top-level keys on and left
`progress_data` untouched, so it stayed at its initial zeros. The
`as DownloadInstance` cast is what stopped TypeScript from catching it.

That single store explains **both** reported surfaces: the onboarding step and
the LLM-providers view ("0 bytes / 0 bytes") read the same downloads array.

**Why my FB-5 round missed it:** my test asserted the WRITE. The write was never
the broken half. The new tests assert what a CONSUMER sees — advancing bytes on
`progress_data`, speed/ETA carried through, and a null field not blanking a
figure already known. **Verified RED**: restoring the flat spread fails all
three.

**On the lead's lead:** the "Removed disconnected download monitoring client"
lines are real but are NOT the cause. The SSE loop polls the DB record every
second and broadcasts to whoever is connected; the record was correct throughout.
Those lines are `broadcast_event` pruning senders whose receiver went away
(a navigated-away tab), which is ordinary. The delivery channel was fine — the
payload SHAPE was not.

### FB-13 — the premise is wrong: the answer was NOT dropped

- **FB-13** [status: wontfix] — investigated on the evidence; the reported
  mechanism does not hold, and the latent defect I did find is shared chat-core,
  so it is escalated rather than changed unilaterally.

**What the log actually shows, two lines past the excerpt in the brief:**

```
18:25:00.134  mcp: Message ca5bc26a-… has 1 content blocks
18:25:00.138  mcp:   Content block: type='text', sequence=0
18:25:00.138  mcp: No tool uses found and stop_when_no_tool_calling=true, conversation complete
```

**The message HAS a persisted text content block and the turn completed cleanly
server-side.** So the answer was not lost between accumulation and finalize. The
`get_accumulated_content returned 0 items` line is benign: the text persisted via
the streaming save path rather than through the extension accumulator, which is
why finalize found nothing left to add. Reading that line as "the response was
dropped" is the wrong conclusion, and building a fix on it would have been
building on sand.

Corroborating: `chat turn completed with no user-visible content (empty
completion)` — the warn that fires when a turn genuinely produces nothing —
appears **zero** times in the log. The server did not consider this turn empty.

**So why did the UI spin?** I could not establish that, and I will not guess. It
is a client-side question (the server finished and persisted at 18:25:00; the app
was restarted at 18:29:02), and the instance has since shut down, so I can no
longer query it. Given FB-12 turned out to be a payload-shape mismatch between
server and UI in the *download* stream, the same class of defect in the *chat*
stream is where I would look first — but that is a lead, not a finding.

**A REAL latent defect I did find while looking, worth fixing separately.** The
text extension keys its accumulator by **`conversation_id`**, not `message_id`
(`chat/extensions/text/text.rs`), and `get_accumulated_content` does a
destructive `remove`. Two consequences: any second read for the same conversation
(a retry, a second finalize, a concurrent call) gets zero items; and two messages
in one conversation share a slot. It did not cause the reported symptom — the
content persisted — but it is a genuine trap.

**Not fixed here, deliberately.** Re-keying that accumulator changes shared
chat-core for every provider and every chat path, on a branch that is already
carrying seven rounds of fixes, and I have no evidence tying it to a live
failure. Per the brief's own instruction, escalated with the diagnosis instead.

**REASSIGNED, and the lead reached the same correction independently.** The
owner reloaded the page and the full Anthropic answer was there, persisted —
confirming from the product side what the log showed from the server side:
nothing was lost, only the REALTIME delivery to the UI failed. That makes FB-13
the same underlying problem as FB-12 — an operation that succeeds while the live
update to the UI does not — so both now belong to one dedicated worker, and
neither is mine. I have made no further edits to the chat-streaming or
download-monitoring paths.

## Follow-up NOT done this round (recorded so it is not lost)

**Enforce the pinned `DEFAULT_MODEL_FILE_SHA256`.** The descriptor now declares
the expected digest of the default model file, but nothing compares it against
what is downloaded. The LFS client already verifies bytes against the oid in the
pointer it was served (`ChecksumMismatch`), so transit corruption is covered;
what is NOT covered is the repository publishing a different file at the same
path, which is the exact risk the pin exists to close. Wiring that into the
server download path is its own change with its own tests and must not ride on a
URL swap. The lead is tracking it.

## Decisions a human may want to reverse

**1. The audit loop was stopped at round 3 on judgement, not on a satisfied
condition.** None of the six mechanical termination conditions had fired. I
stopped because the rounds had stopped auditing the FEATURE and started auditing
my previous round's repairs: round 2's findings were in round 1's fix, and round
3's headline finding was a regression introduced by round 2's fix. That is the
shape ABORT exists to describe, arriving two rounds before ABORT is allowed to
fire. `FIX_ROUND-3.md` records it in full. If you would rather see rounds 4-6 run,
that is a reasonable call and the branch is in a state to resume from.

**2. Granting a user group access to the local provider is an access-control
write performed by an onboarding step.** It is bounded three ways — it only grants
as part of provisioning this step performed, it fails closed on a read error, and
it never guesses a group (seeded default, or one literally named `Users`, or an
honest problem message). Without it, an installed model is invisible: the picker
INNER JOINs `user_group_llm_providers` and every send re-checks access with no
admin bypass. It is still a widening of access initiated by a wizard, and worth a
second opinion.

**3. The 5.68 GB download has a ~25 Mbps floor (DEC-15).** The existing LFS
transfer timeout is 30 minutes, which this model's size turns into a minimum
sustained ~3.2 MB/s. A slower connection fails partway. I did NOT raise the
timeout: it is shared code, and the Medium finding it would have closed is really
a product decision about who this default is for. A user on a slow link gets a
clear failure and a Retry, not a corrupt install (INV-4 holds).

## Deferred findings — real, unfixed, each for a stated reason

These were confirmed in the audit and consciously not fixed. None is a defect in
what shipped; each is a gap a reviewer might prioritise differently.

| # | finding | why deferred |
|---|---|---|
| 1 | A failed install shows the raw transport error to a first-run user | needs an error-mapping layer the rest of the app does not have; every sibling download surface shows raw reasons too, so fixing it here alone would be inconsistent |
| 2 | Cancelling a multi-GB transfer takes no confirmation | a product choice about friction, not a correctness bug — and the transfer is resumable by retrying |
| 3 | "Preparing…" shows no progress | the provider/runtime calls underneath expose no per-leg progress; reporting it would mean changing them |
| 4 | No free-disk-space check before a 5.68 GB download | the hardware surface reports no disk figure; this needs a backend addition |

## Repo-level defects found in passing (NOT this feature's, NOT fixed here)

**1. `npm run test:unit` is red on `main`** — 55 failures of 747. The tier's glob
`src/**/*.test.ts` sweeps vitest-authored `*.store.test.ts` files into the
node:test runner, where they fail for want of `vi`. This branch adds 4 more files
to that overlap (all green under vitest, following the established sibling
convention). Fixing the glob means editing shared test configuration, which rule
B3 puts outside a feature branch's scope — but somebody should, because the tier
currently cannot fail meaningfully.

**2. `lifecycle-check`'s A11 message and its result parser disagree.** A11 tells
you to write `NOT VERIFIED`; `RE_RESULT` only accepts `PASS|FAIL|SKIP`, so a
compliant `NOT VERIFIED` line reads as "no result line" and the phase fails. I hit
this on TEST-20 and worked around it, then removed the workaround by binding
TEST-20 to a real test. Worth reconciling in the tool.

## Handover — REQUIRED before this branch is usable by anyone else

The **`sdk` submodule commits `3e1959b`, `5a4f592`, `c38e9fc`** (testid registry
regenerations) must be pushed to `ziee-ai/sdk`. Until they are, the submodule
pointer on this branch does not resolve for anyone else and their `npm run check`
will fail. I do not have push rights to that repo.

## Residual risk, stated plainly

The 5.68 GB download against real Hugging Face is **never exercised by any test**,
by design: the design forbids hitting real HF, and the clone path refuses loopback
fixtures unconditionally (a deliberate SSRF defence I declined to weaken for
testability). INV-1 is instead proven at the credential decision point, over every
input rather than the paths one clone would take. The upstream's existence was
hand-verified once, on 2026-08-23, and that verification is recorded with its date
in `defaultModel.ts` — it is a point-in-time check of a third-party repo, and a
reviewer should treat it as such.
