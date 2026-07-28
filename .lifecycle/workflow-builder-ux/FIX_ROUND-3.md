# FIX_ROUND-3 — workflow-builder-ux

Input: `ledger-round3.jsonl` (21 rows / 7 confirmed — a third blind audit over the
post-round-2 diff). Fixes landed in commit `c70f695c7`.

Round 3's audit is notable for what it REJECTED: it independently re-derived and
verified round 2's cache/promise/blur/option/sequence-guard machinery as
genuinely closed (the `WeakMap` key is stable per editing session; the stored
in-flight promise cannot leave an entry pending or raise an unhandled rejection;
`invalidate` deletes pending + local state together; the number blur reads the
kit's unflushed buffer so an abandoned partial edit leaves the argument alone;
synthetic option keys cannot shadow a declared choice). Those rejections are the
evidence that round 2 actually worked.

---

## HIGH — a permission-less user was silently locked out

A user holding `workflows::manage`/`install` but **not** `mcp_servers::read` got a
**permanently disabled** Tool field showing a false "Looking up this server…" and
**no reason at all**.

Chain: `mcpServer/actions/loadMcpServers.ts:13` returns at its own permission gate
without setting `isInitialized` **or** `error`, so `serversSettled` is false
forever → `entryForServerName` returns `resolving-server` with
`needsLookup: false` → `busy` stays true → `resolving-server` is classified
transient so no Alert renders → `disabled={busy}` kills the escape hatch. The
store's `no-permission` variant was unreachable because it needed a `serverId`
the list could never supply. INV-6 violated in a reachable state.

→ `ServerResolutionContext` gained `canList`; `entryForServerName` answers
`no-permission` immediately. `ToolStepForm` supplies it from
`usePermission(Permissions.McpServersRead)` — the REACTIVE primitive, not
`hasPermissionNow`, so a grant arriving mid-session opens the picker — hoisted
unconditionally with the other proxy reads. The author now gets the existing
stated reason and a usable hand-entry field, and no 403-bound request is made.

**Upstream cause recorded, not masked:** `loadMcpServers` leaving BOTH flags unset
means *every* consumer of that store sees "still loading" forever for such a user.
The real fix belongs there. This branch's guard is correct locally but is not a
substitute — flagged for that file's owner.

**Residual, deliberate:** that user still cannot pick a NEW server —
`CapabilitySelect` is a `Select` over an empty list. Giving the Server field a
free-text fallback is blocked by `noFreeTextEntityRef.test.ts` (the INV-3 class
scanner), which treats `step.server` bound to an `Input` as an offender and does
not list `CapabilitySelect` among its `PICKER_CONTROLS`, so the paired-picker
carve-out would not apply. Needs that scanner's owner; not worked around here.

## HIGH — the drift guard could STILL pass vacuously, via `Self`

The lexer keyed on the literal identifier `ValidationError` and (after round 2)
reported both renaming dialects — but not the idiomatic third. `impl
ValidationError` exists at `validate.rs:450`, so a constructor written there as
`Self::at("semantic", "WORKFLOW_NEW_CODE", …)` contributed nothing to the emitted
set AND nothing to the humanisation demand: the two agreed, no copy was required,
and the guard was GREEN while a raw wire code shipped to the author. The same
silent-agreement class round 2 had just closed for aliases, through another door.

