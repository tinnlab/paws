import { loginAsAdmin } from '../../common/auth-helpers'
import { expect, test } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import {
  defaultVoiceState,
  installVoiceBrowserMocks,
  mkVoiceModel,
  routeVoice,
} from './voice-helpers'

/**
 * Whisper model management (download / upload / activate / delete) on the
 * reworked /settings/voice page. All /api/voice/** is mocked via voice-helpers
 * so no whisper runtime, DB rows, or network are needed.
 *
 * TEST-17 — AvailableModelsCard lists a paginated catalog; Install shows the
 *           inline SSE progress bar advancing to complete.
 * TEST-18 — the installed model appears; Set-active + Delete (Confirm) work;
 *           the active-model delete guard is honored.
 * TEST-19 — the Upload drawer: select a file, per-file/overall progress render,
 *           and on success the model appears tagged upload/unverified.
 * TEST-20 — at 390px the cards render without horizontal page scroll.
 */
test.describe('Voice — model management', () => {
  test('TEST-17: catalog paginates; Install drives the progress bar to complete', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(page, defaultVoiceState())

    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })

    // The available-models card lists the catalog, paginated (12 > PAGE_SIZE 10).
    const available = byTestId(page, 'voice-available-models-card')
    await expect(available).toBeVisible()
    await expect(
      byTestId(page, 'voice-available-models-pagination'),
    ).toContainText(/of 12/, { timeout: 15000 })
    // A first-page model row + its Install button.
    await expect(byTestId(page, 'voice-available-model-row-base')).toBeVisible()

    // Install `base` → POST download → SSE (connected/progress/complete).
    await byTestId(page, 'voice-available-model-install-base').click()

    // The inline progress line renders (it lingers ~2s after complete before
    // auto-dismiss), proving the progress→complete pipeline ran.
    await expect(
      page.locator('[data-testid^="voice-model-download-progress-"]'),
    ).toBeVisible({ timeout: 15000 })

    // On complete the catalog reload flips `base` to installed.
    await expect(
      byTestId(page, 'voice-available-model-installed-tag-base'),
    ).toBeVisible({ timeout: 15000 })
  })

  test('TEST-18: installed model appears, set-active + delete work, active-delete guard honored', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(page, defaultVoiceState())

    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })

    // Install `base` from the catalog → it lands in the installed library.
    await byTestId(page, 'voice-available-model-install-base').click()
    await expect(byTestId(page, 'voice-installed-model-row-base')).toBeVisible({
      timeout: 15000,
    })

    // Set it active → the active tag appears and the set-active button drops.
    await byTestId(page, 'voice-installed-model-activate-base').click()
    await expect(
      byTestId(page, 'voice-installed-model-active-tag-base'),
    ).toBeVisible({ timeout: 10000 })
    await expect(
      byTestId(page, 'voice-installed-model-activate-base'),
    ).toHaveCount(0)

    // Delete the ACTIVE model → the guard requires acknowledging first.
    await byTestId(page, 'voice-installed-model-delete-base').click()
    const confirmOk = byTestId(
      page,
      'voice-installed-model-delete-confirm-base-confirm',
    )
    const ack = byTestId(page, 'voice-installed-model-delete-ackactive-base')
    await expect(ack).toBeVisible({ timeout: 10000 })
    // Guard honored: OK is disabled until the active-model ack is checked.
    await expect(confirmOk).toBeDisabled()
    await ack.click()
    await expect(confirmOk).toBeEnabled()
    await confirmOk.click()

    // The row is removed.
    await expect(byTestId(page, 'voice-installed-model-row-base')).toHaveCount(
      0,
      { timeout: 10000 },
    )
  })

  test('TEST-19: upload drawer shows progress and the uploaded model appears tagged upload/unverified', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(page, defaultVoiceState())

    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })

    // Open the upload drawer.
    await byTestId(page, 'voice-model-upload-open-btn').click()
    await expect(byTestId(page, 'voice-upload-drawer-submit-btn')).toBeVisible({
      timeout: 10000,
    })

    // Select a ggml file → the name auto-derives (ggml-myupload.bin → myupload).
    await byTestId(page, 'voice-upload-files')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'ggml-myupload.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('fake ggml model bytes'),
      })
    await expect(byTestId(page, 'voice-upload-selected-file')).toBeVisible()

    // Submit → the upload is held ~1.2s server-side so the progress card shows.
    await byTestId(page, 'voice-upload-drawer-submit-btn').click()
    await expect(byTestId(page, 'voice-upload-progress-card')).toBeVisible({
      timeout: 10000,
    })
    await expect(byTestId(page, 'voice-upload-file-progress-0')).toBeVisible()

    // On success the drawer closes and the uploaded model appears in the library
    // tagged `upload` + `unverified`.
    await expect(
      byTestId(page, 'voice-installed-model-row-myupload'),
    ).toBeVisible({ timeout: 15000 })
    await expect(
      byTestId(page, 'voice-installed-model-source-myupload'),
    ).toContainText('upload')
    await expect(
      byTestId(page, 'voice-installed-model-verified-myupload'),
    ).toContainText('unverified')
  })

  test('TEST-20: at 390px the cards render without horizontal page scroll', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await page.setViewportSize({ width: 390, height: 844 })
    await installVoiceBrowserMocks(page)
    await routeVoice(
      page,
      defaultVoiceState({
        models: [mkVoiceModel('base', { is_active: true })],
      }),
    )

    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })

    // Both reworked cards render at mobile width.
    await expect(byTestId(page, 'voice-available-models-card')).toBeVisible()
    await expect(byTestId(page, 'voice-installed-models-card')).toBeVisible()

    // No horizontal page scroll (controls wrap rather than overflow the body).
    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

