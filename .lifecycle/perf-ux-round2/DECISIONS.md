# DECISIONS — perf-ux-round2

Every human/product input the implementation needs, resolved up front — no unresolved markers remain.

---

### DEC-1: Fix the barrel leak by DELETING the `DatePicker` export, or by making the barrel export itself lazy?
**Resolution:** Make the barrel export lazy — add
`sdk/packages/kit/src/kit/date-picker-lazy.tsx` and point `index.ts`'s VALUE
export at it, keeping `export type { DatePickerProps }` on the eager module.
**Basis:** codebase — deleting the export removes `DatePicker` from
`KIT_MANIFEST.md`, which is the kit's machine-readable contract "for agentic
coding … so an agent knows EXACTLY what it must pass"; losing an entry there is a
real regression in a different currency. It would also force edits to
`controls.story.tsx` and break the barrel API for any future consumer. The lazy
variant keeps the public API, the manifest entry, the story, and every consumer
identical, and mirrors the `LazyDatePicker` pattern the repo already ships.

### DEC-2: Where does the lazy-dependency list live?
**Resolution:** `src-app/ui/scripts/lazy-deps.json`, a committed product-tree
file, listing `react-day-picker` and `date-fns` with a one-line rationale each.
**Basis:** convention + **B6** — a gate added to `npm run check` must read its
source of truth from a permanent committed path, never from `.lifecycle/` (which
the merge driver strips), or the gate passes on the branch and then fails
permanently on main. This repo already hit exactly that on the desktop-override
gate, which read its approval list from a `.lifecycle/…/DECISIONS.md`.

### DEC-3: Should the eager-graph gate require a production build to exist?
**Resolution:** No. The static half (barrel must not VALUE-re-export a lazy-only
module; no `src/**` file may import that symbol from the barrel) always runs; the
build-output half runs only when `src-app/dist/ui/index.html` is present and
otherwise skips with a printed notice. The acceptance test (TEST-1) performs its
OWN build, so the strong assertion always has a home.
**Basis:** convention — every sibling `check:*` in `npm run check`
(`check:design-spec`, `check:testid-registry`, `check:state-matrix`) is a fast
static check; making `npm run check` build the app would add ~4 s and a whole
class of environmental failure to every branch's gate.

### DEC-4: Is the eager-graph budget a fixed constant or an admin-configurable setting?
**Resolution:** A fixed, committed list + a committed byte baseline in
`scripts/lazy-deps.json` — NOT a settings row.
**Basis:** convention — the configurable-settings rule targets *operational*
tunables a deployment operator must adjust at runtime (resource limits,
retention, quotas, feature toggles). This is a build-time engineering budget with
no runtime surface, no operator, and no server involvement; there is nothing to
configure and no `<feature>::settings::{read,manage}` permission that would make
sense. It is structured as a JSON file rather than inline constants so it can be
extended without touching the script.

