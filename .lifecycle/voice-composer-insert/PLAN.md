# voice-composer-insert — PLAN

Voice dictation must land where the user is typing, and stream while they speak.
Two reported defects, both reproduced on the live rig against a real whisper
runtime before any code was written: dictated text is rendered in the composer
**toolbar** instead of the chat input, and the final transcript is appended at
the END of the value rather than at the caret.

## Design source

- Realizes `src-app/ui/docs/VOICE_DICTATION_COMPOSER.md` **§3 (intended
  behaviour)**, **§4 (invariants)** and **§5 (mechanism)**. That document is the
  design of record for this feature and was written from the measured
  reproduction in its **§2** — no prior design existed, only an implementation.
- Realizes the two verbatim owner defect reports quoted in that doc's **§1**:
  (1) "The voice transcribed, it should be appending in chat input after the last
  where cursor is put, not on the tools"; (2) "Also make sure that it has real
  time transcribe".
- Realizes the reproduction evidence in **§2**: `/data/pbya/ziee/tmp/voice-repro/`
  (`repro.mjs`, `REPRO.log`, `01-before.png`, `02b-toolbar-zoom.png`,
  `03-after.png`) — driven against the real rig at `http://127.0.0.1:1520` with
  the real `/api/voice/transcribe` + `/api/voice/transcribe/stream` endpoints.
- Realizes the existing in-tree dictation contract stated at
  `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.ts:6-13` (the
  "insert, don't send" rule and the supersession-token rule), as amended by the
  owner in DEC-1.
- Realizes `src-app/ui/docs/VOICE_DICTATION_COMPOSER.md` **§2.1** — the
  production-build testid strip that makes `focusComposer` a no-op in every
  shipped build (`ui/plugins/vite-plugin-remove-data-test.js`).
- Realizes `agent-kit/docs/DESIGN_SYSTEM.md` (semantic tokens only, logical
  direction properties, kit components) and `agent-kit/docs/CODING_GUIDELINES.md`
  §12 (frontend store/proxy discipline), §13 (UI/UX & accessibility), §15 (dead
  code = unfinished work).

## Invariants

- **INV-1**: "it should be appending in chat input after the last where cursor is
  put, not on the tools" (`VOICE_DICTATION_COMPOSER.md` §4, verbatim from the
  owner) — dictated text is inserted at the composer's caret (a selection is
  replaced), the caret is left after the inserted text, and NO transcript text is
  rendered in the composer toolbar.
- **INV-2**: "Also make sure that it has real time transcribe"
  (`VOICE_DICTATION_COMPOSER.md` §4, verbatim from the owner) — while the user is
  speaking, the transcript appears progressively IN THE CHAT INPUT, not only when
  recording stops.
- **INV-3**: "a transcript is … never replacing it and — by construction — never
  triggering a send" (`voiceLogic.ts:8-9`, verbatim) — dictation only ever edits
  the composer's text; it has no send path.
- **INV-4**: "Every await below re-checks this token and bails if superseded."
  (`voiceStore/actions/_engine.ts:422`, verbatim) — a cancelled / superseded /
  unmounted recording must leave the composer exactly as it was, and no late
  result may write into it.
- **INV-5**: when the composer has no caret at all (never focused), dictation
  appends at the end — `appendTranscript`'s existing contract, unchanged.

## Items

- **ITEM-1**: `voiceLogic.ts` — pure `spliceTranscript(value, span, transcript)
  → ComposerEdit`. Replaces `[span.start, span.end)` with the trimmed transcript,
  seam-aware space padding (leading space only when the preceding char is a
  non-whitespace, non-opening-bracket char; trailing space only when the following
  char is a non-whitespace, non-closing-punctuation char), never producing a
  doubled space or a glued word. Returns the written span `[start, end)`
  **including padding** plus `caret` = end-of-transcript (before any trailing pad).
  A blank transcript REMOVES the span (this is the interim-shrink case).
