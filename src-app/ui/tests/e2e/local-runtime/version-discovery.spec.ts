import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid.ts'
import { gotoRuntimeSettings } from './helpers/local-runtime-helpers'

/**
 * Engine-version DISCOVERY, from the operator's side.
 *
 * The reported defect: `POST /local-runtime/versions/download` requires all
 * five of `{engine, version, platform, arch, backend}` and nothing told a
 * caller what to pass. The reporter only found the valid tag `v0.0.3-alpha` by
 * reading the Rust source; their first attempt used an upstream
 * `ggml-org/llama.cpp` tag and 404'd.
 *
 * These specs assert the operator-facing half of the fix: the version is
 * CHOSEN from a rendered list, never typed. They read the real backend (no
 * `page.route()` mocking — the repo forbids it), which now costs at most one
 * upstream GitHub request per cache TTL rather than one per page mount.
 *
 * The degradation half (feed unreachable / stale cache) is proven by the
 * mounted component harness at
 * `src/modules/llm-local-runtime/components/AvailableVersionsCard.test.tsx` and
 * by the gallery cells `seeded-s3-available-versions-{unreachable,stale-cache}`
 * — making the upstream feed genuinely unreachable from here would mean adding
 * a backend-env seam to the SHARED e2e fixture, which the harness rules forbid.
 */
test.describe('Local Runtime — version discovery', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    await loginAsAdmin(page, testInfra.baseURL)
  })

  /**
   * TEST-10 `[acceptance]` for INV-1 — an admin who has typed nothing sees the
   * installable versions and picks one.
   *
   * The load-bearing assertion is that the version string comes from the
   * RENDERED LIST: the spec reads it off the row rather than hardcoding
   * `v0.0.3-alpha`, so it would fail if the surface stopped telling the
   * operator which versions exist — which is precisely the reported state.
   */
  test('lists installable versions and offers an Install action for each', async ({
    page,
    testInfra,
  }) => {
    await gotoRuntimeSettings(page, testInfra.baseURL)

    const card = byTestId(page, 'llmrt-available-versions-card')
    await expect(card).toBeVisible({ timeout: 30000 })

    // Diagnosability, not a weaker assertion: the row assertions below are
    // unchanged, but on failure Playwright can only say "element(s) not found",
    // which is the same message for a real regression and for GitHub simply
    // being unreachable from the runner. Ask the server what it thinks FIRST so
    // the failure names the actual cause — including a rejected GITHUB_TOKEN,
    // which is the defect this spec exists to catch (the invalid placeholder in
    // `tests/.env.test` used to 401 the discovery call and empty this list).
    const diag = await page.evaluate(async () => {
      const res = await fetch(
        '/api/local-runtime/versions/llamacpp/check-updates',
        { headers: { Accept: 'application/json' } },
      )
      return { status: res.status, body: await res.text() }
    })
    const catalog = diag.status === 200 ? JSON.parse(diag.body) : null
    if (!catalog || (catalog.versions ?? []).length === 0) {
      throw new Error(
        `The release catalogue is empty, so no version rows can render. ` +
          `Server says: HTTP ${diag.status} source=${catalog?.source} ` +
          `credential_status=${catalog?.credential_status} ` +
          `unavailable_reason=${catalog?.unavailable_reason ?? 'none'}. ` +
          `credential_status="rejected" with an empty list means the ` +
          `configured GITHUB_TOKEN was refused AND the anonymous fallback ` +
          `also failed; "absent" means GitHub itself was unreachable.`,
      )
    }

    // Rows are `llmrt-version-row-<version>`; at least one must exist, and its
    // version must be discoverable from the DOM without prior knowledge.
    const rows = card.locator('[data-testid^="llmrt-version-row-"]')
    await expect(rows.first()).toBeVisible({ timeout: 30000 })

    const firstRowTestId = await rows
      .first()
      .getAttribute('data-testid')
    expect(firstRowTestId).toBeTruthy()
    const version = firstRowTestId!.replace('llmrt-version-row-', '')
    expect(version.length).toBeGreaterThan(0)

    // The operator CHOOSES it — there is an Install control on the row. No
    // free-text version field is involved anywhere on this surface.
    await expect(
      byTestId(card, `llmrt-version-install-${version}`),
    ).toBeVisible()

    // The size is shown before committing to a download, so the choice is
    // informed (a CPU build and a CUDA build differ by ~275 MB).
    await expect(rows.first()).toContainText(/\d+(\.\d+)?\s*(B|KB|MB|GB)/i)

    // The card must never present the unreachable state while it is happily
    // listing versions — the two are mutually exclusive by construction, and
    // conflating them is the defect the degradation vocabulary exists to fix.
    await expect(byTestId(page, 'llmrt-available-unreachable')).toHaveCount(0)
  })

  /**
   * TEST-25 — the release-catalogue TTL is an admin setting: it persists across
   * a reload, and an out-of-bounds value is refused visibly.
   *
   * Rejection and happy path are in ONE spec so the refusal cannot pass merely
   * because the form is broken.
   */
  test('release-catalogue cache TTL persists, and an out-of-bounds value is refused', async ({
    page,
    testInfra,
  }) => {
    await gotoRuntimeSettings(page, testInfra.baseURL)

    const field = byTestId(page, 'llmrt-config-release-cache-ttl')
    await expect(field).toBeVisible({ timeout: 30000 })

    // --- happy path: an in-bounds value saves and survives a reload ---------
    await field.fill('')
    await field.fill('900')
    await byTestId(page, 'llmrt-runtime-config-card')
      .getByRole('button', { name: /save/i })
      .click()

    await page.reload()
    await page.waitForLoadState('load')
    const reloaded = byTestId(page, 'llmrt-config-release-cache-ttl')
    await expect(reloaded).toBeVisible({ timeout: 30000 })
    await expect(reloaded).toHaveValue('900')

    // --- rejection: below the 60s floor is refused, and the stored value is
    //     NOT replaced (a refusal that silently saved would be worse than none)
    await reloaded.fill('')
    await reloaded.fill('10')
    await byTestId(page, 'llmrt-runtime-config-card')
      .getByRole('button', { name: /save/i })
      .click()

    await page.reload()
    await page.waitForLoadState('load')
    const afterReject = byTestId(page, 'llmrt-config-release-cache-ttl')
    await expect(afterReject).toBeVisible({ timeout: 30000 })
    await expect(afterReject).toHaveValue('900')
  })
})
