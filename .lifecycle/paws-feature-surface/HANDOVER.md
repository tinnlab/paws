# HANDOVER — resume here

Written 2026-08-25 for a context compaction. Everything needed to continue
without re-deriving it.

## Where

| | |
|---|---|
| worktree | `/data/khoi/home-workspace/paws-wt-paws-feature-surface` |
| branch | `feat/paws-feature-surface` |
| HEAD | `750eb59b2` (merge of `origin/main` @ `1e6d93449`) |
| behind main | 0 |
| working tree | clean (only untracked `src-app/server/vendor/pgvector`, a submodule dir — normal) |
| sdk submodule | `8693247` on branch `paws`, **already pushed** to `ziee-ai/sdk` |
| main clone (for base comparisons) | `/data/khoi/home-workspace/paws-project` |
| task brief / EXECUTE / STATUS | `/data/khoi/home-workspace/paws-worker-tasks/paws-feature-surface*.md` |
| design source | `docs/design/paws-feature-surface.md` |

**The lifecycle gate now needs `--dir`** — merging main brought in a second
feature dir (`default-model-onboarding`), so bare `--all` aborts:

```
node .claude/lifecycle/lifecycle-check.mjs --all \
  --dir .lifecycle/paws-feature-surface \
  --repo /data/khoi/home-workspace/paws-wt-paws-feature-surface
```

## Phase state

1–6 **GREEN**. 7 **FAILS at the 6-round cap**. 8 and 9 **PENDING** (files absent).

**Phase 7 needs a HUMAN decision, not another round.** The gate says so itself:
*"fix loop hit the 6-round cap with 3 finding(s) still open (profile 26, 19, 16,
11, 7, 3) — escalate to a human rather than iterating."* Open set is **0 of 81**
(63 fixed, 17 wontfix, 1 obsolete); the "3 still open" in that message is the
round-6 count, not unresolved work. Do **not** start round 7 — rounds 5 and 6
produced no product defect between them, and the skill is explicit that "repeat
until 0" is unsound. Ask the owner to accept the cap.

## What is DONE and verified by running (do not re-do)

- `npm run check` **exit 0 in BOTH workspaces** (captured with `set -o pipefail`).
  The long-standing DEC-13 sdk blocker is **CLEARED** by the main merge.
- `gate:ui` **GATE PASSED** — 210/210 surfaces runtime-clean, 0 gating HIGH,
  visual 44 passed, exit 0. (Run before the merge; A7 wants it on the final tree —
  see "remaining".)
- `paws_surface` integration **5/5**, re-run after the merge + migration renumber.
- `bio_mcp` integration **14/14** (proves the round-3 revert).
- e2e `17-paws-surface` **11/11** (last run pre-merge; needs one re-run — below).
- citation unit **4/4**; desktop `loader.test.ts` **4/4**; config kill-switch **4/4**.
- OpenAPI regen verified **byte-identical** → merge-gate C3 risk closed.

## Remaining work

1. **Re-run the e2e suite on the merged tree** (last run predates the merge):
   ```
   sg docker -c "cd <wt>/src-app/ui && npx playwright test tests/e2e/17-paws-surface --workers=1 --reporter=line"
   ```
   ⚠️ Playwright/docker **must** be wrapped in `sg docker -c "…"` or it fails on
   the docker socket.
2. **Re-run `gate:ui`** on the merged tree for A7 (`cd src-app/ui && npm run gate:ui`,
   capture its own exit code). It takes a host-wide lock; ~10 min.
3. **Write `TEST_RESULTS.md`** — a `- **TEST-N**: PASS` line for every ID in
   `TESTS.md` (TEST-1…TEST-14) plus `npm run check (ui): PASS` and
   `npm run check (desktop/ui): PASS` and the `gate:ui (ui): PASS` line.
   **A11: only record PASS for a test whose ID appears on an ADDED line of this
   branch's diff and that you actually ran.** Otherwise `NOT VERIFIED` + reason.
4. **Write `HUMAN_FEEDBACK.md`** — must exist; carry the two escalations below.
5. `lifecycle-check --all --dir …` (expect phase 7 to need the owner's nod).
6. Commit, push, open PR to `main`. **Do NOT merge. Do NOT push to main.**

## Two things ESCALATED to the owner (must appear in the PR body)

Both are behavioural leaks where a hidden feature still reaches the MODEL, which
is sharper than the design's stated limitation ("a user who knows the URL"):

1. **The citations built-in auto-attaches to every tool-capable chat**
   (`mcp/chat_extension/mcp.rs:252` — "always available, no admin enable"). The
   model gets six citation tools, calls them unprompted, and writes a bibliography
   the user can never view.
2. **`control_mcp` defaults ON and builds its catalog from the live router**, so
   the model can `list_capabilities` → `invoke_capability` against workflow,
   scheduler, knowledge-base, citations, file-rag and hub.

Both fixes are out of scope: a server-side kill switch for a UI-only item (the
design defers this), or the grant revokes withdrawn in round 1 because they broke
chat for every non-admin.

## Known environment floor (classify, do NOT call these regressions)

- `cargo test -p ziee --lib` has **4 pre-existing failures**
  (`job_kind_parses…`, `append_content_doc…`, `credential_is_withheld…`,
  `list_by_conversation…`). **Verified failing identically on `origin/main`** in
  the main clone. Two more (`vector_search…`, memory reaper) are Category-B
  contention and pass at `--test-threads=2`.
- `npm run test:unit` is red on ~25 pre-existing `ERR_MODULE_NOT_FOUND` store
  tests, unrelated to this branch.
- `just` is **not installed**. OpenAPI regen commands are in `justfile:550-554`.
- macOS artifacts cannot be built here.

## Hard constraints

- Commit/push as **khoi <khoi@tinnguyen-lab.com>**. **No Claude/AI attribution
  anywhere** — commits, PR title, PR body.
- **Do not touch `.gitmodules`** — it came from main pinning sdk to `paws`; my
  diff against main on that file is empty. Keep it that way.
- Do not merge the PR; do not push to `main`.
- sdk pushes need SSH (the remote is HTTPS and a bare push hangs):
  `GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes' git push git@github.com:ziee-ai/sdk.git HEAD:refs/heads/paws`

## Gotchas already paid for (don't rediscover)

- Migration prefix: mine is **`202607210300`** — main took `202607210200` after
  #10. `CLAUDE.md`'s documented max is stale; always measure.
- Generated gallery artifacts (`galleryCoverage.generated.ts`,
  `stateMatrix.generated.ts`, `STATE_MATRIX.md`) conflict on merge — **regenerate
  from the merged tree**, never hand-merge. Then re-run `tsc` (stale keys in the
  hand-maintained `coverage.ts` / `stateCoverage.ts` are compile errors).
- Re-verify AFTER the last mutation: I once fixed `coverage.ts`, verified tsc
  clean, then ran generators and committed without re-checking — the fix was gone.
