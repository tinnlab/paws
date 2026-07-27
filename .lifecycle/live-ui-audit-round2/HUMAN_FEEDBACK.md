# HUMAN_FEEDBACK — live-ui-audit round 2

The human's brief for this round carried several explicit directives that shaped
what was built (and what was deliberately NOT built). They are recorded verbatim
here because each one is a judgement the work had to honour, and because two of
them are the reason a plausible-looking fix was rejected.

- **FB-1** [status: resolved] — "NOTE a landed in-flight GET coalescer already exists (`sdk/packages/framework/src/api-client/inflight.ts`) — find out why it does NOT cover this (different callers? cache-busting query? a non-GET? fired across steps?) and fix at the right layer." → Answered in code at the call site (`summaryRefreshTrigger.ts`) and in DEC-2: neither coalescing condition held. The four reads were SEQUENTIAL, not concurrent — each was triggered by the previous response landing and re-rendering the pill — so there was never a second caller while a request was unsettled; and the `POST …/messages` between them calls `bumpFetchEpoch()`, which by design makes any surviving entry unjoinable. `inflight.ts` is "a de-duplicator, deliberately NOT a cache" (its own header), so making it swallow this would have reintroduced the staleness class it exists to prevent. The right layer was the TRIGGER, which is where the fix landed. `inflight.ts` is unmodified. [generalizable: yes — when a "duplicate request" finding survives a transport-level de-duplicator, measure WHETHER the calls actually overlap before touching the transport; a sequential storm and a concurrent storm look identical in a per-step request count and have opposite fixes]

- **FB-2** [status: resolved] — "Prior work parallelized `/auth/me` specifically; the REST of the chain is still serial. Parallelize what has no true data dependency (several of these are plainly independent: setup-status, onboarding-progress, server-update-status, notifications). Do not break ordering that genuinely matters (e.g. anything gated on auth)." → Measured before acting, and the measurement contradicted the premise in a way worth reporting rather than silently working around. (a) The head of the chain is NOT serial: on the branch rig `/auth/me`, `/app/setup/status` and `/onboarding/progress` are issued ~11 ms apart and each completes in 4–9 ms; the audit's waterfall rule allows 20 ms of slack, which is LARGER than these requests' whole duration, so any burst of fast local requests is reported as a "serial dependent chain". 15 of the 41 residual rows are exactly that shape. (b) The genuinely-later requests (`server-update/status`, `notifications`, …) are gated on auth because their modules are `shouldLoad: ctx.isAuthenticated` — and making that predicate optimistic off the persisted token is a design this codebase already implemented, blind-audited, measured at ZERO benefit and CUT (`.lifecycle/net-hygiene` ITEM-6 / DEC-15), with a committed guard test that would have gone red. This round inherited that decision instead of re-litigating it (DEC-3). The waterfall reduction that WAS available came from removing requests from the measured windows. [generalizable: yes — before implementing a fix that a prior lifecycle may have touched, grep `.lifecycle/*/DECISIONS.md` for the mechanism you are about to change; a DESCOPED item with a measured rationale is cheaper to read than to rediscover]

- **FB-3** [status: resolved] — "`control-collision` (the latter is a LOW vision hint with known false-positive pressure — do NOT chase it unless clearly real)." → Not chased. `control-collision` (71 rows), `palette-drift` (11) and `spacing-grid` (4) are unchanged BEFORE→AFTER and descoped with recorded dispositions (DEC-8). The `palette-drift` rows are round 1's deliberate `data-allow-custom-color` accent swatches — a swatch IS genuinely dynamic colour.

- **FB-4** [status: resolved] — "Stand up your OWN rig … on a UNIQUE port, pointed at your OWN backend on a UNIQUE port with rate limiting disabled … Do NOT touch the running 24/7 rig on :1520 / :29500." → Honoured. Backend `:29511`, static `:1560`, database `ziee_liveaudit` on the `:54321` cluster (a `pg_dump` clone of the 24/7 rig's database, so the fixtures are identical and the 24/7 rig's own database was only READ). `rate_limit.enabled: false`. The 24/7 rig's ports and processes were never touched, and `rig-serve.mjs`'s client-disconnect upstream teardown was preserved verbatim in the copy.

- **FB-5** [status: resolved] — "**`git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD -- .lifecycle` MUST be empty.**" → Honoured; verified after the mid-flight rebase as well (the rebase touched no `.lifecycle` file from another feature). Round 1's `.lifecycle/live-ui-audit-fixes/` is untouched — this round is a NEW feature dir rather than an amendment, because round 1 is already merged into this branch's base and its results are satisfied history.

- **FB-6** [status: resolved] — "**NEVER `pkill` on any pattern matching `target/debug/ziee`** — that killed live test servers twice today; scope kills to PIDs you spawned." → Honoured. No `pkill`/`killall` was run at any point. The only long-lived processes this session started are the rig backend (`:29511`) and the rig static server (`:1560`), both started as tracked background jobs.

## Harvested / generalizable

The two `generalizable: yes` rules above are the ones worth folding into the
lifecycle skill:

1. **A duplicate-request finding is not evidence about the transport.** Measure
   whether the duplicated calls OVERLAP before changing a coalescer/cache; a
   sequential storm needs a trigger fix, a concurrent one needs transport
   de-duplication, and the per-step request count cannot tell them apart.
2. **Read the prior lifecycles' DECISIONS before re-implementing a mechanism.**
   `.lifecycle/*/DECISIONS.md` on the base branch records mechanisms that were
   built, audited and CUT with measurements. This round's first plan proposed one
   of them verbatim; a phase-2 read of `net-hygiene`'s DEC-15 caught it before any
   code was written, and a committed guard test would otherwise have gone red at
   phase 8.

A third candidate, from DRIFT-1.7, is narrower but cost real time: **`--base
origin/<branch>` is a MOVING ref in a shared clone.** A concurrent agent landed an
equivalent fix in the same function mid-flight, and the "red proof" probe for it
silently measured the NEW base. Re-resolve the base ref before trusting any
red/green or before/after comparison against it.
