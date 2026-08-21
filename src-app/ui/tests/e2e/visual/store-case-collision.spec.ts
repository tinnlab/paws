/**
 * TEST-9 — the RUNTIME half of the component/store case-collision fix.
 *
 * 24 store directories used to sit beside their component differing only in the
 * first letter's case (`EditUserDrawer.tsx` vs `editUserDrawer/`). Because both TS
 * and the desktop resolver probe EXTENSIONS before `dir/index.ts`, a
 * case-insensitive filesystem (macOS, Windows) resolved the STORE specifier to the
 * COMPONENT file. They now live under a `stores/` parent.
 *
 * `tsc` proves the specifiers still RESOLVE. It cannot prove WHAT they resolve to at
 * runtime, nor that `appLayout`'s module-scope `appLayoutSeam.set(...)` side effect
 * still fires. This spec does both, in a real browser:
 *
 *   1. every relocated store module is imported and asserted to be a STORE module —
 *      it must NOT export its component's name as a React component (which is
 *      exactly what a case-collided resolve returns);
 *   2. every relocated store that backs a gallery overlay is OPENED through its own
 *      store action and the drawer is asserted to render.
 *
 * Backend-free: runs against the gallery Vite server (playwright.visual.config.ts).
 */
import { expect, test } from '@playwright/test'
import { openGallery } from './_gallery'

/**
 * The 24 store directories this branch relocated, as paths relative to
 * `src-app/ui/src`. Enumerated explicitly: this list IS the claim under test, so
 * deriving it from the filesystem at runtime would make the spec agree with
 * whatever the tree happens to contain.
 *
 * These double as dev-server URLs: `vite.config.ts` sets `root: 'src'`, so
 * `src/modules/x` is served at `/modules/x` (NOT `/src/modules/x` — that 404s).
 */
const RELOCATED_STORES = [
  'modules/hub/modules/llm-models/components/stores/modelDetailsDrawer',
  'modules/hub/modules/mcp/components/stores/mcpServerDetailsDrawer',
  'modules/layouts/app-layout/stores/appLayout',
  'modules/llm-provider/components/stores/groupLlmProvidersAssignmentDrawer',
  'modules/llm-provider/components/stores/llmProviderDrawer',
  'modules/llm-provider/components/stores/providerGroupAssignmentCard',
  'modules/llm-provider/widgets/stores/llmProviderGroupWidget',
  'modules/mcp/components/system/stores/groupSystemMcpServersAssignmentDrawer',
  'modules/mcp/components/system/stores/mcpServerGroupsAssignmentCard',
  'modules/mcp/widgets/stores/groupSystemMcpServersWidget',
  'modules/onboarding/guides/getting-started/components/stores/apiKeysStep',
  'modules/onboarding/guides/getting-started/components/stores/mcpServersStep',
  'modules/onboarding/guides/getting-started/components/stores/memorySetupStep',
  'modules/skill/widgets/stores/groupSystemSkillsAssignmentDrawer',
  'modules/skill/widgets/stores/groupSystemSkillsWidget',
  'modules/user/components/group/stores/editUserGroupDrawer',
  'modules/user/components/group/stores/groupMembersDrawer',
  'modules/user/components/user/stores/assignGroupDrawer',
  'modules/user/components/user/stores/createUserDrawer',
  'modules/user/components/user/stores/editUserDrawer',
  'modules/user/components/user/stores/resetPasswordDrawer',
  'modules/user/components/user/stores/userGroupsDrawer',
  'modules/workflow/widgets/stores/groupSystemWorkflowsAssignmentDrawer',
  'modules/workflow/widgets/stores/groupSystemWorkflowsWidget',
] as const

/**
 * The relocated stores that back a gallery overlay, as `slug`s the gallery opens via
 * `?surface=<slug>&state=open` — which calls the entry's `open()`, i.e. the STORE's
 * own action (`EditUserDrawer.openEditUserDrawer(user)` and friends).
 *
 * The other 10 relocated stores back pages/widgets rather than overlays; they are
 * covered by clause 1 above and by the gallery runtime-health pass in `gate:ui`.
 *
 * `overlay-hub-model-details-drawer` and `overlay-hub-mcp-details-drawer` are
 * deliberately EXCLUDED. Their gallery entries render the component with **no
 * props** (`component: lazyNamed(() => import('…/ModelDetailsDrawer'), …)`), and
 * both components begin `if (!model) return null` / `if (!server) return null` —
 * so nothing mounts no matter what the store says. That is a pre-existing gallery
 * defect (contrast the sibling `overlay-hub-assistant-details-drawer`, which passes
 * `{ open: true, onClose, assistant }` explicitly); neither component file is
 * touched by this branch. Fixing those entries is out of scope here. Both stores
 * are still covered by clause 1.
 */
