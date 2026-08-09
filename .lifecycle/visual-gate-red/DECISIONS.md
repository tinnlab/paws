# DECISIONS — visual-gate-red

### DEC-1: `chat-collapse-borders` is red because its subject was deliberately removed. Delete the spec, or give it a real subject?
**Resolution:** Give it a real subject. Rebuild the fixture's in-clamp cards out of
`observation` blocks (rail-excluded, rendered by `ObservationContent` as a kit
`Card` with the same `ring-1 ring-foreground/10` the #183 defect erased). Do NOT
delete the spec, and do NOT re-target it at the rail's buttons.
**Basis:** codebase — the protection the spec guards (`CollapsibleBlock`'s
`-m-0.5 p-0.5`) is measurably still present and still load-bearing (`REPRO.md` §A2,
and `rightGap: 2` in §A3 shows it is what currently keeps a rail button off the
clip edge). Deleting the spec would silently un-pin a shipped fix. Re-targeting at
rail buttons would produce a pin that stays green with the fix reverted, because
those use a real CSS border painted inside the border box (§A3) — a vacuous test,
the exact failure class §14/D2 exists to prevent.

### DEC-2: Should the fix instead assert the inset directly (`padding === '2px'`)?
**Resolution:** No. Keep it a fixture-driven EFFECT assertion.
**Basis:** convention — the spec's own header (INV-2, `chat-collapse-borders.spec.ts:21-24`)
rejects exactly this: asserting the classes "would freeze the technique … and such
a test would not have caught the original bug at all". Honouring the design
invariant over the convenient repair.

### DEC-3: Rename the surface slug `deep-chat-collapsed-tool-boxes`, which no longer contains tool boxes?
**Resolution:** No. Keep the slug; correct the human-readable `title`/`note` and the
`coverage.ts` reasons instead.
**Basis:** convention — the slug is a key referenced by `coverage.ts`,
`gallery.tsx`, the spec and the generated gallery registries; renaming it churns
generated artifacts and the runtime-health surface keys for zero behavioural gain,
which is disproportionate to a gate repair. The misleading NAME is neutralised by
fixing the prose that a reader actually reads.

### DEC-4: `overlays.spec.ts` resolves ambiguously. Scope by portal, by testid, or by "newly appeared"?
**Resolution:** Scope by portal — `[role="…"]:not([data-testid="gallery-root"] *)` —
AND additionally require the handle to be absent before the click and to be the
single visible match after it.
**Basis:** codebase — measured (`REPRO.md` §B2): every genuine overlay portals
outside `gallery-root` while both offending inline panels are inside it, so the
portal scope is exact for all four role-addressed cases. A per-case testid
(`g-sel-filled-popup`) exists for `select` but NOT for `combobox`, so testid
scoping cannot cover the set. The absent-before/present-after guard is what makes
the vacuity (not just the hang) impossible to recur.

### DEC-5: The overlays fix makes `multiselect` and `popover` run for the first time since `c1a7c82a5`. What if one of them fails?
**Resolution:** Report the failure as a real finding and fix it in this branch if
it is in scope; do NOT re-order, skip, or `.catch()` around it.
**Basis:** convention — `[[feedback_no_ignore_unless_platform]]` and the
lifecycle's A3 (no diff-added `.skip`). Pre-measured (`REPRO.md` §B2) both open and
close cleanly, so this is expected to be moot.

### DEC-6: Bounded close-wait — what timeout, and should a failure to close be swallowed?
**Resolution:** 5s, and keep the existing `.catch(() => undefined)` best-effort
semantics rather than promoting a close failure to a hard assertion.
**Basis:** convention — the author's stated intent is best-effort ("Close so the
next overlay opens clean"), and today that intent is UNREACHABLE because
`locator.waitFor` has no default timeout, so the catch can never fire. The bound
restores the written intent without widening the spec's contract in a gate-repair
branch. The case that a stuck overlay must hard-fail is a genuine strengthening
but a separate decision, recorded as such rather than smuggled in here.

### DEC-7: Is any `sdk` submodule change needed?
**Resolution:** No. All edits are in `src-app/ui`.
**Basis:** codebase — the two failing specs and the fixture/coverage files are all
in the app workspace. `sdk` stays pinned at `0ba62538` and is not committed to.
