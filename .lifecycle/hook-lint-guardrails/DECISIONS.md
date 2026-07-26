# DECISIONS — `lint:hooks`

Every human/product input the implementation needs, resolved up front. Zero
markers remain. All of these are TOOLING/implementation choices resolvable by
codebase convention — none is a product choice about what the app should DO, so
none is escalated as a picker (Phase-4 rule / B8).

### DEC-1: Custom AST script, a Biome rule, or a new toolchain (eslint + react-hooks)?
**Resolution:** A custom TypeScript-compiler-API script, `scripts/lint-hooks.mjs`,
gated in `npm run check`.
**Basis:** convention — the repo's three existing source guardrails are exactly
this (`scripts/lint-icon-action.mjs` C11, `scripts/lint-native-scroll.mjs` J8,
`sdk/.../logical-direction.mjs` N1). Biome cannot express either rule: H2 needs a
cross-file registry of which identifiers are store proxies, and Biome's
`useHookAtTopLevel` is not enabled anywhere in `biome.base.json` (and could not see
H2 regardless, since a proxy read is a property access, not a `use*()` call).
Introducing eslint for one rule would add a second lint toolchain — explicitly
out of bounds per the brief.

### DEC-2: ziee-local (`src-app/ui/scripts/`) or shared (`sdk/packages/config/src/lint/`)?
**Resolution:** ziee-local this round; the sdk is documented in the script header
as the natural long-term home for H2.
**Basis:** codebase + hard constraint — `sdk` is a git **submodule** pinned to
`sdk/agent-core-and-perf`. A lint committed there would make this branch point at
an unpushed submodule commit, i.e. un-landable, and this round is explicitly
no-push. The ziee-local precedent (`lint-icon-action.mjs`, `lint-native-scroll.mjs`)
is live and wired into both `check` chains, so this is a supported home, not a
workaround. H2 encodes a property of the SDK's store-kit
(`sdk/packages/framework/src/stores.ts`), so promotion is the right eventual move
and is a mechanical file move (the script's only dependency is `typescript`).

### DEC-3: One implementation + relative cross-workspace call, or a byte-identical copy per workspace?
**Resolution:** A byte-identical **copy in both workspaces**
(`src-app/ui/scripts/lint-hooks.mjs` and `src-app/desktop/ui/scripts/lint-hooks.mjs`),
with a byte-identity drift-guard assertion in the desktop test suite.
**Basis:** convention — this is exactly how `lint-icon-action.mjs` and
`lint-native-scroll.mjs` already live in this repo, and the desktop workspace has a
standing parity contract (`src/dev/guardrails/guardrail-parity.test.ts` asserts the
desktop `check` chain owns each gate, and `detector-acceptance.test.ts` asserts the
desktop copies exist and are byte-faithful). A relative cross-workspace call would
break that contract. The drift risk the duplication creates is closed by the
byte-identity assertion (the same device the repo already uses for the geometry
detector).
*(Supersedes the "single implementation" leaning recorded in PLAN_AUDIT's breakage
section, which was written before the desktop parity contract was found.)*

### DEC-4: How does a byte-identical copy scan the right roots from two different directories?
**Resolution:** Candidate-relative-root list filtered by existence:
`['../src', '../../desktop/ui/src', '../../../ui/src']` resolved against the
script's own dir, de-duplicated, non-existent dropped.
**Basis:** codebase — from `src-app/ui/scripts` this yields `ui/src` +
`desktop/ui/src`; from `src-app/desktop/ui/scripts` it yields `desktop/ui/src` +
`ui/src`. Both copies therefore scan BOTH roots, which matters because a desktop
component reads proxies defined in the web workspace (`Chat` in
`ConversationMountsControl`) — the existing `lint-icon-action.mjs` copy has a
stale `../../desktop/ui/src` in its desktop copy that resolves nowhere, and this
avoids inheriting that bug.

### DEC-5: How is a "store proxy" identified without a type checker?
**Resolution:** A two-factor test — (1) the binding is imported from a store-module
specifier (`…/stores/…`, `…/store`, `*.store`, `@ziee/framework/stores`) AND (2) its
original exported name is in a registry built by scanning the roots for
`export const X = registerLazyStore|registerStore|defineStore|defineLocalStore|createStoreProxy|createNotificationsStore(…)`
or `= <Ident>.store`.
**Basis:** codebase — measured on the tree: 297 proxy names, and the two-factor test
is load-bearing rather than defensive, because `EditLlmModelDrawer` is BOTH a store
proxy export and a component name. A `ts.Program` + checker would be exact but costs
a full type-check per lint run inside `check` (which already runs `tsc` separately);
the registry approach is O(parse) and dependency-free.

### DEC-6: Does H1 (plain `use*()` calls) also flag `after-early-return`?
**Resolution:** **No** — H1 covers `ternary-branch`, `logical-rhs`, `if-body`,
`loop-body`, `switch-case` only. H2 (proxy reads) DOES include
`after-early-return`.
**Basis:** measured — including it in H1 fires on **20 pre-existing sites** (the
type-guard idiom: `if (!('file' in props)) return null` followed by hooks, in the
pdf/web file viewers etc.), which would make INV-3 unreachable without an unrelated
20-site refactor, and it is the standard `rules-of-hooks` rule's own territory. For
H2 the same context fires on exactly **3** sites, all genuine instances of the
shipped bug class, all fixed here (ITEM-11/12/13). The asymmetry is deliberate and
documented in DESIGN §3 + PLAN `## Non-goals`, not a silent narrowing.

### DEC-7: Are hook calls / proxy reads inside `.map()` (and other callbacks) in scope?
**Resolution:** No. The conditional walk stops at the nearest enclosing function
boundary, so a callback body is out of scope for these two rules.
**Basis:** convention — "reactive-read-in-loop" is already a named, separate audit
angle in the feature-lifecycle roster with its own remediation idiom
(`7bb34e223` "component-per-extension", the `.$` snapshot rule), and folding it in
would change the FP profile of a gate whose whole value proposition is zero FPs.
Recorded as an explicit non-goal, not an omission.

### DEC-8: `lifecycle-check` A1 fails (8 feature dirs) — remove the strays?
**Resolution:** No. Leave them; record the condition.
**Basis:** codebase — `git ls-tree -d origin/feat/agent-core .lifecycle/` shows the
7 other dirs already exist on the BASE branch (they are stripped at the merge to
main, not at a merge to `feat/agent-core`). Deleting them would put an unrelated
7-feature deletion into this diff. Every gate below is therefore read as "the
phase-specific check is green; A1 is inherited from the base".

### DEC-9: ITEM-13 (desktop `ConversationMountsControl`) has no render-level test — block on adding one?
**Resolution:** No. Cover it with the lint regression (TEST-3), desktop `tsc` via
`npm run check`, and the module-level e2e `host-mount.spec.ts` (TEST-12); record
the gap explicitly.
**Basis:** codebase — the control is rendered only through a desktop
conversation-extension slot; it has no gallery entry and no e2e reaches it today,
and the workspace has no React render-test harness (`@testing-library/react` is not
a dependency in any workspace). Adding either a gallery entry (which then pulls in
`check:gallery-coverage` + `check:state-matrix` obligations and a seeded
conversation cassette) or a new render-test dependency is strictly larger than the
3-line hoist it would guard. The change is a pure hoist of an object read above an
early return, with the indexing expression unchanged, and it is compile-checked.

### DEC-10: What is the escape hatch for a genuinely-stable conditional?
**Resolution:** An inline `hook-order-ok` marker on the offending line or the line
immediately above, which must carry a reason. Ships with **zero** uses — all five
current violations are fixed, not suppressed.
**Basis:** convention — mirrors `rtl-ok` (N1 logical-direction lint) and
`data-allow-custom-color` / `data-allow-icon`. A gate with no escape hatch gets
disabled wholesale the first time it is genuinely wrong; a gate whose escape hatch
is used zero times at introduction is honest about the current state.

### DEC-11: Should the lint be advisory (warn) or gating (exit non-zero)?
**Resolution:** Gating — exit 1 on any finding, wired into `check`.
**Basis:** convention + the brief — every peer guardrail in the `check` chain is
gating (`lint:colors`, `lint:icon-action`, `lint:logical-direction`), and INV-4
requires that a reintroduction fails the build. Both bugs shipped as user-facing
crashes; an advisory line in a 20-step chain would not have stopped them.

### DEC-12: Is the fixture a hand-written snippet or the real historical code?
**Resolution:** Both, with different jobs. The `__detector_fixtures__/*.tsx` files
are self-contained known-bad instances for the detector-acceptance harness (they
must be `tsc`-valid and workspace-agnostic, so they carry their own fixture store
module). The **acceptance tests** (TEST-1/TEST-2) instead run the lint over the
VERBATIM pre-fix files extracted from git (`649ae7180^`, `57f9fdb5b^`).
**Basis:** D2 — a fixture I author can drift into "whatever my implementation
happens to catch"; the historical source cannot. Both bugs' pre-fix blobs are
ancestors of this branch, so the extraction is reproducible forever.

### DEC-13: Configurable settings introduced?
**Resolution:** None. This feature introduces no runtime tunable — no resource
limit, retention, quota, concurrency cap, feature toggle, model selection, or
threshold. The only knobs are build-time CLI flags on a lint script (`--root=`) and
a source-level opt-out marker (DEC-10), neither of which is an operational setting.
**Basis:** convention — the Phase-4 configurable-settings rule applies to
server-side operational tunables (`code_sandbox_settings` / `session_settings`
pattern); a developer-tooling lint has no deployment-time audience.
