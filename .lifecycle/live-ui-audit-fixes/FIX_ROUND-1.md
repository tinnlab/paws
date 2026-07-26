# FIX_ROUND-1 — live-ui-audit-fixes

Four blind, diff-only reviewers ran 17 angles over `git diff
origin/feat/agent-core...HEAD` (correctness, security, perms/authz,
error-handling, concurrency, state-management, api-contract, tests-quality,
patterns-conformance, perf, a11y, i18n/copy, modularity, extensibility,
maintainability, api-friendliness, design-conformance). Findings in
`LEDGER.jsonl`. Everything confirmed is fixed below; four are rejected with a
recorded rationale (a dismissed finding is not a fix — the rejections are
argued, not waved away).

## Fixed — the two that were genuine DEFECTS in the shipped behaviour

1. **Catalog pagination broke server parity** (4 reviewers, high). The server
   applies `?capability=` BEFORE paginating, so the old
   `?capability=X&perPage=200` returned up to 200 MATCHING models; fetching the
   first 200 UNFILTERED rows and filtering client-side would silently drop any
   embedder/reranker/chat model ranked past row 200. `loadLlmModelCatalog` now
   WALKS pages until the server's `total` (bounded by `CATALOG_MAX_PAGES = 10`),
   restoring exact parity while still costing ONE request on any deployment with
   ≤200 models. The false "no picker loses rows" reasoning in the doc comment is
   replaced by the real one.
2. **A failed batch was cached as a real answer** (2 reviewers, high). The loader
   resolved every id in a failed chunk as `null` and the caller cached it, so one
   transient failure mislabelled up to 200 FILED conversations as "unfiled"
   permanently — a bigger blast radius than the per-id path it replaced.
   `createBatchLoader` now returns `{value, failed}`; `extension.tsx` caches only
   when `!failed`, so a failure degrades this render and RETRIES on the next
   mount.

## Fixed — robustness / correctness of the new code

3. `flush()` called `fetchChunk` while building the `Promise.all` argument, so a
   SYNCHRONOUS throw escaped both catches, aborted `flush` inside a timer
   callback and stranded every resolver — the exact hazard the module doc claims
   to prevent. Now wrapped in `Promise.resolve().then(...)`, each resolver call
   isolated, and covered by two new unit tests (sync-throw, throwing resolver).
4. `createCoalescedLoader`: `invalidate()` cleared only the cache, so the next
   reader got the pre-invalidation in-flight promise which then repopulated the
   cache; and a superseded pre-`force` request still wrote the cache, re-stamping
   its timestamp and keeping stale data alive an extra TTL. Both fixed with a
   generation counter; both pinned by new interleave tests that actually hold a
   request in flight (the old force/invalidate test resolved synchronously and
   could not fail).
5. `extension.tsx` deleted its `.catch` while all consumers still call `.then`
   bare, and cleared the in-flight slot unconditionally (a stale lookup evicting
   a newer force-refresh). Both restored — `.catch` back, and the slot cleared
   only when it is still ours.
6. Memory-admin used two DIFFERENT capability predicates on adjacent lines
   (truthiness vs `=== true`), so a model with a non-boolean flag fell out of
   BOTH pickers. Now one predicate feeds both lists.

## Fixed — contract, payload, conventions, a11y

7. The batch response inlined the FULL `Project` row (up to 64 KiB
   `instructions`) per link, so 200 conversations in one project repeated it 200
   times. The response is now de-duplicated: `links` carry
   `{conversation_id, project_id}` and `projects` lists each row ONCE. Payload is
   O(conversations + projects). Integration test asserts the de-duplication AND
   that the batched project row is byte-identical to the singular endpoint's.
8. `ModelCapabilityName` was a hand-maintained union duplicating the server's
   allowlist; it is now DERIVED from the generated `ModelCapabilities`, so an
   OpenAPI regen that renames a capability breaks the build instead of silently
   emptying a picker.
9. `invalidateLlmModelCatalog` had zero callers (dead public surface, §15). It is
   now wired to `sync:llm_model`, so a model create/update/delete invalidates
   every picker immediately instead of after the TTL — which also removes the
   "an admin sees a stale list" concern the TTL raised. `flushNow` (also unused)
   was deleted rather than kept as untested API.
10. 422 built with the low-level `AppError::new(StatusCode::…)` → the module's
    `AppError::unprocessable_entity`; the message now states the REMEDY ("split
    the list into batches of 200 or fewer"); the OpenAPI description interpolates
    `MAX_CONVERSATIONS_PER_LOOKUP` instead of hardcoding "200" twice.
11. The accent picker exposed selection only visually — added `aria-pressed`. The
    selected check icon dropped its inline colour + second lint escape for the
    semantic `text-primary-foreground` (correct because `applyAccent` sets
    `--primary-foreground` to exactly the selected preset's `fg`).
12. Stale comment describing the per-id GET at the now-batched call site.

## Fixed — tests that could not fail (the paper-9/9 class)

13. **TEST-10 never entered dark mode** — it wrote `localStorage['theme']`/
    `['ui-theme']`, keys the app never reads (the preference lives in
    `config-client-storage`, default `system`). CONFIRMED BY THE RUN: it failed
    on `expect(probe.isDark)`. Rewritten to use `page.emulateMedia({colorScheme})`
    (the repo's own precedent), to assert the SELECTED swatch equals the live
    `--primary`, and to cover BOTH themes plus "every swatch changed between
    themes" — the property the pre-fix code actually violated.
14. **TEST-8 was vacuous at zero** (`toBeLessThanOrEqual(1)`) and never visited a
    surface that reads the catalog. Now navigates to the memory-admin page (which
    alone used to fire two of the three calls) and asserts exactly `1`.
15. **TEST-6 accepted five batched requests for six rows** and drove badges with
    sequential hovers, so the single mount-wave burst was never reproduced. Now
    runs in a `hasTouch` context (where `(hover:none)` makes every row mount at
    once — the case the audit measured), asserts exactly ONE batched request and
    ZERO per-id requests, and asserts BOTH a filed badge and an unfiled
    "Add to project" render — so a fix that merely stopped asking would fail.
16. `accentSwatch.test.ts` asserted against a hand-mirrored copy of the presets
    with nothing detecting drift; it now reads the shipped
    `sdk/packages/shell/src/theme/accentPresets.ts` and fails if a mirrored
    channel string is no longer present.
17. The integration cap test hardcoded 201/200 and asserted only the status; it
    now derives from a documented CAP, asserts `error_code ==
    TOO_MANY_CONVERSATION_IDS` (so axum's own 422 on a malformed body cannot pass
    for it), and the parity test compares the FULL project object rather than
    id+name.

## Widened after the coordinator's systemic report

18. TEST-11 was a single-surface 390 px guard. A wider live sweep reported the
    overflow on **27 surfaces** attributed to one shared shell container, so a
    single-surface guard could pass while the shell broke everywhere. TEST-11 now
    sweeps EIGHT surfaces (chat, conversations, projects, hub grid, and the four
    widest admin tables/forms) and reports the widest offending element by name.
    Measurement of that report is in TEST_RESULTS.md — it does not reproduce on a
    correct build.

**New confirmed findings:** 0
