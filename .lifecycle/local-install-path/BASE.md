# BASE — conflict surface vs current main

Branch base: `origin/main` @ `c7456cec6` ("chore: strip lifecycle artifacts before merge").

## Migration numbering

Highest **server** migration prefix in tree at branch time:

```
$ find src-app/server -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort -n | tail -3
202607200200
202607200300
202607200400
```

Highest **desktop** prefix (separate 1e13 sequence, must stay above every server one):

```
$ find src-app/desktop -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort -n | tail -2
10000000000004
10000000000005
```

Duplicate-prefix check (must print nothing):

```
$ find src-app -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort | uniq -d
(empty)
```

This branch adds two SERVER migrations, both above `202607200400` and far below
the desktop block:

| file | module |
|---|---|
| `202607200500_llm_runtime_release_cache_ttl.sql` | `llm_local_runtime` |
| `202607200600_llm_repository_unverified_status.sql` | `llm_repository` |

**Collision risk: real.** `202607200500` is the immediate next slot, so any other
branch adding a server migration will want the same number. The merge-gate's C2
re-checks against real main at merge time; if it collides, renumber upward — the
two migrations here have no ordering dependency on anything but their own tables.

## Files this branch touches that main may also be changing

| area | files | notes |
|---|---|---|
| `llm_local_runtime` | `engine/download.rs`, `binary_manager.rs`, `runtime_version/{handlers,models}.rs`, `routes.rs` | actively-developed module; `routes.rs` is a single-list file, so a concurrent route addition conflicts textually but trivially |
| `llm_model` | `repository.rs` (one SQL statement) | narrow, low collision risk |
| `llm_repository` | `utils.rs`, `connection_health.rs`, `models.rs`, `handlers.rs` | `utils.rs::test_repository_connectivity` is rewritten, so a concurrent edit there conflicts semantically, not just textually |
| generated | `src-app/{ui,desktop/ui}/openapi/openapi.json`, `src-app/{ui,desktop/ui}/src/api-client/types.ts` | regen-on-merge; expect a positional diff, verify content delta with `comm` on sorted files |

## OpenAPI regen implied

**Yes** — a new route, new response fields on two existing responses, and a new
health-status enum value. `just openapi-regen` must run for BOTH workspaces
(server spec → `src-app/ui/`, desktop spec → `src-app/desktop/ui/`), and the
`openapi::emit_ts::tests::types_ts_parity` golden test must be green afterwards.

## Test-baseline note

`tests/llm_repository/connection_health_test.rs` and
`tests/llm_repository/test_connection_user_agent.rs` currently PASS because their
mocks return a bare `200` for any GET — i.e. they encode the defect this branch
fixes. They are expected to go RED on this branch and are updated as part of
ITEM-11, not treated as regressions.
