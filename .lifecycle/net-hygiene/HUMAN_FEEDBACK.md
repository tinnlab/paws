# HUMAN_FEEDBACK — net-hygiene

Living ledger. Feedback is recorded VERBATIM the moment it arrives, then resolved
and logged. Any `[status: open]` fails phase 9.

- **FB-1** [status: resolved] — "EXCLUDE two endpoints owned by another agent right now: /api/projects/by-conversation/{id} (N+1) and /api/llm-models (duplicate ×3) — do NOT touch those two fixes." → Enforced mechanically, not by intention: TEST-9 scans the real `git diff` of BOTH the superproject and the sdk submodule for those markers, for a generated-api-contract regen, and for any server-side edit, and fails on a hit. That agent's work has since LANDED at `a72553e6e`; this branch was merged onto that tip (conflict-free) so the before→after numbers are measured against a baseline that already contains it and this branch is credited with none of it. [generalizable: yes — when a task carves out territory another agent owns, encode the carve-out as an executable diff check on the branch, not as a note; and when their work lands mid-lifecycle, re-baseline onto it before quoting any number]
- **FB-2** [status: resolved] — "Do NOT regress correctness for the sake of fewer requests (a stale/missing refetch is worse than a duplicate) — keep the sync/refetch semantics intact." → This is INV-1, and it is what the blind audit caught the branch violating in three separate places (a `/me` in flight across a mutation marked fresh; an in-flight join with no epoch check; a bare notification guard that dropped a page change, a filter toggle, and the `sync:*` reload). All three fixed, each pinned by a test that fails on the old behaviour. The whole coalescer is deliberately in-flight-only with a freshness epoch — never a TTL cache (DEC-2/DEC-3). [generalizable: yes — a de-duplication feature should be audited primarily for what it silently DROPS, not for what it saves; make "would this test fail if the drop happened?" the acceptance bar]
- **FB-3** [status: resolved] — "Build + serve your branch (prod static server script …); do NOT verify against the stale :1520 app." → Both sides are production builds of a known commit served on their own ports (`:1548` = `a72553e6e`, `:1547` = this branch) against ONE shared backend, so the delta is attributable to the frontend diff. The stale `:1520` deployment was never used. [generalizable: yes — a perf/network claim needs a paired A/B of two builds against one backend; anything else measures the deployment, not the change]
- **FB-4** [status: resolved] — "Identify the chain and parallelize what doesn't truly depend on a predecessor" → Done for the one genuine dependency found (`/auth/me` was issued from a router-mounted effect, so it followed the chunk waterfall and gated every other mount behind its spinner). It now starts ~7× earlier and overlaps `/api/app/setup/status` on every route. The one thing that LOOKED parallelizable but was not — auth-gated module registration — turned out to be a trust-boundary widening with zero measured benefit and was descoped (DEC-15). [generalizable: yes — before shipping a parallelization, measure it ALONE; "it should help" is not evidence, and a security-adjacent change with no measured benefit is never worth it]
- **FB-5** [status: resolved] — Implicit in the brief's framing that `settings-user`'s ≈1,150 requests were the target. → Reported honestly rather than claimed: that figure is ~13 COLD BOOTS (the audit's `nav()` uses `page.goto`), and its dominant term was the by-conversation N+1 owned by the other branch. On the current baseline the same cell is already 160–166 requests; this branch takes it to 155–160. The remaining per-boot cost is the app shell's own data, which a full reload must fetch. [generalizable: yes — when a headline number is dominated by someone else's fix or by a harness artifact, decompose it in the report instead of quoting the delta]

## No further human review received

The feature has not yet been reviewed live by the owner. The invariants and their
acceptance tests to demonstrate at sign-off (not a gate tally):

- **INV-1** → TEST-2, TEST-3, TEST-7, TEST-12: mutate the profile and watch the
  refetch return the NEW value; a `/me` in flight across a mutation is not
  treated as fresh.
- **INV-2** → TEST-5: on a cold load, `/api/auth/me` and `/api/app/setup/status`
  overlap in wall-clock time (they did not before, on `/settings/profile`).
- **INV-3** → TEST-1: N concurrent identical reads produce ONE round-trip, and a
  later read still refetches (it is not a cache).
- **INV-4** → TEST-9: the diff is mechanically free of the two excluded surfaces.
- **INV-5** → TEST-14: module eligibility still comes from the VERIFIED session.
