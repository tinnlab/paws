import { Permissions } from '../../../src/api-client/permissions'
import { loginWithPerms } from '../permissions/fixtures'
import { expect, test } from '../permissions/no-403'
import { byTestId } from '../testid'
import {
  defaultVoiceState,
  installVoiceBrowserMocks,
  mkVoiceModel,
  routeVoice,
} from './voice-helpers'

/**
 * TEST-24 [negative-perm] — model-management authorization on /settings/voice.
 *
 *  - A user with ONLY `voice::admin::read` sees the page and the model lists but
 *    NO manage controls (Install / Upload / Set-active / Delete), and drives no
 *    unexpected 403 (the no-403 fixture) — the store reads self-gate correctly.
 *  - A user without `voice::admin::read` cannot reach the page at all.
 */
test.describe('Voice model management — read-only user (TEST-24)', () => {
  test('read-only voice admin sees the lists but no manage controls', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(
      page,
      defaultVoiceState({
        // One active + one inactive installed model so the (absent) Set-active
        // and Delete controls have rows to hang off.
        models: [
          mkVoiceModel('base', { is_active: true }),
          mkVoiceModel('small'),
        ],
      }),
    )

    await loginWithPerms(
      page,
      baseURL,
      apiURL,
      [Permissions.VoiceAdminRead],
      'voice-ro',
    )
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })

    // The read surfaces are present.
    await expect(byTestId(page, 'voice-available-models-card')).toBeVisible()
    await expect(byTestId(page, 'voice-installed-models-card')).toBeVisible()
    await expect(
      byTestId(page, 'voice-installed-model-row-small'),
    ).toBeVisible()

    // No manage affordances anywhere.
    await expect(byTestId(page, 'voice-model-upload-open-btn')).toHaveCount(0)
    await expect(
      byTestId(page, 'voice-available-model-install-base'),
    ).toHaveCount(0)
    await expect(byTestId(page, 'voice-model-add-url-form')).toHaveCount(0)
    await expect(
      byTestId(page, 'voice-installed-model-activate-small'),
    ).toHaveCount(0)
    await expect(
      byTestId(page, 'voice-installed-model-delete-small'),
    ).toHaveCount(0)
    await expect(
      byTestId(page, 'voice-installed-model-delete-base'),
    ).toHaveCount(0)

    // The config card renders its read-only banner (no Save/manage).
    await expect(byTestId(page, 'voice-config-readonly-alert')).toBeVisible()
  })

  /**
   * TEST-16 [negative-perm][acceptance][INV-8] — a failed install's RETRY is a
   * mutation and must be gated like the Install button beside it.
   *
   * `GET /voice/models/downloads` is served under `voice::admin::read`, and
   * `loadActive()` seeds terminal tasks too — so a read-only voice admin really
   * does see the failure row on page load, without clicking anything. The
   * failure MESSAGE is theirs to read; the Retry control is not, because it
   * re-issues `POST /voice/models/download` (`voice::admin::manage`) and could
   * only ever 403.
   *
   * The pre-existing TEST-24 above enumerates the manage controls by test-id, so
   * it stayed green when `DownloadFailureRow` introduced a NEW ungated one —
   * which is why this assertion is written against the failure row specifically.
   */
  test('read-only voice admin sees a failed install but gets no Retry control', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await installVoiceBrowserMocks(page)
    const state = defaultVoiceState({ models: [] })
    // A terminal FAILED task already in the registry — the exact live shape
    // (0 bytes received, no total) that produced the owner's screenshot.
    state.modelDownloads = [
      {
        task_id: 'model-task-base',
        key: 'model@base',
        name: 'base',
        status: 'failed',
        bytes_received: 0,
        error:
          'the downloaded file is empty (0 bytes). Expected a whisper model file (a `ggml` or `GGUF` container). The source returned no data — check that the URL points directly at the model file, then try the download again.',
      },
    ]
    await routeVoice(page, state)

    await loginWithPerms(
      page,
      baseURL,
      apiURL,
      [Permissions.VoiceAdminRead],
      'voice-ro-fail',
    )
    await page.goto(`${baseURL}/settings/voice`)
    await expect(byTestId(page, 'voice-settings-page-title')).toBeVisible({
      timeout: 30000,
    })

    // The failure is visible and labelled — a read-only admin is entitled to
    // know WHY the install failed.
    const failure = byTestId(page, 'voice-available-model-failed-base')
    await expect(failure).toBeVisible({ timeout: 15000 })
    await expect(failure).toContainText(/install failed/i)
    await expect(failure).toContainText(/empty \(0 bytes\)/i)

    // …but the mutating control is absent, exactly like the Install button.
    await expect(
      byTestId(page, 'voice-available-model-failed-base-retry'),
    ).toHaveCount(0)
    await expect(
      byTestId(page, 'voice-available-model-install-base'),
    ).toHaveCount(0)
  })
})

test.describe('Voice settings — no read permission (TEST-24 negative)', () => {
  // This test intentionally provokes the route/section 403 gate.
  test.use({ allow403: true })

  test('a user without voice::admin::read cannot reach the page', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginWithPerms(page, baseURL, apiURL, [], 'voice-noperm')
    await page.goto(`${baseURL}/settings/voice`)

    // A 403 gate renders in place of the page (router- or settings-section-level).
    await expect(
      page.locator(
        '[data-testid="router-route-forbidden-result"], [data-testid="settings-forbidden-result"]',
      ),
    ).toBeVisible({ timeout: 15000 })
    await expect(byTestId(page, 'voice-settings-page-title')).toHaveCount(0)
  })
})
