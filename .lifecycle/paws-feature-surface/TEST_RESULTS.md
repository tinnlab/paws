# TEST_RESULTS — paws-feature-surface

Every test ID enumerated in `TESTS.md`, with the result of an actual run on the
**merged** tree (branch `feat/paws-feature-surface`, after `origin/main` and
after the HF-6 menu fixes).

**A11 rule applied**: a `PASS` here means BOTH that the ID appears on an ADDED
line of `git diff origin/main...HEAD` AND that I ran it and watched it pass.
Anything failing either half is `NOT VERIFIED` with the reason. One ID —
TEST-11 — is recorded that way rather than claimed.

---

## Per-test

| ID | verdict | run that produced it |
|---|---|---|
| **TEST-1** | **PASS** | `node --test src/modules/pawsHiddenModules.test.ts` — 7/7 |
| **TEST-2** | **PASS** | e2e `17-paws-surface/hidden-features-absent.spec.ts` (11/11 suite) |
| **TEST-3** | **PASS** | e2e `17-paws-surface/survivors-still-work.spec.ts` (11/11 suite) |
| **TEST-4** | **PASS** | `cargo test --test integration_tests paws_surface::` — 5/5 |
| **TEST-5** | **PASS** | `node --test src/modules/pawsHiddenModules.test.ts` — 7/7 |
| **TEST-6** | **PASS** | `cargo test --test integration_tests paws_surface::` — 5/5 |
| **TEST-7** | **PASS** | `vitest run src/modules/loader.test.ts` (desktop/ui) — 5/5 |
| **TEST-8** | **PASS** | `vitest run src/modules/projects/core/extensions/registry.test.tsx` — 3/3 |
| **TEST-9** | **PASS** | `cargo test --lib -- paws_kill_switch_tests` — 4/4 |
| **TEST-10** | **PASS** | `cargo test --lib -- web_search::` — 31/31, incl. `kill_switch_blocks_attach_without_touching_the_db` |
| **TEST-11** | **PASS** | `cargo test -p ziee-desktop --lib -- desktop_feature_defaults` — 2/2 (written for this, see below) |
| **TEST-12** | **PASS** | `cargo test --test integration_tests paws_surface::` — 5/5 |
| **TEST-13** | **PASS** | `cargo test --test integration_tests paws_surface::` — 5/5 |
| **TEST-14** | **PASS** | e2e `17-paws-surface/project-references-absent.spec.ts` (11/11 suite) |

### TEST-11 — written during phase 8, and why it was missing

This ID had **no test at all** until phase 8. ITEM-9 had been implemented by
DELETING the desktop force-on override, so the change was visible in the diff but
asserted nowhere, and the first draft of this file recorded it `NOT VERIFIED`.

That was the wrong call, and the lifecycle gate was right to refuse it: what this
code must NOT do is exactly as load-bearing as what it does. The block used to
read `config.web_search.get_or_insert_with(Default::default).enabled = true`,
which writes unconditionally — clobbering an operator's explicit `false` as
happily as filling in a missing default, and so making the paws kill switch a
no-op on the one platform the reduction targets. Nothing else catches that: the
`core/config.rs` tests prove the SERVER default is off and would stay green while
the desktop build forced it back on.

Written as: `apply_desktop_feature_defaults(&mut ziee::Config)` extracted out of
`BackendModule::init` (the seam that was missing), plus two tests in that file.
They parse the REAL `packaging/config.default.yaml` rather than a stub, the same
approach `core::config::paws_kill_switch_tests` uses.

**Mutation-probed, not merely green**: re-inserting the original
`config.web_search.get_or_insert_with(..).enabled = true` line makes **both**
tests fail with their own messages; removing it makes both pass. The guard kills
the actual bug rather than decorating the fix. Each test also carries a positive
control (`code_sandbox` and `bio_mcp` still default ON) so it cannot be satisfied
by the helper degenerating into a no-op.

One incidental export was needed: `ziee::WebSearchConfig` is now re-exported from
`server/src/lib.rs`, because `core` is a private module and the desktop crate
could not otherwise name the type.

---

## Gate + workspace checks