const OVERLAY_SLUGS = [
  'overlay-create-user-drawer',
  'overlay-edit-user-drawer',
  'overlay-reset-password-drawer',
  'overlay-edit-user-group-drawer',
  'overlay-assign-group-drawer',
  'overlay-user-groups-drawer',
  'overlay-group-members-drawer',
  'overlay-llm-provider-drawer',
  'overlay-group-llm-providers-assignment',
  'overlay-group-mcp-servers-assignment',
  'overlay-group-skills-assignment',
  'overlay-group-workflows-assignment',
] as const

/**
 * The control target for clause 1: a real component module. Passed in as a VARIABLE
 * rather than written as a literal `import('…')`, so TypeScript treats it as a
 * runtime path (the gallery's Vite dev server resolves it) instead of trying to
 * resolve `/src/…` against the tsconfig at compile time.
 */
const CONTROL_COMPONENT = '/modules/user/components/user/EditUserDrawer.tsx'

test.describe('store case-collision fix', () => {
  test('every relocated store path resolves to the STORE module, not its component', async ({
    page,
  }) => {
    await openGallery(page, 'light', 'blue')

    const results = await page.evaluate(async (paths: readonly string[]) => {
      const out: { path: string; ok: boolean; exports: string[]; kind: string; error?: string }[] = []
      for (const p of paths) {
        try {
          const mod: Record<string, unknown> = await import(/* @vite-ignore */ `/${p}/index.ts`)
          const name = p.split('/').pop() as string
          const pascal = name[0].toUpperCase() + name.slice(1)
          out.push({
            path: p,
            ok: true,
            exports: Object.keys(mod),
            kind: pascal in mod ? typeof mod[pascal] : 'absent',
          })
        } catch (e) {
          out.push({
            path: p,
            ok: false,
            exports: [],
            kind: 'error',
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
      return out
    }, RELOCATED_STORES as unknown as string[])

    expect(results).toHaveLength(RELOCATED_STORES.length)

    for (const r of results) {
      // It must load at all — a broken specifier fails here.
      expect(r.ok, `${r.path} failed to import: ${r.error}`).toBe(true)
      expect(r.exports.length, `${r.path} exported nothing`).toBeGreaterThan(0)

      // The discriminator. A store's `registerLazyStore(...)` proxy is built over a
      // plain object (`new Proxy({}, …)`), so it is an OBJECT. The sibling component
      // exports the same PascalCase name as a FUNCTION. If the specifier had
      // case-collided onto `EditUserDrawer.tsx`, this would read 'function'.
      expect(
        r.kind,
        `${r.path} resolved to a React component — the case collision is back (exports: ${r.exports.join(', ')})`,
      ).not.toBe('function')

      // And a store module never has a default export; a lazily-imported component
      // module frequently does.
      expect(r.exports, `${r.path} has a default export — that is a component module`).not.toContain(
        'default',
      )
    }

    // Positive control: the SAME assertion, aimed at a real component module, must
    // see 'function'. Without this, "not a function" would pass for any path that
    // simply failed to expose the symbol, and the check above would be vacuous.
    const control = await page.evaluate(async (specifier: string) => {
      const mod: Record<string, unknown> = await import(/* @vite-ignore */ specifier)
      return typeof mod.EditUserDrawer
    }, CONTROL_COMPONENT)
    expect(
      control,
      'the control component module must expose EditUserDrawer as a function, or this test proves nothing',
    ).toBe('function')
  })

  for (const slug of OVERLAY_SLUGS) {
    test(`overlay opens through its relocated store action: ${slug}`, async ({ page }) => {
      const pageErrors: string[] = []
      page.on('pageerror', e => pageErrors.push(e.message))
      page.on('console', m => {
        if (m.type() === 'error') pageErrors.push(m.text())
      })

      await page.goto(`/gallery.html?surface=${slug}&state=open&theme=light`)
      await page.getByTestId('gallery-root').waitFor({ state: 'visible' })

      // The overlay's content is portaled out of the gallery canvas. Its presence is
      // the proof that the entry's `open()` — a call into the relocated STORE —
      // actually ran: a component module exposes no such action, so `open()` would
      // have thrown and nothing would be mounted.
      const dialog = page
        .locator('[role="dialog"]:not([data-testid="gallery-root"] *)')
        .filter({ visible: true })
        .first()
      await expect(dialog).toBeVisible({ timeout: 15_000 })

      expect(
        pageErrors.filter(e => /Cannot read|is not a function|undefined|Failed to fetch dynamically/i.test(e)),
        `${slug} raised a module/resolution error: ${pageErrors.join(' | ')}`,
      ).toEqual([])
    })
  }
})
