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
 * runtime. This spec does, in a real browser, two ways:
 *
 *   1. every relocated store is imported through a BARE directory specifier — the
 *      exact shape the bug lives in, so Vite performs the same extension-probe-then-
 *      `/index` walk the compiler does — and the resulting module is asserted to be
 *      the STORE and not its sibling component, per store, against that component's
 *      own exports;
 *   2. every relocated store that backs a gallery overlay is OPENED through its own
 *      store action, and the drawer that renders is asserted to be the RIGHT one.
 *
 * Backend-free: runs against the gallery Vite server (playwright.visual.config.ts),
 * and listed in `gallery.config.json`'s `visualSpecs` so `gate:ui` runs it.
 *
 * Note on what this spec canNOT do: it runs on whatever filesystem CI gives it, and
 * on a case-SENSITIVE one a collision cannot reproduce at all. Clause 1 is a
 * module-identity assertion, not a case-sensitivity simulation. The only true oracle
 * for the macOS behaviour is a macOS build; `lint-case-collisions.mjs` is what keeps
 * the shape from returning in between.
 */
import { expect, test } from '@playwright/test'
import { openGallery } from './_gallery'

/**
 * The 24 store directories this branch relocated, each paired with the component it
 * sits beside. Enumerated explicitly: the PAIRING is the claim under test, so
 * deriving it at runtime would make the spec agree with whatever the tree contains.
 *
 * These double as dev-server URLs: `vite.config.ts` sets `root: 'src'`, so
 * `src/modules/x` is served at `/modules/x` (NOT `/src/modules/x` — that 404s).
 * The store paths carry NO `/index.ts` suffix on purpose — see clause 1.
 */
const RELOCATED = [
  { store: 'modules/hub/modules/llm-models/components/stores/modelDetailsDrawer', component: 'modules/hub/modules/llm-models/components/ModelDetailsDrawer.tsx' },
  { store: 'modules/hub/modules/mcp/components/stores/mcpServerDetailsDrawer', component: 'modules/hub/modules/mcp/components/McpServerDetailsDrawer.tsx' },
  { store: 'modules/layouts/app-layout/stores/appLayout', component: 'modules/layouts/app-layout/AppLayout.tsx' },
  { store: 'modules/llm-provider/components/stores/groupLlmProvidersAssignmentDrawer', component: 'modules/llm-provider/components/GroupLlmProvidersAssignmentDrawer.tsx' },
  { store: 'modules/llm-provider/components/stores/llmProviderDrawer', component: 'modules/llm-provider/components/LlmProviderDrawer.tsx' },
  { store: 'modules/llm-provider/components/stores/providerGroupAssignmentCard', component: 'modules/llm-provider/components/ProviderGroupAssignmentCard.tsx' },
  // The one pair whose component is not the store name in PascalCase (LLM, not Llm).
  { store: 'modules/llm-provider/widgets/stores/llmProviderGroupWidget', component: 'modules/llm-provider/widgets/LLMProviderGroupWidget.tsx' },
  { store: 'modules/mcp/components/system/stores/groupSystemMcpServersAssignmentDrawer', component: 'modules/mcp/components/system/GroupSystemMcpServersAssignmentDrawer.tsx' },
  { store: 'modules/mcp/components/system/stores/mcpServerGroupsAssignmentCard', component: 'modules/mcp/components/system/McpServerGroupsAssignmentCard.tsx' },
  { store: 'modules/mcp/widgets/stores/groupSystemMcpServersWidget', component: 'modules/mcp/widgets/GroupSystemMcpServersWidget.tsx' },
  { store: 'modules/onboarding/guides/getting-started/components/stores/apiKeysStep', component: 'modules/onboarding/guides/getting-started/components/ApiKeysStep.tsx' },
  { store: 'modules/onboarding/guides/getting-started/components/stores/mcpServersStep', component: 'modules/onboarding/guides/getting-started/components/McpServersStep.tsx' },
  { store: 'modules/onboarding/guides/getting-started/components/stores/memorySetupStep', component: 'modules/onboarding/guides/getting-started/components/MemorySetupStep.tsx' },
  { store: 'modules/skill/widgets/stores/groupSystemSkillsAssignmentDrawer', component: 'modules/skill/widgets/GroupSystemSkillsAssignmentDrawer.tsx' },
  { store: 'modules/skill/widgets/stores/groupSystemSkillsWidget', component: 'modules/skill/widgets/GroupSystemSkillsWidget.tsx' },
  { store: 'modules/user/components/group/stores/editUserGroupDrawer', component: 'modules/user/components/group/EditUserGroupDrawer.tsx' },
  { store: 'modules/user/components/group/stores/groupMembersDrawer', component: 'modules/user/components/group/GroupMembersDrawer.tsx' },
  { store: 'modules/user/components/user/stores/assignGroupDrawer', component: 'modules/user/components/user/AssignGroupDrawer.tsx' },
  { store: 'modules/user/components/user/stores/createUserDrawer', component: 'modules/user/components/user/CreateUserDrawer.tsx' },
  { store: 'modules/user/components/user/stores/editUserDrawer', component: 'modules/user/components/user/EditUserDrawer.tsx' },
  { store: 'modules/user/components/user/stores/resetPasswordDrawer', component: 'modules/user/components/user/ResetPasswordDrawer.tsx' },
  { store: 'modules/user/components/user/stores/userGroupsDrawer', component: 'modules/user/components/user/UserGroupsDrawer.tsx' },
  { store: 'modules/workflow/widgets/stores/groupSystemWorkflowsAssignmentDrawer', component: 'modules/workflow/widgets/GroupSystemWorkflowsAssignmentDrawer.tsx' },
  { store: 'modules/workflow/widgets/stores/groupSystemWorkflowsWidget', component: 'modules/workflow/widgets/GroupSystemWorkflowsWidget.tsx' },
] as const

