# DRIFT-1 — implementation vs plan (authored during phase 5)

Reconciled each ITEM against PLAN.md AND the design's invariants as it landed.

- **DRIFT-1.1** — verdict: impl-wins — PLAN said "shared LLM-model catalog
  (`src-app/ui/src/core/llmModelCatalog.ts`)" as ONE file. It shipped as THREE:
  `core/coalescedLoader.ts` (the generic coalescer), `core/llmModelCapabilities.ts`
  (the pure server-parity filter) and `core/llmModelCatalog.ts` (ApiClient wiring
  + re-exports). Forced by the node unit-test loader: it cannot resolve the
  generated `@/api-client` module graph, so any test importing the catalog file
  would have died on `apiEndpoints`. Splitting the PURE logic out is what made
  TEST-7 a real test instead of an untestable claim — and it is better modularity
  (the coalescer is reusable). PLAN.md §Files-to-touch amended to list all three.
  Call sites are unchanged (`llmModelCatalog` re-exports `filterByCapability`).

- **DRIFT-1.2** — verdict: impl-wins — PLAN's ITEM-3 implied the batching would
  live inline in `extension.tsx`. It shipped as a separate
  `projects/chat-extension/projectLookupBatch.ts` (`createBatchLoader`) with the
  extension wiring one instance. Same reason as 1.1: the batching CONTRACT (every
  id settles, chunking, one request per window) is the load-bearing part and had
  to be unit-testable without React or the API client. The extension's cache +
  in-flight maps stayed exactly where PLAN said, so `conversationHref`'s
  synchronous read is untouched.

- **DRIFT-1.3** — verdict: resolved — PLAN's ITEM-7 assumed the 390 px overflow
  might be a real source defect to fix. Measurement during phase 2 (a fresh build
  of this branch, `body.scrollWidth === 390`, zero overflowing elements, vs the
  `:1520` bundle linking a 27 KB CSS chunk with no `.sr-only`/`.fixed`/`.min-w-0`/
  `.flex-1`) showed it is a stale-artifact symptom. ITEM-7 was rewritten BEFORE
  implementation to "reproduce, name the mechanism, ship a regression guard", and
  DEC-8 records the disposition. No source change was invented, per INV-5.

- **DRIFT-1.4** — verdict: none — accepted, documented behaviour change:
  summarization / file-rag / onboarding previously asked the SERVER for a
  capability-filtered first 200 (e.g. the first 200 CHAT models); they now filter
  the first 200 models overall. On a deployment with >200 models whose chat models
  sort late, a picker could show fewer rows than before. Not a regression of the
  audit finding and not observable below 200 models; the pre-existing cap was
  already 200 per caller, so the change is *which* 200, not *how many*. Recorded
  rather than silently accepted; raising `CATALOG_PAGE_SIZE` is the one-line
  escape if a deployment ever needs it.

- **DRIFT-1.5** — verdict: none — a force-refresh of a single conversation
  (attach/detach) now waits out the 20 ms batch window before its request goes
  out. Intended (DEC-4) and imperceptible; the existing `trailing-badge` e2e still
  drives the flip without a reload.

**Unresolved drifts:** 0
