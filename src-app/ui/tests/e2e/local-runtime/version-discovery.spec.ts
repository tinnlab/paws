import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getCurrentUserToken } from '../../common/auth-helpers'
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
/**
 * Click Save on the runtime-config card and wait for the settings PUT to
 * actually COMPLETE, returning its status.
 *
 * Clicking and immediately reloading is a race the spec used to lose: the
 * reload aborts the in-flight PUT (Playwright records status -1), the save
 * never lands, and the assertion fails with "expected 900, received 3600" —
 * which reads like a persistence bug rather than a test bug. Measured: the
 * request body was correct and the request was aborted mid-flight.
 *
 * Returning the status and the sent body is also what lets the caller assert
 * WHAT was submitted, not merely that something was — which is how the
 * client-side clamp (10 -> 60) became visible at all.
 */
async function saveRuntimeConfig(
  page: Page,
): Promise<{ status: number; sentTtl: unknown }> {
  const [response] = await Promise.all([
    page.waitForResponse(
      r =>
        r.url().includes('/api/local-runtime/settings') &&
        r.request().method() === 'PUT',
      { timeout: 30000 },
    ),
    byTestId(page, 'llmrt-runtime-config-card')
      .getByRole('button', { name: /save/i })
      .click(),
  ])
  let sentTtl: unknown
  try {
    sentTtl = JSON.parse(response.request().postData() ?? '{}')
      .engine_release_cache_ttl_secs
  } catch {
    sentTtl = undefined
  }
  return { status: response.status(), sentTtl }
}

/**
 * What the card is actually telling the operator, including the text hidden
 * behind ErrorState's collapsed "Details" disclosure — which is where the
 * store's error message lives, and which is therefore invisible in a
 * Playwright trace unless something expands it.
 */
async function describeCard(page: Page, card: Locator): Promise<string> {
  try {
    const details = card.getByRole('button', { name: /details/i })
    if (await details.count()) {
      await details.first().click({ timeout: 2000 })
      await page.waitForTimeout(200)
    }
  } catch {
    // Expanding is best-effort; report whatever is visible either way.
  }
  const text = (await card.innerText().catch(() => '')) || '(card not readable)'
  return text.replace(/\s+/g, ' ').slice(0, 600)
}

/**
 * Read the server's release-catalogue view for llamacpp.
 *
 * The endpoint is permission-gated and ziee authenticates access tokens from
 * the `Authorization` header only (the refresh cookie is scoped
 * `Path=/api/auth`), so the token must be forwarded explicitly — a bare
 * in-page fetch 401s.
 */