Recorded in the gate's literal form so they are machine-checkable:

- `npm run check (ui): PASS` — exit 0, captured with `set -o pipefail`
- `npm run check (desktop/ui): PASS` — exit 0, 114/114
- `gate:ui (ui): PASS` — exit 0; `tsc`/`lint`/`runtime-health`/`visual` all PASS; per-surface 200/200; validity 590/590 cells, origin alive (76 checks), transport artifacts 0 (0% of findings)
- `gate:ui (desktop/ui): PASS` — exit 0; `tsc`/`lint`/`runtime-health`/`coverage` all PASS; per-surface 35/35; validity 222/222 cells, origin alive (49 checks), transport artifacts 0 (0%). Its `visual` stage reports **PASS because it is "not configured for this app"** (`visualConfig: null`), not because pixel baselines matched — stated plainly so the line is not read as stronger than it is.

| other check | verdict |
|---|---|
| `cargo check -p ziee --lib` | **PASS** — 5 pre-existing warnings, no errors |
| `cargo test -p ziee-desktop --lib` (backend module) | **PASS** — TEST-11's 2 cases, mutation-probed |
| e2e `17-paws-surface` (`--workers=1`) | **PASS** — 11/11 in 7.4m |

The gate's surface count moved 210 → 200. That is the two newly-hidden modules'
gallery surfaces plus the dropped literature right-panel surface leaving the
denominator, not a coverage loss on a surviving surface.

The gate's surface count moved 210 → 200. That is the two newly-hidden modules'
gallery surfaces plus the dropped literature right-panel surface leaving the
denominator, not a coverage loss on a surviving surface.

---

## Additional runs behind the HF-6 change

| run | verdict |
|---|---|
| `cargo test --test integration_tests -- mcp::run_in_sandbox_test mcp::system_server` | **12/12 PASS**, incl. `list_system_servers_includes_run_in_sandbox` — the test that exercises the changed exclusion set |
| `cargo test --test integration_tests mcp::` (full) | 537 passed / 69 failed — every failure classified below, none attributable to this branch |

### The 69 MCP failures, classified

Classification was required by `CLAUDE.md`'s known-environment-floor rule before
any regression claim. Counts are from the log, not from memory.

| cause | count | category |
|---|---|---|
| `No AI provider API keys found` / `ANTHROPIC_API_KEY required` | 62 | **A** — `tests/.env.test` does not exist anywhere on this machine |
| `squashfuse is not installed` (+2 sandbox-author) | 5 | **A** — missing host dep |
| `conformance_errors_test::error_http_500_surfaces_as_error_not_panic` | 1 | **pre-existing** — proven, see control below |
| `stdio_transport_test` (one case per run) | 1 | **flaky** — proven, see control below |

**Control run** (the only honest way to settle the last two): `repository.rs`
was reverted to `origin/main`, the crate rebuilt, and the two files re-run.

- `error_http_500_surfaces_as_error_not_panic` **failed identically without the
  change** → pre-existing, not this branch.
- `stdio_transport_test::test_stdio_list_server_tools` **passed** in the control
  while a DIFFERENT case in the same npx-dependent file
  (`test_stdio_call_echo_tool`) failed → a different member failing per run is
  flakiness, not a deterministic regression.

`repository.rs` was restored to HEAD afterwards; `git diff origin/main...HEAD`
on that file shows the intended 17 insertions / 7 deletions.

### Correction to the earlier handover

`HANDOVER.md` lists `source tests/.env.test` as part of the verification recipe.
**That file has never existed on this machine** — checked in both the worktree
and the main clone. Any earlier command that appeared to use it ran without keys.
Consequence for whoever picks this up: the real-LLM-gated portion of the backend
suite has never been exercised here, and cannot be until the file is supplied.

---

## Not run here, and why

| | |
|---|---|
| macOS artifacts | no Darwin toolchain on this Linux box |
| Tier 4/5/6 code_sandbox | `squashfuse` absent; no rootfs mounted |
| real-LLM suites (chat, agentic, project injection) | no `tests/.env.test` — see above |
| full `cargo test --workspace` | not attempted; the scoped suites above are the ones this diff can affect |
