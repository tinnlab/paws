# Regression scope — the suites this branch's changes could plausibly break

Run during the fix loop (scoped, per the phase-7 rule), because round 1's fixes
touched files OUTSIDE this feature: `llm_repository/connection_health.rs` (the
boot health scan), `llm_repository/models.rs` (the extracted credential
decision), `llm_model/handlers/uploads.rs` (its one caller), and
`onboarding/OnboardingPage.tsx` (the wizard's reset sites).

Every failure below is classified against CLAUDE.md's A/B/C environment floor
BEFORE being called a regression, as that section requires.

| suite | result | verdict |
|---|---|---|
| `cargo test --lib llm_repository::` | **36 passed, 0 failed** | clean |
| `llm_repository::` integration (`--test-threads=6`) | 55 passed, **1 failed** | **Category A** — `create_enabled_huggingface_repo_probes_live_and_persists_healthy` panics at `HUGGINGFACE_API_KEY not set … NotPresent`, before reaching any code this branch touches. `tests/.env.test` does not exist on this box. |
| `llm_provider::` integration (`--test-threads=6`) | **81 passed, 0 failed** | clean |
| `onboarding::` integration (`--test-threads=6`) | **14 passed, 0 failed** | clean |
| `llm_model::` integration (`--test-threads=6`) | 103 passed, **19 failed** | **Category A** — every one panics at `HUGGINGFACE_API_KEY not set` or `GITHUB_TOKEN not set`, at the env fetch, before any product code runs. CLAUDE.md documents this exact floor ("11 failures in `llm_model::download_*` tests (expected)" without the env file). |
| `seed::` integration (`--test-threads=6`) | 2 passed, **2 failed** | **pre-existing suite race, NOT this branch.** |
| `seed::` integration (`--test-threads=1`) | **4 passed, 0 failed** | clean serially |

## On the `seed::` failures — why they are not mine

`seed_creates_and_ledgers_the_overlay_only_demo_provider` and
`seed_rerun_is_idempotent` both call `ziee::init_repositories(pool)`, which
points a PROCESS-GLOBAL `Repos` at their own database. Run concurrently they
clobber each other: the overlay test's `SeedDemo` row landed in the idempotency
test's database, which then counted **9 providers instead of 8**.

That is a race over `llm_providers`. This branch adds one `llm_repositories`
row and touches no seed code, no provider seed, and no `Repos` wiring. The test
file itself documents the hazard in three separate comments ("the codebase norm
for Repos-using integration tests", "the small cross-test `Repos` window"). Both
tests pass serially.

**Consequence for phase 8:** the `seed::` module is run at `--test-threads=1`.
Everything else runs parallel, per CLAUDE.md's guidance that the suite isolates
at the DB layer and 6-8 threads is the sweet spot.

## What is NOT covered here

The credential extraction's one caller (`initiate_repository_download_internal`)
is exercised by `llm_model::download_test`, which is entirely Category-A blocked
on this box. Its behaviour is instead pinned by the `git_credential` unit tests
(TEST-4, verified RED under mutation) plus the three `default_model_*`
integration tests, which drive the same handler through the real endpoint.
