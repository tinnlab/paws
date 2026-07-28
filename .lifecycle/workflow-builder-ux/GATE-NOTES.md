# GATE-NOTES — workflow-builder-ux

Deviations from a clean `lifecycle-check --all`, each with evidence. Nothing
here is a soft-skip: every item states what was checked and why the gate's
verdict is or is not a real defect on this branch.

The gate must be invoked with `--base origin/feat/agent-core`. This campaign's
integration line is `feat/agent-core` (629 commits ahead of `main`), and this
work never merges to `main` — main is only ever pulled *in*. The default base
misattributes the whole agent-core diff to this branch.

```bash
node .claude/lifecycle/lifecycle-check.mjs --all \
  --repo /data/pbya/ziee/tmp/workflow-builder-wt \
  --base origin/feat/agent-core \
  --dir /data/pbya/ziee/tmp/workflow-builder-wt/.lifecycle/workflow-builder-ux
```

---

## A1 — "18 feature dirs; a branch may carry exactly ONE" — BASE-CARRIED, not a stray

**Verdict: a real gate limitation, NOT a defect on this branch. Not worked
around, not suppressed.**

A1 counts the feature dirs present in `.lifecycle/` and expects one. It counts
the WORKING TREE, so on a branch cut from an integration line that already
carries other features' artifacts it can never pass — no matter what this branch
does.

Evidence (`git ls-tree origin/feat/agent-core .lifecycle/`) — the BASE branch
already carries **17** dirs:

```
agent-orchestration            background-in-conversation   chat-ui-robustness
control-describe-schema        control-mcp-e2e-coverage     e2e-render-serving
frontend-perf                  hook-lint-guardrails         live-ui-audit-fixes
live-ui-audit-round2           net-hygiene                  perf-ux-round2
smart-module-loading           sse-slot-leak                streamdown-html-renderer
workflow-kind-agent            worktree-isolation
```

This branch adds **exactly one**:

```
$ git diff --name-only origin/feat/agent-core...HEAD -- .lifecycle/ | cut -d/ -f2 | sort -u
workflow-builder-ux
```

and `workflow-builder-ux` is **not** present in the base (confirmed: the
`git ls-tree` listing above does not contain it), so it is genuinely this
branch's own and not a duplicate.

**Deliberately NOT resolved by deleting the other 17.** They belong to sibling
features on the shared integration line; removing them would destroy other
branches' committed process records and create a merge conflict for every one of
them. The rule's intent — "don't leave YOUR strays behind" — is satisfied: this
branch's `.lifecycle/` delta is one directory.

Every other phase gate was run with `--base origin/feat/agent-core` and is
evaluated on this branch's own diff, so A1 is the only global check affected.

---

## Phase 6 — coverage of the `sdk` submodule pointer

The coverage law excludes mechanically-generated files (`**/openapi.json`,
`**/api-client/types.ts`) but not a submodule pointer. The `sdk` bump
(`22d48e1 -> 364925d`) contains exactly one generated delta: six `data-testid`
literals added to `packages/kit/src/testIds.generated.ts` by
`gen-testid-registry.mjs`.

It is recorded in `AUDIT_COVERAGE.tsv` against the four angles that genuinely
reviewed those ids **at their stamping sites** (see the `_comment_sdk` note in
`angles.json`), not with fabricated coverage. The parent additionally verified
the regen is byte-identical from BOTH npm workspaces and that the delta is those
six ids and nothing else.

**Orchestrator action required:** the sdk branch `wf-builder-ux-testids`
(`364925d`) is **unpushed**. It must be pushed BEFORE the parent pointer, or a
fresh checkout of this branch fails `npm run check:testid-registry` — the
registry would be missing the six ids the new components stamp. (Restoring the
base pointer instead is NOT an option: that fails the same gate.)

---

## `src-app/server/vendor/pgvector` shows modified

Pre-existing build artifact, present in EVERY worktree including the main repo.
Not this branch's change; never committed here.
