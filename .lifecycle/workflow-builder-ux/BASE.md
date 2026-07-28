# BASE.md — conflict surface vs current base

Base branch: `origin/feat/agent-core` @ `d53db2d11`.

## Migrations

This feature adds **NO migration**. Workflow migrations are module-local
(`src-app/server/src/modules/workflow/migrations/`); the highest existing is
`202607191200_background_run_notes.sql`. Nothing to collide with.

## OpenAPI regen

**Not implied.** The only backend edit is a `pub const VALIDATION_CODES: &[&str]`
plus a `#[cfg(test)]` guard test in
`src-app/server/src/modules/workflow/validate.rs`. Neither is a `JsonSchema`
type, a handler, nor a route, so `openapi.json` and `api-client/types.ts` are
byte-unchanged in BOTH workspaces. If Phase 5 drifts into any wire-type change,
`just openapi-regen` for both binaries + `types_ts_parity` becomes mandatory —
recorded as a drift entry, not a silent skip.

## Files this branch touches that the base / sibling branches also touch

Sibling agents are active in other worktrees on: the activity rail, `ask_user`
coercion, voice models, and the **scheduler settings page layout**.

- `src-app/ui/src/modules/scheduler/**` — **NOT TOUCHED** (sibling owns it). The
  scheduler branch is fixing hand-rolled form layout; this branch records the
  analogous `LabeledControl`-vs-kit-`Field` question for the builder
  (ITEM-10) without editing the shared kit or the scheduler module, so the two
  cannot collide.
- `src-app/ui/src/modules/chat/components/rail/**` — **NOT TOUCHED**.
- `src-app/ui/src/dev/gallery/coverage.ts` — a **shared, append-keyed** registry.
  Risk: another branch adding a surface edits the same file. Mitigation: this
  branch adds at most one or two keys in the existing workflow block (lines
  477–492), a small, localized hunk that merges cleanly; and it changes the
  `reason` string on `ToolStepForm` only.
- `src-app/ui/src/modules/workflow/gallery.tsx` — no sibling branch is named as
  working on workflows.
- `src-app/server/src/modules/workflow/validate.rs` — no sibling branch is named
  as working on workflow validation.
- `src-app/ui/tests/e2e/workflows/builder-step-kinds.spec.ts` — updated (it
  currently asserts the defect). No sibling owns workflow e2e.

## Inherited lifecycle dirs

The base carries 16 sibling `.lifecycle/` dirs. They are INHERITED and must never
be deleted. Guard, run before every commit:

```
git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD -- .lifecycle   # must be empty
```

## Submodules

`agent-kit` is a **separate repo** pinned as a submodule. ITEM-12 (adding the
builder routes to the live-UI-audit rig) would require a submodule commit + a
pointer bump, which would collide with the 16 sibling branches that all carry the
same pointer. DESCOPED — see DECISIONS DEC-9.
