# voice-composer-insert — TESTS

Three runners, all of which actually execute this workspace's specs — verified,
not assumed:

| tier | runner | glob it picks up |
|---|---|---|
| `unit` | `npm run test:unit` → `node --import ./scripts/node-test-loader.mjs --test "src/**/*.test.ts"` | plain `*.test.ts` |
| `integration` | `npm run test:component` → `vitest run .test.tsx` | `*.test.tsx` (jsdom, mounts real components) |
| `e2e` | `npx playwright test tests/e2e/14-voice/…` | `*.spec.ts` |

> **Runner trap, checked before writing a line of test code.** `vitest.config.ts`
> `include` is `['src/**/*.store.test.ts', 'src/**/*.test.tsx']` — a plain
> `*.test.ts` is INVISIBLE to vitest. It is not invisible to this repo, because
> `npm run test:unit` runs plain `*.test.ts` under `node:test` (that is how the
> existing `voiceLogic.test.ts` runs today). So the pure-logic specs stay
> `*.test.ts` and MUST be verified via `test:unit`; the mounted-component specs
> MUST be `*.test.tsx` or they run nowhere. Phase 8 records both runners' real
> counts.

---

## Unit — pure logic (`node:test`)

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: `spliceTranscript` replaces exactly `[span.start, span.end)` with the trimmed transcript, returns a written span whose bounds INCLUDE the join padding, and puts `caret` immediately after the transcript (before any trailing pad).
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: seam spacing produces no doubled space (`"a " + "b"` → `"a b"`, not `"a  b"`), no glued words (`"a" + "b"` → `"a b"`), no space wedged before closing punctuation (`"|." → "x."`, not `"x ."`), none after an opening bracket (`"(|" → "(x"`), and treats `\n` as whitespace (no pad added).
- **TEST-3** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: a blank transcript over a NON-empty span REMOVES that span (the interim-shrink case) and collapses the seam back to a single separator, leaving `start === end === caret`.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: `insertTranscript` with a mid-string caret puts the transcript AT THAT CARET and leaves `caret` after the inserted text. Fails if the implementation degrades to append-at-end (the shipped defect): the assertion pins the exact mid-string result, so append-at-end cannot satisfy it.
- **TEST-5** (tier: unit) [covers: ITEM-2] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: a non-empty selection is REPLACED by the transcript (the selected text is gone from the result) and the caret lands after the replacement.
- **TEST-6** (tier: unit) [acceptance] [invariant: INV-5] [covers: ITEM-2, ITEM-14] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: with `selection === null` (composer never focused) `insertTranscript` returns EXACTLY `appendTranscript(value, transcript)` with the caret at end-of-value — the unchanged historical path — **plus a negative control** proving the two paths are genuinely different: for the same value+transcript, a mid-string caret yields a result NOT equal to the append-at-end result. If insert-at-caret silently regressed to append, the control fails.
- **TEST-7** (tier: unit) [covers: ITEM-2] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: a blank/whitespace-only transcript is a true no-op for `insertTranscript` — value unchanged AND a non-empty selection is NOT eaten (a silent decode must never delete the user's selected draft).
- **TEST-8** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: `relocateSpan` returns the span unchanged on an exact hit; re-adopts shifted offsets when the user typed BEFORE the span; returns `null` (detach) when the written text is absent or ambiguous (appears twice); and treats an empty `written` as valid only for an in-bounds zero-length span.
- **TEST-9** (tier: unit) [covers: ITEM-4] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: `restoreSpan` reproduces the pre-dictation string byte-for-byte (including the case where the first write consumed a selection AND added join padding) and re-selects the restored original text.
- **TEST-10** (tier: unit) [covers: ITEM-14] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: `appendTranscript`'s four historical contracts are UNCHANGED (space-joins onto existing text; never replaces the draft; empty composer yields just the transcript; trims and no-ops on blank speech). These are the four tests that previously certified the defect — retained as the specification of the NO-CARET path, not deleted.
- **TEST-11** (tier: unit) [covers: ITEM-13] file: `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts` — asserts: `voiceLogic`'s exported surface is exactly the set its module header documents, so a renamed or removed helper cannot leave a doc comment describing a contract the code no longer has. (The companion half — that the voice STORE no longer carries an `interimText` field, ITEM-12 — asserts against the live store in TEST-12's file instead: this `node:test` runner cannot resolve the store's `@/api-client` import graph.)

## Integration — mounted composer (vitest + jsdom, real `<textarea>`)

All five mount a REAL kit `Textarea`, register the REAL production access
closures (`text/composerAccess.ts`, the exact code `TextInput` registers), and
drive the REAL voice engine — so every assertion reads DOM state
(`textarea.value`, `selectionStart/End`, `document.activeElement`) rather than
store bookkeeping. Only the external boundary is stood in for: the microphone,
the WAV encoder (jsdom has no `AudioContext`), the two transcribe endpoints and
the permission lookup. Mounting `TextInput` itself was rejected — it drags in the
whole chat/draft/auth/send graph for zero extra coverage of the thing under test,
and its registration bodies are shared with the harness anyway (DRIFT-1.3).

- **TEST-12** (tier: integration) [covers: ITEM-5, ITEM-6, ITEM-12] file: `src-app/ui/src/modules/chat/extensions/voice/components/DictationComposer.test.tsx` — asserts: the production access closures read the mounted textarea's real `selectionStart/End`, write the real `value` AND the real selection together, clamp out-of-range offsets, focus the real element, and no-op safely when it is gone; plus that the live voice store carries no `interimText` field (ITEM-12 — the toolbar-caption channel is REMOVED, not merely unrendered).
- **TEST-13** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-8] file: `src-app/ui/src/modules/chat/extensions/voice/components/DictationComposer.test.tsx` — asserts: three successive interim transcripts each REPLACE the previous provisional span **in the textarea's value**, so the mounted composer shows the growing transcript at step 1, 2 and 3 with the surrounding draft text preserved verbatim and no accumulation of superseded interims. Fails if interim text goes anywhere other than the composer.
- **TEST-14** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-4, ITEM-10] file: `src-app/ui/src/modules/chat/extensions/voice/components/DictationComposer.test.tsx` — asserts: after N interim writes, cancelling restores the textarea's `value` byte-for-byte AND its `selectionStart`/`selectionEnd` to the exact pre-recording state (including the selection-replaced case, where the originally selected text comes back and is re-selected).
- **TEST-15** (tier: integration) [covers: ITEM-9] file: `src-app/ui/src/modules/chat/extensions/voice/components/DictationComposer.test.tsx` — asserts: the final authoritative transcript REPLACES the provisional span — the interim wording is absent from the final value (no duplication), and the caret sits after the final text.
- **TEST-16** (tier: integration) [covers: ITEM-3, ITEM-8, ITEM-10] file: `src-app/ui/src/modules/chat/extensions/voice/components/DictationComposer.test.tsx` — asserts: the user's own typing always wins — (a) typing BEFORE the provisional span shifts it and dictation relocates and keeps writing correctly; (b) editing INSIDE the provisional span detaches the session, so no further interim overwrites the user's edit AND a subsequent cancel restores nothing (the user's text survives intact).

## E2E — the real stack (`tests/e2e/14-voice/`)

- **TEST-17** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-7, ITEM-9, ITEM-12] file: `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` — asserts: the LITERAL reported repro — a half-written composer with the caret placed mid-sentence, then dictate and Stop — the transcript lands AT THE CARET (the pinned expected string has it mid-value, which append-at-end cannot produce), the caret is left immediately after the inserted text, and NO transcript text is present anywhere inside the composer toolbar row (the toolbar's text content is asserted free of the transcript, and the removed caption element has count 0).
- **TEST-18** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` — asserts: with a range selected in the composer, dictating REPLACES the selected text with the transcript.
- **TEST-19** (tier: e2e) [acceptance] [invariant: INV-5] [covers: ITEM-2] file: `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` — asserts: a composer that was never focused (no caret) still receives the transcript APPENDED at the end — the pre-existing behaviour, unregressed.
- **TEST-20** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-8] file: `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` — asserts: real-time dictation — the composer's `value` is observed CHANGING through successive interim transcripts **while still recording**, before Stop is ever clicked. Fails if text only appears at Stop (the shipped behaviour).
- **TEST-21** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-10] file: `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` — asserts: cancelling AFTER interim text has visibly landed in the composer restores the composer exactly (value + caret) and issues zero final-transcribe calls.
- **TEST-22** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-9] file: `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` — asserts: a full dictate→stream→stop cycle sends NOTHING — the message list stays empty and the URL never navigates to a conversation — proving dictation has no send path even now that it writes continuously into the composer.
- **TEST-23** (tier: e2e) [covers: ITEM-11] file: `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` — asserts: after dictation ends the composer textarea is `document.activeElement` with the caret after the inserted text, located WITHOUT any `data-testid` (by accessible name), which is the selector class that survives the production `data-test*` strip that made the old `focusComposer` a shipped no-op.
- **TEST-25** (tier: e2e) [covers: ITEM-5, ITEM-6] file: `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` — asserts: dictated text SURVIVES leaving the composer and coming back. This is the regression test for a fix that was inert when first written: an imperative `el.value =` fires no React `onChange`, and React's own value tracker swallows even a dispatched `input` event unless the write goes through the prototype setter — so the draft was never persisted and the draft-restore effect overwrote the whole transcript on the way back. No unit or jsdom test caught it (jsdom has no React tracker on that path); only driving the real app did.

- **TEST-24** (tier: e2e) [covers: ITEM-12, ITEM-15] file: `src-app/ui/tests/e2e/14-voice/live-captions-stream.spec.ts` — asserts: rewritten from the spec that certified the defect — with live captions ON the interim transcripts land in the COMPOSER, the toolbar caption element is absent in every recording state, and the final authoritative transcript — not the last interim — is what remains. The sibling assertions in `mic-button-gating.spec.ts` and `visual-states.spec.ts` are updated in the same change.

## Static gates

- **TEST-26** (tier: unit) [covers: ITEM-16] file: `src-app/ui/package.json` (`npm run check`) — asserts: the regenerated derived artifacts match their generators — `check:store-actions` (the new TextStore actions appear in `actions.gen.ts`), `check:state-matrix` (the removed `liveCaptions && interimText` branch), `check:testid-registry` (the removed `voice-live-caption` literal), `check:gallery-coverage` — plus `tsc` and every lint guardrail. A missed regen fails here rather than silently.

---

## Coverage map

**Every ITEM is covered:**

| ITEM | covering TESTs |
|---|---|
| ITEM-1 | TEST-1, TEST-2, TEST-3 |
| ITEM-2 | TEST-4, TEST-5, TEST-6, TEST-7, TEST-19 |
| ITEM-3 | TEST-8, TEST-16 |
| ITEM-4 | TEST-9, TEST-14 |
| ITEM-5 | TEST-12, TEST-25 |
| ITEM-6 | TEST-12, TEST-25 |
| ITEM-7 | TEST-17, TEST-23 |
| ITEM-8 | TEST-13, TEST-16, TEST-20 |
| ITEM-9 | TEST-15, TEST-17, TEST-18, TEST-22 |
| ITEM-10 | TEST-14, TEST-16, TEST-21 |
| ITEM-11 | TEST-23 |
| ITEM-12 | TEST-12, TEST-17, TEST-24 |
| ITEM-13 | TEST-11 |
| ITEM-14 | TEST-6, TEST-10 |
| ITEM-15 | TEST-24 |
| ITEM-16 | TEST-26 |

**Every INV is pinned by an `[acceptance]` test:**

| INV | acceptance TESTs |
|---|---|
| INV-1 (caret, not the toolbar) | TEST-4 (unit), TEST-17 (e2e) |
| INV-2 (real-time into the input) | TEST-13 (integration), TEST-20 (e2e) |
| INV-3 (never sends) | TEST-22 (e2e) |
| INV-4 (supersede/cancel restores exactly) | TEST-14 (integration), TEST-21 (e2e) |
| INV-5 (no caret → append) | TEST-6 (unit), TEST-19 (e2e) |

**Permissions:** this feature introduces NO permission — it adds no
`modules/*/permissions.rs` entry and no grant migration, and touches no backend
path at all. A10's `[negative-perm]` restricted-user e2e therefore does not
apply. The pre-existing `voice::transcribe` gate is untouched and is already
covered by `tests/e2e/14-voice/mic-button-gating.spec.ts`.

**Descoped:** none. Every planned ITEM is implemented and covered.
