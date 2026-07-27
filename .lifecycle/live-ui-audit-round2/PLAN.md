# PLAN — live-ui-audit defect remediation, ROUND 2

Round 1 (`.lifecycle/live-ui-audit-fixes/`, merged at `5ae4c9379`) fixed the
`n+1`, `llm-models` duplicate, accent-swatch drift and 390px geometry findings.
This round takes the findings that round 1 explicitly left for a second pass
(see `live-ui-audit-fixes/HUMAN_FEEDBACK.md` FB-2: "another agent is handling
the OTHER network findings (boot waterfall, `/api/conversations` duplicates,
settings-user over-fetch)") **plus** the new defects the 81-cycle 24/7 rig
surfaced afterwards.

Its artifacts are a NEW feature dir rather than an amendment of round 1's,
because round 1 is already merged into this branch's base and its ITEM/TEST ids
are satisfied history. Nothing in `live-ui-audit-fixes/` is modified or deleted.

## Design source

- Realizes `.lifecycle/live-ui-audit-round2/DESIGN.md` — §2 (the measured
  defects D-A…D-E), §3 (non-negotiables), §4 (acceptance bar). That file records
  the evidence set (81 cycles, `/data/pbya/ziee/tmp/live-ui-247/`), the
  branch-local reproduction rig, and the BEFORE measurement.
- Realizes `agent-kit/skills/live-ui-audit/SKILL.md` §"The check battery"
  dimensions 1 (functional bugs → stuck spinners), 2 (UI → zero-size control),
  4 (color/theme → contrast) and 6 (network hygiene → duplicate / excess /
  waterfall / irrelevant) — the definitions of the signals the fixes must
  silence.
- Realizes `CLAUDE.md` §"Realtime Sync" (the notify-and-refetch contract that
  must keep every deferred/removed fetch honest) and
  `agent-kit/docs/CODING_GUIDELINES.md` §7/§12/§13.
- Realizes `DESIGN_SYSTEM.md` §"Semantic color tokens" for any contrast fix.

## Invariants

- **INV-1**: "A fix must be proven by the same rig that found the defect — the
  audit's own before→after count for that finding's category, not a reading of
  the code." (verbatim, `DESIGN.md` §3.1)
- **INV-2**: "Removing a request may not remove the freshness it provided. Every
  fetch this work deletes or defers must still be covered by the
  notify-and-refetch contract (`sync:<entity>` + `sync:reconnect`) or by an
  explicit later trigger — a surface may never go stale to win a network count."
  (verbatim, `DESIGN.md` §3.2)
- **INV-3**: "`buildLoadContext`'s module-eligibility inputs are UNCHANGED —
  `isAuthenticated` still comes from the verified session flag, never from a
  persisted token — so a `ctx.can(P)`-gated module's code is still delivered only
  after `/auth/me` proves the permission." (verbatim, `.lifecycle/net-hygiene/
  TESTS.md` TEST-14; this round inherits it as a standing invariant because
  ITEM-3 works in exactly that area — see `DESIGN.md` §3.3.)
- **INV-4**: "An objective check's finding is either fixed in the app or
  explicitly classified as a false positive with its evidence — never silenced,
  never left unexplained." (verbatim, `DESIGN.md` §3.4)
- **INV-5**: "Colors come from semantic DESIGN_SYSTEM tokens — never a raw hue,
  an arbitrary value, or an inline style color." (verbatim, `DESIGN.md` §3.5)

## Items

- **ITEM-1**: Collapse the per-turn `GET /api/conversations/{id}/summary` storm.
  `SummarizationStatusPill` drives `ConversationSummarization.loadForConversation`
  from a `useEffect` keyed on `[conversation?.id, messages.size]`, so every
  message a turn adds (optimistic user bubble, assistant placeholder, tail
  reconcile) is another round-trip — the measured 3–4 per step. The server only
  rewrites the summary in its `after_llm_call` hook, so the trigger becomes two
  precise halves: the **turn end**, owned by the summarization chat-extension's
  `afterStreamComplete` hook (invoked exactly once per completed turn in the
  owning pane), and the **open/switch**, owned by the pill and de-duplicated
  against the STORE (not component state, because the composer genuinely
  re-mounts across the `/` → `/chat/{id}` navigation) and skipped entirely for a
  conversation this tab created (it provably has no summary yet).
  *(Amended from "the streaming true→false edge" per DRIFT-1.2/1.3: measured on
  the rig, `isStreaming` produces TWO falling edges per send because
  `loadConversation` zeroes it transiently mid-navigation.)*
- **ITEM-2**: Record, at the ITEM-1 call site, WHY the landed in-flight GET
  coalescer (`sdk/packages/framework/src/api-client/inflight.ts`) does not and
  cannot cover this storm — the calls are SEQUENTIAL, not concurrent (each is
  triggered by the previous response landing), and the intervening
  `POST /api/conversations/{id}/messages` bumps the freshness epoch, which by
  design makes any surviving entry unjoinable. Documented in the app-side pill,
  NOT in the sdk submodule, so this round moves no submodule pointer.
- **ITEM-3**: Diagnose and classify the residual boot waterfall, then reduce it
  by the only lever that is not already a rejected design.
  **Why not the obvious fix:** deriving `isAuthenticated` from the persisted
  token so `ctx.isAuthenticated`-gated modules register in wave 1 was already
  implemented, blind-audited and **CUT** by `.lifecycle/net-hygiene`
  (ITEM-6 / DEC-15): three audit angles found it widens the authenticated-tier
  trust boundary for a REVOKED-but-unexpired token (modules are never unloaded),
  it contradicts `bootSessionVerify.desktop.ts`'s own reasoning, and
  re-measurement showed **no change to any metric it was meant to move**. A
  committed guard test (`src-app/ui/src/modules/loadContext.nochange.test.ts`)
  turns red if it is reintroduced. This round must NOT reintroduce it.
  **What this item does instead:** measure the real chain with the committed
  `.lifecycle/net-hygiene/boot-probe.mjs` harness plus a failure/timing probe,
  classify every flagged serial run as (a) a real removable dependency,
  (b) a detector artifact, or (c) the rejected design; and deliver the genuine
  reduction through request-COUNT reduction (ITEM-1/4/5 remove requests from the
  same windows the chains are measured in). Findings recorded in
  `INFRA_INTEGRATION.md`; no eligibility/security semantics change.
- **ITEM-4**: Stop the eager `GET /api/memories` on every completed chat turn.
  The memory chat-extension's `afterStreamComplete` calls `Memories.load()` purely
  so the (usually closed) `/memories` page is fresh — but the `Memories` store
  already subscribes to `sync:memory` + `sync:reconnect` in its `init`, and the
  server's extractor publishes `SyncEntity::Memory` on every extracted / updated /
  deleted fact (`modules/memory/engine/extractor.rs`). The hook is redundant and
  it *instantiates* the store (running its own `init` load) for users who never
  open the page. Remove the hook; freshness stays on the sync contract (INV-2).
- **ITEM-5**: Take `GET /api/background/runs` off the compose-send path.
  `BackgroundRunsFooter` probes for runs on EVERY conversation mount even though
  it renders nothing unless runs exist. For a conversation THIS tab just created
  there provably are none, and any run spawned afterwards arrives on
  `sync:workflow_run` — so skip the probe for session-created conversations while
  keeping it for conversations loaded from the server (INV-2).
- **ITEM-6**: Fix the rapid-double-submit defect. `ChatInput.handleSend` guards on
  the RENDERED `sending`/`isStreaming`, but `Chat.sendMessage` performs several
  awaits (extension hooks, `composeRequestFields`, `POST /conversations`) BEFORE
  it sets `sending: true`, so a second keypress inside that window passes the
  guard and starts a concurrent send.
  **AMENDED (DRIFT-1.7): the production fix landed UPSTREAM mid-flight.** A
  synchronous latch was implemented here, and then `origin/feat/agent-core`
  advanced to `bf1b0e9dd` ("double-send latch") carrying an equivalent one from
  a concurrent agent. This branch rebased onto it and **dropped its duplicate**;
  what ITEM-6 ships is the reproduction + the regression guard (TEST-9), not a
  second latch. The audit's `stuck-loading` signal is separately re-classified —
  see ITEM-8's sibling note in TEST_RESULTS.md: measured on the rig, the
  `rapid-double-submit` step samples at a fixed 4000 ms while a real Qwen turn
  takes ~5–7 s, so the spinner it sees is a mid-stream render, not a stuck one.
- **ITEM-7**: Root-cause and dispose the `zero-size-control` finding
  (`div#root>div>div>a`, 1×1 px, `home`@390, 8 rows/run). Identify the element,
  verify its real behaviour by RUNNING it, and either give it a compliant tap
  target or record it as a classified false positive with its evidence (INV-4).
- **ITEM-8**: Root-cause and dispose the single HIGH `contrast` finding
  (390/light, fired in 2 of 81 cycles; both run dirs pruned by the rig's
  retention). Attempt targeted reproduction on the branch rig; fix with semantic
  tokens if reproduced (INV-5), otherwise record the reproduction attempt and its
  measured result (INV-4).
- **ITEM-9**: Measure. Run the UNMODIFIED in-tree audit battery against a build
  of this branch on the branch-local rig, with the same flags / backend / data as
  the BEFORE run, and transcribe per-category before→after counts (INV-1).
- **ITEM-10**: [DESCOPED] `GET …/memory-mode` + `…/summarization-mode` firing 2×
  per step (LOW).
- **ITEM-11**: [DESCOPED] `GET /api/conversations` firing 2–4× within a `(load)`
  step (LOW/MEDIUM).
- **ITEM-12**: [DESCOPED] `control-collision` (LOW), `palette-drift` (LOW) and
  `spacing-grid` (LOW) findings.

## Files to touch

- `src-app/ui/src/modules/summarization/chat-extension/components/SummarizationStatusPill.tsx`,
  `.../chat-extension/summaryRefreshTrigger.ts` (new),
  `.../chat-extension/extension.tsx` (the `afterStreamComplete` half),
  `.../chat-extension/components/SummaryBoundaryMarker.tsx` (stale doc-comment),
  `.../stores/conversationSummarization/actions/loadForConversation.ts`
  (in-flight guard) (ITEM-1)
- `src-app/ui/src/core/sessionCreatedConversations.ts` (new — shared by ITEM-1
  and ITEM-5; see DRIFT-1.3) and
  `src-app/ui/src/modules/chat/core/stores/chat/actions/createConversation.ts`
  (mark the id before it reaches the store)
- `.lifecycle/live-ui-audit-round2/reqfail-probe.mjs` (new — the ITEM-3
  measurement probe: per-request failure reason + `requestStart` timing, which is
  what distinguishes a real dependency from connection-limit queueing)
- `src-app/ui/src/modules/loadContext.ts`, `src-app/ui/src/modules/loader.ts`,
  `src-app/ui/src/modules/loader.desktop.ts` — **read for ITEM-3, deliberately
  NOT modified** (net-hygiene DEC-15); listed so the audit covers the decision
- `src-app/ui/src/modules/memory/chat-extension/extension.tsx` (ITEM-4)
- `src-app/ui/src/modules/background/components/BackgroundRunsFooter.tsx`,
  `src-app/ui/src/modules/background/module.tsx` (ITEM-5)
- `src-app/ui/src/modules/chat/core/stores/chat/actions/sendMessage.ts` — ITEM-6;
  **NOT modified in the end** (the upstream `bf1b0e9dd` latch is used as-is; see
  DRIFT-1.7)
- `sdk/packages/shell/src/layouts/AppLayout.tsx` (ITEM-7 — only if a real fix is needed)
- new unit tests co-located with the touched modules (ITEM-1/3/5/6)
- new e2e spec `src-app/ui/tests/e2e/perf/live-audit-round2.spec.ts` (ITEM-1/4/5/6)
- `.lifecycle/live-ui-audit-round2/*` (artifacts)

## Patterns to follow

- **`toolbar_status` pill effect (ITEM-1)** — mirror `MemoryStatusPill`, the
  sibling pill in the SAME slot: every `Stores.X.field` read hoisted to the top
  before any conditional (a proxy read IS a hook), one `useEffect` per concern,
  soft-fail on error.
- **Module-local request/rentrancy latch (ITEM-5/ITEM-6)** — mirror
  `BackgroundRuns.store.ts`'s `const inFlight = new Set<string>()` declared
  inside the `actions: (set, get) => { … }` closure and documented there as
  "module-local rather than store state: it is a request-dedup guard, not
  something any component renders".
- **Speculative load wave (ITEM-3)** — mirror the second-wave contract already
  implemented in `modules/loader.ts` (`registerWave` + the `coreInitialized`
  branch that runs each new module's `initialize()` and NEVER a second
  `initializeModules()`), and keep the `ensureModuleForPath` security comment's
  rule intact.
- **Deleting a redundant refetch (ITEM-4)** — the store-kit `init({ on })`
  contract already used by `Memories` (`on('sync:memory', reload)` +
  `on('sync:reconnect', reload)` + a self-gated `load()`), which is the
  documented replacement for an ad-hoc eager load.
- **e2e specs** — mirror the round-1 spec
  `src-app/ui/tests/e2e/perf/live-audit-network-hygiene.spec.ts`: real backend,
  no `page.route()` API mocking, request counting via `page.on('request')`.

## UI-surface checklist

This round adds **no new UI surface** — every item changes WHEN an existing
surface fetches, or how it guards a submit. Answered against the surfaces touched:

- **Precedent** — `SummarizationStatusPill` ⇄ `MemoryStatusPill` (same slot, same
  shape). `BackgroundRunsFooter` keeps its exact render contract (renders null
  unless the conversation has runs).
- **Scale / cardinality** — unchanged: `BackgroundRuns` stays server-paginated at
  `PANEL_PAGE_SIZE`, `Memories` stays paginated. No list is newly rendered.
- **Device size / responsive** — no layout change; the ITEM-9 audit re-run covers
  390/768/1280 × light/dark, which is the responsive proof.
- **Populated-render review** — the audit drives real, populated conversations
  (a 1118-conversation clone of the 24/7 rig's DB) at every viewport, capturing a
  screenshot per cell.
- **User-visible progress** — ITEM-6 makes progress state MORE truthful: the send
  button's spinner must clear when the turn ends instead of latching forever.
- **Input economy** — unchanged (no new input).
- **JTBD** — the jobs are the audit's own flows: *"open the app"* (`home`),
  *"type a question and send it"* (`compose-send`), *"break the composer"*
  (`adversarial-compose`), *"configure settings"* (`browse-settings`).
  ITEM-1/3/4/5 make the app do strictly less work per job with no visible change;
  ITEM-6 fixes a job outright — after a double keypress the user must still get
  exactly one answer and a usable composer.
- **Multi-instance / workspace** — ITEM-6's latch lives in the per-pane chat
  store's action closure, so a split pane's send is never blocked by the other
  pane's. ITEM-5's session-created set is keyed by conversation id, so it is
  pane-agnostic and a pane opening an EXISTING conversation still probes.
- **URL-as-view-into-focus** — untouched.
- **Platform-provided affordances** — untouched.

## Out of scope (explicit)

- No backend change, no migration, no OpenAPI/`types.ts` regen (see BASE.md).
- No change to the audit script: BEFORE and AFTER are scored by the same
  unmodified `agent-kit` copy (INV-1).
- Round 1's artifacts, items and tests are untouched.
