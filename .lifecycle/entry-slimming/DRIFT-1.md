# DRIFT-1 — entry-slimming (implementation vs plan)

Audit of the implemented diff against PLAN/DECISIONS. Each divergence reconciled.

- **DRIFT-1.1** — verdict: impl-wins — ITEM-2's react-icons importer set was WIDER than the plan's `src-app/ui` list: the app-wide Drawer primitive is `@ziee/shell/components/Drawer` (`sdk/packages/shell/src/components/Drawer.tsx`), consumed via the `layouts/app-layout/components/Drawer.tsx` shim, and it statically imported `react-icons/io`. Two `resolve.dedupe` lists also named react-icons. To actually eliminate react-icons (uninstall it + drop it from the entry sourcemap) these had to be swapped/cleaned too. PLAN.md *Files to touch* was amended to add `sdk/packages/shell/src/components/Drawer.tsx`, `sdk/packages/shell/package.json`, `src-app/desktop/ui/vite.config.ts` (dedupe), and `src-app/ui/tests/global-setup.ts` (dedupe). The swap is the same trivial `IoIosArrowBack → ChevronLeft` change; low-risk. Resolved.

- **DRIFT-1.2** — verdict: impl-wins — DEC-2 mapped `GoSidebarCollapse`/`GoSidebarExpand` → `PanelLeftClose`/`PanelLeftOpen` at 1em. During implementation the WEB sibling `SidebarToggleButton.tsx` was found already migrated to lucide using `PanelLeft`/`PanelRight` + `className="size-5"` (with a comment that lucide doesn't scale with fontSize). Precedent-fidelity wins: the desktop twin `SidebarToggleButton.desktop.tsx` now mirrors the web sibling EXACTLY (`PanelRight` when collapsed, `PanelLeft` when open, `size-5`) rather than a divergent variant. DEC-8's other mappings unaffected. Resolved.

- **DRIFT-1.3** — verdict: none — the desktop production `vite build` fails on the UNTOUCHED base with 5 pre-existing `loader.desktop.ts` MISSING_EXPORT errors (see INFRA_INTEGRATION.md), so ITEM-1's desktop vendor chunk is validated by construction (a byte-identical mirror of the working, verified UI config) rather than by a full green desktop build. This is a reality constraint (Category-A pre-existing failure), not a plan divergence; the plan intent (mirror the vendor split to desktop) is fully implemented. No plan change needed.

**Unresolved drifts:** 0
