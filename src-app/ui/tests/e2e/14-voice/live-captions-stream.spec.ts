import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import {
  installVoiceBrowserMocks,
  routeVoice,
  defaultVoiceState,
  readyCapability,
  gotoComposer,
} from './voice-helpers'

/**
 * TEST-24 (was TEST-10) — live captions stream INTO THE COMPOSER while
 * recording, and the final authoritative transcript supersedes them.
 *
 * ## This spec previously certified the defect
 *
 * Its earlier form asserted that the interim transcript rendered in the
 * `voice-live-caption` strip — an `aria-hidden`, `max-w-48`, `dir="rtl"`-clipped
 * `<span>` living INSIDE THE COMPOSER TOOLBAR — and that the composer stayed
 * EMPTY until Stop. That is precisely the behaviour the product owner reported
 * as a defect ("it should be appending in chat input …, not on the tools"), so
 * the spec was green on the shipped bug. See
 * `ui/docs/VOICE_DICTATION_COMPOSER.md` §1/§2 for the reproduction.
 *
 * It is REWRITTEN, not deleted: the same flow is still covered, now asserting
 * the correct contract — the words appear in the chat input as they are spoken,
 * and no transcript text is rendered in the toolbar in ANY recording state.
 */
test.describe('Voice — live captions stream into the composer (TEST-24)', () => {
  test('interim transcripts land in the composer; the final one supersedes them; nothing is sent', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    const voice = await routeVoice(
      page,
      defaultVoiceState({
        capability: readyCapability({ stream_interval_ms: 300 }),
        streamTranscribe: {
          text: 'live interim words so far',
          language: 'en',
          duration_ms: 90,
        },
        transcribe: {
          text: 'the final authoritative sentence',
          language: 'en',
          duration_ms: 700,
        },
      }),
    )

    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    await expect(textarea).toHaveValue('')

    // Live captions default ON (streaming_enabled) → the toggle shows pressed.
    await expect(byTestId(page, 'voice-live-toggle')).toHaveAttribute('aria-pressed', 'true')

    const hintDismiss = byTestId(page, 'voice-privacy-hint-dismiss')
    if (await hintDismiss.isVisible().catch(() => false)) await hintDismiss.click()

    await byTestId(page, 'voice-mic-button').first().click()
    await expect(byTestId(page, 'voice-elapsed')).toBeVisible({ timeout: 10000 })

    // The interim loop writes into the CHAT INPUT while recording is still live.
    await expect(textarea).toHaveValue('live interim words so far', { timeout: 15000 })
    await expect(byTestId(page, 'voice-elapsed')).toBeVisible()
    expect(voice.state.streamCount).toBeGreaterThanOrEqual(1)
    expect(voice.state.transcribeCount).toBe(0)

    // There is NO transcript surface in the toolbar. Read the real toolbar row
    // (located from two controls that live in it) WHILE recording — the only
    // moment such a surface could exist. A `toHaveCount(0)` on the deleted
    // element would be a tautology: no implementation could make it non-zero.
    const toolbar = await page.evaluate(() => {
      const add = document.querySelector('[data-testid="chat-input-add-btn"]')
      const stop = document.querySelector(
        'button[aria-label="Stop recording and transcribe"]',
      )
      if (!add || !stop) return null
      // Bounded, for the same reason as `toolbarRowText` in the sibling spec:
      // an unbounded climb would reach <html> and pass vacuously.
      let row: HTMLElement | null = add as HTMLElement
      for (let depth = 0; row && !row.contains(stop); depth++) {
        if (depth > 6) return null
        row = row.parentElement
      }
      return row ? (row.textContent ?? '') : null
    })
    expect(toolbar, 'the composer toolbar row must be locatable').not.toBeNull()
    expect(toolbar).not.toContain('live interim words')
    expect(toolbar).toMatch(/0:0\d/) // positive control: it IS the toolbar

    // Stop → the AUTHORITATIVE final transcript replaces the interim words
    // (rather than being appended after them).
    await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
    await expect(textarea).toHaveValue('the final authoritative sentence', { timeout: 15000 })

    // Exactly one FINAL transcribe, and nothing sent.
    expect(voice.state.transcribeCount).toBe(1)
    await expect(byTestId(page, 'chat-message')).toHaveCount(0)
    expect(new URL(page.url()).pathname).not.toMatch(/\/conversations\//)
  })

  test('with live captions OFF nothing lands until Stop', async ({ page, testInfra }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    const voice = await routeVoice(
      page,
      defaultVoiceState({
        capability: readyCapability({ stream_interval_ms: 300 }),
        streamTranscribe: { text: 'should never appear', language: 'en', duration_ms: 90 },
        transcribe: { text: 'only this at the end', language: 'en', duration_ms: 700 },
      }),
    )

    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    const hintDismiss = byTestId(page, 'voice-privacy-hint-dismiss')
    if (await hintDismiss.isVisible().catch(() => false)) await hintDismiss.click()

    // Turn the per-device preference off, then record.
    await byTestId(page, 'voice-live-toggle').click()
    await expect(byTestId(page, 'voice-live-toggle')).toHaveAttribute('aria-pressed', 'false')

    await byTestId(page, 'voice-mic-button').first().click()
    await expect(byTestId(page, 'voice-elapsed')).toBeVisible({ timeout: 10000 })

    // The interim loop is not armed: the composer stays empty and no stream
    // request is made at all. This is the positive control for the test above —
    // it proves that spec's composer text really came from the interim loop.
    await page.waitForTimeout(1200)
    await expect(textarea).toHaveValue('')
    expect(voice.state.streamCount).toBe(0)

    await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
    await expect(textarea).toHaveValue('only this at the end', { timeout: 15000 })
  })
})