/**
 * The relocated stores that back a gallery overlay, each with a marker that
 * identifies WHICH drawer opened.
 *
 * The markers must be MUTUALLY EXCLUSIVE, and that is asserted below rather than
 * assumed. An earlier version used loose title regexes and was not: `/group/i`
 * matched three different drawers and `/provider/i` matched two, so 8 of 10
 * adversarial cross-pairings passed — i.e. swapping two gallery entries, exactly the
 * "wrong store resolved" outcome this spec exists to catch, would have kept it green.
 * A `data-testid` is used wherever the drawer exposes a stable one.
 *
 * The gallery opens an overlay surface by calling the entry's `open()` — i.e. the
 * STORE's own action (`EditUserDrawer.openEditUserDrawer(user)` and friends). A
 * component module exposes no such action, so a collided specifier would throw and
 * nothing would mount.
 *
 * `overlay-hub-model-details-drawer` and `overlay-hub-mcp-details-drawer` are
 * deliberately EXCLUDED: their gallery entries render the component with **no
 * props**, and both components begin `if (!model) return null` / `if (!server)
 * return null`, so nothing mounts no matter what the store says. That is a
 * pre-existing gallery defect (contrast `overlay-hub-assistant-details-drawer`,
 * which passes `{ open: true, onClose, assistant }`); neither component file is
 * touched by this branch. Both stores are still covered by clause 1.
 */
