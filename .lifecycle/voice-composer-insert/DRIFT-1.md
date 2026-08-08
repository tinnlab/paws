# voice-composer-insert — DRIFT round 1

Implementation reconciled against PLAN.md's ITEMs **and** against
`ui/docs/VOICE_DICTATION_COMPOSER.md`'s `INV-1..INV-5`, item by item as each
landed.

---

- **DRIFT-1.1** — verdict: impl-wins — **`appendTranscript` is now expressed via
  `spliceTranscript` at the end position, not left byte-identical.** The plan
  (ITEM-2) said `insertTranscript` would "delegate to the UNCHANGED
  `appendTranscript`". Implementing it that way kept a real wart: the historical
  `` `${current} ${text}` `` unconditionally adds a space, so a draft already
  ending in whitespace produced a DOUBLED space — which the feature brief
  explicitly forbids ("don't create double spaces"). Re-expressing it as a
  seam-aware splice at the end position satisfies all FOUR of its documented
  contracts unchanged (verified: TEST-10's four legacy assertions pass
  untouched), so INV-5 ("appendTranscript's existing contract, unchanged") is
  upheld — the CONTRACT is what is preserved, and the doubled-space case was
  never part of it. PLAN ITEM-2 amended to say so; a fifth assertion pinning
  `appendTranscript('a ', 'b') === 'a b'` was added to TEST-10.

- **DRIFT-1.2** — verdict: impl-wins — **`composeInterimCaption` renamed to
  `normalizeInterimTranscript`.** Not in the plan. Once the toolbar caption is
  gone (ITEM-12) there is no caption, and a helper named for one is exactly the
  stale-contract problem ITEM-13 exists to remove. One production caller, one
  test. Folded into ITEM-13; TEST-11's export-surface assertion now pins the
  rename so a future divergence between the module header and its exports is a
  compile-visible failure rather than a comment nobody reads.

- **DRIFT-1.3** — verdict: impl-wins — **added
  `text/composerAccess.ts`, not in "Files to touch".** ITEM-5/ITEM-6 put the
  access closures inline in `TextInput`'s mount effect. That would have made
  TEST-12 impossible to write honestly: a harness would have had to
  RE-IMPLEMENT the closures, proving nothing about what ships (and mounting the
  real `TextInput` drags in the whole chat/draft/auth/send graph for zero extra
  coverage of "where do dictated words land in a textarea"). Extracting the
  bodies into one exported factory lets `TextInput` and the harness share the
  SAME production code. PLAN "Files to touch" amended.

- **DRIFT-1.4** — verdict: resolved — **TextStore state field renamed
  `focusInput` → `focusMessage`.** Caught during implementation: the store proxy
  merges state fields and action names, and the action file is `focusInput.ts`,
  so the two would have collided. Renaming the STATE field also restores the
  existing convention this file already follows — every state closure is
  `*Message` (`getMessage`/`setMessage`/`clearMessage`) and every action is the
  short verb (`getText`/`setText`/`clearText`). No plan change; ITEM-5's
  "mirroring the existing registration trio" already required it.

- **DRIFT-1.5** — verdict: resolved — **`relocateSpan` prefers an EXACT hit at
  the recorded offsets over ambiguity elsewhere.** TEST-8 was written asserting
  that text appearing twice always detaches. Running it showed the
  implementation returns the recorded span when that span still holds exactly
  the written string — which is CORRECT: those offsets are the strongest
  evidence the span is ours, and detaching there would abandon a perfectly valid
  session any time the user happens to have the same word twice. Ambiguity only
  matters once a search is needed. The TEST was wrong, not the code; it now
  asserts both halves (exact hit wins; ambiguous SEARCH detaches).

- **DRIFT-1.6** — verdict: resolved — **`fail()` now restores the composer too.**
  ITEM-10 named cancel/supersede/unmount. Walking the entity lifecycle showed a
  fourth terminal path: a transcription failure after interim text had already
  streamed in would have left half a transcript in the composer beside an error
  toast. INV-4's promise ("a cancelled/superseded recording leaves the composer
  exactly as it was") plainly covers it. `fail()` restores + clears the session,
  and the `'error'`-state branch of `cancelRecording` deliberately does NOT touch
  the session — `fail()` already cleared it, and any session alive during the
  ~2.5 s error window belongs to whichever pane took the lock. Extends ITEM-10.

- **DRIFT-1.7** — verdict: impl-wins — **`stateCoverage.ts` edited, and 6
  unrelated states annotated.** Not in "Files to touch". Two independent causes,
  both forced: (a) `check:state-matrix` was **already failing on a pristine
  `origin/main` checkout** — verified by running the generator's `--check` in an
  untouched main worktree, exit 1 — because `67fdf1466` changed
  `OnboardingRedirect` without regenerating, leaving a stale mapping; (b) six
  further conditional renders (citations / llm-local-runtime / mcp / workflow)
  reached main un-annotated. ITEM-12 changes `MicButton`'s conditionals, so the
  regen is mandatory, and the generator has no per-surface mode — regenerating my
  branch necessarily picks up all of main's accumulated drift. Both were
  reconciled following the file's own existing precedents, with a comment stating
  the provenance so the next reader does not mistake them for this feature's
  surfaces. Recorded in HUMAN_FEEDBACK as a generalizable observation.

- **DRIFT-1.8** — verdict: resolved — **the component harness needed a 400 ms
  settle window, not 40 ms.** First run showed 8/12 red with the composer
  apparently never written to — which reads exactly like the defect under test.
  Two real causes, both in the TEST: a `vi.mock` path (`../../audio/wav`) that
  was off by one directory level, so the REAL AudioContext-dependent WAV encoder
  ran and threw in jsdom; and settle windows shorter than the engine's 300 ms
  `clampInterval` floor. Named here because a false RED that looks like the
  bug is as dangerous as a false green: the fix was in the harness, and the
  engine was verified independently correct before either was changed.

- **DRIFT-1.9** — verdict: none — ITEM-1, ITEM-3, ITEM-4, ITEM-7, ITEM-8,
  ITEM-9, ITEM-11, ITEM-14, ITEM-15, ITEM-16 landed as planned, with no
  divergence from either the plan or the design's invariants.

## Invariant reconciliation (each checked against the SHIPPED behaviour)

- **INV-1** — upheld. `insertTranscript`/`spliceTranscript` write at the caret
  and leave it after the transcript (TEST-4, TEST-17 observed passing); the
  toolbar `<span>` and the `interimText` state that fed it are DELETED, not
  hidden (TEST-11, TEST-17, TEST-24).
- **INV-2** — upheld. The interim loop's only action is now
  `writeDictation(...)` into the composer (TEST-13 observed passing on a real
  mounted textarea; TEST-20 on the real stack).
- **INV-3** — upheld. No send path was added; every new call site edits text
  only. Pinned by TEST-22.
- **INV-4** — upheld, and EXTENDED to the failure path (DRIFT-1.6). Every write
  sits inside the pre-existing `isSuperseded` triple guard, plus a new
  `dictation.gen === gen` check so a tick from a previous recording can never
  write into a newer one. Pinned by TEST-14, TEST-21.
- **INV-5** — upheld; see DRIFT-1.1 for the one behavioural refinement and why
  it does not weaken the contract. Pinned by TEST-6, TEST-19.

**Unresolved drifts:** 0
