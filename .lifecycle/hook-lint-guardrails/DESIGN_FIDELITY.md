# DESIGN_FIDELITY — plan vs `.lifecycle/hook-lint-guardrails/DESIGN.md`

One verdict per invariant declared in PLAN.md `## Invariants`.

- **INV-1** — fidelity: UPHELD — ITEM-2 flags ANY `/^use[A-Z]/` call in a conditional-evaluation context, not just `usePermission`, exactly as the design's §3 H1 requires; the two expression contexts that produced BUG-A (`logical-rhs`, `ternary-branch`) are both in the set. The design's own carve-out (`after-early-return` excluded from H1, DESIGN §3) is carried over verbatim rather than silently widened or narrowed. Pinned by TEST-1 (`[acceptance]`), whose fixture is the pre-fix `EnableSection` line copied verbatim from `649ae7180^`, so the test would fail if H1 were narrowed back to a `usePermission`-only special case.

- **INV-2** — fidelity: UPHELD — ITEM-3 + ITEM-4 implement the design's §3 H2 in full: all SIX contexts (including `after-early-return`, which H2 keeps and H1 drops), the five hook-free specials, the action-suppression registry, and the two-factor proxy identification. Nothing in the plan reduces H2 to "the `LlmProvider.providers` case". Pinned by TEST-2 (`[acceptance]`), whose fixture is the pre-fix `EditLlmModelDrawer` ternary copied verbatim from `57f9fdb5b^`.

- **INV-3** — fidelity: UPHELD — the design's §5 blast-radius table (5 real findings) is turned into five explicit plan items (ITEM-9..13) rather than being discharged by an allowlist or by narrowing the rule. This is the invariant most at risk of being reframed ("suppress the 5 and declare zero"), so the plan deliberately spends five items fixing real code. Pinned by TEST-3 (`[acceptance]`), which runs the real lint over both live roots and asserts exactly zero findings.

- **INV-4** — fidelity: UPHELD — ITEM-7 wires `lint:hooks` into the `check` chain of BOTH touched workspaces (`src-app/ui` and `src-app/desktop/ui`), matching how every other gating lint is wired. B6 is satisfied by construction: the lint's only inputs are the two `src` roots and its own fixture-dir exclusion — it reads nothing from `.lifecycle/`, so it keeps passing after the merge strip. Pinned by TEST-4 (`[acceptance]`), which asserts a reintroduced bug makes the wired `check` step exit non-zero.

## Standing debts carried into implementation

None `AT-RISK`, none `DROPPED`. Two design-level scope boundaries are recorded as
explicit decisions rather than silent gaps: `after-early-return` for plain hook
calls (DEC-6) and callback/`.map()` boundaries (DEC-7). Both are stated in
DESIGN §3 / PLAN `## Non-goals`, so neither is a reframing of an invariant.
