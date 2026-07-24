# DRIFT-3 — iteration round 3 (observation content type)

Audited the observation delta against the amended PLAN/DECISIONS/TESTS.

- **DRIFT-3.1** — verdict: resolved — ITEM-7 (observation content type) implemented
  as planned: `Observation { text }` variant in the text extension (types.rs +
  extension.rs), `handled_content_types` += `observation`,
  `process_content_for_llm(Observation) → ContentBlock::Text` (wire → user text),
  `#[serde(skip)] content_as_observation` on `SendMessageRequest`, resume sets it.
  Agent-core reuses the shared converter (transcript.rs:247) — no second path.
- **DRIFT-3.2** — verdict: resolved — ITEM-8 (FE renderer + distinct card):
  `ObservationContent.tsx` registered in the text extension `contentTypes`;
  `ChatMessage.tsx` `renderAsUser` gate; `MessageActions` hides Edit. Gallery
  coverage + testid registered.
- **DRIFT-3.3** — verdict: resolved — ITEM-9 (regen) run for both `ui/` +
  `desktop/ui/`; golden `types_ts_parity` + `_desktop` green.
- **DRIFT-3.4** — verdict: impl-wins — the blind audit surfaced that the new
  `observation` type must be propagated to the OTHER text extractors, not just
  `MessageActions.extractText`: `startRegenerateMessage` (regenerate-after-
  observation was broken → empty send), `findMatches.messageText` (find + collapse
  threshold), and `export/extension` (transcript export). Fixed all three +
  the `isUser`→`renderAsUser` consistency on the two remaining `ContentRenderer`
  call sites + a clearer card label ("Background result"). PLAN ITEM-8's scope
  implicitly includes these sibling extractors; no PLAN amendment needed (they are
  part of "render/handle the observation content type end-to-end").

**Unresolved drifts:** 0