- **ITEM-2**: `voiceLogic.ts` — pure `insertTranscript(value, selection | null,
  transcript) → ComposerEdit`: a non-null selection splices (replacing the
  selection); a `null` selection appends at the end via `appendTranscript`
  (INV-5); a blank transcript is a true no-op that does NOT eat the user's
  selection. `appendTranscript` keeps its signature and all four documented
  behaviours, and is itself re-expressed as a splice at the end position so the
  join is seam-aware (see DRIFT-1.1: the historical form doubled the space when
  the draft already ended in whitespace, which the feature forbids).
- **ITEM-3**: `voiceLogic.ts` — pure `relocateSpan(value, span, written) → span |
  null`: exact hit at the recorded offsets → unchanged; else a unique
  `indexOf(written)` → re-adopted offsets; else `null` (detached). An empty
  `written` is valid only as a zero-length in-bounds span.
- **ITEM-4**: `voiceLogic.ts` — pure `restoreSpan(value, span, original) →
  ComposerEdit`: byte-exact restore of the anchor's original text over the owned
  span, re-selecting it (`start`..`start+original.length`).
- **ITEM-5**: `TextStore` — composer selection/edit/focus access, whose closure
  BODIES live in one exported factory (`text/composerAccess.ts`) so the component
  harness drives the same production code (DRIFT-1.3), mirroring the
  existing `getMessage`/`setMessage`/`clearMessage` registration trio: state
  fields + `setGetSelection`/`setApplyEdit`/`setFocusInput` registrars +
  `getSelection()`/`applyEdit(value, start, end?)`/`focusInput()` actions. All
  DOM access is via the composer's own `ref` closure — **no `querySelector`, no
  testid** (§2.1).
- **ITEM-6**: `TextInput.tsx` — register the three new closures over
  `ref.current` in the existing mount effect, alongside the current three.
- **ITEM-7**: `_engine.ts` — the per-recording **dictation session**: at record
  start capture the owning pane's anchor selection + the text it covers, stamp
  the current generation token, and focus the composer with that selection
  restored so the user SEES where dictation will land.
- **ITEM-8**: `_engine.ts` — each interim decode writes progressively INTO the
  composer (relocate → splice over the owned span → adopt the new span) instead
  of setting `interimText`. Guarded by the same generation token + `recording`
  status the existing interim loop already checks (INV-4).
- **ITEM-9**: `_engine.ts` — on Stop the authoritative transcript replaces the
  owned span; when the session is detached or no interim ran, it is inserted at
  the composer's CURRENT selection (falling back to the captured anchor, then to
  append-at-end). The caret is left after the inserted text.
- **ITEM-10**: `_engine.ts` — cancel / supersede / unmount **and a transcription
  failure** (`fail()`, DRIFT-1.6) restore the composer byte-exactly
  (`restoreSpan` + the original selection). A **detached** session restores
  nothing — that text belongs to the user now.
- **ITEM-11**: `_engine.ts` — replace `focusComposer`'s
  `document.querySelector('[data-testid="chat-message-textarea"]')` (and its
  `chat-pane-<idx>` scope hack) with the owning pane's TextStore-registered focus
  closure, fixing the production-build no-op documented in §2.1.
- **ITEM-12**: `MicButton.tsx` — remove the toolbar live-caption `<span>` (the
  literal "on the tools" surface) and remove the now-unused `interimText` store
  field (§15: no set-but-never-read state). The recording dot / elapsed timer /
  Stop / Cancel controls stay — those are genuinely toolbar controls.
- **ITEM-13**: rename `composeInterimCaption` → `normalizeInterimTranscript`
  (there is no caption any more — DRIFT-1.2) and update the doc comments that
  state the superseded contract —
  `voiceLogic.ts`'s header, `voice/extension.tsx`'s "APPENDED to the composer",
  and `MicButton.tsx`'s "Never written to the composer" — to state the new one
  and point at `docs/VOICE_DICTATION_COMPOSER.md`.
