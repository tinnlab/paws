# FIX_ROUND-3 — final round

Angles: **correctness** + **design-conformance** (required), both blind, over
**round 2's diff only** (`6b79249f3..HEAD`).

## What the round found

16 rows. Crucially, this round was **not** the test-code churn I expected when I
wrote round 2's termination note — it was mostly PRODUCT, which is why running it
was right.

**A regression I introduced.** My round-2 `bio_mcp` route guard breaks **five
existing integration tests**: the harness defaults `bio_mcp_enabled: false`, so
every test server had `/api/bio/mcp` unmounted and tests asserting 401/403/503/405
got a bare 404. Oracle-confirmed by running them. **Reverted** — `bio_mcp` is not
one of the 13 items, so guarding it was scope creep; unmounting redefines its
disabled contract, and one of those tests deliberately uses the disabled path to
reach the graceful-503 branch. That decision belongs to whoever owns `bio_mcp`.
The reasoning stays in the code as a comment so nobody re-adds it blind, and it
goes in the PR body as a follow-up. All 14 bio_mcp tests pass again.

**Five more surviving surfaces pointing at hidden features**, in modules no lever
reaches. The worst two:

- `SkillsList` — *"No skills installed yet — browse the Hub to install one"*. The
  skill module survives and a fresh paws instance has no skills, so this is the
  **default state of `/settings/skills`**.
- `DownloadIndicatorWidget` — a surviving **sidebar** widget reads `HubModels.$`,
  and that store is a lazy proxy that initialises on first access, so the read
  fires `GET /api/hub/models`, `/api/hub/models/version` and
  `/api/hub/local-providers`. This is precisely the render-gated-but-fetch-ungated
  hazard I wrote a paragraph about in `loadMcpServers` one round earlier and did
  not look for elsewhere.

Plus a dead-but-focusable citation chip in chat CORE (any assistant message
containing `[1]` produced a `role="button"`, aria-labelled affordance for the
hidden knowledge base), and two pieces of admin copy.

**An INV-5 violation I introduced in round 2.** I rewrote `MemorySetupStep`'s Hub
sentence *in place* instead of gating it — so deleting `'hub'` from the list would
restore the hub everywhere except there, leaving a code edit needing manual
revert. That is exactly what INV-5 forbids, done by the person implementing INV-5.
Now gated like its sibling one file over.

**Two hollow-assertion classes, again.** The grant pins were substring-shadowed
(`hub::assistants::read` is satisfied by `read_version`, which the same migration
grants), and the onboarding prose assertion could resolve during the step's
loading spinner because the `onboarding-step-*` wrapper renders outside the step
body. Both closed.

## Escalated, not absorbed

**`control_mcp` re-exposes every hidden feature to the MODEL.** It defaults ON and
builds its catalog from the live router, which still mounts all of
workflow/scheduler/citations/knowledge-base/file-rag/hub REST — and the grants
were deliberately kept (round 1). So a paws user's model can `list_capabilities`
→ `invoke_capability` against hidden features. The design frames the residual risk
as *"a user who knows the URL"*; in practice the model **enumerates** them.

That materially sharpens the design's stated limitation, and closing it means
either a server-side kill switch per UI-only item (explicitly out of scope) or
revoking grants (withdrawn in round 1 because it breaks chat). It goes to the
owner in the PR body and `HUMAN_FEEDBACK.md` — not quietly fixed, not quietly
dropped.

## Verification

- `tsc` clean; `cargo check -p ziee --tests` clean.
- **bio_mcp integration 14/14** (was 9/14 before the revert).
- `paws_surface` **5/5**; `17-paws-surface` e2e **11/11**.

## Termination

**Stopping here. Reason: T1.**

- n1 (design-conformance) = 13, n2 (correctness) = 5, m (corroborated) = 2 ⇒
  N̂ = (14 × 6)/3 − 1 = **27**; observed 16 across this round's much smaller diff.
- Profile across rounds: **26 → 25 → 16.** The first genuine decay, and it is a
  large one — round 3 audited a diff a fraction the size of round 1's.
- Promoted fraction fell too: 2 corroborated + 2 unique highs = 4/16 = **0.25**,
  against 0.32 in round 2.
- Remaining × promoted ≈ **< 1**. **T1 fires.**
- GUARD-SUB: not triggered — and the concern I raised at the end of round 2 (test
  churn creeping up) **did not materialise**: this round was ~30% test code, down
  from ~40%, and its highest-value findings were product defects.

Three rounds, HEAVY tier, decaying profile, T1 satisfied. Proceeding to phase 8.

**New confirmed findings:** 16
