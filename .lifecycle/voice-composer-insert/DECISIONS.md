# voice-composer-insert — DECISIONS

Every human/product input the implementation needs, resolved up front. Zero
open questions remain.

---

### DEC-1: `voiceLogic.ts` documents the contract as "APPENDED to the existing composer text". Does insert-at-caret DROP that invariant?
**Resolution:** The append-at-END clause is AMENDED to insert-at-caret, with
append-at-end retained as the no-caret case (INV-5). The other two clauses of
that same sentence — "never replacing it" (the user's draft) and "by
construction never triggering a send" — are UNCHANGED and remain binding as
INV-3. Both `docs/VOICE_DICTATION_COMPOSER.md` §4 and PLAN's `## Invariants`
record the amendment explicitly rather than deleting the inconvenient clause.
**Basis:** user — the product owner's verbatim defect report ("it should be
appending in chat input after the last where cursor is put") is a direct
instruction overriding the previous behaviour. This is the skill's prescribed
route for an invariant that is genuinely wrong: renegotiate with the owner and
amend BOTH the design doc and the plan, never silently drop it.

### DEC-2: Where does the live transcript render while recording?
**Resolution:** In the composer textarea itself, replacing the provisional span
in place on each interim decode. The toolbar caption `<span>` is REMOVED
entirely (not merely hidden), along with the `interimText` store field that fed
it.
**Basis:** user — "not on the tools" is literal: the reproduction
(`02b-toolbar-zoom.png`) shows the transcript rendering inline in the composer
TOOLBAR row. Leaving it there in any form fails the report. Keeping it in
BOTH places would duplicate the same words on screen; removing the field as
well is required by CODING_GUIDELINES §15 (set-but-never-read state is dead
code).

### DEC-3: Should provisional (interim) text be visually distinguished from final text — underline, ghost styling, a separate overlay?
**Resolution:** No. Provisional text is plain composer text, revised in place.
The already-present recording affordances (pulsing dot + elapsed timer + Stop /
Cancel) are what signal "this is still being dictated".
**Basis:** convention — this is exactly how the platform dictation users already
know behaves (macOS/Windows/mobile keyboards: words appear in the field and are
revised in place). A `<textarea>` also cannot style a sub-range, so any
distinction would require an overlay mirror of the composer — a large, fragile
surface (font metrics, scroll sync, IME) far out of proportion to this fix, and
one that would itself risk the "designed in isolation, fights its parent"
finding class. Rejected as gold-plating.

### DEC-4: Does the "Live captions" toggle keep its name, icon and `aria-label` now that captions live in the composer?
**Resolution:** the USER-FACING LABEL changes, the identity does not — REVISED
after the phase-6 audit. Tooltip + `aria-label` become "Turn on/off live dictation
— show words in the message as you speak"; `data-testid="voice-live-toggle"`, the
`Captions`/`CaptionsOff` icons, the `liveCaptions` state field and the
`ziee.voice.liveCaptions` storage key all stay. The audit was right that a
control named for a surface this change DELETED is undiscoverable — it is the
only gate on real-time dictation and its label described nothing that exists. But
renaming the stored key would silently reset every user's preference, and
renaming the testid churns the registry, for no user-visible gain.

**Superseded reasoning:** keep the name unchanged. What it controls is unchanged
too: whether the interim decode loop runs at all.
**Basis:** convention — the toggle's meaning ("show me words as I speak, rather
than only at the end") is still exactly right; only the render target moved.
Renaming it would churn three e2e specs, the testid registry and the
`ziee.voice.liveCaptions` localStorage key for zero user benefit, and this
change already has a large enough blast radius in the voice specs.

### DEC-5: When the user edits the text dictation is currently writing, who wins?
**Resolution:** The user, always. The session tracks the exact string it wrote
into its owned span; before each write it re-verifies and, if the user typed
elsewhere and shifted it, relocates. If the written text can no longer be found
the session DETACHES: it stops writing interims, and the final transcript is
inserted at the user's CURRENT caret instead. A detached session restores
nothing on cancel.
**Basis:** convention — CODING_GUIDELINES §6 ("never silently swallow", never
destroy user data). Detaching can in a rare hand-edited case leave both the
edited provisional text and the final transcript in the composer; that is
non-destructive and visible, whereas the alternative (clobbering the span) would
silently delete something the user typed. Non-destructive wins.

### DEC-6: Should recording start move focus into the composer?
**Resolution:** Yes. Record start restores the captured anchor selection and
focuses the composer, so the caret is visibly blinking where dictation will
land and the browser auto-scrolls the textarea as text streams in.
**Basis:** convention — the engine ALREADY focuses the composer at the end of
every terminal path (`focusComposer` on transcribe-success and on cancel); doing
it at the start is the same affordance moved earlier, and INV-1 ("lands where
the cursor is") is only observable if the cursor is visible. Note this is also
why ITEM-11 is required: `focusComposer` is a no-op in production today.

### DEC-7: `focusComposer` locates the textarea by `data-testid`, which production builds strip. Fix it here, or file it separately?
**Resolution:** Fix it here (ITEM-11), by routing focus through the composer's
own TextStore-registered `ref` closure — the same mechanism `getText`/`setText`
already use, which works in every build.
**Basis:** codebase — it is not adjacent scope, it is load-bearing for THIS
feature: DEC-6 and INV-1 both depend on focus actually returning to the
composer, and every other DOM access this feature adds must avoid the same trap.
Verified the strip at `ui/plugins/vite-plugin-remove-data-test.js` +
`vite.config.ts:87`, and confirmed on the live rig that the shipped textarea
carries no `data-testid`.

### DEC-8: Is the "how the words join" rule (spacing) a fixed constant or admin-configurable?
**Resolution:** Fixed, as a pair of named character-class constants in
`voiceLogic.ts` (`NO_LEADING_PAD_BEFORE` = opening brackets/quotes,
`NO_TRAILING_PAD_BEFORE` = closing punctuation), not inline literals.
**Basis:** convention — this is typographic correctness, not an operational
tunable: there is no deployment for which "put a space before the period" is the
right answer, and no operator would ever want to change it. The
configurable-settings rule targets resource limits / retention / quotas /
toggles; per that rule's own escape clause it is still structured as named
constants rather than magic literals, so it can be promoted later without a
rewrite. The genuinely operational voice tunables that DO exist
(`streaming_enabled`, `stream_interval_ms`, `max_clip_seconds`) are ALREADY
admin-configurable rows in `voice_settings` and are untouched by this change.

### DEC-9: Should dictated text be written into the per-conversation draft store?
**Resolution:** **Yes** — REVISED after the phase-6 audit, which both angles
escalated. `applyComposerEdit` writes through the textarea's PROTOTYPE value
setter and dispatches a native `input` event, so dictated text persists exactly
as typed text does. (A plain `el.value =` is not enough: it goes through React's
own instance-level tracking setter, so the dispatched event is discarded as a
no-op change. Verified on the running app — direct assign wrote no draft, the
prototype setter wrote it. Covered by TEST-25.) The original resolution below was wrong on
its own terms: it reasoned from "pre-existing, therefore not a regression", but
this change makes dictation the composer's PRIMARY content producer, which turns
"dictate a paragraph → switch conversation → come back → the draft-restore effect
overwrites the transcript" from a corner case into a routine data-loss path. A
defect does not need to be new to be worth fixing when your own change is what
makes it reachable.

**Superseded reasoning:** out of scope, and explicitly NOT a regression. Composer
drafts are persisted from `TextInput`'s `onChange` handler, which imperative
`.value` writes do not fire; the pre-existing `TextStore.setText` (used by
dictation today, and by edit/regenerate prefill) already behaves this way.
**Basis:** codebase — changing it would alter draft semantics for the
edit/regenerate prefill path too, which `TextInput.tsx:44-46` deliberately
suppresses (DEC-7 of the chat-drafts work). Behaviour after this change is
identical to before it. Recorded here so the omission is a decision, not an
oversight.

### DEC-10: Where does the per-recording dictation session state live — module scope, or per-engine-instance?
**Resolution:** Module scope, beside the existing `mediaRecorder` / `mediaStream`
/ `chunks` / `finalizing` / `requestGeneration` imperative resources.
**Basis:** codebase — the exclusive recording lock (`voiceRecordingLock.ts`,
acquired in `startRecording`, released in `fail`/`stopRecording`/
`cancelRecording`) guarantees at most ONE pane is in the recording flow at a
time, which is the documented justification for those existing module-scope
resources. The dictation session has exactly the same lifetime as the recorder,
so it belongs in exactly the same place. (The counter-example in that file —
`errorRevertTimer` — is per-instance precisely because TWO panes can sit in the
post-fail `'error'` window at once; the dictation session cannot, because `fail`
clears it.)

### DEC-11: Which layer owns the caret policy — TextStore or the voice engine?
**Resolution:** Three layers, strictly separated: `voiceLogic.ts` = pure policy
(splice/relocate/restore, no DOM); `TextStore` = dumb DOM access over the
composer `ref` (read selection / apply value+selection / focus); `_engine.ts` =
orchestration of the session across the recording lifecycle.
**Basis:** codebase — this mirrors the file's existing split exactly
(`voiceLogic.ts`'s header states it holds the pure decision helpers "extracted
from `Voice.store.ts` so they can be unit-tested without the store's browser +
`defineExtensionStore` graph"). It also keeps TextStore generic: nothing about
voice leaks into the text extension, so the new selection/edit access is
reusable by any future composer feature.

### DEC-12: The visual-regression baseline changes (recording state now shows text in the composer and nothing in the toolbar). Re-bless silently?
**Resolution:** No. The Layer-B baseline for the affected `14-voice` visual
state is re-blessed as an explicit, separately-reviewed step, and the change is
recorded in the drift log — never folded silently into an unrelated commit.
**Basis:** convention — a screenshot baseline is an assertion; overwriting one
without stating what changed is how a real visual regression gets blessed in.

### DEC-13: A transcription FAILURE after words have streamed into the composer — restore the draft, or keep the words?
**Resolution:** KEEP the words, and surface the error beside them. Only
cancel / supersede / unmount restore.
**Basis:** convention (CODING_GUIDELINES §6, never destroy user data) — INV-4
enumerates cancelled / superseded / unmounted, every one of which is the USER
asking for the recording to go away. A backend error is not. By the time
`/transcribe` fails the audio is gone, so the streamed words are the only
surviving record of what the user said; deleting them to tidy up after our own
failure destroys the user's only copy. This REVERSES DRIFT-1.6, which had
extended the restore to `fail()` — the phase-6 design-conformance angle
correctly objected that no rule in the design authorised that user-data
decision. Covered by TEST-17.

---

**Descoped items:** none. Every ITEM in PLAN.md is implemented and covered by an
enumerated TEST.
