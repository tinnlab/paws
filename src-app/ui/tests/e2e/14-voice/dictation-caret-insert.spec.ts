import type { Page } from '@playwright/test'
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
 * TEST-17..TEST-23 — dictation lands where the user is typing, and streams
 * while they speak.
 *
 * These specs are the e2e half of `ui/docs/VOICE_DICTATION_COMPOSER.md`. Each
 * one is written against a behaviour that was REPRODUCED failing on a live rig
 * with a real whisper backend before the fix (§2 of that document): the
 * transcript appeared in the composer TOOLBAR while recording, then landed at
 * the END of the value instead of at the caret.
 */

const DRAFT = 'Please book  for next Tuesday.'
/** Caret between "book " and " for" — mid-sentence, exactly as reported. */
const CARET = 12

/** Read the composer's real value + caret/selection out of the DOM. */
async function composerState(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="chat-message-textarea"]',
    )!
    return {
      value: el.value,
      start: el.selectionStart,
      end: el.selectionEnd,
      focused: document.activeElement === el,
    }
  })
}

/** Put the caret (or a selection) where a user would have left it. */
async function placeCaret(page: Page, start: number, end = start) {
  await page.evaluate(
    ({ start, end }: { start: number; end: number }) => {
      const el = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="chat-message-textarea"]',
      )!
      el.focus()
      el.setSelectionRange(start, end)
    },
    { start, end },
  )
}

/**
 * The text content of the composer's TOOLBAR ROW, mid-recording.
 *
 * Located from two controls that genuinely live in it — the "+" button and the
 * Stop button — by walking up to their common ancestor. Deliberately NOT
 * `[data-testid="chat-input-toolbar"]`: no such element exists, so an assertion
 * against it matches nothing, `allInnerTexts()` returns `[]`, and every
 * `not.toContain(...)` passes vacuously. Returns null if the row cannot be
 * found, so the caller fails loudly instead of asserting against nothing.
 */
async function toolbarRowText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const add = document.querySelector('[data-testid="chat-input-add-btn"]')
    const stop = document.querySelector(
      'button[aria-label="Stop recording and transcribe"]',
    )
    if (!add || !stop) return null
    let row: HTMLElement | null = add as HTMLElement
    while (row && !row.contains(stop)) row = row.parentElement
    return row ? (row.textContent ?? '') : null
  })
}

/** Dismiss the one-time privacy hint, then start recording. */
async function startDictation(page: Page) {
  const hintDismiss = byTestId(page, 'voice-privacy-hint-dismiss')
  if (await hintDismiss.isVisible().catch(() => false)) await hintDismiss.click()
  await byTestId(page, 'voice-mic-button').first().click()
  await expect(byTestId(page, 'voice-elapsed')).toBeVisible({ timeout: 10000 })
}

async function stopDictation(page: Page) {
  await page
    .getByRole('button', { name: 'Stop recording and transcribe' })
    .click()
}

