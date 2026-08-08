# voice-composer-insert — FIX ROUND 4

A blind round-4 auditor ran **regression** and **test-reality** over the round-3
commit, pinned to `280c28808`. 9 findings, most oracle-confirmed.

**Round 3's fix introduced the fourth consecutive regression, in the same place
as the previous three.** That is the finding of this round, and it is a finding
about the DESIGN, not about any individual line.

---

## The regression, and why it kept happening

`commitTranscript` changed `if (session?.span)` to `if (session)`, so a session
owning no span routed the FINAL transcript through `resolveWriteSpan`. No span
is ever owned when live captions are OFF — a per-device pref, or a deployment
with `streaming_enabled: false`, which puts EVERY user of that deployment on
that path. And the round-3 `stillHolds` guard is **vacuous for a bare caret**:
`anchorText` is `''`, and `value.slice(n, n) === ''` for any in-range `n`, so a
wholly replaced draft still "holds". The transcript was spliced at the stale
record-start offset, mid-word, into unrelated text:

```
FIX     -> "supercalifrag INSERTED ilistic"   ← corrupts the user's word
PARENT  -> "INSERTED supercalifragilistic"    ← correct
```

**The common shape across all four rounds:** each fix moved logic into a path
whose PRECONDITIONS were weaker than the path it came from, and each round's
remedy was another guard on the record-start anchor. Guards on that anchor
cannot be made complete — for a caret there is no text to compare, so there is
nothing a guard can even look at.

## The response: delete the mechanism, don't guard it again

`resolveWriteSpan` now has exactly two cases — relocate the span the session
OWNS, or write at the composer's LIVE selection. There is no third case reading
the record-start anchor.

The anchor was never needed to decide WHERE to write: nothing overwrites the
user's selection until dictation itself does, and once it has, `session.span` is
the thing to relocate. The DOM already holds the live insertion point, and §3
rule 7 says the user's current position wins. `anchor`/`anchorText` survive for
one purpose only — knowing what to put BACK on cancel.

Consequences, all simplifications:
- `commitTranscript` consults the session only when it OWNS a span; with
  captions off the composer's own selection is the authority.
- The blank branch keeps tracking a restored SELECTION (so cancel can still
  re-select it) and tracks nothing for a caret (a zero-length span "relocates"
  successfully to stale offsets forever — the same vacuous-guard trap).
- The span clamp is gone: with `resolveWriteSpan` correct it was unreachable.
- The `final` caret flag is gone: `focusComposer` applies the caret
  `writeDictation` RETURNS, so the flag had no observable effect. Confirmed by
  mutation — mutating the RETURN value reddens two tests; mutating the flag
  reddened none.

## Tests

Round 4's audit found four production lines with no test that could fail on
revert. Three now have one; the fourth (`if (session?.span)`) is genuinely
redundant after the structural change rather than untested, and is recorded as
such instead of being given a test that cannot discriminate.

Three of my first attempts passed against a broken mutant and had to be
rewritten: one put the caret where the fallback would have landed anyway; one
was made redundant by a second change in the same commit; one left a settle
window in which a timer moved the caret.

| runner | result |
|---|---|
| `voiceLogic.test.ts` (node:test) | **27 pass / 0 fail** |
| `DictationComposer.test.tsx` (vitest) | **27 pass / 0 fail** |
| `npm run check` (ui + desktop/ui) | **exit 0** |

| mutation | result |
|---|---|
| re-introduce the stale-anchor branch | caret-anchor test **RED** |
| blank branch drops span tracking for a selection | 2 tests **RED** |
| drop the live-selection half of the fallback | 4 tests **RED** |
| return `edit.start` instead of `edit.caret` | 2 tests **RED** |

**New confirmed findings:** 4 — found by the round-5 blind re-audit (see FIX_ROUND-5.md).
