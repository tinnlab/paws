# Gate notes — activity-rail

## Invocation (both flags are required here)

```bash
node .claude/lifecycle/lifecycle-check.mjs --phase N \
  --repo /data/pbya/ziee/tmp/activity-rail-wt \
  --dir .lifecycle/activity-rail \
  --base origin/feat/agent-core
```

- `--base` — without it the checker defaults to `origin/main` and attributes the entire accumulated
  `feat/agent-core` diff to this branch.
- `--dir` — takes a **path** (`.lifecycle/activity-rail`), not a bare feature name. `--dir activity-rail`
  fails with `feature dir not found: <repo>/activity-rail`.

## A1 is structurally unsatisfiable on this base — documented, NOT worked around

Phase 1 reports:

```
✗ phase 0 GLOBAL  FAIL
    - A1: .lifecycle/ has 17 feature dirs (…) — a branch may carry exactly ONE.
✓ phase 1 PLAN    OK
```

**The plan itself passes.** A1 is a repo-state condition:

- `git ls-tree -d origin/feat/agent-core:.lifecycle` → **16** feature dirs already on the base.
- `git diff --diff-filter=A origin/feat/agent-core...HEAD -- .lifecycle` → this branch adds
  **exactly one** (`activity-rail`).

`lifecycle-check.mjs:456-465` counts subdirectories on disk (`subs.length > 1`) and **never compares
against `--base`**, so every lifecycle branch cut from an integration branch that has accumulated
landed features inherits an automatic failure.

The only way to satisfy it is to delete 16 other features' committed lifecycle artifacts — which is
exactly the destructive mistake this project has already made three times (branches that stripped
sibling audit trails to go green). **We do not do that.** Precedent: the `control-mcp-e2e-coverage`
branch recorded the same A1/A2 condition in its `TEST_RESULTS.md` rather than deleting siblings.

Before every push on this branch, verify no sibling was harmed:

```bash
git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD -- .lifecycle   # must be empty
```

### Proposed upstream fix (agent-kit, separate change)

A1 should count only feature dirs **added relative to `--base`**, i.e. reuse the existing
`--diff-filter=A` comparison it already performs elsewhere, instead of a raw on-disk count. That makes
the rule enforce what it actually means ("this branch introduces one feature") and removes the
standing incentive to delete other people's artifacts to get a green gate. The tooling lives in the
`agent-kit` submodule (`.claude/lifecycle/` is a symlink into it), so the fix belongs there and
benefits every consuming app.
