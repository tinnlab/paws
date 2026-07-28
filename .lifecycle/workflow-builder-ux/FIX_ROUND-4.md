# FIX_ROUND-4 — workflow-builder-ux

Input: `ledger-round4.jsonl` (15 rows / 7 confirmed — 0 high, 1 medium, 6 low).
Fixes landed in commit `f5f4a08e6`.

Round 4's audit verified round 3's changes as sound: `usePermission` is called
unconditionally at top level with an invariant hook count; the permission-denied
path leaves an ENABLED hand-entry field under a TRUTHFUL alert; the busy/settled
fix cannot latch (every `load` early-return writes `byServerId[serverId]` before
awaiting); both `staleOption` null cases are correct; all four humanisation routes
make exactly one pass; and the `Self::` detection produces no false positive from
`-> Self`, `impl … for Self`, or an unrelated impl.

---

## MEDIUM — the one state where the builder told the author something UNTRUE

`POST /validate` and `POST /validate-def` deliberately pass a **unique path that
was never created** as the bundle root, so a `WorkflowsRead` caller cannot probe
the filesystem through them. Statting a `prompt_file` under such a root can only
ever fail — so `check_prompt_files` reported `WORKFLOW_PROMPT_FILE_MISSING` for
**every** `prompt_file:` step, a verdict the endpoint had no way to reach.

This branch amplified that into a confident human sentence, a red step marker and
a **permanently disabled Save** on any imported `prompt_file:` workflow — and no
builder form field can clear it, because none writes `prompt_file` (typing a
prompt instead yields `WORKFLOW_PROMPT_BOTH`). Backend-origin, branch-amplified,
and the only reachable state where the builder blocked the author with a false
claim.

**Fixed at the cause**, splitting the check by what is decidable:

- the path-**shape** reject (`..`, absolute → `WORKFLOW_PROMPT_FILE_UNSAFE`) is
  purely textual, decidable anywhere, and is a **security** check — it still
  always runs, before the bundle gate;
- the **existence/confinement** pair (`…_MISSING`, `…_ESCAPE`) can only be decided
  against a real materialized bundle, so it is skipped when `bundle_root.is_dir()`
  is false rather than answered wrongly. Install/import passes the real extracted
  bundle dir and re-validates authoritatively before anything is written.

No finding is invented for a question the call cannot answer. `dev.rs` changed
**comments only** — both bundle-root comments claimed "any `prompt_file:` is
reported as a (soft) missing-file error", which is no longer true.

Proof: `draft_validation_without_a_bundle_reports_no_prompt_file_verdict` builds
the root exactly as `validate_workflow_def` does, asserts it does not exist, and
asserts no `…_MISSING`, no `…_ESCAPE`, and no `Severity::Error` at all. RED with
the gate stubbed to `if false`. A sibling test
(`…_still_rejects_an_unsafe_prompt_path`) proves the security reject survives.

**Round 5 independently re-verified the security property**: the shape reject is
emitted before the `continue`; every `validate_for_install`/`validate_collecting`
caller (`dev.rs:268`/`:564`, `runner.rs:1248`/`:1552`, `hub/handlers.rs:2187`,
`workflow_mcp/tools.rs:528`/`:672`) passes a root it has just `read_to_string`'d
`workflow.yaml` out of, so only the two draft surfaces take the skip; and the
TOCTOU direction that matters is fail-closed.

## LOW

- **The stale-save-error retirement could fire with nothing fixed.**
  `findingStillPresent` compared a `location` that `parseInstallError` had
  GUESSED out of the wire string — a message beginning `workflow.yaml: `
  (`WORKFLOW_TOO_MANY_STEPS`, `WORKFLOW_NO_STEPS`) yielded a pseudo-location that
  never matches `/validate-def`'s `undefined`, retiring the error on the FIRST
  check. → `FindingIdentity` gained `locationCertain` (set from
  `attributed.stepId != null`, the only available evidence that the token really
  is a location); a guessed location matches on code alone. Additionally
  `UNDECIDABLE_BY_DEF_CHECK` was introduced: after the fix above the def-check no
  longer looks at prompt-file existence, so its silence is not evidence and must
  never retire a true save failure. Retirement is now only ever taken on proof.
- **A residual drift-guard hole**: `ValidationError`'s fields are `pub`, so
  `e.code = "NEW"` after a legitimate `::err(...)` was invisible to all three
  assertions at once — the same silent-agreement mode the `Self::` fix closed,
  through another door. Visibility narrowing is impossible (`dev.rs`,
  `workflow_mcp/tools.rs` and `ref_check.rs` all read the fields, and Rust has no
  read-only-public field), so the scanner now reports a post-construction
  assignment to `code`/`layer`/`severity` — with six negative controls (`==`,
  `!=`, `.to_string()`, `match`, an iterator comparison, and a `code:` field on an
  unrelated struct) so it cannot cry wolf on finding *consumers*. RED-then-GREEN
  recorded.
- **The LOAD boundary was the last failure surface outside the shared
  humanisation**, so a 502 HTML body reached `ErrorState details`. → Routed
  through it, and pinned by a **class** assertion (`!/\berror\.message\b/` over
  the comment-stripped store source) that catches any future surface which
  bypasses humanisation. *(Round 5 then found this fix used mutation-voiced copy
  at a read boundary — see FIX_ROUND-5.)*
- Two dead exports: one WIRED (it was exactly what the load boundary needed), one
  REMOVED as provably unreachable (`loading={busy}` on a branch reachable only
  when `usePicker`, and `usePicker ⇒ !busy`).

## Explicit rejection

**The Server picker's missing synthetic option — REJECTED, second time, with new
reasoning.** Beyond round 3's kit-behaviour evidence: the residual named ("shows
raw `name` not `display_name`") is *not fixable* — when a server is absent from
the accessible list there IS no `display_name` to show. Every path that removes it
from the options (`unknown-server`, `disabled-server`, `no-permission`) is a
**blocking** failure, so the Alert renders directly under the Server field with a
title and reason naming it — INV-6's "visible, stated reason" is satisfied at the
field. And making an unavailable server re-selectable and marked-as-selected would
have the picker assert the value is a valid choice, the opposite of what visible
degradation should communicate.

---

## Re-audit outcome

A fifth blind audit (`ledger-round5.jsonl`, 19 rows) confirmed **2 findings, 0
HIGH**, and rejected 17 — including five high-severity candidates. It explicitly
verified the security question above, and confirmed the drift guard cannot pass
vacuously (it could not construct a `ValidationError` invisible to all three
assertions). Both remaining findings — a round-4 regression using mutation-voiced
copy at the LOAD boundary, and a pre-existing zod raw-diagnostic leak newly
exposed by round 4's unblocking of the `prompt_file:` state — go to FIX_ROUND-5.

**New confirmed findings:** 2