/**
 * voice-model-bad-magic regression specs.
 *
 * The owner's screenshot showed `/settings/voice` claiming "No models installed
 * yet" while simultaneously rendering, under two catalog rows, a bare "0 Bytes"
 * and "file is not a whisper ggml/GGUF model (bad magic)" — a file-validation
 * error for models that were never installed.
 *
 * See `.lifecycle/voice-model-bad-magic/` (INV-1, INV-2, INV-6).
 */
test.describe('Voice — failed install presentation', () => {
  test('TEST-12: zero installed models → no per-model validation error, no bare "0 Bytes"', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    // Nothing installed, and any install attempt fails — the exact live state.
    const state = defaultVoiceState()
    state.models = []
    state.catalog = {
      ...state.catalog,
      models: state.catalog.models.map(m => ({ ...m, installed: false })),
    }
    state.failModelDownloadWith =
      'the downloaded file is not a whisper model: it starts with `3c 21 44 4f` ("<!DO") instead of a recognised container header. Expected a whisper model file (a `ggml` or `GGUF` container). Check that it points directly at the raw file, then re-download.'
    await routeVoice(page, state)

    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })
    await expect(byTestId(page, 'voice-available-models-card')).toBeVisible()

    const pageText = async () => (await page.locator('body').innerText()) ?? ''

    // Precondition: the page really is in the "nothing installed" state.
    expect(await pageText()).toMatch(/no models installed/i)

    // INV-1/INV-2: with nothing installed, NO per-model file-validation error
    // may be on the page — for ANY model, not just the two in the screenshot.
    const before = await pageText()
    expect(before).not.toMatch(/bad magic/i)
    expect(before).not.toMatch(/is not a whisper/i)

    // INV-6: no catalog row may render a bare "0 Bytes" byte count. (The rows
    // legitimately show their catalog sizes, e.g. "141.1 MB".)
    const rows = page.locator('[data-testid^="voice-available-model-row-"]')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(0)
    for (let i = 0; i < rowCount; i++) {
      const text = await rows.nth(i).innerText()
      expect(
        text,
        `row ${i} must not render a bare "0 Bytes" next to its catalog size`,
      ).not.toMatch(/\b0 Bytes\b/)
    }

    // Now drive a REAL failed install and re-assert the invariant holds: the
    // failure is presented as a failed ATTEMPT, never as a file error, and still
    // no bare "0 Bytes" appears even though the task reports 0 bytes received.
    await byTestId(page, 'voice-available-model-install-base').click()
    const failure = byTestId(page, 'voice-available-model-failed-base')
    await expect(failure).toBeVisible({ timeout: 15000 })
    await expect(failure).toContainText(/install failed/i)

    // Still nothing installed…
    expect(await pageText()).toMatch(/no models installed/i)
    // …and the failing row still shows no bare zero byte-count.
    const failedRow = byTestId(page, 'voice-available-model-row-base')
    expect(await failedRow.innerText()).not.toMatch(/\b0 Bytes\b/)
  })

  test('TEST-11: a failed install is labelled and offers Retry (models + versions cards)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    const state = defaultVoiceState()
    state.models = []
    state.catalog = {
      ...state.catalog,
      models: state.catalog.models.map(m => ({ ...m, installed: false })),
    }
    state.failModelDownloadWith =
      'the downloaded file is empty (0 bytes). Expected a whisper model file (a `ggml` or `GGUF` container). The source returned no data — check that the URL points directly at the model file, then try the download again.'
    await routeVoice(page, state)

    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })

    await byTestId(page, 'voice-available-model-install-base').click()

    const failure = byTestId(page, 'voice-available-model-failed-base')
    await expect(failure).toBeVisible({ timeout: 15000 })
    // Explicitly framed as a failed INSTALL ATTEMPT — not bare metadata.
    await expect(failure).toContainText(/install failed/i)
    // The server's actionable reason is surfaced verbatim: what was found,
    // what was expected, and what to do.
    await expect(failure).toContainText(/empty \(0 bytes\)/i)
    await expect(failure).toContainText(/expected a whisper model file/i)
    await expect(failure).toContainText(/try the download again/i)
    // It is announced to assistive tech, not just visually styled.
    await expect(failure).toHaveAttribute('role', 'alert')

    // And the corrective action is reachable in place.
    const retry = byTestId(page, 'voice-available-model-failed-base-retry')
    await expect(retry).toBeVisible()
    await expect(retry).toBeEnabled()
    const startsBeforeRetry = state.modelDownloadStartCount
    expect(startsBeforeRetry).toBe(1)
    await retry.click()
    // Retrying really RE-ISSUES the install — asserted on the request count, not
    // on the failure row still being on screen (which it would be either way, so
    // that assertion could not fail and would not prove the control is wired).
    await expect
      .poll(() => state.modelDownloadStartCount, { timeout: 15000 })
      .toBe(startsBeforeRetry + 1)
    // …and it fails again, with the same framing.
    await expect(failure).toBeVisible({ timeout: 15000 })
    await expect(failure).toContainText(/install failed/i)
  })

  test('TEST-11b: the runtime-VERSIONS card on the same page presents a failed install identically', async ({
    page,
    testInfra,
  }) => {
    // INV-2 is a statement about the PAGE. `AvailableVersionsCard` renders
    // directly above the models card on `/settings/voice` and carried the
    // byte-identical defect (a bare `<Text type="secondary">{error}</Text>` plus
    // an unlabelled zero), so the shared `DownloadFailureRow` has to be asserted
    // on both cards — otherwise the twin silently keeps the incoherence one card
    // higher. See `.lifecycle/voice-model-bad-magic/` (ITEM-12).
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    const state = defaultVoiceState()
    state.failVersionDownloadWith =
      'the downloaded file is empty (0 bytes). Expected a whisper runtime binary. The source returned no data — check the release URL, then try the download again.'
    await routeVoice(page, state)

    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })
    await expect(byTestId(page, 'voice-version-row-v1.1.0')).toBeVisible({
      timeout: 15000,
    })

    await byTestId(page, 'voice-version-install-v1.1.0').click()

    const failure = byTestId(page, 'voice-version-failed-v1.1.0')
    await expect(failure).toBeVisible({ timeout: 15000 })
    await expect(failure).toContainText(/install failed/i)
    await expect(failure).toContainText(/empty \(0 bytes\)/i)
    await expect(failure).toHaveAttribute('role', 'alert')
    await expect(
      byTestId(page, 'voice-version-failed-v1.1.0-retry'),
    ).toBeEnabled()

    // INV-6 on this card too: a failure that transferred nothing renders no
    // byte count at all, so no naked "0 Bytes" sits under the row's real size.
    const row = byTestId(page, 'voice-version-row-v1.1.0')
    expect(await row.innerText()).not.toMatch(/\b0 Bytes\b/)
  })
})