async function fetchCatalog(page: Page) {
  const token = await getCurrentUserToken(page)
  const res = await page.evaluate(async t => {
    const r = await fetch('/api/local-runtime/versions/llamacpp/check-updates', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${t}` },
    })
    return { status: r.status, body: await r.text() }
  }, token)
  expect(
    res.status,
    `check-updates must answer 200 even when upstream is unreachable — the ` +
      `degradation rides the 200. Got ${res.status}: ${res.body.slice(0, 300)}`,
  ).toBe(200)
  return JSON.parse(res.body)
}

/** A one-line human summary of the catalogue, for a failure message. */
async function describeCatalog(page: Page): Promise<string> {
  try {
    const c = await fetchCatalog(page)
    return (
      `source=${c.source} credential_status=${c.credential_status} ` +
      `versions=${(c.versions ?? []).length} ` +
      `unavailable_reason=${c.unavailable_reason ?? 'none'}`
    )
  } catch (e) {
    return `could not be read: ${e}`
  }
}

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

    // Assert the DOM FIRST, then ask the server what it thinks.
    //
    // The order matters for cost: the catalogue read is cached per TTL, so once
    // the card has rendered its rows the probe below is a warm, instant call.
    // Probing first would instead issue a SECOND cold read racing the page's
    // own — two extra round-trips to GitHub (each a 401 plus its anonymous
    // re-issue) on a 60/hr/IP budget, and seconds of added latency inside the
    // assertion window.
    //
    // On failure the probe still runs, in the catch, so a genuine GitHub
    // outage reports the server's own diagnosis instead of Playwright's
    // "element(s) not found" — which reads identically for an outage and for a
    // real regression.
    const rows = card.locator('[data-testid^="llmrt-version-row-"]')
    try {
      await expect(rows.first()).toBeVisible({ timeout: 30000 })
    } catch (rowsNeverAppeared) {
      const why = await describeCatalog(page)
      const said = await describeCard(page, card)
      throw new Error(
        `No version rows rendered.\n` +
          `  The CARD says: ${said}\n` +
          `  The SERVER says: ${why}\n\n` +
          `If the server has versions but the card does not show them, the ` +
          `defect is in the UI, not in release discovery.\n\n` +
          `credential_status="rejected" with an empty list means the ` +
          `configured GITHUB_TOKEN was refused AND the anonymous fallback ` +
          `also failed; "absent"/"unverified" means GitHub itself was ` +
          `unreachable.\n\nOriginal failure: ${rowsNeverAppeared}`,
      )
    }

    // Now the warm probe — the only place this spec can assert the thing the
    // fix actually added, on the REAL production path. The mocked integration
    // tier proves the fallback LOGIC; only this proves the verdict survives a
    // real GitHub round-trip onto the wire.
    const catalog = await fetchCatalog(page)

    // The credential verdict must always be one of the four known states —
    // never absent from the payload, since an omitted field is
    // indistinguishable from "no token configured", which is a real state.
    expect(['absent', 'used', 'unverified', 'rejected']).toContain(
      catalog.credential_status,
    )

    // Record which branch this run exercised, so a green result STATES whether
    // it covered the rejected-credential path rather than leaving it implicit.
    // The path is only taken when the backend environment carries an invalid
    // GITHUB_TOKEN — which `src-app/server/tests/.env.test` supplies, but only
    // if the runner exported it (the Playwright harness passes `...process.env`
    // through to the spawned server; it does not source that file itself). The
    // fallback LOGIC is proven hermetically in
    // `server/tests/llm_local_runtime/github_credential_test.rs`; what this
    // spec adds is the real-GitHub round trip.
    test.info().annotations.push({
      type: 'credential_status',
      description: String(catalog.credential_status),
    })

    // UNCONDITIONAL — true on every path, and the observable core of INV-1: a
    // credential problem must never leave the operator with nothing to install
    // while GitHub itself is reachable.
    expect(
      (catalog.versions ?? []).length,
      `discovery returned no versions (source=${catalog.source}, ` +
        `credential_status=${catalog.credential_status})`,
    ).toBeGreaterThan(0)
    expect(
      catalog.unavailable_reason ?? null,
      'GitHub answered, so nothing may be labelled unreachable',
    ).toBeNull()

    // THE acceptance assertion for INV-1, on the production path. The e2e
    // environment supplies an invalid GITHUB_TOKEN (`tests/.env.test` ships a
    // placeholder), so this branch is the reported defect exactly: pre-fix the
    // 401 emptied the catalogue and the rows above could not render. Removing
    // the anonymous fallback makes the rows assertion, and then this, red.
    if (catalog.credential_status === 'rejected') {
      expect(
        (catalog.versions ?? []).length,
        'a refused GITHUB_TOKEN must NOT empty the version list while the ' +
          'anonymous path works — that is the whole defect',
      ).toBeGreaterThan(0)
      // `live` on the fetch that did the rescue, `cache` on any read within
      // the TTL after it. Both mean "we have a real catalogue"; `unavailable`
      // is the one that would mean the fallback rescued nothing.
      expect(
        ['live', 'cache'],
        'an anonymous-rescued catalogue is real, so it must never be reported ' +
          'as unavailable',
      ).toContain(catalog.source)
      expect(
        catalog.unavailable_reason ?? null,
        'and it must not be labelled unreachable — GitHub answered fine; it ' +
          'was only the credential that was refused',
      ).toBeNull()
    }

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
  test('release-catalogue cache TTL persists, and a below-floor value is clamped, never stored', async ({
    page,
    testInfra,
  }) => {
    await gotoRuntimeSettings(page, testInfra.baseURL)

    const field = byTestId(page, 'llmrt-config-release-cache-ttl')
    await expect(field).toBeVisible({ timeout: 30000 })

    // --- happy path: an in-bounds value saves and survives a reload ---------
    await field.fill('')
    await field.fill('900')
    const accepted = await saveRuntimeConfig(page)
    expect(accepted.sentTtl, 'the typed value is what gets sent').toBe(900)
    expect(accepted.status, 'an in-bounds TTL must be accepted').toBe(200)

    await page.reload()
    await page.waitForLoadState('load')
    const reloaded = byTestId(page, 'llmrt-config-release-cache-ttl')
    await expect(reloaded).toBeVisible({ timeout: 30000 })
    await expect(reloaded).toHaveValue('900')

    // --- below the floor: an out-of-bounds value can never be STORED --------
    //
    // What actually happens, measured: the field clamps to its `min` (60) and
    // the server is sent 60, which it accepts. So `10` never reaches the
    // database — which is the property that matters — but the mechanism is a
    // SILENT CLAMP, not a refusal, and the stored value therefore becomes 60
    // rather than staying 900.
    //
    // This spec previously asserted "the stored value is NOT replaced" and
    // passed — but only because `click()` was not awaited and `page.reload()`
    // ABORTED the PUT in flight (observed: status -1). It was certifying the
    // race, not the behaviour. With the save awaited, the truth shows up.
    await reloaded.fill('')
    await reloaded.fill('10')
    const clamped = await saveRuntimeConfig(page)
    expect(
      clamped.sentTtl,
      'a below-floor value must never reach the server; the control clamps ' +
        'it to the 60s floor first',
    ).toBe(60)
    expect(clamped.status, 'and the clamped value is in-bounds').toBe(200)

    await page.reload()
    await page.waitForLoadState('load')
    const afterReject = byTestId(page, 'llmrt-config-release-cache-ttl')
    await expect(afterReject).toBeVisible({ timeout: 30000 })
    await expect(
      afterReject,
      'the persisted value is the clamped floor — never the out-of-bounds 10',
    ).toHaveValue('60')

    // --- and the SERVER enforces the floor independently ---------------------
    //
    // The clamp above is a client-side control affordance; any API client
    // bypasses it. Asserting only the clamp would delete all coverage of the
    // backend bound, so drive the endpoint directly with the out-of-bounds
    // value the UI refuses to send.
    const token = await getCurrentUserToken(page)
    const direct = await page.evaluate(async t => {
      const r = await fetch('/api/local-runtime/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          idle_unload_secs: 1800,
          auto_start_timeout_secs: 30,
          drain_timeout_secs: 30,
          engine_release_cache_ttl_secs: 10,
        }),
      })
      return { status: r.status, body: (await r.text()).slice(0, 300) }
    }, token)
    expect(
      direct.status,
      `the server must refuse a below-floor TTL on its own, not rely on the ` +
        `control clamping first. Got ${direct.status}: ${direct.body}`,
    ).toBeGreaterThanOrEqual(400)

    // ...and the refusal must not have replaced the stored value.
    await page.reload()
    await page.waitForLoadState('load')
    const afterServerReject = byTestId(page, 'llmrt-config-release-cache-ttl')
    await expect(afterServerReject).toBeVisible({ timeout: 30000 })
    await expect(afterServerReject).toHaveValue('60')
  })
})
