# DECISIONS — paws-ui-polish

Every human/product input the implementation needs, resolved up front — nothing
left unresolved for implementation to discover.

### DEC-1: Where do the notification and download icons go?
**Resolution:** ONE row inside the existing `sidebarBottom` slot — the same
mechanism on web and desktop. NOT onto the user widget.
**Basis:** user — asked as an explicit option picker after I surfaced the
constraint that decides it: the user widget is **web-only**
(`modules/loader.desktop.ts:45-58` blocklists the `user-profile` module), so the
user-widget route would have meant designing, screenshotting and
regression-testing two different layouts for one request. The owner picked the
single-row option with that constraint in front of them.

### DEC-2: Which skills stop shipping?
**Resolution:** All three sub-scopes: (a) the three built-ins whose SUBJECT is a
hidden feature (`create-workflow`, `troubleshoot-workflow-run`,
`hub-installation`) **plus a migration pruning already-synced rows**; (b) rewrite
the stale Hub-referencing copy in the three surviving skills
(`configure-mcp-servers`, `create-skill`, `use-assistants`); (c) drop the seeded
hub skill `io.github.ziee/effective-prompting`.
**Basis:** user — multi-select picker; the owner chose all three. The enumeration
(13 built-ins, exactly 3 on-subject, 3 with stale copy, 1 seeded hub skill) was
established read-only before asking, and the "removing a directory is not enough"
finding was in the question so the migration was chosen knowingly.

