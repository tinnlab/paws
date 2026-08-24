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
