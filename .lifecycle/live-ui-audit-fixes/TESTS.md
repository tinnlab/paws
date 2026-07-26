# TESTS — live-ui-audit-fixes

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise (the audit's own measurable signal), not merely
what the new code happens to do.

No new permission is introduced (the batch endpoint reuses `projects::read`),
so no `[negative-perm]` restricted-user e2e is required — but the batch
endpoint's own deny path IS tested (TEST-4).

## Tests

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/modules/project/types.rs` — asserts: `ProjectsByConversationsRequest::validate()` accepts an empty batch and a batch exactly AT `MAX_CONVERSATIONS_PER_LOOKUP`, and rejects cap+1 with a 422 carrying the `TOO_MANY_CONVERSATION_IDS` code
- **TEST-2** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/project/conversations_test.rs` — asserts: `projects_for_conversations_resolves_many_in_one_call` — one POST resolves 5 mixed ids; the 3 attached ones return their correct project, the unfiled and the unknown id are ABSENT (not null entries), and the batched answer matches the singular `by-conversation` endpoint row-for-row
- **TEST-3** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/project/conversations_test.rs` — asserts: `projects_for_conversations_never_leaks_another_users_conversation` — alice batching her own id + Bob's project-bound id gets her link and NOTHING about Bob's (no membership fact, no project row)
- **TEST-4** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/project/conversations_test.rs` — asserts: `projects_for_conversations_requires_auth_and_projects_read` (401 with no token, 403 for an authenticated user lacking `projects::read`) and `projects_for_conversations_over_cap_is_422` (201 ids → 422, exactly 200 → 200) and `projects_for_conversations_empty_batch_is_an_empty_answer`
- **TEST-5** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/modules/projects/chat-extension/projectLookupBatch.test.ts` — asserts: 40 concurrent loads coalesce into ONE fetch carrying every id; omitted ids resolve `null`; a rejected fetch settles EVERY id as `null` (no hung promise → no forever-spinning badge); a duplicate id appears once; an over-cap batch chunks at the cap; one failing chunk does not poison the others; a later window re-fetches
- **TEST-6** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-3] file: `src-app/ui/tests/e2e/perf/live-audit-network-hygiene.spec.ts` — asserts: with 12 seeded conversations (3 filed) the `/chats` list issues ZERO `GET /api/projects/by-conversation/{id}` and ≥1 (but < row-count) `POST /api/projects/by-conversations`, AND the filed conversation's badge still renders its project tag — i.e. the burst is BATCHED, not suppressed
- **TEST-7** (tier: unit) [covers: ITEM-4] file: `src-app/ui/src/core/llmModelCatalogPure.test.ts` — asserts: `createCoalescedLoader` — three overlapping callers issue ONE request; a caller landing after the first resolved but inside the TTL reuses it; past the TTL it re-fetches; `force`/`invalidate()` bypass the cache; a rejection is NOT cached
- **TEST-8** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-5] file: `src-app/ui/tests/e2e/perf/live-audit-network-hygiene.spec.ts` — asserts: a real app load (login → shell rendered → 4 s settle) issues `GET /api/llm-models` at most ONCE, against the real backend with no request mocking
- **TEST-9** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/settings-general/components/accentSwatch.test.ts` — asserts: `accentSwatchColors` returns the LIGHT variant in light mode and the DARK variant + the preset's own `fg` in dark mode, explicitly NOT the light `hsl(220 47% 43%)` (= the measured `rgb(58,92,161)`), and that every preset's two variants differ
- **TEST-10** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-6] file: `src-app/ui/tests/e2e/perf/live-audit-ui-conformance.spec.ts` — asserts: on `/settings/general` in dark mode NO accent swatch computes to `rgb(58, 92, 161)` (the light-blue primary the audit measured), and the swatch for the ACTIVE accent equals the live `--primary` token converted to rgb — i.e. the preview equals what selecting it installs
- **TEST-11** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-7] file: `src-app/ui/tests/e2e/perf/live-audit-ui-conformance.spec.ts` — asserts: at a 390×844 viewport the conversation view has `body.scrollWidth <= clientWidth` (the audit's exact "body scrollWidth 419 > viewport 390" signal) AND no interactive control's box crosses either viewport edge (the `clipped-control` signal), excluding sub-2px absolutely-positioned assistive affordances
- **TEST-12** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/openapi/emit_ts.rs` — asserts: the existing golden parity test `openapi::emit_ts::tests::types_ts_parity` regenerates `api-client/types.ts` from the committed `openapi.json` byte-for-byte — i.e. the new `Project.forConversations` operation + its three schemas were regenerated, not hand-edited
- **TEST-13** (tier: e2e) [acceptance] [invariant: INV-5] [covers: ITEM-8] file: `agent-kit/skills/live-ui-audit/live-ui-audit.mjs` — asserts: the SAME battery (same flags, same backend `:29285`, same seeded data), run against a build of the branch BEFORE and AFTER the fixes, reports the `network/n+1` `by-conversation` rows and the `duplicate GET /api/llm-models fired 3×` rows in the BEFORE run and ZERO of them in the AFTER run; the per-finding before→after counts are transcribed into TEST_RESULTS.md

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 backend batch endpoint | TEST-1, TEST-2, TEST-3, TEST-4 |
| ITEM-2 OpenAPI regen (both workspaces) | TEST-12 |
| ITEM-3 frontend batching loader | TEST-5, TEST-6 |
| ITEM-4 shared model catalog | TEST-7 |
| ITEM-5 call-site migration | TEST-8 |
| ITEM-6 accent swatch | TEST-9, TEST-10 |
| ITEM-7 geometry findings | TEST-11 |
| ITEM-8 audit before→after proof | TEST-13 |

| INV | acceptance test |
|---|---|
| INV-1 responsive-fidelity at 390px | TEST-11 |
| INV-2 no `n+1` burst | TEST-6 |
| INV-3 no `duplicate` in a step | TEST-8 |
| INV-4 no hardcoded/off-theme color | TEST-10 |
| INV-5 evidence-based proof | TEST-13 |