const OVERLAYS = [
  // Form testids: these render unconditionally inside their drawer.
  { slug: 'overlay-create-user-drawer', testid: 'user-create-form' },
  { slug: 'overlay-edit-user-drawer', testid: 'user-edit-form' },
  { slug: 'overlay-reset-password-drawer', testid: 'user-reset-password-form' },
  { slug: 'overlay-edit-user-group-drawer', testid: 'user-edit-group-form' },
  { slug: 'overlay-assign-group-drawer', testid: 'user-assign-group-form' },
  { slug: 'overlay-group-members-drawer', testid: 'user-group-members-list' },
  { slug: 'overlay-llm-provider-drawer', testid: 'llm-provider-form' },
  // Title text for the five whose only stable testids are CONDITIONAL, so a marker
  // built on them would be a case-collision spec that goes red for an unrelated
  // reason: `user-groups-drawer-list` renders only on the `groups.length > 0` branch,
  // the `*-group-assign-*-btn` pair only inside `{canManage && …}`, and the two
  // assignment cards embed a fixture UUID. A drawer title depends on neither the
  // seeded data nor the seeded permissions.
  { slug: 'overlay-user-groups-drawer', text: 'Groups for' },
  { slug: 'overlay-group-skills-assignment', text: 'Assign System Skills' },
  { slug: 'overlay-group-workflows-assignment', text: 'Assign System Workflows' },
  { slug: 'overlay-group-llm-providers-assignment', text: 'Assign LLM Providers' },
  { slug: 'overlay-group-mcp-servers-assignment', text: 'Assign System MCP Servers' },
] as const

