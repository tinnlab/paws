# DECISIONS

### DEC-1: How should the AppLayout-seam optional readers behave when the store is genuinely absent — inject the seam eagerly at boot, or degrade gracefully?
**Resolution:** Degrade gracefully via a non-throwing `peek()` returning `null`, with each reader falling back to its store-less default (`nativeScroll: false`, not-collapsed inset, no-op `setHeaderHidden`). Keep the loud `get()` for genuinely boot-critical seams (`routesSeam`, the shell `AppLayout` layout which only renders when injected).
**Basis:** codebase — `DivScrollY`'s existing comment already documents the store-less-context fallback as intended ("in a store-less context … fall back to an empty object rather than crashing"); the throwing `get()` broke that documented contract. Eager injection would require the gallery to import every app-layout injection site into every isolated overlay, which the seam design (O(page-stores), no global registry) deliberately avoids.

### DEC-2: How should the chat-extension → primary-store seed be made race-free — gate the composer harder, or make the seed synchronous?
**Resolution:** Make the register-time seed SYNCHRONOUS (via an IoC accessor the chat store pushes to the registry). The composer (`ChatInput`) ALREADY gates its `text_input` slot on `chatExtensionsReady`; making the seed synchronous makes that existing gate sound (the store is present the instant readiness resolves) rather than adding a second gate.
**Basis:** codebase — `ChatInput` already renders a skeleton until `chatExtensionsReady`; the only defect was the seed lagging that promise by a microtask. The IoC accessor mirrors the existing "SDK/registry reads an app store it cannot statically import" inversion (app-seam, pane runtime resolver). The async `import().then()` fallback is retained for the out-of-order-load edge, and `injectExtensionStores` is idempotent.

### DEC-3: Desktop loader — should it become manifest-driven like the web loader, or provide eager-loader-appropriate no-op router functions?
**Resolution:** Provide eager-loader-appropriate implementations (`ensureModuleForPath`→`false`, `isPathModulePending`→`false`, `isPathModuleForbidden`→`false`, `revalidateForPath`→no-op).
**Basis:** codebase — the desktop build has NO `moduleManifestPlugin` / `virtual:ziee-module-manifest`, so it cannot re-export from `loader.ts`; the desktop loader eagerly registers every core module at boot, so nothing is lazy/in-flight and no route is permission-forbidden for the single auto-logged-in admin. Converting desktop to manifest-driven is a large, out-of-scope refactor; the no-op implementations are correct for the eager model and keep the shared `RouterComponent` import resolving.

### DEC-4: Configurable settings introduced?
**Resolution:** None. This bugfix introduces no operational tunable (no resource limit, retention, quota, toggle, threshold). The only new "value" is a private per-seam boolean-null (`injected`) and eager-loader no-ops — not operator-facing.
**Basis:** convention — nothing here is an admin-configurable knob.

### DEC-5: SDK submodule commit + pointer reconciliation
**Resolution:** Commit the `sdk/packages/framework` + `sdk/packages/shell` edits IN the `sdk` submodule (on its `agent-core-and-perf`-derived branch), bump the pointer in this branch, and NOTE it for the orchestrator: two sibling branches (entry-slimming, e2e-speedup) also carry sdk-submodule commits that must all reconcile onto `sdk/agent-core-and-perf` at merge.
**Basis:** task brief — the sdk submodule is shared; per-branch sdk commits reconcile at merge time.
