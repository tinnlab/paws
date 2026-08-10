# DECISIONS — blank-page-chatmessage-hooks

### DEC-1: Fix `ChatMessage` by hoisting the hook, or by removing the early return?
**Resolution:** Hoist the `useSyncExternalStore` into the unconditional hook
prologue (immediately after the other hooks, before the `contents.length === 0`
early return). Keep the early return exactly as it is.
**Basis:** codebase — `ContentRenderer.tsx:28`, the sibling component subscribing to
the SAME registry seam one level down, already has precisely this shape: hook in
the prologue, conditional returns after it. Removing the early return instead would
change what an empty message renders (an empty bubble wrapper), a behaviour change
outside the bug's scope. Hoisting is behaviour-preserving for every render that
already reached the hook, and correct for the ones that did not.

### DEC-2: What does the per-module error fallback render?
**Resolution:** A compact, self-contained `role="alert"` card: a short heading, an
explanatory line, the error message in a `<pre>`, and a "Reload page" button —
reusing the structure + copy of the app-entry fallback in `src-app/ui/src/main.tsx`,
with self-contained inline colors (no dependence on the token CSS pipeline).
**Basis:** convention — `main.tsx:22-96` is the existing, reviewed precedent for
"what a crash surface looks like in this app", and it deliberately avoids the token
pipeline because a crash may itself be a theme/CSS failure. Copying it keeps ONE
crash visual instead of inventing a second.

### DEC-3: Should the boundary auto-reset, and on what?
**Resolution:** Reset on LOCATION CHANGE only (the shell re-keys the boundary on the
current pathname), never on a timer and never on every render. `componentDidCatch`
keeps logging unconditionally.
**Basis:** convention — this is the standard `react-error-boundary` `resetKeys`
idiom, and it matches the observed failure: the explorer's log shows the URL kept
changing across steps 13-16 while the surface stayed dead, so location is exactly
the signal that a user "moved on" and deserves a fresh attempt. A module that
throws on every route still shows the fallback each time (bounded, no loop — proven
by TEST-4), and because logging is unconditional the runtime-health gate still
counts every occurrence, so auto-reset cannot hide a crash from the gates.

### DEC-4: Fixed rule set, or an admin-configurable tunable? (configurable-settings rule)
**Resolution:** Fixed. This change introduces NO operational tunable — no limit, no
retention, no quota, no toggle, no model/provider selection. The one numeric value
involved is the error-boundary reset trigger, which is an event (location change),
not a threshold.
**Basis:** convention — the Phase-4 configurable-settings rule applies to
operational tunables; a Rules-of-Hooks correction and an error-fallback visual have
none. Recorded explicitly so the omission is a decision, not an oversight.

### DEC-5: Enable `useHookAtTopLevel` in the shared base config or per-workspace?
**Resolution:** In the shared `sdk/packages/config/biome.base.json`, so both
`src-app/ui` and `src-app/desktop/ui` (and any future consumer) inherit it, with the
existing `__detector_fixtures__` path excluded exactly as the current grit-plugin
override already excludes it.
**Basis:** codebase — `src-app/ui/biome.json` `extends`
`../../sdk/packages/config/biome.base.json`.
**AMENDED during phase 5 (DRIFT-1.2 / DRIFT-1.3):** the premise was half wrong and
the resolution was insufficient. (a) `src-app/desktop/ui/biome.json` has NO
`extends` — it is a standalone copy — so the shared enable did not reach it; the
rule is now set in both, and TEST-6 asserts both independently. (b) Enabling a rule
in config does not RUN it: `npm run check`'s biome step is
`--only=style/noRestrictedImports`. A chained `lint:hooks-top-level` script was
added to both workspaces, and TEST-6 asserts the chaining. Leaving either gap would
have reproduced the exact failure this branch repairs — a guard that is configured
but never executed.

### DEC-6: Keep the existing `lint:hooks` guard, or replace it with the biome rule?
**Resolution:** Keep BOTH. `lint:hooks` covers what biome structurally cannot — a
reactive STORE-PROXY field read (a property access, not a `use*()` call) in a
conditional, which is this codebase's bespoke hook. Biome's `useHookAtTopLevel`
covers the `after-early-return` case `lint:hooks` deliberately excludes. They are
complements, not substitutes.
**Basis:** codebase — `scripts/lint-hooks.mjs` says so in its own header ("even if
it were [run], O2 is invisible to it — `LlmProvider.providers` is a property read,
not a `use*()` call. Only a project-specific lint can know that") and its rule H1
explicitly defers `after-early-return` to "the standard rules-of-hooks rule's
territory". This decision makes that deferral true instead of aspirational.

### DEC-7: Fix all four Rules-of-Hooks sites, or only the reproduced one?
**Resolution:** Fix all four (ITEM-1 + ITEM-5).
**Basis:** convention — the gate in ITEM-4 cannot be enabled while any violation
remains, and a guard that is not enabled is the exact reason this defect shipped.
Leaving three known instances of the reproduced defect class in the tree while
declaring the class closed would recreate the hole. Two of the three are
lower-severity (props-shape guards) and are recorded as such in PLAN.md rather than
silently levelled up.

### DEC-8: SDK submodule commit handling
**Resolution:** `AppShell.tsx` + the new fallback + `biome.base.json` live in the
`sdk` submodule. Commit them there on branch **`chat`** (base tip
`0ba6253855742813bb43e7e0466131496c8ed97a`) and do NOT push; report the sha. The
parent worktree commits its own files plus the submodule pointer, also unpushed.
**Basis:** user — the task states sdk changes go on branch `chat`, unpushed, with
the sha reported, because the human sequences sdk-then-pointer.