- **ITEM-14**: rewrite the four `voiceLogic.test.ts` tests that currently ASSERT
  the append-at-end defect so they encode the correct contract (append is the
  NO-CARET path, INV-5), keeping an explicit negative control that fails if
  insert-at-caret silently degrades back to append-at-end.
- **ITEM-15**: update the e2e specs that assert the toolbar-caption behaviour —
  `live-captions-stream.spec.ts` (asserts the caption strip shows the interim),
  `visual-states.spec.ts:128`, `mic-button-gating.spec.ts:120` — to assert the
  composer-streaming contract instead.
- **ITEM-16**: regenerate the derived artifacts the above invalidates —
  `textStore/actions.gen.ts` (`npm run gen:store-actions`), the gallery state
  matrix (`gen:state-matrix`), and the testid registry (`gen:testid-registry`).

## Files to touch

- `src-app/ui/docs/VOICE_DICTATION_COMPOSER.md` (added — the design of record)
- `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.ts`
- `src-app/ui/src/modules/chat/extensions/voice/voiceLogic.test.ts`
- `src-app/ui/src/modules/chat/extensions/voice/voiceStore/state.ts`
- `src-app/ui/src/modules/chat/extensions/voice/voiceStore/actions/_engine.ts`
- `src-app/ui/src/modules/chat/extensions/voice/components/MicButton.tsx`
- `src-app/ui/src/modules/chat/extensions/voice/extension.tsx`
- `src-app/ui/src/modules/chat/extensions/text/textStore/state.ts`
- `src-app/ui/src/modules/chat/extensions/text/composerAccess.ts` (added — DRIFT-1.3)
- `src-app/ui/src/modules/chat/extensions/text/textStore/actions/getSelection.ts` (added)
- `src-app/ui/src/modules/chat/extensions/text/textStore/actions/setGetSelection.ts` (added)
- `src-app/ui/src/modules/chat/extensions/text/textStore/actions/applyEdit.ts` (added)
- `src-app/ui/src/modules/chat/extensions/text/textStore/actions/setApplyEdit.ts` (added)
- `src-app/ui/src/modules/chat/extensions/text/textStore/actions/focusInput.ts` (added)
- `src-app/ui/src/modules/chat/extensions/text/textStore/actions/setFocusInput.ts` (added)
- `src-app/ui/src/modules/chat/extensions/text/textStore/actions.gen.ts` (regenerated)
- `src-app/ui/src/modules/chat/extensions/text/components/TextInput.tsx`
- `src-app/ui/src/modules/chat/extensions/voice/components/DictationComposer.test.tsx` (added — mounted-component harness)
- `src-app/ui/tests/e2e/14-voice/dictation-caret-insert.spec.ts` (added)
- `src-app/ui/tests/e2e/14-voice/live-captions-stream.spec.ts`
- `src-app/ui/tests/e2e/14-voice/visual-states.spec.ts`
- `src-app/ui/tests/e2e/14-voice/mic-button-gating.spec.ts`
- `src-app/ui/src/dev/gallery/{STATE_MATRIX.md,stateMatrix.generated.ts,galleryCoverage.generated.ts,overlay-registry.generated.json}` (regenerated)
- `sdk/packages/kit/src/testIds.generated.ts` (regenerated)
- `src-app/ui/src/dev/gallery/stateCoverage.ts` (DRIFT-1.7 — reconciles main's
  pre-existing state-matrix staleness that this branch's mandatory regen surfaces)

## Patterns to follow

- **Pure decision helpers** — mirror `voiceLogic.ts` itself: named exports, one
  documented contract per function, zero DOM/browser dependency, unit-tested from
  `voiceLogic.test.ts` under `node:test`. The new splice/relocate/restore helpers
  join the existing `appendTranscript`/`isSuperseded`/`shouldRunInterim` family.
- **TextStore access registration** — mirror the EXISTING trio in
  `extensions/text/textStore/`: a nullable closure field in `state.ts`, a
  `setXxx` registrar action, and a consumer action that warns-and-returns when
  unregistered (`actions/getText.ts`, `actions/setText.ts`,
  `actions/setGetMessage.ts` are the templates). One file per action, folder-glob
  eager store, `actions.gen.ts` regenerated by `npm run gen:store-actions`.
- **Engine orchestration** — mirror the existing `_engine.ts` conventions
  exactly: module-scope imperative session state (justified by the exclusive
  recording lock, as `mediaRecorder`/`chunks` already are), every async
  continuation re-checking `isSuperseded(gen, requestGeneration)`, and the owning
  pane resolved through `ownerTextStore(recordingPaneId)` (never the focused-pane
  bridge).
- **Mounted-component test** — mirror
  `src-app/ui/src/modules/js-tool/.../JsToolApprovalContent.test.tsx` (vitest +
  jsdom, `npm run test:component`), the harness that exists precisely because
  source-scanning stand-ins do not prove render behaviour.
- **Voice e2e** — mirror `tests/e2e/14-voice/dictation-inserts-not-sends.spec.ts`
  and its shared `voice-helpers.ts` (`installVoiceBrowserMocks` +
  `routeVoice` + `defaultVoiceState` + `gotoComposer`). Extend the shared helper
  only in a backward-compatible way (B3: never reshape a shared harness around
  one feature's needs).

## Item audit verdicts (phase 2 — verified against the codebase)

- **ITEM-1** — verdict: PASS — new pure export in `voiceLogic.ts`; no existing
  caller of that file is affected (`appendTranscript` keeps its exact signature
  and semantics, verified: its only production caller is `_engine.ts:488`).
- **ITEM-2** — verdict: PASS — delegates to `appendTranscript` for the null-
  selection case, so INV-5's behaviour is literally the same code path.
- **ITEM-3** — verdict: PASS — pure, no callers to break.
- **ITEM-4** — verdict: PASS — pure, no callers to break.
- **ITEM-5** — verdict: CONCERN — adds fields to `textStoreState`, which is an
  `immer: true` store. The existing trio already stores raw FUNCTIONS in immer
  state (`state.getMessage = getter`) and works, so the pattern is proven; the
  new fields must be registered identically (assigned in a `set(state => …)`,
  never frozen-then-called-with-mutation). Verified `defineExtensionStore` usage
  at `textStore/index.ts:16` uses the EAGER glob — the new actions must load
  eagerly too (they are read synchronously by the voice engine), which the
  existing `{ eager: true }` already guarantees for the whole folder.
- **ITEM-6** — verdict: CONCERN — `TextInput`'s registration effect has the
  dependency array `[setGetMessage, setSetMessage, setClearMessage]`. Adding
  three more registrars requires adding them to that array or the effect will
  not re-run if a registrar identity changes; store-kit action identities are
  stable per instance, so this is correctness hygiene rather than a live bug.
- **ITEM-7** — verdict: PASS — record start already has the owning `paneId` and
  already `set(...)`s at that point; capturing the anchor there adds no new
  ordering hazard. Verified a blurred `<textarea>` retains `selectionStart`/`End`,
  so the caret is still readable after the mic button takes focus.
- **ITEM-8** — verdict: CONCERN — the interim tick currently only touches store
  state; writing to the DOM makes it a real side effect on a shared surface. It
  MUST stay inside the existing triple guard (`!isSuperseded(gen, …) && status
  === 'recording' && !finalizing`) — verified present at `_engine.ts:260-267`.
  Re-verified that `set({interimText})` is the ONLY thing that guard protects
  today, so replacing it in place preserves the guard exactly.
- **ITEM-9** — verdict: PASS — replaces the single `textStore.setText(
  appendTranscript(...))` call at `_engine.ts:488`, already inside the
  `isSuperseded` guard at line 481.
- **ITEM-10** — verdict: CONCERN — `cancelRecording` has an `'error'`-state
  early-return branch (`_engine.ts:523-537`) that must NOT touch shared recorder
  state because another pane may own it by then. The restore must therefore run
  only on the `'requesting'`/`'recording'`/`'transcribing'` path, never in the
  `'error'` branch — where, by construction, `fail()` has already cleared the
  session.
- **ITEM-11** — verdict: PASS — strictly fixes a no-op; verified the strip via
  `ui/plugins/vite-plugin-remove-data-test.js` + `vite.config.ts:87`
  (`...(isDev || isTest ? [] : [removeDataTestPlugin()])`), and verified on the
  live rig that the shipped textarea carries no `data-testid` attribute.
- **ITEM-12** — verdict: CONCERN — removing the `voice-live-caption` element
  invalidates three existing e2e assertions (`live-captions-stream.spec.ts:52,61`,
  `visual-states.spec.ts:128`, `mic-button-gating.spec.ts:120`) and two generated
  state-matrix rows (`stateMatrix.generated.ts:846-847`). Both are handled —
  ITEM-15 and ITEM-16 respectively. `check:testid-registry` must also be
  regenerated since a testid literal disappears.
- **ITEM-13** — verdict: PASS — comments only.
- **ITEM-14** — verdict: PASS — the four tests at `voiceLogic.test.ts:17-34`
  currently certify the defect; A5 (TESTS.md may not shrink) is respected because
  they are REWRITTEN, not deleted, and their TEST-IDs are carried forward.
- **ITEM-15** — verdict: CONCERN — `visual-states.spec.ts` drives the visual
  baseline; changing what renders during recording will change that screenshot,
  so its Layer-B baseline must be re-blessed deliberately, not silently.
- **ITEM-16** — verdict: PASS — all four generators are `--check`ed by
  `npm run check`, so a missed regen fails phase 8 loudly rather than silently.

## Breakage risk

- **`appendTranscript` callers** — one production caller (`_engine.ts:488`) and
  four unit tests. Its signature and semantics are UNCHANGED; it becomes the
  no-caret branch of `insertTranscript`. No external consumer.
- **`interimText` consumers** — `MicButton.tsx:51,191` (removed by ITEM-12) and
  five `set({interimText: ''})` sites in `_engine.ts` (removed with the field).
  No other module reads it; `grep` over `src`, `tests`, and `../desktop/ui/src`
  confirms.
- **Desktop UI** — `src-app/desktop/ui` has NO voice/text override files; it
  resolves them from `../../ui/src` via its vite alias + tsconfig paths
  (`desktop/ui/vite.config.ts:37,74`, `tsconfig.json:41-43,62`). So the change
  reaches desktop automatically and desktop's `tsc` typechecks it. R2-3
  (hand-written desktop override drift) does not apply — there is nothing to
  diff.
- **The composer's autosize** — the kit `Textarea` grows via the CSS
  `field-sizing-content` class (confirmed in the live rig's shipped DOM), not a
  JS measure-on-change, so imperative `.value` writes still reflow. Verified in
  e2e rather than assumed.
- **Shared e2e harness** — `voice-helpers.ts` is shared by 13 specs; it is
  extended additively only (B3).

## Pattern conformance

- Every new pure helper lives in `voiceLogic.ts` beside its siblings, with the
  same doc-comment-states-the-contract style.
- Every new TextStore action is one file in `actions/` with a `default`
  `(set, get) => (...) => …` factory, exactly like the six existing ones, and is
  reflected in the generated `actions.gen.ts`.
- No new component, no new store, no new module; no `antd`, no raw `<button>`,
  no hardcoded color, no physical-direction property. ITEM-12 REMOVES a
  physical-direction (`dir="rtl"`) clipping hack rather than adding one.

## Migration collisions

None — this branch is frontend-only. It adds **no** `.sql` file, touches no
`src-app/server/**` or `src-app/desktop/tauri/**` path, and therefore cannot
collide with main's migration sequence. (`BASE.md` records the current maxima for
the merge-gate's C2 check regardless.)

## OpenAPI regen

Not required. No Rust type, handler, or response shape changes, so neither
`openapi.json` nor `api-client/types.ts` moves in either workspace. The existing
`ApiClient.Voice.transcribe` / `ApiClient.Voice.transcribeStream` signatures are
consumed unchanged.
