import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LONG_TOOL_DESCRIPTION } from '../../dev/gallery/fixtures/longToolDescription.ts'
import { APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX } from '../mcp/chat-extension/components/approvalDescriptionClamp.ts'

/**
 * TEST-14 — the POPULATED approval state stays in the gallery matrix.
 *
 * The pre-existing `deep-chat-tool-approval` cell seeds a two-sentence
 * description, which is exactly the case that HIDES this defect: the card only
 * outgrows the fold once the description is long. This guard keeps the
 * long-description sibling cell registered, so the runtime-health / geometry
 * sweeps keep exercising the clamp at every theme × viewport — including mobile,
 * where the card is tallest.
 *
 * Asserted against the gallery SOURCE (rather than by importing `gallery.tsx`,
 * which would pull the whole chat module and its browser-coupled deps into a
 * `node:test` process).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const GALLERY_SRC = readFileSync(resolve(HERE, 'gallery.tsx'), 'utf8')

const SLUG = 'deep-chat-tool-approval-long-desc'

test('the long-description approval cell is registered in the chat gallery', () => {
  assert.ok(
    GALLERY_SRC.includes(`slug: '${SLUG}'`),
    `${SLUG} must stay in the gallery so the populated approval state is reviewed`,
  )
})

test('the cell seeds a pending_approval tool call using the long description', () => {
  const cell = GALLERY_SRC.split(`slug: '${SLUG}'`)[1] ?? ''
  // Bound the search to this cell's body (up to the next slug declaration).
  const body = cell.split('slug:')[0]
  assert.ok(body.includes("status: 'pending_approval'"), 'must seed the approval state')
  assert.ok(
    body.includes('LONG_TOOL_DESCRIPTION'),
    'must seed the long description, not a short one',
  )
})

test('the seeded description is long enough to actually exercise the clamp', () => {
  // A description only overflows once it wraps past the collapsed cap. At the
  // card's `text-sm` (~20px line-height) the cap is ~6 lines, so anything under
  // a few hundred characters would never trigger the toggle and the cell would
  // silently stop covering the defect.
  const approxLineHeightPx = 20
  const collapsedLines = APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX / approxLineHeightPx
  const generousCharsPerLine = 110
  assert.ok(
    LONG_TOOL_DESCRIPTION.length > collapsedLines * generousCharsPerLine,
    `description (${LONG_TOOL_DESCRIPTION.length} chars) must exceed the collapsed box`,
  )
  // Sanity: it is a realistic ~2k description, not an absurd megabyte.
  assert.ok(LONG_TOOL_DESCRIPTION.length > 1500)
  assert.ok(LONG_TOOL_DESCRIPTION.length < 5000)
})
