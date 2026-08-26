# BASE — upstream-pulldown

Conflict surface against CURRENT paws `main` (`origin/main` = `8b295b268`), measured
in this worktree before any code was written.

## Migration numbers

Two independent sequences; the server sequence is the one this branch adds to.

```
find src-app/server -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort -n | tail -3
  202607210100
  202607210200
  202607210300          <- current server max
find src-app -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort | uniq -d
  (empty)               <- no duplicate prefixes anywhere
```

Desktop sequence max is `10000000000005` and sits in its deliberate 1e13 block above
every server timestamp; this branch does not touch it.

**Incoming migration:** `202608210100_agent_task_list_reconcile.sql` (from upstream
`ee48f1a77`). `202608210100 > 202607210300`, so it sorts after everything paws ships
and there is **no collision**. It is additive: widens a CHECK constraint and adds a
nullable `workflow_run_id` FK + a partial index.

**Migration-immutability hazard.** Upstream `abc8d2429` *edits* the migration that
`ee48f1a77` added, which is exactly why upstream had to add a `GRANDFATHERED` entry to
its own guard. paws' `src-app/server/tests/migration_immutability.rs` baselines against
pushed `origin/main` and its `GRANDFATHERED` list "may only ever SHRINK" (line 83).
Resolution: **squash the two picks into one commit** so the migration has a single
first appearance and no exemption is needed. No `GRANDFATHERED` entry is added.

## Files current main is also changing

`origin/main` is quiescent for this branch's purposes — the only live peer worker is on
`fix/paws-ui-polish` (worktree `paws-wt-ui-polish`), which is frontend-only. Every file
this branch touches is backend Rust plus `src-app/server/tests/**`. No overlap.

## Divergence in the touched files

`git diff <merge-base 7ca09a750> origin/main -- <every touched path>` is **empty**
except:
- `src-app/server/tests/llm_repository/mod.rs` — paws added `mod default_model_seed_test;`.
  Upstream adds `mod ssrf_probe_test;` and rustfmt's the file. One trivial conflict; keep both.
- `src-app/server/src/lib.rs` — paws' hunks are at L27/L152, upstream's at L381/L394
  (inside `pub mod test_internals`). No overlap.

## OpenAPI regen

**Not implied.** None of the six picks changes a `JsonSchema` request/response type or
a route signature; they change handler-internal validation, client transport framing,
and repository SQL. `src-app/ui/openapi/openapi.json` and
`src-app/desktop/ui/src/api-client/types.ts` are expected to be untouched by this
branch, and that expectation is itself checked (a non-empty diff there would mean a
pick dragged in an out-of-scope type change). Note `just` is not installed on this box,
so if a regen ever IS needed it must be run as the raw two-command form from
`justfile:550-554`.

## Submodules

`sdk` (paws `fa9a5772`, branch `paws`), `agent-kit` (`f9ffa599`), pgvector
(`cab9da72`). **This branch moves none of them.** Upstream `f09558f48` / `f6c586408`
would have moved `sdk`, which is why they are excluded rather than ported (see
DECISIONS DEC-6).