test.describe('store case-collision fix', () => {
  test('every relocated store resolves to the STORE module, not its sibling component', async ({
    page,
  }) => {
    await openGallery(page, 'light', 'blue')

    type Row = {
      store: string
      ok: boolean
      error?: string
      storeExports: string[]
      storeKinds: Record<string, string>
      componentExports: string[]
      componentFns: string[]
    }

    const results: Row[] = await page.evaluate(
      async (pairs: { store: string; component: string }[]) => {
        const out: Row[] = []
        for (const p of pairs) {
          try {
            // BARE directory specifier — no `/index.ts`. This is the whole point:
            // Vite runs the same probe walk the compiler does (`x.ts`, `x.tsx`, …,
            // then `x/index.ts`), which is where the collision used to bite. An
            // explicit `/index.ts` would skip probing entirely and prove nothing
            // about resolution.
            const s: Record<string, unknown> = await import(/* @vite-ignore */ `/${p.store}`)
            const c: Record<string, unknown> = await import(/* @vite-ignore */ `/${p.component}`)
            const storeKinds: Record<string, string> = {}
            for (const k of Object.keys(s)) storeKinds[k] = typeof s[k]
            out.push({
              store: p.store,
              ok: true,
              storeExports: Object.keys(s),
              storeKinds,
              componentExports: Object.keys(c),
              componentFns: Object.keys(c).filter(k => typeof c[k] === 'function'),
            })
          } catch (e) {
            out.push({
              store: p.store,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
              storeExports: [],
              storeKinds: {},
              componentExports: [],
              componentFns: [],
            })
          }
        }
        return out
      },
      RELOCATED as unknown as { store: string; component: string }[],
    )

    expect(results).toHaveLength(RELOCATED.length)

    for (const r of results) {
      expect(r.ok, `${r.store} failed to import: ${r.error}`).toBe(true)
      expect(r.storeExports.length, `${r.store} exported nothing`).toBeGreaterThan(0)

      // The control, applied PER STORE rather than once: the component module must
      // itself expose at least one function export. If it did not, "the store is not
      // the component" would be unfalsifiable for that pair.
      expect(
        r.componentFns.length,
        `${r.store}'s sibling component exports no function — the discriminator below would be vacuous for this pair`,
      ).toBeGreaterThan(0)

      // The discriminator. If the bare specifier had resolved to the component, the
      // two namespaces would be IDENTICAL. Requiring the store to export something
      // the component does not makes that indistinguishable case impossible.
      const onlyInStore = r.storeExports.filter(k => !r.componentExports.includes(k))
      expect(
        onlyInStore,
        `${r.store} exports nothing its component does not — it resolved to the component (store: ${r.storeExports.join(', ')} | component: ${r.componentExports.join(', ')})`,
      ).not.toEqual([])

      // …and where the two DO share a name — which is the norm, since a store
      // deliberately exports its `registerLazyStore` proxy under the component's
      // name — the store's value must not be the component. A proxy is built over a
      // plain object (`new Proxy({}, …)`), so it reads as `object`; the component is
      // a `function`. This is the assertion that would flip if a bare specifier
      // resolved to the `.tsx`.
      for (const fn of r.componentFns) {
        if (!(fn in r.storeKinds)) continue
        expect(
          r.storeKinds[fn],
          `${r.store} exports \`${fn}\` as a React component rather than a store handle — the case collision is back`,
        ).not.toBe('function')
      }
    }
  })

  test('each identity marker appears in ITS drawer and in no other', async ({ page }) => {
    // The property the per-overlay assertions need is "marker M appears in drawer D
    // and nowhere else". An earlier version checked the marker STRINGS against each
    // other — uniqueness and substrings — which is not the same thing and would not
    // notice two drawers that genuinely render the same testid (both assignment
    // drawers come from one shared component via a `testidPrefix` prop, so that is
    // the realistic way this regresses).
    //
    // So: open every drawer and cross-check every marker against it. This is the
    // adversarial pairing the loose regexes failed — 8 of 10 cross-pairings passed
    // then; every off-diagonal cell must fail now.
    const satisfied = async (marker: { testid?: string; text?: string }) => {
      const dialog = page
        .locator('[role="dialog"]:not([data-testid="gallery-root"] *)')
        .filter({ visible: true })
        .first()
      if (marker.testid) return await dialog.getByTestId(marker.testid).first().isVisible().catch(() => false)
      return ((await dialog.textContent().catch(() => '')) ?? '').includes(marker.text as string)
    }

    const crossMatches: string[] = []
    for (const open of OVERLAYS) {
      await page.goto(`/gallery.html?surface=${open.slug}&theme=light`)
      await page.getByTestId('gallery-root').waitFor({ state: 'visible' })
      await page
        .locator('[role="dialog"]:not([data-testid="gallery-root"] *)')
        .filter({ visible: true })
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })

      for (const candidate of OVERLAYS) {
        const hit = await satisfied(candidate)
        if (candidate.slug === open.slug) {
          expect(hit, `${open.slug} does not satisfy its OWN marker — the marker is wrong`).toBe(true)
        } else if (hit) {
          crossMatches.push(`${open.slug} also satisfies ${candidate.slug}'s marker`)
        }
      }
    }
    expect(crossMatches, 'markers must identify exactly one drawer each').toEqual([])
  })

  for (const entry of OVERLAYS) {
    const { slug } = entry
    test(`overlay opens through its relocated store action: ${slug}`, async ({ page }) => {
      const pageErrors: string[] = []
      page.on('pageerror', e => pageErrors.push(e.message))
      page.on('console', m => {
        if (m.type() === 'error') pageErrors.push(m.text())
      })

      // No `&state=open`: `OverlayFrame` fires the entry's `open()` unconditionally
      // and hardcodes `data-gallery-state="open"`, so the param is inert and would
      // read as load-bearing.
      await page.goto(`/gallery.html?surface=${slug}&theme=light`)
      await page.getByTestId('gallery-root').waitFor({ state: 'visible' })

      const dialog = page
        .locator('[role="dialog"]:not([data-testid="gallery-root"] *)')
        .filter({ visible: true })
        .first()
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      // …and it is THIS drawer, not merely some drawer.
      if ('testid' in entry) await expect(dialog.getByTestId(entry.testid)).toBeVisible()
      else await expect(dialog).toContainText(entry.text)

      // Narrow on purpose: a bare `undefined` would match benign gallery mock-API
      // chatter and produce false REDs. These four are the shapes a bad specifier
      // actually produces.
      expect(
        pageErrors.filter(e =>
          /Failed to fetch dynamically imported module|Failed to resolve import|is not a function|Cannot read propert/i.test(
            e,
          ),
        ),
        `${slug} raised a module/resolution error: ${pageErrors.join(' | ')}`,
      ).toEqual([])
    })
  }
})