### DEC-5: Does ITEM-3 (gate A1) belong in this round at all, or is it out of scope?
**Resolution:** In scope, as its own item.
**Basis:** user — the task brief names this exact failure as a hard rule
("Branches here have repeatedly stripped sibling features' `.lifecycle` dirs to
satisfy the A1 gate and silently deleted other features' audit trails on merge…
Before you hand back, `git diff --diff-filter=D … -- .lifecycle` MUST be empty").
On a branch stacked on `feat/agent-core` (which carries 13 inherited feature
dirs) the old A1 is unsatisfiable, so "satisfy A1" and "do not delete siblings"
are in direct contradiction until the gate is fixed. Fixing the gate is the only
resolution that satisfies both; deleting-then-restoring is what the base branch
already had to do once (`31de3113 chore(lifecycle): restore sibling feature audit
trails stripped for the A1 gate`).

### DEC-6: What happens to the 2,040-chunk / 5.6 s-throttled-boot finding?
**Resolution:** DESCOPED this round, with the measurement and the disproven fix
recorded so the next round starts from evidence instead of intuition.
**Basis:** codebase + measurement — the obvious fix (rolldown `codeSplitting`
group merging each store's action leaves) was implemented and measured: chunk
count 2,040 → 833, but boot got WORSE (executed chunks 198 → 229, executed bytes
1,593 → 2,110 KiB, throttled composer-interactive 5,041 → 7,227 ms) because
touching one action now drags in every sibling action of that store. Any genuine
fix changes the lazy-store / module-loader architecture that a previous round
deliberately built, which is a round of its own with its own blind audit — not a
tail-end change here.
- DESCOPED: ITEM-8 — the 2,040-chunk granularity (B-2) and the 5.6 s throttled composer-interactive (B-3) are measured and characterised, but the obvious fix was implemented and MEASURED AS A REGRESSION; a real fix is an architectural change to the lazy-store/module-loader design and needs its own round [approved: measured-disproof recorded in MEASUREMENT §1; orchestrator sign-off requested in the hand-back report]

### DEC-7: What happens to the UI/UX half — the 7-dimension live-audit inventory?
**Resolution:** DESCOPED this round. The rig defects that blocked it ARE fixed
and shipped (ITEM-4, ITEM-5) so the next attempt starts clean, but no UI/UX
findings are claimed or fixed.
**Basis:** user + INV-1/INV-4 — two full baseline runs were completed and both had
to be discarded because the audit was measuring the rig, not the app (the per-IP
rate limiter, then the test proxy's SSE-teardown bug that manufactured
`/api/sync/subscribe` + `/api/chat/stream` 429s). The third run was stopped ~2
cells in when the coordinator reported a concurrent full-suite e2e run on the same
worktree and box and directed that all measurement stop. With no valid inventory,
fixing "UI findings" would mean inventing them, which INV-1 ("justified by a
number in this document") and INV-4 ("not reported against the app until the rig
has been excluded") both forbid. An honest red beats a fabricated pass.
- DESCOPED: ITEM-9 — the 7-dimension live-UI-audit inventory and any fixes derived from it; two baseline runs were invalidated by rig defects (now fixed as ITEM-4/ITEM-5) and the third was halted by the coordinator's concurrent full-suite e2e run on the same box [approved: coordinator directive 2026-07-26 "pause source edits and performance measurement"; orchestrator sign-off requested in the hand-back report]

### DEC-8: The `Using cargo from PATH` log line — delete it, or make it conditional?
**Resolution:** Delete it.
**Basis:** codebase — the very next statement already prints the branch actually
taken (`Spawning prebuilt binary: …` / `Prebuilt binary absent — falling back to
cargo run`), so a conditional version would just duplicate it. The variable
`cargoPath` is still needed by the fallback and stays.

### DEC-9: Should `RUNTIME_FINDINGS.md` be regenerated in this round?
**Resolution:** Yes, and specifically from the SAME quiet-box `gate:ui` run whose
result is recorded in `TEST_RESULTS.md`.
**Basis:** convention — `agent-kit/docs/CODING_GUIDELINES.md` §17 ("Docs
reference only verified paths/symbols … code is the source of truth, not status
prose"). The committed copy claims 917 gating HIGH findings; a real run reports 0.
Tying the regeneration to the recorded gate run prevents the committed file and
the recorded result from disagreeing.

### DEC-10: `rate_limit.enabled: false` in the audit rig — a config change to ship, or rig-only?
**Resolution:** Rig-only. `src-app/server/config/dev.yaml` is gitignored
per-machine, so nothing is shipped; the requirement is written into the SKILL
(ITEM-5) as a prerequisite for any multi-shard audit run.
**Basis:** codebase — the limiter's own doc comment in `dev.example.yaml`
anticipates this ("set enabled: false on a trusted/non-public deployment"), and
the burst of 500 is documented as sized for ONE SPA cold-load, not four parallel
audit shards. Changing the shipped default would weaken a real production
protection to suit a test harness — precisely the B3 anti-pattern.

### DEC-11: Which metric proves ITEM-1?
**Resolution:** The deterministic critical-path byte count and the
`modulepreload` set — never FCP or composer-interactive.
**Basis:** measurement (INV-3) — MEASUREMENT §2 measured the noise floors: FCP
σ ≈ 75 ms, composer-interactive σ ≈ 700 ms (14 %). ITEM-1's −23 KB gzip is worth
about 65 ms of transfer at 10 Mbps, well inside both. Claiming a timing win for it
would be unprovable at this sample size; the byte metric has zero variance.