### DEC-3: Hide the seeded tinnlab repository row?
**Resolution:** **No — descoped.** The row stays visible. No code, no migration,
no read-seam filter.
**Basis:** user — the owner withdrew the request during planning ("I changed my
mind, let's just keep it for now") when asked whether the hide should also cover
the admin "Download from Repository" dropdown, which reads the same list.

- DESCOPED: ITEM-11 — the owner withdrew the request during planning; hiding the tinnlab repository row is not built on this branch and the row stays visible [approved: owner, planning session, this branch]

### DEC-4: Which download path does item 5's reproduction have to cover?
**Resolution:** **Both.** The Onboarding default-model step is the path the owner
actually used; the Add-Local-Model drawer is checked as well.
**Basis:** user — "I did on the Onboarding, but please check both". The two
differ materially: onboarding also enables the Local provider, provisions a
runtime and grants a group, so a defect present in only one of them would be
mis-attributed if only one were driven.

### DEC-5: Does harmonising the two widget triggers (ITEM-5) edit the sdk?
**Resolution:** **No — the ROW owns the layout.** `LeftSidebar.tsx`'s new row
container supplies the spacing/alignment; the two trigger components keep their
own internal padding unless the row demonstrably cannot be made correct without
changing them. If it genuinely cannot, that becomes its own sdk branch cut from
`origin/paws` plus a submodule-pointer bump — never an implicit submodule edit.
**Basis:** convention — the sdk is a submodule pinned by `.gitmodules` to the
`chat` branch while paws consumes `paws`; the realtime-sse work recorded that
trap explicitly. Keeping a layout concern in the layout file also matches how the
other five slot containers in that file already work.

### DEC-6: How does the prune migration (ITEM-7) select rows?
**Resolution:** By **exact `name` list**, scoped to `scope = 'built_in'` —
`DELETE FROM skills WHERE scope = 'built_in' AND name IN ('io.github.ziee/create-workflow', 'io.github.ziee/troubleshoot-workflow-run', 'io.github.ziee/hub-installation')`.
Not by prefix, not by a "not in the current set" reconciliation.
**Basis:** convention — a data migration that deletes should name what it
deletes, so the diff is the audit. A general "prune anything not embedded"
reconciliation inside `sync_builtin_skills` is a larger behaviour change (it
would delete a built-in the moment a build ships without it, including a broken
build) and belongs in its own reviewed change; recorded as a follow-up in the PR
rather than smuggled in here.

### DEC-7: Which of the two Tier-2 `enqueue` sites is removed (ITEM-13)?
**Resolution:** Keep exactly one pass **per flow**, verified for BOTH the upload
and the repository-download paths. The two sites are on different code paths
(`create_model_with_files`, and the download task's tail), so the fix is
determined by which one covers both — established by reading both call graphs and
proven by the test, not by deleting the later line.
**Basis:** codebase — `uploads.rs:347` sits inside `create_model_with_files`
(reached by upload-commit AND repository download) while `uploads.rs:1365` is in
the download task only. Deleting the wrong one silently leaves the upload path
unvalidated, which is a worse defect than the one being fixed.

### DEC-8: What should a chat send do when the engine is validation-owned (ITEM-14)?
**Resolution:** **Wait, bounded, then answer** — the send waits for the
validation-owned engine to settle instead of returning 502/503 immediately. The
bound reuses the EXISTING `auto_start_timeout_secs`
(`llm_local_runtime/runtime_settings/`), which is already an admin-configurable
runtime setting.
**Basis:** convention + the configurable-settings rule. This introduces an
operational tunable (how long a send waits), and the rule says default to
admin-configurable rather than a bare constant — but the correct move is to
**reuse the setting that already means exactly this** rather than add a second
knob for the same question. The terminal refusal states (`failed|invalid|error`)
are unchanged and still 503: only the transient, validation-owned states change.

### DEC-9: How is `loadLlmProviders(force)` fixed (ITEM-16) without a request storm?
**Resolution:** **Coalesce, don't drop.** A forced call that arrives while a load
is in flight attaches to (or re-runs after) that load instead of returning
silently. The existing dedupe behaviour for non-forced calls is preserved.
**Basis:** codebase — `ModelPicker.loadProviders` and `UserLlmProviders.load`
already have no `loading` guard and do not storm, and
`llmRepository/actions/loadLlmRepositories.ts` already uses an in-flight promise
dedupe. Deleting the `loading` clause outright would trade a dropped refresh for
a storm; the in-flight-promise shape is the one already in the tree.

### DEC-10: What is the acceptance gate for INV-5?
**Resolution:** **Deterministic, in two legs, with the end-to-end spec demoted to
corroboration.** (G1) exactly ONE Tier-2 pass follows a completed download,
asserted on an observable consequence — the `validation_status` transitions into
`processing` — not a mocked call count. (G2) the model is PUT into each state a
validation pass transits (the draining flag; a `running` instance row pointing at
a dead port) and a send must not fail from it. (C1) the browser spec
"download-shaped model appears → send → response, no reload" runs as
corroboration and is labelled as NOT proving the window is closed.
**Basis:** user — the lead reviewed the plan, independently re-verified the
double `enqueue` and the hazard comment, and objected that a spec which must land
a send INSIDE the validation window is timing-dependent: green on this box, red
in CI at 3am, and weak even when green because it samples one instant rather than
proving a property. Folded in before implementation started. If a deterministic
assertion turns out not to capture the user-visible symptom, that is stated
plainly in TESTS.md and the PR — a flaky spec is never presented as the
criterion.

### DEC-11: Does any new operational tunable need its own settings row?
**Resolution:** **No new settings row.** The only tunable this work introduces is
ITEM-14's wait bound, and DEC-8 reuses the existing admin-configurable
`auto_start_timeout_secs` instead of adding a second knob for the same question.
Nothing else here has a threshold, retention, quota, cap or toggle.
**Basis:** convention — the configurable-settings rule requires an explicit
answer for every tunable, and its own guidance is to follow the existing
singleton-settings pattern; reusing the setting that already means this is
closer to that intent than duplicating it.

### DEC-12: Is the reproduction (ITEM-12) allowed to touch the owner's instance?
**Resolution:** **No.** A separate desktop build from this worktree, run with my
own `XDG_DATA_HOME` under `/tmp/paws-uipolish-*`, on the existing X display or
Xvfb. `~/.local/share/com.ziee.chat` and `/tmp/paws-main-test` are not touched
and the owner's running process is not killed. The desktop binary is
`src-app/target/debug/ziee-desktop`, not `target/debug/ziee` — the latter is also
produced by the server crate and will not open a window.
**Basis:** user — standing instruction in the task brief, plus the binary-name
trap the brief calls out explicitly.

---

## DEC-13 — ITEM-5's fix is FOUR changes, not one, because the repro found four defects

**Decision:** ship, as one coherent change to the local-runtime start path:
(a) a cancellation-safe single-flight (detached leader + `watch`), (b) a
`Liveness::Starting` state distinct from `Crashed`, (c) an honest
`LocalDeployment::status()` that reaps via `try_wait()` instead of trusting
`Child::id()`, and (d) validation HANDING OFF a healthy engine to a waiting
request instead of draining-and-killing it. Plus the shipped-default change
(DEC-14).

**Basis:** owner — "option (b): make ensure_running aware a validation is in
flight for that model, wait for it, and reuse the engine", and "'loading' and
'crashed' must become distinguishable states — a fix that only widens the timing
window would leave a user able to brick a model by sending a few messages too
early."

**Why not fewer changes.** Each was found by the live reproduction failing, not by
reasoning, and each one alone leaves the symptom intact:
- without (a) the chat collides with the validation's engine (`already exists`);
- without (c) the `Starting` state of (b) reads a zombie as "still loading" and
  waits forever — (b) is actively WORSE without (c);
- without (d) the engine is killed 0.4ms before the chat is told it is ready.
The evidence for each is in INFRA_INTEGRATION.md with timestamps.

**Note on (b) and the flap cap.** The owner's correctness point is honoured: the
`Starting` arm records NO `HealthEvent` on any outcome. A slow load can no longer
feed the 5-crashes-in-60s cap, so a user cannot brick a model by sending a few
messages while it loads.

## DEC-14 — ship a 180s `auto_start_timeout_secs` default (was 30s)

**Decision:** new migration `202607220200` sets the column default to 180 and
updates existing rows **only where the value is still exactly 30**, leaving any
operator's deliberate choice alone. The Rust-side fallbacks
(`runtime_settings/models.rs`, `auto_start.rs`) move to 180 to match.

**Basis:** owner — "the SHIPPED default of 30s is shorter than a real model load…
either ship the changed default or demonstrate the fix at the value that actually
ships, because a green run under a config no user has is not evidence."

**Why 180 and not more.** The setting also bounds how long a user waits on an
engine that will never come up. The column CHECK allows 1..600, so a slower host
can raise it. Crucially, raising the default is only safe BECAUSE of the
fail-fast in DEC-13(c): a genuinely broken model now fails in milliseconds
(measured: 27ms for a corrupt GGUF) instead of costing the user the full timeout.
Shipping 180s without fail-fast would have made the worst case three times worse.

**Verified at the shipped value, not a hand-set one:** a fresh first-boot instance
reported `row=180 / coldefault=180` before any manual edit; that is the instance
the passing run was performed on.

## DEC-15 — orphaned extracted skill directories stay, and that is a choice

**Decision:** migration `202607220100` deletes the three hidden-feature built-in
skill ROWS but nothing removes the files they extracted to
`<data_dir>/skills/builtin/<leaf>/`. Recorded as `wontfix` in the ledger
(finding 18), not silently left.

**Basis:** consistency with the migration's own stated scope, which names its
three targets explicitly rather than reconciling. A general "delete anything no
longer embedded" sweep would delete a built-in the moment a build shipped
without it, including a broken build — a strictly worse failure than leaving
dead files.

**Impact assessed, not assumed:** with the row gone the skill is neither listed
by `list_available_for_conversation` nor injected by the chat extension, so
neither the model nor the UI can reach it. The residue is disk, not behaviour.