→ `scan_rust_source` tracks an `impl … ValidationError` body by depth; inside it
`Self` routes to `scan_self_use`, sharing the constructor reader. `Self { … }`
literals are inspected separately: a literal `code:` field is reported, while the
type's own `err`/`at`/`warn` (which thread the `code` PARAMETER through a `Self
{ … }`) are not.

**RED-then-GREEN, verbatim.** With the temporary constructor installed, the
PRE-fix scanner was vacuously green (`3 passed`); the POST-fix scanner failed
naming the code:

```
these validation codes are emitted but NOT listed in `VALIDATION_CODES` (validate.rs): ["WORKFLOW_NEW_CODE"]
```

Constructor removed → `test result: ok. 35 passed`. Pinned in
`scanner_reads_awkward_source_shapes` with two negative controls (the type's own
constructor, and `Self::at` inside `impl SomethingElse`).

## MEDIUM

- **Copy was humanised TWICE and the second pass CLIPPED it.** `save()` already
  stored the humanised sentence; the panel and the toast re-ran
  `humaniseInstallError` on it, which no longer matched `[layer/CODE] loc: msg`,
  fell through to the transport path and truncated at 160 chars. Measured:
  `WORKFLOW_BAD_STEP_ID` is 216 chars step-prefixed — the actionable half was
  cut, in BOTH surfaces. The function's "Idempotent" docstring was the false
  premise behind the bug.
  → The **store** is now the single boundary (it is where the failure is caught
  and where `def.steps` is in hand); both renderers are verbatim pass-throughs.
  `humaniseInstallError` had no remaining caller and was removed (§15). A new
  source-guard test asserts bidirectionally that the renderers do NOT humanise
  and the store DOES.
- **A stale SAVE error was never retired**, so a provably-false red Alert sat
  above a green "No blocking errors." after the author fixed the problem.
  → `describeRequestError` now also returns WHICH finding it restated; a
  successful check retires a save error only when that specific finding (code AND
  location) is gone. A non-finding save error (name collision, 502) has no
  identity and is never auto-retired, preserving round 2's fix.
- **`fieldForValue` still ERASED a stored `null` ELEMENT of a multiselect** — the
  DEC-6 data-loss class it exists to close. `staleOption`'s `value === null`
  early-return was right for the single-select call and wrong for the per-element
  call. → It now rejects only `undefined`; the "no value at all" reading of `null`
  moved to the single-select branch. `staleLabel` was added because
  `valueToText(null)` is `''`, which would have rendered a bare
  " — not one of this tool's choices".

## LOW

- A **one-frame ENABLED free-text fallback** flashed at the server-resolution
  boundary: on the render where `serverId` first resolves, `byServerId[serverId]`
  is `undefined` → `entry` is `EMPTY` (no failure, not loading) → the hand-entry
  Input was committed enabled with the generic blurb before `catalog.load` ran in
  its passive effect. → `awaitingCatalog` folds into `busy`. Every `load`
  early-return writes `byServerId[serverId]` synchronously before its first
  `await`, so this cannot latch.

## Explicit rejection

**The Server picker "silently drops a configured value" — REJECTED as a false
positive, with evidence.** The premise is falsifiable and false: the Tool field is
a `Combobox`, whose `selected` is `byValue.get(current) ?? null`, so an unmatched
value really does render blank (which is why `storedToolMissing` was needed). The
Server field is a `Select`, which renders `<SelectValue placeholder>` with
`customDisplay === undefined`, and base-ui then paints the raw VALUE. Measured in
jsdom: with `step.server='ghost_server'` the field's `textContent` is
`"ghost_server▼"` — visible, not dropped — and the reason IS stated by the
`wf-builder-tool-catalog-error` Alert one element below. Two tests were added to
PIN this behaviour and the kit asymmetry, so the claim need not be re-derived and
a future kit change that DID start blanking fails there. **The round-4 auditor
independently reached the same conclusion.**

---

## Re-audit outcome

A fourth blind audit (`ledger-round4.jsonl`, 15 rows) found **7 new confirmed
findings — 0 high, 1 medium, 6 low** — and verified round 3's changes as sound:
`usePermission` is called unconditionally at top level with an invariant hook
count; the denied path leaves an ENABLED field under a TRUTHFUL alert; the
busy/settled fix cannot latch; both `staleOption` null cases are correct; all four
humanisation routes make exactly one pass; and the `Self::` detection produces no
false positive from `-> Self`, `impl … for Self`, or an unrelated impl. It also
independently confirmed the Server-picker rejection above.

The remaining medium is **not** a round-3 defect: `/validate-def` passes a
guaranteed-nonexistent bundle root, so `check_prompt_files` emits a permanent
FALSE `WORKFLOW_PROMPT_FILE_MISSING` for every `prompt_file:` step while the SAVE
path validates against the real root. Backend-origin, but this branch amplifies it
into a confident sentence, a red marker and a permanently disabled Save — the one
reachable state where the builder tells the author something untrue. It goes to
FIX_ROUND-4 rather than being silently closed.

**New confirmed findings:** 7
