# FIX_ROUND-1 — resolving the phase-6 ledger

Four blind agents ran 16 angles over the full diff (`correctness · error-handling ·
concurrency · security · perf · state-management · api-contract · tests-quality ·
design-conformance · patterns-conformance · modularity · extensibility ·
maintainability · api-friendliness · i18n-copy · wired-and-behaving`). 27 ledger
rows: 23 confirmed, 3 rejected with rationale, 1 partially-confirmed.

## Fixed

- **SDK specs were in a directory no runner reaches** (high, 3 agents independently).
  `src-app/ui`'s `test:unit` globs `src/**` relative to that workspace and no sdk
  package has a test script, so `chunk-recovery.ts` shipped with ZERO executed
  coverage and the INV-2 acceptance test never ran in a gate. Both specs moved to
  `src-app/ui/src/api-client/` (importing the sdk source relatively — the
  workspace's established pattern, already used by the pre-existing
  `lazy-dispatch.test.ts`), and the duplicated dispatcher cases were consolidated
  into that one file instead of a second, drifting copy.
- **Reload advice was prescribed for causes a reload cannot fix** (medium, 3 agents).
  The likeliest real trigger is the model extension's `No model selected`. Advice
  is now gated on `isLoadFailureCause` (which recognises every browser + bundler
  dialect, TEST-5c), so a config problem shows its own cause and a chunk failure
  shows the reload. This also fixed the sticky-stale complaint: a stale mark from
  a blip earlier in the session can no longer attach "the app may have been
  updated" to an unrelated failure hours later.
- **The message was ungrammatical and leaked an unbounded cause** (medium).
  Now `the "model" chat extension failed: <cause>`, with the cause capped at
  `MAX_CAUSE_CHARS` so a raw server error body cannot become an unbounded toast
  (TEST-4f).
- **`branch_id` was unguarded** (medium). The generated client type makes
  `Conversation.active_branch_id` optional while the server declares it a `Uuid`,
  so an absent one still POSTed `branch_id: ""` and returned the same raw 422.
  Now in the required-field table and checked on the assembled payload (TEST-19).
- **Key precedence had silently inverted** (low). `id`/`branch_id` are written
  BEFORE the spread again, so an extension-contributed value still wins as it did
  in the old literal (TEST-20).
- **The "leaves no debris" claim was false for `startRegenerateMessage`** (medium).
  It latches the fork anchor and trims the transcript before calling, and has no
  catch; a pre-flight abort now clears the pending branch, so the user's next
  message cannot silently fork at a stale assistant anchor (TEST-18).
- **`markStaleBuild` had no caller** (medium, 3 agents). The dispatcher's give-up
  path now calls it, so the explanation is reachable in dev, for a plain rejected
  `import()`, and for the nullish-namespace path — not only for Vite's
  `vite:preloadError` (TEST-6d).
- **Prefetch amplification** (medium). The idle warm loop bails once a chunk has
  already failed; one deploy-while-a-tab-is-open otherwise turned a prefetch
  nobody asked for into hundreds of doomed requests with backoff timers.
- **The `installed` guard was module-scope** (low). Now per-target (WeakSet) and
  released by uninstall, so one caller that never uninstalls cannot latch
  installation off for the whole process (TEST-11b2, TEST-11c).
- **Both entry comments described the OPPOSITE of the code** (low) — they claimed
  the listener preventDefaults, which a whole section of the module explains must
  never happen. Corrected in both entries.
- **Structured failure detail had no reader** (medium) — `failures` /
  `missingFields` are now logged by the send path, which is what makes a support
  report actionable without putting a stack in a toast.
- **Hand-rolled message extraction** (medium) — shared with `sendFailureState` as
  `sendErrorMessage` rather than a second, subtly-different vocabulary.
- **The guard was inlined and split across two files** (medium) — the field→label
  table now lives beside the sentence that renders it, as
  `assertRequiredRequestFields`. Adding a required field is one edit.
- **The e2e was one test carrying four IDs** (medium) — split into four, each
  arranging its own stack, so a failure in one leg can no longer hide the others.
  Its "actionable message" check is two requirements instead of a loose OR.
- **No test drove a real production contributor** (medium) — TEST-2d pins the
  model extension's `No model selected` path, with a source assertion that fails
  loudly if that throw is renamed (the extension is `.tsx` and cannot be imported
  by this runner). TEST-2c pins the accepted availability cost of uniform
  fail-closed, so it can never become accidental.
- **`main.entry-wiring` matcher was brittle** (low) — it no longer false-fails on
  a legal `void`/`await`/indentation refactor.

## Found by MY OWN negative control, and fixed

- **e2e TEST-14's "keeps re-attempting" assertion was hollow.** Reinstating the
  old memoize-forever dispatcher policy did NOT turn it red: the composer's
  per-pane store — and therefore its lazy dispatchers — do not necessarily
  survive the failure re-render, so fresh chunk-load attempts appear either way.
  Two successive attempts to make it discriminate (scoping the counter to one
  chunk, then requiring a full retry burst) each failed on a different confound
  (Vite emits a variable number of `vite:preloadError` events per attempt). The
  assertion was REMOVED rather than kept — a test that passes with the defect
  present inflates coverage and proves nothing. The never-memoize property stays
  pinned where it is genuinely discriminating: unit TEST-6/TEST-6b, both verified
  red under exactly that mutation.

## Rejected, with rationale (recorded in LEDGER.jsonl, not silently dropped)

- **Duplicate surfacing (toast + Alert)** — deliberate. The THROW is required by
  the tool-approval card (it reverts its optimistic update on it); the
  `store.error` is required by `startRegenerateMessage` (no catch). Suppressing
  the composer toast for this error class would leave the NewChatPage path, where
  no conversation error Alert is mounted, with no signal at all. A duplicated
  message beats a missed one on the app's primary action.
- **`as Partial<SendMessageRequest>` is still a blanket cast** — `ExtensionRequestFields`
  is an open `[key: string]: unknown` map BY DESIGN; that is the extension seam's
  contract. INV-3 concerns the REQUIRED fields the server rejects on, which are
  now typed and checked. Validating every optional field needs a client-side
  schema that does not exist.
- **TEST-4 ID collision with a pre-existing file** — lifecycle TEST-IDs are scoped
  to a branch's own TESTS.md; the pre-existing TEST-4 belongs to an already-merged
  lifecycle. Renaming would break the TESTS.md↔spec mapping the gate checks.

## Standing, accepted, and now ASSERTED rather than assumed

- **INV-2 is not fully deliverable in a browser.** Three agents converged on this
  and they are right: once a module specifier's fetch fails, the HTML module map
  records the failure for that document, so neither the in-dispatch retries nor a
  later dispatch re-request a bundler-rewritten specifier. `DESIGN_FIDELITY.md`
  is corrected from UPHELD to **AT-RISK** with the delivered scope stated
  precisely, the module header now documents the measured limit instead of
  promising recovery, and the e2e asserts the recovery that IS delivered (the
  prescribed reload works, and the recovered send carries `model_id`).

**New confirmed findings:** 0
