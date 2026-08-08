# DECISIONS — gallery-harness-reliability

Every human/product input the implementation needs, resolved up front. No unresolved markers remain.

### DEC-1: Is the golden testid baseline "current ids" or "current ids minus proven phantoms"?
**Resolution:** **Neither literally — it is `current 1775 − 3 proven phantoms + 6 real ids the text scan was MISSING = 1778`,** with every added and removed id named and sourced below. The golden assertion (TEST-21) pins that exact set by name, not a count.

REMOVED (3) — all template-interpolation artifacts; none is ever rendered as an attribute, so no selector can regress:

| id | source |
|---|---|
| `${testid}-row-${cssEscape(rk)}` | `sdk/packages/kit/src/kit/table.tsx:391` — inside a `querySelector` template string |
| `chat-pane-${idx}` | `src-app/ui/src/modules/chat/extensions/keyboard/extension.tsx:23` — same shape |
| `kb-hit-source-${n - 1}` | `src-app/ui/src/modules/chat/core/utils/CitationChip.tsx:31` — same shape |

ADDED (6) — REAL ids rendered in `??`/ternary value positions that the regex silently missed (it only matches `data-testid="…"` immediately followed by a quote, so `data-testid={x ?? 'y'}` never matched):

| id | source |
|---|---|
| `settings-page-title` | `sdk/packages/shell/src/settings/SettingsPageContainer.tsx:44` — `data-testid={testid ?? 'settings-page-title'}` |
| `desktop-bootstrap-failed` | `src-app/ui/src/modules/auth/AuthGuard.desktop.tsx:84` — ternary arm |
| `desktop-bootstrap-starting` | `src-app/ui/src/modules/auth/AuthGuard.desktop.tsx:85` — ternary arm |
| `memory-core-block-edit-dialog` | `src-app/ui/src/modules/memory/components/CoreMemoryBlocksEditor.tsx:215` — ternary arm |
| `memory-core-block-create-dialog` | `src-app/ui/src/modules/memory/components/CoreMemoryBlocksEditor.tsx:215` — ternary arm |
| `chat-single-drop-column` | `src-app/ui/src/modules/chat/pages/ConversationPage.tsx:1016` — `pane ? undefined : 'chat-single-drop-column'` |

**Basis:** codebase — measured, not assumed: the current regex over the real configured trees yields 1775; the value-position AST pass yields 1778; the symmetric difference is exactly the 3+6 above. Note `layout-drawer-content` is NOT in either list: the regex found it only by coincidence (inside a `querySelector` string at `shell/src/components/Drawer.tsx:190`) while the AST finds it at its real attribute site (line 261) — same id, now for the right reason.

### DEC-2: Does a "string-literal values" AST pass (the design's literal wording) suffice, or must it walk value positions?
**Resolution:** It must walk **value positions** — the literal itself, both ternary arms, both `??`/`||` operands, and through parenthesized/`as`/non-null wrappers. A StringLiteral-initializer-only pass would DROP the six real ids in DEC-1.
**Basis:** codebase — a first draft of the AST pass, written to the design's literal wording, produced exactly that false-negative; a second draft that walked ALL descendant literals over-collected 15 fragments (`toggle`, `assign`, `failed` from a ternary CONDITION, `data-testid` from `props['data-testid']` inside a template). Value positions is the one rule that gets both directions right, and TEST-22 pins each of those real over-collections as a negative case. This STRENGTHENS INV-5 rather than departing from it (see DESIGN_FIDELITY INV-5).

### DEC-3: Is the id-shape check a warning or a hard error?
**Resolution:** **Hard error** at render time in `renderRegistry`, naming the offending id and its source file:line.
**Basis:** convention — CODING_GUIDELINES §6 ("never silently swallow"). All 1778 post-fix ids satisfy `/^[a-zA-Z0-9_-]+$/`, so the check is expected to be permanently silent; a warning nobody reads would not have caught the five phantoms, which is the whole point of the defense-in-depth layer the design asks for.

### DEC-4: On lock contention, does `gate:ui` WAIT or REFUSE?
**Resolution:** **Wait by default**, printing a visible line naming the holding worktree root + pid and the elapsed wait; `--no-wait` refuses immediately with a non-zero exit; `GATE_UI_LOCK=0` disables the lock entirely.
**Basis:** convention + user-impact — the observed failure was SILENT corruption, and both waiting and refusing cure that. Waiting is chosen because an agent fleet running gates in several worktrees is the normal case here, and "refuse" would turn a routine overlap into a spurious red that agents learn to route around (the exact failure mode the lifecycle skill warns about for absolute bars). The `GATE_UI_LOCK=0` escape exists so this feature's own concurrency NEGATIVE control (TEST-3) can deliberately produce the overlap it needs to prove the lock is load-bearing.

### DEC-5: Lock scope and path — per-host, per-user, or per-worktree?
**Resolution:** **Per-host, per-user**: `<os.tmpdir()>/ziee-gate-ui-<uid>.lock`.
**Basis:** design — INV-3 explicitly states "per-worktree `node_modules` isolation does NOT protect against this", so a worktree-scoped lock would not cover the observed defect. Per-USER (uid in the filename) because `os.tmpdir()` is shared and a lock file owned by another user would be unlinkable, wedging the host for everyone — a worse failure than the one being fixed. Two users genuinely sharing a box will not serialize against each other; that is an accepted, documented limit (recorded in the CLAUDE.md update, ITEM-22).

