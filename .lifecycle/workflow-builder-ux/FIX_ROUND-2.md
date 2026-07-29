# FIX_ROUND-2 — workflow-builder-ux

Input: `ledger-round2.jsonl` (28 rows / 20 confirmed — a fresh blind re-audit over
the post-round-1 diff) and `ledger-tests.jsonl` (23 rows / 16 confirmed — a
dedicated blind test-quality audit). Fixes landed in commit `d9501eb24`.

The round-2 auditor was given the round-1 machinery by name and told to hunt for
defects the FIXES introduced. It found several — which is the point of the loop.

---

## Defects round 1 introduced

- **Sticky template mode LATCHED across a tool change** (HIGH).
  `GeneratedField` was keyed by `field.name`, and `ToolStepForm` only remounts
  per STEP — so picking a different tool that declares a same-named property
  reused the same field instance, and the latch effect only ever set TRUE.
  Concretely: tool A's `days` holds `{{ inputs.horizon_days }}`; pick tool B,
  which also declares `days` (integer); `arguments` is cleared but the latch
  survives, so the integer field renders as a free-text Input captioned "Using a
  reference — resolved when the workflow runs." over an EMPTY value, and typing
  `5` commits the STRING `"5"`. INV-4 and INV-6 violated, plus type corruption.
  → Keyed `tool::field`; the latch now also CLEARS on a blank value. Cleared on
  blank only, so a half-typed `{{ inputs.limit` still holds the mode (which was
  round 1's legitimate reason for the latch).
- **`runValidate`'s success branch cleared a concurrent SAVE failure.** Round 1
  added `d.error = null` to stop the new Alert latching; the intent was right,
  the scope too wide — a background validate erased a save error and the green
  "No blocking errors." returned while the workflow was unsaved.
  → An `errorSource` field; a success clears only the error validation owns.
- **`pendingNumberClear` deleted a good value.** Abandoning an InputNumber whose
  buffer is `-`, `1e` or `.` committed `undefined` and removed the argument.
  → The blur handler reads the raw buffer through a ref and only commits a
  delete when the box is genuinely empty.
- **`.filter(s => s.enabled)`** (added in round 1) reclassified a DISABLED but
  registered server as `unknown-server` — a false reason with no recovery path.
  → A `disabled-server` state that says what is actually true.

## Defects round 1 failed to close

- **Stale enum values were silently BLANKED and MultiSelect ERASED undeclared
  entries** — the same class round 1 closed for the Tool picker (a synthetic
  "not offered any more" option) and left open for enum arguments.
  → `fieldForValue` synthesises an option for a stored value the schema no longer
  declares, with keys disambiguated by `assignKeys` so a synthetic cannot shadow
  a declared choice. A second bug surfaced in the same family: `optionValueForKey`
  used `?.raw ?? key`, so a schema declaring `null` as a choice committed the
  string `"null"`.
- **`McpServer.servers` is LAZY and nothing awaited it** (HIGH), so every open of
  a saved tool step first asserted the server *"isn't one of the servers
  available to you"* — a FALSE reason, made PERMANENT if the list load failed,
  with `isRetryableFailure` excluding `unknown-server`.
  → `resolving-server` / `disabled-server` / `server-lookup-failed`; absence is
  now only ever reported from an authoritative by-name lookup.
- **The >10-server pagination hole** (INV-3) — a stored server past page 1
  resolved to `unknown-server`.
  → A real `resolveServer` by-name lookup with exact-name equality, session-cached
  and deduped, rather than guessing from the loaded slice.
- **`humaniseInstallError` piped `HTTP error! status: 502 - <entire HTML page>`
  into an Alert TITLE and a toast** — the same class round 1 guarded in
  `describeFetchError`, just not applied at the save/validate boundary.
- **`inflight`/`generation` were per-mount while the cache was per-session**, so
  switching steps mid-fetch fired the duplicate `tools/list` the WeakMap exists
  to prevent. → Moved into the per-scope `SessionState`, storing the PROMISE so a
  late joiner awaits the running request instead of starting a second one.

## The test that could not fail

**TEST-20's headline overflow probe was structurally unfalsifiable.** The builder
renders inside `SettingsPage.tsx` `flex-1 overflow-hidden` and
`SettingsPageContainer`'s `DivScrollY` (an OverlayScrollbars host), so
`document.scrollingElement.scrollWidth - clientWidth` is **always 0** no matter
how wide a child is. A 900px-wide step list at 390px would be CLIPPED and the
test would still pass — i.e. ITEM-10, the owner's actual visual report, was
proven only for the finding boxes and the four generated fields.

→ Replaced with an ancestor-chain probe and **proven falsifiable**: with an
injected over-wide element it fails naming five ancestors with their
`scrollWidth`/`clientWidth`/overflow; without it, green. The original
document-level probe is retained as a secondary check with a note that it is not
sufficient.

It immediately found a real **pre-existing kit defect**: the combobox inline-end
addon overflows its group by 4px at 390px. Carried as a named, documented
`MAX_TOLERATED_OVERFLOW_PX = 4` bounded at exactly the observed value (so a 5px
regression still fails), and reported to the kit owner rather than hidden.

## Backend guard

Closed the alias hole — `use … as VE` and `type VE = …` were invisible to BOTH
halves of the guard, silently, while every other hole was loud. Added a lexer
self-test pinning char-literal/lifetime handling, raw byte strings, and
`#[cfg(all(test, …))]` vs the literal `#[cfg(test)]` match.

## Parent fan-in fixes (found by the parent, not by an agent)

- The new component probes embedded `data-testid="…"` CSS selectors, and the
  shared cross-repo registry generator scrapes those literals — it had minted 5
  fixture ids (including the literal `${name}`) into `@ziee/kit`'s PRODUCTION
  testId union. This is the SECOND occurrence of that class on this branch.
  Selectors are now built by concatenation via a `sel()` helper; the registry is
  back to exactly the 6 real ids.
- **A Rules-of-Hooks violation:** `McpServer.isInitialized || !!McpServer.error`
  put a store-proxy read — which IS a hook — on the RHS of a `||`, so the hook
  count varied with `isInitialized` and React would crash the frame that flipped
  it. Both reads hoisted. `lint:hooks`: 0 violations across 2481 files.

## Explicit rejections

Recorded as `status: rejected` in `ledger-round2.jsonl`. Notably: a WeakMap leak
or dropped live session (the `use()` proxy is ref-stable per mount); a stale
response winning after `invalidate` (the generation guard is correct in both
orders); the synthetic "not offered any more" option being re-committable (the
`v === step.tool` guard blocks it); a pending number clear being lost on unmount
(blur precedes every click-driven unmount); and `no-tools` mis-describing an
unreachable server (checked `runtime.rs` — errors propagate, so 200-with-empty
really does mean zero tools).

---

## Re-audit outcome

A third blind audit (`ledger-round3.jsonl`, 21 rows) verified round 2's
cache/promise/blur/option/sequence-guard machinery as **genuinely closed** — those
rejections are the most valuable output of that round. It confirmed **7 new
findings**: a permission-less user left with a permanently disabled Tool field
and a false reason (INV-6, reachable); a remaining `Self::` vacuity hole in the
drift guard; copy humanised twice and truncated at 160 chars; a stored `null`
multiselect element still erased; a stale save error never retired; and a
one-frame enabled fallback flash. Those go to FIX_ROUND-3.

**New confirmed findings:** 7
