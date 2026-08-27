# DRIFT-1 — implementation vs plan

Authored DURING phase 5, item by item, as each landed.

- **DRIFT-1.1** — verdict: plan-wins — ITEM-1/ITEM-2 landed exactly as planned (panel owns both bounds via `className`; `min-w-0` + CSS truncation in the row). No divergence. The only addition beyond the plan's words is the `llm-download-list` testid on the scroller, needed so the harness can assert the list is its own scroll container.

- **DRIFT-1.2** — verdict: impl-wins — **PLAN amended.** ITEM-12's reproduction surfaced a THIRD transited state, not either of the two ITEM-14 enumerated. Observed live, not inferred: a chat send during the post-download validation window fails with `502 engine_start_failed: "missing per-instance bearer token"`, because `LocalDeployment::stop` removes the model from the process-global `INSTANCE_API_KEYS` map BEFORE the `llm_runtime_instances` row leaves `status='running'`, while `proxy_handlers.rs` reads base_url first and bearer second.

  PLAN.md said, in ITEM-14's verdict and in `DESIGN_FIDELITY.md`'s INV-5 line, that a third state "becomes a new item rather than being folded in silently". Honouring that: **ITEM-17 added**, with its own verdict, and TESTS.md gains TEST-17 covering it. ITEM-14's two enumerated states are kept — they are still reachable states of the same teardown and the retry covers all three by construction, but they are asserted separately rather than assumed.

  Phases 1–3 re-run after the amendment.

- **DRIFT-1.3** — verdict: impl-wins — **the design doc's framing of item 5 was too generous to the brief, and is corrected.** `docs/design/paws-ui-polish.md` presented the double-`enqueue` race as the leading hypothesis with the sync gaps as "found on the way". The reproduction confirms the race half but shows the double enqueue **does not create** the window — it doubles how long it stays open. The cause is the ordering bug (DRIFT-1.2). The design doc's item-5 section is updated to say so, because leaving it as written would let a reader conclude the sync work fixed the symptom. It did not, and the PR says the same.

- **DRIFT-1.4** — verdict: none — ITEM-13 (single enqueue) landed as planned. DEC-7 said the site to keep is the one covering BOTH flows; confirmed by reading both call graphs: `uploads.rs:347` is inside `create_model_with_files`, reached by upload-commit AND repository-download, while the removed site was in the download task only.

- **DRIFT-1.5** — verdict: impl-wins — TEST-16's file is `loadLlmProviders.store.test.ts`, not the `loadLlmProviders.test.ts` TESTS.md named. `vitest.config.ts` includes `src/**/*.store.test.ts` and `src/**/*.test.tsx`; a plain `.test.ts` is picked up by the `node --test` runner instead, which cannot mock the API client. The TEST-ID is unchanged (A5 guards ID shrinkage, not file naming); TESTS.md's path is corrected.

- **DRIFT-1.6** — verdict: resolved — three component harnesses (TEST-2, TEST-3, TEST-7) initially anchored their assertions on testids this change ADDS, so they went red against pre-fix code with "expected null to be truthy" — a bookkeeping red, not the defect. Each was re-anchored on DOM structure present in BOTH versions (the name/percent flex row's children; `[data-slot="popover-content"]`; the widget element itself). Re-verified: they now fail on the real mechanisms — the `substring(0, 30)` slice, the un-merged `w-72` + the inline 320px wrapper, and the row vanishing with the Tools section. This is the bell harness's own recorded lesson ("a red that isn't caused by the defect proves nothing about the defect") being re-learned rather than inherited; noted so the next harness in this family starts from it.

- **DRIFT-1.7** — verdict: none — ITEM-8's sweep found two hidden-feature references beyond the three skills the owner's question named: `configure-code-sandbox`'s "Workflows that use sandbox" section (workflow is hidden) and `use-assistants`'s "Template assistants" section (design item 12 removed that surface). Both removed. INV-4 is a claim about EVERY shipping skill, not only the three, so this is the invariant being honoured rather than scope creep — and TEST-10 asserts it over the whole set, so a miss would have failed the gate anyway.

- **DRIFT-1.8** — verdict: impl-wins — **TEST-12 and TEST-13 amended to what is actually reachable, and the gap stated rather than papered over.**

  TEST-12 was planned as an integration test driving G2 over the two states PLAN predicted. Two independent reasons it cannot be: (a) `INSTANCE_API_KEYS` is a process-global inside the SERVER process while the harness spawns the server as a subprocess, so no out-of-process test can produce "row says running, bearer already dropped"; and (b) `probe_liveness` health-checks the row's `base_url`, so forcing a `running` row with a dead process just gets restarted before the window is reached — an integration test written that way would have passed against the BROKEN code, which is worse than not having it.

  The resolve policy was therefore extracted into `resolve_engine_endpoint` (real production code, called by the proxy; not a mock) with the two lookups and the restart injected, and TEST-17 drives it directly. Verified RED: with the retry arm disabled the recovery case fails `left: Err(BearerMissingAfterRestart), right: Ok(...)` while the two controls still pass.

  TEST-13's download-path count is likewise unreachable — `GitService::clone_repository` enforces `PUBLIC_HTTP_OR_HTTPS` unconditionally, so a loopback git fixture is refused by design. It now asserts the upload path's single enqueue (same `create_model_with_files` funnel), with the download-path evidence coming from the live reproduction.

  Per DEC-10's escape clause: where a deterministic assertion cannot capture the symptom, that is reported, with what it does and does not prove — not dressed up. Both limits are written into TESTS.md and go in the PR body.

**Unresolved drifts:** 0