### DEC-6: How is a stale lock (holder SIGKILLed) reclaimed?
**Resolution:** The holder record stores `pid` + `startedAt` + worktree root. An acquirer that finds a held lock probes `process.kill(pid, 0)`; if the pid is gone, or the record is unparseable, or the record is older than a hard ceiling (2 h — longer than any observed gate run), it reclaims. Reclaim is logged loudly, never silent.
**Basis:** convention — mirrors the repo's existing "prove it's OURS before reusing" idiom in `scripts/lib/run-key.mjs` (`fetchSentinelRoot` / `serverIsThisWorktree`), and the CLAUDE.md hub-seed lock precedent where "kernel auto-releases on process exit, so SIGKILL is safe". Node has no portable `flock(2)`, so liveness-checked `O_EXCL` is the equivalent.

### DEC-7: Are the lock, the quiesce bound, and the repeat count fixed constants or configurable?
**Resolution:** **Configurable, via CLI flag + env, with validated bounds** — `--quiesce-timeout` / `GALLERY_QUIESCE_MS` (default 5000, clamped 0–60000), `--repeat` / `GALLERY_REPEAT` (default 1, clamped 1–10), `--lock-wait` / `GATE_UI_LOCK_WAIT_MS` (default 900000), `GATE_UI_LOCK=0` to disable.
**Basis:** convention — the phase-4 configurable-settings rule. These are operational tunables (a timeout, a concurrency/serialization control, a repetition count). There is no admin settings row because this is BUILD tooling with no server, no DB and no UI, so the CLI-flag + env form is the correct analogue of the singleton-settings pattern; the bounds validation is the "so an admin can't footgun it" half, kept.

### DEC-8: The three script copies — fix all three, or consolidate?
**Resolution:** Fix the **two live** copies (sdk + desktop) and **DELETE** the dead one (`src-app/ui/scripts/runtime-health.mjs`). Do NOT attempt to consolidate desktop onto the sdk copy in this branch.
**Basis:** codebase — verified `src-app/ui/package.json` routes both `gallery:runtime` and `gate:ui` to the sdk copy, and a tree-wide grep finds no executor of the ui-local copy, so it is dead (CODING_GUIDELINES §15). Consolidating desktop onto the sdk copy is a genuinely larger change (the desktop `gate-ui.mjs` hardcodes `src/dev/gallery` where the sdk one reads `CFG.galleryDir`, and desktop has no `gallery.config.json`), it is orthogonal to all five defects, and doing it here would make the diff unreviewable against the defects it claims to fix. ITEM-20's parity guard is the mechanism that keeps the two honest until someone consolidates them deliberately.

### DEC-9: Does the shared classifier core get extracted to a lib both copies import?
**Resolution:** **Yes** for the classification logic (`lib/finding-classify.mjs`) and the lock (`lib/host-lock.mjs`) and quiesce (`lib/quiesce.mjs`); **no** for the crawl loop itself.
**Basis:** codebase + design — INV-6's failure mode is "the fix lands in one place and not the others", and single-sourcing removes that risk BY CONSTRUCTION for the logic that carries it. The crawl loop is not extracted because the two copies' `main()` genuinely differ (config-driven vs hardcoded anchors) and forcing them together is DEC-8's deferred consolidation. Desktop imports the sdk libs by relative path, which it already does for nothing today — so this establishes the seam that a future consolidation grows through.

### DEC-10: Does `--repeat=1` (the default) change any gating behaviour?
**Resolution:** **No.** At `repeat === 1` no finding is ever annotated `flaky`, and the gating formula is byte-identical to today's `HIGH − baselined − harness`.
**Basis:** convention — a single observation cannot distinguish stable from flaky, so downgrading a one-run finding would make the gate WEAKER, which is the opposite of the defect being fixed. TEST-2 pins this explicitly as half of the INV-2 acceptance test.

### DEC-11: What happens to a run that does not quiesce within the bound?
**Resolution:** Record a **MEDIUM** `quiesce-timeout` finding naming the surface, the theme, and the count + first few URLs of the still-pending requests; close the page; continue the crawl. Never fail the whole run, never silently swallow.
**Basis:** convention — CODING_GUIDELINES §6. MEDIUM (not HIGH) because a slow-loading surface is a diagnostic signal, not a product defect, and making it HIGH would replace one class of false gating failure with another. It is visible in the JSONL and the rollup so a genuinely hung surface surfaces instead of being laundered into transport noise.

### DEC-12: Where does the flake study run, given the box has a live explorer fleet?
**Resolution:** Request that the owner pause the fleet (they explicitly offered and own it — "do not kill it yourself"), run N≥5 repeats during the pause, and record the `ERR_NETWORK_CHANGED` count for every run as the validity gate. A run whose contamination count is not ~0 is VOID and is excluded from the flake computation, with the exclusion stated.
**Basis:** user — the owner's stated box conditions and their explicit offer. Named as a dependency rather than assumed away.

### DEC-13: Does this branch regenerate and commit `testIds.generated.ts`?
**Resolution:** **Yes**, and the sdk commit must land BEFORE the ziee pointer bump (the owner sequences sdk-then-pointer). On a merge conflict in that file the rule is: take main's version, re-run `npm run gen:testid-registry`, commit the regenerated result — never hand-merge.
**Basis:** codebase + convention — the file is a known concurrent-branch collision point (recorded in BASE.md); hand-merging a 1778-entry generated array is how a phantom or a dropped id gets reintroduced.

### DEC-14: Does the parity guard join `npm run check`?
**Resolution:** **Yes** — `check:harness-parity` is added to the `check` chain in both UI workspaces, alongside `test:gallery-scripts`.
**Basis:** convention — this is how every other drift guard in this repo is enforced (`check:testid-registry`, `check:state-matrix`, `check:overlay-registry`). It reads its expectations from `sdk/packages/gallery/scripts/`, a permanent committed product path, never from `.lifecycle/` (rule B6) — verified against a lifecycle-stripped tree before this branch is declared done.
