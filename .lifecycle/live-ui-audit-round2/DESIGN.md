# Design source — Live-UI-audit defect remediation (round 1)

There is no prior product design doc for this work: it is **defect remediation
driven by measured evidence**. This file IS the design source, and it records the
evidence, the acceptance bar, and the non-negotiables the plan must uphold.

## 1. Where the evidence comes from

The `live-ui-audit` skill (`agent-kit/skills/live-ui-audit/SKILL.md`) drives the
LIVE app as a logged-in user across **3 viewports × 2 themes × JTBD flows ×
personas** and emits an objective, deduped finding inventory (7 measurable
dimensions: functional bugs, UI geometry, responsive, color/theme,
design-system consistency, network hygiene, RBAC).

A 24/7 rig ran it **81 cycles** against a real backend + a real Qwen LLM
(`/data/pbya/ziee/tmp/live-ui-247/`, `cycles.log`). Findings export:
`/data/pbya/ziee/tmp/audit-findings-brief.txt`; raw rows in each
`run-*/findings.jsonl`.

A **branch-local reproduction rig** was stood up for this work so before/after is
measured on the same harness, isolated from the 24/7 rig:

| piece | value |
|---|---|
| backend | `ziee` @ base `24ce5dcca`, `127.0.0.1:29511`, rate limiting **disabled** |
| database | `ziee_liveaudit` on `127.0.0.1:54321` — a `pg_dump` **clone of the 24/7 rig's DB** (same 1118 conversations, same Qwen provider) so fixtures are identical |
| static | `rig-serve.mjs` copy on `127.0.0.1:1560` (client-disconnect upstream teardown preserved) |
| audit | the UNMODIFIED `agent-kit` script from the main checkout, so before and after are scored by the same code |

The BEFORE run (`/data/pbya/ziee/tmp/liveaudit-rig/before/`) reproduces the 24/7
profile within noise: waterfall 43, network/duplicate 14 MEDIUM + 29 LOW,
network/excess 10, network/irrelevant 6, zero-size-control 8, stuck-loading 1.

## 2. The measured defects (what must change)

- **D-A — request storm.** `GET /api/conversations/{id}/summary` fires **3–4×
  inside a single flow step** (`sent`, `rapid-double-submit`), at every viewport
  and theme. The landed in-flight GET coalescer
  (`sdk/packages/framework/src/api-client/inflight.ts`) does **not** cover it:
  coalescing joins only requests that are *concurrent and in the same freshness
  epoch*, and these fire *sequentially* (one per message-count change) with a
  `POST /messages` in between that bumps the epoch. The defect is the TRIGGER,
  not the transport.
- **D-B — boot waterfall.** `home` boots a 5–13 deep serial `/api` chain headed by
  `/api/auth/me` (up to 527 ms serial). Prior work (`.lifecycle/net-hygiene`
  ITEM-5) moved `/auth/me` to module-initialize time; what remains must be
  measured and classified before anything is "fixed", because the obvious
  remedy is a design this codebase already rejected (§3.3).
- **C — orphan interactive control.** An interactive control renders 1×1 px on
  `home`@390.
- **D-C — off-page fetch.** `GET /api/background/runs` and `GET /api/memories`
  are fetched during `compose-send`, a flow with no use for either.
- **D-D — stuck loading.** After a **rapid double-submit** the composer's send
  button spins forever and an orphan, permanently empty assistant bubble is left behind
  (screenshot evidence: `run-20260727-101904/screenshots/
  adversarial-compose__rapid-double-submit__desktop__light.png`).
- **D-E — contrast.** One WCAG-AA failure at 390/light, seen in **2 of 81**
  cycles (`cycles.log` cycles 13 + 23); both run dirs have since been pruned.

## 3. Non-negotiables (lifted as invariants)

These are the promises this remediation may not trade away. They are quoted
verbatim into `PLAN.md`'s `## Invariants`.

1. **A fix must be proven by the same rig that found the defect** — the audit's
   own before→after count for that finding's category, not a reading of the code.
   (`SKILL.md`: "Every signal is measurable"; project rule
   `feedback_reproducible_results_only`.)
2. **Removing a request may not remove the freshness it provided.** Every fetch
   this work deletes or defers must still be covered by the notify-and-refetch
   contract (`sync:<entity>` + `sync:reconnect`) or by an explicit later trigger —
   a surface may never go stale to win a network count.
   (`CLAUDE.md` → Realtime Sync; `CODING_GUIDELINES.md` §7.)
3. **`buildLoadContext`'s module-eligibility inputs stay UNCHANGED** —
   `isAuthenticated` still comes from the verified session flag, never from a
   persisted token. Deriving it from the token was implemented, blind-audited and
   CUT by `.lifecycle/net-hygiene` (ITEM-6 / DEC-15: it widens the
   authenticated-tier trust boundary for a REVOKED-but-unexpired token, modules
   are never unloaded, it contradicts `bootSessionVerify.desktop.ts`, and it
   measured ZERO benefit). A committed test
   (`src-app/ui/src/modules/loadContext.nochange.test.ts`) guards it. This round
   inherits that decision rather than re-litigating it.
4. **An objective check's finding is either fixed in the app or explicitly
   classified as a false positive with its evidence** — never silenced, never
   left unexplained. (`SKILL.md` → "Tuning / false-positive discipline".)
5. **Colors come from semantic DESIGN_SYSTEM tokens** — never a raw hue, an
   arbitrary value, or an inline style color. (`DESIGN_SYSTEM.md` → "Forbidden
   patterns".)

## 4. Acceptance bar

The work is done when, on a fresh audit run of the branch build against the same
rig:

- `network/duplicate` + `network/excess` rows naming `…/summary` → **0**.
- `network/irrelevant` rows naming `/api/background/runs` or `/api/memories` →
  **0**.
- `stuck-loading` on `rapid-double-submit` → **0**.
- `network/waterfall` MEDIUM count **reduced** vs the BEFORE run, and every
  residual flagged chain **classified** with measurements (real dependency /
  detector artifact / rejected design).
- no NEW finding category appears that the BEFORE run did not have.