test.describe('Voice — dictation inserts at the caret (TEST-17..TEST-23)', () => {
  // TEST-17 [acceptance, INV-1]
  test('the literal repro: the transcript lands AT THE CARET, and never in the toolbar', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(
      page,
      defaultVoiceState({
        transcribe: { text: 'a table', language: 'en', duration_ms: 700 },
        streamTranscribe: { text: 'a tabl', language: 'en', duration_ms: 90 },
      }),
    )
    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    await textarea.click()
    await textarea.fill(DRAFT)
    await placeCaret(page, CARET)
    expect((await composerState(page)).start).toBe(CARET)

    await startDictation(page)

    // MID-RECORDING: the provisional words are in the CHAT INPUT, and the
    // toolbar row — the literal "tools" of the defect report — carries none of
    // them. Asserted here rather than after Stop, because after Stop the
    // recording chrome is unmounted and any such check passes vacuously.
    await expect(textarea).toHaveValue('Please book a tabl for next Tuesday.', {
      timeout: 15000,
    })
    const toolbar = await toolbarRowText(page)
    expect(toolbar, 'the composer toolbar row must be locatable').not.toBeNull()
    expect(toolbar).not.toContain('a tabl')
    // Positive control for the probe itself: it really is reading the toolbar.
    expect(toolbar).toMatch(/0:0\d/)

    await stopDictation(page)

    // The transcript is INSIDE the sentence. Append-at-end — the shipped defect —
    // would have produced "…next Tuesday. a table", which this cannot match.
    await expect(textarea).toHaveValue('Please book a table for next Tuesday.', {
      timeout: 15000,
    })

    const after = await composerState(page)
    expect(after.value.endsWith('a table')).toBe(false)
    // …and the caret is left right after the inserted words, not at the end.
    expect(after.value.slice(0, after.start)).toBe('Please book a table')
    expect(after.start).toBeLessThan(after.value.length)

  })

  // TEST-18
  test('a selected range is REPLACED by the transcript', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(
      page,
      defaultVoiceState({
        transcribe: { text: 'Alice', language: 'en', duration_ms: 500 },
        // Streaming off so the FINAL insert is what the assertion sees.
        capability: readyCapability({ streaming_enabled: false }),
      }),
    )
    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    await textarea.click()
    await textarea.fill('call Bob tomorrow')
    await placeCaret(page, 5, 8) // "Bob"

    await startDictation(page)
    await stopDictation(page)

    await expect(textarea).toHaveValue('call Alice tomorrow', { timeout: 15000 })
  })

  // TEST-19 [acceptance, INV-5]
  test('a composer that was never focused still APPENDS at the end (no regression)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(
      page,
      defaultVoiceState({
        transcribe: { text: 'a table', language: 'en', duration_ms: 500 },
        capability: readyCapability({ streaming_enabled: false }),
      }),
    )
    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    // Seed the draft the way the composer's own draft-restore effect does — an
    // imperative `el.value =` — and NEVER focus or click the textarea. This is
    // the genuine never-focused state; nothing about the DOM is fabricated.
    // (An earlier version of this spec stubbed `selectionStart` to null, a value
    // a mounted textarea never returns, so it proved nothing about production.)
    await page.evaluate(draft => {
      const el = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="chat-message-textarea"]',
      )!
      el.value = draft
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, DRAFT)
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA')

    await startDictation(page)
    await stopDictation(page)

    await expect(byTestId(page, 'chat-message-textarea')).toHaveValue(
      'Please book  for next Tuesday. a table',
      { timeout: 15000 },
    )
  })

  // TEST-20 [acceptance, INV-2]
  test('real-time: the composer fills in WHILE recording, before Stop is clicked', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    const voice = await routeVoice(
      page,
      defaultVoiceState({
        // A 300 ms cadence (the engine's clamp floor) keeps the spec brisk.
        capability: readyCapability({ stream_interval_ms: 300 }),
        streamTranscribe: { text: 'And so', language: 'en', duration_ms: 60 },
        transcribe: {
          text: 'And so my fellow Americans',
          language: 'en',
          duration_ms: 900,
        },
      }),
    )
    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    await textarea.click()
    await textarea.fill(DRAFT)
    await placeCaret(page, CARET)

    await startDictation(page)

    // FIRST interim — text is in the CHAT INPUT, with Stop not yet clicked.
    await expect(textarea).toHaveValue('Please book And so for next Tuesday.', {
      timeout: 15000,
    })
    await expect(byTestId(page, 'voice-elapsed')).toBeVisible() // still recording

    // SECOND interim REVISES the first in place — the composer grows, it does
    // not accumulate superseded wording.
    voice.setStream({ text: 'And so my fellow', language: 'en', duration_ms: 90 })
    await expect(textarea).toHaveValue(
      'Please book And so my fellow for next Tuesday.',
      { timeout: 15000 },
    )
    await expect(byTestId(page, 'voice-elapsed')).toBeVisible()
    expect(voice.state.streamCount).toBeGreaterThanOrEqual(2)
    // Nothing has been finalised yet: this is genuinely mid-recording.
    expect(voice.state.transcribeCount).toBe(0)

    // Stop → the authoritative transcript replaces the provisional span.
    await stopDictation(page)
    await expect(textarea).toHaveValue(
      'Please book And so my fellow Americans for next Tuesday.',
      { timeout: 15000 },
    )
  })

  // TEST-21 [acceptance, INV-4]
  test('cancelling after live text landed restores the composer exactly', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    const voice = await routeVoice(
      page,
      defaultVoiceState({
        capability: readyCapability({ stream_interval_ms: 300 }),
        streamTranscribe: { text: 'a tabl', language: 'en', duration_ms: 60 },
      }),
    )
    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    await textarea.click()
    await textarea.fill(DRAFT)
    await placeCaret(page, CARET)
    const before = await composerState(page)

    await startDictation(page)
    // Wait until provisional text has VISIBLY landed — cancelling before
    // anything was written would prove nothing.
    await expect(textarea).toHaveValue('Please book a tabl for next Tuesday.', {
      timeout: 15000,
    })

    await byTestId(page, 'voice-cancel-button').click()
    await expect(byTestId(page, 'voice-elapsed')).toHaveCount(0)

    await expect(textarea).toHaveValue(DRAFT, { timeout: 10000 })
    const after = await composerState(page)
    expect(after.value).toBe(before.value)
    expect(after.start).toBe(before.start)
    expect(after.end).toBe(before.end)
    // Cancel never finalises.
    expect(voice.state.transcribeCount).toBe(0)
  })

  // TEST-22 [acceptance, INV-3]
  test('a full stream → stop cycle sends NOTHING', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    const voice = await routeVoice(
      page,
      defaultVoiceState({
        capability: readyCapability({ stream_interval_ms: 300 }),
        streamTranscribe: { text: 'send this now', language: 'en', duration_ms: 60 },
        transcribe: { text: 'send this now please', language: 'en', duration_ms: 800 },
      }),
    )
    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    await textarea.click()
    await textarea.fill('')
    await placeCaret(page, 0)

    await startDictation(page)
    await expect(textarea).toHaveValue('send this now', { timeout: 15000 })
    await stopDictation(page)
    await expect(textarea).toHaveValue('send this now please', { timeout: 15000 })

    // The transcript is sitting in the composer, unsent — even though it reads
    // like an instruction and even though dictation now writes continuously.
    expect(voice.state.transcribeCount).toBe(1)
    await expect(byTestId(page, 'chat-message')).toHaveCount(0)
    expect(new URL(page.url()).pathname).not.toMatch(/\/conversations\//)
  })

  // TEST-25 — dictated text is a real composer edit, so it PERSISTS.
  test('dictated text survives leaving the page and coming back', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(
      page,
      defaultVoiceState({
        transcribe: { text: 'a table for four', language: 'en', duration_ms: 500 },
        capability: readyCapability({ streaming_enabled: false }),
      }),
    )
    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    await textarea.click()
    await placeCaret(page, 0)

    await startDictation(page)
    await stopDictation(page)
    await expect(textarea).toHaveValue('a table for four', { timeout: 15000 })

    // Leave the composer entirely, then come back to it.
    await page.goto(`${baseURL}/knowledge`)
    await page.waitForLoadState('load')
    await gotoComposer(page, baseURL)

    // The transcript is still there. This is NOT incidental: the composer
    // persists its draft from React's `onChange`, and an imperative
    // `el.value = …` fires nothing — React's own value tracker even swallows a
    // dispatched `input` event unless the write goes through the prototype
    // setter. Without that, the draft-restore effect writes the STALE draft
    // (here: empty) over the whole transcript on the way back.
    await expect(byTestId(page, 'chat-message-textarea')).toHaveValue(
      'a table for four',
      { timeout: 15000 },
    )
  })

  // TEST-23
  test('focus returns to the composer, found WITHOUT any testid', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await installVoiceBrowserMocks(page)
    await routeVoice(
      page,
      defaultVoiceState({
        transcribe: { text: 'a table', language: 'en', duration_ms: 500 },
        capability: readyCapability({ streaming_enabled: false }),
      }),
    )
    await loginAsAdmin(page, baseURL)
    await gotoComposer(page, baseURL)

    const textarea = byTestId(page, 'chat-message-textarea')
    await textarea.click()
    await textarea.fill(DRAFT)
    await placeCaret(page, CARET)

    await startDictation(page)
    await stopDictation(page)
    await expect(textarea).toHaveValue('Please book a table for next Tuesday.', {
      timeout: 15000,
    })

    // Resolved by ACCESSIBLE NAME, not by `data-testid`. Production builds strip
    // every `data-test*` attribute, which is exactly why the previous
    // testid-querySelector focus helper was a no-op in every shipped build
    // (`ui/docs/VOICE_DICTATION_COMPOSER.md` §2.1). A spec that asserted focus
    // through the testid would pass here and still ship the defect.
    const focused = await page.evaluate(() => {
      const el = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Message"]',
      )
      return {
        isActive: !!el && document.activeElement === el,
        caretText: el ? el.value.slice(0, el.selectionStart ?? 0) : null,
      }
    })
    expect(focused.isActive).toBe(true)
    expect(focused.caretText).toBe('Please book a table')
  })
})
